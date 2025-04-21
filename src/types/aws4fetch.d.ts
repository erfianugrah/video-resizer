/**
 * Type definitions for aws4fetch library
 */

declare module 'aws4fetch' {
  export interface AwsClientOptions {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    service?: string;
    region?: string;
    cache?: Map<string, ArrayBuffer>;
    retries?: number;
    initRetryMs?: number;
  }

  export interface SignOptions {
    method?: string;
    headers?: Headers | Record<string, string>;
    body?: BodyInit;
    aws?: {
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
      service?: string;
      region?: string;
      cache?: Map<string, ArrayBuffer>;
      datetime?: string;
      signQuery?: boolean;
      appendSessionToken?: boolean;
      allHeaders?: boolean;
      singleEncode?: boolean;
    };
    signQuery?: boolean;
    expiresIn?: number;
  }

  export class AwsClient {
    constructor(options: AwsClientOptions);
    sign(input: RequestInfo, options?: SignOptions): Promise<Request>;
    fetch(input: RequestInfo, options?: SignOptions): Promise<Response>;
  }
}