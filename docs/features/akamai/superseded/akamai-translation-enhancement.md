# Akamai Translation Layer Enhancement

## Current Implementation

The video-resizer service currently includes a translation layer to convert Akamai-style video parameters to Cloudflare's Media Transformation API parameters. This compatibility layer allows users to continue using Akamai-formatted URLs while leveraging Cloudflare's Media Transformation API underneath.

The current implementation includes:

### Parameter Name Mapping

In `transformationUtils.ts`, we have a mapping from Akamai parameter names to Cloudflare parameter names:

```typescript
const AKAMAI_TO_CLOUDFLARE_MAPPING = {
  // Akamai Image & Video Manager params
  'w': 'width',
  'h': 'height',
  'dpr': 'dpr',
  'obj-fit': 'fit',
  'q': 'quality',
  'f': 'format',
  'start': 'time',
  'dur': 'duration',
  'mute': 'audio',
  'bitrate': 'bitrate',
  
  // Map Akamai value translations
  'fit-values': {
    'cover': 'cover',
    'contain': 'contain',
    'crop': 'cover',
    'fill': 'contain',
    'scale-down': 'scale-down'
  },
  
  // Advanced video options
  'quality': 'quality',
  'compression': 'compression',
  'loop': 'loop',
  'preload': 'preload',
  'autoplay': 'autoplay',
  'muted': 'muted'
};
```

### Parameter Value Translation

For parameters like `obj-fit` and `mute` that have different values or semantics:

```typescript
export function translateAkamaiParamValue(paramName: string, akamaiValue: string | boolean | number): string | boolean | number {
  // Handle special case for 'mute' param which inverts the meaning
  if (paramName === 'mute') {
    return !(akamaiValue === 'true' || akamaiValue === true);
  }
  
  // Handle fit value translations
  if (paramName === 'obj-fit' && typeof akamaiValue === 'string') {
    const fitValues = AKAMAI_TO_CLOUDFLARE_MAPPING['fit-values'] as Record<string, string>;
    return fitValues[akamaiValue] || akamaiValue;
  }
  
  return akamaiValue;
}
```

### Integration in Request Processing

In `videoOptionsService.ts`, the translation layer is integrated into the request processing:

```typescript
// Process both standard Cloudflare params and Akamai format params
params.forEach((value, key) => {
  // Check if this is an Akamai format parameter
  const translatedKey = translateAkamaiParamName(key);
  const paramKey = translatedKey || key;

  // Handle parameters based on their proper name
  switch (paramKey) {
    // Parameter handling...
  }
});
```

## Enhancement Opportunities

### 1. Extended Akamai Compatibility

#### Complete Parameter Set Support

Add support for additional Akamai parameters:

- `fps` - Frame rate control
- `speed` - Playback speed
- `crop` - Cropping parameters
- `rotate` - Rotation
- `hue`, `saturation`, `brightness`, `contrast` - Color adjustments
- `watermark` - Watermarking support
- `imwidth`, `imheight` - IMQuery responsive image dimensions
- `imref` - IMQuery reference query for responsive images

#### IMQuery Support

Implement support for Akamai's IMQuery responsive image technology:

- Create mapping between IMQuery and Cloudflare's client hints approach
- Support `imwidth` and `imheight` parameters for client-driven responsive sizing
- Implement `imref` parameter handling for context-aware transformations
- Add `im-viewwidth`, `im-viewheight` and `im-density` parameters for device-based optimizations
- Support automatic translation of complex IMQuery expressions

#### Enhanced Configuration Documentation

Create a comprehensive mapping document between Akamai and Cloudflare parameters, including:
- Parameter name mapping
- Value mapping
- Behavior differences
- Limitations and unsupported features

### 2. Debug UI Integration for Akamai Compatibility

#### Parameter Translation Visualization

Add a new section to the Debug UI that shows:
- Original Akamai parameters received
- Translated Cloudflare parameters
- Any warnings about unsupported parameters or value ranges

