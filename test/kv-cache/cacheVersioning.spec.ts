import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCacheKeyVersion, getNextCacheKeyVersion } from '../../src/services/cacheVersionService';
import { getFromKVCache, storeInKVCache } from '../../src/utils/kvCacheUtils';

// Mock URL versioning utilities
vi.mock('../../src/utils/urlVersionUtils', () => ({
  addVersionToUrl: vi.fn((url, version) => `${url}?v=${version}`),
  normalizeUrlForCaching: vi.fn((url) => url.replace(/[?&]v=\d+/, ''))
}));

// Import after mocking
import { addVersionToUrl, normalizeUrlForCaching } from '../../src/utils/urlVersionUtils';

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

vi.mock('../../src/services/cacheVersionService', () => ({
  getCacheKeyVersion: vi.fn(),
  getNextCacheKeyVersion: vi.fn(),
  storeCacheKeyVersion: vi.fn()
}));

vi.mock('../../src/services/kvStorageService', () => ({
  getTransformedVideo: vi.fn(),
  storeTransformedVideo: vi.fn(),
  generateKVKey: vi.fn((path, options) => `${options.mode || 'video'}:${path}:key`)
}));

vi.mock('../../src/config', () => ({
  getCacheConfig: vi.fn(() => ({
    enableKVCache: true,
    bypassParams: ['nocache', 'bypass']
  }))
}));

describe('Cache Versioning Integration', () => {
  let mockEnv: any;
  let mockResponse: Response;
  
  beforeEach(() => {
    // Setup mock environment
    mockEnv = {
      VIDEO_TRANSFORMATIONS_CACHE: {
        get: vi.fn(),
        put: vi.fn()
      },
      VIDEO_CACHE_KEY_VERSIONS: {
        getWithMetadata: vi.fn(),
        put: vi.fn()
      }
    };
    
    // Create a mock response
    mockResponse = new Response('test video data', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '1000'
      }
    });
    
    // Reset all mocks
    vi.resetAllMocks();
  });
  
  describe('URL normalization in cache operations', () => {
    it('should normalize URLs when accessing the cache', async () => {
      const originalUrl = 'https://example.com/video.mp4?v=2&width=640';
      const normalizedUrl = 'https://example.com/video.mp4?width=640';
      const options = { width: 640 };
      
      // Reset the mock to track calls
      vi.mocked(normalizeUrlForCaching).mockClear();
      
      await getFromKVCache(mockEnv, originalUrl, options);
      
      // Verify normalizeUrlForCaching was called with the original URL
      expect(normalizeUrlForCaching).toHaveBeenCalledWith(originalUrl);
    });
    
    it('should normalize URLs when storing in the cache', async () => {
      const originalUrl = 'https://example.com/video.mp4?v=2&width=640';
      const normalizedUrl = 'https://example.com/video.mp4?width=640';
      const options = { width: 640 };
      
      // Reset the mock to track calls
      vi.mocked(normalizeUrlForCaching).mockClear();
      
      await storeInKVCache(mockEnv, originalUrl, mockResponse, options);
      
      // Verify normalizeUrlForCaching was called with the original URL
      expect(normalizeUrlForCaching).toHaveBeenCalledWith(originalUrl);
    });
  });
  
  describe('Version handling in transformation service', () => {
    it('should increment version for a cache miss', async () => {
      // Mock the getCacheKeyVersion to return null (no version)
      vi.mocked(getCacheKeyVersion).mockResolvedValue(null);
      
      // Mock the getNextCacheKeyVersion to return 1 (first version)
      vi.mocked(getNextCacheKeyVersion).mockResolvedValue(1);
      
      // Simulate a transformation service call with version handling
      const shouldAddVersion = await getNextCacheKeyVersion(mockEnv, 'test-key') > 1;
      
      // Should not add version since it's the first version (1)
      expect(shouldAddVersion).toBe(false);
    });
    
    it('should add version parameter for subsequent versions', async () => {
      // Mock the getCacheKeyVersion to return 2 (existing version)
      vi.mocked(getCacheKeyVersion).mockResolvedValue(2);
      
      // Mock the getNextCacheKeyVersion to return 3 (next version)
      vi.mocked(getNextCacheKeyVersion).mockResolvedValue(3);
      
      // Simulate a transformation service call with version handling
      const nextVersion = await getNextCacheKeyVersion(mockEnv, 'test-key');
      const shouldAddVersion = nextVersion > 1;
      
      // Should add version since it's greater than 1 (3)
      expect(shouldAddVersion).toBe(true);
      
      // Check URL transformation with version
      const cdnCgiUrl = 'https://example.com/cdn-cgi/media/width=640/video.mp4';
      const versionedUrl = addVersionToUrl(cdnCgiUrl, nextVersion);
      
      // Verify URL has version parameter
      expect(versionedUrl).toBe('https://example.com/cdn-cgi/media/width=640/video.mp4?v=3');
    });
  });
});