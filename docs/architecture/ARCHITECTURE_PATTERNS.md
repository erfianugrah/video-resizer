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

By understanding and following these patterns, developers can efficiently extend and maintain the video-resizer codebase while ensuring it remains robust and adaptable to future requirements.\n## Refactoring Patterns\n
# Video Resizer Refactoring

This document outlines the refactoring work done to improve the architecture of the Video Resizer component.

## 0. Latest Refactoring: Logging Configuration Management

We've improved the configuration flow to ensure wrangler.jsonc is properly the single source of truth for all configuration, especially logging. This involved several key improvements:

1. **Enhanced LoggingConfigurationManager**:
   - Added proper schema with Zod for all logging components including breadcrumbs and Pino-specific settings
   - Added methods for accessing all configuration aspects (getPinoConfig, getBreadcrumbConfig, etc.)
   - Made LoggingConfigurationManager the central source for all logging settings

2. **Removed Direct Global Variable Access**:
   - Replaced direct access to global variables (LOGGING_CONFIG, DEBUG_ENABLED, DEBUG_VERBOSE) with manager method calls
   - Updated pinoLogger.ts to use LoggingConfigurationManager for all settings
   - Updated requestContext.ts to use configuration managers for debug flags and breadcrumb settings

3. **Improved Configuration Initialization**:
   - Updated index.ts to use proper configuration initialization
   - Ensured consistent type safety throughout the configuration flow
   - Added better error handling for configuration issues

4. **Benefits**:
   - **Type Safety**: All configuration is now properly typed with TypeScript and validated with Zod
   - **Centralized Management**: Single source of truth for all configuration
   - **Testability**: Easier to mock configuration for tests
   - **Maintainability**: Cleaner code with proper separation of concerns

## 1. Code Structure Refactoring

### Implemented Strategy Pattern

The large `TransformVideoCommand` class (500+ lines) has been refactored using the Strategy pattern to improve maintainability and separation of concerns:

- Created a `TransformationStrategy` interface to define common operations across all transformation types
- Implemented concrete strategies for each transformation mode:
  - `VideoStrategy`: Handles video mode transformations
  - `FrameStrategy`: Handles frame extraction (still images) 
  - `SpritesheetStrategy`: Handles spritesheet generation

### Added Strategy Factory

- Implemented a `StrategyFactory` that selects the appropriate strategy based on the transformation mode
- This allows for easy addition of new transformation types in the future

### Created Dedicated Transformation Service

- Added a new `TransformationService` to coordinate the transformation process
- The service acts as a facade that handles:
  - URL construction
  - Cache configuration 
  - Path pattern application
  - Diagnostics information collection

### Benefits of the New Architecture

1. **Improved Separation of Concerns**:
   - Each transformation type has dedicated logic in its own class
   - Validation, parameter preparation, and diagnostics are cleanly separated

2. **Enhanced Maintainability**:
   - Reduced the size of the `TransformVideoCommand` class from 500+ lines to ~200 lines
   - Better organization of code makes it easier to understand and extend

3. **Better Testability**:
   - Each strategy can be unit tested in isolation
   - The command class is focused on orchestration rather than implementation details

4. **Flexible Extension Points**:
   - New transformation modes can be added by implementing new strategies
   - Common behavior is shared through the strategy interface

## 2. Circular Dependency Improvements

The refactoring also helped address circular dependency issues:

- Services now use more dynamic imports for dependencies
- Shared functionality moved to the proper abstraction level
- Strategy pattern helps keep dependencies flowing in one direction

## Implementation Details

### Strategy Interface

```typescript
export interface TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams;
  validateOptions(options: VideoTransformOptions): void;
  updateDiagnostics(context: TransformationContext): void;
}
```

### Strategy Factory

```typescript
export function createTransformationStrategy(options: VideoTransformOptions): TransformationStrategy {
  const mode = options.mode || 'video'; // Default to video mode
  
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
```

### Transformation Service

The new transformation service orchestrates the process:

```typescript
export async function prepareVideoTransformation(
  request: Request,
  options: VideoTransformOptions,
  pathPatterns: PathPattern[],
  debugInfo?: DebugInfo,
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }}
): Promise<{
  cdnCgiUrl: string;
  cacheConfig: any;
  source: string;
  derivative: string;
  diagnosticsInfo: any;
}>
```

## 3. Error Handling Enhancements

### Custom Error Class Hierarchy

