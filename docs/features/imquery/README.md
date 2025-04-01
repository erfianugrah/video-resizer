# IMQuery Support

This directory contains documentation for IMQuery support in Video Resizer.

## What is IMQuery?

IMQuery is a responsive image technology that uses URL parameters (such as `imwidth` and `imheight`) to request specific dimensions of images and videos. This enables responsive design where different sized assets can be requested based on the viewing context.

## Documentation

- [IMQuery Caching Enhancement](./imquery-caching-enhancement.md)
- [IMQuery Caching Fix](./imquery-caching-fix.md)
- [IMQuery Support](./imquery-support.md)

## Implementation Details

The IMQuery support includes:
- Parameter parsing and validation for `imwidth` and `imheight` parameters
- Matching of IMQuery parameters to appropriate video derivatives
- Special caching considerations for IMQuery requests
- Cache key generation that properly accounts for IMQuery parameters
- Cache tagging for effective cache management
- Responsive behavior based on client size and capabilities