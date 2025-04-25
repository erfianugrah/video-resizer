# Configuration Synchronization Fix

This document explains the issues and fixes related to video configuration synchronization in the video-resizer project.

## Problem

The video-resizer was experiencing an issue where path patterns weren't being correctly applied to video URLs. Specifically, requests to `/rocky.mp4` weren't being properly transformed, with logs showing "Skipping path transformation" despite having a pattern that should match this path.

### Root Cause

The root cause was identified as a configuration synchronization problem:

1. The VideoConfigurationManager uses a singleton pattern and loads configuration only once at startup
2. When configuration is updated via the Config API and stored in KV, the in-memory singleton instance remained stale
3. When a request came in, it used the stale (or empty) path patterns from memory, not the updated ones in KV
4. In particular, we found that the "active_version" key in KV was not being properly set or retrieved
5. Additionally, we discovered that sometimes the active_version value itself was not valid JSON, causing parsing errors

## Solution

We implemented a comprehensive, fault-tolerant solution with multiple fallback strategies:

1. **Robust Configuration Recovery System**
   - Added multi-stage recovery mechanism to handle any invalid configuration format
   - Enhanced direct `videoConfig` retrieval as primary approach (most reliable)
   - Added fallback to active version if direct retrieval fails
   - Implemented historical version discovery when active version is missing
   - Added safety mechanism to store valid configurations for future use
   - Created comprehensive logging to track configuration loading process

2. **Enhanced JSON Parsing**
   - Added robust JSON parsing that can handle various malformed inputs
   - Implemented type checking to handle non-JSON active_version values
   - Added smart parsing to extract valid configuration from multiple formats
   - Built handlers for various configuration structures (videoConfig, modules.video, etc.)
   - Added default path patterns as ultimate fallback

3. **Improved ConfigAPI Service**
   - Added proper active_version handling to ensure it's always a valid ID
   - Added verification of version IDs before activating them
   - Ensured proper storage of configuration data for faster retrieval
   - Fixed issues with version activation and synchronization
   
4. **Automatic Refresh for Video Requests**
   - Modified index.ts to refresh configuration for each video request
   - Added refresh in enhancedVideoHandler for double safety
   - Added direct videoConfig storage in ConfigApiService
   - Added feature flag to enable enhanced path pattern handling
   - Created automatic pattern injection when none are available

5. **Robust Configuration Manager**
   - Created RobustVideoConfigurationManager with better error handling
   - Added ensureDefaultPathPatterns to guarantee patterns are available
   - Used synchronous getPathPatterns method to avoid async issues

6. **Enhanced Path Utilities**
   - Implemented better pattern matching with detailed debugging
   - Added proper logging through the application's logging system

7. **Configuration API Integration**
   - Modified activateVersion to trigger refreshing the VideoConfigurationManager
   - Added better error handling and logging

## Testing the Fix

To test and verify that the fix works correctly, we've created two test scripts:

### 1. Test Video Pattern Matching

The `scripts/test-video-patterns.js` script tests the video path transformation:

```bash
node scripts/test-video-patterns.js
```

This script:
- Sets up a test configuration via the Config API
- Makes requests to `/rocky.mp4` with different parameters
- Tests both normal and enhanced handlers
- Reports detailed diagnostics

### 2. Test Configuration Refresh

The `scripts/test-refresh-from-api.js` script directly tests the refreshFromApi functionality:

```bash
node scripts/test-refresh-from-api.js
```

This script:
- Makes a request to the `/test-refresh` endpoint
- Verifies that refreshFromApi loads the latest configuration
- Reports the before and after state of path patterns

### Feature Flag Testing

You can also test the enhanced handler by adding the `useEnhanced=true` query parameter:

```
/rocky.mp4?useEnhanced=true
```

This activates the enhanced handler with better debugging and pattern matching.

### Debug Mode

For detailed diagnostics, add the `debug=true` parameter:

```
/rocky.mp4?debug=true
```

This will return additional debug headers and logging.

## Expected Behavior

After applying the fix:

1. New configurations added via the Config API should be immediately available
2. Video requests should properly match the configured path patterns
3. The "No active configuration version found" warning should no longer appear
4. If no active version exists, the system will find and use the latest config
5. If no patterns are found, default patterns will be applied

## Default Path Patterns

As a fallback measure, the system now includes default path patterns that are fully schema-compliant:

```javascript
[
  {
    name: 'standard',
    matcher: '^/(.*\\.mp4)',
    transform: '/cdn-cgi/transform/video/$1',
    processPath: true,
    baseUrl: null,
    originUrl: null,
    useTtlByStatus: true,
    quality: 'auto',
    ttl: {
      ok: 86400,           // 24 hours 
      redirects: 3600,      // 1 hour
      clientError: 60,      // 1 minute
      serverError: 10       // 10 seconds
    },
    transformationOverrides: {
      quality: 'auto',
      compression: 'auto'
    }
  },
  {
    name: 'webm',
    matcher: '^/(.*\\.webm)',
    transform: '/cdn-cgi/transform/video/$1',
    processPath: true,
    baseUrl: null,
    originUrl: null,
    useTtlByStatus: true,
    quality: 'auto',
    ttl: {
      ok: 86400,
      redirects: 3600,
      clientError: 60,
      serverError: 10
    },
    transformationOverrides: {
      quality: 'auto'
    }
  },
  {
    name: 'mov',
    matcher: '^/(.*\\.mov)',
    transform: '/cdn-cgi/transform/video/$1',
    processPath: true,
    baseUrl: null,
    originUrl: null,
    useTtlByStatus: true,
    quality: 'auto',
    ttl: {
      ok: 86400,
      redirects: 3600,
      clientError: 60,
      serverError: 10
    },
    transformationOverrides: {
      quality: 'auto',
      format: 'mp4'
    }
  }
]
```

These patterns will be used if no patterns are found in the configuration, ensuring that video transformation always works even without explicit configuration. The patterns are designed to match the expected schema format with all required fields.