Implemented a robust error handling system with a proper hierarchy:

- `VideoTransformError`: Base error class with error type classification and status code mapping
- Specialized error classes for different scenarios:
  - `ValidationError`: For input validation issues
  - `ProcessingError`: For transformation and processing failures
  - `ConfigurationError`: For configuration-related problems
  - `NotFoundError`: For missing resources or patterns

### Improved Error Context

Enhanced errors with rich contextual information:

- Each error includes detailed context about what happened
- Errors have specific error types for better categorization
- Appropriate HTTP status codes are automatically assigned based on error type

### Centralized Error Handling

Added a dedicated error handling service:

- `errorHandlerService`: Centralizes error handling logic
- Provides consistent error normalization and logging
- Generates appropriate error responses with diagnostics
- Enhanced integration with the debug interface

### Error Response Improvements

Error responses now include:

- Appropriate HTTP status codes (400, 404, 500, etc.)
- Structured JSON responses with error type and message
- Additional diagnostic headers (X-Error-Type)
- Improved caching directives for error responses
- Enhanced debug view for errors when debug mode is enabled

### Error Implementation

```typescript
export enum ErrorType {
  // Validation errors - 400 range
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  INVALID_MODE = 'INVALID_MODE',
  INVALID_FORMAT = 'INVALID_FORMAT',
  // ... more error types

  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class VideoTransformError extends Error {
  public errorType: ErrorType;
  public statusCode: number;
  public context: ErrorContext;
  
  // ... constructor and methods
  
  toResponse(): Response {
    // Creates an appropriate HTTP response
  }
}

// Example specialized error
export class ValidationError extends VideoTransformError {
  // Factory methods for common validation errors
  static invalidMode(mode: string, validModes: string[]): ValidationError {
    // ...
  }
  
  static invalidDimension(dimensionName: string, value: number, min: number, max: number): ValidationError {
    // ...
  }
}
```

### Error Handler Service

```typescript
// Convert any error to a VideoTransformError
export function normalizeError(err: unknown, context: Record<string, any> = {}): VideoTransformError {
  // ...
}

// Create an appropriate error response based on the error type
export async function createErrorResponse(
  err: unknown,
  request: Request,
  debugInfo?: DebugInfo,
  diagnosticsInfo?: DiagnosticsInfo,
  env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> }}
): Promise<Response> {
  // ...
}
```

## 4. Error Handling System Implementation

The error handling system has been fully implemented across all transformation strategies:

### Error System Adoption in All Strategies

- **VideoStrategy**: Previously implemented the error system
- **FrameStrategy**: Now updated to use specialized ValidationError classes
- **SpritesheetStrategy**: Now updated to use specialized ValidationError classes

### Consistent Error Context

- All strategies now provide consistent error contexts
- Context includes the transformation mode and relevant parameters
- Errors include diagnostic information for debugging
- Type safety is enforced across all error handling code

### Contextual Error Factories

Each strategy uses appropriate error factory methods:

- `ValidationError.invalidDimension()`: For width/height validation failures
- `ValidationError.invalidFormat()`: For format, quality and fit validation
- `ValidationError.invalidTimeValue()`: For time and duration validation
- `ValidationError.invalidOptionCombination()`: For incompatible option combinations

### Benefits of the Unified Error System

1. **Consistent Error Responses**:
   - All transformations now return standardized error responses
   - HTTP status codes are appropriate for the error type
   - Error messages are clear and actionable

2. **Enhanced Debugging**:
   - Errors provide rich context for easier troubleshooting
   - Error type is included in response headers
   - Debug mode shows detailed error information

3. **Improved Developer Experience**:
   - Clear validation feedback for API users
   - Specific error types make it easier to handle errors programmatically
   - Consistent structure allows for predictable error handling

## 5. Configuration Management Implementation

The configuration management system has been implemented to provide a type-safe, validated, and centralized approach to handling video transformation configuration:

### Zod Schema Validation

- Created comprehensive schemas for all configuration objects
- Implemented strong type checking and runtime validation
- Added proper error messages for invalid configurations
- Generated TypeScript types from the Zod schemas

### VideoConfigurationManager Class

- Implemented as a singleton to ensure consistent configuration access
- Provides type-safe getters for all configuration sections
- Validates configuration at initialization and during updates
- Throws specialized `ConfigurationError` instances with detailed context
- Supports dynamic configuration updates with validation

