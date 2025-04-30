# Configuration Guide

> This guide provides an overview of the configuration system for the video-resizer project.

## Quick Links

- [Complete Configuration Reference](./CONFIGURATION_REFERENCE.md) - Comprehensive documentation of all configuration options
- [Path Pattern Matching](./path-pattern-matching.md) - Detailed guide on URL pattern matching
- [Dynamic Configuration](./dynamic-configuration.md) - How to use KV-based configuration updates
- [Updating Configuration](./updating-configuration.md) - Practical guide for making configuration changes
- [Presigned URL Implementation Guide](./presigned-url-implementation-guide.md) - Comprehensive guide for the presigned URL implementation
- [Presigned URL Monitoring Plan](./presigned-url-monitoring-plan.md) - Plan for monitoring presigned URL performance and health

## Overview

The video-resizer project uses a modular configuration system with the following components:

1. **Wrangler Configuration** - Core environment settings in wrangler.jsonc
2. **KV Configuration** - Dynamic configuration stored in Cloudflare KV
3. **Path Pattern Matching** - URL pattern matching system for processing requests
4. **Presigned URL System** - Secure access to private content with caching

See the [Configuration Reference](./CONFIGURATION_REFERENCE.md) for complete details on all available options.

## Environment-Specific Configuration

Configuration can be customized per environment (development, staging, production).
See [dynamic-configuration.md](./dynamic-configuration.md) for details.

## Presigned URL Documentation

For the presigned URL system, see this comprehensive guide:

- [Presigned URL Guide](./presigned-url-guide.md) - Complete implementation guide including architecture, caching, integration with Cloudflare Media Transformation, monitoring, and operational guidelines

**Legacy Documentation** (for reference only):
- [Presigned URL Implementation Guide](./presigned-url-implementation-guide.md)
- [Presigned URL Monitoring Plan](./presigned-url-monitoring-plan.md)
- [Presigned URL Transformation Integration](./presigned-url-transformation-integration.md)
- [Presigned URL Implementation](./presigned-url-implementation.md)
- [Presigned URL Caching](./presigned-url-caching.md)

