/**
 * Configuration loading from KV storage
 */
import { ConfigurationError } from '../../errors';
import { ConfigEnvironment, WorkerConfiguration } from './schemas';
import { convertJsonToConfig } from './validation';
import { createLogger, debug as pinoDebug, error as pinoError } from '../../utils/pinoLogger';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { tryOrNull, logErrorWithContext } from '../../utils/errorHandlingUtils';
import { ConfigurationCache } from './caching';

// Constants
const CONFIG_KEY = 'worker-config';

/**
 * Load configuration from KV storage
 * @param env Environment with KV namespace
 * @param cache Cache for storing KV results
 * @param metrics Metrics for tracking KV operations
 * @returns WorkerConfiguration or null if loading fails
 */
export async function loadFromKV(
  env: ConfigEnvironment,
  cache: ConfigurationCache,
  metrics: Record<string, number | boolean>
): Promise<WorkerConfiguration | null> {
  const requestContext = getCurrentContext();
  const logger = requestContext ? createLogger(requestContext) : null;
  
  // Support flexible binding names
  const kvBindingName = env.CONFIG_KV_NAME || 'VIDEO_CONFIGURATION_STORE';
  const kvNamespace = env[kvBindingName] as KVNamespace | undefined;
  
  if (!kvNamespace) {
    if (logger && requestContext) {
      pinoError(requestContext, logger, 'ConfigurationService', 'KV namespace not available', {
        environment: env.ENVIRONMENT || 'unknown',
        attemptedBinding: kvBindingName,
        hasConfigKvName: !!env.CONFIG_KV_NAME
      });
    }
    metrics.kvErrorCount = (metrics.kvErrorCount as number) + 1;
    return null;
  }
  
  // Track KV fetch metrics
  metrics.kvFetchCount = (metrics.kvFetchCount as number) + 1;
  const startTime = Date.now();
  metrics.kvLastFetchTimestamp = startTime;
  
  try {
    // First try to get from KV with JSON parsing
    const result = await getFromKV(kvNamespace, CONFIG_KEY);
    
    // Calculate fetch duration
    const fetchDuration = Date.now() - startTime;
    metrics.kvLastFetchDurationMs = fetchDuration;
    
    // Track max and average fetch duration
    if (fetchDuration > (metrics.maxFetchDurationMs as number)) {
      metrics.maxFetchDurationMs = fetchDuration;
    }
    
    // Update average with simple moving average
    const prevAvg = metrics.avgFetchDurationMs as number;
    const fetchCount = metrics.kvFetchCount as number;
    metrics.avgFetchDurationMs = prevAvg + (fetchDuration - prevAvg) / fetchCount;
    
    if (!result) {
      if (logger && requestContext) {
        pinoDebug(requestContext, logger, 'ConfigurationService', 'No configuration found in KV', {
          key: CONFIG_KEY
        });
      }
      metrics.kvFetchFailCount = (metrics.kvFetchFailCount as number) + 1;
      return null;
    }
    
    metrics.kvFetchSuccessCount = (metrics.kvFetchSuccessCount as number) + 1;
    
    // Track data size
    metrics.kvLatestFetchSize = typeof result === 'string' 
      ? result.length 
      : JSON.stringify(result).length;
    
    // Try to convert to WorkerConfiguration
    try {
      return convertJsonToConfig(result);
    } catch (error) {
      if (logger && requestContext) {
        pinoError(requestContext, logger, 'ConfigurationService', 'Invalid configuration format', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      metrics.validationErrorCount = (metrics.validationErrorCount as number) + 1;
      return null;
    }
  } catch (error) {
    // Log error and update metrics
    if (logger && requestContext) {
      pinoError(requestContext, logger, 'ConfigurationService', 'Error fetching configuration from KV', {
        error: error instanceof Error ? error.message : String(error),
        key: CONFIG_KEY
      });
    }
    metrics.kvErrorCount = (metrics.kvErrorCount as number) + 1;
    metrics.kvFetchFailCount = (metrics.kvFetchFailCount as number) + 1;
    
    return null;
  }
}

/**
 * Get configuration from KV with optional caching
 * @param kvNamespace KV namespace to use
 * @param key Key to get from KV
 * @returns Configuration object or null if not found
 */
async function getFromKV(
  kvNamespace: KVNamespace,
  key: string
): Promise<unknown> {
  try {
    // Get the configuration from KV
    const result = await kvNamespace.get(key, 'json');
    return result;
  } catch (jsonError) {
    // If JSON parsing fails, try to get as text
    try {
      const textResult = await kvNamespace.get(key, 'text');
      if (!textResult) {
        return null;
      }
      
      // Try to parse the text as JSON
      try {
        return JSON.parse(textResult);
      } catch (parseError) {
        // If parsing fails, return the text
        return textResult;
      }
    } catch (textError) {
      // If both methods fail, return null
      return null;
    }
  }
}

/**
 * Get configuration from cache or KV
 * @param env Environment with KV namespace
 * @param cache Cache for storing KV results
 * @param metrics Metrics for tracking KV operations
 * @returns WorkerConfiguration or null if loading fails
 */
export async function getFromKVWithCache(
  env: ConfigEnvironment,
  cache: ConfigurationCache,
  metrics: Record<string, number | boolean>
): Promise<WorkerConfiguration | null> {
  // First try to get from cache
  const cachedConfig = cache.get<WorkerConfiguration>(CONFIG_KEY);
  
  if (cachedConfig) {
    metrics.cacheHits = (metrics.cacheHits as number) + 1;
    metrics.cacheLastHitTimestamp = Date.now();
    return cachedConfig;
  }
  
  // Cache miss, load from KV
  metrics.cacheMisses = (metrics.cacheMisses as number) + 1;
  
  const config = await loadFromKV(env, cache, metrics);
  
  // If we got a valid config, cache it
  if (config) {
    cache.set(CONFIG_KEY, config);
  }
  
  return config;
}