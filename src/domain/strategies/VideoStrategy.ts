/**
 * Strategy for video mode transformations
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import {
  TransformationContext,
  TransformationStrategy,
  TransformParams,
} from './TransformationStrategy';
import { VideoConfigurationManager } from '../../config';
import {
  isValidPlaybackOptions,
  isValidTime,
  isValidDuration,
  adjustDuration,
  haveDurationLimits,
  getTransformationLimit,
  storeTransformationLimit,
  parseTimeString,
} from '../../utils/transformationUtils';
import { createCategoryLogger } from '../../utils/logger';

const logger = createCategoryLogger('VideoStrategy');
import { ValidationError } from '../../errors';
import { logErrorWithContext, tryOrNull } from '../../utils/errorHandlingUtils';

export class VideoStrategy implements TransformationStrategy {
  /**
   * Prepare video-specific transformation parameters
   */
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    const params: TransformParams = {};
    const configManager = VideoConfigurationManager.getInstance();

    // Log initial parameters received and config
    import('../../utils/logger')
      .then(({ logInfo }) => {
        logInfo('VideoStrategy', 'Preparing transformation params', {
          options: JSON.stringify(options),
          derivatives: Object.keys(configManager.getConfig().derivatives || {}),
          defaults: configManager.getDefaults(),
        });
      })
      .catch((err) => {
        // Use standardized error handling
        logErrorWithContext(
          'Error importing logger for info logging',
          err,
          {
            fallback: 'using logger',
          },
          'VideoStrategy'
        );

        // Fallback only if import fails
        logger.debug('Preparing transformation params', {
          options: JSON.stringify(options),
          derivatives: Object.keys(configManager.getConfig().derivatives || {}),
        });
      });

    // Create a copy of options that we can modify if needed
    const adjustedOptions = { ...options };

    // Check if we have duration limits, if not, extract from configuration
    if (!haveDurationLimits()) {
      // Get the default duration from configuration
      const configDuration = configManager.getDefaultOption('duration');

      // Use proper logging instead of console
      import('../../utils/logger')
        .then(({ logInfo }) => {
          logInfo('VideoStrategy', 'Checking configuration for duration settings', {
            configLoaded: !!configManager,
            derivativesAvailable: configManager
              ? Object.keys(configManager.getConfig().derivatives || {}).length
              : 0,
            configDefaultDuration: configDuration,
          });
        })
        .catch(() => {
          logger.debug('Checking configuration for duration settings', {
            configDefaultDuration: configDuration,
          });
        });

      // If we have a valid duration in config, use it to set limits
      if (configDuration) {
        // Import duration parsing function
        import('../../utils/transformationUtils')
          .then(({ parseTimeString }) => {
            const seconds = parseTimeString(configDuration);
            if (seconds !== null && seconds > 0) {
              import('../../utils/logger')
                .then(({ logInfo: info }) => {
                  info('VideoStrategy', 'Setting duration limits from config', {
                    defaultDuration: configDuration,
                    parsedSeconds: seconds,
                    min: 0,
                    max: seconds,
                  });
                })
                .catch(() => {
                  logger.debug('Setting duration limits from config', {
                    configDuration,
                    seconds,
                  });
                });

              storeTransformationLimit('duration', 'min', 0);
              storeTransformationLimit('duration', 'max', seconds);
              return;
            } else {
              // If parseTimeString fails or returns 0, use 5m (300s) as default
              const fallbackSeconds = 300; // 5 minutes
              import('../../utils/logger')
                .then(({ logWarn: warn }) => {
                  warn('VideoStrategy', 'Invalid config duration format, using 5m fallback', {
                    invalidDuration: configDuration,
                    settingMin: 0,
                    settingMax: fallbackSeconds,
                  });
                })
                .catch(() => {
                  logger.debug('Invalid config duration format, using 5m fallback', {
                    invalidDuration: configDuration,
                  });
                });

              storeTransformationLimit('duration', 'min', 0);
              storeTransformationLimit('duration', 'max', fallbackSeconds);
            }
          })
          .catch((err) => {
            // If the import fails, use 5m (300s) as default
            const fallbackSeconds = 300; // 5 minutes
            import('../../utils/logger')
              .then(({ logWarn: warn }) => {
                warn('VideoStrategy', 'Error importing parseTimeString, using 5m fallback', {
                  error: err instanceof Error ? err.message : String(err),
                  settingMin: 0,
                  settingMax: fallbackSeconds,
                });
              })
              .catch(() => {
                logger.debug('Error importing parseTimeString, using 5m fallback');
              });

            storeTransformationLimit('duration', 'min', 0);
            storeTransformationLimit('duration', 'max', fallbackSeconds);
          });
      } else {
        // No configuration duration available, use 5m (300s) default
        const fallbackSeconds = 300; // 5 minutes

        import('../../utils/logger')
          .then(({ logWarn: warn }) => {
            warn('VideoStrategy', 'No config duration found - using 5m fallback', {
              settingMin: 0,
              settingMax: fallbackSeconds,
              reason: 'No configuration duration available',
            });
          })
          .catch(() => {
            logger.debug('No config duration found - using 5m fallback');
          });

        storeTransformationLimit('duration', 'min', 0);
        storeTransformationLimit('duration', 'max', fallbackSeconds);
      }
    }

    // Add details about where we're getting configuration
    import('../../utils/logger')
      .then(({ logInfo: info }) => {
        // Import transformation utils to get the current limits
        import('../../utils/transformationUtils').then(({ getTransformationLimit }) => {
          info('VideoStrategy', 'Configuration source details', {
            configIsInitialized: !!configManager,
            defaultDuration: configManager.getDefaultOption('duration'),
            haveDurationLimits: haveDurationLimits(),
            minDuration: getTransformationLimit('duration', 'min'),
            maxDuration: getTransformationLimit('duration', 'max'),
          });
        });
      })
      .catch(() => {
        logger.debug('Configuration source details', {
          defaultDuration: configManager.getDefaultOption('duration'),
          haveDurationLimits: haveDurationLimits(),
        });
      });

    // Adjust duration if provided
    if (adjustedOptions.duration) {
      const maxDuration = getTransformationLimit('duration', 'max') || 30;

      import('../../utils/logger')
        .then(({ logInfo }) => {
          logInfo('VideoStrategy', 'Checking video duration', {
            requestedDuration: adjustedOptions.duration,
            maxDuration,
            usingDefault: maxDuration === 30,
            configDefaultDuration: configManager.getDefaultOption('duration'),
          });
        })
        .catch(() => {
          logger.debug('Checking video duration', {
            requestedDuration: adjustedOptions.duration,
            maxDuration,
          });
        });

      const originalDuration = adjustedOptions.duration;

      // Adjust duration to fit within known limits
      adjustedOptions.duration = adjustDuration(originalDuration);

      // If duration was adjusted, add info to diagnostics
      if (adjustedOptions.duration !== originalDuration) {
        context.diagnosticsInfo.warnings = context.diagnosticsInfo.warnings || [];
        context.diagnosticsInfo.warnings.push(
          `Duration adjusted to ${adjustedOptions.duration} to fit within limit of ${maxDuration}s`
        );

        // Add to diagnostics
        context.diagnosticsInfo.adjustedDuration = adjustedOptions.duration;
        context.diagnosticsInfo.originalDuration = originalDuration;
        context.diagnosticsInfo.configDefaultDuration = configManager.getDefaultOption('duration');

        import('../../utils/logger')
          .then(({ logWarn: warn }) => {
            warn('VideoStrategy', 'Duration adjusted to fit limits', {
              originalDuration,
              adjustedDuration: adjustedOptions.duration,
              maxDuration,
              configDefault: configManager.getDefaultOption('duration'),
            });
          })
          .catch(() => {
            logger.debug('Duration adjusted to fit limits', {
              originalDuration,
              adjustedDuration: adjustedOptions.duration,
              maxDuration,
            });
          });
      }
    }

    // Default time to 0s if not provided
    if (!adjustedOptions.time) {
      adjustedOptions.time = '0s';
    }

    // Log the parameter mapping
    import('../../utils/logger')
      .then(({ logDebug }) => {
        logDebug('VideoStrategy', 'Parameter mapping', {
          mapping: configManager.getParamMapping(),
          hasDurationMapping: 'duration' in configManager.getParamMapping(),
          durationMapping: configManager.getParamMapping()['duration'],
        });
      })
      .catch(() => {
        logger.debug('Parameter mapping', {
          hasDurationMapping: 'duration' in configManager.getParamMapping(),
          durationMapping: configManager.getParamMapping()['duration'],
        });
      });

    // Map parameters using the defined mapping, but use our adjusted options
    for (const [ourParam, cdnParam] of Object.entries(configManager.getParamMapping())) {
      const optionKey = ourParam as keyof VideoTransformOptions;
      const optionValue = adjustedOptions[optionKey];

      // Log the parameter mapping if it's duration
      if (ourParam === 'duration') {
        import('../../utils/logger')
          .then(({ logDebug }) => {
            logDebug('VideoStrategy', 'Mapping duration parameter', {
              ourParam,
              cdnParam,
              optionValue,
              isNull: optionValue === null,
              isUndefined: optionValue === undefined,
            });
          })
          .catch(() => {
            logger.debug('Mapping duration parameter', {
              ourParam,
              cdnParam,
              hasValue: optionValue !== null && optionValue !== undefined,
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
    logger.debug('Prepared video transformation params', params);

    // Log detailed information about duration parameter
    import('../../utils/logger')
      .then(({ logInfo }) => {
        logInfo('VideoStrategy', 'Final transformation parameters', {
          hasDurationInOptions:
            adjustedOptions.duration !== null && adjustedOptions.duration !== undefined,
          hasDurationInParams: 'duration' in params,
          durationValue: params['duration'],
          originalDuration: options.duration,
          adjustedDuration: adjustedOptions.duration,
          allParams: Object.keys(params).join(','),
        });
      })
      .catch(() => {
        logger.debug('Final transformation parameters', {
          hasDurationInOptions:
            adjustedOptions.duration !== null && adjustedOptions.duration !== undefined,
          hasDurationInParams: 'duration' in params,
          durationValue: params['duration'],
          allParams: Object.keys(params).join(','),
        });
      });

    if (adjustedOptions.duration !== options.duration) {
      logger.debug('Adjusted duration parameter', {
        original: options.duration,
        adjusted: adjustedOptions.duration,
        maxDuration: getTransformationLimit('duration', 'max'),
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
      throw ValidationError.invalidFormat(
        'fit',
        configManager.getValidOptions('fit') as string[],
        contextObj
      );
    }

    // Validate time parameter (0-30s)
    if (options.time !== null && options.time !== undefined) {
      if (!isValidTime(options.time)) {
        throw ValidationError.invalidTimeValue('time', options.time, contextObj);
      }
    }

    // Validate and adjust duration parameter
    if (options.duration !== null && options.duration !== undefined) {
      // Check if the format is valid (not checking limits)
      const seconds = parseTimeString(options.duration);
      if (seconds === null) {
        // Invalid format
        throw ValidationError.invalidTimeValue('duration', options.duration, contextObj);
      }

      // Enforce product limits (1s - 60s)
      if (!isValidDuration(options.duration)) {
        throw ValidationError.invalidTimeValue('duration', options.duration, contextObj);
      }

      // Allow any valid duration format - we'll let the API limit it
      // We will adjust it automatically when we hit the API limit error
    }

    // Format parameter is not supported for video output
    if (options.format) {
      throw ValidationError.invalidOptionCombination(
        'Format parameter is not applicable for mode=video',
        { format: options.format },
        contextObj
      );
    }

    // Validate quality
    if (options.quality && !configManager.isValidOption('quality', options.quality)) {
      throw ValidationError.invalidFormat(
        'quality',
        configManager.getValidOptions('quality') as string[],
        contextObj
      );
    }

    // Validate compression
    if (options.compression && !configManager.isValidOption('compression', options.compression)) {
      throw ValidationError.invalidFormat(
        'compression',
        configManager.getValidOptions('compression') as string[],
        contextObj
      );
    }

    // Validate preload
    if (options.preload && !configManager.isValidOption('preload', options.preload)) {
      throw ValidationError.invalidFormat(
        'preload',
        configManager.getValidOptions('preload') as string[],
        contextObj
      );
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
