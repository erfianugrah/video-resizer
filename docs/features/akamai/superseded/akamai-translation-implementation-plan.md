# Akamai Translation Layer Implementation Plan

This document outlines the step-by-step implementation plan for enhancing the Akamai translation layer in the video-resizer service.

## Current Implementation Review

The current Akamai translation functionality is primarily implemented in:

1. **`src/utils/transformationUtils.ts`**:
   - Contains the `AKAMAI_TO_CLOUDFLARE_MAPPING` object mapping Akamai parameter names to Cloudflare
   - Includes `translateAkamaiParamName()` and `translateAkamaiParamValue()` functions
   - Implements `translateAkamaiToCloudflareParams()` for batch translation

2. **`src/handlers/videoOptionsService.ts`**:
   - Integrates the translation layer into request processing
   - Uses the translation utilities to convert parameters on-the-fly

3. **`test/utils/transformationUtils.spec.ts`**:
   - Provides test coverage for Akamai parameter translation

## Implementation Plan

### Phase 1: Parameter Mapping Extension (Week 1)

1. **Update `AKAMAI_TO_CLOUDFLARE_MAPPING` in transformationUtils.ts**:
   ```typescript
   // Add new parameter mappings
   const AKAMAI_TO_CLOUDFLARE_MAPPING = {
     // Existing mappings...
     
     // New IMQuery parameters
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
     'rotate': 'rotate',
     'hue': 'hue',
     'saturation': 'saturation',
     'brightness': 'brightness',
     'contrast': 'contrast',
     'watermark': 'watermark',
     
     // Additional value mappings as needed
   };
   ```

2. **Create IMQuery utility functions in a new file `src/utils/imqueryUtils.ts`**:
   ```typescript
   /**
    * Utilities for handling Akamai IMQuery parameters
    */
   
   /**
    * Parse IMQuery reference parameter
    * @param imref - IMQuery reference parameter
    * @returns Parsed parameters object
    */
   export function parseImQueryRef(imref: string): Record<string, string> {
     // Implement parsing logic for imref parameter
     // Format: key1=value1,key2=value2,...
     
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
   
   /**
    * Convert IMQuery parameters to client hints format
    * @param params - IMQuery parameters
    * @returns Parameters in client hints format
    */
   export function convertImQueryToClientHints(
     params: URLSearchParams
   ): Record<string, string> {
     const result: Record<string, string> = {};
     
     // Map IMQuery to client hints
     if (params.has('im-viewwidth')) {
       result['Sec-CH-Viewport-Width'] = params.get('im-viewwidth')!;
     }
     
     if (params.has('im-viewheight')) {
       result['Viewport-Height'] = params.get('im-viewheight')!;
     }
     
     if (params.has('im-density')) {
       result['Sec-CH-DPR'] = params.get('im-density')!;
     }
     
     return result;
   }
   ```

3. **Enhance error handling for Akamai parameters**:
   ```typescript
   /**
    * Validate Akamai parameters for compatibility
    * @param params - Akamai parameters
    * @returns Validation result with warnings
    */
   export function validateAkamaiParams(
     params: Record<string, string | boolean | number>
   ): { isValid: boolean; warnings: string[] } {
     const warnings: string[] = [];
     
     // Implement validation logic for Akamai parameters
     // Check for unsupported parameters and validate value ranges
     
     return { isValid: warnings.length === 0, warnings };
   }
   ```

### Phase 2: IMQuery Integration (Week 2)

1. **Update `videoOptionsService.ts` to handle IMQuery parameters**:
   ```typescript
   import { 
     parseImQueryRef, 
     convertImQueryToClientHints 
   } from '../utils/imqueryUtils';
   
   export function determineVideoOptions(
     request: Request,
     params: URLSearchParams,
     path: string
   ): VideoTransformOptions {
     // Existing code...
     
     // Handle IMQuery parameters
     if (params.has('imwidth') || params.has('imheight') || params.has('imref')) {
       // Process IMQuery parameters
       if (params.has('imref')) {
         const imrefParams = parseImQueryRef(params.get('imref')!);
         // Apply imref parameters
         // ...
       }
       
       // Convert IMQuery to client hints
       const clientHints = convertImQueryToClientHints(params);
       
       // Create modified request with client hints
       const enhancedRequest = new Request(request.url, {
         method: request.method,
         headers: new Headers(request.headers)
       });
       
       // Add client hints headers
       for (const [key, value] of Object.entries(clientHints)) {
         enhancedRequest.headers.set(key, value);
       }
       
       // Use existing client hints logic with enhanced request
       const responsiveSize = getResponsiveVideoSize(enhancedRequest, 
         explicitWidth, explicitHeight);
       
       // Only override values that weren't explicitly set
       if (!explicitWidth) {
         options.width = responsiveSize.width;
       }
       
       if (!explicitHeight) {
         options.height = responsiveSize.height;
       }
       
       // Add responsive source information
       options.source = 'imquery';
     }
     
     // Existing code...
     
     return options;
   }
   ```

