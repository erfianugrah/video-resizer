/**
 * Streaming chunk processor that avoids memory accumulation
 * Processes chunks on-the-fly without buffering entire chunks in memory
 */

import { logDebug } from './logging';

export interface ChunkProcessorOptions {
  targetChunkSize: number;
  onChunkReady: (chunk: Uint8Array, index: number) => Promise<void>;
  onComplete?: () => Promise<void>;
}

/**
 * Creates a TransformStream that processes incoming data into fixed-size chunks
 * without accumulating all data in memory
 */
export class StreamingChunkProcessor {
  private currentBuffer: Uint8Array;
  private bufferOffset = 0;
  private chunkIndex = 0;
  private totalBytesProcessed = 0;
  private readonly targetChunkSize: number;
  private readonly onChunkReady: (chunk: Uint8Array, index: number) => Promise<void>;
  private readonly onComplete?: () => Promise<void>;

  constructor(options: ChunkProcessorOptions) {
    this.targetChunkSize = options.targetChunkSize;
    this.onChunkReady = options.onChunkReady;
    this.onComplete = options.onComplete;
    this.currentBuffer = new Uint8Array(this.targetChunkSize);
  }

  createTransformStream(): TransformStream<Uint8Array, Uint8Array> {
    return new TransformStream<Uint8Array, Uint8Array>({
      transform: async (
        chunk: Uint8Array,
        controller: TransformStreamDefaultController<Uint8Array>
      ) => {
        await this.processChunk(chunk, controller);
      },
      flush: async (controller: TransformStreamDefaultController<Uint8Array>) => {
        await this.flush(controller);
      },
    });
  }

  async processChunk(
    incoming: Uint8Array,
    controller?: TransformStreamDefaultController<Uint8Array>
  ): Promise<void> {
    let incomingOffset = 0;

    while (incomingOffset < incoming.length) {
      // Calculate how much we can copy to fill the current buffer
      const remainingBufferSpace = this.targetChunkSize - this.bufferOffset;
      const remainingIncoming = incoming.length - incomingOffset;
      const bytesToCopy = Math.min(remainingBufferSpace, remainingIncoming);

      // Copy data to current buffer
      this.currentBuffer.set(
        incoming.subarray(incomingOffset, incomingOffset + bytesToCopy),
        this.bufferOffset
      );

      this.bufferOffset += bytesToCopy;
      incomingOffset += bytesToCopy;
      this.totalBytesProcessed += bytesToCopy;

      // If buffer is full, emit it
      if (this.bufferOffset === this.targetChunkSize) {
        await this.emitCurrentBuffer(controller);
      }
    }
  }

  private async emitCurrentBuffer(
    controller?: TransformStreamDefaultController<Uint8Array>
  ): Promise<void> {
    if (this.bufferOffset === 0) return;

    // CRITICAL: Always .slice() to create an independent copy.
    // The currentBuffer is reused across chunks. If we pass the reference
    // directly, the async upload in the concurrency queue will read stale
    // data because the buffer gets overwritten by the next chunk before
    // the upload completes.
    const chunk = this.currentBuffer.slice(0, this.bufferOffset);

    logDebug('[STREAM_CHUNK_PROCESSOR] Emitting chunk', {
      chunkIndex: this.chunkIndex,
      chunkSize: chunk.length,
      totalProcessed: this.totalBytesProcessed,
    });

    // Pass the chunk to the handler
    await this.onChunkReady(chunk, this.chunkIndex);

    // Reset for next chunk
    this.chunkIndex++;
    this.bufferOffset = 0;
  }

  async flush(controller?: TransformStreamDefaultController<Uint8Array>): Promise<void> {
    // Emit any remaining data in buffer
    if (this.bufferOffset > 0) {
      await this.emitCurrentBuffer(controller);
    }

    logDebug('[STREAM_CHUNK_PROCESSOR] Stream processing complete', {
      totalChunks: this.chunkIndex,
      totalBytes: this.totalBytesProcessed,
    });

    // Call completion handler if provided
    if (this.onComplete) {
      await this.onComplete();
    }
  }

  getTotalBytesProcessed(): number {
    return this.totalBytesProcessed;
  }

  getChunkCount(): number {
    return this.chunkIndex;
  }
}

/**
 * Helper function to create a streaming chunk processor
 */
export function createStreamingChunkProcessor(
  targetChunkSize: number,
  onChunkReady: (chunk: Uint8Array, index: number) => Promise<void>,
  onComplete?: () => Promise<void>
): TransformStream<Uint8Array, Uint8Array> {
  const processor = new StreamingChunkProcessor({
    targetChunkSize,
    onChunkReady,
    onComplete,
  });

  return processor.createTransformStream();
}
