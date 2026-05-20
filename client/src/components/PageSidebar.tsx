import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Reusable in-page sidebar that complements (not replaces) the global
 * AppleDock. Drop into any studio/page that needs sticky filters, params,
 * or a results column with consistent width, sticky behaviour, and a
 * collapse affordance — without each page re-implementing `lg:sticky
 * lg:top-14 lg:max-h-[calc(100vh-4rem)]` style strings.
 *
 * Consumes the layout tokens introduced by the design-system pass:
 *   --page-sticky-panel-max-h  (max-height while sticky)
 *   --sidebar / --sidebar-border  (glass material colours)
 *
 * Persistence: pass `storageKey` to remember the collapsed state per page.
 * Two width tiers cover the common cases; pass `widthClass` for one-offs.
 */

type PageSidebarProps = {
  /** Which edge the sidebar lives on. Default: right. */
  side?: "left" | "right";
  /** Width tier — maps to a Tailwind width class. */
  width?: "narrow" | "default" | "wide";
  /** Tailwind class override for width (takes precedence over `width`). */
  widthClass?: string;
  /** Sticky to the viewport while scrolling. Default: true. */
  sticky?: boolean;
  /** Top offset (Tailwind class) when sticky. Default: top-4. */
  stickyTopClass?: string;
  /** Show a header with title + collapse button. */
  title?: React.ReactNode;
  /** Sub-title rendered under the title (muted). */
  description?: React.ReactNode;
  /** Render a collapse toggle in the header. Default: true. */
  collapsible?: boolean;
  /** localStorage key for persisting collapsed state. */
  storageKey?: string;
  /** Controlled collapsed state. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  /** Extra slot rendered next to the collapse button. */
  headerActions?: React.ReactNode;
  children?: React.ReactNode;
};

const WIDTH_CLASSES: Record<NonNullable<PageSidebarProps["width"]>, string> = {
  narrow: "lg:w-72 xl:w-80",
  default: "lg:w-[340px] xl:w-[380px]",
  wide: "lg:w-[420px] xl:w-[460px]",
};

const COLLAPSED_WIDTH_CLASS = "lg:w-12";

function readPersistedCollapsed(key: string | undefined): boolean {
  if (!key || typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "1";
}

export function PageSidebar({
  side = "right",
  width = "default",
  widthClass,
  sticky = true,
  stickyTopClass = "lg:top-4",
  title,
  description,
  collapsible = true,
  storageKey,
  collapsed: collapsedProp,
  onCollapsedChange,
  className,
  headerActions,
  children,
}: PageSidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = React.useState(() =>
    readPersistedCollapsed(storageKey),
  );
  const isControlled = collapsedProp !== undefined;
  const collapsed = isControlled ? !!collapsedProp : internalCollapsed;

  const setCollapsed = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalCollapsed(next);
      onCollapsedChange?.(next);
      if (storageKey && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      }
    },
    [isControlled, onCollapsedChange, storageKey],
  );

  const expandedWidth = widthClass ?? WIDTH_CLASSES[width];
  // Collapse to a slim rail on lg+; on small screens we stay full-width and
  // hide the body (header still visible so the user can re-expand).
  const widthCls = collapsed ? COLLAPSED_WIDTH_CLASS : expandedWidth;

  // Chevron points toward the direction that opens the sidebar so the
  // affordance reads correctly regardless of which side it lives on.
  const ChevronIcon = (() => {
    if (side === "right") return collapsed ? ChevronLeft : ChevronRight;
    return collapsed ? ChevronRight : ChevronLeft;
  })();

  return (
    <aside
      data-page-sidebar=""
      data-side={side}
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "page-sidebar group/page-sidebar shrink-0 w-full",
        widthCls,
        sticky && "lg:sticky lg:self-start",
        sticky && stickyTopClass,
        side === "left" ? "lg:order-first" : "lg:order-last",
        "transition-[width] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
        className,
      )}
    >
      <div
        className={cn(
          "page-sidebar-surface relative flex h-full flex-col overflow-hidden",
          "rounded-2xl border border-[color:var(--sidebar-border)]",
          "bg-[color:var(--surface-1)] backdrop-blur-xl",
          "shadow-[var(--shadow-healing-md)]",
        )}
        style={{ maxHeight: sticky ? "var(--page-sticky-panel-max-h)" : undefined }}
      >
        {(title || collapsible || headerActions) && (
          <header
            className={cn(
              "flex items-center gap-2 border-b border-[color:var(--sidebar-border)]",
              "px-3 py-2.5",
              collapsed && "px-2 justify-center",
            )}
          >
            {!collapsed && (
              <div className="min-w-0 flex-1">
                {title && (
                  <h3 className="text-sm font-medium truncate text-foreground">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {description}
                  </p>
                )}
              </div>
            )}
            {!collapsed && headerActions}
            {collapsible && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? "展開側欄" : "收合側欄"}
                aria-expanded={!collapsed}
                className="h-7 w-7 shrink-0"
              >
                <ChevronIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </header>
        )}
        {!collapsed && (
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-3">
            {children}
          </div>
        )}
      </div>
    </aside>
  );
}

export default PageSidebar;
