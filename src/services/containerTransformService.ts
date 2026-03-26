/**
 * Container Transform Service
 *
 * Handles delegating video transformation to a Cloudflare Container
 * running ffmpeg when the input exceeds cdn-cgi/media's size limit.
 *
 * Responsibilities:
 * - Build the container transform request payload
 * - Route the request to the correct container instance
 * - Handle container responses and errors
 * - Manage streaming of the transformed output back to the caller
 */
import { VideoConfigurationManager } from '../config';
import type { ContainerConfiguration } from '../config/videoConfigSchemas';
import type { ContainerNamespace } from '../types/cloudflare';
import { VideoTransformOptions } from '../domain/commands/types';
import { createContainerStrategy } from '../domain/strategies/StrategyFactory';
import { MAX_CONTAINER_OUTPUT_FOR_KV } from './kvStorage/constants';
import { createCategoryLogger } from '../utils/logger';

const logger = createCategoryLogger('ContainerTransformService');

/**
 * Result of a container transformation attempt
 */
export interface ContainerTransformResult {
  success: boolean;
  response?: Response;
  error?: string;
  durationMs?: number;
  /** Whether the output should be cached in KV */
  shouldCacheInKV: boolean;
}

/**
 * Options passed to the container transform function
 */
export interface ContainerTransformOptions {
  request: Request;
  sourceUrl: string;
  videoOptions: VideoTransformOptions;
  containerBinding: ContainerNamespace;
  instanceKey: string;
  inputSizeBytes?: number | null;
}

/**
 * Build a stable container instance key for routing.
 * The same source path always routes to the same container instance,
 * leveraging the container's local disk cache of the source file.
 */
export function buildContainerInstanceKey(originName: string, resolvedPath: string): string {
  return `ffmpeg:${originName}:${resolvedPath}`;
}

/**
 * Execute a video transformation via the container FFmpeg fallback.
 *
 * 1. Validates the options via ContainerVideoStrategy
 * 2. Builds a JSON request for the container's /transform endpoint
 * 3. Sends the request to the container instance
 * 4. Returns the streaming response
 */
export async function transformViaContainer(
  options: ContainerTransformOptions
): Promise<ContainerTransformResult> {
  const startTime = performance.now();
  const configManager = VideoConfigurationManager.getInstance();
  const containerConfig = configManager.getContainerConfig();

  // Validate input size against configured max
  if (options.inputSizeBytes && options.inputSizeBytes > containerConfig.maxInputSize) {
    logger.warn('Input file exceeds container max input size', {
      inputSizeMB: Math.round(options.inputSizeBytes / 1024 / 1024),
      maxInputSizeMB: Math.round(containerConfig.maxInputSize / 1024 / 1024),
    });
    return {
      success: false,
      error: `Input size ${Math.round(options.inputSizeBytes / 1024 / 1024)} MB exceeds container limit of ${Math.round(containerConfig.maxInputSize / 1024 / 1024)} MB`,
      shouldCacheInKV: false,
    };
  }

  // Create and validate via the container strategy
  const strategy = createContainerStrategy(options.videoOptions);
  try {
    await strategy.validateOptions(options.videoOptions);
  } catch (validationError) {
    logger.error('Container transform validation failed', {
      error: validationError instanceof Error ? validationError.message : String(validationError),
    });
    return {
      success: false,
      error: validationError instanceof Error ? validationError.message : String(validationError),
      shouldCacheInKV: false,
    };
  }

  // Build the container request payload
  const payload = {
    sourceUrl: options.sourceUrl,
    width: options.videoOptions.width ?? undefined,
    height: options.videoOptions.height ?? undefined,
    mode: options.videoOptions.mode || 'video',
    quality: options.videoOptions.quality || 'medium',
    fit: options.videoOptions.fit || 'contain',
    duration: options.videoOptions.duration ?? undefined,
    time: options.videoOptions.time || '0s',
    format: 'mp4',
  };

  logger.debug('Sending transform request to container', {
    instanceKey: options.instanceKey,
    payload: {
      width: payload.width,
      height: payload.height,
      quality: payload.quality,
      fit: payload.fit,
      mode: payload.mode,
    },
    inputSizeMB: options.inputSizeBytes
      ? Math.round(options.inputSizeBytes / 1024 / 1024)
      : 'unknown',
  });

  try {
    // Get the container instance by name
    const containerInstance = options.containerBinding.getByName(options.instanceKey);

    // Build the request to the container's transform endpoint
    const containerRequest = new Request('http://container/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Send with a timeout
    const timeoutMs = containerConfig.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let containerResponse: Response;
    try {
      containerResponse = await containerInstance.fetch(containerRequest);
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Math.round(performance.now() - startTime);

    if (!containerResponse.ok) {
      const errorText = await containerResponse.text().catch(() => 'Unknown error');
      logger.error('Container returned error', {
        status: containerResponse.status,
        error: errorText.substring(0, 500),
        durationMs,
        instanceKey: options.instanceKey,
      });
      return {
        success: false,
        error: `Container returned ${containerResponse.status}: ${errorText.substring(0, 200)}`,
        durationMs,
        shouldCacheInKV: false,
      };
    }

    // Determine if we should cache the output in KV
    const outputContentLength = containerResponse.headers.get('Content-Length');
    const outputSize = outputContentLength ? parseInt(outputContentLength, 10) : 0;
    const maxOutput = containerConfig.maxOutputForKV || MAX_CONTAINER_OUTPUT_FOR_KV;
    const shouldCacheInKV = outputSize === 0 || outputSize <= maxOutput;

    if (!shouldCacheInKV) {
      logger.warn('Container output exceeds KV cache limit — serving without caching', {
        outputSizeMB: Math.round(outputSize / 1024 / 1024),
        maxOutputMB: Math.round(maxOutput / 1024 / 1024),
        instanceKey: options.instanceKey,
      });
    }

    logger.debug('Container transform completed', {
      durationMs,
      outputSize: outputSize || 'unknown',
      contentType: containerResponse.headers.get('Content-Type'),
      shouldCacheInKV,
      instanceKey: options.instanceKey,
    });

    return {
      success: true,
      response: containerResponse,
      durationMs,
      shouldCacheInKV,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    const errorMessage = isAbort
      ? `Container transform timed out after ${containerConfig.timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);

    logger.error('Container transform failed', {
      error: errorMessage,
      isTimeout: isAbort,
      durationMs,
      instanceKey: options.instanceKey,
    });

    return {
      success: false,
      error: errorMessage,
      durationMs,
      shouldCacheInKV: false,
    };
  }
}
