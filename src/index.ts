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
import { initializeLogging } from './utils/loggingManager';
import { error, info, logRequest } from './utils/loggerUtils';

// Global environment config that will be populated at runtime
let runtimeConfig: EnvironmentConfig | null = null;

export default {
  async fetch(request: Request, env: EnvVariables, _ctx: ExecutionContext): Promise<Response> {
    try {
      // Initialize the runtime config if not already done
      if (!runtimeConfig) {
        runtimeConfig = getEnvironmentConfig(env);

        // Initialize logging using our centralized manager
        initializeLogging(env);

        info(
          'Worker',
          `Initialized video-resizer v${
            env.VERSION || '1.0.0'
          } in ${runtimeConfig.mode} mode`
        );
      }

      // Log incoming request at debug level
      logRequest('Request', request);

      // Define patterns to skip resizing
      const skipPatterns = [(headers: Headers) => /video-resizing/.test(headers.get('via') || '')];

      // Check if we should skip resizing
      const shouldSkip = skipPatterns.some((pattern) => pattern(request.headers));

      if (!shouldSkip && runtimeConfig) {
        return handleVideoRequest(request, runtimeConfig);
      }

      info('Worker', 'Skipping video processing, passing through request');
      return fetch(request); // pass-through and continue
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      error('Worker', 'Unexpected error in worker', {
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
