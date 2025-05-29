# Memory Optimization Plan for Video Resizer

## Overview
This plan addresses critical memory issues in the video resizer codebase while maintaining all existing functionality. The fixes are prioritized by impact and risk.

## Phase 1: Critical Memory Issues (High Priority)

### 1.1 Fix ArrayBuffer Loading for Range Requests
**File:** `src/utils/cacheOrchestrator.ts:885`

**Problem:** Entire video loaded into memory for range requests

**Solution:**
- Implement streaming range request handling
- Use `Response.body.getReader()` to process chunks
- Stream directly to client without buffering entire content

**Implementation Steps:**
1. Replace `arrayBuffer()` call with streaming approach
2. Create `StreamingRangeProcessor` utility class
3. Process chunks and emit only requested byte range
4. Update tests to verify range request functionality

**Estimated Impact:** 90% memory reduction for large video range requests

### 1.2 Fix Chunk Accumulation in Stream Storage
**File:** `src/services/kvStorage/streamStorage.ts:202-232`

**Problem:** Chunks accumulated in array then concatenated (2x memory usage)

**Solution:**
- Stream chunks directly to KV without accumulation
- Use TransformStream for chunk processing
- Implement rolling buffer for chunk boundaries

**Implementation Steps:**
1. Replace `currentChunkData: Uint8Array[]` with streaming approach
2. Create `ChunkStreamProcessor` class with TransformStream
3. Process chunks on-the-fly maintaining chunk size limits
4. Update chunk upload logic to work with streams

**Estimated Impact:** 50% memory reduction during chunk uploads

## Phase 2: Memory Leak Prevention (High Priority)

### 2.1 Add Bounds to Global State Maps
**Files:** 
- `src/services/kvStorage/chunkLockManager.ts:16`
- `src/utils/cacheOrchestrator.ts:37,41`

**Problem:** Unbounded growth of global maps

**Solution:**
- Implement LRU (Least Recently Used) cache with size limits
- Add aggressive TTL-based cleanup
- Use WeakMaps where appropriate

**Implementation Steps:**
1. Create `BoundedLRUMap` utility class with:
   - Max size limit (e.g., 1000 entries)
   - TTL support (e.g., 5 minutes)
   - Automatic eviction of oldest entries
2. Replace existing Maps with BoundedLRUMap
3. For chunkLockManager: Reduce cleanup interval to 5 seconds
4. Add metrics for map sizes and evictions

**Estimated Impact:** Prevents unbounded memory growth

### 2.2 Implement Request Coalescing Cleanup
**File:** `src/utils/cacheOrchestrator.ts`

**Problem:** Coalesced requests may leak on errors

**Solution:**
- Add proper cleanup in finally blocks
- Implement request timeout handling
- Add error boundary for coalesced requests

**Implementation Steps:**
1. Wrap all coalescing logic in try-finally blocks
2. Add 5-minute timeout for in-flight requests
3. Clean up map entries on any error condition
4. Add request tracking metrics

## Phase 3: Response Handling Optimization (Medium Priority)

### 3.1 Reduce Response Cloning
**File:** `src/utils/cacheOrchestrator.ts:488-522`

**Problem:** Multiple response clones increase memory usage

**Solution:**
- Use tee() for efficient stream splitting
- Lazy clone creation only when needed
- Share response bodies where possible

**Implementation Steps:**
1. Replace multiple `clone()` calls with `body.tee()`
2. Create `ResponseSplitter` utility for efficient splitting
3. Only create clones when actually needed (lazy evaluation)
4. Add response reuse logic for identical requests

**Estimated Impact:** 30-50% memory reduction per request

## Phase 4: Concurrency and Backpressure (Medium Priority)

### 4.1 Implement Dynamic Backpressure
**Files:**
- `src/utils/concurrencyQueue.ts`
- `src/services/kvStorage/streamStorage.ts:206`

**Problem:** Fixed concurrency limits, no backpressure

**Solution:**
- Dynamic concurrency based on memory pressure
- Implement backpressure signals
- Add queue size limits

**Implementation Steps:**
1. Add memory monitoring to ConcurrencyQueue
2. Implement dynamic concurrency adjustment (2-10 based on load)
3. Add max queue size limit (e.g., 100 tasks)
4. Implement backpressure propagation to callers
5. Add queue overflow handling

**Estimated Impact:** Better memory usage under high load

