# Video Resizer Documentation Glossary

This document provides a standardized glossary of terms used throughout the Video Resizer documentation to ensure consistency in terminology.

## Core Concepts

| Term | Definition |
|------|------------|
| **Video Resizer** | Cloudflare Worker application that transforms video URLs to use Cloudflare's Media Transformation capabilities |
| **Transformation Mode** | The type of media transformation to perform (video, frame, or spritesheet) |
| **Origin** | Source location where original video content is stored |
| **Unified Origins** | Configuration approach that consolidates multiple content origins into a single configuration |
| **Strategy Pattern** | Design pattern used to implement different transformation modes |
| **Command Pattern** | Design pattern used to encapsulate video transformation operations |

## Configuration Terms

| Term | Definition |
|------|------------|
| **Configuration Manager** | Singleton class responsible for managing a specific area of configuration |
| **Dynamic Configuration** | Configuration stored in KV that can be updated without redeployment |
| **Static Configuration** | Configuration defined in wrangler.jsonc that requires redeployment to update |
| **Environment Configuration** | Configuration specific to an environment (development, staging, production) |
| **Path Pattern** | Regular expression pattern used to match URLs for transformation |
| **Path Capture Group** | Named capture group in a path pattern used to extract parameters |
| **Parameter Mapping** | Configuration that maps URL parameters to transformation options |

## Video Transformation Terms

| Term | Definition |
|------|------------|
| **Video Mode** | Transformation mode that processes complete videos |
| **Frame Mode** | Transformation mode that extracts a single frame from a video |
| **Spritesheet Mode** | Transformation mode that generates a spritesheet from video frames |
| **Quality Preset** | Predefined combination of video quality settings (low, medium, high) |
| **Format** | Output video format (mp4, webm) |
| **Fit Mode** | How video content fits within dimensions (contain, cover, crop, scale-down, pad) |
| **Derivative** | A specific variant of a video with unique transformation parameters |

## Caching Terms

| Term | Definition |
|------|------------|
| **KV Cache** | Cloudflare Key-Value storage used for caching transformed content |
| **Cache API** | Cloudflare's Cache API for storing responses |
| **Cache TTL** | Time-to-live duration for cached content |
| **Cache Versioning** | System for managing different versions of cached content |
| **Cache Namespace** | KV namespace used for storing cached content |
| **Cache Key** | Unique identifier for cached content |
| **Cache Strategy** | Approach for determining what and how to cache content |

## Debug Terms

| Term | Definition |
|------|------------|
| **Debug Mode** | Feature that enables detailed debugging information |
| **Debug UI** | Web interface for viewing debugging information |
| **Debug Headers** | HTTP headers containing debugging information |
| **Debug View Mode** | Mode that renders debugging information in an HTML interface |
| **Diagnostics** | Information collected to help troubleshoot issues |

## Tool-Related Terms

| Term | Definition |
|------|------------|
| **Configuration Upload Tool** | Tool for uploading dynamic configuration to KV storage |
| **Configuration Debug Tool** | Tool for testing configuration API connectivity |
| **Configuration Check Tool** | Tool for validating configuration files locally |
| **Token** | Authentication token used for configuration API access |
| **Configuration API** | API for managing dynamic configuration |

## Architectural Terms

| Term | Definition |
|------|------------|
| **Service** | Class responsible for a specific domain of functionality |
| **Handler** | Function that processes incoming requests |
| **Command** | Class that encapsulates a specific operation |
| **Strategy** | Implementation of a specific transformation approach |
| **Factory** | Class responsible for creating appropriate objects |
| **Dependency Injection** | Design pattern for providing dependencies to classes |
| **Domain-Driven Design** | Architectural approach focused on the core domain |

## URL Parameters

| Term | Definition |
|------|------------|
| **width** | Parameter that specifies the width of the output video |
| **height** | Parameter that specifies the height of the output video |
| **fit** | Parameter that controls how the video fits within dimensions |
| **quality** | Parameter that controls the quality/compression of the output |
| **format** | Parameter that specifies the output video format |
| **time** | Parameter that specifies the timestamp for frame extraction |
| **count** | Parameter that specifies the number of frames for spritesheet |
| **loop** | Parameter that controls whether video should loop |
| **autoplay** | Parameter that controls whether video should autoplay |
| **muted** | Parameter that controls whether video should be muted |
| **preload** | Parameter that controls how video should be preloaded |

## IMQuery Terms

| Term | Definition |
|------|------------|
| **IMQuery** | Responsive image query system for dimension-based transformations |
| **Breakpoint** | Screen width threshold for responsive behavior |
| **Derivative Mapping** | Mapping between breakpoints and video derivatives |
| **Responsive Width** | Width calculation based on device characteristics |
| **Client Hints** | HTTP headers that provide client device information |

This glossary should be referenced when creating or updating documentation to ensure consistent terminology throughout the project.