# Configuration Tool Improvements

The current `config-upload.js` tool works but could be improved in several ways to make it more robust, user-friendly, and maintainable.

## Current Limitations

1. **Minimal Error Handling**
   - Basic error handling for file existence and JSON parsing
   - No validation of config structure before upload
   - Limited error details from the server

2. **Security Concerns**
   - Token is passed as a command-line argument (visible in process list)
   - No support for environment variables for sensitive information
   - No validation of token format

3. **UX Issues**
   - Confirmation only for production, not staging
   - Minimal feedback during operation
   - No way to view current configuration without uploading
   - Limited support for partial config updates

4. **Technical Limitations**
   - No config schema validation
   - No diff view before upload
   - No backup of existing configuration

## Recommended Improvements

### 1. Enhanced Configuration Validation

```javascript
// Add schema validation with Zod (already used in the project)
import { WorkerConfigurationSchema } from '../src/services/configurationService.js';

// Validate configuration before upload
try {
  const validatedConfig = WorkerConfigurationSchema.parse(config);
  config = validatedConfig; // Use the validated config
  console.log('✅ Configuration validated successfully');
} catch (error) {
  console.error('❌ Configuration validation failed:');
  console.error(error.errors);
  process.exit(1);
}
```

### 2. Improved Security

```javascript
// Support for environment variables
const getToken = () => {
  if (options.token) {
    return options.token;
  }
  
  if (process.env.VIDEO_RESIZER_CONFIG_TOKEN) {
    return process.env.VIDEO_RESIZER_CONFIG_TOKEN;
  }
  
  console.error('Error: Authentication token is required. Use --token option or set VIDEO_RESIZER_CONFIG_TOKEN environment variable.');
  process.exit(1);
};

// Mask token in logs
const maskToken = (token) => {
  if (!token) return '';
  return token.substring(0, 4) + '...' + token.substring(token.length - 4);
};

// Use secure token handling
const token = getToken();
console.log(`Using token: ${maskToken(token)}`);
```

### 3. Better User Experience

```javascript
// Add configuration viewing option
if (options.view) {
  const endpoint = `${targetUrl}/admin/config`;
  console.log(`Fetching current configuration from ${endpoint}...`);
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (response.ok) {
    const currentConfig = await response.json();
    console.log(JSON.stringify(currentConfig, null, 2));
  } else {
    console.error(`Failed to fetch configuration: ${response.status}`);
  }
  
  process.exit(0);
}

// Add progress indication for large configs
console.log('Preparing to upload configuration...');
const configSize = JSON.stringify(config).length;
console.log(`Configuration size: ${(configSize / 1024).toFixed(2)} KB`);
```

### 4. Technical Enhancements

```javascript
// Backup current configuration before upload
async function backupCurrentConfig(url, token) {
  const endpoint = `${url}/admin/config`;
  console.log(`Backing up current configuration from ${endpoint}...`);
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (response.ok) {
    const currentConfig = await response.json();
    const backupPath = path.join(
      path.dirname(options.config),
      `backup-${new Date().toISOString().replace(/:/g, '-')}.json`
    );
    
    fs.writeFileSync(backupPath, JSON.stringify(currentConfig, null, 2));
    console.log(`✅ Current configuration backed up to ${backupPath}`);
    return currentConfig;
  } else {
    console.warn(`⚠️ Could not backup current configuration: ${response.status}`);
    return null;
  }
}

// Show diff between current and new configuration
function showConfigDiff(current, updated) {
  if (!current) return;
  
  console.log('\nKey differences:');
  
  // Debug mode changes
  if (current.debug?.enabled !== updated.debug?.enabled) {
    console.log(`- Debug mode: ${current.debug?.enabled} → ${updated.debug?.enabled}`);
  }
  
  // Storage changes
  if (JSON.stringify(current.storage?.r2) !== JSON.stringify(updated.storage?.r2)) {
    console.log('- R2 storage configuration changed');
  }
  
  // Cache changes
  if (current.cache?.debug !== updated.cache?.debug) {
    console.log(`- Cache debug: ${current.cache?.debug} → ${updated.cache?.debug}`);
  }
  
  console.log(''); // Add blank line
}
```

### 5. Support for Partial Updates

```javascript
// Allow updating only specific sections
if (options.section) {
  const sections = options.section.split(',');
  const currentConfig = await fetchCurrentConfig(targetUrl, token);
  
  if (!currentConfig) {
    console.error('Cannot perform partial update without current configuration');
    process.exit(1);
  }
  
  const updatedConfig = { ...currentConfig };
  
  sections.forEach(section => {
    if (config[section]) {
      updatedConfig[section] = config[section];
      console.log(`Updating section: ${section}`);
    } else {
      console.warn(`Section not found in new config: ${section}`);
    }
  });
  
  config = updatedConfig;
}
```

## Revised Command Line Options

```javascript
program
  .name('config-upload')
  .description('Upload configuration to video-resizer worker')
  .option('-u, --url <url>', 'Worker URL')
  .option('-c, --config <path>', 'Path to configuration file', CONFIG_PATH)
  .option('-t, --token <token>', 'Authentication token')
  .option('-e, --env <environment>', 'Environment (development, staging, production)')
  .option('--section <sections>', 'Update only specific sections (comma-separated)')
  .option('--view', 'View current configuration without uploading')
  .option('--backup', 'Create backup of current configuration')
  .option('--dry-run', 'Validate configuration without uploading')
  .option('--no-confirmation', 'Skip confirmation prompts')
  .option('-v, --verbose', 'Verbose output')
  .parse(process.argv);
```

## Error Handling Improvements

```javascript
// Handle different types of errors more gracefully
try {
  // Code...
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    console.error(`❌ Connection refused: Could not connect to ${targetUrl}`);
  } else if (error.code === 'ENOTFOUND') {
    console.error(`❌ Host not found: ${targetUrl}`);
  } else if (error instanceof SyntaxError) {
    console.error('❌ Invalid response from server (not JSON)');
  } else {
    console.error(`❌ Error: ${error.message}`);
    if (options.verbose) {
      console.error(error.stack);
    }
  }
  process.exit(1);
}
```

By implementing these improvements, the configuration tool will be more robust, secure, and user-friendly, providing better feedback and protection against errors.