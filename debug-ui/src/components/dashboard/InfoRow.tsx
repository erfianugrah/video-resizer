import { cn } from '@/utils/cn';
import React from 'react';

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export function InfoRow({ label, value, className }: InfoRowProps) {
  return (
    <div className={cn('border-b py-3 px-4 last:border-0 flex flex-wrap items-center', className)}>
      <div className="w-40 font-medium text-muted-foreground">{label}</div>
      <div className="flex-1 font-mono text-sm">{value}</div>
    </div>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  const variantClasses = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-green-500/10 text-green-500',
    warning: 'bg-amber-500/10 text-amber-500',
    error: 'bg-destructive/10 text-destructive',
    info: 'bg-blue-500/10 text-blue-500',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}