import { createLogger, debug as pinoDebug, error as pinoError } from '../../utils/pinoLogger';
import { getCurrentContext } from '../../utils/legacyLoggerAdapter';
import { addBreadcrumb } from '../../utils/requestContext';
import { logErrorWithContext } from '../../utils/errorHandlingUtils';

/**
 * Helper functions for consistent logging throughout this file
 */
export function logDebug(message: string, data?: Record<string, unknown>): void {
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'KVStorageService', message, data);
  } else {
    console.debug(`KVStorageService: ${message}`, data || {});
  }
}

/**
 * Helper function for logging chunk-specific operations
 */
export function logChunkDebug(operation: 'store' | 'retrieve', message: string, data?: Record<string, unknown>): void {
  const prefix = operation === 'store' ? '[STORE_VIDEO CHUNK]' : '[GET_VIDEO CHUNK]';
  logDebug(`${prefix} ${message}`, data);
}

/**
 * Helper function to log data integrity verification events
 */
export function logIntegrityCheck(operation: 'store' | 'retrieve', key: string, expected: number, actual: number, success: boolean): void {
  const prefix = operation === 'store' ? '[STORE_VIDEO INTEGRITY]' : '[GET_VIDEO INTEGRITY]';
  const status = success ? 'PASSED' : 'FAILED';
  
  logDebug(`${prefix} ${status} for ${key}`, {
    expected,
    actual,
    operation,
    mismatch: !success,
    difference: actual - expected
  });
  
  // Log critical error if integrity check failed
  if (!success) {
    const errorMsg = `Size mismatch for ${key}. Expected: ${expected}, Actual: ${actual}`;
    logErrorWithContext(
      `${prefix} ${errorMsg}`, 
      new Error('Data integrity violation'),
      { key, expected, actual },
      'KVStorageService'
    );
  }
}

/**
 * Helper function to add range request diagnostics
 */
export function addRangeDiagnostics(
  key: string,
  rangeHeader: string | null,
  status: 'success' | 'unsatisfiable' | 'error',
  totalSize: number,
  source: string,
  start?: number,
  end?: number
): void {
  const requestContext = getCurrentContext();
  if (!requestContext) return;
  
  addBreadcrumb(requestContext, 'KV', `Range request ${status}`, {
    key,
    rangeHeader: rangeHeader || '',
    totalSize,
    status,
    start,
    end,
    source
  });
  
  // Add to diagnostics object
  if (!requestContext.diagnostics) {
    requestContext.diagnostics = {};
  }
  
  requestContext.diagnostics.rangeRequest = {
    header: rangeHeader,
    status,
    total: totalSize,
    source,
    start,
    end
  };
}