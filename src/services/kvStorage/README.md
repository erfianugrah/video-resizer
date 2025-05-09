# KV Storage Service

This directory contains the refactored implementation of the KV Storage Service, which is responsible for storing and retrieving transformed video variants in Cloudflare KV.

## Features

- Standard KV storage for videos under size limit
- Chunked storage for larger videos with data integrity verification
- Range request support for streaming video content
- TTL refresh for frequently accessed content
- Cache versioning for cache invalidation

## Structure

- `constants.ts` - Shared constants used across the KV storage service
- `interfaces.ts` - Type definitions for metadata and chunking manifest
- `keyUtils.ts` - Utilities for generating and manipulating KV keys
- `logging.ts` - Logging utilities for the KV storage service
- `storageHelpers.ts` - Helper functions for storing and retrieving data
- `streamingHelpers.ts` - Functions for handling range requests and chunked video streaming
- `versionHandlers.ts` - Utilities for handling cache versions
- `storeVideo.ts` - Implementation of video storage functionality
- `getVideo.ts` - Implementation of video retrieval functionality
- `listVariants.ts` - Implementation of listing video variants
- `index.ts` - Main export file

## Refactoring Notes

This code was refactored from a monolithic file (`kvStorageService.ts`) to improve maintainability and testability. The functionality remains the same, but the code is now organized into smaller, more focused files.

The refactoring approach involved:
1. Splitting the code into logical modules
2. Creating a clear separation of concerns
3. Maintaining backward compatibility through the index.ts file