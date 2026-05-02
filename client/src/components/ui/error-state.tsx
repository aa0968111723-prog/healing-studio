import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  /** Optional raw error for dev / details disclosure */
  error?: Error | string | null;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = "出了一點小狀況",
  description = "讓我們深呼吸後再試一次。如果問題持續發生，請刷新頁面或聯繫支援。",
  error,
  onRetry,
  retryLabel = "重新嘗試",
  className,
}: ErrorStateProps) {
  return (
    <Empty
      role="alert"
      aria-live="polite"
      className={cn(
        "relative overflow-hidden border-0 surface-1",
        className
      )}
    >
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="size-12 rounded-2xl bg-destructive/10 text-destructive"
        >
          <AlertTriangle className="size-6" />
        </EmptyMedia>
        <EmptyTitle className="text-glass-strong">{title}</EmptyTitle>
        <EmptyDescription className="text-glass-soft">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {onRetry && (
          <Button variant="healing" size="lg" onClick={onRetry}>
            <RefreshCw className="size-4" />
            {retryLabel}
          </Button>
        )}
        {error && (
          <details className="mt-2 max-w-md text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none focus-ring-healing rounded-sm">
              查看錯誤細節
            </summary>
            <pre className="mt-2 overflow-auto rounded-md bg-muted/40 p-3 text-left whitespace-pre-wrap break-all">
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </details>
        )}
      </EmptyContent>
    </Empty>
  );
}
