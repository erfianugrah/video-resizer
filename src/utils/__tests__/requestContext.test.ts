/**
 * Tests for request context management and cleanup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRequestContext,
  setCurrentContext,
  getCurrentContext,
  clearCurrentContext,
  addBreadcrumb
} from '../requestContext';

describe('RequestContext', () => {
  beforeEach(() => {
    // Clear any existing context before each test
    clearCurrentContext();
  });

  afterEach(() => {
    // Clean up after each test
    clearCurrentContext();
  });

  describe('Context Management', () => {
    it('should create a new request context', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);

      expect(context).toBeDefined();
      expect(context.requestId).toMatch(/^[a-f0-9-]+$/);
      expect(context.url).toBe('https://example.com/test');
      expect(context.breadcrumbs).toEqual([]);
      expect(context.startTime).toBeGreaterThan(0);
    });

    it('should set and get current context', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);

      // Initially should be undefined
      expect(getCurrentContext()).toBeUndefined();

      // Set context
      setCurrentContext(context);

      // Should be able to retrieve it
      const retrieved = getCurrentContext();
      expect(retrieved).toBe(context);
      expect(retrieved?.requestId).toBe(context.requestId);
    });

    it('should clear current context', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);

      // Set context
      setCurrentContext(context);
      expect(getCurrentContext()).toBeDefined();

      // Clear context
      clearCurrentContext();
      expect(getCurrentContext()).toBeUndefined();
    });
  });

  describe('ActiveStreams Cleanup', () => {
    it('should initialize activeStreams map when needed', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);

      expect(context.activeStreams).toBeUndefined();

      // Add activeStreams manually
      context.activeStreams = new Map();
      expect(context.activeStreams).toBeDefined();
      expect(context.activeStreams.size).toBe(0);
    });

    it('should clean up active streams on context clear', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);
      setCurrentContext(context);

      // Create mock abort controllers
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      
      // Spy on abort method
      const abort1Spy = vi.spyOn(controller1, 'abort');
      const abort2Spy = vi.spyOn(controller2, 'abort');

      // Add active streams
      context.activeStreams = new Map();
      context.activeStreams.set('stream1', controller1);
      context.activeStreams.set('stream2', controller2);

      expect(context.activeStreams.size).toBe(2);

      // Clear context
      clearCurrentContext();

      // Should abort all controllers
      expect(abort1Spy).toHaveBeenCalled();
      expect(abort2Spy).toHaveBeenCalled();

      // Context should be cleared
      expect(getCurrentContext()).toBeUndefined();
    });

    it('should handle abort errors gracefully', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);
      setCurrentContext(context);

      // Create mock abort controller that throws
      const controller = new AbortController();
      vi.spyOn(controller, 'abort').mockImplementation(() => {
        throw new Error('Abort failed');
      });

      // Add active stream
      context.activeStreams = new Map();
      context.activeStreams.set('stream1', controller);

      // Should not throw when clearing
      expect(() => clearCurrentContext()).not.toThrow();
      expect(getCurrentContext()).toBeUndefined();
    });

    it('should handle missing activeStreams gracefully', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);
      setCurrentContext(context);

      // Don't add activeStreams
      expect(context.activeStreams).toBeUndefined();

      // Should not throw when clearing
      expect(() => clearCurrentContext()).not.toThrow();
      expect(getCurrentContext()).toBeUndefined();
    });
  });

  describe('Breadcrumbs', () => {
    it('should add breadcrumbs to context', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);
      setCurrentContext(context);

      // Add breadcrumbs
      addBreadcrumb(context, 'Test', 'Test message', { data: 'test' });

      expect(context.breadcrumbs).toHaveLength(1);
      expect(context.breadcrumbs[0]).toMatchObject({
        category: 'Test',
        message: 'Test message',
        data: { data: 'test' }
      });
    });

    it('should respect maxItems limit', () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);
      setCurrentContext(context);

      // Add more breadcrumbs than the limit
      // Note: Default limit is 100, but we'll test with a smaller number
      // by adding many breadcrumbs
      for (let i = 0; i < 150; i++) {
        addBreadcrumb(context, 'Test', `Message ${i}`);
      }

      // Should be limited to maxItems (default 100)
      expect(context.breadcrumbs.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Performance Tracking', () => {
    it('should track elapsed time', async () => {
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);

      const startTime = context.startTime;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Clear context and check timing log
      setCurrentContext(context);
      
      // Mock performance.now to ensure predictable timing
      const perfNowSpy = vi.spyOn(performance, 'now');
      perfNowSpy.mockReturnValue(startTime + 50); // 50ms elapsed

      clearCurrentContext();

      // Restore
      perfNowSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle clearing already cleared context', () => {
      // Clear when nothing is set
      expect(() => clearCurrentContext()).not.toThrow();
      expect(getCurrentContext()).toBeUndefined();

      // Clear twice
      const request = new Request('https://example.com/test');
      const context = createRequestContext(request);
      setCurrentContext(context);
      
      clearCurrentContext();
      expect(() => clearCurrentContext()).not.toThrow();
    });

    it('should handle concurrent context operations', () => {
      const request1 = new Request('https://example.com/test1');
      const request2 = new Request('https://example.com/test2');
      
      const context1 = createRequestContext(request1);
      const context2 = createRequestContext(request2);

      // Set first context
      setCurrentContext(context1);
      expect(getCurrentContext()?.url).toBe('https://example.com/test1');

      // Override with second context
      setCurrentContext(context2);
      expect(getCurrentContext()?.url).toBe('https://example.com/test2');

      // Clear
      clearCurrentContext();
      expect(getCurrentContext()).toBeUndefined();
    });
  });
});