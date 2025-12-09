/**
 * VideoConfigurationManager
 * 
 * A centralized configuration manager for video transformation with Zod schema validation.
 * This manager provides type-safe access to video transformation settings, path patterns,
 * derivatives, and default values.
 * 
 * @example
 * ```typescript
 * import { VideoConfigurationManager } from '../config';
 * 
 * // Get the singleton instance
 * const config = VideoConfigurationManager.getInstance();
 * 
 * // Access configuration
 * const derivative = config.getDerivative('mobile');
 * const isValidFit = config.isValidOption('fit', 'cover');
 * ```
 */
import { z } from 'zod';
import { ConfigurationError } from '../errors';
import { videoConfig as defaultConfig } from './videoConfig';
import { AuthConfigSchema, StorageConfigSchema } from './storageConfig';
import { OriginSchema, safeValidateOrigin } from './originSchema';
import { convertLegacyConfigToOrigins } from './originConverters';
import { Origin, OriginsConfig, Source } from '../services/videoStorage/interfaces';

// Define Zod schemas for each part of the configuration

// TTL Configuration Schema
const TtlSchema = z.object({
  ok: z.number().positive(),
  redirects: z.number().positive(),
  clientError: z.number().nonnegative(),
  serverError: z.number().nonnegative(),
});

// Cache Configuration Schema
const CacheConfigSchema = z.object({
  regex: z.string(),
  cacheability: z.boolean(),
  videoCompression: z.string(),
  ttl: TtlSchema,
});

// Network Quality Configuration Schema
const NetworkQualityConfigSchema = z.object({
  maxWidth: z.number().positive(),
  maxHeight: z.number().positive(),
  maxBitrate: z.number().positive(),
});

// Browser Capabilities Schema
const BrowserCapabilitySchema = z.object({
  patterns: z.array(z.string()),
  exclusions: z.array(z.string()).optional(),
});

// Auth schema is imported at the top of the file

// Path Pattern Schema
export const PathPatternSchema = z.object({
  name: z.string(),
  matcher: z.string(),
  processPath: z.boolean(),
  baseUrl: z.string().nullable(),
  originUrl: z.string().nullable(),
  quality: z.string().optional(),
  // For backward compatibility, still support cacheTtl but mark as deprecated
  cacheTtl: z.number().positive().optional(),
  // New ttl structure and useTtlByStatus flag
  ttl: TtlSchema.optional(),
  useTtlByStatus: z.boolean().optional().default(true),
  priority: z.number().optional(),
  transformationOverrides: z.record(z.unknown()).optional(),
  captureGroups: z.array(z.string()).optional(),
  // Add auth configuration to path patterns
  auth: AuthConfigSchema.optional(),
});

// Video Derivatives Schema
const DerivativeSchema = z.record(z.object({
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  mode: z.enum(['video', 'frame', 'spritesheet', 'audio']).optional(),
  fit: z.enum(['contain', 'scale-down', 'cover']).optional(),
  audio: z.boolean().optional(),
  format: z.string().nullable().optional(),
  time: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  quality: z.enum(['low', 'medium', 'high', 'auto']).nullable().optional(),
  compression: z.enum(['low', 'medium', 'high', 'auto']).nullable().optional(),
  loop: z.boolean().nullable().optional(),
  preload: z.enum(['none', 'metadata', 'auto']).nullable().optional(),
  autoplay: z.boolean().nullable().optional(),
  muted: z.boolean().nullable().optional(),
}));

// Define ResponsiveBreakpoint Schema
const ResponsiveBreakpointSchema = z.object({
  min: z.number().positive().optional(),
  max: z.number().positive().optional(),
  derivative: z.string()
});

// StorageConfigSchema is imported at the top of the file

