# Akamai Integration: Technical Implementation

This document provides a comprehensive technical overview of the Akamai integration feature in Video Resizer, including implementation details, architecture, code examples, and advanced features.

## Implementation Architecture

The Akamai integration is built around several key components working together to provide a seamless translation layer between Akamai-style URLs and Cloudflare's Media Transformation API.

### Core Components

1. **Parameter Translation Utilities** (`transformationUtils.ts`)
   - Maps Akamai parameter names to Cloudflare equivalents
   - Translates parameter values where semantics differ
   - Provides batch translation capabilities for parameter objects

2. **IMQuery Utilities** (`imqueryUtils.ts`)
   - Handles Akamai's IMQuery responsive image technology
   - Parses IMQuery reference parameters
   - Converts IMQuery parameters to client hints format
   - Implements responsive dimension mapping

3. **Parameter Processing** (`videoOptionsService.ts`)
   - Integrates translation into the request processing flow
   - Applies translated parameters to video options
   - Handles special cases like inverted parameters

4. **Diagnostic Information** (`diagnosticUtils.ts`)
   - Captures original and translated parameters
   - Records translation warnings and errors
   - Provides debugging information for troubleshooting

### Data Flow

The translation process follows this sequence:

1. **Request Arrival**: An incoming request with Akamai-style parameters is received
2. **Parameter Extraction**: URL query parameters are extracted
3. **Parameter Translation**:
   - Check for Akamai parameters using translation mapping
   - Convert parameter names using `translateAkamaiParamName()`
   - Translate parameter values using `translateAkamaiParamValue()`
4. **IMQuery Processing**:
   - If IMQuery parameters are detected, process them separately
   - Convert to client hints for enhanced responsive behavior
5. **Parameter Application**:
   - Apply translated parameters to video transformation options
   - Handle special cases and parameter interactions
6. **Diagnostic Capture**:
   - Store original and translated parameters
   - Record any warnings or translation issues
7. **Transformation Execution**:
   - Use transformed parameters to create Cloudflare CDN-CGI URL
   - Process video using Cloudflare's Media Transformation API

## Translation Implementation Details

### Parameter Mapping

The heart of the translation system is the `AKAMAI_TO_CLOUDFLARE_MAPPING` object that defines the relationship between Akamai and Cloudflare parameters:

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
  
  // IMQuery responsive parameters
  'imwidth': 'width',
  'imheight': 'height',
  'imref': 'imref',
  'im-viewwidth': 'viewwidth',
  'im-viewheight': 'viewheight',
  'im-density': 'dpr',
  
  // Advanced video options
  'fps': 'fps',
  'speed': 'speed',
  'crop': 'crop',
  'rotate': 'rotate',
  'quality': 'quality',
  'compression': 'compression',
  'loop': 'loop',
  'preload': 'preload',
  'autoplay': 'autoplay',
  'muted': 'muted'
};
```

### Parameter Name Translation

The `translateAkamaiParamName()` function handles parameter name translation:

```typescript
/**
 * Translate Akamai parameter name to Cloudflare parameter name
 * @param akamaiParam - The Akamai parameter name
 * @returns The Cloudflare parameter name or null if not supported
 */
export function translateAkamaiParamName(akamaiParam: string): string | null {
  if (!akamaiParam) return null;
  
  // Lookup in mapping table
  const cloudflareParam = AKAMAI_TO_CLOUDFLARE_MAPPING[akamaiParam];
  
  // Return result if it's a string (parameter name)
  if (typeof cloudflareParam === 'string') {
    return cloudflareParam;
  }
  
  // Return null for unsupported parameters or value maps
  return null;
}
```

### Parameter Value Translation

Some parameters need value translation because their semantics differ between platforms:

```typescript
/**
 * Translate Akamai parameter value to Cloudflare parameter value
 * @param paramName - The parameter name
 * @param akamaiValue - The Akamai parameter value
 * @returns The translated Cloudflare parameter value
 */
