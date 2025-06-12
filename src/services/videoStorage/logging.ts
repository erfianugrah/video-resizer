/**
 * Logging utilities for the Video Storage Service
 * 
 * This module now redirects to the centralized logger for consistency.
 * @deprecated Use the centralized logger from '@/utils/logger' instead
 */

import { logDebug as centralizedLogDebug } from '../../utils/logger';

/**
 * Log a debug message with proper context handling
 * @deprecated Use logDebug from '@/utils/logger' directly
 */
export function logDebug(category: string, message: string, data?: Record<string, unknown>) {
  centralizedLogDebug(category, message, data);
}