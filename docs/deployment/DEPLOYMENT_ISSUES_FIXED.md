# Deployment Issues Resolution

This document summarizes the production issues that were identified and fixed in the video-resizer project.

## Issues Identified

The following issues were observed in the production deployment:

1. **Debug Mode Enabled in Production**: 
   - Debug mode was incorrectly enabled in production environment
   - Debug headers were being added to all responses, increasing response size
   - This potentially contributed to "1105: Temporarily Unavailable" errors

2. **Storage Configuration Issues**:
   - R2 storage was not being used despite being configured
   - The system was falling back to remote URLs which had higher latency
   - Fallback URL construction had an error when extracting source URLs from CDN-CGI URLs

3. **Configuration Management**:
   - The VideoConfigurationManager was missing the StorageConfigSchema integration
   - No mechanism to load storage configuration from KV to VideoConfigurationManager
   - Local worker-config.json changes weren't automatically pushed to KV

## Fixes Implemented

### 1. Code Fixes

#### VideoConfigurationManager.ts

Added StorageConfigSchema to VideoConfigSchema and created a new method to access storage configuration:

```typescript
// Add StorageConfigSchema to VideoConfigSchema
import { StorageConfigSchema } from './storageConfig';

export const VideoConfigSchema = z.object({
  // ... existing schema properties
  storage: StorageConfigSchema.optional(),
});

// Add getStorageConfig method to VideoConfigurationManager
public getStorageConfig() {
  const defaultConfig = {
    priority: ['r2', 'remote', 'fallback'],
    r2: {
      enabled: false,
      bucketBinding: 'VIDEOS_BUCKET',
    },
    fetchOptions: {
      userAgent: 'Cloudflare-Video-Resizer/1.0',
    },
  };
  
  if (!this.config.storage) {
    try {
      // Log warning only once, not on every call
      const logWarning = () => {
        import('../utils/legacyLoggerAdapter').then(({ warn }) => {
          warn('VideoConfigurationManager', 'Storage configuration not found, using defaults');
        }).catch(() => {
          console.warn('[VideoConfigurationManager] Storage configuration not found, using defaults');
        });
      };
      
      logWarning();
    } catch (err) {
      // Silent catch - don't fail getting config if logging fails
    }
    
    return defaultConfig;
  }
  
  return this.config.storage;
}
```

#### TransformVideoCommand.ts

Fixed fallback URL construction to correctly extract source URLs from CDN-CGI URLs:

```typescript
try {
  // Fixed extraction - get everything after parameters
  const cdnCgiParts = cdnCgiUrl.split('/cdn-cgi/media/');
  if (cdnCgiParts.length < 2) {
    throw new Error('Invalid CDN-CGI URL format');
  }
  
  // The full path after /cdn-cgi/media/
  const fullPath = cdnCgiParts[1];
  
  // The source URL starts after the first comma in the path
  const firstCommaIndex = fullPath.indexOf(',');
  if (firstCommaIndex === -1) {
    throw new Error('Invalid CDN-CGI URL format - no comma in path');
  }
  
  // Extract source URL - everything after first comma
  sourceUrl = fullPath.substring(firstCommaIndex + 1);
  
  // Log the extracted URL for debugging
  await logDebug('TransformVideoCommand', 'Extracted source URL for direct fetch', {
    extractedUrl: sourceUrl.substring(0, 50) + (sourceUrl.length > 50 ? '...' : '')
  });
} catch (extractError) {
  // Log extraction error but continue
  logErrorWithContext('Error extracting source URL from CDN-CGI URL', extractError, {
    cdnCgiUrl: cdnCgiUrl.split('?')[0]
  }, 'TransformVideoCommand');
  
  // Use the original URL as fallback
  sourceUrl = this.context.request.url;
}
```

### 2. Configuration Updates

Updated `worker-config.json` to disable debug mode and cache debugging in production:

```json
"debug": {
  "enabled": false,
  "verbose": false,
  "includeHeaders": true,
  "includePerformance": true
}
```

```json
"cache": {
  "method": "cacheApi",
  "debug": false,
  "defaultMaxAge": 86400
}
```

### 3. Configuration Management Tool Enhancement

Enhanced the `config-upload.js` tool for better configuration management:

1. **Security Improvements**:
   - Environment variable support for authentication tokens
   - Token masking in logs to prevent exposure
   - HTTPS-only connections
   - Timeout handling for requests

2. **User Experience**:
   - Viewing current configuration without uploading
   - Creating backups before making changes
   - Updating specific sections without affecting others
   - Comparing differences between current and new configuration

3. **Technical Capabilities**:
   - More robust validation of configuration
   - Improved error handling with specific error messages
   - Better response handling and JSON parsing
   - Support for different environments (development, staging, production)

4. **Documentation**:
   - Comprehensive README with usage examples
   - Security best practices
   - Troubleshooting guide

## Next Steps

To fully resolve the production issues:

1. **Update KV Configuration**:
   ```bash
   # Update only debug and cache sections in production
   node tools/config-upload.js --env production --section debug,cache --token YOUR_PROD_TOKEN --backup
   ```

2. **Verify R2 Storage Integration**:
   ```bash
   # Update storage configuration in production
   node tools/config-upload.js --env production --section storage --token YOUR_PROD_TOKEN --backup
   ```

3. **Monitor Production**:
   - Watch for "1105: Temporarily Unavailable" errors
   - Verify R2 storage is being used
   - Check fallback URL construction is working

4. **Future Improvements**:
   - Consider adding schema validation directly in the configuration tool
   - Implement a CI/CD pipeline for configuration changes
   - Add configuration versioning and rollback capabilities