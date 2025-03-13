/**
 * Command for transforming videos using CDN-CGI paths
 */
import { videoConfig } from '../../config/videoConfig';
import { buildCdnCgiMediaUrl, findMatchingPathPattern, PathPattern } from '../../utils/pathUtils';
import { debug, error } from '../../utils/loggerUtils';
import { 
  isValidTime, 
  isValidDuration, 
  isValidFormatForMode,
  parseTimeString 
} from '../../utils/transformationUtils';

export interface VideoTransformOptions {
  width?: number | null;
  height?: number | null;
  mode?: string | null;
  fit?: string | null;
  audio?: boolean | null;
  format?: string | null;
  time?: string | null;
  duration?: string | null;
  source?: string;
  derivative?: string | null;
}

export interface DebugInfo {
  isDebugEnabled?: boolean;
  isVerboseEnabled?: boolean;
  includeHeaders?: boolean;
}

export interface VideoTransformContext {
  request: Request;
  options: VideoTransformOptions;
  pathPatterns: PathPattern[];
  debugInfo?: DebugInfo;
}

export type TransformParamValue = string | number | boolean | null;
export type TransformParams = Record<string, TransformParamValue>;

/**
 * Command class for transforming video URLs
 */
export class TransformVideoCommand {
  private context: VideoTransformContext;

  constructor(context: VideoTransformContext) {
    this.context = context;
  }

  /**
   * Execute the video transformation
   * @returns A response with the transformed video
   */
  async execute(): Promise<Response> {
    try {
      // Extract context information
      const { request, options, pathPatterns } = this.context;
      const url = new URL(request.url);
      const path = url.pathname;

      // Find matching path pattern for the current URL
      const pathPattern = findMatchingPathPattern(path, pathPatterns);

      // If no matching pattern found or if the pattern is set to not process, pass through
      if (!pathPattern || !pathPattern.processPath) {
        debug('TransformVideoCommand', 'Skipping path transformation', {
          path,
          url: url.toString(),
          hasPattern: !!pathPattern,
          shouldProcess: pathPattern?.processPath,
        });

        return fetch(request);
      }

      // Validate options
      this.validateOptions(options);

      // Map our options to CDN-CGI media parameters
      const cdnParams = this.mapToCdnParams(options);

      // Construct the video URL
      let videoUrl: string;

      // If the pattern has an originUrl, use it to construct the video URL
      if (pathPattern.originUrl) {
        videoUrl = this.constructVideoUrl(path, url, pathPattern);
      } else {
        // Otherwise use the current request URL as the video URL
        videoUrl = url.toString();
      }

      // Build the CDN-CGI media URL
      const cdnCgiUrl = buildCdnCgiMediaUrl(cdnParams, videoUrl);

      debug('TransformVideoCommand', 'Transformed URL', {
        original: url.toString(),
        transformed: cdnCgiUrl,
        options,
        pattern: pathPattern.name,
      });

      // Create a fetch request to the CDN-CGI URL
      return fetch(cdnCgiUrl, {
        method: request.method,
        headers: request.headers,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      error('TransformVideoCommand', 'Error transforming video', {
        error: errorMessage,
        stack: errorStack,
      });

      return new Response(`Error transforming video: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  /**
   * Construct the video URL using the path pattern
   */
  private constructVideoUrl(path: string, url: URL, pattern: PathPattern): string {
    // Create a new URL using the originUrl from the pattern
    if (!pattern.originUrl) {
      throw new Error('Origin URL is required for path transformation');
    }
    
    const videoUrl = new URL(pattern.originUrl);

    // Get the matched portion of the path
    const regex = new RegExp(pattern.matcher);
    const match = path.match(regex);

    if (match && match[0]) {
      const matchedPath = match[0];

      // If there's a captured group, use it as the path
      if (match.length > 1) {
        // Use the first capture group if available
        videoUrl.pathname = match[1];
      } else {
        // Otherwise use the full matched path
        videoUrl.pathname = matchedPath;
      }
    } else {
      // Fallback to the original path
      videoUrl.pathname = path;
    }

    // Copy query parameters from the original URL
    url.searchParams.forEach((value, key) => {
      // Skip video parameter names
      const videoParamNames = Object.keys(videoConfig.paramMapping);
      if (!videoParamNames.includes(key) && key !== 'derivative') {
        videoUrl.searchParams.set(key, value);
      }
    });

    return videoUrl.toString();
  }

  /**
   * Validate video transformation options
   */
  private validateOptions(options: VideoTransformOptions): void {
    const { validOptions } = videoConfig;

    // Validate mode
    if (options.mode && !validOptions.mode.includes(options.mode)) {
      throw new Error(
        `Invalid mode: ${options.mode}. Must be one of: ${validOptions.mode.join(', ')}`
      );
    }

    // Validate fit
    if (options.fit && !validOptions.fit.includes(options.fit)) {
      throw new Error(
        `Invalid fit: ${options.fit}. Must be one of: ${validOptions.fit.join(', ')}`
      );
    }

    // Validate format
    if (options.format && !validOptions.format.includes(options.format)) {
      throw new Error(
        `Invalid format: ${options.format}. Must be one of: ${validOptions.format.join(', ')}`
      );
    }

    // Validate format is only used with frame mode
    if (!isValidFormatForMode(options)) {
      throw new Error('Format parameter can only be used with mode=frame');
    }

    // Validate width and height range
    if (options.width !== null && options.width !== undefined) {
      if (options.width < 10 || options.width > 2000) {
        throw new Error('Width must be between 10 and 2000 pixels');
      }
    }

    if (options.height !== null && options.height !== undefined) {
      if (options.height < 10 || options.height > 2000) {
        throw new Error('Height must be between 10 and 2000 pixels');
      }
    }

    // Validate time parameter (0-30s)
    if (options.time !== null && options.time !== undefined) {
      if (!isValidTime(options.time)) {
        throw new Error('Time must be between 0s and 30s (e.g., "5s", "0.5s")');
      }
    }

    // Validate duration parameter
    if (options.duration !== null && options.duration !== undefined) {
      if (!isValidDuration(options.duration)) {
        throw new Error('Duration must be a positive time value (e.g., "5s", "1m")');
      }
    }
  }

  /**
   * Map our internal parameters to CDN-CGI media parameters
   */
  private mapToCdnParams(options: VideoTransformOptions): TransformParams {
    const { paramMapping } = videoConfig;
    const result: TransformParams = {};

    // Map each parameter using the defined mapping
    for (const [ourParam, cdnParam] of Object.entries(paramMapping)) {
      const optionKey = ourParam as keyof VideoTransformOptions;
      const optionValue = options[optionKey];
      
      if (optionValue !== null && optionValue !== undefined) {
        result[cdnParam] = optionValue;
      }
    }

    return result;
  }
}
