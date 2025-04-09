# Video Resizer Tools

This directory contains utility tools for the video-resizer project.

## Configuration Upload Tool

The `config-upload.js` script is used to manage and upload dynamic configuration to a deployed video-resizer worker without requiring redeployment. This tool has been enhanced with robust validation, secure token handling, partial configuration updates, and comprehensive error handling.

### Prerequisites

Before using this tool, make sure you have:

1. Set up the authentication tokens using Wrangler secrets (see [Auth Setup Guide](../docs/deployment/auth-setup.md))
2. Node.js 18+ installed
3. Required dependencies installed: `node-fetch` and `commander`

```bash
# Install dependencies if needed
npm install node-fetch commander
```

### Usage

```bash
node tools/config-upload.js [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-u, --url <url>` | Worker URL (overrides environment URL) |
| `-c, --config <path>` | Path to configuration file (default: `./config/worker-config.json`) |
| `-t, --token <token>` | Authentication token (required unless set as environment variable) |
| `-e, --env <environment>` | Environment to target (`development`, `staging`, `production`) |
| `--section <sections>` | Update only specific sections (comma-separated) |
| `--view` | View current configuration without uploading |
| `--backup` | Create backup of current configuration |
| `--dry-run` | Validate configuration without uploading |
| `--no-confirmation` | Skip confirmation prompts |
| `-v, --verbose` | Show verbose output |
| `-h, --help` | Display help information |

### Environment Variables

- `VIDEO_RESIZER_CONFIG_TOKEN`: Authentication token (alternative to --token)

### Key Features

#### 1. Secure Token Handling

Tokens can be provided in two ways, in order of precedence:
1. Command-line option: `--token YOUR_TOKEN`
2. Environment variable: `VIDEO_RESIZER_CONFIG_TOKEN=YOUR_TOKEN`

The tool masks token display in logs to prevent accidental exposure:
```
🔑 Using token: abcd...wxyz
```

#### 2. Targeted Configuration Updates

Update specific sections of configuration without modifying others:

```bash
# Update only debug and cache sections
node tools/config-upload.js --env production --section debug,cache
```

This is ideal for making targeted changes (like disabling debug mode) without affecting other parts of the configuration.

#### 3. Comprehensive Validation

The tool performs extensive validation of your configuration to prevent common issues:

- Validates all required sections
- Checks data types and values for each configuration option
- Verifies enums (like cache methods and log levels)
- Validates nested structures like path patterns and derivatives

#### 4. Configuration Diffing

When updating configuration, the tool shows differences between current and new values:

```
📊 Key differences:
• Debug mode: true → false
• Cache debug: true → false
• Storage priority changed: ["remote","fallback"] → ["r2","remote","fallback"]
• R2 enabled: false → true
```

This helps you understand exactly what's changing before you apply it.

#### 5. Backup Management

Create automatic backups before making changes:

```bash
node tools/config-upload.js --env production --backup
```

All backups are stored in `./config/backups/` with timestamped filenames.

#### 6. Safe Production Deployments

The tool includes extra safeguards for production environments:

- Confirmation prompts before uploading to production or staging
- Detailed error handling with specific error messages
- Request timeout handling (30 seconds max)

### Examples

#### View Current Configuration

```bash
# View configuration in production
node tools/config-upload.js --env production --view --token YOUR_PROD_TOKEN
```

#### Create Configuration Backup

```bash
# Backup production configuration
node tools/config-upload.js --env production --backup --token YOUR_PROD_TOKEN
```

Backups are stored in the `./config/backups/` directory with timestamps in the filename.

#### Update Specific Configuration Sections

```bash
# Update only debug and cache sections in production (for fixing debug mode in production)
node tools/config-upload.js --env production --section debug,cache --token YOUR_PROD_TOKEN
```

This is particularly useful for disabling debug mode or changing cache settings without affecting other configuration.

#### Update Storage Configuration

```bash
# Update only storage configuration (for R2 integration)
node tools/config-upload.js --env production --section storage --token YOUR_PROD_TOKEN
```

#### Deploy Configuration with Environment Variables

```bash
# More secure approach using environment variables
VIDEO_RESIZER_CONFIG_TOKEN=your_token node tools/config-upload.js --env production
```

#### Upload to Different Environments

```bash
# Development environment
node tools/config-upload.js --env development --token YOUR_DEV_TOKEN

# Staging environment
node tools/config-upload.js --env staging --token YOUR_STAGING_TOKEN

# Production environment
node tools/config-upload.js --env production --token YOUR_PROD_TOKEN
```

#### Use with Custom Configuration Path

```bash
# Using a different configuration file
node tools/config-upload.js --env staging --config ./config/staging-config.json --token YOUR_TOKEN
```

#### Validate Without Uploading

```bash
# Validate configuration without uploading
node tools/config-upload.js --dry-run --config ./config/worker-config.json
```

#### Backup, Update and View Changes in One Flow

```bash
# First backup the current config
node tools/config-upload.js --env production --backup --token YOUR_PROD_TOKEN

# Then update specific sections
node tools/config-upload.js --env production --section debug,cache --token YOUR_PROD_TOKEN

# Finally, view the updated configuration
node tools/config-upload.js --env production --view --token YOUR_PROD_TOKEN
```

### Preconfigured Environments

The tool has the following environments preconfigured:

* `development`: https://video-resizer-development.anugrah.workers.dev
* `staging`: https://staging-video-resizer.workers.dev
* `production`: https://cdn.erfi.dev

You can also specify a custom URL with the `--url` option.

### Security Best Practices

1. **Token Management**:
   - Use environment variables instead of command-line arguments where possible
   - Create unique tokens for each environment (development, staging, production)
   - Rotate tokens periodically for enhanced security

2. **Safe Deployment Workflow**:
   - Always backup before making changes: `--backup`
   - Use `--dry-run` to validate changes before applying
   - Update production in stages, starting with non-critical sections

3. **Permission Controls**:
   - Limit access to production tokens to senior team members
   - Use read-only tokens for viewing configuration
   - Log all configuration changes in a separate audit system

4. **Safe Practices**:
   - Never commit tokens to the repository
   - Use `.env` files for local development (and include in `.gitignore`)
   - Always verify changes after deployment

### Troubleshooting

#### Connection Issues
- Verify the URL is correct and the worker is running
- Check network connectivity to the worker URL
- Ensure your authentication token is valid and has not expired

#### Configuration Validation Errors
- The tool provides specific validation errors
- Fix each error in your configuration file
- Use `--verbose` for more detailed error information

#### Authorization Problems
- Verify your token has the correct permissions
- Check the token format matches what the server expects
- Try regenerating the token if necessary

### Additional Documentation

For more information, see:

* [Dynamic Configuration](../docs/configuration/dynamic-configuration.md)
* [Auth Setup Guide](../docs/deployment/auth-setup.md)
* [Configuration Reference](../docs/configuration/CONFIGURATION_REFERENCE.md)