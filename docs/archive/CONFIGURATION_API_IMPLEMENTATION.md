# Video Resizer Configuration API Implementation

This document outlines a comprehensive implementation strategy for enhancing the Video Resizer Configuration API based on the architecture and patterns from the image-resizer-2 project.

## Overview

The enhanced Video Resizer Configuration API will provide a robust system for managing configuration through multiple complementary mechanisms:

1. **Environment Variables**: Base configuration through Wrangler environment variables
2. **KV Storage**: Persistent configuration storage with versioning
3. **REST API**: Dynamic configuration changes via API endpoints
4. **Module System**: Modular configuration with schema validation
5. **Feature Flags**: Environment-specific feature toggles

## Core Architecture

### Layered Configuration

The configuration system uses a layered approach where settings are applied in the following order (later layers override earlier ones):

1. **Default values**: Hardcoded sensible defaults
2. **Environment-specific defaults**: Values for development/staging/production
3. **Environment variables**: Values from Wrangler config
4. **Stored configuration**: Values from KV storage
5. **Runtime overrides**: Temporary overrides via API

### Type-Safe Configuration

All configuration uses TypeScript interfaces for type safety:

```typescript
// Core configuration structure
export interface VideoResizerConfig {
  // Core configuration
  environment: 'development' | 'staging' | 'production';
  version: string;
  
  // Feature flags
  features?: {
    enableAdvancedEncoding?: boolean;
    enableClientDetection?: boolean;
    enableExperimentalFormats?: boolean;
  };
  
  // Debug settings
  debug: {
    enabled: boolean;
    headers: string[];
    allowedEnvironments: string[];
    verbose: boolean;
    includePerformance: boolean;
    forceDebugHeaders?: boolean;
    prefix?: string;
    headerNames?: Record<string, string>;
    performanceTracking?: boolean;
  };
  
  // Logging settings
  logging: {
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    includeTimestamp: boolean;
    enableStructuredLogs: boolean;
    enableBreadcrumbs?: boolean;
    enableCacheMetrics?: boolean;
    usePino?: boolean;
    prettyPrint?: boolean;
    colorize?: boolean;
  };
  
  // Cache settings
  cache: {
    method: 'cf' | 'cache-api' | 'none';
    ttl: {
      ok: number;           // TTL for successful responses (200-299)
      clientError: number;  // TTL for client error responses (400-499)
      serverError: number;  // TTL for server error responses (500-599)
      remoteFetch?: number; // TTL for remote fetch requests
    };
    cacheEverything?: boolean;
    useTtlByStatus?: boolean;
    statusRanges?: {
      success: string;    // Success status range (default: "200-299")
      redirect: string;   // Redirect status range (default: "301-302")
      notFound: string;   // Not found status code (default: "404")
      serverError: string; // Server error range (default: "500-599")
    };
    cacheTtlByStatus?: Record<string, number>;
    bypassParams?: string[];
    cacheTags?: {
      enabled: boolean;
      prefix?: string;
      includeVideoParameters: boolean;
      includeQuality: boolean;
      includeFormat: boolean;
      includeDerivative: boolean;
      customTags?: string[];
      pathBasedTags?: Record<string, string[]>;
      maxTags?: number;
      simplifiedTags?: boolean;
    };
    enableStaleWhileRevalidate?: boolean;
    staleWhileRevalidatePercentage?: number;
    enableBackgroundCaching?: boolean;
    minTtl?: number;
    maxTtl?: number;
    pathBasedTtl?: Record<string, number>;
    bypassPaths?: string[];
    bypassInDevelopment?: boolean;
    varyOnClientHints?: boolean;
    varyOnUserAgent?: boolean;
    varyOnSaveData?: boolean;
  };
  
  // Video transformation settings
  video: {
    quality: {
      auto: boolean;
      defaultValue: number;
      presets: Record<string, number>;
      formatQuality?: Record<string, number>;
    };
    compression: {
      auto: boolean;
      defaultValue: string;
      presets: Record<string, string>;
    };
    fit: {
      defaultValue: string;
      allowedValues: string[];
    };
    audio: {
      defaultEnabled: boolean;
      controlsEnabled: boolean;
    };
    playback: {
      loop: boolean;
      autoplay: boolean;
      muted: boolean;
      preload: string;
    };
    // Client detection cascade configuration
    clientDetection?: {
      enabled: boolean;
      strategies: {
        clientHints: {
          priority: number;
          enabled: boolean;
        };
        userAgent: {
          priority: number;
          enabled: boolean;
          maxUALength: number;
        };
        saveData: {
          priority: number;
          enabled: boolean;
        };
        queryParams: {
          priority: number;
          enabled: boolean;
          paramNames: string[];
        };
      };
      deviceThresholds: {
        mobile: {
          width: number;
          height: number;
        };
        tablet: {
          width: number;
          height: number;
        };
        desktop: {
          width: number;
          height: number;
        };
      };
    };
  };
  
  // Video derivatives (templates)
  derivatives: Record<string, {
    width?: number;
    height?: number;
    quality?: number;
    compression?: string;
    fit?: string;
    audio?: boolean;
    muted?: boolean;
    loop?: boolean;
    autoplay?: boolean;
    [key: string]: any;
  }>;
  
  // Path patterns for URL matching and transformation
  paths: {
    patterns: Array<{
      name: string;
      matcher: string;
      priority: number;
      baseUrl?: string;
      originUrl?: string;
      cacheTtl?: number;
      quality?: string;
      transformParams?: Record<string, any>;
      captureGroups?: string[];
      derivatives?: string[];
    }>;
  };
}
```

