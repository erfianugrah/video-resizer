/**
 * Logging utility functions
 * 
 * This is now a facade that directs all logging calls to the new Pino-based
 * logger system. It maintains the legacy API for backward compatibility.
 */
import { 
  info as pinoInfo, 
  debug as pinoDebug, 
  warn as pinoWarn, 
  error as pinoError 
} from './legacyLoggerAdapter';

// Reference to global logger configuration
let logConfig = {
  debugEnabled: false,
  verboseEnabled: false,
};

/**
 * Initialize logger configuration
 * @param config Logger configuration with debug settings
 */
export function initializeLogger(config: { debug?: { enabled?: boolean; verbose?: boolean } }) {
  logConfig = {
    debugEnabled: config.debug?.enabled || false,
    verboseEnabled: config.debug?.verbose || false,
  };
}

/**
 * Log an info message
 * @param component Component name
 * @param message Message to log
 * @param data Optional data to include in log
 */
export function info(component: string, message: string, data?: Record<string, unknown>) {
  // Use the Pino logger through the legacy adapter
  pinoInfo(component, message, data);
}

/**
 * Log a debug message (only if debug is enabled)
 * @param component Component name
 * @param message Message to log
 * @param data Optional data to include in log
 */
export function debug(component: string, message: string, data?: Record<string, unknown>) {
  if (logConfig.debugEnabled) {
    // Use the Pino logger through the legacy adapter
    pinoDebug(component, message, data);
  }
}

/**
 * Log an error message
 * @param component Component name
 * @param message Message to log
 * @param data Optional data to include in log
 */
export function error(component: string, message: string, data?: Record<string, unknown>) {
  // Use the Pino logger through the legacy adapter
  pinoError(component, message, data);
}

/**
 * Log a warning message
 * @param component Component name
 * @param message Message to log
 * @param data Optional data to include in log
 */
export function warn(component: string, message: string, data?: Record<string, unknown>) {
  // Use the Pino logger through the legacy adapter
  pinoWarn(component, message, data);
}

/**
 * Log a request (with special handling for Request objects)
 * @param component Component name
 * @param request Request to log
 */
export function logRequest(component: string, request: Request) {
  if (!logConfig.debugEnabled) return;

  const url = new URL(request.url);
  const requestData = {
    method: request.method,
    url: url.toString(),
    pathname: url.pathname,
    headers: logConfig.verboseEnabled ? Object.fromEntries(request.headers.entries()) : undefined,
    search: url.search,
  };

  debug(component, 'Incoming request', requestData);
}

/**
 * Log a response (with special handling for Response objects)
 * @param component Component name
 * @param response Response to log
 */
export function logResponse(component: string, response: Response) {
  if (!logConfig.debugEnabled) return;

  const responseData = {
    status: response.status,
    statusText: response.statusText,
    headers: logConfig.verboseEnabled ? Object.fromEntries(response.headers.entries()) : undefined,
    ok: response.ok,
    redirected: response.redirected,
  };

  debug(component, 'Response', responseData);
}
