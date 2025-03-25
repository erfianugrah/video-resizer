import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/utils/cn';
import type { Icon as LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  subtitle?: string;
  value: string | number;
  icon: LucideIcon;
  className?: string;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

export function StatCard({
  title,
  subtitle,
  value,
  icon: Icon,
  className,
  variant = 'default',
}: StatCardProps) {
  const iconClasses = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-green-500/10 text-green-500',
    warning: 'bg-amber-500/10 text-amber-500',
    error: 'bg-destructive/10 text-destructive',
    info: 'bg-blue-500/10 text-blue-500',
  };

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-6">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
              iconClasses[variant]
            )}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
            <p className="text-2xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}