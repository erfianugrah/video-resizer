# IMQuery Support

This directory contains documentation for IMQuery support in Video Resizer.

## What is IMQuery?

IMQuery is a responsive image technology that uses URL parameters (such as `imwidth` and `imheight`) to request specific dimensions of images and videos. This enables responsive design where different sized assets can be requested based on the viewing context.

## Documentation

- [Breakpoint-Based Derivative Mapping](./breakpoint-based-derivative-mapping.md) - NEW
- [IMQuery Caching Enhancement](./imquery-caching-enhancement.md)
- [IMQuery Caching Fix](./imquery-caching-fix.md)
- [IMQuery Support](./imquery-support.md)

## Implementation Details

The IMQuery support includes:
- Parameter parsing and validation for `imwidth` and `imheight` parameters
- Breakpoint-based mapping of IMQuery widths to appropriate video derivatives
- Special caching considerations for IMQuery requests
- Cache key generation that properly accounts for IMQuery parameters
- Cache tagging for effective cache management
- Responsive behavior based on client size and capabilities

## Breakpoint-Based Mapping

The Video Resizer maps `imwidth` parameters to derivatives using a breakpoint-based approach, similar to CSS media queries:

| Width Range | Derivative | Resolution | Quality |
|------------|------------|------------|---------|
| ≤ 640px    | mobile     | 854x640    | low     |
| 641-1024px | tablet     | 1280x720   | medium  |
| 1025-1440px| tablet     | 1280x720   | medium  |
| ≥ 1441px   | desktop    | 1920x1080  | high    |

This approach provides more predictable mappings that align with responsive design principles. See [Breakpoint-Based Derivative Mapping](./breakpoint-based-derivative-mapping.md) for details.