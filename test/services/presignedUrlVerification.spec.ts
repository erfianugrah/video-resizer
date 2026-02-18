import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyPresignedUrl } from '../../src/services/presignedUrlCacheService';

describe('Presigned URL Verification', () => {
  // Mock fetch
  global.fetch = vi.fn();
  const mockFetch = global.fetch as any;

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('verifyPresignedUrl', () => {
    it('should verify a valid URL with HEAD request', async () => {
      // Mock a successful fetch response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const url = 'https://test-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Signature=abc123';
      const result = await verifyPresignedUrl(url);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(url, {
        method: 'HEAD',
        redirect: 'manual',
      });
    });

    it('should handle redirect responses as valid', async () => {
      // Mock a redirect response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 302,
      });

      const url = 'https://test-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Signature=abc123';
      const result = await verifyPresignedUrl(url);

      expect(result).toBe(true);
    });

    it('should handle error responses as invalid', async () => {
      // Mock an error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const url = 'https://test-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Signature=abc123';
      const result = await verifyPresignedUrl(url);

      expect(result).toBe(false);
    });

    it('should handle fetch exceptions as invalid', async () => {
      // Mock a fetch error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const url = 'https://test-bucket.s3.amazonaws.com/videos/test.mp4?X-Amz-Signature=abc123';
      const result = await verifyPresignedUrl(url);

      expect(result).toBe(false);
    });
  });
});
