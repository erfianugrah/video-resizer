import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeTransformedVideo } from '../../../src/services/kvStorage/storeVideo';
import { getTransformedVideo } from '../../../src/services/kvStorage/getVideo';
import { STANDARD_CHUNK_SIZE } from '../../../src/services/kvStorage/constants';

describe('Chunk Size Integrity Tests', () => {
  let mockNamespace: any;
  let storedData: Map<string, { value: any; metadata: any }>;

  beforeEach(() => {
    storedData = new Map();
    
    mockNamespace = {
      put: vi.fn(async (key: string, value: any, options: any) => {
        // Simulate KV storage behavior
        let actualValue: ArrayBuffer;
        if (value instanceof ArrayBuffer) {
          actualValue = value;
        } else if (typeof value === 'string') {
          // Handle string values (like manifest JSON)
          actualValue = new TextEncoder().encode(value).buffer;
        } else if (value instanceof Uint8Array) {
          actualValue = value.buffer;
        } else {
          actualValue = new TextEncoder().encode(String(value)).buffer;
        }
        storedData.set(key, {
          value: actualValue,
          metadata: options?.metadata
        });
      }),
      get: vi.fn(async (key: string, options: any) => {
        const stored = storedData.get(key);
        if (!stored) return null;
        
        if (options?.type === 'arrayBuffer') {
          return stored.value;
        } else if (options?.type === 'text') {
          return new TextDecoder().decode(stored.value);
        }
        return stored.value;
      }),
      getWithMetadata: vi.fn(async (key: string, options: any) => {
        const stored = storedData.get(key);
        if (!stored) return { value: null, metadata: null };
        
        let value = stored.value;
        if (options?.type === 'text') {
          value = new TextDecoder().decode(value);
        }
        
        return { value, metadata: stored.metadata };
      })
    };
  });

  it('should store chunks with exact sizes matching manifest', async () => {
    // Create a test video that will require chunking (25MB)
    const testVideoSize = 25 * 1024 * 1024;
    const testVideo = new Uint8Array(testVideoSize);
    
    // Fill with test pattern
    for (let i = 0; i < testVideoSize; i++) {
      testVideo[i] = i % 256;
    }
    
    const response = new Response(testVideo, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': testVideoSize.toString()
      }
    });

    const result = await storeTransformedVideo(
      mockNamespace,
      '/test/video.mp4',
      response,
      {
        width: 1920,
        height: 1080,
        format: 'mp4'
      },
      3600
    );

    expect(result).toBe(true);

    // Log all stored keys for debugging
    console.log('Stored keys:', Array.from(storedData.keys()));

    // Verify manifest was stored - use the correct key format from generateKVKey
    // Format is: video:test/video.mp4:w=1920:h=1080:f=mp4
    const manifestKey = 'video:test/video.mp4:w=1920:h=1080:f=mp4';
    const manifestData = storedData.get(manifestKey);
    expect(manifestData).toBeDefined();
    
    // Parse manifest
    const manifest = JSON.parse(new TextDecoder().decode(manifestData!.value));
    expect(manifest.chunkCount).toBeGreaterThan(1);
    expect(manifest.totalSize).toBe(testVideoSize);
    
    // Verify each chunk has the exact size specified in manifest
    for (let i = 0; i < manifest.chunkCount; i++) {
      const chunkKey = `${manifestKey}_chunk_${i}`;
      const chunkData = storedData.get(chunkKey);
      
      expect(chunkData).toBeDefined();
      expect(chunkData!.value.byteLength).toBe(manifest.actualChunkSizes[i]);
      
      // Verify metadata size matches actual size
      expect(chunkData!.metadata.size).toBe(manifest.actualChunkSizes[i]);
    }
    
    // Verify sum of chunks equals total size
    const sumOfChunks = manifest.actualChunkSizes.reduce((sum: number, size: number) => sum + size, 0);
    expect(sumOfChunks).toBe(testVideoSize);
  });

  it('should retrieve chunks without size mismatches', async () => {
    // First store a chunked video
    const testVideoSize = 15 * 1024 * 1024; // 15MB
    const testVideo = new Uint8Array(testVideoSize);
    
    // Fill with test pattern
    for (let i = 0; i < testVideoSize; i++) {
      testVideo[i] = (i * 7) % 256; // Different pattern
    }
    
    const response = new Response(testVideo, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': testVideoSize.toString()
      }
    });

    await storeTransformedVideo(
      mockNamespace,
      '/test/video2.mp4',
      response,
      {
        derivative: '720p',
        format: 'mp4'
      },
      3600
    );
    
    // Now retrieve it
    const retrieveResult = await getTransformedVideo(
      mockNamespace,
      '/test/video2.mp4',
      {
        derivative: '720p',
        format: 'mp4'
      }
    );

    expect(retrieveResult).not.toBeNull();
    const retrieveResponse = retrieveResult!.response;
    expect(retrieveResponse.headers.get('Content-Length')).toBe(testVideoSize.toString());

    // Read the response to ensure no chunk size errors occur
    const retrievedData = await retrieveResponse.arrayBuffer();
    expect(retrievedData.byteLength).toBe(testVideoSize);
    
    // Verify the data matches
    const retrievedArray = new Uint8Array(retrievedData);
    for (let i = 0; i < Math.min(1000, testVideoSize); i++) {
      expect(retrievedArray[i]).toBe(testVideo[i]);
    }
  });

  it('should handle streaming storage without size corruption', async () => {
    // Test with streaming mode explicitly enabled
    const testVideoSize = 30 * 1024 * 1024; // 30MB
    const testVideo = new Uint8Array(testVideoSize);
    
    // Fill with test pattern
    for (let i = 0; i < testVideoSize; i++) {
      testVideo[i] = (i * 13) % 256;
    }
    
    const response = new Response(testVideo, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': testVideoSize.toString()
      }
    });

    const result = await storeTransformedVideo(
      mockNamespace,
      '/test/video3.mp4',
      response,
      {
        width: 3840,
        height: 2160,
        format: 'mp4'
      },
      3600,
      true // Enable streaming
    );

    expect(result).toBe(true);

    // Verify manifest - use correct key format
    const manifestKey = 'video:test/video3.mp4:w=3840:h=2160:f=mp4';
    const manifestData = storedData.get(manifestKey);
    expect(manifestData).toBeDefined();
    const manifest = JSON.parse(new TextDecoder().decode(manifestData!.value));
    
    // Check all chunks have correct sizes
    for (let i = 0; i < manifest.chunkCount; i++) {
      const chunkKey = `${manifestKey}_chunk_${i}`;
      const chunkData = storedData.get(chunkKey);
      
      expect(chunkData!.value.byteLength).toBe(manifest.actualChunkSizes[i]);
      
      // For all but the last chunk, size should be close to STANDARD_CHUNK_SIZE
      if (i < manifest.chunkCount - 1) {
        expect(manifest.actualChunkSizes[i]).toBeLessThanOrEqual(STANDARD_CHUNK_SIZE);
      }
    }
  });
});