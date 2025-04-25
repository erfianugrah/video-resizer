# Video Resizer Component Diagram

This document provides visual and descriptive representations of the key components in the Video Resizer architecture and their interactions.

## System Overview

The following diagram shows the high-level architecture of the Video Resizer system:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    subgraph HTTP Layer
        A[Client Request]
        Z[Client Response]
        REQ[Request Handler]
    end
    
    subgraph Handler Layer
        VH[videoHandler]
        CH[configHandler]
    end
    
    subgraph Command Layer
        TVC[TransformVideoCommand]
    end
    
    subgraph Strategy Layer
        StratFactory[Strategy Factory]
        VS[VideoStrategy]
        FS[FrameStrategy]
        SS[SpritesheetStrategy]
    end
    
    subgraph Service Layer
        VTS[VideoTransformationService]
        CMS[CacheManagementService]
        DS[DebugService]
        VSS[VideoStorageService]
        EHS[ErrorHandlerService]
    end
    
    subgraph Configuration Layer
        VCM[VideoConfigurationManager]
        CCM[CacheConfigurationManager]
        DCM[DebugConfigurationManager]
        LCM[LoggingConfigurationManager]
        CS[ConfigurationService]
    end
    
    subgraph Utilities Layer
        PU[pathUtils]
        CU[cacheUtils]
        TU[transformationUtils]
        LU[loggerUtils]
        EU[errorHandlingUtils]
        RC[requestContext]
    end
    
    subgraph External Services
        CF[Cloudflare Media API]
        KV[Cloudflare KV]
        R2[Cloudflare R2]
        Cache[Cloudflare Cache]
    end
    
    A --> REQ
    REQ --> VH
    REQ --> CH
    
    VH --> TVC
    
    TVC --> StratFactory
    StratFactory --> VS
    StratFactory --> FS
    StratFactory --> SS
    
    TVC --> VTS
    TVC --> CMS
    TVC --> DS
    TVC --> VSS
    TVC --> EHS
    
    VTS --> CF
    CMS --> Cache
    CMS --> KV
    VSS --> R2
    CS --> KV
    
    VCM --> VTS
    CCM --> CMS
    DCM --> DS
    LCM --> LU
    
    VTS --> PU
    VTS --> TU
    CMS --> CU
    DS --> RC
    EHS --> EU
    
    VS & FS & SS --> VTS
    TVC --> Z
    
    style A fill:#5D8AA8,stroke:#333,stroke-width:2px
    style Z fill:#5D8AA8,stroke:#333,stroke-width:2px
```

## Component Interactions

### Request Flow

The following sequence diagram illustrates a typical request flow through the system:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
sequenceDiagram
    participant C as Client
    participant WK as Worker
    participant VH as videoHandler
    participant CMD as TransformVideoCommand
    participant S as Strategy
    participant VT as VideoTransformationService
    participant CM as CacheManagementService
    participant VS as VideoStorageService
    participant CF as Cloudflare Media API
    
    C->>WK: Request video URL
    WK->>VH: Process request
    VH->>CMD: Execute command
    
    CMD->>CM: Check cache
    alt Cache hit
        CM->>CMD: Return cached response
    else Cache miss
        CMD->>S: Get appropriate strategy
        S->>CMD: Return strategy
        
        CMD->>VT: Transform video
        VT->>VS: Fetch original video
        VS->>VT: Return original video
        VT->>CF: Request transformation
        CF->>VT: Return transformed video
        VT->>CMD: Return transformed response
        
        CMD->>CM: Cache response
        CM->>CMD: Return cached response
    end
    
    CMD->>VH: Return response
    VH->>WK: Return response
    WK->>C: Return transformed video
```

### Configuration Initialization

The following sequence diagram shows how configuration is initialized:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
sequenceDiagram
    participant WK as Worker
    participant CS as ConfigurationService
    participant VCM as VideoConfigurationManager
    participant CCM as CacheConfigurationManager
    participant DCM as DebugConfigurationManager
    participant KV as KV Storage
    
    WK->>CS: Initialize configuration
    CS->>VCM: Get instance
    CS->>CCM: Get instance
    CS->>DCM: Get instance
    
    CS->>VCM: Apply default configuration
    CS->>CCM: Apply default configuration
    CS->>DCM: Apply default configuration
    
    CS->>VCM: Apply Wrangler configuration
    CS->>CCM: Apply Wrangler configuration
    CS->>DCM: Apply Wrangler configuration
    
    CS->>KV: Fetch KV configuration
    KV->>CS: Return KV configuration
    
    CS->>VCM: Apply KV configuration
    CS->>CCM: Apply KV configuration
    CS->>DCM: Apply KV configuration
    
    Note over CS: Configuration loaded
