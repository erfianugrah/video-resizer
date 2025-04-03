# Video Resizer Architecture Overview

## Current Architecture

The Video Resizer is built with a service-oriented architecture that transforms video URLs to use Cloudflare's Media Transformation API. The key components are:

### Configuration Layer
- **Configuration Managers**: Specialized singleton managers with Zod validation
  - `VideoConfigurationManager`: Video transformation settings
  - `CacheConfigurationManager`: Cache strategy settings
  - `DebugConfigurationManager`: Debug and logging settings
  - `LoggingConfigurationManager`: Logging behavior configuration

### Domain Layer
- **Command Pattern**: `TransformVideoCommand` encapsulates core business logic
- **Strategy Pattern**: Specialized strategies handle different transformation types
  - `VideoStrategy`: For regular video transformations
  - `FrameStrategy`: For extracting frames
  - `SpritesheetStrategy`: For creating sprite sheets

### Service Layer
- **TransformationService**: Handles URL construction and parameter preparation
- **CacheManagementService**: Manages caching with the Cache API
- **ConfigurationService**: Manages KV-based configuration
- **DebugService**: Provides diagnostics and debug features

### Utils Layer
- **Path Utils**: Handles URL pattern matching and transformation
- **Error Handling Utils**: Standardized error handling functions
- **Request Context**: Manages request-scoped state and breadcrumbs
- **Logging Utils**: Structured logging with Pino

### Handler Layer
- **videoHandler.ts**: Main entry point for video transformation requests
- **configHandler.ts**: Handles configuration management API

## Architectural Improvements in Progress

### 1. Eliminate Circular Dependencies
The codebase currently uses dynamic imports to avoid circular dependencies. We plan to:
- Create a proper layered architecture with clear dependency direction
- Move shared interfaces to separate files
- Replace dynamic imports with static imports
- Implement proper dependency injection

### 2. Enhance Path Matching System
The path matching system is functional but complex. We plan to:
- Create a dedicated PathMatchingService
- Implement pattern caching to avoid repeated regex compilation
- Add validation for patterns during initialization
- Improve testing and debugging tools

### 3. Complete Configuration System
We have a solid configuration foundation with Zod schemas, and plan to:
- Move all hardcoded values to worker-config.json
- Create a unified approach to configuration loading
- Add validation for configuration relationships
- Improve documentation and examples

### 4. Optimize Performance
With the core functionality stable, we will focus on:
- Reducing cold start times
- Optimizing cache efficiency
- Implementing background refresh for KV
- Adding performance benchmarks

## Implementation Timeline

| Phase | Duration | Focus Area |
|-------|----------|------------|
| 1     | 3 weeks  | Dependency Structure Refactoring |
| 2     | 2 weeks  | Path Matching and Configuration |
| 3     | 2 weeks  | Testing and Performance |

See [ARCHITECTURE_ROADMAP.md](../../ARCHITECTURE_ROADMAP.md) for detailed implementation plans and current status.