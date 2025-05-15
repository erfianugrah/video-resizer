#!/usr/bin/env node

/**
 * Origins Converter Tool
 * 
 * Converts legacy pathPatterns and pathTransforms into the new Origins format
 * 
 * Usage:
 *   node origins-converter.js [options]
 * 
 * Options:
 *   --config, -c       Path to config file (default: ./config/worker-config.json)
 *   --output, -o       Output path for converted config (default: ./config/worker-config-origins.json)
 *   --merge, -m        Merge with existing origins configuration
 *   --help, -h         Show help
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
  .name('origins-converter')
  .description('Convert legacy pathPatterns to Origins format')
  .option('-c, --config <path>', 'Path to configuration file', './config/worker-config.json')
  .option('-o, --output <path>', 'Output path for converted configuration', './config/worker-config-origins.json')
  .option('-m, --merge', 'Merge with existing origins configuration', false)
  .option('-v, --verbose', 'Show verbose output', false)
  .parse(process.argv);

const options = program.opts();
const configPath = path.resolve(options.config);
const outputPath = path.resolve(options.output);

/**
 * Convert a PathPattern to Origin format
 * @param {Object} pathPattern The pathPattern to convert
 * @param {Object} storage The storage configuration
 * @returns {Object} The converted Origin
 */
