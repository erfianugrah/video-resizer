/**
 * Strategy for frame mode transformations (extracting still images from videos)
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import { TransformationContext, TransformationStrategy, TransformParams } from './TransformationStrategy';
import { VideoConfigurationManager } from '../../config';
import { isValidTime } from '../../utils/transformationUtils';
import { debug } from '../../utils/loggerUtils';
import { ValidationError } from '../../errors/ValidationError';

export class FrameStrategy implements TransformationStrategy {
  /**
   * Prepare frame-specific transformation parameters
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
        // For frame mode, we need to exclude video-specific parameters
        if (!['loop', 'autoplay', 'muted', 'preload', 'quality', 'compression'].includes(ourParam)) {
          params[cdnParam] = optionValue;
        }
      }
    }
    
    // For frame mode, ensure these parameters are set
    params['mode'] = 'frame';
    
    // Default to jpg format if not specified - Cloudflare API only accepts 'jpg' (not 'jpeg')
    if (!params['format']) {
      params['format'] = 'jpg';
    } else if (typeof params['format'] === 'string' && params['format'].toLowerCase() === 'jpeg') {
      // Normalize jpeg to jpg for Cloudflare Media Transformation API
      params['format'] = 'jpg';
    }
    
    // Default to time=0s if not specified
    if (!params['time']) {
      params['time'] = '0s';
    }
    
    // Log the params for debugging
    debug('FrameStrategy', 'Prepared frame transformation params', params);
    
    return params;
  }
  
  /**
   * Validate frame-specific options
   */
  async validateOptions(options: VideoTransformOptions): Promise<void> {
    const configManager = VideoConfigurationManager.getInstance();
    const context = { parameters: { mode: 'frame' } };
    
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
            mode: 'frame'
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
    
    // Validate format
    if (options.format) {
      const formatLower = options.format.toLowerCase();
      
      // Normalize jpg/jpeg format values
      if (formatLower === 'jpg' || formatLower === 'jpeg') {
        // Use 'jpg' format as Cloudflare API only accepts 'jpg' (not 'jpeg')
        options.format = 'jpg';
      } else {
        // For other formats, just normalize case to match valid options
        options.format = formatLower;
      }
      
      // Validate format
      if (!configManager.isValidOption('format', options.format)) {
        throw ValidationError.invalidFormat(
          options.format,
          configManager.getValidOptions('format') as string[],
          context
        );
      }
    }
    
    // Validate if video-specific parameters are used, which is not allowed for frame mode
    if (options.loop || options.autoplay || options.muted || options.preload) {
      const invalidParams = {
        loop: options.loop,
        autoplay: options.autoplay,
        muted: options.muted,
        preload: options.preload
      };
      
      throw ValidationError.invalidOptionCombination(
        'Playback parameters (loop, autoplay, muted, preload) cannot be used with mode=frame',
        invalidParams,
        context
      );
    }
  }
  
  /**
   * Update diagnostics with frame-specific information
   */
  updateDiagnostics(context: TransformationContext): void {
    const { diagnosticsInfo, options } = context;
    
    // Add frame-specific diagnostic information
    diagnosticsInfo.transformationType = 'frame';
    
    // Add format information if available
    if (options.format) {
      diagnosticsInfo.imageFormat = options.format;
    } else {
      diagnosticsInfo.imageFormat = 'jpg'; // Default format
    }
    
    // Add timestamp information
    if (options.time) {
      diagnosticsInfo.frameTimestamp = options.time;
    } else {
      diagnosticsInfo.frameTimestamp = '0s'; // Default timestamp
    }
  }
}