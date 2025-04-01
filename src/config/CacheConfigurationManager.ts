/**
 * CacheConfigurationManager
 * 
 * A centralized configuration manager for caching with Zod schema validation
 */
import { z } from 'zod';
import { ConfigurationError } from '../errors';

// Define Zod schemas for cache TTL configuration
export const CacheTTLSchema = z.object({
  ok: z.number().nonnegative().default(86400), // 24 hours for successful responses
  redirects: z.number().nonnegative().default(3600), // 1 hour for redirects
  clientError: z.number().nonnegative().default(60), // 1 minute for client errors
  serverError: z.number().nonnegative().default(10), // 10 seconds for server errors
});

// Define schema for a cache profile
export const CacheProfileSchema = z.object({
  regex: z.string(),
  cacheability: z.boolean().default(true),
  videoCompression: z.enum(['auto', 'low', 'medium', 'high', 'off']).default('auto'),
  // Whether to use status-based TTLs (cacheTtlByStatus) or a single TTL (cacheTtl)
  useTtlByStatus: z.boolean().optional().default(true),
  ttl: CacheTTLSchema.default({
    ok: 86400,
    redirects: 3600,
    clientError: 60,
    serverError: 10,
  }),
});

// Define schema for cache configuration
export const CacheConfigSchema = z.object({
  // Caching method: 'cf' for Cloudflare-managed cache, 'cacheApi' for Cache API
  method: z.enum(['cf', 'cacheApi']).default('cacheApi'),
  
  // Enable debug logging for cache operations
  debug: z.boolean().default(false),
  
  // Default behavior for cache headers
  defaultMaxAge: z.number().nonnegative().default(86400),
  respectOriginHeaders: z.boolean().default(true),
  cacheEverything: z.boolean().default(false),
  
  // Cache tagging and purging
  enableCacheTags: z.boolean().default(true),
  purgeOnUpdate: z.boolean().default(false),
  
  // Bypass settings
  bypassQueryParameters: z.array(z.string()).default(['nocache', 'bypass']),
  bypassHeaderValue: z.string().default('no-cache'),
  
  // Cache profiles for different content types
  profiles: z.record(CacheProfileSchema).default({
    default: {
      regex: '.*',
      cacheability: true,
      videoCompression: 'auto',
      ttl: {
        ok: 86400,
        redirects: 3600,
        clientError: 60,
        serverError: 10,
      },
    },
  }),
});

// Type exported from the schema
export type CacheConfiguration = z.infer<typeof CacheConfigSchema>;
export type CacheTTLConfiguration = z.infer<typeof CacheTTLSchema>;
export type CacheProfileConfiguration = z.infer<typeof CacheProfileSchema>;

// Default configuration
const defaultCacheConfig: CacheConfiguration = {
  method: 'cf',
  debug: false,
  defaultMaxAge: 86400,
  respectOriginHeaders: true,
  cacheEverything: false,
  enableCacheTags: true,
  purgeOnUpdate: false,
  bypassQueryParameters: ['nocache', 'bypass'],
  bypassHeaderValue: 'no-cache',
  profiles: {
    default: {
      regex: '.*',
      cacheability: true,
      videoCompression: 'auto',
      useTtlByStatus: true,
      ttl: {
        ok: 86400,
        redirects: 3600,
        clientError: 60,
        serverError: 10,
      },
    },
    highTraffic: {
      regex: '.*\\/popular\\/.*\\.mp4',
      cacheability: true,
      videoCompression: 'auto',
      useTtlByStatus: true,
      ttl: {
        ok: 604800, // 7 days
        redirects: 3600,
        clientError: 60,
        serverError: 10,
      },
    },
    shortForm: {
      regex: '.*\\/shorts\\/.*\\.mp4',
      cacheability: true,
      videoCompression: 'auto',
      useTtlByStatus: true,
      ttl: {
        ok: 172800, // 2 days
        redirects: 3600,
        clientError: 60,
        serverError: 10,
      },
    },
    dynamic: {
      regex: '.*\\/live\\/.*\\.mp4',
      cacheability: true,
      videoCompression: 'auto',
      useTtlByStatus: true,
      ttl: {
        ok: 300, // 5 minutes
        redirects: 60,
        clientError: 30,
        serverError: 10,
      },
    },
  },
};

