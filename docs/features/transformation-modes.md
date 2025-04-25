# Video Transformation Modes

The video-resizer supports three distinct transformation modes, each designed for specific use cases. This document provides a comprehensive overview and comparison of these modes to help you choose the right one for your needs.

## Mode Comparison Matrix

| Feature | Video Mode | Frame Mode | Spritesheet Mode |
|---------|------------|------------|------------------|
| **Output Type** | Video file | Single image | Grid of images |
| **Formats Available** | MP4, WebM | JPG, PNG, WebP | JPEG only |
| **Primary Use Case** | Video playback | Thumbnails, posters | Video navigation, previews |
| **Required Parameters** | None | `time` | `width`, `height` |
| **Optional Parameters** | `width`, `height`, `quality`, `compression`, etc. | `width`, `height`, `format`, `quality`, etc. | `time`, `duration`, `fit` |
| **Audio Support** | ✅ Yes | ❌ No | ❌ No |
| **Playback Parameters** | ✅ Yes (loop, autoplay, muted, preload) | ❌ No | ❌ No |
| **Format Selection** | ✅ Yes | ✅ Yes | ❌ No (JPEG only) |
| **Quality Settings** | ✅ Yes | ✅ Yes | ❌ No |
| **Compression Control** | ✅ Yes | ✅ Yes | ❌ No |
| **IMQuery Support** | ✅ Yes | ✅ Yes | ❌ No |
| **Client Hint Detection** | ✅ Yes | ✅ Yes | ❌ No |
| **KV Caching** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Approximate File Size** | 🔄 Largest | 🔄 Smallest | 🔄 Medium |
| **Processing Speed** | 🔄 Slowest | 🔄 Fastest | 🔄 Medium |
| **Documentation** | [Video Mode](./video-mode.md) | [Frame Docs](./frame/README.md) | [Spritesheet Docs](./spritesheet/README.md) |

## Video Mode

The default mode when no `mode` parameter is specified. Video mode transforms the original video while preserving motion and audio.

```
https://cdn.example.com/sample.mp4?width=854&height=480&quality=medium&loop=true
```

### Key Features

- **Full Video Transformation**: Outputs a complete video file with motion and audio
- **Format Control**: Can adjust video format, quality, and compression
- **Playback Control**: Supports HTML5 video attributes like loop, autoplay, muted, and preload
- **Time Range Selection**: Can extract specific segments using time and duration parameters
- **Device Adaptation**: Automatically adjusts quality based on client device capabilities
- **Derivative Support**: Pre-configured transformation presets (mobile, tablet, desktop, etc.)

### Parameters

| Parameter | Description | Example | Default |
|-----------|-------------|---------|---------|
| `width` | Video width in pixels | `width=854` | Original width |
| `height` | Video height in pixels | `height=480` | Original height |
| `quality` | Video quality preset | `quality=medium` | `auto` |
| `compression` | Compression level | `compression=high` | `auto` |
| `loop` | Enable video looping | `loop=true` | `false` |
| `autoplay` | Start playback automatically | `autoplay=true` | `false` |
| `muted` | Mute audio | `muted=true` | `false` |
| `preload` | Loading behavior | `preload=metadata` | `auto` |
| `time` | Start timestamp | `time=30s` | `0s` |
| `duration` | Clip duration | `duration=10s` | Full video |
| `fit` | Resize method | `fit=contain` | `contain` |
| `derivative` | Preset configuration | `derivative=mobile` | None |

### Example Use Cases

- **Responsive Videos**: Adapt video dimensions to different device sizes
- **Quality Optimization**: Serve appropriate quality based on network conditions
- **Format Conversion**: Convert between different video formats
- **Clips and Previews**: Extract specific segments from longer videos
- **Optimized Playback**: Configure autoplay, looping, and preloading behavior

### Example URLs

**Basic Resizing**:
```
https://cdn.example.com/sample.mp4?width=854&height=480
```

**Mobile Optimization**:
```
https://cdn.example.com/sample.mp4?derivative=mobile&muted=true&autoplay=true
```

**Video Clip**:
```
https://cdn.example.com/sample.mp4?time=30s&duration=15s&width=640&height=360
```

**Looping Animation**:
```
https://cdn.example.com/sample.mp4?width=480&height=270&loop=true&muted=true&autoplay=true
```

