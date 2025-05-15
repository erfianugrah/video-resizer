/**
 * Response Builder
 * 
 * Centralizes response creation with header management
 */
import { RequestContext, getPerformanceMetrics, addBreadcrumb } from './requestContext';
import { DebugInfo } from './debugHeadersUtils';
import { DiagnosticsInfo } from '../types/diagnostics';

/**
 * A builder class for creating responses with consistent headers
 */
export class ResponseBuilder {
  private response: Response;
  private context: RequestContext;
  private headers: Headers;
  private debugInfo?: DebugInfo;
  private cachingApplied = false;
  private debugApplied = false;

  /**
   * Create a new ResponseBuilder
   * @param response The base response to build upon
   * @param context The request context or partial context for the response
   */
  constructor(
    response: Response, 
    context?: RequestContext | Partial<RequestContext> | null
  ) {
    this.response = response;
    
    // Create minimal context if none provided
    if (!context) {
      this.context = this.createMinimalContext();
    } else if (!this.isCompleteContext(context)) {
      // Merge with default context if partial
      this.context = {
        ...this.createMinimalContext(),
        ...context
      } as RequestContext;
    } else {
      this.context = context as RequestContext;
    }
    
    this.headers = new Headers(response.headers);
  }
  
  /**
   * Check if a context is complete and has all required fields
   * @param context The context to check
   * @returns Whether the context is complete
   */
  private isCompleteContext(context: Partial<RequestContext>): boolean {
    return !!(
      context.requestId &&
      context.url !== undefined &&
      context.startTime !== undefined &&
      context.breadcrumbs !== undefined &&
      context.componentTiming !== undefined &&
      context.diagnostics !== undefined
    );
  }
  
  /**
   * Create a minimal context with default values
   * @returns A minimal request context
   */
  private createMinimalContext(): RequestContext {
    return {
      requestId: `auto-${Date.now()}`,
      url: '',
      startTime: performance.now(),
      breadcrumbs: [],
      componentTiming: {},
      diagnostics: {
        errors: [],
        warnings: [],
        originalUrl: ''
      },
      debugEnabled: false,
      verboseEnabled: false
    };
  }

