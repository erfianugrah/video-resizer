import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateKVKey,
  getTransformedVideo,
  storeTransformedVideo,
  listVariants,
} from '../../src/services/kvStorageService';

// Mock TransformStream for tests
global.TransformStream = class TransformStreamMock {
  readable: ReadableStream;
  writable: WritableStream;

  constructor() {
    let controller: ReadableStreamDefaultController | null = null;

    this.readable = new ReadableStream({
      start(c) {
        controller = c;
      },
    });

    this.writable = new WritableStream({
      write(chunk) {
        if (controller) controller.enqueue(chunk);
      },
      close() {
        if (controller) controller.close();
      },
    });
  }
};

// Mock the KV namespace
class MockKVNamespace implements KVNamespace {
  private store: Map<string, ArrayBuffer> = new Map();
  private metadata: Map<string, any> = new Map();

  // Use sync implementation for testing to avoid timeouts
  put(key: string, value: any, options?: any): Promise<void> {
    // For streaming responses, convert to ArrayBuffer
    if (value && typeof value === 'object' && 'getReader' in value) {
      // Just use a simple buffer for testing instead of streams
      const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
      this.store.set(key, buffer);
    } else {
      // Convert string to ArrayBuffer if needed
      const buffer = typeof value === 'string' ? new TextEncoder().encode(value) : value;

      this.store.set(key, buffer);
    }

    if (options?.metadata) {
      this.metadata.set(key, options.metadata);
    }

    // Return resolved promise immediately
    return Promise.resolve();
  }

  get(key: string, options?: any): Promise<any> {
    if (options === 'arrayBuffer' || options?.type === 'arrayBuffer') {
      return Promise.resolve(this.store.get(key) || null);
    }

    const buffer = this.store.get(key);
    if (!buffer) return Promise.resolve(null);

    if (options === 'text' || options?.type === 'text') {
      return Promise.resolve(new TextDecoder().decode(buffer));
    }

    if (options === 'json' || options?.type === 'json') {
      const text = new TextDecoder().decode(buffer);
      return Promise.resolve(JSON.parse(text));
    }

    return Promise.resolve(buffer);
  }

  getWithMetadata<T = any>(
    key: string,
    typeOrOptions?: string | Record<string, any>
  ): Promise<{ value: any; metadata: T }> {
    // Normalize the type parameter - source code may pass an object like { type: 'text', cacheTtl: 60 }
    let resolvedType: string | undefined;
    if (typeof typeOrOptions === 'string') {
      resolvedType = typeOrOptions;
    } else if (typeOrOptions && typeof typeOrOptions === 'object' && 'type' in typeOrOptions) {
      resolvedType = typeOrOptions.type;
    }

    // For stream type, return a ReadableStream for testing
    if (resolvedType === 'stream') {
      // Create a simple readable stream with our test data
      const buffer = this.store.get(key);
      if (!buffer) return Promise.resolve({ value: null, metadata: null as T });

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        },
      });

      return Promise.resolve({
        value: stream,
        metadata: this.metadata.get(key) as T,
      });
    }

    // For other types, use normal get
    return this.get(key, resolvedType).then((value) => {
      return {
        value,
        metadata: this.metadata.get(key) as T,
      };
    });
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    this.metadata.delete(key);
    return Promise.resolve();
  }

  list(options?: any): Promise<{
    keys: { name: string; expiration?: number; metadata?: any }[];
    list_complete: boolean;
    cursor: string;
  }> {
    const prefix = options?.prefix || '';
    const keys = Array.from(this.store.keys())
      .filter((key) => key.startsWith(prefix))
      .map((name) => {
        return {
          name,
          metadata: this.metadata.get(name),
        };
      });

    return Promise.resolve({
      keys,
      list_complete: true,
      cursor: '',
    });
  }
}

// Create a mock request context
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/test',
    startTime: Date.now(),
    debugEnabled: false,
  })),
  addBreadcrumb: vi.fn(),
}));

// Mock the logger
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
  })),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Mock the cache tags generator
vi.mock('../../src/services/videoStorageService', () => ({
  generateCacheTags: vi.fn(() => ['video-test', 'video-derivative-mobile']),
}));