```

## Component Descriptions

### HTTP Layer

The HTTP Layer handles incoming requests and returns responses:

| Component | Type | Description |
|-----------|------|-------------|
| Request Handler | Entry Point | Main worker entry point that receives requests and routes them to the appropriate handler |

### Handler Layer

The Handler Layer contains specialized request handlers:

| Component | Type | Description |
|-----------|------|-------------|
| videoHandler | Function | Handles video transformation requests |
| configHandler | Function | Handles configuration management requests |

### Command Layer

The Command Layer implements the command pattern:

| Component | Type | Description |
|-----------|------|-------------|
| TransformVideoCommand | Class | Implements the command pattern for video transformations |

### Strategy Layer

The Strategy Layer implements the strategy pattern:

| Component | Type | Description |
|-----------|------|-------------|
| StrategyFactory | Class | Creates appropriate transformation strategies |
| VideoStrategy | Class | Handles regular video transformations |
| FrameStrategy | Class | Handles frame extraction |
| SpritesheetStrategy | Class | Handles spritesheet generation |

### Service Layer

The Service Layer provides reusable functionality:

| Component | Type | Description |
|-----------|------|-------------|
| VideoTransformationService | Class | Handles video transformation operations |
| CacheManagementService | Class | Manages caching operations |
| DebugService | Class | Provides debugging functionality |
| VideoStorageService | Class | Handles video storage and retrieval |
| ErrorHandlerService | Class | Centralizes error handling |

### Configuration Layer

The Configuration Layer manages system configuration:

| Component | Type | Description |
|-----------|------|-------------|
| VideoConfigurationManager | Class | Manages video-specific configuration |
| CacheConfigurationManager | Class | Manages cache-specific configuration |
| DebugConfigurationManager | Class | Manages debug-specific configuration |
| LoggingConfigurationManager | Class | Manages logging-specific configuration |
| ConfigurationService | Class | Coordinates configuration loading and distribution |

### Utilities Layer

The Utilities Layer provides reusable utility functions:

| Component | Type | Description |
|-----------|------|-------------|
| pathUtils | Module | URL and path manipulation utilities |
| cacheUtils | Module | Caching utilities |
| transformationUtils | Module | Transformation utilities |
| loggerUtils | Module | Logging utilities |
| errorHandlingUtils | Module | Error handling utilities |
| requestContext | Module | Request context management |

### External Services

External services that the system interacts with:

| Component | Type | Description |
|-----------|------|-------------|
| Cloudflare Media API | External API | Provides video transformation capabilities |
| Cloudflare KV | External Storage | Provides key-value storage for configuration and caching |
| Cloudflare R2 | External Storage | Provides object storage for videos |
| Cloudflare Cache | External Cache | Provides HTTP caching |

## Component Dependencies

### Service Dependencies

Services depend on configuration and sometimes on each other:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    VTS[VideoTransformationService] --> VCM[VideoConfigurationManager]
    VTS --> VSS[VideoStorageService]
    
    CMS[CacheManagementService] --> CCM[CacheConfigurationManager]
    
    DS[DebugService] --> DCM[DebugConfigurationManager]
    
    VSS --> SCM[StorageConfigurationManager]
    
    EHS[ErrorHandlerService] --> LCM[LoggingConfigurationManager]
    
    style VTS fill:#F8B229,stroke:#333,stroke-width:2px
    style CMS fill:#F8B229,stroke:#333,stroke-width:2px
    style DS fill:#F8B229,stroke:#333,stroke-width:2px
    style VSS fill:#F8B229,stroke:#333,stroke-width:2px
    style EHS fill:#F8B229,stroke:#333,stroke-width:2px
    
    style VCM fill:#7B68EE,stroke:#333,stroke-width:2px
    style CCM fill:#7B68EE,stroke:#333,stroke-width:2px
    style DCM fill:#7B68EE,stroke:#333,stroke-width:2px
    style SCM fill:#7B68EE,stroke:#333,stroke-width:2px
    style LCM fill:#7B68EE,stroke:#333,stroke-width:2px
```

### Command Dependencies

Commands depend on services:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    CMD[TransformVideoCommand] --> VTS[VideoTransformationService]
    CMD --> CMS[CacheManagementService]
    CMD --> DS[DebugService]
    CMD --> VSS[VideoStorageService]
    CMD --> EHS[ErrorHandlerService]
    
    style CMD fill:#006400,stroke:#333,stroke-width:2px
    style VTS fill:#F8B229,stroke:#333,stroke-width:2px
    style CMS fill:#F8B229,stroke:#333,stroke-width:2px
    style DS fill:#F8B229,stroke:#333,stroke-width:2px
    style VSS fill:#F8B229,stroke:#333,stroke-width:2px
    style EHS fill:#F8B229,stroke:#333,stroke-width:2px
```

### Strategy Dependencies

Strategies depend on configuration and utilities:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    VS[VideoStrategy] --> VCM[VideoConfigurationManager]
    VS --> TU[transformationUtils]
    
    FS[FrameStrategy] --> VCM
    FS --> TU
    
    SS[SpritesheetStrategy] --> VCM
    SS --> TU
    
    style VS fill:#006400,stroke:#333,stroke-width:2px
    style FS fill:#006400,stroke:#333,stroke-width:2px
    style SS fill:#006400,stroke:#333,stroke-width:2px
    
    style VCM fill:#7B68EE,stroke:#333,stroke-width:2px
    style TU fill:#5D8AA8,stroke:#333,stroke-width:2px
```

