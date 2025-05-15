/**
 * Schema validation for Origin-based configuration
 * 
 * This module defines Zod schemas for validating the Origins configuration objects,
 * ensuring that they meet the required structure and type constraints.
 */

import { z } from 'zod';
import { type Origin, type Source, type Auth } from '../services/videoStorage/interfaces';

/**
 * Schema for authentication configuration
 */
export const AuthSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(['aws-s3', 'token', 'basic', 'bearer', 'query', 'header']),
  accessKeyVar: z.string().optional(),
  secretKeyVar: z.string().optional(),
  region: z.string().optional(),
  service: z.string().optional(),
  tokenVar: z.string().optional(),
  tokenHeaderName: z.string().optional(),
  headerName: z.string().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
  sessionTokenVar: z.string().optional(),
  headers: z.record(z.string()).optional(),
  params: z.record(z.string()).optional(),
  authHeader: z.string().optional(),
  authScheme: z.string().optional(),
  tokenSecret: z.string().optional()
}).strict();

/**
 * Schema for source configuration
 */
export const SourceSchema = z.object({
  type: z.enum(['r2', 'remote', 'fallback']),
  priority: z.number().int().nonnegative(),
  bucketBinding: z.string().optional(),
  url: z.string().url().optional(),
  path: z.string(),
  auth: AuthSchema.optional(),
  headers: z.record(z.string()).optional(),
  cacheControl: z.object({
    maxAge: z.number().int().nonnegative().optional(),
    staleWhileRevalidate: z.number().int().nonnegative().optional(),
    staleIfError: z.number().int().nonnegative().optional()
  }).optional(),
  resolutionPathTemplate: z.boolean().optional()
}).strict()
.refine(data => {
  // If type is r2, bucketBinding should be present
  if (data.type === 'r2' && !data.bucketBinding) {
    return false;
  }
  // If type is remote or fallback, url should be present
  if (['remote', 'fallback'].includes(data.type) && !data.url) {
    return false;
  }
  return true;
}, {
  message: "Invalid source configuration. For r2 sources, bucketBinding is required. For remote or fallback sources, url is required."
});

/**
 * Schema for TTL configuration
 */
export const TtlSchema = z.object({
  ok: z.number().int().positive(),
  redirects: z.number().int().positive(),
  clientError: z.number().int().positive(),
  serverError: z.number().int().positive()
}).strict();

/**
 * Schema for transform options
 */
export const TransformOptionsSchema = z.object({
  cacheability: z.boolean().optional(),
  videoCompression: z.string().optional(),
  quality: z.string().optional(),
  fit: z.string().optional(),
  bypassTransformation: z.boolean().optional()
}).strict();

/**
 * Schema for derivative configuration
 */
export const DerivativeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  compression: z.string().optional()
}).strict();

/**
 * Schema for responsive selection
 */
export const ResponsiveSelectionSchema = z.object({
  enabled: z.boolean(),
  defaultDerivative: z.string(),
  queryParam: z.string()
}).strict();

/**
 * Schema for multi-resolution configuration
 */
export const ResolutionSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bitrate: z.number().int().positive()
}).strict();

export const MultiResolutionSchema = z.object({
  enabled: z.boolean(),
  resolutions: z.record(ResolutionSchema),
  defaultResolution: z.string(),
  queryParam: z.string()
}).strict();

/**
 * Schema for access control
 */
export const AccessControlSchema = z.object({
  enabled: z.boolean(),
  allowedIps: z.array(z.string()).optional(),
  requireAuth: z.boolean().optional(),
  authHeader: z.string().optional(),
  authScheme: z.string().optional()
}).strict();

/**
 * Schema for content moderation
 */
export const ContentModerationSchema = z.object({
  enabled: z.boolean(),
  sensitiveContent: z.boolean(),
  ageRestriction: z.number().int().nonnegative()
}).strict();

/**
 * Schema for streaming configuration
 */
