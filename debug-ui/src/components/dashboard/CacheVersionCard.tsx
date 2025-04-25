import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoRow } from './InfoRow';

interface CacheVersionCardProps {
  cacheVersion?: number;
  className?: string;
}

export function CacheVersionCard({ cacheVersion, className }: CacheVersionCardProps) {
  const hasVersionInfo = typeof cacheVersion === 'number';

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium">
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
            className="mr-2 inline-block"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          Cache Version
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasVersionInfo ? (
          <div className="space-y-4">
            <InfoRow label="Current Version" value={cacheVersion.toString()} />
            <p className="text-xs text-muted-foreground mt-2">
              Cache versioning allows automatic cache busting when needed
            </p>
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center rounded-md border border-dashed p-4">
            <p className="text-center text-muted-foreground text-sm">
              No cache version information available
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}