# Video Resizer Configuration

*Last Updated: May 10, 2025*

This section provides comprehensive documentation on configuring the Video Resizer, including environment settings, path patterns, and dynamic configuration.

## Core Configuration Documents

- [Configuration Guide](./configuration-guide.md) - Complete configuration reference
- [Path Patterns](./path-patterns.md) - URL pattern matching documentation
- [Dynamic Configuration](./dynamic-config.md) - KV-based dynamic configuration
- [Environment Configuration](./environment-config.md) - Environment-specific settings

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