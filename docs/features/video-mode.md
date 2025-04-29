# Video Mode

Video mode is the default transformation mode in video-resizer, optimizing and transforming video files while preserving motion and audio. This document covers all aspects of using video mode for responsive and adaptive video delivery.

## Overview

When no `mode` parameter is specified, video-resizer processes the video in standard video mode, which allows for:
- Resizing and reformatting videos
- Adjusting quality and compression
- Configuring playback behavior
- Extracting specific video segments
- Adapting videos to different devices and networks

## Basic Usage

To transform a video, simply add query parameters to the video URL:

```
https://cdn.example.com/videos/sample.mp4?width=854&height=480&quality=medium
```

## Parameters

### Dimension Parameters

| Parameter | Description | Values | Default | Example |
|-----------|-------------|--------|---------|---------|
| `width` | Video width in pixels | 10-2000 | Original width | `width=854` |
| `height` | Video height in pixels | 10-2000 | Original height | `height=480` |
| `fit` | How to resize the video | `contain`, `cover`, `scale-down` | `contain` | `fit=cover` |

### Quality Parameters

| Parameter | Description | Values | Default | Example |
|-----------|-------------|--------|---------|---------|
| `quality` | Video quality preset | `low`, `medium`, `high`, `auto` | `auto` | `quality=high` |
| `compression` | Compression level | `low`, `medium`, `high`, `auto` | `auto` | `compression=medium` |
| `format` | Output format | `mp4`, `webm` | Matches input | `format=webm` |
| `derivative` | Preset configuration | See derivatives below | None | `derivative=mobile` |

### Time Range Parameters

| Parameter | Description | Values | Default | Example |
|-----------|-------------|--------|---------|---------|
| `time` | Start timestamp | `0s`-`<end>` | `0s` (start) | `time=30s` |
| `duration` | Clip duration | Positive seconds | Full video | `duration=15s` |

### Playback Parameters

| Parameter | Description | Values | Default | Example |
|-----------|-------------|--------|---------|---------|
| `loop` | Enable video looping | `true`, `false` | `false` | `loop=true` |
| `autoplay` | Auto-start playback | `true`, `false` | `false` | `autoplay=true` |
| `muted` | Mute audio | `true`, `false` | `false` | `muted=true` |
| `preload` | Loading behavior | `none`, `metadata`, `auto` | `auto` | `preload=metadata` |
| `audio` | Include audio track | `true`, `false` | `true` | `audio=false` |

## Video Derivatives

Derivatives are preset configurations that apply multiple parameters at once. Use the `derivative` parameter to apply these presets:

| Derivative | Description | Width | Height | Quality | Compression | Other |
|------------|-------------|-------|--------|---------|-------------|-------|
| `desktop` | High quality for large screens | 1920 | 1080 | high | low | - |
| `tablet` | Medium quality for mid-size | 1280 | 720 | medium | medium | - |
| `mobile` | Optimized for mobile devices | 854 | 640 | low | high | - |
| `animation` | Looping video clip | 480 | 270 | medium | medium | loop=true, audio=false |
| `preview` | Short preview clip | 480 | 270 | low | high | duration=5s, audio=false |

Example:
```
https://cdn.example.com/videos/sample.mp4?derivative=mobile
```

## Responsive Behavior

### Client Hints Integration

Video-resizer can use Client Hints headers to automatically optimize videos for the viewer's device:

| Client Hint | Effect on Video |
|-------------|-----------------|
| `Sec-CH-DPR` | Adjusts effective resolution based on device pixel ratio |
| `Sec-CH-Viewport-Width` | Helps determine appropriate video dimensions |
| `Sec-CH-Viewport-Height` | Helps optimize for vertical/horizontal viewing |
| `Sec-CH-Width` | Used for responsive dimension calculation |

### IMQuery Support

The service supports IMQuery parameters for responsive video delivery:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `imwidth` | Target width for responsive sizing | `imwidth=800` |
| `imheight` | Target height for responsive sizing | `imheight=450` |
| `im-viewwidth` | Viewport width for responsive decisions | `im-viewwidth=1200` |
| `im-density` | Device pixel ratio (similar to DPR) | `im-density=2` |

Example:
```
https://cdn.example.com/videos/sample.mp4?imwidth=800
```

## Advanced Usage Examples

### Basic Responsive Video

```
https://cdn.example.com/videos/sample.mp4?width=854&height=480
```

### Mobile-Optimized Video

```
https://cdn.example.com/videos/sample.mp4?derivative=mobile&muted=true&autoplay=true
```

### Custom Video Clip

```
https://cdn.example.com/videos/sample.mp4?time=45s&duration=30s&width=640&height=360
```

### Looping Animation

```
https://cdn.example.com/videos/sample.mp4?width=480&height=270&loop=true&muted=true&autoplay=true&audio=false
```

### High-Quality Presentation Video

```
https://cdn.example.com/videos/sample.mp4?derivative=desktop&audio=true&preload=auto
```

### Responsive Video with IMQuery

```
https://cdn.example.com/videos/sample.mp4?imwidth=1024&quality=auto
```

## HTML Integration

### Basic Video Tag

```html
<video src="https://cdn.example.com/videos/sample.mp4?width=854&height=480" 
       controls>
</video>
```

### Advanced Video Tag with Attributes

