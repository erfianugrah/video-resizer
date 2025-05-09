# Video Storage Service

This directory contains the refactored implementation of the Video Storage Service, which is responsible for retrieving videos from different storage sources including R2 buckets, remote URLs, and fallback URLs.

## Features

- Multi-source video fetching with priority ordering
- Support for AWS S3 authentication
- Presigned URL generation and caching
- Path transformation for different storage backends
- Cache tag generation for efficient cache invalidation
- Range request support for streaming video content

## Structure

- `interfaces.ts` - Type definitions for all the service components
- `logging.ts` - Logging utilities for consistent logging
- `pathTransform.ts` - Utilities for transforming paths for different storage backends
- `r2Storage.ts` - R2 bucket integration for video storage
- `remoteStorage.ts` - Remote URL integration with authentication support
- `fallbackStorage.ts` - Fallback URL integration with authentication support
- `fetchVideo.ts` - Main orchestration logic for fetching videos
- `cacheBypass.ts` - Utilities for determining when to bypass cache
- `cacheTags.ts` - Cache tag generation for efficient invalidation

## Refactoring Notes

This code was refactored from a monolithic file (`videoStorageService.ts`) to improve maintainability and testability. The functionality remains the same, but the code is now organized into smaller, more focused files.

The refactoring approach involved:
1. Extracting common interfaces to a central location
2. Splitting the code by storage backend and functionality
3. Clearly separating core functionality from helper functions
4. Maintaining backward compatibility through the main export file