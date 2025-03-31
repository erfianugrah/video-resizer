# Video Resizer Architecture Patterns

## Overview

This document outlines the key architecture patterns used in the Video Resizer project. Understanding these patterns is essential for maintaining consistency when extending or modifying the codebase.

## 1. Configuration Management Pattern

The Video Resizer uses a centralized configuration management approach with the following components:

### 1.1 ConfigurationManager Classes

Configuration is managed through specialized manager classes that follow the singleton pattern:

- **VideoConfigurationManager**: Video transformation settings
- **LoggingConfigurationManager**: Logging settings, including Pino config and breadcrumbs
- **CacheConfigurationManager**: Cache strategy and settings
- **DebugConfigurationManager**: Debug and diagnostic settings

All configuration managers provide:

1. Zod schema validation for configuration integrity
2. Type-safe access methods
3. Consistent error handling

Example usage:
```typescript
// Get instance of configuration manager
const loggingConfig = LoggingConfigurationManager.getInstance();

// Access specific configuration
const pinoConfig = loggingConfig.getPinoConfig();
const breadcrumbConfig = loggingConfig.getBreadcrumbConfig();
```

### 1.2 Centralized Initialization

Configuration is initialized centrally in the `initializeConfiguration()` function in `config/index.ts`:

1. Environment variables from Cloudflare Workers are processed
2. Values are validated using Zod schemas
3. Configuration is distributed to specialized managers

### 1.3 Environment-Specific Configuration

Environment-specific configuration is defined in `wrangler.jsonc`:

- Development settings at the top level
- Production settings in the `env.production` section
- Staging settings in the `env.staging` section

## 2. Command Pattern

The Video Resizer follows the Command pattern for handling transformation requests:

### 2.1 TransformVideoCommand

The main entry point for video transformation operations:

1. Encapsulates all business logic for transforming videos
2. Separated from the HTTP handling layer
3. Uses dependency injection for services

### 2.2 Strategy Pattern Implementation

The transformation logic uses the Strategy pattern to handle different transformation modes:

- **VideoStrategy**: For regular video transformations
- **FrameStrategy**: For extracting single frames
- **SpritesheetStrategy**: For generating sprite sheets

All strategies implement the common `TransformationStrategy` interface, and the appropriate strategy is selected via a factory.

## 3. Logging System

### 3.1 Request Context Pattern

Request-scoped context is used for tracking the lifecycle of each request:

- Unique request ID
- Start time and performance metrics
- Breadcrumb trail for debugging
- Component timing information

### 3.2.Pino Logger Integration

Structured logging with Pino:

- JSON-formatted logs in production
- Colorized, human-readable logs in development
- Configurable log levels per environment
- Log sampling for production

### 3.3 Breadcrumb System

Chronological trail of operations during request processing:

- Each breadcrumb includes category, message, timestamp, and optional data
- Performance timing is automatically captured between breadcrumbs
- Breadcrumbs can be included in debug responses for troubleshooting

## 4. Error Handling Pattern

### 4.1 Error Class Hierarchy

Specialized error classes with rich metadata:

- **VideoTransformError**: Base class for all errors
- **ValidationError**: For input validation issues
- **ProcessingError**: For transformation failures
- **ConfigurationError**: For configuration issues
- **NotFoundError**: For missing resources

### 4.2 Error Type Mapping

Errors are categorized by type with automatic HTTP status code mapping:

- Client errors (400 range): Invalid parameters, formats, etc.
- Not found errors (404): Missing resources or patterns
- Server errors (500 range): Processing failures, configuration issues

### 4.3 Centralized Error Handling

Error handling is centralized in the error handler service:

- Normalizes any error into a VideoTransformError
- Logs with appropriate context
- Generates consistent HTTP responses

## 5. Service Layer Pattern

### 5.1 Specialized Services

The application is organized into domain-specific services:

- **VideoTransformationService**: Core transformation logic
- **CacheManagementService**: Cache strategy implementation
- **DebugService**: Diagnostics and debug information
- **VideoStorageService**: Content storage and retrieval

### 5.2 Dynamic Imports

Services use dynamic imports to avoid circular dependencies:

```typescript
// Instead of direct imports
import { someFunction } from '../otherModule';

// Use dynamic imports
const { someFunction } = await import('../otherModule');
```

## 6. Integration of Best Practices

### 6.1 TypeScript Type Safety

Strong typing is used throughout the codebase:

- Zod schemas for runtime validation with TypeScript types
- Explicit handling of null and undefined values
- Proper typing for all functions and interfaces

### 6.2 Testing Approach

Tests are organized by component type:

- Unit tests for individual functions and classes
- Integration tests for service interactions
- Parametrized tests for transformation variations

Mock implementations are provided for configuration managers and services during testing.

### 6.3 Debug UI Integration

Debug UI is built with Astro and shadcn/ui:

- Component-based architecture
- Worker integration through the ASSETS binding
- Diagnostic visualization for request flow and performance

## Implementation Recommendations

When implementing new features or changes, follow these recommendations:

1. **Configuration**: Add new settings to the appropriate configuration manager with Zod validation

2. **New Transformation Types**: Implement new strategies that conform to the TransformationStrategy interface

3. **Logging**: Use structured logging with the Pino logger and request context

4. **Error Handling**: Create specialized error classes for new error types

5. **Testing**: Create comprehensive tests with appropriate mocks

6. **Dependencies**: Use dynamic imports to avoid circular dependencies

By following these architectural patterns, the codebase will remain maintainable, testable, and extensible as new features are added.