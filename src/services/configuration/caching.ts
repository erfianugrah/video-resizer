/**
 * In-memory caching utilities for configuration service
 */

// Cache entry type with data and timestamp
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * In-memory cache for configuration data
 * Provides methods for storing, retrieving, and checking cache expiration
 */
export class ConfigurationCache {
  private cache = new Map<string, CacheEntry<any>>();
  private cacheTtlMs: number;
  
  /**
   * Create a new cache with the specified TTL
   * @param cacheTtlMs Time-to-live for cache entries in milliseconds
   */
  constructor(cacheTtlMs: number = 5 * 60 * 1000) { // Default 5 minute TTL
    this.cacheTtlMs = cacheTtlMs;
  }
  
  /**
   * Store a value in the cache with the current timestamp
   * @param key The cache key
   * @param value The value to store
   */
  set<T>(key: string, value: T): void {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get a value from the cache if it exists and hasn't expired
   * @param key The cache key
   * @returns The cached value or null if not found or expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if the entry has expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }
  
  /**
   * Check if a cache entry has expired
   * @param entry The cache entry to check
   * @returns True if expired, false otherwise
   */
  private isExpired(entry: CacheEntry<any>): boolean {
    const now = Date.now();
    return (now - entry.timestamp) > this.cacheTtlMs;
  }
  
  /**
   * Check if the cache has a non-expired entry for the key
   * @param key The cache key
   * @returns True if the key exists and hasn't expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }
  
  /**
   * Delete a key from the cache
   * @param key The cache key
   */
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get the number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }
  
  /**
   * Update the TTL for cache entries
   * @param ttlMs New TTL in milliseconds
   */
  setTtl(ttlMs: number): void {
    this.cacheTtlMs = ttlMs;
  }
}