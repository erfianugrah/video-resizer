#!/usr/bin/env node

/**
 * Enhanced Configuration Check Tool
 *
 * A tool that validates configuration files against common issues,
 * particularly focusing on checking array fields that are common
 * sources of "Expected array, received object" errors.
 *
 * Usage:
 *   node check-config.js [options]
 *
 * Options:
 *   --config, -c  Path to config file (default: ./config/worker-config.json)
 *   --fix, -f     Fix common issues and write to a new file
 *   --output, -o  Output path for fixed config (only used with --fix)
 *   --help, -h    Show help
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

const program = new Command();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define CLI options
program
  .name('check-config')
  .description('Validate configuration against common schema issues')
  .option('-c, --config <path>', 'Path to configuration file', './config/worker-config.json')
  .option('-f, --fix', 'Fix common issues in the configuration')
  .option('-o, --output <path>', 'Output path for fixed configuration (only used with --fix)')
  .parse(process.argv);

const options = program.opts();
const configPath = path.resolve(options.config);
let outputPath = options.output;

if (options.fix && !outputPath) {
  // Generate default output path by adding "-fixed" before the extension
  const parsedPath = path.parse(configPath);
  outputPath = path.join(parsedPath.dir, `${parsedPath.name}-fixed${parsedPath.ext}`);
}

// Define fields that must be arrays according to the schema
const requiredArrayFields = [
  // Video config arrays
  { path: 'video.pathPatterns', description: 'Path patterns defining URL matching rules' },
  { path: 'video.validOptions.mode', description: 'Valid video mode options' },
  { path: 'video.validOptions.fit', description: 'Valid fit options' },
  { path: 'video.validOptions.format', description: 'Valid format options' },
  { path: 'video.validOptions.audio', description: 'Valid audio options' },
  { path: 'video.validOptions.quality', description: 'Valid quality options' },
  { path: 'video.validOptions.compression', description: 'Valid compression options' },
  { path: 'video.validOptions.preload', description: 'Valid preload options' },
  { path: 'video.validOptions.loop', description: 'Valid loop options' },
  { path: 'video.validOptions.autoplay', description: 'Valid autoplay options' },
  { path: 'video.validOptions.muted', description: 'Valid muted options' },
  { path: 'video.responsive.availableQualities', description: 'Available video quality settings' },
  { path: 'video.storage.priority', description: 'Storage priority order' },
  { path: 'video.passthrough.whitelistedFormats', description: 'Formats allowed for passthrough' },
  
  // Cache config arrays
  { path: 'cache.bypassQueryParameters', description: 'Query parameters that bypass cache' },
  { path: 'cache.mimeTypes.video', description: 'Video MIME types to cache' },
  { path: 'cache.mimeTypes.image', description: 'Image MIME types to cache' },
  { path: 'cache.fallback.preserveHeaders', description: 'Headers to preserve in fallback responses' },
  
  // Debug config arrays
  { path: 'debug.debugHeaders', description: 'Headers that enable debug mode' },
  { path: 'debug.allowedIps', description: 'IPs allowed to use debug features' },
  { path: 'debug.excludedPaths', description: 'Paths excluded from debug features' },
  
  // Logging config arrays
  { path: 'logging.enabledComponents', description: 'Components with logging enabled' },
  { path: 'logging.disabledComponents', description: 'Components with logging disabled' }
];

// Fields that must be present according to schema
const requiredFields = [
  { path: 'version', description: 'Configuration version' },
  { path: 'lastUpdated', description: 'Last updated timestamp' },
  { path: 'video', description: 'Video configuration section' },
  { path: 'video.derivatives', description: 'Video derivative configurations' },
  { path: 'video.validOptions', description: 'Valid video transformation options' },
  { path: 'video.pathPatterns', description: 'URL path patterns for matching' },
  { path: 'cache', description: 'Cache configuration section' },
  { path: 'cache.method', description: 'Cache method (should be "kv")' },
  { path: 'logging', description: 'Logging configuration section' },
  { path: 'debug', description: 'Debug configuration section' }
];

// Main function
async function main() {
  try {
    // Read config file
    console.log(`Reading configuration from ${configPath}...`);
    
    if (!fs.existsSync(configPath)) {
      console.error(`Error: Configuration file not found: ${configPath}`);
      process.exit(1);
    }

    const configData = fs.readFileSync(configPath, 'utf8');
    let config;

    try {
      config = JSON.parse(configData);
      console.log('Successfully parsed JSON configuration\n');
    } catch (error) {
      console.error('Error parsing JSON configuration:', error.message);
      process.exit(1);
    }

    // Dynamically add browser capabilities patterns which should also be arrays
    let browserCapabilityPatterns = [];
    if (config.video && config.video.responsive && config.video.responsive.browserCapabilities) {
      const capabilities = config.video.responsive.browserCapabilities;
      for (const cap in capabilities) {
        browserCapabilityPatterns.push(
          { path: `video.responsive.browserCapabilities.${cap}.patterns`, description: `Browser patterns for ${cap}` }
        );
        if (capabilities[cap].exclusions !== undefined) {
          browserCapabilityPatterns.push(
            { path: `video.responsive.browserCapabilities.${cap}.exclusions`, description: `Browser exclusions for ${cap}` }
          );
        }
      }
    }

    // Check for path pattern capture groups
    let captureGroupFields = [];
    if (config.video && config.video.pathPatterns) {
      const patterns = Array.isArray(config.video.pathPatterns) 
        ? config.video.pathPatterns 
        : Object.values(config.video.pathPatterns);
        
      patterns.forEach((pattern, index) => {
        if (pattern.captureGroups !== undefined) {
          captureGroupFields.push({
            path: `video.pathPatterns.${index}.captureGroups`,
            description: `Capture groups for pattern ${pattern.name || index}`
          });
        }
      });
    }

    // Check for required fields
    console.log('Checking required fields:');
    let missingFields = [];
    
    for (const field of requiredFields) {
      const value = getNestedProperty(config, field.path);
      const status = value !== undefined ? '✅' : '❌';
      console.log(`${status} ${field.path}: ${field.description}`);
      
      if (value === undefined) {
        missingFields.push(field.path);
      }
    }
    
    // Specially check for cache.method which is often missing
    if (config.cache && !config.cache.method) {
      console.log('❌ cache.method: Missing but required (should be "kv")');
      missingFields.push('cache.method');
    }
    
    console.log();

    // Check for array fields
    console.log('Checking array fields:');
    let arrayIssues = [];
    
    // Combine all array fields
    const allArrayFields = [...requiredArrayFields, ...browserCapabilityPatterns, ...captureGroupFields];
    
    for (const field of allArrayFields) {
      const value = getNestedProperty(config, field.path);
      
      if (value === undefined) {
        // Field doesn't exist, skip it (might be optional)
        continue;
      }
      
      const isArray = Array.isArray(value);
      const status = isArray ? '✅' : '❌';
      console.log(`${status} ${field.path}: ${isArray ? 'Is an array' : 'NOT an array (should be)'}`);
      
      if (!isArray && typeof value === 'object') {
        arrayIssues.push(field.path);
      }
    }
    
    // Summary
    console.log('\nConfiguration check summary:');
    
    if (missingFields.length === 0 && arrayIssues.length === 0) {
      console.log('✅ Configuration passes all basic validation checks!');
    } else {
      if (missingFields.length > 0) {
        console.log(`❌ Missing required fields: ${missingFields.join(', ')}`);
      }
      
      if (arrayIssues.length > 0) {
        console.log(`❌ Fields that should be arrays but aren't: ${arrayIssues.join(', ')}`);
      }
      
      console.log('\nThese issues will likely cause validation errors when uploading.');
    }
    
    // Fix the issues if requested
    if (options.fix && (missingFields.length > 0 || arrayIssues.length > 0)) {
      console.log(`\nFixing configuration issues and saving to ${outputPath}...`);
      const fixedConfig = JSON.parse(JSON.stringify(config)); // Deep clone
      
      // Fix missing fields
      if (missingFields.includes('cache.method')) {
        if (!fixedConfig.cache) fixedConfig.cache = {};
        fixedConfig.cache.method = 'kv';
        console.log('✓ Added missing cache.method = "kv"');
      }
      
      // Fix array issues
      for (const fieldPath of arrayIssues) {
        const value = getNestedProperty(fixedConfig, fieldPath);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const fixedArray = objectToArray(value);
          setNestedProperty(fixedConfig, fieldPath, fixedArray);
          console.log(`✓ Fixed ${fieldPath}: Converted object to array with ${fixedArray.length} items`);
        }
      }
      
      // Write the fixed configuration
      fs.writeFileSync(outputPath, JSON.stringify(fixedConfig, null, 2));
      console.log(`\n✅ Fixed configuration written to ${outputPath}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Helper function to get a nested property using a path string
function getNestedProperty(obj, path) {
  return path.split('.').reduce((o, i) => o && o[i] !== undefined ? o[i] : undefined, obj);
}

// Helper function to set a nested property using a path string
function setNestedProperty(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, i) => {
    if (o[i] === undefined) o[i] = {};
    return o[i];
  }, obj);
  
  if (parent) parent[last] = value;
}

// Helper function to convert an object to an array
function objectToArray(obj) {
  // If it's already an array or not an object, return as is
  if (Array.isArray(obj) || typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  // If it's an empty object, return an empty array
  if (Object.keys(obj).length === 0) {
    return [];
  }
  
  // Check if the object is array-like (has all numeric keys or keys that parse to integers)
  const isArrayLike = Object.keys(obj).every(key => {
    const parsed = parseInt(key);
    return !isNaN(parsed) && parsed.toString() === key;
  });
  
  if (isArrayLike) {
    const values = Array(Object.keys(obj).length);
    Object.keys(obj).forEach(key => {
      const index = parseInt(key);
      values[index] = obj[key];
    });
    // Filter out any undefined values (in case keys aren't sequential)
    return values.filter(v => v !== undefined);
  }
  
  // If it has named keys, just return the values as an array
  // This is often what the user intended - an array of values
  return Object.values(obj);
}

// Run the main function
main();