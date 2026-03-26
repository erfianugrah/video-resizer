import { withErrorHandling, logErrorWithContext } from '../../utils/errorHandlingUtils';
import { getCurrentContext, addBreadcrumb } from '../../utils/requestContext';
import { EnvVariables } from '../../config/environmentConfig';
import { CacheConfigurationManager } from '../../config';
import { DEFAULT_KV_READ_CACHE_TTL } from './constants';
import { TransformationMetadata, ChunkManifest } from './interfaces';
import { logDebug } from './logging';
import { generateKVKey } from './keyUtils';
import { createCommonHeaders } from './storageHelpers';
import { streamChunkedRangeResponse, streamFullChunkedResponse } from './streamingHelpers';
import { refreshCacheTtl, handleVersionIncrement } from './versionHandlers';
import {
  getNextCacheKeyVersion,
  getCacheKeyVersion,
  storeCacheKeyVersion,
} from '../cacheVersionService';
import { addRangeDiagnostics } from './logging';
import { parseRangeHeader } from '../../utils/httpUtils';

/**
 * Implementation for retrieving a transformed video from KV storage
 * with support for chunked videos and full data integrity verification
 *
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param options - Transformation options
 * @param request - Optional request object for range request support
 * @returns The stored video response or null if not found
 */
async function getTransformedVideoImpl(
  namespace: KVNamespace,
  sourcePath: string,
  options: {
    mode?: string | null;
    width?: number | null;
    height?: number | null;
    format?: string | null;
    quality?: string | null;
    compression?: string | null;
    derivative?: string | null;
    time?: string | null;
    columns?: number | null;
    rows?: number | null;
    interval?: string | null;
    version?: number; // Version from TransformationService
    env?: EnvVariables; // Environment variables for versioning
  },
  request?: Request // Add request parameter for range support
): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
  // Generate a key for this transformed variant
  const key = generateKVKey(sourcePath, options);
  const isRangeRequest = request?.headers.has('Range') || false;
  const rangeHeaderValue = request?.headers.get('Range');
  // Read KV edge cache TTL from config, falling back to the constant default (30s)
  const cacheConfig = CacheConfigurationManager.getInstance().getConfig();
  const kvReadCacheTtl = cacheConfig.kvReadCacheTtl ?? DEFAULT_KV_READ_CACHE_TTL;
  const kvReadOptions = { cacheTtl: kvReadCacheTtl };

  // Log lookup information
  logDebug('[GET_VIDEO] Attempting to retrieve video', {
    key,
    sourcePath,
    derivative: options.derivative,
    width: options.width,
    height: options.height,
    version: options.version,
    isRangeRequest,
    rangeHeaderValue,
  });

  // Fetch the base entry to determine if it's a single entry or chunked
  // Use type 'text' for initial fetch to allow parsing manifest if chunked
  const { value: baseValueText, metadata: baseMetadata } =
    await namespace.getWithMetadata<TransformationMetadata>(key, {
      type: 'text',
      ...kvReadOptions,
    });

  // Handle cache miss
  if (!baseMetadata) {
    logDebug('[GET_VIDEO] Base key not found', { key });

    // Increment version on cache miss if env is provided
    if (options.env?.VIDEO_CACHE_KEY_VERSIONS) {
      try {
        // Force increment on cache miss - this is intentional cache invalidation
        const nextVersion = await getNextCacheKeyVersion(options.env, key, true);

        // Store updated version in background if possible
        await handleVersionIncrement(options.env, key, nextVersion);

        logDebug('[GET_VIDEO] Incremented version on cache miss', {
          key,
          previousVersion: nextVersion - 1,
          nextVersion,
        });
      } catch (err) {
        // Log error but continue - version incrementation is not critical
        logDebug('[GET_VIDEO] Error incrementing version on cache miss', {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return null;
  }

  logDebug('[GET_VIDEO] Retrieved base metadata', {
    key,
    metadata: baseMetadata,
    contentType: baseMetadata.contentType,
    isChunked: baseMetadata.isChunked,
  });

  // Create common headers for response
  const responseHeaders = createCommonHeaders(baseMetadata, key);

  // Get version from metadata or options
  const cacheVersion = baseMetadata.cacheVersion || options.version || 1;

  // Add version information to headers
  if (cacheVersion) {
    responseHeaders.set('X-Cache-Version', cacheVersion.toString());
  }

  // Add chunking information for diagnostics
  if (baseMetadata.isChunked) {
    responseHeaders.set('X-Video-Storage', 'chunked');
  } else {
    responseHeaders.set('X-Video-Storage', 'single');
  }

  //
  // Handle chunked video retrieval
  //
  if (baseMetadata.isChunked === true) {
    logDebug('[GET_VIDEO] Video is stored as chunks', { key });

    // Parse the manifest
    if (!baseValueText) {
      logErrorWithContext(
        '[GET_VIDEO] Manifest value missing for chunked video',
        new Error('Missing manifest value'),
        { key },
        'KVStorageService.get'
      );
      return null;
    }

    let manifest: ChunkManifest;
    try {
      manifest = JSON.parse(baseValueText);
    } catch (e) {
      logErrorWithContext(
        '[GET_VIDEO] Failed to parse manifest JSON',
        e,
        { key, manifestText: baseValueText },
        'KVStorageService.get'
      );
      return null;
    }

    // Validate manifest content
    if (
      !manifest ||
      typeof manifest.totalSize !== 'number' ||
      !Array.isArray(manifest.actualChunkSizes) ||
      manifest.chunkCount !== manifest.actualChunkSizes.length
    ) {
      logErrorWithContext(
        '[GET_VIDEO] Invalid manifest structure',
        new Error('Invalid manifest structure'),
        { key, manifest },
        'KVStorageService.get'
      );
      return null;
    }

    logDebug('[GET_VIDEO] Parsed manifest for chunked video', {
      key,
      totalSize: manifest.totalSize,
      chunkCount: manifest.chunkCount,
      contentType: manifest.originalContentType,
    });

    // Set content type from manifest
    responseHeaders.set('Content-Type', manifest.originalContentType);

    // Handle range request for chunked video
    if (isRangeRequest) {
      try {
        const rangeValue = rangeHeaderValue || '';
        const clientRange = parseRangeHeader(rangeValue, manifest.totalSize);

        if (!clientRange) {
          logDebug('[GET_VIDEO] Potentially unsatisfiable range request for chunked video', {
            key,
            range: rangeHeaderValue,
            totalSize: manifest.totalSize,
          });

          // RECOVERY LOGIC: Instead of returning 416, return the full chunked video
          // This handles cases where KV may have partial content but we should return the full content
          logDebug(
            '[GET_VIDEO] Recovering from unsatisfiable range by returning full chunked response',
            {
              key,
              range: rangeHeaderValue,
              totalSize: manifest.totalSize,
            }
          );

          addRangeDiagnostics(
            key,
            rangeValue,
            'recovered-full-chunked-response',
            manifest.totalSize,
            'chunked-kv'
          );

          // Create enhanced headers for full response
          const fullHeaders = new Headers(responseHeaders);
          fullHeaders.set('Content-Length', manifest.totalSize.toString());
          fullHeaders.set('X-Range-Recovery', 'true');

          // Return the full chunked video instead of just the range
          // We'll use the same approach as the normal full content flow below
          return await getFullChunkedResponse(
            namespace,
            key,
            manifest,
            responseHeaders,
            baseMetadata,
            kvReadOptions
          );
        }

        const rangeLength = clientRange.end - clientRange.start + 1;

        // Set common 206 headers
        responseHeaders.set(
          'Content-Range',
          `bytes ${clientRange.start}-${clientRange.end}/${manifest.totalSize}`
        );
        responseHeaders.set('Content-Length', rangeLength.toString());

        logDebug('[GET_VIDEO] Processing range request for chunked video', {
          key,
          range: clientRange,
          totalSize: manifest.totalSize,
          rangeLength,
          isFullRange: clientRange.start === 0 && clientRange.end >= manifest.totalSize - 1,
        });

        // Use a pull-based ReadableStream that fetches only the needed
        // chunk data on-demand. Unlike the old TransformStream + waitUntil
        // approach, this keeps the stream alive for the full duration.
        // Unlike a full-buffer approach, it doesn't OOM for large ranges.

        // Pre-calculate which chunks overlap with the range
        const chunksToFetch: Array<{
          index: number;
          sliceStart: number;
          sliceEnd: number;
        }> = [];
        let scanPos = 0;
        for (let i = 0; i < manifest.chunkCount; i++) {
          const chunkSize = manifest.actualChunkSizes[i];
          const chunkStart = scanPos;
          const chunkEnd = scanPos + chunkSize - 1;
          scanPos += chunkSize;

          if (clientRange.start > chunkEnd || clientRange.end < chunkStart) continue;

          chunksToFetch.push({
            index: i,
            sliceStart: Math.max(0, clientRange.start - chunkStart),
            sliceEnd: Math.min(chunkSize, clientRange.end - chunkStart + 1),
          });
        }

        let fetchIdx = 0;
        const rangeStream = new ReadableStream({
          async pull(controller) {
            if (fetchIdx >= chunksToFetch.length) {
              controller.close();
              return;
            }

            const info = chunksToFetch[fetchIdx];
            const chunkKey = `${key}_chunk_${info.index}`;

            try {
              const chunkData = await namespace.get(chunkKey, {
                type: 'arrayBuffer',
                ...kvReadOptions,
              });

              if (!chunkData) {
                controller.error(new Error(`Missing chunk: ${chunkKey}`));
                return;
              }

              const slice = new Uint8Array(chunkData).subarray(info.sliceStart, info.sliceEnd);
              controller.enqueue(slice);
              fetchIdx++;
            } catch (err) {
              controller.error(err);
            }
          },
          cancel() {
            // Browser aborted the request (e.g., seeking) — clean exit
            logDebug('[GET_VIDEO] Range stream cancelled by client', {
              key,
              fetchedChunks: fetchIdx,
              totalChunks: chunksToFetch.length,
            });
          },
        });

        addRangeDiagnostics(
          key,
          rangeValue,
          'success',
          manifest.totalSize,
          'chunked-kv',
          clientRange.start,
          clientRange.end
        );

        refreshCacheTtl(namespace, key, baseMetadata, options.env);

        // Pipe through FixedLengthStream so Cloudflare preserves the
        // Content-Length header. A plain ReadableStream causes Workers
        // to use chunked transfer encoding and strip Content-Length,
        // which breaks video seeking in browsers.
        const fixedStream = new FixedLengthStream(rangeLength);
        rangeStream.pipeTo(fixedStream.writable).catch(() => {});

        return {
          response: new Response(fixedStream.readable, {
            status: 206,
            statusText: 'Partial Content',
            headers: responseHeaders,
          }),
          metadata: baseMetadata,
        };
      } catch (err) {
        logErrorWithContext(
          '[GET_VIDEO] Error processing range request for chunked video',
          err,
          { key, range: rangeHeaderValue },
          'KVStorageService.get'
        );

        // Fall back to full content if range request fails
        logDebug('[GET_VIDEO] Falling back to full content response after range error', { key });
      }
    }

    // Full content response for chunked video.
    // Use a ReadableStream that pulls chunks from KV on-demand (not via
    // waitUntil background task). This keeps the stream alive for the
    // entire duration of the response — the previous TransformStream +
    // waitUntil approach caused the connection to drop after a few chunks
    // because the Worker "completed" and the background task got killed.
    responseHeaders.set('Content-Length', manifest.totalSize.toString());

    logDebug('[GET_VIDEO] Processing full content request for chunked video', {
      key,
      totalSize: manifest.totalSize,
      chunkCount: manifest.chunkCount,
    });

    let chunkIndex = 0;
    const readableStream = new ReadableStream({
      async pull(controller) {
        if (chunkIndex >= manifest.chunkCount) {
          controller.close();
          return;
        }

        const chunkKey = `${key}_chunk_${chunkIndex}`;
        try {
          const chunkData = await namespace.get(chunkKey, {
            type: 'arrayBuffer',
            ...kvReadOptions,
          });

          if (!chunkData) {
            logErrorWithContext(
              '[GET_VIDEO] Missing chunk during full content streaming',
              new Error('Chunk not found'),
              { chunkKey, chunkIndex },
              'KVStorageService.get'
            );
            controller.error(new Error(`Missing chunk: ${chunkKey}`));
            return;
          }

          controller.enqueue(new Uint8Array(chunkData));
          chunkIndex++;
        } catch (err) {
          logErrorWithContext(
            '[GET_VIDEO] Error fetching chunk during full content streaming',
            err,
            { chunkKey, chunkIndex },
            'KVStorageService.get'
          );
          controller.error(err);
        }
      },
    });

    // Refresh TTL on cache hit
    refreshCacheTtl(namespace, key, baseMetadata, options.env);

    logDebug('[GET_VIDEO] Returning 200 OK for full chunked video', { key });

    // Pipe through FixedLengthStream so Cloudflare preserves Content-Length.
    const fixedStream = new FixedLengthStream(manifest.totalSize);
    readableStream.pipeTo(fixedStream.writable).catch(() => {});

    return {
      response: new Response(fixedStream.readable, {
        status: 200,
        headers: responseHeaders,
      }),
      metadata: baseMetadata,
    };
  }
  //
  // Handle single entry video retrieval
  //
  else if (
    baseMetadata.isChunked === false &&
    typeof baseMetadata.actualTotalVideoSize === 'number'
  ) {
    logDebug('[GET_VIDEO] Video is stored as single entry', {
      key,
      expectedSize: baseMetadata.actualTotalVideoSize,
    });

    // baseValueText from text fetch not needed, get binary data instead
    const videoArrayBuffer = await namespace.get(key, { type: 'arrayBuffer', ...kvReadOptions });

    if (!videoArrayBuffer) {
      logErrorWithContext(
        '[GET_VIDEO] Video data missing for single entry',
        new Error('Missing data'),
        { key },
        'KVStorageService.get'
      );
      return null;
    }

    // Verify retrieved size against metadata for data integrity
    logDebug('[GET_VIDEO] Retrieved single entry video', {
      key,
      expectedSize: baseMetadata.actualTotalVideoSize,
      actualSize: videoArrayBuffer.byteLength,
    });

    if (videoArrayBuffer.byteLength !== baseMetadata.actualTotalVideoSize) {
      const errorMsg = `CRITICAL SIZE MISMATCH for key ${key}. Expected: ${baseMetadata.actualTotalVideoSize}, Actual: ${videoArrayBuffer.byteLength}`;
      logErrorWithContext(
        '[GET_VIDEO] ' + errorMsg,
        new Error('Size mismatch'),
        { key },
        'KVStorageService.get'
      );

      // Decision: Return null for strict integrity validation
      return null;
    }

    // Set content type from metadata
    responseHeaders.set('Content-Type', baseMetadata.contentType);

    // Handle range request for single entry
    if (isRangeRequest) {
      try {
        const rangeValue = rangeHeaderValue || '';
        const clientRange = parseRangeHeader(rangeValue, videoArrayBuffer.byteLength);

        if (!clientRange) {
          logDebug('[GET_VIDEO] Potentially unsatisfiable range request for single entry', {
            key,
            range: rangeHeaderValue,
            size: videoArrayBuffer.byteLength,
          });

          // RECOVERY LOGIC: Instead of returning 416, return the full video
          // This handles cases where KV may have partial content but we should return the full content
          logDebug('[GET_VIDEO] Recovering from unsatisfiable range by returning full response', {
            key,
            range: rangeHeaderValue,
            fullSize: videoArrayBuffer.byteLength,
          });

          addRangeDiagnostics(
            key,
            rangeValue,
            'recovered-full-response',
            videoArrayBuffer.byteLength,
            'single-kv'
          );

          // Create enhanced headers for full response
          const fullHeaders = new Headers(responseHeaders);
          fullHeaders.set('Content-Length', videoArrayBuffer.byteLength.toString());
          fullHeaders.set('X-Range-Recovery', 'true');

          return {
            response: new Response(videoArrayBuffer, {
              status: 200,
              headers: fullHeaders,
            }),
            metadata: baseMetadata,
          };
        }

        logDebug('[GET_VIDEO] Processing range request for single entry', {
          key,
          range: clientRange,
        });

        // Create partial response from the array buffer
        const partialData = videoArrayBuffer.slice(clientRange.start, clientRange.end + 1);

        // Set range response headers
        responseHeaders.set(
          'Content-Range',
          `bytes ${clientRange.start}-${clientRange.end}/${videoArrayBuffer.byteLength}`
        );
        responseHeaders.set('Content-Length', partialData.byteLength.toString());

        // Add diagnostics
        addRangeDiagnostics(
          key,
          rangeValue,
          'success',
          videoArrayBuffer.byteLength,
          'single-kv',
          clientRange.start,
          clientRange.end
        );

        // Refresh TTL on cache hit
        refreshCacheTtl(namespace, key, baseMetadata, options.env);

        logDebug('[GET_VIDEO] Returning 206 Partial Content for single entry', { key });

        return {
          response: new Response(partialData, {
            status: 206,
            statusText: 'Partial Content',
            headers: responseHeaders,
          }),
          metadata: baseMetadata,
        };
      } catch (err) {
        logErrorWithContext(
          '[GET_VIDEO] Error processing range request for single entry',
          err,
          { key, range: rangeHeaderValue },
          'KVStorageService.get'
        );

        // Fall back to full content
        logDebug('[GET_VIDEO] Falling back to full content response after range error', { key });
      }
    }

    // Full content response for single entry
    responseHeaders.set('Content-Length', videoArrayBuffer.byteLength.toString());

    // Refresh TTL on cache hit
    refreshCacheTtl(namespace, key, baseMetadata, options.env);

    logDebug('[GET_VIDEO] Returning 200 OK for full single entry', { key });

    return {
      response: new Response(videoArrayBuffer, {
        status: 200,
        headers: responseHeaders,
      }),
      metadata: baseMetadata,
    };
  }
  //
  // Handle metadata inconsistency
  //
  else {
    logErrorWithContext(
      '[GET_VIDEO] Inconsistent metadata state',
      new Error('Invalid metadata state'),
      {
        key,
        isChunked: baseMetadata.isChunked,
        actualTotalVideoSize: baseMetadata.actualTotalVideoSize,
      },
      'KVStorageService.get'
    );
    return null;
  }
}

/**
 * Retrieve a transformed video from KV storage
 * Uses standardized error handling for robust error handling and logging
 *
 * @param namespace - The KV namespace to use
 * @param sourcePath - Original video path
 * @param options - Transformation options
 * @param request - Optional request object for range request support
 * @returns The stored video response or null if not found
 */
/**
 * Helper function to get a full chunked response
 * Used when recovering from unsatisfiable range requests
 */
async function getFullChunkedResponse(
  namespace: KVNamespace,
  key: string,
  manifest: ChunkManifest,
  responseHeaders: Headers,
  baseMetadata: TransformationMetadata,
  kvReadOptions: { cacheTtl?: number } = {}
): Promise<{ response: Response; metadata: TransformationMetadata }> {
  // Full content response for chunked video
  responseHeaders.set('Content-Length', manifest.totalSize.toString());

  logDebug('[GET_VIDEO] Processing full content request for chunked video recovery', {
    key,
    totalSize: manifest.totalSize,
    chunkCount: manifest.chunkCount,
  });

  // Create streaming response with transform stream
  const { readable, writable } = new TransformStream();

  // Process all chunks
  const streamChunksPromise = streamFullChunkedResponse(
    namespace,
    key,
    manifest,
    writable.getWriter(),
    kvReadOptions
  );

  // Process in background
  const context = getCurrentContext();
  if (context?.executionContext?.waitUntil) {
    // Create an AbortController to be able to cancel the chunk streaming if needed
    const abortController = new AbortController();
    const abortSignal = abortController.signal;

    // Store the AbortController in the request context for potential cancellation
    if (!context.activeStreams) {
      context.activeStreams = new Map();
    }
    context.activeStreams.set(`${key}_recovery`, abortController);

    // Add cleanup function to remove from activeStreams when done
    const cleanup = () => {
      if (context.activeStreams?.has(`${key}_recovery`)) {
        context.activeStreams.delete(`${key}_recovery`);
        logDebug('[GET_VIDEO] Removed recovery stream from active streams map', { key });
      }
    };

    // Pass the signal to the streaming operation
    context.executionContext.waitUntil(
      streamChunksPromise.then(cleanup).catch((err) => {
        cleanup();
        logErrorWithContext(
          '[GET_VIDEO] Error in background full content chunk processing during recovery',
          err,
          {
            key,
            wasAborted: abortSignal.aborted,
          },
          'KVStorageService.get'
        );
      })
    );
  }

  logDebug('[GET_VIDEO] Returning 200 OK for full chunked video (recovery mode)', { key });

  return {
    response: new Response(readable, {
      status: 200,
      headers: responseHeaders,
    }),
    metadata: baseMetadata,
  };
}

export const getTransformedVideo = withErrorHandling<
  [
    KVNamespace,
    string,
    {
      mode?: string | null;
      width?: number | null;
      height?: number | null;
      format?: string | null;
      quality?: string | null;
      compression?: string | null;
      derivative?: string | null;
      time?: string | null;
      columns?: number | null;
      rows?: number | null;
      interval?: string | null;
      version?: number; // Version from TransformationService
      env?: EnvVariables; // Environment variables for versioning
    },
    Request | undefined, // Add optional request parameter
  ],
  Promise<{ response: Response; metadata: TransformationMetadata } | null>
>(
  async function getTransformedVideoWrapper(
    namespace,
    sourcePath,
    options,
    request // Add request parameter
  ): Promise<{ response: Response; metadata: TransformationMetadata } | null> {
    try {
      // Pass request to the implementation
      return await getTransformedVideoImpl(namespace, sourcePath, options, request);
    } catch (err) {
      // Add breadcrumb for KV retrieval error
      const requestContext = getCurrentContext();
      if (requestContext) {
        addBreadcrumb(requestContext, 'Error', 'Failed to retrieve from KV', {
          sourcePath,
          error: err instanceof Error ? err.message : 'Unknown error',
          severity: 'medium',
        });
      }

      // Version increment on error is disabled to prevent unnecessary version inflation
      // The version will only be incremented manually when you delete cache entries

      // Log via standardized error handling but return null to allow fallback to origin
      logErrorWithContext(
        'Failed to retrieve transformed video from KV',
        err,
        {
          sourcePath,
          options,
          hasRangeRequest: request?.headers.has('Range'),
          key: generateKVKey(sourcePath, options),
          version: options.version,
        },
        'KVStorageService'
      );

      return null;
    }
  },
  {
    functionName: 'getTransformedVideo',
    component: 'KVStorageService',
    logErrors: true,
  },
  { operationType: 'read' }
);