export const StreamingSchema = z.object({
  type: z.string(),
  segmentDuration: z.number().positive(),
  manifestType: z.string(),
  encryption: z.object({
    enabled: z.boolean()
  })
}).strict();

/**
 * Schema for format mapping
 */
export const FormatMappingSchema = z.object({
  contentType: z.string(),
  acceptRanges: z.boolean()
}).strict();

/**
 * Schema for origin configuration
 */
export const OriginSchema = z.object({
  name: z.string().min(1),
  matcher: z.string().min(1),
  captureGroups: z.array(z.string()).optional(),
  sources: z.array(SourceSchema).min(1),
  ttl: TtlSchema.optional(),
  useTtlByStatus: z.boolean().optional(),
  cacheability: z.boolean().optional(),
  videoCompression: z.string().optional(),
  quality: z.string().optional(),
  processPath: z.boolean().optional(),
  
  // Additional fields from comprehensive config
  transformOptions: TransformOptionsSchema.optional(),
  derivatives: z.record(DerivativeSchema).optional(),
  responsiveSelection: ResponsiveSelectionSchema.optional(),
  multiResolution: MultiResolutionSchema.optional(),
  accessControl: AccessControlSchema.optional(),
  contentModeration: ContentModerationSchema.optional(),
  cacheTags: z.array(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
  streaming: StreamingSchema.optional(),
  dimensionRatio: z.string().optional(),
  formatMapping: z.record(FormatMappingSchema).optional()
}).strict();

/**
 * Schema for a list of origins
 */
export const OriginsSchema = z.array(OriginSchema);

// Type definitions using Zod inference
export type AuthSchemaType = z.infer<typeof AuthSchema>;
export type SourceSchemaType = z.infer<typeof SourceSchema>;
export type TtlSchemaType = z.infer<typeof TtlSchema>;
export type OriginSchemaType = z.infer<typeof OriginSchema>;

/**
 * Validates an Origin object against the schema
 * @param origin - The origin object to validate
 * @returns The validated origin object (with any defaults applied)
 * @throws {ZodError} - If validation fails
 */
export function validateOrigin(origin: unknown): Origin {
  return OriginSchema.parse(origin) as Origin;
}

/**
 * Validates a Source object against the schema
 * @param source - The source object to validate
 * @returns The validated source object (with any defaults applied)
 * @throws {ZodError} - If validation fails
 */
export function validateSource(source: unknown): Source {
  return SourceSchema.parse(source) as Source;
}

/**
 * Validates an Auth object against the schema
 * @param auth - The auth object to validate
 * @returns The validated auth object (with any defaults applied)
 * @throws {ZodError} - If validation fails
 */
export function validateAuth(auth: unknown): Auth {
  return AuthSchema.parse(auth) as Auth;
}

/**
 * Safe version of validateOrigin that returns a result object
 * @param origin - The origin object to validate
 * @returns An object with success flag and either data or error
 */
export function safeValidateOrigin(origin: unknown): { 
  success: boolean; 
  data?: Origin; 
  error?: z.ZodError 
} {
  const result = OriginSchema.safeParse(origin);
  if (result.success) {
    return { success: true, data: result.data as Origin };
  } else {
    return { success: false, error: result.error };
  }
}

/**
 * Validates an array of Origin objects
 * @param origins - The array of origin objects to validate
 * @returns The validated origins array
 * @throws {ZodError} - If validation fails
 */
export function validateOrigins(origins: unknown[]): Origin[] {
  return OriginsSchema.parse(origins) as Origin[];
}

/**
 * Safe version of validateOrigins that returns a result object
 * @param origins - The array of origin objects to validate
 * @returns An object with success flag and either data or error
 */
export function safeValidateOrigins(origins: unknown[]): {
  success: boolean;
  data?: Origin[];
  error?: z.ZodError
} {
  const result = OriginsSchema.safeParse(origins);
  if (result.success) {
    return { success: true, data: result.data as Origin[] };
  } else {
    return { success: false, error: result.error };
  }
}