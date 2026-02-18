/**
 * Origins-related methods extracted from VideoConfigurationManager
 *
 * Provides helpers for reading, adding, and diagnosing Origin configurations.
 */
import { ConfigurationError } from '../errors';
import { safeValidateOrigin } from './originSchema';
import { convertLegacyConfigToOrigins } from './originConverters';
import { Origin, OriginsConfig, Source } from '../services/videoStorage/interfaces';
import type { VideoConfiguration } from './videoConfigSchemas';

/**
 * Get all configured origins from the config object.
 */
export function getOrigins(config: VideoConfiguration): Origin[] {
  const origins = config.origins;

  if (!origins) {
    return [];
  }

  // If origins is an array, return it
  if (Array.isArray(origins)) {
    return origins;
  }

  // If origins is an OriginsConfig object, return the items array
  const originsConfig = origins as OriginsConfig;
  if (originsConfig.items && Array.isArray(originsConfig.items)) {
    return originsConfig.items;
  }

  return [];
}

/**
 * Check if Origins are configured and should be used.
 */
export function shouldUseOrigins(config: VideoConfiguration): boolean {
  const origins = config.origins;

  if (!origins) {
    return false;
  }

  // If origins is an array, check if it has items
  if (Array.isArray(origins)) {
    return origins.length > 0;
  }

  // If origins is an OriginsConfig object, check if it has items and is enabled
  const originsConfig = origins as OriginsConfig;
  return (
    originsConfig.enabled !== false &&
    Array.isArray(originsConfig.items) &&
    originsConfig.items.length > 0
  );
}

/**
 * Auto-convert legacy configuration to Origins format.
 */
export function generateOriginsFromLegacy(config: VideoConfiguration) {
  return convertLegacyConfigToOrigins(config);
}

/**
 * Get origin by name.
 */
export function getOriginByName(config: VideoConfiguration, name: string) {
  const origins = getOrigins(config);
  return origins.find((origin) => origin.name === name) || null;
}

/**
 * Add a new origin to the configuration.
 * Mutates the config.origins in place (same semantics as the original method).
 *
 * @returns The validated origin that was added
 * @throws ConfigurationError if the origin is invalid
 */
export function addOrigin(config: VideoConfiguration, origin: unknown) {
  try {
    // Use the safe validation function
    const result = safeValidateOrigin(origin);

    if (!result.success) {
      // Format validation errors
      const issues = result.error?.errors
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');

      // Type check for error reporting
      const originName =
        typeof origin === 'object' && origin !== null && 'name' in origin
          ? String(origin.name)
          : 'unknown';

      throw ConfigurationError.patternError(`Invalid origin: ${issues}`, originName, {
        parameters: { origin },
      });
    }

    // Validation successful, get the validated origin
    const validatedOrigin = result.data;

    // Initialize origins array if not exists
    if (!config.origins) {
      config.origins = [];
    } else if (!Array.isArray(config.origins)) {
      // If origins is an object, convert to array or initialize items array
      if (!config.origins.items) {
        config.origins.items = [];
      }
    }

    // Add the new origin (ensures validatedOrigin is not undefined)
    if (validatedOrigin) {
      if (Array.isArray(config.origins)) {
        config.origins.push(validatedOrigin);
      } else if (config.origins.items) {
        config.origins.items.push(validatedOrigin);
      }
    }

    return validatedOrigin;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }

    // Type check for error reporting
    const originName =
      typeof origin === 'object' && origin !== null && 'name' in origin
        ? String(origin.name)
        : 'unknown';

    // Handle unexpected errors
    throw ConfigurationError.patternError('Invalid origin', originName, {
      parameters: { origin },
    });
  }
}

/**
 * Get diagnostics for Origins configuration.
 */
export function getOriginsDiagnostics(config: VideoConfiguration, pathPatternsCount: number) {
  const origins = getOrigins(config);
  const usingOrigins = shouldUseOrigins(config);

  // Count source types
  const sourceCounts = {
    r2: 0,
    remote: 0,
    fallback: 0,
    total: 0,
  };

  // Count origins with various configurations
  let originsWithTtl = 0;
  let originsWithCacheability = 0;

  origins.forEach((origin) => {
    origin.sources.forEach((source: Source) => {
      sourceCounts[source.type as keyof typeof sourceCounts]++;
      sourceCounts.total++;
    });

    if (origin.ttl) originsWithTtl++;
    if (origin.cacheability !== undefined) originsWithCacheability++;
  });

  return {
    origins: {
      count: origins.length,
      enabled: usingOrigins,
      status: usingOrigins ? 'active' : 'inactive',
      sourceCounts,
      originsWithTtl,
      originsWithCacheability,
      pathPatternsCount,
    },
  };
}
