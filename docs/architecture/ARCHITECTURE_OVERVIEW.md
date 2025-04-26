# Video Resizer Architecture Overview

## System Architecture

The Video Resizer is a Cloudflare Worker application that transforms video URLs to use Cloudflare's Media Transformation API. It follows a modern, service-oriented architecture with clearly defined layers and responsibilities.

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TB
    subgraph Request Flow
        A[Client Request] --> B[Edge Request Handler]
        B --> |Path Matching| C[videoHandler]
        C --> |Command Pattern| D[TransformVideoCommand]
        D --> |Strategy Pattern| E{Mode?}
        E --> |video| V[VideoStrategy]
        E --> |frame| F[FrameStrategy]
        E --> |spritesheet| S[SpritesheetStrategy]
        V & F & S --> P[Transform Response]
        P --> |Cache Check| Q{Cached?}
        Q --> |Yes| R[Cache Hit Response]
        Q --> |No| T[Transform & Cache]
        T --> R
        R --> Z[Client Response]
    end
    
    subgraph Configuration
        CM1[VideoConfigurationManager]
        CM2[CacheConfigurationManager]
        CM3[DebugConfigurationManager]
        CM4[LoggingConfigurationManager]
        CM1 & CM2 & CM3 & CM4 --> |Provides| CONFIG[Runtime Configuration]
    end
    
    subgraph Services
        SVC1[VideoTransformationService]
        SVC2[CacheManagementService]
        SVC3[DebugService]
        SVC4[VideoStorageService]
        SVC5[ErrorHandlerService]
    end
    
    D --> SVC1
    D --> SVC2
    Q --> SVC2
    T --> SVC2
    D --> SVC3
    D --> SVC4
    D --> SVC5
    
    CONFIG --> D
    CONFIG --> SVC1
    CONFIG --> SVC2
    CONFIG --> SVC3
    CONFIG --> SVC4
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style Z fill:#5D8AA8,stroke:#333,stroke-width:2px
```

## Core Components

### 1. Configuration Layer

The configuration system provides strongly-typed, validated access to all settings using Zod schemas.

#### Configuration Managers

Each manager is a singleton class that handles a specific area of configuration:

```typescript
// Example configuration manager
export class VideoConfigurationManager {
  private static instance: VideoConfigurationManager | null = null;
  private config: VideoConfig;
  
  public static getInstance(): VideoConfigurationManager {
    if (!VideoConfigurationManager.instance) {
      VideoConfigurationManager.instance = new VideoConfigurationManager();
    }
    return VideoConfigurationManager.instance;
  }
  
  // Configuration access methods
  public getDerivative(name: string): VideoDerivative | null {
    return this.config.derivatives[name] || null;
  }
  
  public isValidOption(param: string, value: string): boolean {
    // Validation implementation
  }
  
  // Configuration update methods
  public updateConfigFromKV(kvConfig: Partial<VideoConfig>): void {
    // Validation and update logic
  }
}
```

#### Multi-Layer Configuration

Configuration is loaded from multiple sources with clear precedence:

1. **Default Values**: Hardcoded in manager classes
2. **Wrangler Config**: From `wrangler.jsonc` 
3. **Environment Variables**: Override during runtime
4. **KV Storage**: Dynamic updates without redeployment

### 2. Domain Layer

The domain layer implements core business logic through the command and strategy patterns.

#### Command Pattern

The `TransformVideoCommand` implements the command pattern to encapsulate video transformation logic:

```typescript
export class TransformVideoCommand {
  private transformationService: VideoTransformationService;
  private cacheService: CacheManagementService;
  private debugService: DebugService;
  
  constructor(services: ServiceDependencies) {
    // Initialize services
  }
  
  public async execute(request: Request): Promise<Response> {
    // Command execution logic:
    // 1. Parse request
    // 2. Validate parameters
    // 3. Select appropriate strategy
    // 4. Execute transformation
    // 5. Handle caching
    // 6. Return response
  }
}
```

#### Strategy Pattern

The strategy pattern handles different transformation modes:

```typescript
// Strategy interface
interface TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams;
  validateOptions(options: VideoTransformOptions): void | Promise<void>;
  updateDiagnostics(context: TransformationContext): void;
}

