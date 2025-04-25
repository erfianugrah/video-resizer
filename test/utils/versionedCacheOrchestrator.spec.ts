import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCaching } from '../../src/utils/cacheOrchestrator';
import { getFromKVCache, storeInKVCache } from '../../src/utils/kvCacheUtils';
import { getCurrentVersion, incrementVersion } from '../../src/services/versionManagerService';
import { generateBaseKVKey } from '../../src/services/kvStorageService';
import { EnvVariables } from '../../src/config/environmentConfig';
import { CacheConfigurationManager } from '../../src/config/CacheConfigurationManager';

// Mock dependencies
vi.mock('../../src/utils/kvCacheUtils');
vi.mock('../../src/services/versionManagerService');
vi.mock('../../src/services/kvStorageService');
vi.mock('../../src/config/CacheConfigurationManager');

describe('Versioned Cache Orchestrator', () => {
  // Mock environment
  const mockEnv: EnvVariables = {
    VIDEO_TRANSFORMATIONS_CACHE: {} as KVNamespace,
    VIDEO_CACHE_KEY_VERSIONS: {} as KVNamespace
  };
  
  // Mock options
  const mockOptions = {
    width: 640,
    height: 360,
    derivative: 'medium'
  };
  
  // Mock request
  const mockRequest = new Request('https://example.com/videos/test.mp4');
  
  // Mock handler
  const mockHandler = vi.fn().mockImplementation((req: Request) => {
    // Return a mock response
    return Promise.resolve(new Response('test content', {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '100'
      }
    }));
  });
  
  // Mock CacheConfigurationManager
  const mockCacheConfigManager = {
    shouldBypassCache: vi.fn().mockReturnValue(false),
    isKVCacheEnabled: vi.fn().mockReturnValue(true),
    getConfig: vi.fn().mockReturnValue({
      enableKVCache: true
    })
  };
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mocks
    vi.mocked(getFromKVCache).mockResolvedValue(null);
    vi.mocked(storeInKVCache).mockResolvedValue(true);
    vi.mocked(getCurrentVersion).mockResolvedValue(1);
    vi.mocked(incrementVersion).mockResolvedValue(2);
    vi.mocked(generateBaseKVKey).mockReturnValue('video:videos/test.mp4:derivative=medium');
    
    // Setup CacheConfigurationManager mock
    vi.mocked(CacheConfigurationManager.getInstance).mockReturnValue(
      mockCacheConfigManager as unknown as CacheConfigurationManager
    );
  });
  
  it('should call handler with versioned URL on cache miss', async () => {
    // Cache miss
    vi.mocked(getFromKVCache).mockResolvedValue(null);
    
    // Execute with caching
    await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
    
    // Check version was incremented
    expect(getCurrentVersion).toHaveBeenCalledWith(mockEnv, 'video:videos/test.mp4:derivative=medium');
    expect(incrementVersion).toHaveBeenCalledWith(mockEnv, 'video:videos/test.mp4:derivative=medium');
    
    // Verify handler was called with versioned URL
    expect(mockHandler).toHaveBeenCalledTimes(1);
    const handlerArg = mockHandler.mock.calls[0][0] as Request;
    expect(handlerArg.url).toContain('v=2');
  });
  
  it('should return cached response on cache hit', async () => {
    // Prepare a mock cached response
    const mockCachedResponse = new Response('cached content', {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '100'
      }
    });
    
    // Cache hit
    vi.mocked(getFromKVCache).mockResolvedValue(mockCachedResponse);
    
    // Execute with caching
    const response = await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
    
    // Verify caching behavior
    expect(getCurrentVersion).toHaveBeenCalledWith(mockEnv, 'video:videos/test.mp4:derivative=medium');
    expect(getFromKVCache).toHaveBeenCalledWith(mockEnv, '/videos/test.mp4', mockOptions, mockRequest);
    
    // Handler should not be called on cache hit
    expect(mockHandler).not.toHaveBeenCalled();
    expect(incrementVersion).not.toHaveBeenCalled();
    
    // Check response
    const responseText = await response.text();
    expect(responseText).toBe('cached content');
  });
  
  it('should bypass cache for non-GET requests', async () => {
    const postRequest = new Request('https://example.com/videos/test.mp4', { method: 'POST' });
    
    // Execute with caching
    await withCaching(postRequest, mockEnv, mockHandler, mockOptions);
    
    // Should skip cache operations
    expect(getCurrentVersion).not.toHaveBeenCalled();
    expect(getFromKVCache).not.toHaveBeenCalled();
    expect(incrementVersion).not.toHaveBeenCalled();
    
    // Should call handler directly
    expect(mockHandler).toHaveBeenCalledWith(postRequest);
  });
  
  it('should store successful response in KV cache', async () => {
    // Cache miss
    vi.mocked(getFromKVCache).mockResolvedValue(null);
    
    // Execute with caching
    await withCaching(mockRequest, mockEnv, mockHandler, mockOptions);
    
    // Should store the response in KV
    expect(storeInKVCache).toHaveBeenCalledTimes(1);
    expect(storeInKVCache).toHaveBeenCalledWith(
      mockEnv,
      '/videos/test.mp4',
      expect.any(Response),
      mockOptions
    );
  });
});