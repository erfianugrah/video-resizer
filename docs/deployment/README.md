# Video Resizer Deployment

_Last Updated: February 18, 2026_

This section provides documentation on deploying and managing the Video Resizer in production environments.

## Core Deployment Documents

- Environment Setup (planned) - Setting up environments
- Authentication Setup (planned) - Setting up authentication for storage access

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

See the Environment Setup document (planned) for detailed deployment instructions.