// Complete Video Configuration Schema
export const VideoConfigSchema = z.object({
  // Schema version
  version: z.string().optional(),
  
  // New Origins-based configuration - can be array or config object
  origins: z.union([
    z.array(OriginSchema),
    z.object({
      enabled: z.boolean().optional(),
      useLegacyPathPatterns: z.boolean().optional(),
      items: z.array(OriginSchema).optional()
    })
  ]).optional(),
  
  derivatives: DerivativeSchema,
  defaults: z.object({
    width: z.number().nullable(),
    height: z.number().nullable(),
    mode: z.enum(['video', 'frame', 'spritesheet', 'audio']),
    fit: z.enum(['contain', 'scale-down', 'cover']).nullable(),
    audio: z.boolean(),
    format: z.string().nullable(),
    time: z.string().nullable(),
    duration: z.string().nullable(),
    quality: z.enum(['low', 'medium', 'high', 'auto']).nullable(),
    compression: z.enum(['low', 'medium', 'high', 'auto']).nullable(),
    loop: z.boolean().nullable(),
    preload: z.enum(['none', 'metadata', 'auto']).nullable(),
    autoplay: z.boolean().nullable(),
    muted: z.boolean().nullable(),
    filename: z.string().nullable().optional(),
  }),
  validOptions: z.object({
    mode: z.array(z.string()),
    fit: z.array(z.string()),
    format: z.array(z.string()),
    audio: z.array(z.boolean()),
    quality: z.array(z.string()),
    compression: z.array(z.string()),
    preload: z.array(z.string()),
    loop: z.array(z.boolean()),
    autoplay: z.array(z.boolean()),
    muted: z.array(z.boolean()),
  }),
  responsive: z.object({
    breakpoints: z.record(z.number().positive()),
    availableQualities: z.array(z.number().positive()),
    deviceWidths: z.record(z.number().positive()),
    networkQuality: z.record(NetworkQualityConfigSchema),
    browserCapabilities: z.record(BrowserCapabilitySchema).optional(),
  }),
  // New field for responsive breakpoint mapping to derivatives
  responsiveBreakpoints: z.record(ResponsiveBreakpointSchema).optional(),
  paramMapping: z.record(z.string()),
  cdnCgi: z.object({
    basePath: z.string(),
  }),
  passthrough: z.object({
    enabled: z.boolean(),
    whitelistedFormats: z.array(z.string())
  }).optional(),
  // Make pathPatterns optional when origins is present
  pathPatterns: z.array(PathPatternSchema).optional(),
  caching: z.object({
    method: z.enum(['kv']),
    debug: z.boolean(),
    fallback: z.object({
      enabled: z.boolean(),
      badRequestOnly: z.boolean(),
      preserveHeaders: z.array(z.string()).optional(),
      fileSizeErrorHandling: z.boolean().optional(),
      maxRetries: z.number().optional()
    }),
  }).optional(), // Make caching optional
  cache: z.record(CacheConfigSchema).optional(), // Make cache optional
  // Include storage configuration
  storage: StorageConfigSchema.optional(),
})
// Add refinement to require either pathPatterns or origins
.refine(
  (data) => {
    return !!data.pathPatterns || !!data.origins;
  },
  {
    message: 'Either pathPatterns or origins must be provided',
    path: ['configuration']
  }
);

// Type exported from the schema
export type VideoConfiguration = z.infer<typeof VideoConfigSchema>;

/**
 * VideoConfigurationManager class for managing and validating video configuration
 */
