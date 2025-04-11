import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Copy, CheckCheck, Minimize, Expand } from 'lucide-react';

// Simplified JSON viewer component with syntax highlighting
function JsonView({ data, title, globalExpanded }: { data: any; title: string; globalExpanded: boolean }) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Update local expansion state when global state changes
  React.useEffect(() => {
    setIsExpanded(globalExpanded);
  }, [globalExpanded]);
  
  // Format data for display
  const formattedData = JSON.stringify(data, null, 2);
  
  // Copy to clipboard function
  const copyToClipboard = () => {
    navigator.clipboard.writeText(formattedData).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center justify-between bg-muted px-4 py-2">
        <h3 className="font-medium">{title}</h3>
        <div className="flex gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 px-2"
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
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
            className="h-8 px-2"
          >
            {copied ? <CheckCheck className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </Button>
        </div>
      </div>
      <div className={`${isExpanded ? 'max-h-[60vh]' : 'max-h-60'} overflow-auto transition-all duration-200 w-full`}>
        <pre className="bg-muted/50 p-4 m-0 text-xs overflow-x-auto whitespace-pre-wrap break-words">
          <code>{formattedData}</code>
        </pre>
      </div>
    </div>
  );
}

// Main component for configuration viewing
export function ConfigurationViewer({ configuration }: { 
  configuration: {
    videoConfig?: Record<string, any>;
    cacheConfig?: Record<string, any>;
    debugConfig?: Record<string, any>;
    loggingConfig?: Record<string, any>;
    environment?: Record<string, any>;
    performanceMetrics?: {
      totalElapsedMs: number;
      componentTiming?: Record<string, number>;
      breadcrumbCount: number;
    };
    componentTiming?: Record<string, number>;
  } 
}) {
  const [allExpanded, setAllExpanded] = useState(false);
  
  const hasVideoConfig = configuration?.videoConfig && Object.keys(configuration.videoConfig).length > 0;
  const hasCacheConfig = configuration?.cacheConfig && Object.keys(configuration.cacheConfig).length > 0;
  const hasDebugConfig = configuration?.debugConfig && Object.keys(configuration.debugConfig).length > 0;
  const hasLoggingConfig = configuration?.loggingConfig && Object.keys(configuration.loggingConfig).length > 0;
  const hasEnvironment = configuration?.environment && Object.keys(configuration.environment).length > 0;
  const hasPerformanceMetrics = 
    (configuration?.performanceMetrics && Object.keys(configuration.performanceMetrics).length > 0) ||
    (configuration?.componentTiming && Object.keys(configuration.componentTiming).length > 0);
  
  // If no configuration is provided, show a placeholder
  if (!hasVideoConfig && !hasCacheConfig && !hasDebugConfig && !hasLoggingConfig && !hasEnvironment && !hasPerformanceMetrics) {
    return (
      <Card>
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
              <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
            </svg>
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-center justify-center rounded-md border border-dashed p-4">
            <p className="text-center text-muted-foreground">
              No configuration data available.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
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
            <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
          </svg>
          Configuration
        </CardTitle>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setAllExpanded(!allExpanded)}
        >
          {allExpanded ? (
            <>
              <Minimize className="h-4 w-4 mr-1" />
              Collapse All
            </>
          ) : (
            <>
              <Expand className="h-4 w-4 mr-1" />
              Expand All
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={hasVideoConfig ? 'video' : hasDebugConfig ? 'debug' : 'cache'}>
          <TabsList className="mb-4 w-full">
            {hasVideoConfig && <TabsTrigger value="video">Video</TabsTrigger>}
            {hasCacheConfig && <TabsTrigger value="cache">Cache</TabsTrigger>}
            {hasDebugConfig && <TabsTrigger value="debug">Debug</TabsTrigger>}
            {hasLoggingConfig && <TabsTrigger value="logging">Logging</TabsTrigger>}
            {hasEnvironment && <TabsTrigger value="environment">Environment</TabsTrigger>}
            {hasPerformanceMetrics && <TabsTrigger value="performance">Performance</TabsTrigger>}
          </TabsList>
          
          {hasVideoConfig && (
            <TabsContent value="video" className="space-y-4">
              <JsonView data={configuration.videoConfig} title="Video Configuration" globalExpanded={allExpanded} />
            </TabsContent>
          )}
          
          {hasCacheConfig && (
            <TabsContent value="cache" className="space-y-4">
              <JsonView data={configuration.cacheConfig} title="Cache Configuration" globalExpanded={allExpanded} />
            </TabsContent>
          )}
          
          {hasDebugConfig && (
            <TabsContent value="debug" className="space-y-4">
              <JsonView data={configuration.debugConfig} title="Debug Configuration" globalExpanded={allExpanded} />
            </TabsContent>
          )}
          
          {hasLoggingConfig && (
            <TabsContent value="logging" className="space-y-4">
              <JsonView data={configuration.loggingConfig} title="Logging Configuration" globalExpanded={allExpanded} />
            </TabsContent>
          )}
          
          {hasEnvironment && (
            <TabsContent value="environment" className="space-y-4">
              <JsonView data={configuration.environment} title="Environment" globalExpanded={allExpanded} />
            </TabsContent>
          )}
          
          {hasPerformanceMetrics && (
            <TabsContent value="performance" className="space-y-4">
              {configuration.performanceMetrics && (
                <JsonView data={configuration.performanceMetrics} title="Performance Metrics" globalExpanded={allExpanded} />
              )}
              {configuration.componentTiming && !configuration.performanceMetrics?.componentTiming && (
                <JsonView data={configuration.componentTiming} title="Component Timing" globalExpanded={allExpanded} />
              )}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}