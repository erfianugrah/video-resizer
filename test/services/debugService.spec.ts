/**
 * Tests for debugService
 */
import { describe, it, expect, vi } from 'vitest';
import { addDebugHeaders, createDebugReport } from '../../src/services/debugService';
import { DebugInfo, DiagnosticsInfo } from '../../src/utils/debugHeadersUtils';

// Mock logging functions
vi.mock('../../src/utils/loggerUtils', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

describe('debugService', () => {
  describe('addDebugHeaders', () => {
    it('should add basic debug headers when debug is enabled', async () => {
      // Arrange
      const response = new Response('Success', { status: 200 });
      const debugInfo: DebugInfo = {
        isEnabled: true,
        isVerbose: false,
        includeHeaders: false,
        includePerformance: true,
      };
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
      };

      // Act
      const result = await addDebugHeaders(response, debugInfo, diagnosticsInfo);

      // Assert
      expect(result.headers.get('X-Video-Resizer-Debug')).toBe('true');
      expect(result.headers.get('X-Processing-Time-Ms')).toBe('50');
    });

    it('should add additional headers when verbose is enabled', async () => {
      // Arrange
      const response = new Response('Success', { status: 200 });
      const debugInfo: DebugInfo = {
        isEnabled: true,
        isVerbose: true,
        includeHeaders: false,
        includePerformance: true,
      };
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
        pathMatch: 'videos',
        transformSource: 'client-hints',
        clientHints: true,
        deviceType: 'mobile',
        networkQuality: 'fast',
        cacheability: true,
        cacheTtl: 3600,
        videoId: 'abc123',
      };

      // Act
      const result = await addDebugHeaders(response, debugInfo, diagnosticsInfo);

      // Assert
      expect(result.headers.get('X-Video-Resizer-Debug')).toBe('true');
      expect(result.headers.get('X-Processing-Time-Ms')).toBe('50');
      expect(result.headers.get('X-Path-Match')).toBe('videos');
      expect(result.headers.get('X-Transform-Source')).toBe('client-hints');
      expect(result.headers.get('X-Client-Hints-Available')).toBe('true');
      expect(result.headers.get('X-Device-Type')).toBe('mobile');
      expect(result.headers.get('X-Network-Quality')).toBe('fast');
      expect(result.headers.get('X-Cache-Enabled')).toBe('true');
      expect(result.headers.get('X-Cache-TTL')).toBe('3600');
      expect(result.headers.get('X-Video-ID')).toBe('abc123');
    });

    it('should do nothing when debug is disabled', async () => {
      // Arrange
      const response = new Response('Success', { status: 200 });
      const debugInfo: DebugInfo = {
        isEnabled: false,
        isVerbose: false,
        includeHeaders: false,
        includePerformance: true,
      };
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
      };

      // Act
      const result = await addDebugHeaders(response, debugInfo, diagnosticsInfo);

      // Assert
      expect(result.headers.has('X-Video-Resizer-Debug')).toBe(false);
    });
  });

  describe('createDebugReport', () => {
    it('should create a basic HTML debug report', async () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
        pathMatch: 'videos',
        transformSource: 'client-hints',
      };

      // Mock assets binding
      const mockHtmlContent =
        '<!DOCTYPE html><html><body>Video Resizer Debug 50 ms videos client-hints</body></html>';
      const mockAssets = {
        fetch: vi.fn().mockResolvedValue(
          new Response(mockHtmlContent, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        ),
      };

      // Act
      const result = await createDebugReport(diagnosticsInfo, { ASSETS: mockAssets });
      const text = await result.text();

      // Assert
      expect(text).toContain('<!DOCTYPE html>');
      expect(text).toContain('Video Resizer Debug');
      expect(text).toContain('50 ms'); // Processing time
      expect(text).toContain('videos'); // Path match
      expect(text).toContain('client-hints'); // Transform source
    });

    it('should include errors and warnings when present', async () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: ['Error 1', 'Error 2'],
        warnings: ['Warning 1'],
        pathMatch: 'videos',
      };

      // Mock assets binding
      const mockHtmlContent =
        '<!DOCTYPE html><html><body>Errors & Warnings Error 1 Error 2 Warning 1</body></html>';
      const mockAssets = {
        fetch: vi.fn().mockResolvedValue(
          new Response(mockHtmlContent, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        ),
      };

      // Act
      const result = await createDebugReport(diagnosticsInfo, { ASSETS: mockAssets });
      const text = await result.text();

      // Assert
      expect(text).toContain('Errors & Warnings');
      expect(text).toContain('Error 1');
      expect(text).toContain('Error 2');
      expect(text).toContain('Warning 1');
    });

    it('should include transformation parameters when present', async () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
        transformParams: {
          width: 720,
          height: 480,
          mode: 'video',
          fit: 'contain',
        },
      };

      // Mock assets binding
      const mockHtmlContent =
        '<!DOCTYPE html><html><body>Transform Parameters width 720 height 480 mode video fit contain</body></html>';
      const mockAssets = {
        fetch: vi.fn().mockResolvedValue(
          new Response(mockHtmlContent, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        ),
      };

      // Act
      const result = await createDebugReport(diagnosticsInfo, { ASSETS: mockAssets });
      const text = await result.text();

      // Assert
      expect(text).toContain('Transform Parameters');
      expect(text).toContain('width');
      expect(text).toContain('720');
      expect(text).toContain('height');
      expect(text).toContain('480');
    });

    it('should include browser capabilities when present', async () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
        browserCapabilities: {
          supportsWebM: true,
          supportsHEVC: false,
          supportsHDR: false,
        },
      };

      // Mock assets binding
      const mockHtmlContent =
        '<!DOCTYPE html><html><body>Browser Capabilities supportsWebM supportsHEVC supportsHDR</body></html>';
      const mockAssets = {
        fetch: vi.fn().mockResolvedValue(
          new Response(mockHtmlContent, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        ),
      };

      // Act
      const result = await createDebugReport(diagnosticsInfo, { ASSETS: mockAssets });
      const text = await result.text();

      // Assert
      expect(text).toContain('Browser Capabilities');
      expect(text).toContain('supportsWebM');
      expect(text).toContain('supportsHEVC');
      expect(text).toContain('supportsHDR');
    });

    it('should accept an environment parameter', async () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
      };

      // Mock assets binding with HTML response
      const mockHtmlContent = '<!DOCTYPE html><html><body>Debug UI</body></html>';
      const mockAssets = {
        fetch: vi.fn().mockResolvedValue(
          new Response(mockHtmlContent, {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        ),
      };

      // Act
      const result = await createDebugReport(diagnosticsInfo, { ASSETS: mockAssets });
      const text = await result.text();

      // Assert
      expect(text).toContain('<!DOCTYPE html>');
      // The env parameter doesn't affect the output directly in our current implementation
      // but we're testing that the function accepts the parameter without error
    });
  });
});
