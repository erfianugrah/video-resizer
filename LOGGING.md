# Logging Standardization Plan

## Summary

This document outlines our plan to standardize logging across the video-resizer codebase. The main issues we're addressing are:

1. **Inconsistent logging approaches**: The codebase currently uses a mix of direct `console.*` calls, legacy logger utilities, and Pino logger.

2. **Missing breadcrumbs**: Many logs bypass our breadcrumb system, which makes debugging request flows difficult in production.

3. **Configuration bypassed**: Direct console calls ignore log level settings from our configuration.

Our approach is to:
1. Standardize on Pino as our logging backend
2. Replace all direct console.* calls with proper logging
3. Ensure all logs create breadcrumbs when appropriate
4. Maintain compatibility with the existing configuration system

## Current State (Architecture)

The video-resizer logging system has evolved over time, resulting in multiple logging approaches being used simultaneously:

1. **Pino Logger** (`pinoLogger.ts`):
   - Structured logging with request context awareness
   - Proper breadcrumb integration
   - Level filtering and configuration

2. **Legacy Logger** (`loggerUtils.ts`):
   - Simple API (`debug/info/warn/error`)
   - Used throughout older parts of the codebase

3. **Legacy Adapter** (`legacyLoggerAdapter.ts`):
   - Bridges legacy logging calls to Pino
   - Maintains global request context

4. **Direct Console** calls:
   - `console.debug/info/warn/error` scattered across the codebase
   - Bypass configuration and breadcrumb capture

5. **Configuration**:
   - `LoggingConfigurationManager` loads settings from wrangler.jsonc
   - `loggingManager.ts` applies these settings to the logging system

## Issues Identified

1. **Inconsistent Logging Format**:
   - Different components log in different formats
   - Some logs appear as Pino JSON, others as simple console messages

2. **Lost Breadcrumbs**:
   - Direct console calls don't create breadcrumbs
   - Some components may use the wrong logging approach

3. **Configuration Bypassed**:
   - Direct console calls ignore log level settings
   - Sampling and filtering not applied consistently

4. **Circular Dependencies**:
   - Components that import each other can have dependency cycles
   - Logging is used everywhere, making it prone to circular dependencies

## Standardization Plan

### Phase 1: Inventory (Identify)

- [x] Identify files using `console.*` directly
- [x] Identify files using legacy logger utilities
- [x] Identify files using Pino logger directly
- [ ] Document circular dependencies that affect logging

### Phase 2: Updates (Replace)

#### 2A: Core Improvements
- [ ] Enhance `pinoLogger.ts` to handle all edge cases
- [ ] Improve `legacyLoggerAdapter.ts` to ensure consistent breadcrumb capture
- [ ] Fix any issues with context initialization in `index.ts`

#### 2B: File Updates (by category)
- [ ] Update core framework files (handlers, utils)
- [x] Update videoStorageService.ts - COMPLETED (Mar 26, 2025)
- [ ] Update remaining service layer files
- [ ] Update domain layer files
- [ ] Update configuration files

### Phase 3: Validation (Verify)

- [ ] Create logging tests that verify breadcrumb capture
- [ ] Test across different log levels and configurations
- [ ] Confirm all logs use the configured format

## Implementation Progress

### High Priority Files (Critical Path for Error Handling)

| File Path | Status | Priority | Console Calls | Notes |
|-----------|--------|----------|--------------|-------|
| `/home/erfi/resizer/video-resizer/src/services/errorHandlerService.ts` | **Priority 1** | Critical | Moderate | Main error handling service |
| `/home/erfi/resizer/video-resizer/src/services/videoStorageService.ts` | **Completed** | Critical | 0 (was ~55) | Storage service used by fallback |
| `/home/erfi/resizer/video-resizer/src/domain/commands/TransformVideoCommand.ts` | **Priority 1** | Critical | Few | Core transformation logic |
| `/home/erfi/resizer/video-resizer/src/utils/requestContext.ts` | **Priority 1** | Critical | Few | Manages breadcrumbs |
| `/home/erfi/resizer/video-resizer/src/index.ts` | **Priority 1** | Critical | Few | Entry point |