  /**
   * Apply caching headers based on configuration
   */
  withCaching(
    status: number,
    cacheConfig?: Record<string, unknown>,
    source?: string,
    derivative?: string
  ): ResponseBuilder {
    // Skip if already applied
    if (this.cachingApplied) {
      return this;
    }
    
    // Cache TTL values based on response status code
    let cacheTtl = 0;
    
    // Define type-safe cache configuration
    interface CacheTTLConfig {
      ok?: number;
      redirects?: number;
      clientError?: number;
      serverError?: number;
    }
    
    if (cacheConfig?.cacheability !== false) {
      // Check if ttl is a direct number or a complex config object
      if (typeof cacheConfig?.ttl === 'number') {
        // Direct TTL value provided (from Origins system)
        cacheTtl = cacheConfig.ttl;
      } else {
        // Safely cast ttl config to our interface, defaulting to empty object
        const ttlConfig = (cacheConfig?.ttl || {}) as CacheTTLConfig;
        
        // Determine TTL based on status code category
        if (status >= 200 && status < 300) {
          cacheTtl = ttlConfig.ok || 3600;
        } else if (status >= 300 && status < 400) {
          cacheTtl = ttlConfig.redirects || 60;
        } else if (status >= 400 && status < 500) {
          cacheTtl = ttlConfig.clientError || 10;
        } else {
          cacheTtl = ttlConfig.serverError || 0;
        }
      }
      
      // Add cache headers
      if (cacheTtl > 0) {
        this.headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
        
        // Set cache tags if available
        const cacheTags = cacheConfig?.cacheTags as string[] | undefined;
        if (cacheTags && Array.isArray(cacheTags) && cacheTags.length > 0) {
          this.headers.set('Cache-Tag', cacheTags.join(','));
        }
        
        // Add breadcrumb for caching
        addBreadcrumb(this.context, 'Response', 'Applied cache headers', {
          cacheControl: `public, max-age=${cacheTtl}`,
          cacheTtl,
          hasCacheTags: !!(cacheTags && Array.isArray(cacheTags) && cacheTags.length > 0),
          status,
          statusCategory: Math.floor(status / 100) * 100
        });
      } else {
        this.headers.set('Cache-Control', 'no-store, no-cache');
        
        // Add breadcrumb for no-cache
        addBreadcrumb(this.context, 'Response', 'Applied no-cache headers', {
          reason: 'Zero TTL',
          status,
          statusCategory: Math.floor(status / 100) * 100
        });
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
      
      // Add breadcrumb for disabled caching
      addBreadcrumb(this.context, 'Response', 'Caching disabled', {
        reason: 'cacheability=false in config',
        status
      });
    }
    
    this.cachingApplied = true;
    return this;
  }

  /**
   * Add debug headers based on context
   */
  withDebugInfo(debugInfo?: DebugInfo): ResponseBuilder {
    // Use provided debug info or fall back to context debug flags
    this.debugInfo = debugInfo;
    const isDebugEnabled = debugInfo?.isEnabled ?? this.context.debugEnabled;
    const isVerboseEnabled = debugInfo?.isVerbose ?? this.context.verboseEnabled;
    
    // Skip if already applied or debug not enabled
    if (this.debugApplied || !isDebugEnabled) {
      return this;
    }
    
    // Basic debug headers
    this.headers.set('X-Video-Resizer-Debug', 'true');
    this.headers.set('X-Video-Resizer-Version', '1.0.0');
    this.headers.set('X-Request-ID', this.context.requestId);
    
    // Add processing time
    const endTime = performance.now();
    const processingTimeMs = Math.round(endTime - this.context.startTime);
    this.headers.set('X-Processing-Time-Ms', processingTimeMs.toString());
    this.context.diagnostics.processingTimeMs = processingTimeMs;
    
    // Add breadcrumbs count
    this.headers.set('X-Breadcrumbs-Count', this.context.breadcrumbs.length.toString());
    
    // Add performance metrics if includePerformance is enabled
    if (debugInfo?.includePerformance || isVerboseEnabled) {
      const metrics = getPerformanceMetrics(this.context);
      this.headers.set('X-Total-Duration-Ms', metrics.totalElapsedMs.toString());
      
      // Add component timing as JSON
      this.headers.set('X-Component-Timing', JSON.stringify(metrics.componentTiming));
      
      // Add breadcrumbs count (from metrics)
      this.headers.set('X-Breadcrumbs-Count', metrics.breadcrumbCount.toString());
    }
    
    // Add standard diagnostics headers (using the existing pattern from debugHeadersUtils)
    this.addDiagnosticsHeaders(isVerboseEnabled);
    
    // If verbose is enabled, add breadcrumbs
    if (isVerboseEnabled) {
      this.addBreadcrumbHeaders();
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
   * Add Origin system information headers
   * @param originInfo Origin information for headers
   * @param sourceInfo Source resolution information
   */
  withOriginInfo(
    originInfo?: DiagnosticsInfo['origin'],
    sourceInfo?: DiagnosticsInfo['sourceResolution']
  ): ResponseBuilder {
    // Add origin information if available
    if (originInfo) {
      this.headers.set('X-Origin-Name', originInfo.name);
      this.headers.set('X-Origin-Matcher', originInfo.matcher);
      
      // Update diagnostics
      this.context.diagnostics.origin = originInfo;
      
      // Add captured parameters as JSON if available
      if (originInfo.capturedParams && Object.keys(originInfo.capturedParams).length > 0) {
        this.headers.set('X-Origin-Captured-Params', JSON.stringify(originInfo.capturedParams));
        
        // Log breadcrumb for origin matching
        addBreadcrumb(this.context, 'Origins', 'Added origin info to response', {
          originName: originInfo.name,
          capturedParams: originInfo.capturedParams,
          hasSourceInfo: !!sourceInfo
        });
      }
    }
    
    // Add source resolution information if available
    if (sourceInfo) {
      this.headers.set('X-Source-Type', sourceInfo.type);
      this.headers.set('X-Source-Path', sourceInfo.resolvedPath);
      
      if (sourceInfo.url) {
        this.headers.set('X-Source-URL', sourceInfo.url);
      }
      
      // Update diagnostics
      this.context.diagnostics.sourceResolution = sourceInfo;
      
      // Log breadcrumb for source resolution
      addBreadcrumb(this.context, 'Origins', 'Added source info to response', {
        sourceType: sourceInfo.type,
        resolvedPath: sourceInfo.resolvedPath,
        hasUrl: !!sourceInfo.url
      });
    }
    
    // Add X-Handler header to indicate we're using Origins system
    if (originInfo || sourceInfo) {
      this.headers.set('X-Handler', 'Origins');
    }
    
    return this;
  }

  /**
   * Helper method to create a new Response that uses TransformStream to avoid the 
   * "ReadableStream is disturbed" error.
   * 
   * @param originalBody The original response body that might be disturbed
   * @param status The status code for the new response
   * @param statusText The status text for the new response
   * @param headers The headers for the new response
   * @returns A new Response object that uses a TransformStream
   */
  private createSafeStreamResponse(
    originalBody: ReadableStream<Uint8Array> | null, 
    status: number, 
    statusText: string | undefined,
    headers: Headers
  ): Response {
    // Create a TransformStream to pipe the response through
    const { readable, writable } = new TransformStream();
    
    // Start pumping the body without awaiting - this runs asynchronously
    if (originalBody) {
      originalBody.pipeTo(writable).catch(err => {
        console.error('Error piping response body:', err instanceof Error ? err.message : String(err), {
          status,
          bodyType: originalBody ? typeof originalBody : 'null',
          errorType: err instanceof Error ? err.name : typeof err
        });
      });
    }
    
    // Return a new response with the readable stream
    return new Response(readable, {
      status,
      statusText,
      headers
    });
  }
  
  /**
   * Build the final response
   */
  async build(): Promise<Response> {
    // Apply debug headers if not already done
    if (!this.debugApplied && this.context.debugEnabled) {
      this.withDebugInfo();
    }
    
    // Determine content type - this is critical for proper handling
    const contentType = this.response.headers.get('Content-Type') || '';
    const isMediaContent = contentType.includes('video/') || contentType.includes('audio/');
    
    // Enhanced range request detection - check multiple indicators
    const isRangeRequest = this.isRangeRequest(this.response);
    
    // Special handling for incoming range requests in the original request
    const originalRequestHadRange = this.context.diagnostics.originalRequestHeaders?.Range !== undefined;
    const needsRangeSupport = isMediaContent || isRangeRequest || originalRequestHadRange;
    
    // ======= Preserve critical headers =======
    
    // Essential headers that should always be preserved
    const criticalHeaders = [
      'Content-Type',
      'Content-Length',
      'Content-Disposition',
      'Content-Encoding',
      'Connection',
      'Keep-Alive'
    ];
    
    // Copy all critical headers from the original response
    for (const header of criticalHeaders) {
      if (!this.headers.has(header) && this.response.headers.has(header)) {
        this.headers.set(header, this.response.headers.get(header) || '');
      }
    }
    
    // Special case for media content and range requests
    if (needsRangeSupport) {
      // Headers needed for proper video streaming
      const streamingHeaders = [
        'Accept-Ranges',
        'Content-Range',
        'Transfer-Encoding',
        'Last-Modified',
        'ETag',
        'Vary'
      ];
      
      // All range-related request headers that might need preservation
      const rangeHeaders = [
        'Range',
        'If-Range',
        'If-Modified-Since',
        'If-None-Match',
        'If-Match',
        'If-Unmodified-Since'
      ];
      
      // Combine all headers that need to be preserved
      const headersToPreserve = [...streamingHeaders, ...rangeHeaders];
      
      // Copy all necessary headers
      for (const header of headersToPreserve) {
        if (!this.headers.has(header) && this.response.headers.has(header)) {
          this.headers.set(header, this.response.headers.get(header) || '');
        }
      }
      
      // Ensure Accept-Ranges header is present for video/audio content
      // Most video players require this to enable seeking
      if (isMediaContent && !this.headers.has('Accept-Ranges')) {
        this.headers.set('Accept-Ranges', 'bytes');
      }
      
      // If we have a partial content response, ensure Content-Range is preserved exactly
      if (this.response.status === 206 && this.response.headers.has('Content-Range')) {
        const contentRange = this.response.headers.get('Content-Range');
        if (contentRange) {
          this.headers.set('Content-Range', contentRange);
        }
      }
      
      // Always store diagnostic information about headers
      // Store both original and final headers for debugging
      this.context.diagnostics.originalHeaders = Object.fromEntries(
        [...this.response.headers.entries()]
      );
      
      // Log header transformation info
      const requestContextModule = await import('./requestContext');
      requestContextModule.addBreadcrumb(
        this.context,
        'Response',
        'Processing headers for response',
        {
          isRangeRequest,
          isMediaContent,
          status: this.response.status,
          contentType,
          originalHeaders: this.context.diagnostics.originalHeaders,
          hasContentRange: this.response.headers.has('Content-Range'),
          hasAcceptRanges: this.response.headers.has('Accept-Ranges'),
          responseStatus: this.response.status,
          originalRequestHadRange
        }
      );
      
      // For streaming media content, ensure we always send the Accept-Ranges header
      if (isMediaContent) {
        if (!this.headers.has('Accept-Ranges')) {
          this.headers.set('Accept-Ranges', 'bytes');
          
          requestContextModule.addBreadcrumb(
            this.context,
            'Response',
            'Added Accept-Ranges header for media content',
            { contentType }
          );
        }
      }
      
      // Status 206 responses must have the Content-Range header
      if (this.response.status === 206) {
        const contentRange = this.response.headers.get('Content-Range');
        if (contentRange && !this.headers.has('Content-Range')) {
          this.headers.set('Content-Range', contentRange);
          
          requestContextModule.addBreadcrumb(
            this.context,
            'Response',
            'Preserved Content-Range header for 206 response',
            { contentRange }
          );
        }
      }
      
      // Store final headers after all modifications
      this.context.diagnostics.finalHeaders = Object.fromEntries(
        [...this.headers.entries()]
      );
      this.context.diagnostics.isRangeRequest = isRangeRequest;
      this.context.diagnostics.isMediaContent = isMediaContent;
      this.context.diagnostics.originalRequestHadRange = originalRequestHadRange;
      
      // Add a final breadcrumb with complete information
      requestContextModule.addBreadcrumb(
        this.context,
        'Response',
        'Building response with enhanced streaming support',
        {
          isRangeRequest,
          isMediaContent,
          status: this.response.status,
          contentType,
          finalHeaders: this.context.diagnostics.finalHeaders
        }
      );
    }
    
    // Special handling for 206 Partial Content responses
    if (this.response.status === 206) {
      const requestContextModuleFinal = await import('./requestContext');
      requestContextModuleFinal.addBreadcrumb(
        this.context,
        'Response',
        'Creating 206 Partial Content response',
        {
          contentRange: this.headers.get('Content-Range'),
          contentLength: this.headers.get('Content-Length'),
          contentType: this.headers.get('Content-Type')
        }
      );
      
      // Create a response with the identical body, status, and carefully preserved headers
      // Use our helper method to create a safe streamed response
      return this.createSafeStreamResponse(
        this.response.body,
        206, // Force Partial Content status
        this.response.statusText || 'Partial Content',
        this.headers
      );
    }
    
    // For range requests or video/audio content, handle specially
    if (isRangeRequest || isMediaContent) {
      const requestContextModuleFinal = await import('./requestContext');
      requestContextModuleFinal.addBreadcrumb(
        this.context,
        'Response',
        'Creating media content response',
        {
          status: this.response.status,
          contentType: this.headers.get('Content-Type'),
          isRangeRequest,
          hasAcceptRanges: this.headers.has('Accept-Ranges')
        }
      );
      
      // Create a response with the identical body and status, but our enhanced headers
      // Use our helper method to create a safe streamed response
      return this.createSafeStreamResponse(
        this.response.body,
        this.response.status,
        this.response.statusText,
        this.headers
      );
    }
    
    // Create the final response with all headers for non-media content
    // Use our helper method to create a safe streamed response
    return this.createSafeStreamResponse(
      this.response.body,
      this.response.status,
      this.response.statusText,
      this.headers
    );
  }
  
  /**
   * Helper method to determine if a response is a range request response
   * Checks multiple indicators to be thorough
   */
  private isRangeRequest(response: Response): boolean {
    // 206 Partial Content status is a definitive indicator
    if (response.status === 206) {
      return true;
    }
    
    // Content-Range header indicates this is a partial response
    if (response.headers.has('Content-Range')) {
      return true;
    }
    
    // Accept-Ranges with Content-Length indicates range capability
    if (response.headers.has('Accept-Ranges') && 
        response.headers.has('Content-Length')) {
      const acceptRanges = response.headers.get('Accept-Ranges');
      if (acceptRanges && acceptRanges !== 'none') {
        return true;
      }
    }
    
    // Check for ETag and Content-Length together, which often indicates range support
    if (response.headers.has('ETag') && 
        response.headers.has('Content-Length') && 
        response.headers.has('Last-Modified')) {
      return true;
    }
    
    // Not a range request
    return false;
  }

  /**
   * Helper method to add diagnostic information as headers
   */
  private addDiagnosticsHeaders(isVerbose: boolean): void {
    const { diagnostics } = this.context;
    
    // Add transformation source
    if (diagnostics.transformSource) {
      this.headers.set('X-Transform-Source', diagnostics.transformSource);
    }
    
    // Add device detection info
    if (diagnostics.deviceType) {
      this.headers.set('X-Device-Type', diagnostics.deviceType);
    }
    
    // Add network quality info
    if (diagnostics.networkQuality) {
      this.headers.set('X-Network-Quality', diagnostics.networkQuality);
    }
    
    // Add video details
    if (diagnostics.videoId) {
      this.headers.set('X-Video-ID', diagnostics.videoId);
    }
    
    if (diagnostics.pathMatch) {
      this.headers.set('X-Path-Match', diagnostics.pathMatch);
    }
    
    // Add cache info
    if (diagnostics.cacheability !== undefined) {
      this.headers.set('X-Cache-Enabled', diagnostics.cacheability.toString());
    }
    
    if (diagnostics.cacheTtl !== undefined) {
      this.headers.set('X-Cache-TTL', diagnostics.cacheTtl.toString());
    }
    
    // Add caching method info
    if (diagnostics.cachingMethod) {
      this.headers.set('X-Cache-Method', diagnostics.cachingMethod);
    }
    
    // Add Origin system information if available
    if (diagnostics.origin) {
      this.headers.set('X-Origin-Name', diagnostics.origin.name);
    }
    
    if (diagnostics.sourceResolution) {
      this.headers.set('X-Source-Type', diagnostics.sourceResolution.type);
    }
    
    // Add client capability detection results
    if (diagnostics.clientHints !== undefined) {
      this.headers.set('X-Client-Hints-Available', diagnostics.clientHints.toString());
    }
    
    // If verbose mode is enabled, add more detailed headers
    if (isVerbose) {
      // Include responsive sizing info if available
      if (diagnostics.responsiveSize && 
          typeof diagnostics.responsiveSize === 'object' &&
          'width' in diagnostics.responsiveSize &&
          'height' in diagnostics.responsiveSize &&
          'source' in diagnostics.responsiveSize) {
        const width = (diagnostics.responsiveSize as any).width;
        const height = (diagnostics.responsiveSize as any).height;
        const source = (diagnostics.responsiveSize as any).source;
        this.headers.set('X-Responsive-Width', String(width));
        this.headers.set('X-Responsive-Height', String(height));
        this.headers.set('X-Responsive-Method', String(source));
      }
      
      // Include transform parameters in a JSON-encoded header
      if (diagnostics.transformParams) {
        this.headers.set('X-Transform-Params', JSON.stringify(diagnostics.transformParams));
      }
      
      // Include browser capabilities
      if (diagnostics.browserCapabilities) {
        this.headers.set('X-Browser-Capabilities', JSON.stringify(diagnostics.browserCapabilities));
      }
      
      // Include content negotiation info
      if (diagnostics.videoFormat) {
        this.headers.set('X-Video-Format', diagnostics.videoFormat);
      }
      
      if (diagnostics.estimatedBitrate !== undefined && diagnostics.estimatedBitrate !== null) {
        this.headers.set('X-Estimated-Bitrate', diagnostics.estimatedBitrate.toString());
      }
      
      // Include Origin-related detailed information
      if (diagnostics.origin) {
        // Include detailed Origin information including matcher and capture groups
        if (diagnostics.origin.capturedParams) {
          this.headers.set('X-Origin-Captured-Params', JSON.stringify(diagnostics.origin.capturedParams));
        }
        
        // Include process path flag if available
        if (diagnostics.origin.processPath !== undefined) {
          this.headers.set('X-Origin-Process-Path', diagnostics.origin.processPath.toString());
        }
      }
      
      // Include detailed Source resolution information
      if (diagnostics.sourceResolution) {
        this.headers.set('X-Source-Path', diagnostics.sourceResolution.resolvedPath);
        
        if (diagnostics.sourceResolution.url) {
          this.headers.set('X-Source-URL', diagnostics.sourceResolution.url);
        }
        
        // Include detailed source configuration
        if (diagnostics.sourceResolution.source) {
          this.headers.set('X-Source-Config', JSON.stringify(diagnostics.sourceResolution.source));
        }
      }
      
      // Include execution timing information
      if (diagnostics.executionTiming) {
        this.headers.set('X-Execution-Timing', JSON.stringify(diagnostics.executionTiming));
      }
      
      // Include any errors or warnings
      if (diagnostics.errors && diagnostics.errors.length > 0) {
        this.headers.set('X-Debug-Errors', JSON.stringify(diagnostics.errors));
      }
      
      if (diagnostics.warnings && diagnostics.warnings.length > 0) {
        this.headers.set('X-Debug-Warnings', JSON.stringify(diagnostics.warnings));
      }
    }
  }

  /**
   * Helper method to add breadcrumb information as headers
   */
  private addBreadcrumbHeaders(): void {
    const { breadcrumbs } = this.context;
    
    // For large breadcrumb collections, we need to chunk the data
    const breadcrumbsJson = JSON.stringify(breadcrumbs);
    
    if (breadcrumbsJson.length <= 500) {
      // Small enough to include directly
      this.headers.set('X-Breadcrumbs', breadcrumbsJson);
    } else {
      // Split into chunks
      const chunks = Math.ceil(breadcrumbsJson.length / 500);
      for (let i = 0; i < chunks; i++) {
        const chunk = breadcrumbsJson.substring(i * 500, (i + 1) * 500);
        this.headers.set(`X-Breadcrumbs-${i + 1}`, chunk);
      }
      this.headers.set('X-Breadcrumbs-Chunks', chunks.toString());
    }
  }
  
  /**
   * Create an error response for Origin errors
   * @param error The Origin error
   * @param debugMode Whether to include debug information
   * @returns A ResponseBuilder with error information
   */
  static createOriginErrorResponse(error: any, debugMode: boolean = false): ResponseBuilder {
    // Default status code to 404 if not available
    const statusCode = error.getStatusCode?.() || 404;
    
    // Create a basic error object
    const errorInfo = {
      error: error.name || 'OriginError',
      message: error.message,
      errorType: error.errorType,
      statusCode
    };
    
    // Add any additional parameters from the error
    if (error.context && error.context.parameters) {
      Object.assign(errorInfo, { parameters: error.context.parameters });
    }
    
    // Create the error response body
    let responseBody = JSON.stringify({
      success: false,
      ...errorInfo
    }, null, 2);
    
    // Create a minimal context for the response builder
    const context: Partial<RequestContext> = {
      diagnostics: {
        errors: [error.message],
        originalUrl: error.context?.originalUrl || ''
      },
      debugEnabled: debugMode
    };
    
    // Build error response
    // No need for TransformStream here as the body is a simple string
    // and not a potentially disturbed ReadableStream
    const response = new Response(responseBody, {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Create response builder with error information
    const builder = new ResponseBuilder(response, context)
      .withHeaders({
        'X-Error-Type': error.errorType || 'UNKNOWN_ERROR',
        'X-Error-Name': error.name || 'OriginError'
      });
    
    // If we have origin information in the error, add it
    if (error.context?.originName) {
      builder.withOriginInfo(
        {
          name: error.context.originName,
          matcher: error.context.originMatcher || ''
        }
      );
    }
    
    return builder;
  }
}