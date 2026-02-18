/**
 * Tests for imqueryHandler.ts — IMQuery derivative handling logic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleIMQueryDerivative,
  IMQueryHandlerResult,
} from '../../../src/services/transformation/imqueryHandler';

// Mock getDerivativeDimensions
const mockGetDerivativeDimensions = vi.fn();
vi.mock('../../../src/utils/imqueryUtils', () => ({
  getDerivativeDimensions: (...args: any[]) => mockGetDerivativeDimensions(...args),
}));

// Mock buildCdnCgiMediaUrlAsync
const mockBuildCdnCgiMediaUrlAsync = vi.fn();
vi.mock('../../../src/utils/pathUtils', () => ({
  buildCdnCgiMediaUrlAsync: (...args: any[]) => mockBuildCdnCgiMediaUrlAsync(...args),
}));

// Mock addVersionToUrl
const mockAddVersionToUrl = vi.fn();
vi.mock('../../../src/utils/urlVersionUtils', () => ({
  addVersionToUrl: (...args: any[]) => mockAddVersionToUrl(...args),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createCategoryLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithContext: vi.fn(),
  })),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logErrorWithContext: vi.fn(),
}));

// Mock requestContext
const mockAddBreadcrumb = vi.fn();
vi.mock('../../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn().mockReturnValue(null),
  addBreadcrumb: (...args: any[]) => mockAddBreadcrumb(...args),
  createRequestContext: vi.fn(),
  setCurrentContext: vi.fn(),
}));

// Helpers: create minimal test objects
function makeUrl(path: string, params?: Record<string, string>): URL {
  const url = new URL(`https://cdn.example.com${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return url;
}

function makeOptions(overrides: Record<string, any> = {}) {
  return {
    width: 480,
    height: 270,
    derivative: null as string | null,
    ...overrides,
  };
}

function makeCdnParams(overrides: Record<string, any> = {}) {
  return {
    width: 480,
    height: 270,
    format: 'mp4',
    ...overrides,
  };
}

function makeCacheConfig(overrides: Record<string, any> = {}) {
  return {
    cacheability: false,
    videoCompression: 'auto',
    ttl: { ok: 86400, redirects: 3600, clientError: 60, serverError: 0 },
    ...overrides,
  };
}

function makeDiagnosticsInfo(overrides: Record<string, any> = {}) {
  return {
    originalUrl: 'https://cdn.example.com/videos/test.mp4?imwidth=480',
    transformParams: { width: 480, height: 270 },
    cacheVersion: 1,
    ...overrides,
  };
}

describe('IMQuery Handler — handleIMQueryDerivative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildCdnCgiMediaUrlAsync.mockResolvedValue(
      '/cdn-cgi/media/width=854,height=640,format=mp4/https://origin.example.com/videos/test.mp4'
    );
    mockAddVersionToUrl.mockImplementation((url: string, version: number) => `${url}?v=${version}`);
    mockGetDerivativeDimensions.mockReturnValue(null);
  });

  describe('non-IMQuery requests (should return handled=false)', () => {
    it('should return handled=false when no imwidth/imheight params are present', async () => {
      const url = makeUrl('/videos/test.mp4');
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();

      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(result.handled).toBe(false);
      expect(result.result).toBeUndefined();
    });

    it('should return handled=false when imwidth is present but no derivative', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: null });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();

      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(result.handled).toBe(false);
    });

    it('should return handled=false when derivative exists but no imquery params', async () => {
      const url = makeUrl('/videos/test.mp4');
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();

      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(result.handled).toBe(false);
    });
  });

  describe('IMQuery with derivative but no dimensions found', () => {
    it('should return handled=false when getDerivativeDimensions returns null', async () => {
      mockGetDerivativeDimensions.mockReturnValue(null);

      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'nonexistent' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();

      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(result.handled).toBe(false);
      expect(mockGetDerivativeDimensions).toHaveBeenCalledWith('nonexistent');
    });
  });

  describe('successful IMQuery derivative handling', () => {
    beforeEach(() => {
      mockGetDerivativeDimensions.mockReturnValue({ width: 854, height: 640 });
    });

    it('should return handled=true with correct result for imwidth request', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile', width: 480 });
      const cdnParams = makeCdnParams({ width: 480, height: 270 });
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();
      const videoUrl = 'https://origin.example.com/videos/test.mp4';

      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        videoUrl,
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(result.handled).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result!.derivative).toBe('mobile');
      expect(result.result!.source).toBe('r2');
      expect(result.result!.originSourceUrl).toBe(videoUrl);
      expect(result.result!.cacheConfig).toBe(cacheConfig);
    });

    it('should replace cdnParams dimensions with derivative dimensions', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile', width: 480 });
      const cdnParams = makeCdnParams({ width: 480, height: 270 });
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      // cdnParams should be mutated to derivative dimensions
      expect(cdnParams.width).toBe(854);
      expect(cdnParams.height).toBe(640);
    });

    it('should force cacheability to true for IMQuery derivatives', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '1000' });
      const options = makeOptions({ derivative: 'tablet' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig({ cacheability: false });
      const diagnosticsInfo = makeDiagnosticsInfo();

      mockGetDerivativeDimensions.mockReturnValue({ width: 1280, height: 720 });

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(cacheConfig.cacheability).toBe(true);
    });

    it('should not change cacheability if already true', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig({ cacheability: true });
      const diagnosticsInfo = makeDiagnosticsInfo();

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(cacheConfig.cacheability).toBe(true);
    });

    it('should call buildCdnCgiMediaUrlAsync with updated params', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams({ width: 480, height: 270, format: 'mp4' });
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();
      const videoUrl = 'https://origin.example.com/videos/test.mp4';
      const pathPattern = {
        name: 'videos',
        matcher: '/videos/*',
        processPath: true,
        baseUrl: null,
        originUrl: null,
      };

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        videoUrl,
        cacheConfig,
        diagnosticsInfo,
        undefined,
        pathPattern as any,
        null,
        'r2'
      );

      expect(mockBuildCdnCgiMediaUrlAsync).toHaveBeenCalledWith(
        cdnParams,
        videoUrl,
        url.toString(),
        undefined,
        pathPattern
      );
    });

    it('should work with imheight instead of imwidth', async () => {
      const url = makeUrl('/videos/test.mp4', { imheight: '270' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();

      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(result.handled).toBe(true);
      expect(result.result!.derivative).toBe('mobile');
    });
  });

  describe('cache version application', () => {
    beforeEach(() => {
      mockGetDerivativeDimensions.mockReturnValue({ width: 854, height: 640 });
    });

    it('should not apply version when cacheVersion is 1', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo({ cacheVersion: 1 });

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(mockAddVersionToUrl).not.toHaveBeenCalled();
    });

    it('should apply version when cacheVersion > 1', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo({ cacheVersion: 3 });

      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(mockAddVersionToUrl).toHaveBeenCalledWith(expect.any(String), 3);
      // The result URL should be the versioned URL
      expect(result.result!.cdnCgiUrl).toContain('?v=3');
    });

    it('should not apply version when cacheVersion is undefined', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo({ cacheVersion: undefined });

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(mockAddVersionToUrl).not.toHaveBeenCalled();
    });
  });

  describe('diagnostics updates', () => {
    beforeEach(() => {
      mockGetDerivativeDimensions.mockReturnValue({ width: 1920, height: 1080 });
    });

    it('should update diagnosticsInfo.transformParams with derivative dimensions', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '1500' });
      const options = makeOptions({ derivative: 'desktop', width: 1500 });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo({
        transformParams: { width: 1500, height: null },
      });

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(diagnosticsInfo.transformParams.width).toBe(1920);
      expect(diagnosticsInfo.transformParams.height).toBe(1080);
    });

    it('should populate diagnosticsInfo.imqueryParams', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '1500' });
      const options = makeOptions({ derivative: 'desktop', width: 1500 });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo() as any;

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(diagnosticsInfo.imqueryParams).toBeDefined();
      expect(diagnosticsInfo.imqueryParams.requestedWidth).toBe(1500);
      expect(diagnosticsInfo.imqueryParams.mappedToDerivative).toBe('desktop');
      expect(diagnosticsInfo.imqueryParams.actualWidth).toBe(1920);
      expect(diagnosticsInfo.imqueryParams.actualHeight).toBe(1080);
    });

    it('should handle missing transformParams in diagnosticsInfo gracefully', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo({ transformParams: undefined });

      mockGetDerivativeDimensions.mockReturnValue({ width: 854, height: 640 });

      // Should not throw
      const result = await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(result.handled).toBe(true);
    });
  });

  describe('breadcrumb tracking', () => {
    beforeEach(() => {
      mockGetDerivativeDimensions.mockReturnValue({ width: 854, height: 640 });
    });

    it('should add breadcrumb when requestContext is provided', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();
      const requestContext = {
        requestId: 'test-123',
        url: url.toString(),
        startTime: Date.now(),
        breadcrumbs: [],
        diagnostics: {},
        componentTiming: {},
        debugEnabled: false,
        verboseEnabled: false,
      };

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        requestContext as any,
        'r2'
      );

      expect(mockAddBreadcrumb).toHaveBeenCalledWith(
        requestContext,
        'Transform',
        'Applied derivative dimensions',
        expect.objectContaining({
          derivative: 'mobile',
          derivativeWidth: 854,
          derivativeHeight: 640,
        })
      );
    });

    it('should not add breadcrumb when requestContext is null', async () => {
      const url = makeUrl('/videos/test.mp4', { imwidth: '480' });
      const options = makeOptions({ derivative: 'mobile' });
      const cdnParams = makeCdnParams();
      const cacheConfig = makeCacheConfig();
      const diagnosticsInfo = makeDiagnosticsInfo();

      await handleIMQueryDerivative(
        url,
        options,
        cdnParams,
        'https://origin.example.com/videos/test.mp4',
        cacheConfig,
        diagnosticsInfo,
        undefined,
        null,
        null,
        'r2'
      );

      expect(mockAddBreadcrumb).not.toHaveBeenCalled();
    });
  });
});
