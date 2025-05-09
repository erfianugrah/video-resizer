# KV Chunking Implementation

This document outlines the implementation of a custom KV chunking approach for handling large video files in Cloudflare KV storage.

## Overview

Cloudflare's KV storage has a 25MB value size limit, which can be too restrictive for storing large video files. Our chunking implementation addresses this by splitting large videos into manageable chunks, storing them with precise metadata, and efficiently retrieving them with robust support for range requests.

## Implementation Details

### Key Components

1. **Size-Based Chunking Decision**
   - Videos under 20MB are stored as single KV entries
   - Larger videos are automatically split into 5MB chunks with a manifest

2. **Chunk Size Rationale (5MB)**
   - **Balance**: 5MB (5,242,880 bytes) provides an optimal balance between minimizing chunk count and staying well below KV's 25MB limit
   - **Safety margin**: ~20% of KV's limit allows room for metadata overhead and future adjustments
   - **Performance**: Large enough to reduce KV operation count, small enough for efficient memory usage during streaming
   - **Technical efficiency**: As a power-of-2 multiple (5 * 2^20), it aligns well with memory operations
   - **Scalability**: 5MB chunks support videos up to several GB in size without excessive chunk counts

3. **Manifest Storage Approach**
   - The manifest is stored in the **value** of the base key (not in the metadata)
   - For a 50MB video (10 chunks), the manifest is ~200-250 bytes in JSON format
   - While small manifests could fit in metadata (1024 byte limit), storing in the value provides:
     - Scalability for very large videos (no size restrictions)
     - Consistency in access patterns
     - Future-proofing for additional metadata fields
   - Manifest JSON example:
     ```json
     {
       "totalSize": 52428800,
       "chunkCount": 10,
       "actualChunkSizes": [5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880, 5242880],
       "standardChunkSize": 5242880,
       "originalContentType": "video/mp4"
     }
     ```

4. **Storage Architecture**
   - **Base key** (e.g., `video:path/to/video.mp4:w=640:h=480`):
     - **Value**: Contains the JSON manifest data
     - **Metadata**: Contains `TransformationMetadata` with `isChunked: true` flag and `cacheTags` for purging
   - **Chunk keys** (e.g., `video:path/to/video.mp4:w=640:h=480_chunk_0`):
     - **Value**: Contains the actual binary video chunk data
     - **Metadata**: Contains chunk metadata (parent key, index, etc.) and the same `cacheTags` as the parent entry for consistent purging

5. **Byte-Perfect Data Integrity**
   - Stores exact byte lengths for precise verification
   - Verifies chunk sizes on retrieval to ensure data integrity
   - Validates the sum of chunk sizes against the original video size

6. **Range Request Support**
   - Efficiently retrieves only the chunks needed for a specific byte range
   - Calculates precise offsets within chunks
   - Streams the exact requested bytes to the client
   - Supports partial content responses (HTTP 206)

7. **Streaming Improvements**
   - Precomputes needed chunks for range requests to avoid unnecessary fetches
   - Uses timeout handling to prevent hanging on problematic chunks (10s timeout)
   - Implements robust error handling for stream writing
   - Provides graceful degradation for mid-stream errors
   - Properly handles client disconnections

### Storage Process

1. The system determines whether to use single-entry or chunked storage based on video size
2. For chunked storage:
   - Generate cache tags for the video based on its characteristics (path, dimensions, format, etc.)
   - Split the video into chunks of standard size (5MB)
   - Store each chunk with a unique key based on the base key and index
   - Apply the same cache tags to each chunk for consistent purging capability
   - Create and store a manifest with chunk metadata
   - Verify total size integrity

### Retrieval Process

1. Fetch the base key to determine if it's a manifest (chunked) or direct video (single entry)
2. For chunked videos:
   - Parse the manifest to get chunk information
   - For range requests, determine which chunks contain the requested range
   - Fetch only the required chunks
   - Verify each chunk's integrity
   - Stream the chunks (or chunk slices for ranges) to the client
   - Continue despite non-critical mid-stream errors
   - Apply appropriate timeout handling

## Robustness Features

1. **Error Resilience**
   - Gracefully handles missing chunks after streaming has started
   - Properly manages stream states with flags (`isStreamClosed`, `isStreamAborted`)
   - Times out problematic chunk fetches after 10 seconds
   - Avoids stream errors from double-closing or writing to aborted streams

2. **Cache Management & Purging**
   - Applies the same cache tags to all chunks and the manifest
   - Enables purging of both the manifest and all chunks with a single tag-based operation
   - Prevents orphaned chunks when purging videos from cache
   - Ensures cache consistency across all components of chunked videos

3. **Client Disconnection Handling**
   - Detects client disconnections through stream write failures
   - Properly aborts and cleans up resources
   - Prevents unnecessary chunk fetches after client disconnects

4. **Detailed Logging**
   - Logs the progress of chunk processing for debugging
   - Records timing information for performance analysis
   - Provides verbose error logging with context
   - Tracks critical data integrity issues

5. **Retry Logic**
   - Implements exponential backoff for KV operations
   - Handles rate limiting gracefully

## Testing

The implementation includes comprehensive testing:

1. **Unit Tests**
   - Tests for storing small videos as single entries
   - Tests for storing large videos as multiple chunks
   - Tests for retrieving single entry videos
   - Tests for retrieving chunked videos
   - Tests for handling range requests for both storage types
   - Tests for detecting and handling data integrity issues
   - Tests for handling missing video data

2. **Integration Tests**
   - Tests for real-world scenarios involving the full caching layer
   - Tests for different video variants cached separately
   - Tests for error handling and fallback behavior

## Performance Considerations

- Uses edge cache for KV reads (60 minute TTL)
- Precomputes required chunks for range requests
- Processes chunks in order to optimize streaming start time
- Implements timeout handling to prevent hanging on slow operations
- Uses streaming techniques to minimize memory usage