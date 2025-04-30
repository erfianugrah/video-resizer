import { expect, describe, it, vi, beforeEach } from 'vitest';
import { PathPattern } from '../../src/utils/pathUtils';
import * as presignedUrlUtils from '../../src/utils/presignedUrlUtils';

// Mock the required imports
vi.mock('../../src/config/VideoConfigurationManager', () => {
  const mockConfig = {
    pathPatterns: [
      {
        name: 'test-pattern',
        matcher: '/videos/(.*)',
        processPath: true,
        baseUrl: null,
        originUrl: 'https://example-bucket.s3.amazonaws.com/videos',
        auth: {
          type: 'aws-s3-presigned-url',
          region: 'us-east-1',
          service: 's3'
        }
      }
    ],
    storage: {
      remoteUrl: 'https://example-bucket.s3.amazonaws.com',
      remoteAuth: {
        type: 'aws-s3-presigned-url',
        region: 'us-east-1'
      }
    }
  };

  return {
    VideoConfigurationManager: {
      getInstance: vi.fn(() => ({
        getConfig: vi.fn(() => mockConfig),
      }))
    }
  };
});

vi.mock('aws4fetch', () => {
  return {
    AwsClient: class MockAwsClient {
      constructor() {}
      async sign(request: Request) {
        // Return a mock signed URL
        return new Request(request.url + '?X-Amz-Signature=test', request);
      }
    }
  };
});

vi.mock('../../src/services/presignedUrlCacheService', () => {
  return {
    getPresignedUrl: vi.fn().mockResolvedValue(null),
    storePresignedUrl: vi.fn().mockResolvedValue(undefined)
  };
});

describe('PresignedUrlUtils with Pattern Context', () => {
  const mockEnv = {
    PRESIGNED_URLS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined)
    },
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret'
  };

  const storageConfig = {
    remoteUrl: 'https://example-bucket.s3.amazonaws.com',
    remoteAuth: {
      type: 'aws-s3-presigned-url',
      region: 'us-east-1'
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should correctly detect presigning needs using pattern context', () => {
    // Test URL
    const originUrl = 'https://example-bucket.s3.amazonaws.com/videos/test-video.mp4';
    
    // Pattern context that requires presigning
    const patternContext: presignedUrlUtils.PresigningPatternContext = {
      name: 'test-pattern',
      originUrl: 'https://example-bucket.s3.amazonaws.com/videos',
      auth: {
        type: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3'
      }
    };

    // Check with pattern context
    const needsPresigningWithContext = presignedUrlUtils.needsPresigning(
      originUrl, 
      storageConfig, 
      patternContext
    );
    
    expect(needsPresigningWithContext).toBe(true);
  });

  it('should extract the correct path using pattern context', () => {
    // Test URL
    const originUrl = 'https://example-bucket.s3.amazonaws.com/videos/test-video.mp4';
    
    // With pattern context pointing to /videos
    const patternContext: presignedUrlUtils.PresigningPatternContext = {
      name: 'test-pattern',
      originUrl: 'https://example-bucket.s3.amazonaws.com/videos',
      auth: {
        type: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3'
      }
    };
    
    // Using the extractPath function directly
    const path = presignedUrlUtils.extractPath(originUrl, patternContext.originUrl!);
    
    // Should extract just /test-video.mp4 (without /videos/)
    expect(path).toBe('/test-video.mp4');
  });

  it('should use pattern-specific auth config', () => {
    // Test URL
    const originUrl = 'https://example-bucket.s3.amazonaws.com/videos/test-video.mp4';
    
    // Pattern context with specific auth config
    const patternContext: presignedUrlUtils.PresigningPatternContext = {
      name: 'test-pattern',
      originUrl: 'https://example-bucket.s3.amazonaws.com/videos',
      auth: {
        type: 'aws-s3-presigned-url',
        region: 'us-west-2', // Different region than default
        service: 's3'
      }
    };
    
    // Get auth config using pattern context
    const authConfig = presignedUrlUtils.getAuthConfig(
      originUrl, 
      storageConfig, 
      patternContext
    );
    
    // Should use the pattern's auth config
    expect(authConfig).toBeDefined();
    expect(authConfig?.region).toBe('us-west-2'); // Should be the pattern's region
  });
});