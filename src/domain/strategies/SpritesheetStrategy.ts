/**
 * Strategy for spritesheet mode transformations
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import {
  TransformationContext,
  TransformationStrategy,
  TransformParams,
} from './TransformationStrategy';
import { VideoConfigurationManager } from '../../config';
import { isValidTime, isValidDuration, parseTimeString } from '../../utils/transformationUtils';
import { createCategoryLogger } from '../../utils/logger';

const logger = createCategoryLogger('SpritesheetStrategy');
import { ValidationError } from '../../errors/ValidationError';
import { ErrorType } from '../../errors/VideoTransformError';

export class SpritesheetStrategy implements TransformationStrategy {
  /**
   * Prepare spritesheet-specific transformation parameters
   */
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    const params: TransformParams = {};
    const configManager = VideoConfigurationManager.getInstance();

    // Map parameters using the defined mapping
    for (const [ourParam, cdnParam] of Object.entries(configManager.getParamMapping())) {
      const optionKey = ourParam as keyof VideoTransformOptions;
      const optionValue = options[optionKey];

      if (optionValue !== null && optionValue !== undefined) {
        // For spritesheet mode, we need to exclude video-specific parameters
        if (
          !['loop', 'autoplay', 'muted', 'preload', 'quality', 'compression'].includes(ourParam)
        ) {
          params[cdnParam] = optionValue;
        }
      }
    }

    // For spritesheet mode, ensure these parameters are set
    params['mode'] = 'spritesheet';

    // Default time and duration if not specified
    if (!params['time']) {
      params['time'] = '0s';
    }

    // Keep duration unset unless caller specified; API will default/limit

    // Log the params for debugging
    logger.debug('Prepared spritesheet transformation params', params);

    return params;
  }

  /**
   * Validate spritesheet-specific options
   */
  async validateOptions(options: VideoTransformOptions): Promise<void> {
    const configManager = VideoConfigurationManager.getInstance();
    const context = {
      parameters: { mode: 'spritesheet' },
      diagnosticsInfo: {} as Record<string, unknown>,
    };

    // Require width and height for spritesheet mode
    if (options.width === null || options.width === undefined) {
      throw new ValidationError(
        'Missing required parameter: width',
        ErrorType.INVALID_PARAMETER,
        context
      );
    }

    if (options.height === null || options.height === undefined) {
      throw new ValidationError(
        'Missing required parameter: height',
        ErrorType.INVALID_PARAMETER,
        context
      );
    }

    // Validate width and height range
    if (options.width < 10 || options.width > 2000) {
      throw ValidationError.invalidDimension('width', options.width, 10, 2000, context);
    }

    if (options.height < 10 || options.height > 2000) {
      throw ValidationError.invalidDimension('height', options.height, 10, 2000, context);
    }

    // Check aspect ratio for extreme values
    const ratio = options.width / options.height;
    if (ratio > 5 || ratio < 0.2) {
      // Add warning to a custom property instead of array
      context.diagnosticsInfo['ratioWarning'] =
        `Extreme aspect ratio (${ratio.toFixed(2)}) may result in distorted spritesheet thumbnails`;
    }

    // Validate format parameter - not allowed for spritesheet mode
    if (options.format !== null && options.format !== undefined) {
      const invalidParams: Record<string, unknown> = { format: options.format };
      throw ValidationError.invalidOptionCombination(
        'Format parameter cannot be used with mode=spritesheet (always outputs JPEG)',
        invalidParams,
        context
      );
    }

    // Validate quality and compression parameters - not allowed for spritesheet mode
    if (
      (options.quality !== null && options.quality !== undefined) ||
      (options.compression !== null && options.compression !== undefined)
    ) {
      const invalidParams: Record<string, unknown> = {
        quality: options.quality,
        compression: options.compression,
      };
      throw ValidationError.invalidOptionCombination(
        'Quality and compression parameters cannot be used with mode=spritesheet',
        invalidParams,
        context
      );
    }

    // Validate fit
    if (options.fit && !configManager.isValidOption('fit', options.fit)) {
      const validFitOptions = configManager.getValidOptions('fit');
      throw new ValidationError(
        `Invalid fit: ${options.fit}. Must be one of: ${validFitOptions.join(', ')}`,
        undefined,
        {
          parameters: {
            fit: options.fit,
            validOptions: validFitOptions,
            mode: 'spritesheet',
          },
        }
      );
    }

    // Validate time parameter (0-30s)
    if (options.time !== null && options.time !== undefined) {
      if (!isValidTime(options.time)) {
        throw ValidationError.invalidTimeValue('time', options.time, context);
      }
    }

    // Validate duration parameter format and range
    if (options.duration !== null && options.duration !== undefined) {
      // Check if the format is valid
      const seconds = parseTimeString(options.duration);
      if (seconds === null) {
        // Invalid format
        throw ValidationError.invalidTimeValue('duration', options.duration, context);
      }

      if (!isValidDuration(options.duration)) {
        throw ValidationError.invalidTimeValue('duration', options.duration, context);
      }
    }

    // Validate if video-specific parameters are explicitly set, which is not allowed for spritesheet mode
    // Only check for non-null values to allow defaults to pass through
    const hasExplicitPlaybackParams =
      (options.loop !== null && options.loop !== undefined) ||
      (options.autoplay !== null && options.autoplay !== undefined) ||
      (options.muted !== null && options.muted !== undefined) ||
      (options.preload !== null && options.preload !== undefined);

    if (hasExplicitPlaybackParams) {
      const invalidParams = {
        loop: options.loop,
        autoplay: options.autoplay,
        muted: options.muted,
        preload: options.preload,
      };

      throw ValidationError.invalidOptionCombination(
        'Playback parameters (loop, autoplay, muted, preload) cannot be used with mode=spritesheet',
        invalidParams,
        context
      );
    }
  }

  /**
   * Update diagnostics with spritesheet-specific information
   */
  updateDiagnostics(context: TransformationContext): void {
    const { diagnosticsInfo, options } = context;

    // Add spritesheet-specific diagnostic information
    diagnosticsInfo.transformationType = 'spritesheet';

    // Add time range information as custom properties
    const startTime = options.time || '0s'; // Default start time
    const duration = options.duration || '60s'; // Default duration for diagnostics only

    // Add additional spritesheet-specific information
    diagnosticsInfo['outputFormat'] = 'jpg'; // Spritesheets are always JPEG

    // Add information on spritesheet specifics as a custom property
    diagnosticsInfo['spritesheet'] = {
      width: options.width,
      height: options.height,
      fit: options.fit || 'contain',
      timeRange: {
        start: startTime,
        duration: duration,
      },
    };

    diagnosticsInfo['startTime'] = startTime;
    diagnosticsInfo['duration'] = duration;

    // Ensure warnings array exists
    if (!diagnosticsInfo.warnings) {
      diagnosticsInfo.warnings = [];
    }

    // Check for ratio issues and add to custom diagnostics
    if (options.width && options.height) {
      const ratio = options.width / options.height;

      if (ratio > 5 || ratio < 0.2) {
        // Store in custom property to avoid type issues
        const warning = `Extreme aspect ratio (${ratio.toFixed(2)}) may result in distorted spritesheet thumbnails`;
        diagnosticsInfo['ratioWarning'] = warning;
      }
    }

    // Check for duration issues
    if (options.duration) {
      const durationMatch = options.duration.match(/(\d+)/);
      if (durationMatch) {
        const seconds = parseInt(durationMatch[1], 10);
        if (seconds > 60) {
          // Store in custom property
          const warning = `Duration of ${options.duration} may result in a very large spritesheet with reduced thumbnail quality`;
          diagnosticsInfo['durationWarning'] = warning;
        }
      }
    }
  }
}
