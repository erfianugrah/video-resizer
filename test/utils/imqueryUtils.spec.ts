import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  parseImQueryRef, 
  convertImQueryToClientHints,
  hasIMQueryParams,
  validateAkamaiParams,
  findClosestDerivative
} from '../../src/utils/imqueryUtils';

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
    // Mock videoConfig
    vi.mock('../../src/config/videoConfig', () => ({
      videoConfig: {
        derivatives: {
          mobile: { width: 480, height: 270, quality: 'low' },
          medium: { width: 854, height: 480, quality: 'medium' },
          high: { width: 1280, height: 720, quality: 'high' }
        }
      }
    }));

    it('should match dimensions to the closest derivative within threshold', () => {
      // Should match to medium derivative (854x480)
      expect(findClosestDerivative(800, 450)).toBe('medium');
      
      // Should match to mobile derivative (480x270)
      expect(findClosestDerivative(500, 280)).toBe('mobile');
      
      // Should match to high derivative (1280x720)
      expect(findClosestDerivative(1200, 700)).toBe('high');
    });
    
    it('should handle single dimension matching', () => {
      // Width only - should match to medium (854)
      expect(findClosestDerivative(800, null)).toBe('medium');
      
      // Height only - should match to high (720)
      expect(findClosestDerivative(null, 700)).toBe('high');
    });
    
    it('should return null when no dimensions are provided', () => {
      expect(findClosestDerivative(null, null)).toBeNull();
      expect(findClosestDerivative(undefined, undefined)).toBeNull();
    });
    
    it('should return null when no derivative is within threshold', () => {
      // Far outside the ranges of any derivative
      expect(findClosestDerivative(2000, 1500)).toBeNull();
      
      // Using a stricter threshold
      expect(findClosestDerivative(800, 450, 0.05)).toBeNull(); // 5% threshold
    });
  });
});