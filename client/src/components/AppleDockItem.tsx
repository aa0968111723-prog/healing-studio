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
          "apple-dock-item relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[--ring-healing-strong] focus-visible:ring-offset-0",
          "text-foreground/75",
          className
        )}
        {...props}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {isActive && showActiveDot && (
          <span aria-hidden="true" className="apple-dock-active-dot" />
        )}
      </button>
    );

    if (!showTooltip) return button;

    return (
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={tooltipSide} sideOffset={10}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }
);

export default AppleDockItem;
