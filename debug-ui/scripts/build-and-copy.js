#!/usr/bin/env node

/**
 * This script builds the debug UI and copies the output to the Worker's public directory.
 * It also injects a placeholder for the diagnostic data in the debug.html file.
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const workerPublicDir = path.resolve(rootDir, '../public');

/**
 * Run a shell command and return the output as a promise
 */
function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command}`);
    exec(command, { ...options, cwd: rootDir }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        console.error(`Stderr: ${stderr}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.warn(`Command stderr: ${stderr}`);
      }
      resolve(stdout);
    });
  });
}

/**
 * Copy a directory recursively
 */
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Clean up old assets first
    console.log('Cleaning up old assets...');
    // Clean debug-ui dist directory
    await runCommand('npm run clean');
    
    // Clean worker public assets directory (only CSS and JS files)
    console.log('Cleaning worker public assets directory...');
    try {
      const assetsDir = path.join(workerPublicDir, 'assets');
      if (await fs.stat(assetsDir).catch(() => false)) {
        const files = await fs.readdir(assetsDir);
        for (const file of files) {
          // Only remove JS and CSS files as they are regenerated with new hashes
          if (file.endsWith('.js') || file.endsWith('.css')) {
            await fs.unlink(path.join(assetsDir, file));
          }
        }
      }
    } catch (err) {
      console.warn('Error cleaning worker public assets:', err);
    }
    
    // Build the debug UI
    console.log('Building the debug UI...');
    await runCommand('npm run build');
    
    // Copy the build output to the worker's public directory
    console.log('Copying build output to worker public directory...');
    await copyDir(distDir, workerPublicDir);
    
    // Check if we have debug.html directly in the dist directory
    const debugHtmlDistPath = path.join(distDir, 'debug.html');
    const debugHtmlWorkerPath = path.join(workerPublicDir, 'debug.html');
    
    try {
      // First check if debug.html already exists in the distribution
      if (await fs.stat(debugHtmlDistPath).catch(() => false)) {
        // If it exists, just copy it directly
        await fs.copyFile(debugHtmlDistPath, debugHtmlWorkerPath);
        console.log('Copied debug.html from dist to worker public directory');
      } else {
        // Check if we have debug/index.html instead
        const debugIndexPath = path.join(distDir, 'debug', 'index.html');
        if (await fs.stat(debugIndexPath).catch(() => false)) {
          const debugHtml = await fs.readFile(debugIndexPath, 'utf8');
          await fs.writeFile(debugHtmlWorkerPath, debugHtml);
          console.log('Created debug.html from debug/index.html');
        } else {
          console.error('Could not find debug.html or debug/index.html in the build output');
        }
      }
    } catch (err) {
      console.error('Failed to copy debug.html:', err);
    }
    
    console.log('Successfully built and copied debug UI to worker public directory');
  } catch (error) {
    console.error('Build and copy failed:', error);
    process.exit(1);
  }
}

main();