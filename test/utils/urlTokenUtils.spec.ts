import { describe, it, expect } from 'vitest';
import { extractAuthToken, reconstructPresignedUrl } from '../../src/utils/urlTokenUtils';

describe('urlTokenUtils', () => {
  describe('extractAuthToken', () => {
    it('should extract query parameters from a URL', () => {
      const url = 'https://example.com/path/to/file.mp4?param1=value1&param2=value2';
      const token = extractAuthToken(url);
      expect(token).toBe('?param1=value1&param2=value2');
    });

    it('should handle URLs without query parameters', () => {
      const url = 'https://example.com/path/to/file.mp4';
      const token = extractAuthToken(url);
      expect(token).toBe('');
    });

    it('should handle invalid URLs', () => {
      const url = 'not-a-url';
      const token = extractAuthToken(url);
      expect(token).toBe('');
    });

    it('should handle AWS presigned URLs', () => {
      const url = 'https://my-bucket.s3.amazonaws.com/videos/sample.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEY/20210101/region/s3/aws4_request&X-Amz-Date=20210101T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=abcdef123456';
      const token = extractAuthToken(url);
      expect(token).toBe('?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEY/20210101/region/s3/aws4_request&X-Amz-Date=20210101T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=abcdef123456');
    });
  });

  describe('reconstructPresignedUrl', () => {
    it('should combine base URL with auth token', () => {
      const baseUrl = 'https://example.com/path/to/file.mp4';
      const authToken = '?param1=value1&param2=value2';
      const reconstructed = reconstructPresignedUrl(baseUrl, authToken);
      expect(reconstructed).toBe('https://example.com/path/to/file.mp4?param1=value1&param2=value2');
    });

    it('should handle tokens without leading question mark', () => {
      const baseUrl = 'https://example.com/path/to/file.mp4';
      const authToken = 'param1=value1&param2=value2';
      const reconstructed = reconstructPresignedUrl(baseUrl, authToken);
      expect(reconstructed).toBe('https://example.com/path/to/file.mp4?param1=value1&param2=value2');
    });

    it('should handle base URLs with existing query parameters', () => {
      const baseUrl = 'https://example.com/path/to/file.mp4?existing=param';
      const authToken = '?param1=value1&param2=value2';
      const reconstructed = reconstructPresignedUrl(baseUrl, authToken);
      expect(reconstructed).toBe('https://example.com/path/to/file.mp4?param1=value1&param2=value2');
    });

    it('should handle empty auth tokens', () => {
      const baseUrl = 'https://example.com/path/to/file.mp4';
      const authToken = '';
      const reconstructed = reconstructPresignedUrl(baseUrl, authToken);
      expect(reconstructed).toBe('https://example.com/path/to/file.mp4');
    });
  });
});