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
