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
});

// Video Derivatives Schema
const DerivativeSchema = z.record(z.object({
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  mode: z.enum(['video', 'frame', 'spritesheet']).optional(),
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

// Complete Video Configuration Schema
export const VideoConfigSchema = z.object({
  derivatives: DerivativeSchema,
  defaults: z.object({
    width: z.number().nullable(),
    height: z.number().nullable(),
    mode: z.enum(['video', 'frame', 'spritesheet']),
    fit: z.enum(['contain', 'scale-down', 'cover']),
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
  }),
  paramMapping: z.record(z.string()),
  cdnCgi: z.object({
    basePath: z.string(),
  }),
  pathPatterns: z.array(PathPatternSchema),
  caching: z.object({
    method: z.enum(['cf', 'cacheApi']),
    debug: z.boolean(),
    fallback: z.object({
      enabled: z.boolean(),
      badRequestOnly: z.boolean(),
      preserveHeaders: z.array(z.string()).optional()
    }),
  }),
  cache: z.record(CacheConfigSchema),
});

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
      // Validate and parse the configuration
      this.config = VideoConfigSchema.parse(initialConfig);
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
    return this.config.pathPatterns;
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
   * Get cache configuration
   */
  public getCacheConfig() {
    return this.config.cache;
  }

  /**
   * Get responsive configuration
   */
  public getResponsiveConfig() {
    return this.config.responsive;
  }

  /**
   * Get caching method configuration
   */
  public getCachingConfig() {
    return this.config.caching;
  }

  /**
   * Update the configuration (for testing or dynamic reconfiguration)
   */
  public updateConfig(newConfig: Partial<VideoConfiguration>): VideoConfiguration {
    try {
      // Merge the new config with the existing one
      const mergedConfig = {
        ...this.config,
        ...newConfig,
      };
      
      // Validate the merged configuration
      this.config = VideoConfigSchema.parse(mergedConfig);
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