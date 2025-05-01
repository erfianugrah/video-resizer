# TTL Configuration Guide

This document explains the changes made to the TTL (Time-To-Live) configuration system to make it more intuitive and eliminate redundancy between path patterns and cache profiles.

## Current Issues with TTL Configuration

The original TTL configuration system had multiple, sometimes conflicting sources of truth:

1. **Path Patterns TTLs**: Configured in `video.pathPatterns[].ttl`
2. **Cache Profiles TTLs**: Configured in `cache.profiles[].ttl`
3. **Global TTLs**: Configured in `cache.ttl`

This caused confusion because:
- A request could match both a path pattern and a cache profile
- The cache profile's TTL would take precedence over the path pattern's TTL
- There was no clear indication which TTL source was being used

## Solution Options

We've implemented two solutions to address these issues:

### Option 1: Prioritize Path Pattern TTLs

This option preserves the existing configuration structure but modifies the TTL determination logic to prioritize path pattern TTLs over cache profile TTLs.

#### Implementation:
- The `determineTTL` function in `kvCacheUtils.ts` has been updated to:
  1. First check for a matching path pattern and use its TTL if found
  2. Only if no path pattern matches, check for a matching cache profile
  3. Fall back to global TTL settings if neither is found
  4. Use hardcoded defaults as a last resort

#### Benefits:
- Minimal changes to existing configuration structure
- Backward compatible with existing configuration files
- Clear logging of which TTL source is being used
- Intuitive behavior: Path pattern TTLs are respected

### Option 2: Eliminate Cache Profiles

This option simplifies the configuration structure by removing the redundant cache profiles section and consolidating all TTL configuration into path patterns.

#### Implementation:
- Created a new configuration file structure in `worker-config-no-profiles.json`
- Cache settings from profiles have been moved into the relevant path patterns
- Added a default path pattern to handle unmatched paths
- Created a streamlined `determineTTL` function in `determineTTL-no-profiles.ts`

#### Benefits:
- Single source of truth for TTL configuration
- Clear and simple configuration structure
- Elimination of redundant configuration
- Predictable behavior: path pattern TTLs are always used

## Recommended Approach

**Option 2 (Eliminating Profiles) is the recommended approach** for new deployments because it:
- Provides a cleaner, simpler configuration structure
- Eliminates confusion about TTL precedence
- Reduces configuration complexity and maintenance burden

For existing deployments, Option 1 offers a less disruptive transition path.

## Migration Guide

### Migrating to Option 1 (Prioritize Path Patterns)

1. Replace the `determineTTL` function in `kvCacheUtils.ts` with the updated version
2. No configuration changes required
3. Test to ensure TTLs are being applied as expected

### Migrating to Option 2 (Eliminate Profiles)

1. Copy the contents of `worker-config-no-profiles.json` to your `worker-config.json`
2. Import and use the new `determineTTL` function from `determineTTL-no-profiles.ts` instead of the one in `kvCacheUtils.ts`
3. Update any tests or code that relies on cache profiles
4. Test thoroughly to ensure TTLs are being applied as expected

## Verifying TTL Application

To verify that the correct TTLs are being applied:

1. Enable debug logging for cache operations
2. Look for log messages with:
   - `Using TTL from path pattern` (Option 1 and 2)
   - `Found matching cache profile for path` (Option 1 only)
   - `Using default path pattern TTL` (Option 2)
   - `Using global cache TTL settings` (Option 1 and 2)

3. Check the final TTL being applied in the response headers:
   - `Cache-Control: max-age=X` where X is the TTL in seconds
   - `X-KV-Cache-TTL: Xs` for KV cache TTL

## Best Practices

1. **Path-based Configuration**: Define TTLs based on content type and importance
   - High-traffic content: Longer TTLs (1+ days)
   - Frequently updated content: Shorter TTLs (minutes)
   - Static assets: Long TTLs (7+ days)

2. **Default TTLs**: Set reasonable defaults for unmatched content
   - Success responses: 300-3600 seconds (5-60 minutes)
   - Redirects: 300 seconds (5 minutes)
   - Client errors: 60 seconds (1 minute)
   - Server errors: 10 seconds to minimize impact of server issues

3. **Naming**: Use clear, descriptive names for path patterns
   - `videos`, `popular`, `static-assets`, etc.
   - Always include a `default` pattern as a fallback

4. **TTL Consistency**: Maintain consistent TTLs between related content
   - Same content type should have similar TTLs
   - Related content should have similar TTLs

By following these guidelines and implementing one of the provided solutions, you'll have a more intuitive and consistent TTL configuration system that's easier to maintain and reason about.