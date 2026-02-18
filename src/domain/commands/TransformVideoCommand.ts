/**
 * Command for transforming videos using CDN-CGI paths
 * Uses the Strategy pattern for handling different transformation types
 *
 * This class orchestrates the video transformation process, delegating
 * specific functionality to specialized services and utilities.
 *
 * Type definitions, source resolution, CDN-CGI execution, and error handling
 * are extracted into separate modules for better maintainability.
 */
import { VideoConfigurationManager } from '../../config';
import { findMatchingPathPattern } from '../../utils/pathUtils';
import { DiagnosticsInfo, extractRequestHeaders } from '../../utils/debugHeadersUtils';
import {
  addBreadcrumb,
  getClientDiagnostics,
  getCurrentContext,
  RequestContext,
} from '../../utils/requestContext';
import { createCategoryLogger, createLogger } from '../../utils/logger';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';

const tvcLogger = createCategoryLogger('TransformVideoCommand');
import { executeTransformation } from '../../services/TransformationService';
import { handleTransformationError } from '../../services/errorHandlerService';
import { generateDebugPage } from '../../services/debugService';
import { ResponseBuilder } from '../../utils/responseBuilder';
import type { Logger } from 'pino';

// Re-export types for backward compatibility — all external files that
// import types from 'TransformVideoCommand' will continue to work unchanged.
export type {
  VideoTransformOptions,
  R2Bucket,
  R2Object,
  WorkerEnvironment,
  VideoTransformContext,
} from './types';

// Import types for internal use
import type { VideoTransformContext } from './types';

// Import extracted modules
import { initializeOrigins } from './sourceResolution';
import { executeWithOrigins } from './originsExecution';

/**
 * Command class for transforming video URLs
 */
export class TransformVideoCommand {
  private context: VideoTransformContext;
  private requestContext: RequestContext;
  private logger: Logger;

