import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Brain,
  Compass,
  Download,
  Home,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Slash,
  Sparkles,
  Trash2,
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
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { SLASH_COMMANDS, SLASH_GROUP_LABELS } from "../../../shared/slash-commands";
import { useSlashCommandContext } from "@/hooks/useSlashCommandContext";
import { runSlashCommand } from "@/lib/slashCommandRunner";

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
  const globalChat = useGlobalOrbChat();
  const utils = trpc.useUtils();
  const clearMemory = trpc.orbProxy.clearAllPreferenceMemory.useMutation({
    onSuccess: result => {
      void utils.orbProxy.getRememberedPreferences.invalidate();
      toast.success(
        result.removed > 0
          ? `已清掉 ${result.removed} 條偏好記憶，光球會重新詢問`
          : "光球本來就還沒記住任何偏好"
      );
    },
    onError: err => toast.error(`清除失敗：${err.message}`),
  });

  // Toggle on ⌘K / Ctrl-K, plus a programmatic event hook so other UI
  // (e.g. dock search button) can open the palette without faking keypresses.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle =
        (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (isToggle) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    function onOpenEvent() {
      setOpen(true);
    }
    function onToggleEvent() {
      setOpen(prev => !prev);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpenEvent);
    window.addEventListener("toggle-command-palette", onToggleEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpenEvent);
      window.removeEventListener("toggle-command-palette", onToggleEvent);
    };
  }, []);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      // small defer so dialog close animation doesn't fight with route change
      setTimeout(() => setLocation(path), 50);
    },
    [setLocation]
  );

  // Send a phrase via the global orb chat. Closes the palette first so the
  // chat panel/transition isn't fighting the dialog dismiss animation, then
  // ensures the chat is open and forwards the message — the existing
  // `sendMessage` already routes to the right shortcut (search / detection /
  // LLM) so we don't need to duplicate that logic here.
  const sendOrbPhrase = useCallback(
    (phrase: string) => {
      setOpen(false);
      setTimeout(() => {
        globalChat.open();
        void globalChat.sendMessage(phrase);
      }, 80);
    },
    [globalChat]
  );

  const openOrbChat = useCallback(() => {
    setOpen(false);
    setTimeout(() => globalChat.open(), 80);
  }, [globalChat]);

  const handleClearMemory = useCallback(() => {
    setOpen(false);
    if (clearMemory.isPending) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "確定要清掉光球記住的所有偏好（風格／平台／用途／模型）嗎？這會讓光球下次重新詢問。"
      );
      if (!ok) return;
    }
    clearMemory.mutate();
  }, [clearMemory]);

  // ─── Slash command 整合：palette 也能呼叫 / 指令（沒有 argument 的那
  //     些）。需要 argument 的指令會把光球面板打開並把指令名稱預填到輸入
  //     框，讓使用者補上參數。
  const slashCtx = useSlashCommandContext();
  const runSlashFromPalette = useCallback(
    async (commandName: string, takesArgument: boolean) => {
      setOpen(false);
      if (takesArgument) {
        // 打開光球面板並把指令名稱預填到輸入框
        setTimeout(() => {
          globalChat.open();
          globalChat.setInput(`${commandName} `);
        }, 80);
        return;
      }
      // 沒參數的指令直接執行
      await runSlashCommand(commandName, slashCtx);
    },
    [slashCtx, globalChat]
  );

  const groups = getSidebarGroups();
  const allPages = getAllPages();

  // Slash commands 按 group 分桶，給 palette 顯示分組
  const slashCommandsByGroup = SLASH_COMMANDS.reduce<
    Record<string, typeof SLASH_COMMANDS[number][]>
  >((acc, cmd) => {
    if (cmd.hidden) return acc;
    const list = acc[cmd.group] ?? [];
    list.push(cmd);
    acc[cmd.group] = list;
    return acc;
  }, {});

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

        <CommandGroup heading="光球動作">
          <CommandItem
            value="orb open chat 對話 聊天"
            onSelect={openOrbChat}
          >
            <Sparkles />
            <div className="flex flex-col gap-0.5">
              <span>打開光球對話</span>
              <span className="text-xs text-muted-foreground">
                跟光球聊天、提問、要求多步驟代辦
              </span>
            </div>
          </CommandItem>
          <CommandItem
            value="orb search find assets 找 搜尋 我的素材 筆記"
            onSelect={() => sendOrbPhrase("找我之前的素材")}
            data-testid="cmdk-orb-search"
          >
            <Search />
            <div className="flex flex-col gap-0.5">
              <span>找我之前的素材</span>
              <span className="text-xs text-muted-foreground">
                跨資產／筆記／生成歷史／教學中心搜尋
              </span>
            </div>
          </CommandItem>
          <CommandItem
            value="orb export pdf chat 匯出 對話 聊天 pdf"
            onSelect={() => sendOrbPhrase("把今天的對話匯出成 PDF")}
            data-testid="cmdk-orb-export-pdf"
          >
            <Download />
            <div className="flex flex-col gap-0.5">
              <span>匯出今天的對話成 PDF</span>
              <span className="text-xs text-muted-foreground">
                打開列印視窗，挑選「另存為 PDF」
              </span>
            </div>
          </CommandItem>
          <CommandItem
            value="orb share workflow link 分享 工作流 連結"
            onSelect={() => sendOrbPhrase("把剛剛的流程做成連結")}
            data-testid="cmdk-orb-share-workflow"
          >
            <Share2 />
            <div className="flex flex-col gap-0.5">
              <span>分享上一個工作流</span>
              <span className="text-xs text-muted-foreground">
                打包成 /process?spec=… 連結並複製到剪貼簿
              </span>
            </div>
          </CommandItem>
          <CommandItem
            value="orb memory remember preferences 光球 記得 偏好"
            onSelect={() => sendOrbPhrase("光球記得我什麼？")}
            data-testid="cmdk-orb-memory-show"
          >
            <Brain />
            <div className="flex flex-col gap-0.5">
              <span>看光球記得我什麼</span>
              <span className="text-xs text-muted-foreground">
                秀出風格／平台／用途偏好的儀表板
              </span>
            </div>
          </CommandItem>
          <CommandItem
            value="orb clear memory reset preferences 清除 重置 記憶 偏好"
            onSelect={handleClearMemory}
            data-testid="cmdk-orb-memory-clear"
          >
            <Trash2 />
            <div className="flex flex-col gap-0.5">
              <span>清除光球的所有記憶偏好</span>
              <span className="text-xs text-muted-foreground">
                {clearMemory.isPending ? "清除中…" : "重置風格／平台／用途／模型偏好（會問你確認）"}
              </span>
            </div>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Slash commands — 全套 / 指令系統的入口。給還沒習慣在 chat
            裡直接打 / 的使用者一個發現入口；點選後若需要參數會把光球
            面板打開並預填指令名稱。*/}
        {Object.entries(slashCommandsByGroup).map(([groupId, cmds]) => (
          <CommandGroup
            key={`slash-${groupId}`}
            heading={`Slash · ${SLASH_GROUP_LABELS[groupId as keyof typeof SLASH_GROUP_LABELS] ?? groupId}`}
          >
            {cmds.map(cmd => (
              <CommandItem
                key={cmd.name}
                value={`${cmd.name} ${cmd.aliases.join(" ")} ${cmd.description}`}
                onSelect={() => void runSlashFromPalette(cmd.name, cmd.takesArgument)}
                data-testid={`cmdk-slash-${cmd.name.slice(1)}`}
              >
                <Slash />
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-sm">{cmd.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {cmd.description}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

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
