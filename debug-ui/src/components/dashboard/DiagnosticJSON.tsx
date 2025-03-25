import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Expand, Minimize } from 'lucide-react';
import type { DiagnosticsInfo } from '@/types/diagnostics';

interface DiagnosticJSONProps {
  data: DiagnosticsInfo;
  className?: string;
}

export function DiagnosticJSON({ data, className }: DiagnosticJSONProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // Format the JSON data
      setCode(JSON.stringify(data, null, 2));
    }
  }, [data]);

  function copyToClipboard() {
    if (!code) return;
    
    navigator.clipboard.writeText(code).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
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
            <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
            <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" />
          </svg>
          Complete Diagnostic Data
        </CardTitle>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? (
              <>
                <Minimize className="h-4 w-4 mr-1" />
                Collapse
              </>
            ) : (
              <>
                <Expand className="h-4 w-4 mr-1" />
                Expand
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={copyToClipboard}
          >
            {isCopied ? (
              <>
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  className="mr-1"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-1" />
                Copy
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className={`${isExpanded ? 'max-h-[80vh]' : 'max-h-60'} overflow-auto transition-all duration-200 rounded-b-lg`}>
          <pre className="bg-slate-50 dark:bg-slate-950 p-4 m-0 text-sm overflow-auto">
            <code className="text-xs font-mono">{code}</code>
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}