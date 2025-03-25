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
import { createRequestContext } from './utils/requestContext';
import { createLogger, info, error } from './utils/pinoLogger';
import { initializeLegacyLogger } from './utils/legacyLoggerAdapter';

// Global environment config that will be populated at runtime
let runtimeConfig: EnvironmentConfig | null = null;

export default {
  async fetch(request: Request, env: EnvVariables, _ctx: ExecutionContext): Promise<Response> {
    // Create request context and logger at the entry point
    const context = createRequestContext(request);
    const logger = createLogger(context);
    
    // Initialize legacy logger for backward compatibility
    initializeLegacyLogger(request);
    
    try {
      // Initialize the runtime config if not already done
      if (!runtimeConfig) {
        runtimeConfig = getEnvironmentConfig(env);

        // Make LOGGING_CONFIG available globally
        // Since wrangler sends objects as strings, we need to convert it back to an object
        if (env.LOGGING_CONFIG) {
          try {
            // If it's already a string representation of a JSON object, we need to parse it
            const config = typeof env.LOGGING_CONFIG === 'string' 
              ? JSON.parse(env.LOGGING_CONFIG)
              : env.LOGGING_CONFIG;
            
            // Now set the parsed object
            (globalThis as any).LOGGING_CONFIG = config;
          } catch (err) {
            // Use error without context since this happens before context is initialized
            // This will be replaced with proper logging once initialization is complete
            const errMessage = err instanceof Error ? err.message : String(err);
            const errStack = err instanceof Error ? err.stack : undefined;
            console.error(`Error parsing LOGGING_CONFIG: ${errMessage}`, { stack: errStack });
            // Fall back to empty config
            (globalThis as any).LOGGING_CONFIG = {};
          }
        }

        // Initialize logging using our centralized manager
        initializeLogging(env);

        // Initialize the configuration system with environment variables
        initializeConfiguration(env);
        
        // Use Pino logger directly
        info(
          context, 
          logger,
          'Worker',
          `Initialized video-resizer v${
            env.VERSION || '1.0.0'
          } in ${runtimeConfig.mode} mode with ${runtimeConfig.cache.method} caching method`
        );
      }

      // Log incoming request with Pino
      const url = new URL(request.url);
      info(context, logger, 'Request', 'Incoming request', {
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
        return handleVideoRequest(request, runtimeConfig, env);
      }

      info(context, logger, 'Worker', 'Skipping video processing, passing through request');
      return fetch(request); // pass-through and continue
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      error(
        context, 
        logger,
        'Worker', 
        'Unexpected error in worker', 
        {
          error: errorMessage,
          stack: errorStack,
        }
      );

      return new Response('An unexpected error occurred', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
} satisfies ExportedHandler<EnvVariables>;
