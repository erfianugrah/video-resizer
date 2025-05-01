# Frame Mode

*Last Updated: May 1, 2025*

## Table of Contents

- [Overview](#overview)
- [Frame Extraction Parameters](#frame-extraction-parameters)
- [Output Format Options](#output-format-options)
- [Image Processing Parameters](#image-processing-parameters)
- [Example URLs](#example-urls)
- [Frame Selection Techniques](#frame-selection-techniques)
- [Video Derivatives with Frame Mode](#video-derivatives-with-frame-mode)
- [Responsive Behavior](#responsive-behavior)
- [Common Use Cases](#common-use-cases)
- [Performance Considerations](#performance-considerations)
- [Technical Limitations](#technical-limitations)
- [Best Practices](#best-practices)

## Overview

Frame mode is a transformation mode in the Video Resizer that extracts a single still image from a specific timestamp in a video. This mode is ideal for generating thumbnails, poster images, and preview frames from video content.

```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=30s
```

In frame mode, you can:
- Extract a specific frame using timestamp
- Resize the output image
- Convert to different image formats (JPG, PNG, WebP)
- Apply various image processing parameters
- Generate responsive thumbnails for different devices

## Frame Extraction Parameters

| Parameter | Type | Required | Default | Description | Example |
|-----------|------|----------|---------|-------------|---------|
| `mode` | string | Yes | - | Must be set to "frame" | `mode=frame` |
| `time` | string | Yes | - | Timestamp for frame extraction | `time=30s` |

### Time Parameter Format

The `time` parameter specifies which frame to extract and supports several formats:

| Format | Description | Example |
|--------|-------------|---------|
| Seconds | Simple seconds value | `time=30s` |
| Minutes:Seconds | MM:SS format | `time=2:30` |
| Hours:Minutes:Seconds | HH:MM:SS format | `time=1:15:30` |
| Percentage | Percentage of video duration | `time=50%` |
| Frames | Frame number (requires FPS knowledge) | `time=750f` |

The maximum timestamp is limited by the video duration. If you specify a timestamp beyond the video's end, the last frame will be returned.

## Output Format Options

The `format` parameter controls the output image format:

| Value | Description | Advantages | Use Case |
|-------|-------------|------------|----------|
| `jpg` | JPEG format | Small file size, good for photos | Default thumbnails |
| `png` | PNG format | Lossless, supports transparency | UI elements, transparency needed |
| `webp` | WebP format | Best compression, modern support | Performance-focused sites |
| `avif` | AVIF format | Smallest file size, newer format | Next-gen image optimization |

Default is `jpg` if not specified.

## Image Processing Parameters

Frame mode supports standard image processing parameters:

| Parameter | Type | Default | Description | Example |
|-----------|------|---------|-------------|---------|
| `width` | number | null | Width in pixels (10-2000) | `width=800` |
| `height` | number | null | Height in pixels (10-2000) | `height=450` |
| `fit` | string | 'contain' | Resize behavior | `fit=cover` |
| `quality` | string | 'medium' | Image quality level | `quality=high` |
| `sharpen` | number | 0 | Sharpening level (0-10) | `sharpen=5` |
| `blur` | number | 0 | Blur radius (0-250) | `blur=10` |
| `brightness` | number | 0 | Brightness adjustment (-100 to 100) | `brightness=15` |
| `contrast` | number | 0 | Contrast adjustment (-100 to 100) | `contrast=10` |
| `saturation` | number | 0 | Saturation adjustment (-100 to 100) | `saturation=20` |

### Fit Modes

The `fit` parameter controls how the image fits within the specified dimensions:

| Value | Description | Use Case |
|-------|-------------|----------|
| `contain` | Preserves aspect ratio, fits entirely in dimensions | Default, preserves full image |
| `cover` | Fills dimensions while preserving aspect ratio (may crop) | Consistent thumbnail size |
| `scale-down` | Like contain, but never enlarges | Prevents quality loss on small videos |
| `crop` | Centers and crops to exact dimensions | Exact size requirements |

## Example URLs

### Basic Frame Extraction

```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=30s
```

### Formatted Thumbnail

```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=30s&width=800&height=450&fit=cover&format=webp&quality=high
```

### Percentage-Based Frame Extraction

```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=25%&width=800&height=450
```

### Advanced Image Processing

```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=1:15&width=800&height=450&format=webp&quality=high&sharpen=5&contrast=10&saturation=15
```

## Frame Selection Techniques

Selecting the right frame is crucial for effective thumbnails. Here are some techniques:

### 1. Specific Time Points

For videos with known structure, use precise timestamps:
```
https://cdn.example.com/videos/interview.mp4?mode=frame&time=15s
```

### 2. Percentage-Based

For videos of varying length, use percentage to target a relative position:
```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=25%
```

### 3. Multiple Frame Extraction

For selecting the best thumbnail, extract multiple frames and choose:
```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=10%
https://cdn.example.com/videos/sample.mp4?mode=frame&time=25%
https://cdn.example.com/videos/sample.mp4?mode=frame&time=50%
```

### 4. Scene Detection Approach

For videos with distinct scenes, target times just after scene changes (often requires prior analysis).

## Video Derivatives with Frame Mode

Frame mode works with the derivative system for consistent thumbnails:

| Derivative | Frame-Specific Settings | Use Case |
|------------|-------------------------|----------|
| `thumbnail` | mode=frame, time=5s, format=jpg | Standard video thumbnails |
| `poster` | mode=frame, time=0s, quality=high | Video poster images |
| `preview` | mode=frame, time=25%, sharpen=5 | Enhanced preview images |

Using derivatives:
```
https://cdn.example.com/videos/sample.mp4?derivative=thumbnail
```

## Responsive Behavior

Frame mode supports responsive image generation through:

1. **IMQuery Integration**:
   - Supports responsive width parameters (`imwidth`, `im-viewwidth`)
   - Example: `https://cdn.example.com/sample.mp4?mode=frame&time=30s&imwidth=400&im-viewwidth=1200`

2. **Client Hints Detection**:
   - Uses client hint headers to detect device capabilities
   - Automatically adjusts image size and quality
   - Works best with the `CH-Viewport-Width` and `DPR` headers

3. **Derivative Mapping**:
   - Maps responsive dimensions to appropriate derivatives
   - Provides consistent thumbnail styles across devices

## Common Use Cases

### Video Thumbnails

Generate standard thumbnails for video listings:
```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=30s&width=320&height=180&fit=cover
```

### Video Poster Images

Create high-quality poster images for video players:
```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=5s&width=1280&height=720&quality=high
```

### Preview Images

Generate previews for hover effects:
```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=25%&width=640&height=360&sharpen=5
```

### Responsive Gallery Thumbnails

Create thumbnails that adapt to device size:
```
https://cdn.example.com/videos/sample.mp4?mode=frame&time=30s&imwidth=400&im-viewwidth=1200
```

## Performance Considerations

Frame extraction is generally faster and more resource-efficient than full video transformation:

- **Response Time**: Typically 200-500ms for uncached requests
- **Caching Efficiency**: High cache hit rates due to fewer parameter variations
- **Resource Usage**: Lower CPU and memory usage compared to video transformations

For maximum performance:
- Use common dimensions to improve cache efficiency
- Consider using derivatives for consistent parameters
- Use WebP format for modern browsers

## Technical Limitations

- **Input Video Size**: Maximum input video size is 40MB
- **Dimensions**: Width and height must be between 10-2000 pixels
- **Frame Accuracy**: Exact frame selection may have slight variations
- **Color Accuracy**: Some minor color differences compared to original video
- **Format Support**: Only MP4 input files are officially supported

## Best Practices

1. **Choose Representative Frames**:
   - Avoid entirely black or transitional frames
   - Target frames that represent the video content well
   - Consider using percentage-based timing for variable-length videos

2. **Use Appropriate Dimensions**:
   - Match thumbnail dimensions to your UI requirements
   - Use responsive parameters for adaptive layouts
   - Consider device pixel ratio for high-DPI displays

3. **Format Selection**:
   - Use WebP for modern browsers to reduce file size
   - Provide JPG fallbacks for universal support
   - Match quality settings to use case (higher for posters, lower for small thumbnails)

4. **Caching Optimization**:
   - Use consistent parameters to improve cache hit rates
   - Use derivatives for common thumbnail styles
   - Consider TTL settings based on content type

5. **Advanced Techniques**:
   - Use image processing parameters to enhance visibility
   - Consider slight sharpening for clearer thumbnails
   - Adjust brightness and contrast for better representation