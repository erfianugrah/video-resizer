# Client Detection

*Last Updated: May 1, 2025*

## Table of Contents

- [Overview](#overview)
- [Detection Methods](#detection-methods)
- [Device Categories](#device-categories)
- [Client Hints Integration](#client-hints-integration)
- [Network Quality Detection](#network-quality-detection)
- [Impact on Transformations](#impact-on-transformations)
- [Device Information Structure](#device-information-structure)
- [Configuration Options](#configuration-options)
- [Using Client Detection in Path Patterns](#using-client-detection-in-path-patterns)
- [Manual Overrides](#manual-overrides)
- [Custom Device Mapping](#custom-device-mapping)
- [Performance Considerations](#performance-considerations)
- [Best Practices](#best-practices)
- [Debugging](#debugging)

## Overview

The client detection system in Video Resizer automatically identifies device capabilities, screen dimensions, and network conditions to deliver optimized video content. This feature enables adaptive content delivery without requiring client-side JavaScript or complex parameter management.

Client detection works by analyzing:
- HTTP headers (including User-Agent and Client Hints)
- Request parameters (particularly IMQuery parameters)
- Network information (when available)
- Previous request patterns

This information drives intelligent decisions about video quality, dimensions, and format to provide the best viewing experience across different devices and network conditions.

## Detection Methods

The client detection system uses multiple methods in order of precedence:

### 1. Client Hints

When available, Client Hints provide the most accurate and reliable device information:

| Client Hint | Description | Usage |
|-------------|-------------|-------|
| `Sec-CH-UA` | User agent brand and version | Browser identification |
| `Sec-CH-UA-Mobile` | Mobile device indicator | Device type detection |
| `Sec-CH-UA-Platform` | Operating system | OS-specific optimizations |
| `Sec-CH-Viewport-Width` | Viewport width | Responsive sizing |
| `Sec-CH-Width` | Resource width | Content-specific sizing |
| `Sec-CH-DPR` | Device pixel ratio | Resolution optimization |
| `Sec-CH-Prefers-Reduced-Motion` | Motion preference | Accessibility adaptation |
| `Sec-CH-Save-Data` | Data-saving mode | Compression optimization |
| `Sec-CH-Prefers-Color-Scheme` | Color scheme preference | UI adaptation |

### 2. IMQuery Parameters

IMQuery parameters provide context about the intended display size:

| Parameter | Description | Usage |
|-----------|-------------|-------|
| `imwidth` | Intended content width | Responsive sizing |
| `im-viewwidth` | Viewport width | Context for sizing |
| `im-density` | Device pixel density | Resolution optimization |

### 3. User-Agent Analysis

When Client Hints are not available, the system falls back to User-Agent analysis:

```
Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1
```

This example provides information about:
- Device type (iPhone)
- Operating system (iOS 16.3)
- Browser (Safari)
- Form factor (Mobile)

### 4. Network Information

Network information is inferred from:
- `Save-Data` header
- Connection information headers
- Geographic location
- Historical performance data

## Device Categories

The client detection system categorizes devices into three main groups:

### 1. Mobile Devices

Characteristics:
- Small screen (typically <768px wide)
- Touch-focused interaction
- Often on cellular networks
- Limited CPU/GPU resources

Optimizations:
- Lower resolutions (typically 360-480p)
- Higher compression
- Lower bitrates
- Simplified playback controls

### 2. Tablets

Characteristics:
- Medium screen (typically 768-1024px wide)
- Touch-focused interaction
- Mix of WiFi and cellular networks
- Moderate CPU/GPU resources

Optimizations:
- Medium resolutions (typically 480-720p)
- Balanced compression
- Medium bitrates
- Standard playback controls

### 3. Desktop/Laptop

Characteristics:
- Large screen (typically >1024px wide)
- Keyboard/mouse interaction
- Usually on WiFi or wired networks
- Higher CPU/GPU resources

Optimizations:
- Higher resolutions (720-1080p)
- Lower compression
- Higher bitrates
- Full playback controls

## Client Hints Integration

To fully leverage Client Hints, websites should implement:

### 1. Accept-CH Header

The server should respond with the `Accept-CH` header to request Client Hints:

```
Accept-CH: Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-Viewport-Width, Sec-CH-Width, Sec-CH-DPR
```

### 2. HTML Meta Tag

Alternatively, a meta tag can be used to enable Client Hints:

```html
<meta http-equiv="Accept-CH" content="Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-Viewport-Width, Sec-CH-Width, Sec-CH-DPR">
```

### 3. Delegation for Cross-Origin Requests

For Client Hints to work with cross-origin requests:

```html
<meta http-equiv="Delegate-CH" content="Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-Viewport-Width, Sec-CH-Width, Sec-CH-DPR; src=https://cdn.example.com">
```

This delegates permission for the specified origin to receive Client Hints.

## Network Quality Detection

The system assesses network quality through several methods:

### 1. Explicit Signals

- `Save-Data: on` header indicates user preference for reduced data usage
- ECT (Effective Connection Type) headers provide network type information

### 2. Geographical Analysis

- Connection quality often correlates with geographic location
- CDN edge location can provide insights into general network conditions

### 3. IP Range Analysis

- Certain IP ranges are associated with specific network types
- Mobile carrier IP ranges often indicate cellular connectivity

### 4. Adaptive Assessment

- The system learns from request patterns
- Tracks latency and throughput for ongoing optimization

### Network Quality Levels

The system categorizes network quality into three levels:

| Level | Characteristics | Video Adaptations |
|-------|-----------------|-------------------|
| High | Fast, stable connection | Higher quality, lower compression |
| Medium | Average speed/stability | Balanced quality and compression |
| Low | Slow or unstable connection | Lower quality, higher compression, reduced resolution |

## Impact on Transformations

Client detection influences video transformations in several ways:

### 1. Derivative Selection

The detected device type affects which derivative is selected:

| Device Type | Typical Derivative | Characteristics |
|-------------|-------------------|-----------------|
| Mobile | `mobile` | 640×360, high compression, lower quality |
| Tablet | `medium` | 1280×720, medium compression, balanced quality |
| Desktop | `high` | 1920×1080, low compression, high quality |

### 2. Quality Parameter Adjustment

The quality parameter may be adjusted based on detected capabilities:

| Network Quality | Device Type | Quality Adjustment |
|----------------|-------------|-------------------|
| Low | Mobile | Reduce by 1-2 levels, prioritize compression |
| Medium | Any | Use default for device type |
| High | Desktop | Increase by 1 level if bandwidth available |

### 3. Format Selection

Device and browser detection influences format selection:

| Browser | Device | Preferred Format |
|---------|--------|------------------|
| Safari | iOS | MP4 (H.264) |
| Chrome | Any | WebM (if supported) or MP4 |
| Firefox | Desktop | WebM (if supported) or MP4 |

### 4. Responsive Dimensions

Screen size detection enables responsive dimension calculation:

```typescript
// Pseudocode for responsive sizing
const deviceWidth = getDeviceWidth(request);
const deviceType = getDeviceType(request);

let videoWidth;
switch (deviceType) {
  case 'mobile':
    videoWidth = Math.min(deviceWidth, 640);
    break;
  case 'tablet':
    videoWidth = Math.min(deviceWidth, 1280);
    break;
  case 'desktop':
    videoWidth = Math.min(deviceWidth, 1920);
    break;
}

// Apply aspect ratio
const aspectRatio = 16/9;
const videoHeight = Math.round(videoWidth / aspectRatio);
```

## Device Information Structure

The client detection system populates a detailed device information structure:

```typescript
interface DeviceInfo {
  // Device type classification
  type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  
  // Browser information
  browser: {
    name: string;       // 'chrome', 'safari', 'firefox', etc.
    version: string;    // Browser version
    engine: string;     // 'webkit', 'gecko', 'blink', etc.
  };
  
  // Operating system information
  os: {
    name: string;       // 'ios', 'android', 'windows', 'macos', etc.
    version: string;    // OS version
    platform: string;   // 'mobile', 'desktop', etc.
  };
  
  // Screen characteristics
  screen: {
    width: number;      // Viewport width (if known)
    height: number;     // Viewport height (if known)
    dpr: number;        // Device pixel ratio
    touchEnabled: boolean; // Touch screen detection
  };
  
  // Network information
  network: {
    quality: 'low' | 'medium' | 'high' | 'unknown';
    saveData: boolean;  // Data-saving mode enabled
    connection: string; // '4g', 'wifi', etc. (if available)
  };
  
  // Capability flags
  capabilities: {
    webmSupport: boolean;   // WebM format support
    hevcSupport: boolean;   // HEVC codec support
    av1Support: boolean;    // AV1 codec support
    highBitrateSupport: boolean; // Support for high bitrates
  };
  
  // Detection confidence and method
  detection: {
    method: 'client-hints' | 'user-agent' | 'imquery' | 'mixed';
    confidence: number; // 0-1 confidence score
    timestamp: number;  // Detection timestamp
  };
}
```

This structure is available in the request context and used throughout the transformation process.

## Configuration Options

Client detection behavior can be configured:

```json
{
  "clientDetection": {
    "enabled": true,
    "deviceMapping": {
      "mobile": {
        "maxWidth": 767,
        "defaultDerivative": "mobile"
      },
      "tablet": {
        "maxWidth": 1024,
        "defaultDerivative": "medium"
      },
      "desktop": {
        "defaultDerivative": "high"
      }
    },
    "networkQuality": {
      "detectSaveData": true,
      "assumeQualityByDevice": true,
      "mobileNetworkQuality": "medium"
    },
    "features": {
      "useClientHints": true,
      "useUserAgent": true,
      "useIMQuery": true,
      "cacheDeviceInfo": true,
      "adaptQualityByNetwork": true,
      "detectBrowserCapabilities": true
    },
    "cache": {
      "ttl": 3600,
      "varyByUserAgent": false,
      "varyByClientHint": false
    }
  }
}
```

## Using Client Detection in Path Patterns

Client detection can be used in path patterns to route requests:

### Device-Specific Path Patterns

```json
[
  {
    "name": "mobile-videos",
    "matcher": "^/videos/([^/]+)$",
    "processPath": true,
    "originUrl": "https://videos.example.com/{0}",
    "deviceMatch": "mobile",
    "transformationOverrides": {
      "derivative": "mobile"
    }
  },
  {
    "name": "desktop-videos",
    "matcher": "^/videos/([^/]+)$",
    "processPath": true,
    "originUrl": "https://videos.example.com/{0}",
    "deviceMatch": "desktop",
    "transformationOverrides": {
      "derivative": "high"
    }
  }
]
```

### Network-Based Path Patterns

```json
{
  "name": "low-bandwidth-videos",
  "matcher": "^/videos/([^/]+)$",
  "processPath": true,
  "originUrl": "https://videos.example.com/{0}",
  "networkMatch": "low",
  "transformationOverrides": {
    "quality": "low",
    "compression": "high"
  }
}
```

## Manual Overrides

Client detection can be manually overridden with query parameters:

```
https://cdn.example.com/videos/sample.mp4?device=mobile
```

This forces the system to treat the request as coming from a mobile device.

```
https://cdn.example.com/videos/sample.mp4?network=low
```

This forces the system to optimize for low network quality.

These overrides are useful for testing and development.

## Custom Device Mapping

Custom device categories can be defined for specific needs:

```json
{
  "clientDetection": {
    "deviceMapping": {
      "mobile": {
        "maxWidth": 767,
        "defaultDerivative": "mobile"
      },
      "tablet": {
        "maxWidth": 1024,
        "defaultDerivative": "medium"
      },
      "desktop": {
        "maxWidth": 1919,
        "defaultDerivative": "high"
      },
      "4k": {
        "minWidth": 1920,
        "defaultDerivative": "4k"
      }
    }
  }
}
```

This example adds a "4k" device category for screens 1920px and wider.

## Performance Considerations

Client detection has minimal performance impact:

- Client Hints processing adds <1ms to request processing
- User-Agent parsing adds 1-3ms to request processing
- Detection results are cached to minimize repeated parsing
- The performance benefits of optimized content delivery far outweigh the detection overhead

## Best Practices

1. **Enable Client Hints**:
   - Implement Client Hints on your website
   - Delegate hints to your CDN domain
   - This provides the most accurate and efficient detection

2. **Use IMQuery with Client Detection**:
   - Combine IMQuery parameters with client detection
   - This provides both viewport context and device capabilities
   - Leads to more accurate and context-aware optimizations

3. **Configure Appropriate Defaults**:
   - Set reasonable default derivatives for each device type
   - Configure network quality assumptions based on your audience
   - Regularly review and update these settings

4. **Test Across Devices**:
   - Verify detection accuracy across different devices
   - Test with various browsers and operating systems
   - Validate detection confidence with the debug UI

5. **Monitor and Adjust**:
   - Use analytics to track device distribution
   - Monitor cache efficiency across device types
   - Adjust configuration based on audience patterns

## Debugging

The debug UI provides detailed information about client detection:

```
https://cdn.example.com/videos/sample.mp4?debug=view
```

The "Client Detection" section shows:
- Detected device type and capabilities
- Client Hints availability and values
- Network quality assessment
- Detection method and confidence
- Applied device-specific optimizations

For testing specific device types:

```
https://cdn.example.com/videos/sample.mp4?debug=view&device=mobile
```

This simulates a mobile device for debugging purposes.