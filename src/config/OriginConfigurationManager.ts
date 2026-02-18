/**
 * Origin Configuration Manager
 *
 * Manages the Origins configuration with specialized methods for validation,
 * access, and conversion between formats.
 */

import { Origin, Source, OriginsConfig } from '../services/videoStorage/interfaces';
import { safeValidateOrigin } from './originSchema';
import { convertPathPatternToOrigin } from './originConverters';
import { VideoConfigurationManager } from './VideoConfigurationManager';
import { createCategoryLogger } from '../utils/logger';

const logger = createCategoryLogger('OriginConfigurationManager');

/**
 * Shape of the worker config object that provides origins configuration.
 * Previously stored on globalThis.WORKER_CONFIG; now passed explicitly
 * via `OriginConfigurationManager.setWorkerConfig()`.
 */
export interface WorkerConfigShape {
  video?: {
    origins?:
      | Origin[]
      | {
          enabled?: boolean;
          useLegacyPathPatterns?: boolean;
          convertPathPatternsToOrigins?: boolean;
          fallbackHandling?: {
            enabled?: boolean;
            maxRetries?: number;
          };
          items?: Origin[];
        };
  };
  [key: string]: unknown;
}

/**
 * Manages Origin configuration with specialized methods
 */
export class OriginConfigurationManager {
  private static instance: OriginConfigurationManager;
  private static workerConfig: WorkerConfigShape | undefined;
  private origins: Origin[] = [];
  private originMap: Map<string, Origin> = new Map();
  private videoConfig: VideoConfigurationManager;

  /**
   * Private constructor - use getInstance() instead
   */
  private constructor() {
    this.videoConfig = VideoConfigurationManager.getInstance();
    this.initializeOrigins();
  }

  /**
   * Get the singleton instance
   * @returns The OriginConfigurationManager instance
   */
  public static getInstance(): OriginConfigurationManager {
    if (!OriginConfigurationManager.instance) {
      OriginConfigurationManager.instance = new OriginConfigurationManager();
    }
    return OriginConfigurationManager.instance;
  }

  /**
   * Provide the worker config (from worker-config.json) so that origins
   * can be resolved without relying on globalThis.
   * Must be called before getInstance() for the config to take effect on
   * first initialization. If called after, call reset() to re-initialize.
   */
  public static setWorkerConfig(config: WorkerConfigShape): void {
    OriginConfigurationManager.workerConfig = config;
  }

  /**
   * Check if the origins config is the array type
   * @param origins The origins configuration
   * @returns True if it's an array of Origins
   */
  private isOriginsArray(origins: any): origins is Origin[] {
    return Array.isArray(origins);
  }

  /**
   * Check if the origins config is the object type with control flags
   * @param origins The origins configuration
   * @returns True if it's an OriginsConfig object
   */
  private isOriginsConfig(origins: any): origins is OriginsConfig {
    return !Array.isArray(origins) && typeof origins === 'object' && origins !== null;
  }

  /**
   * Initialize the Origins list from configuration
   */
  private initializeOrigins() {
    const config = this.videoConfig.getConfig();

    // Initialize an empty array
    this.origins = [];
    this.originMap.clear();

    // Get the origins configuration
    const originsConfig = config.origins;
    let originsEnabled = true;
    let useLegacyPathPatterns = true;

    logger.debug('Initializing origins', {
      hasOriginsConfig: !!originsConfig,
      originsType: originsConfig ? typeof originsConfig : 'undefined',
      isArray: originsConfig ? Array.isArray(originsConfig) : false,
      hasItems:
        originsConfig && typeof originsConfig === 'object' ? 'items' in originsConfig : false,
    });

    // Check what kind of origins configuration we have
    if (this.isOriginsConfig(originsConfig)) {
      // If we have an object with control flags
      originsEnabled = originsConfig.enabled !== false;
      useLegacyPathPatterns = originsConfig.useLegacyPathPatterns !== false;

      logger.debug('Found origins config object', {
        enabled: originsEnabled,
        useLegacyPathPatterns,
        hasItems: Array.isArray(originsConfig.items),
        itemsCount: Array.isArray(originsConfig.items) ? originsConfig.items.length : 0,
      });

      // If we have items in the config, use those
      if (Array.isArray(originsConfig.items) && originsConfig.items.length > 0) {
        this.origins = [...originsConfig.items];
        logger.debug('Loaded origins from items array', {
          count: this.origins.length,
        });
      }
    } else if (this.isOriginsArray(originsConfig)) {
      // If we have a direct array of Origins, use that
      this.origins = [...originsConfig];
      logger.debug('Loaded origins from direct array', {
        count: this.origins.length,
      });
    }

    // If we have a worker config (from worker-config.json), use its origins
    const wc = OriginConfigurationManager.workerConfig;
    if (originsEnabled && wc) {
      // Debug the worker config structure
      logger.debug('Checking workerConfig structure', {
        hasVideoConfig: !!wc.video,
        hasVideoOrigins: !!wc.video?.origins,
        videoOriginsType: wc.video?.origins ? typeof wc.video.origins : 'undefined',
      });

      // Check workerConfig.video.origins (as array)
      if (wc.video && Array.isArray(wc.video.origins)) {
        this.origins = [...wc.video.origins];
        logger.info('Loaded origins array from workerConfig.video.origins', {
          count: this.origins.length,
          names: this.origins.map((o) => o.name).join(', '),
        });
      }
      // Check workerConfig.video.origins as object with items array
      else if (
        wc.video &&
        wc.video.origins &&
        typeof wc.video.origins === 'object' &&
        'items' in wc.video.origins &&
        Array.isArray((wc.video.origins as any).items)
      ) {
        this.origins = [...(wc.video.origins as any).items];
        logger.info('Loaded origins from workerConfig.video.origins.items', {
          count: this.origins.length,
          names: this.origins.map((o) => o.name).join(', '),
        });
      }
      // Log if no origins were found in workerConfig
      else {
        logger.warn('No origins found in workerConfig', {
          hasVideoConfig: !!wc.video,
          hasVideoOrigins: !!wc.video?.origins,
          videoOriginsType: wc.video?.origins ? typeof wc.video.origins : 'undefined',
        });
      }
    }

    // If we still don't have origins and should use legacy path patterns
    if (
      this.origins.length === 0 &&
      originsEnabled &&
      useLegacyPathPatterns &&
      config.pathPatterns
    ) {
      // Convert path patterns to Origins for backward compatibility
      this.origins = this.convertFromPathPatterns();
      logger.debug('Converted path patterns to origins', {
        patternCount: config.pathPatterns.length,
        originCount: this.origins.length,
      });
    }

    // Validate and index the origins by name
    this.validateAndIndexOrigins();

    logger.debug('Origins initialization complete', {
      totalOrigins: this.origins.length,
      originNames: this.origins.length > 0 ? this.origins.map((o) => o.name).join(', ') : 'none',
    });
  }

