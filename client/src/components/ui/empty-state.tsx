import * as React from "react";
import { Sparkles } from "lucide-react";

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

export interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  /** Use a soft healing blob backdrop behind the icon */
  ambient?: boolean;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  secondaryAction,
  className,
  ambient = true,
}: EmptyStateProps) {
  return (
    <Empty
      className={cn(
        "relative overflow-hidden border-0 surface-1",
        className
      )}
    >
      {ambient && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60 healing-wash-bg"
        />
      )}
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="bg-accent/40 text-accent-foreground size-12 rounded-2xl"
        >
          {icon ?? <Sparkles className="size-6" />}
        </EmptyMedia>
        <EmptyTitle className="text-glass-strong">{title}</EmptyTitle>
        {description && (
          <EmptyDescription className="text-glass-soft">
            {description}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {(action || secondaryAction) && (
        <EmptyContent>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-center">
            {action && (
              <Button variant="healing" size="lg" onClick={action.onClick}>
                {action.label}
              </Button>
            )}
            {secondaryAction && (
              <Button
                variant="ghost"
                size="lg"
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.label}
              </Button>
            )}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}
