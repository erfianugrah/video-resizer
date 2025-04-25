# Client Detection System

The Client Detection System intelligently adapts video delivery based on the client's capabilities, network conditions, and device preferences. This enhances the viewer experience by optimizing video quality, format, and playback parameters for each user's specific situation.

## Key Capabilities

| Capability | Description | Configuration Parameter |
|------------|-------------|-------------------------|
| **Device Detection** | Identifies device type (mobile, tablet, desktop) | `clientDetection.enabled` |
| **Browser Compatibility** | Detects codec and feature support | `clientDetection.useBrowserCompatData` |
| **Network Quality** | Assesses connection speed and stability | `clientDetection.adaptiveNetworkQuality` |
| **HDR Support** | Detects HDR capability for enhanced video | `clientDetection.hdrDetection` |
| **Battery Awareness** | Adjusts quality for low-battery devices | `clientDetection.batteryAwareness` |
| **Client Hints** | Uses modern Client Hints headers | Included in `detectionPriority` array |
| **Fallback Detection** | Graceful degradation for older browsers | `clientDetection.fallbackToUserAgent` |

## Detection Methods

The system uses a configurable priority order of detection methods:

1. **Client Hints**: Modern browser capability detection
2. **Browser Compatibility Data**: Uses @mdn/browser-compat-data
3. **Cloudflare Headers**: Information from Cloudflare's edge
4. **User-Agent Parsing**: Fallback for older browsers

## Configuration

Client detection is fully configurable through the `VIDEO_CONFIG` in your wrangler.jsonc:

```jsonc
// wrangler.jsonc excerpt
{
  "vars": {
    "VIDEO_CONFIG": {
      "responsive": {
        // Client detection configuration
        "clientDetection": {
          "enabled": true,
          "detectionPriority": ["client-hints", "browser-compat", "cf-headers", "user-agent"],
          "useMediaCapabilities": true,
          "useBrowserCompatData": true,
          "fallbackToUserAgent": true,
          "hdrDetection": true,
          "batteryAwareness": true,
          "adaptiveNetworkQuality": true,
          "debug": false
        }
      },
      // Feature flags
      "features": {
        "mediaBrowserCompatData": true,
        "hdrSupport": true,
        "batteryAwareness": true,
        "predictiveBuffering": true
      }
    }
  }
}
```

You can also configure path-specific overrides:

```jsonc
"PATH_PATTERNS": [
  {
    "name": "mobile-videos",
    "matcher": "^/m/",
    "processPath": true,
    "clientDetectionOverrides": {
      "hdrDetection": false,
      "batteryAwareness": true,
      "detectionPriority": ["client-hints", "cf-headers", "user-agent"]
    }
  }
]
```

## Implementation Components

The client detection system consists of several integrated components:

### 1. Feature Detection Service

Detects browser capabilities using multiple methods based on the configured priority order:

```typescript
// Example usage
const hasCodecSupport = FeatureDetectionService.hasCodecSupport('av1', userAgent);
const mediaCapabilities = await FeatureDetectionService.detectMediaCapabilities(request);
```

### 2. Quality Selection Service

Determines optimal video quality based on device capabilities and network conditions:

```typescript
// Example usage
const qualityOptions = QualitySelectionService.determineOptimalQuality(
  request,
  networkQuality,
  deviceCapabilities
);
```

### 3. HDR Detection Service

Detects HDR support and recommends appropriate HDR format:

```typescript
// Example usage
const supportsHdr = HdrDetectionService.supportsHdr(request);
const hdrFormat = HdrDetectionService.getOptimalHdrFormat(request);
```

### 4. Battery Awareness Service

Adjusts video quality based on device battery status:

```typescript
// Example usage
const batteryInfo = BatteryAwarenessService.getBatteryInfo(request);
const adjustedQuality = BatteryAwarenessService.adjustQualityForBattery(quality, batteryInfo);
```

### 5. Network Detection Service

Analyzes connection quality to optimize video delivery:

```typescript
// Example usage
const networkQuality = NetworkDetectionService.getNetworkQuality(request);
const optimizedOptions = NetworkDetectionService.predictiveNetworkAdjustment(
  videoOptions,
  networkQuality
);
```

## Integration with Video-Resizer

The client detection system is integrated with several core components:

1. **VideoConfigurationManager**: Provides access to client detection settings
2. **TransformVideoCommand**: Uses detected capabilities for transformation decisions
3. **VideoOptionsService**: Applies detected information to video parameters
4. **CacheManagementService**: Adjusts caching based on device capabilities
5. **DebugService**: Reports detection results in debug mode

## Debug Information

When debug mode is enabled, client detection information is available in:

1. **Debug Headers**:
   - `X-Client-Device-Type`: Detected device type
   - `X-Client-Browser`: Detected browser
   - `X-Client-Network-Quality`: Detected network quality
   - `X-Client-Capabilities`: Detected media capabilities

2. **Debug UI**:
   - Client Detection tab showing all detected capabilities
   - Quality decision explanation
   - Detection method used for each capability

## Performance Considerations

The client detection system is designed for optimal performance:

- Detection methods are executed in order of performance impact
- Results are cached for the duration of the request
- Only enabled detection methods are used
- Detection is limited to what's needed for the requested transformation

## Recent Improvements

Recent enhancements to the client detection system include:

1. **Multiple Detection Methods**: Added configurable priority for detection methods
2. **Browser Compatibility Data**: Integration with @mdn/browser-compat-data
3. **HDR Support**: Added detection for HDR capability
4. **Battery Awareness**: Optimizations for low-battery devices
5. **Network Quality Assessment**: Enhanced connection quality detection
6. **Configuration Integration**: Full integration with VideoConfigurationManager

## Last Updated

*April 25, 2025*