export class VideoConfigurationManager {
  private static instance: VideoConfigurationManager;
  private config: VideoConfiguration;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(initialConfig: unknown = defaultConfig) {
    try {
      // Ensure we're starting with defaultConfig if nothing is provided
      const configToUse = initialConfig || defaultConfig;
      
      // Auto-generate Origins from legacy config if not already present
      let configWithOrigins = configToUse as any;
      if (!configWithOrigins.origins && configWithOrigins.pathPatterns) {
        try {
          // Generate Origins from path patterns
          configWithOrigins = {
            ...configWithOrigins,
            origins: convertLegacyConfigToOrigins(configWithOrigins)
          };
          
          console.debug('VideoConfigurationManager: Auto-generated Origins from legacy config', {
            originCount: configWithOrigins.origins.length
          });
        } catch (conversionError) {
          console.warn('VideoConfigurationManager: Failed to auto-generate Origins', {
            error: conversionError instanceof Error ? conversionError.message : String(conversionError)
          });
        }
      }
      
      // Validate and parse the configuration
      this.config = VideoConfigSchema.parse(configWithOrigins);

      // Normalize valid options to ensure new modes/formats from defaults are present
      const mergeUnique = (a: string[], b: string[]) =>
        Array.from(new Set([...(a || []), ...(b || [])]));

      this.config.validOptions.mode = mergeUnique(
        defaultConfig.validOptions.mode,
        this.config.validOptions.mode
      );

      this.config.validOptions.format = mergeUnique(
        defaultConfig.validOptions.format,
        this.config.validOptions.format
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'videoConfig',
          initialConfig,
          'Valid video configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'videoConfig',
        initialConfig,
        'Valid video configuration'
      );
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(initialConfig?: unknown): VideoConfigurationManager {
    if (!VideoConfigurationManager.instance) {
      VideoConfigurationManager.instance = new VideoConfigurationManager(initialConfig);
    }
    return VideoConfigurationManager.instance;
  }

  /**
   * Reset the instance (useful for testing)
   */
  public static resetInstance(): void {
    VideoConfigurationManager.instance = undefined as unknown as VideoConfigurationManager;
  }

  /**
   * Get the entire video configuration object
   * 
   * @returns The complete validated video configuration
   */

  public getConfig(): VideoConfiguration {
    return this.config;
  }

  /**
   * Get a derivative configuration by name
   * 
   * Derivatives are preset configurations for different video use cases,
   * such as 'high', 'medium', 'low', 'mobile', 'thumbnail', etc.
   * 
   * @param name - The name of the derivative to retrieve
   * @returns The derivative configuration object
   * @throws ConfigurationError if the derivative doesn't exist
   */

  public getDerivative(name: string) {
    if (!this.config.derivatives[name]) {
      throw ConfigurationError.missingProperty(
        `derivatives.${name}`,
        { parameters: { derivativeName: name } }
      );
    }
    return this.config.derivatives[name];
  }

  /**
   * Get all configured path patterns
   * 
   * Path patterns define URL patterns to match and how to process them.
   * 
   * @returns Array of path pattern configurations
   */

  public getPathPatterns() {
    return this.config.pathPatterns || [];
  }

  /**
   * Add a new path pattern to the configuration
   * 
   * @param pattern - The path pattern to add
   * @returns The validated path pattern that was added
   * @throws ConfigurationError if the pattern is invalid
   */

  public addPathPattern(pattern: z.infer<typeof PathPatternSchema>) {
    try {
      // Convert legacy cacheTtl to ttl structure if needed
      if (pattern.cacheTtl && !pattern.ttl) {
        pattern = {
          ...pattern,
          ttl: {
            ok: pattern.cacheTtl,
            redirects: Math.floor(pattern.cacheTtl / 10),  // Default to 1/10th of ok time
            clientError: 60,  // Fixed value of 60 seconds for client errors
            serverError: 10   // Fixed value of 10 seconds for server errors
          }
        };
      }
      
      const validatedPattern = PathPatternSchema.parse(pattern);
      
      // Initialize pathPatterns array if it doesn't exist
      if (!this.config.pathPatterns) {
        this.config.pathPatterns = [];
      }
      
      this.config.pathPatterns.push(validatedPattern);
      return validatedPattern;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.patternError(
          `Invalid path pattern: ${issues}`,
          pattern.name,
          { parameters: { pattern } }
        );
      }
      
      throw ConfigurationError.patternError(
        'Invalid path pattern',
        pattern.name,
        { parameters: { pattern } }
      );
    }
  }

  /**
   * Get all valid options for a specific parameter
   * 
   * @param param - The parameter name to get valid options for
   * @returns Array of valid options for the parameter
   */

  public getValidOptions(param: keyof z.infer<typeof VideoConfigSchema>['validOptions']) {
    const validOptionsObject = this.config.validOptions as Record<string, unknown[]>;
    return validOptionsObject[param as string];
  }

  /**
   * Check if a value is valid for a given parameter
   * 
   * @param param - The parameter name to check
   * @param value - The value to validate
   * @returns True if the value is valid for the parameter, false otherwise
   */

  public isValidOption(param: string, value: unknown): boolean {
    const validOptionsObject = this.config.validOptions as Record<string, unknown[]>;
    // Use optional chaining to handle missing parameters
    const validOptions = validOptionsObject[param];
    
    if (!validOptions) {
      return false;
    }
    
    return validOptions.some(option => option === value);
  }

  /**
   * Get default video option value
   */
  public getDefaultOption<K extends keyof z.infer<typeof VideoConfigSchema>['defaults']>(
    option: K
  ): z.infer<typeof VideoConfigSchema>['defaults'][K] {
    return this.config.defaults[option];
  }

  /**
   * Get all default options
   */
  public getDefaults() {
    return this.config.defaults;
  }

  /**
   * Get parameter mapping (our param name → CDN param name)
   */
  public getParamMapping() {
    return this.config.paramMapping;
  }

  /**
   * Get CDN-CGI configuration
   */
  public getCdnCgiConfig() {
    return this.config.cdnCgi;
  }

  /**
   * Get storage configuration for video sources
   * @returns Storage configuration or default if not set
   */
  public getStorageConfig() {
    // Using a local defaultStorageConfig inline to avoid async issues
    const defaultConfig = {
      priority: ['r2', 'remote', 'fallback'],
      r2: {
        enabled: false,
        bucketBinding: 'VIDEOS_BUCKET',
      },
      fetchOptions: {
        userAgent: 'Cloudflare-Video-Resizer/1.0',
      },
    };
    
    if (!this.config.storage) {
      try {
        // Try to log the missing config once, not on every call
        const logWarning = () => {
          import('../utils/legacyLoggerAdapter').then(({ warn }) => {
            warn('VideoConfigurationManager', 'Storage configuration not found, using defaults');
          }).catch(() => {
            console.warn('[VideoConfigurationManager] Storage configuration not found, using defaults');
          });
        };
        
        // Only log once by using a function we define and call immediately
        logWarning();
      } catch {
        // Silent catch - don't fail getting config if logging fails
      }
      
      return defaultConfig;
    }
    
    // Return the stored configuration
    return this.config.storage;
  }
  
  /**
   * Get diagnostics for storage configuration
   * This method provides detailed information about storage configuration status
   * including R2 bucket availability and any configuration inconsistencies
   * 
   * @param env Environment containing bindings
   * @returns Detailed storage diagnostics
   */
  public getStorageDiagnostics(env?: Record<string, unknown>) {
    const storageConfig = this.getStorageConfig();
    const r2Config = storageConfig.r2 || { enabled: false, bucketBinding: 'VIDEOS_BUCKET' };
    
    // Check if the R2 bucket is available
    const hasBucket = !!(env && r2Config.bucketBinding && env[r2Config.bucketBinding]);
    const r2Enabled = r2Config.enabled === true;
    
    // Detect configuration inconsistencies
    const inconsistencies: string[] = [];
    if (r2Enabled && !hasBucket) {
      inconsistencies.push('R2 enabled but bucket binding not available');
    }
    if (!r2Enabled && hasBucket) {
      inconsistencies.push('R2 bucket available but not enabled in configuration');
    }
    
    // Determine remoteUrl availability
    const hasRemoteUrl = !!(storageConfig as any).remoteUrl;
    
    // Check if remote auth is properly configured
    const remoteAuth = (storageConfig as any).remoteAuth || { enabled: false };
    const remoteAuthConfigured = remoteAuth.enabled === true;
    const remoteAuthInconsistent = remoteAuthConfigured && !hasRemoteUrl;
    if (remoteAuthInconsistent) {
      inconsistencies.push('Remote auth enabled but no remoteUrl configured');
    }
    
    return {
      storage: {
        r2: {
          enabled: r2Enabled,
          hasBucket,
          bucketBinding: r2Config.bucketBinding,
          available: r2Enabled && hasBucket
        },
        remote: {
          enabled: hasRemoteUrl,
          url: hasRemoteUrl ? (storageConfig as any).remoteUrl : null,
          authConfigured: remoteAuthConfigured,
          available: hasRemoteUrl
        },
        priority: storageConfig.priority || [],
        inconsistencies,
        status: inconsistencies.length > 0 ? 'warning' : 'ok'
      }
    };
  }

  /**
   * Get cache configuration
   * Supports both legacy structure (video.cache) and new structure (root-level cache)
   */
  public getCacheConfig() {
    // Support for both configurations
    return this.config.cache || {}; 
  }

  /**
   * Get responsive configuration
   */
  public getResponsiveConfig() {
    return this.config.responsive;
  }

  /**
   * Get responsive breakpoints mapping
   * Returns the configured responsive breakpoints that map width ranges to derivatives
   * 
   * @returns Responsive breakpoints mapping object or empty object if not configured
   */
  public getResponsiveBreakpoints() {
    return this.config.responsiveBreakpoints || {};
  }

  /**
   * Get caching method configuration
   * Supports both legacy structure (video.caching) and new structure (root-level cache.method etc.)
   */
  public getCachingConfig() {
    // Support for both configurations
    if (this.config.caching) {
      return this.config.caching;
    }
    
    // Create a compatible structure from the root-level cache settings if available
    const rootCache = this.getConfig() as any;
    if (rootCache.cache && rootCache.cache.method) {
      return {
        method: rootCache.cache.method,
        debug: rootCache.cache.debug || false,
        fallback: rootCache.cache.fallback || { 
          enabled: true, 
          badRequestOnly: true,
          preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag']
        }
      };
    }
    
    // Default caching fallback
    return {
      method: 'kv',
      debug: false,
      fallback: {
        enabled: true,
        badRequestOnly: true,
        preserveHeaders: ['Content-Type', 'Cache-Control', 'Etag']
      }
    };
  }
  
  /**
   * Get all configured origins
   * Origins define URL patterns to match and how to process them,
   * combining path pattern and storage configuration.
   * 
   * @returns Array of origin configurations or empty array if not defined
   */
  public getOrigins(): Origin[] {
    const origins = this.config.origins;
    
    if (!origins) {
      return [];
    }
    
    // If origins is an array, return it
    if (Array.isArray(origins)) {
      return origins;
    }
    
    // If origins is an OriginsConfig object, return the items array
    const originsConfig = origins as OriginsConfig;
    if (originsConfig.items && Array.isArray(originsConfig.items)) {
      return originsConfig.items;
    }
    
    return [];
  }
  
  /**
   * Check if Origins are configured and should be used
   * @returns True if Origins should be used for video handling
   */
  public shouldUseOrigins(): boolean {
    const origins = this.config.origins;
    
    if (!origins) {
      return false;
    }
    
    // If origins is an array, check if it has items
    if (Array.isArray(origins)) {
      return origins.length > 0;
    }
    
    // If origins is an OriginsConfig object, check if it has items and is enabled
    const originsConfig = origins as OriginsConfig;
    return originsConfig.enabled !== false && 
           Array.isArray(originsConfig.items) && 
           originsConfig.items.length > 0;
  }
  
  /**
   * Auto-convert legacy configuration to Origins format
   * @returns Array of converted Origins
   */
  public generateOriginsFromLegacy() {
    return convertLegacyConfigToOrigins(this.config);
  }
  
  /**
   * Get origin by name
   * @param name Name of the origin to retrieve
   * @returns The origin configuration or null if not found
   */
  public getOriginByName(name: string) {
    const origins = this.getOrigins();
    return origins.find(origin => origin.name === name) || null;
  }
  
  /**
   * Add a new origin to the configuration
   * @param origin The origin to add
   * @returns The validated origin that was added
   * @throws ConfigurationError if the origin is invalid
   */
  public addOrigin(origin: unknown) {
    try {
      // Use the safe validation function
      const result = safeValidateOrigin(origin);
      
      if (!result.success) {
        // Format validation errors
        const issues = result.error?.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        // Type check for error reporting
        const originName = typeof origin === 'object' && origin !== null && 'name' in origin 
          ? String(origin.name) 
          : 'unknown';
        
        throw ConfigurationError.patternError(
          `Invalid origin: ${issues}`,
          originName,
          { parameters: { origin } }
        );
      }
      
      // Validation successful, get the validated origin
      const validatedOrigin = result.data;
      
      // Initialize origins array if not exists
      if (!this.config.origins) {
        this.config.origins = [];
      } else if (!Array.isArray(this.config.origins)) {
        // If origins is an object, convert to array or initialize items array
        if (!this.config.origins.items) {
          this.config.origins.items = [];
        }
      }
      
      // Add the new origin (ensures validatedOrigin is not undefined)
      if (validatedOrigin) {
        if (Array.isArray(this.config.origins)) {
          this.config.origins.push(validatedOrigin);
        } else if (this.config.origins.items) {
          this.config.origins.items.push(validatedOrigin);
        }
      }
      
      return validatedOrigin;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      
      // Type check for error reporting
      const originName = typeof origin === 'object' && origin !== null && 'name' in origin 
        ? String(origin.name) 
        : 'unknown';
      
      // Handle unexpected errors
      throw ConfigurationError.patternError(
        'Invalid origin',
        originName,
        { parameters: { origin } }
      );
    }
  }
  
  /**
   * Get diagnostics for Origins configuration
   * This method provides detailed information about the Origins status
   * 
   * @returns Detailed Origins diagnostics
   */
  // CDN URL handling removed - we now use request origin directly

  public getOriginsDiagnostics() {
    const origins = this.getOrigins();
    const usingOrigins = this.shouldUseOrigins();
    const pathPatternsCount = this.getPathPatterns().length;
    
    // Count source types
    const sourceCounts = {
      r2: 0,
      remote: 0,
      fallback: 0,
      total: 0
    };
    
    // Count origins with various configurations
    let originsWithTtl = 0;
    let originsWithCacheability = 0;
    
    origins.forEach(origin => {
      origin.sources.forEach((source: Source) => {
        sourceCounts[source.type as keyof typeof sourceCounts]++;
        sourceCounts.total++;
      });
      
      if (origin.ttl) originsWithTtl++;
      if (origin.cacheability !== undefined) originsWithCacheability++;
    });
    
    return {
      origins: {
        count: origins.length,
        enabled: usingOrigins,
        status: usingOrigins ? 'active' : 'inactive',
        sourceCounts,
        originsWithTtl,
        originsWithCacheability,
        pathPatternsCount
      }
    };
  }
  
  /**
   * Get passthrough configuration for non-MP4 files
   * @returns The passthrough configuration with defaults if not explicitly set
   */
  public getPassthroughConfig() {
    // Return configuration with defaults
    return this.config.passthrough || {
      enabled: true,
      whitelistedFormats: []
    };
  }

  /**
   * Update the configuration (for testing or dynamic reconfiguration)
   * @param newConfig Partial configuration to update
   * @returns Updated full configuration
   */
  public updateConfig(newConfig: Partial<VideoConfiguration>): VideoConfiguration {
    try {
      // Check for duration settings in the update
      const oldDefaultDuration = this.config.defaults.duration;
      const newDefaultDuration = newConfig.defaults?.duration;
      
      // Capture duration changes for debugging
      const durationChanges = {
        hasNewDefaultDuration: !!newDefaultDuration,
        oldDefaultDuration,
        newDefaultDuration: newDefaultDuration !== undefined ? newDefaultDuration : 'not changed',
        derivativeChanges: {} as Record<string, {old: string | null, new: string | null}>
      };
      
      // Check derivative durations if they're being updated
      if (newConfig.derivatives) {
        const oldDerivatives = this.config.derivatives;
        Object.entries(newConfig.derivatives).forEach(([name, newDeriv]) => {
          const oldDeriv = oldDerivatives[name];
          if (oldDeriv && newDeriv && oldDeriv.duration !== newDeriv.duration) {
            durationChanges.derivativeChanges[name] = {
              old: oldDeriv.duration ?? null,
              new: newDeriv.duration ?? null
            };
          }
        });
      }
      
      // Log duration changes
      try {
        // Dynamically import to avoid circular dependencies
        import('../utils/legacyLoggerAdapter').then(({ info }) => {
          const hasDurationChanges = 
            newDefaultDuration !== undefined || 
            Object.keys(durationChanges.derivativeChanges).length > 0;
          
          if (hasDurationChanges) {
            info('VideoConfigurationManager', 'Duration settings being updated', durationChanges);
          }
        }).catch(() => {
          console.info('[VideoConfigurationManager] Duration settings update:', 
            JSON.stringify(durationChanges));
        });
      } catch (loggingError) {
        // Ignore logging errors - don't want to fail config updates
      }
      
      // Merge the new config with the existing one
      // Special handling for array fields that should be completely replaced, not merged
      const mergedConfig = {
        ...this.config,
        ...newConfig,
        // Ensure path patterns from the new config completely replace the old ones if present
        // Use undefined for pathPatterns if they don't exist in either config
        pathPatterns: newConfig.pathPatterns !== undefined ? newConfig.pathPatterns : this.config.pathPatterns,
        // Ensure origins from the new config completely replace the old ones if present
        origins: newConfig.origins !== undefined ? newConfig.origins : this.config.origins,
      };
      
      // Validate the merged configuration
      this.config = VideoConfigSchema.parse(mergedConfig);
      
      // Log the final configuration details after update
      try {
        import('../utils/loggerUtils').then(({ info }) => {
          // Log duration settings
          info('VideoConfigurationManager', 'Updated configuration duration settings', {
            defaultDuration: this.config.defaults.duration,
            mobileDerivativeDuration: this.config.derivatives.mobile?.duration || 'not set',
            desktopDerivativeDuration: this.config.derivatives.desktop?.duration || 'not set'
          });
          
          // Log path pattern information if it was updated
          if (newConfig.pathPatterns) {
            info('VideoConfigurationManager', 'Updated path patterns', {
              patternCount: this.config.pathPatterns?.length || 0,
              patterns: this.config.pathPatterns ? this.config.pathPatterns.map(p => p.name).join(', ') : 'none'
            });
          }
          
          // Log origins information if it was updated
          if (newConfig.origins) {
            const originsCount = this.getOrigins().length;
            const originsNames = this.getOrigins().map(o => o.name).join(', ') || 'none';
            
            info('VideoConfigurationManager', 'Updated origins', {
              originsCount,
              origins: originsNames
            });
          }
        }).catch(() => {
          // Fall back to legacy logger if loggerUtils isn't available
          import('../utils/legacyLoggerAdapter').then(({ info }) => {
            info('VideoConfigurationManager', 'Updated configuration', {
              pathPatternCount: this.config.pathPatterns?.length || 0,
              originsCount: this.getOrigins().length
            });
          }).catch(() => {
            // Fallback to console logging
            console.info('[VideoConfigurationManager] Updated configuration');
            if (newConfig.pathPatterns) {
              console.info(`[VideoConfigurationManager] Updated path patterns: ${this.config.pathPatterns?.length || 0} patterns`);
            }
            if (newConfig.origins) {
              console.info(`[VideoConfigurationManager] Updated origins: ${this.getOrigins().length} origins`);
            }
          });
        });
      } catch (loggingError) {
        // Use errorHandlingUtils if available
        try {
          import('../utils/errorHandlingUtils').then(({ logErrorWithContext }) => {
            logErrorWithContext(
              'Error logging configuration update',
              loggingError,
              { component: 'VideoConfigurationManager' }
            );
          }).catch(() => {
            // Last resort - console log
            console.error('[VideoConfigurationManager] Error logging configuration update');
          });
        } catch {
          // Silent failure - don't let logging errors impact configuration
        }
      }
      
      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'videoConfig',
          newConfig,
          'Valid video configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'videoConfig',
        newConfig,
        'Valid video configuration'
      );
    }
  }
}

// Export a default instance for easy access
export const configManager = VideoConfigurationManager.getInstance();

/**
 * Update configuration specifically from ConfigurationService KV data
 * This method is called by ConfigurationService when loading from KV
 * to ensure configuration is properly updated from distributed configuration
 * 
 * @param kvConfig Configuration from KV store
 */
export function updateVideoConfigFromKV(kvConfig: Partial<VideoConfiguration>): void {
  try {
    if (!kvConfig) return;
    
    const manager = VideoConfigurationManager.getInstance();
    
    // Log KV configuration update
    import('../utils/legacyLoggerAdapter').then(({ info }) => {
      info('VideoConfigManager', 'Updating from KV configuration', {
        hasDerivatives: !!kvConfig.derivatives,
        pathPatternCount: kvConfig.pathPatterns?.length || 0,
        hasDurationSettings: !!kvConfig.defaults?.duration,
      });
    }).catch(() => {
      // Silent catch - don't fail configuration update if logging fails
      console.log('[VideoConfigManager] Updating from KV configuration');
    });
    
    // Use the regular update method to apply the changes
    manager.updateConfig(kvConfig);
  } catch (error) {
    console.error('[VideoConfigManager] Error updating from KV:', error);
  }
}
