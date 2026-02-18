/**
 * Unit tests for videoStorageService.ts
 *
 * Tests the authentication methods for remote and fallback storage URLs
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchVideo } from '../../src/services/videoStorageService';
import { EnvVariables } from '../../src/config/environmentConfig';

// Mock aws4fetch
vi.mock('aws4fetch', () => {
  return {
    AwsClient: class MockAwsClient {
      constructor(config: any) {
        // Store config for testing
        (this as any).config = config;
      }

      sign(
        request: Request,
        options?: { aws?: { signQuery?: boolean }; signQuery?: boolean; expiresIn?: number }
      ) {
        // If signQuery is true (either in options.aws or in options directly), return a URL with query params
        if (options?.aws?.signQuery || options?.signQuery) {
          const url = new URL(request.url);
          url.searchParams.append('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
          url.searchParams.append(
            'X-Amz-Credential',
            'AKIAIOSFODNN7EXAMPLE/20220505/us-east-1/s3/aws4_request'
          );
          url.searchParams.append('X-Amz-Date', '20220505T123456Z');
          url.searchParams.append('X-Amz-Expires', String(options?.expiresIn || 3600));
          url.searchParams.append('X-Amz-SignedHeaders', 'host');
          url.searchParams.append(
            'X-Amz-Signature',
            '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
          );

          return {
            url: url.toString(),
            headers: new Headers(),
          };
        }

        // Otherwise, return a signed request with headers
        const headers = new Headers();
        headers.set(
          'x-amz-content-sha256',
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        );
        headers.set('x-amz-date', '20220505T123456Z');
        headers.set(
          'authorization',
          'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20220505/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
        );

        return {
          url: request.url,
          headers: headers,
        };
      }
    },
  };
});

// Mock fetch
global.fetch = vi.fn();
const mockFetch = global.fetch as any;

// Required utilities for test
interface MutableStorageConfig {
  priority?: string[];
  r2?: { enabled?: boolean; bucketBinding?: string };
  remoteUrl?: string;
  fallbackUrl?: string;
  remoteAuth?: {
    enabled: boolean;
    type: string;
    accessKeyVar?: string;
    secretKeyVar?: string;
    region?: string;
    service?: string;
    expiresInSeconds?: number;
    sessionTokenVar?: string;
    headers?: Record<string, string>;
  };
  fallbackAuth?: {
    enabled: boolean;
    type: string;
    accessKeyVar?: string;
    secretKeyVar?: string;
    region?: string;
    service?: string;
    expiresInSeconds?: number;
    sessionTokenVar?: string;
    headers?: Record<string, string>;
  };
  auth?: {
    useOriginAuth?: boolean;
    securityLevel?: 'strict' | 'permissive';
    cacheTtl?: number;
  };
  fetchOptions?: {
    userAgent?: string;
    headers?: Record<string, string>;
  };
}

describe('videoStorageService', () => {
  // Setup test environment
  const mockEnv: EnvVariables = {
    MODE: 'dev',
    VIDEO_CONFIG: '{}',
    HEADERS_CONFIG: '{}',
    CACHE_CONFIG: '{}',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    AWS_SESSION_TOKEN: 'test-session-token',
    AWS_REGION: 'us-east-1',
    VIDEOS_BUCKET: undefined,
  };

  // Reset mocks between tests
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => {
      return new Response('Test video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '100',
        },
      });
    });
  });

  describe('AWS S3 Header Authentication', () => {
    it('should add AWS signature headers when configured for header auth', async () => {
      // Set up the config for header-based auth
      const config = {
        storage: {
          priority: ['remote'],
          remoteUrl: 'https://example-bucket.s3.amazonaws.com',
          remoteAuth: {
            enabled: true,
            type: 'aws-s3',
            accessKeyVar: 'AWS_ACCESS_KEY_ID',
            secretKeyVar: 'AWS_SECRET_ACCESS_KEY',
            region: 'us-east-1',
            service: 's3',
          },
          auth: {
            useOriginAuth: true,
            securityLevel: 'strict',
          },
        },
      };

      // Call the service
      await fetchVideo('test-video.mp4', config as any, mockEnv, undefined);

      // Verify that fetch was called with the expected headers
      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      const [url, options] = fetchCall;

      // Verify URL is the original one (not presigned)
      expect(url).toBe('https://example-bucket.s3.amazonaws.com/test-video.mp4');

      // Verify headers
      expect(options.headers).toBeDefined();
      expect(options.headers['x-amz-content-sha256']).toBeDefined();
      expect(options.headers['x-amz-date']).toBeDefined();
      expect(options.headers['authorization']).toBeDefined();
      expect(options.headers['authorization']).toContain('AWS4-HMAC-SHA256');
    });
  });

  describe('AWS S3 Presigned URL Authentication', () => {
    it('should generate presigned URL when configured for presigned URL auth', async () => {
      // Set up the config for presigned URL auth
      const config = {
        storage: {
          priority: ['remote'],
          remoteUrl: 'https://example-bucket.s3.amazonaws.com',
          remoteAuth: {
            enabled: true,
            type: 'aws-s3-presigned-url',
            accessKeyVar: 'AWS_ACCESS_KEY_ID',
            secretKeyVar: 'AWS_SECRET_ACCESS_KEY',
            region: 'us-east-1',
            service: 's3',
            expiresInSeconds: 900,
          },
        },
      };

      // Call the service
      await fetchVideo('test-video.mp4', config as any, mockEnv, undefined);

      // Verify that fetch was called with the expected presigned URL
      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      const [url, options] = fetchCall;

      // Verify URL contains presigned signature parameters
      expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(url).toContain('X-Amz-Credential=');
      expect(url).toContain('X-Amz-Date=');
      expect(url).toContain('X-Amz-Expires=900'); // Our custom expiration time
      expect(url).toContain('X-Amz-Signature=');

      // Verify no AWS auth headers are set (since we're using query params)
      expect(options.headers['authorization']).toBeUndefined();
      expect(options.headers['x-amz-date']).toBeUndefined();
    });

    it('should generate presigned URL for fallback storage when configured', async () => {
      // Set up the config for fallback with presigned URL auth
      const config = {
        storage: {
          priority: ['fallback'],
          fallbackUrl: 'https://example-bucket.s3.amazonaws.com',
          fallbackAuth: {
            enabled: true,
            type: 'aws-s3-presigned-url',
            accessKeyVar: 'AWS_ACCESS_KEY_ID',
            secretKeyVar: 'AWS_SECRET_ACCESS_KEY',
            region: 'us-east-1',
            service: 's3',
            expiresInSeconds: 1800, // 30 minutes
          },
        },
      };

      // Call the service
      await fetchVideo('test-video.mp4', config as any, mockEnv, undefined);

      // Verify that fetch was called with the expected presigned URL
      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      const [url, options] = fetchCall;

      // Verify URL contains presigned signature parameters
      expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(url).toContain('X-Amz-Credential=');
      expect(url).toContain('X-Amz-Date=');
      expect(url).toContain('X-Amz-Expires=1800'); // Our custom expiration time
      expect(url).toContain('X-Amz-Signature=');

      // Verify no AWS auth headers are set (since we're using query params)
      expect(options.headers['authorization']).toBeUndefined();
      expect(options.headers['x-amz-date']).toBeUndefined();
    });
  });
});
