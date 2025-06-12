/**
 * LoggingConfigurationManager
 * 
 * A centralized configuration manager for logging with Zod schema validation
 */
import { z } from 'zod';
import { ConfigurationError } from '../errors';

// Define Zod schemas for logging configuration
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

export const LoggingConfigSchema = z.object({
  // Logging levels and behavior
  level: LogLevelSchema.default('info'),
  includeTimestamps: z.boolean().default(true),
  includeComponentName: z.boolean().default(true),
  
  // Output formatting
  format: z.enum(['json', 'text']).default('text'),
  colorize: z.boolean().default(true),
  
  // Components to enable/disable logging for
  enabledComponents: z.array(z.string()).default([]),
  disabledComponents: z.array(z.string()).default([]),
  
  // Sampling configuration
  sampleRate: z.number().min(0).max(1).default(1),
  
  // Performance logging
  enablePerformanceLogging: z.boolean().default(false),
  performanceThresholdMs: z.number().min(0).default(1000),
  
  // Breadcrumb configuration
  breadcrumbs: z.object({
    enabled: z.boolean().default(true),
    maxItems: z.number().min(0).default(100)
  }).default({
    enabled: true,
    maxItems: 100
  }),
  
  // Pino specific configuration
  pino: z.object({
    level: LogLevelSchema.default('info'),
    browser: z.object({
      asObject: z.boolean().default(true)
    }).optional(),
    base: z.object({
      service: z.string().default('video-resizer'),
      env: z.string().default('development')
    }).optional(),
    transport: z.any().optional()
  }).default({
    level: 'info',
    browser: { asObject: true },
    base: { service: 'video-resizer', env: 'development' }
  })
});

// Type exported from the schema
export type LoggingConfiguration = z.infer<typeof LoggingConfigSchema>;

// Default configuration
const defaultLoggingConfig: LoggingConfiguration = {
  level: 'debug',
  includeTimestamps: true,
  includeComponentName: true,
  format: 'text',
  colorize: true,
  enabledComponents: [],
  disabledComponents: [],
  sampleRate: 1,
  enablePerformanceLogging: true,
  performanceThresholdMs: 1000,
  breadcrumbs: {
    enabled: true,
    maxItems: 100
  },
  pino: {
    level: 'debug',
    browser: { asObject: true },
    base: { service: 'video-resizer', env: 'development' }
  }
};

/**
 * LoggingConfigurationManager class for managing and validating logging configuration
 */
