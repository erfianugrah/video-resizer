# Breakpoint-Based Derivative Mapping for IMQuery

## Overview

This document describes the breakpoint-based derivative mapping feature implemented for IMQuery parameters in the Video Resizer service. This enhancement improves the way `imwidth` parameters map to video derivatives, making the mapping more predictable and aligned with responsive design principles.

## Problem Statement

In the original implementation, `imwidth` parameters were mapped to derivatives using a percentage-based approach. This approach used a mathematical calculation to find the "closest" derivative based on percentage differences between requested and available dimensions:

- If a user requested `imwidth=1000`, it might match to a derivative with width 854 if that was within the percentage threshold (typically 25%)
- This approach was mathematically sound but often led to unpredictable mappings that weren't aligned with common responsive breakpoints

## Solution: Breakpoint-Based Mapping

The new solution implements a breakpoint-based approach that maps width ranges to specific derivatives, similar to CSS media queries:

```json
"responsiveBreakpoints": {
  "small": {
    "max": 640,
    "derivative": "mobile"
  },
  "medium": {
    "min": 641,
    "max": 1024,
    "derivative": "tablet"
  },
  "large": {
    "min": 1025,
    "max": 1440,
    "derivative": "tablet"
  },
  "extra-large": {
    "min": 1441,
    "derivative": "desktop"
  }
}
```

With this configuration:
- `imwidth=500` maps to "mobile" derivative (width ≤ 640px)
- `imwidth=800` maps to "tablet" derivative (641px ≤ width ≤ 1024px)
- `imwidth=1200` maps to "tablet" derivative (1025px ≤ width ≤ 1440px)
- `imwidth=1600` maps to "desktop" derivative (width ≥ 1441px)

## Benefits

1. **Predictability**: Mapping is now straightforward and predictable based on width ranges
2. **Responsive Design Alignment**: Maps directly to common responsive design breakpoints
3. **Configurability**: Easy to adjust through configuration without code changes
4. **Cache Optimization**: Results in better cache hit rates by normalizing similar requests
5. **Documentation**: Clear ranges make it easy to document which widths map to which derivatives

## Technical Implementation

### Configuration Schema

The `responsiveBreakpoints` configuration was added to the video configuration schema:

```typescript
const ResponsiveBreakpointSchema = z.object({
  min: z.number().positive().optional(),
  max: z.number().positive().optional(),
  derivative: z.string()
});
```

### Mapping Function

The `mapWidthToDerivative` function implements the breakpoint-based mapping:

```typescript
export function mapWidthToDerivative(width: number | null): string | null {
  if (!width || width <= 0) return null;
  
  const configManager = VideoConfigurationManager.getInstance();
  const breakpoints = configManager.getResponsiveBreakpoints();
  
  // Sort breakpoints by max value for consistent matching
  const sortedBreakpoints = Object.entries(breakpoints)
    .sort((a, b) => (a[1].max || Infinity) - (b[1].max || Infinity));
  
  // Find matching breakpoint
  for (const [name, range] of sortedBreakpoints) {
    if (range.min && width < range.min) continue;
    if (range.max === undefined || width <= range.max) {
      return range.derivative;
    }
  }
  
  return null;
}
```

### Backward Compatibility

The system maintains backward compatibility by falling back to the percentage-based approach:

1. If width-only is specified (`imwidth` without `imheight`), the breakpoint approach is used
2. If both width and height are specified, or just height, the old percentage-based method is used
3. If the breakpoint mapping fails, the percentage-based approach is used as a fallback

## Configuration Example

Standard video derivative configuration:

```json
"derivatives": {
  "desktop": {
    "width": 1920,
    "height": 1080,
    "mode": "video",
    "quality": "high",
    "compression": "low",
    "description": "1920x1080 pixels. The video plays in high-definition."
  },
  "tablet": {
    "width": 1280,
    "height": 720,
    "mode": "video",
    "quality": "medium",
    "compression": "medium",
    "description": "1280x720 pixels. The video plays at medium resolution."
  },
  "mobile": {
    "width": 854, 
    "height": 640,
    "mode": "video",
    "quality": "low",
    "compression": "high",
    "description": "854x640 pixels. The video plays at the lowest resolution."
  }
}
```

## Best Practices

1. Name derivatives according to their intended device/context (mobile, tablet, desktop)
2. Use logical breakpoints that align with your CSS breakpoints for consistency
3. Ensure breakpoint ranges don't overlap
4. For the largest breakpoint, you can omit the `max` value
5. Make sure all referenced derivatives exist in your configuration

## Future Enhancements

- Integration with client detection for better automatic derivative selection
- Support for additional factors like bandwidth and device capabilities
- Custom mapping rules for specific URL patterns or content types