import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCacheTags } from '../../../src/services/videoStorage/cacheTags';
import { CacheConfigurationManager } from '../../../src/config';
import { VideoOptions } from '../../../src/services/videoStorage/interfaces';

describe('Cache Tags Generation', () => {
  beforeEach(() => {
    // Mock the CacheConfigurationManager
    vi.mock('../../../src/config', () => ({
      CacheConfigurationManager: {
        getInstance: vi.fn().mockReturnValue({
          getConfig: vi.fn().mockReturnValue({
            enableCacheTags: true,
            cacheTagPrefix: 'video-prod-'
          })
        })
      }
    }));
  });

  it('should generate basic cache tags for a video path', () => {
    const videoPath = '/test-video.mp4';
    const options: VideoOptions = {
      mode: 'video'
    };

    const tags = generateCacheTags(videoPath, options);
    
    // Should contain shortened path tag (last 2 segments)
    expect(tags).toContain('vp-p-test-video.mp4');
  });

  it('should generate derivative-specific cache tags', () => {
    const videoPath = '/test-video.mp4';
    const options: VideoOptions = {
      mode: 'video',
      derivative: 'mobile'
    };

    const tags = generateCacheTags(videoPath, options);
    
    // Should contain path tag, path+derivative tag, and derivative tag
    expect(tags).toContain('vp-p-test-video.mp4');
    expect(tags).toContain('vp-p-test-video.mp4-mobile');
    expect(tags).toContain('vp-d-mobile');
  });

  it('should generate format-specific cache tags', () => {
    const videoPath = '/test-video.mp4';
    const options: VideoOptions = {
      mode: 'video',
      format: 'webm'
    };

    const tags = generateCacheTags(videoPath, options);
    
    // Should contain format tag for migration scenarios
    expect(tags).toContain('vp-f-webm');
  });

  it('should generate tags for nested paths using last 2 segments', () => {
    // Test with a nested path
    const nestedVideoPath = '/videos/category/nested-video.mp4';
    const tabletOptions: VideoOptions = {
      mode: 'video',
      derivative: 'tablet'
    };

    const nestedTags = generateCacheTags(nestedVideoPath, tabletOptions);
    
    // Should use last 2 segments: category-nested-video.mp4
    expect(nestedTags).toContain('vp-p-category-nested-video.mp4');
    expect(nestedTags).toContain('vp-p-category-nested-video.mp4-tablet');
    expect(nestedTags).toContain('vp-d-tablet');
    
    // Test with desktop derivative
    const desktopOptions: VideoOptions = {
      mode: 'video',
      derivative: 'desktop'
    };
    
    const desktopTags = generateCacheTags(nestedVideoPath, desktopOptions);
    
    // Should use same path segments but different derivative
    expect(desktopTags).toContain('vp-p-category-nested-video.mp4');
    expect(desktopTags).toContain('vp-p-category-nested-video.mp4-desktop');
    expect(desktopTags).toContain('vp-d-desktop');
  });

  it('should generate mode-specific tags for non-video modes', () => {
    const videoPath = '/test-video.mp4';
    
    // Test frame mode
    const frameOptions: VideoOptions = {
      mode: 'frame',
      time: '5s'
    };
    
    const frameTags = generateCacheTags(videoPath, frameOptions);
    expect(frameTags).toContain('vp-m-frame');
    expect(frameTags).toContain('vp-t-5');
    
    // Test spritesheet mode
    const spritesheetOptions: VideoOptions = {
      mode: 'spritesheet',
      columns: 4,
      rows: 4,
      interval: '2s'
    };
    
    const spriteTags = generateCacheTags(videoPath, spritesheetOptions);
    expect(spriteTags).toContain('vp-m-spritesheet');
    expect(spriteTags).toContain('vp-c-4');
    expect(spriteTags).toContain('vp-r-4');
    expect(spriteTags).toContain('vp-i-2');
  });
});