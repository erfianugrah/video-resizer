/**
 * OriginResolver service for handling video origins and sources
 */

import { Origin, Source, VideoResizerConfig, OriginsConfig } from '../videoStorage/interfaces';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';
import { 
  OriginError, 
  OriginResolutionError, 
  SourceResolutionError 
} from '../../errors/OriginError';

/**
 * Result of origin matching including capture group values
 */
export interface OriginMatchResult {
  origin: Origin;
  matched: boolean;
  captures: Record<string, string>;
  originalPath: string;
}

/**
 * Options for path resolution in sources
 */
export interface PathResolutionOptions {
  originType?: 'r2' | 'remote' | 'fallback';
  priorityOrder?: boolean;
}

/**
 * Result of source selection and path resolution
 */
export interface SourceResolutionResult {
  source: Source;
  resolvedPath: string;
  originType: 'r2' | 'remote' | 'fallback';
  sourceUrl?: string;
}

/**
 * Service for resolving origins and sources based on path patterns
 */
export class OriginResolver {
  private config: VideoResizerConfig;
  private originsArray: Origin[] = [];

  constructor(config: VideoResizerConfig) {
    this.config = config;
    this.initializeOriginsArray();
  }

  /**
   * Initialize the origins array from the config
   */
  private initializeOriginsArray(): void {
    if (!this.config.origins) {
      this.originsArray = [];
      return;
    }

    // If origins is an array, use it directly
    if (Array.isArray(this.config.origins)) {
      this.originsArray = [...this.config.origins];
      return;
    }

    // If origins is an OriginsConfig object, extract the items array
    const originsConfig = this.config.origins as OriginsConfig;
    if (originsConfig.items && Array.isArray(originsConfig.items)) {
      this.originsArray = [...originsConfig.items];
      return;
    }

    // Default to empty array
    this.originsArray = [];
  }

  /**
   * Find a matching origin for a given URL path
   * @param path The URL path to match
   * @param throwIfNotFound Whether to throw an error if no origin matches
   * @returns The matching origin or null if none match
   * @throws OriginResolutionError if throwIfNotFound is true and no match is found
   */
  public findMatchingOrigin(path: string, throwIfNotFound: boolean = false): Origin | null {
    if (this.originsArray.length === 0) {
      if (throwIfNotFound) {
        throw new OriginResolutionError(
          'No origins configured',
          path
        );
      }
      return null;
    }

    // Log operation with limited scope to avoid overwhelming logs
    console.debug(`[OriginResolver] Finding matching origin for path: ${path}`, { 
      originCount: this.originsArray.length,
      originNames: this.originsArray.map((o: Origin) => o.name)
    });

    for (const origin of this.originsArray) {
      try {
        const regex = new RegExp(origin.matcher);
        const isMatch = regex.test(path);
        
        if (isMatch) {
          console.debug(`[OriginResolver] Found matching origin: ${origin.name}`, {
            matcher: origin.matcher,
            path
          });
          return origin;
        }
      } catch (err) {
        // Log error and continue to next pattern
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.debug(`[OriginResolver] Error testing origin: ${origin.name}`, {
          matcher: origin.matcher,
          error: errorMessage
        });
      }
    }

    console.debug('[OriginResolver] No matching origin found for path', { path });
    
    if (throwIfNotFound) {
      throw OriginError.notFound(path, {
        parameters: {
          availableOrigins: this.originsArray.map((o: Origin) => o.name)
        }
      });
    }
    
    return null;
  }

  /**
   * Find a matching origin with captured groups
   * @param path The URL path to match
   * @param throwIfNotFound Whether to throw an error if no origin matches
   * @returns An origin match result with origin and captures
   * @throws OriginError if throwIfNotFound is true and no match is found
   */
  public matchOriginWithCaptures(path: string, throwIfNotFound: boolean = false): OriginMatchResult | null {
    if (this.originsArray.length === 0) {
      if (throwIfNotFound) {
        throw new OriginResolutionError(
          'No origins configured',
          path
        );
      }
      return null;
    }

    for (const origin of this.originsArray) {
      try {
        const regex = new RegExp(origin.matcher);
        const match = path.match(regex);
        
        if (match) {
          const captures: Record<string, string> = {};
          
          // Add numbered captures
          for (let i = 1; i < match.length; i++) {
            captures[i.toString()] = match[i];
            
            // If there are named capture groups defined, use those names too
            if (origin.captureGroups && i <= origin.captureGroups.length) {
              const name = origin.captureGroups[i - 1];
              if (name) {
                captures[name] = match[i];
              }
            }
          }
          
          return {
            origin,
            matched: true,
            captures,
            originalPath: path,
          };
        }
      } catch (err) {
        // Log error and continue to next origin
        logErrorWithContext(
          `Error matching origin pattern: ${origin.name}`,
          err,
          { path, matcher: origin.matcher },
          'OriginResolver'
        );
      }
    }

    if (throwIfNotFound) {
      throw OriginError.notFound(path, {
        parameters: {
          availableOrigins: this.originsArray.map((o: Origin) => o.name)
        }
      });
    }

    return null;
  }

