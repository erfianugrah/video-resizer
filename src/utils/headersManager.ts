/**
 * Headers Manager - Centralized utility for managing HTTP headers
 * 
 * Provides a consistent way to manage headers for different types of responses,
 * such as video, range requests, errors, etc.
 */
import { hasBypassHeaders, setBypassHeaders } from './bypassHeadersUtils';

export class HeadersManager {
  private headers: Headers;
  
  /**
   * Create a new HeadersManager, optionally copying headers from another source
   * 
   * @param sourceHeaders Optional source Headers to copy from
   */
  constructor(sourceHeaders?: Headers | Record<string, string>) {
    if (sourceHeaders instanceof Headers) {
      this.headers = new Headers(sourceHeaders);
    } else if (sourceHeaders) {
      this.headers = new Headers(sourceHeaders);
    } else {
      this.headers = new Headers();
    }
  }
  
  /**
   * Sets standard headers for range responses
   * 
   * @param start Start byte position
   * @param end End byte position
   * @param totalSize Total size of the resource
   * @returns this (for chaining)
   */
  setRangeHeaders(start: number, end: number, totalSize: number): HeadersManager {
    this.headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    this.headers.set('Content-Length', String(end - start + 1));
    this.headers.set('Accept-Ranges', 'bytes');
    return this;
  }
  
  /**
   * Sets all bypass headers for large videos or fallbacks
   * 
   * @param options Options for the bypass headers
   * @returns this (for chaining)
   */
  setBypassHeaders(options: {
    videoExceedsSize?: boolean;
    isFallback?: boolean;
    fileSizeError?: boolean;
  } = {}): HeadersManager {
    setBypassHeaders(this.headers, options);
    return this;
  }
  
  /**
   * Sets cache control headers
   * 
   * @param options Cache control options
   * @returns this (for chaining)
   */
  setCacheControl(options: {
    noStore?: boolean;
    maxAge?: number;
    private?: boolean;
    immutable?: boolean;
  } = {}): HeadersManager {
    let directives: string[] = [];
    
    if (options.noStore) {
      directives.push('no-store');
    }
    
    if (options.private) {
      directives.push('private');
    }
    
    if (options.maxAge !== undefined) {
      directives.push(`max-age=${options.maxAge}`);
    }
    
    if (options.immutable) {
      directives.push('immutable');
    }
    
    if (directives.length > 0) {
      this.headers.set('Cache-Control', directives.join(', '));
    }
    
    return this;
  }
  
  /**
   * Sets content type header with optional charset
   * 
   * @param contentType MIME type to set
   * @param charset Optional charset to include
   * @returns this (for chaining)
   */
  setContentType(contentType: string, charset?: string): HeadersManager {
    if (charset) {
      this.headers.set('Content-Type', `${contentType}; charset=${charset}`);
    } else {
      this.headers.set('Content-Type', contentType);
    }
    return this;
  }
  
  /**
   * Sets diagnostic headers for debugging
   * 
   * @param key The diagnostic header name (will be prefixed with X-)
   * @param value The value to set
   * @returns this (for chaining)
   */
  setDiagnosticHeader(key: string, value: string): HeadersManager {
    // Ensure key has proper format (X-Something-Descriptive)
    const formattedKey = key.startsWith('X-') ? key : `X-${key}`;
    this.headers.set(formattedKey, value);
    return this;
  }
  
  /**
   * Gets the underlying Headers object
   * 
   * @returns The Headers object
   */
  getHeaders(): Headers {
    return this.headers;
  }
  
  /**
   * Checks if this HeadersManager has bypass headers set
   * 
   * @returns True if bypass headers are set
   */
  hasBypassHeaders(): boolean {
    return hasBypassHeaders(this.headers);
  }
  
  /**
   * Sets a header value
   * 
   * @param name Header name
   * @param value Header value
   * @returns this (for chaining)
   */
  set(name: string, value: string): HeadersManager {
    this.headers.set(name, value);
    return this;
  }
  
  /**
   * Gets a header value
   * 
   * @param name Header name
   * @returns Header value or null if not set
   */
  get(name: string): string | null {
    return this.headers.get(name);
  }
  
  /**
   * Appends a value to a header
   * 
   * @param name Header name
   * @param value Value to append
   * @returns this (for chaining)
   */
  append(name: string, value: string): HeadersManager {
    this.headers.append(name, value);
    return this;
  }
  
  /**
   * Checks if a header exists
   * 
   * @param name Header name
   * @returns True if the header exists
   */
  has(name: string): boolean {
    return this.headers.has(name);
  }
  
  /**
   * Deletes a header
   * 
   * @param name Header name
   * @returns this (for chaining)
   */
  delete(name: string): HeadersManager {
    this.headers.delete(name);
    return this;
  }
}