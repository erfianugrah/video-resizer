# Logging System

This directory contains documentation for the logging system in Video Resizer.

## What is the Logging System?

The logging system provides comprehensive visibility into the operation of Video Resizer, enabling debugging, performance monitoring, and operational insights. It uses a structured logging approach with configurable log levels and output formats.

## Documentation

- [Logging Configuration](./logging-configuration.md)
- [Logging Refactor](./LOGGING-REFACTOR.md)
- [Logging System](./LOGGING.md)

## Implementation Details

The logging system includes:
- Structured JSON logging with Pino
- Contextual logging with request IDs
- Configurable log levels (debug, info, warn, error)
- Performance timing and metrics
- Integration with Cloudflare Workers logging
- Support for additional log sinks like Workers Analytics Engine
- Debug mode with enhanced logging detail
- Request/response logging with sensitive data filtering