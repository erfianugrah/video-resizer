# Video Resizer Documentation

Welcome to the Video Resizer documentation. This document serves as a central hub for all the documentation related to the Video Resizer project.

*Last Updated: April 9, 2025*

## Core Documentation

- **[Configuration Guide](./configuration/README.md)**: Overview of the configuration system
  - [Video Configuration](./configuration/video-configuration.md)
  - [Cache Configuration](./configuration/cache-configuration.md)
  - [Debug Configuration](./configuration/debug-configuration.md)
  - [Configuration Loading](./configuration/configuration-loading.md)
  - [Dynamic Configuration](./configuration/dynamic-configuration.md)
  - [Path Pattern Matching](./configuration/path-pattern-matching.md)
  - [Path Pattern Troubleshooting](./configuration/path-pattern-troubleshooting.md)
  - [Updating Configuration](./configuration/updating-configuration.md)
  - [Configuration Reference](./configuration/CONFIGURATION_REFERENCE.md)

- **[Deployment Guide](./deployment/README.md)**: How to deploy Video Resizer to Cloudflare Workers
  - [Authentication Setup](./deployment/auth-setup.md)
  - [Deployment Issues Fixed](./deployment/DEPLOYMENT_ISSUES_FIXED.md) *[New]*
  - [Future Recommendations](./deployment/FUTURE_RECOMMENDATIONS.md) *[New]*

- **[KV Caching System](./kv-caching/README.md)**: Documentation on the KV caching implementation
  - [Implementation Details](./kv-caching/implementation.md)
  - [Configuration Guide](./kv-caching/configuration.md)
  - [Testing Guide](./kv-caching/testing.md)
  - [Performance Considerations](./kv-caching/performance.md)
  - [Cache Filtering](./kv-caching/cache-filtering.md)

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
  - **[Akamai Integration](./features/akamai/README.md)**: Compatibility with Akamai image format
    - [Akamai Integration Completion](./features/akamai/akamai-integration-completion.md)
    - [Akamai Translation Enhancement](./features/akamai/akamai-translation-enhancement.md)
  - **[Client Detection](./features/client-detection/README.md)**: Improved client device and capability detection
    - [Client Detection Improvements](./features/client-detection/CLIENT_DETECTION_IMPROVEMENT.md)
  - **[Debug UI](./features/debug-ui/README.md)**: Debugging interface for troubleshooting
    - [Debug Headers](./features/debug-ui/DEBUG_HEADERS.md)
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
- **[Dependency Inversion](./architecture/DEPENDENCY_INVERSION_PLAN.md)**: Plan for implementing dependency inversion
  - [Refined Dependency Inversion](./architecture/REFINED_DEPENDENCY_INVERSION.md)
  - [Implementation Progress](./architecture/DEPENDENCY_INVERSION_IMPLEMENTATION_PROGRESS.md)
- **[Path Matching Enhancement](./architecture/PATH_MATCHING_ENHANCEMENT.md)**: Enhancements to the path matching system
- **[Refactoring Guide](./architecture/REFACTORING.md)**: Notes on refactoring approaches
  - [Cache Utils Refactoring](./architecture/CACHE_UTILS_REFACTORING.md)
  - [Client Hints Refactoring](./architecture/CLIENT_HINTS_REFACTORING.md)
  - [Device Utils Refactoring](./architecture/DEVICE_UTILS_REFACTORING.md)
  - [URL Transform Refactoring](./architecture/URL_TRANSFORM_REFACTORING.md)
- **[Unified Origins Migration](./architecture/MIGRATING_TO_UNIFIED_ORIGINS.md)**: Guide to migrating to unified origins
  - [Migration Plan](./architecture/MIGRATION_PLAN.md)
  - [Migration Completion](./architecture/MIGRATION_COMPLETION.md)

## Tools Documentation

- **[Configuration Upload Tool](../tools/README.md)**: Tool for managing dynamic configuration *[Updated]*
- **[Debug UI Documentation](../debug-ui/README.md)**: Debug interface for monitoring and diagnostics

## Documentation Structure

For information about the documentation organization and cleanup efforts:

- [Documentation Structure](./structure/README.md) - Overview of documentation organization
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

1. **Fixed Storage Configuration Integration**: Added proper storage configuration support to VideoConfigurationManager
2. **Enhanced Configuration Tool**: Improved error handling, security, and validation in the config-upload.js tool
3. **Fixed Fallback URL Construction**: Corrected CDN-CGI URL extraction for fallback sources
4. **Deployment Issue Resolution**: Documentation of production deployment issues and fixes
5. **Documentation Reorganization**: Plan for cleaning up and organizing documentation