#### Implementation Notes

##### videoStorageService.ts

This file has ~55 console.log calls and is crucial for our error handling fallback functionality. Following Strategy #6 from our guidelines:

1. ✅ Added helper functions `logDebug()` and `logError()` to handle logging consistently
2. 🔄 In progress: Systematically replacing console.* calls
3. ✅ Ensuring context is handled properly with fallbacks

Implementation approach:
1. Added logging helper functions at the top of the file
2. Replacing each console.* call with the appropriate helper
3. Keeping the same log content but in structured format

Progress:
- ✅ Completed replacing all ~55 console calls with logDebug/logError helpers
- ✅ Fully standardized logging in videoStorageService.ts

Common patterns in this file:
- Pattern 1: Context check with fallback to console
  ```typescript
  const requestContext = getCurrentContext();
  if (requestContext) {
    const logger = createLogger(requestContext);
    pinoDebug(requestContext, logger, 'VideoStorageService', 'Message', { data });
  } else {
    // Fallback for when no context is available
    console.debug(`VideoStorageService: Message: ${data}`);
  }
  ```
  Replaced with:
  ```typescript
  logDebug('VideoStorageService', 'Message', { data });
  ```

- Pattern 2: Error logging with error details
  ```typescript
  console.error(`VideoStorageService: Error: ${err instanceof Error ? err.message : String(err)}`);
  ```
  Replaced with:
  ```typescript
  logError('VideoStorageService', 'Error message', { 
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
  ```

### Medium Priority Files (Core Components)

| File Path | Status | Priority | Console Calls | Notes |
|-----------|--------|----------|--------------|-------|
| `/home/erfi/resizer/video-resizer/src/services/debugService.ts` | **Priority 2** | Medium | Few | Debug functionality |
| `/home/erfi/resizer/video-resizer/src/services/cacheManagementService.ts` | **Priority 2** | Medium | Few | Cache management |
| `/home/erfi/resizer/video-resizer/src/services/TransformationService.ts` | **Priority 2** | Medium | Few | Transformation logic |
| `/home/erfi/resizer/video-resizer/src/utils/pinoLogger.ts` | **Priority 2** | Medium | 1 call | Logging engine itself |
| `/home/erfi/resizer/video-resizer/src/handlers/videoHandler.ts` | **Priority 2** | Medium | Unknown | Request handler |

### Lower Priority Files (Configuration and Utilities)

| File Path | Status | Priority | Console Calls | Notes |
|-----------|--------|----------|--------------|-------|
| `/home/erfi/resizer/video-resizer/src/utils/legacyLoggerAdapter.ts` | **Priority 3** | Low | Few | Will be updated or deprecated |
| `/home/erfi/resizer/video-resizer/src/config/environmentConfig.ts` | **Priority 3** | Low | Few | Configuration |
| `/home/erfi/resizer/video-resizer/src/config/index.ts` | **Priority 3** | Low | Few | Configuration |
| `/home/erfi/resizer/video-resizer/src/services/videoTransformationService.ts` | **Priority 3** | Low | Few | |
| `/home/erfi/resizer/video-resizer/src/domain/strategies/*.ts` | **Priority 3** | Low | Multiple files | Strategy files |

### Files using legacy logger utilities

| File Path | Status | Notes |
|-----------|--------|-------|
| `/home/erfi/resizer/video-resizer/src/domain/strategies/VideoStrategy.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/utils/loggingManager.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/domain/strategies/FrameStrategy.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/domain/strategies/SpritesheetStrategy.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/domain/strategies/StrategyFactory.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/utils/deviceUtils.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/utils/clientHints.ts` | Pending | |

### Files importing legacy logger adapter

| File Path | Status | Notes |
|-----------|--------|-------|
| `/home/erfi/resizer/video-resizer/src/services/debugService.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/index.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/domain/commands/TransformVideoCommand.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/services/errorHandlerService.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/services/cacheManagementService.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/services/videoStorageService.ts` | **Completed** | Fully migrated to pino logging with helper functions |
| `/home/erfi/resizer/video-resizer/src/services/TransformationService.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/services/videoTransformationService.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/utils/loggerUtils.ts` | Pending | |
| `/home/erfi/resizer/video-resizer/src/handlers/videoHandler.ts` | Pending | |

