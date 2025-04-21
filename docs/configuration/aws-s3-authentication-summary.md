# AWS S3 Authentication Implementation Summary

## Overview of Changes

We have implemented support for two different methods of AWS S3 authentication in the video-resizer service:

1. **Header-based authentication** (using Cloudflare Origin Authentication)
2. **Presigned URL authentication** (query parameter-based signing)

These changes allow more flexible deployment scenarios when accessing video content stored in AWS S3 buckets.

## Key Files Modified

1. **Configuration Schema (`storageConfig.ts`)**
   - Added new authentication type `aws-s3-presigned-url` to the enum
   - Added new configuration parameters `expiresInSeconds` and `sessionTokenVar`

2. **Storage Service Implementation (`videoStorageService.ts`)**
   - Updated the `AuthConfig` interface to support new parameters
   - Added implementation for presigned URL generation in both remote and fallback URL fetching
   - Maintained backward compatibility with existing header-based authentication

3. **Type Definitions (`aws4fetch.d.ts`)**
   - Created custom type definitions for the aws4fetch library
   - Added support for both header-based and query parameter-based authentication options

4. **Tests (`videoStorageService.spec.ts`)**
   - Added comprehensive tests for both authentication methods
   - Created mocks to simulate AWS signing behavior

## Implementation Details

### Configuration Schema Changes

We extended the authentication configuration schema to support both authentication methods with appropriate parameters:

```typescript
export const AuthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(['aws-s3', 'aws-s3-presigned-url', 'bearer', 'header', 'query']).default('header'),
  accessKeyVar: z.string().optional(),
  secretKeyVar: z.string().optional(),
  region: z.string().optional(),
  service: z.string().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
  sessionTokenVar: z.string().optional(),
  headers: z.record(z.string()).optional(),
});
```

### Storage Service Implementation

The implementation handles both authentication methods:

- For `aws-s3`, it signs requests with AWS Signature V4 headers (unchanged behavior)
- For `aws-s3-presigned-url`, it generates a signed URL with query parameters

Presigned URLs have these advantages:
- No need for Origin Authentication in Cloudflare
- More flexible deployment options
- Support for temporary credentials through session tokens

### AWS4Fetch Library Integration

We integrated with the aws4fetch library by:
1. Creating proper TypeScript type definitions
2. Supporting both signing methods through the library's options
3. Handling session tokens for temporary credentials

## Usage Examples

### Header-Based Authentication (with Cloudflare Origin Auth)

```json
{
  "storage": {
    "remoteUrl": "https://your-bucket.s3.amazonaws.com",
    "remoteAuth": {
      "enabled": true, 
      "type": "aws-s3",
      "accessKeyVar": "AWS_ACCESS_KEY_ID",
      "secretKeyVar": "AWS_SECRET_ACCESS_KEY",
      "region": "us-east-1"
    },
    "auth": {
      "useOriginAuth": true
    }
  }
}
```

### Presigned URL Authentication

```json
{
  "storage": {
    "fallbackUrl": "https://your-bucket.s3.amazonaws.com",
    "fallbackAuth": {
      "enabled": true,
      "type": "aws-s3-presigned-url",
      "accessKeyVar": "AWS_ACCESS_KEY_ID",
      "secretKeyVar": "AWS_SECRET_ACCESS_KEY",
      "region": "us-east-1",
      "expiresInSeconds": 900
    }
  }
}
```

## Testing

The implementation includes comprehensive tests that verify:
1. Header-based authentication adds the correct headers
2. Presigned URL authentication generates URLs with the required AWS signature parameters
3. Both methods work with remote and fallback storage sources

## Documentation

Detailed documentation has been added to explain both authentication methods, their configuration parameters, and usage examples. See `docs/configuration/aws-s3-authentication.md` for complete details.