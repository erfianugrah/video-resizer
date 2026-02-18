/**
 * Integration test for the presigned URL integration with Cloudflare Media Transformation
 * Tests that presigned URLs are properly generated and included in CDN-CGI media URLs
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { buildCdnCgiMediaUrlAsync } from '../../src/utils/pathUtils';

// Mock presignedUrlUtils - this is dynamically imported inside pathUtils.ts
const mockNeedsPresigning = vi.fn().mockReturnValue(false);
const mockGetOrGeneratePresignedUrl = vi.fn();
const mockEncodePresignedUrl = vi.fn().mockImplementation((url: string) => url);

vi.mock('../../src/utils/presignedUrlUtils', () => ({
  needsPresigning: (...args: any[]) => mockNeedsPresigning(...args),
  getOrGeneratePresignedUrl: (...args: any[]) => mockGetOrGeneratePresignedUrl(...args),
  encodePresignedUrl: (...args: any[]) => mockEncodePresignedUrl(...args),
}));

// Mock AWS4Fetch for testing
vi.mock('aws4fetch', () => {
  return {
    AwsClient: class MockAwsClient {
      config: any;
      constructor(config: any) {
        // Store config for validation
        this.config = config;
      }

      // Mock sign method
      async sign(request: Request, options?: any): Promise<Request> {
        const url = new URL(request.url);

        // For query signing, modify the URL
        if (options?.aws?.signQuery) {
          // Add mock AWS query parameters to simulate a presigned URL
          url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
          url.searchParams.set('X-Amz-Credential', 'mock-key/20230101/us-east-1/s3/aws4_request');
          url.searchParams.set('X-Amz-Date', '20230101T000000Z');
          url.searchParams.set('X-Amz-Expires', options?.expiresIn?.toString() || '3600');
          url.searchParams.set('X-Amz-SignedHeaders', 'host');
          url.searchParams.set('X-Amz-Signature', 'mock-signature');

          // Return a new request with the signed URL
          return new Request(url.toString(), {
            method: request.method,
            headers: request.headers,
          });
        }

        // For header signing, add headers
        const headers = new Headers(request.headers);
        headers.set(
          'Authorization',
          'AWS4-HMAC-SHA256 Credential=mock-key/20230101/us-east-1/s3/aws4_request'
        );
        headers.set('X-Amz-Date', '20230101T000000Z');

        // Return a new request with the signed headers
        return new Request(request.url, {
          method: request.method,
          headers,
        });
      }
    },
  };
});

// Mock KV namespace
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  list: vi.fn(),
};

// Mock environment
const mockEnv = {
  PRESIGNED_URLS: mockKV,
  executionCtx: {
    waitUntil: vi.fn(),
  },
};

// Mock video config manager - using vi.mock directly rather than module import
// Define the storage config inside the mock to avoid hoisting issues
vi.mock('../../src/config/VideoConfigurationManager', () => {
  const mockStorageConfig = {
    remoteUrl: 'https://remote-bucket.s3.amazonaws.com',
    fallbackUrl: 'https://fallback-bucket.s3.amazonaws.com',
    remoteAuth: {
      type: 'aws-s3-presigned-url',
      region: 'us-east-1',
      service: 's3',
      accessKeyVar: 'AWS_ACCESS_KEY_ID',
      secretKeyVar: 'AWS_SECRET_ACCESS_KEY',
      expiresInSeconds: 3600,
    },
  };

  return {
    VideoConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getCdnCgiConfig: vi.fn().mockReturnValue({
          basePath: '/cdn-cgi/media',
        }),
        getConfig: vi.fn().mockReturnValue({
          storage: mockStorageConfig,
        }),
      }),
    },
  };
});

describe('Presigned URL Integration', () => {
  // Define mockStorageConfig within the test scope
  const mockStorageConfig = {
    remoteUrl: 'https://remote-bucket.s3.amazonaws.com',
    fallbackUrl: 'https://fallback-bucket.s3.amazonaws.com',
    remoteAuth: {
      type: 'aws-s3-presigned-url',
      region: 'us-east-1',
      service: 's3',
      accessKeyVar: 'AWS_ACCESS_KEY_ID',
      secretKeyVar: 'AWS_SECRET_ACCESS_KEY',
      expiresInSeconds: 3600,
    },
  };

  beforeEach(() => {
    // Reset mock functions
    mockNeedsPresigning.mockReset().mockReturnValue(false);
    mockGetOrGeneratePresignedUrl.mockReset();
    mockEncodePresignedUrl.mockReset().mockImplementation((url: string) => url);

    // Reset KV mock functions
    mockKV.get.mockReset();
    mockKV.put.mockReset();
    mockKV.list.mockReset().mockResolvedValue({ keys: [] });

    // Make the mocked environment available globally
    (globalThis as any).env = mockEnv;
  });

  afterEach(() => {
    // Clean up global environment
    delete (globalThis as any).env;
  });

  afterEach(() => {
    // Clean up global environment
    delete (globalThis as any).env;

    // Clear call counts without restoring mock implementations
    // vi.restoreAllMocks() would also restore vi.fn() mocks inside vi.mock factories
    mockNeedsPresigning.mockRestore();
    mockGetOrGeneratePresignedUrl.mockRestore();
    mockEncodePresignedUrl.mockRestore();
  });

  it('should generate presigned URL for AWS S3 private bucket', async () => {
    // Set up mocks for presignedUrlUtils
    mockNeedsPresigning.mockReturnValue(true);
    mockGetOrGeneratePresignedUrl.mockResolvedValue(
      'https://remote-bucket.s3.amazonaws.com/videos/sample.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=mock-key%2F20230101%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20230101T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=mock-signature'
    );

    // Set up transformation parameters
    const transformParams = {
      width: 640,
      height: 360,
      quality: 'auto',
    };

    // Create an S3 URL that would need presigning
    const originUrl = 'https://remote-bucket.s3.amazonaws.com/videos/sample.mp4';
    const requestUrl = 'https://video-transform.example.com/videos/sample.mp4';

    // Call the function under test - must pass env for presigning path to be taken
    const cdnCgiUrl = await buildCdnCgiMediaUrlAsync(
      transformParams,
      originUrl,
      requestUrl,
      mockEnv
    );

    // Verify the presignedUrlUtils functions were called
    expect(mockNeedsPresigning).toHaveBeenCalled();
    expect(mockGetOrGeneratePresignedUrl).toHaveBeenCalled();

    // Verify the CDN-CGI URL has the expected format with transformation parameters
    expect(cdnCgiUrl).toContain('/cdn-cgi/media/');
    expect(cdnCgiUrl).toContain('width=640');
    expect(cdnCgiUrl).toContain('height=360');
    expect(cdnCgiUrl).toContain('quality=auto');
  });

  it('should not presign URLs that do not need presigning', async () => {
    // Set up mocks for presignedUrlUtils
    mockNeedsPresigning.mockReturnValue(false);

    // Set up transformation parameters
    const transformParams = {
      width: 640,
      height: 360,
      quality: 'auto',
    };

    // Create a non-S3 URL that wouldn't need presigning
    const originUrl = 'https://videos.example.com/sample.mp4';
    const requestUrl = 'https://video-transform.example.com/videos/sample.mp4';

    // Call the function under test - pass env for the async presigning code path
    const cdnCgiUrl = await buildCdnCgiMediaUrlAsync(
      transformParams,
      originUrl,
      requestUrl,
      mockEnv
    );

    // For non-S3 URLs, the presigning code path may not be entered since
    // likelyNeedsPresigning checks for s3./amazonaws.com patterns.
    // The non-S3 URL won't trigger the async presigning path, so needsPresigning
    // won't be called. Instead, just verify the URL was built correctly.
    expect(mockGetOrGeneratePresignedUrl).not.toHaveBeenCalled();

    // Verify the CDN-CGI URL has the expected format without presigning
    expect(cdnCgiUrl).toContain('/cdn-cgi/media/');
    expect(cdnCgiUrl).toContain('width=640');
    expect(cdnCgiUrl).toContain('height=360');
    expect(cdnCgiUrl).toContain('quality=auto');
    expect(cdnCgiUrl).toContain('https://videos.example.com/sample.mp4');
  });

  it('should handle presigned URLs in transformation process', async () => {
    // Set up a sample presigned URL
    const presignedUrl =
      'https://remote-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test-key&X-Amz-Date=20230101T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=test-signature';

    // Set up mocks for presignedUrlUtils
    mockNeedsPresigning.mockReturnValue(true);
    mockGetOrGeneratePresignedUrl.mockResolvedValue(presignedUrl);

    // Set up transformation parameters
    const transformParams = {
      width: 854,
      height: 480,
      quality: 'auto',
    };

    // Create an S3 URL that would need presigning
    const originUrl = 'https://remote-bucket.s3.amazonaws.com/videos/test.mp4';
    const requestUrl = 'https://video-transform.example.com/videos/test.mp4';

    // Call the function under test - pass env for presigning path
    const cdnCgiUrl = await buildCdnCgiMediaUrlAsync(
      transformParams,
      originUrl,
      requestUrl,
      mockEnv
    );

    // Verify the CDN-CGI URL has the expected format
    expect(cdnCgiUrl).toContain('/cdn-cgi/media/');
    expect(cdnCgiUrl).toContain('width=854');
    expect(cdnCgiUrl).toContain('height=480');
    expect(cdnCgiUrl).toContain('quality=auto');

    // Verify our presigned URL processing was called
    expect(mockNeedsPresigning).toHaveBeenCalled();
    expect(mockGetOrGeneratePresignedUrl).toHaveBeenCalled();
    expect(mockEncodePresignedUrl).toHaveBeenCalled();
  });
});
