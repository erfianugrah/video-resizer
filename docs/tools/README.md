# Video Resizer Tools

This directory contains documentation for utility tools that help manage and maintain the video-resizer system.

## Available Documentation

- [Comprehensive Tools Guide](./TOOLS_GUIDE.md) - Complete documentation for all utility tools

## Tools Overview

The video-resizer project includes several command-line utility tools located in the `/tools` directory:

1. **Configuration Upload Tool** (`config-upload.js`)
   - Updates worker configuration without redeployment
   - Supports multiple environments (development, staging, production)
   - Includes validation and safety features

2. **Configuration Debug Tool** (`config-debug.js`)
   - Tests authentication and API connectivity
   - Helps troubleshoot configuration issues
   - Provides detailed response information

3. **Configuration Check Tool** (`check-config.js`)
   - Validates configuration files locally
   - Performs schema and structure validation
   - Identifies missing or incorrect configuration components

## Getting Started

To use these tools, see the [Comprehensive Tools Guide](./TOOLS_GUIDE.md) for detailed instructions, or visit:

- [Authentication Setup Guide](../deployment/auth-setup.md) - How to set up authentication for the tools
- [Dynamic Configuration](../configuration/dynamic-configuration.md) - Details on the dynamic configuration system

## Quick Reference

```bash
# Upload configuration to development
node tools/config-upload.js --env development --token YOUR_DEV_TOKEN

# Check configuration file validity
node tools/check-config.js --config ./path/to/config.json

# Test authentication and API connectivity
node tools/config-debug.js --env staging --token YOUR_STAGING_TOKEN
```

For complete documentation including all options, examples, and best practices, see the [Comprehensive Tools Guide](./TOOLS_GUIDE.md).