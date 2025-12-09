# Video Mode

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [Video Transformation Parameters](#video-transformation-parameters)
- [Playback Parameters](#playback-parameters)
- [Quality Settings](#quality-settings)
- [Video Derivatives](#video-derivatives)
- [Responsive Behavior](#responsive-behavior)
- [Format Options](#format-options)
- [Example URLs](#example-urls)
- [Technical Limitations](#technical-limitations)
- [Best Practices](#best-practices)
- [Advanced Usage](#advanced-usage)

## Overview

Video mode is the default transformation mode in the Video Resizer. It processes complete videos, preserving motion and audio while allowing for resizing, compression adjustments, and format conversion. This mode outputs optimized MP4 video files with H.264 video and AAC audio.

```
https://cdn.example.com/videos/sample.mp4?width=720&height=480&quality=high
```

In video mode, you can:
- Resize videos to specific dimensions
- Control quality and compression levels
- Apply different fit modes (contain, cover, etc.)
- Configure playback behavior (loop, autoplay, muted, preload)
- Convert between supported formats

## Video Transformation Parameters

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `width` | number | null | Width in pixels (10-2000) | `width=720` |
| `height` | number | null | Height in pixels (10-2000) | `height=480` |
| `fit` | string | 'contain' | Resize behavior | `fit=cover` |
| `format` | string | 'mp4' | Output format (video only; use `mode=audio`/`format=m4a` for audio) | `format=webm` |
| `quality` | string | null | Quality level | `quality=high` |
| `compression` | string | null | Compression level | `compression=low` |
| `bitrate` | number | null | Target bitrate (bps) | `bitrate=3000000` |
| `time` | string | null | Time position for frame extraction | `time=10s` |
| `duration` | string | null | Duration of video segment (1–300s; if omitted, full length) | `duration=30s` |

### Fit Modes

The `fit` parameter controls how the video fits within the specified dimensions:

| Value | Description | Use Case |
|-------|-------------|----------|
| `contain` | Maintains aspect ratio, fits entirely within dimensions | Preserving full content |
| `cover` | Maintains aspect ratio, fills dimensions (may crop) | Filling UI containers |
| `scale-down` | Like contain, but never scales up smaller videos | Avoiding quality loss |
| `pad` | Like contain, adds padding to fill dimensions | Consistent dimensions |
| `crop` | Centers and crops to exact dimensions | Exact sizing |

## Playback Parameters

Video mode supports several parameters that control video playback behavior:

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `loop` | boolean | false | Whether the video should loop | `loop=true` |
| `autoplay` | boolean | false | Whether video should autoplay | `autoplay=true` |
| `muted` | boolean | false | Whether audio should be muted | `muted=true` |
| `preload` | string | 'auto' | Preload behavior | `preload=metadata` |
| `audio` | boolean | true | Whether to include audio | `audio=false` |

> Note: These parameters only apply to video mode and will cause validation errors if used with frame or spritesheet modes.

> **Important**: When using `autoplay=true` with audio, you must also set `muted=true` for browser compatibility. If you only need audio, use `mode=audio` (or `format=m4a`, which auto-switches to audio mode).

### Preload Options

The `preload` parameter accepts the following values:

| Value | Description | Use Case |
|-------|-------------|----------|
| `none` | Doesn't preload any data | Bandwidth conservation |
| `metadata` | Preloads metadata only | Quick preview loading |
| `auto` | Browser decides what to preload | General usage |

## Quality Settings

The `quality` parameter provides presets for video quality:

| Value | Description | Approximate Bitrate |
|-------|-------------|---------------------|
| `low` | Low quality, high compression | ~500 Kbps |
| `medium` | Balanced quality and size | ~1.5 Mbps |
| `high` | High quality, less compression | ~3 Mbps |
| `auto` | Adapts based on client capabilities | Varies |

The `compression` parameter provides more granular control:

| Value | Description | Use Case |
|-------|-------------|----------|
| `low` | Minimal compression | High-quality preservation |
| `medium` | Balanced compression | General usage |
| `high` | Strong compression | Bandwidth-constrained scenarios |
| `auto` | Adapts based on client capabilities | Responsive delivery |

## Video Derivatives

Derivatives are preset configurations optimized for specific use cases:

| Derivative | Width | Height | Quality | Other Settings | Use Case |
|------------|-------|--------|---------|----------------|----------|
| `high` | 1920 | 1080 | high | compression=low | Desktop, high-bandwidth |
| `medium` | 1280 | 720 | medium | compression=medium | Default for most devices |
| `low` | 854 | 480 | low | compression=high | Mobile, low-bandwidth |
| `mobile` | 640 | 360 | low | compression=high | Small screens |
| `thumbnail` | 640 | 360 | low | compression=high, time=5s, mode=frame | Video previews |
| `preview` | 320 | 180 | low | compression=high, duration=5s | Hover previews |
| `animation` | 320 | 180 | low | compression=high, duration=3s, loop=true | Animated previews |

To use a derivative:

```
https://cdn.example.com/videos/sample.mp4?derivative=mobile
```

## Responsive Behavior

Video mode automatically adapts to client capabilities through several mechanisms:

1. **Client Hints Detection**:
   - Uses client hint headers to detect device capabilities
   - Automatically adapts quality based on device type
   - Adjusts dimensions based on viewport size

2. **IMQuery Integration**:
   - Supports responsive width parameters (`imwidth`, `im-viewwidth`)
   - Maps responsive dimensions to appropriate derivatives
   - Example: `https://cdn.example.com/sample.mp4?imwidth=400&im-viewwidth=1200`

3. **Network Quality Estimation**:
   - Estimates client network capabilities
   - Adjusts compression for slower connections
   - Enables quality fallbacks

## Format Options

The `format` parameter controls the output video format:

| Value | Description | Support | Use Case |
|-------|-------------|---------|----------|
| `mp4` | MP4 with H.264/AAC | Universal | General compatibility |
| `webm` | WebM format | Most modern browsers | Better compression |

## Example URLs

### Basic Transformation

```
https://cdn.example.com/videos/sample.mp4?width=720&height=480
```

### Quality Control

```
https://cdn.example.com/videos/sample.mp4?quality=high&compression=low
```

### Responsive Transformation

```
https://cdn.example.com/videos/sample.mp4?imwidth=400&im-viewwidth=1200
```

### Playback Configuration

```
https://cdn.example.com/videos/sample.mp4?loop=true&autoplay=true&muted=true
```

### Combined Parameters

```
https://cdn.example.com/videos/sample.mp4?width=1280&height=720&quality=high&fit=cover&loop=true&muted=true
```

### Using Derivatives

```
https://cdn.example.com/videos/sample.mp4?derivative=mobile
```

## Technical Limitations

- **Input Video Size**: Maximum input video size is 40MB without KV chunking (can be larger with KV chunking enabled)
- **Dimensions**: Width and height must be between 10-2000 pixels
- **Input Format**: Cloudflare Media Transformation primarily supports MP4 files with H.264 video and AAC/MP3 audio
- **Processing Time**: Initial transformations may take 500-2000ms (subsequent requests use cached versions)
- **Duration**: Long videos may have higher processing times and resource usage
- **Duration Limits**: Video durations can be limited by configuration; the system will automatically adjust durations to fit within configured limits
- **Autoplay Limitations**: Browsers require videos with autoplay to be muted unless user interaction has occurred

## Best Practices

1. **Use Derivatives**:
   - Derivatives provide optimized presets for common use cases
   - More consistent experience across videos
   - Better cache efficiency (many URLs map to fewer transformations)

2. **Enable Responsive Features**:
   - Use IMQuery parameters for responsive sizing
   - Allow client detection to optimize for device
   - Consider the target device when selecting quality

3. **Optimize for Caching**:
   - Use consistent parameters to improve cache hit rates
   - Consider cache TTL settings in path patterns
   - Avoid unnecessary parameter variations

4. **Performance Considerations**:
   - For initial page load, consider using the frame mode for thumbnails
   - Preload only metadata for non-primary videos
   - Use muted for autoplay compatibility on mobile

5. **Duration Best Practices**:
   - Keep durations reasonable (generally under 5 minutes) for optimal performance
   - For longer videos, consider breaking into segments or using range requests
   - The system will automatically adjust durations exceeding configured limits

6. **Autoplay Compatibility**:
   - Always set `muted=true` when using `autoplay=true` to ensure compatibility
   - If audio is required, consider a click-to-play approach instead of autoplay
   - Testing across different browsers is recommended for autoplay functionality

## Advanced Usage

### Combining with Other Features

Video mode works well with other Video Resizer features:

1. **Cache Versioning**:
   - Control cache invalidation with version parameters
   - Example: `https://cdn.example.com/videos/sample.mp4?width=720&cache-version=2`

2. **Debug Mode**:
   - Add `debug=view` to see transformation details
   - Example: `https://cdn.example.com/videos/sample.mp4?width=720&debug=view`

3. **Range Request Support**:
   - Video mode supports range requests for seeking
   - No special parameters needed, handled automatically
   - Works with both regular and chunked KV storage

4. **KV Chunking**:
   - Larger videos are automatically stored in chunks in KV
   - Supports videos exceeding the 25MB KV size limit
   - Maintains efficient range request support
   - See [KV Chunking documentation](./kv-chunking.md) for details

### Custom Transformations

For advanced use cases, you can combine parameters for custom transformations:

```
https://cdn.example.com/videos/sample.mp4?width=1280&height=720&quality=high&compression=low&fit=cover&format=webm&loop=true&muted=true&autoplay=true&duration=30s
```

This transforms the video to 1280x720, high quality with low compression, using cover fit, outputs in WebM format, sets it to loop and be muted with autoplay, and limits duration to 30 seconds.

### Duration Format

The `duration` parameter accepts the following formats:

- Seconds: `10s`, `30s`, `60s`
- Minutes: `1m`, `5m`, `30m`
- Combined (in code implementation): `1m30s`

The system will apply configured limits to duration values if they exceed the maximum allowed duration. This automatic adjustment prevents errors and ensures consistent behavior.

Example with duration:
```
https://cdn.example.com/videos/sample.mp4?width=640&height=360&duration=1m30s
```

This will extract a 1 minute and 30 second clip from the start of the video. If the configured maximum duration is less than this (e.g., 1 minute), the system will automatically adjust to use the maximum allowed duration.
