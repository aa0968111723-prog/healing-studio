import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type AppleDockItemProps = {
  icon: LucideIcon;
  label: string;
  isActive?: boolean;
  showActiveDot?: boolean;
  showTooltip?: boolean;
  asChild?: boolean;
  className?: string;
  tooltipSide?: "right" | "top" | "left" | "bottom";
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;

const AppleDockItem = React.forwardRef<HTMLButtonElement, AppleDockItemProps>(
  function AppleDockItem(
    {
      icon: Icon,
      label,
      isActive = false,
      showActiveDot = true,
      showTooltip = true,
      className,
      tooltipSide = "right",
      ...props
    },
    ref
  ) {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
        data-active={isActive ? "true" : "false"}
        className={cn(
          "apple-dock-item group relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong) focus-visible:ring-offset-0",
          "text-foreground/80",
          className
        )}
        {...props}
      >
        {/* Outer side rail — appears on the dock's outer edge when active */}
        {isActive && (
          <span aria-hidden="true" className="apple-dock-side-rail" />
        )}
        {/* Soft inner halo on hover for a magnetic, breathing feel */}
        <span aria-hidden="true" className="apple-dock-halo" />
        <Icon
          className="apple-dock-icon relative h-[19px] w-[19px]"
          strokeWidth={isActive ? 2 : 1.85}
        />
        {isActive && showActiveDot && (
          <span aria-hidden="true" className="apple-dock-active-dot" />
        )}
      </button>
    );

    if (!showTooltip) return button;

    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          side={tooltipSide}
          sideOffset={12}
          className="apple-dock-tooltip"
        >
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }
);

export default AppleDockItem;
