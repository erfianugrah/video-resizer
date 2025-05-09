/**
 * Functions for translating parameters between different CDN formats
 */
import { tryOrNull, tryOrDefault } from '../errorHandlingUtils';

/**
 * Mapping from Akamai params to Cloudflare params
 */
export const AKAMAI_TO_CLOUDFLARE_MAPPING = {
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
  'muted': 'muted',
  
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

/**
 * Implementation of translateAkamaiParamName that might throw errors
 */
function translateAkamaiParamNameImpl(akamaiParam: string): string | null {
  return AKAMAI_TO_CLOUDFLARE_MAPPING[akamaiParam as keyof typeof AKAMAI_TO_CLOUDFLARE_MAPPING] as string || null;
}

/**
 * Translate Akamai parameter name to Cloudflare parameter name
 * Using tryOrNull for safe parameter translation
 * 
 * @param akamaiParam Akamai parameter name
 * @returns Cloudflare parameter name or null if not supported
 */
export const translateAkamaiParamName = tryOrNull<[string], string | null>(
  translateAkamaiParamNameImpl,
  {
    functionName: 'translateAkamaiParamName',
    component: 'TransformationUtils',
    logErrors: false // Low importance function, avoid excessive logging
  }
);

/**
 * Implementation of translateAkamaiParamValue that might throw errors
 */
function translateAkamaiParamValueImpl(paramName: string, akamaiValue: string | boolean | number): string | boolean | number {
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

/**
 * Translate Akamai parameter value to Cloudflare parameter value
 * Using tryOrDefault for safe parameter translation
 * 
 * @param paramName Parameter name
 * @param akamaiValue Akamai parameter value
 * @returns Translated Cloudflare parameter value
 */
export const translateAkamaiParamValue = tryOrDefault<[string, string | boolean | number], string | boolean | number>(
  translateAkamaiParamValueImpl,
  {
    functionName: 'translateAkamaiParamValue',
    component: 'TransformationUtils',
    logErrors: true
  },
  '' // Return empty string as a safe default if translation fails
);

/**
 * Implementation of translateAkamaiToCloudflareParams that might throw errors
 */
function translateAkamaiToCloudflareParamsImpl(
  akamaiParams: Record<string, string | boolean | number>
): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  
  for (const [key, value] of Object.entries(akamaiParams)) {
    const cloudflareKey = translateAkamaiParamName(key);
    if (cloudflareKey) {
      result[cloudflareKey] = translateAkamaiParamValue(key, value);
    }
  }
  
  return result;
}

/**
 * Translate all parameters from Akamai format to Cloudflare format
 * Using tryOrDefault for safe parameter translation with proper error handling
 * 
 * @param akamaiParams Object with Akamai parameters
 * @returns Object with Cloudflare parameters
 */
export const translateAkamaiToCloudflareParams = tryOrDefault<
  [Record<string, string | boolean | number>],
  Record<string, string | boolean | number>
>(
  translateAkamaiToCloudflareParamsImpl,
  {
    functionName: 'translateAkamaiToCloudflareParams',
    component: 'TransformationUtils',
    logErrors: true
  },
  {} // Return empty object as safe default if translation fails
);