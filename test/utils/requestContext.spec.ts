import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequestContext, addBreadcrumb, getPerformanceMetrics } from '../../src/utils/requestContext';

describe('RequestContext', () => {
  // Mock performance.now() for consistent test results
  beforeEach(() => {
    let time = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      time += 10;  // Increment by 10 each call
      return time;
    });
  });

  it('should create a request context with the correct structure', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    
    expect(context.requestId).toBeDefined();
    expect(context.url).toEqual('https://example.com/video.mp4');
    expect(context.startTime).toBeGreaterThan(0);
    expect(context.breadcrumbs).toEqual([]);
    expect(context.diagnostics).toBeDefined();
    expect(context.componentTiming).toEqual({});
  });
  
  it('should set debug flags based on URL parameters', () => {
    const debugRequest = new Request('https://example.com/video.mp4?debug=true');
    const context = createRequestContext(debugRequest);
    
    expect(context.debugEnabled).toBe(true);
    expect(context.verboseEnabled).toBe(false);
    
    const verboseRequest = new Request('https://example.com/video.mp4?debug=verbose');
    const verboseContext = createRequestContext(verboseRequest);
    
    expect(verboseContext.debugEnabled).toBe(true);
    expect(verboseContext.verboseEnabled).toBe(true);
  });
  
  it('should add breadcrumbs correctly', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    
    const breadcrumb1 = addBreadcrumb(context, 'TestComponent', 'First breadcrumb', { key: 'value' });
    
    expect(context.breadcrumbs.length).toEqual(1);
    expect(breadcrumb1.category).toEqual('TestComponent');
    expect(breadcrumb1.message).toEqual('First breadcrumb');
    expect(breadcrumb1.data).toEqual({ key: 'value' });
    expect(breadcrumb1.elapsedMs).toBeGreaterThan(0);
    expect(breadcrumb1.durationMs).toBeUndefined();
    
    // Add a second breadcrumb
    const breadcrumb2 = addBreadcrumb(context, 'TestComponent', 'Second breadcrumb');
    
    expect(context.breadcrumbs.length).toEqual(2);
    expect(breadcrumb2.durationMs).toBeGreaterThan(0);
    
    // Check component timing
    expect(context.componentTiming['TestComponent']).toBeGreaterThan(0);
  });
  
  it('should calculate performance metrics correctly', () => {
    // Use real timing instead of fake timers
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    
    // Add breadcrumbs with different components
    addBreadcrumb(context, 'Component1', 'Breadcrumb 1');
    addBreadcrumb(context, 'Component2', 'Breadcrumb 2');
    addBreadcrumb(context, 'Component1', 'Breadcrumb 3');
    
    // Get performance metrics
    const metrics = getPerformanceMetrics(context);
    
    expect(metrics.totalElapsedMs).toBeGreaterThan(0);
    expect(metrics.breadcrumbCount).toEqual(3);
    expect(Object.keys(metrics.componentTiming).length).toBeGreaterThanOrEqual(2);
  });
});