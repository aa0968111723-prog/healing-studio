import * as React from "react";
import { Link } from "wouter";
import {
  ListChecks,
  LogOut,
  Home,
  Settings,
  Shield,
  Sparkles,
  Loader2,
  Zap,
  Minus,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Search,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme, type AppearanceMode } from "@/contexts/ThemeContext";
import { AvatarRenderer } from "@/components/AvatarStudio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
import { cn } from "@/lib/utils";
import AppleDockItem from "./AppleDockItem";
import AppleDockFlyout, { type FlyoutItem } from "./AppleDockFlyout";

// ─── Types matching DashboardLayout's sidebar entries ───────────────────────

export type DockLeaf = {
  kind: "leaf";
  id: string;
  pageId: string;
  label: string;
  icon: LucideIcon;
  path: string;
};

export type DockGroup = {
  kind: "group";
  label: string;
  icon: LucideIcon;
  children: DockLeaf[];
};

export type DockEntry = DockLeaf | DockGroup;

export type DockPosition = "left" | "right" | "top" | "bottom";
export type DockOrientation = "vertical" | "horizontal";

export function dockOrientation(position: DockPosition): DockOrientation {
  return position === "top" || position === "bottom" ? "horizontal" : "vertical";
}

type AppleDockProps = {
  entries: DockEntry[];
  activePath: string;
  onNavigate: (path: string) => void;
  user: {
    email?: string | null;
    remainingGenerations?: number | null;
    avatarUrl?: string | null;
  } | null;
  displayName: string;
  displayInitial: string;
  isAdmin: boolean;
  onLogout: () => void;
  onRestartTour: () => void;
  position: DockPosition;
  onCyclePosition: () => void;
  onSetPosition?: (position: DockPosition) => void;
  minimized: boolean;
  onToggleMinimized: () => void;
  immersive: boolean;
  onToggleImmersive: () => void;
};

// ─── Background tasks dock trigger ──────────────────────────────────────────

