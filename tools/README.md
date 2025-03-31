# Video Resizer Tools

This directory contains utility tools for the video-resizer project.

## Configuration Upload Tool

The `config-upload.js` script is used to upload dynamic configuration to a deployed video-resizer worker without requiring redeployment.

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
| `-t, --token <token>` | Authentication token (required) |
| `-e, --env <environment>` | Environment to target (`development`, `staging`, `production`) |
| `--dry-run` | Validate configuration without uploading |
| `-v, --verbose` | Show verbose output |
| `-h, --help` | Display help information |

### Examples

#### Upload to Development Environment

```bash
node tools/config-upload.js --env development --token YOUR_DEV_TOKEN
```

#### Upload to Staging with Custom Configuration

```bash
node tools/config-upload.js --env staging --token YOUR_STAGING_TOKEN --config ./path/to/custom-config.json
```

#### Upload to Production

```bash
node tools/config-upload.js --env production --token YOUR_PROD_TOKEN
```

This will prompt for confirmation before uploading to production.

#### Validate Configuration Without Uploading

```bash
node tools/config-upload.js --env development --token YOUR_DEV_TOKEN --dry-run
```

### Preconfigured Environments

The tool has the following environments preconfigured:

* `development`: https://video-resizer-development.anugrah.workers.dev
* `staging`: https://staging-video-resizer.workers.dev
* `production`: https://cdn.erfi.dev

### Security Notes

1. Always use unique, strong tokens for each environment
2. Store tokens securely; never commit them to source control
3. Use the `--dry-run` option to validate configuration changes before applying them to production
4. The tool requires confirmation before uploading to production to prevent accidental changes

## Additional Documentation

For more information, see:

* [Dynamic Configuration](../docs/configuration/dynamic-configuration.md)
* [Auth Setup Guide](../docs/deployment/auth-setup.md)