# Video Frame Feature

The frame feature of the video-resizer service enables the extraction of individual still frames from video files. This document explains how to use the frame feature, its configuration, and provides examples.

## Use Cases

Frame extraction is useful for:

- Creating video thumbnails and poster images
- Generating preview images for video galleries
- Creating still images from specific video moments
- Building custom video scrubbing interfaces
- Creating chapter previews for longer videos

## How to Use

To extract a frame from a video, use the URL parameter `mode=frame` along with the required `time` parameter:

```
https://cdn.erfi.dev/videos/example.mp4?mode=frame&time=30s&width=640&height=360
```

### Required Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `mode` | Set to `frame` | `mode=frame` |
| `time` | Timestamp to extract (0-30s range) | `time=15s` |

### Optional Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `width` | Width of the output image | Original width | `width=640` |
| `height` | Height of the output image | Original height | `height=360` |
| `format` | Output format | `jpg` | `format=png` |
| `fit` | How to fit the frame | `contain` | `fit=cover` |
| `quality` | Image quality | `auto` | `quality=high` |

## Technical Details

### How It Works

1. The service forwards the request to Cloudflare's Media Transformation API using the CDN-CGI endpoint
2. The API extracts the specified frame from the video
3. The frame is processed according to the specified parameters
4. The resulting image is returned in the specified format

### Limitations

- **Time Range**: Frames can only be extracted from the first 30 seconds of video by default
- **Input Requirements**: Input videos must be less than 40MB and preferably in MP4 format
- **Dimension Limits**: Width and height must be between 10-2000 pixels
- **Output Formats**: Supports jpg, png, and webp formats

## Examples

### Basic Frame Extraction

Extract a frame at 5 seconds:

```
https://cdn.erfi.dev/videos/example.mp4?mode=frame&time=5s
```

### High-Quality Thumbnail

Extract a frame and specify size and quality:

```
https://cdn.erfi.dev/videos/example.mp4?mode=frame&time=10s&width=1280&height=720&quality=high&format=png
```

### WebP Format with Cover Fit

Extract a frame in WebP format with cover fit:

```
https://cdn.erfi.dev/videos/example.mp4?mode=frame&time=3s&width=400&height=300&format=webp&fit=cover
```

### Using Fractional Seconds

Extract a frame at a precise moment:

```
https://cdn.erfi.dev/videos/example.mp4?mode=frame&time=7.5s
```

## Integration Examples

### HTML Example

```html
<img 
  src="https://cdn.erfi.dev/videos/example.mp4?mode=frame&time=5s&width=640&height=360" 
  alt="Video thumbnail at 5 seconds"
/>
```

### CSS Background Example

```css
.video-thumbnail {
  background-image: url('https://cdn.erfi.dev/videos/example.mp4?mode=frame&time=15s&width=640&height=360');
  width: 640px;
  height: 360px;
  background-size: cover;
  background-position: center;
}
```

### JavaScript Poster Image

```javascript
const video = document.getElementById('video-player');
const videoId = 'example';
const time = '10s';

// Set poster image from frame extraction
video.poster = `https://cdn.erfi.dev/videos/${videoId}.mp4?mode=frame&time=${time}`;
```

## Troubleshooting

### Common Issues

1. **Error: "Time parameter required for frame mode"**
   - Solution: Add a `time` parameter to your URL

2. **Error: "Time value must be within 0s to 30s range"**
   - Solution: Use a time value within the allowed range

3. **Error: "Invalid time format"**
   - Solution: Use the correct format, e.g., "5s", "10.5s"

4. **Low-quality output**
   - Try increasing the dimensions and quality parameter
   - Experiment with different formats (PNG often has better quality than JPEG)

## Configuration

Frame mode behavior can be configured in `worker-config.json`:

```json
{
  "video": {
    "defaults": {
      "format": "jpg",
      "quality": "auto",
      "fit": "contain"
    },
    "validOptions": {
      "format": ["jpg", "png", "webp"],
      "fit": ["contain", "cover", "scale-down"],
      "quality": ["low", "medium", "high", "auto"]
    }
  }
}
```

## Implementation Details

See the `FrameStrategy.ts` file for the implementation details of how frame requests are processed and validated.

## Best Practices

1. **Specify dimensions** for consistent output and faster processing
2. **Use WebP format** for modern browsers to reduce file size
3. **Choose the appropriate fit mode** based on your UI requirements
4. **Cache frame images** as they rarely change
5. **Use quality parameter judiciously** - higher quality means larger file size