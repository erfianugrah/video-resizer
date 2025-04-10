import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  generateKVKey, 
  getTransformedVideo, 
  storeTransformedVideo, 
  listVariants 
} from '../../src/services/kvStorageService';

// Mock the KV namespace
class MockKVNamespace implements KVNamespace {
  private store: Map<string, ArrayBuffer> = new Map();
  private metadata: Map<string, any> = new Map();
  
  async put(key: string, value: ArrayBuffer | string, options?: any): Promise<void> {
    // Convert string to ArrayBuffer if needed
    const buffer = typeof value === 'string' 
      ? new TextEncoder().encode(value) 
      : value;
    
    this.store.set(key, buffer);
    
    if (options?.metadata) {
      this.metadata.set(key, options.metadata);
    }
  }
  
  async get(key: string, options?: any): Promise<any> {
    if (options === 'arrayBuffer' || options?.type === 'arrayBuffer') {
      return this.store.get(key) || null;
    }
    
    const buffer = this.store.get(key);
    if (!buffer) return null;
    
    if (options === 'text' || options?.type === 'text') {
      return new TextDecoder().decode(buffer);
    }
    
    if (options === 'json' || options?.type === 'json') {
      const text = new TextDecoder().decode(buffer);
      return JSON.parse(text);
    }
    
    return buffer;
  }
  
  async getWithMetadata<T = any>(key: string, type?: string): Promise<{ value: any; metadata: T }> {
    const value = await this.get(key, type);
    const metadata = this.metadata.get(key) as T;
    return { value, metadata };
  }
  
  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.metadata.delete(key);
  }
  
  async list(options?: any): Promise<{ keys: { name: string; expiration?: number; metadata?: any }[], list_complete: boolean, cursor: string }> {
    const prefix = options?.prefix || '';
    const keys = Array.from(this.store.keys())
      .filter(key => key.startsWith(prefix))
      .map(name => {
        return {
          name,
          metadata: this.metadata.get(name)
        };
      });
    
    return {
      keys,
      list_complete: true,
      cursor: ''
    };
  }
}

// Create a mock request context
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/test',
    startTime: Date.now(),
    debugEnabled: false
  })),
  addBreadcrumb: vi.fn()
}));

// Mock the logger
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn()
  })),
  debug: vi.fn(),
  error: vi.fn()
}));

// Mock the cache tags generator
vi.mock('../../src/services/videoStorageService', () => ({
  generateCacheTags: vi.fn(() => ['video-test', 'video-derivative-mobile'])
}));

