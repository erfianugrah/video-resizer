# Configuration Management

This document provides guidance on how to manage, validate, fix, and upload configurations for the Video Resizer service.

## Important Notes

- **KV-Only Configuration**: As of the latest update, configuration is loaded exclusively from KV storage. There is no fallback configuration mechanism.
- **Required Configuration**: The worker requires a configuration to be present in the `VIDEO_CONFIGURATION_STORE` KV namespace with the key `worker-config`.
- **No Embedded Defaults**: The worker will fail to start if no configuration is found in KV storage.

## Configuration Management Commands

The Video Resizer project includes a unified configuration management tool that makes it easy to work with configuration files. The tool supports checking, fixing, validating, and uploading configurations.

### Basic Usage

All configuration management commands use the same base command with different subcommands:

```bash
npm run config -- [command] [options]
```

### Available Commands

| Command | Description |
|---------|-------------|
| `check` | Check a configuration file for issues |
| `fix` | Fix common issues in a configuration file |
| `upload` | Upload a configuration file to the server |
| `validate` | Validate a configuration file without uploading |
| `--help` | Show help information |

### Common Options

| Option | Description |
|--------|-------------|
| `-c, --config <file>` | Path to the configuration file |
| `-o, --output <file>` | Output path for fixed configuration (used with `fix`) |
| `--env <environment>` | Target environment (development, staging, production) |
| `-t, --token <token>` | Authentication token for configuration uploads |
| `-v, --verbose` | Enable verbose output |

## Examples

### Checking a Configuration File

To check a configuration file for issues:

```bash
npm run config -- check -c config/worker-config.json
```

### Fixing a Configuration File

To fix common issues in a configuration file:

```bash
npm run config -- fix -c config/my-config.json -o config/fixed-config.json
```

If you don't specify an output file, the fixed configuration will be written to the same file:

```bash
npm run config -- fix -c config/my-config.json
```

### Uploading a Configuration

To upload a configuration to a specific environment:

```bash
npm run config -- upload -c config/worker-config.json --env production -t YOUR_TOKEN
```

Add the `-v` flag for verbose output, which shows the exact JSON being sent:

```bash
npm run config -- upload -c config/worker-config.json --env production -t YOUR_TOKEN -v
```

### Validating Without Uploading

To validate a configuration file without actually uploading it (dry run):

```bash
npm run config -- validate -c config/worker-config.json
```

## Troubleshooting

### "Expected array, received object" Errors

If you encounter errors like "Expected array, received object" when uploading configurations, use the `fix` command to automatically convert objects to arrays where required:

```bash
npm run config -- fix -c config/my-config.json -o config/fixed-config.json
```

Common fields that need to be arrays include:
- `video.validOptions.*` fields (mode, fit, format, etc.)
- `video.pathPatterns`
- `video.responsive.availableQualities`
- `video.responsive.browserCapabilities.*.patterns`
- `video.storage.priority`
- `cache.bypassQueryParameters`
- `cache.mimeTypes.video`
- `cache.mimeTypes.image`
- `debug.debugHeaders`
- `debug.allowedIps`
- `debug.excludedPaths`
- `logging.enabledComponents`
- `logging.disabledComponents`

### Cache Method Field

All configurations need a `cache.method` field with value `"kv"`. The `fix` command will automatically add this if it's missing.

## Initial Configuration Upload

For initial setup or when the configuration API is not available, use the config upload script:

```bash
# Upload configuration to development environment
node tools/config-upload.js --env development --token YOUR_TOKEN --config config/worker-config.json

# Upload configuration to production environment
node tools/config-upload.js --env production --token YOUR_TOKEN --config config/worker-config.json

# Use --initial-upload flag to bypass validation and upload directly to KV
node tools/config-upload.js --env production --token YOUR_TOKEN --config config/worker-config.json --initial-upload

# Dry run to validate without uploading
node tools/config-upload.js --env production --token YOUR_TOKEN --config config/worker-config.json --dry-run
```

The upload script handles:
- Authentication with the worker
- Configuration validation
- Direct KV upload when needed
- Environment-specific endpoints