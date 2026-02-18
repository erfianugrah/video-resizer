// KV Cache Testing setup file
import { vi, beforeEach } from 'vitest';

// Mock environment configuration
vi.mock('../../src/config', () => {
  const cacheConfig = {
    enableKVCache: true,
    ttl: {
      ok: 86400,
      redirects: 3600,
      clientError: 60,
      serverError: 10,
    },
  };

  return {
    getCacheConfig: vi.fn((env) => {
      // Log the environment variables when called
      console.debug('Mock getCacheConfig called with env:', env);

      // Return based on environment
      if (env && env.CACHE_ENABLE_KV === 'true') {
        return {
          ...cacheConfig,
          enableKVCache: true,
        };
      }

      return cacheConfig;
    }),
    getVideoPathPatterns: vi.fn(() => [
      {
        pattern: '/videos/:path',
        ttl: 86400,
        cacheTag: 'video',
      },
    ]),
    CacheConfigurationManager: {
      getInstance: vi.fn(() => ({
        getConfig: vi.fn(() => ({
          defaultMaxAge: 86400,
          method: 'cf',
          enableCacheTags: true,
          enableKVCache: true,
        })),
      })),
    },
  };
});

// Mock Pino logger
vi.mock('../../src/utils/pinoLogger', () => {
  return {
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    })),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
});

// Mock KV namespace
class MockKVNamespace implements KVNamespace {
  private store: Map<string, ArrayBuffer> = new Map();
  private metadata: Map<string, any> = new Map();

  async put(key: string, value: ArrayBuffer | string, options?: any): Promise<void> {
    const buffer = typeof value === 'string' ? new TextEncoder().encode(value) : value;

    this.store.set(key, buffer);

    if (options?.metadata) {
      this.metadata.set(key, options.metadata);
    }
  }

  async get(key: string, options?: any): Promise<any> {
    if (options === 'arrayBuffer' || options?.type === 'arrayBuffer') {
      return this.store.get(key) || null;
    }

    const buffer = this.store.get(key);
    if (!buffer) return null;

    if (options === 'text' || options?.type === 'text') {
      return new TextDecoder().decode(buffer);
    }

    if (options === 'json' || options?.type === 'json') {
      const text = new TextDecoder().decode(buffer);
      return JSON.parse(text);
    }

    return buffer;
  }

  async getWithMetadata<T = any>(key: string, type?: string): Promise<{ value: any; metadata: T }> {
    const value = await this.get(key, type);
    const metadata = this.metadata.get(key) as T;
    return { value, metadata };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.metadata.delete(key);
  }

  async list(
    options?: any
  ): Promise<{
    keys: { name: string; expiration?: number; metadata?: any }[];
    list_complete: boolean;
    cursor: string;
  }> {
    const prefix = options?.prefix || '';
    const keys = Array.from(this.store.keys())
      .filter((key) => key.startsWith(prefix))
      .map((name) => {
        return {
          name,
          metadata: this.metadata.get(name),
        };
      });

    return {
      keys,
      list_complete: true,
      cursor: '',
    };
  }
}

// Export the mock KV namespace for tests
export { MockKVNamespace };

// Mock request context
vi.mock('../../src/utils/requestContext', () => ({
  getCurrentContext: vi.fn(() => ({
    requestId: 'test-request-id',
    url: 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
    breadcrumbs: [],
    diagnostics: {},
    componentTiming: {},
  })),
  addBreadcrumb: vi.fn(),
  initRequestContext: vi.fn(),
  createRequestContext: vi.fn((request) => ({
    requestId: 'test-request-id',
    url: request?.url || 'https://example.com/videos/test.mp4',
    startTime: Date.now(),
    debugEnabled: false,
    breadcrumbs: [],
    diagnostics: {},
    componentTiming: {},
    verboseEnabled: false,
    executionContext: request?.ctx,
  })),
  setCurrentContext: vi.fn(),
}));

// Mock the video transformation service
vi.mock('../../src/services/videoTransformationService', () => ({
  transformVideo: vi.fn(async (request, options) => {
    return new Response('transformed video data', {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': '20',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }),
}));

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
