#!/usr/bin/env node

/**
 * Configuration Debug Tool
 *
 * A simple utility to test the configuration API authentication.
 *
 * Usage:
 *   node config-debug.js [options]
 *
 * Options:
 *   --url, -u     Worker URL (default: http://localhost:8787)
 *   --token, -t   Authentication token (required)
 *   --env, -e     Environment (development, staging, production)
 *   --help, -h    Show help
 */

import fetch from 'node-fetch';
import { program } from 'commander';

// Configuration
const ENVIRONMENTS = {
  development: 'https://video-resizer-development.anugrah.workers.dev',
  staging: 'https://staging-video-resizer.workers.dev',
  production: 'https://cdn.erfi.dev',
};

// Define CLI options
program
  .name('config-debug')
  .description('Debug the configuration API authentication')
  .option('-u, --url <url>', 'Worker URL')
  .option('-t, --token <token>', 'Authentication token')
  .option(
    '-e, --env <environment>',
    'Environment (development, staging, production)',
  )
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

    // Try to get the configuration
    const endpoint = `${targetUrl}/admin/config`;
    console.log(`Testing GET request to ${endpoint}...`);

    // Perform the request
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${options.token}`,
      },
    });

    console.log(`Response status: ${response.status}`);
    
    // Try to parse response as JSON
    try {
      const responseText = await response.text();
      console.log('Response body:');
      console.log(responseText.substring(0, 1000) + (responseText.length > 1000 ? '...' : ''));
      
      try {
        const responseData = JSON.parse(responseText);
        if (responseData.error) {
          console.error('Error message:', responseData.error);
        }
      } catch (e) {
        console.log('(Response is not valid JSON)');
      }
    } catch (e) {
      console.error('Error reading response:', e.message);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the main function
main();