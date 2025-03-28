/**
 * Strategy for spritesheet mode transformations
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import { TransformationContext, TransformationStrategy, TransformParams } from './TransformationStrategy';
import { VideoConfigurationManager } from '../../config';
import { isValidTime, isValidDuration } from '../../utils/transformationUtils';
import { debug } from '../../utils/loggerUtils';
import { ValidationError } from '../../errors/ValidationError';

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
        if (!['loop', 'autoplay', 'muted', 'preload', 'quality', 'compression'].includes(ourParam)) {
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
    
    if (!params['duration'] && !options.duration) {
      // Default to 10s duration for spritesheets if not specified
      params['duration'] = '10s';
    }
    
    // Log the params for debugging
    debug('SpritesheetStrategy', 'Prepared spritesheet transformation params', params);
    
    return params;
  }
  
  /**
   * Validate spritesheet-specific options
   */
  async validateOptions(options: VideoTransformOptions): Promise<void> {
    const configManager = VideoConfigurationManager.getInstance();
    const context = { parameters: { mode: 'spritesheet' } };
    
    // Validate width and height range
    if (options.width !== null && options.width !== undefined) {
      if (options.width < 10 || options.width > 2000) {
        throw ValidationError.invalidDimension('width', options.width, 10, 2000, context);
      }
    }
    
    if (options.height !== null && options.height !== undefined) {
      if (options.height < 10 || options.height > 2000) {
        throw ValidationError.invalidDimension('height', options.height, 10, 2000, context);
      }
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
            mode: 'spritesheet'
          }
        }
      );
    }
    
    // Validate time parameter (0-30s)
    if (options.time !== null && options.time !== undefined) {
      if (!isValidTime(options.time)) {
        throw ValidationError.invalidTimeValue('time', options.time, context);
      }
    }
    
    // Validate duration parameter format only
    if (options.duration !== null && options.duration !== undefined) {
      const { parseTimeString } = await import('../../utils/transformationUtils');
      
      // Check if the format is valid (not checking limits)
      const seconds = parseTimeString(options.duration);
      if (seconds === null) {
        // Invalid format
        throw ValidationError.invalidTimeValue('duration', options.duration, context);
      }
      
      // Allow any valid duration format - we'll let the API limit it
    }
    
    // Validate if video-specific parameters are used, which is not allowed for spritesheet mode
    if (options.loop || options.autoplay || options.muted || options.preload) {
      const invalidParams = {
        loop: options.loop,
        autoplay: options.autoplay,
        muted: options.muted,
        preload: options.preload
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
    
    // Add time range information
    if (options.time) {
      diagnosticsInfo.startTime = options.time;
    } else {
      diagnosticsInfo.startTime = '0s'; // Default start time
    }
    
    if (options.duration) {
      diagnosticsInfo.duration = options.duration;
    } else {
      diagnosticsInfo.duration = '10s'; // Default duration
    }
    
    // Add spritesheet specific warnings
    if (!diagnosticsInfo.warnings) {
      diagnosticsInfo.warnings = [];
    }
    
    diagnosticsInfo.warnings.push('Spritesheet generation may be limited for videos longer than 30 seconds due to Cloudflare Media API constraints.');
  }
}