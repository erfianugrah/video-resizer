# Breakpoint-Based Derivative Mapping for IMQuery

## Overview

Breakpoint-based derivative mapping is a key feature of Video Resizer's IMQuery support, allowing for intuitive and predictable mapping between requested dimensions and video derivatives. This approach mirrors responsive design patterns used in CSS media queries, creating a more natural and consistent experience.

## Mapping Approach

### Concept

Rather than using a purely mathematical percentage-based mapping, breakpoint-based mapping:
- Defines explicit width ranges that map to specific derivatives
- Uses ranges that align with common responsive design breakpoints
- Provides predictable behavior at range boundaries
- Improves cache efficiency by grouping similar dimensions

### Configuration Schema

Breakpoints are configured in the Video Resizer configuration:

```json
{
  "video": {
    "responsiveBreakpoints": {
      "small": {
        "min": 0,
        "max": 854,
        "derivative": "mobile"
      },
      "medium": {
        "min": 855,
        "max": 1280,
        "derivative": "tablet"
      },
      "large": {
        "min": 1281,
        "derivative": "desktop"
      }
    }
  }
}
```

Each breakpoint has:
- An optional `min` width (inclusive)
- An optional `max` width (inclusive)
- A required `derivative` name that maps to a configured derivative

### Mapping Logic

The mapping process follows this sequence:

1. Extract the `imwidth` parameter from the request
2. Sort breakpoints by max value for consistent matching
3. Iterate through sorted breakpoints
4. For each breakpoint:
   - If the width is less than the min value (if set), skip this breakpoint
   - If the width is less than or equal to the max value (or max is undefined), use this breakpoint's derivative
5. If no match is found, return null (which will trigger fallback behavior)

## Evolution from Percentage-Based Mapping

### Original Approach

The original implementation used a percentage-based approach:

1. Calculate the Euclidean distance between requested dimensions and each derivative's dimensions
2. Convert this distance to a percentage difference relative to the requested dimensions
3. Select the derivative with the smallest percentage difference below a threshold (typically 25%)

While mathematically sound, this approach had drawbacks:
- Less predictable results, especially around boundaries
- Didn't align with common responsive design patterns
- Required both width and height for optimal performance
- Could produce different results for similar dimensions

### Comparison

| Aspect | Percentage-Based | Breakpoint-Based |
|--------|------------------|------------------|
| **Matching Logic** | Mathematical distance calculation | Range-based lookup |
| **Predictability** | Variable based on available derivatives | Consistent based on configuration |
| **Configuration** | Simple derivative definitions | Explicit breakpoint ranges |
| **Responsive Design Alignment** | Limited | Strong (similar to CSS media queries) |
| **Cache Efficiency** | Moderate | High (consolidates similar dimensions) |
| **Required Parameters** | Works best with width and height | Works well with width only |
| **Edge Case Handling** | Depends on mathematical proximity | Clearly defined boundaries |

## Implementation Details

### Core Mapping Function

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

### Integration with Dimension Handling

The mapping function works with the centralized dimension utility:

```typescript
// Map width to derivative
const derivative = mapWidthToDerivative(width);

// Get the actual dimensions of that derivative
const derivativeDimensions = getDerivativeDimensions(derivative);

// Use the derivative's actual dimensions
if (derivativeDimensions) {
  transformParams.width = derivativeDimensions.width;
  transformParams.height = derivativeDimensions.height;
}
```

### Fallback Mechanism

The system maintains backward compatibility by falling back to percentage-based mapping:

1. Try breakpoint-based mapping first (fastest and most predictable)
2. If no match is found or configuration is missing, fall back to percentage-based mapping
3. If both methods fail, use the requested dimensions directly

## Boundary Optimization

A key enhancement was aligning breakpoint boundaries with actual derivative dimensions:

### Before

- Arbitrary boundaries (e.g., 640px, 1024px)
- Could lead to mapping edge cases to unexpected derivatives

### After

- Boundaries match derivative dimensions (854, 1280, 1920)
- Ensures clear, expected behavior at boundaries
- Improves cache efficiency

For example:
- `imwidth=854` maps to "mobile" (854×640)
- `imwidth=855` maps to "tablet" (1280×720)

This eliminates confusion and ensures consistent behavior.

## Test Cases and Edge Cases

When testing breakpoint mapping, pay special attention to boundary values:

### Key Test Cases

- `imwidth=0` → Should map to "mobile" (or lowest defined range)
- `imwidth=854` → Should map to "mobile" (mobile max boundary)
- `imwidth=855` → Should map to "tablet" (tablet min boundary)
- `imwidth=1280` → Should map to "tablet" (tablet max boundary)
- `imwidth=1281` → Should map to "desktop" (desktop min boundary)
- `imwidth=9999` → Should map to "desktop" (far beyond any boundary)

### Edge Case Handling

- **Negative or zero values**: Handled by validation check
- **Missing configuration**: Falls back to percentage-based approach
- **Overlapping ranges**: First match in sorted order takes precedence

## Performance Considerations

The breakpoint-based approach offers several performance advantages:

1. **Faster matching**: Simple range checks instead of mathematical calculations
2. **Better cache consolidation**: Grouped dimensions lead to higher cache hit rates
3. **Reduced computation**: No need to calculate distances or percentages
4. **Simplified logic**: Easier to understand, debug, and maintain

## Best Practices

1. **Name Breakpoints Meaningfully**: Use names that reflect intended devices ("small", "medium", "large" or "mobile", "tablet", "desktop")
2. **Align with CSS**: Make breakpoints match your CSS media queries for consistency
3. **Match Derivative Dimensions**: Set breakpoint boundaries to match derivative dimensions
4. **Cover All Ranges**: Ensure all possible width values map to some derivative
5. **Test Boundaries**: Always verify behavior at boundary values
6. **Document Breakpoints**: Clearly document which width ranges map to which derivatives

## Future Enhancements

Potential improvements to the breakpoint system include:

1. **Device-Aware Breakpoints**: Adapt breakpoints based on detected device type
2. **Network-Condition Adjustment**: Modify breakpoint selection based on network quality
3. **Path-Specific Breakpoints**: Different breakpoint configurations for different content paths
4. **Advanced Caching Integration**: Further optimize cache behavior based on breakpoint analytics

## Last Updated

*April 25, 2025*