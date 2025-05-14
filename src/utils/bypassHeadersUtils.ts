/**
 * Utility functions for managing bypass headers
 * 
 * These headers control streaming behavior, particularly for bypassing caching mechanisms
 * for large videos or fallback responses.
 */

// Constants for header names to ensure consistency
export const BYPASS_CACHE_API_HEADER = 'X-Bypass-Cache-API'; // Primary header
export const DIRECT_STREAM_HEADER = 'X-Direct-Stream-Only';  // Legacy support
export const CACHE_API_BYPASS_HEADER = 'X-Cache-API-Bypass'; // Legacy support
export const VIDEO_EXCEEDS_SIZE_HEADER = 'X-Video-Exceeds-256MiB'; // Specific size error
export const FILE_SIZE_ERROR_HEADER = 'X-File-Size-Error'; // General size error
export const FALLBACK_APPLIED_HEADER = 'X-Fallback-Applied'; // Fallback indicator

/**
 * Sets all bypass headers on a Headers object
 * 
 * @param headers The Headers object to modify
 * @param options Additional options
 */
export function setBypassHeaders(
  headers: Headers,
  options: {
    videoExceedsSize?: boolean;
    isFallback?: boolean;
    fileSizeError?: boolean;
  } = {}
): void {
  // Set the primary bypass header - this should be the primary indicator for bypassing Cache API
  headers.set(BYPASS_CACHE_API_HEADER, 'true');
  
  // Set legacy headers for backward compatibility
  headers.set(DIRECT_STREAM_HEADER, 'true');
  headers.set(CACHE_API_BYPASS_HEADER, 'true');
  
  // Set specific headers based on options
  if (options.videoExceedsSize) {
    headers.set(VIDEO_EXCEEDS_SIZE_HEADER, 'true');
  }
  
  if (options.fileSizeError) {
    headers.set(FILE_SIZE_ERROR_HEADER, 'true');
  }
  
  if (options.isFallback) {
    headers.set(FALLBACK_APPLIED_HEADER, 'true');
  }
  
  // Ensure no caching for bypassed content
  headers.set('Cache-Control', 'no-store');
  
  // Ensure range requests are supported
  if (!headers.has('Accept-Ranges')) {
    headers.set('Accept-Ranges', 'bytes');
  }
}

/**
 * Checks if a response has bypass headers set
 * 
 * @param headers Headers object to check
 * @returns True if bypass headers are set
 */
export function hasBypassHeaders(headers: Headers): boolean {
  return headers.get(BYPASS_CACHE_API_HEADER) === 'true' ||
         headers.get(DIRECT_STREAM_HEADER) === 'true' ||
         headers.get(CACHE_API_BYPASS_HEADER) === 'true' ||
         headers.get(VIDEO_EXCEEDS_SIZE_HEADER) === 'true' ||
         headers.get(FILE_SIZE_ERROR_HEADER) === 'true';
}

/**
 * Copies bypass headers from one Headers object to another
 * 
 * @param fromHeaders Source Headers object
 * @param toHeaders Destination Headers object
 */
export function copyBypassHeaders(fromHeaders: Headers, toHeaders: Headers): void {
  if (fromHeaders.get(BYPASS_CACHE_API_HEADER) === 'true') {
    toHeaders.set(BYPASS_CACHE_API_HEADER, 'true');
  }
  
  if (fromHeaders.get(DIRECT_STREAM_HEADER) === 'true') {
    toHeaders.set(DIRECT_STREAM_HEADER, 'true');
  }
  
  if (fromHeaders.get(CACHE_API_BYPASS_HEADER) === 'true') {
    toHeaders.set(CACHE_API_BYPASS_HEADER, 'true');
  }
  
  if (fromHeaders.get(VIDEO_EXCEEDS_SIZE_HEADER) === 'true') {
    toHeaders.set(VIDEO_EXCEEDS_SIZE_HEADER, 'true');
  }
  
  if (fromHeaders.get(FILE_SIZE_ERROR_HEADER) === 'true') {
    toHeaders.set(FILE_SIZE_ERROR_HEADER, 'true');
  }
  
  if (fromHeaders.get(FALLBACK_APPLIED_HEADER) === 'true') {
    toHeaders.set(FALLBACK_APPLIED_HEADER, 'true');
  }
}