import { useState, useMemo, useCallback, Component, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Users, Search, Package, Cpu, Share2, Sparkles, Image, Music, Video, Mic,
  Wand2, ArrowRight, AlertTriangle, RefreshCw,
} from "lucide-react";
import { motion } from "framer-motion";

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
            <p className="text-sm font-medium text-foreground">共享空間暫時無法顯示</p>
            <p className="text-xs text-muted-foreground mt-1">{this.state.errorMessage}</p>
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

const MODALITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
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
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("assets");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");

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

  // ── Showcase data (showcase.*) ──
  const [showcaseModality, setShowcaseModality] = useState<"image" | "video" | "audio" | "voice">("image");
  const [aestheticSearch, setAestheticSearch] = useState<string[]>([]);
  const showcaseTrending = trpc.showcase.trending.useQuery(
    { limit: 8 },
    { staleTime: 60_000, retry: 1 }
  );
  const showcaseStats = trpc.showcase.stats.useQuery(undefined, {
    staleTime: 120_000, retry: 1,
  });
  const showcaseByModality = trpc.showcase.byModality.useQuery(
    { modality: showcaseModality, limit: 12 },
    { staleTime: 60_000, retry: 1 }
  );
  const showcaseMyItems = trpc.showcase.myItems.useQuery(undefined, {
    retry: 1, staleTime: 30_000,
  });
  const showcaseRemove = trpc.showcase.removeItem.useMutation({
    onSuccess: () => {
      showcaseMyItems.refetch();
      toast.success("已移除展示作品");
    },
    onError: (e) => toast.error("移除失敗：" + e.message),
  });
  const [selectedShowcaseId, setSelectedShowcaseId] = useState<number | null>(null);
  const showcaseDetail = trpc.showcase.getById.useQuery(
    { id: selectedShowcaseId! },
    { enabled: !!selectedShowcaseId, retry: false }
  );
  // ── Aesthetic search (showcase.byAesthetics) ──
  const showcaseByAesthetics = trpc.showcase.byAesthetics.useQuery(
    { aesthetics: aestheticSearch, limit: 12 },
    { enabled: aestheticSearch.length > 0, staleTime: 60_000, retry: 1 }
  );

  // Contribution stats
  const mySharedAssetsCount = useMemo(
    () => (myAssetsQuery.data || []).filter(a => a.visibility === "team_shared").length,
    [myAssetsQuery.data]
  );
  const mySharedModelsCount = useMemo(
    () => (myModelsQuery.data || []).filter(m => m.visibility === "team_shared").length,
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
    return result.filter(a =>
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.promptUsed && a.promptUsed.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [sharedAssetsQuery.data, searchQuery, assetTypeFilter]);

  const filteredModels = useMemo(() => {
    const models = sharedModelsQuery.data || [];
    if (!searchQuery) return models;
    return models.filter(m =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.description && m.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [sharedModelsQuery.data, searchQuery]);

  // ── One-Click Use: Send asset to Studio ──
  const handleUseAsset = useCallback((asset: {
    title: string;
    assetType: string;
    fileUrl?: string | null;
    promptUsed?: string | null;
  }) => {
    const generationType = (["image", "video", "audio", "voice"].includes(asset.assetType))
      ? asset.assetType
      : "image";

    const studioData: Record<string, unknown> = {
      prompt: asset.promptUsed || `以「${asset.title}」為靈感`,
      generationType,
      source: "shared_space",
    };

    // For image assets, also set as style reference
    if (asset.assetType === "image" && asset.fileUrl) {
      studioData.referenceImageUrl = asset.fileUrl;
      studioData.parameterSnapshot = {
        styleReferenceUrl: asset.fileUrl,
      };
    }

    // For video assets, set as first frame reference
    if (asset.assetType === "video" && asset.fileUrl) {
      studioData.referenceImageUrl = asset.fileUrl;
      studioData.parameterSnapshot = {
        firstFrameUrl: asset.fileUrl,
      };
    }

    sessionStorage.setItem("sendToStudio", JSON.stringify(studioData));
    toast.success(
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-primary shrink-0" />
        <span>
          已載入「<strong>{asset.title}</strong>」到工作室
        </span>
      </div>,
      { duration: 3000 }
    );
    navigate("/studio");
  }, [navigate]);

  // ── One-Click Use: Send model to Studio (as LoRA model selection) ──
  const handleUseModel = useCallback((model: {
    id: number;
    name: string;
    modelType: string;
    status: string;
  }) => {
    if (model.status !== "ready") {
      toast.error("此模型尚未訓練完成，無法使用");
      return;
    }

    const studioData: Record<string, unknown> = {
      prompt: `使用「${model.name}」風格`,
      generationType: "image",
      source: "shared_space",
      fineTunedModelId: model.id,
      fineTunedModelName: model.name,
    };

    sessionStorage.setItem("sendToStudio", JSON.stringify(studioData));
    toast.success(
      <div className="flex items-center gap-2">
        <Cpu className="w-4 h-4 text-primary shrink-0" />
        <span>
          已載入模型「<strong>{model.name}</strong>」到工作室
        </span>
      </div>,
      { duration: 3000 }
    );
    navigate("/studio");
  }, [navigate]);

  return (
    <SharedSpaceErrorBoundary>
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6" />
          共享空間
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          探索社群創作、分享你的作品，獲得配額獎勵
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "共享素材", value: sharedAssetsQuery.data?.length || 0, icon: Package },
          { label: "共享模型", value: sharedModelsQuery.data?.length || 0, icon: Cpu },
          { label: "你的貢獻", value: myTotalContributions, icon: Share2 },
          { label: "共享資產", value: mySharedAssetsCount, icon: Sparkles },
        ].map((stat) => (
          <GlassCard key={stat.label} className="text-center py-4">
            <stat.icon className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
            <p className="text-lg font-semibold text-foreground tabular-nums">{stat.value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</p>
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
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-10 rounded-xl bg-white/40 border-white/60"
          />
        </div>
        {activeTab === "assets" && (
          <div className="flex gap-1 flex-wrap">
            {(["all", "image", "video", "audio", "voice", "script"] as const).map(t => (
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
          <TabsTrigger value="assets" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Package className="w-4 h-4 mr-1.5" />
            共享素材 ({filteredAssets.length})
          </TabsTrigger>
          <TabsTrigger value="models" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Cpu className="w-4 h-4 mr-1.5" />
            共享模型 ({filteredModels.length})
          </TabsTrigger>
          <TabsTrigger value="showcase" className="rounded-lg text-sm data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Sparkles className="w-4 h-4 mr-1.5" />
            精選展示
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="mt-4">
          {sharedAssetsQuery.isLoading ? (
            <ZenSkeleton lines={4} />
          ) : sharedAssetsQuery.isError ? (
            <GlassCard className="text-center py-12">
              <AlertTriangle className="w-10 h-10 text-amber-400/60 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">載入共享素材失敗</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
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
              <p className="text-sm text-muted-foreground">尚無共享素材</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                在「數位資產庫」中將素材設為團隊共享，即可出現在這裡
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {filteredAssets.map((asset, idx) => {
                const ModalityIcon = MODALITY_ICONS[asset.assetType] || Package;
                const canUse = ["image", "video", "audio", "voice"].includes(asset.assetType);
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
                        {asset.fileUrl && (asset.assetType === "image" || asset.assetType === "video") ? (
                          <img
                            src={asset.fileUrl}
                            alt={asset.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-muted/10">
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            <ModalityIcon className={"w-10 h-10 text-muted-foreground/20" as any} />
                          </div>
                        )}
                        <div className="absolute top-2 left-2">
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-white/80 text-muted-foreground" style={{ backdropFilter: "blur(4px)" }}>
                            {MODALITY_LABELS[asset.assetType] || asset.assetType}
                          </span>
                        </div>

                        {/* One-Click Use overlay — always visible on mobile, hover-only on desktop */}
                        {canUse && (
                          <div className={`absolute inset-0 transition-colors duration-300 flex items-center justify-center ${
                            isMobile
                              ? "bg-black/0"
                              : "bg-black/0 group-hover:bg-black/40"
                          }`}>
                            <Button
                              size="sm"
                              onClick={() => handleUseAsset(asset)}
                              className={`gap-1.5 bg-white/90 hover:bg-white text-foreground shadow-lg transition-all duration-300 ${
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

                      <p className="text-xs font-medium text-foreground truncate">{asset.title}</p>
                      {asset.promptUsed && (
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{asset.promptUsed}</p>
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
                          {isMobile ? <Wand2 className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
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
              <p className="text-sm text-muted-foreground">載入共享模型失敗</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
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
              <p className="text-sm text-muted-foreground">尚無共享模型</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
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
                        <p className="text-sm font-medium text-foreground truncate">{model.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{model.modelType}</p>
                        {model.description && (
                          <p className="text-[10px] text-muted-foreground/70 mt-1 line-clamp-2">{model.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/20">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        model.status === "ready" ? "bg-green-500/10 text-green-600" :
                        model.status === "training" ? "bg-yellow-500/10 text-yellow-600" :
                        "bg-muted/30 text-muted-foreground"
                      }`}>
                        {model.status === "ready" ? "就緒" : model.status === "training" ? "訓練中" : model.status}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(model.createdAt).toLocaleDateString("zh-TW")}
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

        {/* ── Showcase Tab (showcase.*) ── */}
        <TabsContent value="showcase" className="mt-4 space-y-6">
          {/* Showcase Stats */}
          {showcaseStats.data && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {showcaseStats.data.map((s: any) => (
                <GlassCard key={s.key} className="text-center py-3 px-2">
                  <p className="text-lg font-bold tabular-nums">{s.count}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className="text-[9px] text-muted-foreground/60">{s.totalLikes} ♥ · {s.totalForks} ⑂</p>
                </GlassCard>
              ))}
            </div>
          )}

          {/* Trending Section */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" /> 趨勢作品
            </h3>
            {showcaseTrending.isLoading ? (
              <ZenSkeleton lines={3} />
            ) : showcaseTrending.data && showcaseTrending.data.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {showcaseTrending.data.map((item: any) => (
                  <div key={item.id} className="overflow-hidden cursor-pointer group p-0 rounded-xl border border-border/20 bg-background/60 backdrop-blur-sm" onClick={() => setSelectedShowcaseId(item.id)}>
                    {item.thumbnailUrl || item.imageUrl ? (
                      <img src={item.thumbnailUrl || item.imageUrl} alt={item.title} className="w-full aspect-video object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                    ) : (
                      <div className="w-full aspect-video bg-muted/20 flex items-center justify-center">
                        <Sparkles className="w-6 h-6 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <div className="flex items-center gap-2 text-[9px] text-muted-foreground mt-0.5">
                        <span>{item.modality}</span>
                        <span>♥ {item.likeCount}</span>
                        <span>⑂ {item.forkCount}</span>
                      </div>
                    </div>
                    </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">暫無趨勢作品</p>
            )}
          </div>

          {/* Filter by Modality (showcase.byModality) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">依類型瀏覽</h3>
              <div className="flex gap-1">
                {(["image", "video", "audio", "voice"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setShowcaseModality(m)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                      showcaseModality === m ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {m === "image" ? "圖片" : m === "video" ? "影片" : m === "audio" ? "音樂" : "語音"}
                  </button>
                ))}
              </div>
            </div>
            {showcaseByModality.isLoading ? (
              <ZenSkeleton lines={3} />
            ) : showcaseByModality.data?.items && showcaseByModality.data.items.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {showcaseByModality.data.items.map((item: any) => (
                  <div key={item.id} className="overflow-hidden cursor-pointer group p-0 rounded-xl border border-border/20 bg-background/60 backdrop-blur-sm" onClick={() => setSelectedShowcaseId(item.id)}>
                    {item.thumbnailUrl || item.imageUrl ? (
                      <img src={item.thumbnailUrl || item.imageUrl} alt={item.title} className="w-full aspect-square object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                    ) : (
                      <div className="w-full aspect-square bg-muted/20 flex items-center justify-center">
                        <Package className="w-6 h-6 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="p-2">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">此類型暫無作品</p>
            )}
          </div>

          {/* Aesthetic Search (showcase.byAesthetics) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold">依美學風格搜尋</h3>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {["cyberpunk", "watercolor", "minimalist", "surreal", "anime", "cinematic", "vintage", "abstract"].map((tag) => (
                <button
                  key={tag}
                  onClick={() => setAestheticSearch(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                    aestheticSearch.includes(tag) ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            {aestheticSearch.length > 0 && (
              showcaseByAesthetics.isLoading ? (
                <ZenSkeleton lines={2} />
              ) : showcaseByAesthetics.data?.items && showcaseByAesthetics.data.items.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {showcaseByAesthetics.data.items.map((item: any) => (
                    <div key={item.id} className="overflow-hidden cursor-pointer group p-0 rounded-xl border border-border/20 bg-background/60 backdrop-blur-sm" onClick={() => setSelectedShowcaseId(item.id)}>
                      {item.thumbnailUrl || item.imageUrl ? (
                        <img src={item.thumbnailUrl || item.imageUrl} alt={item.title} className="w-full aspect-square object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                      ) : (
                        <div className="w-full aspect-square bg-muted/20 flex items-center justify-center">
                          <Sparkles className="w-6 h-6 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="p-2">
                        <p className="text-xs font-medium truncate">{item.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">沒有符合的作品</p>
              )
            )}
          </div>

          {/* My Showcase Items (showcase.myItems) */}
          {showcaseMyItems.data && showcaseMyItems.data.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3">我的展示作品</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {showcaseMyItems.data.map((item: any) => (
                  <GlassCard key={item.id} className="p-3">
                    <p className="text-xs font-medium truncate">{item.title}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[9px] text-muted-foreground">♥ {item.likeCount} · ⑂ {item.forkCount}</span>
                      <button
                        className="text-[9px] text-destructive hover:text-destructive/80 transition-colors"
                        onClick={() => { if (confirm("確定要移除此展示作品？")) showcaseRemove.mutate({ id: item.id }); }}
                      >
                        移除
                      </button>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Showcase Detail Modal (showcase.getById) */}
          {selectedShowcaseId && showcaseDetail.data && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setSelectedShowcaseId(null)}>
              <div className="bg-background rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold">{(showcaseDetail.data as any).title}</h3>
                  <button onClick={() => setSelectedShowcaseId(null)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
                </div>
                {(showcaseDetail.data as any).imageUrl && (
                  <img src={(showcaseDetail.data as any).imageUrl} alt={(showcaseDetail.data as any).title} className="w-full rounded-xl object-cover" loading="lazy" />
                )}
                {(showcaseDetail.data as any).description && (
                  <p className="text-sm text-muted-foreground">{(showcaseDetail.data as any).description}</p>
                )}
                {(showcaseDetail.data as any).originalPrompt && (
                  <div className="bg-muted/20 rounded-lg p-3">
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">原始提示詞</p>
                    <p className="text-xs whitespace-pre-wrap">{(showcaseDetail.data as any).originalPrompt}</p>
                  </div>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{(showcaseDetail.data as any).modality}</span>
                  <span>♥ {(showcaseDetail.data as any).likeCount}</span>
                  <span>⑂ {(showcaseDetail.data as any).forkCount}</span>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
    </SharedSpaceErrorBoundary>
  );
}
