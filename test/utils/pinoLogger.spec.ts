import { describe, it, expect, vi } from 'vitest';
import * as pinoLoggerModule from '../../src/utils/pinoLogger';
import { createRequestContext } from '../../src/utils/requestContext';

describe('PinoLogger', () => {
  it('should create a logger with basic methods', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);

    const logger = pinoLoggerModule.createLogger(context);

    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  // This test checks that debug level properly adds breadcrumbs and calls the debug method
  // when debug mode is enabled
  it('should add breadcrumb and log when using debug', () => {
    const mockRequest = new Request('https://example.com/video.mp4?debug=true');
    const context = createRequestContext(mockRequest);

    // Explicitly set debug enabled for test
    context.debugEnabled = true;

    const logger = pinoLoggerModule.createLogger(context);

    // Create mock logger with debugSpy
    const debugSpy = vi.fn();
    const mockedLogger = {
      debug: debugSpy,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      level: 'debug', // Important: set log level to debug to allow debug logs
    };

    // Use debug method with our mocked logger
    pinoLoggerModule.debug(context, mockedLogger as any, 'TestComponent', 'Debug message', {
      key: 'value',
    });

    // Check that breadcrumb was added
    expect(context.breadcrumbs.length).toBe(1);
    expect(context.breadcrumbs[0].category).toBe('TestComponent');
    expect(context.breadcrumbs[0].message).toBe('Debug message');
    expect(context.breadcrumbs[0].data).toEqual({ key: 'value' });

    // Check that the debug method was called on our mocked logger
    expect(debugSpy).toHaveBeenCalled();
  });

  it('should not log debug messages when debug mode is disabled', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);

    // Create a mock logger with level 'info' to suppress debug logging
    const debugSpy = vi.fn();
    const mockedLogger = {
      debug: debugSpy,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      level: 'info', // Set log level to 'info' so debug logs are suppressed
    };

    // Use debug method with our mocked logger
    pinoLoggerModule.debug(context, mockedLogger as any, 'TestComponent', 'Debug message');

    // Check that breadcrumb was added but logger wasn't called
    expect(context.breadcrumbs.length).toBe(1);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('should add breadcrumb and log for info level', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const logger = pinoLoggerModule.createLogger(context);

    // Spy on logger methods
    const infoSpy = vi.spyOn(logger, 'info');

    // Use info method
    pinoLoggerModule.info(context, logger, 'TestComponent', 'Info message');

    // Check that breadcrumb was added
    expect(context.breadcrumbs.length).toBe(1);
    expect(context.breadcrumbs[0].category).toBe('TestComponent');
    expect(context.breadcrumbs[0].message).toBe('Info message');

    // Check that logger was called
    expect(infoSpy).toHaveBeenCalled();
  });

  it('should add breadcrumb and log for warn level', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const logger = pinoLoggerModule.createLogger(context);

    // Spy on logger methods
    const warnSpy = vi.spyOn(logger, 'warn');

    // Use warn method
    pinoLoggerModule.warn(context, logger, 'TestComponent', 'Warning message');

    // Check that breadcrumb was added
    expect(context.breadcrumbs.length).toBe(1);
    expect(context.breadcrumbs[0].category).toBe('TestComponent');
    expect(context.breadcrumbs[0].message).toBe('Warning message');

    // Check that logger was called
    expect(warnSpy).toHaveBeenCalled();
  });

  it('should add breadcrumb and log for error level', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const logger = pinoLoggerModule.createLogger(context);

    // Spy on logger methods
    const errorSpy = vi.spyOn(logger, 'error');

    // Use error method
    pinoLoggerModule.error(context, logger, 'TestComponent', 'Error message');

    // Check that breadcrumb was added
    expect(context.breadcrumbs.length).toBe(1);
    expect(context.breadcrumbs[0].category).toBe('TestComponent');
    expect(context.breadcrumbs[0].message).toBe('Error message');

    // Check that logger was called
    expect(errorSpy).toHaveBeenCalled();
  });
});
