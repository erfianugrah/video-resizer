// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';

// Mock modules
vi.mock('../src/handlers/videoHandler', () => ({
  handleVideoRequest: vi.fn().mockImplementation(() => {
    return new Response('Transformed video', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    });
  }),
}));

vi.mock('../src/utils/loggingManager', () => ({
  initializeLogging: vi.fn(),
}));

vi.mock('../src/config/videoConfig', () => ({
  videoConfig: {
    caching: {
      method: 'cacheApi',
      debug: false,
    }
  }
}));

vi.mock('../src/config/environmentConfig', () => ({
  getEnvironmentConfig: vi.fn().mockReturnValue({
    mode: 'development',
    debug: { enabled: true },
    cache: { method: 'cacheApi', debug: false },
  }),
}));

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Video Resizer Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes video requests', async () => {
    // Arrange
    const request = new IncomingRequest('http://example.com/videos/sample.mp4');

    // Create an empty context to pass to `worker.fetch()`.
    const ctx = createExecutionContext();

    // Act
    const response = await worker.fetch(request, env, ctx);

    // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await waitOnExecutionContext(ctx);

    // Assert
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Transformed video');
  });
});
