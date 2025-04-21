/**
 * Storage configuration for video resizer
 * 
 * This module defines the schema and default values for storage configuration
 * including different storage backends (R2, remote URLs, fallback URLs)
 */
import { z } from 'zod';

// Auth configuration schema
export const AuthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(['aws-s3', 'aws-s3-presigned-url', 'bearer', 'header', 'query']).default('header'),
  accessKeyVar: z.string().optional(),
  secretKeyVar: z.string().optional(),
  region: z.string().optional(),
  service: z.string().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
  sessionTokenVar: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

// Storage configuration schema
export const StorageConfigSchema = z.object({
  // Storage priority determines the order in which storage options are tried
  priority: z.array(z.enum(['r2', 'remote', 'fallback'])).default(['r2', 'remote', 'fallback']),
  
  // R2 storage configuration
  r2: z.object({
    enabled: z.boolean().default(false),
    bucketBinding: z.string().default('VIDEOS_BUCKET'),
  }).default({
    enabled: false,
    bucketBinding: 'VIDEOS_BUCKET',
  }),
  
  // Remote storage configuration
  remoteUrl: z.string().optional(),
  remoteAuth: AuthConfigSchema.optional(),
  
  // Fallback storage configuration
  fallbackUrl: z.string().optional(),
  fallbackAuth: AuthConfigSchema.optional(),
  
  // General storage auth configuration
  auth: z.object({
    useOriginAuth: z.boolean().default(false),
    securityLevel: z.enum(['strict', 'permissive']).default('strict'),
    cacheTtl: z.number().optional(),
  }).optional(),
  
  // Fetch options for remote and fallback URLs
  fetchOptions: z.object({
    userAgent: z.string().default('Cloudflare-Video-Resizer/1.0'),
    headers: z.record(z.string()).optional(),
  }).default({
    userAgent: 'Cloudflare-Video-Resizer/1.0',
  }),
  
  // Path transformations for different storage types
  pathTransforms: z.record(z.any()).optional(),
});

// Default storage configuration
export const defaultStorageConfig = {
  priority: ['r2', 'remote', 'fallback'],
  r2: {
    enabled: false,
    bucketBinding: 'VIDEOS_BUCKET',
  },
  fetchOptions: {
    userAgent: 'Cloudflare-Video-Resizer/1.0',
  },
};

export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;