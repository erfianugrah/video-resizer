import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponseBuilder } from '../../src/utils/responseBuilder';
import { createRequestContext } from '../../src/utils/requestContext';

describe('ResponseBuilder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should create a basic response with default headers', async () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder.build();

    expect(finalResponse.status).toBe(200);
    expect(await finalResponse.text()).toBe('test content');
  });

  it('should apply caching headers correctly', async () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const cacheConfig = {
      cacheability: true,
      ttl: {
        ok: 3600,
        redirects: 300,
        clientError: 60,
        serverError: 10,
      },
    };

    const finalResponse = await responseBuilder
      .withCaching(200, cacheConfig, 'test-source', 'test-derivative')
      .build();

    expect(finalResponse.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(context.diagnostics.cacheTtl).toBe(3600);
    expect(context.diagnostics.transformSource).toBe('test-source');
    expect(context.diagnostics.derivative).toBe('test-derivative');
  });

  it('should apply debug headers when debug is enabled', async () => {
    const mockRequest = new Request('https://example.com/video.mp4?debug=true');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder.build();

    expect(finalResponse.headers.get('X-Video-Resizer-Debug')).toBe('true');
    expect(finalResponse.headers.get('X-Request-ID')).toBe(context.requestId);
    expect(finalResponse.headers.get('X-Processing-Time-Ms')).toBeDefined();
    expect(finalResponse.headers.get('X-Breadcrumbs-Count')).toBe('0');
  });

  it('should add custom headers', async () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder
      .withHeaders({
        'X-Custom-Header': 'custom value',
        'X-Another-Header': 'another value',
      })
      .build();

    expect(finalResponse.headers.get('X-Custom-Header')).toBe('custom value');
    expect(finalResponse.headers.get('X-Another-Header')).toBe('another value');
  });

  it('should add CDN error information', async () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder
      .withCdnErrorInfo(400, 'Bad Request', 'https://original.example.com/video.mp4')
      .build();

    expect(finalResponse.headers.get('X-CDN-Error-Status')).toBe('400');
    expect(finalResponse.headers.get('X-CDN-Error-Response')).toBe('Bad Request');
    expect(finalResponse.headers.get('X-Original-Source-URL')).toBe(
      'https://original.example.com/video.mp4'
    );

    expect(context.diagnostics.cdnErrorStatus).toBe(400);
    expect(context.diagnostics.cdnErrorResponse).toBe('Bad Request');
    expect(context.diagnostics.originalSourceUrl).toBe('https://original.example.com/video.mp4');
  });

  it('should correctly handle range requests - 206 status', async () => {
    const mockRequest = new Request('https://example.com/video.mp4', {
      headers: {
        Range: 'bytes=0-1023',
      },
    });
    const context = createRequestContext(mockRequest);

    // Store original request headers in diagnostics
    context.diagnostics.originalRequestHeaders = {
      Range: 'bytes=0-1023',
    };

    // Create a 206 Partial Content response
    const mockResponse = new Response('partial content', {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-1023/10240',
        'Content-Length': '1024',
        'Accept-Ranges': 'bytes',
      },
    });

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder.build();

    // Verify the response has the correct status and headers
    expect(finalResponse.status).toBe(206);
    expect(finalResponse.headers.get('Content-Range')).toBe('bytes 0-1023/10240');
    expect(finalResponse.headers.get('Content-Length')).toBe('1024');
    expect(finalResponse.headers.get('Accept-Ranges')).toBe('bytes');
    expect(finalResponse.headers.get('Content-Type')).toBe('video/mp4');

    // Check diagnostics values
    expect(context.diagnostics.isRangeRequest).toBe(true);
    expect(context.diagnostics.originalRequestHadRange).toBe(true);
  });

  it('should add Accept-Ranges header for video content', async () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);

    // Create a normal 200 response with video content type
    const mockResponse = new Response('video content', {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '10240',
      },
    });

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder.build();

    // Verify the response has Accept-Ranges header
    expect(finalResponse.headers.get('Accept-Ranges')).toBe('bytes');
    expect(context.diagnostics.isMediaContent).toBe(true);
  });

  it('should add origin information headers', async () => {
    const mockRequest = new Request('https://example.com/videos/sample.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    // Create origin information
    const originInfo = {
      name: 'videos',
      matcher: '^/videos/(.+)$',
      capturedParams: {
        videoId: 'sample.mp4',
        '1': 'sample.mp4',
      },
      processPath: true,
    };

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder.withOriginInfo(originInfo).build();

    // Verify the response has origin headers
    expect(finalResponse.headers.get('X-Origin-Name')).toBe('videos');
    expect(finalResponse.headers.get('X-Origin-Matcher')).toBe('^/videos/(.+)$');
    expect(finalResponse.headers.get('X-Origin-Captured-Params')).toBe(
      JSON.stringify(originInfo.capturedParams)
    );
    expect(finalResponse.headers.get('X-Handler')).toBe('Origins');

    // Check diagnostics values
    expect(context.diagnostics.origin).toEqual(originInfo);
  });

  it('should add source resolution information headers', async () => {
    const mockRequest = new Request('https://example.com/videos/sample.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    // Create source resolution information
    const sourceInfo = {
      type: 'remote',
      resolvedPath: 'videos/sample.mp4',
      url: 'https://storage.example.com/videos/sample.mp4',
      source: {
        type: 'remote',
        priority: 1,
        url: 'https://storage.example.com',
        path: 'videos/${videoId}',
      },
    };

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder.withOriginInfo(undefined, sourceInfo).build();

    // Verify the response has source headers
    expect(finalResponse.headers.get('X-Source-Type')).toBe('remote');
    expect(finalResponse.headers.get('X-Source-Path')).toBe('videos/sample.mp4');
    // Note: X-Source-URL is intentionally not set in withOriginInfo() for security reasons
    // (source URLs are not exposed in response headers, only in diagnostics)
    expect(finalResponse.headers.get('X-Source-URL')).toBeNull();
    expect(finalResponse.headers.get('X-Handler')).toBe('Origins');

    // Check diagnostics values
    expect(context.diagnostics.sourceResolution).toEqual(sourceInfo);
  });

  it('should add both origin and source information headers', async () => {
    const mockRequest = new Request('https://example.com/videos/sample.mp4');
    const context = createRequestContext(mockRequest);
    const mockResponse = new Response('test content');

    // Create origin and source information
    const originInfo = {
      name: 'videos',
      matcher: '^/videos/(.+)$',
      capturedParams: {
        videoId: 'sample.mp4',
        '1': 'sample.mp4',
      },
    };

    const sourceInfo = {
      type: 'r2',
      resolvedPath: 'videos/sample.mp4',
      source: {
        type: 'r2',
        priority: 1,
        bucketBinding: 'VIDEOS_BUCKET',
        path: 'videos/${videoId}',
      },
    };

    const responseBuilder = new ResponseBuilder(mockResponse, context);
    const finalResponse = await responseBuilder.withOriginInfo(originInfo, sourceInfo).build();

    // Verify the response has both origin and source headers
    expect(finalResponse.headers.get('X-Origin-Name')).toBe('videos');
    expect(finalResponse.headers.get('X-Origin-Matcher')).toBe('^/videos/(.+)$');
    expect(finalResponse.headers.get('X-Source-Type')).toBe('r2');
    expect(finalResponse.headers.get('X-Source-Path')).toBe('videos/sample.mp4');
    expect(finalResponse.headers.get('X-Handler')).toBe('Origins');

    // Check diagnostics values
    expect(context.diagnostics.origin).toEqual(originInfo);
    expect(context.diagnostics.sourceResolution).toEqual(sourceInfo);
  });

  it('should create origin error response with proper status and headers', () => {
    // Create a mock error that simulates an OriginError
    const mockError = {
      name: 'OriginResolutionError',
      message: 'No matching origin found for path: /invalid/path',
      errorType: 'ORIGIN_NOT_FOUND',
      getStatusCode: () => 404,
      context: {
        parameters: {
          path: '/invalid/path',
          availableOrigins: ['videos', 'images'],
        },
        originName: 'unknown',
      },
    };

    // Create an error response
    const responseBuilder = ResponseBuilder.createOriginErrorResponse(mockError, true);

    // Check response headers
    const headers = responseBuilder['headers']; // Access private property for testing

    expect(headers.get('X-Error-Type')).toBe('ORIGIN_NOT_FOUND');
    expect(headers.get('X-Error-Name')).toBe('OriginResolutionError');
    expect(headers.get('X-Origin-Name')).toBe('unknown');
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
