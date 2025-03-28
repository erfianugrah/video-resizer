/**
 * Strategy for video mode transformations
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import { TransformationContext, TransformationStrategy, TransformParams } from './TransformationStrategy';
import { VideoConfigurationManager } from '../../config';
import { 
  isValidPlaybackOptions, 
  isValidTime, 
  isValidDuration, 
  adjustDuration,
  haveDurationLimits,
  getTransformationLimit
} from '../../utils/transformationUtils';
import { debug } from '../../utils/loggerUtils';
import { ValidationError } from '../../errors';

export class VideoStrategy implements TransformationStrategy {
  /**
   * Prepare video-specific transformation parameters
   */
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    const params: TransformParams = {};
    const configManager = VideoConfigurationManager.getInstance();
    
    // Create a copy of options that we can modify if needed
    const adjustedOptions = { ...options };
    
    // Adjust duration if needed and if we have learned limits
    if (adjustedOptions.duration && haveDurationLimits()) {
      const maxDuration = getTransformationLimit('duration', 'max');
      
      // Only adjust if we've learned limits from previous API responses
      if (maxDuration) {
        const originalDuration = adjustedOptions.duration;
        
        // Adjust duration to fit within known limits
        adjustedOptions.duration = adjustDuration(originalDuration);
        
        // If duration was adjusted, add info to diagnostics
        if (adjustedOptions.duration !== originalDuration) {
          context.diagnosticsInfo.warnings = context.diagnosticsInfo.warnings || [];
          context.diagnosticsInfo.warnings.push(`Duration adjusted to ${adjustedOptions.duration} to fit within learned limit of ${maxDuration}s`);
          
          // Add to diagnostics
          context.diagnosticsInfo.adjustedDuration = adjustedOptions.duration;
          context.diagnosticsInfo.originalDuration = originalDuration;
        }
      }
    }
    
    // Map parameters using the defined mapping, but use our adjusted options
    for (const [ourParam, cdnParam] of Object.entries(configManager.getParamMapping())) {
      const optionKey = ourParam as keyof VideoTransformOptions;
      const optionValue = adjustedOptions[optionKey];
      
      if (optionValue !== null && optionValue !== undefined) {
        params[cdnParam] = optionValue;
      }
    }
    
    // For video mode, ensure these parameters are set
    if (!params['mode']) {
      params['mode'] = 'video';
    }
    
    // Log the params for debugging
    debug('VideoStrategy', 'Prepared video transformation params', params);
    
    if (adjustedOptions.duration !== options.duration) {
      debug('VideoStrategy', 'Adjusted duration parameter', {
        original: options.duration,
        adjusted: adjustedOptions.duration,
        maxDuration: getTransformationLimit('duration', 'max')
      });
    }
    
    return params;
  }
  
  /**
   * Validate video-specific options
   */
  async validateOptions(options: VideoTransformOptions): Promise<void> {
    const configManager = VideoConfigurationManager.getInstance();
    const contextObj = { parameters: { mode: 'video', ...options } };
    
    // Validate width and height range
    if (options.width !== null && options.width !== undefined) {
      if (options.width < 10 || options.width > 2000) {
        throw ValidationError.invalidDimension('width', options.width, 10, 2000, contextObj);
      }
    }
    
    if (options.height !== null && options.height !== undefined) {
      if (options.height < 10 || options.height > 2000) {
        throw ValidationError.invalidDimension('height', options.height, 10, 2000, contextObj);
      }
    }
    
    // Validate fit
    if (options.fit && !configManager.isValidOption('fit', options.fit)) {
      throw ValidationError.invalidFormat('fit', configManager.getValidOptions('fit') as string[], contextObj);
    }
    
    // Validate time parameter (0-30s)
    if (options.time !== null && options.time !== undefined) {
      if (!isValidTime(options.time)) {
        throw ValidationError.invalidTimeValue('time', options.time, contextObj);
      }
    }
    
    // Validate and adjust duration parameter
    if (options.duration !== null && options.duration !== undefined) {
      const { parseTimeString, isValidDuration, adjustDuration } = await import('../../utils/transformationUtils');
      
      // Check if the format is valid (not checking limits)
      const seconds = parseTimeString(options.duration);
      if (seconds === null) {
        // Invalid format
        throw ValidationError.invalidTimeValue('duration', options.duration, contextObj);
      }
      
      // Allow any valid duration format - we'll let the API limit it
      // We will adjust it automatically when we hit the API limit error
    }
    
    // Validate quality
    if (options.quality && !configManager.isValidOption('quality', options.quality)) {
      throw ValidationError.invalidFormat('quality', configManager.getValidOptions('quality') as string[], contextObj);
    }
    
    // Validate compression
    if (options.compression && !configManager.isValidOption('compression', options.compression)) {
      throw ValidationError.invalidFormat('compression', configManager.getValidOptions('compression') as string[], contextObj);
    }
    
    // Validate preload
    if (options.preload && !configManager.isValidOption('preload', options.preload)) {
      throw ValidationError.invalidFormat('preload', configManager.getValidOptions('preload') as string[], contextObj);
    }
    
    // Validate playback options
    if (!isValidPlaybackOptions(options)) {
      if (options.autoplay && !options.muted && !options.audio) {
        throw ValidationError.invalidOptionCombination(
          'Autoplay with audio requires muted=true for browser compatibility',
          { autoplay: options.autoplay, muted: options.muted, audio: options.audio },
          contextObj
        );
      }
    }
  }
  
  /**
   * Update diagnostics with video-specific information
   */
  updateDiagnostics(context: TransformationContext): void {
    const { diagnosticsInfo, options } = context;
    
    // Add video-specific diagnostic information
    diagnosticsInfo.transformationType = 'video';
    
    // Add quality information if available
    if (options.quality) {
      diagnosticsInfo.videoQuality = options.quality;
    }
    
    // Add compression information if available
    if (options.compression) {
      diagnosticsInfo.videoCompression = options.compression;
    }
    
    // Add playback settings if available
    const playbackSettings: Record<string, string | boolean> = {};
    if (options.loop !== null && options.loop !== undefined) {
      playbackSettings.loop = options.loop;
    }
    if (options.autoplay !== null && options.autoplay !== undefined) {
      playbackSettings.autoplay = options.autoplay;
    }
    if (options.muted !== null && options.muted !== undefined) {
      playbackSettings.muted = options.muted;
    }
    if (options.preload !== null && options.preload !== undefined) {
      playbackSettings.preload = options.preload;
    }
    
    if (Object.keys(playbackSettings).length > 0) {
      diagnosticsInfo.playbackSettings = playbackSettings;
    }
  }
}