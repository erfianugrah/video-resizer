/**
 * Origin resolution logic for video transformation
 *
 * Extracted from TransformationService.ts to reduce file size.
 * Tries Origins first (if enabled), then falls back to path patterns.
 */
import { DiagnosticsInfo } from '../../utils/debugHeadersUtils';
import { PathPattern, findMatchingPathPattern } from '../../utils/pathUtils';
import { RequestContext, addBreadcrumb } from '../../utils/requestContext';
import {
  OriginResolver,
  OriginMatchResult,
  SourceResolutionResult,
} from '../origins/OriginResolver';
import { VideoConfigurationManager } from '../../config';
import { createCategoryLogger } from '../../utils/logger';

// Create a category-specific logger
const logger = createCategoryLogger('TransformationService');
const { debug: logDebug } = logger;

/**
 * Result of origin/path-pattern resolution
 */
export interface OriginResolutionResult {
  /** The matched path pattern (null if Origins were used) */
  pathPattern: PathPattern | null;
  /** The matched origin result (null if path patterns were used) */
  originMatch: OriginMatchResult | null;
  /** The source resolution result (null if path patterns were used) */
  sourceResolution: SourceResolutionResult | null;
  /** Whether Origins-based resolution was used */
  useOrigins: boolean;
}

/**
 * Resolve the origin or path pattern for a given path.
 *
 * Tries Origins first if enabled in the configuration, then falls back to path patterns.
 * Throws if neither Origins nor path patterns produce a match.
 *
 * @param path The URL pathname
 * @param url The full URL object
 * @param pathPatterns Array of path patterns to try as fallback
 * @param configManager The video configuration manager instance
 * @param requestContext Current request context (may be null)
 * @param diagnosticsInfo Diagnostics (mutated: origin, sourceResolution, warnings may be set)
 * @returns Resolution result with origin match, source resolution, and/or path pattern
 */
export function resolveOriginOrPathPattern(
  path: string,
  url: URL,
  pathPatterns: PathPattern[],
  configManager: VideoConfigurationManager,
  requestContext: RequestContext | null,
  diagnosticsInfo: DiagnosticsInfo
): OriginResolutionResult {
  let pathPattern: PathPattern | null = null;
  let originMatch: OriginMatchResult | null = null;
  let sourceResolution: SourceResolutionResult | null = null;

  const shouldUseOrigins = configManager.shouldUseOrigins();

  // Try Origins first if enabled, fall back to path patterns
  if (shouldUseOrigins) {
    try {
      // Create OriginResolver
      const resolver = new OriginResolver(configManager.getConfig());

      // Log that we're using Origins
      logDebug('Trying Origins-based path resolution', { path });

      // Find matching origin with captures
      originMatch = resolver.matchOriginWithCaptures(path);

      if (originMatch) {
        // Add breadcrumb for origin match
        if (requestContext) {
          addBreadcrumb(requestContext, 'Transform', 'Found matching Origin', {
            originName: originMatch.origin.name,
            matcher: originMatch.origin.matcher,
            path,
          });
        }

        // Log origin match details
        logDebug('Found matching Origin', {
          originName: originMatch.origin.name,
          matcher: originMatch.origin.matcher,
          captureCount: Object.keys(originMatch.captures).length,
        });

        // Add origin to diagnostics
        diagnosticsInfo.origin = {
          name: originMatch.origin.name,
          matcher: originMatch.origin.matcher,
        };

        // Resolve path to source
        sourceResolution = resolver.resolvePathToSource(path);

        if (sourceResolution) {
          // Log source resolution success
          logDebug('Resolved path to source', {
            originName: originMatch.origin.name,
            sourceType: sourceResolution.originType,
            resolvedPath: sourceResolution.resolvedPath,
            hasSourceUrl: !!sourceResolution.sourceUrl,
          });

          // Add breadcrumb for source resolution
          if (requestContext) {
            addBreadcrumb(requestContext, 'Transform', 'Resolved path to source', {
              originName: originMatch.origin.name,
              sourceType: sourceResolution.originType,
              hasSourceUrl: !!sourceResolution.sourceUrl,
            });
          }

          // Add source resolution to diagnostics
          diagnosticsInfo.sourceResolution = {
            type: sourceResolution.originType,
            resolvedPath: sourceResolution.resolvedPath,
            url: sourceResolution.sourceUrl,
          };
        } else {
          // Log source resolution failure
          logDebug('Failed to resolve path to source, will fall back to path patterns', {
            originName: originMatch.origin.name,
            path,
          });

          // Add warning to diagnostics (ensure warnings array exists)
          if (!diagnosticsInfo.warnings) {
            diagnosticsInfo.warnings = [];
          }
          diagnosticsInfo.warnings.push(
            `Failed to resolve path to source for origin: ${originMatch.origin.name}`
          );

          // Fall back to path patterns
          originMatch = null;
        }
      } else {
        // Log no matching origin
        logDebug('No matching Origin found, falling back to path patterns', { path });
      }
    } catch (err) {
      // Log error in Origins resolution
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logDebug('Error in Origins resolution, falling back to path patterns', {
        error: errorMessage,
        path,
      });

      // Add warning to diagnostics (ensure warnings array exists)
      if (!diagnosticsInfo.warnings) {
        diagnosticsInfo.warnings = [];
      }
      diagnosticsInfo.warnings.push(`Origins resolution error: ${errorMessage}`);
    }
  }

  // Fall back to path patterns if Origins resolution failed or is disabled
  if (!originMatch || !sourceResolution) {
    // Find matching path pattern for the URL
    pathPattern = findMatchingPathPattern(path, pathPatterns);

    // Add breadcrumb for path pattern matching
    if (requestContext) {
      addBreadcrumb(requestContext, 'Transform', 'Path pattern matching', {
        path,
        url: url.toString(),
        matchFound: !!pathPattern,
        patternName: pathPattern ? pathPattern.name : undefined,
        patternCount: pathPatterns.length,
      });
    }

    if (!pathPattern) {
      throw new Error('No matching path pattern or Origin found');
    }
  }

  const useOrigins = !!(originMatch && sourceResolution);

  return {
    pathPattern,
    originMatch,
    sourceResolution,
    useOrigins,
  };
}
