/**
 * Tests for presignedUrlUtils.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  needsPresigning,
  getAuthConfig,
  getStorageType,
  extractPath,
  encodePresignedUrl
} from '../../src/utils/presignedUrlUtils';

// Mock config for testing
const mockStorageConfig = {
  remoteUrl: 'https://remote-bucket.s3.amazonaws.com',
  fallbackUrl: 'https://fallback-bucket.s3.amazonaws.com',
  remoteAuth: {
    type: 'aws-s3-presigned-url',
    region: 'us-east-1',
    service: 's3',
    accessKeyVar: 'AWS_ACCESS_KEY_ID',
    secretKeyVar: 'AWS_SECRET_ACCESS_KEY',
    expiresInSeconds: 3600
  },
  fallbackAuth: {
    type: 'aws-s3',
    region: 'us-west-2',
    service: 's3',
    accessKeyVar: 'AWS_ACCESS_KEY_ID',
    secretKeyVar: 'AWS_SECRET_ACCESS_KEY'
  }
};

describe('presignedUrlUtils', () => {
  describe('needsPresigning', () => {
    it('should identify URLs that need presigning', () => {
      // Remote URL with presigned URL auth type
      expect(needsPresigning('https://remote-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig)).toBe(true);
      
      // Fallback URL with non-presigned auth type
      expect(needsPresigning('https://fallback-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig)).toBe(false);
      
      // Non-configured URL
      expect(needsPresigning('https://other-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig)).toBe(false);
    });
    
    it('should handle undefined config', () => {
      expect(needsPresigning('https://remote-bucket.s3.amazonaws.com/video.mp4', undefined)).toBe(false);
    });
  });
  
  describe('getAuthConfig', () => {
    it('should return the correct auth config for a URL', () => {
      // Remote URL
      const remoteConfig = getAuthConfig('https://remote-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig);
      expect(remoteConfig).toEqual(mockStorageConfig.remoteAuth);
      
      // Fallback URL
      const fallbackConfig = getAuthConfig('https://fallback-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig);
      expect(fallbackConfig).toEqual(mockStorageConfig.fallbackAuth);
      
      // Non-configured URL
      const otherConfig = getAuthConfig('https://other-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig);
      expect(otherConfig).toBeNull();
    });
    
    it('should handle undefined config', () => {
      expect(getAuthConfig('https://remote-bucket.s3.amazonaws.com/video.mp4', undefined)).toBeNull();
    });
  });
  
  describe('getStorageType', () => {
    it('should return the correct storage type for a URL', () => {
      // Remote URL
      expect(getStorageType('https://remote-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig)).toBe('remote');
      
      // Fallback URL
      expect(getStorageType('https://fallback-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig)).toBe('fallback');
      
      // Non-configured URL
      expect(getStorageType('https://other-bucket.s3.amazonaws.com/video.mp4', mockStorageConfig)).toBeNull();
    });
    
    it('should handle undefined config', () => {
      expect(getStorageType('https://remote-bucket.s3.amazonaws.com/video.mp4', undefined)).toBeNull();
    });
  });
  
  describe('extractPath', () => {
    it('should extract the path from a URL relative to a base URL', () => {
      // Simple case
      expect(extractPath(
        'https://remote-bucket.s3.amazonaws.com/videos/test.mp4',
        'https://remote-bucket.s3.amazonaws.com'
      )).toBe('/videos/test.mp4');
      
      // With base path
      expect(extractPath(
        'https://remote-bucket.s3.amazonaws.com/base/videos/test.mp4',
        'https://remote-bucket.s3.amazonaws.com/base'
      )).toBe('/videos/test.mp4');
      
      // With query parameters
      expect(extractPath(
        'https://remote-bucket.s3.amazonaws.com/videos/test.mp4?param=value',
        'https://remote-bucket.s3.amazonaws.com'
      )).toBe('/videos/test.mp4');
    });
    
    it('should handle edge cases', () => {
      // Invalid URLs (testing string mode fallback)
      expect(extractPath(
        'remote-bucket/videos/test.mp4',
        'remote-bucket'
      )).toBe('/videos/test.mp4');
    });
  });
  
  describe('encodePresignedUrl', () => {
    it('should properly encode a presigned URL for inclusion in another URL', () => {
      // Test with a typical AWS presigned URL
      const presignedUrl = 'https://bucket.s3.amazonaws.com/file.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=key%2F20230101%2Fregion%2Fs3%2Faws4_request&X-Amz-Date=20230101T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=signature';
      
      const encodedUrl = encodePresignedUrl(presignedUrl);
      
      // The URL should still be valid
      expect(() => new URL(encodedUrl)).not.toThrow();
      
      // The encoded URL should have encoded the query parameters
      expect(encodedUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(encodedUrl).toContain('X-Amz-Credential=key%2F20230101%2Fregion%2Fs3%2Faws4_request');
      expect(encodedUrl).toContain('X-Amz-Signature=signature');
      
      // The base URL should remain unchanged
      expect(encodedUrl.startsWith('https://bucket.s3.amazonaws.com/file.mp4?')).toBe(true);
    });
    
    it('should handle URLs without query parameters', () => {
      const url = 'https://bucket.s3.amazonaws.com/file.mp4';
      expect(encodePresignedUrl(url)).toBe(url);
    });
  });
});