# Architecture Patterns in Video Resizer

This document provides a comprehensive guide to the architectural patterns used throughout the video-resizer project, with examples and implementation details.

## Core Architectural Patterns

### 1. Command Pattern

The Command pattern centralizes business logic and separates it from request handling. This improves testability, maintainability, and allows for better separation of concerns.

#### 1.1 TransformVideoCommand

The `TransformVideoCommand` class implements the Command pattern:

```typescript
export class TransformVideoCommand {
  private transformationService: VideoTransformationService;
  private cacheService: CacheManagementService;
  private debugService: DebugService;
  private storageService: VideoStorageService;
  private errorHandler: ErrorHandlerService;
  
  constructor(services: ServiceDependencies) {
    this.transformationService = services.transformationService;
    this.cacheService = services.cacheService;
    this.debugService = services.debugService;
    this.storageService = services.storageService;
    this.errorHandler = services.errorHandler;
  }
  
  public async execute(request: Request): Promise<Response> {
    try {
      // 1. Extract and validate options
      const url = new URL(request.url);
      const options = this.determineOptions(url, request);
      
      // 2. Select transformation strategy
      const strategy = StrategyFactory.createStrategy(options.mode || 'video');
      await strategy.validateOptions(options);
      
      // 3. Check cache
      const cachedResponse = await this.cacheService.getCachedResponse(request);
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // 4. Execute transformation
      const transformedResponse = await this.transformationService.transformVideo(
        request, 
        options, 
        strategy
      );
      
      // 5. Cache response
      return await this.cacheService.cacheResponse(request, transformedResponse);
    } catch (error) {
      return this.errorHandler.handleError(error, request);
    }
  }
  
  // Other methods...
}
```

#### 1.2 Command Execution Flow

The command encapsulates a complete business transaction:

1. Parse and validate input
2. Select appropriate strategy
3. Execute core logic
4. Handle results and side effects
5. Manage errors

This pattern keeps HTTP-specific logic out of the business domain and allows the command to be reused in different contexts.

### 2. Strategy Pattern

The Strategy pattern provides a clean way to handle different transformation modes with specific behaviors while maintaining a consistent interface.

#### 2.1 TransformationStrategy Interface

All strategies implement a common interface:

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

#### 2.2 Concrete Strategy Implementations

Each mode has its own strategy implementation:

```typescript
// Video mode strategy
export class VideoStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    
    // Video-specific parameter preparation
    return {
      width: options.width,
      height: options.height,
      fit: options.fit,
      quality: options.quality,
      format: options.format,
      // Video-specific properties
      audio: options.audio,
      loop: options.loop,
      autoplay: options.autoplay,
      muted: options.muted,
      // Other parameters...
    };
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // Video-specific validation
    // ...
  }
  
  updateDiagnostics(context: TransformationContext): void {
    // Update diagnostics with video-specific information
    context.diagnosticsInfo.mode = 'video';
    context.diagnosticsInfo.modeSpecific = {
      hasAudio: context.options.audio !== false,
      playbackControls: {
        loop: !!context.options.loop,
        autoplay: !!context.options.autoplay,
        muted: !!context.options.muted,
        preload: context.options.preload || 'auto'
      }
    };
  }
}

// Frame mode strategy
export class FrameStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    
    // Frame-specific parameter preparation
    return {
      width: options.width,
      height: options.height,
      fit: options.fit,
      quality: options.quality,
      format: options.format || 'jpg',
      // Frame-specific properties
      time: options.time,
      // Other parameters...
    };
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // Frame-specific validation
    if (!options.time) {
      throw new ValidationError('Time parameter is required for frame mode');
    }
    
    // Invalid parameters for frame mode
    if (options.loop || options.autoplay || options.muted) {
      throw new ValidationError('Playback controls are not valid for frame mode');
    }
    
    // Other validations...
  }
  
  updateDiagnostics(context: TransformationContext): void {
    // Update diagnostics with frame-specific information
    context.diagnosticsInfo.mode = 'frame';
    context.diagnosticsInfo.modeSpecific = {
      time: context.options.time,
      format: context.options.format || 'jpg'
    };
  }
}

// Spritesheet mode strategy
export class SpritesheetStrategy implements TransformationStrategy {
  // Similar implementation...
}
```

