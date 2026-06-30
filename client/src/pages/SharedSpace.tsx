import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  Component,
  type ReactNode,
} from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useAIState } from "@/contexts/AIStateContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { AssetModelSubpageGuide } from "@/components/AssetModelSubpageGuide";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Users,
  Search,
  Package,
  Cpu,
  Share2,
  Sparkles,
  Image,
  Music,
  Video,
  Mic,
  Wand2,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  dispatchToStudio,
  studioRouteLabel,
} from "@/lib/send-to-studio";

// ─── Error Boundary ────────────────────────────────────────────────────────

class SharedSpaceErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, errorMessage: err.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <GlassCard className="flex flex-col items-center justify-center py-16 text-center gap-4">
          <AlertTriangle className="w-10 h-10 text-amber-500" />
          <div>
            <p className="hs-h3 !mb-0 text-foreground">共享空間暫時無法顯示</p>
            <p className="hs-small !mb-0 text-muted-foreground mt-1">
              {this.state.errorMessage}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, errorMessage: "" })}
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重新載入
          </Button>
        </GlassCard>
      );
    }
    return this.props.children;
  }
}

const MODALITY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  image: Image,
  video: Video,
  audio: Music,
  voice: Mic,
  script: Sparkles,
  zip_bundle: Package,
};

const MODALITY_LABELS: Record<string, string> = {
  image: "圖片",
  video: "影片",
  audio: "音樂",
  voice: "語音",
  script: "腳本",
  zip_bundle: "素材包",
};

