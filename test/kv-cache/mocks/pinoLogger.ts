/**
 * Mock Pino Logger for testing
 */
import { vi } from 'vitest';

// Mock logger object
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => mockLogger,
};

// Mock createLogger function
export const createLogger = vi.fn(() => mockLogger);

// Mock debug function
export const debug = vi.fn();

// Mock info function
export const info = vi.fn();

// Mock error function
export const error = vi.fn();

// Export mock logger
export default mockLogger;