/**
 * CacheConfigurationManager class for managing and validating cache configuration
 */
export class CacheConfigurationManager {
  private static instance: CacheConfigurationManager;
  private config: CacheConfiguration;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(initialConfig: unknown = defaultCacheConfig) {
    try {
      // Validate and parse the configuration
      this.config = CacheConfigSchema.parse(initialConfig);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'cacheConfig',
          initialConfig,
          'Valid cache configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'cacheConfig',
        initialConfig,
        'Valid cache configuration'
      );
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(initialConfig?: unknown): CacheConfigurationManager {
    if (!CacheConfigurationManager.instance) {
      CacheConfigurationManager.instance = new CacheConfigurationManager(initialConfig);
    }
    return CacheConfigurationManager.instance;
  }

  /**
   * Reset the instance (useful for testing)
   */
  public static resetInstance(): void {
    CacheConfigurationManager.instance = undefined as unknown as CacheConfigurationManager;
  }

  /**
   * Get the entire configuration
   */
  public getConfig(): CacheConfiguration {
    return this.config;
  }

  /**
   * Get the cache method (cf or cacheApi)
   */
  public getCacheMethod(): string {
    return this.config.method;
  }

  /**
   * Check if cache debugging is enabled
   */
  public isDebugEnabled(): boolean {
    return this.config.debug;
  }

  /**
   * Determine if cache should be bypassed based on query parameters
   * This only checks for specific bypass parameters, not all query parameters
   */
  public shouldBypassCache(url: URL): boolean {
    // Only check for specific bypass parameters (nocache, bypass, debug)
    // Do NOT treat all query parameters (like imwidth) as bypass triggers
    for (const param of this.config.bypassQueryParameters) {
      if (url.searchParams.has(param)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get cache profile for a given URL path
   */
  public getProfileForPath(path: string): CacheProfileConfiguration {
    // Check all profiles for a matching regex
    for (const [name, profile] of Object.entries(this.config.profiles)) {
      if (name === 'default') continue; // Skip default, we'll fall back to it
      
      const regex = new RegExp(profile.regex);
      if (regex.test(path)) {
        return profile;
      }
    }
    
    // Fall back to default profile
    return this.config.profiles.default;
  }

  /**
   * Update the configuration
   */
  public updateConfig(newConfig: Partial<CacheConfiguration>): CacheConfiguration {
    try {
      // Merge the new config with the existing one
      const mergedConfig = {
        ...this.config,
        ...newConfig,
        // Merge nested objects
        profiles: {
          ...this.config.profiles,
          ...(newConfig.profiles || {}),
        },
      };
      
      // Validate the merged configuration
      this.config = CacheConfigSchema.parse(mergedConfig);
      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'cacheConfig',
          newConfig,
          'Valid cache configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'cacheConfig',
        newConfig,
        'Valid cache configuration'
      );
    }
  }

  /**
   * Add a new cache profile
   */
  public addProfile(name: string, profile: Partial<CacheProfileConfiguration>): CacheProfileConfiguration {
    try {
      // Validate the profile
      const validatedProfile = CacheProfileSchema.parse(profile);
      
      // Add the useTtlByStatus field with default value true if it doesn't exist
      const profileWithDefaults = {
        ...validatedProfile,
        useTtlByStatus: validatedProfile.useTtlByStatus !== undefined ? validatedProfile.useTtlByStatus : true
      };
      
      // Update the config with the new profile
      this.config.profiles[name] = profileWithDefaults;
      
      return profileWithDefaults;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          `cacheProfile.${name}`,
          profile,
          'Valid cache profile configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        `cacheProfile.${name}`,
        profile,
        'Valid cache profile configuration'
      );
    }
  }
}

// Export a default instance for easy access
export const cacheConfig = CacheConfigurationManager.getInstance();

// Add this to ensure module gets picked up properly in tests
if (typeof cacheConfig === 'undefined') {
  console.warn('CacheConfigurationManager failed to initialize default instance');
}