## Core Components Implementation

### 1. Configuration Manager

Central interface for working with configuration:

```typescript
// config/ConfigurationManager.ts
import { VideoResizerConfig } from './types';
import { deepMerge } from '../utils/objectUtils';
import { defaultConfig, environmentConfigs } from './defaultConfig';
import { getConfigFromEnv } from './envConfig';
import { ConfigStorageService } from './ConfigStorageService';

/**
 * Configuration Manager - provides access to application configuration
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager | null = null;
  private config: VideoResizerConfig;
  private storageService: ConfigStorageService;
  private configVersion: string = '1.0.0';
  private configId: string = '';
  private isInitialized: boolean = false;
  
  private constructor() {
    // Initialize with defaults - will be replaced during init()
    this.config = { ...defaultConfig };
    this.storageService = new ConfigStorageService();
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }
  
  /**
   * Initialize the configuration system
   */
  public async init(env: Record<string, any>): Promise<void> {
    if (this.isInitialized) return;
    
    try {
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
      this.isInitialized = true;
      
    } catch (err) {
      console.error('Error initializing configuration', err);
      throw new Error('Configuration initialization failed');
    }
  }
  
  /**
   * Get the complete configuration object (readonly)
   */
  public getConfig(): Readonly<VideoResizerConfig> {
    return this.config;
  }
  
  /**
   * Get configuration for a specific module
   */
  public getModuleConfig<T>(module: keyof VideoResizerConfig): Readonly<T> {
    return this.config[module] as unknown as T;
  }
  
  /**
   * Update configuration
   */
  public async updateConfig(
    updates: Partial<VideoResizerConfig>,
    options: { 
      persist?: boolean, 
      comment?: string, 
      author?: string 
    } = {}
  ): Promise<void> {
    // Apply updates to current config
    this.config = deepMerge(this.config, updates);
    
    // Persist changes if requested
    if (options.persist) {
      const metadata = {
        comment: options.comment || 'Configuration update',
        author: options.author || 'system',
        timestamp: new Date().toISOString()
      };
      
      const result = await this.storageService.saveConfig(this.config, metadata);
      this.configId = result.id;
      this.configVersion = result.version;
    }
  }
  
  /**
   * Get current configuration version
   */
  public getConfigVersion(): string {
    return this.configVersion;
  }
  
  /**
   * Get configuration ID
   */
  public getConfigId(): string {
    return this.configId;
  }
  
  /**
   * Get configuration version history
   */
  public async getVersionHistory(): Promise<Array<{
    id: string;
    version: string;
    timestamp: string;
    comment: string;
    author: string;
  }>> {
    return this.storageService.getVersionHistory();
  }
  
  /**
   * Rollback to a previous version
   */
  public async rollbackToVersion(id: string): Promise<void> {
    const configVersion = await this.storageService.getConfigById(id);
    if (!configVersion) {
      throw new Error(`Configuration version ${id} not found`);
    }
    
    this.config = configVersion.config;
    this.configId = configVersion.id;
    this.configVersion = configVersion.version;
    
    await this.storageService.setActiveConfig(id);
  }
}
```

