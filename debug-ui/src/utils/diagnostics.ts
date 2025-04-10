import type { DiagnosticsInfo } from '@/types/diagnostics';

// Parse diagnostic data from query params or window object
export function parseDiagnosticsFromUrl(): DiagnosticsInfo | null {
  if (typeof window === 'undefined') return null;
  
  try {
    console.log('Attempting to parse diagnostics data...');
    console.log('URL:', window.location.href);
    console.log('Search params:', window.location.search);
    
    // Add error display to the DOM for debugging
    const placeholderMessage = document.getElementById('placeholder-message');
    if (placeholderMessage) {
      const debugInfoDiv = document.createElement('div');
      debugInfoDiv.className = 'debug-info mt-4 text-left bg-slate-100 p-3 rounded text-sm overflow-auto';
      debugInfoDiv.style.maxHeight = '200px';
      placeholderMessage.appendChild(debugInfoDiv);
      
      // Log to both console and the DOM
      const logToPage = (message: string) => {
        console.log(message);
        const logLine = document.createElement('div');
        logLine.textContent = message;
        debugInfoDiv.appendChild(logLine);
      };
      
      logToPage(`Current URL: ${window.location.href}`);
      logToPage(`Search params: ${window.location.search}`);
      
      // First check for data in window.DIAGNOSTICS_DATA (set by worker)
      if (window.DIAGNOSTICS_DATA) {
        logToPage('Found window.DIAGNOSTICS_DATA');
        
        try {
          // Stringify and parse to validate it's proper JSON, handling circular references
          const getCircularReplacer = () => {
            const seen = new WeakSet();
            return (key: any, value: any) => {
              if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                  return '[Circular]';
                }
                seen.add(value);
              }
              return value;
            };
          };
          
          const validatedData = JSON.parse(JSON.stringify(window.DIAGNOSTICS_DATA, getCircularReplacer()));
          logToPage(`DIAGNOSTICS_DATA is valid: ${typeof validatedData === 'object'}`);
          return window.DIAGNOSTICS_DATA;
        } catch (e) {
          logToPage(`Error validating window.DIAGNOSTICS_DATA: ${e}`);
        }
      } else {
        logToPage('No window.DIAGNOSTICS_DATA found');
      }
      
      // Then fallback to URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const dataParam = urlParams.get('data');
      
      if (!dataParam) {
        logToPage('No data parameter found in URL');
        
        // Create a "View Page Source" button to help debugging
        const viewSourceBtn = document.createElement('button');
        viewSourceBtn.className = 'mt-4 px-4 py-2 bg-blue-500 text-white rounded';
        viewSourceBtn.textContent = 'Inspect window.DIAGNOSTICS_DATA';
        viewSourceBtn.onclick = () => {
          logToPage(`window.DIAGNOSTICS_DATA type: ${typeof window.DIAGNOSTICS_DATA}`);
          logToPage(`window.DIAGNOSTICS_DATA null/undefined: ${window.DIAGNOSTICS_DATA == null}`);
          
          if (window.DIAGNOSTICS_DATA) {
            logToPage('Keys: ' + Object.keys(window.DIAGNOSTICS_DATA).join(', '));
          }
          
          // Check script injection
          const scripts = document.querySelectorAll('script');
          logToPage(`Found ${scripts.length} script tags`);
          
          // Look for a script with window.DIAGNOSTICS_DATA
          let found = false;
          for (let i = 0; i < scripts.length; i++) {
            const content = scripts[i].innerHTML;
            if (content && content.includes('window.DIAGNOSTICS_DATA')) {
              logToPage(`Found DIAGNOSTICS_DATA in script ${i}`);
              found = true;
              break;
            }
          }
          
          if (!found) {
            logToPage('No script found with window.DIAGNOSTICS_DATA');
          }
        };
        
        placeholderMessage.appendChild(viewSourceBtn);
        return null;
      }
      
      logToPage(`Found data parameter in URL: ${dataParam.substring(0, 50)}...`);
      
      try {
        const parsed = JSON.parse(decodeURIComponent(dataParam));
        logToPage('Successfully parsed data parameter');
        return parsed;
      } catch (e) {
        logToPage(`Error parsing data parameter: ${e}`);
        return null;
      }
    } else {
      // No placeholder message found, use standard approach
      // First check for data in window.DIAGNOSTICS_DATA (set by worker)
      if (window.DIAGNOSTICS_DATA) {
        console.log('Using diagnostics data from window.DIAGNOSTICS_DATA');
        return window.DIAGNOSTICS_DATA;
      }
      
      // Then fallback to URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const dataParam = urlParams.get('data');
      
      if (!dataParam) {
        console.log('No diagnostic data found in URL or window object');
        return null;
      }
      
      console.log('Using diagnostics data from URL parameter');
      return JSON.parse(decodeURIComponent(dataParam));
    }
  } catch (error) {
    console.error('Error parsing diagnostics data:', error);
    
    // Display error on the page
    const placeholderMessage = document.getElementById('placeholder-message');
    if (placeholderMessage) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mt-4';
      errorDiv.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
      placeholderMessage.appendChild(errorDiv);
    }
    
    return null;
  }
}

// Get original URL without debug parameters
export function getOriginalUrl(diagnosticsInfo?: DiagnosticsInfo): string {
  // If we have diagnostics data with original URL, use it
  if (diagnosticsInfo?.originalUrl) {
    try {
      const originalUrl = new URL(diagnosticsInfo.originalUrl);
      originalUrl.searchParams.delete('debug');
      return originalUrl.href;
    } catch (e) {
      console.error('Error using originalUrl from diagnostics:', e);
    }
  }
  
  // If we're in a browser, try to reconstruct from current URL
  if (typeof window !== 'undefined') {
    try {
      const currentUrl = new URL(window.location.href);
      
      // Copy all query parameters except debug-related ones
      const params = new URLSearchParams(window.location.search);
      params.delete('data');
      params.delete('error');
      params.delete('debug');
      
      // If we have videoId or pathMatch in diagnostics, use it
      if (diagnosticsInfo?.videoId) {
        const videoPath = diagnosticsInfo.videoId;
        return `${currentUrl.origin}/${videoPath}${params.toString() ? '?' + params.toString() : ''}`;
      }
      
      if (diagnosticsInfo?.pathMatch) {
        return `${currentUrl.origin}/${diagnosticsInfo.pathMatch}`;
      }
      
      // Fallback
      return `${currentUrl.origin}/videos/sample.mp4`;
    } catch (e) {
      console.error('Error reconstructing URL:', e);
    }
  }
  
  // Fallback for SSR or errors
  return '/videos/sample.mp4';
}