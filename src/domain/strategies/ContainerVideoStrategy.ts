/**
 * Strategy for container-based FFmpeg video transformations.
 *
 * Used when the input file exceeds cdn-cgi/media's size limit and the
 * Worker delegates transformation to a Cloudflare Container running ffmpeg.
 *
 * Unlike VideoStrategy (which produces cdn-cgi URL params), this strategy
 * produces a JSON payload suitable for the container's HTTP transform API.
 * Validation is intentionally relaxed — no cdn-cgi duration cap (60 s)
 * because ffmpeg has no such restriction.
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import {
  TransformationContext,
  TransformationStrategy,
  TransformParams,
} from './TransformationStrategy';
import { VideoConfigurationManager } from '../../config';
import { isValidTime, parseTimeString } from '../../utils/transformationUtils';
import { createCategoryLogger } from '../../utils/logger';
import { ValidationError } from '../../errors';

const logger = createCategoryLogger('ContainerVideoStrategy');

/**
 * Container transform request payload — what gets sent to the container.
 */
export interface ContainerTransformPayload {
  sourceUrl: string;
  width?: number | null;
  height?: number | null;
  mode: string;
  quality: string;
  fit: string;
  duration?: string | null;
  time?: string | null;
  format: string;
}

export class ContainerVideoStrategy implements TransformationStrategy {
  /**
   * Prepare parameters for the container ffmpeg transform.
   *
   * Returns a flat Record that can be JSON-serialised into the container
   * request body. The `sourceUrl` is not set here — it's added by the
   * containerTransformService which has access to the resolved source.
   */
  prepareTransformParams(context: TransformationContext): TransformParams {
    const { options } = context;
    const params: TransformParams = {};

    if (options.width !== null && options.width !== undefined) {
      params.width = options.width;
    }

    if (options.height !== null && options.height !== undefined) {
      params.height = options.height;
    }

    params.mode = options.mode || 'video';
    params.quality = options.quality || 'medium';
    params.fit = options.fit || 'contain';
    params.format = 'mp4';

    if (options.time !== null && options.time !== undefined) {
      params.time = options.time;
    }

    if (options.duration !== null && options.duration !== undefined) {
      params.duration = options.duration;
    }

    logger.debug('Prepared container transform params', {
      width: params.width,
      height: params.height,
      quality: params.quality,
      fit: params.fit,
    });

    return params;
  }

  /**
   * Validate options — similar to VideoStrategy but with relaxed limits:
   * - No 60 s duration cap (ffmpeg can produce any duration)
   * - Same width/height 10-2000 range (practical resize limit)
   */
  async validateOptions(options: VideoTransformOptions): Promise<void> {
    const configManager = VideoConfigurationManager.getInstance();
    const contextObj = { parameters: { mode: 'video', source: 'container', ...options } };

    // Validate width range
    if (options.width !== null && options.width !== undefined) {
      if (options.width < 10 || options.width > 2000) {
        throw ValidationError.invalidDimension('width', options.width, 10, 2000, contextObj);
      }
    }

    // Validate height range
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

    // Validate time format (but no upper bound — large files can have long durations)
    if (options.time !== null && options.time !== undefined) {
      if (!isValidTime(options.time)) {
        throw ValidationError.invalidTimeValue('time', options.time, contextObj);
      }
    }

    // Validate duration format only — no product-limit enforcement
    if (options.duration !== null && options.duration !== undefined) {
      const seconds = parseTimeString(options.duration);
      if (seconds === null) {
        throw ValidationError.invalidTimeValue('duration', options.duration, contextObj);
      }
      // No max duration cap — ffmpeg can handle any duration
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
  }

  /**
   * Update diagnostics with container-specific information.
   */
  updateDiagnostics(context: TransformationContext): void {
    const { diagnosticsInfo, options } = context;

    diagnosticsInfo.transformationType = 'container-ffmpeg';
    diagnosticsInfo.transformSource = 'container';

    if (options.quality) {
      diagnosticsInfo.videoQuality = options.quality;
    }

    if (options.compression) {
      diagnosticsInfo.videoCompression = options.compression;
    }
  }
}
