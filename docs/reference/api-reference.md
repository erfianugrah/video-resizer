# Video Resizer API Reference

_Last Updated: February 18, 2026_

This document provides a comprehensive reference of public APIs, interfaces, and important types in the Video Resizer.

## Table of Contents

- [Core Handlers](#core-handlers)
- [Configuration API](#configuration-api)
- [Transformation API](#transformation-api)
- [Cache and Storage API](#cache-and-storage-api)
- [Utility Functions](#utility-functions)
- [Core Interfaces](#core-interfaces)
  - [Video Transform Options](#video-transform-options)
  - [Path Patterns](#path-patterns)
  - [Configuration Interfaces](#configuration-interfaces)
  - [Context and Diagnostics](#context-and-diagnostics)
- [Error Types](#error-types)

## Core Handlers

These are the main entry points for the Video Resizer.

### handleVideoRequest

```typescript
handleVideoRequest(
  request: Request,
  config: EnvironmentConfig,
  env?: EnvVariables,
  ctx?: ExecutionContext
): Promise<Response>
```

Main handler for processing video transformation requests.

**Parameters:**

- `request`: Cloudflare Workers Request object
- `config`: Environment configuration
- `env`: Cloudflare environment bindings (optional)
- `ctx`: Cloudflare execution context (optional)

**Returns:** Promise resolving to a Response object

**Example:**

```typescript
// In your worker.js or index.ts
export default {
  async fetch(request, env, ctx) {
    return handleVideoRequest(request, getConfig(), env, ctx);
  },
};
```

### handleConfigUpload

```typescript
handleConfigUpload(
  request: Request,
  env: EnvVariables
): Promise<Response>
```

Handles uploading new configuration to KV store.

**Parameters:**

- `request`: Request containing configuration data
- `env`: Environment variables with KV bindings

**Returns:** Promise resolving to a Response with status information

### handleConfigGet

```typescript
handleConfigGet(
  request: Request,
  env: EnvVariables
): Promise<Response>
```

Retrieves current configuration from KV store.

**Parameters:**

- `request`: Request with query parameters
- `env`: Environment variables with KV bindings

**Returns:** Promise resolving to a Response with configuration data

## Configuration API

These APIs allow accessing and managing configuration.

### VideoConfigurationManager

```typescript
VideoConfigurationManager.getInstance(): VideoConfigurationManager
```

Gets the singleton instance of the VideoConfigurationManager.

**Returns:** VideoConfigurationManager instance

```typescript
VideoConfigurationManager.getConfig(): VideoConfig
```

Gets the current video configuration.

**Returns:** VideoConfig object

```typescript
VideoConfigurationManager.getPathPatterns(): PathPattern[]
```

Gets the configured path patterns.

**Returns:** Array of PathPattern objects

```typescript
VideoConfigurationManager.getDerivative(name: string): VideoDerivative | null
```

Gets a video derivative configuration by name.

**Parameters:**

- `name`: Name of the derivative (e.g., "high", "medium", "low", "mobile")

**Returns:** VideoDerivative if found, null otherwise

**Example:**

```typescript
const videoConfig = VideoConfigurationManager.getInstance();
const mobileDerivative = videoConfig.getDerivative('mobile');
if (mobileDerivative) {
  console.log(`Mobile derivative width: ${mobileDerivative.width}`);
}
```

### CacheConfigurationManager

```typescript
CacheConfigurationManager.getInstance(): CacheConfigurationManager
```

Gets the singleton instance of the CacheConfigurationManager.

**Returns:** CacheConfigurationManager instance

```typescript
CacheConfigurationManager.getConfig(): CacheConfig
```

Gets the current cache configuration.

**Returns:** CacheConfig object

```typescript
CacheConfigurationManager.isKVCacheEnabled(): boolean
```

Determines if KV caching is enabled.

**Returns:** true if KV caching is enabled, false otherwise

```typescript
CacheConfigurationManager.shouldBypassCache(url: URL): boolean
```

Determines if caching should be bypassed for the given URL.

**Parameters:**

- `url`: URL to check

**Returns:** true if cache should be bypassed, false otherwise

### DebugConfigurationManager

```typescript
DebugConfigurationManager.getInstance(): DebugConfigurationManager
```

Gets the singleton instance of the DebugConfigurationManager.

**Returns:** DebugConfigurationManager instance

```typescript
DebugConfigurationManager.isDebugEnabled(): boolean
```

Determines if debug mode is enabled.

**Returns:** true if debug mode is enabled, false otherwise

```typescript
DebugConfigurationManager.isVerboseEnabled(): boolean
```

Determines if verbose debug mode is enabled.

**Returns:** true if verbose debug mode is enabled, false otherwise

```typescript
DebugConfigurationManager.shouldEnableForRequest(request: Request): boolean
```

Determines if debug should be enabled for a specific request.

**Parameters:**

- `request`: Request to check

**Returns:** true if debug should be enabled, false otherwise

## Transformation API

These APIs handle video transformation.

### TransformVideoCommand

```typescript
new TransformVideoCommand(context: VideoTransformContext)
```

Creates a new command for transforming video.

**Parameters:**

- `context`: Context containing request information and options

```typescript
TransformVideoCommand.execute(): Promise<Response>
```

Executes the video transformation command.

**Returns:** Promise resolving to a Response with transformed video

**Example:**

```typescript
const context = {
  request,
  options: { width: 720, height: 480, quality: 'high' },
  url: new URL(request.url),
  environment: env,
  // other required context properties
};

const command = new TransformVideoCommand(context);
const response = await command.execute();
```

### VideoTransformationService

```typescript
transformVideo(
  request: Request,
  options: VideoTransformOptions,
  pathPatterns: PathPattern[],
  debugInfo?: DebugInfo,
  env?: EnvWithAssets
): Promise<Response>
```

Main service function for video transformation.

**Parameters:**

- `request`: Incoming request
- `options`: Transformation options
- `pathPatterns`: Available path patterns
- `debugInfo`: Optional debug information
- `env`: Optional environment with assets

**Returns:** Promise resolving to a Response with transformed video

```typescript
getBestVideoFormat(request: Request): string
```

Determines optimal video format based on Accept headers.

**Parameters:**

- `request`: Incoming request

**Returns:** Best video format (e.g., "mp4", "webm")

```typescript
estimateOptimalBitrate(
  width: number,
  height: number,
  networkQuality: string
): number
```

Estimates optimal bitrate based on resolution and network conditions.

**Parameters:**

- `width`: Video width
- `height`: Video height
- `networkQuality`: Network quality identifier (e.g., "4g", "3g", "2g")

**Returns:** Estimated bitrate in bits per second

### TransformationService

```typescript
prepareVideoTransformation(
  context: TransformContext
): Promise<PreparedTransformation>
```

Prepares transformation parameters for a video request.

**Parameters:**

- `context`: Transformation context

**Returns:** Promise resolving to prepared transformation parameters

```typescript
executeTransformation(
  params: TransformExecutionParams
): Promise<TransformResult>
```

Executes the video transformation using the appropriate strategy.

**Parameters:**

- `params`: Execution parameters

**Returns:** Promise resolving to transformation result

### Transformation Strategies

```typescript
interface TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams;
  validateOptions(options: VideoTransformOptions): void | Promise<void>;
  updateDiagnostics(context: TransformationContext): void;
}
```

Interface for all transformation strategies.

```typescript
StrategyFactory.createStrategy(mode: string): TransformationStrategy
```

Creates a strategy based on transformation mode.

**Parameters:**

- `mode`: Transformation mode ("video", "frame", "spritesheet", or "audio")

**Returns:** Appropriate transformation strategy

**Example:**

```typescript
const strategy = StrategyFactory.createStrategy('frame');
const params = strategy.prepareTransformParams(context);
await strategy.validateOptions(context.options);
```

## Cache and Storage API

These APIs handle caching and storage operations.

### VideoStorageService

```typescript
VideoStorageService.fetchVideo(
  url: string,
  options?: FetchOptions
): Promise<Response>
```

Fetches a video from the specified URL.

**Parameters:**

- `url`: URL of the video
- `options`: Optional fetch options

**Returns:** Promise resolving to a Response with the video

```typescript
VideoStorageService.getVideoFromOrigin(
  url: string,
  options?: FetchOptions
): Promise<Response>
```

Gets a video directly from origin.

**Parameters:**

- `url`: URL of the video
- `options`: Optional fetch options

**Returns:** Promise resolving to a Response with the video

```typescript
VideoStorageService.generateCacheTags(
  path: string,
  options: Record<string, any>,
  headers: Headers
): string[]
```

Generates cache tags for a video.

**Parameters:**

- `path`: Video path
- `options`: Transformation options
- `headers`: Response headers

**Returns:** Array of cache tags

### CacheManagementService

```typescript
cacheManagementService.getCachedResponse(
  request: Request,
  env: EnvVariables
): Promise<Response | null>
```

Gets a cached response for a request.

**Parameters:**

- `request`: The request to get a cached response for
- `env`: Environment variables with cache bindings

**Returns:** Promise resolving to a cached Response or null if not found

```typescript
cacheManagementService.cacheResponse(
  request: Request,
  response: Response,
  env: EnvVariables
): Promise<Response>
```

Caches a response for a request.

**Parameters:**

- `request`: The request to cache
- `response`: The response to cache
- `env`: Environment variables with cache bindings

**Returns:** Promise resolving to the cached Response

### KVStorageService

```typescript
KVStorageService.getInstance(): KVStorageService
```

Gets the singleton instance of the KVStorageService.

**Returns:** KVStorageService instance

```typescript
KVStorageService.initialize(env: EnvVariables): void
```

Initializes the KV storage service.

**Parameters:**

- `env`: Environment variables with KV bindings

```typescript
KVStorageService.getItem(
  key: string,
  namespace: string
): Promise<any | null>
```

Gets an item from KV storage.

**Parameters:**

- `key`: Key of the item
- `namespace`: KV namespace

**Returns:** Promise resolving to the item or null if not found

```typescript
KVStorageService.setItem(
  key: string,
  value: any,
  namespace: string,
  ttl?: number
): Promise<boolean>
```

Sets an item in KV storage.

**Parameters:**

- `key`: Key of the item
- `value`: Value to store
- `namespace`: KV namespace
- `ttl`: Optional TTL in seconds

**Returns:** Promise resolving to true if successful, false otherwise

### PresignedUrlCacheService

```typescript
presignedUrlCacheService.getPresignedUrl(
  originalUrl: string,
  env: EnvVariables
): Promise<string | null>
```

Gets a presigned URL from the cache.

**Parameters:**

- `originalUrl`: Original URL
- `env`: Environment variables with KV bindings

**Returns:** Promise resolving to presigned URL or null if not found

```typescript
presignedUrlCacheService.storePresignedUrl(
  originalUrl: string,
  presignedUrl: string,
  env: EnvVariables,
  ttl?: number
): Promise<boolean>
```

Stores a presigned URL in the cache.

**Parameters:**

- `originalUrl`: Original URL
- `presignedUrl`: Presigned URL
- `env`: Environment variables with KV bindings
- `ttl`: Optional TTL in seconds

**Returns:** Promise resolving to true if successful, false otherwise

## Utility Functions

These are utility functions for working with the Video Resizer.

### Path Utilities

```typescript
pathUtils.findMatchingPathPattern(
  path: string,
  patterns: PathPattern[]
): PathPattern | null
```

Finds a matching path pattern for a path.

**Parameters:**

- `path`: Path to match
- `patterns`: Array of path patterns

**Returns:** Matching PathPattern or null if no match found

```typescript
pathUtils.isCdnCgiMediaPath(path: string): boolean
```

Determines if a path is a Cloudflare Media path.

**Parameters:**

- `path`: Path to check

**Returns:** true if path is a Cloudflare Media path, false otherwise

```typescript
pathUtils.normalizePath(path: string): string
```

Normalizes a path.

**Parameters:**

- `path`: Path to normalize

**Returns:** Normalized path

### URL Transform Utilities

```typescript
urlTransformUtils.transformUrl(
  url: URL,
  cdnParams: Record<string, string>,
  cdnCgiBasePath: string
): string
```

Transforms a URL for Cloudflare Media.

**Parameters:**

- `url`: URL to transform
- `cdnParams`: Cloudflare Media parameters
- `cdnCgiBasePath`: Base path for Cloudflare Media

**Returns:** Transformed URL string

```typescript
urlTransformUtils.buildCdnCgiUrl(
  params: BuildCdnCgiUrlParams
): string
```

Builds a Cloudflare Media URL.

**Parameters:**

- `params`: Parameters for building the URL

**Returns:** Built URL string

### Cache Utilities

```typescript
cacheUtils.addCacheHeaders(
  response: Response,
  status: number,
  config: CacheConfig,
  source: string
): Response
```

Adds cache headers to a response.

**Parameters:**

- `response`: Response to add headers to
- `status`: Response status
- `config`: Cache configuration
- `source`: Cache source

**Returns:** Response with cache headers

```typescript
cacheUtils.shouldCacheStatus(status: number): boolean
```

Determines if a status should be cached.

**Parameters:**

- `status`: HTTP status code

**Returns:** true if status should be cached, false otherwise

```typescript
cacheUtils.getCacheTtl(
  status: number,
  config: CacheConfig
): number
```

Gets the TTL for a status.

**Parameters:**

- `status`: HTTP status code
- `config`: Cache configuration

**Returns:** TTL in seconds

### Debug Utilities

```typescript
debugHeadersUtils.addDebugHeaders(
  response: Response,
  diagnostics: DiagnosticsInfo
): Response
```

Adds debug headers to a response.

**Parameters:**

- `response`: Response to add headers to
- `diagnostics`: Diagnostic information

**Returns:** Response with debug headers

```typescript
debugHeadersUtils.extractRequestHeaders(
  request: Request
): RequestHeaders
```

Extracts headers from a request.

**Parameters:**

- `request`: Request to extract headers from

**Returns:** Extracted headers as a RequestHeaders object

### Logging Utilities

```typescript
pinoLogger.createLogger(context: any): Logger
```

Creates a logger.

**Parameters:**

- `context`: Logger context

**Returns:** Logger instance

```typescript
pinoLogger.debug(
  context: any,
  logger: Logger,
  component: string,
  message: string,
  data?: Record<string, unknown>
): void
```

Logs a debug message.

**Parameters:**

- `context`: Log context
- `logger`: Logger instance
- `component`: Component name
- `message`: Log message
- `data`: Optional log data

```typescript
pinoLogger.info(
  context: any,
  logger: Logger,
  component: string,
  message: string,
  data?: Record<string, unknown>
): void
```

Logs an info message.

**Parameters:**

- `context`: Log context
- `logger`: Logger instance
- `component`: Component name
- `message`: Log message
- `data`: Optional log data

```typescript
pinoLogger.warn(
  context: any,
  logger: Logger,
  component: string,
  message: string,
  data?: Record<string, unknown>
): void
```

Logs a warning message.

**Parameters:**

- `context`: Log context
- `logger`: Logger instance
- `component`: Component name
- `message`: Log message
- `data`: Optional log data

```typescript
pinoLogger.error(
  context: any,
  logger: Logger,
  component: string,
  message: string,
  data?: Record<string, unknown>
): void
```

Logs an error message.

**Parameters:**

- `context`: Log context
- `logger`: Logger instance
- `component`: Component name
- `message`: Log message
- `data`: Optional log data

### Request Context Utilities

```typescript
requestContext.createRequestContext(
  request: Request,
  ctx?: ExecutionContext
): RequestContext
```

Creates a request context.

**Parameters:**

- `request`: Request
- `ctx`: Optional execution context

**Returns:** Created RequestContext

```typescript
requestContext.getCurrentContext(): RequestContext | null
```

Gets the current request context.

**Returns:** Current RequestContext or null if not set

```typescript
requestContext.addBreadcrumb(
  context: RequestContext,
  category: string,
  message: string,
  data?: Record<string, unknown>
): void
```

Adds a breadcrumb to a request context.

**Parameters:**

- `context`: Request context
- `category`: Breadcrumb category
- `message`: Breadcrumb message
- `data`: Optional breadcrumb data

```typescript
requestContext.getClientDiagnostics(
  request: Request
): ClientDiagnostics
```

Gets client diagnostics from a request.

**Parameters:**

- `request`: Request to get diagnostics from

**Returns:** ClientDiagnostics object

### Response Builder

```typescript
new ResponseBuilder(response: Response, context: RequestContext)
```

Creates a new response builder.

**Parameters:**

- `response`: Base response
- `context`: Request context

```typescript
ResponseBuilder.withDebugInfo(
  debugInfo?: DebugInfo
): ResponseBuilder
```

Adds debug information to a response.

**Parameters:**

- `debugInfo`: Debug information to add

**Returns:** ResponseBuilder for chaining

```typescript
ResponseBuilder.withCaching(
  status: number,
  cacheConfig?: Record<string, unknown>,
  source?: string,
  derivative?: string
): ResponseBuilder
```

Adds caching to a response.

**Parameters:**

- `status`: Response status
- `cacheConfig`: Optional cache configuration
- `source`: Optional cache source
- `derivative`: Optional derivative name

**Returns:** ResponseBuilder for chaining

```typescript
ResponseBuilder.build(): Promise<Response>
```

Builds the response.

**Returns:** Promise resolving to the built Response

**Example:**

```typescript
const builder = new ResponseBuilder(baseResponse, context);
const finalResponse = await builder
  .withDebugInfo(debugInfo)
  .withCaching(200, cacheConfig, 'edge')
  .build();
```

## Core Interfaces

These are the core interfaces used in the Video Resizer.

### Video Transform Options

```typescript
interface VideoTransformOptions {
  width?: number | null;
  height?: number | null;
  mode?: string | null;
  fit?: string | null;
  audio?: boolean | null;
  format?: string | null;
  time?: string | null;
  duration?: string | null;
  quality?: string | null;
  compression?: string | null;
  loop?: boolean | null;
  preload?: string | null;
  autoplay?: boolean | null;
  muted?: boolean | null;
  source?: string;
  derivative?: string | null;
  fps?: number | null;
  speed?: number | null;
  crop?: string | null;
  rotate?: number | null;
  imref?: string | null;
  version?: number;
  diagnosticsInfo?: Record<string, any>;
  customData?: Record<string, unknown>;
}
```

Options for video transformation.

**Properties:**

- `width`: Width in pixels
- `height`: Height in pixels
- `mode`: Transformation mode ("video", "frame", "spritesheet", "audio")
- `fit`: Fit mode ("cover", "contain", "crop", "scale-down")
- `audio`: Whether to include audio
- `format`: Output format (mp4, webm, etc.)
- `time`: Timestamp for frame extraction (e.g., "10s", "25%")
- `duration`: Duration limit (e.g., "30s")
- `quality`: Quality setting ("low", "medium", "high", "auto")
- `compression`: Compression level ("low", "medium", "high", "auto")
- `loop`: Whether to loop the video
- `preload`: Preload behavior ("auto", "metadata", "none")
- `autoplay`: Whether to autoplay the video
- `muted`: Whether to mute the video
- `source`: Source URL
- `derivative`: Named derivative to use (e.g., "mobile", "high")
- `fps`: Frames per second
- `speed`: Playback speed
- `crop`: Crop settings
- `rotate`: Rotation angle in degrees
- `imref`: IMQuery reference
- `version`: Cache version
- `diagnosticsInfo`: Additional diagnostic information
- `customData`: Custom data for extensions

### Path Patterns

```typescript
interface PathPattern {
  name: string;
  matcher: string;
  processPath: boolean;
  baseUrl?: string | null;
  originUrl?: string | null;
  quality?: string;
  ttl?: {
    ok: number;
    redirects: number;
    clientError: number;
    serverError: number;
  };
  useTtlByStatus?: boolean;
  priority?: number;
  captureGroups?: string[];
  transformationOverrides?: Record<string, any>;
}
```

Pattern for matching URL paths.

**Properties:**

- `name`: Pattern name
- `matcher`: Regex pattern for matching paths
- `processPath`: Whether to process the path
- `baseUrl`: Base URL for the pattern
- `originUrl`: Origin URL for fetching content
- `quality`: Default quality for this pattern
- `ttl`: TTL settings for different response types
- `useTtlByStatus`: Whether to use TTL based on status
- `priority`: Pattern priority (higher numbers have higher priority)
- `captureGroups`: Named capture groups in the regex
- `transformationOverrides`: Override parameters for transformation

### Configuration Interfaces

```typescript
interface EnvironmentConfig {
  mode: string;
  isProduction: boolean;
  isStaging: boolean;
  isDevelopment: boolean;
  version: string;
  debug: {
    enabled: boolean;
    verbose: boolean;
    includeHeaders: boolean;
    includePerformance: boolean;
    allowedIps: string[];
    excludedPaths: string[];
  };
  cache: {
    debug: boolean;
    defaultTtl: number;
    respectOrigin: boolean;
    cacheEverything: boolean;
    enableTags: boolean;
    purgeOnUpdate: boolean;
    bypassParams: string[];
    enableKVCache: boolean;
    kvTtl: {
      ok: number;
      redirects: number;
      clientError: number;
      serverError: number;
    };
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
    includeTimestamps: boolean;
    includeComponent: boolean;
    colorize: boolean;
    enabledComponents: string[];
    disabledComponents: string[];
    sampleRate: number;
    performance: boolean;
    performanceThreshold: number;
  };
  video: {
    defaultQuality: string;
    defaultCompression: string;
    defaultAudio: boolean;
    defaultFit: string;
  };
  cdnCgi: {
    basePath: string;
  };
  advanced: {
    workerConcurrency: number;
    requestTimeout: number;
    maxVideoSize: number;
  };
  pathPatterns?: PathPattern[];
}
```

Main configuration interface with all settings.

```typescript
interface VideoDerivative {
  width?: number;
  height?: number;
  quality?: string;
  compression?: string;
  fit?: string;
  audio?: boolean;
  muted?: boolean;
  loop?: boolean;
  autoplay?: boolean;
  time?: string;
  [key: string]: unknown;
}
```

Preset configurations for different use cases.

### Context and Diagnostics

```typescript
interface TransformationContext {
  request: Request;
  options: VideoTransformOptions;
  pathPattern: PathPattern;
  url: URL;
  path: string;
  diagnosticsInfo: DiagnosticsInfo;
  env?: {
    ASSETS?: {
      fetch: (request: Request) => Promise<Response>;
    };
  };
}
```

Context for transformation strategies.

```typescript
interface RequestContext {
  requestId: string;
  url?: string;
  startTime: number;
  breadcrumbs: Breadcrumb[];
  diagnostics: DiagnosticsInfo;
  componentTiming: Record<string, ComponentTiming>;
  debugEnabled: boolean;
  verboseEnabled: boolean;
}
```

Request context for tracking and diagnostics.

```typescript
interface Breadcrumb {
  message: string;
  category: string;
  timestamp: number;
  data?: Record<string, unknown>;
}
```

Breadcrumb for tracking request processing steps.

```typescript
interface DiagnosticsInfo {
  originalUrl: string;
  errors: string[];
  warnings: string[];
  requestHeaders?: RequestHeaders;
  responseHeaders?: ResponseHeaders;
  pathMatch?: string;
  derivative?: string;
  transformParams?: Record<string, any>;
  cdnCgiUrl?: string;
  processingTimeMs?: number;
  browserCapabilities?: BrowserCapabilities;
  clientHints?: boolean;
  deviceType?: string;
  networkQuality?: string;
  videoInfo?: {
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
    size?: number;
  };
  cacheInfo?: {
    enabled: boolean;
    hit: boolean;
    ttl?: number;
    key?: string;
  };
  [key: string]: any;
}
```

Diagnostic information for debugging.

## Response Headers

### X-CF-Error-Code

When a Cloudflare Media Transformation error occurs, the `X-CF-Error-Code` response header is set with the numeric error code extracted from the `Cf-Resized` response header. This header is useful for programmatic error handling and diagnostics.

**Example:**

```
X-CF-Error-Code: 9402
```

### CfErrorCode Values

The `CfErrorCode` enum defines known Cloudflare Media Transformation error codes (range 9401–9523). These are used internally for error classification, retry decisions, and mapping to appropriate HTTP status codes.

| Code | Description                 | HTTP Status | Retryable |
| ---- | --------------------------- | ----------- | --------- |
| 9401 | Input video too large       | 413         | No        |
| 9402 | Could not fetch input video | 502         | Yes       |
| 9403 | Input duration too long     | 413         | No        |
| 9406 | Invalid input video         | 400         | No        |
| 9407 | Input video too wide/tall   | 413         | No        |
| 9409 | Request timeout             | 504         | Yes       |
| 9413 | Input too large (POST body) | 413         | No        |
| 9415 | Unsupported media type      | 415         | No        |
| 9429 | Rate limited                | 429         | Yes       |
| 9500 | Internal Cloudflare error   | 500         | Yes       |
| 9503 | Service unavailable         | 503         | Yes       |
| 9523 | Origin unreachable          | 502         | Yes       |

The `CF_ERROR_MAP` constant provides the full mapping of each `CfErrorCode` to its human-readable description, HTTP status code, and retryability flag.

## Error Types

The Video Resizer defines several error types for specific error scenarios.

### VideoTransformError

```typescript
class VideoTransformError extends Error {
  public readonly type: ErrorType;
  public readonly status: number;
  public readonly context?: ErrorContext;
  public readonly originalError?: Error;

  constructor(
    message: string,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    context?: ErrorContext,
    originalError?: Error
  );

  toJSON(): ErrorResponseBody;
  toResponse(): Response;
}
```

Base error class for all Video Resizer errors.

### ConfigurationError

```typescript
class ConfigurationError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.CONFIGURATION_ERROR,
    context?: ErrorContext,
    originalError?: Error
  );

  static missingProperty(property: string, context?: ErrorContext): ConfigurationError;
  static invalidConfiguration(
    property: string,
    value: any,
    context?: ErrorContext
  ): ConfigurationError;
}
```

Error class for configuration-related errors.

### NotFoundError

```typescript
class NotFoundError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.NOT_FOUND,
    context?: ErrorContext,
    originalError?: Error
  );

  static resourceNotFound(path: string, context?: ErrorContext): NotFoundError;
  static patternNotFound(path: string, context?: ErrorContext): NotFoundError;
}
```

Error class for resource not found errors.

### ProcessingError

```typescript
class ProcessingError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.TRANSFORMATION_ERROR,
    context?: ErrorContext,
    originalError?: Error
  );

  static transformationFailed(
    reason: string,
    context?: ErrorContext,
    originalError?: Error
  ): ProcessingError;
  static fetchFailed(
    url: string,
    status: number,
    context?: ErrorContext,
    originalError?: Error
  ): ProcessingError;
}
```

Error class for general processing errors.

### ValidationError

```typescript
class ValidationError extends VideoTransformError {
  constructor(
    message: string,
    type: ErrorType = ErrorType.INVALID_PARAMETERS,
    context?: ErrorContext,
    originalError?: Error
  );

  static invalidMode(mode: string, context?: ErrorContext): ValidationError;
  static invalidDimensions(width: string, height: string, context?: ErrorContext): ValidationError;
  static patternNotFound(path: string, context?: ErrorContext): ValidationError;
}
```

Error class for input validation errors.

---

This API reference provides a comprehensive overview of the public interfaces and types in the Video Resizer. For detailed examples and guides, see the other documentation sections, particularly the [Guides](../guides/README.md) section.
