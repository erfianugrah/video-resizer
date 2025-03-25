# Advanced Logging & Response Handling Implementation Plan

## Overview
This document outlines a comprehensive strategy for implementing an advanced logging system using Pino and a centralized response handling mechanism for the Video Resizer service.

## Problem Statement
The current implementation has several limitations:

1. **Distributed Logging**: Logging is scattered throughout the codebase with inconsistent patterns
2. **No Request Context**: It's difficult to track a single request across multiple service components
3. **Manual Header Management**: Response headers are set in multiple places without a unified approach
4. **Limited Error Tracking**: The current error logging doesn't provide sufficient context for debugging
5. **No Performance Tracking**: We lack comprehensive performance metrics for different parts of the request lifecycle

## Goals
1. Create a unified logging system with request-specific context
2. Implement a breadcrumb trail for debugging request flows
3. Centralize response header management
4. Standardize error handling with detailed context
5. Add performance tracking for request components
6. Ensure thread safety in Cloudflare Workers environment

## Architecture

### Core Components
1. **PinoLogger**: Request-scoped logger with breadcrumb support
2. **RequestContext**: Shared context object for request lifecycle data
3. **ResponseBuilder**: Centralized response construction with header management
4. **DiagnosticsCollector**: Expanded diagnostics gathering system
5. **HeaderSerializer**: Standardized header formatting and chunking

### Data Flow
1. Create RequestContext and logger at the start of each request
2. Add breadcrumbs during request processing
3. Collect diagnostics throughout the request lifecycle
4. Use ResponseBuilder to create the final response with appropriate headers

## Implementation Plan

## Phase 1: Foundation - Request Context & Logger

### 1.1 Create RequestContext

```typescript
// src/utils/requestContext.ts
import { DiagnosticsInfo } from './debugHeadersUtils';
import { v4 as uuidv4 } from 'uuid';

export interface Breadcrumb {
  timestamp: number;       // When this event occurred
  category: string;        // Component/category name
  message: string;         // Event description
  data?: Record<string, any>; // Additional context data
  durationMs?: number;     // Duration since last breadcrumb
  elapsedMs?: number;      // Time since request start
}

export interface RequestContext {
  // Request identification
  requestId: string;      // Unique ID for the request
  url: string;            // Original request URL
  startTime: number;      // Request start timestamp
  
  // Tracking data
  breadcrumbs: Breadcrumb[];  // Chronological events during processing
  diagnostics: DiagnosticsInfo; // Expanded diagnostic information
  
  // Performance tracking
  componentTiming: Record<string, number>; // Time spent in each component
  
  // Feature flags
  debugEnabled: boolean;  // Whether debug mode is enabled
  verboseEnabled: boolean; // Whether verbose logging is enabled
}

/**
 * Create a new request context
 */
export function createRequestContext(request: Request): RequestContext {
  const url = new URL(request.url);
  
  // Check for debug parameters
  const debugEnabled = url.searchParams.has('debug');
  const verboseEnabled = url.searchParams.has('verbose') || url.searchParams.get('debug') === 'verbose';
  
  return {
    requestId: uuidv4(),
    url: request.url,
    startTime: performance.now(),
    breadcrumbs: [],
    diagnostics: {
      originalUrl: request.url,
    },
    componentTiming: {},
    debugEnabled,
    verboseEnabled
  };
}

/**
 * Add a new breadcrumb to the request context
 */
export function addBreadcrumb(
  context: RequestContext,
  category: string,
  message: string,
  data?: Record<string, any>
): Breadcrumb {
  const timestamp = performance.now();
  const elapsedMs = timestamp - context.startTime;
  
  // Calculate duration from previous breadcrumb if available
  let durationMs: number | undefined;
  if (context.breadcrumbs.length > 0) {
    const lastBreadcrumb = context.breadcrumbs[context.breadcrumbs.length - 1];
    durationMs = timestamp - lastBreadcrumb.timestamp;
  }
  
  const breadcrumb: Breadcrumb = {
    timestamp,
    category,
    message,
    data,
    elapsedMs,
    durationMs
  };
  
  context.breadcrumbs.push(breadcrumb);
  
  // Update component timing
  if (durationMs !== undefined) {
    context.componentTiming[category] = (context.componentTiming[category] || 0) + durationMs;
  }
  
  return breadcrumb;
}
```