  constructor(context: VideoTransformContext) {
    this.context = context;

    try {
      // Initialize context - use provided context, getCurrentContext, or create a minimal one for tests
      const currentContext = context.requestContext || getCurrentContext();

      if (currentContext) {
        // Use existing context if available
        this.requestContext = currentContext;
      } else {
        // Create a minimal context for testing purposes
        this.requestContext = {
          requestId: 'test-' + Date.now(),
          url: context.request.url,
          startTime: performance.now(),
          breadcrumbs: [],
          diagnostics: {
            errors: [],
            warnings: [],
            originalUrl: context.request.url,
          },
          componentTiming: {},
          debugEnabled: !!context.debugInfo?.isEnabled,
          verboseEnabled: false,
        };
      }

      // Set up logger
      this.logger = context.logger || createLogger(this.requestContext);

      // Log initialization with breadcrumb
      addBreadcrumb(this.requestContext, 'CommandInit', 'TransformVideoCommand Initialized', {
        requestId: this.requestContext.requestId,
        url: this.requestContext.url?.substring(0, 100), // Limit URL length
        hasOptions: !!this.context.options,
        hasPathPatterns:
          Array.isArray(this.context.pathPatterns) && this.context.pathPatterns.length > 0,
        debugEnabled: !!this.context.debugInfo?.isEnabled,
      });

      // Log additional diagnostics if in verbose mode
      if (this.requestContext.verboseEnabled) {
        tvcLogger.debug('Command initialized with context', {
          requestId: this.requestContext.requestId,
          breadcrumbCount: this.requestContext.breadcrumbs.length,
          options: {
            ...this.context.options,
            source: this.context.options?.source ? '[source url omitted]' : undefined,
          },
        });
      }
    } catch (err) {
      // Fallback logging if context/logger init fails
      console.error({
        context: 'TransformVideoCommand',
        operation: 'constructor',
        message: 'CRITICAL: Failed to initialize RequestContext/Logger',
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
      logErrorWithContext(
        'Error initializing TransformVideoCommand context/logger',
        err,
        {},
        'TransformVideoCommand.constructor'
      );

      // Create a minimal fallback request context
      const minimalContext: RequestContext = {
        requestId: 'fallback-' + Date.now(),
        url: context.request.url,
        startTime: performance.now(),
        breadcrumbs: [],
        diagnostics: {
          errors: [],
          warnings: [],
          originalUrl: context.request.url,
        },
        componentTiming: {},
        debugEnabled: !!context.debugInfo?.isEnabled,
        verboseEnabled: false,
      };

      this.requestContext = minimalContext;
      this.logger = context.logger || createLogger(minimalContext);
    }
  }

  /**
   * Execute the video transformation using the appropriate method based on context
   *
   * This method is the main entry point for the command,
   * orchestrating the transformation process by delegating to
   * specialized services and utilities.
   *
   * @returns A response with the transformed video
   */
  async execute(): Promise<Response> {
    // Extract context information
    const { request, options, pathPatterns, env } = this.context;
    const url = new URL(request.url);
    const path = url.pathname;

    // Initialize diagnostics - use existing diagnostics from request context if available
    const diagnosticsInfo: DiagnosticsInfo = this.requestContext.diagnostics || {
      errors: [],
      warnings: [],
      originalUrl: request.url,
    };

    // Ensure diagnostics arrays exist
    if (!diagnosticsInfo.errors) diagnosticsInfo.errors = [];
    if (!diagnosticsInfo.warnings) diagnosticsInfo.warnings = [];

    // Log execution start
    tvcLogger.debug('Starting execution', {
      path,
    });
    addBreadcrumb(this.requestContext, 'Execution', 'Command execution started');

    try {
      // Collect request headers for diagnostics if debug is enabled
      if (this.context.debugInfo?.isEnabled || this.context.debugMode) {
        diagnosticsInfo.requestHeaders = extractRequestHeaders(request);
      }

      // Try to initialize Origins context if not already provided
      const shouldUseOrigins = VideoConfigurationManager.getInstance().shouldUseOrigins();

      // If Origins should be used and context not already initialized, attempt to initialize it
      if (shouldUseOrigins && (!this.context.origin || !this.context.sourceResolution)) {
        await initializeOrigins(path, this.context, this.requestContext, this.logger);
      }

      // Check if we now have a valid Origins context
      if (this.context.origin && this.context.sourceResolution) {
        return await executeWithOrigins({
          context: this.context,
          requestContext: this.requestContext,
        });
      }

      // If we reach here, we're falling back to legacy path patterns
      addBreadcrumb(this.requestContext, 'Routing', 'Falling back to legacy path patterns', {
        path,
        shouldUseOrigins,
      });

      // If Origin initialization failed but was enabled, add a warning to diagnostics
      if (shouldUseOrigins) {
        diagnosticsInfo.warnings.push(
          'Origins enabled but initialization failed, falling back to legacy path patterns'
        );
      }

      // Legacy transformation with path patterns
      // Find matching path pattern
      addBreadcrumb(this.requestContext, 'Routing', 'Finding path pattern', {
        path,
      });
      const pathPattern = findMatchingPathPattern(path, pathPatterns || []);

      // Calculate fallback URL for potential error recovery
      let fallbackOriginUrl: string | null = null;
      if (pathPattern) {
        diagnosticsInfo.pathMatch = pathPattern.name;
        const originBaseUrl = pathPattern.originUrl || pathPattern.baseUrl;
        if (originBaseUrl) {
          fallbackOriginUrl = new URL(url.pathname, originBaseUrl).toString();
          tvcLogger.debug('Calculated fallback URL', { fallbackOriginUrl });
        }
      } else {
        diagnosticsInfo.warnings.push('No matching path pattern found');
        addBreadcrumb(this.requestContext, 'Routing', 'No matching pattern found');
      }

      // Handle pass-through case (no pattern or pattern shouldn't be processed)
      if (!pathPattern || !pathPattern.processPath) {
        tvcLogger.debug('Path configured for pass-through', {
          pattern: pathPattern?.name,
        });
        addBreadcrumb(this.requestContext, 'Routing', 'Pass-through request', {
          pattern: pathPattern?.name,
        });

        // Handle diagnostics
        if (pathPattern) {
          diagnosticsInfo.warnings.push(
            `Path pattern ${pathPattern.name} is configured to not process`
          );
        }

        // Pass-through to original request
        const passThroughResponse = await fetch(request);

        // Use ResponseBuilder for consistent response handling
        const responseBuilder = new ResponseBuilder(passThroughResponse, this.requestContext);
        responseBuilder.withDebugInfo(this.context.debugInfo);
        return await responseBuilder.build();
      }

      // Gather client capabilities and add to diagnostics
      addBreadcrumb(this.requestContext, 'Context', 'Gathering client capabilities');
      const clientInfo = getClientDiagnostics(request);
      diagnosticsInfo.browserCapabilities = clientInfo.browserCapabilities;
      diagnosticsInfo.clientHints = clientInfo.hasClientHints;
      diagnosticsInfo.deviceType = clientInfo.deviceType;
      diagnosticsInfo.networkQuality = clientInfo.networkQuality;

      // Execute the core transformation
      const transformResult = await executeTransformation({
        request,
        options,
        pathPatterns: pathPatterns || [],
        env: env || {}, // Ensure env is not undefined
        requestContext: this.requestContext,
        diagnosticsInfo,
        debugInfo: this.context.debugInfo,
      });

      // Check if the response from executeTransformation was OK
      if (!transformResult.response.ok) {
        // Handle error with the extracted error handler
        return await handleTransformationError({
          errorResponse: transformResult.response,
          originalRequest: request,
          context: this.context,
          requestContext: this.requestContext,
          diagnosticsInfo,
          fallbackOriginUrl,
          cdnCgiUrl: transformResult.cdnCgiUrl,
          source: transformResult.source,
        });
      }

      // --- Success Path ---
      addBreadcrumb(
        this.requestContext,
        'Response',
        'Transformation successful, building final response'
      );

      // Build final response with ResponseBuilder
      const responseBuilder = new ResponseBuilder(transformResult.response, this.requestContext);

      // Convert the cacheConfig to a Record<string, unknown> if not null
      const cacheConfig = transformResult.cacheConfig
        ? ({ ...transformResult.cacheConfig } as Record<string, unknown>)
        : undefined;

      responseBuilder.withCaching(
        transformResult.response.status,
        cacheConfig,
        transformResult.source,
        transformResult.derivative
      );
      responseBuilder.withDebugInfo(this.context.debugInfo);

      // Check for debug view mode
      const debugView =
        url.searchParams.get('debug') === 'view' || url.searchParams.get('debug') === 'true';
      if (debugView && (this.context.debugInfo?.isEnabled || this.requestContext.debugEnabled)) {
        addBreadcrumb(this.requestContext, 'Debug', 'Preparing debug view');

        return await generateDebugPage({
          diagnosticsInfo,
          isError: false,
          request: this.context.request,
          env: this.context.env,
          requestContext: this.requestContext,
        });
      }

      // Return built response
      return await responseBuilder.build();
    } catch (err: unknown) {
      // Error handling
      const errorMessage = err instanceof Error ? err.message : 'Unknown execution error';

      logErrorWithContext(
        'Unhandled error during TransformVideoCommand execution',
        err,
        { requestId: this.requestContext.requestId },
        'TransformVideoCommand.execute'
      );
      addBreadcrumb(this.requestContext, 'Error', 'Unhandled Command Execution Error', {
        error: errorMessage,
      });

      // Add error to diagnostics
      diagnosticsInfo.errors.push(`Unhandled Execution Error: ${errorMessage}`);

      // Check for debug view mode
      const debugView =
        url.searchParams.get('debug') === 'view' || url.searchParams.get('debug') === 'true';
      if (debugView && (this.context.debugInfo?.isEnabled || this.requestContext.debugEnabled)) {
        addBreadcrumb(this.requestContext, 'Debug', 'Preparing error debug view');

        return await generateDebugPage({
          diagnosticsInfo,
          isError: true,
          request: this.context.request,
          env: this.context.env,
          requestContext: this.requestContext,
        });
      }

      // Build error response
      const errorResponse = new Response(`Error transforming video: ${errorMessage}`, {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store',
        },
      });

      const responseBuilder = new ResponseBuilder(errorResponse, this.requestContext);
      responseBuilder.withDebugInfo(this.context.debugInfo);
      responseBuilder.withCdnErrorInfo(500, errorMessage, request.url);

      return await responseBuilder.build();
    }
  }
}
