#!/usr/bin/env node

/**
 * Configuration Check Tool
 *
 * A simple utility to validate the configuration JSON without uploading.
 *
 * Usage:
 *   node check-config.js [options]
 *
 * Options:
 *   --config, -c  Path to config file (default: ./config/worker-config.json)
 *   --help, -h    Show help
 */

import fs from 'fs';
import path from 'path';
import { program } from 'commander';

// Configuration
const CONFIG_PATH = './config/worker-config.json';

// Define CLI options
program
  .name('check-config')
  .description('Validate configuration JSON')
  .option('-c, --config <path>', 'Path to configuration file', CONFIG_PATH)
  .parse(process.argv);

const options = program.opts();

// Main function
async function main() {
  try {
    // Read config file
    console.log(`Reading configuration from ${options.config}...`);
    const configPath = path.resolve(options.config);

    if (!fs.existsSync(configPath)) {
      console.error(`Error: Configuration file not found: ${configPath}`);
      process.exit(1);
    }

    const configData = fs.readFileSync(configPath, 'utf8');
    let config;

    try {
      config = JSON.parse(configData);
      console.log('Successfully parsed JSON configuration');
      
      // Check for required fields
      console.log('\nValidating configuration structure...');
      console.log(`- version: ${config.version ? 'present' : 'missing'}`);
      console.log(`- lastUpdated: ${config.lastUpdated ? 'present' : 'missing'}`);
      console.log(`- video: ${config.video ? 'present' : 'missing'}`);
      if (config.video) {
        console.log(`  - derivatives: ${config.video.derivatives ? 'present' : 'missing'}`);
        console.log(`  - passthrough: ${config.video.passthrough ? 'present' : 'missing'}`);
        console.log(`  - pathPatterns: ${config.video.pathPatterns ? `${config.video.pathPatterns.length} patterns` : 'missing'}`);
      }
      console.log(`- cache: ${config.cache ? 'present' : 'missing'}`);
      if (config.cache) {
        console.log(`  - method: ${config.cache.method || 'missing'}`);
        console.log(`  - enableKVCache: ${config.cache.enableKVCache !== undefined ? config.cache.enableKVCache : 'not set (will default to true)'}`);
        console.log(`  - cacheTagPrefix: ${config.cache.cacheTagPrefix || 'missing'}`);
      }
      console.log(`- debug: ${config.debug ? 'present' : 'missing'}`);
      console.log(`- logging: ${config.logging ? 'present' : 'missing'}`);
      console.log(`- storage: ${config.storage ? 'present' : 'missing'}`);
      
      console.log('\nConfiguration JSON is valid!');
    } catch (error) {
      console.error('Error parsing JSON configuration:', error.message);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the main function
main();