  /**
   * Get the highest priority source for a given origin
   * @param origin The origin to get sources from
   * @param options Options for source selection
   * @param throwIfNotFound Whether to throw an error if no source is found
   * @returns The highest priority source
   * @throws SourceResolutionError if throwIfNotFound is true and no source is found
   */
  public getHighestPrioritySource(
    origin: Origin, 
    options?: { excludeTypes?: Array<'r2' | 'remote' | 'fallback'> },
    throwIfNotFound: boolean = false
  ): Source | null {
    if (!origin.sources || origin.sources.length === 0) {
      if (throwIfNotFound) {
        throw new SourceResolutionError(
          `No sources defined for origin '${origin.name}'`,
          origin.name,
          'any'
        );
      }
      return null;
    }

    // Sort sources by priority (lower number is higher priority)
    const sortedSources = [...origin.sources].sort((a, b) => a.priority - b.priority);
    
    // Filter out excluded types if specified
    const filteredSources = options?.excludeTypes 
      ? sortedSources.filter(source => !options.excludeTypes?.includes(source.type))
      : sortedSources;
    
    if (filteredSources.length === 0 && throwIfNotFound) {
      const excludedTypes = options?.excludeTypes ? options.excludeTypes.join(', ') : '';
      throw OriginError.sourceResolutionFailed(
        origin.name,
        '',
        `No sources available${excludedTypes ? ` (excluded types: ${excludedTypes})` : ''}`
      );
    }
    
    return filteredSources.length > 0 ? filteredSources[0] : null;
  }

  /**
   * Resolve a path for a specific source using capture groups
   * @param path The original path
   * @param source The source to resolve for
   * @param captures The capture groups from matching
   * @param originName The name of the origin (for error reporting)
   * @param throwIfError Whether to throw an error if path resolution fails
   * @returns The resolved path
   * @throws OriginError if throwIfError is true and path resolution fails
   */
  public resolvePathForSource(
    path: string, 
    source: Source, 
    captures: Record<string, string>,
    originName?: string,
    throwIfError: boolean = false
  ): string {
    try {
      // If source has no path definition, return the original path
      if (!source.path) {
        return path.startsWith('/') ? path.substring(1) : path;
      }

      // Start with the source path template
      let resolvedPath = source.path;

      // Replace capture group references with actual values
      Object.entries(captures).forEach(([key, value]) => {
        // Replace both $1, $2, etc. and ${1}, ${videoId}, etc. formats
        resolvedPath = resolvedPath.replace(new RegExp(`\\$${key}\\b`, 'g'), value);
        resolvedPath = resolvedPath.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
      });

      return resolvedPath;
    } catch (err) {
      // Log error
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logErrorWithContext(
        `Error resolving path for source type: ${source.type}`,
        err,
        { path, sourcePath: source.path },
        'OriginResolver'
      );
      
      if (throwIfError && originName) {
        throw OriginError.pathResolutionFailed(
          path,
          originName,
          errorMessage,
          {
            parameters: {
              sourcePath: source.path,
              sourceType: source.type,
              captures: JSON.stringify(captures)
            }
          }
        );
      }
      
      // Return the original path as fallback if not throwing
      return path.startsWith('/') ? path.substring(1) : path;
    }
  }

  /**
   * Fully resolve a path to a source with URL and path
   * @param path The original request path
   * @param options Options for resolution
   * @param throwIfNotFound Whether to throw an error if no match is found
   * @returns A source resolution result or null if no match
   * @throws OriginError if throwIfNotFound is true and no match is found
   */
  public resolvePathToSource(
    path: string, 
    options?: PathResolutionOptions, 
    throwIfNotFound: boolean = false
  ): SourceResolutionResult | null {
    try {
      // Find matching origin with captures
      const originMatch = this.matchOriginWithCaptures(path, throwIfNotFound);
      if (!originMatch) {
        return null;
      }

      // Get sources in priority order
      const origin = originMatch.origin;
      let sources = [...origin.sources];

      // Sort by priority if requested
      if (options?.priorityOrder !== false) {
        sources = sources.sort((a, b) => a.priority - b.priority);
      }

      // Filter by originType if specified
      if (options?.originType) {
        sources = sources.filter(s => s.type === options.originType);
      }

      // If no sources left after filtering, throw error or return null
      if (sources.length === 0) {
        if (throwIfNotFound) {
          const originTypeName = options?.originType ? options.originType : 'any';
          throw OriginError.sourceResolutionFailed(
            origin.name,
            path,
            `No sources of type '${originTypeName}' found for origin '${origin.name}'`,
            {
              parameters: {
                availableSourceTypes: origin.sources.map(s => s.type)
              }
            }
          );
        }
        return null;
      }

      // Use the first (highest priority) source
      const source = sources[0];
      
      // Resolve the path for this source
      const resolvedPath = this.resolvePathForSource(
        path, 
        source, 
        originMatch.captures,
        origin.name,
        throwIfNotFound
      );
      
      // Build the full result
      const result: SourceResolutionResult = {
        source,
        resolvedPath,
        originType: source.type,
      };

      // Add sourceUrl for remote and fallback types
      if (source.type === 'remote' || source.type === 'fallback') {
        if (source.url) {
          const baseUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
          result.sourceUrl = `${baseUrl}/${resolvedPath}`;
        } else if (throwIfNotFound) {
          throw OriginError.sourceResolutionFailed(
            origin.name,
            path,
            `Source of type '${source.type}' does not have a URL configured`,
            {
              parameters: {
                sourceType: source.type
              }
            }
          );
        }
      }

      return result;
    } catch (err) {
      // If the error is already an OriginError, rethrow it
      if (err instanceof OriginError) {
        throw err;
      }
      
      // Otherwise log error and return null, or throw new OriginError
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logErrorWithContext(
        'Error resolving path to source',
        err,
        { path, options },
        'OriginResolver'
      );
      
      if (throwIfNotFound) {
        throw OriginError.sourceResolutionFailed(
          'unknown',
          path,
          errorMessage,
          {
            parameters: {
              options: JSON.stringify(options)
            }
          }
        );
      }
      
      return null;
    }
  }
}