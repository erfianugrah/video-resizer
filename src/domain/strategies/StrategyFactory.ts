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
import { debug } from '../../utils/loggerUtils';

/**
 * Create a strategy for the given transformation options
 */
export function createTransformationStrategy(options: VideoTransformOptions): TransformationStrategy {
  // Determine which strategy to use based on the mode
  const mode = options.mode || 'video'; // Default to video mode
  
  debug('StrategyFactory', `Creating transformation strategy for mode: ${mode}`);
  
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
