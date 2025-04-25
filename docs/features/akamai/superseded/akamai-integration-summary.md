# Akamai Integration: Implementation Summary

This document summarizes the implementation of Akamai compatibility features in the video-resizer service.

## Overview

We've enhanced the video-resizer service to support Akamai-style parameters and the IMQuery responsive image technology. This enables a smooth transition from Akamai to Cloudflare while maintaining backward compatibility with existing Akamai-formatted URLs.

## Implemented Features

### 1. Extended Parameter Mapping

We've expanded the `AKAMAI_TO_CLOUDFLARE_MAPPING` in `transformationUtils.ts` to include:

- Standard Akamai parameters (`w`, `h`, `obj-fit`, etc.)
- IMQuery responsive parameters (`imwidth`, `imheight`, `imref`, etc.)
- Additional video parameters (`fps`, `speed`, `crop`, `rotate`)

```typescript
const AKAMAI_TO_CLOUDFLARE_MAPPING = {
  // Akamai Image & Video Manager params
  'w': 'width',
  'h': 'height',
  // ...many more parameters...
  
  // IMQuery responsive image parameters
  'imwidth': 'width',
  'imheight': 'height',
  'imref': 'imref',
  'im-viewwidth': 'viewwidth',
  'im-viewheight': 'viewheight',
  'im-density': 'dpr',
  
  // Additional video parameters
  'fps': 'fps',
  'speed': 'speed',
  'crop': 'crop',
  'rotate': 'rotate'
};
```

### 2. IMQuery Support

We've created a dedicated utility module `imqueryUtils.ts` for handling Akamai's IMQuery technology:

- `parseImQueryRef()` - Parses Akamai's reference query syntax
- `convertImQueryToClientHints()` - Translates IMQuery parameters to client hints
- `hasIMQueryParams()` - Detects IMQuery parameters in requests
- `validateAkamaiParams()` - Validates parameter formats and provides warnings

```typescript
export function parseImQueryRef(imref: string): Record<string, string> {
  // Format: key1=value1,key2=value2,...
  const result: Record<string, string> = {};
  
  if (!imref) return result;
  
  debug('IMQuery', 'Parsing imref parameter', { imref });
  
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

### 3. Client Hints Integration

We've integrated IMQuery with Cloudflare's client hints system:

- IMQuery parameters are converted to client hints headers
- Enhanced request objects are created with the client hints
- Responsive sizing calculations use the enhanced request

```typescript
// Convert IMQuery to client hints if present
const clientHints = convertImQueryToClientHints(params);
if (Object.keys(clientHints).length > 0) {
  // Create enhanced request with client hints
  const headers = new Headers(request.headers);
  
  // Add client hints headers
  for (const [key, value] of Object.entries(clientHints)) {
    headers.set(key, value);
  }
  
  // Create new request with enhanced headers
  const enhancedRequest = new Request(request.url, {
    method: request.method,
    headers,
    // ...other request properties...
  });
  
  // Use the enhanced request for further processing
  request = enhancedRequest;
}
```

### 4. Parameter Processing

We've enhanced the video options service to handle:

- Traditional Akamai parameters
- IMQuery parameters
- Additional video parameters

```typescript
// Handle parameters based on their proper name
switch (paramKey) {
  // ...existing parameters...
  
  // Handle additional video parameters
  case 'fps':
    const fpsValue = parseFloat(value);
    if (!isNaN(fpsValue) && fpsValue > 0) {
      options.fps = fpsValue;
    }
    break;
    
  case 'speed':
    const speedValue = parseFloat(value);
    if (!isNaN(speedValue) && speedValue > 0) {
      options.speed = speedValue;
    }
    break;
    
  case 'rotate':
    const rotateValue = parseFloat(value);
    if (!isNaN(rotateValue)) {
      options.rotate = rotateValue;
    }
    break;
    
  case 'crop':
    options.crop = value;
    break;
}
```

### 5. Diagnostic Information

We've updated the `DiagnosticsInfo` interface to include Akamai translation information:

```typescript
export interface DiagnosticsInfo {
  // ...existing fields...
  
  // Akamai translation info
  originalAkamaiParams?: Record<string, string>;
  translatedCloudflareParams?: Record<string, string | boolean | number>;
  translationWarnings?: string[];
  usingIMQuery?: boolean;
}
```

This information is collected and stored in the request context for:
- Debugging and troubleshooting
- Future integration with the Debug UI
- Monitoring the translation process

## What's Next

To complete the implementation as outlined in the enhancement plan, the next steps would be:

1. **Debug UI Integration**:
   - Create a new Debug UI component to visualize parameter translations
   - Show original and translated parameters side by side
   - Display any warnings or issues with translations

2. **Performance Optimization**:
   - Implement caching for translated parameters
   - Add benchmarking for translation overhead
   - Optimize translation logic for common parameter sets

3. **Bidirectional Translation**:
   - Implement Cloudflare to Akamai translation
   - Support URL generation in both formats
   - Enable A/B testing between Akamai and Cloudflare transformations

## Usage Examples

### Basic Akamai Parameter Usage

```
https://example.com/videos/sample.mp4?w=800&h=600&obj-fit=cover
```

This URL uses traditional Akamai parameters and will be translated to Cloudflare's:
```
https://example.com/cdn-cgi/media/width=800,height=600,fit=cover/videos/sample.mp4
```

### IMQuery Usage

```
https://example.com/videos/sample.mp4?imwidth=800&imheight=600&imref=w=800,h=600,dpr=2
```

This URL uses IMQuery parameters and will:
1. Convert IMQuery parameters to client hints
2. Use responsive sizing based on the parameters
3. Generate an appropriate Cloudflare transformation URL

### Advanced Video Parameters

```
https://example.com/videos/sample.mp4?fps=30&speed=1.5&rotate=90&crop=100,100,500,500
```

This URL uses the new video parameters for more advanced transformations.

## Conclusion

The implemented Akamai compatibility layer provides a robust foundation for transitioning from Akamai to Cloudflare while maintaining backward compatibility. Users can continue using existing Akamai-formatted URLs while benefiting from Cloudflare's Media Transformation capabilities.