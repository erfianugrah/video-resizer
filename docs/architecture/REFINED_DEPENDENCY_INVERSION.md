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

By following this implementation plan, we will not only resolve our immediate circular dependency issues but also establish a solid foundation for future architectural improvements including the path matching service enhancement and error handling completion.