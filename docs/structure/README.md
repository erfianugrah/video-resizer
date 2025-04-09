# Documentation Structure

*Last Updated: April 9, 2025*

This directory contains documents about the documentation itself, including organization, cleanup plans, and documentation structure.

## Documentation Overview

- [Documentation Overview](./DOCUMENTATION.md) - General information about project documentation

## Documentation Cleanup

- [Cleanup Plan](./CLEANUP_PLAN.md) - Plan for cleaning up and organizing documentation

## Documentation Structure

The video-resizer documentation is organized into the following main sections:

### Core Documentation

1. **Architecture** (`/docs/architecture/`)
   - High-level architecture description
   - Architectural patterns
   - Dependency inversion implementation
   - Migration plans

2. **Configuration** (`/docs/configuration/`)
   - Configuration system overview
   - Video, cache, and debug configuration
   - Path pattern matching
   - Dynamic configuration

3. **Deployment** (`/docs/deployment/`)
   - Deployment instructions
   - Authentication setup
   - Fixed deployment issues
   - Future recommendations

4. **Environments** (`/docs/environments/`)
   - Environment-specific configuration
   - Development, staging, production settings

### Feature Documentation

5. **Features** (`/docs/features/`)
   - Akamai integration
   - Client detection
   - Debug UI
   - IMQuery support
   - Logging

6. **Error Handling** (`/docs/error-handling/`)
   - Error handling system
   - Implementation details
   - Guidelines and best practices

7. **KV Caching** (`/docs/kv-caching/`)
   - KV caching implementation
   - Configuration, performance, testing

8. **Storage** (`/docs/storage/`)
   - Storage options and configuration
   - Origin consolidation

## Documentation Standards

All documentation should follow these standards:

1. Use Markdown formatting with proper headings, lists, and code blocks
2. Include a "Last Updated" date at the top of each document
3. Use descriptive filenames in kebab-case (lowercase with dashes)
4. Place documentation in the appropriate directory based on content
5. Link to related documentation using relative paths
6. Include code examples where appropriate