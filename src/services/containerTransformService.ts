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
 * - Manage fire-and-forget background transforms with KV storage
 */
import { VideoConfigurationManager } from '../config';
import type { ContainerConfiguration } from '../config/videoConfigSchemas';
import type { ContainerNamespace } from '../types/cloudflare';
import { VideoTransformOptions } from '../domain/commands/types';
import { createContainerStrategy } from '../domain/strategies/StrategyFactory';
import { MAX_CONTAINER_OUTPUT_FOR_KV } from './kvStorage/constants';
import { createCategoryLogger } from '../utils/logger';
import { getCacheKV } from '../utils/flexibleBindings';
import { storeTransformedVideoWithStreaming } from './kvStorage/streamStorage';

const logger = createCategoryLogger('ContainerTransformService');

// ── In-flight container job tracker ──────────────────────────────────────
// Tracks container jobs that have been kicked off via waitUntil so that
// concurrent requests for the same video don't launch duplicate transforms.
// Key = instanceKey (e.g. "ffmpeg:videos:/videos/hero.mp4"), value = start timestamp.
const inFlightContainerJobs = new Map<string, number>();

/**
 * Check whether a container transform is already in progress for this key.
 */
export function isContainerJobInFlight(instanceKey: string): boolean {
  return inFlightContainerJobs.has(instanceKey);
}

/**
 * Get the start time of an in-flight container job.
 */
export function getContainerJobStartTime(instanceKey: string): number | null {
  return inFlightContainerJobs.get(instanceKey) ?? null;
}

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

// ── Fire-and-forget container transform ──────────────────────────────────

/**
 * Options for the fire-and-forget container transform.
 */
export interface FireAndForgetContainerOptions extends ContainerTransformOptions {
  /** KV path for storing the transformed output (typically the URL pathname). */
  kvPath: string;
  /** Environment bindings (for KV access and executionCtx). */
  env: Record<string, unknown>;
}

/**
 * Launch a container transform in the background via `waitUntil`.
 *
 * Unlike `transformViaContainer`, this does NOT block the request. It:
 * 1. Registers the job in the in-flight tracker
 * 2. Kicks off the transform + KV store via `waitUntil`
 * 3. Returns immediately so the caller can send a 202
 *
 * The background job:
 * - Awaits the container response
 * - Reads the full body into an ArrayBuffer (decoupled from any client stream)
 * - Stores in KV via the streaming storage helper
 * - Cleans up the in-flight tracker
 *
 * Returns `true` if the job was launched, `false` if the container is
 * unavailable or validation failed (caller should fall through).
 */
export function fireAndForgetContainerTransform(options: FireAndForgetContainerOptions): boolean {
  const configManager = VideoConfigurationManager.getInstance();
  const containerConfig = configManager.getContainerConfig();

  // Validate input size
  if (options.inputSizeBytes && options.inputSizeBytes > containerConfig.maxInputSize) {
    logger.warn('Input file exceeds container max input size — skipping background job', {
      inputSizeMB: Math.round(options.inputSizeBytes / 1024 / 1024),
      maxInputSizeMB: Math.round(containerConfig.maxInputSize / 1024 / 1024),
    });
    return false;
  }

  // Validate options synchronously
  const strategy = createContainerStrategy(options.videoOptions);
  try {
    // validateOptions is async but the checks are all synchronous range checks.
    // We call it synchronously here to fail fast; the background job will
    // re-validate anyway via transformViaContainer.
    strategy.validateOptions(options.videoOptions);
  } catch {
    logger.warn('Container transform validation failed — skipping background job');
    return false;
  }

  // Check if already in flight
  if (inFlightContainerJobs.has(options.instanceKey)) {
    logger.debug('Container job already in flight — not launching duplicate', {
      instanceKey: options.instanceKey,
      startedAt: inFlightContainerJobs.get(options.instanceKey),
    });
    return true; // Job exists, caller should still return 202
  }

  // Register the job
  const startTime = Date.now();
  inFlightContainerJobs.set(options.instanceKey, startTime);

  logger.info('Launching background container transform', {
    instanceKey: options.instanceKey,
    kvPath: options.kvPath,
    inputSizeMB: options.inputSizeBytes
      ? Math.round(options.inputSizeBytes / 1024 / 1024)
      : 'unknown',
  });

  // Build the background job promise
  const jobPromise = (async () => {
    try {
      const result = await transformViaContainer(options);

      if (!result.success || !result.response) {
        logger.error('Background container transform failed', {
          error: result.error,
          durationMs: result.durationMs,
          instanceKey: options.instanceKey,
        });
        return;
      }

      logger.info('Background container transform succeeded', {
        durationMs: result.durationMs,
        instanceKey: options.instanceKey,
      });

      // Determine if we should cache in KV
      if (!result.shouldCacheInKV) {
        logger.warn('Background container output too large for KV — discarding', {
          instanceKey: options.instanceKey,
        });
        return;
      }

      // Store in KV — the response body is fully decoupled from any client
      const cacheKV = getCacheKV(options.env);
      if (!cacheKV) {
        logger.warn('KV namespace not available — cannot cache container output', {
          instanceKey: options.instanceKey,
        });
        return;
      }

      const storeResponse = new Response(result.response.body, {
        headers: result.response.headers,
      });

      const stored = await storeTransformedVideoWithStreaming(
        cacheKV,
        options.kvPath,
        storeResponse,
        {
          ...options.videoOptions,
          env: options.env as any,
          version: options.videoOptions.version || 1,
        }
      );

      if (stored) {
        logger.info('Background container output stored in KV', {
          instanceKey: options.instanceKey,
          kvPath: options.kvPath,
          durationMs: result.durationMs,
          totalElapsedMs: Date.now() - startTime,
        });
      } else {
        logger.error('Failed to store background container output in KV', {
          instanceKey: options.instanceKey,
          kvPath: options.kvPath,
        });
      }
    } catch (err) {
      logger.error('Background container job crashed', {
        error: err instanceof Error ? err.message : String(err),
        instanceKey: options.instanceKey,
      });
    } finally {
      inFlightContainerJobs.delete(options.instanceKey);
      logger.debug('Cleaned up in-flight container job', {
        instanceKey: options.instanceKey,
        elapsedMs: Date.now() - startTime,
        remainingJobs: inFlightContainerJobs.size,
      });
    }
  })();

  // Fire via waitUntil if available, otherwise let it run detached
  const execCtx = (options.env as any)?.executionCtx;
  if (execCtx && typeof execCtx.waitUntil === 'function') {
    execCtx.waitUntil(jobPromise);
  }

  return true;
}
