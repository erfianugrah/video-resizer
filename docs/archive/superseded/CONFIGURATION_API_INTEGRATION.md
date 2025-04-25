# Video Resizer Configuration API Integration Guide

This guide provides specific steps to integrate the new Configuration API with the existing Video Resizer codebase.

## Integration Overview

Integrating the enhanced Configuration API requires changes to:

1. **Project Structure**: Add new files and organize modules
2. **Existing Code**: Update imports and usage patterns
3. **Worker Entry Point**: Modify how configuration is loaded and accessed
4. **Service Initialization**: Change how services access configuration
5. **Wrangler.jsonc**: Update environment variables organization

## Project Structure Changes

Add the following new files to implement the Configuration API:

```
video-resizer/
└── src/
    ├── config/
    │   ├── ConfigurationManager.ts     // Core configuration manager
    │   ├── ConfigStorageService.ts     // KV-based configuration storage
    │   ├── SchemaValidator.ts          // JSON schema validation
    │   ├── defaultConfig.ts            // Default configurations
    │   ├── envConfig.ts                // Environment variable parsing
    │   └── types.ts                    // Configuration interfaces
    ├── handlers/
    │   └── ConfigApiHandler.ts         // API endpoint handler
    └── utils/
        ├── objectUtils.ts              // Deep merge and other utilities
        └── configTransforms.ts         // Config transformation helpers
```

## Step 1: Preserve Backward Compatibility

Create a backward compatibility layer to avoid breaking existing code:

```typescript
// src/config/compatibility.ts
import { ConfigurationManager } from './ConfigurationManager';
import { EnvironmentConfig } from './types';

/**
 * Provides a legacy-compatible configuration object
 * @returns Legacy-format configuration
 */
export function getLegacyEnvironmentConfig(): EnvironmentConfig {
  const configManager = ConfigurationManager.getInstance();
  const config = configManager.getConfig();
  
  // Map new configuration format to old format
  return {
    mode: config.environment,
    isProduction: config.environment === 'production',
    isStaging: config.environment === 'staging',
    isDevelopment: config.environment === 'development',
    version: config.version,
    debug: {
      enabled: config.debug.enabled,
      verbose: config.debug.verbose,
      includeHeaders: config.debug.headers.length > 0,
      includePerformance: config.debug.includePerformance,
      allowedIps: [],
      excludedPaths: []
    },
    cache: {
      method: config.cache.method === 'cf' ? 'cf' : 'cacheApi',
      debug: false,
      defaultTtl: config.cache.ttl.ok,
      respectOrigin: true,
      cacheEverything: config.cache.cacheEverything || false,
      enableTags: config.cache.cacheTags?.enabled || false,
      purgeOnUpdate: false,
      bypassParams: config.cache.bypassParams || ['nocache', 'bypass']
    },
    logging: {
      level: config.logging.level.toLowerCase() as any,
      format: config.logging.enableStructuredLogs ? 'json' : 'text',
      includeTimestamps: config.logging.includeTimestamp,
      includeComponent: true,
      colorize: config.logging.colorize || false,
      enabledComponents: [],
      disabledComponents: [],
      sampleRate: 1,
      performance: config.debug.includePerformance,
      performanceThreshold: 1000
    },
    video: {
      defaultQuality: config.video.quality.defaultValue.toString(),
      defaultCompression: config.video.compression.defaultValue,
      defaultAudio: config.video.audio.defaultEnabled,
      defaultFit: config.video.fit.defaultValue
    },
    cdnCgi: {
      basePath: '/cdn-cgi/media'
    },
    advanced: {
      workerConcurrency: 10,
      requestTimeout: 30000,
      maxVideoSize: 0
    },
    pathPatterns: config.paths.patterns.map(pattern => ({
      name: pattern.name,
      matcher: pattern.matcher,
      processPath: true,
      baseUrl: pattern.baseUrl || null,
      originUrl: pattern.originUrl || null,
      quality: pattern.quality,
      cacheTtl: pattern.cacheTtl,
      priority: pattern.priority,
      captureGroups: pattern.captureGroups
    }))
  };
}
```

## Step 2: Update Entry Point

Modify the worker entry point to use the new configuration system:

```typescript
// src/index.ts
import { handleVideoRequest } from './handlers/videoHandler';
import { ConfigurationManager } from './config/ConfigurationManager';
import { ConfigApiHandler } from './handlers/ConfigApiHandler';
import { initializeLogging } from './utils/loggingManager';
import { createRequestContext } from './utils/requestContext';
import { createLogger, info, error } from './utils/pinoLogger';
import { initializeLegacyLogger } from './utils/legacyLoggerAdapter';

// Global state
let hasInitialized = false;

export default {
  async fetch(request: Request, env: Record<string, any>, ctx: ExecutionContext): Promise<Response> {
    // Create request context and logger
    const context = createRequestContext(request);
    const logger = createLogger(context);
    
    // Legacy logger support
    initializeLegacyLogger(request);
    
    try {
      const url = new URL(request.url);
      
      // Handle configuration API requests
      if (url.pathname.startsWith('/api/config')) {
        const configApiHandler = new ConfigApiHandler();
        return configApiHandler.handleRequest(request);
      }
      
      // Initialize configuration and services
      if (!hasInitialized) {
        // Initialize configuration
        const configManager = ConfigurationManager.getInstance();
        
        // Set KV namespace if available
        if (env.CONFIG_STORE) {
          const storageService = configManager.getStorageService();
          storageService.setKvNamespace(env.CONFIG_STORE);
        }
        
        // Initialize config from environment, KV, etc.
        await configManager.init(env);
        
        // Initialize logging
        const config = configManager.getConfig();
        initializeLogging({
          LOG_LEVEL: config.logging.level,
          LOG_FORMAT: config.logging.enableStructuredLogs ? 'json' : 'text',
          LOG_INCLUDE_TIMESTAMPS: String(config.logging.includeTimestamp),
          LOG_COLORIZE: String(config.logging.colorize || false),
          LOGGING_CONFIG: JSON.stringify({
            pino: {
              level: config.logging.level.toLowerCase(),
              browser: { asObject: config.logging.enableStructuredLogs }
            },
            breadcrumbs: {
              enabled: config.logging.enableBreadcrumbs || false,
              maxItems: 50
            }
          })
        });
        
        info(context, logger, 'Worker', `Initialized video-resizer v${config.version} in ${config.environment} mode`);
        hasInitialized = true;
      }
      
      // Get configuration
      const configManager = ConfigurationManager.getInstance();
      const config = configManager.getConfig();
      
      // Define patterns to skip resizing
      const skipPatterns = [(headers: Headers) => /video-resizing/.test(headers.get('via') || '')];
      
      // Check if we should skip resizing
      const shouldSkip = skipPatterns.some((pattern) => pattern(request.headers));
      
      if (!shouldSkip) {
        return handleVideoRequest(request, config, env);
      }
      
      info(context, logger, 'Worker', 'Skipping video processing, passing through request');
      return fetch(request); // pass-through and continue
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      error(context, logger, 'Worker', 'Unexpected error in worker', {
        error: errorMessage,
        stack: errorStack,
      });
      
      return new Response('An unexpected error occurred', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};
```

## Step 3: Update Video Handler

Update the video handler to use the new configuration structure:

```typescript
// src/handlers/videoHandler.ts
import { VideoResizerConfig } from '../config/types';
import { TransformVideoCommand } from '../domain/commands/TransformVideoCommand';
import { createRequestContext } from '../utils/requestContext';
import { createLogger, info } from '../utils/pinoLogger';

export async function handleVideoRequest(
  request: Request,
  config: VideoResizerConfig,
  env: Record<string, any>
): Promise<Response> {
  // Create context and logger
  const context = createRequestContext(request);
  const logger = createLogger(context);
  
  info(context, logger, 'VideoHandler', 'Processing video request', {
    url: request.url,
    method: request.method
  });
  
  // Create command to transform the video
  const command = new TransformVideoCommand(config, env);
  
  // Execute command
  return command.execute(request, context);
}
```

## Step 4: Update Command Implementation

Update the TransformVideoCommand to use the new configuration structure:

```typescript
// src/domain/commands/TransformVideoCommand.ts
import { VideoResizerConfig } from '../../config/types';
import { VideoTransformationService } from '../services/VideoTransformationService';
import { CacheManagementService } from '../services/CacheManagementService';
import { DebugService } from '../services/DebugService';
import { createLogger, info, debug } from '../../utils/pinoLogger';
import { buildCdnCgiMediaUrl } from '../../utils/pathUtils';
import { matchPathWithCaptures } from '../../utils/pathUtils';

export class TransformVideoCommand {
  private config: VideoResizerConfig;
  private env: Record<string, any>;
  private videoService: VideoTransformationService;
  private cacheService: CacheManagementService;
  private debugService: DebugService;
  
  constructor(config: VideoResizerConfig, env: Record<string, any>) {
    this.config = config;
    this.env = env;
    
    // Initialize services with new config structure
    this.videoService = new VideoTransformationService(config.video, config.derivatives);
    this.cacheService = new CacheManagementService(config.cache);
    this.debugService = new DebugService(config.debug);
  }
  
  async execute(request: Request, context: any): Promise<Response> {
    const logger = createLogger(context);
    const url = new URL(request.url);
    
    debug(context, logger, 'TransformVideoCommand', 'Executing command', {
      path: url.pathname,
      search: url.search
    });
    
    // Find matching path pattern
    const pathMatch = matchPathWithCaptures(url.pathname, this.config.paths.patterns);
    
    // Get video transformation options
    const transformOptions = await this.videoService.getTransformOptions(request, pathMatch);
    
    // Apply client detection if enabled
    if (this.config.features?.enableClientDetection && this.config.video.clientDetection?.enabled) {
      await this.videoService.applyClientDetection(transformOptions, request, context);
    }
    
    // Build the CDN-CGI URL
    const cdnUrl = buildCdnCgiMediaUrl(transformOptions, request.url);
    
    // Create the request for the CDN
    const cdnRequest = new Request(cdnUrl, {
      method: request.method,
      headers: request.headers
    });
    
    // Apply cache settings
    const cacheOptions = this.cacheService.getCacheOptions(pathMatch);
    
    // Add debug headers if enabled
    if (this.debugService.isDebugEnabled(request)) {
      this.debugService.addDebugHeaders(cdnRequest, {
        originalUrl: request.url,
        transformOptions,
        pathPattern: pathMatch?.pattern?.name || 'none'
      });
    }
    
    // Fetch with cache settings
    const response = await fetch(cdnRequest, {
      cf: cacheOptions
    });
    
    return response;
  }
}
```

## Step 5: Update Service Implementations

Update the VideoTransformationService to use the new configuration structure:

```typescript
// src/domain/services/VideoTransformationService.ts

export class VideoTransformationService {
  private videoConfig: any;
  private derivatives: Record<string, any>;
  
  constructor(videoConfig: any, derivatives: Record<string, any>) {
    this.videoConfig = videoConfig;
    this.derivatives = derivatives;
  }
  
  async getTransformOptions(request: Request, pathMatch: any): Promise<Record<string, any>> {
    // Default options
    const options: Record<string, any> = {
      width: 'auto',
      height: 'auto',
      quality: this.videoConfig.quality.defaultValue,
      compression: this.videoConfig.compression.defaultValue,
      fit: this.videoConfig.fit.defaultValue,
      audio: this.videoConfig.audio.defaultEnabled ? 'on' : 'off'
    };
    
    // Apply path pattern specific options
    if (pathMatch?.pattern?.transformParams) {
      Object.assign(options, pathMatch.pattern.transformParams);
    }
    
    // Apply quality preset if specified
    if (pathMatch?.pattern?.quality) {
      const qualityPreset = pathMatch.pattern.quality;
      if (this.videoConfig.quality.presets[qualityPreset]) {
        options.quality = this.videoConfig.quality.presets[qualityPreset];
      }
    }
    
    // Apply derivative template if specified in URL
    const url = new URL(request.url);
    const derivativeName = url.searchParams.get('derivative');
    if (derivativeName && this.derivatives[derivativeName]) {
      const derivative = this.derivatives[derivativeName];
      Object.assign(options, derivative);
    }
    
    // Parse URL options (override defaults)
    this.parseUrlOptions(url, options);
    
    return options;
  }
  
  async applyClientDetection(
    options: Record<string, any>,
    request: Request,
    context: any
  ): Promise<void> {
    // Implement client detection based on new config structure
    // (Implementation details omitted for brevity)
  }
  
  private parseUrlOptions(url: URL, options: Record<string, any>): void {
    // Parse width and height
    if (url.searchParams.has('width')) {
      options.width = url.searchParams.get('width');
    }
    
    if (url.searchParams.has('height')) {
      options.height = url.searchParams.get('height');
    }
    
    // Parse quality
    if (url.searchParams.has('quality')) {
      options.quality = url.searchParams.get('quality');
    }
    
    // Parse compression
    if (url.searchParams.has('compression')) {
      options.compression = url.searchParams.get('compression');
    }
    
    // Parse fit
    if (url.searchParams.has('fit')) {
      const fit = url.searchParams.get('fit');
      if (this.videoConfig.fit.allowedValues.includes(fit)) {
        options.fit = fit;
      }
    }
    
    // Parse audio
    if (url.searchParams.has('audio')) {
      options.audio = url.searchParams.get('audio') === 'true' ? 'on' : 'off';
    }
    
    // Parse playback options
    if (url.searchParams.has('loop')) {
      options.loop = url.searchParams.get('loop') === 'true';
    }
    
    if (url.searchParams.has('autoplay')) {
      options.autoplay = url.searchParams.get('autoplay') === 'true';
    }
    
    if (url.searchParams.has('muted')) {
      options.muted = url.searchParams.get('muted') === 'true';
    }
  }
}
```

