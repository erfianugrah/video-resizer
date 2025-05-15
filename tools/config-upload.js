#!/usr/bin/env node

/**
 * Configuration Upload Tool
 *
 * A simple utility to upload configuration to the video-resizer worker.
 *
 * Usage:
 *   node config-upload.js [options]
 *
 * Options:
 *   --url, -u     Worker URL (default: http://localhost:8787)
 *   --config, -c  Path to config file (default: ./config/worker-config.json)
 *   --token, -t   Authentication token (required)
 *   --env, -e     Environment (development, staging, production)
 *   --help, -h    Show help
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
  .option(
    '-e, --env <environment>',
    'Environment (development, staging, production)',
  )
  .option('--dry-run', 'Validate configuration without uploading')
  .option('-v, --verbose', 'Verbose output')
  .parse(process.argv);

const options = program.opts();

// Main function
async function main() {
  try {
    // Determine URL based on environment or direct URL
    let targetUrl = options.url;
    if (options.env && ENVIRONMENTS[options.env]) {
      targetUrl = ENVIRONMENTS[options.env];
      console.log(`Using ${options.env} environment URL: ${targetUrl}`);
    }

    if (!targetUrl) {
      console.error(
        'Error: No target URL specified. Use --url or --env option.',
      );
      process.exit(1);
    }

    // Validate token
    if (!options.token) {
      console.error(
        'Error: Authentication token is required. Use --token option.',
      );
      process.exit(1);
    }

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
    } catch (error) {
      console.error('Error parsing JSON configuration:', error.message);
      process.exit(1);
    }

    // Update the lastUpdated timestamp
    config.lastUpdated = new Date().toISOString();

    if (options.verbose) {
      console.log('Configuration to upload:');
      console.log(JSON.stringify(config, null, 2));
    }

    // Dry run mode
    if (options.dryRun) {
      console.log('Dry run mode - configuration validated, not uploading');
      process.exit(0);
    }

    // Upload configuration
    const endpoint = `${targetUrl}/admin/config`;
    console.log(`Uploading configuration to ${endpoint}...`);

    // Production confirmation
    if (
      options.env === 'production' || targetUrl.includes('production') ||
      targetUrl.includes('.workers.dev')
    ) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      await new Promise((resolve) => {
        rl.question(
          '⚠️  You are uploading to PRODUCTION. Continue? (y/N): ',
          (answer) => {
            rl.close();
            if (
              answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes'
            ) {
              console.log('Upload canceled.');
              process.exit(0);
            }
            resolve();
          },
        );
      });
    }

    // Validate Origins configuration if present
    if (config.origins) {
      console.log('Validating Origins configuration...');
      
      // Check if it's an array
      if (!Array.isArray(config.origins)) {
        console.error('❌ Origins configuration must be an array.');
        process.exit(1);
      }
      
      // Check each origin for required properties
      for (const origin of config.origins) {
        if (!origin.name) {
          console.error(`❌ Origin missing required name property.`);
          process.exit(1);
        }
        
        if (!origin.matcher) {
          console.error(`❌ Origin '${origin.name}' missing required matcher property.`);
          process.exit(1);
        }
        
        if (!origin.sources || !Array.isArray(origin.sources) || origin.sources.length === 0) {
          console.error(`❌ Origin '${origin.name}' has missing or empty sources array.`);
          process.exit(1);
        }
        
        // Check each source for required properties
        for (const source of origin.sources) {
          if (!source.type) {
            console.error(`❌ Source in origin '${origin.name}' missing required type property.`);
            process.exit(1);
          }
          
          if (!['r2', 'remote', 'fallback'].includes(source.type)) {
            console.error(`❌ Source in origin '${origin.name}' has invalid type: ${source.type}`);
            process.exit(1);
          }
          
          if (source.type === 'r2' && !source.bucketBinding) {
            console.error(`❌ R2 source in origin '${origin.name}' missing required bucketBinding property.`);
            process.exit(1);
          }
          
          if ((source.type === 'remote' || source.type === 'fallback') && !source.url) {
            console.error(`❌ ${source.type} source in origin '${origin.name}' missing required url property.`);
            process.exit(1);
          }
          
          if (!source.path) {
            console.error(`❌ Source in origin '${origin.name}' missing required path property.`);
            process.exit(1);
          }
        }
      }
      
      console.log('✅ Origins configuration is valid.');
    } else if (!config.video.pathPatterns) {
      console.warn('⚠️ Warning: No Origins or pathPatterns found in configuration.');
    }
    
    // Perform the upload
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.token}`,
      },
      body: JSON.stringify(config),
    });

    // Handle response
    const responseData = await response.json();

    if (response.ok) {
      console.log('✅ Configuration uploaded successfully!');
      if (options.verbose) {
        console.log('Response:', responseData);
      }
    } else {
      console.error(`❌ Upload failed with status ${response.status}`);
      console.error('Error:', responseData);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the main function
main();
