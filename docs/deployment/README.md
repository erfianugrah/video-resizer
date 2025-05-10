# Video Resizer Deployment

*Last Updated: May 10, 2025*

This section provides documentation on deploying and managing the Video Resizer in production environments.

## Core Deployment Documents

- [Environment Setup](./environment-setup.md) - Setting up environments
- [Authentication Setup](./auth-setup.md) - Setting up authentication for storage access

## Deployment Overview

The Video Resizer can be deployed using Cloudflare Wrangler:

```bash
# Development deployment
npm run dev

# Production deployment
npm run deploy
```

The deployment process includes:

1. Building the TypeScript code
2. Creating KV namespaces if not existing
3. Uploading the worker code to Cloudflare
4. Configuring bindings and routes

See the [Environment Setup](./environment-setup.md) document for detailed deployment instructions.