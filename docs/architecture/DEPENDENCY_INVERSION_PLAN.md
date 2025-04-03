# Dependency Inversion Implementation Plan

## Overview

This document outlines our strategy for resolving circular dependencies in the Video Resizer codebase using dependency inversion principles. The current architecture relies heavily on dynamic imports to break circular references, which impacts performance, complicates debugging, and makes testing difficult.

## Current Challenges

1. **Circular Dependencies**: Many core modules depend on each other, creating circular references
2. **Dynamic Imports**: Workarounds using `.then()` callbacks add complexity and latency
3. **Testing Difficulties**: Mock implementations become complex due to interdependencies
4. **Code Maintainability**: Understanding dependencies and code flow becomes challenging

## Dependency Inversion Approach

We will implement a systematic approach following SOLID principles, specifically the Dependency Inversion Principle:

> High-level modules should not depend on low-level modules. Both should depend on abstractions.

## Implementation Strategy

### 1. Create Core Interfaces Layer

First, we'll create a clean `/src/core` module with zero external dependencies:

```
/src/core/
  /interfaces/      # Pure interface definitions
    logger.ts       # Logger interface
    context.ts      # Request context interface
    config.ts       # Configuration provider interface
    errors.ts       # Error handling interfaces
    path-matcher.ts # Path matching interface
    cache.ts        # Caching service interfaces
  /types/           # Type definitions
    error-types.ts  # Error enums and types
    config-types.ts # Configuration types
    request-types.ts # Request and context types
```

Example implementation:

```typescript
// src/core/interfaces/logger.ts
export interface Logger {
  debug(category: string, message: string, data?: Record<string, unknown>): void;
  info(category: string, message: string, data?: Record<string, unknown>): void;
  warn(category: string, message: string, data?: Record<string, unknown>): void;
  error(category: string, message: string, data?: Record<string, unknown>): void;
}

// src/core/interfaces/context.ts
export interface RequestContext {
  requestId: string;
  startTime: number;
  url: string;
  executionContext?: ExecutionContext;
  debugEnabled: boolean;
  verboseEnabled: boolean;
  breadcrumbs: Breadcrumb[];
  diagnostics: DiagnosticsInfo;
  addBreadcrumb(category: string, message: string, data?: Record<string, unknown>): Breadcrumb;
  startTimedOperation(id: string, category: string): void;
  endTimedOperation(id: string): number;
}
```

### 2. Implement Service Registry Pattern

Create a service registry for runtime dependency resolution:

```typescript
// src/core/registry.ts
export class ServiceRegistry {
  private static instance: ServiceRegistry;
  private services: Map<string, unknown> = new Map();
  private factories: Map<string, () => unknown> = new Map();

  public static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
    }
    return ServiceRegistry.instance;
  }

  public register<T>(key: string, service: T): void {
    this.services.set(key, service);
  }

  public registerFactory<T>(key: string, factory: () => T): void {
    this.factories.set(key, factory);
  }

  public get<T>(key: string): T | undefined {
    // Check for cached instance first
    const service = this.services.get(key) as T;
    if (service) return service;
    
    // Try to create using factory if available
    const factory = this.factories.get(key) as (() => T) | undefined;
    if (factory) {
      const instance = factory();
      this.services.set(key, instance);
      return instance;
    }
    
    return undefined;
  }
  
  // For testing
  public reset(): void {
    this.services.clear();
    this.factories.clear();
  }
}
```

### 3. Create Factory Functions

Add factory functions to obtain implementations without direct imports:

```typescript
// src/factory/logger.ts
import { Logger } from '../core/interfaces/logger';
import { ServiceRegistry } from '../core/registry';

export function getLogger(): Logger {
  const registry = ServiceRegistry.getInstance();
  const logger = registry.get<Logger>('logger');
  
  if (logger) return logger;
  
  // Fallback console logger
  return {
    debug: (category, message, data) => console.debug(`[${category}] ${message}`, data || {}),
    info: (category, message, data) => console.info(`[${category}] ${message}`, data || {}),
    warn: (category, message, data) => console.warn(`[${category}] ${message}`, data || {}),
    error: (category, message, data) => console.error(`[${category}] ${message}`, data || {})
  };
}

// src/factory/context.ts
import { RequestContext } from '../core/interfaces/context';
import { ServiceRegistry } from '../core/registry';

export function getCurrentContext(): RequestContext | undefined {
  const registry = ServiceRegistry.getInstance();
  return registry.get<() => RequestContext | undefined>('contextProvider')?.();
}
```

### 4. Register Services at Application Startup

Initialize the service registry at application startup:

```typescript
// src/index.ts (partial)
import { ServiceRegistry } from './core/registry';
import { LoggerImpl } from './utils/logger-impl';
import { RequestContextProvider } from './utils/request-context-provider';
import { ConfigurationProvider } from './config/configuration-provider';

function initializeServices() {
  const registry = ServiceRegistry.getInstance();
  
  // Register core services
  registry.register('logger', new LoggerImpl());
  registry.register('contextProvider', () => RequestContextProvider.getCurrentContext());
  registry.register('configProvider', new ConfigurationProvider());
  
  // Register factory functions for more complex services
  registry.registerFactory('transformationService', () => new TransformationServiceImpl());
  registry.registerFactory('pathMatchingService', () => new PathMatchingServiceImpl());
}

// Call during worker initialization
initializeServices();
```

