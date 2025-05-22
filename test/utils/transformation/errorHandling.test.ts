import { describe, expect, it } from 'vitest';
import { parseErrorMessage } from '../../../src/utils/transformation/errorHandling';

describe('errorHandling', () => {
  describe('parseErrorMessage', () => {
    it('should parse seek time exceeded errors', () => {
      const result = parseErrorMessage('Error: seek time exceeds video duration');
      
      expect(result.errorType).toBe('seek_time_error');
      expect(result.parameter).toBe('time');
      expect(result.specificError).toContain('timestamp');
    });
    
    it('should parse invalid mode combination errors', () => {
      const result = parseErrorMessage('Error: invalid mode combination');
      
      expect(result.errorType).toBe('invalid_mode_error');
      expect(result.parameter).toBe('mode');
      expect(result.specificError).toContain('parameter combination');
    });
    
    it('should parse 404 not found errors', () => {
      const result = parseErrorMessage('Error: 404 not found');
      
      expect(result.errorType).toBe('video_not_readable');
      expect(result.parameter).toBe('source');
      expect(result.specificError).toContain('404 Not Found');
    });
    
    it('should parse "resource not found" errors', () => {
      const result = parseErrorMessage('Error: resource not found');
      
      expect(result.errorType).toBe('video_not_readable');
      expect(result.parameter).toBe('source');
      expect(result.specificError).toContain('404 Not Found');
    });
    
    it('should parse "source does not exist" errors', () => {
      const result = parseErrorMessage('Error: source does not exist');
      
      expect(result.errorType).toBe('video_not_readable');
      expect(result.parameter).toBe('source');
      expect(result.specificError).toContain('does not exist');
    });
    
    it('should parse invalid parameter errors', () => {
      const result = parseErrorMessage('Error: invalid parameter for time');
      
      expect(result.errorType).toBe('invalid_parameter_error');
      expect(result.parameter).toBe('time');
      expect(result.specificError).toContain('Invalid value or format');
    });
    
    it('should parse general invalid value errors', () => {
      const result = parseErrorMessage('Error: invalid value in request');
      
      expect(result.errorType).toBe('invalid_parameter_error');
      expect(result.parameter).toBe('unknown');
      expect(result.specificError).toContain('Invalid parameter value');
    });
    
    it('should parse unsupported codec errors', () => {
      const result = parseErrorMessage('Error: unsupported codec in source video');
      
      expect(result.errorType).toBe('codec_error');
      expect(result.parameter).toBe('format');
      expect(result.specificError).toContain('codec or format is not supported');
    });
    
    it('should parse unsupported format errors', () => {
      const result = parseErrorMessage('Error: format not supported');
      
      expect(result.errorType).toBe('codec_error');
      expect(result.parameter).toBe('format');
      expect(result.specificError).toContain('codec or format is not supported');
    });
    
    it('should parse time format errors', () => {
      const result = parseErrorMessage('Error: invalid time format - time: attribute must be in the format');
      
      expect(result.errorType).toBe('time_format_error');
      expect(result.parameter).toBe('time');
      expect(result.specificError).toContain('time parameter has an invalid format');
    });
    
    it('should parse resource limit errors', () => {
      const result = parseErrorMessage('Error: resource limit exceeded');
      
      expect(result.errorType).toBe('resource_limit_error');
      expect(result.parameter).toBe('service');
      expect(result.specificError).toContain('high load');
    });
    
    it('should parse rate limit errors', () => {
      const result = parseErrorMessage('Error: rate limit exceeded');
      
      expect(result.errorType).toBe('resource_limit_error');
      expect(result.parameter).toBe('service');
      expect(result.specificError).toContain('rate limits');
    });
    
    it('should parse duration limit errors', () => {
      const result = parseErrorMessage('Error: duration: attribute must be between 100ms and 10.0s');
      
      expect(result.errorType).toBe('duration_limit');
      expect(result.parameter).toBe('duration');
      expect(result.specificError).toContain('between 100ms and 10s');
    });
    
    it('should parse file size limit errors', () => {
      const result = parseErrorMessage('Error: Input video must be less than 256000000 bytes');
      
      expect(result.errorType).toBe('file_size_limit');
      expect(result.parameter).toBe('fileSize');
      expect(result.specificError).toContain('MB');
    });
    
    it('should return original message for unknown error patterns', () => {
      const errorText = 'Unknown error without specific pattern';
      const result = parseErrorMessage(errorText);
      
      expect(result.originalMessage).toBe(errorText);
      expect(result.errorType).toBeUndefined();
      expect(result.specificError).toBeUndefined();
    });
  });
});