### 1.2 Implement Pino Logger

```typescript
// src/utils/pinoLogger.ts
import pino from 'pino';
import { RequestContext, addBreadcrumb } from './requestContext';

// Create the base logger
const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'video-resizer' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a request-scoped logger
 */
export function createLogger(context: RequestContext) {
  return baseLogger.child({ requestId: context.requestId });
}

/**
 * Log a message with breadcrumb
 */
export function logWithBreadcrumb(
  logger: pino.Logger,
  context: RequestContext,
  level: 'debug' | 'info' | 'warn' | 'error',
  category: string,
  message: string,
  data?: Record<string, any>
) {
  // Add the breadcrumb
  const breadcrumb = addBreadcrumb(context, category, message, data);
  
  // Skip debug logs if debug mode is not enabled
  if (level === 'debug' && !context.debugEnabled) {
    return breadcrumb;
  }
  
  // Add timing information
  const logData = {
    ...data,
    requestId: context.requestId,
    elapsedMs: breadcrumb.elapsedMs,
    ...(breadcrumb.durationMs ? { durationMs: breadcrumb.durationMs } : {})
  };
  
  // Log with the appropriate level
  switch (level) {
    case 'debug':
      logger.debug(logData, `[${category}] ${message}`);
      break;
    case 'info':
      logger.info(logData, `[${category}] ${message}`);
      break;
    case 'warn':
      logger.warn(logData, `[${category}] ${message}`);
      break;
    case 'error':
      logger.error(logData, `[${category}] ${message}`);
      break;
  }
  
  return breadcrumb;
}

/**
 * Legacy API compatibility for existing code
 */
export function debug(context: RequestContext, logger: pino.Logger, component: string, message: string, data?: Record<string, any>) {
  return logWithBreadcrumb(logger, context, 'debug', component, message, data);
}

export function info(context: RequestContext, logger: pino.Logger, component: string, message: string, data?: Record<string, any>) {
  return logWithBreadcrumb(logger, context, 'info', component, message, data);
}

export function warn(context: RequestContext, logger: pino.Logger, component: string, message: string, data?: Record<string, any>) {
  return logWithBreadcrumb(logger, context, 'warn', component, message, data);
}

export function error(context: RequestContext, logger: pino.Logger, component: string, message: string, data?: Record<string, any>) {
  return logWithBreadcrumb(logger, context, 'error', component, message, data);
}
```

### 1.3 Create Legacy Logger Adapter

To ease migration, create an adapter for existing code:

```typescript
// src/utils/legacyLoggerAdapter.ts
import { createLogger, logWithBreadcrumb } from './pinoLogger';
import { createRequestContext, RequestContext } from './requestContext';
import pino from 'pino';

// Global request context for legacy calls
let currentContext: RequestContext | null = null;
let currentLogger: pino.Logger | null = null;

/**
 * Initialize the legacy logger with a request
 */
export function initializeLegacyLogger(request: Request) {
  currentContext = createRequestContext(request);
  currentLogger = createLogger(currentContext);
  return { context: currentContext, logger: currentLogger };
}

/**
 * Clear the current request context
 */
export function clearLegacyLogger() {
  currentContext = null;
  currentLogger = null;
}

/**
 * Legacy debug function
 */
export function debug(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.debug(`[${component}] ${message}`, data);
    return;
  }
  
  logWithBreadcrumb(currentLogger, currentContext, 'debug', component, message, data);
}

/**
 * Legacy info function 
 */
export function info(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.info(`[${component}] ${message}`, data);
    return;
  }
  
  logWithBreadcrumb(currentLogger, currentContext, 'info', component, message, data);
}

/**
 * Legacy warn function
 */
export function warn(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.warn(`[${component}] ${message}`, data);
    return;
  }
  
  logWithBreadcrumb(currentLogger, currentContext, 'warn', component, message, data);
}

/**
 * Legacy error function
 */
export function error(component: string, message: string, data?: Record<string, unknown>) {
  if (!currentContext || !currentLogger) {
    console.error(`[${component}] ${message}`, data);
    return;
  }
  
  logWithBreadcrumb(currentLogger, currentContext, 'error', component, message, data);
}

/**
 * Get the current request context if one exists
 */
export function getCurrentContext(): RequestContext | null {
  return currentContext;
}
```

