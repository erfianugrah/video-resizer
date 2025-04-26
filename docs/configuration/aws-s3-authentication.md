# AWS S3 Authentication Methods

This document describes the supported authentication methods for accessing videos stored in AWS S3 buckets.

## Authentication Types

Video Resizer supports two methods for authenticating with AWS S3:

1. **Header-based signing** (using Cloudflare Origin Authentication)
2. **Presigned URL** (query parameter-based signing)

Each method has its advantages and is suitable for different deployment scenarios.

## Header-Based Signing (Cloudflare Origin Authentication)

Header-based signing uses AWS Signature Version 4 to sign requests with authentication headers. This requires Cloudflare Origin Authentication to be properly configured to pass the signed headers through to the S3 bucket.

### Configuration Example

```json
{
  "storage": {
    "remoteUrl": "https://your-bucket-requiring-cf-auth.s3.amazonaws.com",
    "remoteAuth": {
      "enabled": true,
      "type": "aws-s3",
      "accessKeyVar": "S3_HEADER_ACCESS_KEY",
      "secretKeyVar": "S3_HEADER_SECRET_KEY",
      "region": "us-east-1",
      "service": "s3"
    },
    "auth": {
      "useOriginAuth": true,
      "securityLevel": "strict"
    }
  }
}
```

### Key Configuration Parameters

- `type: "aws-s3"`: Specifies header-based signing
- `useOriginAuth: true`: **Required** for header-based auth to work properly
- `securityLevel`: Controls behavior when authentication fails
  - `"strict"`: Fail request if authentication fails
  - `"permissive"`: Continue without authentication if it fails

### Environment Variables

Set these environment variables in your Cloudflare Worker:

```
S3_HEADER_ACCESS_KEY = "your-aws-access-key"
S3_HEADER_SECRET_KEY = "your-aws-secret-key"
```

## Presigned URL (Query Parameter Authentication)

Presigned URL authentication generates AWS Signature Version 4 signatures as query parameters directly in the URL. This method doesn't require Cloudflare Origin Authentication and can be used in more flexible deployment scenarios.

### Configuration Example

```json
{
  "storage": {
    "fallbackUrl": "https://your-bucket-requiring-presigned.s3.amazonaws.com",
    "fallbackAuth": {
      "enabled": true,
      "type": "aws-s3-presigned-url",
      "accessKeyVar": "S3_PRESIGNED_ACCESS_KEY",
      "secretKeyVar": "S3_PRESIGNED_SECRET_KEY",
      "region": "us-west-2",
      "service": "s3",
      "expiresInSeconds": 900
    },
    "auth": {
      "useOriginAuth": false,
      "securityLevel": "strict"
    }
  }
}
```

### Key Configuration Parameters

- `type: "aws-s3-presigned-url"`: Specifies presigned URL generation
- `expiresInSeconds`: Lifespan of the presigned URL (default: 3600 seconds/1 hour)
- `sessionTokenVar`: Optional environment variable name for AWS session token
- `useOriginAuth`: Not needed for presigned URLs (can be set to false)

### Environment Variables

Set these environment variables in your Cloudflare Worker:

```
S3_PRESIGNED_ACCESS_KEY = "your-aws-access-key"
S3_PRESIGNED_SECRET_KEY = "your-aws-secret-key"
```

## Using Both Methods for Different Origins

You can use different authentication methods for different storage origins:

```json
{
  "storage": {
    "priority": ["remote", "fallback"],
    "remoteUrl": "https://primary-bucket.s3.amazonaws.com",
    "remoteAuth": {
      "enabled": true,
      "type": "aws-s3",
      "accessKeyVar": "PRIMARY_ACCESS_KEY",
      "secretKeyVar": "PRIMARY_SECRET_KEY",
      "region": "us-east-1"
    },
    "fallbackUrl": "https://backup-bucket.s3.amazonaws.com",
    "fallbackAuth": {
      "enabled": true,
      "type": "aws-s3-presigned-url",
      "accessKeyVar": "BACKUP_ACCESS_KEY",
      "secretKeyVar": "BACKUP_SECRET_KEY",
      "region": "eu-west-1",
      "expiresInSeconds": 1800
    },
    "auth": {
      "useOriginAuth": true,
      "securityLevel": "strict"
    }
  }
}
```

## Security Considerations

- Store AWS credentials as environment variables, never hardcode them
- Use IAM roles with minimal permissions
- For presigned URLs, keep the expiration time (`expiresInSeconds`) as short as practical
- Enable logging for authentication failures
- Consider using different credentials for different storage origins

## Troubleshooting

### Header-Based Authentication Issues

- Verify that Cloudflare Origin Authentication is properly configured
- Check that `useOriginAuth` is set to `true`
- Verify that the AWS region matches your S3 bucket's region
- Check the logs for authentication errors

### Presigned URL Issues

- Verify that your S3 bucket policy allows access via presigned URLs
- Check that the AWS credentials have sufficient permissions
- Verify that the URL is correctly generated (check logs)
- For short expiration times, ensure that server clock synchronization is accurate\n## Summary\n
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