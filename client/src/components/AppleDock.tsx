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
  ChevronLeft,
  ChevronRight,
  Minus,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

export type DockPosition = "left" | "right";

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
  onTogglePosition: () => void;
  minimized: boolean;
  onToggleMinimized: () => void;
};

// ─── Background tasks dock trigger ──────────────────────────────────────────

function BackgroundTasksDockButton({ side }: { side: "left" | "right" }) {
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
  const popoverSide = side === "left" ? "right" : "left";

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
          side={popoverSide}
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
  const sideClass = position === "left" ? "left-3" : "right-3";
  return (
    <div
      className={cn(
        "block fixed top-1/2 -translate-y-1/2 z-30",
        sideClass
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
          side={position === "left" ? "right" : "left"}
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
  onTogglePosition,
  minimized,
  onToggleMinimized,
}: AppleDockProps) {
  const [openGroup, setOpenGroup] = React.useState<string | null>(null);

  const handleNavigate = React.useCallback(
    (path: string) => {
      onNavigate(path);
      setOpenGroup(null);
    },
    [onNavigate]
  );

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

  const sideClass = position === "left" ? "left-3" : "right-3";
  const popoverSide = position === "left" ? "right" : "left";
  const TogglePositionIcon =
    position === "left" ? PanelRightClose : PanelLeftClose;

  // ── Compose stagger animation delays so items wave in on first mount ──
  let staggerIndex = 0;
  const staggerDelay = (i: number) => ({
    animationDelay: `${i * 45}ms`,
  });

  return (
    <nav
      id="sidebar-nav"
      aria-label="主導覽"
      data-position={position}
      className={cn(
        "flex fixed top-1/2 -translate-y-1/2 z-30 flex-col items-center gap-1.5 px-2 py-2.5 apple-dock-glass overflow-y-auto no-scrollbar overscroll-contain",
        sideClass,
        position === "right" && "apple-dock-right"
      )}
    >
      {/* ── Compact controls header: minimize + position toggle ── */}
      <div className="apple-dock-controls flex items-center justify-center gap-1">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="最小化導覽列"
              onClick={onToggleMinimized}
              className="apple-dock-control"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side={popoverSide}
            sideOffset={12}
            className="apple-dock-tooltip"
          >
            最小化導覽列
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={
                position === "left" ? "移到右側" : "移到左側"
              }
              onClick={onTogglePosition}
              className="apple-dock-control"
            >
              <TogglePositionIcon className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side={popoverSide}
            sideOffset={12}
            className="apple-dock-tooltip"
          >
            {position === "left" ? "移到右側" : "移到左側"}
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        className="apple-dock-divider w-9 self-center -mt-0.5 mb-0.5"
        aria-hidden="true"
      />

      {/* ── Top cluster: navigation entries ── */}
      <div className="flex flex-col items-center gap-1.5">
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
                  tooltipSide={popoverSide}
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
                    tooltipSide={popoverSide}
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
      <div className="apple-dock-divider w-9 self-center" aria-hidden="true" />

      {/* ── Bottom cluster: tasks · credits · avatar ── */}
      <div className="flex flex-col items-center gap-1.5">
        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <BackgroundTasksDockButton side={position} />
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
              side={popoverSide}
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
                side={popoverSide}
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
              className="w-60 apple-dock-flyout border-0 p-1.5"
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
              <DropdownMenuItem
                onClick={onTogglePosition}
                className="cursor-pointer rounded-[10px]"
              >
                {position === "left" ? (
                  <ChevronRight className="mr-2 h-4 w-4" />
                ) : (
                  <ChevronLeft className="mr-2 h-4 w-4" />
                )}
                <span>{position === "left" ? "移到右側" : "移到左側"}</span>
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
  );
}

export default AppleDock;
