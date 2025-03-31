# Dynamic Configuration System

The video-resizer worker uses a dynamic configuration system that allows you to update configuration values without redeploying the worker. This configuration is stored in a Cloudflare KV namespace and can be updated using an API endpoint.

## How It Works

1. Configuration is stored in a KV namespace called `VIDEO_CONFIGURATION_STORE`
2. The worker loads the configuration from KV at runtime
3. An API endpoint (`/admin/config`) is available for updating the configuration
4. The configuration is validated using Zod schema validation
5. Authentication is required to update the configuration using a secure token

## Configuration Schema

The configuration schema is defined in `src/services/configurationService.ts` and includes sections for:

- Video handling and derivatives
- Caching behavior
- Logging settings
- Debug options
- Storage configuration

## Setting Up Authentication with Wrangler Secrets

The configuration API is protected with a token-based authentication system using Wrangler secrets. To set up and use this:

### 1. Set up Wrangler secrets for each environment

```bash
# Generate a secure random token (you can use any secure method)
TOKEN=$(openssl rand -hex 32)

# Set the token as a secret for each environment
wrangler secret put CONFIG_API_TOKEN --env development
# Enter the secret value when prompted

wrangler secret put CONFIG_API_TOKEN --env staging
# Enter the secret value when prompted

wrangler secret put CONFIG_API_TOKEN --env production
# Enter the secret value when prompted
```

### 2. Verify the secrets are set

You can verify that the secrets are properly set using:

```bash
wrangler secret list --env development
wrangler secret list --env staging
wrangler secret list --env production
```

## Uploading Configuration

The project includes a Node.js tool for uploading configuration to the worker. This tool is located in `/tools/config-upload.js`.

### Installing Dependencies

```bash
# Navigate to the project root
cd /path/to/video-resizer

# Install dependencies if needed
npm install node-fetch commander
```

### Usage

```bash
# Basic usage
node tools/config-upload.js --env development --token YOUR_TOKEN

# With custom config file
node tools/config-upload.js --env development --token YOUR_TOKEN --config ./path/to/custom-config.json

# Dry run (validate only)
node tools/config-upload.js --env development --token YOUR_TOKEN --dry-run

# Using direct URL
node tools/config-upload.js --url https://your-worker-url.workers.dev --token YOUR_TOKEN
```

### Command Options

- `--url, -u`: Worker URL (defaults to environment URL)
- `--config, -c`: Path to config file (default: `./config/worker-config.json`)
- `--token, -t`: Authentication token (required)
- `--env, -e`: Environment (`development`, `staging`, `production`)
- `--dry-run`: Validate configuration without uploading
- `--verbose, -v`: Verbose output
- `--help, -h`: Show help

## Retrieving Current Configuration

You can retrieve the current configuration using the same authentication mechanism:

```bash
curl https://your-worker-url.workers.dev/admin/config \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Configuration Structure

The configuration file (`worker-config.json`) contains the following sections:

1. **Version Information**
   - `version`: Semantic version of the configuration
   - `lastUpdated`: ISO 8601 timestamp when the configuration was last updated

2. **Video Configuration**
   - `derivatives`: Presets for video transformations (high_quality, medium_quality, etc.)
   - `defaults`: Default values for transformation parameters
   - `validOptions`: Valid values for each parameter
   - `responsive`: Configuration for responsive video sizing
   - `pathPatterns`: URL patterns for processing different types of videos
   - `caching`: Video-specific caching behavior

3. **Cache Configuration**
   - General caching settings including TTLs and cache management options

4. **Debug Configuration**
   - Settings for debug mode and diagnostics

5. **Logging Configuration**
   - Log levels, formats, and advanced logging options

6. **Storage Configuration**
   - Sources and priorities for video storage (R2, remote URLs, etc.)
   - Authentication for storage sources

## Security Considerations

1. **Token Security**
   - Use a strong, random token
   - Store the token securely using Wrangler secrets
   - Rotate tokens periodically

2. **Access Control**
   - Limit access to the configuration API to trusted administrators
   - Consider implementing additional security measures like IP restrictions

3. **Production Changes**
   - Always test configuration changes in development/staging before applying to production
   - The upload tool requires confirmation for production updates

## Best Practices

1. **Version Control**
   - Keep your configuration files in version control
   - Document changes to configuration

2. **Testing**
   - Test configuration changes in development environment before applying to production
   - Use the `--dry-run` option to validate configuration before upload

3. **Environment-Specific Configuration**
   - Maintain separate configurations for development, staging, and production
   - Use environment variables or separate config files

4. **Monitoring**
   - Monitor the worker logs after configuration changes
   - Set up alerts for configuration-related errors

5. **Rollback Plan**
   - Keep previous versions of configuration for quick rollback
   - Document rollback procedures