/**
 * Unit tests for the centralized logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  logDebug,
  logInfo,
  logWarn,
  logError,
  logErrorWithContext,
  createCategoryLogger,
  startPerformanceMeasurement,
  flushPerformanceMetrics,
  clearPerformanceMetrics,
  type LogOptions,
  type EnrichmentOptions,
} from '../logger';
import { LoggingConfigurationManager } from '../../config/LoggingConfigurationManager';

// Mock the dependencies
vi.mock('../requestContext', () => ({
  getCurrentContext: vi.fn(),
  createRequestContext: vi.fn(),
  setCurrentContext: vi.fn(),
}));

vi.mock('../pinoLogger', () => ({
  createLogger: vi.fn(() => ({})),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  updatePinoLoggerConfig: vi.fn(),
}));

vi.mock('../../config/LoggingConfigurationManager', () => {
  const mockInstance = {
    shouldLogComponent: vi.fn(() => true),
    shouldLogPerformance: vi.fn(() => true),
    getPerformanceThreshold: vi.fn(() => 100),
  };

  return {
    LoggingConfigurationManager: {
      getInstance: vi.fn(() => mockInstance),
    },
  };
});

// Import mocked modules
import { getCurrentContext } from '../requestContext';
import * as pinoLogger from '../pinoLogger';

describe('Logger', () => {
  const mockContext = {
    requestId: 'test-123',
    url: 'https://example.com/test',
    startTime: 0,
    breadcrumbs: [],
    diagnostics: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset performance.now() to return predictable values
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Logging Functions', () => {
    it('should log debug messages', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      logDebug('TestComponent', 'Debug message', { data: 'test' });

      expect(pinoLogger.debug).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Debug message',
        expect.objectContaining({ data: 'test' })
      );
    });

    it('should log info messages', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      logInfo('TestComponent', 'Info message', { count: 42 });

      expect(pinoLogger.info).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Info message',
        expect.objectContaining({ count: 42 })
      );
    });

    it('should log warning messages', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      logWarn('TestComponent', 'Warning message', { warning: true });

      expect(pinoLogger.warn).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Warning message',
        expect.objectContaining({ warning: true })
      );
    });

    it('should log error messages', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      logError('TestComponent', 'Error message', { error: 'details' });

      expect(pinoLogger.error).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Error message',
        expect.objectContaining({ error: 'details' })
      );
    });

    it('should fallback to console when no context available', () => {
      (getCurrentContext as any).mockReturnValue(null);
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      logInfo('TestComponent', 'Fallback message');

      expect(consoleSpy).toHaveBeenCalledWith('[TestComponent] Fallback message', {});
      expect(pinoLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('Component Filtering', () => {
    it('should respect component filtering', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);
      const loggingConfig = LoggingConfigurationManager.getInstance();
      (loggingConfig.shouldLogComponent as any).mockReturnValue(false);

      logDebug('FilteredComponent', 'Should not log');

      expect(pinoLogger.debug).not.toHaveBeenCalled();
    });

    it('should bypass filtering with force option', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);
      const loggingConfig = LoggingConfigurationManager.getInstance();
      (loggingConfig.shouldLogComponent as any).mockReturnValue(false);

      logDebug('FilteredComponent', 'Should log anyway', {}, { force: true });

      expect(pinoLogger.debug).toHaveBeenCalled();
    });
  });

  describe('Log Enrichment', () => {
    it('should enrich logs with timing information', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      const options: LogOptions = {
        enrich: {
          includeTiming: true,
        },
      };

      logInfo('TestComponent', 'Enriched message', {}, options);

      expect(pinoLogger.info).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Enriched message',
        expect.objectContaining({
          timing: expect.objectContaining({
            elapsed: expect.stringMatching(/\d+ms/),
            timestamp: expect.any(String),
            breadcrumbCount: 0,
          }),
        })
      );
    });

    it('should enrich logs with request metadata', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      const options: LogOptions = {
        enrich: {
          includeRequestMetadata: true,
        },
      };

      logInfo('TestComponent', 'Request enriched', {}, options);

      expect(pinoLogger.info).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Request enriched',
        expect.objectContaining({
          request: expect.objectContaining({
            url: 'https://example.com/test',
            requestId: 'test-123',
            breadcrumbCount: 0,
          }),
        })
      );
    });

    it('should enrich logs with environment information', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      const options: LogOptions = {
        enrich: {
          includeEnvironment: true,
        },
      };

      logInfo('TestComponent', 'Environment enriched', {}, options);

      expect(pinoLogger.info).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Environment enriched',
        expect.objectContaining({
          environment: expect.objectContaining({
            runtime: expect.any(String),
            platform: expect.any(String),
          }),
        })
      );
    });
  });

  describe('Category Logger', () => {
    it('should create category-specific logger', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      const logger = createCategoryLogger('MyService');

      logger.debug('Debug from category');
      logger.info('Info from category');
      logger.warn('Warn from category');
      logger.error('Error from category');

      expect(pinoLogger.debug).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'MyService',
        'Debug from category',
        expect.any(Object)
      );

      expect(pinoLogger.info).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'MyService',
        'Info from category',
        expect.any(Object)
      );
    });

    it('should handle error with context in category logger', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      const logger = createCategoryLogger('MyService');
      const testError = new Error('Test error');

      logger.errorWithContext('Error occurred', testError, { additional: 'data' });

      expect(pinoLogger.error).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'MyService',
        'Error occurred',
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Test error',
            name: 'Error',
            stack: expect.any(String),
          }),
          additional: 'data',
        })
      );
    });
  });

  describe('Performance Monitoring', () => {
    beforeEach(() => {
      // Mock setTimeout to execute immediately
      vi.useFakeTimers();
      // Clear any accumulated metrics from previous tests
      clearPerformanceMetrics();
    });

    afterEach(() => {
      vi.useRealTimers();
      // Clean up after tests
      clearPerformanceMetrics();
    });

    it('should measure performance and warn on slow operations', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      // Mock performance.now to simulate a slow operation
      let timeValue = 0;
      vi.spyOn(performance, 'now')
        .mockImplementationOnce(() => timeValue) // Start time
        .mockImplementationOnce(() => timeValue + 150); // End time (150ms)

      const stopMeasurement = startPerformanceMeasurement('slowOperation', 'TestComponent');
      stopMeasurement();

      // Should log a warning for slow operation
      expect(pinoLogger.warn).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Slow operation detected: slowOperation',
        expect.objectContaining({
          duration: '150ms',
          threshold: '100ms',
        })
      );
    });

    it('should batch performance metrics', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      // Create multiple measurements
      let timeValue = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => timeValue++);

      const stop1 = startPerformanceMeasurement('op1', 'Service1');
      const stop2 = startPerformanceMeasurement('op2', 'Service2');

      stop1();
      stop2();

      // Manually flush metrics instead of waiting for timer
      flushPerformanceMetrics();

      // Should log aggregated metrics
      expect(pinoLogger.info).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'PerformanceMonitor',
        'Performance metrics summary',
        expect.objectContaining({
          totalOperations: 2,
          averageDuration: expect.any(String),
          minDuration: expect.any(String),
          maxDuration: expect.any(String),
          p95Duration: expect.any(String),
          topOperations: expect.any(Array),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle Error objects properly', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      const error = new Error('Test error message');
      logErrorWithContext('TestComponent', 'An error occurred', error);

      expect(pinoLogger.error).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'An error occurred',
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Test error message',
            name: 'Error',
            stack: expect.any(String),
          }),
        })
      );
    });

    it('should handle non-Error objects', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      logErrorWithContext('TestComponent', 'String error', 'Just a string error');

      expect(pinoLogger.error).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'String error',
        expect.objectContaining({
          error: {
            message: 'Just a string error',
            type: 'string',
          },
        })
      );
    });

    it('should handle null/undefined errors', () => {
      (getCurrentContext as any).mockReturnValue(mockContext);

      logErrorWithContext('TestComponent', 'Null error', null);

      expect(pinoLogger.error).toHaveBeenCalledWith(
        mockContext,
        expect.any(Object),
        'TestComponent',
        'Null error',
        expect.objectContaining({
          error: {
            message: 'Unknown error',
            type: 'unknown',
          },
        })
      );
    });
  });
});
