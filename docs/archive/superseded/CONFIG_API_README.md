# Video Resizer Configuration API

The Video Resizer Configuration API provides a RESTful interface for managing service configurations programmatically. This API allows you to adjust settings, create configuration versions, and manage deployments without code changes.

## Quick Start

### Authentication

All protected endpoints require an API key in the request header:

```
X-API-Key: your-api-key
```

For security, store API keys as Cloudflare secrets:

```bash
# Set API key for development environment
npx wrangler secret put CONFIG_API_KEY --env development

# Set API key for production environment 
npx wrangler secret put CONFIG_API_KEY --env production
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Get current configuration |
| `/api/config` | POST | Create a new configuration version |
| `/api/config/modules/:moduleName` | PATCH | Update a specific module |
| `/api/config/versions` | GET | List all configuration versions |
| `/api/config/activate/:id` | PUT | Activate a specific version |
| `/api/config/compare` | GET | Compare two configuration versions |
| `/api/config/resolve` | POST | Resolve environment variables |
| `/api/config/health` | GET | Check API health (no auth required) |

### Utility Scripts

The `scripts/` directory includes helpful utilities:

- `post-config.sh`: Post a new configuration
- `compare-versions.sh`: Compare two configuration versions
- `resolve-env-vars.sh`: Resolve environment variables

Example:
```bash
./scripts/post-config.sh dev scripts/sample-config.json
```

## Configuration Modules

Configurations are organized by modules:

- **video**: Video transformation settings
- **cache**: Caching behavior
- **routes**: URL pattern matching and processing
- **debug**: Debugging features
- **storage**: Storage configuration
- **logging**: Logging settings

Example configuration:
```json
{
  "modules": {
    "video": {
      "defaultQuality": "high",
      "defaultCompression": "medium",
      "derivatives": {
        "preview": {
          "width": 480,
          "height": 270,
          "quality": "low"
        }
      }
    },
    "cache": {
      "method": "cf",
      "defaultTtl": 3600
    }
  },
  "activate": true,
  "comment": "Initial configuration"
}
```

## Environment Variables

Use environment variables in your configurations with `${VAR_NAME}` syntax:

```json
{
  "video": {
    "quality": "${VIDEO_QUALITY:-medium}"
  }
}
```

## Next Steps

- Read the [full Configuration API Guide](./CONFIGURATION_API_GUIDE.md) for detailed documentation
- Explore the sample configurations in the `scripts/` directory
- Set up your API keys as Cloudflare secrets
- Create your first configuration with the `post-config.sh` script

## Security Recommendations

1. Always use secrets for API keys
2. Limit API access to authorized personnel
3. Review configuration changes before activating
4. Use IP restrictions to secure API access
5. Audit configuration changes regularly