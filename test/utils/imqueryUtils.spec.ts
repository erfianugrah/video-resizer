import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  parseImQueryRef, 
  convertImQueryToClientHints,
  hasIMQueryParams,
  validateAkamaiParams,
  findClosestDerivative,
  findClosestDerivativePercentage
} from '../../src/utils/imqueryUtils';

// Mock the VideoConfigurationManager
vi.mock('../../src/config/VideoConfigurationManager', () => {
  const mockConfig = {
    derivatives: {
      mobile: { width: 480, height: 270, quality: 'low' },
      medium: { width: 854, height: 480, quality: 'medium' },
      high: { width: 1280, height: 720, quality: 'high' }
    },
    responsive: {
      breakpoints: {},
      availableQualities: [240, 360, 480, 720, 1080, 1440, 2160]
    }
  };
  
  return {
    VideoConfigurationManager: {
      getInstance: vi.fn().mockReturnValue({
        getConfig: vi.fn().mockReturnValue(mockConfig),
        getResponsiveBreakpoints: vi.fn().mockReturnValue({}),
        getResponsiveConfig: vi.fn().mockReturnValue(mockConfig.responsive)
      })
    }
  };
});

describe('IMQuery Utils', () => {
  describe('parseImQueryRef', () => {
    it('should parse imref parameters correctly', () => {
      const imref = 'w=800,h=600,dpr=2';
      const result = parseImQueryRef(imref);
      
      expect(result).toEqual({
        w: '800',
        h: '600',
        dpr: '2'
      });
    });
    
    it('should handle empty or undefined imref', () => {
      expect(parseImQueryRef('')).toEqual({});
      expect(parseImQueryRef(undefined as unknown as string)).toEqual({});
    });
    
    it('should handle malformed imref values', () => {
      // Missing value
      expect(parseImQueryRef('w=800,h=')).toEqual({
        w: '800'
      });
      
      // Missing key
      expect(parseImQueryRef('w=800,=600')).toEqual({
        w: '800'
      });
    });
  });
  
  describe('convertImQueryToClientHints', () => {
    it('should convert IMQuery parameters to client hints', () => {
      const params = new URLSearchParams({
        'im-viewwidth': '1024',
        'im-density': '2',
        'imwidth': '800',
        'imheight': '600'
      });
      
      const result = convertImQueryToClientHints(params);
      
      expect(result).toEqual({
        'Sec-CH-Viewport-Width': '1024',
        'Sec-CH-DPR': '2',
        'Width': '800',
        'Height': '600'
      });
    });
    
    it('should handle empty parameters', () => {
      const params = new URLSearchParams();
      const result = convertImQueryToClientHints(params);
      
      expect(result).toEqual({});
    });
  });
  
  describe('hasIMQueryParams', () => {
    it('should detect IMQuery parameters', () => {
      const withIMQuery = new URLSearchParams({
        'imwidth': '800'
      });
      
      const withoutIMQuery = new URLSearchParams({
        'width': '800'
      });
      
      expect(hasIMQueryParams(withIMQuery)).toBe(true);
      expect(hasIMQueryParams(withoutIMQuery)).toBe(false);
    });
    
    it('should detect all IMQuery parameter types', () => {
      const paramSets = [
        { 'imwidth': '800' },
        { 'imheight': '600' },
        { 'imref': 'w=800,h=600' },
        { 'im-viewwidth': '1024' },
        { 'im-viewheight': '768' },
        { 'im-density': '2' }
      ];
      
      paramSets.forEach(params => {
        expect(hasIMQueryParams(new URLSearchParams(params))).toBe(true);
      });
    });
  });
  
  describe('validateAkamaiParams', () => {
    it('should validate supported parameters', () => {
      const validParams = {
        'imwidth': '800',
        'imheight': '600',
        'imref': 'w=800,h=600',
        'w': '800',
        'h': '600'
      };
      
      const result = validateAkamaiParams(validParams);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toEqual([]);
    });
    
    it('should detect unsupported parameters', () => {
      const invalidParams = {
        'imwidth': '800',
        'im-palette': 'rgb',
        'layer': '1'
      };
      
      const result = validateAkamaiParams(invalidParams);
      
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain('Unsupported Akamai parameter: im-palette');
      expect(result.warnings).toContain('Unsupported Akamai parameter: layer');
    });
    
    it('should validate imref format', () => {
      const validImref = {
        'imref': 'w=800,h=600,dpr=2'
      };
      
      const invalidImref = {
        'imref': 'w=800,h='
      };
      
      expect(validateAkamaiParams(validImref).isValid).toBe(true);
      expect(validateAkamaiParams(invalidImref).isValid).toBe(false);
    });
  });

  describe('findClosestDerivative', () => {
    // Mock VideoConfigurationManager and videoConfig
    vi.mock('../../src/config/VideoConfigurationManager', () => ({
      VideoConfigurationManager: {
        getInstance: vi.fn().mockReturnValue({
          getConfig: vi.fn().mockReturnValue({
            derivatives: {
              mobile: { width: 854, height: 640, quality: 'low' },
              tablet: { width: 1280, height: 720, quality: 'medium' },
              desktop: { width: 1920, height: 1080, quality: 'high' }
            },
            responsiveBreakpoints: {
              small: { max: 640, derivative: 'mobile' },
              medium: { min: 641, max: 1024, derivative: 'tablet' },
              large: { min: 1025, max: 1440, derivative: 'tablet' },
              'extra-large': { min: 1441, derivative: 'desktop' }
            }
          }),
          getResponsiveBreakpoints: vi.fn().mockReturnValue({
            small: { max: 640, derivative: 'mobile' },
            medium: { min: 641, max: 1024, derivative: 'tablet' },
            large: { min: 1025, max: 1440, derivative: 'tablet' },
            'extra-large': { min: 1441, derivative: 'desktop' }
          })
        })
      }
    }));
    
    // Mock videoConfig as a fallback
    vi.mock('../../src/config/videoConfig', () => ({
      videoConfig: {
        derivatives: {
          mobile: { width: 854, height: 640, quality: 'low' },
          tablet: { width: 1280, height: 720, quality: 'medium' },
          desktop: { width: 1920, height: 1080, quality: 'high' }
        }
      }
    }));

    // Clear any static cache before each test
    beforeEach(() => {
      (global as any).__derivativeMappingCache = {};
    });

    it('should match dimensions to the closest derivative within threshold', () => {
      // Should match to mobile derivative (854x640)
      expect(findClosestDerivative(800, 600)).toBe('mobile');
      
      // Should match to tablet derivative (1280x720)
      expect(findClosestDerivative(1200, 700)).toBe('tablet');
      
      // Should match to desktop derivative (1920x1080)
      expect(findClosestDerivative(1800, 1000)).toBe('desktop');
    });
    
    it('should handle single dimension matching', () => {
      // Width only - should match to tablet via breakpoints (800 is in 641-1024 range)
      expect(findClosestDerivative(800, null)).toBe('tablet');
      
      // Height only - should match to tablet (720 is this height)
      expect(findClosestDerivative(null, 700)).toBe('tablet');
    });
    
    it('should return null when no dimensions are provided', () => {
      expect(findClosestDerivative(null, null)).toBeNull();
      expect(findClosestDerivative(undefined, undefined)).toBeNull();
    });
    
    it('should apply the threshold correctly for percentage-based matching', () => {
      // With our new breakpoint logic, 2000 will match to 'hd' via the 'extra-large' breakpoint
      // But with a very strict threshold, percentage-based matching should fail
      expect(findClosestDerivative(800, 450, 0.01)).toBeNull(); // 1% threshold - too strict
      
      // For very strict thresholds that no derivative meets
      expect(findClosestDerivativePercentage(800, 450, 0.01)).toBeNull();
    });
    
    it('should provide consistent mappings for similar dimensions', () => {
      // First request establishes the mapping
      const derivative1 = findClosestDerivative(805, 600);
      expect(derivative1).toBe('mobile');
      
      // Slightly different dimensions should map to the same derivative
      const derivative2 = findClosestDerivative(802, 598);
      expect(derivative2).toBe('mobile');
      
      // Even more different dimensions, but within normalized rounding (nearest 10px)
      const derivative3 = findClosestDerivative(809, 605);
      expect(derivative3).toBe('mobile');
    });
    
    it('should use closest breakpoint for dimensions outside exact ranges', () => {
      // This width (1500) is outside any exact range but closest to 'extra-large' (min: 1441)
      const derivative = findClosestDerivative(1500, null);
      expect(derivative).toBe('desktop'); // Should map to desktop via 'extra-large' breakpoint
      
      // This width (630) is just below the medium range (min: 641), should map to closest breakpoint
      const derivativeLower = findClosestDerivative(630, null);
      expect(derivativeLower).toBe('mobile'); // Should map to mobile via closest breakpoint
    });
    
    it('should factor in aspect ratio when both width and height are specified', () => {
      // Regular 16:9 aspect ratio, should match to tablet
      expect(findClosestDerivative(1200, 675)).toBe('tablet');
      
      // Very different aspect ratio (1:1 square) might match differently due to aspect ratio factor
      // It should still pick the closest derivative by dimension, but with aspect ratio consideration
      const squareResult = findClosestDerivative(720, 720);
      // The exact result depends on our algorithm, but it should be consistent
      expect(['mobile', 'tablet', 'desktop']).toContain(squareResult);
      
      // Ensure consistent mapping for same aspect ratio
      const square1 = findClosestDerivative(720, 720);
      const square2 = findClosestDerivative(700, 700);
      expect(square1).toBe(square2); // Should get same derivative for similar squares
    });
    
    it('should use expanded threshold for better cache consistency when needed', () => {
      // Set up a dimension that's just outside the normal threshold but within expanded one
      // With standard 25% threshold, this might fail, but with expanded threshold (37.5%) it should pass
      const justAboveThreshold = findClosestDerivative(600, 500); // ~30% difference from mobile
      
      // Expect a mapping rather than null due to expanded threshold fallback
      expect(justAboveThreshold).not.toBeNull();
    });
  });
});