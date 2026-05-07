import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
  type AgentCapability,
} from "@/contexts/PageAgentContext";
import {
  Wand2,
  Clapperboard,
  Package,
  StickyNote,
  CalendarDays,
  Clock,
  type LucideIcon,
} from "lucide-react";

const Studio = lazy(() => import("./Studio"));
const DirectorAI = lazy(() => import("./DirectorAI"));
const AssetsLibrary = lazy(() => import("./AssetsLibrary"));
const NotesPage = lazy(() => import("./NotesPage"));
const CalendarPage = lazy(() => import("./CalendarPage"));
const HistoryPage = lazy(() => import("./HistoryPage"));

type CreationTabId =
  | "studio"
  | "director"
  | "assets"
  | "notes"
  | "calendar"
  | "history";

type CreationTab = {
  id: CreationTabId;
  label: string;
  hint: string;
  icon: LucideIcon;
  Component: React.ComponentType;
};

const TABS: readonly CreationTab[] = [
  {
    id: "studio",
    label: "創作工作室",
    hint: "跨模態創作主入口",
    icon: Wand2,
    Component: Studio,
  },
  {
    id: "director",
    label: "導演 AI",
    hint: "腳本與分鏡企劃",
    icon: Clapperboard,
    Component: DirectorAI,
  },
  {
    id: "assets",
    label: "數位資產",
    hint: "圖片、影片、音頻素材庫",
    icon: Package,
    Component: AssetsLibrary,
  },
  {
    id: "notes",
    label: "專案筆記",
    hint: "靈感、腳本、待辦",
    icon: StickyNote,
    Component: NotesPage,
  },
  {
    id: "calendar",
    label: "創作排程",
    hint: "本週節奏與交付節點",
    icon: CalendarDays,
    Component: CalendarPage,
  },
  {
    id: "history",
    label: "生成歷史",
    hint: "回顧過去作品與任務",
    icon: Clock,
    Component: HistoryPage,
  },
] as const;

const isCreationTabId = (value: string | null): value is CreationTabId =>
  value !== null && TABS.some(tab => tab.id === value);

function FallbackSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-1/3 rounded-xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

export default function CreationHub() {
  const [, setLocation] = useLocation();
  const search = useSearch();

  const initialTab = useMemo<CreationTabId>(() => {
    try {
      const params = new URLSearchParams(search);
      const v = params.get("tab");
      return isCreationTabId(v) ? v : "studio";
    } catch {
      return "studio";
    }
  }, [search]);

  const [activeTab, setActiveTab] = useState<CreationTabId>(initialTab);

  useEffect(() => {
    try {
      const params = new URLSearchParams(search);
      const v = params.get("tab");
      if (isCreationTabId(v) && v !== activeTab) {
        setActiveTab(v);
      }
    } catch {
      // ignore
    }
  }, [search, activeTab]);

  const handleTabChange = (value: string) => {
    if (!isCreationTabId(value)) return;
    setActiveTab(value);
    const params = new URLSearchParams(search);
    params.set("tab", value);
    setLocation(`/create?${params.toString()}`, { replace: true });
  };

  const creationCapabilities = useMemo<AgentCapability[]>(
    () => [
      {
        action: "setTab",
        label: "切換創作中心分頁",
        currentId: activeTab,
        options: TABS.map(tab => ({
          id: tab.id,
          label: tab.label,
          description: tab.hint,
        })),
      },
    ],
    [activeTab]
  );

  useRegisterPageAgent({
    pageId: "creation-hub",
    pageLabel: "創作中心",
    pagePath: "/create",
    capabilities: creationCapabilities,
    state: { activeTab },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "setTab") {
        if (!isCreationTabId(action.tabId)) {
          return { ok: false, reason: `unknown creation-hub tab: ${action.tabId}` };
        }
        handleTabChange(action.tabId);
        return { ok: true, message: `切到「${action.tabId}」分頁`, data: { activeTab: action.tabId } };
      }
      return { ok: false, reason: `unsupported on creation-hub: ${action.type}` };
    },
  });

  return (
    <div className="creation-hub-shell space-y-5">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          創作中心
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          整合創作工作室、導演 AI、資產、筆記與排程的單一工作台。切換上方頁籤即可在不同任務間流暢移動。
        </p>
      </header>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="gap-4"
      >
        <TabsList className="hub-tabs-list bg-transparent p-0 h-auto gap-1.5 flex-wrap justify-start overflow-x-auto w-full">
          {TABS.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="hub-tab-trigger gap-2 h-10 px-3.5 rounded-xl border border-border/40 bg-background/60 text-foreground/80 hover:bg-accent/40 hover:text-foreground transition-all duration-200 ease-out data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary/30 data-[state=active]:shadow-sm"
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