#### 2.3 Strategy Factory

A factory selects the appropriate strategy based on the requested mode:

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

### 3. Configuration Management Pattern

The Configuration Management pattern provides a centralized, type-safe, and validated way to manage application configuration.

#### 3.1 Configuration Manager Classes

Each area of configuration has a dedicated manager:

```typescript
export class VideoConfigurationManager {
  private static instance: VideoConfigurationManager | null = null;
  private config: VideoConfig;
  
  // Singleton pattern
  public static getInstance(): VideoConfigurationManager {
    if (!VideoConfigurationManager.instance) {
      VideoConfigurationManager.instance = new VideoConfigurationManager();
    }
    return VideoConfigurationManager.instance;
  }
  
  // Constructor initializes with defaults
  private constructor() {
    this.config = this.getDefaultConfig();
  }
  
  // Configuration access methods
  public getPathPatterns(): PathPattern[] {
    return this.config.pathPatterns;
  }
  
  public getDerivative(name: string): VideoDerivative | null {
    return this.config.derivatives[name] || null;
  }
  
  public isValidOption(param: string, value: string): boolean {
    // Validation implementation
    const validOptions = this.getValidOptions(param);
    return validOptions.includes(value);
  }
  
  // Configuration update methods
  public updateConfigFromKV(kvConfig: Partial<VideoConfig>): void {
    // Validate with Zod schema
    const validatedConfig = videoConfigSchema.parse(kvConfig);
    
    // Merge with existing config
    this.config = {
      ...this.config,
      ...validatedConfig
    };
  }
  
  // Default configuration
  private getDefaultConfig(): VideoConfig {
    return {
      pathPatterns: [],
      derivatives: {
        high: { width: 1920, height: 1080, quality: 'high' },
        medium: { width: 1280, height: 720, quality: 'medium' },
        low: { width: 640, height: 360, quality: 'low' },
        // Other derivatives...
      },
      defaults: {
        quality: 'auto',
        fit: 'contain',
        // Other defaults...
      }
    };
  }
}
```

#### 3.2 Zod Schema Validation

Configuration uses Zod for runtime validation with TypeScript type inference:

```typescript
// Define schema
const videoConfigSchema = z.object({
  pathPatterns: z.array(
    z.object({
      name: z.string(),
      matcher: z.string(),
      priority: z.number().default(10),
      processPath: z.boolean().default(true),
      baseUrl: z.string().optional(),
      originUrl: z.string().optional(),
      quality: z.string().optional(),
      cacheTtl: z.number().optional(),
      captureGroups: z.array(z.string()).optional()
    })
  ).default([]),
  
  derivatives: z.record(
    z.string(),
    z.object({
      width: z.number().optional(),
      height: z.number().optional(),
      quality: z.string().optional(),
      fit: z.string().optional(),
      // Other derivative properties...
    })
  ).default({}),
  
  defaults: z.object({
    quality: z.string().default('auto'),
    fit: z.string().default('contain'),
    audio: z.boolean().default(true),
    // Other default properties...
  }).default({})
});

// Infer TypeScript type from schema
type VideoConfig = z.infer<typeof videoConfigSchema>;
```

### 4. Service Dependency Pattern

The Service Dependency pattern enables testable, maintainable code by explicitly declaring and injecting dependencies.

#### 4.1 Service Dependencies Interface

Dependencies are defined through interfaces:

```typescript
export interface ServiceDependencies {
  transformationService: VideoTransformationService;
  cacheService: CacheManagementService;
  debugService: DebugService;
  storageService: VideoStorageService;
  errorHandler: ErrorHandlerService;
}
```