[View Detailed Video Mode Documentation](./video-mode.md)

## Frame Mode

Extracts a single still image frame from the video at a specified timestamp. Ideal for thumbnails, poster images, and previews.

```
https://cdn.example.com/sample.mp4?mode=frame&time=10s&width=640&height=360&format=webp
```

### Key Features

- **Single Frame Extraction**: Outputs one still image from the specified timestamp
- **Multiple Image Formats**: Supports JPG (default), PNG, and WebP formats
- **High Quality Options**: PNG format provides lossless quality for detailed frames
- **Small File Size**: Generally produces the smallest file size of all modes
- **Fast Processing**: Typically the fastest transformation to process

### Parameters

| Parameter | Description | Example | Default |
|-----------|-------------|---------|---------|
| `mode` | Must be set to "frame" | `mode=frame` | Required |
| `time` | Timestamp to extract frame from | `time=15s` | Required |
| `width` | Image width in pixels | `width=640` | Original width |
| `height` | Image height in pixels | `height=360` | Original height |
| `format` | Image format | `format=png` | `jpg` |
| `quality` | Image quality (for jpg/webp) | `quality=high` | `auto` |
| `fit` | Resize method | `fit=cover` | `contain` |

### Example Use Cases

- **Video Thumbnails**: Generate preview images for video galleries
- **Poster Images**: Create initial images for video players
- **Key Frame Extraction**: Capture specific moments from videos
- **Social Media Previews**: Generate sharing images from video content
- **Chapter Images**: Create navigation thumbnails for video chapters

### Example URLs

**Basic Thumbnail**:
```
https://cdn.example.com/sample.mp4?mode=frame&time=5s
```

**High-Quality PNG Frame**:
```
https://cdn.example.com/sample.mp4?mode=frame&time=15s&format=png&width=1280&height=720
```

**WebP Format with Cover Fit**:
```
https://cdn.example.com/sample.mp4?mode=frame&time=10s&format=webp&width=400&height=300&fit=cover
```

**Exact Timestamp Frame**:
```
https://cdn.example.com/sample.mp4?mode=frame&time=42.5s&width=640&height=360
```

[View Detailed Frame Mode Documentation](./frame/README.md)

## Spritesheet Mode

Generates a grid of thumbnails from the video at regular intervals, combined into a single JPEG image. Perfect for video scrubbing interfaces and visual summaries.

```
https://cdn.example.com/sample.mp4?mode=spritesheet&width=800&height=600&duration=30s
```

### Key Features

- **Thumbnail Grid**: Outputs multiple frames arranged in a grid pattern
- **Visual Timeline**: Shows the video progression across time
- **Custom Time Range**: Can specify starting point and duration
- **Automatic Grid Sizing**: Grid dimensions automatically determined based on video length
- **Fixed Output Format**: Always outputs as JPEG format

### Parameters

| Parameter | Description | Example | Default |
|-----------|-------------|---------|---------|
| `mode` | Must be set to "spritesheet" | `mode=spritesheet` | Required |
| `width` | Total spritesheet width | `width=800` | Required |
| `height` | Total spritesheet height | `height=600` | Required |
| `time` | Starting timestamp | `time=30s` | `0s` |
| `duration` | Duration to include | `duration=60s` | `10s` |
| `fit` | How thumbnails fit in grid cells | `fit=cover` | `contain` |

### Example Use Cases

- **Video Scrubbing UIs**: Create hover preview thumbnails for video players
- **Visual Summaries**: Generate visual overviews of video content
- **Chapter Navigation**: Show key moments for chapter selection
- **Content Previews**: Display video content progression in galleries
- **Animation References**: Create visual references for animations

### Example URLs

**Basic Spritesheet**:
```
https://cdn.example.com/sample.mp4?mode=spritesheet&width=800&height=600
```

**Custom Time Range**:
```
https://cdn.example.com/sample.mp4?mode=spritesheet&width=800&height=600&time=30s&duration=60s
```

**Cover Fit Spritesheet**:
```
https://cdn.example.com/sample.mp4?mode=spritesheet&width=800&height=600&fit=cover
```

[View Detailed Spritesheet Mode Documentation](./spritesheet/README.md)

## Visual Comparison