function convertPathPatternToOrigin(pathPattern, storage) {
  const sources = [];
  const pathName = pathPattern.name || 'default';
  
  // Check if there are pathTransforms for this pattern
  const pathTransforms = storage.pathTransforms && storage.pathTransforms[pathName];
  
  // Add R2 source if enabled
  if (storage.r2 && storage.r2.enabled) {
    const r2Config = {
      type: 'r2',
      priority: 1,
      bucketBinding: storage.r2.bucketBinding || 'VIDEOS_BUCKET',
      path: pathPattern.name === 'default' ? '${request_path}' : undefined
    };
    
    // If we have path transforms for R2, apply them
    if (pathTransforms && pathTransforms.r2) {
      const r2Transform = pathTransforms.r2;
      
      // Handle prefix/removePrefix in the path transform
      if (typeof r2Transform.prefix === 'string') {
        if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
          // Use capture groups if available
          const videoIdParam = pathPattern.captureGroups[0] || 'videoId';
          r2Config.path = r2Transform.prefix + '${' + videoIdParam + '}';
          
          // Add extension if the pattern looks like it's capturing one
          if (pathPattern.matcher && pathPattern.matcher.includes('\\.(')) {
            if (pathPattern.captureGroups.length > 1) {
              const extensionParam = pathPattern.captureGroups[1] || 'extension';
              r2Config.path += '.${' + extensionParam + '}';
            } else {
              r2Config.path += '.mp4'; // Default extension if none specified
            }
          }
        } else {
          // Use original path as fallback
          r2Config.path = r2Transform.prefix + '${request_path}';
        }
      }
    }
    
    // Ensure path is defined
    if (!r2Config.path) {
      if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
        const videoIdParam = pathPattern.captureGroups[0] || 'videoId';
        r2Config.path = '${' + videoIdParam + '}';
        
        // Add extension if the pattern looks like it's capturing one
        if (pathPattern.matcher && pathPattern.matcher.includes('\\.(')) {
          if (pathPattern.captureGroups.length > 1) {
            const extensionParam = pathPattern.captureGroups[1] || 'extension';
            r2Config.path += '.${' + extensionParam + '}';
          } else {
            r2Config.path += '.mp4'; // Default extension if none specified
          }
        }
      } else {
        r2Config.path = '${request_path}';
      }
    }
    
    sources.push(r2Config);
  }
  
  // Add remote source if originUrl is defined
  if (pathPattern.originUrl || storage.remoteUrl) {
    const remoteConfig = {
      type: 'remote',
      priority: sources.length + 1,
      url: pathPattern.originUrl || storage.remoteUrl,
      path: pathPattern.name === 'default' ? '${request_path}' : undefined
    };
    
    // If we have path transforms for remote, apply them
    if (pathTransforms && pathTransforms.remote) {
      const remoteTransform = pathTransforms.remote;
      
      // Handle prefix/removePrefix in the path transform
      if (typeof remoteTransform.prefix === 'string') {
        if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
          // Use capture groups if available
          const videoIdParam = pathPattern.captureGroups[0] || 'videoId';
          remoteConfig.path = remoteTransform.prefix + '${' + videoIdParam + '}';
          
          // Add extension if the pattern looks like it's capturing one
          if (pathPattern.matcher && pathPattern.matcher.includes('\\.(')) {
            if (pathPattern.captureGroups.length > 1) {
              const extensionParam = pathPattern.captureGroups[1] || 'extension';
              remoteConfig.path += '.${' + extensionParam + '}';
            } else {
              remoteConfig.path += '.mp4'; // Default extension if none specified
            }
          }
        } else {
          // Use original path as fallback
          remoteConfig.path = remoteTransform.prefix + '${request_path}';
        }
      }
    }
    
    // Ensure path is defined
    if (!remoteConfig.path) {
      if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
        const videoIdParam = pathPattern.captureGroups[0] || 'videoId';
        remoteConfig.path = '${' + videoIdParam + '}';
        
        // Add extension if the pattern looks like it's capturing one
        if (pathPattern.matcher && pathPattern.matcher.includes('\\.(')) {
          if (pathPattern.captureGroups.length > 1) {
            const extensionParam = pathPattern.captureGroups[1] || 'extension';
            remoteConfig.path += '.${' + extensionParam + '}';
          } else {
            remoteConfig.path += '.mp4'; // Default extension if none specified
          }
        }
      } else {
        remoteConfig.path = '${request_path}';
      }
    }
    
    // Add authentication if specified
    if (storage.remoteAuth && storage.remoteAuth.enabled) {
      remoteConfig.auth = { ...storage.remoteAuth };
    }
    
    sources.push(remoteConfig);
  }
  
  // Add fallback source if fallbackUrl is defined
  if (storage.fallbackUrl) {
    const fallbackConfig = {
      type: 'fallback',
      priority: sources.length + 1,
      url: storage.fallbackUrl,
      path: pathPattern.name === 'default' ? '${request_path}' : undefined
    };
    
    // If we have path transforms for fallback, apply them
    if (pathTransforms && pathTransforms.fallback) {
      const fallbackTransform = pathTransforms.fallback;
      
      // Handle prefix/removePrefix in the path transform
      if (typeof fallbackTransform.prefix === 'string') {
        if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
          // Use capture groups if available
          const videoIdParam = pathPattern.captureGroups[0] || 'videoId';
          fallbackConfig.path = fallbackTransform.prefix + '${' + videoIdParam + '}';
          
          // Add extension if the pattern looks like it's capturing one
          if (pathPattern.matcher && pathPattern.matcher.includes('\\.(')) {
            if (pathPattern.captureGroups.length > 1) {
              const extensionParam = pathPattern.captureGroups[1] || 'extension';
              fallbackConfig.path += '.${' + extensionParam + '}';
            } else {
              fallbackConfig.path += '.mp4'; // Default extension if none specified
            }
          }
        } else {
          // Use original path as fallback
          fallbackConfig.path = fallbackTransform.prefix + '${request_path}';
        }
      }
    }
    
    // Ensure path is defined
    if (!fallbackConfig.path) {
      if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
        const videoIdParam = pathPattern.captureGroups[0] || 'videoId';
        fallbackConfig.path = 'fallback-${' + videoIdParam + '}';
        
        // Add extension if the pattern looks like it's capturing one
        if (pathPattern.matcher && pathPattern.matcher.includes('\\.(')) {
          if (pathPattern.captureGroups.length > 1) {
            const extensionParam = pathPattern.captureGroups[1] || 'extension';
            fallbackConfig.path += '.${' + extensionParam + '}';
          } else {
            fallbackConfig.path += '.mp4'; // Default extension if none specified
          }
        }
      } else {
        fallbackConfig.path = '${request_path}';
      }
    }
    
    // Add fallback authentication if specified
    if (storage.fallbackAuth && storage.fallbackAuth.enabled) {
      fallbackConfig.auth = { ...storage.fallbackAuth };
    }
    
    sources.push(fallbackConfig);
  }
  
  // Create the origin object
  const origin = {
    name: pathPattern.name,
    matcher: pathPattern.matcher,
    sources: sources,
    processPath: pathPattern.processPath !== false, // Default to true if not specified
  };
  
  // Add capture groups if specified
  if (pathPattern.captureGroups && pathPattern.captureGroups.length > 0) {
    origin.captureGroups = [...pathPattern.captureGroups];
  }
  
  // Add TTL if specified
  if (pathPattern.ttl) {
    origin.ttl = { ...pathPattern.ttl };
  }
  
  // Add quality if specified
  if (pathPattern.quality) {
    origin.quality = pathPattern.quality;
  }
  
  // Add cacheability if specified
  if (pathPattern.cacheability !== undefined) {
    origin.cacheability = pathPattern.cacheability;
  }
  
  // Add videoCompression if specified
  if (pathPattern.videoCompression) {
    origin.videoCompression = pathPattern.videoCompression;
  }
  
  return origin;
}

