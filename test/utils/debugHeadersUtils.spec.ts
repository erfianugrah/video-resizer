/**
 * Tests for debugHeadersUtils
 */
import { describe, it, expect } from 'vitest';
import { 
  addDebugHeaders,
  extractRequestHeaders,
  createDebugReport,
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
  
  describe('createDebugReport', () => {
    it('should generate an HTML debug report', () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 42,
        transformSource: 'client-hints',
        pathMatch: 'videos',
        videoId: 'abc123',
        deviceType: 'desktop',
        networkQuality: 'fast',
        clientHints: true,
        responsiveSize: { width: 1280, height: 720, source: 'client-hints' },
        cacheability: true,
        cacheTtl: 3600,
        transformParams: { width: 1280, height: 720, mode: 'video' },
        browserCapabilities: { supportsHEVC: true, supportsAV1: false },
        errors: [],
        warnings: ['Low bandwidth detected'],
      };
      
      // Act
      const html = createDebugReport(diagnosticsInfo);
      
      // Assert
      expect(html).toContain('Video Resizer Debug Report');
      expect(html).toContain('42 ms'); // Processing time
      expect(html).toContain('client-hints'); // Transform source
      expect(html).toContain('1280 px'); // Width
      expect(html).toContain('720 px'); // Height
      expect(html).toContain('3600 seconds'); // Cache TTL
      expect(html).toContain('Low bandwidth detected'); // Warning
    });
  });
});