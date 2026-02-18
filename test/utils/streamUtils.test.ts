import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processRangeRequest, handleRangeRequest } from '../../src/utils/streamUtils';

const mockContext = {
  requestId: 'test-request-id',
  startTime: Date.now(),
  diagnostics: {},
  debugEnabled: true,
  executionContext: {
    waitUntil: vi.fn(),
  },
};

// Mock the logger and request context
vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/utils/requestContext', () => ({
  addBreadcrumb: vi.fn(),
  getCurrentContext: vi.fn(() => mockContext),
}));

vi.mock('../../src/utils/errorHandlingUtils', async () => {
  const actual = await vi.importActual('../../src/utils/errorHandlingUtils');
  return {
    ...actual,
    logErrorWithContext: vi.fn(),
  };
});

describe('streamUtils', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('processRangeRequest', () => {
    it('should process a range request correctly', async () => {
      // Create a mock response with a body
      const mockBody = new Uint8Array(1000).fill(42); // Fill with the number 42
      const mockResponse = new Response(mockBody, {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
          'Accept-Ranges': 'bytes',
        }),
      });

      // Process a range request for bytes 100-299
      const result = await processRangeRequest(mockResponse, 100, 299, 1000, {
        preserveHeaders: true,
        handlerTag: 'Test-Handler',
      });

      // Verify the response
      expect(result.status).toBe(206);
      expect(result.headers.get('Content-Range')).toBe('bytes 100-299/1000');
      expect(result.headers.get('Content-Length')).toBe('200');
      expect(result.headers.get('Accept-Ranges')).toBe('bytes');
      expect(result.headers.get('X-Range-Handled-By')).toBe('Test-Handler');

      // Verify the body
      const resultBody = await result.arrayBuffer();
      expect(resultBody.byteLength).toBe(200);

      // All bytes should be 42 (our mock content)
      const resultArray = new Uint8Array(resultBody);
      expect(resultArray.every((byte) => byte === 42)).toBe(true);
    });

    it('should handle bypass flags correctly', async () => {
      // Create a mock response with a body
      const mockBody = new Uint8Array(1000).fill(42);
      const mockResponse = new Response(mockBody, {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
          'Accept-Ranges': 'bytes',
        }),
      });

      // Process a range request with bypass flags
      const result = await processRangeRequest(mockResponse, 0, 499, 1000, {
        bypassCacheAPI: true,
        fallbackApplied: true,
        preserveHeaders: true,
      });

      // Verify the bypass flags
      expect(result.headers.get('X-Bypass-Cache-API')).toBe('true');
      expect(result.headers.get('X-Direct-Stream-Only')).toBe('true');
      expect(result.headers.get('X-Cache-API-Bypass')).toBe('true');
      expect(result.headers.get('X-Fallback-Applied')).toBe('true');
    });

    it('should handle errors gracefully', async () => {
      // Create a mock response that will throw an error when reading
      const mockResponse = new Response(null, {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
        }),
      });

      // Create a spy to verify error handling
      const { logErrorWithContext } = await import('../../src/utils/errorHandlingUtils');

      // Process the range request
      const result = await processRangeRequest(mockResponse, 0, 499, 1000);

      // Should return the original response on error
      expect(result).toBe(mockResponse);
      expect(logErrorWithContext).toHaveBeenCalled();
    });
  });

  describe('handleRangeRequest', () => {
    it('should parse a range header and process the request', async () => {
      // Create a mock response
      const mockBody = new Uint8Array(1000).fill(42);
      const mockResponse = new Response(mockBody, {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '1000',
          'Accept-Ranges': 'bytes',
        }),
      });

      // Mock parseRangeHeader directly
      vi.spyOn(await import('../../src/utils/httpUtils'), 'parseRangeHeader').mockImplementation(
        () => ({
          start: 200,
          end: 699,
          total: 1000,
        })
      );

      // Handle a range request
      const result = await handleRangeRequest(mockResponse, 'bytes=200-699', {
        bypassCacheAPI: true,
        handlerTag: 'Test-Handler',
      });

      // Verify the response
      expect(result.status).toBe(206);
      expect(result.headers.get('Content-Range')).toBe('bytes 200-699/1000');
      expect(result.headers.get('Content-Length')).toBe('500');
      expect(result.headers.get('X-Range-Handled-By')).toBe('Test-Handler');
    });

    it('should return the original response if no range header', async () => {
      const mockResponse = new Response('test', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '4',
        }),
      });

      const result = await handleRangeRequest(mockResponse, null);
      expect(result).toBe(mockResponse);
    });

    it('should return 416 for unsatisfiable range', async () => {
      const mockResponse = new Response('test', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '4',
        }),
      });

      // Mock parseRangeHeader to return null (unsatisfiable)
      vi.mock('../../src/utils/httpUtils', async () => {
        const actual = await vi.importActual('../../src/utils/httpUtils');
        return {
          ...actual,
          parseRangeHeader: vi.fn().mockReturnValue(null),
        };
      });

      const result = await handleRangeRequest(mockResponse, 'bytes=10-20');
      expect(result.status).toBe(416);
      expect(result.headers.get('Content-Range')).toBe('bytes */4');
    });

    it('should handle invalid content length', async () => {
      const mockResponse = new Response('test', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          // No Content-Length header
        }),
      });

      const result = await handleRangeRequest(mockResponse, 'bytes=0-3');
      expect(result).toBe(mockResponse);
    });
  });
});
