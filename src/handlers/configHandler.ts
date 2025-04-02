/**
 * Configuration Upload Handler
 * 
 * Handles requests to upload and manage dynamic configuration
 */

import { ConfigurationService, WorkerConfiguration } from '../services/configurationService';
import { ConfigurationError } from '../errors';
import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createRequestContext } from '../utils/requestContext';
import { logErrorWithContext, withErrorHandling } from '../utils/errorHandlingUtils';
import { z } from 'zod';

// Environment interface with KV binding and secret
interface Env {
  VIDEO_CONFIGURATION_STORE?: KVNamespace;
  CONFIG_API_TOKEN?: string;
  ENVIRONMENT?: string;
}

/**
 * Helper for logging debug messages
 */
function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'ConfigHandler', message, data);
  } else {
    console.debug(`ConfigHandler: ${message}`, data || {});
  }
}

// logError function has been replaced with direct use of logErrorWithContext

/**
 * Authentication schema for config upload requests
 */
const AuthHeaderSchema = z.string().refine(
  (val) => val.startsWith('Bearer '),
  { message: 'Authorization header must use Bearer scheme' }
);

/**
 * Handle configuration upload request
 * 
 * @param request The incoming request
 * @param env Environment with KV bindings
 * @returns Response
 */
export const handleConfigUpload = withErrorHandling<[Request, Env], Response>(
  async function handleConfigUploadImpl(request: Request, env: Env): Promise<Response> {
  try {
    // Initialize request context
    const context = createRequestContext(request);
    
    // Add breadcrumb for request processing start
    const { addBreadcrumb } = await import('../utils/requestContext');
    addBreadcrumb(context, 'ConfigHandler', 'Processing configuration upload request', {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries([...request.headers].map(([k, v]) => 
        [k, k.toLowerCase() === 'authorization' ? '***' : v]
      ))
    });

    logDebug('Processing configuration upload request', {
      method: request.method,
      url: request.url,
      hasAuthHeader: !!request.headers.get('Authorization')
    });

    // Check if KV namespace exists
    if (!env.VIDEO_CONFIGURATION_STORE) {
      logErrorWithContext('No VIDEO_CONFIGURATION_STORE KV namespace binding found', new Error('KV namespace not found'), {}, 'ConfigHandler');
      addBreadcrumb(context, 'ConfigHandler', 'KV namespace missing', {
        error: 'VIDEO_CONFIGURATION_STORE binding not found'
      });
      return new Response('KV namespace not configured', { status: 500 });
    }

    // Validate request method
    if (request.method !== 'POST') {
      logDebug('Invalid method for config upload', { 
        method: request.method, 
        expected: 'POST' 
      });
      addBreadcrumb(context, 'ConfigHandler', 'Method not allowed', {
        method: request.method,
        expected: 'POST'
      });
      return new Response('Method not allowed', { status: 405 });
    }

    // Authorize request using Wrangler secret
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      logDebug('Missing authorization header');
      addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
        reason: 'Missing authorization header'
      });
      return new Response('Unauthorized - Missing authorization header', { status: 401 });
    }

    try {
      // Validate header format
      addBreadcrumb(context, 'ConfigHandler', 'Validating authorization header format');
      AuthHeaderSchema.parse(authHeader);
      
      // Extract token from header
      const token = authHeader.split(' ')[1];
      
      // Check if environment token is configured
      if (!env.CONFIG_API_TOKEN) {
        logErrorWithContext('CONFIG_API_TOKEN not set in environment', new Error('API token not configured'), {
          environment: env.ENVIRONMENT || 'unknown'
        }, 'ConfigHandler');
        addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
          reason: 'CONFIG_API_TOKEN not set in environment',
          environment: env.ENVIRONMENT || 'unknown'
        });
        return new Response('Unauthorized - Configuration error', { status: 500 });
      }
      
      // Validate against the secure token from environment
      if (token !== env.CONFIG_API_TOKEN) {
        logErrorWithContext('Invalid API token provided', new Error('Invalid API token'), { 
          tokenProvided: !!token,
          tokenLength: token?.length || 0,
          expectedLength: env.CONFIG_API_TOKEN?.length || 0
        }, 'ConfigHandler');
        addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
          reason: 'Invalid token',
          tokenProvided: !!token
        });
        return new Response('Unauthorized - Invalid token', { status: 401 });
      }
      
      // Log successful authentication
      logDebug('Authentication successful');
      addBreadcrumb(context, 'ConfigHandler', 'Authentication successful');
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      logErrorWithContext('Authorization header validation failed', error, {
        error: errMessage
      }, 'ConfigHandler');
      addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
        reason: 'Invalid header format',
        error: errMessage
      });
      return new Response('Unauthorized - Invalid authorization header', { status: 401 });
    }

    // Get configuration from request body
    let configData: unknown;
    try {
      addBreadcrumb(context, 'ConfigHandler', 'Parsing request JSON body');
      logDebug('Parsing request JSON body');
      configData = await request.json();
      
      // Log config data size for troubleshooting
      const configSize = JSON.stringify(configData).length;
      logDebug('Parsed configuration data', {
        configSize,
        hasVersion: !!(configData as any)?.version,
        timestamp: new Date().toISOString()
      });
      addBreadcrumb(context, 'ConfigHandler', 'JSON body parsed successfully', {
        configSize,
        hasVersion: !!(configData as any)?.version
      });
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      logErrorWithContext('Failed to parse request JSON', error, {
        error: errMessage,
        contentType: request.headers.get('Content-Type') || 'unknown'
      }, 'ConfigHandler');
      addBreadcrumb(context, 'ConfigHandler', 'JSON parsing failed', {
        error: errMessage,
        contentType: request.headers.get('Content-Type') || 'unknown'
      });
      return new Response('Bad request - Invalid JSON', { status: 400 });
    }

    // Store in KV
    try {
      addBreadcrumb(context, 'ConfigHandler', 'Storing configuration in KV');
      logDebug('Storing configuration in KV', {
        hasVideoConfig: !!(configData as any)?.video,
        hasCacheConfig: !!(configData as any)?.cache,
        environment: env.ENVIRONMENT || 'unknown'
      });
      
      const configService = ConfigurationService.getInstance();
      const startTime = Date.now();
      const success = await configService.storeConfiguration(
        env,
        configData as WorkerConfiguration
      );
      const duration = Date.now() - startTime;
      
      // Log the storage result
      if (success) {
        logDebug('Configuration successfully stored in KV', {
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        });
        addBreadcrumb(context, 'ConfigHandler', 'Configuration stored successfully', {
          duration,
          timestamp: new Date().toISOString()
        });
        
        return new Response(JSON.stringify({
          success: true,
          message: 'Configuration updated successfully',
          timestamp: new Date().toISOString()
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      } else {
        logErrorWithContext('Failed to store configuration in KV', new Error('KV storage operation failed'), {
          duration: `${duration}ms`
        }, 'ConfigHandler');
        addBreadcrumb(context, 'ConfigHandler', 'Configuration storage failed', {
          duration,
          error: 'Unknown error during storage operation'
        });
        
        return new Response(JSON.stringify({
          success: false,
          message: 'Failed to update configuration',
          timestamp: new Date().toISOString()
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      
      logErrorWithContext('Exception during configuration storage', error, {
        error: errMessage,
        stack: errStack
      }, 'ConfigHandler');
      addBreadcrumb(context, 'ConfigHandler', 'Exception during configuration storage', {
        error: errMessage
      });
      
      return new Response(JSON.stringify({
        success: false,
        message: 'Internal error during configuration update',
        error: errMessage,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    // For unexpected errors outside the normal flow
    const errMessage = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    
    logErrorWithContext('Unhandled error in configuration upload handler', error, {
      error: errMessage,
      stack: errStack,
      url: request.url,
      method: request.method
    }, 'ConfigHandler');
    
    // Try to add a breadcrumb if the context is available
    try {
      const context = createRequestContext(request);
      const { addBreadcrumb } = await import('../utils/requestContext');
      addBreadcrumb(context, 'ConfigHandler', 'Unhandled exception', {
        error: errMessage,
        url: request.url
      });
    } catch (breadcrumbError) {
      // If we can't add a breadcrumb, just log it
      logErrorWithContext('Failed to add breadcrumb for unhandled error', breadcrumbError, {
        error: breadcrumbError instanceof Error ? breadcrumbError.message : String(breadcrumbError)
      }, 'ConfigHandler');
    }

    return new Response(JSON.stringify({
      success: false,
      message: 'Error processing configuration upload',
      error: errMessage,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
},
{
  functionName: 'handleConfigUpload',
  component: 'ConfigHandler',
  logErrors: true
});

/**
 * Handle configuration retrieval request
 * 
 * @param request The incoming request
 * @param env Environment with KV bindings
 * @returns Response with the current configuration
 */
export const handleConfigGet = withErrorHandling<[Request, Env], Response>(
  async function handleConfigGetImpl(request: Request, env: Env): Promise<Response> {
  try {
    // Initialize request context
    const context = createRequestContext(request);
    
    // Add breadcrumb for request processing start
    const { addBreadcrumb } = await import('../utils/requestContext');
    addBreadcrumb(context, 'ConfigHandler', 'Processing configuration retrieve request', {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries([...request.headers].map(([k, v]) => 
        [k, k.toLowerCase() === 'authorization' ? '***' : v]
      ))
    });

    logDebug('Processing configuration retrieve request', {
      method: request.method,
      url: request.url,
      hasAuthHeader: !!request.headers.get('Authorization')
    });

    // Check if KV namespace exists
    if (!env.VIDEO_CONFIGURATION_STORE) {
      logErrorWithContext('No VIDEO_CONFIGURATION_STORE KV namespace binding found', new Error('KV namespace not found'), {}, 'ConfigHandler');
      addBreadcrumb(context, 'ConfigHandler', 'KV namespace missing', {
        error: 'VIDEO_CONFIGURATION_STORE binding not found'
      });
      return new Response('KV namespace not configured', { status: 500 });
    }

    // Validate request method
    if (request.method !== 'GET') {
      logDebug('Invalid method for config retrieval', { 
        method: request.method, 
        expected: 'GET' 
      });
      addBreadcrumb(context, 'ConfigHandler', 'Method not allowed', {
        method: request.method,
        expected: 'GET'
      });
      return new Response('Method not allowed', { status: 405 });
    }

    // Authorize request
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      logDebug('Missing authorization header');
      addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
        reason: 'Missing authorization header'
      });
      return new Response('Unauthorized - Missing authorization header', { status: 401 });
    }

    try {
      // Validate header format
      addBreadcrumb(context, 'ConfigHandler', 'Validating authorization header format');
      AuthHeaderSchema.parse(authHeader);
      
      // Extract token from header
      const token = authHeader.split(' ')[1];
      
      // Check if environment token is configured
      if (!env.CONFIG_API_TOKEN) {
        logErrorWithContext('CONFIG_API_TOKEN not set in environment', new Error('API token not configured'), {
          environment: env.ENVIRONMENT || 'unknown'
        }, 'ConfigHandler');
        addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
          reason: 'CONFIG_API_TOKEN not set in environment',
          environment: env.ENVIRONMENT || 'unknown'
        });
        return new Response('Unauthorized - Configuration error', { status: 500 });
      }
      
      // Validate against the secure token from environment
      if (token !== env.CONFIG_API_TOKEN) {
        logErrorWithContext('Invalid API token provided', new Error('Invalid API token'), { 
          tokenProvided: !!token,
          tokenLength: token?.length || 0,
          expectedLength: env.CONFIG_API_TOKEN?.length || 0
        }, 'ConfigHandler');
        addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
          reason: 'Invalid token',
          tokenProvided: !!token
        });
        return new Response('Unauthorized - Invalid token', { status: 401 });
      }
      
      // Log successful authentication
      logDebug('Authentication successful');
      addBreadcrumb(context, 'ConfigHandler', 'Authentication successful');
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      logErrorWithContext('Authorization header validation failed', error, {
        error: errMessage
      }, 'ConfigHandler');
      addBreadcrumb(context, 'ConfigHandler', 'Authorization failed', {
        reason: 'Invalid header format',
        error: errMessage
      });
      return new Response('Unauthorized - Invalid authorization header', { status: 401 });
    }

    // Get configuration from KV
    try {
      addBreadcrumb(context, 'ConfigHandler', 'Loading configuration from KV');
      logDebug('Loading configuration from KV', {
        environment: env.ENVIRONMENT || 'unknown'
      });
      
      const configService = ConfigurationService.getInstance();
      const startTime = Date.now();
      const config = await configService.loadConfiguration(env);
      const duration = Date.now() - startTime;
      
      addBreadcrumb(context, 'ConfigHandler', 'Configuration load completed', {
        duration,
        found: !!config,
        timestamp: new Date().toISOString()
      });
      
      if (config) {
        logDebug('Configuration successfully retrieved from KV', {
          duration: `${duration}ms`,
          configVersion: config.version,
          lastUpdated: config.lastUpdated
        });
        
        return new Response(JSON.stringify({
          ...config,
          _meta: {
            retrievedAt: new Date().toISOString(),
            environment: env.ENVIRONMENT || 'unknown'
          }
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      } else {
        logDebug('No configuration found in KV store', {
          duration: `${duration}ms`
        });
        
        return new Response(JSON.stringify({
          success: false,
          message: 'No configuration found in KV store',
          timestamp: new Date().toISOString()
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      
      logErrorWithContext('Exception during configuration retrieval', error, {
        error: errMessage,
        stack: errStack
      }, 'ConfigHandler');
      addBreadcrumb(context, 'ConfigHandler', 'Exception during configuration retrieval', {
        error: errMessage
      });
      
      return new Response(JSON.stringify({
        success: false,
        message: 'Internal error during configuration retrieval',
        error: errMessage,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (error) {
    // For unexpected errors outside the normal flow
    const errMessage = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    
    logErrorWithContext('Unhandled error in configuration retrieval handler', error, {
      error: errMessage,
      stack: errStack,
      url: request.url,
      method: request.method
    }, 'ConfigHandler');
    
    // Try to add a breadcrumb if the context is available
    try {
      const context = createRequestContext(request);
      const { addBreadcrumb } = await import('../utils/requestContext');
      addBreadcrumb(context, 'ConfigHandler', 'Unhandled exception', {
        error: errMessage,
        url: request.url
      });
    } catch (breadcrumbError) {
      // If we can't add a breadcrumb, just log it
      logErrorWithContext('Failed to add breadcrumb for unhandled error', breadcrumbError, {
        error: breadcrumbError instanceof Error ? breadcrumbError.message : String(breadcrumbError)
      }, 'ConfigHandler');
    }

    return new Response(JSON.stringify({
      success: false,
      message: 'Error retrieving configuration',
      error: errMessage,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
},
{
  functionName: 'handleConfigGet',
  component: 'ConfigHandler',
  logErrors: true
});