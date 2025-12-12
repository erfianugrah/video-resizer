# Video Resizer Architecture

_Last Updated: December 9, 2025_

This section documents the architecture that is currently implemented in the codebase.

## Core Architecture Documents

- [Architecture Overview](./architecture-overview.md) - System design and request flow
- [Design Patterns](./design-patterns.md) - Strategy, Command, and related patterns
- [Service Separation](./service-separation.md) - How responsibilities are split across services
- [Origins System](./origins-system.md) - Origins-based configuration and resolution
- [Multi-Origin Fallback](./multi-origin-fallback.md) - Failover and retry behaviour
- [Logging Architecture](./logging/README.md) - Centralised logging, breadcrumbs, and adapters

## System Architecture

The Video Resizer follows a service-oriented architecture with clearly defined layers and responsibilities:

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

### Consolidated failover

- 404s from the transformation proxy are handled by `retryWithAlternativeOrigins`.
- Failed sources are excluded from further attempts during a request.
- Multi-origin retries are coordinated through the Origins system rather than bespoke handlers.

### Service separation

- KV Storage, Video Storage, Error Handling, and Configuration each live in dedicated modules under `src/services` and `src/config`.
- Shared utilities (e.g., `cacheOrchestrator`, `streamUtils`) keep handlers thin.

### Non-blocking operations

- Cache version writes and TTL refreshes run via `waitUntil` when available.
- Background KV storage retries are bounded (3 attempts) and logged with breadcrumbs.

See the [Architecgure Overview](./architecture-overview.md) for the end-to-end flow and component boundaries.
