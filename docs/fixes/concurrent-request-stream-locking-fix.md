# Concurrent Request Stream Locking Fix

## Issue: 500 Errors During Concurrent Requests

### Problem Summary
When multiple concurrent requests arrive for the same video that is not in the KV cache, the worker returns 500 errors with the message:
```
ProcessingError: This ReadableStream is currently locked to a reader
    at handleVideoRequestWithOriginsImpl (index.js:29279:46)
```

### Root Cause Analysis

1. **Request Coalescing**: The system implements request coalescing to avoid duplicate origin fetches
2. **Shared Response Object**: All concurrent requests waiting on the same transformation receive the same `Response` object
3. **Stream Locking Issue**: The error occurs when multiple concurrent requests try to clone the shared response for KV storage. Once one request starts cloning/reading the stream, the others fail with "ReadableStream is locked"

### The Fix

Clone the response ONLY for concurrent requests that joined an existing transformation:

```typescript
// CRITICAL: Clone response ONLY for coalesced requests to avoid stream locking
// When request coalescing occurs, multiple requests share the same Response object.
// The ResponseBuilder needs to read the body stream, which can only be done once.
// Only clone for requests that joined an existing transformation to minimize memory usage.
// The first request (that initiated the transformation) uses the original response.
let finalResponse = response;
if (existingTransform) {
  finalResponse = response.clone();
  debug(context, logger, 'VideoHandlerWithOrigins', 'Cloned response for coalesced request', {
    origin: originMatch.origin.name,
    status: response.status,
    reason: 'Avoiding stream lock on shared response'
  });
}

// Later in the code, use finalResponse for KV storage:
const responseForKV = finalResponse.clone();
```

### Why This Approach?

1. **Minimal Memory Impact**: Only clones for coalesced requests, not all requests
2. **Temporary Issue**: Only affects initial cache miss; subsequent requests are served from KV
3. **Better Than Alternatives**: 
   - Disabling request coalescing would cause duplicate origin fetches
   - Failing some requests would provide poor user experience
   - The cloned response is short-lived (only during request processing)

### Technical Details

- **Location**: `src/handlers/videoHandlerWithOrigins.ts` lines 554-562 and 606
- **Impact**: Prevents 500 errors during concurrent requests for uncached videos
- **Memory Usage**: Temporary increase only during concurrent cache misses
- **Performance**: `response.clone()` is efficient in Workers environment

### Testing Notes

To verify the fix:
1. Clear KV cache for a test video
2. Send multiple concurrent requests for the same video
3. All requests should receive successful responses without 500 errors
4. Check logs for "Cloned response for coalesced request" messages
5. Verify only coalesced requests show clone messages, not the initial request