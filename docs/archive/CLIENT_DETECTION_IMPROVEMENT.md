# Client Detection Improvements for Video Resizer

This document outlines the planned enhancements to the client detection capabilities of the video-resizer project, to improve video delivery optimization and browser compatibility.

## Goals

- Implement more accurate client capability detection
- Move away from User-Agent parsing to more reliable methods
- Improve codec selection based on browser support
- Enhance network quality detection for better video quality decisions
- Support future updates to Cloudflare's Media Transformation API
- Ensure all features are configurable through wrangler.jsonc

## Configuration Integration

All client detection capabilities will be integrated into the existing `VideoConfigurationManager` to maintain a single source of truth:

```jsonc
// wrangler.jsonc additions for client detection
{
  "vars": {
    "VIDEO_CONFIG": {
      "responsive": {
        // Existing responsive configuration...
        
        // New client detection settings
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
      // Feature flags embedded within existing config
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

## Implementation Approach

### 1. Extend VideoConfigurationManager

We'll extend the existing VideoConfigurationManager to include client detection settings:

```typescript
// Update to VideoConfigurationSchema in VideoConfigurationManager.ts
const ClientDetectionSchema = z.object({
  enabled: z.boolean().default(true),
  detectionPriority: z.array(z.string()).default(['client-hints', 'browser-compat', 'cf-headers', 'user-agent']),
  useMediaCapabilities: z.boolean().default(true),
  useBrowserCompatData: z.boolean().default(true),
  fallbackToUserAgent: z.boolean().default(true),
  hdrDetection: z.boolean().default(true),
  batteryAwareness: z.boolean().default(true),
  adaptiveNetworkQuality: z.boolean().default(true),
  debug: z.boolean().default(false)
});

// Update to ResponsiveSchema
const ResponsiveSchema = z.object({
  breakpoints: z.record(z.number().positive()),
  availableQualities: z.array(z.number().positive()),
  deviceWidths: z.record(z.number().positive()),
  networkQuality: z.record(NetworkQualityConfigSchema),
  // Add client detection to responsive section
  clientDetection: ClientDetectionSchema.optional()
});

// Add feature flags section
const FeaturesSchema = z.object({
  mediaBrowserCompatData: z.boolean().default(true),
  hdrSupport: z.boolean().default(true),
  batteryAwareness: z.boolean().default(true),
  predictiveBuffering: z.boolean().default(true)
}).optional();

// Add to VideoConfigSchema
export const VideoConfigSchema = z.object({
  // Existing schema elements...
  responsive: ResponsiveSchema,
  features: FeaturesSchema,
  // Other existing schema properties...
});

// Add new methods to VideoConfigurationManager
export class VideoConfigurationManager {
  // Existing methods...
  
  /**
   * Get client detection configuration
   */
  public getClientDetectionConfig() {
    return this.config.responsive.clientDetection || {
      enabled: true,
      detectionPriority: ['client-hints', 'browser-compat', 'cf-headers', 'user-agent'],
      useMediaCapabilities: true,
      useBrowserCompatData: true,
      fallbackToUserAgent: true,
      hdrDetection: true,
      batteryAwareness: true,
      adaptiveNetworkQuality: true,
      debug: false
    };
  }
  
  /**
   * Check if a feature is enabled
   */
  public isFeatureEnabled(featureName: string): boolean {
    if (!this.config.features) return true; // Default to enabled if features section missing
    return this.config.features[featureName] !== false; // Default to true if not explicitly disabled
  }
}
```

### 2. Modern Feature Detection Layer

We'll implement a feature detection service that uses multiple detection methods in a priority order, following the configuration:

```typescript
// featureDetectionService.ts
import browserCompat from '@mdn/browser-compat-data';
import { debug, error } from '../utils/loggerUtils';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';

export class FeatureDetectionService {
  private static getConfig() {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.getClientDetectionConfig();
  }
  
  private static isFeatureEnabled(feature: string): boolean {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.isFeatureEnabled(feature);
  }
  
