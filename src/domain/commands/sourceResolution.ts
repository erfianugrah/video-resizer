/**
 * Source resolution helpers for Origins-based video transformation
 *
 * Handles initialization of Origins context and finding fallback sources.
 * Extracted from TransformVideoCommand.ts for better modularity.
 */
import { VideoConfigurationManager } from '../../config';
import { addBreadcrumb, RequestContext } from '../../utils/requestContext';
import { createCategoryLogger } from '../../utils/logger';
import { Origin, Source } from '../../services/videoStorage/interfaces';
import { OriginResolver, SourceResolutionResult } from '../../services/origins/OriginResolver';
import { VideoTransformContext } from './types';
import type { Logger } from 'pino';

const srcLogger = createCategoryLogger('SourceResolution');

/**
 * Initialize context for Origins-based transformation if not already provided.
 * Uses the OriginResolver directly to set up the transform context.
 *
 * @param path The URL path to resolve
 * @param context The video transform context (will be mutated with origin/sourceResolution)
 * @param requestContext The request context for breadcrumbs/diagnostics
 * @param logger Logger instance
 * @returns Whether the Origins initialization was successful
 */
export async function initializeOrigins(
  path: string,
  context: VideoTransformContext,
  requestContext: RequestContext,
  logger: Logger
): Promise<boolean> {
  // Skip if Origins context is already initialized
  if (context.origin && context.sourceResolution) {
    srcLogger.debug('Origins context already initialized');
    return true;
  }

  try {
    // Get configuration to determine if Origins should be used
    const configManager = VideoConfigurationManager.getInstance();

    if (!configManager.shouldUseOrigins()) {
      // Origins not enabled in configuration
      srcLogger.debug('Origins not enabled in configuration');
      return false;
    }

    // Create OriginResolver
    const resolver = new OriginResolver(configManager.getConfig());

    // Find matching origin with captures
    addBreadcrumb(requestContext, 'Origins', 'Resolving origin for path', { path });

    const originMatch = resolver.matchOriginWithCaptures(path);
    if (!originMatch) {
      srcLogger.debug('No matching origin found for path', { path });
      return false;
    }

    // Resolve path to source
    addBreadcrumb(requestContext, 'Origins', 'Resolving path to source', {
      origin: originMatch.origin.name,
    });

    const sourceResult = resolver.resolvePathToSource(path);
    if (!sourceResult) {
      srcLogger.debug('Failed to resolve path to source', {
        origin: originMatch.origin.name,
        path,
      });
      return false;
    }

    // Set up Origins context
    context.origin = originMatch.origin;
    context.sourceResolution = sourceResult;

    srcLogger.debug('Origins context initialized', {
      origin: originMatch.origin.name,
      sourceType: sourceResult.originType,
      resolvedPath: sourceResult.resolvedPath,
    });

    addBreadcrumb(requestContext, 'Origins', 'Origins context initialized', {
      origin: originMatch.origin.name,
      sourceType: sourceResult.originType,
    });

    return true;
  } catch (err) {
    // Log error but don't fail the request - we'll fall back to legacy path patterns
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    srcLogger.debug('Error initializing Origins context', {
      error: errorMessage,
      path,
    });

    addBreadcrumb(requestContext, 'Origins', 'Error initializing Origins context', {
      error: errorMessage,
    });

    // Add warning to diagnostics
    if (requestContext.diagnostics?.warnings) {
      requestContext.diagnostics.warnings.push(`Origins initialization error: ${errorMessage}`);
    }

    return false;
  }
}

/**
 * Find the next source to try based on priority order
 * @param origin The origin containing sources
 * @param currentPriority The priority of the current source that failed
 * @returns The next source to try, or null if there are no more sources
 */
export function findNextSourceByPriority(origin: Origin, currentPriority: number): Source | null {
  // Get all sources with higher priority number (lower priority = higher precedence)
  const higherPrioritySources = origin.sources
    .filter((source) => source.priority > currentPriority)
    .sort((a, b) => a.priority - b.priority);

  // Return the source with the next highest priority, or null if there are none
  return higherPrioritySources.length > 0 ? higherPrioritySources[0] : null;
}

/**
 * Gets a valid URL from the current source or the next source by priority that can be used for fallback
 * @param origin The origin containing sources
 * @param currentPriority The priority of the current source that failed
 * @returns A valid fallback URL or null if no valid URL is available
 */
export function getNextSourceUrl(origin: Origin, currentPriority: number): string | null {
  // First check if the current source has a valid URL (for non-R2 sources)
  const currentSource = origin.sources.find((source) => source.priority === currentPriority);

  // If current source is not R2 and has a URL, use it for direct fetch from same origin
  if (currentSource && currentSource.type !== 'r2' && currentSource.url) {
    return currentSource.url;
  }

  // If current source doesn't have a valid URL or is R2, find the next source
  // Find all sources with higher priority number (lower priority = higher precedence)
  const higherPrioritySources = origin.sources
    .filter((source) => source.priority > currentPriority)
    .sort((a, b) => a.priority - b.priority);

  // Look for the first source with a valid URL
  for (const source of higherPrioritySources) {
    // Only remote and fallback sources have valid URLs
    if ((source.type === 'remote' || source.type === 'fallback') && source.url) {
      return source.url;
    }
  }

  return null;
}
