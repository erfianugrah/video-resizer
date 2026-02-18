/**
 * Configuration Handler tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleConfigUpload, handleConfigGet } from '../../src/handlers/configHandler';

// Mock configuration service
const mockConfigService = {
  initialize: vi.fn(),
  loadConfiguration: vi.fn(),
  storeConfiguration: vi.fn(),
};

// Mock the getInstance method
vi.mock('../../src/services/configurationService', () => {
  return {
    ConfigurationService: {
      getInstance: () => mockConfigService,
    },
  };
});

describe('Configuration Handler', () => {
  // Mock KV namespace (must have get/put/delete to pass isKVNamespace check)
  const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
    deleteBulk: vi.fn(),
  } as unknown as KVNamespace;

  // Mock environment with KV namespace and API token
  const mockEnv = {
    VIDEO_CONFIGURATION_STORE: mockKV,
    CONFIG_API_TOKEN: 'test-token',
  };

  // Sample valid config
  const sampleConfig = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    video: {
      derivatives: {},
    },
    cache: {},
    debug: {},
    logging: {},
  };

  // Valid auth token
  const validAuthHeader = 'Bearer test-token';

  beforeEach(() => {
    vi.resetAllMocks();
    mockConfigService.loadConfiguration.mockResolvedValue(sampleConfig);
    mockConfigService.storeConfiguration.mockResolvedValue(true);
  });

  describe('handleConfigUpload', () => {
    it('should return 401 when missing authorization header', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'POST',
        body: JSON.stringify(sampleConfig),
      });

      const response = await handleConfigUpload(req, mockEnv);
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('Unauthorized');
    });

    it('should return 401 when invalid authorization header', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'POST',
        headers: {
          Authorization: 'Invalid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleConfig),
      });

      const response = await handleConfigUpload(req, mockEnv);
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('Unauthorized');
    });

    it('should return 405 for non-POST requests', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'PUT',
        headers: {
          Authorization: validAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleConfig),
      });

      const response = await handleConfigUpload(req, mockEnv);
      expect(response.status).toBe(405);
      const text = await response.text();
      expect(text).toContain('Method not allowed');
    });

    it('should return 400 for invalid JSON', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'POST',
        headers: {
          Authorization: validAuthHeader,
          'Content-Type': 'application/json',
        },
        body: 'invalid json',
      });

      const response = await handleConfigUpload(req, mockEnv);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('Bad request');
    });

    it('should return 200 for successful upload', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'POST',
        headers: {
          Authorization: validAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleConfig),
      });

      mockConfigService.storeConfiguration.mockResolvedValue(true);

      const response = await handleConfigUpload(req, mockEnv);
      expect(response.status).toBe(200);
      const responseBody: any = await response.json();
      expect(responseBody.success).toBe(true);
      expect(mockConfigService.storeConfiguration).toHaveBeenCalledWith(mockEnv, sampleConfig);
    });

    it('should return 500 when storage fails', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'POST',
        headers: {
          Authorization: validAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleConfig),
      });

      mockConfigService.storeConfiguration.mockResolvedValue(false);

      const response = await handleConfigUpload(req, mockEnv);
      expect(response.status).toBe(500);
      const responseBody: any = await response.json();
      expect(responseBody.success).toBe(false);
    });

    it('should return 500 when KV namespace is missing', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'POST',
        headers: {
          Authorization: validAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleConfig),
      });

      const response = await handleConfigUpload(req, {});
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toContain('KV namespace not configured');
    });
  });

  describe('handleConfigGet', () => {
    it('should return 401 when missing authorization header', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'GET',
      });

      const response = await handleConfigGet(req, mockEnv);
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('Unauthorized');
    });

    it('should return 401 when invalid authorization header', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'GET',
        headers: {
          Authorization: 'Invalid',
        },
      });

      const response = await handleConfigGet(req, mockEnv);
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).toContain('Unauthorized');
    });

    it('should return 405 for non-GET requests', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'DELETE',
        headers: {
          Authorization: validAuthHeader,
        },
      });

      const response = await handleConfigGet(req, mockEnv);
      expect(response.status).toBe(405);
      const text = await response.text();
      expect(text).toContain('Method not allowed');
    });

    it('should return 200 with configuration for successful retrieval', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'GET',
        headers: {
          Authorization: validAuthHeader,
        },
      });

      mockConfigService.loadConfiguration.mockResolvedValue(sampleConfig);

      const response = await handleConfigGet(req, mockEnv);
      expect(response.status).toBe(200);
      const responseBody: any = await response.json();

      // Verify that the response contains the sample config data
      expect(responseBody.version).toEqual(sampleConfig.version);
      expect(responseBody.video).toEqual(sampleConfig.video);
      expect(responseBody.cache).toEqual(sampleConfig.cache);
      expect(responseBody.debug).toEqual(sampleConfig.debug);
      expect(responseBody.logging).toEqual(sampleConfig.logging);

      // Verify that the metadata is included
      expect(responseBody._meta).toBeDefined();
      expect(responseBody._meta.environment).toBeDefined();
      expect(responseBody._meta.retrievedAt).toBeDefined();

      expect(mockConfigService.loadConfiguration).toHaveBeenCalledWith(mockEnv);
    });

    it('should return 404 when configuration not found', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'GET',
        headers: {
          Authorization: validAuthHeader,
        },
      });

      mockConfigService.loadConfiguration.mockResolvedValue(null);

      const response = await handleConfigGet(req, mockEnv);
      expect(response.status).toBe(404);
      const responseBody: any = await response.json();
      expect(responseBody.success).toBe(false);
    });

    it('should return 500 when KV namespace is missing', async () => {
      const req = new Request('https://example.com/admin/config', {
        method: 'GET',
        headers: {
          Authorization: validAuthHeader,
        },
      });

      const response = await handleConfigGet(req, {});
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toContain('KV namespace not configured');
    });
  });
});
