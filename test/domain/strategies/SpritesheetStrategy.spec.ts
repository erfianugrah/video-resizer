import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpritesheetStrategy } from '../../../src/domain/strategies/SpritesheetStrategy';
import { TransformationContext } from '../../../src/domain/strategies/TransformationStrategy';
import { VideoTransformOptions } from '../../../src/domain/commands/TransformVideoCommand';

// Mock the ValidationError module first (due to hoisting)
vi.mock('../../../src/errors/ValidationError', () => {
  class MockValidationError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ValidationError';
    }
    
    static missingRequiredParameter(param) {
      return new MockValidationError(`Missing required parameter: ${param}`);
    }
    
    static invalidDimension(param, value, min, max) {
      return new MockValidationError(`Invalid ${param}: ${value}. Must be between ${min} and ${max}.`);
    }
    
    static invalidTimeValue(param, value) {
      return new MockValidationError(`Invalid ${param}: ${value}. Must be a valid time value.`);
    }
    
    static invalidOptionCombination(message) {
      return new MockValidationError(message);
    }
  }
  
  return {
    ValidationError: MockValidationError
  };
});

// Mock transformationUtils
vi.mock('../../../src/utils/transformationUtils', () => {
  return {
    isValidTime: vi.fn().mockImplementation(time => {
      // Basic validation - accept anything with s suffix in 0-60s range
      if (typeof time !== 'string') return false;
      if (!time.endsWith('s')) return false;
      
      const seconds = parseInt(time);
      return !isNaN(seconds) && seconds >= 0 && seconds <= 60;
    }),
    isValidDuration: vi.fn().mockImplementation(duration => {
      // Basic validation - accept anything with s suffix in positive range
      if (typeof duration !== 'string') return false;
      if (!duration.endsWith('s')) return false;
      
      const seconds = parseInt(duration);
      return !isNaN(seconds) && seconds > 0;
    }),
    parseTimeString: vi.fn().mockImplementation(timeStr => {
      if (typeof timeStr !== 'string') return null;
      if (!timeStr.endsWith('s')) return null;
      
      const seconds = parseInt(timeStr);
      return !isNaN(seconds) ? seconds : null;
    })
  };
});

// Mock the VideoConfigurationManager
vi.mock('../../../src/config', () => {
  const mockInstance = {
    getParamMapping: vi.fn().mockReturnValue({
      width: 'width',
      height: 'height',
      mode: 'mode',
      fit: 'fit',
      time: 'time',
      duration: 'duration',
      loop: 'loop',
      autoplay: 'autoplay',
      muted: 'muted',
      preload: 'preload',
      quality: 'quality',
      compression: 'compression',
      format: 'format'
    }),
    getValidOptions: vi.fn().mockReturnValue(['contain', 'cover', 'scale-down']),
    isValidOption: vi.fn().mockImplementation((param, value) => {
      if (param === 'fit') {
        return ['contain', 'cover', 'scale-down'].includes(value);
      }
      return true;
    })
  };

  return {
    VideoConfigurationManager: {
      getInstance: vi.fn().mockReturnValue(mockInstance)
    }
  };
});

// Mock logger
vi.mock('../../../src/utils/loggerUtils', () => {
  return {
    debug: vi.fn()
  };
});

