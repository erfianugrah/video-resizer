# Video Resizer Architecture

*Last Updated: May 15, 2025*

This section provides comprehensive documentation on the Video Resizer architecture, including system design, components, patterns, and evolution.

## Core Architecture Documents

- [Architecture Overview](./architecture-overview.md) - Comprehensive system design overview
- [Design Patterns](./design-patterns.md) - Strategy, Command, and other patterns used
- [Service Separation](./service-separation.md) - Modular service architecture
- [Origins System](./origins-system.md) - Origins-based configuration architecture
- [Origins Migration](./origins-migration.md) - Migration from legacy to Origins system
- [Multi-Origin Fallback](./multi-origin-fallback.md) - Consolidated failover architecture
- [Dependency Management](./dependency-management.md) - Dependency injection approach
- [Architecture Roadmap](./roadmap.md) - Future architecture plans

## System Architecture

The Video Resizer follows a modern, service-oriented architecture with clearly defined layers and responsibilities:

1. **Configuration Layer**: Manages settings with type safety and validation
2. **Domain Layer**: Implements core business logic through commands and strategies
3. **Service Layer**: Provides specialized functionality for transformation, caching, etc.
4. **Utilities Layer**: Offers reusable helper functions for common operations
5. **Handler Layer**: Processes HTTP requests and orchestrates operations

The architecture uses several design patterns:

- **Strategy Pattern**: For different transformation modes (video, frame, spritesheet)
- **Command Pattern**: To encapsulate transformation operations
- **Singleton Pattern**: For configuration managers
- **Factory Pattern**: For creating appropriate strategy instances
- **Dependency Injection**: For service management
- **Service Separation Pattern**: For modular, maintainable code organization

## Recent Architectural Improvements

### Consolidated 404 Failover

The system now implements a consolidated approach for handling 404 errors from the transformation proxy:

- **Clean Separation**: 404s from cdn-cgi/media are handled by `retryWithAlternativeOrigins`
- **Source Exclusion**: Failed sources are excluded from retry attempts
- **Multi-Origin Retry**: The Origins system tries all remaining sources across matching origins
- **Simplified Error Handler**: `handleTransformationError` now focuses on non-404 errors

This consolidation eliminates duplicate failover logic and provides a single source of truth for failover behavior. See [Multi-Origin Fallback](./multi-origin-fallback.md) and [404 Retry Mechanism](../features/404-retry-mechanism.md) for details.

### Service Separation Pattern

The codebase has been refactored to improve maintainability by breaking down large monolithic files into smaller, focused modules:

- **KV Storage Service**: Separated into 9 specialized modules
- **Video Storage Service**: Separated into 9 focused components
- **Error Handler Service**: Split into 6 responsibility-specific files
- **Configuration Service**: Divided into 8 logical modules
- **Transformation Utils**: Organized into 5 focused utility files

This pattern maintains backward compatibility while improving code organization and testability. See [Service Separation](./service-separation.md) for details.

### Non-Blocking Operations

The architecture now emphasizes non-blocking operations for improved performance:

- Cache version metadata updates performed in the background
- TTL refresh operations executed non-blocking
- Streaming responses for large content
- Parallel operations where beneficial

These improvements ensure responsive user experience even during resource-intensive operations.

See the [Architecture Overview](./architecture-overview.md) for a detailed explanation of the system's architecture.