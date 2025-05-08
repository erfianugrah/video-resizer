import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { storeTransformedVideo, getTransformedVideo, TransformationMetadata, ChunkManifest } from '../../src/services/kvStorageService';

// Mock all imports used by kvStorageService
vi.mock('../../src/utils/pinoLogger', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }))
}));

vi.mock('../../src/utils/legacyLoggerAdapter', () => ({
  getCurrentContext: vi.fn(() => null)
}));

vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn()
}));

vi.mock('../../src/utils/errorHandlingUtils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logErrorWithContext: vi.fn(),
    withErrorHandling: vi.fn((fn, _, __) => fn)
  };
});

vi.mock('../../src/utils/kvTtlRefreshUtils', () => ({
  checkAndRefreshTtl: vi.fn()
}));

vi.mock('../../src/services/cacheVersionService', () => ({
  getCacheKeyVersion: vi.fn().mockResolvedValue(1),
  getNextCacheKeyVersion: vi.fn().mockResolvedValue(2),
  storeCacheKeyVersion: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../src/services/videoStorageService', () => ({
  generateCacheTags: vi.fn().mockReturnValue(['tag1', 'tag2'])
}));

vi.mock('../../src/utils/imqueryUtils', () => ({
  getDerivativeDimensions: vi.fn().mockReturnValue({ width: 320, height: 240 })
}));

vi.mock('../../src/config', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        defaultMaxAge: 300,
        storeIndefinitely: false
      }))
    }))
  },
  VideoConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({}))
    }))
  }
}));

// Create mock for httpUtils that may be dynamically imported
vi.mock('../../src/utils/httpUtils', async () => ({
  parseRangeHeader: vi.fn((rangeHeader, contentLength) => {
    if (rangeHeader === 'bytes=100-200') {
      return { start: 100, end: 200, total: contentLength };
    }
    if (rangeHeader === 'bytes=invalid') {
      return null;
    }
    return { start: 0, end: 99, total: contentLength };
  }),
  createUnsatisfiableRangeResponse: vi.fn(() => new Response(null, { status: 416 }))
}));

