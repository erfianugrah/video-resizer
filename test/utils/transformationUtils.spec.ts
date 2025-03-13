import { describe, it, expect } from 'vitest';
import {
  translateAkamaiParamName,
  translateAkamaiParamValue,
  translateAkamaiToCloudflareParams,
  parseTimeString,
  formatTimeString,
  isValidTime,
  isValidDuration,
  isValidFormatForMode,
  isValidQuality,
  isValidCompression,
  isValidPreload,
  isValidPlaybackOptions
} from '../../src/utils/transformationUtils';
import { VideoTransformOptions } from '../../src/domain/commands/TransformVideoCommand';

describe('Transformation Utils', () => {
  describe('Akamai to Cloudflare translation', () => {
    it('should translate Akamai parameter names to Cloudflare parameter names', () => {
      expect(translateAkamaiParamName('w')).toBe('width');
      expect(translateAkamaiParamName('h')).toBe('height');
      expect(translateAkamaiParamName('obj-fit')).toBe('fit');
      expect(translateAkamaiParamName('start')).toBe('time');
      expect(translateAkamaiParamName('dur')).toBe('duration');
      expect(translateAkamaiParamName('mute')).toBe('audio');
      
      // Unknown parameter should return null
      expect(translateAkamaiParamName('unknown')).toBeNull();
    });

    it('should translate Akamai parameter values to Cloudflare parameter values', () => {
      // Translate fit values
      expect(translateAkamaiParamValue('obj-fit', 'crop')).toBe('cover');
      expect(translateAkamaiParamValue('obj-fit', 'fill')).toBe('contain');
      expect(translateAkamaiParamValue('obj-fit', 'contain')).toBe('contain');
      
      // Translate mute to audio (inverting the value)
      expect(translateAkamaiParamValue('mute', 'true')).toBe(false);
      expect(translateAkamaiParamValue('mute', true)).toBe(false);
      expect(translateAkamaiParamValue('mute', 'false')).toBe(true);
      expect(translateAkamaiParamValue('mute', false)).toBe(true);
      
      // Regular values should pass through unchanged
      expect(translateAkamaiParamValue('w', '800')).toBe('800');
      expect(translateAkamaiParamValue('h', 600)).toBe(600);
    });

    it('should translate complete Akamai parameter sets', () => {
      const akamaiParams = {
        'w': 800,
        'h': 600,
        'obj-fit': 'crop',
        'mute': true,
        'start': '5s',
        'dur': '10s',
        'f': 'jpg'
      };
      
      const cloudflareParams = translateAkamaiToCloudflareParams(akamaiParams);
      
      expect(cloudflareParams).toEqual({
        'width': 800,
        'height': 600,
        'fit': 'cover',
        'audio': false,
        'time': '5s',
        'duration': '10s',
        'format': 'jpg'
      });
    });
  });

  describe('Time handling', () => {
    it('should parse time strings to seconds', () => {
      expect(parseTimeString('5s')).toBe(5);
      expect(parseTimeString('1.5s')).toBe(1.5);
      expect(parseTimeString('2m')).toBe(120);
      expect(parseTimeString('0.5m')).toBe(30);
      
      // Invalid formats should return null
      expect(parseTimeString('')).toBeNull();
      expect(parseTimeString('invalid')).toBeNull();
      expect(parseTimeString('5x')).toBeNull();
    });

    it('should format seconds to time strings', () => {
      expect(formatTimeString(5)).toBe('5s');
      expect(formatTimeString(30)).toBe('30s');
      expect(formatTimeString(60)).toBe('1m');
      expect(formatTimeString(90)).toBe('1m');
      expect(formatTimeString(120)).toBe('2m');
    });

    it('should validate time ranges', () => {
      // Valid time values (0-30s)
      expect(isValidTime('0s')).toBe(true);
      expect(isValidTime('15s')).toBe(true);
      expect(isValidTime('30s')).toBe(true);
      expect(isValidTime('0.5s')).toBe(true);
      expect(isValidTime(null)).toBe(true); // Null is valid (default value)
      
      // Invalid time values
      expect(isValidTime('31s')).toBe(false);
      expect(isValidTime('1m')).toBe(false); // 60s is > 30s
      expect(isValidTime('invalid')).toBe(false);
    });

    it('should validate duration values', () => {
      // Valid duration values (positive times)
      expect(isValidDuration('1s')).toBe(true);
      expect(isValidDuration('10s')).toBe(true);
      expect(isValidDuration('1m')).toBe(true);
      expect(isValidDuration('0.5s')).toBe(true);
      expect(isValidDuration(null)).toBe(true); // Null is valid (default value)
      
      // Invalid duration values
      expect(isValidDuration('0s')).toBe(false); // Duration must be positive
      expect(isValidDuration('-5s')).toBe(false);
      expect(isValidDuration('invalid')).toBe(false);
    });
  });

  describe('Format and mode validation', () => {
    it('should validate format is only used with frame mode', () => {
      // Valid combinations
      const validOptions1: VideoTransformOptions = {
        mode: 'frame',
        format: 'jpg'
      };
      expect(isValidFormatForMode(validOptions1)).toBe(true);
      
      const validOptions2: VideoTransformOptions = {
        mode: 'video',
        format: null
      };
      expect(isValidFormatForMode(validOptions2)).toBe(true);
      
      // Invalid combinations
      const invalidOptions: VideoTransformOptions = {
        mode: 'video',
        format: 'jpg'
      };
      expect(isValidFormatForMode(invalidOptions)).toBe(false);
    });
  });
  
  describe('Advanced video options validation', () => {
    it('should validate quality values', () => {
      const validQualities = ['low', 'medium', 'high', 'auto'];
      
      // Valid quality values
      expect(isValidQuality('low', validQualities)).toBe(true);
      expect(isValidQuality('medium', validQualities)).toBe(true);
      expect(isValidQuality('high', validQualities)).toBe(true);
      expect(isValidQuality('auto', validQualities)).toBe(true);
      expect(isValidQuality(null, validQualities)).toBe(true); // Null is valid (default)
      
      // Invalid quality values
      expect(isValidQuality('ultra', validQualities)).toBe(false);
      expect(isValidQuality('invalid', validQualities)).toBe(false);
    });
    
    it('should validate compression values', () => {
      const validCompression = ['low', 'medium', 'high', 'auto'];
      
      // Valid compression values
      expect(isValidCompression('low', validCompression)).toBe(true);
      expect(isValidCompression('medium', validCompression)).toBe(true);
      expect(isValidCompression('high', validCompression)).toBe(true);
      expect(isValidCompression('auto', validCompression)).toBe(true);
      expect(isValidCompression(null, validCompression)).toBe(true); // Null is valid (default)
      
      // Invalid compression values
      expect(isValidCompression('super', validCompression)).toBe(false);
      expect(isValidCompression('invalid', validCompression)).toBe(false);
    });
    
    it('should validate preload values', () => {
      const validPreload = ['none', 'metadata', 'auto'];
      
      // Valid preload values
      expect(isValidPreload('none', validPreload)).toBe(true);
      expect(isValidPreload('metadata', validPreload)).toBe(true);
      expect(isValidPreload('auto', validPreload)).toBe(true);
      expect(isValidPreload(null, validPreload)).toBe(true); // Null is valid (default)
      
      // Invalid preload values
      expect(isValidPreload('lazy', validPreload)).toBe(false);
      expect(isValidPreload('eager', validPreload)).toBe(false);
    });
    
    it('should validate playback options', () => {
      // Valid combinations
      const validOptions1: VideoTransformOptions = {
        mode: 'video',
        loop: true
      };
      expect(isValidPlaybackOptions(validOptions1)).toBe(true);
      
      const validOptions2: VideoTransformOptions = {
        mode: 'video',
        autoplay: true,
        muted: true
      };
      expect(isValidPlaybackOptions(validOptions2)).toBe(true);
      
      // Invalid combinations - loop with non-video mode
      const invalidOptions1: VideoTransformOptions = {
        mode: 'frame',
        loop: true
      };
      expect(isValidPlaybackOptions(invalidOptions1)).toBe(false);
      
      // Invalid combinations - autoplay with unmuted audio
      const invalidOptions2: VideoTransformOptions = {
        mode: 'video',
        autoplay: true,
        muted: false,
        audio: true
      };
      expect(isValidPlaybackOptions(invalidOptions2)).toBe(false);
    });
  });
});