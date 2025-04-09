#!/usr/bin/env node

/**
 * Configuration Upload Tool
 *
 * A utility to manage and upload configuration to the video-resizer worker.
 *
 * Usage:
 *   node config-upload.js [options]
 *
 * Options:
 *   --url, -u         Worker URL (default: http://localhost:8787)
 *   --config, -c      Path to config file (default: ./config/worker-config.json)
 *   --token, -t       Authentication token
 *   --env, -e         Environment (development, staging, production)
 *   --section         Update only specific sections (comma-separated)
 *   --view            View current configuration without uploading
 *   --backup          Create backup of current configuration
 *   --dry-run         Validate configuration without uploading
 *   --no-confirmation Skip confirmation prompts
 *   --verbose, -v     Verbose output
 *   --help, -h        Show help
 */

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { program } from 'commander';
import readline from 'readline';

// Configuration
const CONFIG_PATH = './config/worker-config.json';
const ENVIRONMENTS = {
  development: 'https://video-resizer-development.anugrah.workers.dev',
  staging: 'https://staging-video-resizer.workers.dev',
  production: 'https://cdn.erfi.dev',
};

// Define CLI options
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

const options = program.opts();

/**
 * Securely get authentication token from options or environment variables
 */
function getToken() {
  if (options.token) {
    return options.token;
  }
  
  if (process.env.VIDEO_RESIZER_CONFIG_TOKEN) {
    return process.env.VIDEO_RESIZER_CONFIG_TOKEN;
  }
  
  console.error('Error: Authentication token is required. Use --token option or set VIDEO_RESIZER_CONFIG_TOKEN environment variable.');
  process.exit(1);
}

/**
 * Mask token for display in logs
 */
function maskToken(token) {
  if (!token || token.length < 8) return '[token]';
  return token.substring(0, 4) + '...' + token.substring(token.length - 4);
}

/**
 * Fetch current configuration from server
 */
async function fetchCurrentConfig(url, token) {
  try {
    const endpoint = `${url}/admin/config`;
    console.log(`Fetching current configuration from ${endpoint}...`);
    
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const currentConfig = await response.json();
      return currentConfig;
    } else {
      console.warn(`Failed to fetch configuration: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.warn(`Could not fetch current configuration: ${error.message}`);
    return null;
  }
}

/**
 * Back up current configuration to file
 */
async function backupCurrentConfig(url, token, config = null) {
  try {
    // Use provided config or fetch it
    const currentConfig = config || await fetchCurrentConfig(url, token);
    
    if (!currentConfig) {
      console.warn(`⚠️ Could not backup configuration: Failed to fetch current configuration`);
      return null;
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupDir = path.join(path.dirname(options.config), 'backups');
    
    // Create backups directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }
    
    const backupPath = path.join(backupDir, `config-backup-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentConfig, null, 2));
    console.log(`✅ Current configuration backed up to ${backupPath}`);
    
    return currentConfig;
  } catch (error) {
    console.warn(`⚠️ Could not backup current configuration: ${error.message}`);
    return null;
  }
}

/**
 * Show differences between current and new configuration
 */