#### Translation Rule Testing

Create a tool in the Debug UI to:
- Test parameter translations interactively
- Preview how different Akamai parameter combinations would translate
- Validate parameters against both Akamai and Cloudflare constraints

#### Configuration Editor

Allow modifying the translation rules in the Debug UI:
- Add/edit/remove parameter mappings
- Test changes before applying them
- Export updated configuration

### 3. Performance Optimization

#### Caching Translated Parameters

Implement caching for frequently used parameter combinations:
- Store translated parameters for common Akamai parameter combinations
- Use hash-based lookup for fast retrieval
- Include cache statistics in Debug UI

#### Optimized Translation Logic

Improve translation performance:
- Replace switch statements with direct object lookups
- Optimize common parameter pathways
- Add benchmarking for translation overhead

### 4. Robustness Improvements

#### Error Handling and Validation

Enhance error handling for parameter translation:
- Detailed validation for Akamai parameters
- Specific error messages for parameter translation failures
- Graceful fallbacks for partial parameter support
- Validation against known Akamai parameter constraints

#### Logging and Monitoring

Improve observability for the translation layer:
- Log translation activities with detailed metrics
- Track translation errors and fallbacks
- Identify problematic parameter combinations
- Monitor performance of the translation layer

### 5. Advanced Features

#### Bidirectional Translation

Implement reverse translation (Cloudflare to Akamai):
- Allow generating Akamai-compatible URLs
- Support migration use cases
- Enable A/B testing between Akamai and Cloudflare transformations

#### Parameter Transformation Templates

Implement template-based parameter transformations:
- Define common transformations as templates
- Support complex parameter interdependencies
- Allow advanced rule-based transformations
- Enable conditional parameter mapping

## Implementation Plan

### Phase 1: Enhanced Compatibility (3 weeks)

1. Week 1: Extend parameter mapping
   - Add support for missing Akamai parameters
   - Implement value range translations
   - Create comprehensive parameter mapping documentation

2. Week 2: IMQuery integration
   - Implement IMQuery parameter support
   - Create mapping between IMQuery and client hints
   - Build translation layer for responsive sizing
   - Add device-based optimization parameters

3. Week 3: Debug UI integration
   - Add parameter translation visualization to Debug UI
   - Implement basic translation testing interface
   - Create IMQuery visualization components

### Phase 2: Performance and Robustness (2 weeks)

4. Week 4: Performance optimization
   - Implement parameter translation caching
   - Optimize translation logic
   - Add performance benchmarking

5. Week 5: Robustness improvements
   - Enhance error handling and validation
   - Improve logging and monitoring
   - Add parameter constraint validation

### Phase 3: Advanced Features (3 weeks)

6. Week 6-7: Bidirectional translation
   - Implement Cloudflare to Akamai translation
   - Add URL generation capabilities
   - Create comparison tools for dual translations

7. Week 8: Parameter transformation templates
   - Design template system
   - Implement template-based transformations
   - Add template configuration to Debug UI

## Technical Considerations

1. **Parameter Semantics**: Ensure correct handling of parameters with different semantics
2. **Default Values**: Handle differences in default behaviors between platforms
3. **Range Constraints**: Account for different valid ranges between platforms
4. **Feature Parity**: Document cases where direct translation isn't possible
5. **Configuration Management**: Make translation rules configurable without code changes
6. **Performance Impact**: Minimize overhead of translation layer
7. **IMQuery Integration**: Handle special client-side logic required for IMQuery parameters
8. **Responsive Breakpoints**: Support Akamai's responsive image breakpoint system
9. **Browser Compatibility**: Maintain support for all browsers that Akamai's IMQuery supports

## Success Metrics

1. Zero regression in parameter handling
2. Reduced support requests related to parameter compatibility
3. Improved developer experience in the Debug UI
4. Minimal performance overhead (< 1ms per request)
5. Complete documentation of parameter mapping
6. Successfully handling 100% of common Akamai parameter combinations