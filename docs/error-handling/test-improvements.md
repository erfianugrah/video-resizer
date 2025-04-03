# Error Handling Test Improvements

## Overview

This document outlines recommended test improvements to properly validate the error handling mechanisms implemented across the video-resizer codebase. These test improvements will help ensure our error handling remains robust as the application evolves.

## General Testing Principles

1. **Error Path Testing**: For each function with error handling, create dedicated tests that trigger error scenarios
2. **Fallback Verification**: Verify that default values are correctly returned when errors occur
3. **Logging Capture**: Verify that errors are properly logged with expected context data
4. **Performance Impact**: Benchmark critical functions to ensure error handling doesn't significantly impact performance

## Specific Test Improvements by Module

### 1. urlTransformUtils.ts

```typescript
// Example test for transformRequestUrl with error handling
it('should use safe defaults when URL parsing fails', () => {
  // Arrange
  const badRequest = new Request('invalid://url');
  const config = { /* Mock config */ };
  
  // Act
  const result = transformRequestUrl(badRequest, config);
  
  // Assert
  expect(result.originUrl).toBeDefined();
  expect(result.bucketName).toBe('default');
  expect(result.isRemoteFetch).toBe(false);
});
```

Additional tests needed:
- Test error handling when buildOriginUrl throws
- Test error handling when getDerivativeForPath fails
- Test error handling when create origin request fails
- Test with malformed paths and URLs

### 2. clientHints.ts

```typescript
// Example test for client hints error handling
it('should handle client hints parsing errors gracefully', () => {
  // Arrange
  const mockRequest = new Request('https://example.com');
  mockRequest.headers.set('Sec-CH-Viewport-Width', 'not-a-number');
  
  // Act
  const result = getVideoSizeFromClientHints(mockRequest);
  
  // Assert
  expect(result.width).toBe(854); // Default width
  expect(result.height).toBe(480); // Default height
  expect(result.source).toBe('client-hints-error-fallback');
});
```

Additional tests needed:
- Test error handling for malformed DPR values
- Test error handling when VideoConfigurationManager throws
- Test correct fallback behavior for network quality detection errors

### 3. deviceUtils.ts

```typescript
// Example test for device detection error handling
it('should handle device capability detection errors', () => {
  // Arrange
  const mockRequest = new Request('https://example.com');
  // Setup so getDeviceTypeFromUserAgent throws an error
  vi.spyOn(userAgentUtils, 'getDeviceTypeFromUserAgent').mockImplementation(() => {
    throw new Error('Parsing failed');
  });
  
  // Act
  const result = detectDeviceCapabilities(mockRequest);
  
  // Assert
  expect(result.deviceType).toBe('desktop'); // Default device type
  expect(result.source).toBe('error-fallback');
});
```

Additional tests needed:
- Test error handling in CF-Device-Type parsing
- Test error handling for video size determination
- Test error handling with unusual User-Agent strings

### 4. cacheUtils.ts

```typescript
// Example test for cache config error handling
it('should use safe defaults when regex parsing fails', () => {
  // Arrange
  const url = 'https://example.com/videos/test.mp4';
  // Setup profile with invalid regex
  const mockProfile = {
    regex: '(invalid[regex',
    cacheability: true,
    // other properties
  };
  vi.spyOn(cacheConfig, 'getConfig').mockReturnValue({
    profiles: {
      testProfile: mockProfile
    }
  });
  
  // Act
  const result = determineCacheConfig(url);
  
  // Assert
  expect(result.cacheability).toBeDefined();
  expect(result.videoCompression).toBeDefined();
  expect(result.ttl).toBeDefined();
});
```

Additional tests needed:
- Test error handling when configuration manager is not available
- Test error handling when multiple regex patterns fail
- Test error handling for validation errors

### 5. transformationUtils.ts

```typescript
// Example test for transformation utility error handling
it('should handle duration parsing errors', () => {
  // Arrange
  const invalidTimeString = '12:ab:45';
  
  // Act
  const result = parseTimeString(invalidTimeString);
  
  // Assert
  expect(result).toBeNull(); // Should return null on error
});
```

Additional tests needed:
- Test error handling for all time-based functions
- Test error handling for parameter validation
- Test error handling for URL transformation errors
- Test correct handling of expected error messages

## Testing Error Logging

To properly test error logging, consider adding a mock logger that captures logged errors:

```typescript
// Example test for error logging
it('should log errors with appropriate context', () => {
  // Arrange
  const mockContext = { requestId: '123' };
  const mockLogger = { error: vi.fn() };
  vi.spyOn(getCurrentContext, 'getCurrentContext').mockReturnValue(mockContext);
  vi.spyOn(createLogger, 'createLogger').mockReturnValue(mockLogger);
  
  // Setup to trigger error
  vi.spyOn(transformationUtils, 'parseTimeStringImpl').mockImplementation(() => {
    throw new Error('Test error');
  });
  
  // Act
  parseTimeString('invalid');
  
  // Assert
  expect(mockLogger.error).toHaveBeenCalledWith(
    expect.stringContaining('parseTimeString'),
    expect.objectContaining({
      error: expect.any(Object),
      args: expect.any(Array)
    })
  );
});
```

## Test Coverage Goals

For each utility module, aim for:
1. At least one test per function that validates error handling
2. Tests for edge cases (null inputs, undefined values, malformed data)
3. Validation of correct default values when errors occur
4. Verification that error context is correctly populated

## Implementation Plan

1. Start with the most critical utilities (urlTransformUtils, cacheUtils)
2. Add tests for the client detection utilities (clientHints, deviceUtils)
3. Enhance test coverage for transformation utilities
4. Consider adding chaos testing to validate overall system resilience
5. Add performance benchmarks for critical error handling paths