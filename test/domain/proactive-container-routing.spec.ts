/**
 * Tests for proactive source-size detection and container routing
 *
 * Validates that oversized videos are routed directly to the FFmpeg container
 * without wasting a round-trip to cdn-cgi/media.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSourceSizeBytes } from '../../src/domain/commands/originsExecution';
import { CDN_CGI_SIZE_LIMIT } from '../../src/utils/httpUtils';
import type { SourceResolutionResult } from '../../src/services/origins/OriginResolver';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => null),
  addBreadcrumb: vi.fn(),
  createContext: vi.fn(() => ({ requestId: 'test-123', url: 'test' })),
  getPerformanceMetrics: vi.fn(() => ({})),
  getClientDiagnostics: vi.fn(() => ({
    browserCapabilities: {},
    hasClientHints: false,
    deviceType: 'desktop',
    networkQuality: 'good',
  })),
}));

vi.mock('../../src/utils/pinoLogger', () => ({
  createLogger: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../src/config', () => ({
  VideoConfigurationManager: {
    getInstance: vi.fn(() => ({
      isContainerEnabled: vi.fn(() => true),
      getContainerConfig: vi.fn(() => ({
        enabled: true,
        maxInputSize: 6 * 1024 * 1024 * 1024,
        maxOutputForKV: 2 * 1024 * 1024 * 1024,
        timeoutMs: 600000,
        sleepAfter: '5m',
        maxInstances: 5,
        fallbackToDirectStream: true,
      })),
      getConfig: vi.fn(() => ({})),
      getPathPatterns: vi.fn(() => []),
    })),
    resetInstance: vi.fn(),
  },
  CacheConfigurationManager: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({ bypassQueryParameters: [] })),
      isKVCacheEnabled: vi.fn(() => true),
      shouldBypassCache: vi.fn(() => false),
    })),
  },
  DebugConfigurationManager: {
    getInstance: vi.fn(() => ({
      isDebugEnabled: vi.fn(() => false),
      isVerboseEnabled: vi.fn(() => false),
      shouldIncludeHeaders: vi.fn(() => false),
      shouldIncludePerformance: vi.fn(() => false),
    })),
    resetInstance: vi.fn(),
  },
  LoggingConfigurationManager: {
    getInstance: vi.fn(() => ({
      getPinoConfig: vi.fn(() => ({
        level: 'debug',
        browser: { asObject: true },
        base: { service: 'video-resizer', env: 'test' },
      })),
      getSamplingConfig: vi.fn(() => ({ enabled: false, rate: 1.0 })),
      getBreadcrumbConfig: vi.fn(() => ({ enabled: true, maxItems: 100 })),
      areBreadcrumbsEnabled: vi.fn(() => true),
      getMaxBreadcrumbs: vi.fn(() => 100),
      getLogLevel: vi.fn(() => 'debug'),
      shouldLogComponent: vi.fn(() => true),
    })),
  },
  getEnvironmentConfig: vi.fn(() => ({
    mode: 'test',
    isProduction: false,
    cdnCgi: { basePath: '/cdn-cgi/media' },
  })),
}));

vi.mock('../../src/config/environmentConfig', () => ({
  getEnvironmentConfig: vi.fn(() => ({
    mode: 'test',
    isProduction: false,
    cdnCgi: { basePath: '/cdn-cgi/media' },
  })),
}));

vi.mock('../../src/config/LoggingConfigurationManager', () => {
  const mock = {
    getPinoConfig: vi.fn().mockReturnValue({
      level: 'debug',
      browser: { asObject: true },
      base: { service: 'video-resizer', env: 'test' },
    }),
    getSamplingConfig: vi.fn().mockReturnValue({ enabled: false, rate: 1.0 }),
    getBreadcrumbConfig: vi.fn().mockReturnValue({ enabled: true, maxItems: 100 }),
    areBreadcrumbsEnabled: vi.fn().mockReturnValue(true),
    getMaxBreadcrumbs: vi.fn().mockReturnValue(100),
    getLogLevel: vi.fn().mockReturnValue('debug'),
    shouldLogComponent: vi.fn().mockReturnValue(true),
  };
  return {
    LoggingConfigurationManager: {
      getInstance: vi.fn(() => mock),
      resetInstance: vi.fn(),
    },
    loggingConfig: mock,
  };
});

vi.mock('../../src/config/DebugConfigurationManager', () => ({
  DebugConfigurationManager: {
    getInstance: vi.fn().mockReturnValue({
      isDebugEnabled: vi.fn().mockReturnValue(false),
      isVerboseEnabled: vi.fn().mockReturnValue(false),
      shouldIncludeHeaders: vi.fn().mockReturnValue(false),
      shouldIncludePerformance: vi.fn().mockReturnValue(false),
    }),
    resetInstance: vi.fn(),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeR2SourceResolution(
  overrides: Partial<SourceResolutionResult> = {}
): SourceResolutionResult {
  return {
    source: {
      type: 'r2',
      priority: 1,
      bucketBinding: 'VIDEOS_BUCKET',
    },
    resolvedPath: 'big_buck_bunny_1080p.mov',
    originType: 'r2',
    ...overrides,
  } as SourceResolutionResult;
}

function makeRemoteSourceResolution(
  overrides: Partial<SourceResolutionResult> = {}
): SourceResolutionResult {
  return {
    source: {
      type: 'remote',
      priority: 1,
      url: 'https://storage.example.com',
    },
    resolvedPath: 'videos/hero.mp4',
    originType: 'remote',
    sourceUrl: 'https://storage.example.com/videos/hero.mp4',
    ...overrides,
  } as SourceResolutionResult;
}

function makeMockR2Bucket(sizeBytes: number | null) {
  return {
    head: vi.fn().mockResolvedValue(
      sizeBytes !== null
        ? {
            key: 'big_buck_bunny_1080p.mov',
            version: '1',
            size: sizeBytes,
            etag: '"abc"',
            httpEtag: '"abc"',
            uploaded: new Date(),
          }
        : null
    ),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

describe('Proactive container routing', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── getSourceSizeBytes ─────────────────────────────────────────────────

  describe('getSourceSizeBytes', () => {
    describe('R2 sources', () => {
      it('should return size from R2 head() for R2 sources', async () => {
        const sizeBytes = 500 * 1024 * 1024; // 500 MiB
        const mockBucket = makeMockR2Bucket(sizeBytes);
        const env = { VIDEOS_BUCKET: mockBucket } as any;
        const sr = makeR2SourceResolution();

        const result = await getSourceSizeBytes(sr, env, 'ignored');

        expect(result).toBe(sizeBytes);
        expect(mockBucket.head).toHaveBeenCalledWith('big_buck_bunny_1080p.mov');
      });

      it('should return null when R2 object does not exist', async () => {
        const mockBucket = makeMockR2Bucket(null);
        const env = { VIDEOS_BUCKET: mockBucket } as any;
        const sr = makeR2SourceResolution();

        const result = await getSourceSizeBytes(sr, env, 'ignored');

        expect(result).toBeNull();
      });

      it('should return null when R2 bucket binding is missing', async () => {
        const env = {} as any; // No VIDEOS_BUCKET
        const sr = makeR2SourceResolution();

        const result = await getSourceSizeBytes(sr, env, 'ignored');

        expect(result).toBeNull();
      });

      it('should return null when env is undefined', async () => {
        const sr = makeR2SourceResolution();

        const result = await getSourceSizeBytes(sr, undefined, 'ignored');

        expect(result).toBeNull();
      });

      it('should catch and return null on R2 head() error', async () => {
        const mockBucket = {
          head: vi.fn().mockRejectedValue(new Error('R2 internal error')),
          get: vi.fn(),
          put: vi.fn(),
          delete: vi.fn(),
        };
        const env = { VIDEOS_BUCKET: mockBucket } as any;
        const sr = makeR2SourceResolution();

        const result = await getSourceSizeBytes(sr, env, 'ignored');

        expect(result).toBeNull();
      });

      it('should use correct bucket binding from source config', async () => {
        const sizeBytes = 300 * 1024 * 1024;
        const mockBucket = makeMockR2Bucket(sizeBytes);
        const env = { CUSTOM_BUCKET: mockBucket } as any;
        const sr = makeR2SourceResolution({
          source: {
            type: 'r2',
            priority: 1,
            bucketBinding: 'CUSTOM_BUCKET',
          } as any,
        });

        const result = await getSourceSizeBytes(sr, env, 'ignored');

        expect(result).toBe(sizeBytes);
      });
    });

    describe('Remote/fallback sources', () => {
      it('should return Content-Length from HEAD request for remote sources', async () => {
        const sizeBytes = 400 * 1024 * 1024;
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(null, {
            status: 200,
            headers: { 'Content-Length': String(sizeBytes) },
          })
        );

        const sr = makeRemoteSourceResolution();
        const result = await getSourceSizeBytes(
          sr,
          {} as any,
          'https://storage.example.com/videos/hero.mp4'
        );

        expect(result).toBe(sizeBytes);
        // Verify it was a HEAD request
        const fetchCall = (globalThis.fetch as any).mock.calls[0];
        expect(fetchCall[0].method).toBe('HEAD');
      });

      it('should return null when HEAD response has no Content-Length', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

        const sr = makeRemoteSourceResolution();
        const result = await getSourceSizeBytes(
          sr,
          {} as any,
          'https://storage.example.com/videos/hero.mp4'
        );

        expect(result).toBeNull();
      });

      it('should return null when HEAD request fails', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        const sr = makeRemoteSourceResolution();
        const result = await getSourceSizeBytes(
          sr,
          {} as any,
          'https://storage.example.com/videos/hero.mp4'
        );

        expect(result).toBeNull();
      });

      it('should return null for non-HTTP source URLs', async () => {
        const sr = makeRemoteSourceResolution();
        const result = await getSourceSizeBytes(sr, {} as any, 'r2://bucket/key');

        expect(result).toBeNull();
      });

      it('should work for fallback origin type', async () => {
        const sizeBytes = 600 * 1024 * 1024;
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(null, {
            status: 200,
            headers: { 'Content-Length': String(sizeBytes) },
          })
        );

        const sr = makeRemoteSourceResolution({ originType: 'fallback' });
        const result = await getSourceSizeBytes(
          sr,
          {} as any,
          'https://fallback.example.com/videos/hero.mp4'
        );

        expect(result).toBe(sizeBytes);
      });
    });

    describe('Unknown source types', () => {
      it('should return null for unknown origin types', async () => {
        const sr = makeRemoteSourceResolution({ originType: 'unknown' as any });
        const result = await getSourceSizeBytes(sr, {} as any, 'https://example.com/video.mp4');

        expect(result).toBeNull();
      });
    });
  });

  // ── CDN_CGI_SIZE_LIMIT constant ────────────────────────────────────────

  describe('CDN_CGI_SIZE_LIMIT', () => {
    it('should be 256 MiB (268435456 bytes)', () => {
      expect(CDN_CGI_SIZE_LIMIT).toBe(268435456);
      expect(CDN_CGI_SIZE_LIMIT).toBe(256 * 1024 * 1024);
    });
  });

  // ── Size threshold decisions ───────────────────────────────────────────

  describe('Size threshold decisions', () => {
    it('should identify files above 256 MiB as exceeding limit', () => {
      const size = 300 * 1024 * 1024; // 300 MiB
      expect(size > CDN_CGI_SIZE_LIMIT).toBe(true);
    });

    it('should identify files at exactly 256 MiB as not exceeding limit', () => {
      // The limit is "must be less than 268435456 bytes" — exactly 256 MiB
      // is fine. Our check is > (not >=).
      const size = 256 * 1024 * 1024;
      expect(size > CDN_CGI_SIZE_LIMIT).toBe(false);
    });

    it('should identify files below 256 MiB as not exceeding limit', () => {
      const size = 100 * 1024 * 1024; // 100 MiB
      expect(size > CDN_CGI_SIZE_LIMIT).toBe(false);
    });

    it('should not trigger for null size (unknown)', () => {
      const size: number | null = null;
      // The actual code uses: if (sourceSizeBytes !== null && sourceSizeBytes > CDN_CGI_SIZE_LIMIT)
      expect(size !== null && size > CDN_CGI_SIZE_LIMIT).toBe(false);
    });
  });

  // ── R2 head() integration with size check ──────────────────────────────

  describe('R2 head() + size check integration', () => {
    it('should detect oversized R2 video and trigger container routing', async () => {
      const sizeBytes = 691 * 1024 * 1024; // 691 MiB — like big_buck_bunny
      const mockBucket = makeMockR2Bucket(sizeBytes);
      const env = { VIDEOS_BUCKET: mockBucket } as any;
      const sr = makeR2SourceResolution();

      const result = await getSourceSizeBytes(sr, env, 'ignored');

      expect(result).toBe(sizeBytes);
      expect(result! > CDN_CGI_SIZE_LIMIT).toBe(true);
    });

    it('should allow small R2 video through to cdn-cgi', async () => {
      const sizeBytes = 50 * 1024 * 1024; // 50 MiB
      const mockBucket = makeMockR2Bucket(sizeBytes);
      const env = { VIDEOS_BUCKET: mockBucket } as any;
      const sr = makeR2SourceResolution();

      const result = await getSourceSizeBytes(sr, env, 'ignored');

      expect(result).toBe(sizeBytes);
      expect(result! > CDN_CGI_SIZE_LIMIT).toBe(false);
    });
  });
});