### 2. Configuration Storage Service

Handles persistent storage using Cloudflare KV:

```typescript
// config/ConfigStorageService.ts
import { VideoResizerConfig } from './types';

interface ConfigMetadata {
  comment: string;
  author: string;
  timestamp: string;
}

interface StoredConfig {
  id: string;
  version: string;
  config: VideoResizerConfig;
  metadata: ConfigMetadata;
  active: boolean;
}

export class ConfigStorageService {
  private kvNamespace: KVNamespace | null = null;
  private readonly CONFIG_KEY_PREFIX = 'config:';
  private readonly ACTIVE_CONFIG_KEY = 'config:active';
  private readonly VERSION_LIST_KEY = 'config:versions';
  
  /**
   * Set the KV namespace to use for storage
   */
  public setKvNamespace(namespace: KVNamespace): void {
    this.kvNamespace = namespace;
  }
  
  /**
   * Get the currently active configuration
   */
  public async getActiveConfig(): Promise<StoredConfig | null> {
    if (!this.kvNamespace) return null;
    
    try {
      // Get the active config ID
      const activeConfigId = await this.kvNamespace.get(this.ACTIVE_CONFIG_KEY);
      if (!activeConfigId) return null;
      
      // Get the active config
      return this.getConfigById(activeConfigId);
    } catch (err) {
      console.error('Error getting active config:', err);
      return null;
    }
  }
  
  /**
   * Get a configuration by ID
   */
  public async getConfigById(id: string): Promise<StoredConfig | null> {
    if (!this.kvNamespace) return null;
    
    try {
      const configKey = `${this.CONFIG_KEY_PREFIX}${id}`;
      const configData = await this.kvNamespace.get(configKey, 'json');
      return configData as StoredConfig;
    } catch (err) {
      console.error(`Error getting config ${id}:`, err);
      return null;
    }
  }
  
  /**
   * Save a new configuration version
   */
  public async saveConfig(
    config: VideoResizerConfig,
    metadata: ConfigMetadata
  ): Promise<{ id: string, version: string }> {
    if (!this.kvNamespace) {
      throw new Error('KV namespace not set');
    }
    
    try {
      // Generate a new ID and version
      const timestamp = new Date().toISOString();
      const id = `config-${timestamp.replace(/\D/g, '').substring(0, 14)}`;
      const version = this.generateVersion();
      
      // Create the stored config
      const storedConfig: StoredConfig = {
        id,
        version,
        config,
        metadata,
        active: true
      };
      
      // Save the config
      const configKey = `${this.CONFIG_KEY_PREFIX}${id}`;
      await this.kvNamespace.put(configKey, JSON.stringify(storedConfig));
      
      // Update the active config pointer
      await this.kvNamespace.put(this.ACTIVE_CONFIG_KEY, id);
      
      // Update the version list
      await this.updateVersionList(id, version, metadata);
      
      return { id, version };
    } catch (err) {
      console.error('Error saving config:', err);
      throw new Error('Failed to save configuration');
    }
  }
  
  /**
   * Set a specific configuration as active
   */
  public async setActiveConfig(id: string): Promise<void> {
    if (!this.kvNamespace) {
      throw new Error('KV namespace not set');
    }
    
    try {
      // Verify the config exists
      const config = await this.getConfigById(id);
      if (!config) {
        throw new Error(`Configuration ${id} not found`);
      }
      
      // Update the active config pointer
      await this.kvNamespace.put(this.ACTIVE_CONFIG_KEY, id);
      
      // Update the version list to mark this version as active
      const versionList = await this.getVersionList();
      const updatedList = versionList.map(version => ({
        ...version,
        active: version.id === id
      }));
      
      await this.kvNamespace.put(this.VERSION_LIST_KEY, JSON.stringify(updatedList));
    } catch (err) {
      console.error(`Error setting active config ${id}:`, err);
      throw new Error('Failed to set active configuration');
    }
  }
  
  /**
   * Get the version history
   */
  public async getVersionHistory(): Promise<Array<{
    id: string;
    version: string;
    timestamp: string;
    comment: string;
    author: string;
    active: boolean;
  }>> {
    if (!this.kvNamespace) return [];
    
    try {
      const versionList = await this.getVersionList();
      return versionList;
    } catch (err) {
      console.error('Error getting version history:', err);
      return [];
    }
  }
  
  /**
   * Compare two configuration versions
   */
  public async compareVersions(id1: string, id2: string): Promise<{
    added: string[];
    removed: string[];
    modified: Record<string, { from: any, to: any }>;
  }> {
    const config1 = await this.getConfigById(id1);
    const config2 = await this.getConfigById(id2);
    
    if (!config1 || !config2) {
      throw new Error('One or both configurations not found');
    }
    
    // Implement deep diff logic here
    // This is a simplified example
    const diff = {
      added: [] as string[],
      removed: [] as string[],
      modified: {} as Record<string, { from: any, to: any }>
    };
    
    // For now, return an empty diff
    return diff;
  }
  
  /**
   * Generate a new version string
   */
  private generateVersion(): string {
    // Simple version generation - in practice, you'd want something more sophisticated
    return `1.0.${Date.now() % 1000}`;
  }
  
  /**
   * Get the version list
   */
  private async getVersionList(): Promise<Array<{
    id: string;
    version: string;
    timestamp: string;
    comment: string;
    author: string;
    active: boolean;
  }>> {
    if (!this.kvNamespace) return [];
    
    try {
      const versionList = await this.kvNamespace.get(this.VERSION_LIST_KEY, 'json');
      return versionList as any[] || [];
    } catch (err) {
      console.error('Error getting version list:', err);
      return [];
    }
  }
  
  /**
   * Update the version list
   */
  private async updateVersionList(
    id: string,
    version: string,
    metadata: ConfigMetadata
  ): Promise<void> {
    if (!this.kvNamespace) return;
    
    try {
      const versionList = await this.getVersionList();
      
      // Mark all existing versions as inactive
      const updatedList = versionList.map(v => ({
        ...v,
        active: false
      }));
      
      // Add the new version
      updatedList.unshift({
        id,
        version,
        timestamp: metadata.timestamp,
        comment: metadata.comment,
        author: metadata.author,
        active: true
      });
      
      // Save the updated list
      await this.kvNamespace.put(this.VERSION_LIST_KEY, JSON.stringify(updatedList));
    } catch (err) {
      console.error('Error updating version list:', err);
    }
  }
}
```