## Phase 2: Response Building & Header Management

### 2.1 Create Response Builder

```typescript
// src/utils/responseBuilder.ts
import { RequestContext } from './requestContext';
import { serializeHeaders } from './headerSerializer';

export class ResponseBuilder {
  private response: Response;
  private context: RequestContext;
  private headers: Headers;
  private cachingApplied = false;
  private debugApplied = false;

  constructor(response: Response, context: RequestContext) {
    this.response = response;
    this.context = context;
    this.headers = new Headers(response.headers);
  }

  /**
   * Apply caching headers based on configuration
   */
  withCaching(
    status: number,
    cacheConfig?: any,
    source?: string,
    derivative?: string
  ): ResponseBuilder {
    // Skip if already applied
    if (this.cachingApplied) {
      return this;
    }
    
    // Cache TTL values based on response status code
    let cacheTtl = 0;
    
    if (cacheConfig?.cacheability !== false) {
      // Determine TTL based on status code category
      if (status >= 200 && status < 300) {
        cacheTtl = cacheConfig?.ttl?.ok || 3600;
      } else if (status >= 300 && status < 400) {
        cacheTtl = cacheConfig?.ttl?.redirects || 60;
      } else if (status >= 400 && status < 500) {
        cacheTtl = cacheConfig?.ttl?.clientError || 10;
      } else {
        cacheTtl = cacheConfig?.ttl?.serverError || 0;
      }
      
      // Add cache headers
      if (cacheTtl > 0) {
        this.headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
        
        // Set cache tags if available
        if (cacheConfig?.cacheTags && cacheConfig.cacheTags.length > 0) {
          this.headers.set('Cache-Tag', cacheConfig.cacheTags.join(','));
        }
      } else {
        this.headers.set('Cache-Control', 'no-store, no-cache');
      }
      
      // Add diagnostic info to context
      this.context.diagnostics.cacheability = cacheConfig?.cacheability !== false;
      this.context.diagnostics.cacheTtl = cacheTtl;
      this.context.diagnostics.transformSource = source;
      
      if (derivative) {
        this.context.diagnostics.derivative = derivative;
      }
    } else {
      this.headers.set('Cache-Control', 'no-store, no-cache');
      this.context.diagnostics.cacheability = false;
    }
    
    this.cachingApplied = true;
    return this;
  }

  /**
   * Add debug headers based on context
   */
  withDebugInfo(): ResponseBuilder {
    // Skip if already applied or debug not enabled
    if (this.debugApplied || !this.context.debugEnabled) {
      return this;
    }
    
    // Basic debug headers
    this.headers.set('X-Video-Resizer-Debug', 'true');
    this.headers.set('X-Video-Resizer-Version', '1.0.0');
    
    // Add processing time
    const endTime = performance.now();
    const processingTimeMs = Math.round(endTime - this.context.startTime);
    this.headers.set('X-Processing-Time-Ms', processingTimeMs.toString());
    this.context.diagnostics.processingTimeMs = processingTimeMs;
    
    // Add breadcrumbs count
    this.headers.set('X-Breadcrumbs-Count', this.context.breadcrumbs.length.toString());
    
    // Add component timing
    const componentTimingJson = JSON.stringify(this.context.componentTiming);
    this.headers.set('X-Component-Timing', componentTimingJson);
    
    // Add serialized headers from diagnostics
    const diagnosticsHeaders = serializeHeaders(this.context.diagnostics, this.context.verboseEnabled);
    
    // Add all diagnostic headers
    for (const [key, value] of Object.entries(diagnosticsHeaders)) {
      this.headers.set(key, value);
    }
    
    // If verbose is enabled, add breadcrumbs
    if (this.context.verboseEnabled) {
      // Add serialized breadcrumbs
      const breadcrumbHeaders = serializeHeaders(
        { breadcrumbs: this.context.breadcrumbs }, 
        true, 
        'X-Breadcrumb'
      );
      
      // Add all breadcrumb headers
      for (const [key, value] of Object.entries(breadcrumbHeaders)) {
        this.headers.set(key, value);
      }
    }
    
    this.debugApplied = true;
    return this;
  }

  /**
   * Add custom headers
   */
  withHeaders(headers: Record<string, string>): ResponseBuilder {
    Object.entries(headers).forEach(([key, value]) => {
      this.headers.set(key, value);
    });
    return this;
  }

  /**
   * Add CDN error information headers
   */
  withCdnErrorInfo(
    status: number,
    errorResponse: string,
    originalUrl?: string
  ): ResponseBuilder {
    this.headers.set('X-CDN-Error-Status', status.toString());
    this.headers.set('X-CDN-Error-Response', errorResponse.substring(0, 200));
    
    if (originalUrl) {
      this.headers.set('X-Original-Source-URL', originalUrl);
    }
    
    // Update diagnostics
    this.context.diagnostics.cdnErrorStatus = status;
    this.context.diagnostics.cdnErrorResponse = errorResponse;
    if (originalUrl) {
      this.context.diagnostics.originalSourceUrl = originalUrl;
    }
    
    return this;
  }

  /**
   * Build the final response
   */
  build(): Response {
    // Apply debug headers if not already done
    if (!this.debugApplied && this.context.debugEnabled) {
      this.withDebugInfo();
    }
    
    // Create the final response with all headers
    return new Response(this.response.body, {
      status: this.response.status,
      statusText: this.response.statusText,
      headers: this.headers
    });
  }
}
```