## Phase 5: Stream Lifecycle Management (Low Priority)

### 5.1 Proper Stream and AbortController Cleanup
**Problem:** Streams and controllers not always cleaned up

**Solution:**
- Implement comprehensive cleanup handlers
- Add stream lifecycle tracking
- Use finalizers for critical resources

**Implementation Steps:**
1. Create `StreamLifecycleManager` class
2. Track all active streams and controllers
3. Add cleanup in error paths and timeouts
4. Implement periodic orphan cleanup
5. Add metrics for active streams

## Implementation Schedule

### Week 1-2: Phase 1 (Critical Issues)
- Day 1-3: Implement streaming range requests
- Day 4-6: Fix chunk accumulation
- Day 7-10: Testing and validation

### Week 3: Phase 2 (Memory Leaks)
- Day 1-2: Implement BoundedLRUMap
- Day 3-4: Update global maps
- Day 5: Testing and metrics

### Week 4: Phase 3-4 (Optimizations)
- Day 1-2: Response handling optimization
- Day 3-4: Backpressure implementation
- Day 5: Integration testing

### Week 5: Phase 5 + Final Testing
- Day 1-2: Stream lifecycle management
- Day 3-5: Load testing and validation

## Testing Strategy

### Unit Tests
- Test each new utility class in isolation
- Verify memory bounds are respected
- Test error conditions and cleanup

### Integration Tests
- Test end-to-end video streaming
- Verify range requests work correctly
- Test high concurrency scenarios

### Load Tests
- Simulate 1000+ concurrent requests
- Monitor memory usage over time
- Verify no memory leaks after 24 hours

### Backward Compatibility Tests
- Ensure all existing APIs work unchanged
- Verify cache hit/miss behavior unchanged
- Test with existing client applications

## Monitoring and Metrics

### New Metrics to Add
1. Memory usage per request type
2. Active stream count
3. Global map sizes
4. Queue depths and rejection rates
5. GC pressure indicators

### Alerts to Configure
1. Memory usage > 80% of limit
2. Global map size > 1000 entries
3. Queue rejection rate > 5%
4. Stream leak detection (growing count)

## Rollback Plan

### Feature Flags
- Add feature flags for each optimization
- Allow gradual rollout and quick disable
- Default to old behavior initially

### Canary Deployment
- Deploy to 5% of traffic initially
- Monitor metrics for 24 hours
- Gradual rollout if metrics are good

### Emergency Rollback
- Keep previous version ready
- One-click rollback procedure
- Automated rollback on memory spike

## Success Criteria

1. **Memory Usage:** 50% reduction in peak memory
2. **Performance:** No increase in response times
3. **Reliability:** No increase in error rates
4. **Functionality:** All existing features work unchanged
5. **Monitoring:** All new metrics reporting correctly

## Risk Mitigation

1. **Risk:** Breaking existing functionality
   - **Mitigation:** Comprehensive test suite, feature flags

2. **Risk:** Performance degradation
   - **Mitigation:** Load testing, gradual rollout

3. **Risk:** New bugs from refactoring
   - **Mitigation:** Code review, incremental changes

4. **Risk:** Compatibility issues
   - **Mitigation:** Backward compatibility tests

## Appendix: Code Examples

### Example: Streaming Range Processor
```typescript
class StreamingRangeProcessor {
  constructor(private start: number, private end: number) {}
  
  createTransformStream(): TransformStream<Uint8Array, Uint8Array> {
    let position = 0;
    return new TransformStream({
      transform(chunk, controller) {
        const chunkEnd = position + chunk.length;
        if (position < this.end && chunkEnd > this.start) {
          const sliceStart = Math.max(0, this.start - position);
          const sliceEnd = Math.min(chunk.length, this.end - position + 1);
          controller.enqueue(chunk.slice(sliceStart, sliceEnd));
        }
        position = chunkEnd;
      }
    });
  }
}
```

### Example: BoundedLRUMap
```typescript
class BoundedLRUMap<K, V> {
  private map = new Map<K, { value: V; timestamp: number }>();
  private maxSize: number;
  private ttlMs: number;
  
  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }
  
  set(key: K, value: V): void {
    this.cleanup();
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, { value, timestamp: Date.now() });
  }
  
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (now - entry.timestamp > this.ttlMs) {
        this.map.delete(key);
      }
    }
  }
}
```