### Configuration Features

- **Strongly Typed API**: Full TypeScript support with proper type inference
- **Runtime Validation**: Catches configuration errors at startup or update time
- **Centralized Access**: Single source of truth for all configuration data
- **Extensible System**: Easy to add new configuration sections
- **Developer Experience**: Helpful error messages with detailed path information

### Schema-Based Validation Benefits

1. **Type Safety**: Ensures configuration matches expected types
2. **Value Validation**: Validates values meet business logic constraints
3. **Self-Documentation**: Schemas document expected types and constraints
4. **Fail-Fast**: Catches configuration errors early rather than at runtime
5. **Detailed Error Reporting**: Provides clear error messages for invalid configuration

### Unit Testing

Added comprehensive tests for the configuration manager:
- Singleton pattern implementation
- Configuration validation functionality
- Accessors for all configuration sections 
- Configuration modification methods
- Error handling for invalid configurations

## 6. Logging System Improvements

The logging system has been enhanced with a more efficient and configurable architecture that respects production environment requirements:

### Structured Logging with Pino

- Implemented a structured JSON logging system using Pino
- Added request-scoped logging with breadcrumb support
- Created a centralized logging configuration via wrangler.jsonc
- Added proper log level filtering based on environment

### Breadcrumb System

- Added an efficient request-scoped breadcrumb collection system
- Made breadcrumb collection configurable (can be disabled in production)
- Implemented breadcrumb count limiting to prevent memory issues
- Integrated breadcrumbs with performance tracking

### Environment-Aware Logging

- Log levels are now configurable per environment (debug, info, warn, error)
- Production environment uses higher log level threshold (info)
- Development and staging use more verbose logging (debug)
- Debug flags can be toggled via URL parameters or headers, overriding environment defaults

### Log Sampling

- Added support for log sampling to reduce log volume in production
- Configurable sampling rates per environment
- Full logging in development, reduced rates in staging/production
- Debug logs can still be triggered for specific requests

### Enhanced Debug Headers

- Debug headers include performance metrics
- Component timing breakdowns are tracked and exposed
- Breadcrumb counts are reported in response headers
- Debug mode can be activated per request

### Type-Safe Configuration

- Created proper interfaces for all logging configuration
- Added schema validation for log configuration
- Implemented strong typing for log levels and options
- Uses proper type narrowing for safer code

### Latest Improvement: Centralized Configuration Management

We've improved the configuration flow to ensure wrangler.jsonc is properly the single source of truth for all logging configuration:

1. **Enhanced LoggingConfigurationManager**:
   - Added proper schema with Zod for all logging components including breadcrumbs and Pino-specific settings
   - Added methods for accessing all configuration aspects (getPinoConfig, getBreadcrumbConfig, etc.)
   - Made LoggingConfigurationManager the central source for all logging settings

2. **Removed Direct Global Variable Access**:
   - Replaced direct access to global variables (LOGGING_CONFIG, DEBUG_ENABLED, DEBUG_VERBOSE) with manager method calls
   - Updated pinoLogger.ts to use LoggingConfigurationManager for all settings
   - Updated requestContext.ts to use configuration managers for debug flags and breadcrumb settings

3. **Improved Configuration Initialization**:
   - Updated index.ts to use proper configuration initialization
   - Ensured consistent type safety throughout the configuration flow
   - Added better error handling for configuration issues

### Implementation Details

```typescript
// Logging configuration in wrangler.jsonc
"LOGGING_CONFIG": {
  "pino": {
    "level": "info",  // Only log info and above in production
    "browser": {
      "asObject": true
    },
    "base": {
      "service": "video-resizer",
      "env": "production"
    }
  },
  "sampling": {
    "enabled": true,
    "rate": 0.05      // Sample only 5% of logs in production
  },
  "breadcrumbs": {
    "enabled": false, // Disable breadcrumbs in production
    "maxItems": 25
  }
}

// Log level enforcement in pinoLogger.ts
export function debug(
  context: RequestContext, 
  logger: pino.Logger, 
  category: string, 
  message: string, 
  data?: Record<string, unknown>
) {
  // Always add breadcrumb for tracking, regardless of log level
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Skip debug logs if:
  // 1. The logger's level is higher than debug OR
  // 2. Debug is not enabled in the request context
  const loggerLevel = logger.level as string;
  const isDebugAllowedByLevel = loggerLevel === 'debug' || loggerLevel === 'trace';
  
  if (!isDebugAllowedByLevel || !context.debugEnabled) {
    return breadcrumb;
  }
  
  // Apply sampling if enabled
  if (samplingConfig.enabled && Math.random() > samplingConfig.rate) {
    return breadcrumb;
  }
  
  // Log with Pino - (rest of implementation)
}
```