### 2.2 Create Header Serializer

```typescript
// src/utils/headerSerializer.ts

/**
 * Serialize an object for HTTP headers
 * For complex objects, split into multiple headers
 */
export function serializeHeaders(
  data: Record<string, any>,
  includeObjects = false,
  prefix = 'X'
): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Process each property
  for (const [key, value] of Object.entries(data)) {
    // Skip null/undefined values
    if (value === null || value === undefined) {
      continue;
    }
    
    // Format key with proper casing
    const formattedKey = formatHeaderKey(key, prefix);
    
    // Handle different value types
    if (typeof value === 'string') {
      result[formattedKey] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[formattedKey] = value.toString();
    } else if (Array.isArray(value) && value.length > 0) {
      // If simple array of primitives
      if (isPrimitiveArray(value)) {
        result[formattedKey] = value.join(',');
      } else if (includeObjects) {
        // Complex array, serialize as JSON and potentially split
        serializeComplexValue(result, formattedKey, value);
      }
    } else if (typeof value === 'object' && includeObjects) {
      // Serialize object values
      serializeComplexValue(result, formattedKey, value);
    }
  }
  
  return result;
}

/**
 * Format a key for HTTP header use
 */
function formatHeaderKey(key: string, prefix: string): string {
  // Convert camelCase to Hyphen-Case with prefix
  const formattedKey = key
    .replace(/([A-Z])/g, '-$1')
    .replace(/[-_\s]+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
  
  // Capitalize each segment
  const capitalizedKey = formattedKey
    .split('-')
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('-');
  
  return `${prefix}-${capitalizedKey}`;
}

/**
 * Check if an array contains only primitives
 */
function isPrimitiveArray(arr: any[]): boolean {
  return arr.every(item => 
    typeof item === 'string' || 
    typeof item === 'number' || 
    typeof item === 'boolean'
  );
}

/**
 * Serialize a complex value, splitting into chunks if needed
 */
function serializeComplexValue(
  result: Record<string, string>,
  key: string,
  value: any
): void {
  const json = JSON.stringify(value);
  
  // If small enough, store directly
  if (json.length <= 500) {
    result[key] = json;
    return;
  }
  
  // Otherwise split into chunks
  const chunks = Math.ceil(json.length / 500);
  for (let i = 0; i < chunks; i++) {
    const chunk = json.substring(i * 500, (i + 1) * 500);
    result[`${key}-${i + 1}`] = chunk;
  }
  
  // Add chunk count
  result[`${key}-Count`] = chunks.toString();
}
```

## Phase 3: Integration into Request Handlers

### 3.1 Update TransformVideoCommand

