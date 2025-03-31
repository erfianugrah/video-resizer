import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRequestWithCaching } from '../../src/handlers/videoHandlerWithCache';
import { transformVideo } from '../../src/services/videoTransformationService';
import { MockKVNamespace } from '../kv-cache/setup';
import '../kv-cache/setup';

// Mock the video transformation service
vi.mock('../../src/services/videoTransformationService', () => ({
  transformVideo: vi.fn(async (_request, _options) => {
    return new Response('transformed video data', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '20',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  })
}));

// Mock the generateKVKey function since it might not be available in the mocked service
vi.mock('../../src/services/kvStorageService', () => ({
  generateKVKey: vi.fn((sourcePath, options) => {
    let key = `video:${sourcePath.replace(/^\/+/, '')}`;
    if (options.derivative) {
      key += `:derivative=${options.derivative}`;
    }
    if (options.width) {
      key += `:w=${options.width}`;
    }
    if (options.height) {
      key += `:h=${options.height}`;
    }
    return key;
  }),
  storeTransformedVideo: vi.fn().mockResolvedValue(true),
  getTransformedVideo: vi.fn(),
  listVariants: vi.fn()
}));

describe('Video Handler with KV Caching - Integration Test', () => {
  let mockKV: MockKVNamespace;
  let mockEnv: {
    VIDEO_TRANSFORMATIONS_CACHE: MockKVNamespace;
    executionCtx: {
      waitUntil: (promise: Promise<unknown>) => unknown;
    };
  };
  
  beforeEach(() => {
    mockKV = new MockKVNamespace();
    mockEnv = {
      VIDEO_TRANSFORMATIONS_CACHE: mockKV,
      executionCtx: {
        waitUntil: vi.fn((promise) => promise)
      }
    };
    
    vi.clearAllMocks();
  });
  
  // Helper to create a request with transformation options
  function createRequest(options?: Record<string, string>) {
    const url = new URL('https://example.com/videos/test.mp4');
    
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    
    return new Request(url.toString());
  }
  
  it('should transform video with options from URL parameters', async () => {
    const request = createRequest({
      derivative: 'mobile',
      width: '640',
      height: '360'
    });
    
    const response = await handleRequestWithCaching(request, mockEnv, mockEnv.executionCtx);
    
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('transformed video data');
    
    // Verify the transformation service was called with the correct options
    expect(transformVideo).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        derivative: 'mobile',
        width: 640,
        height: 360
      }),
      expect.anything(),
      expect.anything(),
      mockEnv
    );
  });
  
  it('should bypass cache when debug=true is present', async () => {
    const request = createRequest({
      derivative: 'mobile',
      debug: 'true'
    });
    
    const response = await handleRequestWithCaching(request, mockEnv, mockEnv.executionCtx);
    
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('transformed video data');
    
    // Verify the transformation service was called directly
    expect(transformVideo).toHaveBeenCalled();
  });
  
  it('should handle requests with multiple transformation parameters', async () => {
    const request = createRequest({
      quality: 'high',
      compression: 'low',
      width: '1280',
      height: '720',
      format: 'mp4',
      loop: 'true',
      autoplay: 'true',
      muted: 'true'
    });
    
    const response = await handleRequestWithCaching(request, mockEnv, mockEnv.executionCtx);
    
    expect(response.status).toBe(200);
    
    // Verify the transformation service was called with all parameters
    expect(transformVideo).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        quality: 'high',
        compression: 'low',
        width: 1280,
        height: 720,
        format: 'mp4',
        loop: true,
        autoplay: true,
        muted: true
      }),
      expect.anything(),
      expect.anything(),
      mockEnv
    );
  });
});