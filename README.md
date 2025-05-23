# Video Resizer

A Cloudflare Worker for transforming and resizing video content on the edge.

## Features

- Video transformation and optimization
- Multiple transformation strategies (video, frame, spritesheet)
- Caching with KV store integration and efficient TTL refresh
- KV chunking for large videos with concurrency-safe chunk locking
- Background fallback caching with streaming for large videos
- Cache versioning for invalidation without purging
- Multi-origin fallback for improved resilience
- Memory-efficient video streaming with zero-copy buffer handling
- Optimized timeout management to prevent quota exceeded errors
- Enhanced range request support for seeking and streaming
- Client-aware responsive transformations
- Automatic device and bandwidth detection
- Debug UI for monitoring and troubleshooting
- High-concurrency chunk size validation and tolerance

## Quick Start

1. Clone this repository
2. Install dependencies with `npm install`
3. Start development server with `npm run dev` or `wrangler dev`
4. Deploy to Cloudflare with `npm run deploy` or `wrangler deploy`

For more detailed instructions, see the [Quickstart Guide](./docs/guides/quickstart.md).

## Documentation

Comprehensive documentation is available in the [docs directory](./docs/README.md).

### Guides

- [Configuration Guide](./docs/guides/configuration.md) - Practical configuration examples
- [Troubleshooting Guide](./docs/guides/troubleshooting.md) - Common issues and solutions
- [Performance Tuning Guide](./docs/guides/performance-tuning.md) - Optimization tips
- [API Reference](./docs/reference/api-reference.md) - Complete API details

## System Architecture

This section provides visual diagrams of the system architecture and key components. For your convenience, diagrams are organized by functional area.

### Core System Flow

<details>
<summary><strong>Complete System Flow</strong> - High-level overview of the entire system</summary>

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
</details>

<details>
<summary><strong>Comprehensive E2E System Diagram</strong> - Complete end-to-end flow of all components</summary>

