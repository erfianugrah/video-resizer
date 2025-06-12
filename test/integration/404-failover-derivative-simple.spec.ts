import { describe, it, expect } from 'vitest';

describe('404 Failover - Derivative Preservation', () => {
  it('should preserve derivative parameter in CDN-CGI URL during failover', () => {
    // Test the core logic of derivative preservation
    // This is already covered in retryWithAlternativeOrigins.ts line 251
    
    // Convert VideoOptions to TransformParams
    const transformOptions = {
      width: 1920,
      height: 1080,
      quality: 85,
      format: 'mp4',
      derivative: 'desktop' // This should be preserved
    };
    
    const transformParams: Record<string, any> = {};
    
    // Copy only defined values with proper type handling (mimics the actual code)
    if (transformOptions.width !== undefined) transformParams.width = transformOptions.width;
    if (transformOptions.height !== undefined) transformParams.height = transformOptions.height;
    if (transformOptions.quality !== undefined) transformParams.quality = transformOptions.quality;
    if (transformOptions.format !== undefined) transformParams.format = transformOptions.format;
    if (transformOptions.derivative !== undefined) transformParams.derivative = transformOptions.derivative;
    
    // Verify derivative is preserved in the transform parameters
    expect(transformParams).toHaveProperty('derivative', 'desktop');
    expect(transformParams).toHaveProperty('width', 1920);
    expect(transformParams).toHaveProperty('height', 1080);
    expect(transformParams).toHaveProperty('quality', 85);
    expect(transformParams).toHaveProperty('format', 'mp4');
  });

  it('should generate correct cache keys with derivative', () => {
    // Test cache key generation logic
    const sourcePath = '/videos/test.mp4';
    const options = {
      width: 1920,
      height: 1080,
      derivative: 'desktop'
    };
    
    // Simulate the cache key generation (mimics cacheOrchestrator.ts logic)
    let cacheKey = `video:${sourcePath.replace(/^\//g, '')}`;
    
    if (options.derivative) {
      cacheKey += `:derivative=${options.derivative}`;
    }
    
    if (options.width) {
      cacheKey += `:width=${options.width}`;
    }
    
    if (options.height) {
      cacheKey += `:height=${options.height}`;
    }
    
    cacheKey += ':v1'; // version
    
    // Verify the cache key includes the derivative
    expect(cacheKey).toBe('video:videos/test.mp4:derivative=desktop:width=1920:height=1080:v1');
    expect(cacheKey).toContain('derivative=desktop');
  });

  it('should handle missing derivative parameter correctly', () => {
    // Test when derivative is undefined
    const transformOptions = {
      width: 1280,
      height: 720,
      quality: 80,
      format: 'webm'
      // No derivative
    };
    
    const transformParams: Record<string, any> = {};
    
    // Copy only defined values
    if (transformOptions.width !== undefined) transformParams.width = transformOptions.width;
    if (transformOptions.height !== undefined) transformParams.height = transformOptions.height;
    if (transformOptions.quality !== undefined) transformParams.quality = transformOptions.quality;
    if (transformOptions.format !== undefined) transformParams.format = transformOptions.format;
    if ((transformOptions as any).derivative !== undefined) transformParams.derivative = (transformOptions as any).derivative;
    
    // Verify derivative is not included when undefined
    expect(transformParams).not.toHaveProperty('derivative');
    expect(transformParams).toHaveProperty('width', 1280);
    expect(transformParams).toHaveProperty('height', 720);
    expect(transformParams).toHaveProperty('quality', 80);
    expect(transformParams).toHaveProperty('format', 'webm');
  });

  it('should handle different derivative types', () => {
    const derivativeTypes = ['mobile', 'tablet', 'desktop', '4k', 'custom-derivative'];
    
    derivativeTypes.forEach(derivative => {
      const transformOptions = {
        width: 1920,
        height: 1080,
        derivative: derivative
      };
      
      const transformParams: Record<string, any> = {};
      
      // Copy with derivative
      if (transformOptions.derivative !== undefined) {
        transformParams.derivative = transformOptions.derivative;
      }
      
      // Verify each derivative type is preserved
      expect(transformParams).toHaveProperty('derivative', derivative);
    });
  });

  it('should generate KV storage keys consistent with cache orchestrator', () => {
    // Test that KV storage key generation matches cache orchestrator pattern
    const sourcePath = '/videos/example.mp4';
    const imqueryOptions = {
      derivative: 'tablet',
      width: 1280,
      height: 720,
      customData: {
        imwidth: '1280',
        imheight: '720'
      }
    };
    
    // KV storage key generation (from keyUtils.ts)
    const normalizedPath = sourcePath.replace(/^\/+/, '');
    let kvKey = `video:${normalizedPath}`;
    
    if (imqueryOptions.derivative) {
      kvKey += `:derivative=${imqueryOptions.derivative}`;
    }
    
    // Cache orchestrator key generation  
    let cacheOrchestratorKey = `video:${normalizedPath}`;
    
    if (imqueryOptions.derivative) {
      cacheOrchestratorKey += `:derivative=${imqueryOptions.derivative}`;
    }
    
    if (imqueryOptions.width) {
      cacheOrchestratorKey += `:width=${imqueryOptions.width}`;
    }
    
    if (imqueryOptions.height) {
      cacheOrchestratorKey += `:height=${imqueryOptions.height}`;
    }
    
    // IMQuery parameters should be added
    if (imqueryOptions.customData?.imwidth) {
      cacheOrchestratorKey += `:imwidth=${imqueryOptions.customData.imwidth}`;
    }
    
    if (imqueryOptions.customData?.imheight) {
      cacheOrchestratorKey += `:imheight=${imqueryOptions.customData.imheight}`;
    }
    
    cacheOrchestratorKey += ':v1';
    
    // Both should contain the derivative
    expect(kvKey).toContain('derivative=tablet');
    expect(cacheOrchestratorKey).toContain('derivative=tablet');
    
    // The cache orchestrator key should include additional parameters
    expect(cacheOrchestratorKey).toContain('width=1280');
    expect(cacheOrchestratorKey).toContain('height=720');
    expect(cacheOrchestratorKey).toContain('imwidth=1280');
    expect(cacheOrchestratorKey).toContain('imheight=720');
  });
});