export default function SharedSpace() {
  const { user } = useAuth();

  // 全站新手引導
  usePageTour("shared");

  // ── AI Agent Integration ──
  const { setPageContext } = useAIState();

  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("assets");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");

  // ── AI Agent: broadcast page context ──
  useEffect(() => {
    setPageContext({ pageId: "shared", pageLabel: "共享空間", activeTab });
    return () => setPageContext(null);
  }, [activeTab, setPageContext]);

  // Fetch shared assets — retry: 1, fail fast (500ms retry delay), no window refetch
  const sharedAssetsQuery = trpc.assets.teamAssets.useQuery(undefined, {
    retry: 1,
    retryDelay: 500,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  // Fetch shared models — same guards
  const sharedModelsQuery = trpc.models.teamModels.useQuery(undefined, {
    retry: 1,
    retryDelay: 500,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  // My own assets — to calculate personal contribution count
  const myAssetsQuery = trpc.assets.myAssets.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const myModelsQuery = trpc.models.myModels.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Contribution stats
  const mySharedAssetsCount = useMemo(
    () =>
      (myAssetsQuery.data?.items ?? []).filter(a => a.visibility === "team_shared")
        .length,
    [myAssetsQuery.data]
  );
  const mySharedModelsCount = useMemo(
    () =>
      (myModelsQuery.data || []).filter(m => m.visibility === "team_shared")
        .length,
    [myModelsQuery.data]
  );
  const myTotalContributions = mySharedAssetsCount + mySharedModelsCount;

  const filteredAssets = useMemo(() => {
    const assets = sharedAssetsQuery.data || [];
    let result = assets;
    if (assetTypeFilter !== "all") {
      result = result.filter(a => a.assetType === assetTypeFilter);
    }
    if (!searchQuery) return result;
    return result.filter(
      a =>
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.promptUsed &&
          a.promptUsed.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [sharedAssetsQuery.data, searchQuery, assetTypeFilter]);

  const filteredModels = useMemo(() => {
    const models = sharedModelsQuery.data || [];
    if (!searchQuery) return models;
    return models.filter(
      m =>
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.description &&
          m.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [sharedModelsQuery.data, searchQuery]);

  const sharedSpaceUtils = trpc.useUtils();
  const recordModelPick = trpc.agentModelPicks.recordPick.useMutation();

  // ── One-Click Use: Send asset to Studio ──
  const handleUseAsset = useCallback(
    async (asset: {
      title: string;
      assetType: string;
      fileUrl?: string | null;
      promptUsed?: string | null;
    }) => {
      const generationType = ["image", "video", "audio", "voice"].includes(
        asset.assetType
      )
        ? asset.assetType
        : "image";

      // Pull the user's preferred model for this modality from the shared
      // table so the destination studio opens with their habit, not a
      // hardcoded default. Same React Query cache that
      // `usePreferredStudioModel` uses, so it's typically a cache hit.
      let overrideEngine: string | undefined;
      try {
        const data =
          await sharedSpaceUtils.agentModelPicks.getPreferredForModality.fetch({
            modality: generationType,
            topK: 1,
          });
        overrideEngine = data.entries[0]?.modelId;
      } catch {
        overrideEngine = undefined;
      }
      if (overrideEngine) {
        recordModelPick.mutate({
          modality: generationType,
          modelId: overrideEngine,
          source: "shared_space",
          context: { assetType: asset.assetType },
        });
      }

      const payload: Record<string, unknown> = {
        prompt: asset.promptUsed || `以「${asset.title}」為靈感`,
        generationType,
        overrideEngine,
        source: "shared_space",
      };
      if (asset.assetType === "image" && asset.fileUrl) {
        payload.referenceImageUrl = asset.fileUrl;
        payload.parameterSnapshot = { styleReferenceUrl: asset.fileUrl };
      }
      if (asset.assetType === "video" && asset.fileUrl) {
        payload.referenceImageUrl = asset.fileUrl;
        payload.parameterSnapshot = { firstFrameUrl: asset.fileUrl };
      }

      const route = dispatchToStudio({
        payload: payload as Parameters<typeof dispatchToStudio>[0]["payload"],
        navigate,
      });
      toast.success(
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-primary shrink-0" />
          <span>
            已載入「<strong>{asset.title}</strong>」到{studioRouteLabel(route)}
          </span>
        </div>,
        { duration: 3000 }
      );
    },
    [navigate, recordModelPick, sharedSpaceUtils]
  );

  // ── PageAgent：光球可代操分頁、搜尋、類型篩選 ───────────────────
  const SHARED_TAB_OPTIONS = useMemo(
    () => [
      { id: "assets", label: "共享素材", meta: { bestFor: "素材協作復用", tip: "附註用途與授權狀態" } },
      { id: "models", label: "共享模型", meta: { bestFor: "團隊模型共用", tip: "附上推薦參數與版本註記" } },
    ],
    []
  );
  const SHARED_TYPE_OPTIONS = useMemo(
    () =>
      ["all", "image", "video", "audio", "voice", "script"].map(t => ({
        id: t,
        label: t === "all" ? "全部" : MODALITY_LABELS[t] || t,
        meta: {
          bestFor: t === "all" ? "整體盤點" : `${MODALITY_LABELS[t] || t}資產篩選`,
          tip: "可再搭配搜尋關鍵字縮小結果",
        },
      })),
    []
  );
  const SHARED_NAV_ALLOWLIST = useMemo<Set<string>>(
    () =>
      new Set([
        "/assets",
        "/models",
        "/studio",
        "/notes",
        "/image-studio",
        "/video-studio",
        "/pro-studio",
        "/settings",
      ]),
    []
  );
  const sharedAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換分頁",
        currentId: activeTab,
        options: SHARED_TAB_OPTIONS,
        hint: "assets（共享素材）或 models（共享模型）",
      },
      {
        action: "setParam",
        label: "類型篩選",
        options: SHARED_TYPE_OPTIONS,
        hint: "setParam key='assetType' value=all|image|video|audio|voice|script",
      },
      {
        action: "search",
        label: "搜尋共享內容",
        hint: "搜尋共享素材或模型",
      },
      {
        action: "reset",
        label: "清空搜尋條件",
        hint: "搜尋清空、類型回 all",
      },
      {
        action: "navigate",
        label: "前往相關頁面",
        options: [
          { id: "/assets", label: "數位資產庫", meta: { bestFor: "管理我的素材", tip: "將共享素材儲存到自己的資產庫" } },
          { id: "/models", label: "角色鍛造所", meta: { bestFor: "查看模型詳情", tip: "將共享模型導入自己的庫" } },
          { id: "/studio", label: "創作工作室", meta: { bestFor: "套用素材創作", tip: "直接使用共享素材生成" } },
          { id: "/notes", label: "專案筆記", meta: { bestFor: "記錄靈感", tip: "將共享素材的靈感記下" } },
          { id: "/image-studio", label: "圖片工作室", meta: { bestFor: "精細圖像創作", tip: "用共享素材做參考圖" } },
          { id: "/video-studio", label: "影片工作室", meta: { bestFor: "精細影片創作", tip: "把共享素材當成 i2v 起手圖" } },
          { id: "/pro-studio", label: "音樂配音工作室", meta: { bestFor: "音樂與語音", tip: "把共享音檔當參考素材" } },
          { id: "/settings", label: "個人設定", meta: { bestFor: "調整共享偏好", tip: "決定哪些資產自動共享" } },
        ],
        hint: "navigate path='/assets' | '/models' | '/studio' | '/notes' | '/image-studio' | '/video-studio' | '/pro-studio' | '/settings'",
      },
    ],
    [activeTab, SHARED_TAB_OPTIONS, SHARED_TYPE_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "shared",
    pageLabel: "共享空間",
    pagePath: "/shared",
    capabilities: sharedAgentCapabilities,
    state: {
      activeTab,
      assetTypeFilter,
      searchQuery,
      sharedAssetsCount: sharedAssetsQuery.data?.length ?? 0,
      sharedModelsCount: sharedModelsQuery.data?.length ?? 0,
      myTotalContributions,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          if (action.tabId !== "assets" && action.tabId !== "models") {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          setActiveTab(action.tabId);
          return { ok: true, message: `切到「${action.tabId}」分頁` };
        }
        case "setParam": {
          if (action.key === "assetType") {
            const v = String(action.value ?? "");
            const valid = ["all", "image", "video", "audio", "voice", "script"];
            if (!valid.includes(v)) {
              return { ok: false, reason: `unknown assetType: ${v}` };
            }
            setAssetTypeFilter(v);
            if (activeTab !== "assets") setActiveTab("assets");
            return { ok: true, message: `類型切到「${v}」` };
          }
          return { ok: false, reason: `unknown param key: ${action.key}` };
        }
        case "search": {
          setSearchQuery(action.query);
          return { ok: true, message: "已套用搜尋" };
        }
        case "navigate": {
          if (!SHARED_NAV_ALLOWLIST.has(action.path)) {
            return { ok: false, reason: `navigation blocked: ${action.path}` };
          }
          navigate(action.path);
          return { ok: true, message: `已導航到 ${action.path}` };
        }
        case "reset": {
          setSearchQuery("");
          setAssetTypeFilter("all");
          return { ok: true, message: "已清空搜尋與類型" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on shared: ${action.type}`,
          };
      }
    },
  });

  // ── One-Click Use: Send model to Studio (as LoRA model selection) ──
  const handleUseModel = useCallback(
    (model: {
      id: number;
      name: string;
      modelType: string;
      status: string;
    }) => {
      if (model.status !== "ready") {
        toast.error("此模型尚未訓練完成，無法使用");
        return;
      }

      // Recording happens server-side keyed by `name` because the LoRA's
      // numeric id isn't a usable engine identifier — the studio looks up
      // the LoRA by name when applying it. The pick is logged so the
      // shared table can show "you've reused this LoRA N times".
      recordModelPick.mutate({
        modality: "image",
        modelId: `lora:${model.name}`,
        source: "shared_space",
        context: { fineTunedModelId: model.id, kind: "lora" },
      });

      const route = dispatchToStudio({
        payload: {
          prompt: `使用「${model.name}」風格`,
          generationType: "image",
          source: "shared_space",
          fineTunedModelId: model.id,
          fineTunedModelName: model.name,
        },
        navigate,
      });
      toast.success(
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary shrink-0" />
          <span>
            已載入模型「<strong>{model.name}</strong>」到
            {studioRouteLabel(route)}
          </span>
        </div>,
        { duration: 3000 }
      );
    },
    [navigate, recordModelPick]
  );

  return (
    <SharedSpaceErrorBoundary>
      <div className="page-shell space-y-6">
        <header className="page-header">
          <p className="page-eyebrow">Shared Space</p>
          <h1 className="page-title flex items-center gap-2 !mb-0">
            <Users className="w-6 h-6" />
            共享空間
          </h1>
          <p className="page-subtitle">
            探索社群創作、分享你的作品，獲得配額獎勵
          </p>
        </header>

        <AssetModelSubpageGuide page="shared" />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "共享素材",
              value: sharedAssetsQuery.data?.length || 0,
              icon: Package,
            },
            {
              label: "共享模型",
              value: sharedModelsQuery.data?.length || 0,
              icon: Cpu,
            },
            { label: "你的貢獻", value: myTotalContributions, icon: Share2 },
            { label: "共享資產", value: mySharedAssetsCount, icon: Sparkles },
          ].map(stat => (
            <GlassCard key={stat.label} className="text-center py-4">
              <stat.icon className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
              <p className="hs-h3-lg !mb-0 text-foreground tabular-nums">
                {stat.value}
              </p>
              <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                {stat.label}
              </p>
            </GlassCard>
          ))}
        </div>

        {/* Search + asset type filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <Input
              placeholder="搜尋共享素材或模型..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10 h-10 rounded-xl bg-card/40 border-white/60"
            />
          </div>
          {activeTab === "assets" && (
            <div className="flex gap-1 flex-wrap">
              {(
                ["all", "image", "video", "audio", "voice", "script"] as const
              ).map(t => (
                <button
                  key={t}
                  onClick={() => setAssetTypeFilter(t)}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
                    assetTypeFilter === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {t === "all" ? "全部" : MODALITY_LABELS[t] || t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="rounded-xl bg-muted/30 p-0.5">
            <TabsTrigger
              value="assets"
              className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              <Package className="w-4 h-4 mr-1.5" />
              共享素材 ({filteredAssets.length})
            </TabsTrigger>
            <TabsTrigger
              value="models"
              className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              <Cpu className="w-4 h-4 mr-1.5" />
              共享模型 ({filteredModels.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assets" className="mt-4">
            {sharedAssetsQuery.isLoading ? (
              <ZenSkeleton lines={4} />
            ) : sharedAssetsQuery.isError ? (
              <GlassCard className="text-center py-12">
                <AlertTriangle className="w-10 h-10 text-amber-400/60 mx-auto mb-3" />
                <p className="hs-p !mb-0 text-muted-foreground">
                  載入共享素材失敗
                </p>
                <p className="hs-small !mb-0 text-muted-foreground/60 mt-1">
                  {sharedAssetsQuery.error?.message || "網路不穩定，請稍後再試"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => sharedAssetsQuery.refetch()}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重試
                </Button>
              </GlassCard>
            ) : filteredAssets.length === 0 ? (
              <GlassCard className="text-center py-12">
                <Package className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="hs-p !mb-0 text-muted-foreground">尚無共享素材</p>
                <p className="hs-small !mb-0 text-muted-foreground/60 mt-1">
                  在「數位資產庫」中將素材設為團隊共享，即可出現在這裡
                </p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {filteredAssets.map((asset, idx) => {
                  const ModalityIcon =
                    MODALITY_ICONS[asset.assetType] || Package;
                  const canUse = ["image", "video", "audio", "voice"].includes(
                    asset.assetType
                  );
                  return (
                    <motion.div
                      key={asset.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <GlassCard className="overflow-hidden group">
                        {/* Thumbnail */}
                        <div className="aspect-square relative -mx-4 -mt-4 mb-3 overflow-hidden">
                          {asset.fileUrl &&
                          (asset.assetType === "image" ||
                            asset.assetType === "video") ? (
                            <img
                              src={asset.fileUrl}
                              alt={asset.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-muted/10">
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              <ModalityIcon
                                className={
                                  "w-10 h-10 text-muted-foreground/20" as any
                                }
                              />
                            </div>
                          )}
                          <div className="absolute top-2 left-2">
                            <span
                              className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-card/80 text-muted-foreground"
                              style={{ backdropFilter: "blur(4px)" }}
                            >
                              {MODALITY_LABELS[asset.assetType] ||
                                asset.assetType}
                            </span>
                          </div>

                          {/* One-Click Use overlay — always visible on mobile, hover-only on desktop */}
                          {canUse && (
                            <div
                              className={`absolute inset-0 transition-healing flex items-center justify-center ${
                                isMobile
                                  ? "bg-black/0"
                                  : "bg-black/0 group-hover:bg-black/40"
                              }`}
                            >
                              <Button
                                size="sm"
                                onClick={() => handleUseAsset(asset)}
                                className={`gap-1.5 bg-card/90 hover:bg-card text-foreground shadow-lg transition-healing ${
                                  isMobile
                                    ? "opacity-0 pointer-events-none"
                                    : "opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0"
                                }`}
                              >
                                <Wand2 className="w-3.5 h-3.5" />
                                一鍵使用
                              </Button>
                            </div>
                          )}
                        </div>

                        <p className="hs-h3 !mb-0 text-foreground truncate">
                          {asset.title}
                        </p>
                        {asset.promptUsed && (
                          <p className="hs-small !mb-0 text-muted-foreground mt-1 line-clamp-2">
                            {asset.promptUsed}
                          </p>
                        )}

                        {/* Use button below card content — always visible */}
                        {canUse && (
                          <Button
                            size="sm"
                            variant={isMobile ? "default" : "ghost"}
                            onClick={() => handleUseAsset(asset)}
                            className={`w-full mt-2 text-[11px] gap-1 ${
                              isMobile
                                ? "h-8 rounded-lg"
                                : "h-7 text-primary hover:text-primary hover:bg-primary/10"
                            }`}
                          >
                            {isMobile ? (
                              <Wand2 className="w-3 h-3" />
                            ) : (
                              <ArrowRight className="w-3 h-3" />
                            )}
                            {isMobile ? "使用此素材" : "帶入工作室"}
                          </Button>
                        )}
                      </GlassCard>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="models" className="mt-4">
            {sharedModelsQuery.isLoading ? (
              <ZenSkeleton lines={4} />
            ) : sharedModelsQuery.isError ? (
              <GlassCard className="text-center py-12">
                <AlertTriangle className="w-10 h-10 text-amber-400/60 mx-auto mb-3" />
                <p className="hs-p !mb-0 text-muted-foreground">
                  載入共享模型失敗
                </p>
                <p className="hs-small !mb-0 text-muted-foreground/60 mt-1">
                  {sharedModelsQuery.error?.message || "網路不穩定，請稍後再試"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => sharedModelsQuery.refetch()}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重試
                </Button>
              </GlassCard>
            ) : filteredModels.length === 0 ? (
              <GlassCard className="text-center py-12">
                <Cpu className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="hs-p !mb-0 text-muted-foreground">尚無共享模型</p>
                <p className="hs-small !mb-0 text-muted-foreground/60 mt-1">
                  在「角色鍛造所」中將模型設為團隊共享，即可出現在這裡
                </p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredModels.map((model, idx) => (
                  <motion.div
                    key={model.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <GlassCard>
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-xl bg-primary/5 flex items-center justify-center shrink-0">
                          <Cpu className="w-6 h-6 text-primary/40" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="hs-h3 !mb-0 text-foreground truncate">
                            {model.name}
                          </p>
                          <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                            {model.modelType}
                          </p>
                          {model.description && (
                            <p className="hs-small !mb-0 text-muted-foreground/70 mt-1 line-clamp-2">
                              {model.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/20">
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            model.status === "ready"
                              ? "bg-green-500/10 text-green-600"
                              : model.status === "training"
                                ? "bg-yellow-500/10 text-yellow-600"
                                : "bg-muted/30 text-muted-foreground"
                          }`}
                        >
                          {model.status === "ready"
                            ? "就緒"
                            : model.status === "training"
                              ? "訓練中"
                              : model.status}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(model.createdAt).toLocaleDateString(
                              "zh-TW"
                            )}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleUseModel(model)}
                            disabled={model.status !== "ready"}
                            className="h-6 text-[10px] gap-1 text-primary hover:text-primary hover:bg-primary/10 px-2"
                          >
                            <Wand2 className="w-3 h-3" />
                            使用
                          </Button>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </SharedSpaceErrorBoundary>
  );
}