```typescript
// src/domain/commands/TransformVideoCommand.ts

import { createRequestContext } from '../../utils/requestContext';
import { createLogger, logWithBreadcrumb } from '../../utils/pinoLogger';
import { ResponseBuilder } from '../../utils/responseBuilder';
import pino from 'pino';

// Updated execute method
async execute(): Promise<Response> {
  // Create request context and logger
  const context = createRequestContext(this.context.request);
  const logger = createLogger(context);
  
  // Store debug info in context
  if (this.context.debugInfo) {
    context.debugEnabled = this.context.debugInfo.isEnabled;
    context.verboseEnabled = !!this.context.debugInfo.isVerbose;
  }
  
  // Start breadcrumb trail
  logWithBreadcrumb(
    logger,
    context,
    'info',
    'TransformVideoCommand',
    'Starting video transformation',
    { url: this.context.request.url }
  );
  
  try {
    // Extract context information
    const { request, options, pathPatterns } = this.context;
    logWithBreadcrumb(
      logger,
      context,
      'debug',
      'TransformVideoCommand',
      'Processing request',
      { 
        url: request.url,
        hasOptions: !!options,
        pathPatternCount: pathPatterns.length
      }
    );
    
    // Store diagnostics
    context.diagnostics.originalUrl = request.url;
    
    // [... existing transformation logic with added breadcrumbs ...]
    
    // For CDN fetch:
    logWithBreadcrumb(
      logger,
      context,
      'debug',
      'TransformVideoCommand',
      'Fetching from CDN-CGI',
      { cdnCgiUrl }
    );
    
    const response = await fetch(cdnCgiUrl, fetchOptions);
    
    // CDN Error handling with breadcrumbs
    if (response.status === 400) {
      let errorResponseText = '';
      try {
        errorResponseText = await response.text();
      } catch (e) {
        errorResponseText = 'Could not read error response';
      }
      
      logWithBreadcrumb(
        logger,
        context,
        'warn',
        'TransformVideoCommand',
        'CDN-CGI returned 400 Bad Request, using original URL instead',
        { cdnCgiUrl, errorResponseText }
      );
      
      // [... Original URL resolution logic ...]
      
      logWithBreadcrumb(
        logger,
        context,
        'debug',
        'TransformVideoCommand',
        'Fetching original video',
        { originalVideoUrl }
      );
      
      const originalResponse = await fetch(originalVideoUrl, originalFetchOptions);
      
      return new ResponseBuilder(originalResponse, context)
        .withCaching(originalResponse.status, cacheConfig, source, derivative)
        .withCdnErrorInfo(400, errorResponseText, originalVideoUrl)
        .build();
    }
    
    // Regular response handling
    logWithBreadcrumb(
      logger,
      context,
      'debug',
      'TransformVideoCommand',
      'Received CDN-CGI response',
      { status: response.status }
    );
    
    return new ResponseBuilder(response, context)
      .withCaching(response.status, cacheConfig, source, derivative)
      .build();
    
  } catch (err) {
    // Error handling with breadcrumbs
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    logWithBreadcrumb(
      logger,
      context,
      'error',
      'TransformVideoCommand',
      'Error transforming video',
      { 
        error: errorMessage,
        stack: err instanceof Error ? err.stack : undefined
      }
    );
    
    // Create error response
    const errorResponse = new Response(`Error transforming video: ${errorMessage}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
    
    // Build the error response
    return new ResponseBuilder(errorResponse, context)
      .withCaching(500)
      .build();
  }
}
```

### 3.2 Update videoHandler.ts

```typescript
// src/handlers/videoHandler.ts

