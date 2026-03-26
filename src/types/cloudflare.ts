/**
 * Cloudflare Worker specific types
 */

/**
 * Extended ExecutionContext with waitUntil method
 */
export interface ExecutionContextExt extends ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Extended environment variables with execution context
 */
export interface EnvWithExecutionContext {
  executionCtx?: ExecutionContextExt;
}

/**
 * Extended environment variables with VIDEO_CONFIGURATION_STORE KV binding
 */
export interface EnvWithConfigStore {
  VIDEO_CONFIGURATION_STORE?: KVNamespace;
}

/**
 * Durable Object namespace stub for Container bindings.
 * Containers are backed by Durable Objects — the Worker accesses them
 * via a DurableObjectNamespace binding configured in wrangler.jsonc.
 */
export interface ContainerNamespace {
  getByName(name: string): ContainerStub;
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): ContainerStub;
}

/**
 * Stub for a single Container / Durable Object instance.
 */
export interface ContainerStub {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

/**
 * Extended environment variables with FFmpeg Container binding
 */
export interface EnvWithContainer {
  FFMPEG_CONTAINER?: ContainerNamespace;
}
