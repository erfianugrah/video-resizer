/**
 * Test utilities for video-resizer
 */
import { vi } from 'vitest';
import { PathPattern } from '../../src/utils/pathUtils';
import { EnvironmentConfig } from '../../src/config/environmentConfig';
import { VideoTransformOptions } from '../../src/domain/commands/TransformVideoCommand';
import { DebugInfo } from '../../src/utils/debugHeadersUtils';

/**
 * Create a mock request object
 * @param url The URL to request
 * @param method The HTTP method to use
 * @param headers Optional headers
 * @param body Optional request body
 * @returns A Request object
 */
export function createMockRequest(
  url: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string | ReadableStream | Blob | FormData | URLSearchParams | null
): Request {
  const requestInit: RequestInit = {
    method,
    headers,
    body,
  };

  return new Request(url, requestInit);
}

/**
 * Create a mock environment configuration
 * @param options Optional configuration options to override defaults
 * @returns A mock configuration object
 */
export function createMockConfig(options?: Partial<EnvironmentConfig>): EnvironmentConfig {
  return {
    mode: 'development',
    version: '1.0.0',
    isProduction: false,
    isStaging: false,
    isDevelopment: true,
    debug: {
      enabled: true,
      verbose: true,
      includeHeaders: true,
      includePerformance: false,
      allowedIps: [],
      excludedPaths: [],
    },
    cache: {
      debug: false,
      defaultTtl: 86400,
      respectOrigin: false,
      cacheEverything: true,
      enableTags: true,
      purgeOnUpdate: false,
      bypassParams: [],
      enableKVCache: true,
      kvReadCacheTtl: 30,
      kvTtl: {
        ok: 86400,
        redirects: 3600,
        clientError: 60,
        serverError: 10,
      },
    },
    pathPatterns: createMockPathPatterns(),
    ...options,
  } as EnvironmentConfig;
}

/**
 * Create mock path patterns for testing
 * @returns An array of path patterns
 */
export function createMockPathPatterns(): PathPattern[] {
  return [
    {
      name: 'videos',
      matcher: '^/videos/',
      processPath: true,
      baseUrl: null,
      originUrl: null,
    },
    {
      name: 'custom',
      matcher: '^/custom/',
      processPath: true,
      baseUrl: null,
      originUrl: 'https://videos.example.com',
    },
    {
      name: 'assets',
      matcher: '^/assets/videos/',
      processPath: false, // This one should be skipped
      baseUrl: null,
      originUrl: null,
    },
    {
      name: 'advanced',
      matcher: '^/v/([a-z0-9]+)(?:/.*)?$',
      processPath: true,
      baseUrl: null,
      originUrl: 'https://videos.example.com',
      captureGroups: ['videoId'],
      priority: 10,
    },
    {
      name: 'features',
      matcher: '^/features/([a-z0-9-]+)',
      processPath: true,
      baseUrl: null,
      originUrl: 'https://videos.example.com/special',
      quality: 'high',
      cacheTtl: 3600,
    },
  ];
}

/**
 * Create a mock debug info object
 * @param options Optional debug options to override defaults
 * @returns A debug info object
 */
export function createMockDebugInfo(options?: Partial<DebugInfo>): DebugInfo {
  return {
    isEnabled: true,
    isVerbose: true,
    includeHeaders: true,
    includePerformance: true,
    ...options,
  };
}

/**
 * Create mock video transform options
 * @param options Optional options to override defaults
 * @returns Video transform options
 */
export function createMockVideoOptions(
  options?: Partial<VideoTransformOptions>
): VideoTransformOptions {
  return {
    width: 854,
    height: 480,
    mode: 'video',
    fit: 'contain',
    audio: true,
    ...options,
  };
}

/**
 * Create a mock response for testing
 * @param body Response body
 * @param status HTTP status code
 * @param headers Response headers
 * @returns A Response object
 */
export function createMockResponse(
  body: string | ReadableStream | Blob | ArrayBuffer = '',
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers,
  });
}

/**
 * Wait for a response and extract its text
 * @param responsePromise Promise that resolves to a Response
 * @returns The response text
 */
export async function getResponseText(responsePromise: Promise<Response>): Promise<string> {
  const response = await responsePromise;
  return await response.text();
}