2. **Enhance client hints handling in `clientHints.ts`**:
   ```typescript
   /**
    * Detect combined client hints from standard headers and IMQuery
    * @param request - The incoming request
    * @returns True if any client hints are available
    */
   export function hasCombinedClientHints(request: Request): boolean {
     // Check for standard client hints
     const hasStandardHints = hasClientHints(request);
     
     // Check for IMQuery parameters
     const url = new URL(request.url);
     const hasIMQuery = url.searchParams.has('imwidth') || 
                        url.searchParams.has('imheight') || 
                        url.searchParams.has('imref') ||
                        url.searchParams.has('im-viewwidth');
     
     return hasStandardHints || hasIMQuery;
   }
   ```

3. **Add tests for IMQuery handling**:
   ```typescript
   // In a new file: test/utils/imqueryUtils.spec.ts
   import { describe, it, expect } from 'vitest';
   import { 
     parseImQueryRef, 
     convertImQueryToClientHints 
   } from '../../src/utils/imqueryUtils';
   
   describe('IMQuery Utils', () => {
     describe('parseImQueryRef', () => {
       it('should parse imref parameters correctly', () => {
         const imref = 'w=800,h=600,dpr=2';
         const result = parseImQueryRef(imref);
         
         expect(result).toEqual({
           w: '800',
           h: '600',
           dpr: '2'
         });
       });
       
       // More tests...
     });
     
     describe('convertImQueryToClientHints', () => {
       it('should convert IMQuery parameters to client hints', () => {
         const params = new URLSearchParams({
           'im-viewwidth': '1024',
           'im-density': '2'
         });
         
         const result = convertImQueryToClientHints(params);
         
         expect(result).toEqual({
           'Sec-CH-Viewport-Width': '1024',
           'Sec-CH-DPR': '2'
         });
       });
       
       // More tests...
     });
   });
   ```

### Phase 3: Debug UI Integration (Week 3)

1. **Create translation visualization component in `debug-ui/src/components/dashboard/AkamaiTranslation.tsx`**:
   ```tsx
   import React from 'react';
   import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
   
   interface AkamaiTranslationProps {
     originalParams: Record<string, string>;
     translatedParams: Record<string, string>;
     warnings: string[];
   }
   
   export function AkamaiTranslation({ 
     originalParams, 
     translatedParams,
     warnings 
   }: AkamaiTranslationProps) {
     return (
       <Card>
         <CardHeader>
           <CardTitle>Akamai Parameter Translation</CardTitle>
         </CardHeader>
         <CardContent>
           <div className="grid grid-cols-2 gap-6">
             <div>
               <h3 className="text-md font-semibold mb-2">Original Akamai Parameters</h3>
               <div className="rounded bg-muted p-4">
                 <pre className="text-sm">
                   {JSON.stringify(originalParams, null, 2)}
                 </pre>
               </div>
             </div>
             <div>
               <h3 className="text-md font-semibold mb-2">Translated Cloudflare Parameters</h3>
               <div className="rounded bg-muted p-4">
                 <pre className="text-sm">
                   {JSON.stringify(translatedParams, null, 2)}
                 </pre>
               </div>
             </div>
           </div>
           
           {warnings.length > 0 && (
             <div className="mt-4">
               <h3 className="text-md font-semibold mb-2 text-amber-500">Translation Warnings</h3>
               <ul className="space-y-1">
                 {warnings.map((warning, i) => (
                   <li key={i} className="text-sm text-amber-500">{warning}</li>
                 ))}
               </ul>
             </div>
           )}
         </CardContent>
       </Card>
     );
   }
   ```

