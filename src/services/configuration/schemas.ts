/**
 * Configuration schemas and types
 */
import { z } from 'zod';
import { VideoConfigSchema } from '../../config/VideoConfigurationManager';
import { CacheConfigSchema } from '../../config/CacheConfigurationManager';
import { LoggingConfigSchema } from '../../config/LoggingConfigurationManager';
import { DebugConfigSchema } from '../../config/DebugConfigurationManager';

// Configuration version schema
export const ConfigVersionSchema = z.object({
  version: z.string(),
  lastUpdated: z.string().datetime(),
});

// Complete worker configuration schema
export const WorkerConfigurationSchema = z.object({
  // Version info
  ...ConfigVersionSchema.shape,
  
  // Config sections
  video: VideoConfigSchema,
  cache: CacheConfigSchema,
  logging: LoggingConfigSchema,
  debug: DebugConfigSchema,
});

// Type inference for TypeScript
export type WorkerConfiguration = z.infer<typeof WorkerConfigurationSchema>;

// Environment type for configuration service
export interface ConfigEnvironment {
  VIDEO_CONFIGURATION_STORE?: KVNamespace;
  ENVIRONMENT?: string;
  CONFIG_KV_NAME?: string;
  [key: string]: any;
}