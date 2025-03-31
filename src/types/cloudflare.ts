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