### 5. Refactor Services Incrementally

For each service that currently has circular dependencies:

1. Define its interface in the core layer
2. Create adapter class implementing the interface
3. Update service to use dependencies via factories

Example refactoring for part of TransformationService:

```typescript
// Before - with circular dependencies
import { logDebug } from '../utils/loggerUtils';
import { getCurrentContext } from '../utils/requestContext';

export async function prepareVideoTransformation(request, options, pathPatterns) {
  try {
    const { getCurrentContext } = await import('../utils/requestContext');
    const context = getCurrentContext();
    // ...implementation
  } catch (err) {
    // Error handling
  }
}

// After - using dependency inversion
import { Logger } from '../core/interfaces/logger';
import { RequestContext } from '../core/interfaces/context';
import { PathMatchingService } from '../core/interfaces/path-matcher';
import { getLogger } from '../factory/logger';
import { getCurrentContext } from '../factory/context';
import { getPathMatchingService } from '../factory/path-matcher';

export function prepareVideoTransformation(
  request: Request,
  options: VideoTransformOptions,
  pathPatterns: PathPattern[]
): TransformationResult {
  const logger = getLogger();
  const context = getCurrentContext();
  const pathMatcher = getPathMatchingService();
  
  try {
    // Use injected services
    logger.debug('TransformationService', 'Preparing transformation', { options });
    
    if (context) {
      context.addBreadcrumb('Transform', 'Preparing video transformation');
    }
    
    // Find matching pattern using service instead of direct utility
    const matchingPattern = pathMatcher.findMatchingPattern(request.url, pathPatterns);
    
    // ... rest of implementation
  } catch (error) {
    // Error handling
    logger.error('TransformationService', 'Error preparing transformation', { error });
    throw error;
  }
}
```

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)

1. **Days 1-2: Create Core Interfaces**
   - Define all core interfaces in `/src/core/interfaces`
   - Create basic type definitions in `/src/core/types`
   - Implement service registry and factory functions

2. **Days 3-5: Implement Foundation Services**
   - Create concrete implementations for Logger, ErrorHandler
   - Implement RequestContext provider
   - Build tests for core infrastructure

### Phase 2: Refactor Essential Services (Week 2)

1. **Days 1-2: Configuration Layer**
   - Update configuration managers to implement interfaces
   - Create factories for configuration access
   - Refactor configuration loading logic

2. **Days 3-5: Core Utils Refactoring**
   - Refactor path utilities to use interfaces
   - Update transformation utilities
   - Implement caching services with new structure

### Phase 3: Domain and Handlers (Week 3)

1. **Days 1-3: Domain Layer**
   - Update TransformVideoCommand to use interface-based dependencies
   - Refactor strategy implementations
   - Fix remaining dynamic imports in domain logic

2. **Days 4-5: Handler Layer**
   - Refactor request handlers to use new architecture
   - Update service initialization in index.ts
   - Ensure proper dependency flow

### Phase 4: Testing and Cleanup (Week 4)

1. **Days 1-3: Comprehensive Testing**
   - Create unit tests for all refactored components
   - Add integration tests for end-to-end flows
   - Test service resolution and dependency injection

2. **Days 4-5: Cleanup and Documentation**
   - Remove remaining dynamic imports
   - Update architecture documentation
   - Create diagrams showing new dependency flow

## Testing Strategy

1. **Unit Testing**:
   - Test each factory function
   - Verify service registry functions correctly
   - Test concrete implementations against their interfaces

2. **Integration Testing**:
   - Test the complete request flow with mocked dependencies
   - Verify proper service resolution
   - Test with simulated failures to ensure proper fallbacks

3. **Mocking Approach**:
   - Use service registry to inject mocks during tests
   - Create specialized test implementations of interfaces
   - Add registry reset capability for test isolation

## Expected Benefits

1. **Performance Improvements**:
   - Elimination of dynamic import latency
   - More predictable cold start times
   - Reduced memory usage from optimized dependency loading

2. **Enhanced Maintainability**:
   - Clear dependency structure
   - Better code organization
   - Easier to understand component relationships

3. **Improved Testability**:
   - Simple mocking through interfaces
   - Better test isolation
   - More reliable test coverage

4. **Easier Future Development**:
   - Clear extension points
   - Better service composition
   - Follows established design patterns

## Risks and Mitigations

| Risk | Description | Mitigation |
|------|-------------|------------|
| Regression | Breaking existing functionality | Comprehensive testing strategy with high coverage |
| Performance Impact | New abstraction layer could add overhead | Benchmark before/after and optimize as needed |
| Implementation Complexity | Significant refactoring required | Incremental approach with continuous testing |
| Timeline | May take longer than expected | Prioritize most critical dependencies first |

## Conclusion

This dependency inversion approach will provide a solid foundation for the Video Resizer codebase. By establishing clear interfaces and proper dependency flow, we'll eliminate circular dependencies and set the stage for easier implementation of the path matching service and other architectural improvements.