```mermaid
flowchart TD
    %% Client request entry point
    Client([Client Request]) --> Fetch[src/index.ts]
    Fetch --> ReqCtx[Request Context]
    ReqCtx --> Router{URL Pattern}
    
    %% Route branching
    Router -->|"/admin/config"| Config[configHandler.ts]
    Router -->|"Non-MP4"| Pass[Direct Passthrough]
    Router -->|"Video Request"| Video[videoHandler.ts]
    
    %% Config flow
    Config --> ConfigSvc[configurationService.ts]
    ConfigSvc --> KVStore[KV Configuration Storage]
    KVStore --> ConfigResp[Configuration Response]
    
    %% Video processing flow
    Video --> ClientDet[clientHints.ts]
    ClientDet --> DeviceUtil[deviceUtils.ts]
    DeviceUtil --> CacheChk{KV Cache Check}
    
    %% Cache hit/miss paths
    CacheChk -->|"Hit"| CacheHit[Serve from Cache]
    CacheChk -->|"Miss"| Coalesce{Request Coalescing}
    
    %% Request coalescing
    Coalesce -->|"In-flight"| Wait[Wait for Original]
    Coalesce -->|"New Request"| Options[videoOptionsService.ts]
    
    %% Options flow
    Options --> IMCheck{IMQuery Parameters?}
    IMCheck -->|"Yes"| IMProc[imqueryUtils.ts]
    IMCheck -->|"No"| StdOpt[Standard Options]
    IMProc --> Pattern[Path Pattern Matching]
    StdOpt --> Pattern
    
    %% Command pattern
    Pattern --> Command[TransformVideoCommand.ts]
    Command --> Mode{Transformation Mode}
    
    %% Strategy pattern
    Mode -->|"video"| VideoS[VideoStrategy.ts]
    Mode -->|"frame"| FrameS[FrameStrategy.ts]
    Mode -->|"spritesheet"| SheetS[SpritesheetStrategy.ts]
    
    %% Strategy execution
    VideoS --> Validate[validateOptions]
    FrameS --> Validate
    SheetS --> Validate
    Validate --> Prepare[prepareTransformParams]
    Prepare --> Transform[TransformationService.ts]
    
    %% Transformation execution
    Transform --> CDN[Create cdn-cgi URL]
    CDN --> Execute[executeTransformation]
    Execute --> TransformErr{Transform Error?}
    TransformErr -->|No| FetchVid[fetchVideo.ts]
    TransformErr -->|Yes| ErrorHdl[transformationErrorHandler.ts]
    
    %% Error fallback flow
    ErrorHdl --> MatchPatterns[Find All Matching Origins]
    MatchPatterns --> TryOrigins[Try Each Origin in Sequence]
    TryOrigins --> OriginSuccess{Success?}
    OriginSuccess -->|Yes| Return[Return Origin Content]
    OriginSuccess -->|No| DirectFetch[Try Direct Fetch]
    DirectFetch --> DirectSuccess{Success?}
    DirectSuccess -->|Yes| Return
    DirectSuccess -->|No| StorageFallback[Try Storage Service]
    StorageFallback --> Return
    
    %% Storage backend
    FetchVid --> Storage{Storage Priority}
    Storage -->|"R2"| R2Store[r2Storage.ts]
    Storage -->|"Remote"| RemStore[remoteStorage.ts]
    Storage -->|"Fallback"| FallStore[fallbackStorage.ts]
    
    %% Response processing
    R2Store --> Process[Process Response]
    RemStore --> Process
    FallStore --> Process
    
    %% Caching system
    Process --> StoreCache[cacheManagementService.ts]
    StoreCache --> GenKey[keyUtils.ts]
    GenKey --> Version[cacheVersionService.ts]
    Version --> SizeChk{Size > 20MB?}
    
    %% Chunking implementation
    SizeChk -->|"Yes"| Chunk[storeVideo.ts: Chunked]
    SizeChk -->|"No"| Single[storeVideo.ts: Single]
    Chunk --> CacheTags[cacheTags.ts]
    Single --> CacheTags
    
    %% TTL calculation
    CacheTags --> TTLCalc[determineTTL.ts]
    TTLCalc --> Profile[Match Cache Profile]
    Profile --> TTLType{Response Type}
    TTLType -->|"200"| OkTTL[Standard TTL]
    TTLType -->|"404"| ErrTTL[Error TTL]
    TTLType -->|"302"| RedirTTL[Redirect TTL]
    
    %% Range request handling
    CacheHit --> RangeChk{Range Request?}
    RangeChk -->|"Yes"| Stream[streamingHelpers.ts]
    RangeChk -->|"No"| StdResp[Standard Response]
    
    %% Streaming logic
    Stream --> ChunkChk{Chunked Storage?}
    ChunkChk -->|"Yes"| ChunkStream[streamChunkedRangeResponse]
    ChunkChk -->|"No"| StdStream[Standard Range Response]
    
    %% Error handling system
    Validate -.-> Error[errorHandlerService.ts]
    FetchVid -.-> Error
    Process -.-> Error
    Error --> Normalize[normalizeError.ts]
    Normalize --> ErrType{Error Type}
    
    %% Error responses
    ErrType -->|"Validation"| Err400[400 Response]
    ErrType -->|"NotFound"| Err404[404 Response]
    ErrType -->|"Processing"| Err500[500 Response]
    ErrType -->|"Size Limit"| FallResp[Fallback Content]
    
    %% Debug system
    Command -.-> Debug[debugService.ts]
    Debug --> Diag[collectDiagnostics]
    Diag --> Bread[Add Breadcrumbs]
    Bread --> DebugMd{Debug Mode}
    
    %% Debug outputs
    DebugMd -->|"Headers"| DebugH[Debug Headers]
    DebugMd -->|"View"| DebugV[Debug UI]
    DebugMd -->|"JSON"| DebugJ[Diagnostic JSON]
    
    %% Logging system
    Fetch -.-> Logger[pinoLogger.ts]
    Video -.-> Logger
    Command -.-> Logger
    Error -.-> Logger
    Logger --> LogLvl{Log Level}
    
    %% Log levels
    LogLvl -->|"Info"| InfoLog[Info Logging]
    LogLvl -->|"Error"| ErrLog[Error with Context]
    LogLvl -->|"Debug"| DbgLog[Debug Details]
    
    %% Configuration system
    EnvConf[environmentConfig.ts] --> VidConf[VideoConfigurationManager.ts]
    VidConf --> CacheConf[CacheConfigurationManager.ts]
    CacheConf --> LogConf[LoggingConfigurationManager.ts]
    LogConf --> DbgConf[DebugConfigurationManager.ts]
    
    %% Configuration connections
    VidConf -.-> Command
    CacheConf -.-> StoreCache
    CacheConf -.-> TTLCalc
    LogConf -.-> Logger
    DbgConf -.-> Debug
    
    %% Final response paths
    ConfigResp --> Final[Finalize Response]
    Pass --> Final
    StdResp --> Final
    ChunkStream --> Final
    StdStream --> Final
    Err400 --> Final
    Err404 --> Final
    Err500 --> Final
    FallResp --> Final
    
    Final --> Client
    
    %% Performance monitoring connections
    Performance[Time Tracking] -.-> Fetch
    Performance -.-> Video
    Performance -.-> Command
    Performance -.-> StoreCache
    
    %% Styling for better readability within confluence
    classDef primary fill:#d0e0ff
    classDef cache fill:#ffffd0
    classDef error fill:#ffd0d0
    classDef strategy fill:#d8f9d8
    
    class Command,Pattern,Transform primary
    class CacheChk,StoreCache,GenKey,Version cache
    class Error,Normalize,ErrType error
    class VideoS,FrameS,SheetS strategy
```
</details>

<details>
<summary><strong>Request Processing Flow</strong> - Decision path for request handling</summary>

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
</details>

<details>
<summary><strong>Configuration System</strong> - Configuration hierarchy</summary>

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
</details>

### Video Transformation

<details>
<summary><strong>Command Pattern Flow</strong> - Transformation logic and error handling</summary>

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
</details>

