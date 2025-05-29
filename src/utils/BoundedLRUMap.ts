/**
 * BoundedLRUMap - A Map implementation with size limits and TTL support
 * Prevents unbounded memory growth by implementing LRU eviction and TTL expiration
 */

export interface LRUEntry<V> {
  value: V;
  timestamp: number;
  lastAccessed: number;
}

export interface BoundedLRUMapOptions<K, V> {
  maxSize: number;
  ttlMs?: number;
  onEvict?: (key: K, value: V) => void;
}

export class BoundedLRUMap<K, V> {
  private map: Map<K, LRUEntry<V>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly onEvict?: (key: K, value: V) => void;
  private accessOrder: K[] = [];

  constructor(options: BoundedLRUMapOptions<K, V>) {
    this.map = new Map();
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs || 300000; // Default 5 minutes
    this.onEvict = options.onEvict;
  }

  /**
   * Set a value in the map with automatic eviction if needed
   */
  set(key: K, value: V): void {
    const now = Date.now();
    
    // Clean up expired entries first
    this.cleanup();

    // If key exists, update access order
    if (this.map.has(key)) {
      this.updateAccessOrder(key);
    } else {
      // Check if we need to evict before adding new entry
      if (this.map.size >= this.maxSize) {
        this.evictLRU();
      }
      this.accessOrder.push(key);
    }

    // Set the new value
    this.map.set(key, {
      value,
      timestamp: now,
      lastAccessed: now
    });
  }

  /**
   * Get a value from the map and update access time
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    
    // Check if entry has expired
    if (now - entry.timestamp > this.ttlMs) {
      this.delete(key);
      return undefined;
    }

    // Update last accessed time and access order
    entry.lastAccessed = now;
    this.updateAccessOrder(key);
    
    return entry.value;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.map.get(key);
    
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the map
   */
  delete(key: K): boolean {
    const entry = this.map.get(key);
    
    if (entry) {
      // Call eviction callback if provided
      if (this.onEvict) {
        this.onEvict(key, entry.value);
      }
      
      // Remove from access order
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      
      return this.map.delete(key);
    }
    
    return false;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    if (this.onEvict) {
      this.map.forEach((entry, key) => {
        this.onEvict!(key, entry.value);
      });
    }
    
    this.map.clear();
    this.accessOrder = [];
  }

  /**
   * Get current size
   */
  get size(): number {
    // Clean up expired entries before returning size
    this.cleanup();
    return this.map.size;
  }

  /**
   * Get all keys (non-expired)
   */
  keys(): K[] {
    this.cleanup();
    return Array.from(this.map.keys());
  }

  /**
   * Get all values (non-expired)
   */
  values(): V[] {
    this.cleanup();
    return Array.from(this.map.values()).map(entry => entry.value);
  }

  /**
   * Get all entries as [key, value] pairs (non-expired)
   */
  entries(): Array<[K, V]> {
    this.cleanup();
    const result: Array<[K, V]> = [];
    
    this.map.forEach((entry, key) => {
      result.push([key, entry.value]);
    });
    
    return result;
  }

  /**
   * Update access order for LRU tracking
   */
  private updateAccessOrder(key: K): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      // Remove from current position
      this.accessOrder.splice(index, 1);
    }
    // Add to end (most recently used)
    this.accessOrder.push(key);
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;

    // Get least recently used key (first in array)
    const lruKey = this.accessOrder[0];
    this.delete(lruKey);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: K[] = [];

    this.map.forEach((entry, key) => {
      if (now - entry.timestamp > this.ttlMs) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.delete(key));
  }

  /**
   * Get statistics about the map
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttlMs: number;
    oldestEntryAge: number | null;
    newestEntryAge: number | null;
  } {
    this.cleanup();
    
    const now = Date.now();
    let oldestAge: number | null = null;
    let newestAge: number | null = null;

    this.map.forEach(entry => {
      const age = now - entry.timestamp;
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age;
      }
      if (newestAge === null || age < newestAge) {
        newestAge = age;
      }
    });

    return {
      size: this.map.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      oldestEntryAge: oldestAge,
      newestEntryAge: newestAge
    };
  }
}

/**
 * Factory function for creating a BoundedLRUMap with default options
 */
export function createBoundedLRUMap<K, V>(
  maxSize: number,
  ttlMs?: number,
  onEvict?: (key: K, value: V) => void
): BoundedLRUMap<K, V> {
  return new BoundedLRUMap<K, V>({
    maxSize,
    ttlMs,
    onEvict
  });
}