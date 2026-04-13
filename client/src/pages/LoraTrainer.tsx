import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Flame,
  CheckCircle2,
  X,
  Loader2,
  Tag,
  Settings2,
  Clock,
  Zap,
  ExternalLink,
  Globe,
  Lock,
  Trash2,
  RefreshCw,
  BarChart3,
  Activity,
  Database,
  Cpu,
} from "lucide-react";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";

// ── Status badge helper ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    ready: { label: "就緒", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    training: { label: "訓練中", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    failed: { label: "失敗", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    pending: { label: "佇列中", className: "bg-muted text-muted-foreground" },
  };
  const c = config[status] ?? config.pending;
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

// ── Elapsed time formatter ──────────────────────────────────────────────────

function formatDuration(startMs: number | null, endMs: number | null): string {
  if (!startMs) return "—";
  const end = endMs || Date.now();
  const diff = end - startMs;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins < 1) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

// ── Main Page Component ─────────────────────────────────────────────────────

export default function LoraTrainer() {
  usePageTour("lora-trainer");
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"overview" | "history" | "detail">("overview");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  // ── tRPC queries ──
  const statsQuery = trpc.loraTrainer.stats.useQuery(undefined, { retry: false });
  const replicateStatusQuery = trpc.loraTrainer.replicateStatus.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const historyQuery = trpc.loraTrainer.trainingHistory.useQuery(undefined, {
    retry: false,
  });
  const detailQuery = trpc.loraTrainer.trainingDetail.useQuery(
    { modelId: selectedModelId! },
    { enabled: !!selectedModelId, retry: false },
  );

  // ── Reuse existing model mutations from models router ──
  const syncStatusMutation = trpc.models.syncReplicateStatus.useMutation({
    onSuccess: (data) => {
      historyQuery.refetch();
      if (data.status === "ready") toast.success("訓練完成！LoRA 已就緒");
      else if (data.status === "failed") toast.error("訓練失敗");
      else toast.info(`狀態已同步：${data.message}`);
    },
    onError: (e) => toast.error("同步失敗：" + e.message),
  });

  const retrainMutation = trpc.models.retrain.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
      statsQuery.refetch();
      toast.success("重新訓練已啟動");
    },
    onError: (e) => toast.error("重新訓練失敗：" + e.message),
  });

  const deleteModel = trpc.models.delete.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
      statsQuery.refetch();
      toast.success("已刪除");
      if (tab === "detail") {
        setTab("history");
        setSelectedModelId(null);
      }
    },
  });

  const toggleVisibility = trpc.models.toggleVisibility.useMutation({
    onSuccess: () => {
      historyQuery.refetch();
      toast.success("可見性已更新");
    },
  });

  const openDetail = (modelId: number) => {
    setSelectedModelId(modelId);
    setTab("detail");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Flame className="w-5 h-5 text-orange-500" />
          <div>
            <h1 className="text-xl font-semibold">LoRA 訓練工坊</h1>
            <p className="text-xs text-muted-foreground">Replicate 專屬 LoRA 微調訓練環境</p>
          </div>
        </div>
        <Button
          className="rounded-xl gap-1.5 text-sm"
          onClick={() => navigate("/models")}
        >
          <Cpu className="w-4 h-4" />
          前往角色鍛造所訓練
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); if (v !== "detail") setSelectedModelId(null); }}>
        <TabsList className="rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="overview" className="rounded-lg gap-1 text-xs">
            <BarChart3 className="w-3 h-3" /> 總覽
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-lg gap-1 text-xs">
            <Clock className="w-3 h-3" /> 訓練紀錄
          </TabsTrigger>
          {selectedModelId && (
            <TabsTrigger value="detail" className="rounded-lg gap-1 text-xs">
              <Settings2 className="w-3 h-3" /> 訓練詳情
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      <AnimatePresence mode="wait">
        {/* ═══ Overview Tab ═══ */}
        {tab === "overview" && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Replicate Connection Status */}
            <GlassCard>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <h3 className="text-sm font-medium">Replicate API 狀態</h3>
                    {replicateStatusQuery.isLoading ? (
                      <span className="text-xs text-muted-foreground">檢查中...</span>
                    ) : replicateStatusQuery.data?.connected ? (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> {replicateStatusQuery.data.message}
                      </span>
                    ) : (
                      <span className="text-xs text-red-500 flex items-center gap-1">
                        <X className="w-3 h-3" /> {replicateStatusQuery.data?.message ?? "未連線"}
                      </span>
                    )}
                  </div>
                </div>
                {replicateStatusQuery.data?.connected && replicateStatusQuery.data?.trainingModel && (
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">訓練模型</p>
                    <code className="text-xs font-mono">{replicateStatusQuery.data.trainingModel}</code>
                  </div>
                )}
              </div>
            </GlassCard>

            {/* Stats Cards */}
            {statsQuery.isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <GlassCard key={i} hover={false}>
                    <ZenSkeleton lines={2} />
                  </GlassCard>
                ))}
              </div>
            ) : statsQuery.data ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <GlassCard>
                  <div className="text-center space-y-1">
                    <Database className="w-5 h-5 mx-auto text-muted-foreground" />
                    <p className="text-2xl font-bold">{statsQuery.data.total}</p>
                    <p className="text-[11px] text-muted-foreground">模型總數</p>
                  </div>
                </GlassCard>
                <GlassCard>
                  <div className="text-center space-y-1">
                    <CheckCircle2 className="w-5 h-5 mx-auto text-green-500" />
                    <p className="text-2xl font-bold text-green-600">{statsQuery.data.ready}</p>
                    <p className="text-[11px] text-muted-foreground">已就緒</p>
                  </div>
                </GlassCard>
                <GlassCard>
                  <div className="text-center space-y-1">
                    <Loader2 className="w-5 h-5 mx-auto text-amber-500" />
                    <p className="text-2xl font-bold text-amber-600">{statsQuery.data.training}</p>
                    <p className="text-[11px] text-muted-foreground">訓練中</p>
                  </div>
                </GlassCard>
                <GlassCard>
                  <div className="text-center space-y-1">
                    <X className="w-5 h-5 mx-auto text-red-500" />
                    <p className="text-2xl font-bold text-red-600">{statsQuery.data.failed}</p>
                    <p className="text-[11px] text-muted-foreground">失敗</p>
                  </div>
                </GlassCard>
                <GlassCard>
                  <div className="text-center space-y-1">
                    <Zap className="w-5 h-5 mx-auto text-blue-500" />
                    <p className="text-2xl font-bold text-blue-600">{statsQuery.data.totalUsage}</p>
                    <p className="text-[11px] text-muted-foreground">總使用次數</p>
                  </div>
                </GlassCard>
              </div>
            ) : null}

            {/* Replicate Training Pipeline Overview */}
            <GlassCard>
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                Replicate LoRA 訓練管線
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {[
                  { step: "1", title: "資料集打包", desc: "多角度圖片 → ZIP 檔案", icon: <Database className="w-4 h-4" /> },
                  { step: "2", title: "雲端上傳", desc: "ZIP → S3 儲存空間", icon: <Globe className="w-4 h-4" /> },
                  { step: "3", title: "提交訓練", desc: "ostris/flux-dev-lora-trainer", icon: <Flame className="w-4 h-4" /> },
                  { step: "4", title: "輪詢完成", desc: "30s 間隔 · 最長 60 分鐘", icon: <RefreshCw className="w-4 h-4" /> },
                ].map((item) => (
                  <div key={item.step} className="rounded-xl bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                        {item.step}
                      </div>
                      {item.icon}
                    </div>
                    <p className="text-xs font-medium">{item.title}</p>
                    <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Training Hyperparameters Reference */}
            <GlassCard>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                超參數參考
              </h3>
              <div className="rounded-xl overflow-hidden border border-border/30">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/40 text-muted-foreground">
                      <th className="text-left px-3 py-2 font-medium">參數</th>
                      <th className="text-left px-3 py-2 font-medium">範圍</th>
                      <th className="text-left px-3 py-2 font-medium">預設值</th>
                      <th className="text-left px-3 py-2 font-medium">說明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    <tr>
                      <td className="px-3 py-2 font-mono">epochs</td>
                      <td className="px-3 py-2">5 – 50</td>
                      <td className="px-3 py-2">20</td>
                      <td className="px-3 py-2 text-muted-foreground">訓練輪數，建議 10-30</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono">learning_rate</td>
                      <td className="px-3 py-2">0.00001 – 0.01</td>
                      <td className="px-3 py-2">0.0001</td>
                      <td className="px-3 py-2 text-muted-foreground">學習率，過高可能不穩定</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono">steps</td>
                      <td className="px-3 py-2">200 – 2000</td>
                      <td className="px-3 py-2">epochs × 30</td>
                      <td className="px-3 py-2 text-muted-foreground">訓練步驟數（自動計算）</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono">caption_prefix</td>
                      <td className="px-3 py-2">自訂</td>
                      <td className="px-3 py-2">—</td>
                      <td className="px-3 py-2 text-muted-foreground">觸發詞，在提示詞中使用</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ═══ History Tab ═══ */}
        {tab === "history" && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {historyQuery.isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <GlassCard key={i} hover={false}>
                    <ZenSkeleton lines={5} />
                  </GlassCard>
                ))}
              </div>
            ) : historyQuery.data && historyQuery.data.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {historyQuery.data.map((model) => (
                  <GlassCard key={model.id}>
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold truncate">{model.name}</h3>
                        <StatusBadge status={model.status} />
                      </div>

                      {/* Trigger word */}
                      {model.triggerWord && (
                        <div className="flex items-center gap-1.5">
                          <Tag className="w-3 h-3 text-muted-foreground" />
                          <code className="text-xs font-mono text-muted-foreground">{model.triggerWord}</code>
                        </div>
                      )}

                      {/* Training info */}
                      <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                        <span>輪數: {model.epochs}</span>
                        <span>學習率: {model.learningRate.toFixed(4)}</span>
                        <span>步驟: {model.steps}</span>
                        <span>圖片: {model.datasetImageCount} 張</span>
                      </div>

                      {/* Replicate Prediction ID */}
                      {model.predictionId && (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Activity className="w-3 h-3" />
                          <span className="font-mono truncate">{model.predictionId}</span>
                        </div>
                      )}

                      {/* Duration */}
                      {model.submittedAt && (
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>耗時: {formatDuration(model.submittedAt, model.completedAt)}</span>
                        </div>
                      )}

                      {/* LoRA weight ready badge */}
                      {model.trainedLoraUrl && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-400 px-2 py-0.5 rounded-md">
                          ✓ LoRA 權重已就緒
                        </span>
                      )}

                      {/* Training progress for active jobs */}
                      {model.status === "training" && (
                        <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 text-center">
                          <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
                          正在 Replicate 上訓練中
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-1.5 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-7 text-xs gap-1 rounded-lg"
                          onClick={() => openDetail(model.id)}
                        >
                          <ExternalLink className="w-3 h-3" /> 詳情
                        </Button>

                        {(model.status === "training" || model.status === "pending") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1 rounded-lg"
                            disabled={syncStatusMutation.isPending}
                            onClick={() => syncStatusMutation.mutate({ modelId: model.id })}
                          >
                            {syncStatusMutation.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3 h-3" />
                            )}
                            同步
                          </Button>
                        )}

                        {model.status === "failed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1 rounded-lg text-amber-600 border-amber-300"
                            disabled={retrainMutation.isPending}
                            onClick={() => retrainMutation.mutate({ modelId: model.id })}
                          >
                            {retrainMutation.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Flame className="w-3 h-3" />
                            )}
                            重訓
                          </Button>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-2 border-t border-border/30">
                        <span className="text-[11px] text-muted-foreground">
                          {model.createdAt && new Date(model.createdAt).toLocaleDateString("zh-TW")}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 rounded-lg"
                            title={model.status === "ready" ? "切換可見性" : ""}
                            disabled={model.status !== "ready"}
                            onClick={() => toggleVisibility.mutate({
                              id: model.id,
                              visibility: "team_shared",
                            })}
                          >
                            <Globe className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 rounded-lg text-destructive"
                            onClick={() => deleteModel.mutate({ id: model.id })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Flame className="w-12 h-12 text-muted-foreground/30" />
                <h3 className="text-base font-medium mt-6">尚無訓練紀錄</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                  前往「角色鍛造所」建立你的第一個 LoRA 模型
                </p>
                <Button variant="outline" className="mt-4 rounded-xl gap-1.5" onClick={() => navigate("/models")}>
                  <Cpu className="w-4 h-4" /> 前往角色鍛造所
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══ Detail Tab ═══ */}
        {tab === "detail" && selectedModelId && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {detailQuery.isLoading ? (
              <GlassCard>
                <ZenSkeleton lines={10} />
              </GlassCard>
            ) : detailQuery.data ? (
              <>
                {/* Model Header */}
                <GlassCard>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Flame className="w-5 h-5 text-orange-500" />
                      <div>
                        <h2 className="text-base font-semibold">{detailQuery.data.name}</h2>
                        {detailQuery.data.description && (
                          <p className="text-xs text-muted-foreground">{detailQuery.data.description}</p>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={detailQuery.data.status} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <p className="text-muted-foreground">觸發詞</p>
                      <code className="font-mono font-medium">{detailQuery.data.triggerWord || "—"}</code>
                    </div>
                    <div>
                      <p className="text-muted-foreground">模型類型</p>
                      <p className="font-medium">{detailQuery.data.modelType}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">使用次數</p>
                      <p className="font-medium">{detailQuery.data.usageCount}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">可見性</p>
                      <p className="font-medium flex items-center gap-1">
                        {detailQuery.data.visibility === "team_shared" ? (
                          <><Globe className="w-3 h-3" /> 團隊共享</>
                        ) : (
                          <><Lock className="w-3 h-3" /> 私人</>
                        )}
                      </p>
                    </div>
                  </div>
                </GlassCard>

                {/* Training Configuration */}
                <GlassCard>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Settings2 className="w-4 h-4" /> 訓練配置
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <p className="text-muted-foreground">訓練輪數</p>
                      <p className="font-mono font-medium">{detailQuery.data.epochs}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">學習率</p>
                      <p className="font-mono font-medium">{detailQuery.data.learningRate.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">批次大小</p>
                      <p className="font-mono font-medium">{detailQuery.data.batchSize}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">訓練步驟</p>
                      <p className="font-mono font-medium">{detailQuery.data.steps}</p>
                    </div>
                  </div>
                </GlassCard>

                {/* Dataset Images Preview */}
                {Array.isArray(detailQuery.data.datasetImages) && detailQuery.data.datasetImages.length > 0 && (
                  <GlassCard>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Database className="w-4 h-4" /> 資料集 ({detailQuery.data.datasetImages.length} 張)
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {(detailQuery.data.datasetImages as Array<{ url: string; angle: string; caption?: string }>).slice(0, 10).map((img, idx) => (
                        <div key={idx} className="relative group">
                          <img
                            src={img.url}
                            alt={img.angle}
                            className="w-16 h-16 rounded-lg object-cover border border-border/30"
                            loading="lazy"
                          />
                          <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/50 text-white rounded-b-lg py-0.5">
                            {img.angle}
                          </span>
                        </div>
                      ))}
                      {detailQuery.data.datasetImages.length > 10 && (
                        <div className="w-16 h-16 rounded-lg bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
                          +{detailQuery.data.datasetImages.length - 10}
                        </div>
                      )}
                    </div>
                  </GlassCard>
                )}

                {/* Replicate Info */}
                <GlassCard>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Replicate 訓練資訊
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Prediction ID</span>
                      <code className="font-mono">{detailQuery.data.predictionId || "—"}</code>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">提交時間</span>
                      <span>{detailQuery.data.submittedAt ? new Date(detailQuery.data.submittedAt).toLocaleString("zh-TW") : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">完成時間</span>
                      <span>{detailQuery.data.completedAt ? new Date(detailQuery.data.completedAt).toLocaleString("zh-TW") : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">訓練耗時</span>
                      <span>{formatDuration(detailQuery.data.submittedAt, detailQuery.data.completedAt)}</span>
                    </div>
                    {detailQuery.data.trainedLoraUrl && (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">LoRA 權重 URL</span>
                        <a
                          href={detailQuery.data.trainedLoraUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-1 font-mono text-[10px] max-w-[200px] truncate"
                        >
                          {detailQuery.data.trainedLoraUrl.split("/").pop()} <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                    )}

                    {/* Replicate Live Info */}
                    {detailQuery.data.replicateInfo && (
                      <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
                        <h4 className="text-xs font-medium text-muted-foreground">Replicate 即時狀態</h4>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <span className="font-medium">{String(detailQuery.data.replicateInfo.status)}</span>
                        </div>
                        {detailQuery.data.replicateInfo.metrics != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Metrics</span>
                            <span className="font-mono text-[10px]">
                              {JSON.stringify(detailQuery.data.replicateInfo.metrics)}
                            </span>
                          </div>
                        )}
                        {detailQuery.data.replicateInfo.error != null && (
                          <div className="text-red-500 text-[10px] bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                            {String(detailQuery.data.replicateInfo.error)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </GlassCard>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  {(detailQuery.data.status === "training" || detailQuery.data.status === "pending") && (
                    <Button
                      variant="outline"
                      className="rounded-xl gap-1.5 text-sm"
                      disabled={syncStatusMutation.isPending}
                      onClick={() => syncStatusMutation.mutate({ modelId: selectedModelId })}
                    >
                      {syncStatusMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      同步 Replicate 狀態
                    </Button>
                  )}
                  {detailQuery.data.status === "failed" && (
                    <Button
                      variant="outline"
                      className="rounded-xl gap-1.5 text-sm text-amber-600 border-amber-300"
                      disabled={retrainMutation.isPending}
                      onClick={() => retrainMutation.mutate({ modelId: selectedModelId })}
                    >
                      {retrainMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Flame className="w-4 h-4" />
                      )}
                      重新訓練
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="rounded-xl gap-1.5 text-sm text-destructive"
                    onClick={() => deleteModel.mutate({ id: selectedModelId })}
                  >
                    <Trash2 className="w-4 h-4" />
                    刪除模型
                  </Button>
                </div>
              </>
            ) : (
              <GlassCard>
                <p className="text-sm text-muted-foreground text-center py-8">模型不存在或無存取權限</p>
              </GlassCard>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
