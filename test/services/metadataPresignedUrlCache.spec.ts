import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  generatePresignedUrlKey,
  storePresignedUrl,
  getPresignedUrl,
  PresignedUrlCacheEntry,
} from '../../src/services/presignedUrlCacheService';

// Mock KV namespace with metadata support
class MockKVNamespace {
  private store: Map<string, any> = new Map();
  private metadata: Map<string, any> = new Map();
  private ttl: Map<string, number> = new Map();

  async get(key: string, options?: any): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async put(
    key: string,
    value: string | ReadableStream | ArrayBuffer | FormData,
    options?: any
  ): Promise<void> {
    // Store value (even if it's an empty string)
    this.store.set(key, value === undefined ? null : value);

    if (options?.metadata) {
      this.metadata.set(key, options.metadata);
    }
    if (options?.expirationTtl) {
      this.ttl.set(key, options.expirationTtl);
    }
  }

  async getWithMetadata(
    key: string,
    type: 'text'
  ): Promise<{ value: string | null; metadata: any }>;
  async getWithMetadata(key: string, type: 'json'): Promise<{ value: any; metadata: any }>;
  async getWithMetadata(
    key: string,
    type: 'arrayBuffer'
  ): Promise<{ value: ArrayBuffer | null; metadata: any }>;
  async getWithMetadata(
    key: string,
    type: 'stream'
  ): Promise<{ value: ReadableStream | null; metadata: any }>;
  async getWithMetadata(key: string, type: string): Promise<{ value: any; metadata: any }> {
    return {
      value: this.store.has(key) ? this.store.get(key) : null,
      metadata: this.metadata.has(key) ? this.metadata.get(key) : null,
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.metadata.delete(key);
    this.ttl.delete(key);
  }

  async list(
    options?: any
  ): Promise<{ keys: { name: string; expiration?: number; metadata?: any }[] }> {
    const keys = Array.from(this.store.keys()).map((name) => {
      return {
        name,
        expiration: this.ttl.has(name) ? Date.now() + this.ttl.get(name)! * 1000 : undefined,
        metadata: this.metadata.get(name),
      };
    });
    return { keys };
  }
}

describe('Metadata-Based Presigned URL Cache', () => {
  let mockKV: MockKVNamespace;
  let mockEnv: any;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    mockEnv = {
      VIDEO_CACHE_KEY_VERSIONS: new MockKVNamespace(),
      executionCtx: {
        waitUntil: vi.fn((promise) => promise),
      },
    };

    // Mock Date.now for consistent timestamps in tests
    vi.spyOn(Date, 'now').mockImplementation(() => 1619795160000); // 2021-04-30T17:06:00.000Z
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('storePresignedUrl with metadata', () => {
    it('should store URL data in metadata with empty value', async () => {
      const path = 'videos/test.mp4';
      const presignedUrl =
        'https://test-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...';
      const originalUrl = 'https://test-bucket.s3.amazonaws.com/videos/test.mp4';

      const options = {
        storageType: 'remote' as const,
        expiresInSeconds: 3600,
        authType: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
        env: mockEnv,
      };

      // Store the URL
      const storeResult = await storePresignedUrl(
        mockKV as any,
        path,
        presignedUrl,
        originalUrl,
        options
      );
      expect(storeResult).toBe(true);

      // Verify KV storage
      const key = generatePresignedUrlKey(path, options);
      const { value, metadata } = await mockKV.getWithMetadata(key, 'text');

      // Value should be empty
      expect(value).toBe('');

      // Metadata should contain all the URL information
      expect(metadata).toBeDefined();
      expect(metadata.url).toBe(presignedUrl);
      expect(metadata.originalUrl).toBe(originalUrl);
      expect(metadata.path).toBe(path);

      // Should extract auth token
      expect(metadata.authToken).toBeDefined();
      expect(metadata.authToken).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    });
  });

  describe('getPresignedUrl with metadata', () => {
    it('should retrieve URL data from metadata', async () => {
      const path = 'videos/test.mp4';
      const presignedUrl =
        'https://test-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...';
      const originalUrl = 'https://test-bucket.s3.amazonaws.com/videos/test.mp4';

      const options = {
        storageType: 'remote' as const,
        expiresInSeconds: 3600,
        authType: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
        env: mockEnv,
      };

      // Store first
      await storePresignedUrl(mockKV as any, path, presignedUrl, originalUrl, options);

      // Then retrieve
      const cachedEntry = await getPresignedUrl(mockKV as any, path, {
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
        env: mockEnv,
      });

      // Should retrieve the entry from metadata
      expect(cachedEntry).not.toBeNull();
      expect(cachedEntry?.url).toBe(presignedUrl);
      expect(cachedEntry?.originalUrl).toBe(originalUrl);
      expect(cachedEntry?.path).toBe(path);
      expect(cachedEntry?.authToken).toBeDefined();
    });
  });
});
