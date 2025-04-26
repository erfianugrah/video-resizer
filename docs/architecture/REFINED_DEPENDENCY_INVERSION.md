# Refined Dependency Inversion Strategy

This document outlines our refined strategy for addressing circular dependencies in the Video Resizer codebase while creating a more maintainable, testable architecture.

## Key Enhancements to Original Plan

After thorough analysis of our codebase and dependency challenges, we've identified several critical refinements needed to ensure our approach is robust and sustainable.

### 1. Service Lifecycle Management

Different services require different lifecycle patterns: some should be singletons, others created per-request, and some created fresh each time they're needed.

```typescript
export enum ServiceLifecycle {
  SINGLETON, // One instance shared across the application 
  SCOPED,    // One instance per request scope
  TRANSIENT  // New instance each time requested
}

export class ServiceRegistry {
  // Original functionality plus:
  private scopedInstances: Map<string, Map<string, unknown>> = new Map();
  
  public registerFactory<T>(
    key: string, 
    factory: () => T, 
    lifecycle: ServiceLifecycle = ServiceLifecycle.SINGLETON,
    dependencies: string[] = []
  ): void {
    // Store factory with metadata about dependencies and lifecycle
    this.factories.set(key, {
      factory,
      lifecycle,
      dependencies
    });
    
    // Update initialization order if needed
    this.calculateInitOrder();
  }
  
  // Methods for managing scoped services
  public createScope(scopeId: string): void {
    this.scopedInstances.set(scopeId, new Map());
  }
  
  public getFromScope<T>(scopeId: string, key: string): T | undefined {
    const scope = this.scopedInstances.get(scopeId);
    if (!scope) return undefined;
    return scope.get(key) as T;
  }
  
  public registerInScope<T>(scopeId: string, key: string, instance: T): void {
    const scope = this.scopedInstances.get(scopeId);
    if (scope) {
      scope.set(key, instance);
    }
  }
  
  public disposeScope(scopeId: string): void {
    // Clean up any resources before removing
    const scope = this.scopedInstances.get(scopeId);
    if (scope) {
      // Call dispose method on services that support it
      for (const [_, service] of scope.entries()) {
        if (typeof (service as any).dispose === 'function') {
          (service as any).dispose();
        }
      }
      this.scopedInstances.delete(scopeId);
    }
  }
}
```

### 2. Dependency-Aware Initialization

Proper initialization order ensures dependencies are available when needed:

```typescript
export class ServiceRegistry {
  // Original properties plus:
  private initializationOrder: string[] = [];
  private initializing: Set<string> = new Set();
  
  public async initializeServices(): Promise<void> {
    this.calculateInitOrder();
    
    for (const serviceKey of this.initializationOrder) {
      // Initialize services in proper dependency order
      await this.getOrCreate(serviceKey);
    }
  }
  
  private calculateInitOrder(): void {
    // Reset initialization order
    this.initializationOrder = [];
    
    // Perform topological sort of service dependencies
    const visited = new Set<string>();
    const temp = new Set<string>();
    
    // Visit all services
    for (const key of this.factories.keys()) {
      if (!visited.has(key)) {
        this.visitNode(key, visited, temp);
      }
    }
  }
  
  private visitNode(
    node: string, 
    visited: Set<string>, 
    temp: Set<string>
  ): void {
    // Check for circular dependencies
    if (temp.has(node)) {
      throw new Error(`Circular dependency detected: ${node}`);
    }
    
    // Skip already visited nodes
    if (visited.has(node)) return;
    
    // Mark as being processed
    temp.add(node);
    
    // Visit dependencies first
    const metadata = this.factories.get(node);
    if (metadata && metadata.dependencies) {
      for (const dep of metadata.dependencies) {
        this.visitNode(dep, visited, temp);
      }
    }
    
    // Mark as visited and add to initialization order
    temp.delete(node);
    visited.add(node);
    this.initializationOrder.push(node);
  }
  
  private async getOrCreate<T>(key: string): Promise<T | undefined> {
    // Check for cached instance first
    const cachedInstance = this.services.get(key) as T;
    if (cachedInstance) return cachedInstance;
    
    // Check if we're already initializing this service (circular dependency check)
    if (this.initializing.has(key)) {
      throw new Error(`Circular dependency detected during initialization: ${key}`);
    }
    
    // Get factory metadata
    const metadata = this.factories.get(key);
    if (!metadata) return undefined;
    
    // Mark as initializing
    this.initializing.add(key);
    
    try {
      // Initialize dependencies first if needed
      for (const dep of metadata.dependencies) {
        await this.getOrCreate(dep);
      }
      
      // Create instance
      const instance = await metadata.factory();
      
      // Cache instance if it's a singleton
      if (metadata.lifecycle === ServiceLifecycle.SINGLETON) {
        this.services.set(key, instance);
      }
      
      return instance as T;
    } finally {
      // Always remove from initializing set
      this.initializing.delete(key);
    }
  }
}
```

