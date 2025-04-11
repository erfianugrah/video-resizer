# Parameter Compatibility Matrix

This document provides a comprehensive guide to parameter compatibility across different transformation modes in the video-resizer.

## Mode Compatibility Matrix

| Parameter    | Video Mode | Frame Mode | Spritesheet Mode | Notes |
|--------------|------------|------------|------------------|-------|
| `width`      | ✅         | ✅         | ✅ (required)    | 10-2000px range |
| `height`     | ✅         | ✅         | ✅ (required)    | 10-2000px range |
| `fit`        | ✅         | ✅         | ✅               | contain, cover, scale-down |
| `format`     | ✅         | ✅         | ❌               | Spritesheet always outputs JPEG |
| `time`       | ❌         | ✅ (required) | ✅ (optional) | 0-30s range, default: 0s for spritesheet |
| `duration`   | ✅         | ❌         | ✅ (optional)    | Default: 10s for spritesheet |
| `quality`    | ✅         | ✅         | ❌               | low, medium, high, auto |
| `compression`| ✅         | ✅         | ❌               | low, medium, high, auto |
| `audio`      | ✅         | ❌         | ❌               | Audio doesn't apply to still images |
| `loop`       | ✅         | ❌         | ❌               | Playback parameter for video only |
| `autoplay`   | ✅         | ❌         | ❌               | Playback parameter for video only |
| `muted`      | ✅         | ❌         | ❌               | Playback parameter for video only |
| `preload`    | ✅         | ❌         | ❌               | Playback parameter for video only |
| `derivative` | ✅         | ✅         | ✅               | Presets from configuration |

## Mode-Specific Requirements

### Video Mode
- No specific required parameters
- Supports all playback controls (loop, autoplay, muted, preload)
- Supports quality and compression settings
- Supports audio control

### Frame Mode
- **Required**: `time` parameter to specify which frame to extract
- Format can be specified (jpg, png, webp)
- Does not support playback parameters
- Does not support audio parameter
- Does not support duration

### Spritesheet Mode
- **Required**: `width` and `height` parameters
- Always outputs JPEG format (format parameter not allowed)
- Does not support playback parameters (loop, autoplay, muted, preload)
- Does not support quality or compression parameters
- Does not support audio parameter
- Defaults: `time=0s`, `duration=10s` if not specified

## Parameter Validation

### Width and Height
- Valid range: 10-2000 pixels
- Required for spritesheet mode
- Messages: "Missing required parameter", "Invalid dimension"

### Format
- Valid values depend on mode
- Video: mp4, webm
- Frame: jpg, png, webp
- Spritesheet: (not allowed, always jpg)
- Message: "Format parameter cannot be used with mode=spritesheet"

### Time
- Valid format: Number followed by 's' (e.g., "5s", "30s", "0.5s")
- Valid range: 0-30s
- Required for frame mode
- Message: "Invalid time parameter"

### Duration
- Valid format: Number followed by 's' or 'm' (e.g., "10s", "1m")
- Warnings for spritesheet mode: Duration > 60s may result in very large spritesheets
- Message: "Invalid duration parameter"

### Fit
- Valid values: "contain", "cover", "scale-down"
- Message: "Invalid fit parameter"

### Quality and Compression
- Valid values: "low", "medium", "high", "auto"
- Not allowed in spritesheet mode
- Message: "Quality and compression parameters cannot be used with mode=spritesheet"

### Playback Parameters
- Valid only for video mode
- Not allowed in frame or spritesheet modes
- Message: "Playback parameters cannot be used with mode=frame/spritesheet"

## Common Error Patterns

### Invalid Parameter Combination
When parameters are used that are incompatible with a specific mode:

```
ValidationError: Playback parameters (loop, autoplay, muted, preload) cannot be used with mode=spritesheet
```

### Missing Required Parameter
When a required parameter for a mode is missing:

```
ValidationError: Missing required parameter: width
```

### Invalid Dimension
When width or height is outside the valid range:

```
ValidationError: width must be between 10 and 2000 pixels
```

### Invalid Time Value
When time format is incorrect:

```
ValidationError: Invalid time parameter: 60x. Must be between 0s and 30s (e.g., "5s", "0.5s")
```

## Warnings

Some parameter combinations will not cause errors but will generate warnings:

1. **Extreme aspect ratios** (width/height ratio > 5 or < 0.2)
   - Warning: "Extreme aspect ratio (10.00) may result in distorted spritesheet thumbnails"

2. **Long durations for spritesheets** (> 60s)
   - Warning: "Duration of 120s may result in a very large spritesheet with reduced thumbnail quality"