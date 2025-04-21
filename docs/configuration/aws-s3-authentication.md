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
- For short expiration times, ensure that server clock synchronization is accurate