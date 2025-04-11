# URL Parameter Filtering

The video-resizer service implements a parameter filtering system to ensure that transformation-specific parameters are excluded from origin requests while preserving other query parameters. This document explains how this system works and how to configure it.

## How Parameter Filtering Works

When a request comes in with query parameters, the service processes the URL in the following way:

1. The original URL with all parameters is preserved for the client-facing response
2. Transformation-specific parameters are extracted for use in the CDN-CGI URL transformation
3. Non-transformation parameters are kept and passed to the origin server
4. Special parameters like `debug=view` are handled according to configuration

This ensures that origin servers receive clean URLs without Cloudflare-specific transformation parameters.

## Parameter Categories

### Filtered Parameters

The following parameter types are filtered and not passed to the origin:

#### Video Transformation Parameters
- `width`, `height`, `bitrate`, `quality`, `format`, `segment`, `time`, etc.
- `derivative` - Predefined transformation profiles
- `mode` - Transformation mode (video, frame, spritesheet)
- `fit` - Scaling method (contain, cover, scale-down)

#### Playback Control Parameters
- `loop`, `preload`, `autoplay`, `muted`

#### IMQuery Parameters
- `imwidth`, `imheight`, `im-viewwidth`, `im-viewheight`, `im-density`

See the full list in `src/utils/pathUtils.ts`.

### Special Handling

Some parameters receive special handling:

1. **Debug Parameters**:
   - `debug=view` - Preserved to enable the debug view UI
   - Other debug values like `debug=headers` are typically filtered out

2. **Cache Control Parameters**:
   - `nocache`, `bypass` - Used to control caching behavior, handled separately

## Implementation

The parameter filtering logic is implemented in the `filterTransformParams` function in `src/utils/pathUtils.ts`:

```typescript
export function filterTransformParams(url: URL, options?: FilterOptions): URL {
  // Create a new URL for the filtered version
  const filteredUrl = new URL(url.toString());
  
  // Check if we should preserve the debug parameter
  const hasDebugParam = url.searchParams.has('debug');
  const debugParamValue = hasDebugParam ? url.searchParams.get('debug') : null;
  
  // Start with empty search params
  filteredUrl.search = '';
  
  // Copy over search params, excluding video-specific ones
  url.searchParams.forEach((value, key) => {
    if (!videoParams.includes(key)) {
      filteredUrl.searchParams.set(key, value);
    }
  });
  
  // Explicitly preserve debug=view parameter
  if (hasDebugParam && debugParamValue === 'view') {
    filteredUrl.searchParams.set('debug', debugParamValue);
  }
  
  return filteredUrl;
}
```

## Configuration

The list of parameters to filter is defined in the `videoParams` array in `src/utils/pathUtils.ts`. This list can be modified to add or remove parameters from filtering.

For debug parameters, the behavior is controlled by the `debug` section in the `worker-config.json` file:

```json
"debug": {
  "enabled": true,
  "preserveDebugParams": false,
  "debugQueryParam": "debug",
  "debugViewParam": "view"
}
```

- `preserveDebugParams` - When true, preserves all debug parameters; when false, applies filtering
- `debugQueryParam` - The name of the parameter used for debugging (default: "debug")
- `debugViewParam` - The value that enables the debug view (default: "view")

## Common Issues

### Debug View Not Working

If the debug view isn't working correctly, check:
1. The `debug.enabled` setting in `worker-config.json` is `true`
2. The `debug.preserveDebugParams` setting is not filtering the parameter
3. The `debug.debugQueryParam` and `debug.debugViewParam` match what you're using in URLs

### Missing Parameters at Origin

If parameters are being incorrectly filtered from origin requests:
1. Check the `videoParams` array in `pathUtils.ts` to ensure your parameters aren't listed
2. Review any custom filtering logic that might be affecting your parameters

### Debug Parameters Being Filtered

If debug parameters are being unexpectedly filtered:
1. Check `debugHeadersUtils.ts` for any debug header filtering logic
2. Review `pathUtils.ts` for special case handling of debug parameters

## Best Practices

1. **Do not modify the video parameters list** without thorough testing
2. **Add explicit handling for special parameters** rather than removing them from filtering
3. **Document any custom parameters** you add to your application
4. **Use the debug view** to inspect how parameters are being handled