export class LoggingConfigurationManager {
  private static instance: LoggingConfigurationManager;
  private config: LoggingConfiguration;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(initialConfig: unknown = defaultLoggingConfig) {
    try {
      // Validate and parse the configuration
      this.config = LoggingConfigSchema.parse(initialConfig);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'loggingConfig',
          initialConfig,
          'Valid logging configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'loggingConfig',
        initialConfig,
        'Valid logging configuration'
      );
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(initialConfig?: unknown): LoggingConfigurationManager {
    if (!LoggingConfigurationManager.instance) {
      LoggingConfigurationManager.instance = new LoggingConfigurationManager(initialConfig);
    }
    return LoggingConfigurationManager.instance;
  }

  /**
   * Reset the instance (useful for testing)
   */
  public static resetInstance(): void {
    LoggingConfigurationManager.instance = undefined as unknown as LoggingConfigurationManager;
  }

  /**
   * Get the entire configuration
   */
  public getConfig(): LoggingConfiguration {
    return this.config;
  }

  /**
   * Get the current log level
   */
  public getLogLevel(): string {
    return this.config.level;
  }

  /**
   * Get the Pino-specific configuration
   */
  public getPinoConfig(): any {
    return this.config.pino;
  }

  /**
   * Check if a component should be logged
   */
  public shouldLogComponent(componentName: string): boolean {
    // If specific components are enabled, check if this component matches
    if (this.config.enabledComponents.length > 0) {
      return this.matchesComponentPatterns(componentName, this.config.enabledComponents);
    }
    
    // Otherwise, log all components that don't match disabled patterns
    return !this.matchesComponentPatterns(componentName, this.config.disabledComponents);
  }
  
  /**
   * Check if a component name matches any of the patterns
   * Supports exact match and wildcard patterns (e.g., "Cache*", "*Utils", "Cache*Storage*", etc.)
   */
  private matchesComponentPatterns(componentName: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      // Exact match
      if (pattern === componentName) {
        return true;
      }
      
      // Convert wildcard pattern to regex
      // Replace * with .* and escape other regex special characters
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars except *
        .replace(/\*/g, '.*'); // Replace * with .*
      
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(componentName)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if a log should be sampled based on the sample rate
   */
  public shouldSampleLog(): boolean {
    return Math.random() < this.config.sampleRate;
  }

  /**
   * Get the sampling configuration
   */
  public getSamplingConfig(): { enabled: boolean, rate: number } {
    return {
      enabled: this.config.sampleRate < 1.0, 
      rate: this.config.sampleRate
    };
  }

  /**
   * Check if performance should be logged
   */
  public shouldLogPerformance(): boolean {
    return this.config.enablePerformanceLogging;
  }

  /**
   * Get the performance threshold in milliseconds
   */
  public getPerformanceThreshold(): number {
    return this.config.performanceThresholdMs;
  }

  /**
   * Get breadcrumb configuration
   */
  public getBreadcrumbConfig(): { enabled: boolean, maxItems: number } {
    return this.config.breadcrumbs;
  }

  /**
   * Check if breadcrumbs are enabled
   */
  public areBreadcrumbsEnabled(): boolean {
    return this.config.breadcrumbs.enabled;
  }

  /**
   * Get maximum number of breadcrumbs to keep
   */
  public getMaxBreadcrumbs(): number {
    return this.config.breadcrumbs.maxItems;
  }

  /**
   * Validate a configuration object
   * @param config Configuration to validate
   * @returns Validation result with errors if any
   */
  public validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    try {
      LoggingConfigSchema.parse(config);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(issue => {
          const path = issue.path.join('.');
          const message = issue.message;
          return `${path}: ${message}`;
        });
        return { valid: false, errors };
      }
      return { valid: false, errors: ['Unknown validation error'] };
    }
  }

  /**
   * Update the configuration
   */
  public updateConfig(newConfig: Partial<LoggingConfiguration>): LoggingConfiguration {
    try {
      // Store the previous configuration for logging
      const previousConfig = { ...this.config };
      
      // Merge the new config with the existing one
      const mergedConfig = {
        ...this.config,
        ...newConfig,
      };
      
      // Validate the merged configuration
      this.config = LoggingConfigSchema.parse(mergedConfig);
      
      // Log configuration changes
      const changes: Record<string, { old: any, new: any }> = {};
      let hasChanges = false;
      
      // Check for changes in key properties
      if (previousConfig.level !== this.config.level) {
        changes.level = { old: previousConfig.level, new: this.config.level };
        hasChanges = true;
      }
      if (previousConfig.format !== this.config.format) {
        changes.format = { old: previousConfig.format, new: this.config.format };
        hasChanges = true;
      }
      if (previousConfig.sampleRate !== this.config.sampleRate) {
        changes.sampleRate = { old: previousConfig.sampleRate, new: this.config.sampleRate };
        hasChanges = true;
      }
      if (previousConfig.breadcrumbs.enabled !== this.config.breadcrumbs.enabled) {
        changes.breadcrumbsEnabled = { old: previousConfig.breadcrumbs.enabled, new: this.config.breadcrumbs.enabled };
        hasChanges = true;
      }
      
      // Log changes if any occurred
      if (hasChanges) {
        // Use console.info to avoid circular dependency with logger
        console.info('Logging configuration updated', {
          source: 'LoggingConfigurationManager',
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
        console.error('Logging configuration validation failed', {
          source: 'LoggingConfigurationManager',
          errors: validationErrors,
          invalidConfig: newConfig,
          timestamp: new Date().toISOString()
        });
        
        // Attempt graceful fallback - revert to previous config
        console.warn('Reverting to previous logging configuration', {
          source: 'LoggingConfigurationManager',
          previousLevel: this.config.level,
          attemptedConfig: newConfig
        });
        
        // Don't throw - just return current config
        return this.config;
      }
      
      // For unknown errors, log and return current config
      console.error('Unknown error updating logging configuration', {
        source: 'LoggingConfigurationManager',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      
      return this.config;
    }
  }
}

// Export a default instance for easy access
export const loggingConfig = LoggingConfigurationManager.getInstance();