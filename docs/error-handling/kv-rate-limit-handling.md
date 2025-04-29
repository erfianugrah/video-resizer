# KV Rate Limit Handling

## Problem

Cloudflare's KV storage enforces a rate limit of 1 write per second per key. This can lead to 409 Conflict errors when our application needs to perform multiple write operations to the same key in rapid succession, such as:

1. Writing the initial video content to KV storage
2. Refreshing TTL on cache hits
3. Storing or updating cache key versions

## Solution: Exponential Backoff Retry

We've implemented a comprehensive retry mechanism with exponential backoff throughout the `kvStorageService.ts` file. This approach makes our KV operations more resilient to rate limiting issues.

### Implementation Details

#### 1. Retry Strategy

- **Maximum Retries**: 3 attempts per operation
- **Backoff Algorithm**: Exponential with a base of 200ms
  - First retry: 200ms delay
  - Second retry: 400ms delay
  - Third retry: 800ms delay
  - Maximum delay capped at 2000ms
- **Error Detection**: Specifically targets rate limit errors (HTTP 409, 429)

#### 2. Key Components

1. **Main Content Storage Operation**
   - Implemented in `storeTransformedVideoImpl`
   - Handles initial storage of video content with metadata
   - Uses retry mechanism for primary content writes

2. **TTL Refresh Logic**
   - Implemented in `getTransformedVideoImpl`
   - Refreshes TTL on cache hits to extend expiration for frequently accessed content
   - Uses retry logic with `waitUntil` for background processing

3. **Version Storage Operations**
   - Implemented across multiple functions
   - Manages cache versioning for cache busting
   - Includes retry mechanisms for background and direct operations

### Usage Examples

```typescript
// Example retry pattern used throughout the codebase
const maxRetries = 3;
let attemptCount = 0;
let success = false;
let lastError: Error | null = null;

while (attemptCount < maxRetries && !success) {
  try {
    attemptCount++;
    
    // Perform KV operation
    await namespace.put(key, data, options);
    
    success = true;
    
    // Log success if retries were needed
    if (attemptCount > 1) {
      logDebug('Operation succeeded after retries', {
        attempts: attemptCount
      });
    }
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    const isRateLimitError = 
      lastError.message.includes('429') || 
      lastError.message.includes('409') || 
      lastError.message.includes('rate limit') ||
      lastError.message.includes('conflict');
    
    if (!isRateLimitError || attemptCount >= maxRetries) {
      // Either not a rate limit error or we've exhausted our retries
      throw lastError;
    }
    
    // Log the retry attempt
    logDebug('KV rate limit hit, retrying with backoff', {
      attempt: attemptCount,
      maxRetries,
      error: lastError.message
    });
    
    // Exponential backoff: 200ms, 400ms, 800ms, etc.
    const backoffMs = Math.min(200 * Math.pow(2, attemptCount - 1), 2000);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
  }
}
```

### Error Handling Considerations

1. **Critical vs. Non-Critical Operations**
   - For critical operations (e.g., primary content storage), we throw errors after retries are exhausted
   - For non-critical operations (e.g., version tracking), we log errors but don't throw

2. **Background Processing**
   - We use Cloudflare's `waitUntil` for non-blocking retries when available
   - This prevents retry delays from impacting response time

3. **Detailed Logging**
   - Each retry attempt is logged with detailed information
   - Success after retries is specifically noted in logs
   - Error details are captured for monitoring and debugging

## Benefits

1. **Improved Resilience**: The system gracefully handles transient rate limit errors
2. **Better User Experience**: Users don't see errors due to KV rate limits
3. **Reduced Error Rate**: 409 Conflict errors are significantly reduced
4. **Operational Visibility**: Detailed logging helps track retry patterns

## Limitations

1. **Maximum Delay**: The maximum delay is capped at 2 seconds
2. **Maximum Retries**: Limited to 3 retries to prevent excessive waiting
3. **Error Detection**: Only targets specific error types containing known patterns

## Future Enhancements

1. **Configurable Retry Parameters**: Move retry settings to configuration
2. **Jitter**: Add randomness to backoff times to prevent thundering herd problems
3. **Circuit Breaking**: Add circuit breaking for persistent failures
4. **Metrics**: Track retry counts and success rates for monitoring