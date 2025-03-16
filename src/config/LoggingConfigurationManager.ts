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
});

// Type exported from the schema
export type LoggingConfiguration = z.infer<typeof LoggingConfigSchema>;

// Default configuration
const defaultLoggingConfig: LoggingConfiguration = {
  level: 'info',
  includeTimestamps: true,
  includeComponentName: true,
  format: 'text',
  colorize: true,
  enabledComponents: [],
  disabledComponents: [],
  sampleRate: 1,
  enablePerformanceLogging: false,
  performanceThresholdMs: 1000,
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
   * Check if a component should be logged
   */
  public shouldLogComponent(componentName: string): boolean {
    // If specific components are enabled, only log those
    if (this.config.enabledComponents.length > 0) {
      return this.config.enabledComponents.includes(componentName);
    }
    
    // Otherwise, log all components that aren't specifically disabled
    return !this.config.disabledComponents.includes(componentName);
  }

  /**
   * Check if a log should be sampled based on the sample rate
   */
  public shouldSampleLog(): boolean {
    return Math.random() < this.config.sampleRate;
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
   * Update the configuration
   */
  public updateConfig(newConfig: Partial<LoggingConfiguration>): LoggingConfiguration {
    try {
      // Merge the new config with the existing one
      const mergedConfig = {
        ...this.config,
        ...newConfig,
      };
      
      // Validate the merged configuration
      this.config = LoggingConfigSchema.parse(mergedConfig);
      return this.config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map(issue => 
          `${issue.path.join('.')}: ${issue.message}`
        ).join(', ');
        
        throw ConfigurationError.invalidValue(
          'loggingConfig',
          newConfig,
          'Valid logging configuration',
          { additionalInfo: `Validation errors: ${issues}` }
        );
      }
      
      throw ConfigurationError.invalidValue(
        'loggingConfig',
        newConfig,
        'Valid logging configuration'
      );
    }
  }
}

// Export a default instance for easy access
export const loggingConfig = LoggingConfigurationManager.getInstance();