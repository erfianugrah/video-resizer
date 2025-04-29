# Error Handling Guide for Video Resizer

## Introduction

This guide provides a comprehensive overview of the error handling system in the video-resizer project, including its architecture, implementation patterns, best practices, and common error scenarios.

## Table of Contents

- [Error Handling Architecture](#error-handling-architecture)
- [Error Handling Utilities](#error-handling-utilities)
- [Error Types and Hierarchy](#error-types-and-hierarchy)
- [Implementation Patterns](#implementation-patterns)
- [Common Error Scenarios](#common-error-scenarios)
- [Best Practices](#best-practices)
- [Performance Considerations](#performance-considerations)
- [KV Rate Limit Handling](#kv-rate-limit-handling)
- [Testing Error Handling](#testing-error-handling)
- [Debugging Error Scenarios](#debugging-error-scenarios)
- [Implementation Examples](#implementation-examples)

...

<!-- Keep the middle content unchanged, just inserting the KV rate limit section -->

## Performance Considerations

### 1. Logging Levels

Adjust logging for performance-critical paths:

```typescript
// High-volume utility - minimal logging
export const parseQueryParam = tryOrDefault<[string], QueryParam>(
  parseQueryParamImpl,
  {
    functionName: 'parseQueryParam',
    component: 'QueryUtils',
    logErrors: false // Disable logging for high-volume function
  },
  DEFAULT_QUERY_PARAM
);

// Critical business logic - full logging
export const transformVideo = withErrorHandling<[string, Options], Response>(
  transformVideoImpl,
  {
    functionName: 'transformVideo',
    component: 'TransformationService',
    logErrors: true // Enable full logging for critical operation
  }
);
```

### 2. Error Context Size

Keep error context size reasonable:

```typescript
// BAD: Too much data in context
logErrorWithContext('Error processing video', error, {
  requestHeaders: request.headers, // Potential large object
  videoContent: videoData,         // Very large binary data
  fullConfig: config                // Large configuration object
});

// GOOD: Focused, relevant context
logErrorWithContext('Error processing video', error, {
  contentType: request.headers.get('content-type'),
  contentLength: videoData.length,
  configVersion: config.version
});
```

### 3. Error Rate Limiting

For high-frequency errors, implement rate limiting:

```typescript
// Error rate limiting helper
const errorRates = new Map<string, { count: number, firstSeen: number }>();

function shouldLogError(errorKey: string, maxPerMinute: number = 10): boolean {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const key = `${errorKey}:${minute}`;
  
  if (!errorRates.has(key)) {
    errorRates.set(key, { count: 1, firstSeen: now });
    return true;
  }
  
  const rate = errorRates.get(key)!;
  rate.count++;
  
  // Clean up old entries
  for (const [oldKey, value] of errorRates.entries()) {
    if (now - value.firstSeen > 60000) {
      errorRates.delete(oldKey);
    }
  }
  
  return rate.count <= maxPerMinute;
}

// Usage
if (shouldLogError('fetch_failure', 5)) {
  logErrorWithContext('Fetch operation failed', error, context);
}
```

## KV Rate Limit Handling

Cloudflare KV enforces a rate limit of 1 write per second per key. Our system implements a comprehensive retry mechanism with exponential backoff to handle these rate limits gracefully. For detailed implementation, see [KV Rate Limit Handling](./kv-rate-limit-handling.md).

### 1. Retry Strategy

```typescript
const maxRetries = 3;
let attemptCount = 0;
let success = false;
let lastError: Error | null = null;

while (attemptCount < maxRetries && !success) {
  try {
    attemptCount++;
    await namespace.put(key, data, options);
    success = true;
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    const isRateLimitError = 
      lastError.message.includes('429') || 
      lastError.message.includes('409') || 
      lastError.message.includes('rate limit') ||
      lastError.message.includes('conflict');
    
    if (!isRateLimitError || attemptCount >= maxRetries) {
      throw lastError;
    }
    
    // Exponential backoff: 200ms, 400ms, 800ms, etc.
    const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
  }
}
```

### 2. Background Processing with waitUntil

For non-blocking operations, we use Cloudflare's `waitUntil` with retry logic:

```typescript
ctx.waitUntil(
  (async () => {
    const maxRetries = 3;
    let attemptCount = 0;
    
    while (attemptCount < maxRetries) {
      try {
        attemptCount++;
        await kv.put(key, value, options);
        return; // Success
      } catch (err) {
        if (!isRateLimitError(err) || attemptCount >= maxRetries) {
          logDebug('Operation failed after retries', { 
            attempts: attemptCount,
            error: err.message
          });
          return; // Exit the async function
        }
        
        // Backoff before retry
        await new Promise(resolve => setTimeout(resolve, 
          Math.min(200 * Math.pow(2, attemptCount - 1), 2000)
        ));
      }
    }
  })()
);
```

### 3. Critical vs. Non-Critical Operations

We handle different types of operations differently:

- **Critical operations** (e.g., primary content storage): Throw errors after retries are exhausted
- **Non-critical operations** (e.g., cache versioning): Log errors but don't throw after retries

## Testing Error Handling

<!-- The rest of the document continues from here -->
...