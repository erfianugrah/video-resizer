import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Edit, Copy, CheckCheck } from 'lucide-react';

// Simplified JSON viewer component with syntax highlighting
function JsonView({ data, title }: { data: any; title: string }) {
  const [copied, setCopied] = useState(false);
  
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
        <Button
          variant="ghost"
          size="sm"
          onClick={copyToClipboard}
          className="h-8 px-2"
        >
          {copied ? <CheckCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="ml-1">{copied ? 'Copied!' : 'Copy'}</span>
        </Button>
      </div>
      <pre className="overflow-auto bg-muted/50 p-4 text-xs">
        <code>{formattedData}</code>
      </pre>
    </div>
  );
}

// Main component for configuration viewing
export function ConfigurationViewer({ configuration }: { configuration: Record<string, any> }) {
  const hasVideoConfig = configuration?.videoConfig && Object.keys(configuration.videoConfig).length > 0;
  const hasCacheConfig = configuration?.cacheConfig && Object.keys(configuration.cacheConfig).length > 0;
  const hasDebugConfig = configuration?.debugConfig && Object.keys(configuration.debugConfig).length > 0;
  const hasLoggingConfig = configuration?.loggingConfig && Object.keys(configuration.loggingConfig).length > 0;
  const hasEnvironment = configuration?.environment && Object.keys(configuration.environment).length > 0;
  
  // If no configuration is provided, show a placeholder
  if (!hasVideoConfig && !hasCacheConfig && !hasDebugConfig && !hasLoggingConfig && !hasEnvironment) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-medium leading-none">
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
              className="flex-shrink-0"
            >
              <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
            </svg>
            <span className="leading-tight">Configuration</span>
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium leading-none">
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
            className="flex-shrink-0"
          >
            <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
          </svg>
          <span className="leading-tight">Configuration</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={hasVideoConfig ? "video" : hasDebugConfig ? "debug" : "cache"}>
          <TabsList className="mb-4 w-full">
            {hasVideoConfig && <TabsTrigger value="video">Video</TabsTrigger>}
            {hasCacheConfig && <TabsTrigger value="cache">Cache</TabsTrigger>}
            {hasDebugConfig && <TabsTrigger value="debug">Debug</TabsTrigger>}
            {hasLoggingConfig && <TabsTrigger value="logging">Logging</TabsTrigger>}
            {hasEnvironment && <TabsTrigger value="environment">Environment</TabsTrigger>}
          </TabsList>
          
          {hasVideoConfig && (
            <TabsContent value="video" className="space-y-4">
              <JsonView data={configuration.videoConfig} title="Video Configuration" />
            </TabsContent>
          )}
          
          {hasCacheConfig && (
            <TabsContent value="cache" className="space-y-4">
              <JsonView data={configuration.cacheConfig} title="Cache Configuration" />
            </TabsContent>
          )}
          
          {hasDebugConfig && (
            <TabsContent value="debug" className="space-y-4">
              <JsonView data={configuration.debugConfig} title="Debug Configuration" />
            </TabsContent>
          )}
          
          {hasLoggingConfig && (
            <TabsContent value="logging" className="space-y-4">
              <JsonView data={configuration.loggingConfig} title="Logging Configuration" />
            </TabsContent>
          )}
          
          {hasEnvironment && (
            <TabsContent value="environment" className="space-y-4">
              <JsonView data={configuration.environment} title="Environment" />
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}