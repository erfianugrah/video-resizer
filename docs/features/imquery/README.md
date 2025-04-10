# IMQuery Support

This directory contains documentation for IMQuery support in Video Resizer.

## What is IMQuery?

IMQuery is a responsive image technology that uses URL parameters (such as `imwidth` and `imheight`) to request specific dimensions of images and videos. This enables responsive design where different sized assets can be requested based on the viewing context.

## Documentation

- [IMQuery Support](./imquery-support.md) - Overview of IMQuery parameter handling
- [IMQuery Caching Behavior](./IMQUERY_CACHING.md) - Detailed explanation of caching behavior
- [Breakpoint-Based Derivative Mapping](./breakpoint-based-derivative-mapping.md) - How IMQuery parameters map to derivatives
- [IMQuery Caching Enhancement](./imquery-caching-enhancement.md) - Latest enhancements to caching system

## Implementation Details

The IMQuery support includes:
- Parameter parsing and validation for `imwidth` and `imheight` parameters
- Breakpoint-based mapping of IMQuery widths to appropriate video derivatives
- Special caching considerations for IMQuery requests
- Cache key generation that properly accounts for IMQuery parameters
- Cache tagging for effective cache management
- Responsive behavior based on client size and capabilities
- Centralized utility functions for consistent dimension handling

## Breakpoint-Based Mapping

The Video Resizer maps `imwidth` parameters to derivatives using a breakpoint-based approach, similar to CSS media queries:

| Width Range | Derivative | Resolution | Quality |
|------------|------------|------------|---------|
| ≤ 854px    | mobile     | 854x640    | low     |
| 855-1280px | tablet     | 1280x720   | medium  |
| ≥ 1281px   | desktop    | 1920x1080  | high    |

This approach provides predictable mappings that align with responsive design principles. See [Breakpoint-Based Derivative Mapping](./breakpoint-based-derivative-mapping.md) for details.

## Recent Enhancements

The most recent enhancements to IMQuery support include:

1. **Centralized Dimension Handling**: Added a `getDerivativeDimensions` utility function to centralize derivative dimension lookups

2. **Consistent Transformation URLs**: Using derivative dimensions (not requested dimensions) in CDN-CGI URLs

3. **Enhanced Cache Metadata**: Storing both derivative dimensions and requested dimensions in cache metadata

4. **Improved Cache Tags**: Adding derivative-dimension tags and requested-dimension tags for better analysis

5. **Refined Breakpoint Boundaries**: Updated breakpoint boundaries to align with actual derivative dimensions

6. **Removed Size Limit Check**: Let KV naturally handle size limits to avoid incorrect content rejection

See [IMQuery Caching Enhancement](./imquery-caching-enhancement.md) for more details.