/**
 * Tests for containerTransformService
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildContainerInstanceKey,
  transformViaContainer,
} from '../../src/services/containerTransformService';
import { VideoConfigurationManager } from '../../src/config';

describe('containerTransformService', () => {
  beforeEach(() => {
    VideoConfigurationManager.resetInstance();
    VideoConfigurationManager.getInstance();
  });

  describe('buildContainerInstanceKey', () => {
    it('should build a stable key from origin name and path', () => {
      const key = buildContainerInstanceKey('videos', '/videos/hero.mp4');
      expect(key).toBe('ffmpeg:videos:/videos/hero.mp4');
    });

    it('should produce different keys for different paths', () => {
      const key1 = buildContainerInstanceKey('videos', '/videos/a.mp4');
      const key2 = buildContainerInstanceKey('videos', '/videos/b.mp4');
      expect(key1).not.toBe(key2);
    });

    it('should produce different keys for different origins', () => {
      const key1 = buildContainerInstanceKey('videos', '/test.mp4');
      const key2 = buildContainerInstanceKey('shorts', '/test.mp4');
      expect(key1).not.toBe(key2);
    });
  });

  describe('transformViaContainer', () => {
    it('should reject inputs exceeding maxInputSize', async () => {
      const mockBinding = {
        getByName: vi.fn(),
        idFromName: vi.fn(),
        get: vi.fn(),
      };

      const result = await transformViaContainer({
        request: new Request('https://example.com/test.mp4'),
        sourceUrl: 'https://storage.example.com/test.mp4',
        videoOptions: { width: 1280, height: 720 },
        containerBinding: mockBinding as any,
        instanceKey: 'ffmpeg:test:/test.mp4',
        inputSizeBytes: 7 * 1024 * 1024 * 1024, // 7 GiB — exceeds 6 GiB default
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds container limit');
      expect(result.shouldCacheInKV).toBe(false);
      // Should NOT have called the container
      expect(mockBinding.getByName).not.toHaveBeenCalled();
    });

    it('should return success false on validation error', async () => {
      const mockBinding = {
        getByName: vi.fn(),
        idFromName: vi.fn(),
        get: vi.fn(),
      };

      const result = await transformViaContainer({
        request: new Request('https://example.com/test.mp4'),
        sourceUrl: 'https://storage.example.com/test.mp4',
        videoOptions: { width: 5 }, // Invalid — below 10
        containerBinding: mockBinding as any,
        instanceKey: 'ffmpeg:test:/test.mp4',
        inputSizeBytes: 200 * 1024 * 1024,
      });

      expect(result.success).toBe(false);
      expect(result.shouldCacheInKV).toBe(false);
      expect(mockBinding.getByName).not.toHaveBeenCalled();
    });

    it('should handle container returning non-200', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValue(new Response('Internal error', { status: 500 })),
      };
      const mockBinding = {
        getByName: vi.fn().mockReturnValue(mockStub),
        idFromName: vi.fn(),
        get: vi.fn(),
      };

      const result = await transformViaContainer({
        request: new Request('https://example.com/test.mp4'),
        sourceUrl: 'https://storage.example.com/test.mp4',
        videoOptions: { width: 1280, height: 720 },
        containerBinding: mockBinding as any,
        instanceKey: 'ffmpeg:test:/test.mp4',
        inputSizeBytes: 200 * 1024 * 1024,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
      expect(result.durationMs).toBeDefined();
      expect(result.shouldCacheInKV).toBe(false);
    });

    it('should return success with response on 200', async () => {
      const mockResponse = new Response('fake-video-data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '500000',
        },
      });
      const mockStub = {
        fetch: vi.fn().mockResolvedValue(mockResponse),
      };
      const mockBinding = {
        getByName: vi.fn().mockReturnValue(mockStub),
        idFromName: vi.fn(),
        get: vi.fn(),
      };

      const result = await transformViaContainer({
        request: new Request('https://example.com/test.mp4'),
        sourceUrl: 'https://storage.example.com/test.mp4',
        videoOptions: { width: 1280, height: 720 },
        containerBinding: mockBinding as any,
        instanceKey: 'ffmpeg:test:/test.mp4',
        inputSizeBytes: 200 * 1024 * 1024,
      });

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.shouldCacheInKV).toBe(true);
      expect(result.durationMs).toBeDefined();
    });

    it('should flag shouldCacheInKV false when output exceeds limit', async () => {
      const mockResponse = new Response('fake-video-data', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(3 * 1024 * 1024 * 1024), // 3 GiB — exceeds 2 GiB default
        },
      });
      const mockStub = {
        fetch: vi.fn().mockResolvedValue(mockResponse),
      };
      const mockBinding = {
        getByName: vi.fn().mockReturnValue(mockStub),
        idFromName: vi.fn(),
        get: vi.fn(),
      };

      const result = await transformViaContainer({
        request: new Request('https://example.com/test.mp4'),
        sourceUrl: 'https://storage.example.com/test.mp4',
        videoOptions: { width: 1280, height: 720 },
        containerBinding: mockBinding as any,
        instanceKey: 'ffmpeg:test:/test.mp4',
        inputSizeBytes: 5 * 1024 * 1024 * 1024,
      });

      expect(result.success).toBe(true);
      expect(result.shouldCacheInKV).toBe(false);
    });

    it('should handle network errors gracefully', async () => {
      const mockStub = {
        fetch: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };
      const mockBinding = {
        getByName: vi.fn().mockReturnValue(mockStub),
        idFromName: vi.fn(),
        get: vi.fn(),
      };

      const result = await transformViaContainer({
        request: new Request('https://example.com/test.mp4'),
        sourceUrl: 'https://storage.example.com/test.mp4',
        videoOptions: { width: 1280, height: 720 },
        containerBinding: mockBinding as any,
        instanceKey: 'ffmpeg:test:/test.mp4',
        inputSizeBytes: 200 * 1024 * 1024,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
      expect(result.shouldCacheInKV).toBe(false);
    });
  });
});
