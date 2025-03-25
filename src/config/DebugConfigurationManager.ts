/**
 * DebugConfigurationManager
 * 
 * A centralized configuration manager for debugging with Zod schema validation
 */
import { z } from 'zod';
import { ConfigurationError } from '../errors';

// Define Zod schema for debug configuration
export const DebugConfigSchema = z.object({
  // Basic debugging options
  enabled: z.boolean().default(false),
  verbose: z.boolean().default(false),
  includeHeaders: z.boolean().default(false),
  includePerformance: z.boolean().default(false),
  
  // Debug modes
  dashboardMode: z.boolean().default(true),
  viewMode: z.boolean().default(true),
  headerMode: z.boolean().default(true),
  
  // Query string parameters that trigger debug views
  debugQueryParam: z.string().default('debug'),
  debugViewParam: z.string().default('view'),
  
  // Headers settings
  debugHeaders: z.array(z.string()).default([
    'X-Debug', 
    'X-Debug-Enabled', 
    'Debug'
  ]),
  
  // Debug HTML rendering options
  renderStaticHtml: z.boolean().default(true),
  includeStackTrace: z.boolean().default(false),
  
  // Content settings
  maxContentLength: z.number().positive().default(50000),
  truncationMessage: z.string().default('... [content truncated]'),
  
  // Filter options
  allowedIps: z.array(z.string()).default([]),
  excludedPaths: z.array(z.string()).default([]),
});

// Type exported from the schema
export type DebugConfiguration = z.infer<typeof DebugConfigSchema>;

// Default configuration
const defaultDebugConfig: DebugConfiguration = {
  enabled: false,
  verbose: false,
  includeHeaders: false,
  includePerformance: false,
  dashboardMode: true,
  viewMode: true,
  headerMode: true,
  debugQueryParam: 'debug',
  debugViewParam: 'view',
  debugHeaders: ['X-Debug', 'X-Debug-Enabled', 'Debug'],
  renderStaticHtml: true,
  includeStackTrace: false,
  maxContentLength: 50000,
  truncationMessage: '... [content truncated]',
  allowedIps: [],
  excludedPaths: [],
};

/**
 * DebugConfigurationManager class for managing and validating debug configuration
 */
export class DebugConfigurationManager {
  private static instance: DebugConfigurationManager;
  private config: DebugConfiguration;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(initialConfig: unknown = defaultDebugConfig) {
    try {
      // Validate and parse the configuration
      this.config = DebugConfigSchema.parse(initialConfig);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'debugConfig',
          initialConfig,
          'Valid debug configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'debugConfig',
        initialConfig,
        'Valid debug configuration'
      );
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(initialConfig?: unknown): DebugConfigurationManager {
    if (!DebugConfigurationManager.instance) {
      DebugConfigurationManager.instance = new DebugConfigurationManager(initialConfig);
    }
    return DebugConfigurationManager.instance;
  }

  /**
   * Reset the instance (useful for testing)
   */
  public static resetInstance(): void {
    DebugConfigurationManager.instance = undefined as unknown as DebugConfigurationManager;
  }

  /**
   * Get the entire configuration
   */
  public getConfig(): DebugConfiguration {
    return this.config;
  }

  /**
   * Check if debugging is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if verbose debugging is enabled
   */
  public isVerbose(): boolean {
    return this.config.verbose && this.config.enabled;
  }
  
  /**
   * Check if debug is enabled (alias for isEnabled for consistency)
   */
  public isDebugEnabled(): boolean {
    return this.isEnabled();
  }
  
  /**
   * Check if verbose is enabled (alias for isVerbose for consistency)
   */
  public isVerboseEnabled(): boolean {
    return this.isVerbose();
  }

  /**
   * Check if header inclusion is enabled
   */
  public shouldIncludeHeaders(): boolean {
    return this.config.includeHeaders && this.config.enabled;
  }

  /**
   * Check if performance metrics should be included
   */
  public shouldIncludePerformance(): boolean {
    return this.config.includePerformance && this.config.enabled;
  }

  /**
   * Check if debugging should be enabled for a specific request
   */
  public shouldEnableForRequest(request: Request): boolean {
    // If debugging is not enabled globally, check other conditions
    if (!this.config.enabled) {
      // Check for debug query parameters
      const url = new URL(request.url);
      if (url.searchParams.has(this.config.debugQueryParam)) {
        return true;
      }
      
      // Check for debug headers
      for (const headerName of this.config.debugHeaders) {
        if (request.headers.has(headerName)) {
          return true;
        }
      }
      
      return false;
    }
    
    // Debugging is globally enabled, check exclusions
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Check for excluded paths
    for (const excludedPath of this.config.excludedPaths) {
      if (path.startsWith(excludedPath)) {
        return false;
      }
    }
    
    // If we have allowed IPs and client IP is not in the list, disable debug
    if (this.config.allowedIps.length > 0) {
      const clientIp = request.headers.get('CF-Connecting-IP');
      if (clientIp && !this.config.allowedIps.includes(clientIp)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check if debug view rendering is requested
   */
  public isDebugViewRequested(request: Request): boolean {
    const url = new URL(request.url);
    return (
      url.searchParams.has(this.config.debugQueryParam) && 
      url.searchParams.get(this.config.debugQueryParam) === this.config.debugViewParam
    );
  }

  /**
   * Update the configuration
   */
  public updateConfig(newConfig: Partial<DebugConfiguration>): DebugConfiguration {
    try {
      // Merge the new config with the existing one
      const mergedConfig = {
        ...this.config,
        ...newConfig,
      };
      
      // Validate the merged configuration
      this.config = DebugConfigSchema.parse(mergedConfig);
      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'debugConfig',
          newConfig,
          'Valid debug configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'debugConfig',
        newConfig,
        'Valid debug configuration'
      );
    }
  }

  /**
   * Add an allowed IP address
   */
  public addAllowedIp(ip: string): string[] {
    if (!this.config.allowedIps.includes(ip)) {
      this.config.allowedIps.push(ip);
    }
    return this.config.allowedIps;
  }

  /**
   * Add an excluded path
   */
  public addExcludedPath(path: string): string[] {
    if (!this.config.excludedPaths.includes(path)) {
      this.config.excludedPaths.push(path);
    }
    return this.config.excludedPaths;
  }
}

// Export a default instance for easy access
export const debugConfig = DebugConfigurationManager.getInstance();