/**
 * Extract URL from fetch calls
 * @param fetchSpy A jest/vitest spy on the fetch function
 * @returns The URL that was fetched
 */
export function getLastFetchedUrl(fetchSpy: unknown): string {
  if (!fetchSpy || typeof fetchSpy !== 'function' || !('mock' in fetchSpy)) {
    return '';
  }

  const mockFn = fetchSpy as { mock: { calls: Array<Array<unknown>> } };
  if (!mockFn.mock || !mockFn.mock.calls || !mockFn.mock.calls.length) {
    return '';
  }

  const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
  if (!lastCall || !lastCall.length) {
    return '';
  }

  const firstArg = lastCall[0];
  if (typeof firstArg === 'string') {
    return firstArg;
  }

  if (firstArg instanceof Request) {
    return firstArg.url;
  }

  if (firstArg && typeof firstArg === 'object' && 'toString' in firstArg) {
    return String(firstArg);
  }

  return '';
}

/**
 * Mock the global fetch function with a custom response
 * @param responseBody Response body
 * @param status HTTP status code
 * @param headers Response headers
 * @returns The fetch spy
 */
export function mockFetch(
  responseBody: string = 'Mock response',
  status = 200,
  headers: Record<string, string> = { 'Content-Type': 'text/plain' }
): any {
  // Create a mock response with the given parameters
  return vi.spyOn(global, 'fetch').mockImplementation((input) => {
    // Store the input URL for assertions in tests
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);

    // Add debugging info to the response
    const allHeaders = { ...headers, 'X-Requested-URL': url };
    const debugResponse = createMockResponse(responseBody, status, allHeaders);

    return Promise.resolve(debugResponse);
  });
}

/**
 * Create a mock Headers object from an object
 * @param headerMap Object with header name-value pairs
 * @returns Headers object
 */
export function createMockHeaders(headerMap: Record<string, string> = {}): Headers {
  const headers = new Headers();
  Object.entries(headerMap).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return headers;
}

/**
 * Generate a random video ID for testing
 * @param length Length of the video ID (default: 11)
 * @returns Random video ID
 */
export function generateRandomVideoId(length = 11): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

/**
 * Generate test case variations for parameterized tests
 * @param baseOptions Base option object
 * @param variations Variations of specific fields
 * @returns Array of test cases
 */
export function generateTestCases<T extends Record<string, unknown>>(
  baseOptions: T,
  variations: Record<string, unknown[]>
): Array<T & { name: string }> {
  const result: Array<T & { name: string }> = [];

  // Get all fields that have variations
  const fields = Object.keys(variations);

  // Helper function to generate combinations recursively
  function generateCombinations(
    current: Record<string, unknown>,
    depth: number,
    name: string[]
  ): void {
    if (depth === fields.length) {
      // We've assigned values to all fields with variations
      result.push({
        ...baseOptions,
        ...current,
        name: name.join(' + '),
      });
      return;
    }

    // For the current field, try each variation
    const field = fields[depth];
    const values = variations[field];

    for (const value of values) {
      const newCurrent = { ...current, [field]: value };
      const label = `${field}=${String(value)}`;
      generateCombinations(newCurrent, depth + 1, [...name, label]);
    }
  }

  // Start the recursion
  generateCombinations({}, 0, []);
  return result;
}

/**
 * Mock implementation of Cloudflare's cache API
 */
export class MockCache {
  private store = new Map<string, Response>();

  async put(request: Request | string, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url;
    // We need to clone the response since it can only be used once
    const clonedResponse = response.clone();
    this.store.set(key, clonedResponse);
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    const response = this.store.get(key);
    return response ? response.clone() : undefined;
  }

  async delete(request: Request | string): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.delete(key);
  }
}

/**
 * Setup mock CF Runtime API
 * @returns Mock CF object
 */
export function setupMockCf() {
  const mockCache = new MockCache();

  // Create a mock CF object
  const mockCf = {
    caches: {
      default: mockCache,
    },
    env: {} as Record<string, unknown>,
    waitUntil: vi.fn(),
  };

  // Make the CF object available globally
  (global as any).caches = mockCf.caches as unknown as CacheStorage;

  return mockCf;
}
