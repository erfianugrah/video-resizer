import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchFromRemote } from '../../src/services/videoStorageService';
import * as presignedUrlCacheService from '../../src/services/presignedUrlCacheService';

// Mock the presignedUrlCacheService to test integration
vi.mock('../../src/services/presignedUrlCacheService', () => {
  return {
    getPresignedUrl: vi.fn(),
    storePresignedUrl: vi.fn().mockResolvedValue(true),
    isUrlExpiring: vi.fn().mockReturnValue(false),
    refreshPresignedUrl: vi.fn().mockResolvedValue(true)
  };
});

// Mock aws4fetch
vi.mock('aws4fetch', () => {
  return {
    AwsClient: class MockAwsClient {
      constructor(options) {
        this.options = options;
      }
      
      async sign(request, options) {
        // Return a mock signed request with a presigned URL
        return new Request(
          request.url + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Signature=test',
          request
        );
      }
    }
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('VideoStorageService AWS S3 Presigned URL Integration', () => {
  const mockEnv = {
    PRESIGNED_URLS: {
      get: vi.fn(),
      put: vi.fn(),
      getWithMetadata: vi.fn(),
      delete: vi.fn(),
      list: vi.fn()
    },
    executionCtx: {
      waitUntil: vi.fn()
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
    
    // Mock successful fetch response
    (global.fetch as any).mockResolvedValue(new Response('test', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '1024'
      }
    }));
  });

  it('should use cached presigned URL when available', async () => {
    // Set up mock for cached presigned URL
    const mockCachedEntry = {
      url: 'https://test-bucket.s3.amazonaws.com/video.mp4?X-Amz-Algorithm=CACHED',
      originalUrl: 'https://test-bucket.s3.amazonaws.com/video.mp4',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600 * 1000,
      path: 'video.mp4',
      storageType: 'remote',
      authType: 'aws-s3-presigned-url'
    };
    
    (presignedUrlCacheService.getPresignedUrl as any).mockResolvedValue(mockCachedEntry);
    
    // Create config with presigned URL enabled
    const config = {
      storage: {
        remoteUrl: 'https://test-bucket.s3.amazonaws.com',
        remoteAuth: {
          enabled: true,
          type: 'aws-s3-presigned-url',
          accessKeyVar: 'AWS_ACCESS_KEY',
          secretKeyVar: 'AWS_SECRET_KEY',
          region: 'us-east-1',
          expiresInSeconds: 3600
        }
      }
    };
    
    // Set AWS credentials in env
    const env = {
      ...mockEnv,
      AWS_ACCESS_KEY: 'test-access-key',
      AWS_SECRET_KEY: 'test-secret-key'
    };
    
    // Call fetchFromRemote
    const result = await fetchFromRemote('video.mp4', 'https://test-bucket.s3.amazonaws.com', config, env);
    
    // Verify it used the cached URL
    expect(presignedUrlCacheService.getPresignedUrl).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(mockCachedEntry.url, expect.anything());
    expect(result).not.toBeNull();
    expect(result?.sourceType).toBe('remote');
  });

  it('should generate and cache new presigned URL when no cached URL exists', async () => {
    // Set up mock for no cached URL
    (presignedUrlCacheService.getPresignedUrl as any).mockResolvedValue(null);
    
    // Create config with presigned URL enabled
    const config = {
      storage: {
        remoteUrl: 'https://test-bucket.s3.amazonaws.com',
        remoteAuth: {
          enabled: true,
          type: 'aws-s3-presigned-url',
          accessKeyVar: 'AWS_ACCESS_KEY',
          secretKeyVar: 'AWS_SECRET_KEY',
          region: 'us-east-1',
          expiresInSeconds: 3600
        }
      }
    };
    
    // Set AWS credentials in env
    const env = {
      ...mockEnv,
      AWS_ACCESS_KEY: 'test-access-key',
      AWS_SECRET_KEY: 'test-secret-key'
    };
    
    // Call fetchFromRemote
    const result = await fetchFromRemote('video.mp4', 'https://test-bucket.s3.amazonaws.com', config, env);
    
    // Verify it generated a new URL
    expect(presignedUrlCacheService.getPresignedUrl).toHaveBeenCalled();
    expect(presignedUrlCacheService.storePresignedUrl).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('?X-Amz-Algorithm=AWS4-HMAC-SHA256'),
      expect.anything()
    );
    expect(result).not.toBeNull();
    expect(result?.sourceType).toBe('remote');
  });
});