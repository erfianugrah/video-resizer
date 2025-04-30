# Presigned URL Implementation Steps

## Overview

This document outlines the step-by-step implementation process for integrating AWS S3 presigned URLs with Cloudflare Media Transformation. It serves as a detailed guide for implementing, testing, and deploying the solution.

## Implementation Process

### Phase 1: Core Infrastructure

1. ✅ **Create KV Namespace for Presigned URL Caching**
   - Create KV namespace `PRESIGNED_URLS` with ID `502fa1f64a6e4e48bb7e0bcd32472ba8`
   - Update `wrangler.jsonc` with the KV namespace configuration
   - Update `EnvVariables` interface to include the new KV namespace

2. ✅ **Create Presigned URL Caching Service**
   - Implement `presignedUrlCacheService.ts` with core functions:
     - `getPresignedUrl`: Retrieve cached presigned URLs
     - `storePresignedUrl`: Store newly generated presigned URLs
     - `isUrlExpiring`: Check if a URL is close to expiration
     - `refreshPresignedUrl`: Update expiring URLs in the background

3. ✅ **Create Utilities for Presigned URL Integration**
   - Implement `presignedUrlUtils.ts` with helper functions:
     - `needsPresigning`: Determine if a URL requires presigning
     - `getOrGeneratePresignedUrl`: Get cached or generate new presigned URL
     - `encodePresignedUrl`: Format presigned URL for CDN-CGI use
     - `extractPath`: Extract relative path from full URL

### Phase 2: URL Transformation Integration

4. ✅ **Enhance URL Transformation Function**
   - Modify `pathUtils.ts` to support asynchronous URL building
   - Create synchronous and asynchronous URL building functions:
     - `buildCdnCgiMediaUrl`: Maintained for backward compatibility
     - `buildCdnCgiMediaUrlAsync`: New async version that supports presigning
   - Implement dynamic imports to avoid circular dependencies

5. ✅ **Update TransformationService**
   - Modify `TransformationService.ts` to use async URL building
   - Import `buildCdnCgiMediaUrlAsync` to support presigned URLs
   - Update URL construction in the `prepareVideoTransformation` function
   - Update IMQuery parameter handling to support presigned URLs

### Phase 3: Testing and Validation

6. ✅ **Unit Tests**
   - Create tests for presigned URL utilities (`presignedUrlUtils.spec.ts`)
   - Update path utilities tests for async URL construction
   - Test proper URL encoding and preservation of AWS signature parameters

7. ✅ **Integration Tests**
   - Create integration tests for the presigned URL flow
   - Test caching, expiration, and refresh functionality
   - Verify correct integration with URL transformation

8. ✅ **Documentation**
   - Create implementation documentation:
     - `presigned-url-cache.md`: Details the caching implementation
     - `presigned-url-transformation-integration.md`: Explains the integration architecture
     - `presigned-url-implementation-steps.md`: This implementation guide
     - `presigned-url-implementation.md`: Overall implementation summary

### Phase 4: Deployment and Monitoring

9. **Deployment**
   - Deploy the updated worker to development environment
   - Verify correct functionality with real S3 buckets
   - Monitor KV usage and performance

10. **Performance Tuning**
    - Adjust cache TTLs based on observed usage patterns
    - Fine-tune background refresh thresholds
    - Optimize AWS API call frequency

## Testing Checklist

### Unit Tests
- ✅ Verify presignedUrlUtils.ts functionality
- ✅ Confirm proper URL building with and without presigning
- ✅ Test URL encoding functions with AWS signature parameters

### Integration Tests
- ✅ Test KV caching of presigned URLs
- ✅ Verify correct URL construction with presigned content URLs
- ✅ Test background refresh for expiring URLs

### Manual Tests
- ⬜ Test with real private S3 bucket
- ⬜ Verify Media Transformation can access private content
- ⬜ Monitor AWS API usage and KV operations

## Implementation Details

### Key Files Modified

1. **New Files**
   - `/src/services/presignedUrlCacheService.ts`
   - `/src/utils/presignedUrlUtils.ts`
   - `/test/utils/presignedUrlUtils.spec.ts`
   - `/test/integration/presigned-url-integration.spec.ts`
   - Documentation files in `/docs/configuration/`

2. **Modified Files**
   - `/src/utils/pathUtils.ts`
   - `/src/services/TransformationService.ts`
   - `/src/config/environmentConfig.ts`
   - `/wrangler.jsonc`
   - `/test/utils/pathUtils.spec.ts`

### Key Function Changes

1. **buildCdnCgiMediaUrlAsync**
   ```typescript
   export async function buildCdnCgiMediaUrlAsync(
     options: TransformParams,
     originUrl: string,
     requestUrl?: string
   ): Promise<string>
   ```

2. **getOrGeneratePresignedUrl**
   ```typescript
   export const getOrGeneratePresignedUrl = tryOrNull<
     [EnvVariables, string, StorageConfig],
     string
   >(async function(env, url, storageConfig): Promise<string>)
   ```

3. **TransformationService URL Construction**
   ```typescript
   // Import path utils module to get buildCdnCgiMediaUrlAsync
   const { buildCdnCgiMediaUrlAsync } = await import('../utils/pathUtils');
   
   // Build the CDN-CGI media URL asynchronously
   let cdnCgiUrl = await buildCdnCgiMediaUrlAsync(cdnParams, videoUrl, url.toString());
   ```

## Deployment Procedure

1. **Pre-Deployment**
   - Run all unit and integration tests
   - Verify KV namespace is properly configured
   - Ensure AWS credentials are available in environment

2. **Deployment Steps**
   - Deploy using `wrangler deploy`
   - Verify worker is using the correct KV namespace
   - Test with synthetic requests to confirm functionality

3. **Post-Deployment**
   - Monitor KV operations and cache hit ratio
   - Check for errors in S3 access logs
   - Verify AWS API usage remains within limits

## Troubleshooting Guide

### Common Issues

1. **Authentication Failures**
   - Verify AWS credentials are correctly set in environment variables
   - Check that S3 bucket policy allows the action being performed
   - Ensure the presigned URL hasn't expired before use

2. **URL Encoding Issues**
   - Verify the presigned URL is properly encoded within the CDN-CGI URL
   - Check for double-encoding of parameters
   - Ensure special characters are handled correctly

3. **KV Access Issues**
   - Confirm KV namespace binding is correctly configured
   - Check for KV rate limiting or quota issues
   - Verify KV operations are completing successfully

### Monitoring Recommendations

1. **Performance Metrics**
   - Track presigned URL generation time
   - Monitor cache hit rates
   - Measure end-to-end request latency

2. **Error Tracking**
   - Log all AWS signature failures
   - Monitor KV operation failures
   - Track URL construction errors

3. **Usage Statistics**
   - Monitor AWS API call frequency
   - Track KV storage utilization
   - Measure cache entry expiration patterns