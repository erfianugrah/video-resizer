# Configuration API Tools

This document outlines the tools and utilities provided for working with the Video Resizer Configuration API.

## Overview

As part of the Configuration API implementation, we've created several tools to simplify interaction with the API and enable common operational tasks. These tools help developers, administrators, and operations teams work with the Configuration API without needing to manually craft API requests.

## Tools Provided

### 1. CLI Tool (`config-cli.js`)

A command-line interface tool for interacting with the Configuration API from the terminal.

#### Features

- **Get Configuration**: Retrieve current active configuration
- **List Versions**: View all available configuration versions
- **Compare Versions**: See differences between configuration versions
- **Update Configuration**: Apply new configuration settings
- **Update Module**: Update specific configuration modules
- **Activate Version**: Switch active configuration to a specific version
- **Export Configuration**: Save configuration to a file
- **Resolve Variables**: Test environment variable resolution
- **View Schema**: Get the JSON schema for validation

#### Installation

1. Make the script executable:
   ```bash
   chmod +x scripts/config-cli.js
   ```

2. Set up environment variables:
   ```bash
   export CONFIG_API_KEY_DEV="your-dev-api-key"
   export CONFIG_API_KEY_STAGING="your-staging-api-key"
   export CONFIG_API_KEY_PROD="your-production-api-key"
   ```

#### Usage

```bash
./scripts/config-cli.js <command> [environment] [options]
```

For example:
```bash
# Get current configuration in development
./scripts/config-cli.js get dev

# Update configuration in staging
./scripts/config-cli.js update staging config.json

# Compare two versions in production
./scripts/config-cli.js compare prod version1-id version2-id

# Activate a specific version in production
./scripts/config-cli.js activate prod version-id
```

### 2. Sample Configuration Files

The `scripts` directory contains sample configuration files that can be used as templates for your own configurations:

#### `sample-config.json`

A comprehensive example configuration with all supported modules and settings.

#### `video-module.json`

An example of a module-specific configuration for the video transformation module.

### 3. Shell Scripts

#### `post-comprehensive-config.sh`

A simple shell script for posting a complete configuration to a specified environment.

```bash
./scripts/post-comprehensive-config.sh [dev|staging|prod] [config-file]
```

## Security Considerations

- **API Keys**: Store API keys as environment variables, not in source code
- **Production Changes**: The CLI tool requires confirmation for production changes
- **HTTPS**: Always use HTTPS for production API interactions
- **Access Control**: Limit access to the Configuration API to authorized personnel

## Best Practices

1. **Version Control**: Store configuration templates in version control
2. **Documentation**: Document changes to configuration with clear commit messages
3. **Testing**: Test configuration changes in development/staging before production
4. **Backup**: Use the export command to backup configurations before changes
5. **Comparison**: Use the compare command to review changes before activation
6. **Automation**: Integrate configuration deployment in CI/CD pipelines

## Future Enhancements

1. **Web UI**: A web-based admin interface for configuration management is planned
2. **Approval Workflow**: Adding approval steps for production configuration changes
3. **Scheduled Activation**: Setting a future time for configuration activation
4. **Configuration Testing**: Automated validation of configurations
5. **Rollback Automation**: Automatic rollback if a configuration causes issues
6. **Notification Integration**: Alerts for configuration changes

## Integration with CI/CD

The Configuration API and its tools can be integrated into CI/CD pipelines for automated configuration management:

```yaml
# Example GitHub Actions workflow
name: Deploy Configuration

on:
  push:
    paths:
      - 'configs/**'
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Validate configuration
        run: node ./scripts/config-cli.js schema staging
      - name: Deploy to staging
        run: ./scripts/post-comprehensive-config.sh staging ./configs/staging.json
        env:
          CONFIG_API_KEY_STAGING: ${{ secrets.CONFIG_API_KEY_STAGING }}
```

## Conclusion

The Configuration API tools provide a robust way to manage Video Resizer configurations across environments. They make it easier to view, modify, and track configuration changes, ensuring consistency and reliability in service configuration.

For detailed API documentation, refer to [CONFIGURATION_API_GUIDE.md](CONFIGURATION_API_GUIDE.md).