  // Use browser-compat-data for static feature checks
  static hasCodecSupport(codec: string, userAgent: string): boolean {
    const config = this.getConfig();
    debug('FeatureDetectionService', 'Checking codec support', { 
      codec, 
      useBrowserCompatData: config.useBrowserCompatData 
    });
    
    // Check if browser-compat-data is enabled in config
    if (config.useBrowserCompatData && this.isFeatureEnabled('mediaBrowserCompatData')) {
      // Map codecs to browser-compat-data paths
      const compatPaths = {
        'av1': 'api.MediaSource.isTypeSupported.av1',
        'hevc': 'api.MediaSource.isTypeSupported.hevc',
        'vp9': 'api.MediaSource.isTypeSupported.vp9'
      };
      // Implementation that checks browser-compat-data
    }
    
    // Fallback to UA detection if configured
    if (config.fallbackToUserAgent) {
      // Legacy UA detection as fallback
    }
    
    return false;
  }

  // Runtime detection when possible
  static async detectMediaCapabilities(request: Request): Promise<MediaCapabilitiesInfo> {
    const config = this.getConfig();
    debug('FeatureDetectionService', 'Detecting media capabilities', { 
      useMediaCapabilities: config.useMediaCapabilities 
    });
    
    // Use MediaCapabilities API when available and enabled in config
    // Follow the configured detection priority
    // Implement fallbacks based on configuration
  }
}
```

### 3. Adaptive Quality Selection

We'll create a more sophisticated quality selection system, fully integrated with the logging and configuration:

```typescript
// qualitySelectionService.ts
import { debug } from '../utils/loggerUtils';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';

export class QualitySelectionService {
  private static getConfig() {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.getClientDetectionConfig();
  }
  
  private static isFeatureEnabled(feature: string): boolean {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.isFeatureEnabled(feature);
  }
  
  static determineOptimalQuality(
    request: Request, 
    networkQuality: NetworkQualityInfo,
    deviceCapabilities: DeviceCapabilitiesInfo,
    contentComplexity?: ContentComplexityInfo
  ): VideoQualityOptions {
    const config = this.getConfig();
    debug('QualitySelectionService', 'Determining optimal quality', { 
      networkQuality: networkQuality.quality,
      deviceType: deviceCapabilities.deviceType,
      hdrEnabled: config.hdrDetection && deviceCapabilities.supportsHdr,
      batteryAware: config.batteryAwareness
    });
    
    // Sophisticated algorithm that balances factors based on configuration
    // Only use enabled features from configuration
  }
}
```

### 4. HDR Detection and Support

We'll implement proper HDR detection that respects the configuration:

```typescript
// hdrDetectionService.ts
import { debug } from '../utils/loggerUtils';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';
import { FeatureDetectionService } from './featureDetectionService';

export class HdrDetectionService {
  private static getConfig() {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.getClientDetectionConfig();
  }
  
  private static isFeatureEnabled(feature: string): boolean {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.isFeatureEnabled(feature);
  }
  
  static supportsHdr(request: Request): boolean {
    const config = this.getConfig();
    
    // Skip detection if disabled in config or feature flag
    if (!config.hdrDetection || !this.isFeatureEnabled('hdrSupport')) {
      debug('HdrDetectionService', 'HDR detection disabled in config');
      return false;
    }
    
    debug('HdrDetectionService', 'Checking HDR support');
    // Check for HDR support via configured detection methods
    // Follow detection priority from config
  }
  
  static getOptimalHdrFormat(request: Request): string {
    const config = this.getConfig();
    
    // Skip if disabled in config or feature flag
    if (!config.hdrDetection || !this.isFeatureEnabled('hdrSupport')) {
      return 'none';
    }
    
    debug('HdrDetectionService', 'Determining optimal HDR format');
    // Determine best HDR format based on browser and device capabilities
    // Log decision process for debugging
  }
}
```

### 5. Battery Status Awareness

For mobile devices, we'll add battery status detection that respects the configuration:

```typescript
// batteryAwarenessService.ts
import { debug } from '../utils/loggerUtils';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';

