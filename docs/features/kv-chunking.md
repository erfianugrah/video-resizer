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

### Process Flow Diagrams

#### Storage Flow

```mermaid
flowchart TD
    A[Transformed Video Response] --> B{Size > 20MB?}
    B -->|No| C[Store as Single KV Entry]
    B -->|Yes| D[Initialize Chunking Process]

    D --> E[Calculate Optimal Chunk Count]
    E --> F[Split Video into 5MB Chunks]
    F --> G[Create Manifest with Metadata]

    G --> H[Store Manifest at Base Key]
    H --> I[Store Individual Chunks]

    I --> J[Apply Cache Tags to All Parts]

    C & J --> K[Return Original Response]

    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef storage fill:#E8EAF6,stroke:#3949AB,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;

    class A,K response
    class B decision
    class C,H,I,J storage
    class D,E,F,G process
```

#### Retrieval Flow

```mermaid
flowchart TD
    A[Request for Video] --> B[Generate Cache Key]
    B --> C[Fetch from KV Store]
    C --> D{Is Chunked?}

    D -->|No| E[Return Full Response]
    D -->|Yes| F[Parse Manifest]

    F --> G{Range Request?}

    G -->|No| H[Fetch All Chunks]
    G -->|Yes| I[Calculate Required Chunks]

    I --> J[Fetch Only Needed Chunks]

    H & J --> K[Stream Video to Client]
    K --> L[Return Response]

    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef fetch fill:#E8EAF6,stroke:#3949AB,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;

    class A request
    class B,F,I,K process
    class C,H,J fetch
    class D,G decision
    class E,L response
```

#### Range Request Optimization

