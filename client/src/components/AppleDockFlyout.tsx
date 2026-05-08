import * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type FlyoutItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  isActive?: boolean;
  onSelect: () => void;
};

type AppleDockFlyoutProps = {
  trigger: React.ReactNode;
  title?: string;
  items: FlyoutItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "right" | "top" | "left" | "bottom";
};

function AppleDockFlyout({
  trigger,
  title,
  items,
  open,
  onOpenChange,
  side = "right",
}: AppleDockFlyoutProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={14}
        className={cn(
          "apple-dock-flyout w-[200px] p-1.5 border-0",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        )}
      >
        {title && (
          <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.16em] uppercase text-muted-foreground/70">
            {title}
          </div>
        )}
        <ul className="flex flex-col gap-0.5">
          {items.map(item => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    item.onSelect();
                    onOpenChange(false);
                  }}
                  data-active={item.isActive ? "true" : "false"}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-sm transition-colors",
                    "hover:bg-foreground/8",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)",
                    item.isActive
                      ? "bg-foreground/10 text-foreground font-medium"
                      : "text-foreground/85"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      item.isActive ? "text-primary" : "text-foreground/70"
                    )}
                    strokeWidth={1.75}
                  />
                  <span className="truncate">{item.label}</span>
                  {item.isActive && (
                    <span
                      aria-hidden="true"
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default AppleDockFlyout;
export type { FlyoutItem };