### 3. Configuration API Handler

Implements the REST API endpoints:

```typescript
// handlers/ConfigApiHandler.ts
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SchemaValidator } from '../config/SchemaValidator';

/**
 * Handler for Configuration API endpoints
 */
export class ConfigApiHandler {
  private configManager = ConfigurationManager.getInstance();
  private schemaValidator = new SchemaValidator();
  
  /**
   * Handle API requests
   */
  public async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Authenticate the request
    if (!this.authenticate(request)) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    try {
      // Route to the appropriate handler
      if (path === '/api/config' && request.method === 'GET') {
        return this.getCurrentConfig();
      } else if (path === '/api/config' && request.method === 'POST') {
        return this.updateConfig(request);
      } else if (path.match(/^\/api\/config\/modules\/[^\/]+$/) && request.method === 'PATCH') {
        const moduleName = path.split('/').pop() as string;
        return this.updateModule(request, moduleName);
      } else if (path === '/api/config/versions' && request.method === 'GET') {
        return this.getVersions();
      } else if (path.match(/^\/api\/config\/activate\/[^\/]+$/) && request.method === 'PUT') {
        const configId = path.split('/').pop() as string;
        return this.activateVersion(configId);
      } else if (path === '/api/config/compare' && request.method === 'GET') {
        const fromId = url.searchParams.get('from');
        const toId = url.searchParams.get('to');
        if (!fromId || !toId) {
          return new Response(JSON.stringify({
            error: 'Missing from or to parameter'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json'
            }
          });
        }
        return this.compareVersions(fromId, toId);
      } else if (path === '/api/config/resolve' && request.method === 'POST') {
        return this.resolveEnvVars(request);
      } else {
        return new Response(JSON.stringify({
          error: 'Not found'
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error handling config API request:', errorMessage);
      
      return new Response(JSON.stringify({
        error: errorMessage
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }
  
  /**
   * Get the current configuration
   */
  private async getCurrentConfig(): Promise<Response> {
    const config = this.configManager.getConfig();
    
    return new Response(JSON.stringify({
      id: this.configManager.getConfigId(),
      version: this.configManager.getConfigVersion(),
      modules: config,
      activeVersion: true,
      createdAt: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Update the entire configuration
   */
  private async updateConfig(request: Request): Promise<Response> {
    const body = await request.json();
    
    // Validate the input
    if (!body.modules) {
      return new Response(JSON.stringify({
        error: 'Missing modules in request body'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Validate against schema
    const validationResult = this.schemaValidator.validateConfig(body.modules);
    if (!validationResult.valid) {
      return new Response(JSON.stringify({
        error: 'Invalid configuration',
        details: validationResult.errors
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Update the configuration
    await this.configManager.updateConfig(body.modules, {
      persist: body.activate !== false,
      comment: body.comment || 'Configuration update',
      author: body.author || 'api'
    });
    
    // Return the updated configuration
    const config = this.configManager.getConfig();
    
    return new Response(JSON.stringify({
      id: this.configManager.getConfigId(),
      version: this.configManager.getConfigVersion(),
      modules: config,
      activeVersion: true,
      createdAt: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Update a specific module
   */
  private async updateModule(request: Request, moduleName: string): Promise<Response> {
    const body = await request.json();
    
    if (!body.settings) {
      return new Response(JSON.stringify({
        error: 'Missing settings in request body'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Validate against schema
    const validationResult = this.schemaValidator.validateModule(moduleName, body.settings);
    if (!validationResult.valid) {
      return new Response(JSON.stringify({
        error: `Invalid ${moduleName} configuration`,
        details: validationResult.errors
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Create a partial update with just this module
    const update = {
      [moduleName]: body.settings
    } as any;
    
    // Update the configuration
    await this.configManager.updateConfig(update, {
      persist: body.activate !== false,
      comment: body.comment || `Updated ${moduleName} module`,
      author: body.author || 'api'
    });
    
    // Return the updated configuration
    const config = this.configManager.getConfig();
    
    return new Response(JSON.stringify({
      id: this.configManager.getConfigId(),
      version: this.configManager.getConfigVersion(),
      modules: {
        [moduleName]: (config as any)[moduleName]
      },
      activeVersion: true,
      createdAt: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Get all configuration versions
   */
  private async getVersions(): Promise<Response> {
    const versions = await this.configManager.getVersionHistory();
    
    return new Response(JSON.stringify({
      versions
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Activate a specific configuration version
   */
  private async activateVersion(configId: string): Promise<Response> {
    await this.configManager.rollbackToVersion(configId);
    
    return new Response(JSON.stringify({
      success: true,
      id: configId,
      activeVersion: true
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Compare two configuration versions
   */
  private async compareVersions(fromId: string, toId: string): Promise<Response> {
    // This would call the ConfigStorageService.compareVersions method
    // For now, we'll return a placeholder
    return new Response(JSON.stringify({
      differences: {
        // Placeholder data
        video: {
          quality: {
            from: "high",
            to: "medium"
          }
        }
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Resolve environment variables in a configuration
   */
  private async resolveEnvVars(request: Request): Promise<Response> {
    const body = await request.json();
    
    // In a real implementation, this would resolve environment variables
    // For now, we'll return the same object
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  /**
   * Authenticate API requests
   */
  private authenticate(request: Request): boolean {
    const apiKey = request.headers.get('X-API-Key');
    
    // In a real implementation, this would verify the API key
    // For now, we'll return true for any non-empty key
    return !!apiKey;
  }
}
```

