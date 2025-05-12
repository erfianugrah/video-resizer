#!/usr/bin/env node

/**
 * Configuration Management Wrapper
 * 
 * A comprehensive wrapper script that provides a unified interface for
 * config validation, fixing, and uploading with sensible defaults
 * 
 * Usage:
 *   node config-wrapper.js [command] [options]
 * 
 * Commands:
 *   check    - Check a configuration file
 *   fix      - Fix and save a configuration file
 *   upload   - Upload a configuration file
 *   validate - Validate without uploading (dry run)
 * 
 * Common Options:
 *   -c, --config <file>   - Configuration file path
 *   -o, --output <file>   - Output file path (for 'fix' command)
 *   --env <environment>   - Environment (for 'upload' command)
 *   -t, --token <token>   - Auth token (for 'upload' command)
 *   -v, --verbose         - Verbose output
 *   -h, --help            - Show help
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Command line arguments
const args = process.argv.slice(2);

// Show help if no command provided
if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
  showHelp();
  process.exit(0);
}

// Get the command (first argument)
const command = args[0];

// Remove the command from args
const commandArgs = args.slice(1);

// Execute appropriate command
try {
  switch (command) {
    case 'check':
      checkConfig(commandArgs);
      break;
    case 'fix':
      fixConfig(commandArgs);
      break;
    case 'upload':
      uploadConfig(commandArgs);
      break;
    case 'validate':
      validateConfig(commandArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Configuration Management Tool

Usage:
  node config-wrapper.js [command] [options]

Commands:
  check    - Check a configuration file
  fix      - Fix and save a configuration file
  upload   - Upload a configuration file
  validate - Validate without uploading (dry run)

Common Options:
  -c, --config <file>   - Configuration file path
  -o, --output <file>   - Output file path (for 'fix' command)
  --env <environment>   - Environment (for 'upload' command)
  -t, --token <token>   - Auth token (for 'upload' command)
  -v, --verbose         - Verbose output
  -h, --help            - Show help for a specific command

Examples:
  node config-wrapper.js check -c config/worker-config.json
  node config-wrapper.js fix -c config/my-config.json -o config/fixed-config.json
  node config-wrapper.js upload -c config/worker-config.json --env production -t YOUR_TOKEN
  node config-wrapper.js validate -c config/worker-config.json
  `);
}

/**
 * Check a configuration file
 */
function checkConfig(args) {
  const scriptPath = path.join(__dirname, 'check-config.js');
  executeCommand(scriptPath, args);
}

/**
 * Fix a configuration file
 */
function fixConfig(args) {
  const scriptPath = path.join(__dirname, 'check-config.js');
  
  // Add --fix flag if not already present
  if (!args.includes('--fix')) {
    args.unshift('--fix');
  }
  
  executeCommand(scriptPath, args);
}

/**
 * Upload a configuration file
 */
function uploadConfig(args) {
  const scriptPath = path.join(__dirname, 'config-upload.js');
  executeCommand(scriptPath, args);
}

/**
 * Validate a configuration file without uploading
 */
function validateConfig(args) {
  const scriptPath = path.join(__dirname, 'config-upload.js');
  
  // Add --dry-run flag if not already present
  if (!args.includes('--dry-run')) {
    args.unshift('--dry-run');
  }
  
  executeCommand(scriptPath, args);
}

/**
 * Execute a command with the given arguments
 */
function executeCommand(scriptPath, args) {
  // Ensure the script exists
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }
  
  // Create a child process with all arguments
  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit' // Inherit stdio to see output in real-time
  });

  // Handle process exit
  child.on('close', (code) => {
    process.exit(code);
  });

  // Handle errors
  child.on('error', (err) => {
    console.error(`Error executing script: ${err.message}`);
    process.exit(1);
  });
}