/**
 * Tests for debugHeadersUtils
 */
import { describe, it, expect } from 'vitest';
import { 
  addDebugHeaders,
  extractRequestHeaders,
  DebugInfo,
  DiagnosticsInfo 
} from '../../src/utils/debugHeadersUtils';

describe('debugHeadersUtils', () => {
  describe('addDebugHeaders', () => {
    it('should not add headers when debug is disabled', () => {
      // Arrange
      const response = new Response('Test content');
      const debugInfo: DebugInfo = { isEnabled: false };
      const diagnosticsInfo: DiagnosticsInfo = {};
      
      // Act
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.has('X-Video-Resizer-Debug')).toBe(false);
    });
    
    it('should add basic debug headers when debug is enabled', () => {
      // Arrange
      const response = new Response('Test content');
      const debugInfo: DebugInfo = { isEnabled: true };
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 42,
        transformSource: 'test-source',
        deviceType: 'mobile',
      };
      
      // Act
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.get('X-Video-Resizer-Debug')).toBe('true');
      expect(result.headers.get('X-Processing-Time-Ms')).toBe('42');
      expect(result.headers.get('X-Transform-Source')).toBe('test-source');
      expect(result.headers.get('X-Device-Type')).toBe('mobile');
    });
    
    it('should add verbose headers when verbose mode is enabled', () => {
      // Arrange
      const response = new Response('Test content');
      const debugInfo: DebugInfo = { isEnabled: true, isVerbose: true };
      const diagnosticsInfo: DiagnosticsInfo = {
        responsiveSize: { width: 1280, height: 720, source: 'client-hints' },
        transformParams: { width: 1280, height: 720, mode: 'video' },
        browserCapabilities: { supportsHEVC: true, supportsAV1: false },
      };
      
      // Act
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.get('X-Responsive-Width')).toBe('1280');
      expect(result.headers.get('X-Responsive-Height')).toBe('720');
      expect(result.headers.get('X-Responsive-Method')).toBe('client-hints');
      expect(result.headers.get('X-Transform-Params')).toBe(JSON.stringify(diagnosticsInfo.transformParams));
      expect(result.headers.get('X-Browser-Capabilities')).toBe(JSON.stringify(diagnosticsInfo.browserCapabilities));
    });
    
    it('should include request headers when includeHeaders is true', () => {
      // Arrange
      const response = new Response('Test content');
      const debugInfo: DebugInfo = { isEnabled: true, includeHeaders: true };
      const diagnosticsInfo: DiagnosticsInfo = {
        requestHeaders: { 'User-Agent': 'Test Agent', 'Accept': 'video/mp4' },
      };
      
      // Act
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.get('X-Request-Headers')).toBe(JSON.stringify(diagnosticsInfo.requestHeaders));
    });
    
    it('should split long request headers into chunks', () => {
      // Arrange
      const response = new Response('Test content');
      const debugInfo: DebugInfo = { isEnabled: true, includeHeaders: true };
      
      // Create a large headers object (> 500 chars)
      const largeHeaders: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        largeHeaders[`Test-Header-${i}`] = 'X'.repeat(30);
      }
      
      const diagnosticsInfo: DiagnosticsInfo = { requestHeaders: largeHeaders };
      
      // Act
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.has('X-Request-Headers-Count')).toBe(true);
      expect(result.headers.has('X-Request-Headers-1')).toBe(true);
    });
  });
  
  describe('extractRequestHeaders', () => {
    it('should extract headers from request', () => {
      // Arrange
      const headers = new Headers();
      headers.set('User-Agent', 'Test Agent');
      headers.set('Accept', 'video/mp4');
      const request = new Request('https://example.com', { headers });
      
      // Act
      const result = extractRequestHeaders(request);
      
      // Assert
      expect(result['user-agent']).toBe('Test Agent');
      expect(result['accept']).toBe('video/mp4');
    });
  });
  
  describe('cache tag headers', () => {
    it('should add cache tags to headers when provided', () => {
      // Arrange
      const testTags = [
        'video-path-videos-test-mp4',
        'video-segment-0-videos',
        'video-segment-1-test',
        'video-derivative-mobile',
        'video-quality-low'
      ];
      
      const diagnosticsInfo: DiagnosticsInfo = {
        cacheability: true,
        cacheTtl: 86400,
        cacheTags: testTags,
        cachingMethod: 'cf-object'
      };
      
      // Create a response without Cache-Tag
      const response = new Response('Test response');
      
      // Act
      const result = addDebugHeaders(
        response,
        { isEnabled: true },
        diagnosticsInfo
      );
      
      // Assert
      expect(result.headers.get('X-Cache-Tags')).toBe(testTags.join(','));
      
      // Check that Cache-Tag is exposed when debug is enabled
      expect(result.headers.get('Cache-Tag')).toBe(testTags.join(','));
    });
    
    it('should not override existing Cache-Tag header', () => {
      // Arrange
      const testTags = [
        'video-path-videos-test-mp4',
        'video-segment-0-videos',
        'video-segment-1-test'
      ];
      
      const diagnosticsInfo: DiagnosticsInfo = {
        cacheTags: testTags
      };
      
      // Create a response with existing Cache-Tag
      const headers = new Headers();
      headers.set('Cache-Tag', 'existing-tag');
      const response = new Response('Test response', { headers });
      
      // Act
      const result = addDebugHeaders(
        response,
        { isEnabled: true },
        diagnosticsInfo
      );
      
      // Assert
      expect(result.headers.get('X-Cache-Tags')).toBe(testTags.join(','));
      
      // Check that original Cache-Tag is preserved
      expect(result.headers.get('Cache-Tag')).toBe('existing-tag');
    });
  });
});