/**
 * Convert from legacy config to Origins format
 * @param {Object} config 
 * @returns {Object} The updated config with Origins
 */
function convertToOrigins(config) {
  // Create a deep copy of the config to avoid modifying the original
  const newConfig = JSON.parse(JSON.stringify(config));
  const origins = [];
  
  // Add origins section to video config
  if (!newConfig.video.origins) {
    newConfig.video.origins = {
      enabled: true,
      useLegacyPathPatterns: true,
      convertPathPatternsToOrigins: true,
      fallbackHandling: {
        enabled: true,
        maxRetries: 2
      }
    };
  }
  
  // Process pathPatterns if they exist
  if (newConfig.video.pathPatterns && Array.isArray(newConfig.video.pathPatterns)) {
    const storage = newConfig.video.storage || {};
    
    // Convert each pathPattern to an Origin
    for (const pathPattern of newConfig.video.pathPatterns) {
      const origin = convertPathPatternToOrigin(pathPattern, storage);
      origins.push(origin);
    }
  }
  
  // Add the origins to the config
  newConfig.origins = origins;
  
  return newConfig;
}

/**
 * Merge existing origins with newly converted ones
 * @param {Array} existing Existing origins
 * @param {Array} converted Newly converted origins
 * @returns {Array} Merged origins
 */
function mergeOrigins(existing, converted) {
  const result = [...existing];
  const existingNames = new Set(existing.map(o => o.name));
  
  // Add converted origins that don't exist in the existing ones
  for (const origin of converted) {
    if (!existingNames.has(origin.name)) {
      result.push(origin);
    }
  }
  
  return result;
}

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
    
    // Check if output file exists and contains origins
    let outputConfig = config;
    let existingOrigins = [];
    
    if (options.merge && fs.existsSync(outputPath)) {
      try {
        const outputData = fs.readFileSync(outputPath, 'utf8');
        const parsedOutput = JSON.parse(outputData);
        
        if (parsedOutput.origins && Array.isArray(parsedOutput.origins)) {
          existingOrigins = parsedOutput.origins;
          console.log(`Found ${existingOrigins.length} existing origins in output file`);
        }
        
        // Use the output file as the base
        outputConfig = parsedOutput;
      } catch (error) {
        console.warn(`Warning: Could not parse output file for merging: ${error.message}`);
      }
    }
    
    // Convert to Origins format
    console.log('Converting pathPatterns to Origins format...');
    const convertedConfig = convertToOrigins(config);
    const convertedOrigins = convertedConfig.origins || [];
    
    console.log(`Converted ${convertedOrigins.length} pathPatterns to Origins format`);
    
    // Merge with existing origins if requested
    if (options.merge && existingOrigins.length > 0) {
      console.log('Merging with existing origins...');
      convertedConfig.origins = mergeOrigins(existingOrigins, convertedOrigins);
      console.log(`Final configuration has ${convertedConfig.origins.length} origins`);
    }
    
    // Update the base config if merging
    if (options.merge) {
      outputConfig = {
        ...outputConfig,
        ...convertedConfig,
        video: {
          ...outputConfig.video,
          ...convertedConfig.video
        }
      };
    } else {
      outputConfig = convertedConfig;
    }
    
    // Update lastUpdated timestamp
    outputConfig.lastUpdated = new Date().toISOString();
    
    // Write the output file
    console.log(`Writing converted configuration to ${outputPath}...`);
    fs.writeFileSync(outputPath, JSON.stringify(outputConfig, null, 2));
    
    console.log(`\n✅ Configuration converted and written to ${outputPath}`);
    
    // If verbose, show the converted Origins
    if (options.verbose) {
      console.log('\nConverted Origins:');
      console.log(JSON.stringify(outputConfig.origins, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the main function
main();