/**
 * Mock logger for testing
 */
import { vi } from 'vitest';

export const createLogger = vi.fn().mockReturnValue({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn()
});

export const debug = vi.fn();
export const info = vi.fn();
export const warn = vi.fn();
export const error = vi.fn();
export const fatal = vi.fn();