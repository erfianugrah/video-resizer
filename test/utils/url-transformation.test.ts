import { describe, it, expect } from 'vitest';
import { buildOriginUrl } from '../../src/utils/urlTransformUtils';

describe('URL Transformation Query Parameter Handling', () => {
  it('should remove all transformation parameters from origin URL', () => {
    // Create a URL with various transformation parameters
    const originalUrl = new URL('https://example.com/video.mp4');
    originalUrl.searchParams.set('width', '640');
    originalUrl.searchParams.set('height', '480');
    originalUrl.searchParams.set('quality', 'high');
    originalUrl.searchParams.set('format', 'mp4');
    originalUrl.searchParams.set('loop', 'true');
    originalUrl.searchParams.set('autoplay', 'true');
    originalUrl.searchParams.set('muted', 'true');
    originalUrl.searchParams.set('preload', 'auto');
    originalUrl.searchParams.set('duration', '30');
    originalUrl.searchParams.set('mode', 'video');
    originalUrl.searchParams.set('fit', 'contain');
    originalUrl.searchParams.set('crop', '16:9');
    originalUrl.searchParams.set('rotate', '90');
    originalUrl.searchParams.set('imref', 'ref1');
    
    // Add IMQuery parameters
    originalUrl.searchParams.set('imwidth', '800');
    originalUrl.searchParams.set('imheight', '600');
    originalUrl.searchParams.set('im-viewwidth', '1024');
    originalUrl.searchParams.set('im-viewheight', '768');
    originalUrl.searchParams.set('im-density', '2.0');
    
    // Add a non-transformation parameter
    originalUrl.searchParams.set('tracking', 'abc123');
    
    // Transform the URL
    const transformedPath = '/path/to/video.mp4';
    const remoteOrigin = 'https://origin.example.com';
    const originUrl = buildOriginUrl(originalUrl, transformedPath, remoteOrigin);
    
    // Check that transformation parameters are removed
    expect(originUrl.searchParams.has('width')).toBe(false);
    expect(originUrl.searchParams.has('height')).toBe(false);
    expect(originUrl.searchParams.has('quality')).toBe(false);
    expect(originUrl.searchParams.has('format')).toBe(false);
    expect(originUrl.searchParams.has('loop')).toBe(false);
    expect(originUrl.searchParams.has('autoplay')).toBe(false);
    expect(originUrl.searchParams.has('muted')).toBe(false);
    expect(originUrl.searchParams.has('preload')).toBe(false);
    expect(originUrl.searchParams.has('duration')).toBe(false);
    expect(originUrl.searchParams.has('mode')).toBe(false);
    expect(originUrl.searchParams.has('fit')).toBe(false);
    expect(originUrl.searchParams.has('crop')).toBe(false);
    expect(originUrl.searchParams.has('rotate')).toBe(false);
    expect(originUrl.searchParams.has('imref')).toBe(false);
    
    // Check that IMQuery parameters are removed
    expect(originUrl.searchParams.has('imwidth')).toBe(false);
    expect(originUrl.searchParams.has('imheight')).toBe(false);
    expect(originUrl.searchParams.has('im-viewwidth')).toBe(false);
    expect(originUrl.searchParams.has('im-viewheight')).toBe(false);
    expect(originUrl.searchParams.has('im-density')).toBe(false);
    
    // Check that non-transformation parameters are preserved
    expect(originUrl.searchParams.has('tracking')).toBe(true);
    expect(originUrl.searchParams.get('tracking')).toBe('abc123');
  });
});