## Package Structure

The codebase is organized into the following directory structure:

```
src/
├── config/              # Configuration managers and schemas
│   ├── index.ts
│   ├── videoConfig.ts
│   ├── cacheConfig.ts
│   ├── debugConfig.ts
│   └── loggingConfig.ts
│
├── domain/              # Domain logic and business rules
│   ├── commands/
│   │   └── TransformVideoCommand.ts
│   ├── strategies/
│   │   ├── index.ts
│   │   ├── StrategyFactory.ts
│   │   ├── TransformationStrategy.ts
│   │   ├── VideoStrategy.ts
│   │   ├── FrameStrategy.ts
│   │   └── SpritesheetStrategy.ts
│
├── errors/              # Error classes and handling
│   ├── index.ts
│   ├── VideoTransformError.ts
│   ├── ValidationError.ts
│   ├── ProcessingError.ts
│   ├── ConfigurationError.ts
│   └── NotFoundError.ts
│
├── handlers/            # Request handlers
│   ├── videoHandler.ts
│   ├── configHandler.ts
│   └── videoOptionsService.ts
│
├── services/            # Service implementations
│   ├── TransformationService.ts
│   ├── CacheManagementService.ts
│   ├── ConfigurationService.ts
│   ├── DebugService.ts
│   ├── VideoStorageService.ts
│   └── ErrorHandlerService.ts
│
├── utils/               # Utility functions
│   ├── cacheUtils.ts
│   ├── pathUtils.ts
│   ├── transformationUtils.ts
│   ├── loggerUtils.ts
│   ├── errorHandlingUtils.ts
│   ├── requestContext.ts
│   └── responseBuilder.ts
│
├── types/               # TypeScript type definitions
│   ├── cloudflare.ts
│   └── diagnostics.ts
│
└── index.ts            # Application entry point
```

## Extensibility Points

The architecture provides several key extensibility points:

### 1. New Transformation Modes

To add a new transformation mode:

1. Create a new strategy implementing `TransformationStrategy`
2. Add the strategy to `StrategyFactory`
3. Update configuration and validation

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart LR
    SF[StrategyFactory]
    VS[VideoStrategy]
    FS[FrameStrategy]
    SS[SpritesheetStrategy]
    NS[New Strategy]
    
    SF --> VS
    SF --> FS
    SF --> SS
    SF --> NS
    
    style NS fill:#006400,stroke:red,stroke-width:2px,stroke-dasharray: 5 5
```

### 2. New Storage Backends

To add a new storage backend:

1. Update the `VideoStorageService` with the new backend
2. Add configuration options for the new backend
3. Implement authentication and connection logic

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    VS[VideoStorageService]
    R2[R2 Storage]
    RS[Remote Storage]
    FS[Fallback Storage]
    NS[New Storage]
    
    VS --> R2
    VS --> RS
    VS --> FS
    VS --> NS
    
    style NS fill:#006400,stroke:red,stroke-width:2px,stroke-dasharray: 5 5
```

### 3. New Commands

To add a new command:

1. Create a new command class
2. Inject required services
3. Add a new handler to use the command

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart LR
    VH[videoHandler]
    TVC[TransformVideoCommand]
    NH[New Handler]
    NC[New Command]
    
    VH --> TVC
    NH --> NC
    
    style NH fill:#006400,stroke:red,stroke-width:2px,stroke-dasharray: 5 5
    style NC fill:#006400,stroke:red,stroke-width:2px,stroke-dasharray: 5 5
```

### 4. New Configuration Managers

To add a new configuration area:

1. Create a new configuration manager class
2. Define Zod schema for validation
3. Add initialization in the configuration service

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'primaryColor': '#5D8AA8', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5D8AA8', 'lineColor': '#F8B229', 'secondaryColor': '#006400', 'tertiaryColor': '#3E3E3E' }}}%%
flowchart TD
    CS[ConfigurationService]
    VCM[VideoConfigurationManager]
    CCM[CacheConfigurationManager]
    DCM[DebugConfigurationManager]
    LCM[LoggingConfigurationManager]
    NCM[New ConfigurationManager]
    
    CS --> VCM
    CS --> CCM
    CS --> DCM
    CS --> LCM
    CS --> NCM
    
    style NCM fill:#7B68EE,stroke:red,stroke-width:2px,stroke-dasharray: 5 5
```

## Conclusion

The Video Resizer architecture follows a clear component structure with separation of concerns and well-defined interfaces between layers. The architecture is designed to be extensible, maintainable, and testable through the use of established patterns like command, strategy, and dependency injection.

Key architectural principles:

1. **Separation of Concerns**: Each component has a specific responsibility
2. **Pattern-Based Design**: Leveraging established patterns for common problems
3. **Centralized Configuration**: Type-safe, validated configuration
4. **Comprehensive Error Handling**: Structured error hierarchy
5. **Extensibility**: Clear extension points for new features

This component diagram provides a reference for understanding the system structure and for planning future enhancements.