/**
 * Request-scoped caching for performance optimization
 * 
 * Provides utilities for caching function results and pattern matches
 * within the scope of a single request.
 */

import { RequestContext } from './requestContext';
import { PathPattern, PathMatchResult } from './pathUtils';

/**
 * Cache a function result for the duration of a request
 * 
 * @param context RequestContext to store the cache in
 * @param fn Function to call and cache the result of
 * @param args Arguments to the function
 * @param key Optional custom cache key
 * @returns The function result (either from cache or newly computed)
 */
export function withRequestScopedCache<T>(
  context: RequestContext,
  fn: (...args: any[]) => T,
  args: any[],
  key?: string
): T {
  // Initialize cache if it doesn't exist
  if (!context.diagnostics.fnCache) {
    context.diagnostics.fnCache = new Map<string, any>();
  }

  // Create cache key based on function name and arguments
  const cacheKey = key || `${fn.name}:${JSON.stringify(args)}`;
  
  // Return cached result if available
  if (context.diagnostics.fnCache.has(cacheKey)) {
    return context.diagnostics.fnCache.get(cacheKey);
  }
  
  // Call function and cache result
  const result = fn(...args);
  context.diagnostics.fnCache.set(cacheKey, result);
  return result;
}

/**
 * Cache pattern match results for the duration of a request
 * 
 * @param context RequestContext to store the cache in
 * @param url URL to match against patterns
 * @param patterns Array of path patterns to match against
 * @param matchFn Function that performs the actual matching
 * @returns The match result (either from cache or newly computed)
 */
export function withPatternMatchCache<T>(
  context: RequestContext,
  url: string,
  patterns: PathPattern[],
  matchFn: (url: string, patterns: PathPattern[]) => T
): T {
  // Initialize pattern match cache if it doesn't exist
  if (!context.diagnostics.patternMatchCache) {
    context.diagnostics.patternMatchCache = new Map<string, any>();
  }
  
  // Create cache key based on URL and number of patterns (avoids stringifying all patterns)
  const cacheKey = `${url}:${patterns.length}`;
  
  // Return cached result if available
  if (context.diagnostics.patternMatchCache.has(cacheKey)) {
    return context.diagnostics.patternMatchCache.get(cacheKey);
  }
  
  // Perform matching and cache result
  const result = matchFn(url, patterns);
  context.diagnostics.patternMatchCache.set(cacheKey, result);
  return result;
}

/**
 * Function to get or create a generic cache in the request context
 * @param context Request context
 * @param cacheName Name of the cache
 * @returns The cache Map object
 */
export function getOrCreateRequestCache<K, V>(
  context: RequestContext,
  cacheName: string
): Map<K, V> {
  if (!context.diagnostics[cacheName]) {
    context.diagnostics[cacheName] = new Map<K, V>();
  }
  return context.diagnostics[cacheName] as Map<K, V>;
}