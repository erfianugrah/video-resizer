# Configuration API Comparison and Migration

This document provides a detailed comparison between the existing video-resizer configuration system and the proposed image-resizer-2 inspired system, highlighting key integration points and migration strategies.

## Current Video-Resizer Configuration System

The current video-resizer project has a well-structured configuration system with:

1. **Singleton Configuration Managers**:
   - `VideoConfigurationManager`: Video transformation settings
   - `CacheConfigurationManager`: Cache behavior settings
   - `DebugConfigurationManager`: Debug settings
   - `LoggingConfigurationManager`: Logging settings

2. **Schema Validation**:
   - Uses Zod for schema validation
   - Type-safe configuration with TypeScript interfaces
   - Validation at runtime

3. **Configuration Initialization**:
   - Loaded from environment variables
   - Accessed through configuration managers
   - Configuration exported via `config/index.ts`

4. **Configuration Categories**:
   - Video derivatives (high, medium, low, mobile, thumbnail, etc.)
   - Path patterns for URL matching
   - Cache profiles with TTL settings
   - Debug options
   - Logging options

## Image-Resizer-2 Configuration System

The image-resizer-2 project has a more comprehensive configuration system:

1. **Layered Configuration Structure**:
   - Default values
   - Environment-specific defaults
   - Environment variables
   - KV-stored configuration
   - Runtime overrides

2. **Configuration API**:
   - REST API for configuration management
   - Versioning with history
   - Schema validation
   - Environment variable interpolation

3. **Feature Flags**:
   - Environment-specific feature toggles
   - Conditional activation

4. **Advanced Configuration Storage**:
   - KV-based persistence
   - Versioning and rollback capability
   - Diff and comparison tools

## Key Differences and Integration Points

### 1. Architectural Approach

**Current System**:
- Multiple independent configuration managers
- Each manager handles its own domain
- Configuration loaded at startup from environment

**Image-Resizer-2 System**:
- Unified configuration manager
- Layered configuration resolution
- KV-based persistence and versioning
- REST API for configuration management

### 2. Schema Validation

**Current System**:
- Uses Zod for validation
- Schema defined within each configuration manager
- Separate validation for each configuration domain

**Image-Resizer-2 System**:
- Uses JSON Schema for validation
- Centralized schema registry
- Single validation for entire configuration

### 3. Storage Mechanism

**Current System**:
- Environment variables and defaults
- No persistent storage beyond environment

**Image-Resizer-2 System**:
- KV storage for configuration
- Versioning with metadata
- History tracking

### 4. API Access

**Current System**:
- No API for configuration management
- Configuration only changed via environment or code

**Image-Resizer-2 System**:
- REST API endpoints
- Authentication and authorization
- Versioning and rollback

## Migration Approach

To bridge these differences while preserving existing functionality, the implementation should:

### 1. Create a Unified Configuration System

Implement a unified `ConfigurationManager` that:
- Uses the existing managers for backward compatibility
- Adds new KV storage and versioning capability
- Supports layered configuration resolution

```typescript
// config/ConfigurationManager.ts
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private config: VideoResizerConfig;
  private storageService: ConfigStorageService;
  
  // Legacy managers for backward compatibility
  private videoConfigManager: VideoConfigurationManager;
  private cacheConfigManager: CacheConfigurationManager;
  private debugConfigManager: DebugConfigurationManager;
  private loggingConfigManager: LoggingConfigurationManager;
  
  private constructor() {
    // Initialize legacy managers
    this.videoConfigManager = VideoConfigurationManager.getInstance();
    this.cacheConfigManager = CacheConfigurationManager.getInstance();
    this.debugConfigManager = DebugConfigurationManager.getInstance();
    this.loggingConfigManager = LoggingConfigurationManager.getInstance();
    
    // Initialize storage service
    this.storageService = new ConfigStorageService();
    
    // Initialize default config
    this.config = this.buildDefaultConfig();
  }
  
  // Build default config from legacy managers
  private buildDefaultConfig(): VideoResizerConfig {
    return {
      environment: 'development',
      version: '1.0.0',
      
      // Map from VideoConfigurationManager
      video: {
        quality: { /* ... */ },
        compression: { /* ... */ },
        fit: { /* ... */ },
        audio: { /* ... */ },
        playback: { /* ... */ },
        clientDetection: { /* ... */ }
      },
      
      // Map from CacheConfigurationManager
      cache: {
        method: this.cacheConfigManager.getCacheMethod() as any,
        ttl: { /* ... */ },
        cacheEverything: this.cacheConfigManager.getConfig().cacheEverything,
        // ...
      },
      
      // Map from DebugConfigurationManager
      debug: {
        enabled: this.debugConfigManager.isEnabled(),
        // ...
      },
      
      // Map from LoggingConfigurationManager
      logging: {
        level: this.loggingConfigManager.getLogLevel() as any,
        // ...
      },
      
      // Other config sections...
    };
  }
  
  // Rest of implementation (init, getConfig, etc.)
}
```