### 4. Schema Validator

Validates configuration against JSON schemas:

```typescript
// config/SchemaValidator.ts
// Note: This is a simplified version, a real implementation would use
// a library like Ajv for JSON Schema validation

interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class SchemaValidator {
  private schemas: Record<string, any> = {};
  
  constructor() {
    this.initializeSchemas();
  }
  
  /**
   * Initialize default schemas
   */
  private initializeSchemas(): void {
    // Define schemas for each module
    this.schemas.video = {
      type: 'object',
      properties: {
        quality: {
          type: 'object',
          properties: {
            auto: { type: 'boolean' },
            defaultValue: { type: 'number' },
            presets: { type: 'object' }
          },
          required: ['auto', 'defaultValue']
        },
        compression: {
          type: 'object',
          properties: {
            auto: { type: 'boolean' },
            defaultValue: { type: 'string' },
            presets: { type: 'object' }
          },
          required: ['auto', 'defaultValue']
        }
      }
    };
    
    this.schemas.cache = {
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
            serverError: { type: 'number' }
          },
          required: ['ok', 'clientError', 'serverError']
        },
        cacheEverything: { type: 'boolean' }
      },
      required: ['method', 'ttl']
    };
    
    this.schemas.debug = {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        headers: { 
          type: 'array',
          items: { type: 'string' }
        },
        allowedEnvironments: {
          type: 'array',
          items: { type: 'string' }
        },
        verbose: { type: 'boolean' },
        includePerformance: { type: 'boolean' }
      },
      required: ['enabled']
    };
    
    // Add more schemas as needed
  }
  
  /**
   * Validate a complete configuration
   */
  public validateConfig(config: any): ValidationResult {
    const errors: string[] = [];
    
    // Check each module against its schema
    for (const [module, schema] of Object.entries(this.schemas)) {
      if (config[module]) {
        const moduleResult = this.validateModule(module, config[module]);
        if (!moduleResult.valid && moduleResult.errors) {
          errors.push(...moduleResult.errors);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }
  
  /**
   * Validate a specific module
   */
  public validateModule(module: string, config: any): ValidationResult {
    const schema = this.schemas[module];
    if (!schema) {
      return {
        valid: false,
        errors: [`No schema found for module: ${module}`]
      };
    }
    
    // In a real implementation, this would use a proper JSON Schema validator
    // For now, we'll just do a very basic check
    const errors = this.validateAgainstSchema(config, schema, module);
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }
  
  /**
   * Register a new schema
   */
  public registerSchema(module: string, schema: any): void {
    this.schemas[module] = schema;
  }
  
  /**
   * Get all schemas
   */
  public getSchemas(): Record<string, any> {
    return { ...this.schemas };
  }
  
  /**
   * Get a specific module schema
   */
  public getModuleSchema(module: string): any {
    return this.schemas[module];
  }
  
  /**
   * Validate an object against a schema
   * This is a very simplified implementation
   */
  private validateAgainstSchema(obj: any, schema: any, path: string): string[] {
    const errors: string[] = [];
    
    // Check required properties
    if (schema.required) {
      for (const prop of schema.required) {
        if (obj[prop] === undefined) {
          errors.push(`Missing required property: ${path}.${prop}`);
        }
      }
    }
    
    // Check property types
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (obj[prop] !== undefined) {
          const propPath = `${path}.${prop}`;
          
          // Check type
          if ((propSchema as any).type === 'object' && typeof obj[prop] !== 'object') {
            errors.push(`${propPath} should be an object`);
          } else if ((propSchema as any).type === 'array' && !Array.isArray(obj[prop])) {
            errors.push(`${propPath} should be an array`);
          } else if ((propSchema as any).type === 'string' && typeof obj[prop] !== 'string') {
            errors.push(`${propPath} should be a string`);
          } else if ((propSchema as any).type === 'number' && typeof obj[prop] !== 'number') {
            errors.push(`${propPath} should be a number`);
          } else if ((propSchema as any).type === 'boolean' && typeof obj[prop] !== 'boolean') {
            errors.push(`${propPath} should be a boolean`);
          }
          
          // Check enum values
          if ((propSchema as any).enum && !(propSchema as any).enum.includes(obj[prop])) {
            errors.push(`${propPath} should be one of: ${(propSchema as any).enum.join(', ')}`);
          }
          
          // Recursively validate nested objects
          if ((propSchema as any).type === 'object' && typeof obj[prop] === 'object' && (propSchema as any).properties) {
            errors.push(...this.validateAgainstSchema(obj[prop], propSchema, propPath));
          }
          
          // Validate array items
          if ((propSchema as any).type === 'array' && Array.isArray(obj[prop]) && (propSchema as any).items) {
            for (let i = 0; i < obj[prop].length; i++) {
              errors.push(...this.validateAgainstSchema(obj[prop][i], (propSchema as any).items, `${propPath}[${i}]`));
            }
          }
        }
      }
    }
    
    return errors;
  }
}
```

