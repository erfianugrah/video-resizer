import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getOriginalUrl } from '@/utils/diagnostics';
import type { DiagnosticsInfo, TransformParams } from '@/types/diagnostics';
import { ExternalLink } from 'lucide-react';

interface MediaPreviewProps {
  diagnostics: DiagnosticsInfo;
  className?: string;
}

export function MediaPreview({ diagnostics, className }: MediaPreviewProps) {
  const originalUrl = getOriginalUrl(diagnostics);
  const isVideo = !diagnostics.transformParams?.mode || 
                  diagnostics.transformParams.mode === 'video';
  
  const importantParams = ['width', 'height', 'mode', 'fit', 'format', 'quality', 'time'];
  
  // For display, we need to show the actual transformed parameters, not the original URL parameters
  // The actualTransformParams will contain the parameters extracted from cdnCgiUrl if available
  const transformParameters = diagnostics.actualTransformParams || diagnostics.transformParams || {};
  
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="gap-2">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="18" 
            height="18" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
            className="mr-2"
          >
            {isVideo ? (
              <path d="m22 8-6 4 6 4V8Z M2 8v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
            ) : (
              <path d="M5 3a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Z M12 8v8 M8 12h8" />
            )}
          </svg>
          Media Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-hidden">
        <div className="bg-slate-900 rounded-md overflow-hidden flex items-center justify-center mb-4 max-w-full">
          <div className="h-64 w-full flex items-center justify-center overflow-hidden">
            {isVideo ? (
              <video 
                src={originalUrl} 
                controls
                className="max-h-64 w-auto object-contain"
                preload="metadata"
              >
                Your browser does not support the video tag.
              </video>
            ) : (
              <img 
                src={originalUrl} 
                alt="Transformed media"
                className="max-h-64 w-auto object-contain"
              />
            )}
          </div>
        </div>
        
        <div className="space-y-4 text-sm mb-4 overflow-x-auto">
          {/* Original video dimensions section */}
          {(diagnostics.videoInfo?.width || diagnostics.videoInfo?.height) && (
            <div>
              <div className="font-medium mb-2">
                <span className="flex items-center">
                  <span className="mr-1">Original Video Dimensions</span>
                  <span className="text-xs bg-slate-200 px-1 rounded text-slate-700">estimated</span>
                </span>
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-sm">
                  <tbody>
                    {diagnostics.videoInfo?.width && (
                      <tr className="border-b">
                        <td className="py-2 pr-4 font-medium">width</td>
                        <td className="py-2 font-mono">{diagnostics.videoInfo.width}</td>
                      </tr>
                    )}
                    {diagnostics.videoInfo?.height && (
                      <tr className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">height</td>
                        <td className="py-2 font-mono">{diagnostics.videoInfo.height}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Transform Parameters section */}
          <div>
            <div className="font-medium mb-2">Transform Parameters</div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-sm">
                <tbody>
                  {/* Show difference between requested and actual parameters when available */}
                  {importantParams.map(key => {
                    const requestedValue = diagnostics.transformParams?.[key];
                    const actualValue = diagnostics.actualTransformParams?.[key];
                    
                    // Skip if both are undefined
                    if (requestedValue === undefined && actualValue === undefined) {
                      return null;
                    }
                    
                    // Check if there's a difference between requested and actual
                    const isDifferent = actualValue !== undefined && 
                                       String(requestedValue) !== String(actualValue);
                    
                    return (
                      <tr key={key} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium whitespace-nowrap">{key}</td>
                        <td className="py-2 font-mono">
                          {isDifferent ? (
                            <>
                              <span className={`${isDifferent ? 'text-amber-600 line-through mr-2' : ''}`}>
                                {String(requestedValue)}
                              </span>
                              <span className="text-green-600">
                                {String(actualValue)}
                              </span>
                            </>
                          ) : (
                            String(requestedValue || actualValue)
                          )}
                        </td>
                      </tr>
                    );
                  }).filter(Boolean)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <Button variant="outline" size="sm" className="w-full" asChild>
          <a href={originalUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Open in New Tab
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}