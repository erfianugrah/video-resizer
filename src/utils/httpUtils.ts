/**
 * HTTP utilities for video-resizer
 * 
 * Provides helper functions for handling HTTP operations like range requests
 */

/**
 * Parses the HTTP Range header.
 * Spec: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Range
 *
 * @param rangeHeader The value of the Range header (e.g., "bytes=0-1023").
 * @param totalSize The total size of the resource.
 * @returns An object with start, end, and total size, or null if the header is invalid/absent or unsatisfiable.
 */
export function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number,
): { start: number; end: number; total: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=') || totalSize <= 0) {
    return null;
  }

  const range = rangeHeader.substring(6); // Remove "bytes="
  const parts = range.split('-');
  if (parts.length !== 2) {
    return null; // Invalid format
  }

  const startStr = parts[0].trim();
  const endStr = parts[1].trim();

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix range: bytes=-N (last N bytes)
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else if (startStr !== '' && endStr === '') {
    // Open range: bytes=N- (from N to end)
    start = parseInt(startStr, 10);
    if (isNaN(start) || start >= totalSize) {
      return null; // Start is out of bounds
    }
    end = totalSize - 1;
  } else if (startStr !== '' && endStr !== '') {
    // Closed range: bytes=N-M
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
      // Invalid numbers, start > end, or start is out of bounds
      return null;
    }
    // Clamp end to the actual size
    end = Math.min(end, totalSize - 1);
  } else {
    // Invalid format (e.g., "bytes=-")
    return null;
  }

  // Final check: Ensure the range is valid after calculations
  if (start > end || start < 0 || end < 0 || start >= totalSize) {
    return null; // Unsatisfiable range
  }

  return { start, end, total: totalSize };
}

/**
 * Creates a Response for an unsatisfiable range request.
 * @param totalSize The total size of the resource.
 * @returns A Response object with status 416.
 */
export function createUnsatisfiableRangeResponse(totalSize: number): Response {
  const headers = new Headers({
    'Content-Range': `bytes */${totalSize}`,
    'Accept-Ranges': 'bytes', // Good practice to include even on error
  });
  return new Response('Range Not Satisfiable', { status: 416, headers });
}