function showConfigDiff(current, updated) {
  if (!current) return;
  
  console.log('\n📊 Key differences:');
  let diffCount = 0;
  
  // Debug mode changes
  if (current.debug?.enabled !== updated.debug?.enabled) {
    console.log(`• Debug mode: ${current.debug?.enabled} → ${updated.debug?.enabled}`);
    diffCount++;
  }
  
  // Debug verbose changes
  if (current.debug?.verbose !== updated.debug?.verbose) {
    console.log(`• Debug verbose: ${current.debug?.verbose} → ${updated.debug?.verbose}`);
    diffCount++;
  }
  
  // Debug headers changes
  if (current.debug?.includeHeaders !== updated.debug?.includeHeaders) {
    console.log(`• Debug headers: ${current.debug?.includeHeaders} → ${updated.debug?.includeHeaders}`);
    diffCount++;
  }
  
  // Cache debug changes
  if (current.cache?.debug !== updated.cache?.debug) {
    console.log(`• Cache debug: ${current.cache?.debug} → ${updated.cache?.debug}`);
    diffCount++;
  }
  
  // Cache method changes
  if (current.cache?.method !== updated.cache?.method) {
    console.log(`• Cache method: ${current.cache?.method} → ${updated.cache?.method}`);
    diffCount++;
  }
  
  // Cache TTL changes
  if (current.cache?.defaultMaxAge !== updated.cache?.defaultMaxAge) {
    console.log(`• Cache TTL: ${current.cache?.defaultMaxAge} → ${updated.cache?.defaultMaxAge}`);
    diffCount++;
  }
  
  // Log level changes
  if (current.logging?.level !== updated.logging?.level) {
    console.log(`• Log level: ${current.logging?.level} → ${updated.logging?.level}`);
    diffCount++;
  }

  // Storage priority changes
  if (JSON.stringify(current.storage?.priority) !== JSON.stringify(updated.storage?.priority)) {
    console.log(`• Storage priority changed: ${JSON.stringify(current.storage?.priority)} → ${JSON.stringify(updated.storage?.priority)}`);
    diffCount++;
  }

  // Storage R2 changes
  if (JSON.stringify(current.storage?.r2) !== JSON.stringify(updated.storage?.r2)) {
    const r2Enabled = current.storage?.r2?.enabled !== updated.storage?.r2?.enabled;
    const bucketChanged = current.storage?.r2?.bucketBinding !== updated.storage?.r2?.bucketBinding;
    
    if (r2Enabled) {
      console.log(`• R2 enabled: ${current.storage?.r2?.enabled} → ${updated.storage?.r2?.enabled}`);
    }
    if (bucketChanged) {
      console.log(`• R2 bucket: ${current.storage?.r2?.bucketBinding} → ${updated.storage?.r2?.bucketBinding}`);
    }
    if (!r2Enabled && !bucketChanged) {
      console.log(`• R2 storage configuration changed`);
    }
    diffCount++;
  }
  
  // Path patterns changes
  const currentPatternCount = current.video?.pathPatterns?.length || 0;
  const updatedPatternCount = updated.video?.pathPatterns?.length || 0;
  
  if (currentPatternCount !== updatedPatternCount) {
    console.log(`• Path patterns: ${currentPatternCount} → ${updatedPatternCount}`);
    diffCount++;
  } else if (JSON.stringify(current.video?.pathPatterns) !== JSON.stringify(updated.video?.pathPatterns)) {
    console.log(`• Path patterns configuration changed (same count but different content)`);
    diffCount++;
  }
  
  // Video derivatives changes
  if (JSON.stringify(current.video?.derivatives) !== JSON.stringify(updated.video?.derivatives)) {
    console.log(`• Video derivatives configuration changed`);
    diffCount++;
  }
  
  // Version changes
  if (current.version !== updated.version) {
    console.log(`• Version: ${current.version} → ${updated.version}`);
    diffCount++;
  }
  
  if (diffCount === 0) {
    console.log('• No significant differences detected');
  }
  
  console.log(''); // Add blank line
}

/**
 * Validate configuration schema
 * This is a simple validation - in production you would import the actual Zod schema
 */
