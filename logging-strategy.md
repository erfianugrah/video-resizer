# Logging Strategy

## Current Implementation Overview

The video-resizer uses a multi-layered logging system:
- **pinoLogger.ts** - Core Pino-based logger with level checking
- **loggerUtils.ts** - Legacy facade for backward compatibility  
- **requestContext.ts** - Request-scoped breadcrumbs and performance tracking
- **logger.ts** - Category-based logger for components

## Log Levels & When to Use Them

### ERROR
- Actual failures that prevent operation completion
- Unhandled exceptions
- Critical service failures
- Example: "Failed to process video: Invalid format"

### WARN
- Recoverable issues or degraded performance
- Fallback behavior triggered
- Resource limits approaching
- Currently underutilized - most warnings logged as info

### INFO  
- Key business operations (start/complete)
- State changes
- Important metrics
- Example: "Video transformation completed in 250ms"

### DEBUG
- Detailed operation flow
- Internal state for troubleshooting
- Configuration values
- Example: "Applying transform: width=1920, quality=85"
- Currently includes breadcrumb logging (should move to trace)

### TRACE
- Very detailed debugging info
- All parameters and intermediate values
- Breadcrumbs and request tracking
- **Not currently implemented** - would be ideal for breadcrumbs

## Implementation Changes

### 1. Fix Breadcrumb Logging
**File**: `src/utils/requestContext.ts` (lines 303-308)

Current issue: Breadcrumbs are ALWAYS logged at debug level, creating ~7,400 log lines per 100 requests.

```typescript
// Current - Always logs
logDebug({
  category: LogCategory.RequestContext,
  message: 'Adding breadcrumb',
  context: { requestId, breadcrumb }
});

// Proposed - Only log in trace mode (when implemented) or with explicit flag
if (loggingConfig.breadcrumbs.logAdditions === true) {
  logDebug({
    category: LogCategory.RequestContext,
    message: 'Adding breadcrumb',
    context: { requestId, breadcrumb }
  });
}
```

Add to config:
```json
"breadcrumbs": {
  "enabled": true,        // Keep collecting breadcrumbs
  "maxItems": 25,
  "logAdditions": false   // Don't log each addition
}

```

### 2. Remove console.log Statements

Found in 44 files, but most are in tools/tests. Production code to clean:
- `src/services/videoOptionsService.ts` (lines 46, 109) - Remove these
- Keep console statements in: pinoLogger.ts, requestContext.ts (initialization only)
- Tool scripts can keep them (check-config.js, etc.)

### 3. Reclassify Current Logs Based on Analysis

#### Keep at INFO:
- Request start/complete
- Cache misses (important for monitoring)
- Transform completion with timing
- Performance warnings (>1000ms threshold)
- Origin fallback attempts

#### Move from INFO to DEBUG:
- `videoOptionsService.ts`: IMQuery detection, derivative matching (lines 57, 103, 197, 260)
- `videoHandlerWithOrigins.ts`: "Handling video request", "No video source found"
- Cache hits (currently logged, high volume)
- Configuration loading details
- Environment detection logs (5 logs per init)

#### Move to TRACE (when implemented):
- Breadcrumbs (currently 37% of all logs!)
- All intermediate processing steps
- Request header details
- Transform parameter calculations

### 4. Update Config Structure

Current config has two level settings that conflict:
- Line 816: `"level": "debug"`  
- Line 839: `"level": "debug"` (inside pino object - this overrides!)

```json
{
  "logging": {
    "level": "info",  // Change from debug
    "breadcrumbs": {
      "enabled": true,      // Store breadcrumbs for error context
      "maxItems": 25,
      "logAdditions": false // NEW - Don't log each breadcrumb
    },
    "pino": {
      "level": "info"  // Change from debug - MUST match above!
    }
  }
}
```

Note: The pino.level overrides the main level, so both must be updated!

## Expected Results After Changes

### Current State (DEBUG level)
- ~20,000 lines per 100 requests
- 37% are breadcrumb logs (7,400 lines)
- 45% are debug-level logs

### After Quick Fixes (INFO level)
- ~4,000 lines per 100 requests (80% reduction)
- Breadcrumbs: Hidden but still collected
- Shows: Requests, errors, cache misses, completions
- Hides: Breadcrumbs, cache hits, routine operations

### With Full Implementation (INFO level)
- ~2,000 lines per 100 requests (90% reduction)
- Only operationally important events logged
- Debug mode available via header/config for troubleshooting

## Implementation Status

### ✅ Completed (Phase 1 - 80% reduction achieved):
1. **Updated `worker-config.json`**:
   - Changed main log level from "debug" to "info" (line 816)
   - Changed pino log level from "debug" to "info" (line 839)
   - Added `logAdditions: false` to breadcrumbs config

2. **Implemented breadcrumb logging control**:
   - Added check in `requestContext.ts` (line 303)
   - Updated `LoggingConfigurationManager.ts` schema
   - Breadcrumbs still collected but not logged

3. **Cleaned up logging**:
   - Removed 2 console.log statements from `videoOptionsService.ts`
   - Changed 4 info() calls to debug() in `videoOptionsService.ts`

### ⏳ Next Phase:
   - Fix environment config re-initialization
   - Implement component-based log level control
   - Add trace level support

3. **Future**:
   - Add trace level support
   - Implement log sampling for high-volume events
   - Add debug mode toggle via request header