2. **Update `DiagnosticsInfo` interface in `src/types/diagnostics.ts`**:
   ```typescript
   export interface DiagnosticsInfo {
     // Existing fields...
     
     // Add fields for Akamai translation
     originalAkamaiParams?: Record<string, string>;
     translatedCloudflareParams?: Record<string, string>;
     translationWarnings?: string[];
     usingIMQuery?: boolean;
   }
   ```

3. **Modify `debugService.ts` to include Akamai translation info**:
   ```typescript
   export function addDebugHeaders(
     response: Response,
     debugInfo: DebugInfo,
     diagnosticsInfo: DiagnosticsInfo
   ): Response {
     // Existing code...
     
     // Add Akamai translation headers if present
     if (diagnosticsInfo.usingIMQuery) {
       newHeaders.set('X-Using-IMQuery', 'true');
     }
     
     if (diagnosticsInfo.translationWarnings && 
         diagnosticsInfo.translationWarnings.length > 0) {
       newHeaders.set('X-Translation-Warnings', 
         diagnosticsInfo.translationWarnings.join('; '));
     }
     
     // Existing code...
     
     return new Response(response.body, responseInit);
   }
   ```

4. **Integrate the component into `debug.astro`**:
   ```astro
   ---
   // Existing imports...
   import { AkamaiTranslation } from '@/components/dashboard/AkamaiTranslation';
   ---
   
   <!-- In the appropriate section -->
   {diagnosticsInfo.originalAkamaiParams && (
     <div id="akamai-translation-container">
       <AkamaiTranslation 
         originalParams={diagnosticsInfo.originalAkamaiParams}
         translatedParams={diagnosticsInfo.translatedCloudflareParams} 
         warnings={diagnosticsInfo.translationWarnings || []}
       />
     </div>
   )}
   ```

### Phase 4: Performance Optimization (Week 4)

1. **Implement parameter translation caching in `transformationUtils.ts`**:
   ```typescript
   // Simple in-memory cache for translated parameters
   const parameterCache = new Map<string, Record<string, string | boolean | number>>();
   
   /**
    * Create a cache key from parameter object
    * @param params - Parameter object
    * @returns Cache key string
    */
   function createCacheKey(params: Record<string, string | boolean | number>): string {
     return JSON.stringify(params);
   }
   
   /**
    * Translate Akamai parameters to Cloudflare with caching
    * @param akamaiParams - Akamai parameters
    * @returns Translated Cloudflare parameters
    */
   export function translateAkamaiToCloudflareParamsCached(
     akamaiParams: Record<string, string | boolean | number>
   ): Record<string, string | boolean | number> {
     // Create cache key
     const cacheKey = createCacheKey(akamaiParams);
     
     // Check if translation is cached
     if (parameterCache.has(cacheKey)) {
       return parameterCache.get(cacheKey)!;
     }
     
     // Perform translation
     const result = translateAkamaiToCloudflareParams(akamaiParams);
     
     // Cache the result (limit cache size to prevent memory issues)
     if (parameterCache.size > 1000) {
       // Remove oldest entry
       const firstKey = parameterCache.keys().next().value;
       parameterCache.delete(firstKey);
     }
     
     parameterCache.set(cacheKey, result);
     return result;
   }
   ```

2. **Add parameter benchmarking in `videoOptionsService.ts`**:
   ```typescript
   import { addBreadcrumb, startTimer } from '../utils/requestContext';
   
   export function determineVideoOptions(
     request: Request,
     params: URLSearchParams,
     path: string
   ): VideoTransformOptions {
     const requestContext = getCurrentContext();
     
     // Start timer for translation benchmarking
     const translationTimer = startTimer('akamai_translation');
     
     // Extract parameters and convert to object
     const paramObject: Record<string, string> = {};
     params.forEach((value, key) => {
       paramObject[key] = value;
     });
     
     // Detect if any Akamai parameters are present
     const hasAkamaiParams = Object.keys(paramObject).some(key => 
       translateAkamaiParamName(key) !== null);
     
     // If using Akamai params, store original params for debugging
     let originalAkamaiParams: Record<string, string> | undefined;
     let translatedParams: Record<string, string | boolean | number> | undefined;
     
     if (hasAkamaiParams && requestContext) {
       originalAkamaiParams = { ...paramObject };
       
       // Use cached translation for performance
       translatedParams = translateAkamaiToCloudflareParamsCached(paramObject);
       
       // Store in request context for debug UI
       requestContext.diagnosticsInfo = requestContext.diagnosticsInfo || {};
       requestContext.diagnosticsInfo.originalAkamaiParams = originalAkamaiParams;
       requestContext.diagnosticsInfo.translatedCloudflareParams = translatedParams;
       
       // Add breadcrumb for Akamai translation
       addBreadcrumb(requestContext, 'Parameters', 'Translated Akamai parameters', {
         paramCount: Object.keys(originalAkamaiParams).length,
         translationTime: translationTimer.getElapsedMs()
       });
     }
     
     // Existing code...
     
     return options;
   }
   ```