## Integration with Video Resizer

### Main Worker Integration

```typescript
// src/index.ts
import { handleVideoRequest } from './handlers/videoHandler';
import { ConfigurationManager } from './config/ConfigurationManager';
import { ConfigApiHandler } from './handlers/ConfigApiHandler';

export default {
  async fetch(request: Request, env: Record<string, any>, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      
      // Handle configuration API requests
      if (url.pathname.startsWith('/api/config')) {
        const configApiHandler = new ConfigApiHandler();
        return configApiHandler.handleRequest(request);
      }
      
      // Initialize configuration
      const configManager = ConfigurationManager.getInstance();
      await configManager.init(env);
      const config = configManager.getConfig();
      
      // Handle video requests
      return handleVideoRequest(request, config, env);
    } catch (err) {
      console.error('Unexpected error in worker', err);
      return new Response('An unexpected error occurred', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};
```

### Updating the Video Handler

```typescript
// handlers/videoHandler.ts
import { VideoResizerConfig } from '../config/types';
import { TransformVideoCommand } from '../domain/commands/TransformVideoCommand';

export async function handleVideoRequest(
  request: Request,
  config: VideoResizerConfig,
  env: Record<string, any>
): Promise<Response> {
  // Create a command to transform the video
  const command = new TransformVideoCommand(config, env);
  
  // Execute the command
  return command.execute(request);
}
```