### 3. Request Context Management

Special handling for request-scoped services:

```typescript
export function createRequestScope(request: Request, ctx?: ExecutionContext): string {
  const scopeId = crypto.randomUUID();
  const registry = ServiceRegistry.getInstance();
  
  // Create new scope in registry
  registry.createScope(scopeId);
  
  // Create request-scoped services
  const requestContext = new RequestContextImpl(request, ctx);
  registry.registerInScope(scopeId, 'requestContext', requestContext);
  
  // Create other request-scoped services
  const logger = new LoggerImpl(requestContext);
  registry.registerInScope(scopeId, 'logger', logger);
  
  // Store scope ID in a global context for this request
  (globalThis as any).__CURRENT_SCOPE_ID = scopeId;
  
  return scopeId;
}

export function getCurrentScopeId(): string | undefined {
  return (globalThis as any).__CURRENT_SCOPE_ID;
}

export function disposeRequestScope(scopeId: string): void {
  const registry = ServiceRegistry.getInstance();
  registry.disposeScope(scopeId);
  
  if ((globalThis as any).__CURRENT_SCOPE_ID === scopeId) {
    delete (globalThis as any).__CURRENT_SCOPE_ID;
  }
}

// Updated factory functions to use current scope
export function getLogger(): Logger {
  const registry = ServiceRegistry.getInstance();
  const scopeId = getCurrentScopeId();
  
  if (scopeId) {
    const scopedLogger = registry.getFromScope<Logger>(scopeId, 'logger');
    if (scopedLogger) return scopedLogger;
  }
  
  // Fall back to singleton or default logger
  return registry.get<Logger>('logger') || createDefaultLogger();
}
```

### 4. Worker Integration

Integration with Cloudflare Workers requires careful handling of the execution context:

```typescript
// Singleton flag to track initialization
let initialized = false;

export default {
  async fetch(request: Request, env: EnvVariables, ctx: ExecutionContext): Promise<Response> {
    // On first request, initialize singleton services
    if (!initialized) {
      await bootstrapServices(env);
      initialized = true;
    }
    
    // Create request scope and get scope ID
    const scopeId = createRequestScope(request, ctx);
    
    try {
      // Use handler factory to get the appropriate handler for this request
      const handlerFactory = getHandlerFactory();
      const handler = handlerFactory.createHandler(request);
      
      // Pass scope ID to handler
      return await handler.handleRequest({ 
        request, 
        env, 
        ctx, 
        scopeId 
      });
    } catch (error) {
      // Use error handling service
      const errorHandler = getErrorHandler();
      return await errorHandler.handleError(error, request, scopeId);
    } finally {
      // Always clean up request scope to prevent memory leaks
      disposeRequestScope(scopeId);
    }
  }
}

// Bootstrap all services with proper error handling
async function bootstrapServices(env: EnvVariables): Promise<void> {
  try {
    // Register environment in registry
    const registry = ServiceRegistry.getInstance();
    registry.register('environment', env);
    
    // Register essential services
    registerCoreServices();
    registerConfigServices();
    registerDomainServices();
    registerHandlers();
    
    // Initialize all services in proper order
    await registry.initializeServices();
    
    console.log('Services initialized successfully');
  } catch (error) {
    console.error('Error during service initialization:', error);
    throw error; // Re-throw to fail worker initialization
  }
}
```

### 5. Enhanced Testing Support

Specialized tools for testing the new architecture:

```typescript
export class TestServiceRegistry extends ServiceRegistry {
  public mockService<T>(key: string, mockImpl: T): void {
    this.register(key, mockImpl);
  }
  
  public simulateServiceFailure(key: string, error?: Error): void {
    const errorToThrow = error || new Error(`Simulated failure for ${key}`);
    this.registerFactory(key, () => { throw errorToThrow; });
  }
  
  public getRegisteredKeys(): string[] {
    return [...this.services.keys(), ...this.factories.keys()];
  }
  
  public clearAll(): void {
    this.services.clear();
    this.factories.clear();
    this.scopedInstances.clear();
    this.initializationOrder = [];
  }
}

// Testing helper to set up an isolated test environment
export function setupTestEnvironment(): TestEnvironment {
  // Store original registry
  const originalRegistry = ServiceRegistry.instance;
  
  // Create new test registry
  const testRegistry = new TestServiceRegistry();
  (ServiceRegistry as any).instance = testRegistry;
  
  return {
    registry: testRegistry,
    
    // Mock a service implementation
    mockService: <T>(key: string, implementation: T) => {
      testRegistry.mockService(key, implementation);
      return implementation;
    },
    
    // Create a test request scope
    createTestScope: () => {
      const scopeId = `test-${crypto.randomUUID()}`;
      testRegistry.createScope(scopeId);
      (globalThis as any).__CURRENT_SCOPE_ID = scopeId;
      return scopeId;
    },
    
    // Clean up the test environment
    teardown: () => {
      // Restore original registry
      (ServiceRegistry as any).instance = originalRegistry;
      delete (globalThis as any).__CURRENT_SCOPE_ID;
    }
  };
}
```

