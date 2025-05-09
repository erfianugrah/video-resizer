# Service Separation Pattern

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [Refactoring Approach](#refactoring-approach)
- [Benefits](#benefits)
- [Implementation Details](#implementation-details)
  - [File Structure](#file-structure)
  - [Module Organization](#module-organization)
  - [Backward Compatibility](#backward-compatibility)
- [Service Modules](#service-modules)
  - [KV Storage Service](#kv-storage-service)
  - [Video Storage Service](#video-storage-service)
  - [Error Handler Service](#error-handler-service)
  - [Configuration Service](#configuration-service)
  - [Transformation Utils](#transformation-utils)
- [Best Practices](#best-practices)
- [Migration Path](#migration-path)

## Overview

The Service Separation Pattern is an architectural pattern applied to the Video Resizer to improve code organization, maintainability, and testability. This pattern involves breaking down large monolithic service files into smaller, focused modules while maintaining backward compatibility.

The approach was applied to the five largest files in the codebase:

1. `kvStorageService.ts` (2631 lines) → Refactored into 9 smaller files in `src/services/kvStorage/`
2. `videoStorageService.ts` (1927 lines) → Refactored into 9 smaller files in `src/services/videoStorage/`
3. `errorHandlerService.ts` (1426 lines) → Refactored into 6 smaller files in `src/services/errorHandler/`
4. `configurationService.ts` (1045 lines) → Refactored into 8 smaller files in `src/services/configuration/`
5. `transformationUtils.ts` (1029 lines) → Refactored into 5 smaller files in `src/utils/transformation/`

## Refactoring Approach

The refactoring process followed these steps for each service:

1. **Analysis**: Identify logical groupings of functions in the monolithic file
2. **Backup**: Create a backup (.bak) file of the original implementation
3. **Structure**: Create a new directory with the same name as the service
4. **Separation**: Move related functions to appropriate new files
5. **Documentation**: Add a README.md file explaining the module structure
6. **Re-export**: Create an index.ts file that re-exports all functionality
7. **Validation**: Ensure all tests pass with the new structure

This approach maintains the original import paths, ensuring that existing code continues to work without modification.

## Benefits

The Service Separation Pattern provides several key benefits:

1. **Improved Maintainability**: Smaller, focused files are easier to understand and modify
2. **Better Testability**: Components can be tested in isolation
3. **Clear Responsibility Boundaries**: Each file has a specific purpose and scope
4. **Reduced Cognitive Load**: Developers can focus on a single aspect at a time
5. **Easier Onboarding**: New team members can understand the system incrementally
6. **Enhanced Collaboration**: Multiple developers can work on different parts simultaneously
7. **Better Performance**: Smaller files can lead to faster IDE performance
8. **Simplified Debugging**: Easier to trace issues to their source

## Implementation Details

### File Structure

Each refactored service follows a consistent structure:

```
src/services/serviceName/
├── README.md        # Documentation of the service structure
├── constants.ts     # Shared constants
├── interfaces.ts    # Type definitions
├── componentA.ts    # Focused implementation file
├── componentB.ts    # Focused implementation file
├── ...              # Additional component files
└── index.ts         # Re-exports all functionality
```

The original monolithic file is modified to import and re-export all functionality from the new structure:

```typescript
// src/services/serviceName.ts
export * from './serviceName/index';
```

### Module Organization

Each module is organized around a specific responsibility:

1. **Constants**: Shared constants used across the service
2. **Interfaces**: Type definitions and interfaces
3. **Utilities**: Helper functions focused on a specific task
4. **Core Logic**: Main service functionality split by feature
5. **Integration**: Code that connects to other services

### Backward Compatibility

Backward compatibility is maintained through careful re-exports:

```typescript
// src/services/kvStorage/index.ts
export { storeTransformedVideo } from './storeVideo';
export { getTransformedVideo } from './getVideo';
export { listVideoVariants } from './listVariants';
export { generateKVKey } from './keyUtils';
// ... additional exports
```

This ensures that existing code can continue to import from the original file path without modification.

## Service Modules

### KV Storage Service

The KV Storage Service manages the storage and retrieval of transformed videos in Cloudflare KV:

```
src/services/kvStorage/
├── README.md         # Documentation
├── constants.ts      # Shared constants
├── interfaces.ts     # Type definitions
├── keyUtils.ts       # Key generation and management
├── storageHelpers.ts # Common storage functions
├── storeVideo.ts     # Video storage implementation
├── getVideo.ts       # Video retrieval implementation
├── listVariants.ts   # Video variant listing
├── streamingHelpers.ts # Range request handling
├── versionHandlers.ts # Cache versioning
└── index.ts          # Re-exports
```

Key features include:
- Standard and chunked video storage
- Range request support
- TTL refresh
- Cache versioning

### Video Storage Service

The Video Storage Service handles fetching video content from various storage backends:

```
src/services/videoStorage/
├── README.md         # Documentation
├── interfaces.ts     # Type definitions
├── cacheTags.ts      # Cache tag generation
├── cacheBypass.ts    # Cache bypass detection
├── pathTransform.ts  # URL transformation
├── r2Storage.ts      # R2 storage implementation
├── remoteStorage.ts  # Remote URL fetching
├── fallbackStorage.ts # Fallback content
├── fetchVideo.ts     # Main fetch orchestration
└── index.ts          # Re-exports
```

Key features include:
- Multiple storage backends (R2, remote, fallback)
- Cache tag generation
- Path transformation for different origins

### Error Handler Service

The Error Handler Service provides comprehensive error handling and reporting:

```
src/services/errorHandler/
├── README.md                   # Documentation
├── normalizeError.ts           # Error normalization
├── errorResponse.ts            # Error response creation
├── fallbackContent.ts          # Fallback content generation
├── logging.ts                  # Error logging
├── transformationErrorHandler.ts # Specific handling for transformation errors
└── index.ts                    # Re-exports
```

Key features include:
- Error normalization
- Custom error responses
- Fallback content generation
- Comprehensive logging

### Configuration Service

The Configuration Service manages loading, validation, and access to configuration:

```
src/services/configuration/
├── README.md       # Documentation
├── schemas.ts      # Configuration schemas
├── caching.ts      # In-memory caching
├── metrics.ts      # Performance metrics
├── loaders.ts      # KV loading
├── storage.ts      # Configuration storage
├── accessors.ts    # Configuration access
├── validation.ts   # Configuration validation
├── service.ts      # Main service implementation
└── index.ts        # Re-exports
```

Key features include:
- Type-safe configuration validation
- In-memory caching
- Metrics tracking
- Centralized access to configuration

### Transformation Utils

The Transformation Utils provide utilities for video transformation operations:

```
src/utils/transformation/
├── README.md            # Documentation
├── parameterMapping.ts  # Parameter translation
├── timeUtils.ts         # Time and duration handling
├── formatValidation.ts  # Format validation
├── errorHandling.ts     # Error handling utilities
└── index.ts             # Re-exports
```

Key features include:
- CDN parameter mapping
- Time and duration parsing
- Format validation
- Error handling utilities

## Best Practices

When applying the Service Separation Pattern, follow these best practices:

1. **Single Responsibility**: Each file should focus on a single responsibility
2. **Minimal Dependencies**: Minimize dependencies between modules
3. **Comprehensive Documentation**: Include a README.md for each service
4. **Consistent Naming**: Use consistent naming conventions across all modules
5. **Complete Test Coverage**: Ensure tests cover the refactored code
6. **Backward Compatibility**: Maintain the original import paths
7. **Clear Interface Definitions**: Define clear interfaces between modules
8. **Avoid Circular Dependencies**: Structure modules to avoid circular imports

## Migration Path

For teams considering applying the Service Separation Pattern to their own code:

1. **Start with Analysis**: Identify logical groups of functionality
2. **Create a Plan**: Map out the new file structure before starting
3. **One Service at a Time**: Refactor one service completely before moving to the next
4. **Incremental Testing**: Test thoroughly after each service is refactored
5. **Documentation**: Document the new structure as you go
6. **Team Communication**: Keep the team informed of structural changes
7. **IDE Support**: Use IDE refactoring tools to help with the separation
8. **Backup Strategy**: Always create backups before starting

The incremental approach minimizes risk while still achieving the benefits of the pattern.