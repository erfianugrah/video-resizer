import { describe, it, expect, vi } from 'vitest';

// Simple implementation of the request coalescing pattern for testing
const inFlightRequests = new Map();

/**
 * Simplified function that showcases the request coalescing pattern
 */
async function getWithCoalescing(key, handler) {
  // Check if request is already in-flight
  let existingPromise = inFlightRequests.get(key);
  let isFirstRequest = false;
  
  if (!existingPromise) {
    isFirstRequest = true;
    
    // Create new promise for this request
    const promise = (async () => {
      try {
        // Execute handler
        return await handler();
      } finally {
        // Clean up after completion
        setTimeout(() => {
          inFlightRequests.delete(key);
        }, 50);
      }
    })();
    
    // Store promise in map
    inFlightRequests.set(key, promise);
    existingPromise = promise;
  }
  
  // Wait for request to complete
  const result = await existingPromise;
  
  // Create response with diagnostic info
  return {
    result,
    isFirstRequest,
    inFlightCount: inFlightRequests.size
  };
}

describe('Request Coalescing Pattern', () => {
  it('should only call handler once for multiple identical requests', async () => {
    // Create a slow handler
    const mockResult = { data: 'test data' };
    const handler = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return mockResult;
    });
    
    // Execute multiple requests in parallel
    const [response1, response2, response3] = await Promise.all([
      getWithCoalescing('test-key', handler),
      getWithCoalescing('test-key', handler),
      getWithCoalescing('test-key', handler)
    ]);
    
    // Verify handler was only called once
    expect(handler).toHaveBeenCalledTimes(1);
    
    // Verify all responses contain the result
    expect(response1.result).toEqual(mockResult);
    expect(response2.result).toEqual(mockResult);
    expect(response3.result).toEqual(mockResult);
    
    // First request should be marked as such
    expect(response1.isFirstRequest).toBe(true);
    
    // Other requests should not be first
    expect(response2.isFirstRequest).toBe(false);
    expect(response3.isFirstRequest).toBe(false);
    
    // Verify map is cleaned up after requests complete
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(inFlightRequests.size).toBe(0);
  });
  
  it('should correctly propagate errors to all coalesced requests', async () => {
    // Create a handler that throws
    const testError = new Error('Test error');
    const handler = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      throw testError;
    });
    
    // Execute multiple requests that should all fail with the same error
    const requests = [
      getWithCoalescing('error-key', handler),
      getWithCoalescing('error-key', handler),
      getWithCoalescing('error-key', handler)
    ];
    
    // All requests should reject with the same error
    for (const request of requests) {
      await expect(request).rejects.toThrow(testError);
    }
    
    // Handler should only be called once
    expect(handler).toHaveBeenCalledTimes(1);
    
    // Verify map is cleaned up after errors
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(inFlightRequests.size).toBe(0);
  });
  
  it('should handle different keys separately', async () => {
    // Create handlers for each key
    const handler1 = vi.fn().mockResolvedValue('result1');
    const handler2 = vi.fn().mockResolvedValue('result2');
    
    // Execute requests with different keys
    const [response1, response2] = await Promise.all([
      getWithCoalescing('key1', handler1),
      getWithCoalescing('key2', handler2)
    ]);
    
    // Both handlers should be called
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    
    // Results should be different
    expect(response1.result).toBe('result1');
    expect(response2.result).toBe('result2');
  });
});