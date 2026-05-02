import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface LoadingCardProps {
  /** Number of body lines to show. Default 3. */
  lines?: number;
  /** Show a header row (avatar/title) above the body lines. Default true. */
  header?: boolean;
  /** Optional aria-label for screen readers. */
  label?: string;
  className?: string;
}

/**
 * LoadingCard — composable skeleton matching `.glass-card-static` rhythm.
 * Use as a Suspense fallback or inline placeholder while content streams in.
 */
export function LoadingCard({
  lines = 3,
  header = true,
  label = "載入中…",
  className,
}: LoadingCardProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn(
        "glass-card-static flex flex-col gap-4 p-5",
        className
      )}
    >
      {header && (
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
          />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