```mermaid
flowchart TD
    A[Range Request<br>bytes=1000000-2000000] --> B[Parse Manifest]
    B --> C[Determine Chunk Size: 5MB]

    C --> D[Calculate Chunk Mapping]
    D --> E{Which Chunks Needed?}

    E --> F[Chunk 0: bytes 0-5242879]
    E --> G[Chunk 1: bytes 5242880-10485759]

    F --> H{Contains Range Start?}
    H -->|Yes| I[Fetch Chunk 0]

    G --> J{Contains Range End?}
    J -->|Yes| K[Fetch Chunk 1]

    I & K --> L[Extract Requested Range]
    L --> M[Stream to Client]

    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef chunk fill:#F3E5F5,stroke:#7B1FA2,color:#000000;
    classDef fetch fill:#E8EAF6,stroke:#3949AB,color:#000000;
    classDef stream fill:#FFEBEE,stroke:#C62828,color:#000000;

    class A request
    class B,C,D process
    class E,H,J decision
    class F,G chunk
    class I,K fetch
    class L,M stream
```

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
async function storeChunkedVideo(namespace, baseKey, videoBuffer, contentType) {
  // Prepare chunks from video buffer
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
  const totalSize = videoBuffer.byteLength;
  const chunks = [];
  const chunkSizes = [];
  let currentPosition = 0;

  // Split video into chunks
  while (currentPosition < totalSize) {
    const endPosition = Math.min(currentPosition + CHUNK_SIZE, totalSize);
    const chunkData = videoBuffer.slice(currentPosition, endPosition);
    chunks.push(chunkData);
    chunkSizes.push(chunkData.byteLength);
    currentPosition = endPosition;
  }

  // Generate consistent cache tags for all parts
  const cacheTags = generateCacheTags(baseKey);

  // Create manifest with metadata
  const manifest = {
    totalSize,
    chunkCount: chunks.length,
    actualChunkSizes: chunkSizes,
    standardChunkSize: CHUNK_SIZE,
    originalContentType: contentType
  };

  // Store manifest at base key
  await namespace.put(baseKey, JSON.stringify(manifest), {
    metadata: {
      isChunked: true,
      cacheTags,
      contentType: 'application/json',
      contentLength: JSON.stringify(manifest).length
    }
  });

  // Store chunks with related metadata
  for (let i = 0; i < chunks.length; i++) {
    const chunkKey = `${baseKey}_chunk_${i}`;
    await namespace.put(chunkKey, chunks[i], {
      metadata: {
        parentKey: baseKey,
        chunkIndex: i,
        cacheTags,
        contentLength: chunks[i].byteLength
      }
    });
  }

  return manifest;
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
async function getChunkedVideo(namespace, baseKey, request) {
  // Get manifest from base key
  const manifestValue = await namespace.get(baseKey, 'text');
  if (!manifestValue) {
    return null; // Not found
  }

  // Parse manifest
  const manifest = JSON.parse(manifestValue);
  const isRangeRequest = request?.headers?.has('Range');

  if (isRangeRequest) {
    // Handle range request
    const rangeHeader = request.headers.get('Range') || '';
    const { start, end } = parseRange(rangeHeader, manifest.totalSize);

    // Calculate which chunks contain the requested range
    const neededChunks = calculateNeededChunks(start, end, manifest);

    // Create streaming response for efficient memory usage
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Create and return the response with range headers immediately
    const response = new Response(readable, {
      status: 206,
      headers: {
        'Content-Type': manifest.originalContentType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${manifest.totalSize}`,
        'Content-Length': (end - start + 1).toString(),
        'Cache-Control': 'public, max-age=3600'
      }
    });

    // Start async chunk fetching and streaming
    // This happens in the background while response is already being sent
    streamChunksForRange(writer, namespace, baseKey, neededChunks, start, end);

    return response;
  } else {
    // Full video request - fetch all chunks
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Create full response
    const response = new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': manifest.originalContentType,
        'Content-Length': manifest.totalSize.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
      }
    });

    // Start async chunk fetching for full video
    streamFullVideo(writer, namespace, baseKey, manifest);

    return response;
  }
}

// Fetch and stream chunks for range request
async function streamChunksForRange(writer, namespace, baseKey, neededChunks, start, end) {
  try {
    let processedBytes = 0;
    let videoPosition = 0;

    // Process each needed chunk
    for (const chunk of neededChunks) {
      // Fetch the chunk
      const chunkKey = `${baseKey}_chunk_${chunk.index}`;
      const chunkData = await namespace.get(chunkKey, 'arrayBuffer');

      if (!chunkData) {
        throw new Error(`Chunk ${chunk.index} not found`);
      }

      // Calculate slice within this chunk
      const sliceStart = chunk.index === neededChunks[0].index ? start - videoPosition : 0;
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
  } catch (error) {
    console.error('Error streaming chunks:', error);
  } finally {
    await writer.close();
  }
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

### Key-Value Structure Diagram

```mermaid
classDiagram
    class BaseKey {
        key: "video:path/to/video.mp4:w=1280:h=720"
        value: JSON Manifest
        metadata: TransformationMetadata
    }

    class ChunkKey0 {
        key: "video:path/to/video.mp4:w=1280:h=720_chunk_0"
        value: Binary Chunk Data (0-5MB)
        metadata: ChunkMetadata
    }

    class ChunkKey1 {
        key: "video:path/to/video.mp4:w=1280:h=720_chunk_1"
        value: Binary Chunk Data (5-10MB)
        metadata: ChunkMetadata
    }

    class ChunkKey2 {
        key: "video:path/to/video.mp4:w=1280:h=720_chunk_2"
        value: Binary Chunk Data (10-15MB)
        metadata: ChunkMetadata
    }

    class ChunkKeyN {
        key: "video:path/to/video.mp4:w=1280:h=720_chunk_N"
        value: Binary Chunk Data
        metadata: ChunkMetadata
    }

    class TransformationMetadata {
        sourcePath: string
        width: number
        height: number
        format: string
        cacheTags: string[]
        contentType: string
        contentLength: number
        isChunked: true
    }

    class ChunkMetadata {
        parentKey: string
        chunkIndex: number
        cacheTags: string[]
    }

    class Manifest {
        totalSize: number
        chunkCount: number
        actualChunkSizes: number[]
        standardChunkSize: number
        originalContentType: string
    }

    BaseKey -- ChunkKey0 : references
    BaseKey -- ChunkKey1 : references
    BaseKey -- ChunkKey2 : references
    BaseKey -- ChunkKeyN : references
    BaseKey *-- TransformationMetadata : contains
    BaseKey *-- Manifest : contains value
    ChunkKey0 *-- ChunkMetadata : contains
    ChunkKey1 *-- ChunkMetadata : contains
    ChunkKey2 *-- ChunkMetadata : contains
    ChunkKeyN *-- ChunkMetadata : contains
```

### Manifest-Chunk Relationship

```mermaid
flowchart TD
    A[(KV Cache)]

    B[Base Key:<br>video:example.mp4:w=1280:h=720]
    C[Manifest JSON]

    D[Chunk 0 Key:<br>video:example.mp4_chunk_0]
    E[Chunk 1 Key:<br>video:example.mp4_chunk_1]
    F[Chunk 2 Key:<br>video:example.mp4_chunk_2]

    G[Video Binary<br>0-5MB]
    H[Video Binary<br>5-10MB]
    I[Video Binary<br>10-15MB]

    A --> B
    A --> D
    A --> E
    A --> F

    B --> C
    C --> |references| D
    C --> |references| E
    C --> |references| F

    D --> G
    E --> H
    F --> I

    classDef kv fill:#F3E5F5,stroke:#8E24AA,color:#000000;
    classDef key fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef manifest fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef data fill:#E8F5E9,stroke:#2E7D32,color:#000000;

    class A kv
    class B,D,E,F key
    class C manifest
    class G,H,I data
```

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

### Error Handling Flow

```mermaid
flowchart TD
    A[Start Video Streaming] --> B[Initialize Streaming State]
    B --> C[Begin Fetching Chunks]

    C --> D{Fetch Successful?}

    D -->|Yes| E[Write Chunk to Stream]
    D -->|No| F{Stream Already<br>Closed/Aborted?}

    F -->|Yes| G[Log and Exit]
    F -->|No| H{Chunk Timeout?}

    H -->|Yes| I[Log Timeout Warning]
    H -->|No| J[Log Fetch Error]

    I & J --> K{Critical Chunk?}

    K -->|Yes| L[Try Fallback Approach]
    K -->|No| M[Write Empty Buffer<br>To Maintain Position]

    L --> N{Fallback Successful?}

    N -->|Yes| O[Write Fallback Data]
    N -->|No| P[Signal Error in Headers]

    E & M & O & P --> Q[Continue to Next Chunk]
    Q --> R[Complete Stream]

    classDef start fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef error fill:#FFEBEE,stroke:#C62828,color:#000000;
    classDef success fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef recovery fill:#F3E5F5,stroke:#7B1FA2,color:#000000;

    class A,B start
    class C,E,Q,R process
    class D,F,H,K,N decision
    class G,I,J,P error
    class L,M,O recovery
```

### Parallel Fetching

```mermaid
flowchart TD
    A[Initialize Chunk Fetching] --> B[Determine Total Chunks]
    B --> C[Set Parallel Fetch Limit = 3]

    C --> D[Start First Batch<br>Chunks 0,1,2]
    D --> E{All Chunks<br>Fetched?}

    E -->|Yes| F[Complete Stream]
    E -->|No| G[Wait for Any<br>Chunk to Complete]

    G --> H{Chunk Completed?}

    H -->|Success| I[Write to Stream]
    H -->|Error| J[Handle Error]

    I & J --> K[Start Next Chunk Fetch]
    K --> E

    classDef start fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef fetch fill:#E1BEE7,stroke:#8E24AA,color:#000000;
    classDef error fill:#FFEBEE,stroke:#C62828,color:#000000;
    classDef success fill:#E8F5E9,stroke:#2E7D32,color:#000000;

    class A,B,C start
    class D,G,K fetch
    class E,H decision
    class F,I success
    class J error
```

```typescript
// Example: Resilient error handling during streaming
async function fetchChunkWithErrorHandling(namespace, chunkKey, chunkSize, writer, streamState) {
  try {
    // Fetch with timeout using Promise.race
    const chunkData = await Promise.race([
      namespace.get(chunkKey, 'arrayBuffer'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Chunk fetch timeout')), 10000)
      )
    ]);

    // Successfully fetched chunk
    if (!streamState.isStreamClosed && !streamState.isStreamAborted) {
      await writer.write(new Uint8Array(chunkData));
      return true;
    }
  } catch (error) {
    // Log the error for diagnostics
    logError('Error fetching chunk', {
      chunkKey,
      error: error.message,
      errorType: error.name,
      timeout: error.message === 'Chunk fetch timeout'
    });

    // Try to continue streaming if possible
    if (!streamState.isStreamClosed && !streamState.isStreamAborted) {
      try {
        // For non-critical chunks, write an empty buffer to maintain position
        // This allows playback to continue with some missing data
        await writer.write(new Uint8Array(chunkSize));

        // Add diagnostic headers if possible
        streamState.errorCount = (streamState.errorCount || 0) + 1;

        return false;
      } catch (streamError) {
        // Client likely disconnected, set abort flag
        streamState.isStreamAborted = true;
        logError('Stream write error', {
          reason: 'Client likely disconnected',
          error: streamError.message
        });
      }
    }
  }

  return false;
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