### 2. Implement Backward Compatibility Layer

Create a compatibility layer that maps between the old and new configuration systems:

```typescript
// config/compatibility.ts

/**
 * Updates legacy configuration managers from the unified config
 */
export function syncLegacyManagers(config: VideoResizerConfig): void {
  // Update VideoConfigurationManager
  VideoConfigurationManager.getInstance().updateConfig({
    defaults: {
      quality: config.video.quality.defaultValue,
      compression: config.video.compression.defaultValue,
      // ...
    },
    // ...
  });
  
  // Update CacheConfigurationManager
  CacheConfigurationManager.getInstance().updateConfig({
    method: config.cache.method,
    defaultMaxAge: config.cache.ttl.ok,
    // ...
  });
  
  // Update DebugConfigurationManager
  DebugConfigurationManager.getInstance().updateConfig({
    enabled: config.debug.enabled,
    verbose: config.debug.verbose,
    // ...
  });
  
  // Update LoggingConfigurationManager
  LoggingConfigurationManager.getInstance().updateConfig({
    level: config.logging.level.toLowerCase() as any,
    // ...
  });
}

/**
 * Get environment config in the legacy format
 */
export function getLegacyEnvironmentConfig(config: VideoResizerConfig): EnvironmentConfig {
  return {
    mode: config.environment,
    isProduction: config.environment === 'production',
    isStaging: config.environment === 'staging',
    isDevelopment: config.environment === 'development',
    // ...
  };
}
```

### 3. Incremental Service Migration

Migrate services one-by-one to use the new unified configuration:

```typescript
// Before: Using legacy configuration
const videoConfig = VideoConfigurationManager.getInstance();
const derivative = videoConfig.getDerivative('mobile');

// After: Using unified configuration
const configManager = ConfigurationManager.getInstance();
const config = configManager.getConfig();
const derivative = config.derivatives.mobile;
```

### 4. API Endpoints Implementation

Add API endpoints that integrate with both systems during transition:

```typescript
// handlers/ConfigApiHandler.ts
export class ConfigApiHandler {
  private configManager = ConfigurationManager.getInstance();
  
  public async handleRequest(request: Request): Promise<Response> {
    // Handle API request using the new ConfigurationManager
    // But also sync with legacy managers after updates
    
    // Example: Update config via API and sync legacy managers
    if (request.method === 'POST' && request.url.endsWith('/api/config')) {
      const body = await request.json();
      await this.configManager.updateConfig(body.modules);
      
      // Sync with legacy managers for backward compatibility
      syncLegacyManagers(this.configManager.getConfig());
      
      return new Response(/* ... */);
    }
    
    // Other handlers...
  }
}
```

## Specific Implementation Differences

### Configuration Structure Mapping

Here's how the current configuration maps to the proposed structure:

| Current System | Proposed System |
|----------------|----------------|
| `VideoConfigurationManager.defaults` | `config.video` + `config.derivatives` |
| `CacheConfigurationManager.profiles` | `config.cache.pathBasedTtl` + `config.cache.cacheTags.pathBasedTags` |
| `DebugConfigurationManager.config` | `config.debug` |
| `LoggingConfigurationManager.config` | `config.logging` |
| Path patterns | `config.paths.patterns` |

### Zod Schema to JSON Schema Conversion

The current system uses Zod for validation. The new system should map these to JSON schemas:

```typescript
// Example of converting Zod schema to JSON Schema
const videoSchemaJson = {
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
        }
      },
      required: ['auto', 'defaultValue', 'presets']
    },
    // ...
  }
};
```

### Configuration Initialization Differences

Current initialization in `initializeConfiguration()` vs. new initialization:

```typescript
// Current initialization in config/index.ts
export function initializeConfiguration(env?: EnvVariables): ConfigurationSystem {
  if (env) {
    applyEnvironmentVariables(env);
  }
  
  return {
    videoConfig: VideoConfigurationManager.getInstance(),
    loggingConfig: LoggingConfigurationManager.getInstance(),
    cacheConfig: CacheConfigurationManager.getInstance(),
    debugConfig: DebugConfigurationManager.getInstance(),
  };
}

// New initialization in ConfigurationManager
public async init(env: Record<string, any>): Promise<void> {
  // 1. Start with defaults
  let mergedConfig = { ...defaultConfig };
  
  // 2. Apply environment-specific defaults
  const environment = (env.ENVIRONMENT || 'development').toLowerCase();
  if (environmentConfigs[environment]) {
    mergedConfig = deepMerge(mergedConfig, environmentConfigs[environment]);
  }
  
  // 3. Apply environment variables
  const envConfig = getConfigFromEnv(env);
  mergedConfig = deepMerge(mergedConfig, envConfig);
  
  // 4. Load stored configuration (if available)
  try {
    const storedConfig = await this.storageService.getActiveConfig();
    if (storedConfig) {
      this.configId = storedConfig.id;
      this.configVersion = storedConfig.version;
      mergedConfig = deepMerge(mergedConfig, storedConfig.config);
    }
  } catch (err) {
    console.warn('Failed to load stored configuration, using defaults', err);
  }
  
  // 5. Set the merged configuration
  this.config = mergedConfig;
  
  // 6. Sync with legacy managers
  syncLegacyManagers(this.config);
}
```

## Top-Level Components Integration

### 1. `index.ts` Integration

The worker entry point (`index.ts`) needs to be updated to use the new configuration system while maintaining compatibility:

```typescript
// src/index.ts
import { ConfigurationManager } from './config/ConfigurationManager';
import { getLegacyEnvironmentConfig } from './config/compatibility';
// ...

export default {
  async fetch(request: Request, env: Record<string, any>, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      
      // Handle configuration API requests
      if (url.pathname.startsWith('/api/config')) {
        const configApiHandler = new ConfigApiHandler();
        return configApiHandler.handleRequest(request);
      }
      
      // Initialize the unified configuration
      const configManager = ConfigurationManager.getInstance();
      if (!configManager.isInitialized()) {
        await configManager.init(env);
      }
      
      // Get both new and legacy-format configurations
      const config = configManager.getConfig();
      const legacyConfig = getLegacyEnvironmentConfig(config);
      
      // Process request
      if (shouldProcess(request)) {
        // Can use either the new or old config format
        // During migration, services will be updated one by one
        return handleVideoRequest(request, config, legacyConfig, env);
      }
      
      return fetch(request);
    } catch (err) {
      // Error handling...
    }
  }
};
```

### 2. `handleVideoRequest` Integration

The video handler function should support both new and legacy configurations during migration:

```typescript
// handlers/videoHandler.ts
export async function handleVideoRequest(
  request: Request,
  config: VideoResizerConfig,
  legacyConfig: EnvironmentConfig,
  env: Record<string, any>
): Promise<Response> {
  // During migration, some services might use legacy config, others might use new config
  
  // Option 1: Use the legacy config for now (backward compatibility)
  const command = new TransformVideoCommand(legacyConfig, env);
  
  // Option 2: Use the new config format (after service is updated)
  // const command = new TransformVideoCommand(config, env);
  
  return command.execute(request);
}
```

## Hybrid Deployment Strategy

To ensure a smooth transition, use a hybrid deployment strategy:

1. **Phase 1**: Add new configuration system alongside existing one
   - Implement `ConfigurationManager` and `ConfigStorageService`
   - Keep using legacy managers
   - Add compatibility layer

2. **Phase 2**: Add configuration API endpoints
   - Implement REST API for configuration management
   - Ensure changes propagate to legacy managers
   - Support versioning and rollbacks

3. **Phase 3**: Migrate services one by one
   - Update services to use the new configuration format
   - Keep compatibility layer for remaining services
   - Add tests for both configurations

4. **Phase 4**: Complete transition
   - Remove dependency on legacy managers
   - Optimize configuration resolution
   - Clean up compatibility code

## Potential Challenges and Solutions

### 1. Different Schema Validation Approaches

**Challenge**: The existing system uses Zod while the proposed system uses JSON Schema.

**Solution**: Create adapter functions that convert between Zod and JSON Schema formats, or maintain both validation systems during transition.

### 2. Singleton Pattern Conflicts

**Challenge**: Both systems use singletons that might conflict.

**Solution**: Implement careful initialization order and explicit reset methods for testing.

### 3. Runtime Performance Impact

**Challenge**: Adding additional layers of configuration resolution might impact performance.

**Solution**: Implement caching of merged configurations and use a single resolution per request.

### 4. KV Storage Latency

**Challenge**: KV operations are asynchronous and might add latency.

**Solution**: Use in-memory caching for configurations and only load from KV during initialization.

## Conclusion

The video-resizer project already has a solid configuration foundation with singleton managers, schema validation, and type safety. The proposed enhancement adds valuable capabilities like versioning, API access, and persistent storage.

By implementing a careful migration strategy with backward compatibility, the project can adopt the image-resizer-2 configuration patterns while preserving existing functionality and ensuring a smooth transition for developers.