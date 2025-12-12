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
  
  // Whether to preserve debug parameters in transformed URLs
  preserveDebugParams: z.boolean().default(false),
  
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
  enabled: true,
  verbose: true,
  includeHeaders: true,
  includePerformance: true,
  dashboardMode: true,
  viewMode: true,
  headerMode: true,
  debugQueryParam: 'debug',
  debugViewParam: 'view',
  preserveDebugParams: false,
  debugHeaders: ['X-Debug', 'X-Debug-Enabled', 'Debug'],
  renderStaticHtml: true,
  includeStackTrace: true,
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
   * Check if debug parameters should be preserved in URLs
   */
  public shouldPreserveDebugParams(): boolean {
    return this.config.preserveDebugParams;
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
      // Store the previous configuration for logging
      const previousConfig = { ...this.config };
      
      // Merge the new config with the existing one
      const mergedConfig = {
        ...this.config,
        ...newConfig,
      };
      
      // Validate the merged configuration
      this.config = DebugConfigSchema.parse(mergedConfig);
      
      // Log configuration changes
      const changes: Record<string, { old: any, new: any }> = {};
      let hasChanges = false;
      
      // Check for changes in key properties
      if (previousConfig.enabled !== this.config.enabled) {
        changes.enabled = { old: previousConfig.enabled, new: this.config.enabled };
        hasChanges = true;
      }
      if (previousConfig.verbose !== this.config.verbose) {
        changes.verbose = { old: previousConfig.verbose, new: this.config.verbose };
        hasChanges = true;
      }
      if (previousConfig.includeHeaders !== this.config.includeHeaders) {
        changes.includeHeaders = { old: previousConfig.includeHeaders, new: this.config.includeHeaders };
        hasChanges = true;
      }
      if (previousConfig.includePerformance !== this.config.includePerformance) {
        changes.includePerformance = { old: previousConfig.includePerformance, new: this.config.includePerformance };
        hasChanges = true;
      }
      
      // Log changes if any occurred
      if (hasChanges) {
        // Use console.info to avoid circular dependency with logger
        console.info({
          context: 'DebugConfigurationManager',
          operation: 'updateConfig',
          message: 'Debug configuration updated',
          changes,
          timestamp: new Date().toISOString()
        });
      }
      return this.config;
    } catch (error) {
      // Store validation errors for logging
      let validationErrors: string[] = [];
      
      if (error instanceof z.ZodError) {
        validationErrors = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        );
        
        // Log validation failure
        console.error({
          context: 'DebugConfigurationManager',
          operation: 'updateConfig',
          message: 'Debug configuration validation failed',
          errors: validationErrors,
          invalidConfig: newConfig,
          timestamp: new Date().toISOString()
        });

        // Attempt graceful fallback - revert to previous config
        console.warn({
          context: 'DebugConfigurationManager',
          operation: 'updateConfig',
          message: 'Reverting to previous debug configuration',
          previousEnabled: this.config.enabled,
          attemptedConfig: newConfig
        });
        
        // Don't throw - just return current config
        return this.config;
      }
      
      // For unknown errors, log and return current config
      console.error({
        context: 'DebugConfigurationManager',
        operation: 'updateConfig',
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        timestamp: new Date().toISOString()
      });
      
      return this.config;
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