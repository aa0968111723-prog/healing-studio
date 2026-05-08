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
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="背景任務"
              className="apple-dock-item relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
            >
              {activeCount > 0 ? (
                <Loader2
                  className="h-[18px] w-[18px] animate-spin text-primary"
                  strokeWidth={1.85}
                />
              ) : (
                <ListChecks
                  className="h-[18px] w-[18px]"
                  strokeWidth={1.85}
                />
              )}
              {activeCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-[oklch(0.6_0.18_30)] to-[oklch(0.55_0.16_350)] text-white text-[10px] font-bold flex items-center justify-center tabular-nums shadow-[0_2px_8px_oklch(0.55_0.16_30/0.5)]"
                >
                  {activeCount > 9 ? "9+" : activeCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={popoverSide} sideOffset={10}>
          背景任務{activeCount > 0 ? ` · ${activeCount} 進行中` : ""}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side={popoverSide}
        align="end"
        sideOffset={14}
        className="apple-dock-flyout w-[280px] p-2 border-0"
      >
        <div className="px-2.5 pt-1 pb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-muted-foreground/70">
            背景任務
          </span>
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
        "hidden md:block fixed top-1/2 -translate-y-1/2 z-30",
        sideClass
      )}
    >
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="展開導覽列"
            onClick={onExpand}
            className="apple-dock-bubble relative flex h-12 w-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong) transition-transform hover:scale-110 active:scale-95"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.99 0.005 75 / 0.85), oklch(0.96 0.02 300 / 0.75))",
              backdropFilter: "blur(20px) saturate(160%)",
              WebkitBackdropFilter: "blur(20px) saturate(160%)",
              border: "1px solid oklch(1 0 0 / 0.5)",
            }}
          >
            <AvatarRenderer
              avatarUrl={user?.avatarUrl ?? null}
              fallback={displayInitial}
              className="h-10 w-10"
            />
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-gradient-to-br from-[oklch(0.55_0.1_300)] to-[oklch(0.5_0.1_320)] border-2 border-background shadow-[0_0_8px_oklch(0.55_0.12_300/0.6)]"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={position === "left" ? "right" : "left"}
          sideOffset={12}
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
        "hidden md:flex fixed top-1/2 -translate-y-1/2 z-30 flex-col items-center gap-1.5 px-1.5 py-2 apple-dock-glass max-h-[calc(100svh-1.5rem)] overflow-y-auto no-scrollbar overscroll-contain",
        sideClass,
        position === "right" && "apple-dock-right"
      )}
    >
      {/* ── Compact controls header: minimize + position toggle ── */}
      <div className="flex items-center gap-0.5 -mt-0.5 mb-0.5 opacity-65 hover:opacity-100 transition-opacity">
        <Tooltip delayDuration={350}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="最小化導覽列"
              onClick={onToggleMinimized}
              className="apple-dock-item flex h-5 w-5 items-center justify-center rounded-full text-foreground/50 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
            >
              <Minus className="h-3 w-3" strokeWidth={2.4} />
            </button>
          </TooltipTrigger>
          <TooltipContent side={popoverSide} sideOffset={10}>
            最小化導覽列
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={350}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={
                position === "left" ? "移到右側" : "移到左側"
              }
              onClick={onTogglePosition}
              className="apple-dock-item flex h-5 w-5 items-center justify-center rounded-full text-foreground/50 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
            >
              <TogglePositionIcon className="h-3 w-3" strokeWidth={2.2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side={popoverSide} sideOffset={10}>
            {position === "left" ? "移到右側" : "移到左側"}
          </TooltipContent>
        </Tooltip>
      </div>

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
          <Tooltip delayDuration={350}>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard?section=credits"
                aria-label="查看積分"
                className="apple-dock-item relative flex h-11 w-11 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong)"
              >
                <Zap className="h-[18px] w-[18px]" strokeWidth={1.85} />
                <span
                  aria-hidden="true"
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 min-w-[22px] px-1 h-[14px] rounded-full bg-gradient-to-br from-[oklch(0.45_0.07_300)] to-[oklch(0.4_0.08_320)] text-white text-[9px] font-semibold flex items-center justify-center tabular-nums leading-none shadow-[0_2px_6px_oklch(0.45_0.08_300/0.45)]"
                >
                  {user?.remainingGenerations ?? 0}
                </span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side={popoverSide} sideOffset={10}>
              剩餘配額 · {user?.remainingGenerations ?? 0}
            </TooltipContent>
          </Tooltip>
        </div>

        <div
          className="apple-dock-stagger"
          style={staggerDelay(staggerIndex++)}
        >
          <DropdownMenu>
            <Tooltip delayDuration={350}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="使用者選單"
                    className="apple-dock-item flex h-11 w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong) shadow-[0_4px_12px_-4px_oklch(0.55_0.1_300/0.35)]"
                  >
                    <AvatarRenderer
                      avatarUrl={user?.avatarUrl ?? null}
                      fallback={displayInitial}
                      className="h-9 w-9 ring-1 ring-foreground/10"
                    />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side={popoverSide} sideOffset={10}>
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
