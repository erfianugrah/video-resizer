# Cache Version Increment Behavior

## Manual Version Management (Updated)

The automatic version increment on cache miss has been disabled. Now versions are only incremented when you explicitly manage them.

## How Versioning Works Now

1. **Initial State**:
   - No entries in either KV namespace
   - First request uses version 1 (default)
   - Content is stored with version 1

2. **Cache Invalidation**:
   - When you delete entries from VIDEO_TRANSFORMATIONS_CACHE
   - The version in VIDEO_CACHE_KEY_VERSIONS persists
   - You can manually increment it or let the system handle it

3. **Version Usage**:
   - Version is retrieved at the start of request handling
   - Used to generate CDN URLs with `v=X` parameter
   - Ensures CDN cache busting when version changes

## Benefits of Manual Version Control

- **No version inflation**: Versions only change when you want them to
- **Predictable behavior**: Cache misses don't automatically increment versions
- **Better control**: You decide when to invalidate caches
- **Cleaner version history**: Version numbers reflect actual invalidation events

## Manual Version Management

To manually manage versions:

1. **Clear cache entries**:
```bash
# Clear video cache entries
cf kv list --namespace VIDEO_TRANSFORMATIONS_CACHE --json | jq -r '.[].name' | xargs -I {} cf kv delete --namespace VIDEO_TRANSFORMATIONS_CACHE "{}"
```

2. **Increment version** (optional):
```bash
# Get current version
cf kv get --namespace VIDEO_CACHE_KEY_VERSIONS "version-video-videos/example.mp4-derivative-desktop"

# Set new version
cf kv put --namespace VIDEO_CACHE_KEY_VERSIONS "version-video-videos/example.mp4-derivative-desktop" '{"version":2,"createdAt":1234567890,"updatedAt":1234567890}' --metadata '{"version":2,"createdAt":1234567890,"updatedAt":1234567890}'
```

3. **Clear version tracking** (to reset to version 1):
```bash
cf kv delete --namespace VIDEO_CACHE_KEY_VERSIONS "version-video-videos/example.mp4-derivative-desktop"
```

## How It Works

- When you delete cache entries but keep the version, the next request will use the existing version number
- When you delete both cache entries and version tracking, the next request will start fresh with version 1
- The version in VIDEO_CACHE_KEY_VERSIONS is stored in the metadata, not the value