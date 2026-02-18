/**
 * Tests for Cloudflare Media Transformation error codes
 */
import { describe, it, expect } from 'vitest';
import {
  CfErrorCode,
  CF_ERROR_MAP,
  extractCfErrorCode,
  getCfErrorInfo,
  isCfErrorRetryable,
  shouldCfErrorFallback,
} from '../../src/errors/cfErrorCodes';

describe('CfErrorCode enum', () => {
  it('should have all 12 known error codes', () => {
    expect(CfErrorCode.INVALID_OPTIONS).toBe(9401);
    expect(CfErrorCode.ORIGIN_TOO_LARGE_OR_NO_RESPONSE).toBe(9402);
    expect(CfErrorCode.RESOURCE_NOT_FOUND).toBe(9404);
    expect(CfErrorCode.MALFORMED_URL).toBe(9406);
    expect(CfErrorCode.DNS_ERROR).toBe(9407);
    expect(CfErrorCode.ORIGIN_CLIENT_ERROR).toBe(9408);
    expect(CfErrorCode.ORIGIN_NOT_MEDIA).toBe(9412);
    expect(CfErrorCode.URL_FORMAT_ERROR).toBe(9419);
    expect(CfErrorCode.ORIGIN_UNREACHABLE).toBe(9504);
    expect(CfErrorCode.ORIGIN_SERVER_ERROR).toBe(9509);
    expect(CfErrorCode.CF_INTERNAL_ERROR_A).toBe(9517);
    expect(CfErrorCode.CF_INTERNAL_ERROR_B).toBe(9523);
  });
});