import { createRequestContext } from '../utils/requestContext';
import { createLogger, logWithBreadcrumb } from '../utils/pinoLogger';
import { ResponseBuilder } from '../utils/responseBuilder';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  // Create request context and logger
  const context = createRequestContext(request);
  const logger = createLogger(context);
  
  // First breadcrumb
  logWithBreadcrumb(
    logger, 
    context, 
    'info', 
    'VideoHandler', 
    'Received request', 
    { url: request.url }
  );
  
  try {
    const url = new URL(request.url);
    
    // Add request information to diagnostics
    context.diagnostics.requestUrl = url.toString();
    context.diagnostics.requestMethod = request.method;
    
    // [... Existing handler logic with added breadcrumbs ...]
    
    // Pass the context to the command
    const command = new TransformVideoCommand({
      request,
      options,
      pathPatterns: videoConfig.pathPatterns,
      debugInfo: context.debugEnabled ? {
        isEnabled: context.debugEnabled,
        isVerbose: context.verboseEnabled,
        includeHeaders: true,
        includePerformance: true
      } : undefined,
      env,
      requestContext: context, // Pass the context to the command
      logger // Pass the logger too
    });
    
    logWithBreadcrumb(
      logger,
      context,
      'debug',
      'VideoHandler',
      'Executing transformation command',
      { options: JSON.stringify(options) }
    );
    
    return await command.execute();
    
  } catch (err) {
    // Error handling with proper logging
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    logWithBreadcrumb(
      logger,
      context,
      'error',
      'VideoHandler',
      'Error handling request',
      { 
        error: errorMessage,
        stack: err instanceof Error ? err.stack : undefined
      }
    );
    
    const errorResponse = new Response(`Error handling request: ${errorMessage}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
    
    return new ResponseBuilder(errorResponse, context).build();
  }
}
```

## Phase 4: Performance Monitoring & Analysis

### 4.1 Performance Tracker

```typescript
// src/utils/performanceTracker.ts
import { RequestContext, Breadcrumb } from './requestContext';

export interface PerformanceMetrics {
  totalDurationMs: number;
  componentBreakdown: Record<string, number>;
  operationBreakdown: Record<string, number>;
  slowestOperations: Array<{name: string, durationMs: number}>;
  breadcrumbCount: number;
}

/**
 * Analyze performance metrics from request context
 */
export function analyzePerformance(context: RequestContext): PerformanceMetrics {
  const totalDurationMs = performance.now() - context.startTime;
  
  // Component breakdown is already tracked in context
  const componentBreakdown = { ...context.componentTiming };
  
  // Operation breakdown by message
  const operationBreakdown: Record<string, number> = {};
  const operationTotals: Record<string, number> = {};
  
  // Process all breadcrumbs to extract operation metrics
  context.breadcrumbs.forEach((breadcrumb, index) => {
    if (breadcrumb.durationMs === undefined) {
      return;
    }
    
    // Use message as operation name
    const operation = breadcrumb.message;
    
    // Add to operation totals
    operationTotals[operation] = (operationTotals[operation] || 0) + breadcrumb.durationMs;
  });
  
  // Copy totals to breakdown
  Object.assign(operationBreakdown, operationTotals);
  
  // Find slowest operations
  const slowestOperations = Object.entries(operationTotals)
    .map(([name, durationMs]) => ({ name, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);
  
  return {
    totalDurationMs,
    componentBreakdown,
    operationBreakdown,
    slowestOperations,
    breadcrumbCount: context.breadcrumbs.length
  };
}

/**
 * Add performance metrics to request context
 */
export function addPerformanceMetrics(context: RequestContext): void {
  const metrics = analyzePerformance(context);
  
  // Add to diagnostics
  context.diagnostics.performanceMetrics = metrics;
  context.diagnostics.totalDurationMs = metrics.totalDurationMs;
  context.diagnostics.slowestOperations = metrics.slowestOperations;
}
```

### 4.2 Debug Dashboard Data Provider

```typescript
// src/utils/debugDashboardProvider.ts
import { RequestContext } from './requestContext';
import { analyzePerformance } from './performanceTracker';

/**
 * Generate debug dashboard data for UI
 */
export function generateDebugDashboardData(context: RequestContext): Record<string, any> {
  // Generate performance metrics
  const performanceMetrics = analyzePerformance(context);
  
  // Create timeline data for visualization
  const timeline = context.breadcrumbs.map((breadcrumb, index) => {
    return {
      index,
      timestamp: breadcrumb.timestamp,
      elapsedMs: breadcrumb.elapsedMs,
      category: breadcrumb.category,
      message: breadcrumb.message,
      durationMs: breadcrumb.durationMs,
      data: breadcrumb.data
    };
  });
  
  // Generate component timing chart data
  const componentTiming = Object.entries(context.componentTiming).map(([component, time]) => {
    return {
      component,
      timeMs: time,
      percentage: (time / performanceMetrics.totalDurationMs) * 100
    };
  }).sort((a, b) => b.timeMs - a.timeMs);
  
  // Return the complete dashboard data
  return {
    requestInfo: {
      requestId: context.requestId,
      url: context.url,
      startTime: new Date(context.startTime).toISOString(),
      totalDurationMs: performanceMetrics.totalDurationMs
    },
    performance: performanceMetrics,
    timeline,
    componentTiming,
    breadcrumbs: context.breadcrumbs,
    diagnostics: context.diagnostics
  };
}
```

## Phase 5: Testing & Validation

### 5.1 Create Unit Tests

```typescript
// test/utils/requestContext.spec.ts
import { describe, it, expect } from 'vitest';
import { createRequestContext, addBreadcrumb } from '../../src/utils/requestContext';

describe('RequestContext', () => {
  it('should create a request context with the correct structure', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    
    expect(context.requestId).toBeDefined();
    expect(context.url).toEqual('https://example.com/video.mp4');
    expect(context.startTime).toBeGreaterThan(0);
    expect(context.breadcrumbs).toEqual([]);
    expect(context.diagnostics).toBeDefined();
    expect(context.componentTiming).toEqual({});
  });
  
  it('should add breadcrumbs correctly', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    
    const breadcrumb1 = addBreadcrumb(context, 'TestComponent', 'First breadcrumb', { key: 'value' });
    
    expect(context.breadcrumbs.length).toEqual(1);
    expect(breadcrumb1.category).toEqual('TestComponent');
    expect(breadcrumb1.message).toEqual('First breadcrumb');
    expect(breadcrumb1.data).toEqual({ key: 'value' });
    expect(breadcrumb1.elapsedMs).toBeGreaterThan(0);
    expect(breadcrumb1.durationMs).toBeUndefined();
    
    // Add a second breadcrumb
    const breadcrumb2 = addBreadcrumb(context, 'TestComponent', 'Second breadcrumb');
    
    expect(context.breadcrumbs.length).toEqual(2);
    expect(breadcrumb2.durationMs).toBeGreaterThan(0);
    
    // Check component timing
    expect(context.componentTiming['TestComponent']).toBeGreaterThan(0);
  });
});
```

```typescript
// test/utils/responseBuilder.spec.ts
import { describe, it, expect } from 'vitest';
import { ResponseBuilder } from '../../src/utils/responseBuilder';
import { createRequestContext } from '../../src/utils/requestContext';

describe('ResponseBuilder', () => {
  it('should build a response with cache headers', async () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test');
    
    const builder = new ResponseBuilder(mockResponse, context);
    const response = builder
      .withCaching(200, { ttl: { ok: 3600 } })
      .build();
    
    expect(response.headers.get('Cache-Control')).toEqual('public, max-age=3600');
    expect(context.diagnostics.cacheTtl).toEqual(3600);
  });
  
  it('should build a response with debug headers when debug is enabled', async () => {
    const mockRequest = new Request('https://example.com/video.mp4?debug=true');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test');
    
    const builder = new ResponseBuilder(mockResponse, context);
    const response = builder.build();
    
    expect(response.headers.get('X-Video-Resizer-Debug')).toEqual('true');
    expect(response.headers.get('X-Processing-Time-Ms')).toBeDefined();
  });
  
  it('should add CDN error information headers', async () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test');
    
    const builder = new ResponseBuilder(mockResponse, context);
    const response = builder
      .withCdnErrorInfo(400, 'Bad Request', 'https://original.com/video.mp4')
      .build();
    
    expect(response.headers.get('X-CDN-Error-Status')).toEqual('400');
    expect(response.headers.get('X-CDN-Error-Response')).toEqual('Bad Request');
    expect(response.headers.get('X-Original-Source-URL')).toEqual('https://original.com/video.mp4');
    
    expect(context.diagnostics.cdnErrorStatus).toEqual(400);
    expect(context.diagnostics.cdnErrorResponse).toEqual('Bad Request');
    expect(context.diagnostics.originalSourceUrl).toEqual('https://original.com/video.mp4');
  });
});
```

### 5.2 Create Integration Tests

```typescript
// test/integration/loggingIntegration.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { handleRequest } from '../../src/handlers/videoHandler';
import { Env } from '../../src/types/env';

describe('Logging Integration', () => {
  // Mock console.log
  const originalConsoleLog = console.log;
  let logCalls: string[] = [];
  
  beforeEach(() => {
    logCalls = [];
    console.log = vi.fn((message) => {
      logCalls.push(typeof message === 'string' ? message : JSON.stringify(message));
    });
  });
  
  afterEach(() => {
    console.log = originalConsoleLog;
  });
  
  it('should log request events with breadcrumbs', async () => {
    const mockRequest = new Request('https://example.com/video.mp4?debug=true');
    const mockEnv: Env = {
      // Mock environment variables as needed
    };
    
    const response = await handleRequest(mockRequest, mockEnv);
    
    // Verify logs contain breadcrumbs
    expect(logCalls.length).toBeGreaterThan(0);
    
    // Check for breadcrumb-related logs
    const breadcrumbLogs = logCalls.filter(log => log.includes('breadcrumb'));
    expect(breadcrumbLogs.length).toBeGreaterThan(0);
    
    // Check response has debug headers
    expect(response.headers.get('X-Video-Resizer-Debug')).toEqual('true');
    expect(response.headers.get('X-Breadcrumbs-Count')).toBeDefined();
  });
  
  it('should handle errors with proper logging', async () => {
    // Create a request that will cause an error
    const mockRequest = new Request('https://example.com/error-trigger');
    const mockEnv: Env = {
      // Mock environment variables as needed
    };
    
    const response = await handleRequest(mockRequest, mockEnv);
    
    // Verify error logs
    const errorLogs = logCalls.filter(log => log.includes('error'));
    expect(errorLogs.length).toBeGreaterThan(0);
    
    // Check error response
    expect(response.status).toEqual(500);
  });
});
```

## Phase 6: Migration & Rollout Strategy

### 6.1 Gradual Migration Plan

1. **Phase 1: Infrastucture Setup (Week 1)**
   - Install dependencies: `npm install pino uuid @types/uuid`
   - Implement core utilities: RequestContext, PinoLogger, ResponseBuilder, HeaderSerializer
   - Set up unit tests for new components

2. **Phase 2: Integration (Week 2)**
   - Update videoHandler.ts to use the new context and logger
   - Update TransformVideoCommand to use the new system
   - Add performance tracking to key points in the request flow
   - Set up integration tests

3. **Phase 3: Service Migration (Week 3)**
   - Migrate individual services (video transformation, caching, etc.)
   - Update diagnostics collection throughout the codebase
   - Run comprehensive tests to verify functionality

4. **Phase 4: Legacy Adapter & Compatibility (Week 4)**
   - Implement the legacy logger adapter
   - Update import paths in existing files
   - Verify backwards compatibility
   - Refine performance metrics

5. **Phase 5: Debug UI Updates (Week 5)**
   - Update debug HTML UI to display breadcrumbs
   - Add performance visualizations to the debug dashboard
   - Implement timeline view for request flow

6. **Phase 6: Cleanup & Documentation (Week 6)**
   - Remove deprecated code
   - Finalize documentation and examples
   - Performance tuning and optimization

### 6.2 Rollout Checklist

- [ ] All unit tests pass
- [ ] Integration tests confirm functionality
- [ ] Performance benchmarks show acceptable overhead
- [ ] Legacy compatibility verified
- [ ] Debug UI correctly displays new metrics
- [ ] Documentation updated
- [ ] Team members briefed on new approach

## Future Enhancements

1. **Log Shipping to External Service**
   - Implement a log shipper to send logs to a centralized service
   - Add batching and retry logic for reliability
   
2. **Real-Time Performance Monitoring**
   - Add real-time metrics collection
   - Implement threshold alerts for performance issues
   
3. **Trace Correlation**
   - Add distributed tracing with W3C Trace Context support
   - Correlate requests across services
   
4. **Structured Error Reporting**
   - Enhanced error classification and categorization
   - Automatic grouping of similar errors
   
5. **Telemetry Visualization**
   - Create a dedicated dashboard for visualizing performance metrics
   - Add trend analysis for detecting performance regressions

## Conclusion

This implementation plan provides a structured approach to enhancing the logging infrastructure and response handling in the Video Resizer service. By introducing request context tracking, breadcrumbs, and centralized response building, we will gain better visibility into request flows, improve debugging capabilities, and ensure consistent response handling throughout the codebase.

The proposed system is designed with performance in mind, with the ability to collect detailed metrics while maintaining good runtime performance. The breadcrumb system will provide a detailed timeline of each request's journey through the system, making it easier to diagnose issues and understand performance bottlenecks.

By following this plan, we will create a more maintainable, observable, and reliable service that is easier to debug and optimize.