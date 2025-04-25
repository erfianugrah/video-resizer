import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentVersion, incrementVersion, resetVersion } from '../../src/services/versionManagerService';
import { EnvVariables } from '../../src/config/environmentConfig';

describe('VersionManagerService', () => {
  // Mock KV namespace
  const mockKV = {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
  } as unknown as KVNamespace;

  // Mock environment
  const mockEnv: EnvVariables = {
    VIDEO_CACHE_KEY_VERSIONS: mockKV,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentVersion', () => {
    it('should return version 1 when no version exists', async () => {
      mockKV.get.mockResolvedValueOnce(null);
      
      const version = await getCurrentVersion(mockEnv, 'test-key');
      
      expect(version).toBe(1);
      expect(mockKV.get).toHaveBeenCalledWith('test-key');
    });

    it('should return the current version when it exists', async () => {
      mockKV.get.mockResolvedValueOnce('5');
      
      const version = await getCurrentVersion(mockEnv, 'test-key');
      
      expect(version).toBe(5);
      expect(mockKV.get).toHaveBeenCalledWith('test-key');
    });

    it('should return 1 when KV namespace is not available', async () => {
      const version = await getCurrentVersion({} as EnvVariables, 'test-key');
      
      expect(version).toBe(1);
      expect(mockKV.get).not.toHaveBeenCalled();
    });
  });

  describe('incrementVersion', () => {
    it('should increment the version by 1', async () => {
      mockKV.get.mockResolvedValueOnce('3');
      
      const newVersion = await incrementVersion(mockEnv, 'test-key');
      
      expect(newVersion).toBe(4);
      expect(mockKV.get).toHaveBeenCalledWith('test-key');
      expect(mockKV.put).toHaveBeenCalledWith('test-key', '4');
    });

    it('should start from 1 when no version exists', async () => {
      mockKV.get.mockResolvedValueOnce(null);
      
      const newVersion = await incrementVersion(mockEnv, 'test-key');
      
      expect(newVersion).toBe(2);
      expect(mockKV.get).toHaveBeenCalledWith('test-key');
      expect(mockKV.put).toHaveBeenCalledWith('test-key', '2');
    });

    it('should return 1 when KV namespace is not available', async () => {
      const newVersion = await incrementVersion({} as EnvVariables, 'test-key');
      
      expect(newVersion).toBe(1);
      expect(mockKV.get).not.toHaveBeenCalled();
      expect(mockKV.put).not.toHaveBeenCalled();
    });
  });

  describe('resetVersion', () => {
    it('should reset the version to 1', async () => {
      const success = await resetVersion(mockEnv, 'test-key');
      
      expect(success).toBe(true);
      expect(mockKV.put).toHaveBeenCalledWith('test-key', '1');
    });

    it('should return false when KV namespace is not available', async () => {
      const success = await resetVersion({} as EnvVariables, 'test-key');
      
      expect(success).toBe(false);
      expect(mockKV.put).not.toHaveBeenCalled();
    });
  });
});