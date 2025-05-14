import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { storeTransformedVideoWithStreaming } from '../../../src/services/kvStorage/streamStorage';

// Mock all needed imports
vi.mock('../../../src/utils/errorHandlingUtils', () => ({
  withErrorHandling: vi.fn((fn, _, __) => fn),
  logErrorWithContext: vi.fn(),
  tryOrDefault: vi.fn((fn) => fn)
}));

vi.mock('../../../src/services/kvStorage/logging', () => ({
  logDebug: vi.fn()
}));

vi.mock('../../../src/config', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn().mockReturnValue({
      getConfig: vi.fn().mockReturnValue({
        storeIndefinitely: false
      })
    })
  }
}));

vi.mock('../../../src/services/videoStorage/cacheTags', () => ({
  generateCacheTags: vi.fn().mockReturnValue(['test:tag'])
}));

vi.mock('../../../src/services/kvStorage/keyUtils', () => ({
  generateKVKey: vi.fn((path, _) => `transformed:${path}`)
}));

vi.mock('../../../src/services/kvStorage/storageHelpers', () => ({
  createBaseMetadata: vi.fn((sourcePath, options, contentType, size, version, ttl) => ({
    sourcePath,
    contentType,
    size,
    version,
    ttl,
    isChunked: false
  })),
  storeWithRetry: vi.fn().mockResolvedValue(true),
  handleVersionStorage: vi.fn(),
  logStorageSuccess: vi.fn()
}));

describe('Streaming Storage', () => {
  // Common test variables
  const mockKVNamespace = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    getWithMetadata: vi.fn(),
    delete: vi.fn()
  } as unknown as KVNamespace;

  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store small videos in a single KV entry', async () => {
    // Create a small video content (10KB)
    const smallContent = new Uint8Array(10 * 1024).fill(1);
    
    // Create a response with the small content
    const response = new Response(smallContent, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': smallContent.length.toString()
      }
    });
    
    // Call the function with the small content
    const result = await storeTransformedVideoWithStreaming(
      mockKVNamespace,
      'videos/small.mp4',
      response,
      {
        width: 640,
        height: 480,
        format: 'mp4',
        env: {} as any
      },
      3600
    );
    
    // Verify the result is successful
    expect(result).toBe(true);
    
    // Verify storeWithRetry was called at least once
    const { storeWithRetry } = await import('../../../src/services/kvStorage/storageHelpers');
    expect(storeWithRetry).toHaveBeenCalled();
    
    // Verify logs indicate success
    const { logDebug } = await import('../../../src/services/kvStorage/logging');
    
    // Just check that the logs include a success message
    expect(logDebug).toHaveBeenCalledWith(
      '[STREAM_STORE] Successfully stored manifest and all chunks',
      expect.objectContaining({ 
        key: 'transformed:videos/small.mp4'
      })
    );
  });
  
  it('should chunk large videos across multiple KV entries', async () => {
    // Create response that simulates large content (25MB)
    // We're not actually creating a 25MB buffer in the test, just simulating it
    const contentLength = 25 * 1024 * 1024;
    const smallActualContent = new Uint8Array(1024).fill(1); // Small content for test
    
    // Mock the ReadableStream to provide multiple chunks
    const chunks = Array(25).fill(smallActualContent);
    let chunkIndex = 0;
    
    // Create a response with simulated large content
    const mockStream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < chunks.length) {
          controller.enqueue(chunks[chunkIndex++]);
        } else {
          controller.close();
        }
      }
    });
    
    const response = new Response(mockStream, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': contentLength.toString()
      }
    });
    
    // Call the function with the large content
    const result = await storeTransformedVideoWithStreaming(
      mockKVNamespace,
      'videos/large.mp4',
      response,
      {
        width: 1920,
        height: 1080,
        format: 'mp4',
        env: {} as any
      },
      3600
    );
    
    // Verify the result is successful
    expect(result).toBe(true);
    
    // Verify storeWithRetry was called at least once
    const { storeWithRetry } = await import('../../../src/services/kvStorage/storageHelpers');
    expect(storeWithRetry).toHaveBeenCalled();
    
    // Verify chunked storage metrics were logged
    const { logDebug } = await import('../../../src/services/kvStorage/logging');
    expect(logDebug).toHaveBeenCalledWith(
      expect.stringContaining('[STREAM_STORE]'),
      expect.stringContaining('Successfully stored manifest and all chunks'),
      expect.objectContaining({ 
        key: expect.stringContaining('transformed:videos/large.mp4'),
        chunkCount: expect.any(Number),
        totalSize: expect.any(Number)
      })
    );
  });
  
  it('should handle errors during streaming storage', async () => {
    // Create a small video content
    const content = new Uint8Array(1024).fill(1);
    
    // Create a response with the content
    const response = new Response(content, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': content.length.toString()
      }
    });
    
    // Mock storeWithRetry to fail
    const { storeWithRetry } = await import('../../../src/services/kvStorage/storageHelpers');
    vi.mocked(storeWithRetry).mockResolvedValueOnce(false);
    
    // Call the function
    const result = await storeTransformedVideoWithStreaming(
      mockKVNamespace,
      'videos/error.mp4',
      response,
      {
        width: 640,
        height: 480,
        format: 'mp4',
        env: {} as any
      },
      3600
    );
    
    // Verify the result is failure
    expect(result).toBe(false);
    
    // Verify error was logged
    const { logDebug } = await import('../../../src/services/kvStorage/logging');
    expect(logDebug).toHaveBeenCalledWith(
      'Response body is null',
      expect.objectContaining({ sourcePath: 'videos/null-body.mp4' })
    );
  });
  
  it('should handle responses with null body', async () => {
    // Create a response with null body
    const response = new Response();
    Object.defineProperty(response, 'body', { value: null });
    
    // Call the function
    const result = await storeTransformedVideoWithStreaming(
      mockKVNamespace,
      'videos/null-body.mp4',
      response,
      {
        width: 640,
        height: 480,
        format: 'mp4',
        env: {} as any
      },
      3600
    );
    
    // Verify the result is failure
    expect(result).toBe(false);
    
    // Verify null body was logged
    const { logDebug } = await import('../../../src/services/kvStorage/logging');
    expect(logDebug).toHaveBeenCalledWith(
      'Response body is null',
      expect.objectContaining({ sourcePath: 'videos/null-body.mp4' })
    );
  });
});