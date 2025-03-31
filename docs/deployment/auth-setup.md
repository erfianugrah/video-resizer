# Authentication Setup Guide

This guide covers the setup of the secure authentication system for the dynamic configuration API in video-resizer.

## Overview

The video-resizer uses a token-based authentication system to secure the configuration API endpoints. These tokens are stored securely as Wrangler secrets, which keeps them out of the codebase and provides environment-specific security.

## Setup Steps

Follow these steps to set up authentication for each environment:

### 1. Generate Secure Tokens

First, generate a secure random token for each environment (development, staging, production):

```bash
# Generate a secure random token
TOKEN=$(openssl rand -hex 32)
echo $TOKEN  # Copy this value for use in the next step
```

> **Security Note**: Always use a different token for each environment and keep them secure.

### 2. Set Up Wrangler Secrets

For each environment, set the `CONFIG_API_TOKEN` secret using Wrangler:

#### Development Environment
```bash
wrangler secret put CONFIG_API_TOKEN --env development
# When prompted, paste the token you generated
```

#### Staging Environment
```bash
wrangler secret put CONFIG_API_TOKEN --env staging
# When prompted, paste the token you generated (a different one from development)
```

#### Production Environment
```bash
wrangler secret put CONFIG_API_TOKEN --env production
# When prompted, paste the token you generated (a different one from staging and development)
```

### 3. Verify Secret Configuration

You can verify that secrets have been properly set up by listing them:

```bash
# List secrets for development environment
wrangler secret list --env development

# List secrets for staging environment
wrangler secret list --env staging

# List secrets for production environment
wrangler secret list --env production
```

The output should include `CONFIG_API_TOKEN` for each environment (the actual token value will not be displayed).

## Using the Authentication

Once the secrets are set up, you can use the authentication token to interact with the configuration API:

### Uploading Configuration

Use the `config-upload.js` tool with the appropriate token:

```bash
# For development environment
node tools/config-upload.js --env development --token YOUR_DEV_TOKEN

# For staging environment
node tools/config-upload.js --env staging --token YOUR_STAGING_TOKEN

# For production environment
node tools/config-upload.js --env production --token YOUR_PRODUCTION_TOKEN
```

### Direct API Access

You can also interact directly with the API using curl or other HTTP tools:

```bash
# Get current configuration
curl https://your-worker-url.workers.dev/admin/config \
  -H "Authorization: Bearer YOUR_TOKEN"

# Upload new configuration
curl https://your-worker-url.workers.dev/admin/config \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d @config/worker-config.json
```

## Security Best Practices

1. **Token Rotation**: Periodically rotate your tokens (ideally every 30-90 days) to minimize risk
2. **Least Privilege**: Only share tokens with team members who need to manage configuration
3. **Secure Storage**: Store your tokens securely (password managers, secure notes, etc.)
4. **Environment Isolation**: Never use the same token across different environments
5. **Audit**: Keep track of when and why configuration changes are made

## Troubleshooting

If authentication fails, check the following:

1. Ensure the token is correctly set as a Wrangler secret
2. Verify you're using the correct token for the environment
3. Check that the `Authorization` header is properly formatted (`Bearer YOUR_TOKEN`)
4. Confirm that the worker has been deployed since setting the secret

## Reference

For more details on the dynamic configuration system, see [Dynamic Configuration](../configuration/dynamic-configuration.md).