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
  getTransformationLimit,
  storeTransformationLimit
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
    
    // Log initial parameters received and config
    import('../../utils/legacyLoggerAdapter').then(({ info }) => {
      info('VideoStrategy', 'Preparing transformation params', {
        options: JSON.stringify(options),
        derivatives: Object.keys(configManager.getConfig().derivatives || {}),
        defaults: configManager.getDefaults()
      });
    }).catch(() => {
      // Fallback only if import fails
      debug('VideoStrategy', 'Preparing transformation params', {
        options: JSON.stringify(options),
        derivatives: Object.keys(configManager.getConfig().derivatives || {})
      });
    });
    
    // Create a copy of options that we can modify if needed
    const adjustedOptions = { ...options };
    
    // Apply default duration from config if not specified in options
    if (adjustedOptions.duration === null || adjustedOptions.duration === undefined) {
      const configDuration = configManager.getDefaultOption('duration');
      if (configDuration) {
        // Apply it synchronously first
        adjustedOptions.duration = configDuration;
        
        // Log it asynchronously
        try {
          import('../../utils/legacyLoggerAdapter').then(({ info }) => {
            info('VideoStrategy', 'Applied default duration from config', {
              defaultDuration: configDuration,
              hadExistingDuration: !!options.duration
            });
          }).catch(() => {
            // Use debug from loggerUtils as a fallback
            debug('VideoStrategy', 'Applied default duration from config', {
              defaultDuration: configDuration
            });
          });
        } catch (err) {
          // Use debug from loggerUtils as a fallback
          debug('VideoStrategy', 'Applied default duration from config', {
            defaultDuration: configDuration
          });
        }
      }
    }
    
    // Check if we have duration limits, if not, extract from configuration
    if (!haveDurationLimits()) {
      // Use proper logging instead of console
      import('../../utils/legacyLoggerAdapter').then(({ warn, info }) => {
        warn('VideoStrategy', 'No duration limits found - checking configuration', {
          configLoaded: !!configManager,
          derivativesAvailable: configManager ? Object.keys(configManager.getConfig().derivatives || {}).length : 0,
          configDefaultDuration: configManager.getDefaultOption('duration')
        });
        
        // Try to get the duration from configuration first
        const configDuration = configManager.getDefaultOption('duration');
        if (configDuration) {
          // Import duration parsing function
          import('../../utils/transformationUtils').then(({ parseTimeString }) => {
            const seconds = parseTimeString(configDuration);
            if (seconds !== null) {
              info('VideoStrategy', 'Setting duration limits from config', {
                defaultDuration: configDuration,
                parsedSeconds: seconds,
                min: 0,
                max: seconds
              });
              
              storeTransformationLimit('duration', 'min', 0);
              storeTransformationLimit('duration', 'max', seconds);
              return;
            }
          });
        } else {
          // Fallback to default of 30s if no configuration is available
          warn('VideoStrategy', 'No config duration found - applying defaults', {
            settingMin: 0,
            settingMax: 30,
            reason: 'No configuration duration available'
          });
          
          storeTransformationLimit('duration', 'min', 0);
          storeTransformationLimit('duration', 'max', 30);
        }
      }).catch(() => {
        // Use debug from loggerUtils as a fallback
        debug('VideoStrategy', 'No duration limits found - applying defaults of 0-30s', {});
        
        // Get default duration from config if available
        const configDuration = configManager.getDefaultOption('duration');
        if (configDuration) {
          debug('VideoStrategy', 'Found config duration', { configDuration });
          
          // Try to parse the duration from config
          const durationMatch = configDuration.match(/^(\d+)([sm])$/);
          if (durationMatch) {
            const value = parseInt(durationMatch[1], 10);
            const unit = durationMatch[2];
            
            // Convert to seconds
            const seconds = unit === 'm' ? value * 60 : value;
            debug('VideoStrategy', 'Setting duration limits from config', { 
              min: 0, 
              max: seconds,
              configDuration
            });
            
            storeTransformationLimit('duration', 'min', 0);
            storeTransformationLimit('duration', 'max', seconds);
            return;
          }
        }
        
        // Fallback to 30s default
        debug('VideoStrategy', 'Using fallback 30s duration limit', {
          reason: 'No valid configuration found'
        });
        storeTransformationLimit('duration', 'min', 0);
        storeTransformationLimit('duration', 'max', 30);
      });
    }
    
    // Add details about where we're getting configuration
    import('../../utils/legacyLoggerAdapter').then(({ info }) => {
      // Import transformation utils to get the current limits
      import('../../utils/transformationUtils').then(({ getTransformationLimit }) => {
        info('VideoStrategy', 'Configuration source details', {
          configIsInitialized: !!configManager,
          defaultDuration: configManager.getDefaultOption('duration'),
          haveDurationLimits: haveDurationLimits(),
          minDuration: getTransformationLimit('duration', 'min'),
          maxDuration: getTransformationLimit('duration', 'max')
        });
      });
    }).catch(() => {
      debug('VideoStrategy', 'Configuration source details', { 
        defaultDuration: configManager.getDefaultOption('duration'), 
        haveDurationLimits: haveDurationLimits() 
      });
    });
    
    // Adjust duration if provided
    if (adjustedOptions.duration) {
      const maxDuration = getTransformationLimit('duration', 'max') || 30;
      
      import('../../utils/legacyLoggerAdapter').then(({ info }) => {
        info('VideoStrategy', 'Checking video duration', {
          requestedDuration: adjustedOptions.duration,
          maxDuration,
          usingDefault: maxDuration === 30,
          configDefaultDuration: configManager.getDefaultOption('duration')
        });
      }).catch(() => {
        debug('VideoStrategy', 'Checking video duration', {
          requestedDuration: adjustedOptions.duration,
          maxDuration
        });
      });
      
      const originalDuration = adjustedOptions.duration;
      
      // Adjust duration to fit within known limits
      adjustedOptions.duration = adjustDuration(originalDuration);
      
      // If duration was adjusted, add info to diagnostics
      if (adjustedOptions.duration !== originalDuration) {
        context.diagnosticsInfo.warnings = context.diagnosticsInfo.warnings || [];
        context.diagnosticsInfo.warnings.push(`Duration adjusted to ${adjustedOptions.duration} to fit within limit of ${maxDuration}s`);
        
        // Add to diagnostics
        context.diagnosticsInfo.adjustedDuration = adjustedOptions.duration;
        context.diagnosticsInfo.originalDuration = originalDuration;
        context.diagnosticsInfo.configDefaultDuration = configManager.getDefaultOption('duration');
        
        import('../../utils/legacyLoggerAdapter').then(({ warn }) => {
          warn('VideoStrategy', 'Duration adjusted to fit limits', {
            originalDuration,
            adjustedDuration: adjustedOptions.duration,
            maxDuration,
            configDefault: configManager.getDefaultOption('duration')
          });
        }).catch(() => {
          debug('VideoStrategy', 'Duration adjusted to fit limits', {
            originalDuration,
            adjustedDuration: adjustedOptions.duration,
            maxDuration
          });
        });
      }
    }
    
    // Log the parameter mapping
    import('../../utils/legacyLoggerAdapter').then(({ debug: logDebug }) => {
      logDebug('VideoStrategy', 'Parameter mapping', {
        mapping: configManager.getParamMapping(),
        hasDurationMapping: 'duration' in configManager.getParamMapping(),
        durationMapping: configManager.getParamMapping()['duration']
      });
    }).catch(() => {
      debug('VideoStrategy', 'Parameter mapping', {
        hasDurationMapping: 'duration' in configManager.getParamMapping(),
        durationMapping: configManager.getParamMapping()['duration']
      });
    });
    
    // Map parameters using the defined mapping, but use our adjusted options
    for (const [ourParam, cdnParam] of Object.entries(configManager.getParamMapping())) {
      const optionKey = ourParam as keyof VideoTransformOptions;
      const optionValue = adjustedOptions[optionKey];
      
      // Log the parameter mapping if it's duration
      if (ourParam === 'duration') {
        import('../../utils/legacyLoggerAdapter').then(({ debug: logDebug }) => {
          logDebug('VideoStrategy', 'Mapping duration parameter', {
            ourParam,
            cdnParam,
            optionValue,
            isNull: optionValue === null,
            isUndefined: optionValue === undefined
          });
        }).catch(() => {
          debug('VideoStrategy', 'Mapping duration parameter', {
            ourParam,
            cdnParam,
            hasValue: optionValue !== null && optionValue !== undefined
          });
        });
      }
      
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
    
    // Log detailed information about duration parameter
    import('../../utils/legacyLoggerAdapter').then(({ info }) => {
      info('VideoStrategy', 'Final transformation parameters', {
        hasDurationInOptions: adjustedOptions.duration !== null && adjustedOptions.duration !== undefined,
        hasDurationInParams: 'duration' in params,
        durationValue: params['duration'],
        originalDuration: options.duration,
        adjustedDuration: adjustedOptions.duration,
        allParams: Object.keys(params).join(',')
      });
    }).catch(() => {
      debug('VideoStrategy', 'Final transformation parameters', {
        hasDurationInOptions: adjustedOptions.duration !== null && adjustedOptions.duration !== undefined,
        hasDurationInParams: 'duration' in params,
        durationValue: params['duration'],
        allParams: Object.keys(params).join(',')
      });
    });
    
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