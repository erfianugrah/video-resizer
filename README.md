# Video Resizer

A Cloudflare Worker for transforming and resizing video content on the edge.

## Features

- Video transformation and optimization
- Multiple transformation strategies (video, frame, spritesheet)
- Caching with KV store integration
- Enhanced range request support for seeking and streaming
- Client-aware responsive transformations
- Automatic device and bandwidth detection
- Debug UI for monitoring and troubleshooting

## Architecture Diagrams

Each diagram illustrates a key aspect of the Video Resizer system architecture, showing the flow of data and control through the system.

### Complete System Flow

This diagram provides a high-level overview of the entire system, showing how components interact.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef config fill:#FFF8E1,stroke:#F57F17,color:#000000;
    
    %% Request handling
    A([HTTP Request]) --> B[Worker Entry Point]
    B --> C[Video Handler]
    C --> D{Cache Hit?}
    
    %% Response paths
    D -->|Yes| E([Cached Response])
    D -->|No| F[Transform Process]
    F --> G([Generated Response])
    
    %% Core components
    F -.-> H[Command Pattern]
    H -.-> I[Strategy Pattern]
    F -.-> J[KV Cache Storage]
    
    %% Configuration
    subgraph Config [Configuration System]
    direction TB
    K[Environment Config] --> L[Video Config]
    K --> M[Cache Config]
    K --> N[Debug Config]
    end
    
    Config -.-> B
    
    %% Apply styles
    class A request
    class B,C,F,H,I,J process
    class D decision
    class E,G response
    class K,L,M,N config
```

### Request Processing Flow

This diagram shows the decision path for an incoming request.

```mermaid
flowchart LR
    %% Define node styles with high contrast colors
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef success fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    
    %% Request flow
    A([Request]) --> B{CDN-CGI Path?}
    B -->|Yes| C([Passthrough])
    B -->|No| D{KV Cache Hit?}
    D -->|Yes| E([Return Cached])
    D -->|No| F[Transform Video]
    
    F --> G[Store in KV]
    F --> H([Return Response])
    
    %% Apply styles
    class A request
    class B,D decision
    class F,G process
    class C,E,H success
```

### Command Pattern Flow

The command pattern centralizes transformation logic and error handling.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef success fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef error fill:#FFEBEE,stroke:#C62828,color:#000000;
    
    %% Command flow
    A[VideoHandler] --> B[TransformVideoCommand]
    B --> C[Execute Method]
    C --> D[Prepare Transform]
    D --> E[Execute Transform]
    E --> F{Success?}
    F -->|Yes| G[Build Response]
    F -->|No| H[Handle Error]
    G --> I([Return Response])
    H --> I
    
    %% Apply styles
    class A,B,C,D,E process
    class F decision
    class G success
    class H error
    class I success
```

### Strategy Pattern Design

The strategy pattern allows multiple video processing approaches.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef interface fill:#F5F5F5,stroke:#424242,stroke-dasharray: 5 5,color:#000000;
    classDef concrete fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef factory fill:#FFF8E1,stroke:#F57F17,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    
    %% Strategy hierarchy
    A["TransformationStrategy\n(Interface)"] --> B[VideoStrategy]
    A --> C[FrameStrategy]
    A --> D[SpritesheetStrategy]
    
    %% Factory
    E[StrategyFactory] --> F{Mode?}
    F -->|video| B
    F -->|frame| C
    F -->|spritesheet| D
    
    %% Implementation
    B & C & D --> G[Transform Video URL]
    
    %% Apply styles
    class A interface
    class B,C,D,G concrete
    class E factory
    class F decision
```

### Video Options Determination

This diagram shows how video options are determined from various inputs.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef params fill:#FFF8E1,stroke:#F57F17,color:#000000;
    
    %% Options flow
    A[Determine Options] --> B{IMQuery Params?}
    
    %% IMQuery branch
    B -->|Yes| C[Process IMQuery]
    C --> D{Match Derivative?}
    D -->|Yes| E[Apply Derivative]
    D -->|No| F[Use Direct Dimensions]
    
    %% Standard params branch
    B -->|No| G{Derivative Param?}
    G -->|Yes| H[Apply Derivative]
    G -->|No| I{URL Dimensions?}
    I -->|Yes| J[Use Explicit Dimensions]
    I -->|No| K[Apply Responsive Sizing]
    
    %% Apply styles
    class A,C,E,F,H,J,K process
    class B,D,G,I decision
```

### Range Request Handling

