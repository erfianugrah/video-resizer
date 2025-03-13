/**
 * Test utilities for video-resizer
 */
import { PathPattern } from '../../src/utils/pathUtils';

/**
 * Create a mock request object
 * @param url The URL to request
 * @param method The HTTP method to use
 * @param headers Optional headers
 * @returns A Request object
 */
export function createMockRequest(
  url: string, 
  method = 'GET', 
  headers: Record<string, string> = {}
): Request {
  const requestInit: RequestInit = {
    method,
    headers,
  };
  
  return new Request(url, requestInit);
}

/**
 * Create a mock environment configuration
 * @param pathPatterns Optional path patterns to include
 * @param debug Optional debug configuration
 * @returns A mock configuration object
 */
export function createMockConfig(
  pathPatterns: PathPattern[] = [],
  debug = { enabled: true, verbose: true }
): Record<string, unknown> {
  return {
    mode: 'development',
    isProduction: false,
    isStaging: false,
    isDevelopment: true,
    debug,
    pathPatterns
  };
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
    }
  ];
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