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
    
    expect(tags).toContain('video-prod-path-test-video-mp4');
    expect(tags).toContain('video-prod-mode-video');
  });

  it('should generate derivative-specific cache tags', () => {
    const videoPath = '/test-video.mp4';
    const options: VideoOptions = {
      mode: 'video',
      derivative: 'mobile'
    };

    const tags = generateCacheTags(videoPath, options);
    
    expect(tags).toContain('video-prod-path-test-video-mp4');
    expect(tags).toContain('video-prod-derivative-mobile');
    expect(tags).toContain('video-prod-mode-video');
  });

  it('should generate combined path+derivative cache tags', () => {
    const videoPath = '/test-video.mp4';
    const options: VideoOptions = {
      mode: 'video',
      derivative: 'mobile'
    };

    const tags = generateCacheTags(videoPath, options);
    
    // Check for the new combined tag
    expect(tags).toContain('video-prod-path-test-video-mp4-derivative-mobile');
  });

  it('should generate combined tags for nested paths and different derivatives', () => {
    // Test with a nested path
    const nestedVideoPath = '/videos/category/nested-video.mp4';
    const tabletOptions: VideoOptions = {
      mode: 'video',
      derivative: 'tablet'
    };

    const nestedTags = generateCacheTags(nestedVideoPath, tabletOptions);
    
    // Check combined tag for nested path
    expect(nestedTags).toContain('video-prod-path-videos-category-nested-video-mp4-derivative-tablet');
    
    // Test with desktop derivative
    const desktopOptions: VideoOptions = {
      mode: 'video',
      derivative: 'desktop'
    };
    
    const desktopTags = generateCacheTags(nestedVideoPath, desktopOptions);
    
    // Check combined tag for desktop derivative
    expect(desktopTags).toContain('video-prod-path-videos-category-nested-video-mp4-derivative-desktop');
  });
});