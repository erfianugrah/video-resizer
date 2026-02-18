# Video Resizer Troubleshooting Guide

_Last Updated: February 18, 2026_

This guide helps diagnose and resolve common issues with the Video Resizer. It covers error identification, debugging tools, and recommended solutions for specific problems.

## Table of Contents

- [Introduction](#introduction)
- [Debugging Tools](#debugging-tools)
- [Common Error Types](#common-error-types)
  - [Client Errors (400 Range)](#client-errors-400-range)
  - [Server Errors (500 Range)](#server-errors-500-range)
  - [Not Found Errors (404)](#not-found-errors-404)
- [Common Issues and Solutions](#common-issues-and-solutions)
  - [Transformation Failures](#transformation-failures)
  - [Caching Issues](#caching-issues)
  - [Origin Access Problems](#origin-access-problems)
  - [Performance Problems](#performance-problems)
  - [Configuration Errors](#configuration-errors)
- [Advanced Troubleshooting](#advanced-troubleshooting)
  - [Examining Worker Logs](#examining-worker-logs)
  - [Performance Analysis](#performance-analysis)
  - [Error Analysis](#error-analysis)
- [Frequently Asked Questions](#frequently-asked-questions)

## Introduction

The Video Resizer implements comprehensive error handling and fallback mechanisms. This guide will help you understand the errors you might encounter and how to resolve them.

## Debugging Tools

### Debug View Mode

Add `?debug=view` to any video URL to access the debug UI:

```
https://videos.example.com/sample.mp4?debug=view
```

This provides:

- Request information
- Applied configuration
- Path pattern matching
- Cache status
- Transformation options
- Performance metrics
- Error details (if any)

### Debug Headers

When debug mode is enabled, responses include detailed headers:

- `X-Error-Type`: Type of error that occurred
- `X-Error-Status`: HTTP status code for the error
- `X-Fallback-Applied`: "true" if a fallback was used
- `X-Fallback-Reason`: Reason for fallback
- `X-Pattern-Matched`: Name of matched path pattern
- `X-Cache-Status`: Cache status (HIT, MISS, BYPASS)
- `X-Cache-Key`: The cache key used
- `X-Performance-Total`: Total processing time in ms

### Command Line Tools

Use the configuration debug tool:

```bash
# Check all configuration
node tools/config-debug.js --check-all

# Test URL matching
node tools/config-debug.js --test-url https://videos.example.com/sample.mp4

# Test authentication
node tools/config-debug.js --test-auth <pattern-name>
```

## Common Error Types

### Client Errors (400 Range)

#### INVALID_PARAMETERS

**Symptoms**: 400 Bad Request, error message about invalid parameters

**Common Causes**:

- Missing required parameters
- Invalid parameter values
- Malformed URL

**Solutions**:

1. Check URL structure and parameters
2. Ensure all parameters have valid values
3. Verify query string format

#### INVALID_MODE

**Symptoms**: 400 Bad Request, error message about invalid mode

**Common Causes**:

- Mode parameter not one of: 'video', 'frame', 'spritesheet', 'audio'
- Mode parameter missing when required

**Solutions**:

1. Use only supported modes: 'video', 'frame', 'spritesheet', 'audio'
2. Check for typos in the mode parameter

#### INVALID_DIMENSIONS

**Symptoms**: 400 Bad Request, error about invalid dimensions

**Common Causes**:

- Width or height not numeric
- Dimensions outside allowed range (typically 10-2000 pixels)
- Zero or negative dimensions

**Solutions**:

1. Use numeric values for width and height
2. Keep dimensions within the allowed range
3. Use derivatives instead of specific dimensions for common cases

#### PATTERN_NOT_FOUND

**Symptoms**: 400 Bad Request, error about no matching pattern

**Common Causes**:

- URL path structure doesn't match any configured patterns
- Missing pattern configuration
- Typo in URL path

**Solutions**:

1. Verify the URL matches a configured path pattern
2. Check path pattern configuration
3. Use the debug tool to test URL matching:
   ```bash
   node tools/config-debug.js --test-url https://videos.example.com/your/path.mp4
   ```

### Server Errors (500 Range)

#### TRANSFORMATION_ERROR

**Symptoms**: 500 Internal Server Error, error about transformation failure

**Common Causes**:

- Video format not supported
- Corrupted video file
- Transformation service temporary issue
- Resource limits exceeded

**Solutions**:

1. Verify video is in a supported format (MP4 with H.264 encoding)
2. Check file integrity
3. Try with smaller dimensions or lower quality
4. Check Cloudflare status for Media Transformation API issues

#### FILE_SIZE_LIMIT_EXCEEDED

**Symptoms**: 500 Server Error or automatic fallback to original, `X-File-Size-Error: true` header

**Common Causes**:

- Video file too large for processing
- Configuration limits exceeded

**Solutions**:

1. The system should automatically fallback to serving the original
2. Use smaller video files if transformation is required
3. Configure higher limits if supported by your Cloudflare plan

#### FETCH_ERROR

**Symptoms**: 500 Server Error, error about failing to fetch content

**Common Causes**:

- Origin server unreachable
- Authentication failure
- Rate limit exceeded
- Network issues

**Solutions**:

1. Verify origin server is accessible
2. Check authentication configuration
3. Verify storage configuration:
   ```bash
   node tools/config-debug.js --check-storage
   ```
4. Check logs for specific fetch errors

#### CONFIGURATION_ERROR

**Symptoms**: 500 Server Error, error about configuration issues

**Common Causes**:

- Missing required configuration
- Invalid configuration format
- Configuration conflicts

**Solutions**:

1. Validate configuration with the debug tool:
   ```bash
   node tools/config-debug.js --validate ./config/your-config.json
   ```
2. Check for missing required settings
3. Ensure KV bindings are correctly set in wrangler.jsonc

### Not Found Errors (404)

#### NOT_FOUND

**Symptoms**: 404 Not Found response

**Common Causes**:

- Video doesn't exist at the origin
- Incorrect origin URL configuration
- Authentication issue preventing access

**Solutions**:

1. Verify the video exists at the origin
2. Check origin URL configuration
3. Test direct access to the origin
4. Verify authentication settings

## Common Issues and Solutions

### Transformation Failures

#### Issue: Video Won't Transform at All

**Symptoms**: Original video served instead of transformed version

**Troubleshooting Steps**:

1. Check for `X-Fallback-Applied: true` header
2. Look for `X-Fallback-Reason` to identify the cause
3. Verify video format is supported (MP4/H.264 recommended)
4. Try with smaller dimensions or shorter duration

**Solutions**:

1. Convert video to MP4 with H.264 encoding
2. Reduce video dimensions or quality
3. Check if file size exceeds limits

#### Issue: Quality Issues After Transformation

**Symptoms**: Pixelation, artifacts, or poor quality

**Troubleshooting Steps**:

1. Check the quality parameter value
2. Verify dimensions are appropriate for content
3. Check if the original video is high quality

**Solutions**:

1. Use higher quality settings: `?quality=high`
2. Use lower compression: `?compression=low`
3. Try maintaining aspect ratio with appropriate dimensions
4. Use a derivative preset for consistent quality

#### Issue: Inconsistent Transformation Results

**Symptoms**: Different results for seemingly identical requests

**Troubleshooting Steps**:

1. Enable debug mode to see exact parameters being applied
2. Check for cache hits/misses
3. Look for client hints or device detection affecting results

**Solutions**:

1. Use explicit parameters instead of relying on auto-detection
2. Disable responsive behavior if needed
3. Clear cache if testing changes:
   ```bash
   node tools/config-upload.js --env production --increment-version
   ```

### Caching Issues

#### Issue: Content Not Cached

**Symptoms**: `CF-Cache-Status: MISS` on repeated requests

**Troubleshooting Steps**:

1. Check cache configuration for the path pattern
2. Look for `Cache-Control: no-store` or similar cache-preventing headers
3. Verify the `useTtlByStatus` setting is enabled

**Solutions**:

1. Ensure cache configuration is correctly set:
   ```bash
   node tools/config-debug.js --check-cache
   ```
2. Verify TTL settings are non-zero for successful responses
3. Check cache profile RegEx is matching your URL pattern

#### Issue: Cache Not Invalidating

**Symptoms**: Old content still served after updates

**Troubleshooting Steps**:

1. Check the cache versioning system
2. Verify version propagation

**Solutions**:

1. Increment the cache version:
   ```bash
   node tools/config-upload.js --env production --increment-version
   ```
2. Use specific path invalidation if available
3. Add a cache bypass parameter for testing: `?bypass=cache`

#### Issue: Different Devices Get Different Cache Results

**Symptoms**: Mobile and desktop get different results for same URL

**Troubleshooting Steps**:

1. Check if client hints are influencing cache keys
2. Look for `Vary` headers in the response

**Solutions**:

1. Disable client hints if consistent caching is required
2. Use explicit device targeting instead of auto-detection
3. Create separate cache profiles for different device types

### Origin Access Problems

#### Issue: S3 Authentication Failures

**Symptoms**: 403 Forbidden errors from origin, authentication failures

**Troubleshooting Steps**:

1. Check authentication configuration
2. Verify environment variables for credentials
3. Test direct S3 access

**Solutions**:

1. Ensure AWS credentials are correctly set in environment vars
2. Verify region is correctly specified
3. Check bucket permissions
4. Test authentication:
   ```bash
   node tools/config-debug.js --test-auth <pattern-name>
   ```

#### Issue: Origin Connection Timeouts

**Symptoms**: 504 Gateway Timeout, origin fetch errors

**Troubleshooting Steps**:

1. Check origin server status
2. Verify network connectivity
3. Look for rate limiting

**Solutions**:

1. Ensure origin server is operational
2. Check for networking issues between Cloudflare and origin
3. Consider using Cloudflare R2 for better integration
4. Implement a fallback origin

### Performance Problems

#### Issue: Slow Transformation Times

**Symptoms**: High latency, slow video loading

**Troubleshooting Steps**:

1. Use debug mode to see performance metrics
2. Check origin fetch time vs. transformation time
3. Look for caching issues

**Solutions**:

1. Optimize video source files
2. Use appropriate dimensions and quality
3. Implement aggressive caching for frequently accessed videos
4. Use derivative presets instead of custom dimensions
5. Consider using shorter duration if only previews are needed

#### Issue: Cold Start Latency

**Symptoms**: First request after deployment is very slow

**Troubleshooting Steps**:

1. Check initialization timing in debug view
2. Look for complex configuration loading

**Solutions**:

1. Use scheduled pings to keep workers warm
2. Simplify initialization process
3. Ensure KV reads are optimized

### Configuration Errors

#### Issue: Configuration Not Applied

**Symptoms**: Default settings used instead of custom configuration

**Troubleshooting Steps**:

1. Check KV namespace bindings
2. Verify configuration upload
3. Look for configuration loading errors in logs

**Solutions**:

1. Verify KV namespace is correctly bound in wrangler.jsonc
2. Ensure configuration is uploaded to the correct environment:
   ```bash
   node tools/config-upload.js --env production --view
   ```
3. Check for validation errors in configuration

#### Issue: Environment Variables Not Available

**Symptoms**: Configuration using environment variables fails

**Troubleshooting Steps**:

1. Check wrangler.jsonc env section
2. Verify environment-specific deployment

**Solutions**:

1. Ensure variables are defined in correct environment section
2. Deploy to specific environment:
   ```bash
   wrangler deploy --env production
   ```
3. Use the debug tool to check environment variables:
   ```bash
   node tools/config-debug.js --check-env-vars
   ```

### Cloudflare Transformation Error Codes

If you see an `X-CF-Error-Code` header in the response, it indicates a Cloudflare Media Transformation error:

| Code | Meaning                     | Action                                      |
| ---- | --------------------------- | ------------------------------------------- |
| 9401 | Input video too large       | Reduce source video size                    |
| 9402 | Could not fetch input video | Check source URL accessibility              |
| 9403 | Input duration too long     | Use shorter video or add duration parameter |
| 9406 | Invalid input video         | Verify video format and codec               |
| 9407 | Input video too wide/tall   | Reduce source video dimensions              |
| 9409 | Request timeout             | Retry; consider smaller transformation      |
| 9413 | Input too large (POST body) | Reduce input size                           |
| 9415 | Unsupported media type      | Use supported video format (MP4, WebM)      |
| 9429 | Rate limited                | Back off and retry                          |
| 9500 | Internal CF error           | Retry later                                 |
| 9503 | Service unavailable         | Retry later                                 |
| 9523 | Origin unreachable          | Check origin server availability            |

These codes are extracted from the `Cf-Resized` response header and are used internally for error classification and retry decisions.

## Advanced Troubleshooting

### Examining Worker Logs

Access logs to diagnose issues:

```bash
# View recent logs
wrangler tail

# Filter logs for errors
wrangler tail --filter "error"

# Focus on specific request ID
wrangler tail --filter "requestId: YOUR-REQUEST-ID"
```

Look for:

- Error messages and stack traces
- Request and response information
- Breadcrumb trails showing processing steps
- Performance metrics
- Cache status information

### Performance Analysis

Use debug view to analyze performance:

1. Add `?debug=view` to any URL
2. Look at the "Performance" section
3. Check "Timeline" for bottlenecks
4. Look for:
   - Origin fetch time
   - Transformation time
   - Cache lookup time
   - Overall response time

### Error Analysis

For detailed error analysis:

1. Capture error information from debug view
2. Check error type and status code
3. Look for original error details
4. Check if fallbacks were applied
5. Review breadcrumb trail for context

## Frequently Asked Questions

### Why are my videos not transforming?

The most common reasons are:

- Unsupported video format (use MP4 with H.264)
- File too large (check for X-File-Size-Error header)
- Invalid transformation parameters
- Origin access issues

### How can I tell if caching is working?

Look for these headers:

- `CF-Cache-Status: HIT` means the cache is working
- `X-Cache-Key` shows the cache key used
- `Age` header indicates time in cache

### Why am I getting different results on mobile vs desktop?

The system uses client hints to detect devices and can adjust:

- Quality based on network conditions
- Dimensions based on screen size
- Format based on browser support

To get consistent results, specify explicit parameters rather than relying on auto-detection.

### How do I update my configuration?

Use the config-upload.js tool:

```bash
# Upload new configuration
node tools/config-upload.js --env production --config ./config/your-config.json
```

### How do I completely clear the cache?

Increment the cache version:

```bash
node tools/config-upload.js --env production --increment-version
```

This will invalidate all cached content without purging individual URLs.

### Why am I getting 403 Forbidden errors from origin?

Check:

- Authentication configuration
- AWS/S3 credentials if using those
- Bucket/origin permissions
- Token expiration if using token authentication

### What should I do if I see high error rates?

1. Enable detailed logging: set LOG_LEVEL to "debug"
2. Monitor the logs: `wrangler tail`
3. Look for patterns in errors
4. Check Cloudflare status for Media Transformation API issues
5. Implement more aggressive fallback strategies in configuration

---

If you encounter issues not covered in this guide, check the [Error Handling Documentation](../error-handling/implementation.md) for more detailed information on how errors are processed.
