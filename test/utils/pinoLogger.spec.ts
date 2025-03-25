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
  
  it('should add breadcrumb and log when using debug', () => {
    const mockRequest = new Request('https://example.com/video.mp4?debug=true');
    const context = createRequestContext(mockRequest);
    const logger = pinoLoggerModule.createLogger(context);
    
    // Spy on logger methods
    const debugSpy = vi.spyOn(logger, 'debug');
    
    // Use debug method
    pinoLoggerModule.debug(context, logger, 'TestComponent', 'Debug message', { key: 'value' });
    
    // Check that breadcrumb was added
    expect(context.breadcrumbs.length).toBe(1);
    expect(context.breadcrumbs[0].category).toBe('TestComponent');
    expect(context.breadcrumbs[0].message).toBe('Debug message');
    expect(context.breadcrumbs[0].data).toEqual({ key: 'value' });
    
    // Check that logger was called
    expect(debugSpy).toHaveBeenCalled();
  });
  
  it('should not log debug messages when debug mode is disabled', () => {
    const mockRequest = new Request('https://example.com/video.mp4');
    const context = createRequestContext(mockRequest);
    const logger = pinoLoggerModule.createLogger(context);
    
    // Spy on logger methods
    const debugSpy = vi.spyOn(logger, 'debug');
    
    // Use debug method
    pinoLoggerModule.debug(context, logger, 'TestComponent', 'Debug message');
    
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