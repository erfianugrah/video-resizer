# Transformation Strategies

This document explains the Strategy pattern implementation used for video transformation modes in the video-resizer.

## Overview

The video-resizer uses the Strategy pattern to handle different transformation modes (video, frame, spritesheet) in a maintainable and extensible way. Each mode has its own strategy implementation that encapsulates the mode-specific logic and validation.

## Strategy Pattern

The Strategy pattern is implemented with the following key components:

1. **TransformationStrategy Interface**: Defines the common interface for all transformation strategies
2. **Concrete Strategy Classes**: Implement mode-specific logic
3. **StrategyFactory**: Creates and returns the appropriate strategy based on the mode
4. **Command Class**: Uses the strategy to fulfill the transformation request

## TransformationStrategy Interface

The `TransformationStrategy` interface defines three key methods that all strategies must implement:

```typescript
export interface TransformationStrategy {
  /**
   * Prepare parameters for this specific transformation strategy
   * @param context The transformation context
   * @returns The prepared CDN parameters
   */
  prepareTransformParams(context: TransformationContext): TransformParams;
  
  /**
   * Validate the options for this strategy
   * @param options The transformation options
   * @throws Error if options are invalid
   */
  validateOptions(options: VideoTransformOptions): void | Promise<void>;
  
  /**
   * Update diagnostics information with strategy-specific details
   * @param context The transformation context
   */
  updateDiagnostics(context: TransformationContext): void;
}
```

## Concrete Strategy Implementations

### VideoStrategy

Handles the default video mode:
- Prepares parameters for video streaming
- Validates video-specific parameters
- Allows all playback parameters (loop, autoplay, muted, preload)
- Supports all transformation parameters

### FrameStrategy

Handles the frame extraction mode:
- Prepares parameters for single frame extraction
- Requires the `time` parameter
- Validates frame-specific parameters
- Rejects video-specific parameters like playback controls
- Supports image format selection (jpg, png, webp)

### SpritesheetStrategy

Handles the spritesheet generation mode:
- Prepares parameters for spritesheet generation
- Requires `width` and `height` parameters
- Validates spritesheet-specific parameters
- Rejects video-specific parameters and formats
- Adds warnings for extreme aspect ratios or long durations

## Strategy Factory

The `StrategyFactory` class is responsible for creating the appropriate strategy:

```typescript
export class StrategyFactory {
  /**
   * Create a transformation strategy based on the mode
   * @param mode The transformation mode
   * @returns The appropriate strategy
   */
  static createStrategy(mode: string): TransformationStrategy {
    switch (mode) {
      case 'frame':
        return new FrameStrategy();
      case 'spritesheet':
        return new SpritesheetStrategy();
      case 'video':
      default:
        return new VideoStrategy();
    }
  }
}
```

## Command Integration

The `TransformVideoCommand` class uses the Strategy pattern through the following process:

1. Determine the transformation mode from options
2. Get the appropriate strategy from the factory
3. Validate options using the strategy
4. Prepare parameters using the strategy
5. Update diagnostics using the strategy
6. Execute the transformation

### Example Flow

```typescript
// Inside TransformVideoCommand
async execute(request: Request): Promise<Response> {
  // ... other code ...
  
  // Get transformation options from the request
  const options = this.parseOptions(url);
  
  // Determine the mode and get the appropriate strategy
  const mode = options.mode || 'video';
  const strategy = StrategyFactory.createStrategy(mode);
  
  // Validate the options using the strategy
  await strategy.validateOptions(options);
  
  // Prepare parameters using the strategy
  const transformParams = strategy.prepareTransformParams({
    url,
    options,
    pathPattern,
    diagnosticsInfo
  });
  
  // Update diagnostics
  strategy.updateDiagnostics({
    url,
    options,
    pathPattern,
    diagnosticsInfo
  });
  
  // Use the parameters to perform the transformation
  // ... other code ...
}
```

## Benefits of the Strategy Pattern

The strategy pattern provides several key benefits in this architecture:

1. **Separation of Concerns**: Each strategy handles only its specific mode
2. **Encapsulation**: Mode-specific logic is contained within its strategy
3. **Extensibility**: New modes can be added by creating new strategies
4. **Maintainability**: Changes to one mode don't affect others
5. **Testability**: Each strategy can be tested in isolation

## Adding a New Transformation Mode

To add a new transformation mode:

1. Create a new strategy class implementing `TransformationStrategy`
2. Implement the required methods for the new mode
3. Add the new mode to the `StrategyFactory`
4. Update configuration to include the new mode
5. Add validation for new parameters

### Example: Adding a GIF Mode

To add a hypothetical GIF mode:

```typescript
export class GifStrategy implements TransformationStrategy {
  prepareTransformParams(context: TransformationContext): TransformParams {
    // Prepare GIF-specific parameters
  }
  
  validateOptions(options: VideoTransformOptions): void {
    // Validate GIF-specific options
  }
  
  updateDiagnostics(context: TransformationContext): void {
    // Update diagnostics with GIF-specific information
  }
}

// Update factory
export class StrategyFactory {
  static createStrategy(mode: string): TransformationStrategy {
    switch (mode) {
      case 'gif':
        return new GifStrategy();
      // ... other cases ...
    }
  }
}
```

## Transformation Context

The transformation context is a crucial part of the strategy pattern, passing all needed information between components:

```typescript
export interface TransformationContext {
  request: Request;
  options: VideoTransformOptions;
  pathPattern: PathPattern;
  url: URL;
  path: string;
  diagnosticsInfo: DiagnosticsInfo;
  env?: { 
    ASSETS?: { 
      fetch: (request: Request) => Promise<Response> 
    } 
  };
}
```

This context allows strategies to access all necessary information while maintaining a clean interface.