# Cache Tags Implementation

*Last Updated: January 2025*

## Overview

Cache tags provide a mechanism for efficiently purging related content from Cloudflare's cache. This document describes the cache tag implementation for the video resizer service.

## Tag Format

Cache tags use a shortened prefix to optimize metadata storage:

- **Prefix**: `vp-` (short for "video-prod-")
- **Format**: Path-based identifiers for reliable content grouping

## Tag Types

### 1. Path-Based Tags (`vp-p-{shortPath}`)

- **Purpose**: Identify all derivatives of a specific video
- **Format**: Uses the last 2 segments of the video path
- **Example**: For path `/videos/category/example.mp4`, the tag would be `vp-p-category-example.mp4`
- **Use case**: Purge all derivatives (mobile, desktop, tablet) of a specific video

### 2. Path + Derivative Tags (`vp-p-{shortPath}-{derivative}`)

- **Purpose**: Target a specific derivative of a video
- **Format**: Combines path identifier with derivative name
- **Example**: `vp-p-category-example.mp4-mobile`
- **Use case**: Purge only the mobile version of a specific video

### 3. Derivative Tags (`vp-d-{derivative}`)

- **Purpose**: Purge all videos of a specific derivative type
- **Format**: Derivative name only
- **Example**: `vp-d-desktop`
- **Use case**: Purge all desktop versions across all videos

### 4. Format Tags (`vp-f-{format}`)

- **Purpose**: Support format migration scenarios
- **Format**: Video format identifier
- **Example**: `vp-f-mp4`, `vp-f-webm`
- **Use case**: Purge all videos of a specific format when migrating to a new format

### 5. Mode-Specific Tags (Non-Video Modes)

For frame and spritesheet modes:

- **Frame mode**: `vp-m-frame`, `vp-t-{time}` (e.g., `vp-t-5` for 5 seconds)
- **Spritesheet mode**: 
  - `vp-m-spritesheet`
  - `vp-c-{columns}` (e.g., `vp-c-4`)
  - `vp-r-{rows}` (e.g., `vp-r-4`)
  - `vp-i-{interval}` (e.g., `vp-i-2` for 2-second intervals)

### 6. IMQuery Tag (`vp-imq`)

- **Purpose**: Identify content transformed via IMQuery parameters
- **Format**: Simple flag tag
- **Applied when**: Request contains `imwidth` or `imheight` parameters
- **Use case**: Purge all IMQuery-transformed content

## Implementation Details

### Tag Generation

```typescript
// Example: Tag generation for a video
const videoPath = '/videos/sports/football/match-highlights.mp4';
const options = {
  derivative: 'mobile',
  format: 'mp4'
};

// Generated tags:
// - vp-p-football-match-highlights.mp4 (path-based)
// - vp-p-football-match-highlights.mp4-mobile (path + derivative)
// - vp-d-mobile (derivative)
// - vp-f-mp4 (format)
```

### Metadata Optimization

The tag system is designed to minimize metadata size:

1. **Short prefixes**: Using `vp-` instead of `video-prod-` saves ~10 bytes per tag
2. **Path shortening**: Using only the last 2 path segments reduces tag length
3. **Selective tagging**: Only relevant tags are applied (e.g., mode tags only for non-video modes)

### Storage Consistency

For chunked videos, the same cache tags are applied to:
- The manifest (base key)
- All chunk keys

This ensures that purging operations affect all parts of a chunked video.

## Purging Examples

### Purge All Derivatives of a Video

```bash
# Purge all versions of match-highlights.mp4
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"tags":["vp-p-football-match-highlights.mp4"]}'
```

### Purge Specific Derivative

```bash
# Purge only the mobile version
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"tags":["vp-p-football-match-highlights.mp4-mobile"]}'
```

### Purge All Videos of a Derivative

```bash
# Purge all desktop videos
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"tags":["vp-d-desktop"]}'
```

### Format Migration

```bash
# Purge all MP4 videos when migrating to WebM
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"tags":["vp-f-mp4"]}'
```

## Configuration

Cache tags can be enabled/disabled via configuration:

```json
{
  "enableCacheTags": true,
  "cacheTagPrefix": "video-prod-"
}
```

The system automatically converts long prefixes to short versions to optimize storage.

## Best Practices

1. **Use path-based purging** for content updates
2. **Use derivative purging** when updating transformation logic
3. **Use format purging** during format migrations
4. **Monitor metadata size** to ensure it stays within KV limits
5. **Test purge operations** in staging before production use

## Metadata Size Considerations

With the optimized tag system, typical metadata sizes are:

- **Basic video**: 3-4 tags ≈ 100-150 bytes
- **Frame extraction**: 4-5 tags ≈ 150-200 bytes  
- **Spritesheet**: 6-7 tags ≈ 200-250 bytes

This leaves ample room within the 1KB metadata limit for other fields.