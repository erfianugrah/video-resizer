# IMQuery Parameter Caching Enhancement

## Overview

This documentation describes the enhancement to the video-resizer's caching system to better handle IMQuery parameters. IMQuery is Akamai's responsive image URL format that we support for backwards compatibility.

## Problem

Previously, when a request with IMQuery parameters (like `imwidth=800`) came in, the system would match it to the appropriate derivative (e.g., "low" for 854x480 resolution), but would use only the derivative name in the cache key. This led to a few issues:

1. The cache key reflected the derivative ("low") rather than the actual requested dimension (`imwidth=800`)
2. Different IMQuery values that mapped to the same derivative would share the same cache key
3. The cache metadata didn't reflect the IMQuery origins of the transformation

## Solution

We've implemented several changes to improve the handling of IMQuery parameters in the caching system:

1. Modified `generateKVKey` in `kvStorageService.ts` to prioritize IMQuery parameters in the cache key
2. Updated the video handlers to capture IMQuery parameters and add them to the `customData` field
3. Updated the cache orchestrator to use IMQuery parameters in both lookups and storage operations

### Cache Key Generation

The cache key now includes IMQuery parameters directly when they're present. For example:

- Old: `video:erfi.mp4:derivative=low`
- New: `video:erfi.mp4:imwidth=800:via=low`

This means:
- Different IMQuery values will have different cache keys, even if they map to the same derivative
- The cache key accurately reflects the origin of the transformation (IMQuery parameters)
- The derivative used for transformation is still recorded in the cache key (`:via=low`)

### Storage & Lookup Updates

Both storage and lookup operations now correctly check and include IMQuery parameters:

1. We detect IMQuery parameters in the URL and store them in the `customData` field
2. The `customData` field is used by the cache key generator to create IMQuery-specific keys
3. Lookup operations also use the same `customData` approach for consistent key generation

## Benefits

This enhancement provides several benefits:

1. **Improved Cacheability**: URLs with IMQuery parameters are now properly cached with specific keys
2. **Accuracy**: Cache entries accurately reflect the actual parameters used for transformation
3. **Clarity**: Developers can more easily understand how IMQuery parameters affect caching
4. **Diagnostic Value**: Logs and cache keys make it clear when IMQuery parameters are driving transformations

## Example

A request for `/video.mp4?imwidth=800` that is translated to the "low" derivative will now:

1. Be cached with the key `video:video.mp4:imwidth=800:via=low`
2. Have the IMQuery parameters recorded in the cache metadata
3. Be found again when the same IMQuery parameter is requested

This better supports responsive web designs that rely on IMQuery parameters for consistent video dimensions.