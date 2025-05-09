# Request Coalescing Implementation

## Overview

Request coalescing (also known as the "single-flight" pattern) has been implemented in the video-resizer to handle multiple simultaneous requests efficiently and reliably. This implementation addresses two critical issues:

1. **Partial Content Storage Bug**: Previously, when a range request (HTTP 206) arrived first, only partial content was stored in KV, causing corruption for subsequent requests.
2. **Race Conditions**: Under high load, multiple simultaneous requests could compete to fetch and store the same resource, causing KV write conflicts.

## Implementation Details

### Core Components

1. **In-Flight Request Tracking**:
   - A static `Map<string, InFlightRequest>` stores all in-progress origin fetches
   - Enhanced with metadata for better observability (request count, timestamps, etc.)
   - Unique request IDs for tracking and diagnostics

2. **Cache Key Generation**:
   - Canonical cache key format ensures consistent access patterns
   - Handles video derivatives and IMQuery parameters
   - Matched to KV storage key format to prevent duplicates

3. **Response Handling**:
   - Full origin response is cloned immediately before any processing
   - Ensures the complete 200 OK response is stored in KV
   - Range requests (206 Partial Content) are processed correctly for clients

4. **Error Handling**:
   - Comprehensive try/catch blocks throughout the flow
   - Fallback strategies for each failure point
   - Recovery logic for unsatisfiable range requests
   - Enhanced logging for diagnostics

### Key Features

- **Request Coalescing**: Multiple simultaneous requests for the same resource share a single origin fetch
- **Reference Counting**: Tracks how many requests are using each in-flight request
- **Automatic Cleanup**: In-flight requests are removed from the map after completion
- **Retry Logic**: KV storage operations can retry with exponential backoff for transient errors
- **Diagnostics**: Enhanced logging and tracing headers for better observability

## Flow Diagram

```
Request ──┬─► KV Cache Hit ──► Return Cached Response
          │
          └─► KV Cache Miss ──┬─► Existing In-Flight Request ──► Wait & Return Response
                             └─► No In-Flight Request ──► Execute Handler ──► Store in KV ──► Return Response
```

## Error Handling

1. **Range Request Errors**:
   - Invalid ranges are detected and adjusted
   - Unsatisfiable ranges fall back to full responses
   - Diagnostic headers track recovery strategies

2. **KV Storage Errors**:
   - Retries with exponential backoff for rate limits and conflicts
   - Fallback strategies when retries fail
   - Background execution via waitUntil to prevent blocking

3. **Origin Fetch Errors**:
   - Propagated to all waiting requests
   - Detailed logging with request IDs for tracing
   - In-flight map cleanup even on errors

## Testing

The request coalescing implementation has been tested for:

1. Basic coalescing functionality (single handler execution)
2. Error propagation to all waiting requests
3. Range request handling during coalescing
4. Key separation for different resource paths
5. Performance under simultaneous request load

## Benefits

- **Reduced Origin Load**: Multiple clients share a single fetch
- **Prevented Race Conditions**: Single-writer pattern avoids KV conflicts
- **Improved Cache Integrity**: Only full responses are stored
- **Better Error Recovery**: Graceful fallbacks for edge cases
- **Enhanced Observability**: Detailed logging and diagnostics