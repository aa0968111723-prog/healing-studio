import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";
import { useLocation, useSearch } from "wouter";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Image as ImageIcon,
  Film,
  Music,
  Cpu,
  Zap,
  BarChart3,
  BookMarked,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
} from "@/contexts/PageAgentContext";

const ImageStudio = lazy(() => import("./ImageStudio"));
const VideoStudio = lazy(() => import("./VideoStudio"));
const ProStudio = lazy(() => import("./ProStudio"));
const ModelsPage = lazy(() => import("./ModelsPage"));
const LoraTrainer = lazy(() => import("./LoraTrainer"));
const DashboardPage = lazy(() => import("./DashboardPage"));
const PromptLibraryPage = lazy(() => import("./PromptLibraryPage"));

type PlaygroundTabId =
  | "image-studio"
  | "video-studio"
  | "pro-studio"
  | "models"
  | "lora-trainer"
  | "dashboard"
  | "prompt-library";

type PlaygroundTab = {
  id: PlaygroundTabId;
  label: string;
  hint: string;
  icon: LucideIcon;
  Component: React.ComponentType;
};

const TABS: readonly PlaygroundTab[] = [
  {
    id: "image-studio",
    label: "圖片創作室",
    hint: "圖片生成與編輯",
    icon: ImageIcon,
    Component: ImageStudio,
  },
  {
    id: "video-studio",
    label: "影片創作室",
    hint: "影片生成與轉換",
    icon: Film,
    Component: VideoStudio,
  },
  {
    id: "pro-studio",
    label: "音樂配音創作室",
    hint: "音樂、語音、音效",
    icon: Music,
    Component: ProStudio,
  },
  {
    id: "models",
    label: "角色鍛造所",
    hint: "模型管理與版本檢視",
    icon: Cpu,
    Component: ModelsPage,
  },
  {
    id: "lora-trainer",
    label: "模型訓練中心",
    hint: "LoRA 微調流程",
    icon: Zap,
    Component: LoraTrainer,
  },
  {
    id: "dashboard",
    label: "數據儀表板",
    hint: "使用統計與洞察",
    icon: BarChart3,
    Component: DashboardPage,
  },
  {
    id: "prompt-library",
    label: "提示詞庫",
    hint: "可重用的提示詞模板",
    icon: BookMarked,
    Component: PromptLibraryPage,
  },
] as const;

const isPlaygroundTabId = (value: string | null): value is PlaygroundTabId =>
  value !== null && TABS.some(tab => tab.id === value);

function FallbackSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-1/3 rounded-xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

export default function Playground() {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const initialTab = useMemo<PlaygroundTabId>(() => {
    try {
      const params = new URLSearchParams(search);
      const v = params.get("tab");
      return isPlaygroundTabId(v) ? v : "image-studio";
    } catch {
      return "image-studio";
    }
  }, [search]);

  const [activeTab, setActiveTab] = useState<PlaygroundTabId>(initialTab);

  useEffect(() => {
    try {
      const params = new URLSearchParams(search);
      const v = params.get("tab");
      if (isPlaygroundTabId(v) && v !== activeTab) {
        setActiveTab(v);
      }
    } catch {
      // ignore
    }
  }, [search, activeTab]);

  const handleTabChange = (value: string) => {
    if (!isPlaygroundTabId(value)) return;
    setActiveTab(value);
    const params = new URLSearchParams(search);
    params.set("tab", value);
    setLocation(`/playground?${params.toString()}`, { replace: true });
  };

  // 讓光球能直接切換模型樂園的工具分頁，並在需要時引導到對應的獨立頁。
  // NAV_ALLOWLIST 與 setTab options 同步，避免出現「光球說要去 image-studio
  // 但 Hub 沒登錄該路徑」的靜默失敗。
  const PLAYGROUND_NAV_ALLOWLIST = useMemo<Set<string>>(
    () =>
      new Set([
        "/playground",
        "/image-studio",
        "/video-studio",
        "/pro-studio",
        "/models",
        "/lora-trainer",
        "/dashboard",
        "/prompt-library",
      ]),
    []
  );

  useRegisterPageAgent({
    pageId: "playground",
    pageLabel: "模型樂園",
    pagePath: "/playground",
    capabilities: [
      {
        action: "setTab",
        label: "切換模型樂園分頁",
        options: TABS.map(tab => ({ id: tab.id, label: tab.label })),
        currentId: activeTab,
        hint: "在模型樂園內切換子工具（不離開 Hub）",
      },
      {
        action: "navigate",
        label: "進入單獨工具頁",
        options: [
          { id: "/image-studio", label: "圖片創作室（獨立頁）" },
          { id: "/video-studio", label: "影片創作室（獨立頁）" },
          { id: "/pro-studio", label: "音樂配音創作室（獨立頁）" },
          { id: "/models", label: "角色鍛造所（獨立頁）" },
          { id: "/lora-trainer", label: "LoRA 訓練（獨立頁）" },
          { id: "/dashboard", label: "儀表板（獨立頁）" },
          { id: "/prompt-library", label: "提示詞庫（獨立頁）" },
        ],
        hint: "需要全螢幕或獨立網址時使用",
      },
    ],
    state: {
      activeTab,
      tabCount: TABS.length,
      surface: "playground",
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "setTab" && typeof action.tabId === "string") {
        if (!isPlaygroundTabId(action.tabId)) {
          return { ok: false, reason: `playground: 未知 tabId：${action.tabId}` };
        }
        handleTabChange(action.tabId);
        const tab = TABS.find(t => t.id === action.tabId);
        return {
          ok: true,
          message: `已切到「${tab?.label ?? action.tabId}」`,
          data: { activeTab: action.tabId, activeTabLabel: tab?.label },
        };
      }
      if (action.type === "navigate" && typeof action.path === "string") {
        if (!PLAYGROUND_NAV_ALLOWLIST.has(action.path)) {
          return { ok: false, reason: `playground: 不在允許跳轉清單：${action.path}` };
        }
        setLocation(action.path);
        return { ok: true, message: `跳到 ${action.path}` };
      }
      return { ok: false, reason: `playground: unsupported action "${action.type}"` };
    },
  });

  return (
    <div className="playground-shell page-shell space-y-5">
      <header className="playground-hero page-header relative overflow-hidden rounded-2xl border border-border/40 px-5 py-4 sm:px-6 sm:py-5 !gap-0">
        <div className="playground-hero-glow" aria-hidden />
        <div className="relative flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="page-eyebrow">Playground</p>
            <h1 className="page-title !mb-0">模型樂園</h1>
            <p className="page-subtitle">
              所有進階模型工具都在這裡：圖片、影片、音樂創作室、角色鍛造、模型訓練、數據儀表板與提示詞庫，可在頁籤間自由切換。
            </p>
          </div>
        </div>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="gap-4"
      >
        <TabsList className="playground-tabs-list bg-transparent p-0 h-auto gap-1.5 flex-wrap justify-start overflow-x-auto w-full">
          {TABS.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="playground-tab-trigger gap-2 h-10 px-3.5 rounded-xl border border-border/40 bg-background/60 text-foreground/80 hover:bg-accent/40 hover:text-foreground transition-healing ease-out data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary/30 data-[state=active]:shadow-sm"
              title={tab.hint}
            >
              <tab.icon className="size-4" />
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map(tab => {
          const Comp = tab.Component;
          return (
            <TabsContent
              key={tab.id}
              value={tab.id}
              className="mt-0 focus-visible:outline-none"
            >
              <Suspense fallback={<FallbackSkeleton />}>
                <Comp />
              </Suspense>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
