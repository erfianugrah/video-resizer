import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  generatePresignedUrlKey,
  storePresignedUrl,
  getPresignedUrl,
  isUrlExpiring,
  refreshPresignedUrl,
  PresignedUrlCacheEntry,
} from '../../src/services/presignedUrlCacheService';

// Mock KV namespace
class MockKVNamespace {
  private store: Map<string, any> = new Map();
  private metadata: Map<string, any> = new Map();
  private ttl: Map<string, number> = new Map();

  async get(key: string, options?: any): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async put(
    key: string,
    value: string | ReadableStream | ArrayBuffer | FormData,
    options?: any
  ): Promise<void> {
    this.store.set(key, value);
    if (options?.metadata) {
      this.metadata.set(key, options.metadata);
    }
    if (options?.expirationTtl) {
      this.ttl.set(key, options.expirationTtl);
    }
  }

  async getWithMetadata(key: string, type?: string): Promise<{ value: any; metadata: any }> {
    return {
      value: this.store.get(key) || null,
      metadata: this.metadata.get(key) || null,
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.metadata.delete(key);
    this.ttl.delete(key);
  }

  async deleteBulk(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key);
      this.metadata.delete(key);
      this.ttl.delete(key);
    }
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

describe('PresignedUrlCacheService', () => {
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

  describe('generatePresignedUrlKey', () => {
    it('should generate a key based on path and options', () => {
      const key = generatePresignedUrlKey('videos/test.mp4', {
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
      });

      expect(key).toContain('presigned:remote:videos/test.mp4');
      expect(key).toContain('auth=aws-s3-presigned-url');
      expect(key).toContain('region=us-east-1');
      expect(key).toContain('service=s3');
    });

    it('should handle paths with special characters', () => {
      const key = generatePresignedUrlKey('videos/test file with spaces.mp4', {
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
      });

      expect(key).not.toContain(' ');
      expect(key).toContain('videos/test-file-with-spaces.mp4');
    });
  });

  describe('storePresignedUrl and getPresignedUrl', () => {
    it('should store and retrieve a presigned URL', async () => {
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

      // Retrieve the URL
      const retrieveOptions = {
        storageType: 'remote' as const,
        authType: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
        env: mockEnv,
      };

      const cachedEntry = await getPresignedUrl(mockKV as any, path, retrieveOptions);

      expect(cachedEntry).not.toBeNull();
      expect(cachedEntry?.url).toBe(presignedUrl);
      expect(cachedEntry?.originalUrl).toBe(originalUrl);
      expect(cachedEntry?.storageType).toBe('remote');
      expect(cachedEntry?.expiresAt).toBe(Date.now() + 3600 * 1000);
    });

    it('should handle URL expiration', async () => {
      const path = 'videos/test.mp4';
      const presignedUrl =
        'https://test-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...';
      const originalUrl = 'https://test-bucket.s3.amazonaws.com/videos/test.mp4';

      // Store with short expiration
      await storePresignedUrl(mockKV as any, path, presignedUrl, originalUrl, {
        storageType: 'remote',
        expiresInSeconds: 10, // 10 seconds
        authType: 'aws-s3-presigned-url',
        env: mockEnv,
      });

      // Simulate time passing - URL is still valid
      vi.spyOn(Date, 'now').mockImplementation(() => 1619795165000); // 5 seconds later

      let cachedEntry = await getPresignedUrl(mockKV as any, path, {
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
        env: mockEnv,
      });

      expect(cachedEntry).not.toBeNull();
      expect(cachedEntry?.url).toBe(presignedUrl);

      // Simulate time passing - URL is now expired
      vi.spyOn(Date, 'now').mockImplementation(() => 1619795180000); // 20 seconds later

      cachedEntry = await getPresignedUrl(mockKV as any, path, {
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
        env: mockEnv,
      });

      expect(cachedEntry).toBeNull(); // Expired URL should not be returned
    });
  });

  describe('isUrlExpiring', () => {
    it('should detect URLs that are close to expiration', () => {
      const entry: PresignedUrlCacheEntry = {
        url: 'https://test.com/signed-url',
        originalUrl: 'https://test.com/original',
        createdAt: Date.now(),
        expiresAt: Date.now() + 200 * 1000, // 200 seconds until expiration
        path: 'test.mp4',
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
      };

      // With default threshold (300 seconds)
      expect(isUrlExpiring(entry)).toBe(true);

      // With custom threshold
      expect(isUrlExpiring(entry, 100)).toBe(false);
      expect(isUrlExpiring(entry, 300)).toBe(true);
    });
  });

  describe('refreshPresignedUrl', () => {
    it('should refresh an expiring URL', async () => {
      const path = 'videos/refresh-test.mp4';
      const oldUrl = 'https://test-bucket.s3.amazonaws.com/videos/old-signature';
      const newUrl = 'https://test-bucket.s3.amazonaws.com/videos/new-signature';
      const originalUrl = 'https://test-bucket.s3.amazonaws.com/videos/original';

      // Create an expiring entry
      const entry: PresignedUrlCacheEntry = {
        url: oldUrl,
        originalUrl,
        createdAt: Date.now() - 3000 * 1000, // Created 3000 seconds ago
        expiresAt: Date.now() + 600 * 1000, // Expires in 600 seconds
        path,
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
      };

      // Create URL generator function that returns a new URL
      const generateUrlFn = vi.fn().mockResolvedValue(newUrl);

      // Refresh the URL
      const refreshResult = await refreshPresignedUrl(mockKV as any, entry, {
        thresholdSeconds: 900, // 15 minutes threshold
        env: mockEnv,
        generateUrlFn,
      });

      expect(refreshResult).toBe(true);
      expect(generateUrlFn).toHaveBeenCalledWith(path);

      // Verify the new URL was stored
      const cachedEntry = await getPresignedUrl(mockKV as any, path, {
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
        env: mockEnv,
      });

      expect(cachedEntry).not.toBeNull();
      expect(cachedEntry?.url).toBe(newUrl);
      expect(cachedEntry?.originalUrl).toBe(originalUrl);
    });

    it('should not refresh a URL that is not expiring soon', async () => {
      const path = 'videos/not-expiring.mp4';
      const url = 'https://test-bucket.s3.amazonaws.com/videos/signature';
      const originalUrl = 'https://test-bucket.s3.amazonaws.com/videos/original';

      // Create entry that doesn't expire soon
      const entry: PresignedUrlCacheEntry = {
        url,
        originalUrl,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600 * 1000, // Expires in 1 hour
        path,
        storageType: 'remote',
        authType: 'aws-s3-presigned-url',
      };

      // URL generator should not be called
      const generateUrlFn = vi.fn();

      // Try to refresh the URL
      const refreshResult = await refreshPresignedUrl(mockKV as any, entry, {
        thresholdSeconds: 300, // 5 minutes threshold
        env: mockEnv,
        generateUrlFn,
      });

      expect(refreshResult).toBe(false);
      expect(generateUrlFn).not.toHaveBeenCalled();
    });
  });
});