function validateConfig(config) {
  // Verify required top-level sections
  const requiredSections = ['version', 'video', 'cache', 'debug', 'logging'];
  const missingFields = requiredSections.filter(field => !config[field]);
  
  if (missingFields.length > 0) {
    console.error(`❌ Invalid configuration: Missing required sections: ${missingFields.join(', ')}`);
    return false;
  }
  
  // Check version is a string
  if (typeof config.version !== 'string') {
    console.error('❌ Invalid configuration: version must be a string');
    return false;
  }
  
  // Validate debug section
  const debugValidation = validateDebugSection(config.debug);
  if (!debugValidation.valid) {
    console.error(`❌ Invalid debug configuration: ${debugValidation.message}`);
    return false;
  }
  
  // Validate cache section
  const cacheValidation = validateCacheSection(config.cache);
  if (!cacheValidation.valid) {
    console.error(`❌ Invalid cache configuration: ${cacheValidation.message}`);
    return false;
  }
  
  // Validate video section
  const videoValidation = validateVideoSection(config.video);
  if (!videoValidation.valid) {
    console.error(`❌ Invalid video configuration: ${videoValidation.message}`);
    return false;
  }
  
  // Validate logging section
  const loggingValidation = validateLoggingSection(config.logging);
  if (!loggingValidation.valid) {
    console.error(`❌ Invalid logging configuration: ${loggingValidation.message}`);
    return false;
  }
  
  // Validate storage section if present
  if (config.storage) {
    const storageValidation = validateStorageSection(config.storage);
    if (!storageValidation.valid) {
      console.error(`❌ Invalid storage configuration: ${storageValidation.message}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Validate debug section
 */
function validateDebugSection(debug) {
  if (typeof debug.enabled !== 'boolean') {
    return { valid: false, message: 'debug.enabled must be a boolean' };
  }
  
  if (debug.verbose !== undefined && typeof debug.verbose !== 'boolean') {
    return { valid: false, message: 'debug.verbose must be a boolean' };
  }
  
  if (debug.includeHeaders !== undefined && typeof debug.includeHeaders !== 'boolean') {
    return { valid: false, message: 'debug.includeHeaders must be a boolean' };
  }
  
  if (debug.includePerformance !== undefined && typeof debug.includePerformance !== 'boolean') {
    return { valid: false, message: 'debug.includePerformance must be a boolean' };
  }
  
  return { valid: true };
}

/**
 * Validate cache section
 */
function validateCacheSection(cache) {
  const validCacheMethods = ['cacheApi', 'cf', 'none'];
  
  if (typeof cache.method !== 'string') {
    return { valid: false, message: 'cache.method must be a string' };
  }
  
  if (!validCacheMethods.includes(cache.method)) {
    return { valid: false, message: `cache.method must be one of: ${validCacheMethods.join(', ')}` };
  }
  
  if (cache.debug !== undefined && typeof cache.debug !== 'boolean') {
    return { valid: false, message: 'cache.debug must be a boolean' };
  }
  
  if (cache.defaultMaxAge !== undefined && 
     (typeof cache.defaultMaxAge !== 'number' || cache.defaultMaxAge < 0)) {
    return { valid: false, message: 'cache.defaultMaxAge must be a positive number' };
  }
  
  if (cache.cacheEverything !== undefined && typeof cache.cacheEverything !== 'boolean') {
    return { valid: false, message: 'cache.cacheEverything must be a boolean' };
  }
  
  return { valid: true };
}

/**
 * Validate video section
 */
function validateVideoSection(video) {
  // Check for required fields
  if (!video.defaults) {
    return { valid: false, message: 'video.defaults is required' };
  }
  
  if (!video.derivatives) {
    return { valid: false, message: 'video.derivatives is required' };
  }
  
  if (!video.pathPatterns) {
    return { valid: false, message: 'video.pathPatterns is required' };
  }
  
  // Validate path patterns
  if (!Array.isArray(video.pathPatterns)) {
    return { valid: false, message: 'video.pathPatterns must be an array' };
  }
  
  // Check path patterns for required properties
  for (let i = 0; i < video.pathPatterns.length; i++) {
    const pattern = video.pathPatterns[i];
    
    if (!pattern.name) {
      return { valid: false, message: `video.pathPatterns[${i}] missing required 'name' property` };
    }
    
    if (typeof pattern.name !== 'string') {
      return { valid: false, message: `video.pathPatterns[${i}].name must be a string` };
    }
    
    if (!pattern.matcher) {
      return { valid: false, message: `video.pathPatterns[${i}] missing required 'matcher' property` };
    }
    
    if (typeof pattern.matcher !== 'string') {
      return { valid: false, message: `video.pathPatterns[${i}].matcher must be a string` };
    }
    
    if (pattern.processPath === undefined) {
      return { valid: false, message: `video.pathPatterns[${i}] missing required 'processPath' property` };
    }
    
    if (typeof pattern.processPath !== 'boolean') {
      return { valid: false, message: `video.pathPatterns[${i}].processPath must be a boolean` };
    }
    
    // baseUrl and originUrl can be null, but they must be defined
    if (pattern.baseUrl === undefined) {
      return { valid: false, message: `video.pathPatterns[${i}] missing required 'baseUrl' property (can be null)` };
    }
    
    if (pattern.originUrl === undefined) {
      return { valid: false, message: `video.pathPatterns[${i}] missing required 'originUrl' property (can be null)` };
    }
  }
  
  // Validate derivatives
  for (const [key, derivative] of Object.entries(video.derivatives)) {
    if (typeof derivative !== 'object' || derivative === null) {
      return { valid: false, message: `video.derivatives.${key} must be an object` };
    }
  }
  
  return { valid: true };
}

/**
 * Validate logging section
 */
function validateLoggingSection(logging) {
  const validLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  
  if (logging.level !== undefined) {
    if (typeof logging.level !== 'string') {
      return { valid: false, message: 'logging.level must be a string' };
    }
    
    if (!validLogLevels.includes(logging.level.toLowerCase())) {
      return { valid: false, message: `logging.level must be one of: ${validLogLevels.join(', ')}` };
    }
  }
  
  return { valid: true };
}

/**
 * Validate storage section 
 */
function validateStorageSection(storage) {
  // Validate storage priority if present
  if (storage.priority) {
    if (!Array.isArray(storage.priority)) {
      return { valid: false, message: 'storage.priority must be an array' };
    }
    
    const validPriorities = ['r2', 'remote', 'fallback'];
    for (const priority of storage.priority) {
      if (!validPriorities.includes(priority)) {
        return { valid: false, message: `storage.priority contains invalid value: ${priority}. Must be one of: ${validPriorities.join(', ')}` };
      }
    }
  }
  
  // Validate r2 configuration if present
  if (storage.r2) {
    if (typeof storage.r2 !== 'object' || storage.r2 === null) {
      return { valid: false, message: 'storage.r2 must be an object' };
    }
    
    if (storage.r2.enabled !== undefined && typeof storage.r2.enabled !== 'boolean') {
      return { valid: false, message: 'storage.r2.enabled must be a boolean' };
    }
    
    if (storage.r2.bucketBinding !== undefined && typeof storage.r2.bucketBinding !== 'string') {
      return { valid: false, message: 'storage.r2.bucketBinding must be a string' };
    }
  }
  
  // Validate fetchOptions if present
  if (storage.fetchOptions) {
    if (typeof storage.fetchOptions !== 'object' || storage.fetchOptions === null) {
      return { valid: false, message: 'storage.fetchOptions must be an object' };
    }
    
    if (storage.fetchOptions.userAgent !== undefined && typeof storage.fetchOptions.userAgent !== 'string') {
      return { valid: false, message: 'storage.fetchOptions.userAgent must be a string' };
    }
  }
  
  return { valid: true };
}

/**
 * Wait for user confirmation
 */
async function confirmAction(message) {
  if (!options.confirmation) {
    return true;
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// Main function
async function main() {
  try {
    // Determine URL based on environment or direct URL
    let targetUrl = options.url;
    if (options.env && ENVIRONMENTS[options.env]) {
      targetUrl = ENVIRONMENTS[options.env];
      console.log(`🌐 Using ${options.env} environment URL: ${targetUrl}`);
    }

    if (!targetUrl) {
      console.error('❌ Error: No target URL specified. Use --url or --env option.');
      process.exit(1);
    }

    // Get token securely
    const token = getToken();
    console.log(`🔑 Using token: ${maskToken(token)}`);

    // If just viewing current config, fetch and exit
    if (options.view) {
      const currentConfig = await fetchCurrentConfig(targetUrl, token);
      if (currentConfig) {
        console.log(JSON.stringify(currentConfig, null, 2));
      }
      process.exit(0);
    }

    // Read config file (unless we're just backing up)
    let config = null;
    if (!options.backup || options.section) {
      console.log(`📂 Reading configuration from ${options.config}...`);
      const configPath = path.resolve(options.config);

      if (!fs.existsSync(configPath)) {
        console.error(`❌ Error: Configuration file not found: ${configPath}`);
        process.exit(1);
      }

      const configData = fs.readFileSync(configPath, 'utf8');

      try {
        config = JSON.parse(configData);
      } catch (error) {
        console.error('❌ Error parsing JSON configuration:', error.message);
        process.exit(1);
      }

      // Update the lastUpdated timestamp
      config.lastUpdated = new Date().toISOString();
      
      // Validate configuration
      if (!validateConfig(config)) {
        console.error('❌ Configuration validation failed');
        process.exit(1);
      }
      
      console.log('✅ Configuration validated successfully');
    }

    // If only backing up, do that and exit
    if (options.backup && !config) {
      await backupCurrentConfig(targetUrl, token);
      process.exit(0);
    }

    // Handle partial updates if section is specified
    if (options.section) {
      const sections = options.section.split(',');
      const currentConfig = await fetchCurrentConfig(targetUrl, token);
      
      if (!currentConfig) {
        console.error('❌ Cannot perform partial update without current configuration');
        process.exit(1);
      }
      
      // Back up before modifications
      if (options.backup) {
        await backupCurrentConfig(targetUrl, token, currentConfig);
      }
      
      const updatedConfig = { ...currentConfig };
      
      sections.forEach(section => {
        if (config[section]) {
          updatedConfig[section] = config[section];
          console.log(`📝 Updating section: ${section}`);
        } else {
          console.warn(`⚠️ Section not found in new config: ${section}`);
        }
      });
      
      // Update timestamp after modifications
      updatedConfig.lastUpdated = new Date().toISOString();
      
      // Show diff for partial updates
      showConfigDiff(currentConfig, updatedConfig);
      
      // Use the updated config
      config = updatedConfig;
    } else if (options.backup) {
      // Back up full configuration before uploading
      const currentConfig = await backupCurrentConfig(targetUrl, token);
      
      // Show differences between current and new configuration
      if (currentConfig) {
        showConfigDiff(currentConfig, config);
      }
    }

    // Show details about the configuration to upload
    const configSize = JSON.stringify(config).length;
    console.log(`📦 Configuration size: ${(configSize / 1024).toFixed(2)} KB`);

    if (options.verbose) {
      console.log('📄 Configuration to upload:');
      console.log(JSON.stringify(config, null, 2));
    }

    // Dry run mode
    if (options.dryRun) {
      console.log('🔍 Dry run mode - configuration validated, not uploading');
      process.exit(0);
    }

    // Upload configuration
    const endpoint = `${targetUrl}/admin/config`;
    console.log(`🚀 Uploading configuration to ${endpoint}...`);

    // Environment confirmation
    let shouldConfirm = false;
    
    if (options.env === 'production' || targetUrl.includes('cdn.erfi.dev')) {
      shouldConfirm = await confirmAction('⚠️  You are uploading to PRODUCTION. Continue?');
    } else if (options.env === 'staging' || targetUrl.includes('staging')) {
      shouldConfirm = await confirmAction('⚠️  You are uploading to STAGING. Continue?');
    }
    
    if (shouldConfirm === false) {
      console.log('Upload canceled by user.');
      process.exit(0);
    }

    // Add timestamp to the config for tracking
    config.uploadTimestamp = new Date().toISOString();
    
    // Perform the upload with timeout handling
    let uploadTimeout;
    const timeoutPromise = new Promise((_, reject) => {
      uploadTimeout = setTimeout(() => {
        reject(new Error('Request timed out after 30 seconds'));
      }, 30000);
    });

    try {
      // Perform the upload with timeout protection
      const responsePromise = fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(config),
      });
      
      // Race between the fetch and the timeout
      const response = await Promise.race([responsePromise, timeoutPromise]);
      
      // Clear the timeout since we got a response
      clearTimeout(uploadTimeout);
      
      // Parse response as JSON, with error handling
      let responseData;
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.error('❌ Failed to parse response as JSON:', jsonError.message);
        console.log('Raw response:', await response.text());
        process.exit(1);
      }

      // Handle response based on status
      if (response.ok) {
        console.log('✅ Configuration uploaded successfully!');
        
        if (responseData.status === 'success') {
          console.log(`🔄 Configuration updated at: ${responseData.timestamp || 'unknown'}`);
          
          if (responseData.message) {
            console.log(`📝 Server message: ${responseData.message}`);
          }
        }
        
        if (options.verbose) {
          console.log('Full response:', JSON.stringify(responseData, null, 2));
        }
        
        console.log('\n💡 Remember to purge cache if needed for changes to take effect immediately');
      } else {
        console.error(`❌ Upload failed with status ${response.status}`);
        
        if (responseData.error) {
          console.error(`Error: ${responseData.error}`);
        }
        
        if (responseData.message) {
          console.error(`Message: ${responseData.message}`);
        }
        
        if (options.verbose) {
          console.error('Full error response:', JSON.stringify(responseData, null, 2));
        }
        
        process.exit(1);
      }
    } catch (fetchError) {
      // Clear the timeout in case of fetch error
      clearTimeout(uploadTimeout);
      
      // Handle specific fetch errors
      if (fetchError.message.includes('timed out')) {
        console.error('❌ Request timed out - server may be busy or unreachable');
      } else if (fetchError.code === 'ECONNREFUSED') {
        console.error(`❌ Connection refused: Could not connect to ${targetUrl}`);
      } else {
        console.error(`❌ Fetch error: ${fetchError.message}`);
      }
      
      process.exit(1);
    }
  } catch (error) {
    // Enhanced error handling
    if (error.code === 'ECONNREFUSED') {
      console.error(`❌ Connection refused: Could not connect to ${options.url || options.env || 'server'}`);
    } else if (error.code === 'ENOTFOUND') {
      console.error(`❌ Host not found: ${options.url || options.env || 'server'}`);
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
}

// Run the main function
main();