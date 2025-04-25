# Video Resizer Documentation

Welcome to the Video Resizer documentation. This document serves as a central hub for all the documentation related to the Video Resizer project.

*Last Updated: April 25, 2025*

## Core Documentation

- **[Configuration Guide](./configuration/README.md)**: Overview of the configuration system
  - [Video Configuration](./configuration/video-configuration.md)
  - [Cache Configuration](./configuration/cache-configuration.md)
  - [Debug Configuration](./configuration/debug-configuration.md)
  - [Configuration Loading](./configuration/configuration-loading.md)
  - [Dynamic Configuration](./configuration/dynamic-configuration.md)
  - [Path Pattern Matching](./configuration/path-pattern-matching.md)
  - [Path Pattern Troubleshooting](./configuration/path-pattern-troubleshooting.md)
  - [URL Parameter Filtering](./configuration/url-parameter-filtering.md)
  - [Updating Configuration](./configuration/updating-configuration.md)
  - [Parameter Compatibility Matrix](./configuration/parameter-compatibility.md)
  - [Configuration Reference](./configuration/CONFIGURATION_REFERENCE.md)

- **[Deployment Guide](./deployment/README.md)**: How to deploy Video Resizer to Cloudflare Workers
  - [Authentication Setup](./deployment/auth-setup.md)
  - [Deployment Process](./deployment/DEPLOY.md)

- **[KV Caching System](./kv-caching/README.md)**: Documentation on the KV caching implementation
  - [Implementation Details](./kv-caching/implementation.md)
  - [Configuration Guide](./kv-caching/configuration.md)
  - [Testing Guide](./kv-caching/testing.md)
  - [Performance Considerations](./kv-caching/performance.md)
  - [Cache Filtering](./kv-caching/cache-filtering.md)
  - [Cache Versioning](./kv-caching/cache-versioning.md)

- **[Storage System](./storage/README.md)**: Documentation on storage backends and origins
  - [Origin Consolidation](./storage/origin-consolidation.md)

- **[Error Handling](./error-handling/README.md)**: Comprehensive error handling documentation
  - [Developer Guidelines](./error-handling/developer-guidelines.md)
  - [Implementation Plan](./error-handling/implementation-plan.md)
  - [Next Steps](./error-handling/next-steps.md)
  - [Monitoring Plan](./error-handling/monitoring-plan.md)
  - [Test Improvements](./error-handling/test-improvements.md)
  - [Implementation Details](./error-handling/implementations/)

## Features Documentation

- **[Features Overview](./features/README.md)**: Documentation for specific features
  - **[Video Transformation Modes](./features/transformation-modes.md)**: Overview of video, frame and spritesheet modes
    - **[Frame Extraction](./features/frame/README.md)**: Video frame extraction feature
    - **[Spritesheet Generation](./features/spritesheet/README.md)**: Video spritesheet generation feature
  - **[Akamai Integration](./features/akamai/README.md)**: Compatibility with Akamai image format
    - [Akamai Integration Completion](./features/akamai/akamai-integration-completion.md)
    - [Akamai Translation Enhancement](./features/akamai/akamai-translation-enhancement.md)
  - **[Client Detection](./features/client-detection/README.md)**: Improved client device and capability detection
    - [Client Detection Improvements](./features/client-detection/CLIENT_DETECTION_IMPROVEMENT.md)
  - **[Debug UI](./features/debug-ui/README.md)**: Debugging interface for troubleshooting
    - [Debug Headers](./features/debug-ui/DEBUG_HEADERS.md)
    - [Debug View Mode](./features/debug-ui/DEBUG_VIEW_MODE.md)
    - [Debug UI Enhancement Plan](./features/debug-ui/debug-ui-enhancement-plan.md)
  - **[IMQuery Support](./features/imquery/README.md)**: Support for IMQuery responsive image parameters
    - [IMQuery Caching](./features/imquery/IMQUERY_CACHING.md)
    - [Breakpoint-based Derivative Mapping](./features/imquery/breakpoint-based-derivative-mapping.md)
    - [IMQuery Caching Enhancement](./features/imquery/imquery-caching-enhancement.md)
    - [IMQuery Caching Fix](./features/imquery/imquery-caching-fix.md)
  - **[Logging](./features/logging/README.md)**: Advanced logging and monitoring capabilities
    - [Logging Configuration](./features/logging/logging-configuration.md)
    - [Logging Refactor](./features/logging/LOGGING-REFACTOR.md)

## Architecture Documentation

- **[Architecture Overview](./architecture/ARCHITECTURE_OVERVIEW.md)**: High-level architecture description
- **[Architecture Roadmap](./architecture/ARCHITECTURE_ROADMAP.md)**: Current progress and future architectural improvements
- **[Architecture Patterns](./architecture/ARCHITECTURE_PATTERNS.md)**: Architectural patterns used in the project
- **[Transformation Strategies](./architecture/TRANSFORMATION_STRATEGIES.md)**: Strategy pattern for transformation modes
- **[Dependency Inversion](./architecture/DEPENDENCY_INVERSION_PLAN.md)**: Plan for implementing dependency inversion
  - [Refined Dependency Inversion](./architecture/REFINED_DEPENDENCY_INVERSION.md)
- **[Path Matching Enhancement](./architecture/PATH_MATCHING_ENHANCEMENT.md)**: Enhancements to the path matching system
- **[Refactoring Guide](./architecture/REFACTORING.md)**: Notes on refactoring approaches
- **[Unified Origins Migration](./architecture/MIGRATING_TO_UNIFIED_ORIGINS.md)**: Guide to migrating to unified origins

## Tools Documentation

- **[Tools Overview](./tools/README.md)**: Documentation for utility tools
  - [Comprehensive Tools Guide](./tools/TOOLS_GUIDE.md): Detailed documentation of all tools
- **[Debug UI Documentation](../debug-ui/README.md)**: Debug interface for monitoring and diagnostics

## Documentation Resources

- **[Documentation Glossary](./documentation-glossary.md)**: Standardized terminology used throughout documentation
- **[Documentation Roadmap](./documentation-roadmap.md)**: Future documentation priorities and maintenance plan

## Documentation Structure

For information about the documentation organization:

- [Documentation Summary](./documentation-summary.md) - Overview of documentation organization and standards
- [Documentation Structure](./structure/README.md) - Detailed documentation structure
- [Documentation Cleanup Plan](./structure/CLEANUP_PLAN.md) - Plan for documentation cleanup
- [Documentation Overview](./structure/DOCUMENTATION.md) - General documentation information

## Environment Configuration

- **[Environments](./environments/README.md)**: Environment-specific configuration
  - Development, Staging, Production environments
  - Environment-specific configuration requirements

## Additional Resources

- **[Archive](./archive/)**: Historical documents kept for reference

## Recent Changes

The following significant changes have recently been implemented:

1. **Added Loop Functionality**: Added support for the `loop` parameter in video playback
2. **Fixed Storage Configuration Integration**: Added proper storage configuration support to VideoConfigurationManager
3. **Enhanced Configuration Tool**: Improved error handling, security, and validation in the config-upload.js tool
4. **Fixed Fallback URL Construction**: Corrected CDN-CGI URL extraction for fallback sources
5. **Documentation Reorganization**: Cleaned up and reorganized documentation to fix broken links and inconsistencies
6. **Enhanced Tools Documentation**: Created comprehensive guide for utility tools and improved organization
7. **KV Cache Versioning**: Implemented KV cache versioning system with dedicated namespace