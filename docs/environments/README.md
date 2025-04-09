# Environment Configuration

*Last Updated: April 9, 2025*

This directory contains documentation about environment configuration and deployment for the Video Resizer project. It covers topics related to different environments (development, staging, production) and their specific configuration needs.

## Environment Types

Video Resizer supports the following environments:

1. **Development** - Local development environment using Wrangler
2. **Staging** - Pre-production environment for testing
3. **Production** - Live production environment

## Wrangler Configuration

The project uses Wrangler for local development and deployment. Key configuration topics:

- [Wrangler vs KV Configuration](../configuration/wrangler-vs-kv-config.md) - Understanding different configuration sources
- [Simplified Wrangler Template](../configuration/simplified-wrangler-template.jsonc) - Example template for Wrangler configuration

## Environment-Specific Configuration

Each environment has specific configuration requirements to ensure proper behavior:

1. **Development Environment**
   - Debug mode enabled
   - Verbose logging
   - Local R2 storage emulation

2. **Staging Environment**
   - Limited debug features
   - Standard logging
   - R2 storage enabled

3. **Production Environment**
   - Debug mode disabled
   - Minimal logging
   - R2 storage enabled
   - Performance optimizations

## Related Documentation

- [Deployment Guide](../deployment/README.md) - How to deploy to different environments
- [Configuration System](../configuration/README.md) - Configuration system overview
- [Dynamic Configuration](../configuration/dynamic-configuration.md) - Using KV for dynamic configuration