## Implementation Journey

### Phase 0: Preparation and Analysis (1 week)

Before beginning implementation, we need to fully understand the codebase:

1. **Dependency Mapping**
   - Create complete dependency graph of the codebase
   - Identify all circular reference chains
   - Document service responsibilities and lifetimes
   - Prioritize services to migrate

2. **Performance Benchmarking**
   - Establish baseline performance metrics
   - Profile request handling latency
   - Measure cold-start times
   - Create performance test suite

3. **Documentation**
   - Create interface specifications for all services
   - Document expected behavior and contracts
   - Establish naming conventions and patterns
   - Create architecture diagrams

### Phase 1: Foundation Building (2 weeks)

1. **Core Infrastructure**
   - Implement enhanced ServiceRegistry with lifecycle management
   - Build request scope management system
   - Create interface definitions for all core services
   - Develop factory functions

2. **Service Discovery System**
   - Implement dynamic service resolution
   - Create initialization ordering system
   - Build startup sequence
   - Implement error handling for service resolution

3. **Testing Infrastructure**
   - Create TestServiceRegistry
   - Build mocking utilities
   - Implement test environment helpers
   - Create isolated test patterns

### Phase 2: Migration Strategy (3 weeks)

Our migration approach focuses on incrementally replacing dependencies while ensuring system stability:

1. **Migration Path for Each Service**:
   1. Define interface in core module
   2. Create adapter that implements interface but uses existing code
   3. Register adapter with ServiceRegistry
   4. Update factory functions to use registry
   5. Replace direct imports with factory functions
   6. Refactor implementation to follow clean architecture

2. **Migration Order**
   1. **Foundation Layer** (Week 1)
      - Logger implementation
      - RequestContext provider
      - Error handling utilities
   
   2. **Configuration Layer** (Week 1-2)
      - ConfigurationManager interfaces
      - Environment config providers
      - Feature flags system
   
   3. **Utility Layer** (Week 2)
      - Path utilities
      - Transformation utilities
      - Caching utilities
   
   4. **Domain Layer** (Week 2-3)
      - Strategy implementations
      - Command implementations
      - Service implementations
   
   5. **Handler Layer** (Week 3)
      - Request handlers
      - Error handlers
      - Main entry point

3. **Parallel Validation Approach**
   - Each service is initially migrated with both implementations active
   - Output from both implementations is compared to verify consistency
   - Performance metrics are captured to ensure no regressions
   - Only when validated is the old implementation removed

### Phase 3: Validation and Optimization (2 weeks)

1. **Comprehensive Testing**
   - Verify all services work with new architecture
   - Test error handling and recovery
   - Validate initialization sequence
   - Test with simulated failures

2. **Performance Optimization**
   - Measure cold start times
   - Optimize initialization sequence
   - Identify and fix bottlenecks
   - Implement lazy loading where appropriate

3. **Documentation and Training**
   - Document new architecture
   - Create service reference documentation
   - Establish patterns for future development
   - Provide examples for common scenarios

## Risk Management

| Risk | Mitigation Strategy |
|------|---------------------|
| Subtle behavior changes | Run parallel implementations, compare outputs |
| Performance regression | Continuous benchmarking during development |
| Increased complexity | Comprehensive documentation, patterns library |
| Inconsistent adoption | Linting rules to enforce new patterns |
| Extended timeline | Prioritize critical paths, incremental value |
| Lost context during refactoring | Pair programming, frequent reviews |
| Service resolution failures | Detailed error messages, fallback mechanisms |
| Production issues | Feature flag system to disable new architecture |

## Conclusion

This refined dependency inversion strategy addresses the key challenges in our codebase, providing a clear path to eliminating circular dependencies while creating a more maintainable, testable architecture. 

The key advantages of this approach:

1. **Proper Lifecycle Management**: Different services have different lifecycle needs (singleton vs. request-scoped)
2. **Initialization Ordering**: Ensures dependencies are available when needed
3. **Request-Scoped Services**: Clean handling of per-request state
4. **Enhanced Testability**: Sophisticated mocking and testing capabilities
5. **Performance Optimization**: Careful attention to cold-start and runtime performance

By following this implementation plan, we will not only resolve our immediate circular dependency issues but also establish a solid foundation for future architectural improvements including the path matching service enhancement and error handling completion.\n## Original Dependency Inversion Plan\n
> Historical document - included for context\n
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