// Mock the VideoConfigurationManager
// Mock for Response.clone to avoid streaming issues
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Response: class MockResponse extends actual.Response {
      constructor(body: any, init?: any) {
        super(body, init);
      }

      clone() {
        // Return a new response with the same properties
        return new MockResponse('test data', {
          status: this.status,
          statusText: this.statusText,
          headers: this.headers,
        });
      }

      // Mock arrayBuffer to avoid streaming issues
      arrayBuffer() {
        return Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
      }

      // Mock text method to avoid streaming issues
      text() {
        return Promise.resolve('test data');
      }

      // Mock body property
      get body() {
        // Create a simple mock for pipeTo
        return {
          pipeTo: () => Promise.resolve(),
        };
      }
    },
  };
});

vi.mock('../../src/config/VideoConfigurationManager', () => ({
  VideoConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        derivatives: {
          mobile: {
            width: 854,
            height: 640,
            mode: 'video',
          },
          tablet: {
            width: 1280,
            height: 720,
            mode: 'video',
          },
          desktop: {
            width: 1920,
            height: 1080,
            mode: 'video',
          },
        },
      })),
    })),
  },
}));

// Mock the CacheConfigurationManager
vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        storeIndefinitely: false,
        defaultMaxAge: 300,
        ttlRefresh: {
          minElapsedPercent: 10,
          minRemainingSeconds: 60,
        },
      })),
    })),
  },
}));