<details>
<summary><strong>Strategy Pattern Design</strong> - Multiple video processing approaches</summary>

```mermaid
flowchart TB
    %% Define node styles with high contrast colors
    classDef interface fill:#F5F5F5,stroke:#424242,stroke-dasharray: 5 5,color:#000000;
    classDef concrete fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef factory fill:#FFF8E1,stroke:#F57F17,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;

    %% Strategy hierarchy
    A["TransformationStrategy (Interface)"] --> B[VideoStrategy]
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
</details>

<details>
<summary><strong>Video Options Determination</strong> - Parameter processing flow</summary>

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
</details>

### Caching System

<details>
<summary><strong>Caching Architecture</strong> - KV caching system overview</summary>

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
</details>

<details>
<summary><strong>Cache TTL Refresh Flow</strong> - Efficient TTL refresh with metadata-only updates</summary>

```mermaid
flowchart TB
    %% Define node styles
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef background fill:#F3E5F5,stroke:#6A1B9A,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;

    %% Main request flow
    A([Cache Hit]) --> B{TTL Refresh Needed?}
    B -->|No| C([Return Response])
    B -->|Yes| D[Start Background Refresh]
    D --> C

    %% Background processes
    D -.-> E[Update Metadata Only]
    E --> F{Rate Limited?}
    F -->|Yes| G[Exponential Backoff]
    G --> H[Retry]
    F -->|No| I[Record New TTL]

    %% Apply styles
    class A request
    class B,F decision
    class D,E,G,H,I process
    class C response
    class E,F,G,H,I background
```
</details>

<details>
<summary><strong>Cache Versioning Flow</strong> - Invalidation without purging</summary>

```mermaid
flowchart TB
    %% Define node styles
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef version fill:#FFF8E1,stroke:#F57F17,color:#000000;
    classDef cache fill:#ECEFF1,stroke:#455A64,color:#000000;
    classDef response fill:#E8F5E9,stroke:#2E7D32,color:#000000;

    %% Versioning flow
    A([Request]) --> B[Generate Cache Key]
    B --> C[Add Version to Key]
    C --> D{In KV Cache?}
    D -->|Yes| E([Return Cached Response])
    D -->|No| F[Transform Video]
    F --> G[Store with Version]
    G --> H([Return Response])

    %% Version update flow
    I([Cache Invalidation]) --> J[Get Next Version]
    J --> K[(Update Version in KV)]
    K -.-> L[Existing Cached Items]
    L -.-> M[Become Stale]

    %% Apply styles
    class A,I request
    class B,C,F,G,J process
    class D decision
    class E,H response
    class K,L,M cache
    class C,J,K version
```
</details>

<details>
<summary><strong>KV Chunking Architecture</strong> - Large video storage with concurrency control</summary>

```mermaid
flowchart TB
    %% Define node styles
    classDef request fill:#E8F5E9,stroke:#2E7D32,color:#000000;
    classDef process fill:#E3F2FD,stroke:#1565C0,color:#000000;
    classDef decision fill:#FFF3E0,stroke:#E65100,color:#000000;
    classDef storage fill:#E8EAF6,stroke:#3949AB,color:#000000;
    classDef lock fill:#F3E5F5,stroke:#7B1FA2,color:#000000;
    classDef chunk fill:#FFF3E0,stroke:#F57C00,color:#000000;

    %% Storage flow
    A([Video Response > 20MB]) --> B{Check Active Locks}
    B -->|Locked| C[Wait in Queue]
    B -->|Available| D[Acquire Chunk Locks]
    
    C --> D
    D --> E[Split into 5MB Chunks]
    E --> F[Concurrent Upload Queue<br>Max 5 parallel]
    
    F --> G[Store Chunk 0]
    F --> H[Store Chunk 1]
    F --> I[Store Chunk N]
    
    G & H & I --> J[Create Manifest]
    J --> K[Store at Base Key]
    K --> L[Release All Locks]
    L --> M([Success Response])

    %% Retrieval flow
    N([Range Request]) --> O[Read Manifest]
    O --> P{Calculate Chunks}
    P --> Q[Fetch Only Required Chunks]
    Q --> R{Size Validation}
    R -->|Match| S([Stream to Client])
    R -->|Minor Diff < 0.1%| T[Log & Continue]
    T --> S
    R -->|Major Diff| U[Error Recovery]

    %% Apply styles
    class A,N request
    class B,P,R decision
    class C,D,L lock
    class E,F,J,K,O,Q,T,U process
    class G,H,I chunk
    class M,S storage
```
</details>

### Additional Features

<details>
<summary><strong>Range Request Handling</strong> - Video seeking and streaming support</summary>

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
</details>

<details>
<summary><strong>Configuration API Flow</strong> - Authenticated configuration management</summary>

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
</details>

<details>
<summary><strong>Debug UI Flow</strong> - Monitoring and troubleshooting interface</summary>

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
</details>

## License

This project is licensed under the terms in the [LICENSE](./LICENSE) file.