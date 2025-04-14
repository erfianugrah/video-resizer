# Video Transformation Modes

The video-resizer supports three distinct transformation modes, each designed for specific use cases. This document provides a high-level overview and comparison of these modes.

## Mode Comparison

| Feature | Video Mode | Frame Mode | Spritesheet Mode |
|---------|------------|------------|------------------|
| **Output** | Video file | Single image | Grid of images |
| **Format** | MP4, WebM | JPG, PNG, WebP | JPEG only |
| **Use Case** | Video playback | Thumbnails, posters | Video navigation, previews |
| **Required Parameters** | None | `time` | `width`, `height` |
| **Audio Support** | Yes | No | No |
| **Playback Parameters** | Yes | No | No |
| **Documentation** | Default | [Frame Docs](./frame/README.md) | [Spritesheet Docs](./spritesheet/README.md) |

## Video Mode

The default mode when no `mode` parameter is specified.

```
https://cdn.example.com/video.mp4?width=854&height=480&loop=true
```

**Key Features:**
- Outputs a transformed video file
- Preserves motion and audio
- Supports all transformation parameters
- Allows playback controls (loop, autoplay, muted, preload)
  - The new `loop` parameter enables continuous playback

**Example Use Cases:**
- Responsive video playback
- Device-specific video quality
- Video format conversion
- Timed video clips

[View Video Mode Examples](../configuration/video-configuration.md)

## Frame Mode

Extracts a single frame from the video at a specified time.

```
https://cdn.example.com/video.mp4?mode=frame&time=10s&width=640&height=360
```

**Key Features:**
- Outputs a single still image
- Requires the `time` parameter
- Supports multiple image formats (jpg, png, webp)
- Does not support audio or playback parameters

**Example Use Cases:**
- Video thumbnails and poster images
- Preview images for video galleries
- Key frame extraction
- Creating still images from videos

[View Frame Mode Documentation](./frame/README.md)

## Spritesheet Mode

Generates a grid of thumbnails from the video.

```
https://cdn.example.com/video.mp4?mode=spritesheet&width=800&height=600&duration=30s
```

**Key Features:**
- Outputs a JPEG image containing a grid of thumbnails
- Requires `width` and `height` parameters
- Always outputs JPEG format
- Does not support audio, playback parameters, or quality/compression settings

**Example Use Cases:**
- Video scrubbing interfaces
- Chapter/scene previews
- Visual summaries of videos
- Hover preview thumbnails

[View Spritesheet Mode Documentation](./spritesheet/README.md)

## Visual Comparison

### Video Mode
Outputs a standard streaming video with the specified dimensions and quality.

### Frame Mode
![Frame Mode Example](https://cdn.erfi.dev/white-fang.mp4?mode=frame&time=5s&width=320&height=180)

Extracts a single frame (this example: at 5 seconds).

### Spritesheet Mode
![Spritesheet Mode Example](https://cdn.erfi.dev/white-fang.mp4?mode=spritesheet&width=320&height=180&duration=10s)

Generates a grid of frames across the specified duration (this example: 10 seconds).

## Mode Selection Guide

- **For video playback:** Use the default video mode
- **For a single thumbnail or poster:** Use frame mode
- **For video scrubbing UI elements:** Use spritesheet mode
- **When audio is needed:** Use video mode (the only mode supporting audio)
- **For the smallest file size:** Generally, frame mode produces the smallest files
- **For the most detail in still images:** Use frame mode with PNG format

## Parameter Compatibility

For detailed information about which parameters work with each mode, see the [Parameter Compatibility Matrix](../configuration/parameter-compatibility.md).

## Implementation Details

The transformation modes are implemented using the Strategy pattern. Each mode has its own strategy class that handles mode-specific validation and parameter preparation.

For more information on the implementation, see [Transformation Strategies](../architecture/TRANSFORMATION_STRATEGIES.md).