```html
<video width="854" height="480" controls autoplay muted loop>
  <source src="https://cdn.example.com/videos/sample.mp4?quality=high" type="video/mp4">
  Your browser does not support the video tag.
</video>
```

### Responsive Video

```html
<video width="100%" height="auto" controls>
  <source src="https://cdn.example.com/videos/sample.mp4?imwidth=1280" type="video/mp4">
  Your browser does not support the video tag.
</video>
```

### Picture Element for Art Direction

```html
<picture>
  <!-- Mobile -->
  <source media="(max-width: 640px)" 
          srcset="https://cdn.example.com/videos/sample.mp4?derivative=mobile">
  
  <!-- Tablet -->
  <source media="(max-width: 1024px)" 
          srcset="https://cdn.example.com/videos/sample.mp4?derivative=tablet">
  
  <!-- Desktop -->
  <source srcset="https://cdn.example.com/videos/sample.mp4?derivative=desktop">
  
  <!-- Fallback -->
  <video width="100%" height="auto" controls>
    <source src="https://cdn.example.com/videos/sample.mp4" type="video/mp4">
    Your browser does not support the video tag.
  </video>
</picture>
```

## Performance Considerations

### File Size Optimization

To optimize video file size:
- Use appropriate dimensions for the intended display size
- Set quality parameter based on content type (lower for animations, higher for detailed content)
- Consider using the `compression=high` parameter for mobile devices
- Use derivatives to apply tested optimization settings

### Loading Optimization

To optimize video loading:
- Use `preload="metadata"` for videos not immediately visible
- Add `muted` and `autoplay` attributes for background videos
- Consider `audio=false` for purely visual videos to reduce file size
- Use appropriate derivatives for different devices

### Range Request Support

Video-resizer provides optimized support for range requests, which enables:
- Seeking through videos without downloading the entire file
- Fast forward/rewind operations in video players
- Improved playback experience on both first and subsequent views
- Efficient resumption of interrupted downloads

Range requests are supported in the following scenarios:
- First access to a video (via Cache API with transparent fallback)
- KV-cached responses (supported automatically)
- All standard video formats (mp4, webm)

The implementation handles range requests efficiently by:
1. Storing the full video in temporary Cache API storage on first access
2. Using the Cache API's built-in range request support for immediate seeking
3. Preserving all standard range-related HTTP headers
4. Providing multiple fallback mechanisms for reliability

#### Expiration and TTL Handling

Range request support is integrated with the system's expiration handling:
- TTL values for Cache API storage align with KV cache configuration
- Both temporary (Cache API) and persistent (KV) storage respect the same TTL values
- Expiration is determined based on response status, content type, and path-based caching profiles
- TTL values are extracted from Cache-Control headers or determined from configuration

For detailed implementation information, see the [Range Request Support](./range-request-support.md) documentation.

## Troubleshooting

### Common Issues

1. **Video quality is too low**
   - Try increasing `quality` parameter (medium or high)
   - Ensure dimensions are appropriate for display size
   - If using derivatives, try one with higher quality

2. **Video loads slowly**
   - Try reducing dimensions or quality
   - Use `compression=high` parameter
   - Consider using a derivative like `mobile`

3. **Playback issues on mobile**
   - Ensure video has `muted=true` for autoplay to work
   - Check if the device supports the video format
   - Try using `derivative=mobile` for optimized settings

4. **Black borders around video**
   - This is caused by `fit=contain` (default) preserving aspect ratio
   - Use `fit=cover` to fill the frame (may crop sides)
   - Adjust both width and height to match the video's aspect ratio

5. **Video doesn't autoplay**
   - Most browsers require `muted=true` for autoplay
   - Make sure both `autoplay=true` and `muted=true` are set
   - Some mobile browsers restrict autoplay regardless of settings

## Technical Implementation

Video mode is implemented in the `VideoStrategy` class, which:
1. Validates all input parameters
2. Applies derivatives if specified
3. Processes playback parameters
4. Constructs the CDN-CGI transformation URL
5. Handles caching configuration

The video handling pipeline includes several optimizations:

### Caching Architecture
- Initial responses are stored in KV storage using non-blocking waitUntil
- Subsequent requests with identical parameters are served directly from KV
- Storage keys use path and normalized parameters to maximize cache hits

### Range Request Handling
- The system uses a multi-layered approach for range requests:
  1. **Cache API Layer**: Temporarily stores videos in the Cache API for range support
  2. **KV Cache Layer**: Provides persistent caching with range support
  3. **Manual Fallback**: Direct ArrayBuffer manipulation when necessary
- For first-time video access with range requests, the system:
  1. Stores the full video in the Cache API
  2. Uses the Cache API's native range request support for immediate seeking
  3. Simultaneously stores the video in KV cache for persistent storage
  4. Gracefully falls back to manual range handling if Cache API is unavailable

For more implementation details, see:
- `VideoStrategy.ts` - Core transformation logic
- `videoHandler.ts` - Request handling and caching coordination
- `httpUtils.ts` - Range request handling and Cache API integration

## Related Documentation

- [Transformation Modes Overview](./transformation-modes.md) - Comparison of all transformation modes
- [Parameter Compatibility](../configuration/parameter-compatibility.md) - Complete parameter reference
- [Video Configuration](../configuration/video-configuration.md) - Configuration options
- [IMQuery Support](./imquery/README.md) - Details on responsive parameters

## Last Updated

*April 29, 2025*