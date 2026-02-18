/**
 * Utilities for applying cache headers to responses
 */
import { CacheConfig } from './cacheUtils';
import { getCurrentContext, addBreadcrumb } from './requestContext';
import { determineCacheControl } from './cacheControlUtils';
import { generateCacheTags } from '../services/videoStorageService';
import { withErrorHandling } from './errorHandlingUtils';
import { createCategoryLogger } from './logger';

// Create a category-specific logger for CacheHeaderUtils
const logger = createCategoryLogger('CacheHeaderUtils');
const { debug: logDebug } = logger;

/**
 * Apply cache headers to a response based on configuration and use Cache API if available
 *
 * @param response - The response to modify
 * @param status - HTTP status code
 * @param cacheConfig - Cache configuration
 * @param source - Content source for tagging
 * @param derivative - Optional derivative name for tagging
 * @returns Modified response with cache headers
 */
export const applyCacheHeaders = withErrorHandling<
  [Response, number, CacheConfig | null | undefined, string | undefined, string | undefined],
  Promise<Response>
>(
  async function applyCacheHeadersImpl(
    response: Response,
    status: number,
    cacheConfig?: CacheConfig | null,
    source?: string,
    derivative?: string
  ): Promise<Response> {
    // Create new headers object
    const newHeaders = new Headers(response.headers);

    // Create response init with headers object
    const responseInit: ResponseInit = {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    };

    // Get request context for breadcrumbs
    const requestContext = getCurrentContext();

    // If no cache config, use default no-cache behavior
    if (!cacheConfig) {
      newHeaders.set('Cache-Control', 'no-store');

      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Using no-cache behavior', {
          status,
          reason: 'No cache configuration',
          cacheControl: 'no-store',
        });
      }

      return new Response(response.body, responseInit);
    }

    // Get the appropriate cache control header
    const cacheControl = determineCacheControl(status, cacheConfig);

    logDebug('Applying cache headers', {
      status,
      cacheControl,
      cacheability: cacheConfig.cacheability,
      source,
      derivative,
    });

    // Apply cache headers
    if (cacheConfig.cacheability && cacheControl) {
      newHeaders.set('Cache-Control', cacheControl);

      // Add breadcrumb for applied cache control
      if (requestContext) {
        // Extract the caching duration from a "max-age=X" directive
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        const maxAgeTtl = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : undefined;

        addBreadcrumb(requestContext, 'Cache', 'Applied cacheable headers', {
          status,
          cacheControl,
          maxAgeTtl,
          statusCategory: Math.floor(status / 100) * 100,
          isCacheable: true,
        });
      }
    } else {
      newHeaders.set('Cache-Control', 'no-store');

      // Add breadcrumb for non-cacheable response
      if (requestContext) {
        addBreadcrumb(requestContext, 'Cache', 'Applied non-cacheable headers', {
          status,
          cacheControl: 'no-store',
          reason: cacheConfig.cacheability ? 'No valid cacheControl' : 'Cacheability disabled',
          statusCategory: Math.floor(status / 100) * 100,
          isCacheable: false,
        });
      }
    }

    // Generate cache tags if source is provided - important for purging
    if (source) {
      const options = { derivative };
      const tags = generateCacheTags(source, options, newHeaders);

      if (tags.length > 0) {
        newHeaders.set('Cache-Tag', tags.join(','));

        // Add breadcrumb for cache tags
        if (requestContext) {
          // Store cache tags in the request context for diagnostics
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }

          // Add cache tags to diagnostics info
          requestContext.diagnostics.cacheTags = tags;

          addBreadcrumb(requestContext, 'Cache', 'Generated cache tags', {
            tagCount: tags.length,
            source,
            derivative: derivative || undefined,
            firstTags: tags.slice(0, 3).join(','), // Include just the first few tags
            hasCustomTags: true,
          });
        }
      } else {
        // For backward compatibility with tests
        const fallbackTag = `video-resizer,source:${source}${derivative ? `,derivative:${derivative}` : ''}`;
        newHeaders.set('Cache-Tag', fallbackTag);

        // Add fallback tag to diagnostics
        if (requestContext) {
          // Store fallback cache tag in the request context for diagnostics
          if (!requestContext.diagnostics) {
            requestContext.diagnostics = {};
          }

          // Add fallback cache tag as an array to diagnostics
          requestContext.diagnostics.cacheTags = [fallbackTag];

          addBreadcrumb(requestContext, 'Cache', 'Using fallback cache tags', {
            source,
            derivative: derivative || undefined,
            tag: fallbackTag,
            reason: 'No tags generated by service',
          });
        }
      }
    }

    return new Response(response.body, responseInit);
  },
  {
    functionName: 'applyCacheHeaders',
    component: 'CacheHeaderUtils',
    logErrors: true,
  }
);
