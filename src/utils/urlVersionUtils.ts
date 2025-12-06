/**
 * URL utilities for working with version parameters
 * Provides functions for handling version parameters in URLs
 */
import { cacheConfig } from '../config/CacheConfigurationManager';

/**
 * Normalizes a URL by removing version parameter
 * @param url The URL to normalize
 * @returns Normalized URL string
 */
export function normalizeUrlForCaching(url: string): string {
  try {
    // Absolute URLs keep their origin
    if (/^https?:\/\//i.test(url)) {
      const parsedUrl = new URL(url);
      parsedUrl.searchParams.delete('v');
      return parsedUrl.toString();
    }
    // Pathnames need a base for URL parsing; strip back to path afterwards
    if (url.startsWith('/')) {
      const parsedUrl = new URL(url, 'http://dummy');
      parsedUrl.searchParams.delete('v');
      return `${parsedUrl.pathname}${parsedUrl.search}`;
    }
    // For everything else, leave untouched to avoid mangling
    return url;
  } catch (err) {
    // If parsing fails, just return the original
    return url;
  }
}

/**
 * Adds version parameter to a URL
 * @param url The URL to modify
 * @param version The version number to add
 * @returns URL with version parameter
 */
export function addVersionToUrl(url: string, version: number): string {
  // If versioning is disabled in configuration, return the original URL
  if (!cacheConfig.isVersioningEnabled()) {
    return url;
  }

  // Skip adding version parameters to AWS presigned URLs entirely
  // Presigned URLs naturally expire and change, so no versioning is needed
  if (url.includes('X-Amz-Signature=')) {
    return url; // Return unmodified for AWS presigned URLs
  }
  
  // Standard approach for regular URLs
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set('v', version.toString());
    return parsedUrl.toString();
  } catch (err) {
    // If parsing fails, append version parameter directly
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${version}`;
  }
}

/**
 * Extracts version parameter from a URL
 * @param url The URL to extract version from
 * @returns Version number or null if not found
 */
export function getVersionFromUrl(url: string): number | null {
  try {
    const parsedUrl = new URL(url);
    const versionParam = parsedUrl.searchParams.get('v');
    
    if (!versionParam) {
      return null;
    }
    
    const version = parseInt(versionParam, 10);
    return isNaN(version) ? null : version;
  } catch (err) {
    return null;
  }
}

/**
 * Checks if a URL has a version parameter
 * @param url The URL to check
 * @returns True if URL has version parameter
 */
export function hasVersionParameter(url: string): boolean {
  return getVersionFromUrl(url) !== null;
}
