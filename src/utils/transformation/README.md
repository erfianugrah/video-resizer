# Transformation Utilities

This directory contains the implementation of the Transformation Utilities, which was refactored from a single monolithic file into smaller, more focused modules.

## Directory Structure

- `parameterMapping.ts` - Functions for translating parameters between different CDN formats
- `timeUtils.ts` - Functions for parsing, formatting, and validating time and duration values
- `formatValidation.ts` - Functions for validating media formats, quality, and compression
- `limits.ts` - Functions for storing and retrieving transformation limits
- `errorHandling.ts` - Functions for parsing error messages and handling specific errors
- `playbackOptions.ts` - Functions related to playback options
- `index.ts` - Re-exports all functionality to maintain backward compatibility

## Functionality

The Transformation Utilities are responsible for:

1. Translating parameters between different CDN formats (e.g., Akamai to Cloudflare)
2. Validating and formatting time values for video transformations
3. Checking and enforcing limits on transformation parameters
4. Validating media formats and compression settings
5. Handling errors from transformation services
6. Managing playback options for video transformations