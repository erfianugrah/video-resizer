/**
 * HTTP utilities for handling common HTTP operations
 * This file contains utility functions for working with HTTP requests and responses
 */

/**
 * Parse the Range header and return start/end positions
 * 
 * @param rangeHeader The Range header value (e.g., "bytes=0-1023")
 * @param totalSize The total size of the resource
 * @returns Object with start and end positions, or null if invalid
 */
export function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number
): { start: number; end: number; total: number } | null {
  // Check for null/empty header or invalid totalSize
  if (!rangeHeader || totalSize <= 0) {
    return null;
  }

  // Only support simple byte ranges for now (no multipart)
  // Strict regex to avoid matching invalid formats like "bytes=1-2-3"
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }

  let start = 0;
  let end = totalSize - 1;

  // Both parts empty (bytes=-)
  if (!match[1] && !match[2]) {
    return null;
  }

  if (match[1] && match[2]) {
    // bytes=start-end
    start = parseInt(match[1], 10);
    end = parseInt(match[2], 10);
  } else if (match[1] && !match[2]) {
    // bytes=start- (from start to end)
    start = parseInt(match[1], 10);
    end = totalSize - 1;
  } else if (!match[1] && match[2]) {
    // bytes=-suffix (last N bytes)
    const suffix = parseInt(match[2], 10);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  }

  // Clamp end to totalSize - 1
  end = Math.min(end, totalSize - 1);

  // Validate range
  if (start < 0 || start >= totalSize || end < start) {
    return null;
  }

  return { start, end, total: totalSize };
}

/**
 * Get content type from response headers with fallback
 * 
 * @param headers Response headers
 * @param fallback Fallback content type
 * @returns Content type string
 */
export function getContentType(headers: Headers, fallback = 'application/octet-stream'): string {
  return headers.get('content-type') || fallback;
}

/**
 * Check if a response should be cached based on status and headers
 * 
 * @param response The response to check
 * @returns True if the response should be cached
 */
export function isCacheable(response: Response): boolean {
  // Cache successful responses (2xx) and some redirects
  if (response.status >= 200 && response.status < 300) {
    return true;
  }
  
  // Don't cache client errors, server errors, or other status codes
  return false;
}

/**
 * Create a 416 Range Not Satisfiable response
 * 
 * @param totalSize The total size of the resource
 * @returns A 416 response with appropriate headers
 */
export function createUnsatisfiableRangeResponse(totalSize: number): Response {
  const headers = new Headers({
    'Content-Range': `bytes */${totalSize}`,
    'Accept-Ranges': 'bytes'
  });
  return new Response('Range Not Satisfiable', { status: 416, headers });
}

/**
 * Handles range requests for initial video access.
 * Since we store videos in KV and serve range requests from there,
 * this function simply returns the original response without any Cache API logic.
 * 
 * @param originalResponse The full response with the video content
 * @param request The original request, potentially with a Range header
 * @returns The original response (range handling happens in KV retrieval)
 */
export async function handleRangeRequestForInitialAccess(
  originalResponse: Response,
  _request: Request
): Promise<Response> {
  // Simply return the original response
  // Range request handling is done when serving from KV storage
  return originalResponse;
}