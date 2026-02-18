/**
 * Tests for range request handling in videoHandler
 *
 * handleVideoRequest has extensive dynamic imports and side effects.
 * We mock all dependencies at module level and use per-test mockImplementation overrides.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module-level mocks (hoisted by vitest) ────────────────────────────

vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-123',
    startTime: 0,
    debugEnabled: false,
    verboseEnabled: false,
    diagnostics: {},
    activeStreams: new Map(),
    executionContext: { waitUntil: vi.fn((p: any) => p) },
  })),
  createRequestContext: vi.fn((req: any) => ({
    requestId: 'test-123',
    url: req.url,
    startTime: 0,
    debugEnabled: false,
    verboseEnabled: false,
    diagnostics: {},
    activeStreams: new Map(),
    executionContext: { waitUntil: vi.fn((p: any) => p) },
  })),
  addBreadcrumb: vi.fn(),
  startTimedOperation: vi.fn(),
  endTimedOperation: vi.fn(),
  setCurrentContext: vi.fn(),
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  initializeLegacyLogger: vi.fn(),
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logErrorWithContext: vi.fn(),
}));

vi.mock('../../src/utils/errorHandlingUtils', () => ({
  logErrorWithContext: vi.fn(),
  withErrorHandling: vi.fn((fn: any) => fn),
  tryOrNull: vi.fn((fn: any) => (...args: any[]) => {
    try {
      return fn(...args);
    } catch {
      return null;
    }
  }),
  tryOrDefault: vi.fn((fn: any) => fn),
}));

vi.mock('../../src/utils/pathUtils', () => ({
  isCdnCgiMediaPath: vi.fn(() => false),
}));

vi.mock('../../src/utils/kvCacheUtils', () => ({
  getFromKVCache: vi.fn().mockResolvedValue(null),
  storeInKVCache: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services/cacheManagementService', () => ({
  getCachedResponse: vi.fn().mockResolvedValue(null),
  cacheResponse: vi.fn(async (_req: any, handler: any) => handler()),
}));

vi.mock('../../src/config', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      isKVCacheEnabled: vi.fn(() => false),
      shouldBypassCache: vi.fn(() => false),
      getConfig: vi.fn(() => ({
        bypassQueryParameters: [],
        enableCacheTags: false,
        defaultMaxAge: 3600,
      })),
    })),
  },
}));

vi.mock('../../src/config/CacheConfigurationManager', () => ({
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      isKVCacheEnabled: vi.fn(() => false),
      shouldBypassCache: vi.fn(() => false),
      getConfig: vi.fn(() => ({
        bypassQueryParameters: [],
        enableCacheTags: false,
        defaultMaxAge: 3600,
      })),
    })),
  },
}));

vi.mock('../../src/config/DebugConfigurationManager', () => ({
  DebugConfigurationManager: {
    getInstance: vi.fn(() => ({
      isDebugEnabled: vi.fn(() => false),
      isVerboseEnabled: vi.fn(() => false),
    })),
  },
}));

vi.mock('../../src/config/VideoConfigurationManager', () => ({
  VideoConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({})),
      getPathPatterns: vi.fn(() => []),
      shouldUseOrigins: vi.fn(() => false),
      getOrigins: vi.fn(() => []),
      getStorageDiagnostics: vi.fn(() => ({})),
    })),
  },
}));

vi.mock('../../src/handlers/videoOptionsService', () => ({
  determineVideoOptions: vi.fn(() => ({
    derivative: 'mobile',
    width: 640,
    height: 360,
  })),
}));

vi.mock('../../src/utils/flexibleBindings', () => ({
  getCacheKV: vi.fn(() => null),
  isKVNamespace: vi.fn(() => false),
}));

// Mock Sentry
vi.mock('@sentry/cloudflare', () => ({
  metrics: {
    count: vi.fn(),
    distribution: vi.fn(),
  },
  captureException: vi.fn(),
}));

// Mock the transformation service — default returns a regular video
vi.mock('../../src/services/videoTransformationService', () => ({
  transformVideo: vi.fn(),
}));

// Mock httpUtils at module level
vi.mock('../../src/utils/httpUtils', () => ({
  handleRangeRequestForInitialAccess: vi.fn(),
  parseRangeHeader: vi.fn(),
}));

// Mock streamUtils at module level
vi.mock('../../src/utils/streamUtils', () => ({
  handleRangeRequest: vi.fn(),
  processRangeRequest: vi.fn(),
}));

// Mock bypassHeadersUtils
vi.mock('../../src/utils/bypassHeadersUtils', () => ({
  hasBypassHeaders: vi.fn(() => false),
  setBypassHeaders: vi.fn(),
}));

// Mock responseBuilder
vi.mock('../../src/utils/responseBuilder', () => ({
  ResponseBuilder: class MockResponseBuilder {
    private response: Response;
    constructor(response: Response) {
      this.response = response;
    }
    withDebugInfo() {
      return this;
    }
    withFilename() {
      return this;
    }
    build() {
      return Promise.resolve(this.response);
    }
  },
}));

// Mock videoStorageService (exports generateCacheTags)
vi.mock('../../src/services/videoStorageService', () => ({
  generateCacheTags: vi.fn(() => []),
}));

// ── Tests ──────────────────────────────────────────────────────────────

import { handleVideoRequest } from '../../src/handlers/videoHandler';

describe('VideoHandler Range Request Handling', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: transformVideo returns a regular video response
    const { transformVideo } = await import('../../src/services/videoTransformationService');
    vi.mocked(transformVideo).mockImplementation(async () => {
      return new Response('video content', {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '10000',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    });

    // Default: handleRangeRequestForInitialAccess returns the original response unchanged
    // (matches real behavior — it simply returns the response as-is)
    const httpUtils = await import('../../src/utils/httpUtils');
    vi.mocked(httpUtils.handleRangeRequestForInitialAccess).mockImplementation(
      async (response) => response
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should handle regular videos with Cache API for range requests', async () => {
    // Override handleRangeRequestForInitialAccess to simulate range handling
    const httpUtils = await import('../../src/utils/httpUtils');
    vi.mocked(httpUtils.handleRangeRequestForInitialAccess).mockImplementation(async (response) => {
      const headers = new Headers(response.headers);
      headers.set('Content-Range', 'bytes 0-999/10000');
      headers.set('Content-Length', '1000');
      headers.set('X-Range-Handled-By', 'CacheAPI-Test');
      return new Response('partial content', { status: 206, headers });
    });

    const request = new Request('https://example.com/videos/test.mp4', {
      headers: { Range: 'bytes=0-999' },
    });

    const response = await handleVideoRequest(
      request,
      { mode: 'development', isProduction: false, pathPatterns: [] } as any,
      {} as any,
      { waitUntil: vi.fn((p) => p) } as any
    );

    // Verify the response is a 206 Partial Content
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 0-999/10000');
    expect(response.headers.get('X-Range-Handled-By')).toBe('CacheAPI-Test');

    // Verify httpUtils.handleRangeRequestForInitialAccess was called
    expect(httpUtils.handleRangeRequestForInitialAccess).toHaveBeenCalled();
  });

  it('should handle fallback videos with direct streaming for range requests', async () => {
    // transformVideo returns a fallback response (with X-Fallback-Applied)
    const { transformVideo } = await import('../../src/services/videoTransformationService');
    vi.mocked(transformVideo).mockImplementation(async () => {
      return new Response('fallback video content', {
        status: 200,
        headers: new Headers({
          'Content-Type': 'video/mp4',
          'Content-Length': '10000',
          'Accept-Ranges': 'bytes',
          'X-Fallback-Applied': 'true',
          'X-Bypass-Cache-API': 'true',
          'X-Direct-Stream-Only': 'true',
          'Cache-Control': 'public, max-age=86400',
        }),
      });
    });

    // hasBypassHeaders should return true for fallback responses
    const bypassUtils = await import('../../src/utils/bypassHeadersUtils');
    vi.mocked(bypassUtils.hasBypassHeaders).mockReturnValue(true);

    // streamUtils.handleRangeRequest should return a 206 response
    const streamUtilsMod = await import('../../src/utils/streamUtils');
    vi.mocked(streamUtilsMod.handleRangeRequest).mockImplementation(
      async (response, rangeHeader, options) => {
        return new Response('partial fallback content', {
          status: 206,
          headers: new Headers({
            'Content-Type': 'video/mp4',
            'Content-Range': 'bytes 0-999/10000',
            'Content-Length': '1000',
            'Accept-Ranges': 'bytes',
            'X-Range-Handled-By': options?.handlerTag || 'VideoHandler-Direct-Stream',
            'X-Bypass-Cache-API': 'true',
            'X-Direct-Stream-Only': 'true',
            'X-Fallback-Applied': 'true',
          }),
        });
      }
    );

    const request = new Request('https://example.com/videos/large.mp4', {
      headers: { Range: 'bytes=0-999' },
    });

    const response = await handleVideoRequest(
      request,
      { mode: 'development', isProduction: false, pathPatterns: [] } as any,
      {} as any,
      { waitUntil: vi.fn((p) => p) } as any
    );

    // Verify the response is a 206 Partial Content for direct stream
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 0-999/10000');
    expect(response.headers.get('X-Range-Handled-By')).toBe('VideoHandler-Direct-Stream');
    expect(response.headers.get('X-Fallback-Applied')).toBe('true');

    // Verify streamUtils.handleRangeRequest was called (not httpUtils)
    expect(streamUtilsMod.handleRangeRequest).toHaveBeenCalled();
    const httpUtils = await import('../../src/utils/httpUtils');
    expect(httpUtils.handleRangeRequestForInitialAccess).not.toHaveBeenCalled();
  });
});
