#!/usr/bin/env node

/**
 * Fix Configuration Script
 * 
 * This script fixes the configuration by adding missing 'pattern' properties to the pathPatterns.
 */

const fs = require('fs');
const path = require('path');

// Path to the configuration file
const CONFIG_PATH = path.resolve('./config/worker-config.json');

// Read config file
console.log(`Reading configuration from ${CONFIG_PATH}...`);
let config;

try {
  const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
  config = JSON.parse(configData);
} catch (error) {
  console.error(`Error reading or parsing config file: ${error.message}`);
  process.exit(1);
}

// Check if the video and pathPatterns properties exist
if (!config.video || !config.video.pathPatterns) {
  console.error('Configuration is missing video.pathPatterns property');
  process.exit(1);
}

// Now we need to understand the actual schema requirements. Looking at the code,
// the issue is likely that our validator is checking for 'pattern' but the schema
// doesn't define it.

// The simplest way to address this is to rename 'matcher' to 'pattern'
// in each of the path patterns
let patternsUpdated = 0;
for (const pattern of config.video.pathPatterns) {
  // If pattern doesn't have 'pattern' property but has 'matcher', 
  // add 'pattern' with matcher's value
  if (!pattern.pattern && pattern.matcher) {
    pattern.pattern = pattern.matcher;
    patternsUpdated++;
    console.log(`Added pattern '${pattern.pattern}' to '${pattern.name}'`);
  }
}

console.log(`Updated ${patternsUpdated} path patterns`);

// Write the updated config back to the file
try {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, '\t'));
  console.log(`Updated configuration saved to ${CONFIG_PATH}`);
} catch (error) {
  console.error(`Error writing config file: ${error.message}`);
  process.exit(1);
}

console.log('Configuration fix completed successfully!');