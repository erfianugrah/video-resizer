# Design Patterns in Video Resizer

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [Strategy Pattern](#strategy-pattern)
  - [Implementation](#strategy-implementation)
  - [Benefits](#strategy-benefits)
  - [Adding New Strategies](#adding-new-strategies)
- [Command Pattern](#command-pattern)
  - [Implementation](#command-implementation)
  - [Benefits](#command-benefits)
- [Factory Pattern](#factory-pattern)
  - [Implementation](#factory-implementation)
  - [Benefits](#factory-benefits)
- [Singleton Pattern](#singleton-pattern)
  - [Implementation](#singleton-implementation)
  - [Benefits](#singleton-benefits)
- [Dependency Injection](#dependency-injection)
  - [Implementation](#dependency-injection-implementation)
  - [Benefits](#dependency-injection-benefits)
- [Conclusion](#conclusion)

## Overview

The Video Resizer uses several design patterns to create a maintainable, extensible, and testable architecture. This document provides detailed information on the key patterns used and their implementation.

## Strategy Pattern

The Strategy pattern allows different algorithms (transformation modes in our case) to be defined, encapsulated, and made interchangeable. This pattern is fundamental to the Video Resizer's ability to handle different transformation modes.

### Strategy Implementation

The Strategy pattern consists of these key components:

1. **Strategy Interface**: Defines the common interface for all concrete strategies

```typescript
export interface TransformationStrategy {
  /**
   * Prepare parameters for this specific transformation strategy
   * @param context The transformation context
   * @returns The prepared CDN parameters
   */
  prepareTransformParams(context: TransformationContext): TransformParams;
  
  /**
   * Validate the options for this strategy
   * @param options The transformation options
   * @throws Error if options are invalid
   */
  validateOptions(options: VideoTransformOptions): void | Promise<void>;
  
  /**
   * Update diagnostics information with strategy-specific details
   * @param context The transformation context
   */
  updateDiagnostics(context: TransformationContext): void;
}
```

2. **Concrete Strategies**: Implement specific transformation modes

```typescript
// Video strategy implementation
export class VideoStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    
    // Extract and prepare video-specific parameters
    const params: TransformParams = {
      mode: 'video',
      width: options.width || null,
      height: options.height || null,
      fit: options.fit || 'contain',
      // Additional video-specific parameters
      loop: options.loop,
      autoplay: options.autoplay,
      muted: options.muted,
      preload: options.preload
    };
    
    return params;
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // Validate video-specific options
    // e.g., check valid ranges for width/height
    // Check compatibility of playback parameters
  }
  
  updateDiagnostics(context: TransformationContext): void {
    // Add video-specific diagnostic information
    context.diagnosticsInfo.mode = 'video';
    context.diagnosticsInfo.playbackFeatures = {
      loop: context.options.loop,
      autoplay: context.options.autoplay,
      muted: context.options.muted
    };
  }
}

// Frame strategy implementation
export class FrameStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    
    // Frame mode requires a time parameter
    if (!options.time) {
      throw new ValidationError('Time parameter is required for frame mode');
    }
    
    // Extract and prepare frame-specific parameters
    const params: TransformParams = {
      mode: 'frame',
      width: options.width || null,
      height: options.height || null,
      fit: options.fit || 'contain',
      time: options.time,
      format: options.format || 'jpg'
    };
    
    return params;
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // Validate frame-specific options
    if (!options.time) {
      throw new ValidationError('Time parameter is required for frame mode');
    }
    
    // Reject video-specific parameters
    if (options.loop || options.autoplay || options.muted || options.preload) {
      throw new ValidationError('Playback parameters are not compatible with frame mode');
    }
  }
  
  updateDiagnostics(context: TransformationContext): void {
    // Add frame-specific diagnostic information
    context.diagnosticsInfo.mode = 'frame';
    context.diagnosticsInfo.frameDetails = {
      time: context.options.time,
      format: context.options.format || 'jpg'
    };
  }
}

// Spritesheet strategy implementation
export class SpritesheetStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    
    // Spritesheet mode requires width and height
    if (!options.width || !options.height) {
      throw new ValidationError('Width and height parameters are required for spritesheet mode');
    }
    
    // Extract and prepare spritesheet-specific parameters
    const params: TransformParams = {
      mode: 'spritesheet',
      width: options.width,
      height: options.height,
      fit: options.fit || 'contain',
      time: options.time || '0s',
      duration: options.duration || '10s'
    };
    
    return params;
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // Validate spritesheet-specific options
    if (!options.width || !options.height) {
      throw new ValidationError('Width and height parameters are required for spritesheet mode');
    }
    
    // Reject video-specific parameters
    if (options.loop || options.autoplay || options.muted || options.preload) {
      throw new ValidationError('Playback parameters are not compatible with spritesheet mode');
    }
  }
  
  updateDiagnostics(context: TransformationContext): void {
    // Add spritesheet-specific diagnostic information
    context.diagnosticsInfo.mode = 'spritesheet';
    context.diagnosticsInfo.spritesheetDetails = {
      time: context.options.time || '0s',
      duration: context.options.duration || '10s',
      aspectRatio: (context.options.width || 0) / (context.options.height || 1)
    };
  }
}
```

3. **Transformation Context**: Object that provides all needed information to strategies

```typescript
export interface TransformationContext {
  request: Request;
  options: VideoTransformOptions;
  pathPattern: PathPattern;
  url: URL;
  path: string;
  diagnosticsInfo: DiagnosticsInfo;
  env?: { 
    ASSETS?: { 
      fetch: (request: Request) => Promise<Response> 
    } 
  };
}
```

### Strategy Benefits

The Strategy pattern provides several key benefits:

1. **Separation of Concerns**: Each strategy handles only its specific mode
2. **Encapsulation**: Mode-specific logic is contained within its strategy
3. **Extensibility**: New modes can be added by creating new strategies
4. **Maintainability**: Changes to one mode don't affect others
5. **Testability**: Each strategy can be tested in isolation

### Adding New Strategies

To add a new transformation mode, such as a GIF mode:

```typescript
export class GifStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    
    // Prepare GIF-specific parameters
    const params: TransformParams = {
      mode: 'gif',
      width: options.width || null,
      height: options.height || null,
      fit: options.fit || 'contain',
      duration: options.duration || '3s',
      frameRate: options.frameRate || 10
    };
    
    return params;
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // Validate GIF-specific options
    if (options.duration && parseDuration(options.duration) > 10) {
      throw new ValidationError('GIF duration must be less than 10 seconds');
    }
  }
  
  updateDiagnostics(context: TransformationContext): void {
    // Add GIF-specific diagnostic information
    context.diagnosticsInfo.mode = 'gif';
    context.diagnosticsInfo.gifDetails = {
      duration: context.options.duration || '3s',
      frameRate: context.options.frameRate || 10
    };
  }
}
```

Then update the factory:

```typescript
// Update factory
export class StrategyFactory {
  static createStrategy(mode: string): TransformationStrategy {
    switch (mode) {
      case 'frame':
        return new FrameStrategy();
      case 'spritesheet':
        return new SpritesheetStrategy();
      case 'gif':
        return new GifStrategy();
      case 'video':
      default:
        return new VideoStrategy();
    }
  }
}
```

## Command Pattern

The Command pattern encapsulates a request as an object, allowing parameterization of clients with different requests, queue or log requests, and support undoable operations.

### Command Implementation

The Command pattern is implemented through the `TransformVideoCommand` class:

```typescript
export class TransformVideoCommand {
  private readonly transformationService: VideoTransformationService;
  private readonly cacheService: CacheManagementService;
  private readonly debugService: DebugService;
  private readonly videoStorageService: VideoStorageService;
  private readonly errorHandlerService: ErrorHandlerService;
  
  constructor(services: ServiceDependencies) {
    this.transformationService = services.transformationService;
    this.cacheService = services.cacheService;
    this.debugService = services.debugService;
    this.videoStorageService = services.videoStorageService;
    this.errorHandlerService = services.errorHandlerService;
  }
  
  public async execute(request: Request): Promise<Response> {
    // Create diagnostic information for debugging
    const diagnosticsInfo: DiagnosticsInfo = { 
      timestamp: Date.now(),
      requestUrl: request.url
    };
    
    try {
      // 1. Parse request URL
      const url = new URL(request.url);
      const path = url.pathname;
      
      // 2. Match path pattern
      const pathPattern = this.findMatchingPathPattern(path);
      if (!pathPattern || !pathPattern.processPath) {
        return this.videoStorageService.fetchOriginalVideo(request);
      }
      
      // 3. Extract options from URL and query parameters
      const options = this.parseOptions(url, pathPattern);
      
      // 4. Get appropriate strategy based on mode
      const mode = options.mode || 'video';
      const strategy = StrategyFactory.createStrategy(mode);
      
      // 5. Validate options using the strategy
      await strategy.validateOptions(options);
      
      // 6. Create transformation context
      const context: TransformationContext = {
        request,
        options,
        pathPattern,
        url,
        path,
        diagnosticsInfo
      };
      
      // 7. Prepare transformation parameters using strategy
      const transformParams = strategy.prepareTransformParams(context);
      
      // 8. Update diagnostics information
      strategy.updateDiagnostics(context);
      
      // 9. Check cache
      const cachedResponse = await this.cacheService.getCachedResponse(
        request, 
        options,
        transformParams
      );
      
      if (cachedResponse) {
        // Add debug headers if needed
        return this.debugService.addDebugInfo(cachedResponse, diagnosticsInfo);
      }
      
      // 10. Transform video
      const response = await this.transformationService.transformVideo(
        request,
        options,
        transformParams
      );
      
      // 11. Cache response
      const cachedResponse = await this.cacheService.cacheResponse(
        request,
        response.clone(),
        options,
        transformParams
      );
      
      // 12. Add debug information if needed
      return this.debugService.addDebugInfo(cachedResponse, diagnosticsInfo);
    } catch (error) {
      // Handle errors
      return this.errorHandlerService.createErrorResponse(error, diagnosticsInfo);
    }
  }
  
  // Helper methods
  private findMatchingPathPattern(path: string): PathPattern | null {
    // Path pattern matching implementation
  }
  
  private parseOptions(url: URL, pathPattern: PathPattern): VideoTransformOptions {
    // Options extraction implementation
  }
}
```

### Command Benefits

The Command pattern provides several benefits:

1. **Encapsulation**: Complex transformation logic is encapsulated in a single object
2. **Separation of Concerns**: The command focuses solely on orchestrating the transformation
3. **Decoupling**: The client (handler) is decoupled from the transformation details
4. **Testability**: The command can be tested independently with mocked services
5. **Error Handling**: Centralized error handling for all transformation operations

## Factory Pattern

The Factory pattern provides an interface for creating objects without specifying their concrete classes.

### Factory Implementation

The Factory pattern is implemented through the `StrategyFactory` class:

```typescript
export class StrategyFactory {
  /**
   * Create a transformation strategy based on the mode
   * @param mode The transformation mode
   * @returns The appropriate strategy
   */
  static createStrategy(mode: string): TransformationStrategy {
    switch (mode) {
      case 'frame':
        return new FrameStrategy();
      case 'spritesheet':
        return new SpritesheetStrategy();
      case 'video':
      default:
        return new VideoStrategy();
    }
  }
}
```

### Factory Benefits

The Factory pattern provides several benefits:

1. **Centralized Creation**: Single place for strategy instantiation
2. **Decoupling**: Clients don't need to know concrete strategy classes
3. **Extensibility**: Easy to add new strategies without modifying client code
4. **Simplicity**: Creates appropriate concrete strategy based on mode
5. **Maintainability**: Changes to strategy creation are localized

## Singleton Pattern

The Singleton pattern ensures that a class has only one instance and provides a global point of access to it.

### Singleton Implementation

The Singleton pattern is implemented in configuration managers:

```typescript
export class VideoConfigurationManager {
  private static instance: VideoConfigurationManager | null = null;
  private config: VideoConfig;
  
  private constructor() {
    // Initialize with default configuration
    this.config = DEFAULT_VIDEO_CONFIG;
    
    // Load from environment variables
    this.loadFromEnvironment();
  }
  
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
  
  // Configuration update methods
  public updateConfigFromKV(kvConfig: Partial<VideoConfig>): void {
    // Validate and update configuration
    this.config = {
      ...this.config,
      ...kvConfig
    };
  }
  
  private loadFromEnvironment(): void {
    // Load configuration from environment variables
  }
}
```

### Singleton Benefits

The Singleton pattern provides several benefits for configuration management:

1. **Shared State**: Ensures a single, consistent configuration across the application
2. **Lazy Initialization**: Configuration is loaded only when first accessed
3. **Centralized Updates**: Configuration changes are applied in one place
4. **Global Access**: Configuration is accessible throughout the application
5. **Resource Efficiency**: Prevents multiple instances of resource-intensive objects

## Dependency Injection

Dependency Injection is a technique where an object receives its dependencies from external sources rather than creating them itself.

### Dependency Injection Implementation

Dependency Injection is implemented through service initialization and injection:

```typescript
// Service dependencies interface
interface ServiceDependencies {
  transformationService: VideoTransformationService;
  cacheService: CacheManagementService;
  debugService: DebugService;
  videoStorageService: VideoStorageService;
  errorHandlerService: ErrorHandlerService;
}

// Service initialization
async function initializeServices(env: Env): Promise<ServiceDependencies> {
  return {
    transformationService: new VideoTransformationService(env),
    cacheService: new CacheManagementService(env),
    debugService: new DebugService(env),
    videoStorageService: new VideoStorageService(env),
    errorHandlerService: new ErrorHandlerService(env)
  };
}

// Command using injected services
export class TransformVideoCommand {
  private readonly transformationService: VideoTransformationService;
  private readonly cacheService: CacheManagementService;
  // Other services...
  
  constructor(services: ServiceDependencies) {
    this.transformationService = services.transformationService;
    this.cacheService = services.cacheService;
    // Initialize other services...
  }
  
  // Command implementation...
}

// Handler injecting services into command
export async function videoHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    // Initialize services
    const services = await initializeServices(env);
    
    // Create and execute command with injected services
    const command = new TransformVideoCommand(services);
    return await command.execute(request);
  } catch (error) {
    // Error handling
    return createErrorResponse(error);
  }
}
```

### Dependency Injection Benefits

Dependency Injection provides several benefits:

1. **Decoupling**: Components have loose coupling with their dependencies
2. **Testability**: Dependencies can be easily mocked for testing
3. **Flexibility**: Dependencies can be changed without modifying the dependent component
4. **Reusability**: Components can be reused with different implementations of dependencies
5. **Centralized Configuration**: Dependencies are configured in a central location

## Conclusion

The Video Resizer architecture leverages these design patterns to create a maintainable, extensible, and testable codebase. These patterns work together to provide a solid foundation for handling the complexities of video transformation while promoting good software development practices.

- **Strategy Pattern**: Enables different transformation modes
- **Command Pattern**: Encapsulates transformation logic
- **Factory Pattern**: Creates appropriate strategies
- **Singleton Pattern**: Manages configuration
- **Dependency Injection**: Provides loose coupling between components

By following these established patterns, the Video Resizer achieves a modular, maintainable architecture that can easily adapt to new requirements and features.