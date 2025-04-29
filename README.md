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

## Documentation

Comprehensive documentation is available in the [docs directory](./docs/README.md).

## Getting Started

1. Clone this repository
2. Install dependencies with `npm install`
3. Start development server with `npm run dev` or `wrangler dev`
4. Deploy to Cloudflare with `npm run deploy` or `wrangler deploy`

## Configuration

See the [Configuration Reference](./docs/configuration/CONFIGURATION_REFERENCE.md) for detailed configuration options.

## License

This project is licensed under the terms in the LICENSE file.