# Advanced Configuration API for Video Resizer

This document describes the advanced Configuration API implementation for the Video Resizer service, based on the design patterns from the image-resizer-2 project.

## Overview

We've implemented a comprehensive Configuration API system in the Video Resizer service, offering a rich set of features for managing service configurations:

- **RESTful API**: A complete set of endpoints for managing configurations
- **Versioning**: Storage and retrieval of configuration versions
- **Persistence**: KV-based storage for configurations
- **Diffing**: Ability to compare configuration versions
- **Environment Variable Resolution**: Support for environment variables in configuration values
- **Authentication**: API key-based authentication

## Architecture

The Configuration API follows a service-oriented architecture with clear separation of concerns:

1. **Handler Layer**:
   - `configApiHandler.ts`: REST API endpoints for the Configuration API
   - `configAuthMiddleware.ts`: Authentication and authorization middleware

2. **Service Layer**:
   - `configApiService.ts`: High-level operations for managing configurations
   - `configurationStorageService.ts`: Storage and retrieval of configurations using KV

3. **Domain Layer**:
   - Configuration interfaces and types
   - Command-pattern implementation for configuration operations

## Key Components

### 1. Configuration Storage Service

The `ConfigurationStorageService` provides:

- Persistent storage using Cloudflare KV
- Version management and retrieval
- Comparison between versions
- Fallback to in-memory storage for testing

```typescript
export class ConfigurationStorageService {
  constructor(private store: KVNamespace) {}

  async getCurrentConfig(): Promise<ConfigurationDocument> { ... }
  async storeConfig(config: ConfigurationDocument): Promise<ConfigurationDocument> { ... }
  async getVersions(): Promise<ConfigurationVersionInfo[]> { ... }
  async getVersion(id: string): Promise<ConfigurationDocument> { ... }
  async setVersionActive(id: string): Promise<boolean> { ... }
  async compareVersions(fromId: string, toId: string): Promise<ConfigurationDifference> { ... }
}
```

### 2. Configuration API Service

The `ConfigApiService` provides a higher-level API:

- Configuration retrieval and updates
- Module-specific operations
- Environment variable resolution

```typescript
export class ConfigApiService {
  constructor(private storageService: ConfigurationStorageService) {}

  async getConfig(): Promise<ConfigurationDocument> { ... }
  async storeConfig(config: ConfigurationUpdate): Promise<ConfigurationDocument> { ... }
  async updateModule(moduleName: string, settings: any): Promise<ConfigurationDocument> { ... }
  async listVersions(): Promise<ConfigurationVersionInfo[]> { ... }
  async activateVersion(id: string): Promise<boolean> { ... }
  async compareVersions(fromId: string, toId: string): Promise<ConfigurationDifference> { ... }
  async resolveEnvVars(config: any): Promise<any> { ... }
}
```

### 3. Configuration API Handler

The `ConfigApiHandler` provides REST endpoints:

- GET, POST, and PATCH methods
- Specialized endpoints for versions and comparisons
- Environment variable resolution endpoint

```typescript
export class ConfigApiHandler {
  constructor(private configApiService: ConfigApiService) {}

  async handleRequest(request: Request): Promise<Response> {
    // Route to appropriate handler methods based on request
  }

  private async handleGetConfig(request: Request): Promise<Response> { ... }
  private async handlePostConfig(request: Request): Promise<Response> { ... }
  private async handlePatchModule(request: Request): Promise<Response> { ... }
  private async handleGetVersions(request: Request): Promise<Response> { ... }
  private async handleActivateVersion(request: Request): Promise<Response> { ... }
  private async handleCompareVersions(request: Request): Promise<Response> { ... }
  private async handleResolveEnvVars(request: Request): Promise<Response> { ... }
}
```

### 4. Authentication Middleware

The `ConfigAuthMiddleware` provides:

- API key validation
- Request authentication
- Test environment bypass

```typescript
export function authenticateConfigRequest(request: Request, env: Env): boolean {
  // Validate the API key
}

export function createAuthResponse(message: string): Response {
  // Create a 401 Unauthorized response
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/config | Get current active configuration |
| POST | /api/config | Create a new configuration version |
| PATCH | /api/config/modules/:moduleName | Update a specific module |
| GET | /api/config/versions | List all configuration versions |
| PUT | /api/config/activate/:id | Activate a specific version |
| GET | /api/config/compare | Compare two configuration versions |
| POST | /api/config/resolve | Resolve environment variables |

## Environment Setup

The configuration API requires:

1. **KV Namespace**: `CONFIG_STORE` for configuration storage
2. **Environment Variables**:
   - `CONFIG_API_ENABLED`: Enable/disable the Configuration API
   - `CONFIG_API_KEY`: API key for authentication

## Utility Scripts

Several utility scripts are provided for interacting with the Configuration API:

1. **post-config.sh**: Post a new configuration
2. **compare-versions.sh**: Compare configuration versions
3. **resolve-env-vars.sh**: Resolve environment variables in a configuration

## Integration with Image Resizer 2

This implementation is based on the Configuration API in the image-resizer-2 project, with several enhancements:

1. **Improved Architecture**: Clear separation of concerns with distinct services
2. **Enhanced Versioning**: More robust version management
3. **Diffing Capabilities**: Ability to compare configuration versions
4. **Environment Variable Resolution**: Support for dynamic configuration values
5. **Better Test Coverage**: Comprehensive tests for all components

## Future Enhancements

Potential future enhancements include:

1. **Role-Based Access Control**: Different access levels for different users
2. **Validation Rules**: Schema-based validation for configurations
3. **Audit Logging**: Track who made what changes and when
4. **Scheduled Activation**: Activate configurations at a specific time
5. **Configuration Templates**: Reusable configuration templates
6. **Partial Updates**: Update specific fields without replacing entire modules
7. **Import/Export**: Import and export configurations between environments