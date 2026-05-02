import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Compass,
  Home,
  RotateCcw,
  Settings,
  Sparkles,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { getSidebarGroups, getAllPages } from "@/config/appRegistry";
import type { AppPageGroupId } from "@/config/appRegistry";
import { useSiteOnboarding } from "@/contexts/SiteOnboardingContext";

const GROUP_LABELS: Record<AppPageGroupId, string> = {
  orb: "光球與首頁",
  create: "創作工坊",
  train: "訓練模型",
  project: "專案紀錄",
  assets: "素材與資料",
  learn: "學習與支援",
  settings: "個人設定",
  admin: "管理員",
};

/**
 * Global ⌘K / Ctrl-K command palette.
 * Renders nothing until activated; subscribes to keydown to toggle.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { startTour } = useSiteOnboarding();

  // Toggle on ⌘K / Ctrl-K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle =
        (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (isToggle) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      // small defer so dialog close animation doesn't fight with route change
      setTimeout(() => setLocation(path), 50);
    },
    [setLocation]
  );

  const groups = getSidebarGroups();
  const allPages = getAllPages();

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="指令面板"
      description="搜尋功能、頁面或快捷指令"
      className="surface-3 border-0 shadow-2xl"
    >
      <CommandInput placeholder="搜尋頁面、功能、設定..." />
      <CommandList>
        <CommandEmpty>沒有找到符合的功能。</CommandEmpty>

        <CommandGroup heading="快捷">
          <CommandItem
            value="home 首頁"
            onSelect={() => navigate("/")}
          >
            <Home />
            <span>回到首頁</span>
            <CommandShortcut>G H</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="agent 光球 助手"
            onSelect={() => navigate("/agent")}
          >
            <Sparkles />
            <span>呼叫光球助手</span>
            <CommandShortcut>G A</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="settings 設定"
            onSelect={() => navigate("/settings")}
          >
            <Settings />
            <span>個人設定</span>
          </CommandItem>
          <CommandItem
            value="onboarding 新手 導覽 教學"
            onSelect={() => {
              setOpen(false);
              setTimeout(() => startTour("welcome", true), 200);
            }}
          >
            <RotateCcw />
            <span>重新開始新手導覽</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {groups.map(group => {
          const pages = group.pages.filter(p => p.path);
          if (pages.length === 0) return null;
          return (
            <CommandGroup
              key={group.groupId}
              heading={GROUP_LABELS[group.groupId] ?? group.groupId}
            >
              {pages.map(item => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.aliases.join(" ")} ${item.description}`}
                  onSelect={() => navigate(item.path)}
                >
                  <ArrowRight />
                  <div className="flex flex-col gap-0.5">
                    <span>{item.label}</span>
                    {item.description && (
                      <span className="text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        <CommandSeparator />

        <CommandGroup heading="所有頁面">
          {allPages
            .filter(p => p.path && !p.showInSidebar)
            .map(page => (
              <CommandItem
                key={`all-${page.id}`}
                value={`${page.label} ${page.aliases.join(" ")}`}
                onSelect={() => navigate(page.path)}
              >
                <Compass />
                <span>{page.label}</span>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
