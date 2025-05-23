/**
 * Manages locks for chunk operations to prevent concurrent writes to the same chunks
 * This helps avoid chunk size mismatches during high concurrency
 */

import { logDebug } from './logging';

interface ChunkLock {
  promise: Promise<void>;
  resolve: () => void;
  acquiredAt: number;
  key: string;
}

class ChunkLockManager {
  private locks: Map<string, ChunkLock> = new Map();
  private readonly lockTimeout = 30000; // 30 seconds
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start cleanup interval to remove stale locks
    // Note: In Cloudflare Workers, this interval will be automatically
    // cleaned up when the worker instance is terminated
    this.startCleanup();
  }

  /**
   * Acquire a lock for a chunk key
   * If the chunk is already being processed, wait for it to complete
   */
  async acquireLock(key: string): Promise<() => void> {
    const existingLock = this.locks.get(key);
    
    if (existingLock) {
      logDebug('[CHUNK_LOCK] Waiting for existing lock', {
        key,
        lockAge: Date.now() - existingLock.acquiredAt
      });
      
      // Wait for existing operation to complete
      await existingLock.promise;
    }

    // Create new lock
    let lockResolve: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      lockResolve = resolve;
    });

    const lock: ChunkLock = {
      promise: lockPromise,
      resolve: lockResolve!,
      acquiredAt: Date.now(),
      key
    };

    this.locks.set(key, lock);

    logDebug('[CHUNK_LOCK] Lock acquired', {
      key,
      activeLocks: this.locks.size
    });

    // Return release function
    return () => {
      this.releaseLock(key);
    };
  }

  /**
   * Release a lock for a chunk key
   */
  private releaseLock(key: string): void {
    const lock = this.locks.get(key);
    if (lock) {
      lock.resolve();
      this.locks.delete(key);
      
      logDebug('[CHUNK_LOCK] Lock released', {
        key,
        lockDuration: Date.now() - lock.acquiredAt,
        remainingLocks: this.locks.size
      });
    }
  }

  /**
   * Start periodic cleanup of stale locks
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const staleKeys: string[] = [];

      for (const [key, lock] of this.locks) {
        if (now - lock.acquiredAt > this.lockTimeout) {
          staleKeys.push(key);
        }
      }

      if (staleKeys.length > 0) {
        logDebug('[CHUNK_LOCK] Cleaning up stale locks', {
          count: staleKeys.length,
          keys: staleKeys
        });

        staleKeys.forEach(key => {
          this.releaseLock(key);
        });
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get current lock statistics
   */
  getStats(): { activeLocks: number; oldestLockAge: number | null } {
    let oldestLockAge: number | null = null;
    const now = Date.now();

    for (const lock of this.locks.values()) {
      const age = now - lock.acquiredAt;
      if (oldestLockAge === null || age > oldestLockAge) {
        oldestLockAge = age;
      }
    }

    return {
      activeLocks: this.locks.size,
      oldestLockAge
    };
  }
}

// Export singleton instance
export const chunkLockManager = new ChunkLockManager();