<table>
<tr>
<th>Video Mode</th>
<th>Frame Mode</th>
<th>Spritesheet Mode</th>
</tr>
<tr>
<td>
<video width="320" height="180" controls>
  <source src="https://cdn.erfi.dev/white-fang.mp4?width=320&height=180" type="video/mp4">
</video>
<p><em>Requires browser video playback</em></p>
</td>
<td>
<img src="https://cdn.erfi.dev/white-fang.mp4?mode=frame&time=5s&width=320&height=180" alt="Frame Mode Example" width="320" height="180">
</td>
<td>
<img src="https://cdn.erfi.dev/white-fang.mp4?mode=spritesheet&width=320&height=180&duration=10s" alt="Spritesheet Mode Example" width="320" height="180">
</td>
</tr>
<tr>
<td>Full video with motion and audio</td>
<td>Single frame at 5 seconds</td>
<td>Grid of frames across 10 seconds</td>
</tr>
</table>

## Mode Selection Guide

### Choose Video Mode When:
- You need to preserve motion and audio
- You want responsive video playback
- You need format adaptation for different devices
- You need to support HTML5 video attributes like loop and autoplay
- You want to extract specific time segments while maintaining playback

### Choose Frame Mode When:
- You need a single still image from the video
- You want the smallest possible file size
- You need high-quality still images (especially with PNG format)
- You're creating thumbnails, posters, or preview images
- You want the fastest transformation processing time

### Choose Spritesheet Mode When:
- You want to show multiple frames from the video at once
- You're building a video scrubbing interface
- You need a visual timeline of the video content
- You're creating chapter navigation thumbnails
- You want to provide a visual summary of video content

## Parameter Compatibility

The following table shows which parameters work with each transformation mode:

| Parameter | Video Mode | Frame Mode | Spritesheet Mode |
|-----------|------------|------------|------------------|
| `width` | ✅ Yes | ✅ Yes | ✅ Yes (Required) |
| `height` | ✅ Yes | ✅ Yes | ✅ Yes (Required) |
| `time` | ✅ Yes | ✅ Yes (Required) | ✅ Yes |
| `duration` | ✅ Yes | ❌ No | ✅ Yes |
| `fit` | ✅ Yes | ✅ Yes | ✅ Yes |
| `quality` | ✅ Yes | ✅ Yes | ❌ No |
| `compression` | ✅ Yes | ✅ Yes | ❌ No |
| `format` | ✅ Yes | ✅ Yes | ❌ No (JPEG only) |
| `loop` | ✅ Yes | ❌ No | ❌ No |
| `autoplay` | ✅ Yes | ❌ No | ❌ No |
| `muted` | ✅ Yes | ❌ No | ❌ No |
| `preload` | ✅ Yes | ❌ No | ❌ No |
| `derivative` | ✅ Yes | ✅ Yes | ❌ No |
| `imwidth` | ✅ Yes | ✅ Yes | ❌ No |
| `audio` | ✅ Yes | ❌ No | ❌ No |

For complete parameter details, see the [Parameter Compatibility Matrix](../configuration/parameter-compatibility.md).

## Technical Implementation

The transformation modes are implemented using the Strategy pattern, which allows for specialized handling of different modes while maintaining a consistent interface:

1. `TransformationStrategy` - Base interface defining common operations
2. `VideoStrategy` - Handles standard video transformations
3. `FrameStrategy` - Specialized for extracting still frames
4. `SpritesheetStrategy` - Manages spritesheet generation

Each strategy implements mode-specific validation and parameter preparation. When a request is received, the `StrategyFactory` determines the appropriate strategy based on the request parameters.

For more details on the implementation, see [Transformation Strategies](../architecture/TRANSFORMATION_STRATEGIES.md).

## Performance Considerations

| Mode | File Size | Processing Time | Cache Efficiency |
|------|-----------|-----------------|------------------|
| Video | Largest | Slowest | Good with derivatives |
| Frame | Smallest | Fastest | Excellent |
| Spritesheet | Medium | Medium | Good |

- **Video Mode** typically produces the largest files and requires the most processing time, but offers the most features.
- **Frame Mode** is the most efficient in terms of both file size and processing speed.
- **Spritesheet Mode** offers a good balance between comprehensive visual information and efficiency.

For optimal performance, choose the mode that provides exactly what you need without excess features.

## Last Updated

*April 25, 2025*