// Concrete strategies
class VideoStrategy implements TransformationStrategy { /* implementation */ }
class FrameStrategy implements TransformationStrategy { /* implementation */ }
class SpritesheetStrategy implements TransformationStrategy { /* implementation */ }

// Strategy factory
class StrategyFactory {
  static createStrategy(mode: string): TransformationStrategy {
    switch (mode) {
      case 'frame': return new FrameStrategy();
      case 'spritesheet': return new SpritesheetStrategy();
      default: return new VideoStrategy();
    }
  }
}
```

### 3. Service Layer

The service layer provides reusable, specialized functionality for the domain layer.

#### Core Services

```typescript
// Video transformation service
export class VideoTransformationService {
  public buildTransformUrl(params: TransformParams): string {
    // Create Cloudflare Media Transformation URL
  }
  
  public async transformVideo(
    request: Request, 
    options: VideoTransformOptions
  ): Promise<Response> {
    // Transformation implementation
  }
}

// Cache management service
export class CacheManagementService {
  public async getCachedResponse(request: Request): Promise<Response | null> {
    // Cache retrieval implementation
  }
  
  public async cacheResponse(
    request: Request, 
    response: Response
  ): Promise<Response> {
    // Cache storage implementation
  }
}
```

#### Error Handling

Centralized error handling through specialized error classes:

```typescript
// Base error class
export class VideoTransformError extends Error {
  public readonly statusCode: number;
  public readonly errorType: string;
  public readonly details: Record<string, any>;
  
  constructor(message: string, options: ErrorOptions) {
    super(message);
    // Initialize error properties
  }
}

// Specialized error classes
export class ValidationError extends VideoTransformError { /* ... */ }
export class ProcessingError extends VideoTransformError { /* ... */ }
export class ConfigurationError extends VideoTransformError { /* ... */ }
export class NotFoundError extends VideoTransformError { /* ... */ }
```

### 4. Utilities Layer

Reusable utility functions organized by domain:

- **pathUtils.ts**: URL and path handling
- **cacheUtils.ts**: Caching utilities
- **transformationUtils.ts**: Shared transformation functions
- **loggerUtils.ts**: Structured logging utilities
- **errorHandlingUtils.ts**: Error processing and formatting

### 5. Handler Layer

Handles HTTP requests and orchestrates the execution of commands:

```typescript
// Video handler
export async function videoHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    // Initialize services
    const services = await initializeServices(env);
    
    // Create and execute command
    const command = new TransformVideoCommand(services);
    return await command.execute(request);
  } catch (error) {
    // Error handling
    return createErrorResponse(error);
  }
}
```

## Request Flow

The request flow through the system follows these steps:

1. **Request Entry**: Cloudflare Worker receives the request
2. **Path Matching**: URL is matched against configured path patterns
3. **Parameter Extraction**: URL parameters and path captures are processed
4. **Strategy Selection**: Based on mode (video, frame, spritesheet)
5. **Cache Check**: Check if transformed response is already cached
6. **Transformation**: If needed, transform video using Cloudflare Media API
7. **Caching**: Cache the response for future requests
8. **Response**: Return the transformed video to the client

## Caching Architecture

The caching system has a multi-layer design:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    A[Client Request] --> B{KV Cache?}
    B -->|Yes| C[KV Lookup]
    B -->|No| D{CF Cache?}
    
    C -->|Hit| E[Return KV Response]
    C -->|Miss| D
    
    D -->|Hit| F[Return CF Response]
    D -->|Miss| G[Transform Video]
    
    G --> H[Cache Response]
    H --> I[Return Response]
    
    E & F & I --> J[Client Response]
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style J fill:#5D8AA8,stroke:#333,stroke-width:2px
    style C fill:#F8B229,stroke:#333,stroke-width:2px
    style F fill:#F8B229,stroke:#333,stroke-width:2px
    style H fill:#F8B229,stroke:#333,stroke-width:2px
```

