# Video Spritesheet Feature

The spritesheet feature of the video-resizer service enables the generation of sprite sheets from video files. A spritesheet is a grid of thumbnails extracted from the video at regular intervals, combined into a single JPEG image. This document explains how to use the spritesheet feature, its configuration, and provides examples.

## Use Cases

Spritesheets are useful for:

- Video player scrubbing interfaces (hover thumbnails)
- Video navigation UI components
- Content previews in media galleries
- Creating visual summaries of video content
- Thumbnail generation for video cataloging

## How to Use

To generate a spritesheet, use the URL parameter `mode=spritesheet` along with required dimension parameters:

```
https://cdn.erfi.dev/videos/example.mp4?mode=spritesheet&width=800&height=600
```

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `mode` | Set to `spritesheet` | `mode=spritesheet` |
| `width` | Width of the entire spritesheet (10-2000px) | `width=800` |
| `height` | Height of the entire spritesheet (10-2000px) | `height=600` |

### Optional Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `time` | Starting time for the spritesheet range | `0s` | `time=30s` |
| `duration` | Duration of video to include in spritesheet | `10s` | `duration=60s` |
| `fit` | How to fit thumbnails within the grid | `contain` | `fit=cover` |

## Technical Details

### How It Works

1. The system extracts frames from the video at regular intervals over the specified duration
2. Frames are arranged in a grid pattern to form a single JPEG image
3. The grid size (number of columns and rows) is automatically determined by Cloudflare's service based on the video length
4. The thumbnail size is calculated by dividing the total width/height by the grid dimensions

### Limitations

- Maximum input video size: 40MB
- Maximum output dimensions: 2000x2000 pixels
- Minimum output dimensions: 10x10 pixels
- Playback parameters (loop, autoplay, muted, preload) cannot be used with spritesheet mode
- Duration may be limited based on video length

## Examples

### Basic Spritesheet

Generate a spritesheet for the first 10 seconds of the video:

```
https://cdn.erfi.dev/videos/example.mp4?mode=spritesheet&width=800&height=600
```

### Custom Time Range

Generate a spritesheet for the segment from 30s to 1m30s:

```
https://cdn.erfi.dev/videos/example.mp4?mode=spritesheet&width=800&height=600&time=30s&duration=60s
```

### Different Fit Modes

Use `fit=cover` to crop thumbnails to fill their cells completely:

```
https://cdn.erfi.dev/videos/example.mp4?mode=spritesheet&width=800&height=600&fit=cover
```

Use `fit=contain` (default) to preserve aspect ratio without cropping:

```
https://cdn.erfi.dev/videos/example.mp4?mode=spritesheet&width=800&height=600&fit=contain
```

## Integration Examples

### HTML/CSS Example

```html
<div class="video-scrubber" 
     style="background-image: url('https://cdn.erfi.dev/videos/example.mp4?mode=spritesheet&width=800&height=600');
            width: 800px; 
            height: 600px;">
</div>
```

### JavaScript Video Player Integration

```javascript
const videoPlayer = document.getElementById('video-player');
const scrubber = document.getElementById('scrubber');
const videoId = 'example';

// Load the spritesheet
const spritesheet = new Image();
spritesheet.src = `https://cdn.erfi.dev/videos/${videoId}.mp4?mode=spritesheet&width=800&height=600`;

// Setup scrubbing behavior
scrubber.addEventListener('mousemove', (e) => {
  const position = e.offsetX / scrubber.offsetWidth;
  const time = position * videoPlayer.duration;
  
  // Calculate which sprite to show based on position
  // This depends on the grid size of your spritesheet
  // For example, if it's a 4x4 grid:
  const totalSprites = 16;
  const spriteIndex = Math.floor(position * totalSprites);
  
  // Logic to display the appropriate sprite
  // ...
});
```

## Troubleshooting

### Common Issues

1. **Error: "Playback parameters cannot be used with mode=spritesheet"**
   - Solution: Remove any loop, autoplay, muted, or preload parameters from the URL

2. **Error: "Width and height must be between 10-2000 pixels"**
   - Solution: Ensure width and height parameters are within the allowed range

3. **Blank or incomplete spritesheet**
   - The video may be too large (>40MB)
   - The specified time range may exceed the video length
   - The video format may not be supported (MP4 with H.264 is recommended)

## Configuration

The default behavior of the spritesheet mode can be configured in `worker-config.json`:

```json
{
  "video": {
    "defaults": {
      "time": "0s",
      "duration": "10s",
      "fit": "contain"
    }
  }
}
```

## Implementation Details

See the `SpritesheetStrategy.ts` file for the implementation details of how spritesheet requests are processed and validated.