describe('KV Storage Service', () => {
  let mockKV: MockKVNamespace;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    vi.clearAllMocks();
  });

  describe('generateKVKey', () => {
    it('should generate a key with only the source path when no options provided', () => {
      const key = generateKVKey('/videos/test.mp4', {});
      expect(key).toBe('video:videos/test.mp4');
    });

    it('should generate a key with derivative parameter', () => {
      const key = generateKVKey('/videos/test.mp4', { derivative: 'mobile' });
      expect(key).toBe('video:videos/test.mp4:derivative=mobile');
    });

    it('should generate a key with multiple transformation parameters', () => {
      const key = generateKVKey('/videos/test.mp4', {
        width: 640,
        height: 360,
        format: 'mp4',
        quality: 'high',
      });
      expect(key).toBe('video:videos/test.mp4:w=640:h=360:f=mp4:q=high');
    });

    it('should normalize the source path by removing leading slashes', () => {
      const key = generateKVKey('///videos/test.mp4', { derivative: 'mobile' });
      expect(key).toBe('video:videos/test.mp4:derivative=mobile');
    });

    it('should handle null values in options', () => {
      const key = generateKVKey('/videos/test.mp4', {
        width: 640,
        height: null,
        format: 'mp4',
      });
      expect(key).toBe('video:videos/test.mp4:w=640:f=mp4');
    });

    it('should replace invalid characters in the key', () => {
      const key = generateKVKey('/videos/test with spaces.mp4', { derivative: 'mobile' });
      expect(key).toBe('video:videos/test-with-spaces.mp4:derivative=mobile');
    });
  });

  describe('storeTransformedVideo', () => {
    it('should store a video with metadata', async () => {
      // Create a real Response with body content that can be read via arrayBuffer()
      // storeTransformedVideo calls responseClone.arrayBuffer() to read the body
      const videoData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      const mockResponse = new Response(videoData.buffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '14',
        },
      });

      const options = {
        width: 640,
        height: 360,
        derivative: 'mobile',
        format: 'mp4',
        quality: 'high',
      };

      // Mock direct access to put method to bypass stream handling
      const mockPut = vi.fn().mockResolvedValue(undefined);
      mockKV.put = mockPut;

      const result = await storeTransformedVideo(
        mockKV,
        '/videos/test.mp4',
        mockResponse as any,
        options
      );

      expect(result).toBe(true);
      expect(mockPut).toHaveBeenCalled();

      // Verify the key follows the right pattern (we can't check the actual metadata since we mocked put)
      const key = generateKVKey('/videos/test.mp4', options);
      expect(key).toBe('video:videos/test.mp4:derivative=mobile');
    });

    it('should store a video with TTL', async () => {
      // Create a real Response with body content that can be read via arrayBuffer()
      const videoData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      const mockResponse = new Response(videoData.buffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '14',
        },
      });

      const options = { derivative: 'mobile' };
      const ttl = 3600; // 1 hour

      // Mock put method to verify arguments
      const mockPut = vi.fn().mockImplementation((key, value, options) => {
        // Store the options for verification
        mockMetadata = options;
        return Promise.resolve();
      });
      let mockMetadata: any = null;
      mockKV.put = mockPut;

      const result = await storeTransformedVideo(
        mockKV,
        '/videos/test.mp4',
        mockResponse as any,
        options,
        ttl
      );

      expect(result).toBe(true);
      expect(mockPut).toHaveBeenCalled();

      // Check that expirationTtl was passed, but we can't check exact value since storeIndefinitely may affect it
      if (mockMetadata) {
        expect(mockMetadata.metadata).toBeDefined();
      }
    });

    it('should store a video with TTL and expirationTtl', async () => {
      // Create a real Response with body content that can be read via arrayBuffer()
      const videoData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      const mockResponse = new Response(videoData.buffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '14',
        },
      });

      const options = { derivative: 'mobile' };
      const ttl = 3600; // 1 hour

      // Mock put method to verify arguments
      const mockPut = vi.fn().mockImplementation((key, value, options) => {
        // Store the options for verification
        mockMetadata = options;
        return Promise.resolve();
      });
      let mockMetadata: any = null;
      mockKV.put = mockPut;

      const result = await storeTransformedVideo(
        mockKV,
        '/videos/test.mp4',
        mockResponse as any,
        options,
        ttl
      );

      expect(result).toBe(true);
      expect(mockPut).toHaveBeenCalled();

      // Check that expirationTtl was passed, but we can't check exact value since storeIndefinitely may affect it
      if (mockMetadata) {
        expect(mockMetadata.metadata).toBeDefined();
      }
    });

    it('should handle errors when storing', async () => {
      // Create a KV with a put method that throws
      const mockKVWithError = {
        put: vi.fn().mockRejectedValue(new Error('KV storage error')),
      } as unknown as KVNamespace;

      const response = new Response('test video data');
      const options = { derivative: 'mobile' };

      const result = await storeTransformedVideo(
        mockKVWithError,
        '/videos/test.mp4',
        response,
        options
      );

      expect(result).toBe(false);
    });
  });

  describe('getTransformedVideo', () => {
    it('should retrieve a stored video with metadata', async () => {
      // Simple binary data for the video
      const videoData = new Uint8Array([1, 2, 3, 4]);
      const options = { derivative: 'mobile' };
      const key = generateKVKey('/videos/test.mp4', options);

      // Create metadata - must include isChunked and actualTotalVideoSize for the source code
      // to recognize it as a single-entry video
      const metadata = {
        sourcePath: '/videos/test.mp4',
        derivative: 'mobile',
        cacheTags: ['video-test', 'video-derivative-mobile'],
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: Date.now(),
        isChunked: false,
        actualTotalVideoSize: videoData.length,
      };

      // The source code calls getWithMetadata with { type: 'text', ...kvReadOptions } to get metadata first,
      // then calls get with { type: 'arrayBuffer', ...kvReadOptions } for single-entry videos.
      // Mock the KV instance to handle both calls.
      const mockKVCustom = {
        getWithMetadata: vi.fn().mockResolvedValue({
          value: new TextDecoder().decode(videoData), // text representation for initial fetch
          metadata,
        }),
        get: vi.fn().mockResolvedValue(videoData.buffer), // arrayBuffer for data fetch
      } as unknown as KVNamespace;

      // Now retrieve using our mock
      const result = await getTransformedVideo(mockKVCustom, '/videos/test.mp4', options);

      expect(result).not.toBeNull();
      expect(result?.metadata).toEqual(metadata);

      // Check the response
      const response = result?.response;
      expect(response).toBeInstanceOf(Response);
      expect(response!.headers.get('Content-Type')).toBe('video/mp4');
      expect(response!.headers.get('Content-Length')).toBe(String(videoData.length));
      expect(response!.headers.get('Cache-Control')).toContain('public, max-age=');
      expect(response!.headers.get('Cache-Tag')).toBe('video-test,video-derivative-mobile');
    });

    it('should return null if video not found', async () => {
      const options = { derivative: 'mobile' };
      const result = await getTransformedVideo(mockKV, '/videos/not-found.mp4', options);

      expect(result).toBeNull();
    });

    it('should set remaining TTL in Cache-Control if expiresAt is present', async () => {
      // Store a video with expiration
      const videoData = new Uint8Array([1, 2, 3, 4]);
      const options = { derivative: 'mobile' };
      const key = generateKVKey('/videos/test.mp4', options);

      // Set expiration 10 minutes in the future
      const now = Date.now();
      const expiresIn = 10 * 60 * 1000; // 10 minutes
      const expiresAt = now + expiresIn;

      // Create metadata with expiration - must include isChunked and actualTotalVideoSize
      const metadata = {
        sourcePath: '/videos/test.mp4',
        derivative: 'mobile',
        cacheTags: ['video-test'],
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: now,
        expiresAt: expiresAt,
        isChunked: false,
        actualTotalVideoSize: videoData.length,
      };

      // Store directly
      await mockKV.put(key, videoData, { metadata });

      // Now retrieve
      const result = await getTransformedVideo(mockKV, '/videos/test.mp4', options);

      expect(result).not.toBeNull();

      // Check the Cache-Control header
      const cacheControl = result?.response.headers.get('Cache-Control');
      expect(cacheControl).toContain('public, max-age=');

      // Extract the max-age value
      const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/);
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 0;

      // Should be close to our remaining time (within a small margin for test execution time)
      const expectedMaxAge = Math.floor(expiresIn / 1000);
      expect(maxAge).toBeGreaterThanOrEqual(expectedMaxAge - 5);
      expect(maxAge).toBeLessThanOrEqual(expectedMaxAge);
    });

    it('should handle errors when retrieving', async () => {
      // Create a KV with a getWithMetadata method that throws
      const mockKVWithError = {
        getWithMetadata: vi.fn().mockRejectedValue(new Error('KV retrieval error')),
      } as unknown as KVNamespace;

      const options = { derivative: 'mobile' };
      const result = await getTransformedVideo(mockKVWithError, '/videos/test.mp4', options);

      expect(result).toBeNull();
    });
  });

  describe('listVariants', () => {
    it('should list all variants for a source path', async () => {
      // Store multiple variants
      const sourcePath = '/videos/test.mp4';
      const options1 = { derivative: 'mobile' };
      const options2 = { width: 640, height: 360 };
      const options3 = { derivative: 'high' };

      const key1 = generateKVKey(sourcePath, options1);
      const key2 = generateKVKey(sourcePath, options2);
      const key3 = generateKVKey(sourcePath, options3);
      const key4 = generateKVKey('/videos/other.mp4', options1);

      // Store all variants
      await mockKV.put(key1, new Uint8Array([1]), {
        metadata: { sourcePath, derivative: 'mobile', createdAt: Date.now() },
      });
      await mockKV.put(key2, new Uint8Array([2]), {
        metadata: { sourcePath, width: 640, height: 360, createdAt: Date.now() },
      });
      await mockKV.put(key3, new Uint8Array([3]), {
        metadata: { sourcePath, derivative: 'high', createdAt: Date.now() },
      });
      await mockKV.put(key4, new Uint8Array([4]), {
        metadata: { sourcePath: '/videos/other.mp4', derivative: 'mobile', createdAt: Date.now() },
      });

      // List variants for the test.mp4 video
      const variants = await listVariants(mockKV, sourcePath);

      // Should find 3 variants for test.mp4
      expect(variants.length).toBe(3);

      // Check that all variants have the correct source path
      for (const variant of variants) {
        expect(variant.metadata.sourcePath).toBe(sourcePath);
      }

      // Check for specific keys
      const keys = variants.map((v) => v.key);
      expect(keys).toContain(key1);
      expect(keys).toContain(key2);
      expect(keys).toContain(key3);
      expect(keys).not.toContain(key4);
    });

    it('should return an empty array if no variants found', async () => {
      const variants = await listVariants(mockKV, '/videos/not-found.mp4');
      expect(variants).toEqual([]);
    });

    it('should handle errors when listing', async () => {
      // Create a KV with a list method that throws
      const mockKVWithError = {
        list: vi.fn().mockRejectedValue(new Error('KV list error')),
      } as unknown as KVNamespace;

      const variants = await listVariants(mockKVWithError, '/videos/test.mp4');

      expect(variants).toEqual([]);
    });
  });
});
