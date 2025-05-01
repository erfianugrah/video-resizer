/**
 * Utility functions for extracting and handling URL auth tokens
 * These functions are separated to avoid circular dependencies between
 * presignedUrlUtils.ts and presignedUrlCacheService.ts
 */

/**
 * Extract just the authentication token/signature portion from a presigned URL
 * This helps minimize storage by keeping only the essential auth components
 * 
 * @param presignedUrl The full presigned URL
 * @returns Authentication token/query string
 */
export function extractAuthToken(presignedUrl: string): string {
  try {
    const url = new URL(presignedUrl);
    return url.search; // Returns the query string including '?'
  } catch (err) {
    // If URL parsing fails, use a simple string approach
    const queryIndex = presignedUrl.indexOf('?');
    if (queryIndex >= 0) {
      return presignedUrl.substring(queryIndex);
    }
    // If no query string, return empty
    return '';
  }
}

/**
 * Reconstruct a full presigned URL from a base URL and auth token
 * 
 * @param baseUrl The base URL without authentication
 * @param authToken The authentication token/query string
 * @returns Complete presigned URL
 */
export function reconstructPresignedUrl(baseUrl: string, authToken: string): string {
  // Remove any existing query string from the base URL
  const baseWithoutQuery = baseUrl.split('?')[0];
  
  // If the auth token already starts with '?', use it directly
  if (authToken.startsWith('?')) {
    return baseWithoutQuery + authToken;
  }
  
  // Otherwise, add the '?' prefix
  return baseWithoutQuery + (authToken ? `?${authToken}` : '');
}