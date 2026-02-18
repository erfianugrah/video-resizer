/**
 * Strategy for audio-only transformations
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import {
  TransformationContext,
  TransformationStrategy,
  TransformParams,
} from './TransformationStrategy';
import { VideoConfigurationManager } from '../../config';
import { isValidTime, isValidDuration } from '../../utils/transformationUtils';
import { createCategoryLogger } from '../../utils/logger';

const logger = createCategoryLogger('AudioStrategy');
import { ValidationError } from '../../errors/ValidationError';

export class AudioStrategy implements TransformationStrategy {
  /**
   * Prepare audio-specific transformation parameters
   */
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    const params: TransformParams = {};
    const configManager = VideoConfigurationManager.getInstance();

    // Map parameters using the defined mapping, but exclude video-only fields
    for (const [ourParam, cdnParam] of Object.entries(configManager.getParamMapping())) {
      const optionKey = ourParam as keyof VideoTransformOptions;
      const optionValue = options[optionKey];

      if (optionValue !== null && optionValue !== undefined) {
        // Exclude video/frame-specific params that do not apply to audio output
        if (
          ![
            'width',
            'height',
            'fit',
            'loop',
            'autoplay',
            'muted',
            'preload',
            'quality',
            'compression',
          ].includes(ourParam)
        ) {
          params[cdnParam] = optionValue;
        }
      }
    }

    // Ensure mode is set to audio
    params['mode'] = 'audio';

    // Audio output must include audio
    params['audio'] = true;

    // Default format for audio output
    if (!params['format']) {
      params['format'] = 'm4a';
    }

    // Default start time
    if (!params['time']) {
      params['time'] = '0s';
    }

    logger.debug('Prepared audio transformation params', params);
    return params;
  }

  /**
   * Validate audio-specific options
   */
  async validateOptions(options: VideoTransformOptions): Promise<void> {
    const context = { parameters: { mode: 'audio' } };
    const configManager = VideoConfigurationManager.getInstance();

    // Audio flag must be true (cannot be muted/disabled)
    if (options.audio === false) {
      throw ValidationError.invalidOptionCombination(
        'Audio output requires audio=true',
        { audio: options.audio },
        context
      );
    }

    // Disallow width/height/fit for audio output
    if (options.width !== null && options.width !== undefined) {
      throw ValidationError.invalidOptionCombination(
        'Width parameter is not applicable for mode=audio',
        { width: options.width },
        context
      );
    }
    if (options.height !== null && options.height !== undefined) {
      throw ValidationError.invalidOptionCombination(
        'Height parameter is not applicable for mode=audio',
        { height: options.height },
        context
      );
    }
    if (options.fit) {
      throw ValidationError.invalidOptionCombination(
        'Fit parameter is not applicable for mode=audio',
        { fit: options.fit },
        context
      );
    }

    // Disallow video playback params
    if (options.loop || options.autoplay || options.muted || options.preload) {
      const invalidParams = {
        loop: options.loop,
        autoplay: options.autoplay,
        muted: options.muted,
        preload: options.preload,
      };
      throw ValidationError.invalidOptionCombination(
        'Playback parameters (loop, autoplay, muted, preload) cannot be used with mode=audio',
        invalidParams,
        context
      );
    }

    // Validate time range (0–10m)
    if (options.time !== null && options.time !== undefined) {
      if (!isValidTime(options.time)) {
        throw ValidationError.invalidTimeValue('time', options.time, context);
      }
    }

    // Validate duration range (1–60s)
    if (options.duration !== null && options.duration !== undefined) {
      if (!isValidDuration(options.duration)) {
        throw ValidationError.invalidTimeValue('duration', options.duration, context);
      }
    }

    // Validate format (only m4a)
    if (options.format) {
      const normalized = options.format.toLowerCase();
      if (normalized !== 'm4a') {
        throw ValidationError.invalidFormat(options.format, ['m4a'], context);
      }
      options.format = 'm4a';
    }

    // Quality/compression not supported for audio mode
    if (options.quality || options.compression) {
      throw ValidationError.invalidOptionCombination(
        'Quality and compression parameters cannot be used with mode=audio',
        { quality: options.quality, compression: options.compression },
        context
      );
    }
  }

  /**
   * Update diagnostics with audio-specific information
   */
  updateDiagnostics(context: TransformationContext): void {
    const { diagnosticsInfo, options } = context;
    diagnosticsInfo.transformationType = 'audio';
    diagnosticsInfo.audioFormat = options.format || 'm4a';
    diagnosticsInfo.audioStartTime = options.time || '0s';
    diagnosticsInfo.audioDuration = options.duration || '60s';
  }
}