#### 4.2 Service Initialization

Services are initialized centrally:

```typescript
export async function initializeServices(env: Env): Promise<ServiceDependencies> {
  return {
    transformationService: new VideoTransformationService(env),
    cacheService: new CacheManagementService(env),
    debugService: new DebugService(env),
    storageService: new VideoStorageService(env),
    errorHandler: new ErrorHandlerService(env)
  };
}
```

#### 4.3 Dependency Injection

Services are injected into consumers:

```typescript
// In handler
export async function videoHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Initialize services
  const services = await initializeServices(env);
  
  // Create command with dependencies
  const command = new TransformVideoCommand(services);
  
  // Execute command
  return await command.execute(request);
}
```

#### 4.4 Testing with Mock Services

This pattern makes testing easier:

```typescript
// In tests
import { describe, it, expect } from 'vitest';
import { TransformVideoCommand } from '../src/domain/commands/TransformVideoCommand';

describe('TransformVideoCommand', () => {
  it('should transform video with valid options', async () => {
    // Create mock services
    const mockServices = {
      transformationService: {
        transformVideo: vi.fn().mockResolvedValue(new Response('transformed content'))
      },
      cacheService: {
        getCachedResponse: vi.fn().mockResolvedValue(null),
        cacheResponse: vi.fn().mockImplementation(async (_, response) => response)
      },
      // Other mock services...
    } as unknown as ServiceDependencies;
    
    // Create command with mock services
    const command = new TransformVideoCommand(mockServices);
    
    // Create test request
    const request = new Request('https://example.com/video.mp4?width=800');
    
    // Execute command
    const response = await command.execute(request);
    
    // Verify results
    expect(response.status).toBe(200);
    expect(mockServices.transformationService.transformVideo).toHaveBeenCalled();
    expect(mockServices.cacheService.cacheResponse).toHaveBeenCalled();
  });
});
```

### 5. Request Context Pattern

The Request Context pattern provides a way to pass request-specific information throughout the call chain without excessive parameter passing.

#### 5.1 Request Context Interface

```typescript
export interface RequestContext {
  id: string;
  request: Request;
  url: URL;
  startTime: number;
  breadcrumbs: Breadcrumb[];
  diagnosticsInfo: DiagnosticsInfo;
  executionContext?: ExecutionContext;
  env?: Env;
}
```

#### 5.2 Context Creation

```typescript
export function createRequestContext(
  request: Request,
  env?: Env,
  executionContext?: ExecutionContext
): RequestContext {
  const id = crypto.randomUUID();
  const url = new URL(request.url);
  
  return {
    id,
    request,
    url,
    startTime: performance.now(),
    breadcrumbs: [],
    diagnosticsInfo: {
      requestId: id,
      url: request.url,
      method: request.method,
      timestamp: new Date().toISOString()
    },
    executionContext,
    env
  };
}
```

#### 5.3 Context Usage

```typescript
// In handler
export async function videoHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Create request context
  const requestContext = createRequestContext(request, env, ctx);
  
  // Store in a storage accessible to current request
  setCurrentContext(requestContext);
  
  try {
    // Add breadcrumb
    addBreadcrumb(requestContext, 'Handler', 'Video handler started');
    
    // Initialize services
    const services = await initializeServices(env);
    
    // Create and execute command
    const command = new TransformVideoCommand(services);
    return await command.execute(request);
  } catch (error) {
    // Error handling
    return createErrorResponse(error, requestContext);
  } finally {
    // Clean up
    clearCurrentContext();
  }
}
```

### 6. Logging and Breadcrumb Pattern

The Logging and Breadcrumb pattern provides a comprehensive way to trace request execution for debugging and monitoring.

#### 6.1 Structured Logging with Pino

