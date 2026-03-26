/**
 * Factory for creating transformation strategies based on transformation mode
 * Implements the Factory pattern
 */
import { VideoTransformOptions } from '../commands/TransformVideoCommand';
import { TransformationStrategy } from './TransformationStrategy';
import { VideoStrategy } from './VideoStrategy';
import { FrameStrategy } from './FrameStrategy';
import { SpritesheetStrategy } from './SpritesheetStrategy';
import { AudioStrategy } from './AudioStrategy';
import { ContainerVideoStrategy } from './ContainerVideoStrategy';
import { createCategoryLogger } from '../../utils/logger';

const logger = createCategoryLogger('StrategyFactory');

/**
 * Create a strategy for the given transformation options
 */
export function createTransformationStrategy(
  options: VideoTransformOptions
): TransformationStrategy {
  // Determine which strategy to use based on the mode
  const mode = options.mode || 'video'; // Default to video mode

  logger.debug(`Creating transformation strategy for mode: ${mode}`);

  switch (mode) {
    case 'frame':
      return new FrameStrategy();
    case 'spritesheet':
      return new SpritesheetStrategy();
    case 'audio':
      return new AudioStrategy();
    case 'video':
    default:
      return new VideoStrategy();
  }
}

/**
 * Create a container-based strategy for oversized video files.
 * This is called explicitly by the handler when the input exceeds
 * cdn-cgi/media limits — it bypasses the normal mode-based routing.
 */
export function createContainerStrategy(options: VideoTransformOptions): TransformationStrategy {
  const mode = options.mode || 'video';

  logger.debug(`Creating container strategy for mode: ${mode}`);

  // For now, only video mode is supported by the container path.
  // Audio/frame extraction for oversized files can be added later.
  return new ContainerVideoStrategy();
}
