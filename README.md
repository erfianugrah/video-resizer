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

For more detailed instructions, see the [Quickstart Guide](./docs/guides/quickstart.md).

## Guides

- [Configuration Guide](./docs/guides/configuration.md) - Practical configuration examples
- [Troubleshooting Guide](./docs/guides/troubleshooting.md) - Common issues and solutions
- [Performance Tuning Guide](./docs/guides/performance-tuning.md) - Optimization tips

## Configuration

See the [Configuration Guide](./docs/configuration/README.md) for detailed configuration options.

## License

This project is licensed under the terms in the LICENSE file.