### Phase 5: Robustness Improvements (Week 5)

1. **Enhance error handling for Akamai parameters**:
   ```typescript
   /**
    * Validate and process Akamai parameters with detailed feedback
    * @param params - Akamai parameters
    * @returns Processed parameters with validation results
    */
   export function processAkamaiParams(
     params: Record<string, string | boolean | number>
   ): {
     translatedParams: Record<string, string | boolean | number>;
     warnings: string[];
     errors: string[];
   } {
     const warnings: string[] = [];
     const errors: string[] = [];
     
     // Check for unsupported parameters
     Object.keys(params).forEach(key => {
       if (translateAkamaiParamName(key) === null) {
         warnings.push(`Unsupported Akamai parameter: ${key}`);
       }
     });
     
     // Validate parameter values
     // Example: Check time format
     if (params.start && typeof params.start === 'string') {
       if (!isValidTime(params.start)) {
         warnings.push(`Invalid time format: ${params.start}. Must be in format Ns or Nm and between 0-30s.`);
       }
     }
     
     // More validation...
     
     // Translate parameters (handling errors)
     let translatedParams: Record<string, string | boolean | number> = {};
     try {
       translatedParams = translateAkamaiToCloudflareParams(params);
     } catch (err) {
       errors.push(`Translation error: ${err instanceof Error ? err.message : String(err)}`);
     }
     
     return { translatedParams, warnings, errors };
   }
   ```

2. **Implement better logging for Akamai translation**:
   ```typescript
   // In videoOptionsService.ts
   import { info, warn, error } from '../utils/loggerUtils';
   
   // During parameter processing:
   const { translatedParams, warnings, errors } = processAkamaiParams(paramObject);
   
   // Log translation results
   if (warnings.length > 0) {
     warn('AkamaiTranslation', 'Parameter translation warnings', { 
       warnings, 
       originalParams: paramObject 
     });
     
     if (requestContext) {
       requestContext.diagnosticsInfo = requestContext.diagnosticsInfo || {};
       requestContext.diagnosticsInfo.translationWarnings = warnings;
     }
   }
   
   if (errors.length > 0) {
     error('AkamaiTranslation', 'Parameter translation errors', { 
       errors, 
       originalParams: paramObject 
     });
   } else {
     info('AkamaiTranslation', 'Successfully translated parameters', {
       paramCount: Object.keys(paramObject).length,
       translationTime: translationTimer.getElapsedMs()
     });
   }
   ```

### Phases 6-7: Advanced Features (Weeks 6-8)

These phases would implement the bidirectional translation and parameter transformation templates as outlined in the enhancement plan document. These are more advanced features that would build on the foundation established in the first 5 weeks.

## Testing Strategy

1. **Unit Tests**:
   - Test all new utility functions in isolation
   - Verify correct parameter translation for all cases
   - Test error handling and edge cases

2. **Integration Tests**:
   - Test IMQuery parameter handling with realistic requests
   - Test end-to-end flows from request to response
   - Verify performance with different parameter combinations

3. **Visual Testing**:
   - Verify debug UI displays translation information correctly
   - Test with various parameter combinations

## Documentation

Create comprehensive documentation comparing Akamai and Cloudflare parameters, including:
- Parameter equivalents
- Value range differences
- Behavioral differences
- Implementation details for the translation layer
- Performance considerations

## Success Metrics

Track the following metrics to measure implementation success:
1. Parameter translation success rate
2. Translation performance (average time taken)
3. Number of unsupported parameters encountered
4. Cache hit rate for parameter translation