```typescript
import pino from 'pino';

// Configure logger
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    }
  }
});

// Logging functions
export function info(component: string, message: string, data?: any): void {
  logger.info({ component, ...data }, message);
}

export function warn(component: string, message: string, data?: any): void {
  logger.warn({ component, ...data }, message);
}

export function error(component: string, message: string, error?: any, data?: any): void {
  logger.error(
    { 
      component, 
      error: error ? { 
        message: error.message, 
        stack: error.stack,
        code: error.code 
      } : undefined,
      ...data 
    }, 
    message
  );
}
```

#### 6.2 Breadcrumb System

```typescript
export interface Breadcrumb {
  category: string;
  message: string;
  timestamp: number;
  data?: Record<string, any>;
  elapsedMs?: number;
}

export function addBreadcrumb(
  context: RequestContext,
  category: string,
  message: string,
  data?: Record<string, any>
): void {
  const timestamp = performance.now();
  const lastBreadcrumb = context.breadcrumbs[context.breadcrumbs.length - 1];
  
  // Calculate elapsed time since last breadcrumb
  const elapsedMs = lastBreadcrumb 
    ? parseFloat((timestamp - lastBreadcrumb.timestamp).toFixed(2)) 
    : 0;
  
  // Add new breadcrumb
  context.breadcrumbs.push({
    category,
    message,
    timestamp,
    data,
    elapsedMs
  });
  
  // Log if needed
  if (shouldLogBreadcrumb(category)) {
    info(category, message, { ...data, elapsedMs });
  }
}
```

#### 6.3 Request Timer

```typescript
export function startTimer(name: string): {
  getElapsedMs: () => number;
  stop: () => number;
} {
  const startTime = performance.now();
  
  return {
    getElapsedMs: () => {
      return parseFloat((performance.now() - startTime).toFixed(2));
    },
    stop: () => {
      const elapsed = parseFloat((performance.now() - startTime).toFixed(2));
      return elapsed;
    }
  };
}
```

### 7. Error Handling Pattern

The Error Handling Pattern provides consistent, informative error responses across the application.

#### 7.1 Error Class Hierarchy

```typescript
export interface ErrorOptions {
  statusCode?: number;
  errorType?: string;
  details?: Record<string, any>;
  cause?: Error;
}

export class VideoTransformError extends Error {
  public readonly statusCode: number;
  public readonly errorType: string;
  public readonly details: Record<string, any>;
  public readonly cause?: Error;
  
  constructor(message: string, options: ErrorOptions = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options.statusCode || 500;
    this.errorType = options.errorType || 'server_error';
    this.details = options.details || {};
    this.cause = options.cause;
  }
}

export class ValidationError extends VideoTransformError {
  constructor(message: string, details?: Record<string, any>, cause?: Error) {
    super(message, { 
      statusCode: 400, 
      errorType: 'validation_error', 
      details, 
      cause 
    });
  }
}

export class NotFoundError extends VideoTransformError {
  constructor(message: string, details?: Record<string, any>, cause?: Error) {
    super(message, { 
      statusCode: 404, 
      errorType: 'not_found', 
      details, 
      cause 
    });
  }
}

export class ProcessingError extends VideoTransformError {
  constructor(message: string, details?: Record<string, any>, cause?: Error) {
    super(message, { 
      statusCode: 500, 
      errorType: 'processing_error', 
      details, 
      cause 
    });
  }
}
```

#### 7.2 Error Handler Service