## Logging Guidelines for Developers

### 1. Preferred Approach: Direct Pino Logger

Use this approach for new code and when updating high-priority files:

```typescript
import { getCurrentContext } from '../utils/legacyLoggerAdapter';
import { createLogger, debug, info, warn, error } from '../utils/pinoLogger';

// Get the context
const requestContext = getCurrentContext();
if (requestContext) {
  const logger = createLogger(requestContext);
  info(requestContext, logger, 'ComponentName', 'Message here', { optional: 'data' });
}
```

### 2. For Legacy Code: Use the Legacy Adapter

Use this as an intermediate solution when refactoring is more complex:

```typescript
import { debug, info, warn, error } from '../utils/legacyLoggerAdapter';

info('ComponentName', 'Message here', { optional: 'data' });
```

### 3. Never Use Direct Console Calls

```typescript
// DON'T DO THIS
console.log('Some message');

// Instead, do this
import { info } from '../utils/legacyLoggerAdapter';
info('ComponentName', 'Some message');
```

### 4. Handling Circular Dependencies

If you encounter circular dependencies, use dynamic imports:

```typescript
// Instead of static import
// import { debug } from '../utils/legacyLoggerAdapter';

// Use dynamic import to break the circular dependency
async function logSomething() {
  try {
    const { debug } = await import('../utils/legacyLoggerAdapter');
    debug('ComponentName', 'Message here');
  } catch (err) {
    // Fallback for critical logs only if import fails
    console.debug('[ComponentName] Message here');
  }
}
```

### 5. For Initialization Code: Handle Missing Context

```typescript
try {
  // Initialization code here
} catch (err) {
  // If this is initialization code that runs before context exists:
  const errMessage = err instanceof Error ? err.message : String(err);
  console.error(`Initialization error: ${errMessage}`);
  // Once context is available, log properly
}
```

### 6. Migration Strategy for Files with Many Console Calls

1. First, add correct imports at the top:
   ```typescript
   import { getCurrentContext } from '../utils/legacyLoggerAdapter';
   import { createLogger, debug as pinoDebug, error as pinoError } from '../utils/pinoLogger';
   ```

2. Create a logging helper function for the file (to avoid code duplication):
   ```typescript
   /**
    * Log a debug message
    */
   function logDebug(category: string, message: string, data?: Record<string, unknown>) {
     const requestContext = getCurrentContext();
     if (requestContext) {
       const logger = createLogger(requestContext);
       pinoDebug(requestContext, logger, category, message, data);
     } else {
       // Fall back to console as a last resort
       console.debug(`[${category}] ${message}`, data || {});
     }
   }
   ```

3. Replace console calls systematically:
   ```typescript
   // OLD:
   console.debug(`VideoStorageService: Path transformation for ${path} to ${transformedPath}`);
   
   // NEW:
   logDebug('VideoStorageService', 'Path transformation', { 
     path, 
     transformedPath 
   });
   ```

## Next Steps and Using This Document

This document serves as both a tracking tool and a guide for standardizing logging across the video-resizer codebase. Here's how to use it:

1. **For developers working on the codebase**:
   - Before making changes to a file, check if it's on the priority list
   - If working on a file with console.* calls, follow the guidelines to update them
   - Use the patterns documented here for consistency

2. **For tracking progress**:
   - Update the status field for files as they're updated
   - Add notes about any challenging files or patterns discovered
   - Consider using git blame to track who added console.* calls to coordinate fixes

3. **For review**:
   - When reviewing PRs, check for proper logging patterns
   - Ensure no new console.* calls are being added
   - Verify that breadcrumbs are being tracked correctly

The ultimate goal is to have all logging use the Pino logger consistently, ensuring we have breadcrumbs for all operations and respect configuration settings in all environments.