### Benefits

1. **Production Performance**:
   - Reduced log volume with appropriate levels
   - Memory optimization by disabling breadcrumbs in production
   - Sampling to prevent log overload
   - Configurable per environment

2. **Better Diagnostics**:
   - Structured logging enables better log parsing and analysis
   - Breadcrumbs provide request history for debugging
   - Performance metrics help identify bottlenecks
   - Per-component timing information

3. **Flexibility**:
   - Temporary debug mode available even in production
   - URL parameters can enable debug for specific requests
   - Headers can trigger more detailed logging
   - Environment-specific configuration

4. **Type Safety**:
   - Proper TypeScript interfaces for all logging components
   - Safer code with explicit null and undefined handling
   - Better IDE support with proper typing
   - All configuration is now properly typed with TypeScript and validated with Zod

## 7. Recent Improvements (April 2025)

We've made several significant improvements to the codebase:

### Unified Debug Headers System

The debug headers system has been completely refactored and consolidated:

1. **Centralized Debug Utilities**:
   - Consolidated all debug header functionality in `src/utils/debugHeadersUtils.ts`
   - Added proper logging throughout the utilities for consistent tracing
   - Combined functionality from multiple files (debugHeadersUtils.ts, debugService.ts)
   - Added helper functions for common tasks like chunking large JSON data into headers

2. **Backward Compatibility**:
   - Maintained the `src/services/debugService.ts` as a compatibility layer
   - Used re-exports with aliasing to avoid breaking existing imports
   - Added deprecation notices to encourage direct use of the centralized utilities

3. **Enhanced Functionality**:
   - Added performance metrics tracking from the ResponseBuilder
   - Added breadcrumb header capabilities from the ResponseBuilder
   - Improved error handling and logging
   - Standardized the debugging experience across all code paths

4. **Improved Helper Functions**:
   - `addJsonChunkedHeader` for splitting large JSON objects into multiple headers
   - `addBreadcrumbHeaders` for consistent breadcrumb header formatting
   - Consolidated logging functions with proper fallbacks

### Cache System Enhancements

The caching implementation has been enhanced to be more selective:

1. **Content-Type Filtering**:
   - Added explicit filtering based on content types
   - Only cache video and image MIME types
   - Skip caching for other content types (HTML, JSON, etc.)

2. **Status Code Filtering**:
   - Improved filtering by HTTP status code
   - Avoid caching 4xx and 5xx error responses
   - Use appropriate TTLs based on status code ranges

3. **Cloudflare Cache API Integration**:
   - Enhanced integration with Cloudflare's Cache API
   - Made Cache API logic consistent with KV caching rules
   - Consolidated caching logic and conditions

4. **Cache Tags Integration**:
   - Improved cache tag generation
   - Added debug header support for cache tags
   - Made cache tags available in debug responses

### Configuration Consistency

1. **VideoConfigurationManager Usage**:
   - Updated files to use the VideoConfigurationManager consistently
   - Removed direct imports of videoConfig.ts
   - Improved circular dependency handling

2. **Proper Logging Implementation**:
   - Enhanced logging throughout the application
   - Used proper dynamic imports to avoid circular dependencies
   - Eliminated console.log calls in favor of structured logging
   - Added fallback mechanisms for logging when imports fail

## Next Steps

1. **Further Strategy Refinements**:
   - Implement additional specialized transformation strategies
   - Add more sophisticated content negotiation
   - Continue refining cache strategies

2. **Testing Improvements**:
   - Expand test coverage for the consolidated debug systems
   - Add edge case testing for content type filtering in cache
   - Update mocks to match newer architectural patterns

3. **Performance Optimizations**:
   - Continue reducing cold start times
   - Optimize header generation
   - Improve cache hit rates with smarter key generation
   
4. **Documentation Updates**:
   - Document the consolidated debug utility approach
   - Create examples of debug header usage
   - Update cache behavior documentation

5. **System Integration**:
   - Improve integration with monitoring systems
   - Create better observability tools for cache performance
   - Enhance debugging capabilities for production environments