describe('CF_ERROR_MAP', () => {
  it('should have entries for all 12 known codes', () => {
    expect(CF_ERROR_MAP.size).toBe(12);
  });

  it('should have consistent code field in each entry', () => {
    for (const [code, info] of CF_ERROR_MAP) {
      expect(info.code).toBe(code);
    }
  });

  it('should have non-empty labels and descriptions', () => {
    for (const [, info] of CF_ERROR_MAP) {
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it('should map client-error codes to non-retryable, non-fallback', () => {
    const clientCodes = [
      CfErrorCode.INVALID_OPTIONS,
      CfErrorCode.MALFORMED_URL,
      CfErrorCode.URL_FORMAT_ERROR,
    ];
    for (const code of clientCodes) {
      const info = CF_ERROR_MAP.get(code)!;
      expect(info.retryable).toBe(false);
      expect(info.shouldFallback).toBe(false);
      expect(info.httpStatus).toBe(400);
    }
  });

  it('should map origin-unreachable and server-error to retryable + fallback', () => {
    const retryCodes = [CfErrorCode.ORIGIN_UNREACHABLE, CfErrorCode.ORIGIN_SERVER_ERROR];
    for (const code of retryCodes) {
      const info = CF_ERROR_MAP.get(code)!;
      expect(info.retryable).toBe(true);
      expect(info.shouldFallback).toBe(true);
    }
  });

  it('should map CF internal errors to retryable + fallback', () => {
    const internalCodes = [CfErrorCode.CF_INTERNAL_ERROR_A, CfErrorCode.CF_INTERNAL_ERROR_B];
    for (const code of internalCodes) {
      const info = CF_ERROR_MAP.get(code)!;
      expect(info.retryable).toBe(true);
      expect(info.shouldFallback).toBe(true);
      expect(info.httpStatus).toBe(500);
    }
  });
});

describe('extractCfErrorCode', () => {
  it('should return null when Cf-Resized header is absent', () => {
    const response = new Response('', { headers: {} });
    expect(extractCfErrorCode(response)).toBeNull();
  });

  it('should return null when Cf-Resized header has no err= field', () => {
    const response = new Response('', {
      headers: { 'Cf-Resized': 'internal=ok q=85 n=1234' },
    });
    expect(extractCfErrorCode(response)).toBeNull();
  });

  it('should extract a known error code', () => {
    const response = new Response('', {
      headers: { 'Cf-Resized': 'err=9404' },
    });
    expect(extractCfErrorCode(response)).toBe(9404);
  });

  it('should extract error code from complex header value', () => {
    const response = new Response('', {
      headers: { 'Cf-Resized': 'internal=ok err=9412' },
    });
    expect(extractCfErrorCode(response)).toBe(9412);
  });

  it('should extract error code when using lowercase header name', () => {
    const response = new Response('', {
      headers: { 'cf-resized': 'err=9509' },
    });
    expect(extractCfErrorCode(response)).toBe(9509);
  });

  it('should return the code even if it is unknown', () => {
    const response = new Response('', {
      headers: { 'Cf-Resized': 'err=9999' },
    });
    // Should still return the number even though it's not in our known map
    expect(extractCfErrorCode(response)).toBe(9999);
  });
});

describe('getCfErrorInfo', () => {
  it('should return info for a known code', () => {
    const info = getCfErrorInfo(CfErrorCode.RESOURCE_NOT_FOUND);
    expect(info).toBeDefined();
    expect(info!.code).toBe(9404);
    expect(info!.label).toBe('Resource Not Found');
    expect(info!.httpStatus).toBe(404);
  });

  it('should return undefined for an unknown code', () => {
    expect(getCfErrorInfo(9999 as CfErrorCode)).toBeUndefined();
  });
});

describe('isCfErrorRetryable', () => {
  it('should return false for non-retryable codes', () => {
    expect(isCfErrorRetryable(CfErrorCode.INVALID_OPTIONS)).toBe(false);
    expect(isCfErrorRetryable(CfErrorCode.RESOURCE_NOT_FOUND)).toBe(false);
    expect(isCfErrorRetryable(CfErrorCode.MALFORMED_URL)).toBe(false);
  });

  it('should return true for retryable codes', () => {
    expect(isCfErrorRetryable(CfErrorCode.DNS_ERROR)).toBe(true);
    expect(isCfErrorRetryable(CfErrorCode.ORIGIN_UNREACHABLE)).toBe(true);
    expect(isCfErrorRetryable(CfErrorCode.ORIGIN_SERVER_ERROR)).toBe(true);
    expect(isCfErrorRetryable(CfErrorCode.CF_INTERNAL_ERROR_A)).toBe(true);
    expect(isCfErrorRetryable(CfErrorCode.CF_INTERNAL_ERROR_B)).toBe(true);
  });

  it('should return true (fail-safe) for unknown codes', () => {
    expect(isCfErrorRetryable(9999 as CfErrorCode)).toBe(true);
  });
});

describe('shouldCfErrorFallback', () => {
  it('should return false for client-error codes', () => {
    expect(shouldCfErrorFallback(CfErrorCode.INVALID_OPTIONS)).toBe(false);
    expect(shouldCfErrorFallback(CfErrorCode.MALFORMED_URL)).toBe(false);
    expect(shouldCfErrorFallback(CfErrorCode.URL_FORMAT_ERROR)).toBe(false);
    expect(shouldCfErrorFallback(CfErrorCode.RESOURCE_NOT_FOUND)).toBe(false);
  });

  it('should return true for origin/server errors', () => {
    expect(shouldCfErrorFallback(CfErrorCode.ORIGIN_TOO_LARGE_OR_NO_RESPONSE)).toBe(true);
    expect(shouldCfErrorFallback(CfErrorCode.DNS_ERROR)).toBe(true);
    expect(shouldCfErrorFallback(CfErrorCode.ORIGIN_CLIENT_ERROR)).toBe(true);
    expect(shouldCfErrorFallback(CfErrorCode.ORIGIN_NOT_MEDIA)).toBe(true);
    expect(shouldCfErrorFallback(CfErrorCode.ORIGIN_UNREACHABLE)).toBe(true);
    expect(shouldCfErrorFallback(CfErrorCode.ORIGIN_SERVER_ERROR)).toBe(true);
  });

  it('should return true (fail-safe) for unknown codes', () => {
    expect(shouldCfErrorFallback(9999 as CfErrorCode)).toBe(true);
  });
});
