import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as streamUtils from '../../src/utils/streamUtils';

describe('Stream Utils Integration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should properly export and implement required functions', () => {
    // Verify the exported functions exist
    expect(typeof streamUtils.handleRangeRequest).toBe('function');
    expect(typeof streamUtils.processRangeRequest).toBe('function');
  });

  it('should create a proper 206 response', async () => {
    // Create a mock response with a body
    const mockBody = new Uint8Array(1000).fill(42);
    const mockResponse = new Response(mockBody, {
      status: 200,
      headers: new Headers({
        'Content-Type': 'video/mp4',
        'Content-Length': '1000',
        'Accept-Ranges': 'bytes'
      })
    });

    // Create a spy on parseRangeHeader
    vi.spyOn(await import('../../src/utils/httpUtils'), 'parseRangeHeader')
      .mockImplementation(() => ({ 
        start: 0, 
        end: 499, 
        total: 1000 
      }));

    // Test the handleRangeRequest function directly
    const result = await streamUtils.handleRangeRequest(
      mockResponse,
      'bytes=0-499',
      {
        bypassCacheAPI: true,
        preserveHeaders: true,
        handlerTag: 'Test-Handler'
      }
    );

    // Verify the response is correct
    expect(result.status).toBe(206);
    expect(result.headers.get('Content-Range')).toBe('bytes 0-499/1000');
    expect(result.headers.get('Content-Length')).toBe('500');
    expect(result.headers.get('X-Range-Handled-By')).toBe('Test-Handler');
    expect(result.headers.get('X-Bypass-Cache-API')).toBe('true');
  });
});