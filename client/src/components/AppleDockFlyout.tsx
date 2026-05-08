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
          "apple-dock-flyout w-[218px] p-1.5 border-0",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        )}
      >
        {title && (
          <div className="apple-dock-flyout-header">
            <span className="apple-dock-flyout-title">{title}</span>
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
                  aria-current={item.isActive ? "page" : undefined}
                  className="apple-dock-flyout-item"
                >
                  <span aria-hidden="true" className="apple-dock-flyout-item-bg" />
                  <Icon
                    className="relative h-4 w-4 shrink-0 apple-dock-flyout-item-icon"
                    strokeWidth={item.isActive ? 2 : 1.85}
                  />
                  <span className="relative truncate">{item.label}</span>
                  {item.isActive && (
                    <span
                      aria-hidden="true"
                      className="apple-dock-flyout-item-pin"
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
