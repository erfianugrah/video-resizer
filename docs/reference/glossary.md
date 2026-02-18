# Video Resizer Glossary

_Last Updated: February 18, 2026_

This glossary provides standardized definitions for terms used throughout the Video Resizer documentation to ensure consistency in terminology.

## Table of Contents

- [Architectural Concepts](#architectural-concepts)
- [Configuration Terms](#configuration-terms)
- [Transformation Modes](#transformation-modes)
- [Video Parameters](#video-parameters)
- [Caching Terminology](#caching-terminology)
- [Integration Features](#integration-features)
- [Debugging Terms](#debugging-terms)
- [Security Terms](#security-terms)

## Architectural Concepts

| Term                      | Definition                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Video Resizer**         | Cloudflare Worker application that transforms video URLs to use Cloudflare's Media Transformation capabilities               |
| **Strategy Pattern**      | Design pattern used to implement different transformation modes (video, frame, spritesheet, audio) with polymorphic behavior |
| **Command Pattern**       | Design pattern used to encapsulate video transformation operations as discrete commands                                      |
| **Dependency Injection**  | Pattern where a service's dependencies are provided from external sources rather than created internally                     |
| **Service**               | Class responsible for a specific domain of functionality such as transformation, caching, or configuration                   |
| **Handler**               | Function that processes incoming requests and orchestrates service interactions                                              |
| **Domain-Driven Design**  | Design approach focused on modeling based on the domain's logic and concepts                                                 |
| **Configuration Manager** | Singleton class responsible for managing a specific area of configuration                                                    |

## Configuration Terms

| Term                          | Definition                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| **Path Pattern**              | Regular expression pattern used to match URLs for transformation processing                   |
| **Capture Group**             | Named group in a path pattern regex used to extract parameters from URLs                      |
| **Environment Configuration** | Configuration specific to an environment (development, staging, production)                   |
| **Dynamic Configuration**     | Configuration stored in KV that can be updated without redeploying the worker                 |
| **Static Configuration**      | Configuration defined in wrangler.jsonc that requires redeployment to update                  |
| **Unified Origins**           | Configuration approach that consolidates multiple content origins into a single configuration |
| **Parameter Mapping**         | Configuration that maps URL parameters to transformation options                              |
| **Wrangler**                  | CLI tool for developing and deploying Cloudflare Workers                                      |

## Transformation Modes

| Term                        | Definition                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| **Video Mode**              | Transformation mode that processes complete videos, preserving motion and audio             |
| **Frame Mode**              | Transformation mode that extracts a single still image from a specific timestamp in a video |
| **Spritesheet Mode**        | Transformation mode that generates a grid of thumbnails showing progression through a video |
| **Audio Mode**              | Transformation mode that extracts AAC/M4A audio from a video source                         |
| **Derivative**              | Predefined set of transformation parameters optimized for a specific use case               |
| **Quality Preset**          | Predefined combination of video quality settings (low, medium, high)                        |
| **Format**                  | Output video format (mp4, webm) or image format for extracted frames (jpg, png, webp)       |
| **Fit Mode**                | How video content fits within specified dimensions (contain, cover, crop, scale-down, pad)  |
| **Transformation Strategy** | Implementation of a specific transformation approach (video, frame, spritesheet, audio)     |

## Video Parameters

| Term            | Definition                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------- |
| **width**       | Parameter that specifies the width in pixels of the output video or image                   |
| **height**      | Parameter that specifies the height in pixels of the output video or image                  |
| **fit**         | Parameter that controls how the video fits within specified dimensions                      |
| **quality**     | Parameter that controls the quality/compression level of the output                         |
| **compression** | Parameter that controls the video compression level (low, medium, high, auto)               |
| **format**      | Parameter that specifies the output format (mp4, webm for video; jpg, png, webp for frames) |
| **time**        | Parameter that specifies the timestamp for frame extraction (e.g., "30s")                   |
| **duration**    | Parameter that specifies the length of video to include in a spritesheet or clip            |
| **loop**        | Parameter that controls whether video should loop during playback                           |
| **autoplay**    | Parameter that controls whether video should automatically start playing                    |
| **muted**       | Parameter that controls whether video audio should be muted                                 |
| **preload**     | Parameter that controls how video should be preloaded (none, metadata, auto)                |

## Caching Terminology

| Term                 | Definition                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| **KV Cache**         | Cloudflare Key-Value storage used for caching transformed content globally                        |
| **Cache API**        | Cloudflare's Cache API for storing responses in edge caches                                       |
| **TTL**              | Time-to-live duration controlling how long content remains in cache                               |
| **Cache Versioning** | System for managing different versions of cached content, enabling controlled invalidation        |
| **Cache Key**        | Unique identifier for cached content, typically based on source URL and transformation parameters |
| **Range Request**    | HTTP request that specifies a byte range of content, used for video seeking and streaming         |
| **Cache Tag**        | Label attached to cached content enabling grouped invalidation of related items                   |
| **Cache Strategy**   | Approach for determining what and how to cache different types of content                         |
| **Origin Pull**      | Process of fetching content from the origin server when not in cache                              |

## Integration Features

| Term                     | Definition                                                                      |
| ------------------------ | ------------------------------------------------------------------------------- |
| **IMQuery**              | Responsive image query system for dimension-based transformations               |
| **Client Hints**         | HTTP headers that provide client device information used for adaptive responses |
| **Breakpoint**           | Screen width threshold used for responsive design decisions                     |
| **Derivative Mapping**   | System that maps responsive dimensions to predefined video derivatives          |
| **Responsive Width**     | Width calculation based on device characteristics and viewport dimensions       |
| **Akamai Compatibility** | Translation of Akamai-style parameters to Cloudflare format                     |
| **Presigned URL**        | Security feature providing time-limited, signature-validated access to content  |
| **S3 Authentication**    | Authentication method for accessing content in S3-compatible storage            |

## Debugging Terms

| Term                      | Definition                                                                 |
| ------------------------- | -------------------------------------------------------------------------- |
| **Debug Mode**            | Feature that enables detailed debugging information in responses           |
| **Debug UI**              | Web interface for viewing detailed transformation and request diagnostics  |
| **Debug Headers**         | HTTP headers containing debugging information about request processing     |
| **Debug View Mode**       | Mode that renders debugging information in an HTML interface               |
| **Diagnostics**           | Information collected to help troubleshoot issues in request processing    |
| **Performance Metrics**   | Measurements of processing time and resource usage during request handling |
| **Breadcrumb Trail**      | Sequential tracking of request processing events for debugging             |
| **Debug Query Parameter** | URL parameter (typically `debug=view`) that enables debugging features     |

## Security Terms

| Term                      | Definition                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------- |
| **Origin Authentication** | Method for authenticating requests to origin storage services                      |
| **Presigned URL**         | URL with a time-limited signature allowing temporary access to content             |
| **SigV4 Signing**         | AWS Signature Version 4 algorithm used for authenticating requests to AWS services |
| **Token**                 | Authentication token used for securing API access                                  |
| **API Key**               | Secret key used to authenticate with services                                      |
| **Expiration Time**       | Timestamp after which a presigned URL or token becomes invalid                     |
| **CORS**                  | Cross-Origin Resource Sharing, controls which origins can access content           |
| **Referer Checking**      | Security feature that validates the referring site making a request                |

## Error Handling Terms

| Term                    | Definition                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CfErrorCode**         | Enum defining known Cloudflare Media Transformation error codes (9401–9523), used to classify transformation failures from the `Cf-Resized` response header |
| **CF_ERROR_MAP**        | Mapping of CfErrorCode values to human-readable descriptions, HTTP status codes, and retryability flags                                                     |
| **cleanupStoredChunks** | Function in `storeVideo.ts` that deletes successfully uploaded KV chunks when a chunked storage operation fails partway through                             |
| **clearCurrentContext** | Function called in the request lifecycle's `finally` block to prevent request context from leaking between requests                                         |