```typescript
export class ErrorHandlerService {
  public handleError(error: unknown, request: Request): Response {
    // Normalize error
    const normalizedError = this.normalizeError(error);
    
    // Log error
    this.logError(normalizedError, request);
    
    // Create error response
    return this.createErrorResponse(normalizedError);
  }
  
  private normalizeError(error: unknown): VideoTransformError {
    if (error instanceof VideoTransformError) {
      return error;
    }
    
    if (error instanceof Error) {
      return new ProcessingError(
        error.message,
        {},
        error
      );
    }
    
    return new ProcessingError(
      typeof error === 'string' ? error : 'Unknown error occurred'
    );
  }
  
  private logError(error: VideoTransformError, request: Request): void {
    // Get request context if available
    const context = getCurrentContext();
    
    // Log error with context
    error(
      'ErrorHandler',
      error.message,
      error,
      {
        url: request.url,
        method: request.method,
        statusCode: error.statusCode,
        errorType: error.errorType,
        details: error.details,
        requestId: context?.id,
        breadcrumbs: context?.breadcrumbs
      }
    );
  }
  
  private createErrorResponse(error: VideoTransformError): Response {
    // Create error response object
    const errorResponse = {
      error: error.errorType,
      message: error.message,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString()
    };
    
    // Add debug information if available
    const context = getCurrentContext();
    if (context && isDebugEnabled(context.request)) {
      Object.assign(errorResponse, {
        details: error.details,
        requestId: context.id,
        breadcrumbs: context.breadcrumbs
      });
    }
    
    // Create response with appropriate status code
    return new Response(
      JSON.stringify(errorResponse),
      {
        status: error.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'X-Error-Type': error.errorType
        }
      }
    );
  }
}
```

## Implementation Best Practices

### 1. Adding a New Transformation Mode

To add a new transformation mode:

1. Create a new strategy class implementing `TransformationStrategy`
2. Add the new mode to `StrategyFactory`
3. Update configuration schemas and validation
4. Add tests for the new mode

Example for a hypothetical 'gif' mode:

```typescript
// 1. Create strategy
export class GifStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    
    return {
      width: options.width,
      height: options.height,
      fit: options.fit,
      quality: options.quality,
      format: 'gif',
      // GIF-specific options
      frameCount: options.frameCount || 10,
      frameRate: options.frameRate || 10,
      startTime: options.startTime || '0s',
      duration: options.duration || '1s'
    };
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // GIF-specific validation
    if (options.frameCount && (options.frameCount < 2 || options.frameCount > 100)) {
      throw new ValidationError('frameCount must be between 2 and 100 for GIF mode');
    }
    
    // Other validations...
  }
  
  updateDiagnostics(context: TransformationContext): void {
    context.diagnosticsInfo.mode = 'gif';
    context.diagnosticsInfo.modeSpecific = {
      frameCount: context.options.frameCount || 10,
      frameRate: context.options.frameRate || 10,
      duration: context.options.duration || '1s'
    };
  }
}

// 2. Update factory
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

// 3. Update validation schema
const videoOptionsSchema = z.object({
  mode: z.enum(['video', 'frame', 'spritesheet', 'gif']).optional().default('video'),
  // Existing fields...
  
  // New GIF-specific fields
  frameCount: z.number().min(2).max(100).optional(),
  frameRate: z.number().min(1).max(60).optional(),
  // Other fields...
});
```

### 2. Adding a New Service

To add a new service:

1. Define the service interface
2. Implement the service class
3. Update the `ServiceDependencies` interface
4. Add service initialization
5. Inject the service where needed

Example for a hypothetical 'analytics' service:

```typescript
// 1. Define interface
export interface AnalyticsService {
  recordTransformation(options: VideoTransformOptions): Promise<void>;
  recordCacheStatus(cacheHit: boolean): Promise<void>;
  recordError(error: VideoTransformError): Promise<void>;
}

// 2. Implement service
export class CloudflareAnalyticsService implements AnalyticsService {
  private readonly env: Env;
  
  constructor(env: Env) {
    this.env = env;
  }
  
  public async recordTransformation(options: VideoTransformOptions): Promise<void> {
    // Implementation...
  }
  
  public async recordCacheStatus(cacheHit: boolean): Promise<void> {
    // Implementation...
  }
  
  public async recordError(error: VideoTransformError): Promise<void> {
    // Implementation...
  }
}

// 3. Update dependencies interface
export interface ServiceDependencies {
  transformationService: VideoTransformationService;
  cacheService: CacheManagementService;
  debugService: DebugService;
  storageService: VideoStorageService;
  errorHandler: ErrorHandlerService;
  analyticsService: AnalyticsService; // New service
}

// 4. Update initialization
export async function initializeServices(env: Env): Promise<ServiceDependencies> {
  return {
    transformationService: new VideoTransformationService(env),
    cacheService: new CacheManagementService(env),
    debugService: new DebugService(env),
    storageService: new VideoStorageService(env),
    errorHandler: new ErrorHandlerService(env),
    analyticsService: new CloudflareAnalyticsService(env) // New service
  };
}

// 5. Update command to use new service
export class TransformVideoCommand {
  private analyticsService: AnalyticsService;
  
  constructor(services: ServiceDependencies) {
    // Existing services...
    this.analyticsService = services.analyticsService;
  }
  
  public async execute(request: Request): Promise<Response> {
    try {
      // Existing code...
      
      // Record analytics
      await this.analyticsService.recordTransformation(options);
      
      // Return response...
    } catch (error) {
      // Record error
      await this.analyticsService.recordError(error);
      
      // Handle error...
    }
  }
}
```