  /**
   * Validate all origins and index them by name
   */
  private validateAndIndexOrigins() {
    const validOrigins: Origin[] = [];

    // Validate each origin
    for (const origin of this.origins) {
      const result = safeValidateOrigin(origin);

      if (result.success && result.data) {
        validOrigins.push(result.data);
        this.originMap.set(result.data.name, result.data);
        logger.debug('Validated origin', {
          name: result.data.name,
          matcher: result.data.matcher,
          sourceCount: result.data.sources?.length || 0,
        });
      } else if (result.error) {
        logger.error('Invalid origin configuration', {
          error: result.error.message,
          origin: origin.name || 'unnamed',
        });
      }
    }

    // Replace origins with validated ones
    this.origins = validOrigins;

    logger.info('Origins validated and indexed', {
      validCount: validOrigins.length,
      totalAttempted: this.origins.length,
    });
  }

  /**
   * Convert legacy path patterns to Origins
   * @returns An array of Origins converted from path patterns
   */
  public convertFromPathPatterns(): Origin[] {
    const config = this.videoConfig.getConfig();
    const result: Origin[] = [];

    if (!Array.isArray(config.pathPatterns) || config.pathPatterns.length === 0) {
      return result;
    }

    // Get storage config for conversion
    const storageConfig = config.storage || {};

    // Convert each path pattern
    for (const pathPattern of config.pathPatterns) {
      try {
        const origin = convertPathPatternToOrigin(pathPattern, storageConfig);
        result.push(origin);
      } catch (error) {
        console.error({
          context: 'OriginConfigurationManager',
          operation: 'convertPathPatternsToOrigins',
          message: 'Error converting path pattern to origin',
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Get all configured origins
   * @returns Array of Origins
   */
  public getOrigins(): Origin[] {
    return [...this.origins];
  }

  /**
   * Find an origin by name
   * @param name The origin name to find
   * @returns The matching Origin or undefined if not found
   */
  public findOriginByName(name: string): Origin | undefined {
    return this.originMap.get(name);
  }

  /**
   * Add a new origin to the configuration
   * @param origin The origin to add
   * @throws Error if the origin is invalid
   */
  public addOrigin(origin: unknown): void {
    const result = safeValidateOrigin(origin);

    if (!result.success || !result.data) {
      throw new Error(
        `Invalid origin configuration: ${result.error?.message || 'Validation failed'}`
      );
    }

    // Check for duplicate name
    if (this.originMap.has(result.data.name)) {
      throw new Error(`Origin with name '${result.data.name}' already exists`);
    }

    // Add to origins and index
    this.origins.push(result.data);
    this.originMap.set(result.data.name, result.data);
  }

  /**
   * Update an existing origin
   * @param name The name of the origin to update
   * @param origin The new origin configuration
   * @throws Error if origin is invalid or not found
   */
  public updateOrigin(name: string, origin: unknown): void {
    // Validate the origin
    const result = safeValidateOrigin(origin);

    if (!result.success || !result.data) {
      throw new Error(
        `Invalid origin configuration: ${result.error?.message || 'Validation failed'}`
      );
    }

    // Check that the origin exists
    if (!this.originMap.has(name)) {
      throw new Error(`Origin with name '${name}' not found`);
    }

    // Check if the name is changing
    if (result.data.name !== name && this.originMap.has(result.data.name)) {
      throw new Error(
        `Cannot update origin name: an origin with name '${result.data.name}' already exists`
      );
    }

    // Remove the old origin
    this.origins = this.origins.filter((o) => o.name !== name);
    this.originMap.delete(name);

    // Add the updated origin
    this.origins.push(result.data);
    this.originMap.set(result.data.name, result.data);
  }

  /**
   * Remove an origin by name
   * @param name The name of the origin to remove
   * @returns true if the origin was removed, false if not found
   */
  public removeOrigin(name: string): boolean {
    if (!this.originMap.has(name)) {
      return false;
    }

    // Remove from origins
    this.origins = this.origins.filter((o) => o.name !== name);
    this.originMap.delete(name);

    return true;
  }

  /**
   * Reset the origins manager to reload configuration
   */
  public reset(): void {
    this.initializeOrigins();
  }
}
