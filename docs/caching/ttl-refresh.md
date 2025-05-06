# TTL Refresh in KV Cache

This document explains how TTL refreshing works in the video-resizer's KV cache system and how to configure it.

## Overview

TTL (Time-To-Live) refresh extends the lifetime of cached items when they are accessed. This is particularly valuable for video content, as it helps keep frequently accessed videos in cache longer while allowing less popular content to expire naturally.

> **New Feature:** You can now set `storeIndefinitely: true` in your `worker-config.json` to store KV items permanently without expiration. This bypasses the KV TTL mechanism entirely while maintaining all Cache-Control header behaviors. See [Indefinite Storage](#indefinite-storage) below for details.

## How It Works

When a cached item is accessed:

1. The system checks how much of the original TTL has elapsed
2. If enough time has elapsed (configurable threshold) and there's sufficient time remaining, the TTL is refreshed
3. The refresh is performed in the background using Cloudflare's `waitUntil` to avoid blocking responses
4. Only the metadata is updated, not the entire video content, making it very efficient

## Optimization Details

The TTL refresh implementation includes several optimizations:

1. **Metadata-only updates**: Instead of re-storing the entire video content (which could be many MB), only the metadata's `expiresAt` field is updated
2. **Background processing**: Refresh operations happen in the background via Cloudflare's `waitUntil` API
3. **Rate limit protection**: Includes exponential backoff retry logic to handle KV's rate limiting (1 write per second per key)
4. **Configurable thresholds**: Refresh criteria can be adjusted through configuration

## Configuration Options

TTL refresh behavior can be configured in your `worker-config.json` file:

```json
{
  "cache": {
    "ttlRefresh": {
      "minElapsedPercent": 10,
      "minRemainingSeconds": 60
    }
  }
}
```

### Parameters

- **minElapsedPercent**: Minimum percentage of the original TTL that must have elapsed before refreshing (default: 10%)
- **minRemainingSeconds**: Minimum seconds remaining before refreshing (default: 60 seconds)

## Usage Examples

### Default Behavior

With default settings (10% elapsed, 60s minimum remaining):

- For a 1-hour cache TTL: Refresh after 6 minutes of the original caching time
- For a 1-day cache TTL: Refresh after 2.4 hours of the original caching time

### More Aggressive Refresh

```json
{
  "cache": {
    "ttlRefresh": {
      "minElapsedPercent": 5,
      "minRemainingSeconds": 30
    }
  }
}
```

This configuration will refresh TTLs more aggressively:

- For a 1-hour cache TTL: Refresh after just 3 minutes
- For a 1-day cache TTL: Refresh after 1.2 hours

### Less Aggressive Refresh

```json
{
  "cache": {
    "ttlRefresh": {
      "minElapsedPercent": 25,
      "minRemainingSeconds": 300
    }
  }
}
```

This configuration will refresh TTLs less aggressively:

- For a 1-hour cache TTL: Refresh after 15 minutes (and only if 5+ minutes remain)
- For a 1-day cache TTL: Refresh after 6 hours (and only if 5+ minutes remain)

## Performance Considerations

Cloudflare KV has a rate limit of 1 write per second per key. The TTL refresh mechanism includes:

1. Exponential backoff for retries
2. Thresholds to prevent excessive refreshes
3. Metadata-only updates to minimize data transfer

Generally, the default settings strike a good balance between keeping popular content in cache longer while avoiding excessive writes.

## Implementation Details

The TTL refresh logic is implemented in:

- `src/utils/kvTtlRefreshUtils.ts`: Core TTL refresh utilities
- `src/services/kvStorageService.ts`: Integration with the KV storage service
- `src/config/CacheConfigurationManager.ts`: Configuration management

The core refresh function (`refreshKeyTtl`) avoids rewriting the entire value by using an empty string value with updated metadata, which is much more efficient than re-storing the entire video content.

## Best Practices

1. **Adjust based on traffic patterns**: Sites with higher traffic may want to be less aggressive with refreshes to avoid rate limiting.
2. **Consider cache size**: More aggressive TTL refreshing can increase your KV storage usage as items stay in cache longer.
3. **Monitor KV usage**: Watch for increased KV operations if you adjust to more aggressive settings.

By configuring TTL refresh appropriately, you can optimize cache efficiency and performance for your specific use case.

## Indefinite Storage

The `storeIndefinitely` setting allows you to store KV items permanently without expiration, regardless of the TTL settings:

```json
{
  "cache": {
    "storeIndefinitely": true,
    "defaultMaxAge": 300,
    "ttlRefresh": {
      "minElapsedPercent": 10,
      "minRemainingSeconds": 60
    }
  }
}
```

### How It Works

When `storeIndefinitely` is set to `true`:

1. KV items are stored **without** the `expirationTtl` parameter, making them persist indefinitely
2. The `expiresAt` field is still set in metadata, ensuring Cache-Control headers work properly
3. Client browsers will still respect cache expiration as specified in your TTL configuration
4. The `TTL refresh` mechanism becomes irrelevant for KV storage, though still functional for metadata

### Use Cases

This setting is ideal for:

- Production environments with high-value video content that shouldn't expire
- Situations where the 25 MiB KV value size limit isn't a concern
- Environments where storage costs are less important than optimizing hit rates
- Content that's infrequently updated and benefits from maximum persistence

### Trade-offs

Consider these trade-offs when using indefinite storage:

**Advantages:**
- Maximum KV hit rates (no TTL expirations)
- Simplified architecture (no TTL refresh needed)
- Reduced operations on hot content

**Disadvantages:**
- Increased KV storage usage and potential costs
- Requires manual purging of outdated content
- No automatic cleanup of rarely accessed content