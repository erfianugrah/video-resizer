# Video Resizer Configuration

_Last Updated: February 18, 2026_

This section provides comprehensive documentation on configuring the Video Resizer, including environment settings, path patterns, and dynamic configuration.

## Core Configuration Documents

- [Configuration Guide](./configuration-guide.md) - Complete configuration reference
- [Path Patterns](./path-patterns.md) - URL pattern matching documentation
- [Configuration Management](./config-management.md) - How to check, fix, and upload configurations
- [Flexible Bindings](./flexible-bindings.md) - Custom KV namespace binding names
- [Origins Configuration](./origins-configuration.md) - Multi-origin setup and authentication

## Configuration Overview

The video-resizer project uses a modular configuration system with the following components:

1. **Wrangler Configuration** - Core environment settings in wrangler.jsonc
2. **KV Configuration** - Dynamic configuration stored in Cloudflare KV
3. **Path Pattern Matching** - URL pattern matching system for processing requests
4. **Environment-specific Configuration** - Settings that vary by environment

Configuration managers provide type-safe access to settings:

- **VideoConfigurationManager** - Video transformation settings
- **CacheConfigurationManager** - Caching behavior and profiles
- **DebugConfigurationManager** - Debugging capabilities
- **LoggingConfigurationManager** - Logging levels and formats

See the [Configuration Guide](./configuration-guide.md) for complete details on all options.
