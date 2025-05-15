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

/**
 * Extend the globalThis interface to include WORKER_CONFIG
 */
declare global {
  var WORKER_CONFIG: {
    origins?: Origin[];
    [key: string]: unknown;
  };
}

/**
 * Manages Origin configuration with specialized methods
 */
export class OriginConfigurationManager {
  private static instance: OriginConfigurationManager;
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
    
    // Check what kind of origins configuration we have
    if (this.isOriginsConfig(originsConfig)) {
      // If we have an object with control flags
      originsEnabled = originsConfig.enabled !== false;
      useLegacyPathPatterns = originsConfig.useLegacyPathPatterns !== false;
      
      // If we have items in the config, use those
      if (Array.isArray(originsConfig.items) && originsConfig.items.length > 0) {
        this.origins = [...originsConfig.items];
      }
    } else if (this.isOriginsArray(originsConfig)) {
      // If we have a direct array of Origins, use that
      this.origins = [...originsConfig];
    }
    
    // If we have a direct origins configuration from WORKER_CONFIG, use that
    if (originsEnabled && typeof globalThis.WORKER_CONFIG !== 'undefined' && Array.isArray(globalThis.WORKER_CONFIG.origins)) {
      this.origins = [...globalThis.WORKER_CONFIG.origins];
    }
    
    // If we should also use legacy path patterns and we have access to them
    else if (originsEnabled && useLegacyPathPatterns && config.pathPatterns) {
      // Convert path patterns to Origins for backward compatibility
      this.origins = this.convertFromPathPatterns();
    }
    
    // Validate and index the origins by name
    this.validateAndIndexOrigins();
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
      } else if (result.error) {
        console.error(`Invalid origin configuration: ${result.error.message}`);
      }
    }
    
    // Replace origins with validated ones
    this.origins = validOrigins;
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
        console.error(`Error converting path pattern to origin: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Invalid origin configuration: ${result.error?.message || 'Validation failed'}`);
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
      throw new Error(`Invalid origin configuration: ${result.error?.message || 'Validation failed'}`);
    }
    
    // Check that the origin exists
    if (!this.originMap.has(name)) {
      throw new Error(`Origin with name '${name}' not found`);
    }
    
    // Check if the name is changing
    if (result.data.name !== name && this.originMap.has(result.data.name)) {
      throw new Error(`Cannot update origin name: an origin with name '${result.data.name}' already exists`);
    }
    
    // Remove the old origin
    this.origins = this.origins.filter(o => o.name !== name);
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
    this.origins = this.origins.filter(o => o.name !== name);
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