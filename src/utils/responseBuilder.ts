/**
 * Response Builder
 * 
 * Centralizes response creation with header management
 */
import { RequestContext, getPerformanceMetrics } from './requestContext';
import { DebugInfo } from './debugHeadersUtils';

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
      
      // Add cache headers
      if (cacheTtl > 0) {
        this.headers.set('Cache-Control', `public, max-age=${cacheTtl}`);
        
        // Set cache tags if available
        const cacheTags = cacheConfig?.cacheTags as string[] | undefined;
        if (cacheTags && Array.isArray(cacheTags) && cacheTags.length > 0) {
          this.headers.set('Cache-Tag', cacheTags.join(','));
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
        'ResponseBuilder',
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
            'ResponseBuilder',
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
            'ResponseBuilder',
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
        'ResponseBuilder',
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
        'ResponseBuilder',
        'Creating 206 Partial Content response',
        {
          contentRange: this.headers.get('Content-Range'),
          contentLength: this.headers.get('Content-Length'),
          contentType: this.headers.get('Content-Type')
        }
      );
      
      // Create a response with the identical body, status, and carefully preserved headers
      return new Response(this.response.body, {
        status: 206,  // Force Partial Content status
        statusText: this.response.statusText || 'Partial Content',
        headers: this.headers
      });
    }
    
    // For range requests or video/audio content, handle specially
    if (isRangeRequest || isMediaContent) {
      const requestContextModuleFinal = await import('./requestContext');
      requestContextModuleFinal.addBreadcrumb(
        this.context,
        'ResponseBuilder',
        'Creating media content response',
        {
          status: this.response.status,
          contentType: this.headers.get('Content-Type'),
          isRangeRequest,
          hasAcceptRanges: this.headers.has('Accept-Ranges')
        }
      );
      
      // Create a response with the identical body and status, but our enhanced headers
      return new Response(this.response.body, {
        status: this.response.status,
        statusText: this.response.statusText,
        headers: this.headers
      });
    }
    
    // Create the final response with all headers for non-media content
    return new Response(this.response.body, {
      status: this.response.status,
      statusText: this.response.statusText,
      headers: this.headers
    });
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
}