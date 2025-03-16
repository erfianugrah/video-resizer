import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigurationViewer } from './ConfigurationViewer';

export function renderConfigurationViewer(containerSelector: string, configuration: Record<string, any>): void {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  
  const root = createRoot(container);
  root.render(<ConfigurationViewer configuration={configuration} />);
}