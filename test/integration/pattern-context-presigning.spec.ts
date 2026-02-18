import { expect, describe, it, beforeEach, vi, afterEach } from 'vitest';
import { buildCdnCgiMediaUrlAsync } from '../../src/utils/pathUtils';
import {
  getOrGeneratePresignedUrl,
  needsPresigning,
  PresigningPatternContext,
} from '../../src/utils/presignedUrlUtils';
import { PathPattern } from '../../src/utils/pathUtils';
import { VideoConfigurationManager } from '../../src/config/VideoConfigurationManager';

// Mock the VideoConfigurationManager
vi.mock('../../src/config/VideoConfigurationManager', () => {
  const mockInstance = {
    getConfig: vi.fn().mockReturnValue({
      pathPatterns: [],
      storage: {
        remoteUrl: 'https://example-bucket.s3.amazonaws.com',
        remoteAuth: {
          type: 'aws-s3-presigned-url',
          region: 'us-east-1',
        },
      },
    }),
    getCdnCgiConfig: vi.fn().mockReturnValue({
      basePath: '/cdn-cgi/transform/video',
    }),
  };

  return {
    VideoConfigurationManager: {
      getInstance: vi.fn().mockReturnValue(mockInstance),
    },
  };
});

// Mock aws4fetch
vi.mock('aws4fetch', () => {
  return {
    AwsClient: class MockAwsClient {
      constructor() {}
      async sign(request: Request, options: any) {
        // Return a mock signed URL with query parameters that look like AWS signatures
        const url =
          request.url +
          '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Date=20230101T000000Z&X-Amz-Expires=3600&X-Amz-Signature=abcdef123456&X-Amz-SignedHeaders=host';
        return new Request(url, request);
      }
    },
  };
});

// Mock the KV namespace for presigned URLs
const mockKV = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
};

describe('Pattern Context Presigning Integration', () => {
  // Environment variables for testing
  const mockEnv = {
    PRESIGNED_URLS: mockKV as any,
    AWS_ACCESS_KEY_ID: 'test-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should correctly use pattern context for path extraction', async () => {
    // Test URL with a prefix that needs to be handled via pattern context
    const originUrl = 'https://example-bucket.s3.amazonaws.com/videos/test-video.mp4';

    // Pattern with a specific originUrl that has a path prefix
    const testPattern: PathPattern = {
      name: 'test-pattern',
      matcher: '/videos/(.*)',
      processPath: true,
      baseUrl: null,
      originUrl: 'https://example-bucket.s3.amazonaws.com/videos',
      auth: {
        type: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
      },
    };

    // Create transformation parameters
    const transformParams = {
      width: 640,
      height: 360,
      format: 'mp4',
    };

    // Call buildCdnCgiMediaUrlAsync with pattern context
    const result = await buildCdnCgiMediaUrlAsync(
      transformParams,
      originUrl,
      'https://example.com/videos/test-video.mp4',
      mockEnv,
      testPattern
    );

    // Verify the result contains the CDN-CGI base path and transformation params
    expect(result).toContain('/cdn-cgi/transform/video/');
    expect(result).toContain('width=640,height=360,format=mp4');
    // The presigned URL should contain AWS signature parameters
    expect(result).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
  });

  it('should correctly detect presigning needs using pattern context', () => {
    // Test URL
    const originUrl = 'https://example-bucket.s3.amazonaws.com/videos/test-video.mp4';

    // Storage config
    const storageConfig = {
      remoteUrl: 'https://example-bucket.s3.amazonaws.com',
      remoteAuth: {
        type: 'basic-auth', // Not a presigned URL type
      },
    };

    // Pattern context that requires presigning
    const patternContext: PresigningPatternContext = {
      name: 'test-pattern',
      originUrl: 'https://example-bucket.s3.amazonaws.com/videos',
      auth: {
        type: 'aws-s3-presigned-url',
        region: 'us-east-1',
        service: 's3',
      },
    };

    // Check with pattern context
    const needsPresigningWithContext = needsPresigning(originUrl, storageConfig, patternContext);
    expect(needsPresigningWithContext).toBe(true);

    // Check without pattern context - should fall back to config
    const needsPresigningWithoutContext = needsPresigning(originUrl, storageConfig);
    expect(needsPresigningWithoutContext).toBe(false); // Should be false because remoteAuth is not aws-s3-presigned-url
  });
});