// Mock the VideoConfigurationManager
vi.mock('../../src/config/VideoConfigurationManager', () => ({
  VideoConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        derivatives: {
          mobile: {
            width: 854,
            height: 640,
            mode: 'video'
          },
          tablet: {
            width: 1280,
            height: 720,
            mode: 'video'
          },
          desktop: {
            width: 1920,
            height: 1080,
            mode: 'video'
          }
        }
      }))
    }))
  }
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
        quality: 'high'
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
        format: 'mp4'
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
      const response = new Response('test video data', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '14'
        }
      });
      
      const options = {
        width: 640,
        height: 360,
        derivative: 'mobile',
        format: 'mp4',
        quality: 'high'
      };
      
      const result = await storeTransformedVideo(mockKV, '/videos/test.mp4', response, options);
      
      expect(result).toBe(true);
      
      // Check that the data was stored
      const key = generateKVKey('/videos/test.mp4', options);
      const { value, metadata } = await mockKV.getWithMetadata(key, 'arrayBuffer');
      
      expect(value).toBeDefined();
      expect(metadata).toBeDefined();
      expect(metadata.sourcePath).toBe('/videos/test.mp4');
      expect(metadata.width).toBe(854); // Now using the actual derivative dimensions
      expect(metadata.height).toBe(640); // Now using the actual derivative dimensions
      expect(metadata.derivative).toBe('mobile');
      expect(metadata.customData.requestedWidth).toBe(640); // The originally requested dimensions
      expect(metadata.customData.requestedHeight).toBe(360); // The originally requested dimensions
      expect(metadata.format).toBe('mp4');
      expect(metadata.quality).toBe('high');
      expect(metadata.contentType).toBe('video/mp4');
      expect(metadata.contentLength).toBe(14);
      expect(metadata.cacheTags).toEqual(['video-test', 'video-derivative-mobile']);
      expect(metadata.createdAt).toBeGreaterThan(0);
    });
    
    it('should store a video with TTL', async () => {
      const response = new Response('test video data', {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '14'
        }
      });
      
      const options = { derivative: 'mobile' };
      const ttl = 3600; // 1 hour
      
      const result = await storeTransformedVideo(mockKV, '/videos/test.mp4', response, options, ttl);
      
      expect(result).toBe(true);
      
      // Check that the data was stored with expiration
      const key = generateKVKey('/videos/test.mp4', options);
      const { metadata } = await mockKV.getWithMetadata(key);
      
      expect(metadata.expiresAt).toBeDefined();
      // expiresAt should be approximately createdAt + ttl*1000
      const expectedExpiration = metadata.createdAt + ttl * 1000;
      expect(metadata.expiresAt).toBeCloseTo(expectedExpiration, -2); // within ~100ms
    });
    
    it('should handle errors when storing', async () => {
      // Create a KV with a put method that throws
      const mockKVWithError = {
        put: vi.fn().mockRejectedValue(new Error('KV storage error'))
      } as unknown as KVNamespace;
      
      const response = new Response('test video data');
      const options = { derivative: 'mobile' };
      
      const result = await storeTransformedVideo(mockKVWithError, '/videos/test.mp4', response, options);
      
      expect(result).toBe(false);
    });
  });
  
  describe('getTransformedVideo', () => {
    it('should retrieve a stored video with metadata', async () => {
      // First, store a video
      const videoData = new Uint8Array([1, 2, 3, 4]); // Simple binary data
      const options = { derivative: 'mobile' };
      const key = generateKVKey('/videos/test.mp4', options);
      
      // Create metadata
      const metadata = {
        sourcePath: '/videos/test.mp4',
        derivative: 'mobile',
        cacheTags: ['video-test', 'video-derivative-mobile'],
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: Date.now()
      };
      
      // Store directly
      await mockKV.put(key, videoData, { metadata });
      
      // Now retrieve
      const result = await getTransformedVideo(mockKV, '/videos/test.mp4', options);
      
      expect(result).not.toBeNull();
      expect(result?.metadata).toEqual(metadata);
      
      // Check the response
      const response = result?.response;
      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get('Content-Type')).toBe('video/mp4');
      expect(response.headers.get('Content-Length')).toBe(String(videoData.length));
      expect(response.headers.get('Cache-Control')).toContain('public, max-age=');
      expect(response.headers.get('Cache-Tag')).toBe('video-test,video-derivative-mobile');
      
      // Check the body
      const responseData = await response.arrayBuffer();
      expect(new Uint8Array(responseData)).toEqual(videoData);
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
      
      // Create metadata with expiration
      const metadata = {
        sourcePath: '/videos/test.mp4',
        derivative: 'mobile',
        cacheTags: ['video-test'],
        contentType: 'video/mp4',
        contentLength: videoData.length,
        createdAt: now,
        expiresAt: expiresAt
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
        getWithMetadata: vi.fn().mockRejectedValue(new Error('KV retrieval error'))
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
        metadata: { sourcePath, derivative: 'mobile', createdAt: Date.now() }
      });
      await mockKV.put(key2, new Uint8Array([2]), { 
        metadata: { sourcePath, width: 640, height: 360, createdAt: Date.now() }
      });
      await mockKV.put(key3, new Uint8Array([3]), { 
        metadata: { sourcePath, derivative: 'high', createdAt: Date.now() }
      });
      await mockKV.put(key4, new Uint8Array([4]), { 
        metadata: { sourcePath: '/videos/other.mp4', derivative: 'mobile', createdAt: Date.now() }
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
      const keys = variants.map(v => v.key);
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
        list: vi.fn().mockRejectedValue(new Error('KV list error'))
      } as unknown as KVNamespace;
      
      const variants = await listVariants(mockKVWithError, '/videos/test.mp4');
      
      expect(variants).toEqual([]);
    });
  });
});