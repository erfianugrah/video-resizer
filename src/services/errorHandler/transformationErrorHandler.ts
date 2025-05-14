/**
 * Specialized handling for transformation errors
 */
import { VideoTransformContext } from '../../domain/commands/TransformVideoCommand';
import { RequestContext, addBreadcrumb } from '../../utils/requestContext';
import { createLogger } from '../../utils/pinoLogger';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { parseErrorMessage, isDurationLimitError, adjustDuration, storeTransformationLimit } from '../../utils/transformationUtils';
import { fetchVideo } from '../videoStorageService';
import { cacheResponse } from '../cacheManagementService';
import { prepareVideoTransformation } from '../TransformationService';
// Import will be done dynamically within the function to allow for mocking in tests
import type { DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { logDebug } from './logging';
import { EnvVariables } from '../../config/environmentConfig';
import type { VideoResizerConfig } from '../videoStorage/interfaces';

/**
 * Helper function to initiate background caching of fallback responses
 * This centralizes the background caching logic to avoid code duplication
 * 
 * @param env Cloudflare environment with executionCtx and KV namespace (can be undefined)
 * @param path Path of the video being cached
 * @param fallbackResponse Response to cache in KV
 * @param requestContext Request context for diagnostics and logging
 * @param tagInfo Additional information tags for logs (pattern name, content info)
 */
async function initiateBackgroundCaching(
  env: Partial<EnvVariables> | undefined,
  path: string,
  fallbackResponse: Response,
  requestContext: RequestContext,
  tagInfo?: {
    pattern?: string,
    isLargeVideo?: boolean
  }
): Promise<void> {
  // Only proceed if we have the necessary environment and response
  if (!env || !env.executionCtx?.waitUntil || !env.VIDEO_TRANSFORMATIONS_CACHE || !fallbackResponse.body || !fallbackResponse.ok) {
    return;
  }

  try {
    // Log context based on whether this is a large video or pattern fallback
    const contextType = tagInfo?.isLargeVideo 
      ? 'large video'
      : tagInfo?.pattern 
        ? `pattern fallback (${tagInfo.pattern})`
        : 'fallback video';
    
    // Get content length to check file size
    const contentLengthHeader = fallbackResponse.headers.get('Content-Length');
    const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
    
    // For extremely large files, we'll still process them using the streams API
    if (contentLength > 100 * 1024 * 1024) { // 100MB threshold
      logDebug('handleTransformationError', `Processing large ${contextType} (${Math.round(contentLength/1024/1024)}MB) with streams API`, {
        path,
        pattern: tagInfo?.pattern,
        contentLength,
        status: fallbackResponse.status,
        isLargeVideo: tagInfo?.isLargeVideo
      });
      
      addBreadcrumb(requestContext, 'KVCache', `Using streaming for large ${contextType}`, {
        path,
        pattern: tagInfo?.pattern,
        contentLength,
        isLargeVideo: tagInfo?.isLargeVideo,
        sizeMB: Math.round(contentLength/1024/1024)
      });
    }
    
    // Import the background chunking storage function
    const { streamFallbackToKV } = await import('../../services/videoStorage/fallbackStorage');
    
    // Get a fresh clone for KV storage - this is separate from the response we send to the client
    const fallbackClone = fallbackResponse.clone();
    
    // Log the KV storage attempt
    logDebug('handleTransformationError', `Initiating background KV storage for ${contextType}`, {
      path,
      pattern: tagInfo?.pattern,
      contentType: fallbackResponse.headers.get('Content-Type'),
      contentLength,
      status: fallbackResponse.status,
      isLargeVideo: tagInfo?.isLargeVideo
    });
    
    // Add breadcrumb for tracking
    addBreadcrumb(requestContext, 'KVCache', `Starting background storage for ${contextType}`, {
      path,
      pattern: tagInfo?.pattern,
      contentLength,
      isLargeVideo: tagInfo?.isLargeVideo
    });
    
    // Import VideoConfigurationManager to get configuration
    const { VideoConfigurationManager } = await import('../../config');
    const videoConfigManager = VideoConfigurationManager.getInstance();
    const videoConfig = videoConfigManager.getConfig();
    
    // Use waitUntil to store in the background
    env.executionCtx.waitUntil(
      streamFallbackToKV(env, path, fallbackClone, videoConfig)
        .catch(storeError => {
          // Log any errors that occur during background storage
          logErrorWithContext(`Error during background KV storage for ${contextType}`, storeError, {
            path,
            pattern: tagInfo?.pattern,
            requestId: requestContext.requestId,
            isLargeVideo: tagInfo?.isLargeVideo
          }, 'handleTransformationError');
        })
    );
  } catch (importError) {
    // Log error but don't let it affect the user response
    logErrorWithContext(`Failed to initialize background KV storage for ${tagInfo?.isLargeVideo ? 'large video' : 'fallback'}`, importError, {
      requestId: requestContext.requestId,
      pattern: tagInfo?.pattern
    }, 'handleTransformationError');
  }
}

/**
 * Handles transformation errors, including fallback logic and retries
 * 
 * @param params Error handling parameters
 * @returns Response with appropriate error handling or fallback content
 */
export async function handleTransformationError({
  errorResponse,
  originalRequest,
  context,
  requestContext,
  diagnosticsInfo,
  fallbackOriginUrl,
  cdnCgiUrl,
  source
}: {
  errorResponse: Response;
  originalRequest: Request;
  context: VideoTransformContext;
  requestContext: RequestContext;
  diagnosticsInfo: DiagnosticsInfo;
  fallbackOriginUrl: string | null;
  cdnCgiUrl: string;
  source?: string;
}): Promise<Response> {
  // Get logger from context or create one if needed
  const logger = context.logger || createLogger(requestContext);

  const errorText = await errorResponse.text();
  const parsedError = parseErrorMessage(errorText);
  const status = errorResponse.status;
  const isServerError = status >= 500 && status < 600;
  const isFileSizeError = parsedError.errorType === 'file_size_limit' || errorText.includes('file size limit');

  // Log the initial error
  logErrorWithContext(`Transformation proxy returned ${status}`, { message: errorText }, { requestId: requestContext.requestId, url: cdnCgiUrl }, 'handleTransformationError');
  addBreadcrumb(requestContext, 'Error', 'Transformation Proxy Error', { status, errorText: errorText.substring(0, 100), parsedError });

  // --- Duration Limit Retry Logic ---
  if (isDurationLimitError(errorText) && context.options?.duration) {
    const originalDuration = context.options.duration;
    // Extract the exact upper limit from the error message if possible
    const limitMatch = errorText.match(/between \d+\w+ and ([\d.]+)(\w+)/);
    let adjustedDuration: string | null = null;
    
    if (limitMatch && limitMatch.length >= 3) {
      // Use exactly what the error tells us is the maximum
      const maxValue = parseFloat(limitMatch[1]);
      const unit = limitMatch[2];
      // Use the exact value from the error message
      const exactValue = Math.floor(maxValue); // Just convert to integer for clean values
      if (exactValue > 0) {
        adjustedDuration = `${exactValue}${unit}`;
        // Store this limit for future use
        storeTransformationLimit('duration', 'max', exactValue);
        
        logDebug('handleTransformationError', 'Extracted exact duration limit', { 
          maxValue, 
          unit, 
          exactValue, 
          adjustedDuration,
          originalDuration,
          errorMessage: errorText.substring(0, 100)
        });
      }
    }
    
    // If we couldn't extract the limit from the error, fall back to the standard adjustment
    if (!adjustedDuration) {
      adjustedDuration = adjustDuration(originalDuration);
      logDebug('handleTransformationError', 'Using standard duration adjustment', { 
        originalDuration, 
        adjustedDuration 
      });
    }

    if (adjustedDuration && adjustedDuration !== originalDuration) {
      logDebug('handleTransformationError', 'Attempting retry with adjusted duration', { originalDuration, adjustedDuration });
      addBreadcrumb(requestContext, 'Retry', 'Adjusting duration', { originalDuration, adjustedDuration });

      const adjustedOptions = { ...context.options, duration: adjustedDuration };
      try {
        const transformResult = await prepareVideoTransformation(
          context.request, adjustedOptions, context.pathPatterns, context.debugInfo, context.env
        );
        const adjustedCdnCgiUrl = transformResult.cdnCgiUrl;

        const retryResponse = await cacheResponse(originalRequest, async () => fetch(adjustedCdnCgiUrl));

        if (retryResponse.ok) {
          logDebug('handleTransformationError', 'Retry successful', { adjustedDuration });
          addBreadcrumb(requestContext, 'Retry', 'Duration adjustment successful', { status: retryResponse.status });
          
          // Add adjustment headers and return
          const headers = new Headers(retryResponse.headers);
          headers.set('X-Duration-Adjusted', 'true');
          headers.set('X-Original-Duration', originalDuration);
          headers.set('X-Adjusted-Duration', adjustedDuration);
          headers.set('X-Duration-Limit-Applied', 'true');
          
          return new Response(retryResponse.body, { 
            status: retryResponse.status, 
            statusText: retryResponse.statusText, 
            headers 
          });
        } else {
          logErrorWithContext('Retry with adjusted duration failed', new Error(`Status: ${retryResponse.status}`), { requestId: requestContext.requestId, url: adjustedCdnCgiUrl }, 'handleTransformationError');
          addBreadcrumb(requestContext, 'Retry', 'Duration adjustment failed', { status: retryResponse.status });
        }
      } catch (retryError) {
        logErrorWithContext('Error during duration retry logic', retryError, { requestId: requestContext.requestId }, 'handleTransformationError');
        addBreadcrumb(requestContext, 'Error', 'Duration retry preparation failed', { error: retryError instanceof Error ? retryError.message : String(retryError) });
      }
    }
  }

  // --- Find matched path pattern with its origin and auth for pattern-specific fallback ---
  const url = new URL(originalRequest.url);
  const path = url.pathname;
  let matchedPattern = null;
  
  // Find matching path pattern for potential pattern-specific auth
  try {
    // Import pathUtils to find the matching pattern
    const { findMatchingPathPattern } = await import('../../utils/pathUtils');
    matchedPattern = findMatchingPathPattern(path, context.pathPatterns);
    
    logDebug('handleTransformationError', 'Found matching pattern for fallback', { 
      hasPattern: !!matchedPattern,
      patternName: matchedPattern?.name,
      hasOriginUrl: !!matchedPattern?.originUrl,
      hasAuth: !!matchedPattern?.auth?.enabled
    });
  } catch (patternError) {
    logErrorWithContext('Error finding matching pattern for fallback', patternError, { path }, 'handleTransformationError');
  }

  // --- Fallback Logic (Pattern-specific, Direct Fetch, or Storage Service) ---
  let fallbackResponse: Response | undefined;
  let patternFetchAttempted = false;
  
  // First priority: Try pattern-specific origin and auth if available
  if (matchedPattern && matchedPattern.originUrl && matchedPattern.auth?.enabled) {
    patternFetchAttempted = true;
    addBreadcrumb(requestContext, 'Fallback', 'Attempting fetch using matched pattern origin/auth', { 
      pattern: matchedPattern.name, 
      origin: matchedPattern.originUrl, 
      authType: matchedPattern.auth.type 
    });
    
    logDebug('handleTransformationError', 'Attempting pattern-specific fallback', { 
      pattern: matchedPattern.name,
      originUrl: matchedPattern.originUrl,
      authType: matchedPattern.auth.type
    });

    try {
      const originToFetch = matchedPattern.originUrl; // Base origin
      const pathSegment = url.pathname; // Original request path
      
      // Refine URL construction with careful path segment handling
      let s3ObjectPath = pathSegment.startsWith('/') ? pathSegment.substring(1) : pathSegment;
      
      if (originToFetch.endsWith('/')) {
        // Already has trailing slash, just append path without leading slash
        s3ObjectPath = s3ObjectPath; // no change needed
      } else if (!s3ObjectPath.startsWith('/')) {
        // Needs slash between base and path
        s3ObjectPath = '/' + s3ObjectPath;
      } else {
        // Base doesn't end with /, path starts with /, remove path's leading slash
        s3ObjectPath = pathSegment.substring(1);
      }
      
      // Construct the full URL
      let finalUrlToFetch = originToFetch + s3ObjectPath;
      
      // Handle different auth types
      if (matchedPattern.auth.type === 'aws-s3-presigned-url') {
        try {
          const { getOrGeneratePresignedUrl, encodePresignedUrl } = await import('../../utils/presignedUrlUtils');
          
          // Use pattern name for auth configuration to ensure proper variable naming
          // The problem was we were using remoteAuth which caused the utils to look for REMOTE_ prefixed variables
          // Instead we need to construct a storage config that will look for pattern-specific variables
          // We need to create a custom configuration object with the correct property names
          
          // TypeScript-friendly approach with a Record type
          const storageConfigForUtil: Record<string, any> = {
            remoteUrl: originToFetch
          };
          
          // Create a property key using the pattern's name (e.g., standardAuth instead of remoteAuth)
          // This ensures pattern-specific credentials are used
          const authKey = `${matchedPattern.name}Auth`;
          storageConfigForUtil[authKey] = matchedPattern.auth;
          
          // Log the storage config to help with debugging
          logDebug('handleTransformationError', 'Created pattern-specific storage config for presigned URL', {
            pattern: matchedPattern.name,
            authKey: authKey,
            authType: matchedPattern.auth.type,
            accessKeyVar: matchedPattern.auth.accessKeyVar || `${matchedPattern.name.toUpperCase()}_AWS_ACCESS_KEY_ID`,
            secretKeyVar: matchedPattern.auth.secretKeyVar || `${matchedPattern.name.toUpperCase()}_AWS_SECRET_ACCESS_KEY`
          });
          
          // Generate presigned URL with the pattern's specific auth configuration
          addBreadcrumb(requestContext, 'Fallback', 'Generating presigned URL for pattern fallback', { 
            pattern: matchedPattern.name,
            authKey: authKey
          });
          
          // Ensure we have the correct environment
          const env = context.env || {};
          
          // Get the presigned URL - pass null as patternContext since we'll use the config
          const presignedUrl = await getOrGeneratePresignedUrl(env, finalUrlToFetch, storageConfigForUtil, null);
          
          if (presignedUrl && presignedUrl !== finalUrlToFetch) {
            finalUrlToFetch = presignedUrl; // Use the presigned URL
            addBreadcrumb(requestContext, 'Fallback', 'Using presigned URL for pattern fallback fetch', { 
              pattern: matchedPattern.name 
            });
            
            logDebug('handleTransformationError', 'Generated presigned URL for pattern fallback', {
              pattern: matchedPattern.name,
              urlLength: presignedUrl.length
            });
            
            // Perform the fetch with the presigned URL
            try {
              // Create a new request with the presigned URL
              const presignedRequest = new Request(presignedUrl, {
                method: originalRequest.method,
                headers: originalRequest.headers,
                redirect: 'follow'
              });
              
              // Log the request details
              logDebug('handleTransformationError', 'Fetching with presigned URL', {
                pattern: matchedPattern.name,
                method: originalRequest.method,
                urlLength: presignedUrl.length
              });
              
              // Fetch the content directly using the presigned URL
              fallbackResponse = await fetch(presignedRequest);
              
              // If successful, return immediately - no need to try other options
              if (fallbackResponse && fallbackResponse.ok) {
                logDebug('handleTransformationError', 'Presigned URL fetch successful', {
                  pattern: matchedPattern.name,
                  status: fallbackResponse.status,
                  contentType: fallbackResponse.headers.get('Content-Type')
                });
              }
            } catch (presignedFetchError) {
              logErrorWithContext('Error fetching with presigned URL', presignedFetchError, {
                pattern: matchedPattern.name
              }, 'handleTransformationError');
              
              // Don't throw, continue to other fallback mechanisms
              logDebug('handleTransformationError', 'Presigned URL fetch failed, trying other fallbacks', {
                error: presignedFetchError instanceof Error ? presignedFetchError.message : String(presignedFetchError)
              });
            }
          } else if (!presignedUrl) {
            throw new Error('Failed to generate presigned URL for pattern fallback');
          }
        } catch (presignError) {
          logErrorWithContext('Error generating presigned URL for pattern fallback', presignError, { 
            pattern: matchedPattern.name,
            origin: matchedPattern.originUrl
          }, 'handleTransformationError');
          
          // Continue using the direct URL as fallback
          logDebug('handleTransformationError', 'Continuing with direct pattern URL after presigning failure', {
            pattern: matchedPattern.name,
            url: finalUrlToFetch
          });
        }
      } else if (matchedPattern.auth.type === 'aws-s3') {
        try {
          // For aws-s3 auth, sign the request headers
          addBreadcrumb(requestContext, 'Fallback', 'Using AWS S3 direct auth for pattern fallback', {
            pattern: matchedPattern.name
          });
          
          // Ensure we have the env
          const env = context.env || {};
          const envRecord = env as unknown as Record<string, string | undefined>;
          
          // Get credentials from env using the pattern's specific auth config
          const accessKeyVar = matchedPattern.auth.accessKeyVar || 'AWS_ACCESS_KEY_ID';
          const secretKeyVar = matchedPattern.auth.secretKeyVar || 'AWS_SECRET_ACCESS_KEY';
          const sessionTokenVar = matchedPattern.auth.sessionTokenVar;
          
          const accessKey = envRecord[accessKeyVar] as string;
          const secretKey = envRecord[secretKeyVar] as string;
          const sessionToken = sessionTokenVar ? envRecord[sessionTokenVar] as string : undefined;
          
          if (accessKey && secretKey) {
            // Import AWS client
            const { AwsClient } = await import('aws4fetch');
            
            // Setup AWS client with pattern-specific auth config
            const aws = new AwsClient({
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              sessionToken,
              service: matchedPattern.auth.service || 's3',
              region: matchedPattern.auth.region || 'us-east-1'
            });
            
            // Create and sign the request
            const signRequest = new Request(finalUrlToFetch, {
              method: originalRequest.method,
              headers: originalRequest.headers
            });
            
            const signedRequest = await aws.sign(signRequest);
            
            // Extract headers for logging
            const authHeader = signedRequest.headers.get('Authorization');
            const hasAuthHeader = !!authHeader;
            
            logDebug('handleTransformationError', 'Signed request for pattern fallback', {
              pattern: matchedPattern.name,
              hasAuthHeader,
              authHeaderPrefix: authHeader ? authHeader.substring(0, 15) + '...' : 'none'
            });
            
            // Perform the fetch with signed request
            fallbackResponse = await fetch(signedRequest);
          } else {
            // Missing credentials, attempt direct fetch without auth
            logDebug('handleTransformationError', 'Missing AWS credentials for pattern fallback, trying direct fetch', {
              pattern: matchedPattern.name,
              url: finalUrlToFetch
            });
            
            // Use original request's method and headers for direct fetch
            const directRequest = new Request(finalUrlToFetch, {
              method: originalRequest.method,
              headers: originalRequest.headers,
              redirect: 'follow' // Important for potential redirects at origin
            });
            
            fallbackResponse = await fetch(directRequest);
          }
        } catch (awsError) {
          logErrorWithContext('Error using AWS S3 auth for pattern fallback', awsError, {
            pattern: matchedPattern.name,
            origin: matchedPattern.originUrl
          }, 'handleTransformationError');
          
          // Try a direct fetch as fallback
          try {
            const directRequest = new Request(finalUrlToFetch, {
              method: originalRequest.method,
              headers: originalRequest.headers,
              redirect: 'follow'
            });
            
            fallbackResponse = await fetch(directRequest);
          } catch (directError) {
            logErrorWithContext('Error with direct fetch after AWS auth failure', directError, {
              pattern: matchedPattern.name,
              url: finalUrlToFetch
            }, 'handleTransformationError');
          }
        }
      } else {
        // For other auth types or no specific auth implementation, try direct fetch
        addBreadcrumb(requestContext, 'Fallback', 'Using direct fetch for pattern origin', {
          pattern: matchedPattern.name,
          authType: matchedPattern.auth.type
        });
        
        // Use original request's method and headers for direct fetch
        const directRequest = new Request(finalUrlToFetch, {
          method: originalRequest.method,
          headers: originalRequest.headers,
          redirect: 'follow' // Important for potential redirects at origin
        });
        
        fallbackResponse = await fetch(directRequest);
      }
      
      // Check if the pattern-specific fetch succeeded
      if (fallbackResponse && fallbackResponse.ok) {
        logDebug('handleTransformationError', 'Pattern-specific fallback successful', {
          pattern: matchedPattern?.name || 'direct',
          status: fallbackResponse.status,
          contentType: fallbackResponse.headers.get('Content-Type')
        });
        
        addBreadcrumb(requestContext, 'Fallback', 'Successfully fetched using pattern origin/auth', {
          pattern: matchedPattern?.name || 'direct',
          status: fallbackResponse.status
        });
        
        // Store pattern-specific fallback video in KV cache in the background
        // This is particularly important for S3 presigned URLs which expire
        if (fallbackResponse.body) {
          // Get the path from the original request
          const path = new URL(originalRequest.url).pathname;
          
          // Use our centralized helper function for background caching
          await initiateBackgroundCaching(context.env, path, fallbackResponse, requestContext, {
            pattern: matchedPattern?.name
          });
        }
        
        // Add pattern-specific fallback header
        const headers = new Headers(fallbackResponse.headers);
        headers.set('X-Fallback-Applied', 'true');
        
        if (matchedPattern) {
          headers.set('X-Pattern-Fallback-Applied', 'true');
          headers.set('X-Pattern-Name', matchedPattern.name);
          
          // Add detailed debugging information
          if (matchedPattern.auth?.type) {
            headers.set('X-Pattern-Auth-Type', matchedPattern.auth.type);
          }
          
          // Add pattern origin info (with domain only for security)
          if (matchedPattern.originUrl) {
            try {
              const originDomain = new URL(matchedPattern.originUrl).hostname;
              headers.set('X-Pattern-Origin-Domain', originDomain);
            } catch (e) {
              // If URL parsing fails, just use a placeholder
              headers.set('X-Pattern-Origin-Domain', 'unknown');
            }
          }
        }
        
        // Add fallback-specific headers
        headers.set('X-Fallback-Reason', parsedError.specificError || errorText.substring(0, 100));
        
        // Add original error information for debugging
        headers.set('X-Original-Error-Status', String(errorResponse.status));
        headers.set('X-Original-Error-Type', parsedError.errorType || 'unknown');
        
        // Add Cache-Control header to prevent caching of fallback response
        headers.set('Cache-Control', 'no-store');
        
        // Ensure correct content type for video playback in browser
        const contentType = fallbackResponse.headers.get('Content-Type');
        if (contentType === 'application/octet-stream' || contentType === 'binary/octet-stream') {
          // Set proper video content type based on the file extension
          const url = new URL(originalRequest.url);
          const path = url.pathname;
          if (path.endsWith('.mp4')) {
            headers.set('Content-Type', 'video/mp4');
          } else if (path.endsWith('.webm')) {
            headers.set('Content-Type', 'video/webm');
          } else if (path.endsWith('.mov')) {
            headers.set('Content-Type', 'video/quicktime');
          } else if (path.endsWith('.avi')) {
            headers.set('Content-Type', 'video/x-msvideo');
          } else if (path.endsWith('.wmv')) {
            headers.set('Content-Type', 'video/x-ms-wmv');
          } else if (path.endsWith('.m4v')) {
            headers.set('Content-Type', 'video/mp4');
          } else if (path.endsWith('.mkv')) {
            headers.set('Content-Type', 'video/x-matroska');
          } else {
            // Default to MP4 if we can't determine from extension
            headers.set('Content-Type', 'video/mp4');
          }
          
          logDebug('handleTransformationError', 'Fixed content type for video playback', {
            original: contentType,
            updated: headers.get('Content-Type'),
            path: path
          });
        }
        
        // Create a response with our custom headers
        const finalResponse = new Response(fallbackResponse.body, {
          status: fallbackResponse.status,
          statusText: fallbackResponse.statusText,
          headers
        });
        
        // Return the response
        return finalResponse;
      } else if (fallbackResponse) {
        // Didn't get an OK response, log the failure
        logDebug('handleTransformationError', 'Pattern-specific fallback returned non-OK status', {
          pattern: matchedPattern.name,
          status: fallbackResponse.status,
          statusText: fallbackResponse.statusText
        });
        
        addBreadcrumb(requestContext, 'Fallback', 'Pattern origin/auth fetch failed with status', {
          pattern: matchedPattern.name,
          status: fallbackResponse.status
        });
        
        // Reset the fallbackResponse to try other fallback mechanisms
        fallbackResponse = undefined;
      }
    } catch (patternFetchError) {
      logErrorWithContext('Error during pattern-specific fallback fetch', patternFetchError, {
        pattern: matchedPattern.name,
        url: matchedPattern.originUrl
      }, 'handleTransformationError');
      
      addBreadcrumb(requestContext, 'Error', 'Pattern-specific fallback fetch error', {
        pattern: matchedPattern.name,
        error: patternFetchError instanceof Error ? patternFetchError.message : 'Unknown'
      });
      
      // Reset the fallbackResponse to try other fallback mechanisms
      fallbackResponse = undefined;
    }
  }

  // Second priority: Basic direct fetch from fallbackOriginUrl or source
  const sourceUrlForDirectFetch = fallbackOriginUrl || source; // Prefer pattern-based fallback URL
  
  // Check if this is specifically a "video too large" error
  const is256MiBSizeError = isFileSizeError && (
    errorText.includes('256MiB') || 
    errorText.includes('256 MiB') || 
    parsedError.specificError?.includes('256MiB')
  );
  
  // Only attempt direct fetch if pattern-specific fetch wasn't attempted or failed, and we have a direct URL
  if (!fallbackResponse && !patternFetchAttempted && ((isServerError || isFileSizeError) || is256MiBSizeError) && sourceUrlForDirectFetch) {
    // If it's specifically a 256MiB size error, log it differently
    if (is256MiBSizeError) {
      logDebug('handleTransformationError', 'Video exceeds 256MiB limit, attempting direct source fetch with range support', { 
        sourceUrl: sourceUrlForDirectFetch.substring(0,50)
      });
      addBreadcrumb(requestContext, 'Fallback', 'Attempting direct fetch for large video', { 
        reason: 'Video exceeds 256MiB size limit'
      });
    } else {
      logDebug('handleTransformationError', 'Attempting direct source fetch', { 
        sourceUrl: sourceUrlForDirectFetch.substring(0,50), 
        reason: isServerError ? 'Server Error' : 'File Size Error' 
      });
      addBreadcrumb(requestContext, 'Fallback', 'Attempting direct fetch', { 
        reason: isServerError ? 'Server Error' : 'File Size Error' 
      });
    }
    
    try {
      // Use original request's method and headers for direct fetch
      const directRequest = new Request(sourceUrlForDirectFetch, {
        method: originalRequest.method,
        headers: originalRequest.headers,
        redirect: 'follow' // Important for potential redirects at origin
      });
      
      // For large videos that exceed 256MiB, handle differently to avoid cache API
      if (is256MiBSizeError) {
        // Fetch but don't use cache API for these large files
        fallbackResponse = await fetch(directRequest);
        
        if (!fallbackResponse.ok) {
          logDebug('handleTransformationError', 'Direct source fetch failed for large video', { status: fallbackResponse.status });
          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch failed for large video', { status: fallbackResponse.status });
          fallbackResponse = undefined; // Reset to trigger storage service fallback
        } else {
          // Check if origin supports range requests
          const hasRangeSupport = fallbackResponse.headers.get('Accept-Ranges') === 'bytes';
          
          logDebug('handleTransformationError', 'Direct source fetch successful for large video', { 
            status: fallbackResponse.status,
            contentLength: fallbackResponse.headers.get('Content-Length'),
            hasRangeSupport: hasRangeSupport
          });
          
          // If origin doesn't support range requests, we could implement streaming 
          // using utilities similar to those in kvStorage/streamingHelpers.ts
          
          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch successful for large video', { 
            status: fallbackResponse.status,
            streamedDirectly: true,
            hasRangeSupport: hasRangeSupport
          });
          
          // Store large video in KV cache in the background using chunking
          // Use waitUntil to process in the background without blocking the response
          if (fallbackResponse.body) {
            // Get the path from the original request
            const path = new URL(originalRequest.url).pathname;
            
            // Use our centralized helper function for background caching
            await initiateBackgroundCaching(context.env, path, fallbackResponse, requestContext, {
              isLargeVideo: true
            });
          }
        }
      } else {
        // Normal fetch for other cases
        fallbackResponse = await fetch(directRequest);
        
        if (!fallbackResponse.ok) {
          logDebug('handleTransformationError', 'Direct source fetch failed', { status: fallbackResponse.status });
          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch failed', { status: fallbackResponse.status });
          fallbackResponse = undefined; // Reset to trigger storage service fallback
        } else {
          logDebug('handleTransformationError', 'Direct source fetch successful', { status: fallbackResponse.status });
          addBreadcrumb(requestContext, 'Fallback', 'Direct fetch successful', { status: fallbackResponse.status });
          
          // Also store regular fallback videos in KV cache in the background
          // This handles the non-large video case but with the same chunking support
          if (fallbackResponse.body) {
            // Get the path from the original request
            const path = new URL(originalRequest.url).pathname;
            
            // Use our centralized helper function for background caching
            await initiateBackgroundCaching(context.env, path, fallbackResponse, requestContext);
          }
        }
      }
    } catch (directFetchError) {
      logErrorWithContext('Error fetching directly from source', directFetchError, { sourceUrl: sourceUrlForDirectFetch }, 'handleTransformationError');
      addBreadcrumb(requestContext, 'Error', 'Direct fetch exception', { error: directFetchError instanceof Error ? directFetchError.message : String(directFetchError) });
      fallbackResponse = undefined;
    }
  }

  // Third priority: Use storage service if all previous attempts failed
  if (!fallbackResponse) {
    logDebug('handleTransformationError', 'Using storage service for fallback');
    addBreadcrumb(requestContext, 'Fallback', 'Using storage service');
    
    try {
      // Import VideoConfigurationManager dynamically to allow for mocking in tests
      const { VideoConfigurationManager } = await import('../../config');
      const videoConfigManager = VideoConfigurationManager.getInstance();
      const videoConfig = videoConfigManager.getConfig();
      const storageResult = await fetchVideo(
        new URL(originalRequest.url).pathname,
        videoConfig,
        context.env || {},
        originalRequest
      );

      if (storageResult.sourceType !== 'error') {
        fallbackResponse = storageResult.response;
        logDebug('handleTransformationError', 'Storage service fallback successful', { status: fallbackResponse.status });
        addBreadcrumb(requestContext, 'Fallback', 'Storage service successful', { status: fallbackResponse.status });
      } else {
        logErrorWithContext('Failed to get fallback content via storage service', storageResult.error, { path: new URL(originalRequest.url).pathname }, 'handleTransformationError');
        addBreadcrumb(requestContext, 'Error', 'Storage service fallback failed', { error: storageResult.error?.message });
      }
    } catch (storageError) {
      logErrorWithContext('Error using storage service for fallback', storageError, { path: new URL(originalRequest.url).pathname }, 'handleTransformationError');
      addBreadcrumb(requestContext, 'Error', 'Storage service exception', { error: storageError instanceof Error ? storageError.message : String(storageError) });
    }
  }

  // --- Finalize Fallback Response ---
  if (fallbackResponse) {
    const headers = new Headers(fallbackResponse.headers);
    
    // Add fallback-specific headers
    headers.set('X-Fallback-Applied', 'true');
    headers.set('X-Fallback-Reason', parsedError.specificError || errorText.substring(0, 100));
    headers.set('X-Original-Error-Status', String(status));
    
    if (parsedError.errorType) headers.set('X-Error-Type', parsedError.errorType);
    if (parsedError.parameter) headers.set('X-Invalid-Parameter', parsedError.parameter);
    
    // Add specific headers for file size errors
    if (isFileSizeError || parsedError.errorType === 'file_size_limit' || errorText.includes('file size limit')) {
      headers.set('X-File-Size-Error', 'true');
      headers.set('X-Video-Too-Large', 'true'); // Required for backward compatibility
    }
    
    // Add specific header for 256MiB size errors
    if (is256MiBSizeError) {
      headers.set('X-Video-Exceeds-256MiB', 'true');
      headers.set('X-Direct-Stream', 'true');
    }
    
    if (isServerError) headers.set('X-Server-Error-Fallback', 'true');
    
    // Add pattern info if a pattern was matched but direct fetch was used
    if (matchedPattern && patternFetchAttempted) {
      headers.set('X-Pattern-Fallback-Attempted', 'true');
      headers.set('X-Pattern-Name', matchedPattern.name);
      
      // Add more detailed information for debugging
      if (matchedPattern.auth?.type) {
        headers.set('X-Pattern-Auth-Type', matchedPattern.auth.type);
      }
      
      // Add pattern origin info (with domain only for security)
      if (matchedPattern.originUrl) {
        try {
          const originDomain = new URL(matchedPattern.originUrl).hostname;
          headers.set('X-Pattern-Origin-Domain', originDomain);
        } catch (e) {
          // If URL parsing fails, just use a placeholder
          headers.set('X-Pattern-Origin-Domain', 'unknown');
        }
      }
    }
    
    // For storage service fallback, add storage source header for backward compatibility
    if (!((isServerError || isFileSizeError) && sourceUrlForDirectFetch && fallbackResponse.url === sourceUrlForDirectFetch)) {
      // If we didn't use direct fetch, assume it came from storage service
      headers.set('X-Storage-Source', 'remote');
    } else {
      // Indicate if direct source was successfully used for fallback
      headers.set('X-Direct-Source-Used', 'true');
    }

    // For ALL fallbacks, set bypass headers using the centralized utility
    const { setBypassHeaders } = await import('../../utils/bypassHeadersUtils');
    
    // Set bypass headers with appropriate options
    setBypassHeaders(headers, {
      videoExceedsSize: is256MiBSizeError,
      isFallback: true,
      fileSizeError: isFileSizeError || parsedError.errorType === 'file_size_limit' || errorText.includes('file size limit')
    })
    
    // For large videos specifically, add some browser cache hints to improve playback
    if (is256MiBSizeError) {
      // Also allow some browser-side caching with private directive 
      headers.append('Cache-Control', 'private, max-age=3600');
      
      logDebug('handleTransformationError', 'Setting up large video response for direct streaming (bypassing Cache API)', {
        contentLength: headers.get('Content-Length'),
        contentType: headers.get('Content-Type'),
        acceptRanges: headers.get('Accept-Ranges'),
        sizeExceeds256MiB: true
      });
    } else {
      // Log regular fallback
      logDebug('handleTransformationError', 'Fallback streaming with direct response (bypassing Cache API)', {
        contentLength: headers.get('Content-Length'),
        contentType: headers.get('Content-Type'),
        acceptRanges: headers.get('Accept-Ranges')
      });
    }

    return new Response(fallbackResponse.body, {
      status: fallbackResponse.status,
      statusText: fallbackResponse.statusText,
      headers
    });
  }

  // If all fallbacks fail, return a generic error response
  logErrorWithContext('All fallback mechanisms failed', new Error('No fallback content available'), { requestId: requestContext.requestId }, 'handleTransformationError');
  addBreadcrumb(requestContext, 'Error', 'All fallbacks failed');
  
  // Return a generic 500
  return new Response(`Transformation failed and fallback could not be retrieved. Original error status: ${status}`, {
    status: 500,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
  });
}