export class BatteryAwarenessService {
  private static getConfig() {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.getClientDetectionConfig();
  }
  
  private static isFeatureEnabled(feature: string): boolean {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.isFeatureEnabled(feature);
  }
  
  static getBatteryInfo(request: Request): BatteryInfo {
    const config = this.getConfig();
    
    // Skip if disabled in config or feature flag
    if (!config.batteryAwareness || !this.isFeatureEnabled('batteryAwareness')) {
      debug('BatteryAwarenessService', 'Battery awareness disabled in config');
      return { enabled: false };
    }
    
    debug('BatteryAwarenessService', 'Getting battery information');
    // Check for Battery Status API support
    // Look for low-power mode indicators
    // Apply client-side power saving hints
  }
  
  static adjustQualityForBattery(quality: VideoQualityOptions, batteryInfo: BatteryInfo): VideoQualityOptions {
    const config = this.getConfig();
    
    // Skip if disabled in config, feature flag, or battery info
    if (!config.batteryAwareness || !this.isFeatureEnabled('batteryAwareness') || !batteryInfo.enabled) {
      return quality;
    }
    
    debug('BatteryAwarenessService', 'Adjusting quality for battery', batteryInfo);
    // Reduce quality for low battery
    // Disable high bitrate for power saving mode
    // Implement power-efficient playback options
  }
}
```

### 6. Enhanced Network Quality Detection

We'll improve the network quality detection logic with proper configuration and logging:

```typescript
// networkDetectionService.ts
import { debug } from '../utils/loggerUtils';
import { VideoConfigurationManager } from '../config/VideoConfigurationManager';

export class NetworkDetectionService {
  private static getConfig() {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.getClientDetectionConfig();
  }
  
  private static isFeatureEnabled(feature: string): boolean {
    const configManager = VideoConfigurationManager.getInstance();
    return configManager.isFeatureEnabled(feature);
  }
  
  static getNetworkQuality(request: Request): NetworkQualityInfo {
    const config = this.getConfig();
    debug('NetworkDetectionService', 'Detecting network quality', {
      adaptiveEnabled: config.adaptiveNetworkQuality
    });
    
    // Use detection methods according to configured priority
    // Check ECT (Effective Connection Type) for cellular connections
    // Use downlink and RTT values when available
    // Consider connection stability if enabled in config
  }
  
