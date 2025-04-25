# Akamai Integration for Video Resizer

## Overview

The Akamai integration feature allows Video Resizer to support Akamai-style URL parameters and the IMQuery responsive image technology. This enables a seamless migration path from Akamai to Cloudflare while maintaining backward compatibility with existing applications.

With this feature, you can continue using existing Akamai-formatted URLs with the Video Resizer service, and they will automatically be translated to Cloudflare's Media Transformation API format.

## Key Features

| Feature | Description | Benefits |
|---------|-------------|----------|
| **Parameter Translation** | Converts Akamai-style parameters (`w`, `h`, `obj-fit`, etc.) to Cloudflare format | Maintain compatibility with existing applications |
| **IMQuery Support** | Handles Akamai's responsive image technology parameters (`imwidth`, `imheight`, etc.) | Enable responsive video delivery |
| **Client Hints Integration** | Translates IMQuery parameters to client hints format | Better device-specific optimizations |
| **Validation & Error Handling** | Provides detailed warnings for unsupported parameters | Improved debugging experience |
| **Diagnostic Information** | Captures original and translated parameters for debugging | Easier troubleshooting |

## Parameter Mapping

The integration includes comprehensive parameter mapping between Akamai and Cloudflare formats:

| Akamai Parameter | Cloudflare Parameter | Notes |
|------------------|----------------------|-------|
| `w` | `width` | Video width in pixels |
| `h` | `height` | Video height in pixels |
| `obj-fit` | `fit` | Resize mode (cover, contain, etc.) |
| `q` | `quality` | Quality setting |
| `f` | `format` | Output format |
| `start` | `time` | Start timestamp |
| `dur` | `duration` | Video duration |
| `mute` | `audio` | Audio control (inverted: mute=true → audio=false) |
| `imwidth` | `width` | IMQuery responsive width |
| `imheight` | `height` | IMQuery responsive height |
| `im-viewwidth` | Converted to client hints | Client viewport width |
| `im-viewheight` | Converted to client hints | Client viewport height |
| `im-density` | Converted to client hints | Device pixel ratio |

## Parameter Value Translation

Some parameters have values that need translation:

| Parameter | Akamai Value | Cloudflare Value |
|-----------|--------------|------------------|
| `obj-fit` | `cover` | `cover` |
| `obj-fit` | `contain` | `contain` |
| `obj-fit` | `crop` | `cover` |
| `obj-fit` | `fill` | `contain` |
| `mute` | `true` | `audio=false` |
| `mute` | `false` | `audio=true` |

## IMQuery Support

IMQuery is Akamai's responsive image technology that allows clients to request appropriately sized videos based on the client's viewport. The Video Resizer's IMQuery support includes:

1. **Parameter Recognition**: Detects IMQuery parameters in URL requests
2. **Reference Parameter Parsing**: Handles the `imref` parameter for reference values
3. **Client Hints Integration**: Converts IMQuery parameters to client hints
4. **Responsive Sizing**: Adapts video dimensions based on client capabilities
5. **Device Adaptation**: Optimizes video delivery for different devices

### How IMQuery Works

When a request includes IMQuery parameters (e.g., `imwidth=800`):

1. The parameters are detected in the URL
2. IMQuery reference values are parsed if present
3. Device viewport parameters are converted to client hints
4. The system maps the dimensions to an appropriate derivative
5. The transformation uses the derivative's parameters
6. Diagnostic information captures both original and translated parameters

## Usage Examples

### Basic Akamai Parameter Usage

```
https://cdn.example.com/videos/sample.mp4?w=800&h=600&obj-fit=cover
```

This URL uses traditional Akamai parameters and will be translated to Cloudflare's format.

### IMQuery Usage

```
https://cdn.example.com/videos/sample.mp4?imwidth=800&imheight=600&imref=w=800,h=600,dpr=2
```

This URL uses IMQuery parameters and will leverage client hints and responsive sizing.

### Combined Parameter Usage

```
https://cdn.example.com/videos/sample.mp4?w=800&h=600&mute=true&start=10s&dur=30s
```

This URL combines multiple Akamai parameters for a more complex transformation.

## Implementation Architecture

The Akamai integration is implemented across several key components:

1. **Parameter Translation**: In `transformationUtils.ts`, provides mapping between Akamai and Cloudflare parameters

2. **IMQuery Support**: In `imqueryUtils.ts`, handles all IMQuery-specific functionality

3. **Parameter Processing**: In `videoOptionsService.ts`, integrates translation into the request processing flow

4. **Diagnostic Capture**: Stores original and translated parameters for debugging

## Diagnostic Information

When using Akamai-style parameters, you can enable debug output to see the translation process:

```
https://cdn.example.com/videos/sample.mp4?w=800&h=600&debug=true
```

The debug output includes:
- Original Akamai parameters
- Translated Cloudflare parameters
- Any warnings about unsupported parameters
- IMQuery processing details (if applicable)

## Best Practices

1. **Consistent Parameter Use**: Either use all Akamai-style or all Cloudflare-style parameters in a single request for best predictability
2. **IMQuery for Responsive Design**: Use IMQuery parameters for responsive video delivery
3. **Test Complex Transformations**: Verify complex parameter combinations work as expected
4. **Check Debug Output**: Use the debug parameter to understand how parameters are translated
5. **Monitor Warnings**: Pay attention to warnings about unsupported parameters

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| Parameter not applied | Unsupported parameter | Check debug output for warnings about unsupported parameters |
| Unexpected transformation | Value range difference | Verify parameter values are within acceptable ranges |
| IMQuery not working | Missing viewport information | Include `im-viewwidth` parameter or ensure client hints are available |
| Audio issues | Inverted `mute` parameter | Remember that `mute=true` translates to `audio=false` |

## Related Documentation

- [IMQuery Support](../imquery/README.md) - Comprehensive documentation on IMQuery support
- [Video Mode](../video-mode.md) - Standard video transformation documentation
- [Transformation Modes](../transformation-modes.md) - Overview of all transformation modes
- [Parameter Compatibility](../../configuration/parameter-compatibility.md) - Complete parameter reference

## Last Updated

*April 25, 2025*