export function translateAkamaiParamValue(
  paramName: string,
  akamaiValue: string | boolean | number
): string | boolean | number {
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

### Batch Parameter Translation

The system provides a batch translation function for converting multiple parameters at once:

```typescript
/**
 * Translate a batch of Akamai parameters to Cloudflare parameters
 * @param akamaiParams - Object containing Akamai parameters
 * @returns Object containing translated Cloudflare parameters
 */
export function translateAkamaiToCloudflareParams(
  akamaiParams: Record<string, string | boolean | number>
): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  
  for (const [key, value] of Object.entries(akamaiParams)) {
    const translatedKey = translateAkamaiParamName(key);
    
    if (translatedKey) {
      const translatedValue = translateAkamaiParamValue(key, value);
      result[translatedKey] = translatedValue;
    }
  }
  
  return result;
}
```

## IMQuery Implementation Details

### IMQuery Reference Parsing

The `parseImQueryRef()` function handles Akamai's reference parameter format:

```typescript
/**
 * Parse IMQuery reference parameter
 * @param imref - IMQuery reference parameter (format: key1=value1,key2=value2)
 * @returns Parsed parameters as key-value object
 */
export function parseImQueryRef(imref: string): Record<string, string> {
  const result: Record<string, string> = {};
  
  if (!imref) return result;
  
  const params = imref.split(',');
  for (const param of params) {
    const [key, value] = param.split('=');
    if (key && value) {
      result[key] = value;
    }
  }
  
  return result;
}
```

### IMQuery to Client Hints Conversion

IMQuery parameters are translated to client hints format for better device-specific optimization:

```typescript
/**
 * Convert IMQuery parameters to client hints format
 * @param params - URL search parameters containing IMQuery parameters
 * @returns Client hints headers as key-value pairs
 */
export function convertImQueryToClientHints(
  params: URLSearchParams
): Record<string, string> {
  const result: Record<string, string> = {};
  
  // Map viewport width
  if (params.has('im-viewwidth')) {
    result['Sec-CH-Viewport-Width'] = params.get('im-viewwidth')!;
  }
  
  // Map viewport height
  if (params.has('im-viewheight')) {
    result['Viewport-Height'] = params.get('im-viewheight')!;
  }
  
  // Map device pixel ratio
  if (params.has('im-density')) {
    result['Sec-CH-DPR'] = params.get('im-density')!;
  }
  
  return result;
}
```

### Enhanced Request Creation

When IMQuery parameters are detected, the system creates an enhanced request with client hints:

```typescript
/**
 * Create enhanced request with client hints from IMQuery parameters
 * @param request - Original request
 * @param params - URL search parameters
 * @returns Enhanced request with client hints headers
 */
export function createEnhancedRequest(
  request: Request,
  params: URLSearchParams
): Request {
  const clientHints = convertImQueryToClientHints(params);
  
  // If no client hints were generated, return the original request
  if (Object.keys(clientHints).length === 0) {
    return request;
  }
  
  // Create new headers with client hints
  const headers = new Headers(request.headers);
  
  // Add client hints headers
  for (const [key, value] of Object.entries(clientHints)) {
    headers.set(key, value);
  }
  
  // Create new request with enhanced headers
  return new Request(request.url, {
    method: request.method,
    headers,
    // Copy other properties as needed
    cf: request.cf,
    redirect: request.redirect,
    bodyUsed: request.bodyUsed
  });
}
```

## Integration with Request Processing

The translation layer is integrated into the request processing flow in `videoOptionsService.ts`:

```typescript
/**
 * Determine video transformation options from request
 * @param request - The incoming request
 * @param params - URL search parameters
 * @param path - The video path
 * @returns VideoTransformOptions with translated parameters
 */
export function determineVideoOptions(
  request: Request,
  params: URLSearchParams,
  path: string
): VideoTransformOptions {
  // Start with default options
  const options: VideoTransformOptions = {
    // Default values...
  };
  
  // Track original Akamai parameters and translation info for diagnostics
  const originalAkamaiParams: Record<string, string> = {};
  let hasAkamaiParams = false;
  
  // Process parameters
  params.forEach((value, key) => {
    // Check if this is an Akamai format parameter
    const translatedKey = translateAkamaiParamName(key);
    if (translatedKey) {
      hasAkamaiParams = true;
      originalAkamaiParams[key] = value;
    }
    
    // Use the translated key or original key
    const paramKey = translatedKey || key;
    const paramValue = translatedKey 
      ? translateAkamaiParamValue(key, value) 
      : value;
    
    // Apply parameter to options
    switch (paramKey) {
      case 'width':
        options.width = parseInt(paramValue as string);
        break;
      case 'height':
        options.height = parseInt(paramValue as string);
        break;
      // Other parameter handling...
    }
  });
  
  // Handle IMQuery parameters if present
  if (params.has('imwidth') || params.has('imheight')) {
    // Process IMQuery parameters
    // ...
  }
  
  // Store diagnostic information if Akamai parameters were used
  if (hasAkamaiParams) {
    const requestContext = getCurrentContext();
    if (requestContext) {
      requestContext.diagnosticsInfo = requestContext.diagnosticsInfo || {};
      requestContext.diagnosticsInfo.originalAkamaiParams = originalAkamaiParams;
      // Other diagnostic info...
    }
  }
  
  return options;
}
```

## Diagnostic Information

The system captures detailed diagnostic information for debugging and troubleshooting:

```typescript
// Extension to DiagnosticsInfo interface
export interface DiagnosticsInfo {
  // Existing fields...
  
  // Akamai translation fields
  originalAkamaiParams?: Record<string, string>;
  translatedCloudflareParams?: Record<string, string | boolean | number>;
  translationWarnings?: string[];
  usingIMQuery?: boolean;
}

// Diagnostic header population
export function addDebugHeaders(
  response: Response, 
  debugInfo: DebugInfo,
  diagnosticsInfo?: DiagnosticsInfo
): Response {
  // Existing code...
  
  // Add Akamai translation headers
  if (diagnosticsInfo?.usingIMQuery) {
    newHeaders.set('X-Using-IMQuery', 'true');
  }
  
  if (diagnosticsInfo?.translationWarnings?.length) {
    newHeaders.set('X-Translation-Warnings', 
      diagnosticsInfo.translationWarnings.join('; '));
  }
  
  // Existing code...
  
  return new Response(response.body, responseInit);
}
```

## Recent Enhancements

### Extended Parameter Support

The translation layer has been enhanced to support additional parameters:

1. **Advanced Video Parameters**: Added support for `fps`, `speed`, `crop`, `rotate`, etc.
2. **IMQuery Parameters**: Added support for `imwidth`, `imheight`, `imref`, etc.
3. **HTML5 Video Attributes**: Added support for `loop`, `preload`, `autoplay`, `muted`, etc.

### Client Hints Integration

IMQuery parameters are now integrated with Cloudflare's client hints system:

1. **Automatic Translation**: IMQuery viewport parameters are converted to client hints
2. **Enhanced Requests**: Requests are enhanced with client hints headers
3. **Responsive Sizing**: Responsive dimensions are calculated using client hints

### Improved Error Handling

The system now provides better error handling and validation:

1. **Parameter Validation**: Checks for unsupported parameters and value ranges
2. **Warning Collection**: Gathers warnings about translation issues
3. **Diagnostic Information**: Stores comprehensive diagnostic data

## Edge Cases and Special Considerations

### Parameter Precedence

When both Akamai and Cloudflare parameters are present in the same request:

1. Parameters are processed in the order they appear in the URL
2. Later parameters override earlier ones
3. Cloudflare native parameters take precedence over translated ones

### Value Range Differences

Some parameters have different valid ranges between platforms:

1. Quality values may have different scales
2. Time formats may differ
3. Special handling is implemented for these cases

### Multiple Value Parameters

Some parameters can have multiple values:

1. The translation layer handles comma-separated values
2. Array parameters are properly preserved
3. Complex parameter structures are supported

## Best Practices for Extending the Translation Layer

When extending the Akamai translation layer:

1. **Update the Mapping Object**: Add new parameter mappings to `AKAMAI_TO_CLOUDFLARE_MAPPING`
2. **Add Value Translations**: For parameters with different value semantics
3. **Update Tests**: Add test cases for the new parameters
4. **Document the Changes**: Update parameter mapping documentation
5. **Check for Edge Cases**: Consider interactions with existing parameters

## Performance Considerations

The translation layer is designed for optimal performance:

1. **Minimal Overhead**: Translation adds only microseconds to request processing
2. **Memory Efficiency**: Parameters are processed in-place without excessive copying
3. **No Network Impact**: All translation happens locally without additional requests
4. **Caching Support**: Translated parameters are fully compatible with caching

## Integration with Debug UI

The Debug UI provides visualization of the Akamai translation process:

1. **Parameter Comparison**: Shows original and translated parameters side by side
2. **Warning Display**: Highlights translation warnings and issues
3. **IMQuery Visualization**: Shows how IMQuery parameters are processed
4. **Translation Testing**: Allows testing different parameter combinations

## Future Enhancements

Planned improvements to the Akamai translation layer:

1. **Bidirectional Translation**: Implement Cloudflare to Akamai translation
2. **Parameter Transformation Templates**: Support complex parameter interdependencies
3. **Performance Optimization**: Implement caching for translated parameters
4. **Advanced Validation**: Enhance validation with deeper semantic checks

## Last Updated

*April 25, 2025*