  static predictiveNetworkAdjustment(videoOptions: VideoOptions, networkInfo: NetworkQualityInfo): VideoOptions {
    const config = this.getConfig();
    
    // Skip if disabled in config or feature flag
    if (!config.adaptiveNetworkQuality || !this.isFeatureEnabled('predictiveBuffering')) {
      return videoOptions;
    }
    
    debug('NetworkDetectionService', 'Applying predictive network adjustments', {
      networkQuality: networkInfo.quality
    });
    
    // Adjust preload behavior based on network
    // Implement smart buffer size recommendations
    // Optimize startup time vs. quality tradeoffs
  }
}
```

## Configuration in wrangler.jsonc

All client detection settings will be configurable through wrangler.jsonc, making it the single source of truth:

```jsonc
// wrangler.jsonc
{
  "name": "video-resizer",
  "main": "src/index.ts",
  "compatibility_date": "2023-09-04",
  "compatibility_flags": ["nodejs_compat"],
  
  "vars": {
    "ENVIRONMENT": "production",
    "DEBUG_ENABLED": "true",
    
    // Integrated client detection in the existing VIDEO_CONFIG
    "VIDEO_CONFIG": {
      "responsive": {
        "breakpoints": {
          "xs": 640,
          "sm": 768,
          "md": 1024,
          "lg": 1280,
          "xl": 1920
        },
        "availableQualities": [360, 480, 720, 1080, 1440, 2160],
        "deviceWidths": {
          "mobile": 480,
          "tablet": 720,
          "desktop": 1080
        },
        "networkQuality": {
          "slow": {
            "maxWidth": 480,
            "maxHeight": 360,
            "maxBitrate": 800
          },
          "medium": {
            "maxWidth": 854, 
            "maxHeight": 480,
            "maxBitrate": 1500
          },
          "fast": {
            "maxWidth": 1280,
            "maxHeight": 720,
            "maxBitrate": 3000
          },
          "ultrafast": {
            "maxWidth": 1920,
            "maxHeight": 1080,
            "maxBitrate": 6000
          }
        },
        // Client detection integrated into responsive config
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
      // Feature flags within the existing VIDEO_CONFIG
      "features": {
        "mediaBrowserCompatData": true,
        "hdrSupport": true,
        "batteryAwareness": true,
        "predictiveBuffering": true
      }
    },
    
    // Path patterns with clientDetection overrides capability
    "PATH_PATTERNS": [
      {
        "name": "videos",
        "matcher": "^/videos/",
        "processPath": true,
        "transformationOverrides": {
          // Path-specific video transformation options
        },
        "clientDetectionOverrides": {
          "hdrDetection": false,
          "batteryAwareness": true
        }
      },
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
  }
}
```

## Development Process

For each component:

1. **Design & Planning**
   - Define interface that integrates with configuration system
   - Document expected behavior
   - Create test specifications that include configuration testing

2. **Implementation**
   - Develop core functionality with configuration awareness
   - Implement fallback mechanisms based on configuration
   - Add proper error handling with logging
   - Ensure all client detection logic respects configuration

3. **Testing & Validation**
   - Run unit tests for each configuration option
   - Verify type safety with `npm run typecheck`
   - Ensure code quality with `npm run lint`
   - Create integration tests with various configuration scenarios

4. **Documentation**
   - Update API documentation
   - Add configuration examples
   - Document limitations and fallbacks
   - Update configuration reference docs

## Integration with Existing System

The client detection enhancements will integrate with the existing architecture:

1. **VideoConfigurationManager** - For centralized configuration using the existing manager
2. **TransformVideoCommand** - For video transformation decisions based on detected capabilities
3. **VideoOptionsService** - For parameter processing and quality selection
4. **CacheManagementService** - For cache strategy decisions based on device capabilities
5. **DebugService** - For reporting detection results in debug mode
6. **Logging Utilities** - For consistent logging of detection decisions using the central logger

## Fallback Strategy

Each detection method will implement a consistent fallback pattern based on configuration from VideoConfigurationManager:

1. Check VideoConfigurationManager to determine enabled detection methods
2. Follow the configured detection priority order from clientDetection.detectionPriority
3. Use only enabled detection methods and feature flags
4. Log each decision and fallback using the central logging utility
5. Handle path-specific overrides from matching PathPatterns

## Timeline

1. **Phase 1: Core Implementation**
   - Extend VideoConfigurationManager with client detection schema
   - Add @mdn/browser-compat-data integration
   - Implement FeatureDetectionService with VideoConfigurationManager support
   - Create basic tests for configuration integration

2. **Phase 2: Enhanced Detection**
   - Implement HDR detection with configuration options
   - Add battery awareness with feature flags
   - Improve network quality detection with configuration
   - Ensure all features respect configuration
   - Add path-specific client detection overrides

3. **Phase 3: Integration & Testing**
   - Integrate with TransformVideoCommand
   - Update VideoOptionsService to use new detection methods
   - Update wrangler.jsonc with new VIDEO_CONFIG options
   - Add tests for different configuration scenarios
   - Implement defensive error handling for all detection methods

4. **Phase 4: Documentation & Optimization**
   - Update configuration reference documentation
   - Add examples for common client detection scenarios
   - Optimize performance and minimize unnecessary detection
   - Add detailed debug information to debug UI
   - Document behavior in different configuration scenarios

## Defensive Coding Approach

For each component:

1. **Run linting**: `npm run lint`
2. **Type check**: `npm run typecheck`
3. **Run tests**: `npm test`
4. **Create specific tests**: `npm test -- -t "test name"`

After any change, we'll ensure:
- No regressions in existing functionality
- Type safety is maintained
- Code quality standards are met
- Tests cover all new functionality
- Configuration options are properly validated
- Default values exist for all configuration options