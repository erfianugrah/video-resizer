/**
 * Tests for range request handling with Cache API bypass
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleRangeRequestForInitialAccess } from '../../src/utils/httpUtils';

// Mock requestContext and pinoLogger since we need to import them dynamically
vi.mock('../../src/utils/requestContext', () => {
  return {
    getCurrentContext: vi.fn(() => ({ 
      requestId: '123',
      executionContext: { 
        waitUntil: vi.fn((promise) => promise) 
      } 
    })),
    addBreadcrumb: vi.fn(),
  };
});

vi.mock('../../src/utils/pinoLogger', () => {
  return {
    createLogger: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
});

describe('Range Request Handling with Cache API Bypass', () => {
  // Store original implementation of TransformStream
  let originalTransformStream: typeof TransformStream;
  let originalReadableStream: typeof ReadableStream;
  let originalWritableStream: typeof WritableStream;
  
  // Store original streaming capabilities
  beforeEach(() => {
    originalTransformStream = globalThis.TransformStream;
    originalReadableStream = globalThis.ReadableStream;
    originalWritableStream = globalThis.WritableStream;
    
    // Setup mock for caches API
    // @ts-ignore - Mocking the global caches object
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        put: vi.fn().mockResolvedValue(undefined),
        match: vi.fn().mockResolvedValue(null),
      }),
    };
  });
  
  // Restore original implementations
  afterEach(() => {
    globalThis.TransformStream = originalTransformStream;
    globalThis.ReadableStream = originalReadableStream;
    globalThis.WritableStream = originalWritableStream;
    
    vi.resetAllMocks();
  });
  
  it('should bypass Cache API for flagged responses without range requests', async () => {
    // Create a bypass-flagged response
    const bypassResponse = new Response('video content', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '1000',
        'Accept-Ranges': 'bytes',
        'X-Bypass-Cache-API': 'true',
      },
    });
    
    // Create a request without Range header
    const request = new Request('https://example.com/video.mp4');
    
    // Call the function
    const result = await handleRangeRequestForInitialAccess(bypassResponse, request);
    
    // Verify the response is returned directly without caching
    expect(result).toBe(bypassResponse);
    expect(globalThis.caches.open).not.toHaveBeenCalled();
  });
  
  it('should bypass Cache API for all fallback responses', async () => {
    // Create a fallback response
    const fallbackResponse = new Response('video content', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '1000',
        'Accept-Ranges': 'bytes',
        'X-Fallback-Applied': 'true',
      },
    });
    
    // Create a request without Range header
    const request = new Request('https://example.com/video.mp4');
    
    // Call the function
    const result = await handleRangeRequestForInitialAccess(fallbackResponse, request);
    
    // Verify the response is returned directly without caching
    expect(result).toBe(fallbackResponse);
    expect(globalThis.caches.open).not.toHaveBeenCalled();
  });
  
  it('should handle range requests for bypassed large videos', async () => {
    // Mock streams for testing
    const mockWriter = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    
    const mockWritable = {
      getWriter: vi.fn().mockReturnValue(mockWriter),
    };
    
    const mockReadable = {};
    
    // Setup TransformStream mock
    class MockTransformStream {
      readable: any;
      writable: any;
      
      constructor() {
        this.readable = mockReadable;
        this.writable = mockWritable;
      }
    }
    
    // Mock the global TransformStream
    const originalTransformStream = globalThis.TransformStream;
    globalThis.TransformStream = MockTransformStream as any;
    
    // Create a mock reader that returns chunks
    const mockRead = vi.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(1024) })
      .mockResolvedValueOnce({ done: true });
    
    const mockGetReader = vi.fn().mockReturnValue({
      read: mockRead
    });
    
    // Create a bypassed large video response with Content-Length
    const largeVideoResponse = new Response('large video content', {
      status: 200,
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '268435456', // 256 MiB
        'Accept-Ranges': 'bytes',
        'X-Video-Exceeds-256MiB': 'true',
        'X-Bypass-Cache-API': 'true',
      }),
    });
    
    // Mock the response.clone method
    largeVideoResponse.clone = vi.fn().mockReturnValue({
      body: {
        getReader: mockGetReader
      },
      headers: new Headers(largeVideoResponse.headers),
    });
    
    // Create a request with a Range header
    const request = new Request('https://example.com/large-video.mp4', {
      headers: new Headers({
        'Range': 'bytes=0-1023',
      }),
    });
    
    // Call the function
    const result = await handleRangeRequestForInitialAccess(largeVideoResponse, request);
    
    // Verify the response is a 206 Partial Content
    expect(result.status).toBe(206);
    expect(result.headers.get('Content-Range')).toBe('bytes 0-1023/268435456');
    expect(result.headers.get('Content-Length')).toBe('1024');
    expect(result.headers.get('X-Range-Handled-By')).toBe('Direct-Stream-Range-Handler');
    
    // Verify correct bypass headers are maintained
    expect(result.headers.get('X-Video-Exceeds-256MiB')).toBe('true');
    expect(result.headers.get('X-Range-Handled-By')).toBe('Direct-Stream-Range-Handler');
    
    // Verify we didn't use the Cache API
    expect(globalThis.caches.open).not.toHaveBeenCalled();
    
    // Clean up
    globalThis.TransformStream = originalTransformStream;
  });
});