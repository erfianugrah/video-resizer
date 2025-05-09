# KV Chunking for Large Videos

*Last Updated: May 10, 2025*

## Table of Contents

- [Overview](#overview)
- [How KV Chunking Works](#how-kv-chunking-works)
- [Implementation Details](#implementation-details)
- [Chunk Size Rationale](#chunk-size-rationale)
- [Storage Architecture](#storage-architecture)
- [Range Request Support](#range-request-support)
- [Error Resilience](#error-resilience)
- [Cache Management](#cache-management)
- [Performance Considerations](#performance-considerations)
- [Testing and Verification](#testing-and-verification)
- [Configuration Options](#configuration-options)
- [Best Practices](#best-practices)

## Overview

KV Chunking is a feature that enables storing large video files in Cloudflare KV storage by splitting them into smaller, manageable chunks. This addresses the 25MB value size limit of Cloudflare KV while maintaining efficient storage and retrieval of videos of any size.

Key benefits of KV Chunking include:

- Support for videos larger than 25MB (Cloudflare KV's size limit)
- Optimized streaming with precise range request handling
- Improved resilience with per-chunk error recovery
- Efficient memory usage during video streaming
- Comprehensive data integrity validation
- Automatic detection and handling based on video size

## How KV Chunking Works

The KV Chunking system follows a simple decision flow:

1. **Size Detection**: When storing a video, its size is checked
   - Videos under 20MB are stored as single KV entries
   - Videos 20MB or larger are stored as multiple chunks

2. **Chunking Process**: For large videos, the system:
   - Splits the video into 5MB chunks
   - Creates a manifest file with metadata
   - Stores each chunk with a unique key
   - Applies consistent cache tags to all parts

3. **Retrieval Process**: When fetching a chunked video:
   - The manifest is retrieved first
   - Required chunks are fetched based on the manifest
   - For range requests, only needed chunks are retrieved
   - The video is streamed to the client

4. **Integrity Verification**: The system ensures:
   - All chunks maintain the correct size
   - The total size matches the original video
   - Content type is preserved

## Implementation Details

The KV Chunking implementation involves several key components:

### Manifest Structure

The manifest is stored in the value of the base key and contains all necessary metadata:

```json
{
  "totalSize": 52428800,
  "chunkCount": 10,
  "actualChunkSizes": [5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880],
  "standardChunkSize": 5242880,
  "originalContentType": "video/mp4"
}
```

### Storage Process

1. Generate a base key for the video
2. Determine if chunking is needed based on size
3. For chunked videos:
   - Split into 5MB chunks
   - Create a manifest with metadata
   - Store each chunk with key pattern: `baseKey_chunk_X`
   - Apply the same cache tags to all parts

```typescript
// Example of storing a chunked video
const chunks = [];
const chunkSizes = [];
let currentPosition = 0;

while (currentPosition < totalSize) {
  const endPosition = Math.min(currentPosition + CHUNK_SIZE, totalSize);
  const chunkData = videoBuffer.slice(currentPosition, endPosition);
  chunks.push(chunkData);
  chunkSizes.push(chunkData.byteLength);
  currentPosition = endPosition;
}

// Create manifest
const manifest = {
  totalSize,
  chunkCount: chunks.length,
  actualChunkSizes: chunkSizes,
  standardChunkSize: CHUNK_SIZE,
  originalContentType: videoContentType
};

// Store manifest
await namespace.put(baseKey, JSON.stringify(manifest), {
  metadata: {
    isChunked: true,
    cacheTags: cacheTags
  }
});

// Store chunks
for (let i = 0; i < chunks.length; i++) {
  const chunkKey = `${baseKey}_chunk_${i}`;
  await namespace.put(chunkKey, chunks[i], {
    metadata: {
      parentKey: baseKey,
      chunkIndex: i,
      cacheTags: cacheTags
    }
  });
}
```

### Retrieval Process

1. Fetch the base key to determine if it's a regular video or a chunked manifest
2. For chunked videos:
   - Parse the manifest
   - For full videos, fetch all chunks
   - For range requests, calculate which chunks contain the requested range
   - Stream the video content to the client

```typescript
// Example of retrieving a chunked video with range support
const manifestValue = await namespace.get(baseKey, 'text');
const manifest = JSON.parse(manifestValue);

if (isRangeRequest) {
  // Calculate which chunks contain the requested range
  const { start, end } = parseRange(rangeHeader, manifest.totalSize);
  const neededChunks = calculateNeededChunks(start, end, manifest);
  
  // Create a streaming response
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  
  // Start streaming response immediately
  const response = new Response(readable, {
    status: 206,
    headers: {
      'Content-Type': manifest.originalContentType,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${manifest.totalSize}`,
      'Content-Length': (end - start + 1).toString()
    }
  });
  
  // Fetch chunks in sequence and write to stream
  streamChunksForRange(writer, namespace, baseKey, neededChunks, start, end);
  
  return response;
} else {
  // Full video request logic...
}
```

## Chunk Size Rationale

The 5MB (5,242,880 bytes) chunk size was carefully chosen for several reasons:

- **Balance**: Provides optimal balance between minimizing chunk count and staying well below KV's 25MB limit
- **Safety margin**: ~20% of KV's limit allows room for metadata overhead and future adjustments
- **Performance**: Large enough to reduce KV operation count, small enough for efficient memory usage
- **Technical efficiency**: As a power-of-2 multiple (5 * 2^20), it aligns well with memory operations
- **Scalability**: 5MB chunks support videos up to several GB in size without excessive chunk counts

## Storage Architecture

The KV Chunking system uses a two-level storage architecture:

### Base Key

- **Value**: Contains the JSON manifest data
- **Metadata**: Contains `TransformationMetadata` with `isChunked: true` flag and `cacheTags` for purging

### Chunk Keys

- **Key Pattern**: `originalKey_chunk_X` (where X is the chunk index)
- **Value**: Contains the actual binary video chunk data
- **Metadata**: Contains chunk metadata (parent key, index) and the same `cacheTags` as the parent

This architecture ensures:
- Consistent cache invalidation
- Clear relationship between chunks and parent video
- Efficient lookup and retrieval

## Range Request Support

The KV Chunking system includes advanced range request support:

1. **Precise Chunk Selection**:
   - Only chunks containing the requested byte range are fetched
   - Avoids unnecessary data transfer for seeking operations

2. **Optimized Range Slicing**:
   - For ranges spanning multiple chunks, only the necessary portions are used
   - Minimizes memory usage and improves performance

3. **Streaming Architecture**:
   - Uses `TransformStream` for efficient streaming
   - Begins sending data immediately while fetching remaining chunks

```typescript
// Example: Handling a range request spanning multiple chunks
function streamChunksForRange(writer, namespace, baseKey, neededChunks, start, end) {
  let processedBytes = 0;
  let videoPosition = 0;
  
  // Process each needed chunk
  for (const chunk of neededChunks) {
    // Fetch the chunk
    const chunkKey = `${baseKey}_chunk_${chunk.index}`;
    const chunkData = await namespace.get(chunkKey, 'arrayBuffer');
    
    // Calculate slice within this chunk
    const sliceStart = chunk.index === 0 ? start : 0;
    const sliceEnd = Math.min(chunk.size, end - videoPosition + 1);
    
    // Write the slice to the stream
    await writer.write(new Uint8Array(chunkData.slice(sliceStart, sliceEnd)));
    
    videoPosition += chunk.size;
    processedBytes += (sliceEnd - sliceStart);
    
    // Check if we've fulfilled the range request
    if (processedBytes >= (end - start + 1)) {
      break;
    }
  }
  
  // Close the stream
  await writer.close();
}
```

## Error Resilience

The KV Chunking implementation includes several error resilience features:

### 1. Stream State Management

- Tracks stream state with flags (`isStreamClosed`, `isStreamAborted`)
- Prevents writing to closed or aborted streams
- Avoids errors when client disconnects mid-stream

### 2. Timeout Handling

- Implements a 10-second timeout for chunk fetches
- Prevents hanging on problematic chunks
- Continues streaming when possible despite partial failures

### 3. Graceful Degradation

- Handles missing chunks after streaming has started
- Logs detailed error information
- Attempts to provide as much content as possible

```typescript
// Example: Error handling during streaming
try {
  const chunkData = await Promise.race([
    namespace.get(chunkKey, 'arrayBuffer'),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Chunk fetch timeout')), 10000)
    )
  ]);
  
  await writer.write(new Uint8Array(chunkData));
} catch (error) {
  logError('Error fetching chunk', { chunkKey, error });
  
  // Try to continue if possible
  if (!isStreamClosed && !isStreamAborted) {
    try {
      // Write an empty buffer to maintain position
      await writer.write(new Uint8Array(chunk.size));
    } catch (streamError) {
      // Client likely disconnected, abort
      isStreamAborted = true;
    }
  }
}
```

## Cache Management

The chunking system integrates with the cache management system:

### 1. Consistent Cache Tags

- Applies identical cache tags to manifest and all chunks
- Enables purging all components with a single operation
- Prevents orphaned chunks when purging videos

### 2. TTL Management

- Supports consistent TTL across all chunks
- Implements TTL refresh for frequently accessed chunks
- Maintains cache hygiene with coordinated expiration

### 3. Versioning Support

- Integrates with the cache versioning system
- Supports cache invalidation through version increments
- Prevents serving stale data after updates

## Performance Considerations

The KV Chunking implementation includes optimizations for performance:

### 1. Edge Cache Integration

- Uses edge cache for KV reads (60 minute TTL)
- Reduces KV read operations for frequently accessed videos
- Decreases latency and origin load

### 2. Pre-computed Chunk Mapping

- Pre-calculates which chunks to fetch for range requests
- Avoids unnecessary chunk lookups
- Optimizes memory usage by fetching only what's needed

### 3. Sequential Processing

- Processes chunks in order to optimize streaming start time
- Prioritizes initial chunks for faster playback start
- Provides a better user experience for video playback

### 4. Memory Management

- Uses streaming techniques to minimize memory usage
- Processes chunks individually rather than loading entire video
- Enables efficient handling of very large videos

## Testing and Verification

The KV Chunking implementation includes comprehensive testing:

### 1. Unit Tests

- Tests for small videos (single entry)
- Tests for large videos (chunked storage)
- Range request handling tests
- Data integrity verification tests

### 2. Integration Tests

- Tests with the full caching layer
- Tests with different video variants
- Error handling and fallback behavior tests

### 3. Performance Tests

- Memory usage measurements
- Streaming performance tests
- Range request optimization tests

## Configuration Options

The KV Chunking behavior can be configured:

```json
{
  "kvChunking": {
    "enabled": true,
    "sizeThreshold": 20971520,
    "chunkSize": 5242880,
    "timeoutMs": 10000,
    "maxChunks": 1000,
    "parallelFetches": 3,
    "logChunkOperations": true,
    "useEdgeCache": true,
    "edgeCacheTtl": 3600
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | true | Enable KV chunking |
| `sizeThreshold` | number | 20971520 | Size threshold for chunking (20MB) |
| `chunkSize` | number | 5242880 | Size of each chunk (5MB) |
| `timeoutMs` | number | 10000 | Timeout for chunk operations (10s) |
| `maxChunks` | number | 1000 | Maximum allowed chunks |
| `parallelFetches` | number | 3 | Maximum parallel chunk fetches |
| `logChunkOperations` | boolean | true | Log detailed chunk operations |
| `useEdgeCache` | boolean | true | Use edge cache for KV reads |
| `edgeCacheTtl` | number | 3600 | Edge cache TTL in seconds (60m) |

## Best Practices

1. **Configure Appropriate Size Threshold**:
   - Adjust the `sizeThreshold` based on your video characteristics
   - Consider lowering for videos with frequent range requests
   - Consider raising for videos rarely accessed with ranges

2. **Optimize Chunk Size for Content**:
   - The default 5MB is optimal for most use cases
   - Smaller chunks (1-2MB) may be better for videos with frequent seeking
   - Larger chunks (8-10MB) may be better for sequential streaming of large files

3. **Monitor and Adjust Cache TTLs**:
   - Longer TTLs reduce origin load
   - Consider content update frequency when setting TTLs
   - Use cache tags for effective invalidation

4. **Leverage Range Request Optimizations**:
   - Configure your video player to use optimal chunk sizes
   - Consider adding range prediction for HLS/DASH content
   - Test with different range sizes to optimize performance

5. **Implement Proper Error Handling**:
   - Handle client disconnections gracefully
   - Log chunk errors for troubleshooting
   - Configure appropriate timeouts for your network conditions