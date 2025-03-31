/**
 * Video Resizer Worker
 *
 * This worker transforms video requests by modifying URLs to use Cloudflare video parameters
 * via the cdn-cgi path for resizing videos on the fly.
 *
 * - Run `npm run dev` to start a development server
 * - Run `npm run deploy` to publish your worker
 */

import { handleVideoRequest } from './handlers/videoHandler';
import { getEnvironmentConfig, EnvironmentConfig, EnvVariables } from './config/environmentConfig';
import { initializeConfiguration } from './config';
import { initializeLogging } from './utils/loggingManager';
import { createRequestContext, updateBreadcrumbConfig } from './utils/requestContext';
import { createLogger, info, error, debug } from './utils/pinoLogger';
import { initializeLegacyLogger } from './utils/legacyLoggerAdapter';
import { LoggingConfigurationManager } from './config/LoggingConfigurationManager';

/**
 * Helper functions for consistent logging in the index module
 */

/**
 * Log an info message with proper context handling
 */
function logInfo(context: any, message: string, data?: Record<string, unknown>): void {
  try {
    const logger = createLogger(context);
    info(context, logger, 'Worker', message, data);
  } catch (err) {
    // Fallback to console if the logger isn't ready yet
    console.info(`Worker: ${message}`, data || {});
  }
}

/**
 * Log an error message with proper context handling
 */
function logError(context: any, message: string, data?: Record<string, unknown>): void {
  try {
    const logger = createLogger(context);
    error(context, logger, 'Worker', message, data);
  } catch (err) {
    // Fallback to console if the logger isn't ready yet
    console.error(`Worker: ${message}`, data || {});
  }
}

/**
 * Log a debug message with proper context handling
 */
function logDebug(context: any, message: string, data?: Record<string, unknown>): void {
  try {
    const logger = createLogger(context);
    debug(context, logger, 'Worker', message, data);
  } catch (err) {
    // Fallback to console if the logger isn't ready yet
    console.debug(`Worker: ${message}`, data || {});
  }
}

// Global environment config that will be populated at runtime
let runtimeConfig: EnvironmentConfig | null = null;
let hasInitialized = false;

export default {
  async fetch(request: Request, env: EnvVariables, _ctx: ExecutionContext): Promise<Response> {
    // Create request context and logger at the entry point
    const context = createRequestContext(request);
    const logger = createLogger(context);
    
    // Initialize legacy logger for backward compatibility
    initializeLegacyLogger(request);
    
    try {
      // Initialize the runtime config if not already done
      if (!runtimeConfig || !hasInitialized) {
        runtimeConfig = getEnvironmentConfig(env);
        
        // Initialize the configuration managers instead of setting globals directly
        try {
          // Initialize the configuration system with environment variables
          // This will properly configure all managers (Debug, Logging, etc.)
          // Only call this once
          initializeConfiguration(env);
          
          // Get the logging configuration and explicitly update breadcrumb config
          const loggingConfig = LoggingConfigurationManager.getInstance();
          const breadcrumbConfig = loggingConfig.getBreadcrumbConfig();
          updateBreadcrumbConfig(breadcrumbConfig);
          
          // Log initialization
          logInfo(context, 'Initialized configuration from environment', { 
            breadcrumbsEnabled: breadcrumbConfig.enabled, 
            maxItems: breadcrumbConfig.maxItems 
          });
        } catch (err) {
          // Log initialization error
          const errMessage = err instanceof Error ? err.message : String(err);
          const errStack = err instanceof Error ? err.stack : undefined;
          logError(context, 'Error initializing configuration', { 
            error: errMessage, 
            stack: errStack 
          });
        }

        // Initialize logging using our centralized manager
        initializeLogging(env);
        
        // Set flag to prevent repeated initialization
        hasInitialized = true;
        
        // Log successful initialization with version and config info
        logInfo(
          context,
          `Initialized video-resizer v${
            env.VERSION || '1.0.0'
          } in ${runtimeConfig.mode} mode with ${runtimeConfig.cache.method} caching method`,
          {
            loggingLevel: LoggingConfigurationManager.getInstance().getLogLevel(),
            breadcrumbsEnabled: LoggingConfigurationManager.getInstance().areBreadcrumbsEnabled(),
            maxBreadcrumbs: LoggingConfigurationManager.getInstance().getMaxBreadcrumbs()
          }
        );
      }

      // Log incoming request
      const url = new URL(request.url);
      logInfo(context, 'Incoming request', {
        method: request.method,
        url: url.toString(),
        pathname: url.pathname,
        search: url.search
      });
      
      // Define patterns to skip resizing
      const skipPatterns = [(headers: Headers) => /video-resizing/.test(headers.get('via') || '')];

      // Check if we should skip resizing
      const shouldSkip = skipPatterns.some((pattern) => pattern(request.headers));

      if (!shouldSkip && runtimeConfig) {
        return handleVideoRequest(request, runtimeConfig, env, _ctx);
      }

      logInfo(context, 'Skipping video processing, passing through request');
      return fetch(request); // pass-through and continue
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      // Add breadcrumb for worker-level error
      if (context) {
        const { addBreadcrumb } = await import('./utils/requestContext');
        addBreadcrumb(context, 'Error', 'Unexpected worker error', {
          error: errorMessage,
          url: request.url
        });
      }
      
      logError(context, 'Unexpected error in worker', {
        error: errorMessage,
        stack: errorStack,
      });

      return new Response('An unexpected error occurred', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
} satisfies ExportedHandler<EnvVariables>;