This diagram shows how video range requests are processed.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef cache fill:#ECEFF1,stroke:#455A64,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    
    %% Range flow
    A([Video Request]) --> B{Has Range Header?}
    B -->|No| C([Return Full Response])
    B -->|Yes| D[Clone Full Response]
    D --> E[(Store in Cache API)]
    E --> F{Cache API Match?}
    F -->|Success| G([Return Range Response])
    F -->|Fail| H[Manual Range Extraction]
    H --> I{Range Valid?}
    I -->|Yes| J([Return 206 Response])
    I -->|No| K([Return 416 Error])
    
    %% Apply styles
    class A request
    class B,F,I decision
    class D,E,H process
    class C,G,J,K response
    class E cache
```

### Configuration API Flow

This diagram illustrates the authenticated configuration API.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef auth fill:#FFF8E1,stroke:#F57F17,color:#000000;
    classDef storage fill:#ECEFF1,stroke:#455A64,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef error fill:#FFEBEE,stroke:#C62828,color:#000000;
    
    %% Config API flow
    A([/admin/config Request]) --> B{Method?}
    B -->|GET| C{Auth Valid?}
    B -->|POST| D{Auth Valid?}
    C -->|No| E([401 Unauthorized])
    D -->|No| E
    C -->|Yes| F[Load Config from KV]
    D -->|Yes| G[Parse JSON Body]
    F --> H{Config Found?}
    G --> I[Store Config in KV]
    H -->|Yes| J([Return Config JSON])
    H -->|No| K([Return 404 Not Found])
    I --> L([Return Success Response])
    
    %% Apply styles
    class A request
    class B,C,D,H decision
    class F,G,I process
    class J,L response
    class E,K error
```

### Debug UI Flow

This diagram shows the debug UI generation process.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef asset fill:#FFF8E1,stroke:#F57F17,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef error fill:#FFEBEE,stroke:#C62828,color:#000000;
    
    %% Debug UI flow
    A([Request with debug=view]) --> B[Gather Diagnostics Info]
    B --> C{ASSETS Available?}
    C -->|No| D([Return Minimal Debug HTML])
    C -->|Yes| E[Fetch Debug Template]
    E --> F{Template OK?}
    F -->|No| G([Return Error HTML])
    F -->|Yes| H[Add Diagnostics as JSON]
    H --> I([Return Debug UI Response])
    
    %% Apply styles
    class A request
    class B,E,H process
    class C,F decision
    class I response
    class D,G error
```

### Caching Architecture

This diagram illustrates the KV caching system.

```mermaid
flowchart LR
    %% Define node styles with high contrast colors
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef cache fill:#ECEFF1,stroke:#455A64,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    
    %% Cache flow
    A([Request]) --> B{Check Cache}
    B -->|Hit| C([Return Cached])
    B -->|Miss| D[Process Request]
    D --> E[(KV Storage)]
    D --> F([Return Response])
    
    %% Apply styles
    class A request
    class B decision
    class D process
    class E cache
    class C,F response
```

### Configuration System

This diagram shows the configuration hierarchy.

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef root fill:#FFF8E1,stroke:#F57F17,color:#000000;
    classDef config fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef settings fill:#ECEFF1,stroke:#455A64,color:#000000;
    
    %% Config hierarchy
    A[Environment Config] --> B[Video Config]
    A --> C[Cache Config]
    A --> D[Debug Config]
    A --> E[Logging Config]
    
    %% Settings
    B --> F[Path Patterns]
    B --> G[Video Derivatives]
    C --> H[Cache Settings]
    D --> I[Debug Options]
    E --> J[Log Settings]
    
    %% Apply styles
    class A root
    class B,C,D,E config
    class F,G,H,I,J settings
```

## Documentation

Comprehensive documentation is available in the [docs directory](./docs/README.md).

## Getting Started

1. Clone this repository
2. Install dependencies with `npm install`
3. Start development server with `npm run dev` or `wrangler dev`
4. Deploy to Cloudflare with `npm run deploy` or `wrangler deploy`

For more detailed instructions, see the [Quickstart Guide](./docs/guides/quickstart.md).

## Guides

- [Configuration Guide](./docs/guides/configuration.md) - Practical configuration examples
- [Troubleshooting Guide](./docs/guides/troubleshooting.md) - Common issues and solutions
- [Performance Tuning Guide](./docs/guides/performance-tuning.md) - Optimization tips

## Configuration

See the [Configuration Guide](./docs/configuration/README.md) for detailed configuration options.

## License

This project is licensed under the terms in the LICENSE file.