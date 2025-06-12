/**
 * Helper functions for consistent logging throughout this service
 * 
 * This module now redirects to the centralized logger for consistency.
 * @deprecated Use the centralized logger from '@/utils/logger' instead
 */
import { logDebug as centralizedLogDebug, logError as centralizedLogError } from '../../utils/logger';

/**
 * Log a debug message with proper context handling
 * @deprecated Use logDebug from '@/utils/logger' directly
 */
export function logDebug(category: string, message: string, data?: Record<string, unknown>) {
  centralizedLogDebug(category, message, data);
}

/**
 * Log an error message with proper context handling
 * @deprecated Use logError from '@/utils/logger' directly
 */
export function logError(category: string, message: string, data?: Record<string, unknown>) {
  centralizedLogError(category, message, data);
}