function BackgroundTasksDockButton({
  popoverSide,
  tooltipSide,
}: {
  popoverSide: "left" | "right" | "top" | "bottom";
  tooltipSide: "left" | "right" | "top" | "bottom";
}) {
  const { tasks, activeCount } = useBackgroundTasks();
  const [open, setOpen] = React.useState(false);

  const activeTasks = tasks.filter(
    t => t.status === "queued" || t.status === "processing"
  );
  const recentTasks = tasks.filter(
    t =>
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "cancelled"
  );

  const hasAny = tasks.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="背景任務"
              data-active={activeCount > 0 ? "soft" : "false"}
              className="apple-dock-item group relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
            >
              <span aria-hidden="true" className="apple-dock-halo" />
              {activeCount > 0 ? (
                <Loader2
                  className="apple-dock-icon relative h-[19px] w-[19px] animate-spin text-primary"
                  strokeWidth={1.95}
                />
              ) : (
                <ListChecks
                  className="apple-dock-icon relative h-[19px] w-[19px]"
                  strokeWidth={1.85}
                />
              )}
              {activeCount > 0 && (
                <span
                  aria-hidden="true"
                  className="apple-dock-count-badge"
                >
                  {activeCount > 9 ? "9+" : activeCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent
          side={tooltipSide}
          sideOffset={12}
          className="apple-dock-tooltip"
        >
          背景任務{activeCount > 0 ? ` · ${activeCount} 進行中` : ""}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side={popoverSide}
        align="end"
        sideOffset={14}
        className="apple-dock-flyout w-[280px] p-2 border-0"
      >
        <div className="apple-dock-flyout-header flex items-center justify-between">
          <span className="apple-dock-flyout-title">背景任務</span>
          {activeCount > 0 && (
            <span className="text-[10px] font-medium text-primary tabular-nums">
              {activeCount} 進行中
            </span>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto no-scrollbar">
          {!hasAny && (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
              目前沒有背景任務
            </p>
          )}
          {activeTasks.length > 0 && (
            <div className="space-y-0.5">
              {activeTasks.map(t => (
                <div
                  key={t.jobId}
                  className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 hover:bg-foreground/5"
                >
                  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
                  <span className="text-xs text-foreground/85 truncate flex-1">
                    {t.label || t.studioType}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    生成中
                  </span>
                </div>
              ))}
            </div>
          )}
          {recentTasks.length > 0 && (
            <>
              {activeTasks.length > 0 && <div className="apple-dock-divider" />}
              <div className="space-y-0.5">
                {recentTasks.slice(0, 5).map(t => (
                  <div
                    key={t.jobId}
                    className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 hover:bg-foreground/5"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        t.status === "completed"
                          ? "bg-emerald-500"
                          : "bg-muted-foreground/50"
                      )}
                    />
                    <span className="text-xs text-foreground/75 truncate flex-1">
                      {t.label || t.studioType}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t.status === "completed" ? "完成" : "結束"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Position helpers ───────────────────────────────────────────────────────

function bubblePositionClasses(position: DockPosition): string {
  switch (position) {
    case "left":
      return "left-3 top-1/2 -translate-y-1/2";
    case "right":
      return "right-3 top-1/2 -translate-y-1/2";
    case "top":
      return "top-3 left-1/2 -translate-x-1/2";
    case "bottom":
      return "bottom-3 left-1/2 -translate-x-1/2";
  }
}

function bubbleTooltipSide(
  position: DockPosition
): "left" | "right" | "top" | "bottom" {
  switch (position) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
}

// Choose where flyouts/dropdowns/tooltips should expand from, given dock side.
// Items that sit on the dock's outer edge (popovers) should open AWAY from
// that edge — opposite of the dock side.
function popoverAwaySide(
  position: DockPosition
): "left" | "right" | "top" | "bottom" {
  return bubbleTooltipSide(position);
}

// ─── Theme cycle button ─────────────────────────────────────────────────────

function ThemeToggleDockButton({
  tooltipSide,
}: {
  tooltipSide: "left" | "right" | "top" | "bottom";
}) {
  const { appearanceMode, setAppearanceMode, theme } = useTheme();

  const cycle = () => {
    const order: AppearanceMode[] = ["light", "dark", "system"];
    const normalized: AppearanceMode =
      appearanceMode === "auto" ? "system" : appearanceMode;
    const currentIdx = order.indexOf(normalized);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % order.length;
    setAppearanceMode(order[nextIdx]);
  };

  const Icon =
    appearanceMode === "system" || appearanceMode === "auto"
      ? Laptop
      : theme === "dark"
        ? Moon
        : Sun;

  const label =
    appearanceMode === "light"
      ? "外觀：明亮"
      : appearanceMode === "dark"
        ? "外觀：深色"
        : "外觀：跟隨系統";

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={cycle}
          className="apple-dock-item group relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
        >
          <span aria-hidden="true" className="apple-dock-halo" />
          <Icon
            className="apple-dock-icon relative h-[19px] w-[19px]"
            strokeWidth={1.85}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={tooltipSide}
        sideOffset={12}
        className="apple-dock-tooltip"
      >
        {label}（點擊切換）
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Minimized "bubble" form ────────────────────────────────────────────────

function MinimizedBubble({
  position,
  user,
  displayInitial,
  onExpand,
}: {
  position: DockPosition;
  user: AppleDockProps["user"];
  displayInitial: string;
  onExpand: () => void;
}) {
  return (
    <div
      className={cn(
        "block fixed z-30",
        bubblePositionClasses(position)
      )}
    >
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="展開導覽列"
            onClick={onExpand}
            className="apple-dock-bubble relative flex h-12 w-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
          >
            <span aria-hidden="true" className="apple-dock-bubble-glow" />
            <AvatarRenderer
              avatarUrl={user?.avatarUrl ?? null}
              fallback={displayInitial}
              className="h-10 w-10 relative"
            />
            <span
              aria-hidden="true"
              className="apple-dock-bubble-pip"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={bubbleTooltipSide(position)}
          sideOffset={12}
          className="apple-dock-tooltip"
        >
          展開導覽列
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Main AppleDock ─────────────────────────────────────────────────────────

function AppleDock({
  entries,
  activePath,
  onNavigate,
  user,
  displayName,
  displayInitial,
  isAdmin,
  onLogout,
  onRestartTour,
  position,
  onSetPosition,
  minimized,
  onToggleMinimized,
  immersive,
  onToggleImmersive,
}: AppleDockProps) {
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);
  const [revealed, setRevealed] = React.useState(false);

  const handleNavigate = React.useCallback(
    (path: string) => {
      onNavigate(path);
      setOpenGroup(null);
    },
    [onNavigate]
  );

  // ── While immersive AND revealed, watch the pointer globally so that the
  //    dock only auto-hides after the cursor has truly left both the nav and
  //    any portalled Radix popover (flyouts, dropdown, tasks popover). The
  //    delay also bridges the small sideOffset gap when moving from the dock
  //    into a child popover. ───────────────────────────────────────────────
  React.useEffect(() => {
    if (!immersive || !revealed) return;

    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const isInSafeZone = (el: Element | null): boolean => {
      if (!el) return false;
      return (
        el.closest("#sidebar-nav") !== null ||
        el.closest("[data-radix-popper-content-wrapper]") !== null ||
        el.closest(".apple-dock-peek-zone") !== null
      );
    };

    const cancelHide = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };

    const scheduleHide = () => {
      if (hideTimer) return;
      hideTimer = setTimeout(() => {
        setRevealed(false);
        hideTimer = null;
      }, 350);
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Keep visible while keyboard focus lives in the dock or its popovers.
      const focused = document.activeElement;
      if (
        focused &&
        focused !== document.body &&
        isInSafeZone(focused as Element)
      ) {
        cancelHide();
        return;
      }
      const target = e.target as Element | null;
      if (isInSafeZone(target)) {
        cancelHide();
      } else {
        scheduleHide();
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      cancelHide();
    };
  }, [immersive, revealed]);

  // ── ESC behaviour in immersive mode:
  //    1) If the dock is currently peeked → retract it.
  //    2) Otherwise → exit immersive mode entirely.
  //    Pairs with the floating "退出沉浸" button below so users always have a
  //    discoverable way out (mouse + keyboard). ─────────────────────────────
  React.useEffect(() => {
    if (!immersive) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (revealed) {
        setRevealed(false);
      } else {
        onToggleImmersive();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [immersive, revealed, onToggleImmersive]);

  if (minimized) {
    return (
      <MinimizedBubble
        position={position}
        user={user}
        displayInitial={displayInitial}
        onExpand={onToggleMinimized}
      />
    );
  }

  const orientation = dockOrientation(position);
  const isHorizontal = orientation === "horizontal";

  const positionClasses = (() => {
    switch (position) {
      case "left":
        return "left-3 top-1/2 -translate-y-1/2";
      case "right":
        return "right-3 top-1/2 -translate-y-1/2";
      case "top":
        return "top-3 left-1/2 -translate-x-1/2";
      case "bottom":
        return "bottom-3 left-1/2 -translate-x-1/2";
    }
  })();

  const popoverSide = popoverAwaySide(position);
  const tooltipSide = popoverSide;

  // ── Compose stagger animation delays so items wave in on first mount ──
  let staggerIndex = 0;
  const staggerDelay = (i: number) => ({
    animationDelay: `${i * 45}ms`,
  });

  // Open command palette via the global event we wired in CommandPalette.tsx
  const openCommandPalette = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-command-palette"));
  }, []);

  // In immersive mode the nav is hidden but reveals on hover/focus
  const immersiveHidden = immersive && !revealed;

  return (
    <>
      {/* ── Immersive-mode peek zone: an invisible hit strip + breathing pip
            on the viewport edge. Lives OUTSIDE the nav so it stays hoverable
            while the dock body is translated offscreen. Supports touch /
            click for devices without hover. ─────────────────────────────── */}
      {immersive && !revealed && (
        <button
          type="button"
          aria-label="顯示導覽列"
          data-position={position}
          className="apple-dock-peek-zone"
          onMouseEnter={() => setRevealed(true)}
          onClick={() => setRevealed(true)}
          onTouchStart={() => setRevealed(true)}
        >
          <span aria-hidden="true" className="apple-dock-peek-pip" />
        </button>
      )}

      {/* ── Persistent exit-immersive pill: top-right corner so it never
            overlaps the centered peek strip on any dock side. Always visible
            while immersive is on (whether peek is open or not), giving users
            a one-click way out alongside the ESC shortcut. ──────────────── */}
      {immersive && (
        <button
          type="button"
          onClick={onToggleImmersive}
          className="apple-dock-immersive-exit"
          aria-label="退出沉浸模式"
        >
          <Eye className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          <span>退出沉浸</span>
          <kbd aria-hidden="true">ESC</kbd>
        </button>
      )}

      <nav
        id="sidebar-nav"
        aria-label="主導覽"
        data-position={position}
        data-orientation={orientation}
        data-immersive={immersive ? "true" : "false"}
        data-immersive-revealed={revealed ? "true" : "false"}
        onMouseEnter={() => immersive && setRevealed(true)}
        onFocus={() => immersive && setRevealed(true)}
        className={cn(
          "flex fixed z-30 apple-dock-glass no-scrollbar overscroll-contain",
          isHorizontal
            ? "flex-row items-center gap-1.5 py-2 px-2.5 overflow-x-auto"
            : "flex-col items-center gap-1.5 px-2 py-2.5 overflow-y-auto",
          positionClasses,
          position === "right" && "apple-dock-right",
          position === "top" && "apple-dock-top",
          position === "bottom" && "apple-dock-bottom",
          immersiveHidden && "apple-dock-immersive-hidden"
        )}
      >
      {/* ── Top cluster: navigation entries ──
            (Window-control triplet — minimize / position / immersive — was
            removed from the dock header. All three actions live in the
            avatar dropdown menu below; the persistent floating exit button
            covers immersive mode for one-click discoverability.) */}
      <div
        className={cn(
          "flex items-center gap-1.5",
          isHorizontal ? "flex-row" : "flex-col"
        )}
      >
        {entries.map((entry, idx) => {
          const itemStyle = staggerDelay(staggerIndex++);
          if (entry.kind === "leaf") {
            const isActive = activePath === entry.path;
            return (
              <div
                key={entry.id}
                className="apple-dock-stagger"
                style={itemStyle}
              >
                <AppleDockItem
                  icon={entry.icon}
                  label={entry.label}
                  isActive={isActive}
                  onClick={() => handleNavigate(entry.path)}
                  id={entry.id}
                  data-pageid={entry.pageId}
                  tooltipSide={tooltipSide}
                />
              </div>
            );
          }

          const hasActiveChild = entry.children.some(
            child => activePath === child.path
          );
          const isOpen = openGroup === entry.label;
          const flyoutItems: FlyoutItem[] = entry.children.map(child => ({
            id: child.id,
            label: child.label,
            icon: child.icon,
            isActive: activePath === child.path,
            onSelect: () => handleNavigate(child.path),
          }));

          return (
            <div
              key={`${entry.label}-${idx}`}
              className="apple-dock-stagger relative"
              style={itemStyle}
            >
              <AppleDockFlyout
                title={entry.label}
                items={flyoutItems}
                open={isOpen}
                onOpenChange={next => setOpenGroup(next ? entry.label : null)}
                side={popoverSide}
                trigger={
                  <AppleDockItem
                    icon={entry.icon}
                    label={entry.label}
                    isActive={hasActiveChild}
                    showActiveDot={hasActiveChild && !isOpen}
                    showTooltip={!isOpen}
                    tooltipSide={tooltipSide}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                  />
                }
              />
              {/* Onboarding-tour anchors: invisible spans that share the
                  group icon's bounding box so the welcome tour can highlight
                  the parent button when targeting a child link id. */}
              {entry.children.map(child => (
                <span
                  key={`anchor-${child.id}`}
                  id={child.id}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* ── Hairline divider ── */}
      <div
        className={cn(
          "apple-dock-divider self-center",
          isHorizontal ? "apple-dock-divider-vertical" : "w-9"
        )}
        aria-hidden="true"
      />

      {/* ── Quick utilities cluster: home · search · theme ── */}
      <div
        className={cn(
          "flex items-center gap-1.5",
          isHorizontal ? "flex-row" : "flex-col"
        )}
      >
        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <AppleDockItem
            icon={Home}
            label="回首頁"
            isActive={activePath === "/"}
            onClick={() => handleNavigate("/")}
            tooltipSide={tooltipSide}
          />
        </div>
        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="搜尋（⌘K）"
                onClick={openCommandPalette}
                className="apple-dock-item group relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
              >
                <span aria-hidden="true" className="apple-dock-halo" />
                <Search
                  className="apple-dock-icon relative h-[19px] w-[19px]"
                  strokeWidth={1.85}
                />
                <span aria-hidden="true" className="apple-dock-kbd-hint">
                  ⌘K
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent
              side={tooltipSide}
              sideOffset={12}
              className="apple-dock-tooltip"
            >
              搜尋與快捷指令 · ⌘K
            </TooltipContent>
          </Tooltip>
        </div>
        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <ThemeToggleDockButton tooltipSide={tooltipSide} />
        </div>
      </div>

      <div
        className={cn(
          "apple-dock-divider self-center",
          isHorizontal ? "apple-dock-divider-vertical" : "w-9"
        )}
        aria-hidden="true"
      />

      {/* ── Bottom cluster: tasks · credits · avatar ── */}
      <div
        className={cn(
          "flex items-center gap-1.5",
          isHorizontal ? "flex-row" : "flex-col"
        )}
      >
        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <BackgroundTasksDockButton
            popoverSide={popoverSide}
            tooltipSide={tooltipSide}
          />
        </div>

        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard?section=credits"
                aria-label="查看積分"
                className="apple-dock-item group relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
              >
                <span aria-hidden="true" className="apple-dock-halo" />
                <Zap
                  className="apple-dock-icon relative h-[19px] w-[19px]"
                  strokeWidth={1.85}
                />
                <span
                  aria-hidden="true"
                  className="apple-dock-credit-badge"
                >
                  {user?.remainingGenerations ?? 0}
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent
              side={tooltipSide}
              sideOffset={12}
              className="apple-dock-tooltip"
            >
              剩餘配額 · {user?.remainingGenerations ?? 0}
            </TooltipContent>
          </Tooltip>
        </div>

        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <DropdownMenu>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="使用者選單"
                    className="apple-dock-avatar group relative flex h-11 w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
                  >
                    <span
                      aria-hidden="true"
                      className="apple-dock-avatar-ring"
                    />
                    <AvatarRenderer
                      avatarUrl={user?.avatarUrl ?? null}
                      fallback={displayInitial}
                      className="h-9 w-9 relative"
                    />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent
                side={tooltipSide}
                sideOffset={12}
                className="apple-dock-tooltip"
              >
                {displayName}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              side={popoverSide}
              align="end"
              sideOffset={14}
              className="w-64 apple-dock-flyout border-0 p-1.5"
            >
              <DropdownMenuLabel className="px-2.5 pb-1.5 pt-1.5">
                <p className="text-sm font-medium truncate text-foreground">
                  {displayName}
                </p>
                <p className="text-xs font-normal text-muted-foreground truncate mt-0.5">
                  {user?.email || "-"}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onNavigate("/")}
                className="cursor-pointer rounded-[10px]"
              >
                <Home className="mr-2 h-4 w-4" />
                <span>首頁</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onNavigate("/settings")}
                className="cursor-pointer rounded-[10px]"
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>個人設定</span>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem
                  onClick={() => onNavigate("/admin")}
                  className="cursor-pointer rounded-[10px]"
                >
                  <Shield className="mr-2 h-4 w-4" />
                  <span>管理後台</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2.5 pt-1 pb-1 text-[10px] font-semibold tracking-[0.18em] uppercase text-muted-foreground/80">
                導覽列位置
              </DropdownMenuLabel>
              {(
                [
                  { value: "left", label: "靠左", icon: ArrowLeft },
                  { value: "top", label: "置頂", icon: ArrowUp },
                  { value: "right", label: "靠右", icon: ArrowRight },
                  { value: "bottom", label: "置底", icon: ArrowDown },
                ] as const
              ).map(opt => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => onSetPosition?.(opt.value)}
                  className="cursor-pointer rounded-[10px]"
                  data-active={position === opt.value ? "true" : "false"}
                >
                  <opt.icon className="mr-2 h-4 w-4" />
                  <span>{opt.label}</span>
                  {position === opt.value && (
                    <span
                      aria-hidden="true"
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
                    />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onToggleImmersive}
                className="cursor-pointer rounded-[10px]"
              >
                {immersive ? (
                  <Eye className="mr-2 h-4 w-4" />
                ) : (
                  <EyeOff className="mr-2 h-4 w-4" />
                )}
                <span>{immersive ? "退出沉浸模式" : "沉浸模式"}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onToggleMinimized}
                className="cursor-pointer rounded-[10px]"
              >
                <Minus className="mr-2 h-4 w-4" />
                <span>最小化導覽列</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onRestartTour}
                className="cursor-pointer rounded-[10px]"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                <span>重新開始導覽</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onLogout}
                className="cursor-pointer rounded-[10px] text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>登出</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </nav>
    </>
  );
}

export default AppleDock;
