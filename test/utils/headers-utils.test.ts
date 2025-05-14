import { describe, it, expect } from 'vitest';
import { setBypassHeaders, hasBypassHeaders, copyBypassHeaders } from '../../src/utils/bypassHeadersUtils';
import { HeadersManager } from '../../src/utils/headersManager';

describe('Bypass Headers Utils', () => {
  it('should set all bypass headers correctly', () => {
    const headers = new Headers();
    
    setBypassHeaders(headers);
    
    expect(headers.get('X-Bypass-Cache-API')).toBe('true');
    expect(headers.get('X-Direct-Stream-Only')).toBe('true');
    expect(headers.get('X-Cache-API-Bypass')).toBe('true');
    expect(headers.get('Cache-Control')).toBe('no-store');
    expect(headers.get('Accept-Ranges')).toBe('bytes');
  });
  
  it('should set specific headers based on options', () => {
    const headers = new Headers();
    
    setBypassHeaders(headers, {
      videoExceedsSize: true,
      isFallback: true,
      fileSizeError: true
    });
    
    expect(headers.get('X-Video-Exceeds-256MiB')).toBe('true');
    expect(headers.get('X-Fallback-Applied')).toBe('true');
    expect(headers.get('X-File-Size-Error')).toBe('true');
  });
  
  it('should correctly identify headers with bypass flags', () => {
    // Test X-Bypass-Cache-API
    let headers = new Headers();
    headers.set('X-Bypass-Cache-API', 'true');
    expect(hasBypassHeaders(headers)).toBe(true);
    
    // Test X-Direct-Stream-Only
    headers = new Headers();
    headers.set('X-Direct-Stream-Only', 'true');
    expect(hasBypassHeaders(headers)).toBe(true);
    
    // Test X-Cache-API-Bypass
    headers = new Headers();
    headers.set('X-Cache-API-Bypass', 'true');
    expect(hasBypassHeaders(headers)).toBe(true);
    
    // Test X-Video-Exceeds-256MiB
    headers = new Headers();
    headers.set('X-Video-Exceeds-256MiB', 'true');
    expect(hasBypassHeaders(headers)).toBe(true);
    
    // Test X-File-Size-Error
    headers = new Headers();
    headers.set('X-File-Size-Error', 'true');
    expect(hasBypassHeaders(headers)).toBe(true);
    
    // Test with no bypass headers
    headers = new Headers();
    expect(hasBypassHeaders(headers)).toBe(false);
  });
  
  it('should copy bypass headers correctly', () => {
    const sourceHeaders = new Headers();
    setBypassHeaders(sourceHeaders, {
      videoExceedsSize: true,
      isFallback: true,
      fileSizeError: true
    });
    
    const destHeaders = new Headers();
    copyBypassHeaders(sourceHeaders, destHeaders);
    
    expect(destHeaders.get('X-Bypass-Cache-API')).toBe('true');
    expect(destHeaders.get('X-Direct-Stream-Only')).toBe('true');
    expect(destHeaders.get('X-Cache-API-Bypass')).toBe('true');
    expect(destHeaders.get('X-Video-Exceeds-256MiB')).toBe('true');
    expect(destHeaders.get('X-Fallback-Applied')).toBe('true');
    expect(destHeaders.get('X-File-Size-Error')).toBe('true');
  });
});

describe('Headers Manager', () => {
  it('should initialize with empty headers', () => {
    const manager = new HeadersManager();
    expect(manager.getHeaders()).toBeInstanceOf(Headers);
  });
  
  it('should initialize with existing headers', () => {
    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    
    const manager = new HeadersManager(headers);
    expect(manager.get('Content-Type')).toBe('video/mp4');
  });
  
  it('should set range headers correctly', () => {
    const manager = new HeadersManager()
      .setRangeHeaders(100, 500, 1000);
    
    expect(manager.get('Content-Range')).toBe('bytes 100-500/1000');
    expect(manager.get('Content-Length')).toBe('401'); // 500 - 100 + 1
    expect(manager.get('Accept-Ranges')).toBe('bytes');
  });
  
  it('should set bypass headers correctly', () => {
    const manager = new HeadersManager()
      .setBypassHeaders({ videoExceedsSize: true });
    
    expect(manager.get('X-Bypass-Cache-API')).toBe('true');
    expect(manager.get('X-Video-Exceeds-256MiB')).toBe('true');
    expect(manager.hasBypassHeaders()).toBe(true);
  });
  
  it('should set cache control headers correctly', () => {
    const manager = new HeadersManager()
      .setCacheControl({ noStore: true, maxAge: 3600, private: true });
    
    expect(manager.get('Cache-Control')).toBe('no-store, private, max-age=3600');
  });
  
  it('should support method chaining', () => {
    const manager = new HeadersManager()
      .setContentType('video/mp4')
      .setCacheControl({ maxAge: 3600 })
      .setRangeHeaders(0, 1000, 2000)
      .setDiagnosticHeader('Handler', 'StreamUtils');
    
    expect(manager.get('Content-Type')).toBe('video/mp4');
    expect(manager.get('Cache-Control')).toBe('max-age=3600');
    expect(manager.get('Content-Range')).toBe('bytes 0-1000/2000');
    expect(manager.get('X-Handler')).toBe('StreamUtils');
  });
});