describe('SpritesheetStrategy', () => {
  let strategy: SpritesheetStrategy;
  let defaultOptions: VideoTransformOptions;
  let context: TransformationContext;

  beforeEach(() => {
    strategy = new SpritesheetStrategy();
    defaultOptions = {
      width: 800,
      height: 600,
      mode: 'spritesheet',
      fit: 'contain',
      audio: null,
      format: null,
      time: null,
      duration: null,
      quality: null,
      compression: null,
      loop: null,
      autoplay: null,
      muted: null,
      preload: null,
      derivative: null,
      source: null
    };
    
    context = {
      url: new URL('https://example.com/video.mp4'),
      options: { ...defaultOptions },
      pathPattern: {
        name: 'test',
        matcher: '^/test/',
        processPath: true,
        baseUrl: null,
        originUrl: 'https://origin.example.com',
        ttl: { ok: 86400, redirects: 3600, clientError: 60, serverError: 10 },
        useTtlByStatus: true
      },
      diagnosticsInfo: {
        url: 'https://example.com/video.mp4',
        transformationType: '',
        transformParams: {},
        warnings: [] as string[]
      },
      cacheOptions: {
        cacheability: true,
        ttl: 86400
      }
    };
  });

  describe('prepareTransformParams', () => {
    it('should prepare valid transformation parameters for spritesheet mode', () => {
      const params = strategy.prepareTransformParams(context);
      
      expect(params).toEqual({
        mode: 'spritesheet',
        width: 800,
        height: 600,
        fit: 'contain',
        time: '0s',
        duration: '10s'
      });
    });

    it('should set default time and duration if not provided', () => {
      const params = strategy.prepareTransformParams(context);
      
      expect(params.time).toBe('0s');
      expect(params.duration).toBe('10s');
    });

    it('should use provided time and duration if specified', () => {
      context.options.time = '5s';
      context.options.duration = '20s';
      
      const params = strategy.prepareTransformParams(context);
      
      expect(params.time).toBe('5s');
      expect(params.duration).toBe('20s');
    });

    it('should exclude playback parameters', () => {
      context.options.loop = true;
      context.options.autoplay = true;
      context.options.muted = true;
      context.options.preload = 'auto';
      
      const params = strategy.prepareTransformParams(context);
      
      expect(params.loop).toBeUndefined();
      expect(params.autoplay).toBeUndefined();
      expect(params.muted).toBeUndefined();
      expect(params.preload).toBeUndefined();
    });

    it('should exclude quality and compression parameters', () => {
      context.options.quality = 'high';
      context.options.compression = 'low';
      
      const params = strategy.prepareTransformParams(context);
      
      expect(params.quality).toBeUndefined();
      expect(params.compression).toBeUndefined();
    });
  });

  describe('validateOptions', () => {
    it('should require width parameter', async () => {
      context.options.width = null;
      
      await expect(strategy.validateOptions(context.options)).rejects.toThrow();
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/width|missing/i);
    });

    it('should require height parameter', async () => {
      context.options.height = null;
      
      await expect(strategy.validateOptions(context.options)).rejects.toThrow();
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/height|missing/i);
    });

    it('should validate width range', async () => {
      // Too small
      context.options.width = 5;
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/width/i);
      
      // Too large
      context.options.width = 3000;
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/width/i);
      
      // Valid
      context.options.width = 1000;
      await expect(strategy.validateOptions(context.options)).resolves.toBeUndefined();
    });

    it('should validate height range', async () => {
      // Too small
      context.options.height = 5;
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/height/i);
      
      // Too large
      context.options.height = 3000;
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/height/i);
      
      // Valid
      context.options.height = 1000;
      await expect(strategy.validateOptions(context.options)).resolves.toBeUndefined();
    });

    it('should validate fit parameter', async () => {
      // Invalid fit
      context.options.fit = 'invalid-fit';
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/fit/i);
      
      // Valid fit
      context.options.fit = 'cover';
      await expect(strategy.validateOptions(context.options)).resolves.toBeUndefined();
    });

    it('should validate time parameter', async () => {
      // Invalid time
      context.options.time = 'invalid-time';
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/time/i);
      
      // Valid time
      context.options.time = '10s';
      await expect(strategy.validateOptions(context.options)).resolves.toBeUndefined();
    });

    it('should validate duration parameter', async () => {
      // Invalid duration
      context.options.duration = 'invalid-duration';
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/duration/i);
      
      // Valid duration
      context.options.duration = '30s';
      await expect(strategy.validateOptions(context.options)).resolves.toBeUndefined();
    });

    it('should reject if format parameter is specified', async () => {
      context.options.format = 'jpg';
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/format parameter cannot be used/i);
    });

    it('should reject if quality parameter is specified', async () => {
      context.options.quality = 'high';
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/quality and compression parameters cannot be used/i);
    });

    it('should reject if compression parameter is specified', async () => {
      context.options.compression = 'low';
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/quality and compression parameters cannot be used/i);
    });

    it('should reject if playback parameters are specified', async () => {
      context.options.loop = true;
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/playback parameters/i);
      
      context.options.loop = null;
      context.options.autoplay = true;
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/playback parameters/i);
      
      context.options.autoplay = null;
      context.options.muted = true;
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/playback parameters/i);
      
      context.options.muted = null;
      context.options.preload = 'auto';
      await expect(strategy.validateOptions(context.options)).rejects.toThrow(/playback parameters/i);
    });
  });

  describe('updateDiagnostics', () => {
    it('should add spritesheet-specific information to diagnostics', () => {
      strategy.updateDiagnostics(context);
      
      expect(context.diagnosticsInfo.transformationType).toBe('spritesheet');
      expect(context.diagnosticsInfo.startTime).toBe('0s');
      expect(context.diagnosticsInfo.duration).toBe('10s');
      expect(context.diagnosticsInfo.outputFormat).toBe('jpg');
      expect(context.diagnosticsInfo.spritesheet).toBeDefined();
    });

    it('should use provided time and duration values when available', () => {
      context.options.time = '5s';
      context.options.duration = '15s';
      
      strategy.updateDiagnostics(context);
      
      expect(context.diagnosticsInfo.startTime).toBe('5s');
      expect(context.diagnosticsInfo.duration).toBe('15s');
    });

    it('should add warnings for extreme aspect ratios', () => {
      // Very wide ratio
      context.options.width = 2000;
      context.options.height = 200;
      
      strategy.updateDiagnostics(context);
      
      expect(context.diagnosticsInfo.ratioWarning).toMatch(
        /Extreme aspect ratio/
      );
      
      // Reset warnings
      delete context.diagnosticsInfo.ratioWarning;
      
      // Very tall ratio
      context.options.width = 200;
      context.options.height = 2000;
      
      strategy.updateDiagnostics(context);
      
      expect(context.diagnosticsInfo.ratioWarning).toMatch(
        /Extreme aspect ratio/
      );
    });

    it('should add warnings for long durations', () => {
      context.options.duration = '120s';
      
      strategy.updateDiagnostics(context);
      
      expect(context.diagnosticsInfo.durationWarning).toMatch(
        /may result in a very large spritesheet/
      );
    });
  });
});