import React from 'react';
import { ThemeToggle } from './ThemeToggle';
import { createRoot } from 'react-dom/client';

export function renderThemeToggle(containerSelector: string): void {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  
  const root = createRoot(container);
  root.render(<ThemeToggle />);
}