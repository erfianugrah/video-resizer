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
- [x] Update critical path files - COMPLETED (Mar 26, 2025)
  - [x] errorHandlerService.ts
  - [x] videoStorageService.ts
  - [x] TransformVideoCommand.ts
  - [x] requestContext.ts
  - [x] index.ts
- [ ] Update medium priority service files
  - [ ] TransformationService.ts (~8 console calls)
  - [ ] cacheManagementService.ts (~15 console calls)
  - [ ] videoTransformationService.ts (~2 console calls)
  - [ ] debugService.ts (~9 console calls)
- [ ] Update remaining low priority files
  - [ ] Config files
  - [ ] Utils files

### Phase 3: Validation (Verify)

- [ ] Create logging tests that verify breadcrumb capture
- [ ] Test across different log levels and configurations
- [ ] Confirm all logs use the configured format

## Implementation Progress

### High Priority Files (Critical Path for Error Handling)

| File Path | Status | Priority | Console Calls | Notes |
|-----------|--------|----------|--------------|-------|
| `/home/erfi/resizer/video-resizer/src/services/errorHandlerService.ts` | **Completed** | Critical | 0 (was ~10) | Main error handling service |
| `/home/erfi/resizer/video-resizer/src/services/videoStorageService.ts` | **Completed** | Critical | 0 (was ~55) | Storage service used by fallback |
| `/home/erfi/resizer/video-resizer/src/domain/commands/TransformVideoCommand.ts` | **Completed** | Critical | 0 (was ~15) | Core transformation logic |
| `/home/erfi/resizer/video-resizer/src/utils/requestContext.ts` | **Completed** | Critical | 2* | Manages breadcrumbs |
| `/home/erfi/resizer/video-resizer/src/index.ts` | **Completed** | Critical | 3* | Entry point |

#### Implementation Notes

##### videoStorageService.ts

This file had ~55 console.log calls and is crucial for our error handling fallback functionality. Following Strategy #6 from our guidelines:

1. ✅ Added helper functions `logDebug()` and `logError()` to handle logging consistently
2. ✅ Systematically replaced all console.* calls
3. ✅ Ensuring context is handled properly with fallbacks

Implementation approach:
1. Added logging helper functions at the top of the file
2. Replaced each console.* call with the appropriate helper
3. Kept the same log content but in structured format

##### errorHandlerService.ts

This file had ~10 console.log calls and is the primary error handling service. Following the same strategy:

1. ✅ Added helper functions `logDebug()` and `logError()` for consistent logging
2. ✅ Systematically replaced all conditional logging patterns
3. ✅ Simplified code by removing redundant context checks

Implementation approach:
1. Added the same helper functions at the top of the file
2. Removed repeated context and logger creation code
3. Consolidated duplicate logging statements into single calls

##### TransformVideoCommand.ts

This file had ~15 console calls embedded in complex conditional code with dynamic imports. Following the same strategy:

1. ✅ Added async helper functions `logDebug()` and `logError()` for consistent logging
2. ✅ Replaced all mixed logging patterns with consistent calls
3. ✅ Maintained proper fallback chain for context-less scenarios
4. ✅ Kept browser-context console.log calls in HTML injection (intentional)

Implementation approach:
1. Added async logging helper functions that handle all edge cases
2. Replaced complex conditional logging with simple helper calls
3. Added proper error handling in the logging functions themselves
4. Preserved console.logs that run in browser context (in script tags)

##### requestContext.ts

This file required a special approach due to its central role in the logging system:

1. ✅ Created specialized local helper functions that avoid circular dependencies
2. ✅ Used direct console.debug/warn calls in helper functions (intentional)
3. ✅ Structured all log messages with proper context data
4. ✅ Improved error handling in configuration loading

Implementation approach:
1. Created dedicated logDebug/logWarn functions for this module only
2. Kept direct console.* calls in these helpers to avoid circular dependencies
3. Replaced all direct console.* calls with these helper functions
4. Added proper structured data to all logs for easier filtering

##### index.ts

This file is the main entry point for all requests and required special care:

1. ✅ Created custom helper functions with both logger and console fallbacks
2. ✅ Handled initialization edge cases gracefully
3. ✅ Maintained proper logging before logger system is fully initialized
4. ✅ Added consistent structured data to all log messages

Implementation approach:
1. Added logInfo/logError/logDebug helpers with try/catch for logger initialization
2. Included fallbacks to console.* in helper functions for early initialization
3. Used consistent message formatting and structured data patterns
4. Simplified the main fetch code by removing redundant logging logic

Progress:
- ✅ Completed replacing all ~55 console calls with logDebug/logError helpers in videoStorageService.ts
- ✅ Completed replacing all ~10 console calls with logDebug/logError helpers in errorHandlerService.ts
- ✅ Completed replacing all ~15 console calls with async logDebug/logError helpers in TransformVideoCommand.ts
- ✅ Completed replacing all ~13 console calls in requestContext.ts with special dependency-safe helpers
- ✅ Completed replacing all ~6 console calls in index.ts with initialization-safe helper functions
- ✅ Fully standardized logging in all critical path services ✓

### Remaining Console Calls (Phase 2)

Based on a code scan, these files still have console calls that need to be standardized:

| File Path | Console Calls | Priority |
|-----------|--------------|----------|
| `TransformationService.ts` | ~8 calls | Medium |
| `cacheManagementService.ts` | ~15 calls | Medium |
| `videoTransformationService.ts` | ~2 calls | Medium |
| `debugService.ts` | ~9 calls | Medium |
| `config/environmentConfig.ts` | ~1 call | Low |
| `config/index.ts` | ~3 calls | Low |
| `pinoLogger.ts` | 1 call | Low |

All console calls in helper functions and intentional browser-side logging have been preserved as required.

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
| `/home/erfi/resizer/video-resizer/src/index.ts` | **Completed** | Fully migrated to helper functions with proper fallbacks |
| `/home/erfi/resizer/video-resizer/src/domain/commands/TransformVideoCommand.ts` | **Completed** | Fully migrated to pino logging with helper functions |
| `/home/erfi/resizer/video-resizer/src/services/errorHandlerService.ts` | **Completed** | Fully migrated to pino logging with helper functions |
| `/home/erfi/resizer/video-resizer/src/utils/requestContext.ts` | **Completed** | Special implementation due to circular dependency concerns |
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