## Implementation Strategy

### Phase 1: Core Configuration Structure

1. Define comprehensive TypeScript interfaces for configuration
2. Implement environment-based configuration loading
3. Create the ConfigurationManager with basic functionality
4. Update services to use the ConfigurationManager

### Phase 2: Storage Persistence

1. Implement the ConfigStorageService with KV storage
2. Add version tracking and history
3. Enable configuration persistence
4. Implement rollback functionality

### Phase 3: API Layer

1. Create the ConfigApiHandler for REST endpoints
2. Implement the SchemaValidator for validation
3. Add authentication for API access
4. Build the environment variable resolution

### Phase 4: Advanced Features

1. Add feature flags and conditional activation
2. Implement path patterns with advanced matching
3. Create derivatives for different video profiles
4. Add detection cascade for client capabilities

## Migration Guide

### Migrating from Current Configuration

1. Create a compatibility layer to map old config to new structure
2. Generate default configuration that matches current behavior
3. Test the system with current configuration values
4. Gradually move services to use the ConfigurationManager
5. Update wrangler.jsonc with modular configuration

### Configuration Mapping

```typescript
// Migration helper for converting old configuration
function migrateFromLegacyConfig(oldConfig: any): VideoResizerConfig {
  return {
    environment: oldConfig.mode || 'development',
    version: oldConfig.version || '1.0.0',
    
    debug: {
      enabled: oldConfig.debug?.enabled ?? true,
      headers: oldConfig.debug?.headers ?? ['video', 'cache'],
      allowedEnvironments: ['development', 'staging'],
      verbose: oldConfig.debug?.verbose ?? false,
      includePerformance: oldConfig.debug?.includePerformance ?? true
    },
    
    logging: {
      level: oldConfig.logging?.level || 'INFO',
      includeTimestamp: oldConfig.logging?.includeTimestamps ?? true,
      enableStructuredLogs: oldConfig.logging?.format === 'json',
      enableBreadcrumbs: true
    },
    
    cache: {
      method: oldConfig.cache?.method || 'cf',
      ttl: {
        ok: oldConfig.cache?.defaultTtl || 86400,
        clientError: 60,
        serverError: 10
      },
      cacheEverything: oldConfig.cache?.cacheEverything ?? true,
      cacheTags: {
        enabled: oldConfig.cache?.enableTags ?? true,
        prefix: 'video-',
        includeVideoParameters: true,
        includeQuality: true,
        includeFormat: true,
        includeDerivative: true
      }
    },
    
    video: {
      quality: {
        auto: true,
        defaultValue: 720,
        presets: {
          low: 360,
          medium: 480,
          high: 720,
          hd: 1080
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
        defaultValue: oldConfig.video?.defaultFit || 'contain',
        allowedValues: ['contain', 'cover', 'crop', 'scale-down', 'pad']
      },
      audio: {
        defaultEnabled: oldConfig.video?.defaultAudio ?? true,
        controlsEnabled: true
      },
      playback: {
        loop: false,
        autoplay: false,
        muted: false,
        preload: 'auto'
      }
    },
    
    derivatives: {
      // Default derivatives
      thumbnail: {
        width: 320,
        height: 180,
        quality: 60,
        fit: 'crop',
        audio: false
      },
      preview: {
        width: 640,
        height: 360,
        quality: 70
      }
    },
    
    paths: {
      patterns: oldConfig.pathPatterns?.map((p: any) => ({
        name: p.name,
        matcher: p.matcher,
        priority: p.priority || 0,
        cacheTtl: p.cacheTtl,
        quality: p.quality,
        captureGroups: p.captureGroups
      })) || []
    }
  };
}
```

## Conclusion

This implementation provides a comprehensive configuration system for the Video Resizer, with the following benefits:

1. **Strongly typed**: TypeScript interfaces ensure configuration type safety
2. **Versioned**: Configuration changes are tracked with version history
3. **Flexible**: Support for environment variables, KV storage, and API updates
4. **Validated**: Schema validation ensures valid configuration
5. **Modular**: Configuration is organized into logical modules
6. **API-driven**: REST API for configuration management
7. **Feature flags**: Conditional features based on environment
8. **Advanced path matching**: Sophisticated URL pattern matching

By implementing this system, the Video Resizer will gain the same flexibility and robustness as the image-resizer-2 project, making it easier to maintain, extend, and configure for different environments and use cases.