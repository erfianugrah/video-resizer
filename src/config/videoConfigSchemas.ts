/**
 * Zod schemas for video configuration validation
 *
 * Extracted from VideoConfigurationManager to reduce file size.
 * These schemas define the shape and validation rules for all
 * video transformation configuration.
 */
import { z } from 'zod';
import { AuthConfigSchema, StorageConfigSchema } from './storageConfig';
import { OriginSchema } from './originSchema';

// TTL Configuration Schema
export const TtlSchema = z.object({
  ok: z.number().positive(),
  redirects: z.number().positive(),
  clientError: z.number().nonnegative(),
  serverError: z.number().nonnegative(),
});

// Cache Configuration Schema
const CacheConfigSchema = z.object({
  regex: z.string(),
  cacheability: z.boolean(),
  videoCompression: z.string(),
  ttl: TtlSchema,
});

// Network Quality Configuration Schema
const NetworkQualityConfigSchema = z.object({
  maxWidth: z.number().positive(),
  maxHeight: z.number().positive(),
  maxBitrate: z.number().positive(),
});

// Browser Capabilities Schema
const BrowserCapabilitySchema = z.object({
  patterns: z.array(z.string()),
  exclusions: z.array(z.string()).optional(),
});

// Path Pattern Schema
export const PathPatternSchema = z.object({
  name: z.string(),
  matcher: z.string(),
  processPath: z.boolean(),
  baseUrl: z.string().nullable(),
  originUrl: z.string().nullable(),
  quality: z.string().optional(),
  // For backward compatibility, still support cacheTtl but mark as deprecated
  cacheTtl: z.number().positive().optional(),
  // New ttl structure and useTtlByStatus flag
  ttl: TtlSchema.optional(),
  useTtlByStatus: z.boolean().optional().default(true),
  priority: z.number().optional(),
  transformationOverrides: z.record(z.unknown()).optional(),
  captureGroups: z.array(z.string()).optional(),
  // Add auth configuration to path patterns
  auth: AuthConfigSchema.optional(),
});

// Video Derivatives Schema
const DerivativeSchema = z.record(
  z.object({
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    mode: z.enum(['video', 'frame', 'spritesheet', 'audio']).optional(),
    fit: z.enum(['contain', 'scale-down', 'cover']).optional(),
    audio: z.boolean().optional(),
    format: z.string().nullable().optional(),
    time: z.string().nullable().optional(),
    duration: z.string().nullable().optional(),
    quality: z.enum(['low', 'medium', 'high', 'auto']).nullable().optional(),
    compression: z.enum(['low', 'medium', 'high', 'auto']).nullable().optional(),
    loop: z.boolean().nullable().optional(),
    preload: z.enum(['none', 'metadata', 'auto']).nullable().optional(),
    autoplay: z.boolean().nullable().optional(),
    muted: z.boolean().nullable().optional(),
  })
);

// Define ResponsiveBreakpoint Schema
const ResponsiveBreakpointSchema = z.object({
  min: z.number().positive().optional(),
  max: z.number().positive().optional(),
  derivative: z.string(),
});

// Complete Video Configuration Schema
export const VideoConfigSchema = z
  .object({
    // Schema version
    version: z.string().optional(),

    // New Origins-based configuration - can be array or config object
    origins: z
      .union([
        z.array(OriginSchema),
        z.object({
          enabled: z.boolean().optional(),
          useLegacyPathPatterns: z.boolean().optional(),
          items: z.array(OriginSchema).optional(),
        }),
      ])
      .optional(),

    derivatives: DerivativeSchema,
    defaults: z.object({
      width: z.number().nullable(),
      height: z.number().nullable(),
      mode: z.enum(['video', 'frame', 'spritesheet', 'audio']),
      fit: z.enum(['contain', 'scale-down', 'cover']).nullable(),
      audio: z.boolean(),
      format: z.string().nullable(),
      time: z.string().nullable(),
      duration: z.string().nullable(),
      quality: z.enum(['low', 'medium', 'high', 'auto']).nullable(),
      compression: z.enum(['low', 'medium', 'high', 'auto']).nullable(),
      loop: z.boolean().nullable(),
      preload: z.enum(['none', 'metadata', 'auto']).nullable(),
      autoplay: z.boolean().nullable(),
      muted: z.boolean().nullable(),
      filename: z.string().nullable().optional(),
    }),
    validOptions: z.object({
      mode: z.array(z.string()),
      fit: z.array(z.string()),
      format: z.array(z.string()),
      audio: z.array(z.boolean()),
      quality: z.array(z.string()),
      compression: z.array(z.string()),
      preload: z.array(z.string()),
      loop: z.array(z.boolean()),
      autoplay: z.array(z.boolean()),
      muted: z.array(z.boolean()),
    }),
    responsive: z.object({
      breakpoints: z.record(z.number().positive()),
      availableQualities: z.array(z.number().positive()),
      deviceWidths: z.record(z.number().positive()),
      networkQuality: z.record(NetworkQualityConfigSchema),
      browserCapabilities: z.record(BrowserCapabilitySchema).optional(),
    }),
    // New field for responsive breakpoint mapping to derivatives
    responsiveBreakpoints: z.record(ResponsiveBreakpointSchema).optional(),
    paramMapping: z.record(z.string()),
    cdnCgi: z.object({
      basePath: z.string(),
    }),
    passthrough: z
      .object({
        enabled: z.boolean(),
        whitelistedFormats: z.array(z.string()),
      })
      .optional(),
    // Make pathPatterns optional when origins is present
    pathPatterns: z.array(PathPatternSchema).optional(),
    caching: z
      .object({
        method: z.enum(['kv']),
        debug: z.boolean(),
        fallback: z.object({
          enabled: z.boolean(),
          badRequestOnly: z.boolean(),
          preserveHeaders: z.array(z.string()).optional(),
          fileSizeErrorHandling: z.boolean().optional(),
          maxRetries: z.number().optional(),
        }),
      })
      .optional(), // Make caching optional
    cache: z.record(CacheConfigSchema).optional(), // Make cache optional
    // Include storage configuration
    storage: StorageConfigSchema.optional(),
  })
  // Add refinement to require either pathPatterns or origins
  .refine(
    (data) => {
      return !!data.pathPatterns || !!data.origins;
    },
    {
      message: 'Either pathPatterns or origins must be provided',
      path: ['configuration'],
    }
  );

// Type exported from the schema
export type VideoConfiguration = z.infer<typeof VideoConfigSchema>;