### 3. Adding a New Configuration Manager

To add a new configuration manager:

1. Define the configuration schema with Zod
2. Create the configuration manager class
3. Add initialization and update methods
4. Integrate with the existing configuration system

Example for a hypothetical 'analytics' configuration:

```typescript
// 1. Define schema
const analyticsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sampleRate: z.number().min(0).max(1).default(1),
  recordHeaders: z.boolean().default(false),
  excludedPaths: z.array(z.string()).default([]),
  customDimensions: z.record(z.string(), z.string()).default({})
});

type AnalyticsConfig = z.infer<typeof analyticsConfigSchema>;

// 2. Create manager class
export class AnalyticsConfigurationManager {
  private static instance: AnalyticsConfigurationManager | null = null;
  private config: AnalyticsConfig;
  
  public static getInstance(): AnalyticsConfigurationManager {
    if (!AnalyticsConfigurationManager.instance) {
      AnalyticsConfigurationManager.instance = new AnalyticsConfigurationManager();
    }
    return AnalyticsConfigurationManager.instance;
  }
  
  private constructor() {
    this.config = this.getDefaultConfig();
  }
  
  public isEnabled(): boolean {
    return this.config.enabled;
  }
  
  public getSampleRate(): number {
    return this.config.sampleRate;
  }
  
  public shouldRecord(path: string): boolean {
    // Check if path is excluded
    for (const excludedPath of this.config.excludedPaths) {
      if (path.includes(excludedPath)) {
        return false;
      }
    }
    
    // Apply sampling
    if (this.config.sampleRate < 1) {
      return Math.random() <= this.config.sampleRate;
    }
    
    return true;
  }
  
  public getCustomDimensions(): Record<string, string> {
    return this.config.customDimensions;
  }
  
  public updateConfigFromKV(kvConfig: Partial<AnalyticsConfig>): void {
    // Validate config
    const validatedConfig = analyticsConfigSchema.parse(kvConfig);
    
    // Update config
    this.config = {
      ...this.config,
      ...validatedConfig
    };
  }
  
  private getDefaultConfig(): AnalyticsConfig {
    return analyticsConfigSchema.parse({});
  }
}

// 3. Update configuration initialization
export async function initializeConfiguration(env: Env): Promise<void> {
  // Existing initialization...
  
  // Load analytics configuration
  const analyticsConfig = env.analytics || {};
  const analyticsManager = AnalyticsConfigurationManager.getInstance();
  analyticsManager.updateConfigFromKV(analyticsConfig);
}
```

## Conclusion

The architectural patterns used in the video-resizer provide:

1. **Maintainability**: Clear separation of concerns and modular design
2. **Testability**: Dependency injection and isolated components
3. **Extensibility**: Strategy pattern for adding new modes
4. **Reliability**: Comprehensive error handling
5. **Observability**: Structured logging and breadcrumb tracking

By understanding and following these patterns, developers can efficiently extend and maintain the video-resizer codebase while ensuring it remains robust and adaptable to future requirements.