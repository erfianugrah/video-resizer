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
    it('should add basic debug headers when debug is enabled', () => {
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
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.get('X-Video-Resizer-Debug')).toBe('true');
      expect(result.headers.get('X-Processing-Time-Ms')).toBe('50');
    });
    
    it('should add additional headers when verbose is enabled', () => {
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
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.get('X-Video-Resizer-Debug')).toBe('true');
      expect(result.headers.get('X-Processing-Time-Ms')).toBe('50');
      expect(result.headers.get('X-Path-Match')).toBe('videos');
      expect(result.headers.get('X-Transform-Source')).toBe('client-hints');
      expect(result.headers.get('X-Client-Hints')).toBe('true');
      expect(result.headers.get('X-Device-Type')).toBe('mobile');
      expect(result.headers.get('X-Network-Quality')).toBe('fast');
      expect(result.headers.get('X-Cacheability')).toBe('true');
      expect(result.headers.get('X-Cache-TTL')).toBe('3600');
      expect(result.headers.get('X-Video-ID')).toBe('abc123');
    });
    
    it('should do nothing when debug is disabled', () => {
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
      const result = addDebugHeaders(response, debugInfo, diagnosticsInfo);
      
      // Assert
      expect(result.headers.has('X-Video-Resizer-Debug')).toBe(false);
    });
  });
  
  describe('createDebugReport', () => {
    it('should create a basic HTML debug report', () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: [],
        warnings: [],
        pathMatch: 'videos',
        transformSource: 'client-hints',
      };
      
      // Act
      const result = createDebugReport(diagnosticsInfo);
      
      // Assert
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('Video Resizer Debug Report');
      expect(result).toContain('50 ms'); // Processing time
      expect(result).toContain('videos'); // Path match
      expect(result).toContain('client-hints'); // Transform source
    });
    
    it('should include errors and warnings when present', () => {
      // Arrange
      const diagnosticsInfo: DiagnosticsInfo = {
        processingTimeMs: 50,
        errors: ['Error 1', 'Error 2'],
        warnings: ['Warning 1'],
        pathMatch: 'videos',
      };
      
      // Act
      const result = createDebugReport(diagnosticsInfo);
      
      // Assert
      expect(result).toContain('Errors & Warnings');
      expect(result).toContain('Error 1');
      expect(result).toContain('Error 2');
      expect(result).toContain('Warning 1');
    });
    
    it('should include transformation parameters when present', () => {
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
      
      // Act
      const result = createDebugReport(diagnosticsInfo);
      
      // Assert
      expect(result).toContain('Transform Parameters');
      expect(result).toContain('width');
      expect(result).toContain('720');
      expect(result).toContain('height');
      expect(result).toContain('480');
    });
    
    it('should include browser capabilities when present', () => {
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
      
      // Act
      const result = createDebugReport(diagnosticsInfo);
      
      // Assert
      expect(result).toContain('Browser Capabilities');
      expect(result).toContain('supportsWebM');
      expect(result).toContain('supportsHEVC');
      expect(result).toContain('supportsHDR');
    });
  });
});