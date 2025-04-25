import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  createVersionKey, 
  getCacheKeyVersion, 
  storeCacheKeyVersion,
  getNextCacheKeyVersion
} from '../../src/services/cacheVersionService';

// Mock dependencies
vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn(() => null)
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(),
  debug: vi.fn(),
  error: vi.fn()
}));

vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn()
}));

vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
  withErrorHandling: vi.fn((fn, options) => fn)
}));

describe('cacheVersionService', () => {
  describe('createVersionKey', () => {
    it('should create a valid version key from a cache key', () => {
      const cacheKey = 'video:/path/to/video.mp4:width=640:height=360';
      const result = createVersionKey(cacheKey);
      expect(result).toMatch(/^version-/);
      expect(result).not.toContain(':');
      expect(result.length).toBeLessThanOrEqual(512 + 'version-'.length);
    });

    it('should handle special characters by replacing them', () => {
      const cacheKey = 'video:/path/to/video.mp4?query=value&param=123';
      const result = createVersionKey(cacheKey);
      expect(result).not.toContain('?');
      expect(result).not.toContain('&');
      expect(result).not.toContain('=');
    });
  });

  describe('getCacheKeyVersion', () => {
    let mockEnv: any;
    let mockKVNamespace: any;

    beforeEach(() => {
      // Create mock getWithMetadata function
      mockKVNamespace = {
        getWithMetadata: vi.fn()
      };

      // Create mock environment
      mockEnv = {
        VIDEO_CACHE_KEY_VERSIONS: mockKVNamespace
      };
    });

    it('should return null when KV namespace is not available', async () => {
      const result = await getCacheKeyVersion({}, 'test-key');
      expect(result).toBeNull();
    });

    it('should return null when metadata is not found', async () => {
      mockKVNamespace.getWithMetadata.mockResolvedValue({
        value: '',
        metadata: null
      });
      
      const result = await getCacheKeyVersion(mockEnv, 'test-key');
      expect(result).toBeNull();
    });

    it('should return null when version is not a number in metadata', async () => {
      mockKVNamespace.getWithMetadata.mockResolvedValue({
        value: '',
        metadata: { otherField: 'value' }
      });
      
      const result = await getCacheKeyVersion(mockEnv, 'test-key');
      expect(result).toBeNull();
    });

    it('should return version number from metadata', async () => {
      mockKVNamespace.getWithMetadata.mockResolvedValue({
        value: '',
        metadata: { version: 3 }
      });
      
      const result = await getCacheKeyVersion(mockEnv, 'test-key');
      expect(result).toBe(3);
    });
  });

  describe('storeCacheKeyVersion', () => {
    let mockEnv: any;
    let mockKVNamespace: any;

    beforeEach(() => {
      // Create mock put function
      mockKVNamespace = {
        put: vi.fn().mockResolvedValue(undefined)
      };

      // Create mock environment
      mockEnv = {
        VIDEO_CACHE_KEY_VERSIONS: mockKVNamespace
      };
    });

    it('should return false when KV namespace is not available', async () => {
      const result = await storeCacheKeyVersion({}, 'test-key', 1);
      expect(result).toBe(false);
    });

    it('should store version with TTL when provided', async () => {
      const result = await storeCacheKeyVersion(mockEnv, 'test-key', 2, 300);
      expect(result).toBe(true);
      expect(mockKVNamespace.put).toHaveBeenCalledWith(
        expect.stringContaining('version-test-key'),
        '',
        expect.objectContaining({
          metadata: expect.objectContaining({
            version: 2
          }),
          expirationTtl: 300
        })
      );
    });

    it('should store version without TTL when not provided', async () => {
      const result = await storeCacheKeyVersion(mockEnv, 'test-key', 1);
      expect(result).toBe(true);
      expect(mockKVNamespace.put).toHaveBeenCalledWith(
        expect.stringContaining('version-test-key'),
        '',
        expect.objectContaining({
          metadata: expect.objectContaining({
            version: 1
          })
        })
      );
      // Verify the options object doesn't contain expirationTtl
      const putOptions = mockKVNamespace.put.mock.calls[0][2];
      expect(putOptions).not.toHaveProperty('expirationTtl');
    });
  });

  describe('getNextCacheKeyVersion', () => {
    let mockEnv: any;
    
    beforeEach(() => {
      mockEnv = {
        VIDEO_CACHE_KEY_VERSIONS: {
          getWithMetadata: vi.fn()
        }
      };
    });

    it('should return 1 when no previous version exists', async () => {
      // Mock the behavior for no version found
      mockEnv.VIDEO_CACHE_KEY_VERSIONS.getWithMetadata.mockResolvedValue({
        value: '',
        metadata: null
      });
      
      const result = await getNextCacheKeyVersion(mockEnv, 'test-key');
      expect(result).toBe(1);
    });

    it('should keep version 1 when no cache miss', async () => {
      // Mock the behavior for version 1
      mockEnv.VIDEO_CACHE_KEY_VERSIONS.getWithMetadata.mockResolvedValue({
        value: '',
        metadata: { version: 1 }
      });
      
      // Don't force increment - should stay at 1
      const result = await getNextCacheKeyVersion(mockEnv, 'test-key', false);
      expect(result).toBe(1);
    });
    
    it('should always increment when there is a cache miss (forceIncrement=true)', async () => {
      // Mock the behavior for version 1
      mockEnv.VIDEO_CACHE_KEY_VERSIONS.getWithMetadata.mockResolvedValue({
        value: '',
        metadata: { version: 1 }
      });
      
      // Force increment - should go to 2 even though it's version 1
      const result = await getNextCacheKeyVersion(mockEnv, 'test-key', true);
      expect(result).toBe(2);
    });

    it('should always increment when version is already > 1', async () => {
      // Mock the behavior for version 3
      mockEnv.VIDEO_CACHE_KEY_VERSIONS.getWithMetadata.mockResolvedValue({
        value: '',
        metadata: { version: 3 }
      });
      
      // Without force increment - should still increment to 4
      const result = await getNextCacheKeyVersion(mockEnv, 'test-key');
      expect(result).toBe(4);
    });
  });
});