## Step 6: Update Wrangler.jsonc

Update the wrangler.jsonc file to organize environment variables according to the new configuration structure:

```jsonc
{
  "name": "video-resizer",
  "main": "src/index.ts",
  "compatibility_date": "2023-07-10",
  "env": {
    "development": {
      "vars": {
        "ENVIRONMENT": "development",
        "VERSION": "1.0.0",
        
        // Feature flags
        "ENABLE_ADVANCED_ENCODING": "true",
        "ENABLE_CLIENT_DETECTION": "true",
        
        // Debug settings
        "DEBUG_ENABLED": "true",
        "DEBUG_VERBOSE": "true",
        "DEBUG_INCLUDE_PERFORMANCE": "true",
        
        // Logging settings
        "LOG_LEVEL": "DEBUG",
        "LOG_FORMAT": "text",
        "LOG_INCLUDE_TIMESTAMPS": "true",
        "LOG_COLORIZE": "true",
        "LOGGING_CONFIG": "{\"pino\":{\"level\":\"debug\",\"browser\":{\"asObject\":false}},\"breadcrumbs\":{\"enabled\":true,\"maxItems\":50}}",
        
        // Cache settings
        "CACHE_METHOD": "cache-api",
        "CACHE_DEFAULT_TTL": "60",
        "CACHE_EVERYTHING": "true",
        "CACHE_ENABLE_TAGS": "true",
        
        // Video settings
        "VIDEO_DEFAULT_QUALITY": "720",
        "VIDEO_DEFAULT_COMPRESSION": "medium",
        "VIDEO_DEFAULT_AUDIO": "true",
        "VIDEO_DEFAULT_FIT": "contain",
        
        // Path patterns (simplified example)
        "PATH_PATTERNS": "[{\"name\":\"videos\",\"matcher\":\"^/videos/([^/]+)$\",\"priority\":100,\"captureGroups\":[\"videoId\"]}]"
      },
      "kv_namespaces": [
        {
          "binding": "CONFIG_STORE",
          "id": "your-dev-kv-namespace-id"
        }
      ]
    },
    "production": {
      "vars": {
        "ENVIRONMENT": "production",
        "VERSION": "1.0.0",
        
        // Feature flags
        "ENABLE_ADVANCED_ENCODING": "true",
        "ENABLE_CLIENT_DETECTION": "true",
        
        // Debug settings
        "DEBUG_ENABLED": "false",
        
        // Logging settings
        "LOG_LEVEL": "INFO",
        "LOG_FORMAT": "json",
        "LOG_INCLUDE_TIMESTAMPS": "true",
        
        // Cache settings
        "CACHE_METHOD": "cf",
        "CACHE_DEFAULT_TTL": "86400",
        "CACHE_EVERYTHING": "true",
        "CACHE_ENABLE_TAGS": "true",
        
        // Video settings
        "VIDEO_DEFAULT_QUALITY": "720",
        "VIDEO_DEFAULT_COMPRESSION": "medium",
        "VIDEO_DEFAULT_AUDIO": "true",
        "VIDEO_DEFAULT_FIT": "contain"
      },
      "kv_namespaces": [
        {
          "binding": "CONFIG_STORE",
          "id": "your-prod-kv-namespace-id"
        }
      ]
    }
  }
}
```

## Step 7: Generate Configuration Schemas

Create JSON Schema definitions for configuration validation:

```typescript
// src/config/schemas.ts
export const videoSchema = {
  type: 'object',
  properties: {
    quality: {
      type: 'object',
      properties: {
        auto: { type: 'boolean' },
        defaultValue: { type: 'number' },
        presets: { 
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        formatQuality: {
          type: 'object',
          additionalProperties: { type: 'number' }
        }
      },
      required: ['auto', 'defaultValue', 'presets']
    },
    compression: {
      type: 'object',
      properties: {
        auto: { type: 'boolean' },
        defaultValue: { type: 'string' },
        presets: {
          type: 'object',
          additionalProperties: { type: 'string' }
        }
      },
      required: ['auto', 'defaultValue', 'presets']
    },
    fit: {
      type: 'object',
      properties: {
        defaultValue: { type: 'string' },
        allowedValues: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['defaultValue', 'allowedValues']
    },
    audio: {
      type: 'object',
      properties: {
        defaultEnabled: { type: 'boolean' },
        controlsEnabled: { type: 'boolean' }
      },
      required: ['defaultEnabled']
    },
    playback: {
      type: 'object',
      properties: {
        loop: { type: 'boolean' },
        autoplay: { type: 'boolean' },
        muted: { type: 'boolean' },
        preload: { type: 'string' }
      }
    },
    clientDetection: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        strategies: {
          type: 'object',
          properties: {
            clientHints: {
              type: 'object',
              properties: {
                priority: { type: 'number' },
                enabled: { type: 'boolean' }
              }
            },
            userAgent: {
              type: 'object',
              properties: {
                priority: { type: 'number' },
                enabled: { type: 'boolean' },
                maxUALength: { type: 'number' }
              }
            },
            saveData: {
              type: 'object',
              properties: {
                priority: { type: 'number' },
                enabled: { type: 'boolean' }
              }
            },
            queryParams: {
              type: 'object',
              properties: {
                priority: { type: 'number' },
                enabled: { type: 'boolean' },
                paramNames: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }
};

export const cacheSchema = {
  type: 'object',
  properties: {
    method: { 
      type: 'string',
      enum: ['cf', 'cache-api', 'none']
    },
    ttl: {
      type: 'object',
      properties: {
        ok: { type: 'number' },
        clientError: { type: 'number' },
        serverError: { type: 'number' },
        remoteFetch: { type: 'number' }
      },
      required: ['ok', 'clientError', 'serverError']
    },
    cacheEverything: { type: 'boolean' },
    useTtlByStatus: { type: 'boolean' },
    statusRanges: {
      type: 'object',
      properties: {
        success: { type: 'string' },
        redirect: { type: 'string' },
        notFound: { type: 'string' },
        serverError: { type: 'string' }
      }
    },
    cacheTtlByStatus: {
      type: 'object',
      additionalProperties: { type: 'number' }
    },
    bypassParams: {
      type: 'array',
      items: { type: 'string' }
    },
    cacheTags: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        prefix: { type: 'string' },
        includeVideoParameters: { type: 'boolean' },
        includeQuality: { type: 'boolean' },
        includeFormat: { type: 'boolean' },
        includeDerivative: { type: 'boolean' },
        customTags: {
          type: 'array',
          items: { type: 'string' }
        },
        pathBasedTags: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        maxTags: { type: 'number' },
        simplifiedTags: { type: 'boolean' }
      },
      required: ['enabled']
    }
  },
  required: ['method', 'ttl']
};

// Add more schemas as needed
```

## Step 8: Initialize All Components

Create an initialization module to set up all components:

```typescript
// src/config/initialize.ts
import { ConfigurationManager } from './ConfigurationManager';
import { SchemaValidator } from './SchemaValidator';
import { videoSchema, cacheSchema, debugSchema, loggingSchema } from './schemas';

/**
 * Initialize the configuration system
 */
export async function initializeConfig(env: Record<string, any>): Promise<void> {
  // Register schemas
  const schemaValidator = new SchemaValidator();
  schemaValidator.registerSchema('video', videoSchema);
  schemaValidator.registerSchema('cache', cacheSchema);
  schemaValidator.registerSchema('debug', debugSchema);
  schemaValidator.registerSchema('logging', loggingSchema);
  
  // Initialize the configuration manager
  const configManager = ConfigurationManager.getInstance();
  
  // Set up KV namespace if available
  if (env.CONFIG_STORE) {
    const storageService = configManager.getStorageService();
    storageService.setKvNamespace(env.CONFIG_STORE);
  }
  
  // Initialize configuration
  await configManager.init(env);
  
  // Set up the schema validator
  configManager.setSchemaValidator(schemaValidator);
}
```

## Migration Strategy

To migrate smoothly from the old to the new configuration system:

1. **Dual Support Phase**
   - Implement the new system alongside the old one
   - Use the compatibility layer to maintain backward compatibility
   - Test thoroughly with both old and new code paths

2. **Service Migration**
   - Update each service one by one to use the new configuration
   - Start with non-critical services to minimize risk
   - Maintain backward compatibility during the transition

3. **Configuration Migration**
   - Create a script to convert old configuration to new format
   - Pre-populate KV storage with converted configuration
   - Validate the migrated configuration against schemas

4. **Complete Transition**
   - Remove old configuration access patterns
   - Clean up compatibility layer
   - Update documentation and examples

## Example: Adding a New Derivative

With the new system, adding a configuration option like a video derivative is simple:

1. **Via the API**
```bash
curl -X PATCH https://video-resizer.example.com/api/config/modules/derivatives \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "settings": {
      "mobile-optimized": {
        "width": 640,
        "height": 360,
        "quality": 65,
        "compression": "high",
        "fit": "contain",
        "audio": true,
        "muted": false
      }
    },
    "activate": true
  }'
```

2. **Via Environment Variables**
```jsonc
// wrangler.jsonc
{
  "vars": {
    "DERIVATIVE_MOBILE_OPTIMIZED": "{\"width\":640,\"height\":360,\"quality\":65,\"compression\":\"high\",\"fit\":\"contain\",\"audio\":true,\"muted\":false}"
  }
}
```

3. **Via Default Configuration**
```typescript
// config/defaultConfig.ts
export const defaultConfig: VideoResizerConfig = {
  // ...
  derivatives: {
    // ...
    "mobile-optimized": {
      width: 640,
      height: 360,
      quality: 65,
      compression: "high",
      fit: "contain",
      audio: true,
      muted: false
    }
  }
};
```

## Testing the Integration

Create unit tests to verify the integration:

```typescript
// tests/config-integration.test.ts
import { ConfigurationManager } from '../src/config/ConfigurationManager';
import { VideoTransformationService } from '../src/domain/services/VideoTransformationService';

describe('Configuration Integration', () => {
  beforeEach(() => {
    // Reset the ConfigurationManager singleton
    // This is a test-only method that would need to be added
    ConfigurationManager.reset();
  });
  
  test('ConfigurationManager correctly initializes from environment', async () => {
    const env = {
      ENVIRONMENT: 'development',
      VERSION: '1.0.0',
      DEBUG_ENABLED: 'true',
      CACHE_METHOD: 'cache-api',
      VIDEO_DEFAULT_QUALITY: '720'
    };
    
    const configManager = ConfigurationManager.getInstance();
    await configManager.init(env);
    
    const config = configManager.getConfig();
    expect(config.environment).toBe('development');
    expect(config.version).toBe('1.0.0');
    expect(config.debug.enabled).toBe(true);
    expect(config.cache.method).toBe('cache-api');
    expect(config.video.quality.defaultValue).toBe(720);
  });
  
  test('VideoTransformationService correctly uses configuration', async () => {
    // Setup test configuration
    const config = {
      video: {
        quality: {
          auto: true,
          defaultValue: 720,
          presets: {
            low: 360,
            medium: 480,
            high: 720
          }
        },
        compression: {
          auto: true,
          defaultValue: 'medium',
          presets: {
            low: 'high',
            medium: 'medium',
            high: 'low'
          }
        },
        fit: {
          defaultValue: 'contain',
          allowedValues: ['contain', 'cover', 'crop']
        },
        audio: {
          defaultEnabled: true,
          controlsEnabled: true
        }
      },
      derivatives: {
        'test-derivative': {
          width: 320,
          height: 240,
          quality: 60
        }
      }
    };
    
    const service = new VideoTransformationService(config.video, config.derivatives);
    
    // Test request with derivative
    const request = new Request('https://example.com/video.mp4?derivative=test-derivative');
    const options = await service.getTransformOptions(request, null);
    
    expect(options.width).toBe(320);
    expect(options.height).toBe(240);
    expect(options.quality).toBe(60);
  });
});
```

## Conclusion

This integration guide provides a detailed roadmap for implementing the Configuration API in the Video Resizer project. By following these steps, you'll achieve:

1. A modular, type-safe configuration system
2. Versioned configuration with rollback capability
3. An API for dynamic configuration updates
4. Schema validation for configuration values
5. Smooth migration from the existing system

The implementation preserves backward compatibility while adding powerful new features, making the Video Resizer more flexible, maintainable, and robust.