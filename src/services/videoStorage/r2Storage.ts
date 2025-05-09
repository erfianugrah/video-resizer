/**
 * R2 storage functionality for the Video Storage Service
 */

import { withErrorHandling } from '../../utils/errorHandlingUtils';
import { VideoResizerConfig, StorageResult } from './interfaces';
import { logDebug } from './logging';

/**
 * Implementation of fetchFromR2 that might throw errors
 */
async function fetchFromR2Impl(
  path: string, 
  bucket: R2Bucket,
  request?: Request,
  config?: VideoResizerConfig
): Promise<StorageResult | null> {
  // Normalize the path by removing leading slashes
  const normalizedPath = path.replace(/^\/+/, '');
  
  // Handle conditional requests if we have a request object
  if (request) {
    const ifNoneMatch = request.headers.get('If-None-Match');
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    
    // Check for conditional request options
    const options: R2GetOptions = {};
    
    if (ifNoneMatch) {
      options.onlyIf = { etagDoesNotMatch: ifNoneMatch };
    } else if (ifModifiedSince) {
      const ifModifiedSinceDate = new Date(ifModifiedSince);
      if (!isNaN(ifModifiedSinceDate.getTime())) {
        options.onlyIf = { uploadedAfter: ifModifiedSinceDate };
      }
    }
    
    // Handle range requests
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      try {
        const rangeValue = rangeHeader.substring(6);
        const [start, end] = rangeValue.split('-').map(v => parseInt(v, 10));
        
        if (!isNaN(start)) {
          const range: R2Range = { offset: start };
          
          if (!isNaN(end)) {
            range.length = end - start + 1;
          }
          
          options.range = range;
        }
      } catch (err) {
        // Invalid range header, ignore but still log it
        logDebug('VideoStorageService', 'Invalid range header', { rangeHeader });
      }
    }
    
    // Attempt to get the object from R2 with options
    const object = await bucket.get(normalizedPath, options);
    
    // Handle 304 Not Modified
    if (object === null && (ifNoneMatch || ifModifiedSince)) {
      return {
        response: new Response(null, { status: 304 }),
        sourceType: 'r2',
        contentType: null,
        size: 0
      };
    }
    
    if (!object) {
      return null;
    }
    
    // Create headers using R2 object's writeHttpMetadata
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    
    // Add additional headers
    // Get cache TTL with proper type narrowing
    const cacheTTL = config?.cache?.ttl?.ok ?? 86400;
    headers.set('Cache-Control', `public, max-age=${cacheTTL}`);
    headers.set('Accept-Ranges', 'bytes');
    
    // The Range response
    let status = 200;
    if (options.range && 'offset' in options.range) {
      status = 206;
      const offset = options.range.offset || 0;
      const length = options.range.length || 0;
      const end = offset + length - 1;
      const total = object.size;
      headers.set('Content-Range', `bytes ${offset}-${end}/${total}`);
    }
    
    // Return a successful result with the object details
    return {
      response: new Response(object.body, {
        headers,
        status
      }),
      sourceType: 'r2',
      contentType: object.httpMetadata?.contentType || null,
      size: object.size,
      path: normalizedPath
    };
  } else {
    // Simple case - no request object
    const object = await bucket.get(normalizedPath);
    
    if (!object) {
      return null;
    }
    
    // Create headers using R2 object's writeHttpMetadata
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    
    // Add additional headers with proper type narrowing
    const cacheTTL = config?.cache?.ttl?.ok ?? 86400;
    headers.set('Cache-Control', `public, max-age=${cacheTTL}`);
    headers.set('Accept-Ranges', 'bytes');
    
    // Return a successful result with the object details
    return {
      response: new Response(object.body, { headers }),
      sourceType: 'r2',
      contentType: object.httpMetadata?.contentType || null,
      size: object.size,
      path: normalizedPath
    };
  }
}

/**
 * Fetch a video from R2 storage
 * Uses standardized error handling for consistent logging and error normalization
 */
export const fetchFromR2 = withErrorHandling<
  [string, R2Bucket, Request | undefined, VideoResizerConfig | undefined],
  Promise<StorageResult | null>
>(
  fetchFromR2Impl,
  {
    functionName: 'fetchFromR2',
    component: 'VideoStorageService',
    logErrors: true
  },
  {
    storageType: 'r2'
  }
);