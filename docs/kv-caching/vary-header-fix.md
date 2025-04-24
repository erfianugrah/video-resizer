# Fixing Cache Consistency with Vary Header Sanitization

## Issue Summary

We encountered a persistent issue where video responses were successfully stored in Cloudflare's Cache API but not found by subsequent requests. This document explains the root cause and our solution.

## Problem Details

The issue occurred specifically with CDN-CGI transformed responses:

1. A video response would be successfully stored in cache using `cache.put()`
2. The immediate `cache.match()` after storing would often succeed
3. However, subsequent requests from different clients would consistently fail to match the cached item

This resulted in poor cache hit rates and increased origin traffic, particularly impacting video streaming performance where range requests are common.

## Root Cause

After thorough investigation, we traced the issue to **complex `Vary` headers** in the CDN-CGI transformed responses:

1. When Cloudflare's CDN-CGI service processes media, it adds complex `Vary` headers like:
   ```
   Vary: Accept-Encoding, User-Agent, ...
   ```

2. These headers were being copied to our cached responses without sanitization in the transformed response path

3. The `Vary` header instructs caches that the response varies based on the request headers listed:
   - For a response with `Vary: User-Agent`, cache lookups will only match if the *exact* `User-Agent` string matches
   - This makes cache matching extremely brittle since `User-Agent` strings vary significantly between clients

4. The code path for transformed responses lacked the `Vary` header sanitization that existed in other paths

## Solution Implemented

We implemented a fix consisting of several key changes:

1. **Aggressive Header Sanitization**: For transformed responses, we now:
   ```typescript
   // Only keep essential headers for caching and proper content delivery
   const essentialHeaders = [
     'content-type',
     'content-length',
     'cache-control',
     'etag',
     'last-modified'
   ];
   
   // Clear all headers and only copy essential ones
   for (const key of headerKeys) {
     if (!essentialHeaders.includes(key.toLowerCase())) {
       headers.delete(key);
     }
   }
   
   // Completely remove Vary header for maximum cache reliability
   headers.delete('vary');
   ```

2. **Simplified Cache Keys**: We now use the most minimal cache key possible:
   ```typescript
   // Strip query parameters from the URL
   const urlObj = new URL(url);
   const baseUrl = urlObj.origin + urlObj.pathname;
   
   // Create minimal cache key with no headers
   const simpleCacheKey = new Request(baseUrl, { 
     method: 'GET'
   });
   ```

3. **Multi-Strategy Cache Lookup**: We try multiple approaches for cache matching:
   ```typescript
   // First, try with the super-simplified request
   let matchedResponse = await cache.match(simpleKey);
   let matchSuccessType = matchedResponse ? 'simple-key' : 'none';
   
   // If that fails, try with the original request
   if (!matchedResponse) {
     matchedResponse = await cache.match(request);
     matchSuccessType = matchedResponse ? 'original-request' : 'none';
   }
   ```

4. **Comprehensive Logging**: Added detailed diagnostic logging:
   ```typescript
   logDebug('SYNC_CACHE: Cache match attempt result', {
     url: request.url,
     matchSuccessType,
     foundInCache: !!matchedResponse,
     responseStatus: matchedResponse ? matchedResponse.status : 'n/a',
     responseType: matchedResponse ? matchedResponse.headers.get('content-type') : 'n/a',
     varyHeaderInResponse: matchedResponse ? matchedResponse.headers.get('vary') : 'n/a',
     strategy: 'tried-both-simple-and-original'
   });
   ```

## Expected Impact

This fix should significantly improve cache hit rates for video content by:

1. Making cache keys more consistent and resilient to client differences by removing all non-essential headers
2. Completely removing the `Vary` header which was causing the most significant issues
3. Using multiple cache lookup strategies to maximize the chance of a cache hit

## Implementation Location

The fix was applied in `cacheManagementService.ts`, focusing on:

1. The `storeInCacheWithRangeSupport` function for consistent range request support
2. The transformed response handling path in the `cacheResponse` function
3. Cache key generation and matching strategies

## Verification

You can verify this fix by:

1. Looking for the `X-Cache-Sanitized: true` header in responses
2. Checking logs for entries with `SYNC_CACHE: Removed Vary header completely for maximum cache reliability` 
3. Confirming that subsequent requests from different clients now successfully match cached items

## Broader Implications

This experience highlights the critical importance of response header management when working with caching systems:

1. Headers affect not just browser behavior but also cache matching logic
2. CDN-transformed responses may introduce headers that require sanitization
3. Different response types may need different header handling strategies
4. Simplified cache keys and aggressive header sanitization can dramatically improve cache hit rates

We've updated our [Cloudflare Cache API Insights](./cloudflare-cache-api-insights.md) documentation with these learnings to help prevent similar issues in the future.