### Cache Layers

1. **KV Cache**: Cloudflare KV storage for transformed video variants
   - Configurable TTL for different status codes
   - Global namespace with key structure: `url:options:hash`
   - Best for high-reuse transformations
   
2. **Cloudflare Cache**: Built-in HTTP caching
   - Configured through Cache-Control headers
   - Content-based caching using ETag and If-None-Match
   - Automatic edge distribution
   
3. **Browser Cache**: Client-side caching
   - Controlled through Cache-Control headers
   - Suitable for static transformations

## Debugging Architecture

The debug system provides comprehensive insights into request processing:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart LR
    A[Client Request with\ndebug parameter] --> B[Debug Mode Activated]
    B --> C[Collect Diagnostics]
    C --> D{View Mode?}
    
    D -->|Yes| E[Debug UI]
    D -->|No| F[Debug Headers]
    
    E & F --> G[Client Response\nwith Debug Info]
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style G fill:#5D8AA8,stroke:#333,stroke-width:2px
```

### Debug Features

1. **Debug UI**: Interactive dashboard for detailed request analysis
2. **Debug Headers**: Debug information in response headers
3. **Breadcrumb Trail**: Sequential tracking of request flow
4. **Performance Metrics**: Timing for key operations
5. **Configuration Dump**: Current applied configuration

## Storage Integration

The system supports multiple storage backends for video content:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    A[Content Request] --> B[Storage Service]
    
    B --> C{Storage Priority}
    
    C -->|1st| D[R2 Storage]
    C -->|2nd| E[Remote Storage]
    C -->|3rd| F[Fallback Storage]
    
    D -->|Found| G[Return Content]
    D -->|Not Found| E
    
    E -->|Found| G
    E -->|Not Found| F
    
    F -->|Found| G
    F -->|Not Found| H[Not Found Error]
    
    G & H --> I[Response]
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style I fill:#5D8AA8,stroke:#333,stroke-width:2px
```

### Storage Options

1. **Cloudflare R2**: Primary storage for video content
2. **Remote URL**: Secondary HTTP-based storage
3. **Fallback URL**: Last-resort storage location
4. **AWS S3**: Compatible with S3-compatible storage via SigV4 signing

## Design Evolution

The architecture has evolved through several phases:

### Phase 1: Initial Implementation

- Basic functionality with minimal structure
- Simple transform options
- Limited error handling

### Phase 2: Service Architecture

- Introduced command pattern
- Added service layer
- Improved configuration system

### Phase 3: Current Architecture

- Full strategy pattern implementation
- Advanced configuration with Zod
- Comprehensive error handling
- Cache optimization
- Storage abstraction
- Debug UI integration

### Phase 4: Future Direction

- Further dependency inversion
- Unified origins system
- Expanded transform options
- Enhanced metrics and observability

## Development Patterns

### Dependency Management

Services are initialized centrally and injected into the command:

```typescript
async function initializeServices(env: Env): Promise<ServiceDependencies> {
  return {
    transformationService: new VideoTransformationService(env),
    cacheService: new CacheManagementService(env),
    debugService: new DebugService(env),
    videoStorageService: new VideoStorageService(env),
    errorHandlerService: new ErrorHandlerService(env)
  };
}
```

### Testing Approach

- Unit tests for individual components
- Integration tests for service interactions
- End-to-end tests for request flow
- Parameterized tests for transformation options
- Mock services for isolation

## Conclusion

The Video Resizer architecture follows modern software design principles:

- **Separation of Concerns**: Clear layer boundaries
- **Single Responsibility**: Focused components
- **Open/Closed Principle**: Extensible through strategies
- **Dependency Inversion**: Service injection
- **Command Pattern**: Encapsulation of business logic
- **Strategy Pattern**: Polymorphic transformation behavior

This architecture provides a solid foundation for future enhancements while maintaining maintainability and testability.