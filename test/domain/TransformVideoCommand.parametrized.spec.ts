/**
 * Parameterized tests for TransformVideoCommand
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  createMockRequest,
  createMockConfig,
  createMockPathPatterns,
  createMockVideoOptions,
  createMockDebugInfo,
  generateTestCases,
  mockFetch
} from '../utils/test-utils';
import { TransformVideoCommand } from '../../src/domain/commands/TransformVideoCommand';
import { videoConfig } from '../../src/config/videoConfig';

describe('TransformVideoCommand Parameterized Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock response
    mockFetch('Video content');
  });
  
  describe('Video mode variations', () => {
    // Generate test cases for different combinations of video modes and fits
    const testCases = generateTestCases(
      // Base configuration
      {
        width: 720,
        height: 480,
      },
      // Variations
      {
        mode: ['video', 'frame', 'spritesheet'],
        fit: ['contain', 'cover', 'scale-down'],
      }
    );
    
    // Run a test for each generated test case
    testCases.forEach(testCase => {
      it(`should handle ${testCase.name}`, async () => {
        // Arrange
        const request = createMockRequest(`https://example.com/videos/test.mp4`);
        
        // Create command with the test case options
        const command = new TransformVideoCommand({
          request,
          options: createMockVideoOptions(testCase),
          pathPatterns: createMockPathPatterns(),
          debugInfo: createMockDebugInfo(),
        });
        
        // Act
        const response = await command.execute();
        
        // Assert
        expect(response.status).toBe(200);
        
        // Verify the correct parameters were used
        const fetchCalls = vi.mocked(fetch).mock.calls;
        const transformedUrl = fetchCalls[0][0];
        if (transformedUrl instanceof Request) {
          const urlString = transformedUrl.url;
          expect(urlString).toContain(`width=${testCase.width}`);
          expect(urlString).toContain(`height=${testCase.height}`);
          expect(urlString).toContain(`mode=${testCase.mode}`);
          expect(urlString).toContain(`fit=${testCase.fit}`);
        }
      });
    });
  });
  
  describe('Path pattern variations', () => {
    // Test with each of our mock path patterns
    const pathPatterns = createMockPathPatterns();
    
    pathPatterns.forEach(pattern => {
      // Skip patterns that aren't meant to be processed
      if (!pattern.processPath) {
        return;
      }
      
      it(`should correctly handle ${pattern.name} path pattern`, async () => {
        // Create a URL that matches this pattern
        let testUrl: string;
        
        switch (pattern.name) {
          case 'videos':
            testUrl = 'https://example.com/videos/sample.mp4';
            break;
          case 'custom':
            testUrl = 'https://example.com/custom/video.mp4';
            break;
          case 'advanced':
            testUrl = 'https://example.com/v/abc123/watch';
            break;
          case 'features':
            testUrl = 'https://example.com/features/highlight-reel';
            break;
          default:
            testUrl = 'https://example.com/videos/sample.mp4';
        }
        
        // Arrange
        const request = createMockRequest(testUrl);
        
        const command = new TransformVideoCommand({
          request,
          options: createMockVideoOptions(),
          pathPatterns: [pattern], // Only use this pattern for the test
          debugInfo: createMockDebugInfo(),
        });
        
        // Act
        const response = await command.execute();
        
        // Assert
        expect(response.status).toBe(200);
        
        // Check the URL was transformed according to the pattern
        const fetchCalls = vi.mocked(fetch).mock.calls;
        const transformedUrl = fetchCalls[0][0];
        if (transformedUrl instanceof Request) {
          const urlString = transformedUrl.url;
          
          // Should contain the CDN-CGI path
          expect(urlString).toContain('/cdn-cgi/media/');
          
          // If the pattern has an originUrl, it should be used
          if (pattern.originUrl) {
            expect(urlString).toContain(pattern.originUrl);
          }
          
          // If the pattern has a quality preset, it should be applied
          if (pattern.quality === 'high') {
            expect(urlString).toContain('width=1280');
            expect(urlString).toContain('height=720');
          }
        }
      });
    });
  });
  
  describe('Video derivative tests', () => {
    // Test each derivative
    Object.entries(videoConfig.derivatives).forEach(([name, settings]) => {
      it(`should apply the ${name} derivative correctly`, async () => {
        // Arrange
        const request = createMockRequest(`https://example.com/videos/test.mp4`);
        
        const command = new TransformVideoCommand({
          request,
          options: {
            ...createMockVideoOptions(),
            ...settings,
            derivative: name,
          },
          pathPatterns: createMockPathPatterns(),
          debugInfo: createMockDebugInfo(),
        });
        
        // Act
        const response = await command.execute();
        
        // Assert
        expect(response.status).toBe(200);
        
        // Check the derivative settings were applied
        const fetchCalls = vi.mocked(fetch).mock.calls;
        const transformedUrl = fetchCalls[0][0];
        if (transformedUrl instanceof Request) {
          const urlString = transformedUrl.url;
          
          // Check width and height from derivative
          if (settings.width) {
            expect(urlString).toContain(`width=${settings.width}`);
          }
          
          if (settings.height) {
            expect(urlString).toContain(`height=${settings.height}`);
          }
          
          // Check mode from derivative
          if (settings.mode) {
            expect(urlString).toContain(`mode=${settings.mode}`);
          }
          
          // Check fit from derivative
          if (settings.fit) {
            expect(urlString).toContain(`fit=${settings.fit}`);
          }
          
          // Check if thumbnail has format
          if (name === 'thumbnail' && settings.format) {
            expect(urlString).toContain(`format=${settings.format}`);
          }
        }
      });
    });
  });
});