describe('KV Chunking Functionality', () => {
  // Create mock KV namespace
  const mockKV: KVNamespace = {
    get: vi.fn(),
    getWithMetadata: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] })
  };

  // Create mock env variables
  const mockEnv = {
    VIDEO_CACHE_KEY_VERSIONS: {} as KVNamespace,
    executionCtx: {
      waitUntil: vi.fn((promise) => promise)
    }
  };

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeTransformedVideo function', () => {
    it('should store small video as a single entry', async () => {
      // Create small video data
      const videoData = new Uint8Array(1024 * 1024).fill(1); // 1 MB
      const videoResponse = new Response(videoData, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoData.length.toString()
        }
      });

      // Mock the KV put method to succeed
      mockKV.put.mockResolvedValue(undefined);

      const result = await storeTransformedVideo(
        mockKV as KVNamespace,
        'videos/test.mp4',
        videoResponse,
        {
          mode: 'video',
          width: 640,
          height: 480,
          format: 'mp4',
          version: 1,
          env: mockEnv
        },
        300 // TTL in seconds
      );

      expect(result).toBe(true);
      expect(mockKV.put).toHaveBeenCalledTimes(1);

      // Verify the first put was a single entry (not a manifest)
      const putCall = mockKV.put.mock.calls[0];
      const [key, value, options] = putCall;

      expect(key).toContain('video:videos/test.mp4');
      expect(options.metadata.isChunked).toBe(false);
      expect(options.metadata.actualTotalVideoSize).toBe(videoData.length);
    });

    it('should store large video as multiple chunks with manifest', async () => {
      // Create large video data (25 MB) to force chunking
      const videoData = new Uint8Array(25 * 1024 * 1024).fill(1);
      const videoResponse = new Response(videoData, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoData.length.toString()
        }
      });

      // Mock the KV put method to succeed
      mockKV.put.mockResolvedValue(undefined);

      const result = await storeTransformedVideo(
        mockKV as KVNamespace,
        'videos/large-test.mp4',
        videoResponse,
        {
          mode: 'video',
          width: 1280,
          height: 720,
          format: 'mp4',
          version: 1,
          env: mockEnv
        },
        300 // TTL in seconds
      );

      expect(result).toBe(true);
      
      // Count the number of put calls - should be multiple chunks + 1 manifest
      // Each chunk is 5MB, so 25MB / 5MB = 5 chunks + 1 manifest = 6 total put calls 
      expect(mockKV.put).toHaveBeenCalledTimes(6);

      // Verify the last put was the manifest
      const lastPutCall = mockKV.put.mock.calls[mockKV.put.mock.calls.length - 1];
      const [manifestKey, manifestValue, manifestOptions] = lastPutCall;

      expect(manifestKey).toContain('video:videos/large-test.mp4');
      expect(manifestOptions.metadata.isChunked).toBe(true);
      expect(manifestOptions.metadata.actualTotalVideoSize).toBe(videoData.length);

      // Parse manifest to verify chunk information
      const manifest = typeof manifestValue === 'string' 
        ? JSON.parse(manifestValue) as ChunkManifest
        : null;

      expect(manifest).not.toBeNull();
      expect(manifest?.chunkCount).toBe(5);
      expect(manifest?.totalSize).toBe(videoData.length);
      expect(manifest?.actualChunkSizes.length).toBe(5);
      expect(manifest?.originalContentType).toBe('video/mp4');
    });

    it('should handle errors during storage', async () => {
      // Create video data
      const videoData = new Uint8Array(1024 * 1024).fill(1);
      const videoResponse = new Response(videoData, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoData.length.toString()
        }
      });

      // Mock the KV put method to fail
      mockKV.put.mockRejectedValue(new Error('Storage error'));

      const result = await storeTransformedVideo(
        mockKV as KVNamespace,
        'videos/error-test.mp4',
        videoResponse,
        {
          mode: 'video',
          width: 640,
          height: 480,
          format: 'mp4',
          version: 1,
          env: mockEnv
        },
        300
      );

      expect(result).toBe(false);
    });
  });

  describe('getTransformedVideo function', () => {
    it('should retrieve a single entry video', async () => {
      // Create mock video data
      const videoData = new Uint8Array(1024 * 1024).fill(1); // 1 MB

      // Create mock metadata
      const metadata: TransformationMetadata = {
        sourcePath: 'videos/test.mp4',
        mode: 'video',
        width: 640,
        height: 480,
        format: 'mp4',
        cacheTags: ['tag1', 'tag2'],
        cacheVersion: 1,
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: Date.now(),
        isChunked: false,
        actualTotalVideoSize: videoData.length
      };

      // Mock KV getWithMetadata for single entry
      mockKV.getWithMetadata.mockResolvedValue({
        value: 'mockedVideoData', // Placeholder, will be overridden by direct get call
        metadata
      });

      // Mock KV get for retrieving actual data
      mockKV.get.mockResolvedValue(videoData.buffer);

      const result = await getTransformedVideo(
        mockKV as KVNamespace,
        'videos/test.mp4',
        {
          mode: 'video',
          width: 640,
          height: 480,
          format: 'mp4',
          version: 1,
          env: mockEnv
        }
      );

      expect(result).not.toBeNull();
      expect(result?.metadata).toEqual(metadata);
      expect(result?.response.status).toBe(200);
      expect(result?.response.headers.get('Content-Type')).toBe('video/mp4');
      expect(result?.response.headers.get('Content-Length')).toBe(videoData.length.toString());
    });

    it('should retrieve a chunked video by recombining chunks', async () => {
      // Create mock chunk data
      const chunk1 = new Uint8Array(5 * 1024 * 1024).fill(1);
      const chunk2 = new Uint8Array(5 * 1024 * 1024).fill(2);
      const totalSize = chunk1.length + chunk2.length;

      // Create mock manifest
      const manifest: ChunkManifest = {
        totalSize,
        chunkCount: 2,
        actualChunkSizes: [chunk1.length, chunk2.length],
        standardChunkSize: 5 * 1024 * 1024,
        originalContentType: 'video/mp4'
      };

      // Create mock metadata
      const metadata: TransformationMetadata = {
        sourcePath: 'videos/large-test.mp4',
        mode: 'video',
        width: 1280,
        height: 720,
        format: 'mp4',
        cacheTags: ['tag1', 'tag2'],
        cacheVersion: 1,
        contentType: 'application/json', // Manifest is JSON
        contentLength: JSON.stringify(manifest).length,
        createdAt: Date.now(),
        isChunked: true,
        actualTotalVideoSize: totalSize
      };

      // Mock KV getWithMetadata for manifest
      mockKV.getWithMetadata.mockResolvedValue({
        value: JSON.stringify(manifest),
        metadata
      });

      // Mock KV get for retrieving chunks
      mockKV.get.mockImplementation((key: string, options?: any) => {
        if (key.includes('_chunk_0')) {
          return Promise.resolve(chunk1.buffer);
        } else if (key.includes('_chunk_1')) {
          return Promise.resolve(chunk2.buffer);
        }
        return Promise.resolve(null);
      });

      const result = await getTransformedVideo(
        mockKV as KVNamespace,
        'videos/large-test.mp4',
        {
          mode: 'video',
          width: 1280,
          height: 720,
          format: 'mp4',
          version: 1,
          env: mockEnv
        }
      );

      expect(result).not.toBeNull();
      expect(result?.metadata).toEqual(metadata);
      expect(result?.response.status).toBe(200);
      expect(result?.response.headers.get('Content-Type')).toBe('video/mp4');
      expect(result?.response.headers.get('Content-Length')).toBe(totalSize.toString());
      expect(result?.response.headers.get('X-Video-Chunked')).toBe('true');
    });

    it('should handle range requests for single entry videos', async () => {
      // Create mock video data
      const videoData = new Uint8Array(1024 * 1024).fill(1); // 1 MB

      // Create mock metadata
      const metadata: TransformationMetadata = {
        sourcePath: 'videos/test.mp4',
        mode: 'video',
        width: 640,
        height: 480,
        format: 'mp4',
        cacheTags: ['tag1', 'tag2'],
        cacheVersion: 1,
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: Date.now(),
        isChunked: false,
        actualTotalVideoSize: videoData.length
      };

      // Mock KV getWithMetadata for single entry
      mockKV.getWithMetadata.mockResolvedValue({
        value: 'mockedVideoData', // Placeholder, will be overridden by direct get call
        metadata
      });

      // Mock KV get for retrieving actual data
      mockKV.get.mockResolvedValue(videoData.buffer);

      // Create a mock range request
      const rangeRequest = new Request('https://example.com', {
        headers: {
          'Range': 'bytes=100-200'
        }
      });

      const result = await getTransformedVideo(
        mockKV as KVNamespace,
        'videos/test.mp4',
        {
          mode: 'video',
          width: 640,
          height: 480,
          format: 'mp4',
          version: 1,
          env: mockEnv
        },
        rangeRequest
      );

      expect(result).not.toBeNull();
      expect(result?.response.status).toBe(206); // Partial Content
      expect(result?.response.headers.get('Content-Range')).toBe(`bytes 100-200/${videoData.length}`);
      expect(result?.response.headers.get('Content-Length')).toBe('101'); // 101 bytes (200-100+1)
    });

    it('should handle range requests for chunked videos', async () => {
      // Create mock chunk data
      const chunk1 = new Uint8Array(5 * 1024 * 1024).fill(1);
      const chunk2 = new Uint8Array(5 * 1024 * 1024).fill(2);
      const totalSize = chunk1.length + chunk2.length;

      // Create mock manifest
      const manifest: ChunkManifest = {
        totalSize,
        chunkCount: 2,
        actualChunkSizes: [chunk1.length, chunk2.length],
        standardChunkSize: 5 * 1024 * 1024,
        originalContentType: 'video/mp4'
      };

      // Create mock metadata
      const metadata: TransformationMetadata = {
        sourcePath: 'videos/large-test.mp4',
        mode: 'video',
        width: 1280,
        height: 720,
        format: 'mp4',
        cacheTags: ['tag1', 'tag2'],
        cacheVersion: 1,
        contentType: 'application/json', // Manifest is JSON
        contentLength: JSON.stringify(manifest).length,
        createdAt: Date.now(),
        isChunked: true,
        actualTotalVideoSize: totalSize
      };

      // Mock KV getWithMetadata for manifest
      mockKV.getWithMetadata.mockResolvedValue({
        value: JSON.stringify(manifest),
        metadata
      });

      // Mock KV get for retrieving chunks
      mockKV.get.mockImplementation((key: string, options?: any) => {
        if (key.includes('_chunk_0')) {
          return Promise.resolve(chunk1.buffer);
        } else if (key.includes('_chunk_1')) {
          return Promise.resolve(chunk2.buffer);
        }
        return Promise.resolve(null);
      });

      // Create a mock range request across chunks
      const rangeRequest = new Request('https://example.com', {
        headers: {
          'Range': 'bytes=100-200'
        }
      });

      const result = await getTransformedVideo(
        mockKV as KVNamespace,
        'videos/large-test.mp4',
        {
          mode: 'video',
          width: 1280,
          height: 720,
          format: 'mp4',
          version: 1,
          env: mockEnv
        },
        rangeRequest
      );

      expect(result).not.toBeNull();
      expect(result?.response.status).toBe(206); // Partial Content
      expect(result?.response.headers.get('Content-Range')).toBe(`bytes 100-200/${totalSize}`);
      expect(result?.response.headers.get('Content-Length')).toBe('101'); // 101 bytes (200-100+1)
    });

    it('should handle invalid range requests', async () => {
      // Create mock video data
      const videoData = new Uint8Array(1024 * 1024).fill(1); // 1 MB

      // Create mock metadata
      const metadata: TransformationMetadata = {
        sourcePath: 'videos/test.mp4',
        mode: 'video',
        width: 640,
        height: 480,
        format: 'mp4',
        cacheTags: ['tag1', 'tag2'],
        cacheVersion: 1,
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: Date.now(),
        isChunked: false,
        actualTotalVideoSize: videoData.length
      };

      // Mock KV getWithMetadata for single entry
      mockKV.getWithMetadata.mockResolvedValue({
        value: 'mockedVideoData',
        metadata
      });

      // Mock KV get for retrieving actual data
      mockKV.get.mockResolvedValue(videoData.buffer);

      // Create a mock invalid range request
      const rangeRequest = new Request('https://example.com', {
        headers: {
          'Range': 'bytes=invalid'
        }
      });

      const result = await getTransformedVideo(
        mockKV as KVNamespace,
        'videos/test.mp4',
        {
          mode: 'video',
          width: 640,
          height: 480,
          format: 'mp4',
          version: 1,
          env: mockEnv
        },
        rangeRequest
      );

      expect(result).not.toBeNull();
      expect(result?.response.status).toBe(416); // Range Not Satisfiable
    });

    it('should handle missing video data', async () => {
      // Mock KV getWithMetadata to return null (cache miss)
      mockKV.getWithMetadata.mockResolvedValue({
        value: null,
        metadata: null
      });

      const result = await getTransformedVideo(
        mockKV as KVNamespace,
        'videos/missing.mp4',
        {
          mode: 'video',
          width: 640,
          height: 480,
          format: 'mp4',
          version: 1,
          env: mockEnv
        }
      );

      expect(result).toBeNull();
    });

    it('should detect and handle size mismatches for data integrity', async () => {
      // Create mock video data with different size from metadata
      const videoData = new Uint8Array(1024 * 1024).fill(1); // 1 MB
      
      // Create mock metadata with incorrect size
      const metadata: TransformationMetadata = {
        sourcePath: 'videos/test.mp4',
        mode: 'video',
        width: 640,
        height: 480,
        format: 'mp4',
        cacheTags: ['tag1', 'tag2'],
        cacheVersion: 1,
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: Date.now(),
        isChunked: false,
        actualTotalVideoSize: videoData.length + 1000 // Incorrect size
      };

      // Mock KV getWithMetadata
      mockKV.getWithMetadata.mockResolvedValue({
        value: 'mockedVideoData',
        metadata
      });

      // Mock KV get for retrieving actual data
      mockKV.get.mockResolvedValue(videoData.buffer);

      const result = await getTransformedVideo(
        mockKV as KVNamespace,
        'videos/test.mp4',
        {
          mode: 'video',
          width: 640,
          height: 480,
          format: 'mp4',
          version: 1,
          env: mockEnv
        }
      );

      // Should return null due to size mismatch
      expect(result).toBeNull();
    });
  });
});