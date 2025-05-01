# Video Resizer Architecture

*Last Updated: May 1, 2025*

This section provides comprehensive documentation on the Video Resizer architecture, including system design, components, patterns, and evolution.

## Core Architecture Documents

- [Architecture Overview](./architecture-overview.md) - Comprehensive system design overview
- [Design Patterns](./design-patterns.md) - Strategy, Command, and other patterns used
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

See the [Architecture Overview](./architecture-overview.md) for detailed information on these components and their interactions.