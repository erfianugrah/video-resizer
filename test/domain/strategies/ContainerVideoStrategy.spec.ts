/**
 * Tests for ContainerVideoStrategy
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerVideoStrategy } from '../../../src/domain/strategies/ContainerVideoStrategy';
import { VideoConfigurationManager } from '../../../src/config';

describe('ContainerVideoStrategy', () => {
  let strategy: ContainerVideoStrategy;

  beforeEach(() => {
    VideoConfigurationManager.resetInstance();
    VideoConfigurationManager.getInstance();
    strategy = new ContainerVideoStrategy();
  });

  describe('prepareTransformParams', () => {
    const baseContext = {
      request: new Request('https://example.com/videos/test.mp4'),
      pathPattern: {} as any,
      url: new URL('https://example.com/videos/test.mp4'),
      path: '/videos/test.mp4',
      diagnosticsInfo: {} as any,
    };

    it('should produce params with width and height', () => {
      const params = strategy.prepareTransformParams({
        ...baseContext,
        options: { width: 1280, height: 720 },
      });

      expect(params.width).toBe(1280);
      expect(params.height).toBe(720);
      expect(params.mode).toBe('video');
      expect(params.quality).toBe('medium');
      expect(params.fit).toBe('contain');
      expect(params.format).toBe('mp4');
    });

    it('should default quality to medium and fit to contain', () => {
      const params = strategy.prepareTransformParams({
        ...baseContext,
        options: {},
      });

      expect(params.quality).toBe('medium');
      expect(params.fit).toBe('contain');
    });

    it('should pass through duration and time', () => {
      const params = strategy.prepareTransformParams({
        ...baseContext,
        options: { duration: '120s', time: '5s' },
      });

      expect(params.duration).toBe('120s');
      expect(params.time).toBe('5s');
    });

    it('should use provided quality and fit', () => {
      const params = strategy.prepareTransformParams({
        ...baseContext,
        options: { quality: 'high', fit: 'cover' },
      });

      expect(params.quality).toBe('high');
      expect(params.fit).toBe('cover');
    });

    it('should omit null/undefined width and height', () => {
      const params = strategy.prepareTransformParams({
        ...baseContext,
        options: { width: null, height: null },
      });

      expect(params.width).toBeUndefined();
      expect(params.height).toBeUndefined();
    });
  });

  describe('validateOptions', () => {
    it('should accept valid options', async () => {
      await expect(
        strategy.validateOptions({ width: 1280, height: 720, quality: 'high' })
      ).resolves.toBeUndefined();
    });

    it('should reject width below 10', async () => {
      await expect(strategy.validateOptions({ width: 5 })).rejects.toThrow();
    });

    it('should reject width above 2000', async () => {
      await expect(strategy.validateOptions({ width: 2500 })).rejects.toThrow();
    });

    it('should reject height below 10', async () => {
      await expect(strategy.validateOptions({ height: 3 })).rejects.toThrow();
    });

    it('should reject height above 2000', async () => {
      await expect(strategy.validateOptions({ height: 3000 })).rejects.toThrow();
    });

    it('should accept duration longer than 60s (no cdn-cgi limit)', async () => {
      // This is a key difference vs VideoStrategy which caps at 60s
      await expect(strategy.validateOptions({ duration: '300s' })).resolves.toBeUndefined();
    });

    it('should reject invalid duration format', async () => {
      await expect(strategy.validateOptions({ duration: 'notavalidtime' })).rejects.toThrow();
    });

    it('should reject invalid time format', async () => {
      await expect(strategy.validateOptions({ time: 'badtime' })).rejects.toThrow();
    });

    it('should accept valid time format', async () => {
      await expect(strategy.validateOptions({ time: '10s' })).resolves.toBeUndefined();
    });
  });

  describe('updateDiagnostics', () => {
    it('should set transformationType to container-ffmpeg', () => {
      const diagnosticsInfo: any = {};
      strategy.updateDiagnostics({
        request: new Request('https://example.com/test.mp4'),
        options: { quality: 'high', compression: 'medium' },
        pathPattern: {} as any,
        url: new URL('https://example.com/test.mp4'),
        path: '/test.mp4',
        diagnosticsInfo,
      });

      expect(diagnosticsInfo.transformationType).toBe('container-ffmpeg');
      expect(diagnosticsInfo.transformSource).toBe('container');
      expect(diagnosticsInfo.videoQuality).toBe('high');
      expect(diagnosticsInfo.videoCompression).toBe('medium');
    });
  });
});
