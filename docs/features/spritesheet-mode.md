# Spritesheet Mode

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [Spritesheet Parameters](#spritesheet-parameters)
- [Grid Layout Options](#grid-layout-options)
- [Timeline Control](#timeline-control)
- [Output Format](#output-format)
- [Example URLs](#example-urls)
- [Common Use Cases](#common-use-cases)
- [Technical Limitations](#technical-limitations)
- [Performance Considerations](#performance-considerations)
- [Best Practices](#best-practices)
- [Integration Examples](#integration-examples)

## Overview

Spritesheet mode generates a grid of thumbnails showing the progression of a video over time. This mode is ideal for creating video scrubbing interfaces, preview thumbnails, and visual video timelines.

```
https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=800&height=600
```

Spritesheets provide several advantages:
- One HTTP request fetches multiple thumbnails
- Efficient client-side scrubbing without additional requests
- Consistent visual representation of video content
- Simplified video navigation interfaces

## Spritesheet Parameters

| Parameter | Type | Required | Default | Description | Example |
|-----------|------|----------|---------|-------------|---------|
| `mode` | string | Yes | - | Must be set to "spritesheet" | `mode=spritesheet` |
| `width` | number | Yes | - | Width of the entire spritesheet in pixels | `width=800` |
| `height` | number | Yes | - | Height of the entire spritesheet in pixels | `height=600` |
| `time` | string | No | "0s" | Starting time for the spritesheet range | `time=30s` |
| `duration` | string | No | full (if omitted) | Time window for sprites (1-300s) | `duration=60s` |
| `fit` | string | No | "contain" | How to fit thumbnails within the grid | `fit=cover` |

### Required vs. Optional Parameters

For spritesheet mode, the following parameters are required:
- `mode=spritesheet`: Specifies the transformation mode
- `width`: The total width of the spritesheet image (required)
- `height`: The total height of the spritesheet image (required)

All other parameters are optional and will use defaults if not specified.

## Grid Layout Options

The spritesheet grid layout is automatically determined by Cloudflare's Media Transformation API based on the video duration and the specified dimensions.

### Grid Calculation

The API automatically:
1. Divides the video duration into equal segments
2. Creates a grid that fits within the specified width and height
3. Extracts frames at the midpoint of each segment
4. Arranges the frames in a left-to-right, top-to-bottom grid

For example, a 60-second video with default settings might produce a 4×3 grid (12 frames total), with each frame representing 5 seconds of video.

### Fit Modes

The `fit` parameter controls how individual frames fit within their grid cells:

| Value | Description | Use Case |
|-------|-------------|----------|
| `contain` | Preserves aspect ratio, entire frame visible | Default, no content cropping |
| `cover` | Fills grid cell while preserving aspect ratio (may crop) | Consistent thumbnail appearance |
| `scale-down` | Like contain, but never enlarges | Prevents quality loss on small videos |
| `crop` | Centers and crops to exact dimensions | Exact dimension requirements |

## Timeline Control

Control which portion of the video is included in the spritesheet:

### Starting Point

The `time` parameter sets the starting point for the spritesheet range:

```
https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=800&height=600&time=30s
```

This starts the spritesheet at the 30-second mark in the video.

### Duration Control

The `duration` parameter controls how much video content is included in the spritesheet:

```
https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=800&height=600&time=30s&duration=60s
```

This creates a spritesheet covering 60 seconds of video, starting at the 30-second mark (30s to 90s).

### Time Format

The `time` parameter supports several formats:

| Format | Description | Example |
|--------|-------------|---------|
| Seconds | Simple seconds value | `time=30s` |
| Minutes:Seconds | MM:SS format | `time=2:30` |
| Hours:Minutes:Seconds | HH:MM:SS format | `time=1:15:30` |
| Percentage | Percentage of video duration | `time=25%` |

## Output Format

Spritesheets are always generated as JPEG images, regardless of the original video format. The quality of the output JPEG is automatically determined by the system to balance image quality and file size.

Unlike frame mode, spritesheet mode does not support:
- Different output formats (only JPEG is available)
- Quality parameter adjustment
- Advanced image processing options

## Example URLs

### Basic Spritesheet

```
https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=800&height=600
```

This creates a spritesheet covering the first 10 seconds of the video.

### Custom Time Range

```
https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=800&height=600&time=30s&duration=60s
```

This creates a spritesheet covering 60 seconds of video, starting at the 30-second mark.

### Fit Mode Adjustment

```
https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=800&height=600&fit=cover
```

This creates a spritesheet with frames that fill their grid cells completely (may crop).

### Percentage-Based Starting Point

```
https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=800&height=600&time=25%&duration=50%
```

This creates a spritesheet starting at 25% of the video duration and covering 50% of the video.

## Common Use Cases

### Video Scrubbing Interface

Spritesheets are ideal for creating video scrubbing interfaces that show preview thumbnails when hovering over a timeline:

```html
<div class="video-scrubber" 
     data-spritesheet="https://cdn.example.com/videos/sample.mp4?mode=spritesheet&width=1200&height=100&duration=120s"
     data-video-duration="120">
  <!-- Scrubbing code uses the spritesheet for hover previews -->
</div>
```

### Video Chapter Navigation

Spritesheets can visualize chapters or key moments in a video:

```
https://cdn.example.com/videos/lecture.mp4?mode=spritesheet&width=1000&height=200&duration=3600s
```

This creates a visual overview of the entire lecture, which can be used for chapter navigation.

### Visual Timeline Representation

Use spritesheets to create a visual representation of the video content:

```
https://cdn.example.com/videos/movie.mp4?mode=spritesheet&width=900&height=300
```

This can be used in editing interfaces or content management systems to visualize video content.

## Technical Limitations

- **Maximum Dimensions**: The spritesheet width and height must each be between 10-2000 pixels
- **Input Video Size**: Maximum input video size is 40MB
- **Grid Size**: The system automatically determines the grid size based on the video length
- **Frame Density**: The number of frames is limited by the grid size and dimensions
- **Output Format**: Only JPEG output is supported
- **Video Duration**: Very long videos will result in each frame representing a longer time segment
- **Playback Parameters**: Incompatible with video playback parameters (loop, autoplay, muted, preload)

## Performance Considerations

Generating spritesheets has specific performance characteristics:

- **Processing Time**: 500-2000ms for uncached requests (similar to video transformations)
- **File Size**: Typically 20-200KB depending on dimensions and content
- **Caching Efficiency**: High cache hit rates due to fewer parameter variations
- **Client Performance**: More efficient than loading multiple individual thumbnails

For optimal performance:
- Use reasonable dimensions for your use case
- Consider using consistent dimensions to improve cache hit rates
- Keep the duration parameter aligned with the actual use case

## Best Practices

1. **Right-Size Dimensions**:
   - Match the spritesheet dimensions to your UI requirements
   - Consider the grid density when setting dimensions
   - Balance quality and file size for the intended use

2. **Optimize Time Coverage**:
   - For navigation interfaces, cover the entire video (`duration` set to full length)
   - For preview sections, focus on the most relevant parts of the video
   - For long videos, consider multiple spritesheets covering different segments

3. **Grid Considerations**:
   - Remember that the grid layout is automatically determined
   - The aspect ratio of your specified dimensions affects the grid layout
   - Test different dimensions to achieve the desired grid layout

4. **Integration Best Practices**:
   - Preload spritesheets for better user experience
   - Calculate the position in the spritesheet based on the seek time
   - Use CSS to show only a portion of the spritesheet as a preview

## Integration Examples

### Basic JavaScript Scrubber

```javascript
const videoScrubber = document.querySelector('.video-scrubber');
const spritesheet = videoScrubber.getAttribute('data-spritesheet');
const videoDuration = parseInt(videoScrubber.getAttribute('data-video-duration'));
const previewEl = document.createElement('div');

previewEl.style.backgroundImage = `url(${spritesheet})`;
previewEl.classList.add('thumbnail-preview');
videoScrubber.appendChild(previewEl);

// Calculate grid dimensions (example assumes a 4x3 grid)
const gridCols = 4;
const gridRows = 3;
const frameWidth = parseInt(spritesheet.match(/width=(\d+)/)[1]) / gridCols;
const frameHeight = parseInt(spritesheet.match(/height=(\d+)/)[1]) / gridRows;

videoScrubber.addEventListener('mousemove', (e) => {
  // Calculate percentage through scrubber
  const rect = videoScrubber.getBoundingClientRect();
  const position = (e.clientX - rect.left) / rect.width;
  
  // Calculate time at position
  const timeAtPosition = position * videoDuration;
  
  // Calculate frame index (for a 12-frame spritesheet)
  const frameIndex = Math.min(11, Math.floor(timeAtPosition / (videoDuration / 12)));
  
  // Calculate row and column in grid
  const col = frameIndex % gridCols;
  const row = Math.floor(frameIndex / gridCols);
  
  // Position background to show correct frame
  previewEl.style.backgroundPosition = `-${col * frameWidth}px -${row * frameHeight}px`;
  previewEl.style.width = `${frameWidth}px`;
  previewEl.style.height = `${frameHeight}px`;
  previewEl.style.display = 'block';
  previewEl.style.left = `${position * 100}%`;
});

videoScrubber.addEventListener('mouseleave', () => {
  previewEl.style.display = 'none';
});
```

### React Integration Example

```jsx
import React, { useState, useEffect, useRef } from 'react';

const VideoScrubber = ({ videoUrl, videoDuration }) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const scrubberRef = useRef(null);
  
  // Construct spritesheet URL
  const spritesheetUrl = `${videoUrl}?mode=spritesheet&width=800&height=600`;
  
  // Assume a 4x3 grid (12 frames)
  const gridCols = 4;
  const gridRows = 3;
  const frameWidth = 800 / gridCols;
  const frameHeight = 600 / gridRows;
  
  const handleMouseMove = (e) => {
    const rect = scrubberRef.current.getBoundingClientRect();
    const position = (e.clientX - rect.left) / rect.width;
    const timeAtPosition = position * videoDuration;
    
    // Calculate which frame to show
    const newFrameIndex = Math.min(11, Math.floor(timeAtPosition / (videoDuration / 12)));
    
    setPreviewPosition(position * 100);
    setFrameIndex(newFrameIndex);
    setPreviewVisible(true);
  };
  
  const handleMouseLeave = () => {
    setPreviewVisible(false);
  };
  
  // Calculate background position
  const col = frameIndex % gridCols;
  const row = Math.floor(frameIndex / gridCols);
  const backgroundPosition = `-${col * frameWidth}px -${row * frameHeight}px`;
  
  return (
    <div 
      className="video-scrubber" 
      ref={scrubberRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="scrubber-track">
        {/* Track UI */}
      </div>
      
      {previewVisible && (
        <div 
          className="thumbnail-preview"
          style={{
            backgroundImage: `url(${spritesheetUrl})`,
            backgroundPosition,
            width: frameWidth,
            height: frameHeight,
            left: `${previewPosition}%`,
            display: 'block',
            position: 'absolute',
            transform: 'translateX(-50%)',
            border: '2px solid white'
          }}
        />
      )}
    </div>
  );
};

export default VideoScrubber;
```
