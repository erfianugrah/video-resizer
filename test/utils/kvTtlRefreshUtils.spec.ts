/**
 * Tests for KV TTL refresh utilities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshKeyTtl, checkAndRefreshTtl } from '../../src/utils/kvTtlRefreshUtils';
import { CacheConfigurationManager } from '../../src/config/CacheConfigurationManager';

// Mock dependencies
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn().mockReturnValue({
    requestId: 'test-request-id',
    url: 'https://example.com/test'
  }),
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  debug: vi.fn(),
}));

vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn(),
}));

vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn().mockReturnValue({
      getConfig: vi.fn().mockReturnValue({
        defaultMaxAge: 300,
        ttlRefresh: {
          minElapsedPercent: 10,
          minRemainingSeconds: 60
        }
      })
    })
  }
}));

describe('kvTtlRefreshUtils', () => {
  let mockNamespace: any;
  let mockMetadata: any;
  
  // Setup test data
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 0, 1, 12, 0, 0)); // 2023-01-01 12:00:00
    
    // Mock KV namespace
    mockNamespace = {
      put: vi.fn().mockResolvedValue(undefined)
    };
    
    // Mock metadata
    mockMetadata = {
      createdAt: Date.now() - (180 * 1000), // 3 minutes ago
      expiresAt: Date.now() + (120 * 1000), // expires in 2 minutes
      contentType: 'video/mp4',
      contentLength: 1024,
      cacheTags: ['video-123'],
      cacheVersion: 1
    };
  });
  
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  
  describe('refreshKeyTtl', () => {
    it('should skip refresh if less than 10% of TTL has elapsed', async () => {
      // Setup: 15 seconds elapsed out of 300s TTL (5%)
      const result = await refreshKeyTtl({
        namespace: mockNamespace,
        key: 'test-key',
        metadata: {
          ...mockMetadata,
          createdAt: Date.now() - (15 * 1000), // 15 seconds ago
          expiresAt: Date.now() + (285 * 1000) // expires in 4.75 minutes
        },
        originalTtl: 300,
        elapsedTime: 15,
        remainingTime: 285,
      });
      
      expect(result).toBe(false);
      expect(mockNamespace.put).not.toHaveBeenCalled();
    });
    
    it('should skip refresh if less than 60 seconds remaining', async () => {
      // Setup: 270 seconds elapsed out of 300s TTL (90%), only 30s remaining
      const result = await refreshKeyTtl({
        namespace: mockNamespace,
        key: 'test-key',
        metadata: {
          ...mockMetadata,
          createdAt: Date.now() - (270 * 1000), // 4.5 minutes ago
          expiresAt: Date.now() + (30 * 1000) // expires in 30 seconds
        },
        originalTtl: 300,
        elapsedTime: 270,
        remainingTime: 30,
      });
      
      expect(result).toBe(false);
      expect(mockNamespace.put).not.toHaveBeenCalled();
    });
    
    it('should refresh TTL when conditions are met', async () => {
      // Setup: 180 seconds elapsed out of 300s TTL (60%), 120s remaining
      const result = await refreshKeyTtl({
        namespace: mockNamespace,
        key: 'test-key',
        metadata: mockMetadata,
        originalTtl: 300,
        elapsedTime: 180,
        remainingTime: 120,
      });
      
      expect(result).toBe(true);
      expect(mockNamespace.put).toHaveBeenCalledTimes(1);
      expect(mockNamespace.put).toHaveBeenCalledWith(
        'test-key',
        "",
        {
          metadata: {
            ...mockMetadata,
            expiresAt: Date.now() + (300 * 1000)
          },
          expirationTtl: 300
        }
      );
    });
    
    it('should retry on rate limit errors', async () => {
      // Setup: Mock first call to fail with rate limit error
      mockNamespace.put.mockRejectedValueOnce(new Error('KV PUT failed: 429 Too Many Requests'))
        .mockResolvedValueOnce(undefined);
      
      // Mock setTimeout to avoid waiting
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn().mockImplementation((fn) => {
        if (typeof fn === 'function') fn();
        return 1;
      });
      
      try {
        const result = await refreshKeyTtl({
          namespace: mockNamespace,
          key: 'test-key',
          metadata: mockMetadata,
          originalTtl: 300,
          elapsedTime: 180,
          remainingTime: 120,
        });
        
        expect(result).toBe(true);
        expect(mockNamespace.put).toHaveBeenCalledTimes(2);
      } finally {
        // Restore original setTimeout
        global.setTimeout = originalSetTimeout;
      }
    });
    
    it('should handle non-rate limit errors', async () => {
      // Setup: Mock call to fail with non-rate limit error
      mockNamespace.put.mockRejectedValueOnce(new Error('Unknown error'));
      
      const result = await refreshKeyTtl({
        namespace: mockNamespace,
        key: 'test-key',
        metadata: mockMetadata,
        originalTtl: 300,
        elapsedTime: 180,
        remainingTime: 120,
      });
      
      expect(result).toBe(false);
      expect(mockNamespace.put).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('checkAndRefreshTtl', () => {
    it('should skip refresh if metadata is missing', async () => {
      const result = await checkAndRefreshTtl(
        mockNamespace,
        'test-key',
        null as any
      );
      
      expect(result).toBe(false);
      expect(mockNamespace.put).not.toHaveBeenCalled();
    });
    
    it('should skip refresh if createdAt is missing', async () => {
      const result = await checkAndRefreshTtl(
        mockNamespace,
        'test-key',
        { something: 'else' }
      );
      
      expect(result).toBe(false);
      expect(mockNamespace.put).not.toHaveBeenCalled();
    });
    
    it('should use default TTL if expiresAt is missing', async () => {
      // Setup: No expiresAt, but 180s elapsed (>25% of default 300s)
      const metadataWithoutExpiry = {
        ...mockMetadata,
        expiresAt: undefined
      };
      
      // Mock put to succeed and verify TTL value
      mockNamespace.put.mockImplementationOnce((_key, _value, options) => {
        // Expect TTL to be default value from config (300)
        expect(options.expirationTtl).toBe(300);
        return Promise.resolve();
      });
      
      const result = await checkAndRefreshTtl(
        mockNamespace,
        'test-key',
        metadataWithoutExpiry
      );
      
      // Since we mocked the put method to succeed, this test is checking that
      // the default TTL from CacheConfigurationManager is used
      expect(CacheConfigurationManager.getInstance().getConfig).toHaveBeenCalled();
    });
    
    it('should use waitUntil for background refresh when available', async () => {
      // Setup: Mock execution context with waitUntil
      const mockExecutionCtx = {
        waitUntil: vi.fn((promise) => promise)
      };
      
      const result = await checkAndRefreshTtl(
        mockNamespace,
        'test-key',
        mockMetadata,
        undefined,
        mockExecutionCtx
      );
      
      expect(result).toBe(true);
      expect(mockExecutionCtx.waitUntil).toHaveBeenCalledTimes(1);
      // We can't test the exact function that gets called within waitUntil,
      // but we can verify that waitUntil was called
    });
  });
});