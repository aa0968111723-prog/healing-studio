import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { uploadFileToS3, shortErrorMsg } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
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
  Plus,
  Upload,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { GlassCard, ZenTooltip, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import type { CharacterForgeStep, DatasetImage } from "@shared/types";

// ── Type alias for dataset images from training detail ──────────────────────

type DatasetImageEntry = { url: string; angle: string; caption?: string };

// ── Extended DatasetImage with upload state ──────────────────────────────────

type DatasetImageWithUpload = DatasetImage & {
  file?: File;
  uploadedUrl?: string;
  uploadedKey?: string;
  uploading?: boolean;
  uploaded?: boolean;
  captionGenerated?: boolean;
};

// ── Training wizard steps ───────────────────────────────────────────────────

const FORGE_STEPS: { id: CharacterForgeStep; label: string; icon: React.ReactNode }[] = [
  { id: "dataset", label: "資料集", icon: <Upload className="w-4 h-4" /> },
  { id: "captioning", label: "自動標註", icon: <Tag className="w-4 h-4" /> },
  { id: "hyperparams", label: "超參數", icon: <Settings2 className="w-4 h-4" /> },
  { id: "training", label: "開始訓練", icon: <Flame className="w-4 h-4" /> },
];

const ANGLES = [
  { value: "front" as const, label: "正面" },
  { value: "side" as const, label: "側面" },
  { value: "back" as const, label: "背面" },
  { value: "expression" as const, label: "表情" },
  { value: "other" as const, label: "其他" },
];

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
  const [tab, setTab] = useState<"train" | "overview" | "history" | "detail">("train");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  // ── Training form state ──
  const [step, setStep] = useState<CharacterForgeStep>("dataset");
  const [modelName, setModelName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [description, setDescription] = useState("");
  const [datasetImages, setDatasetImages] = useState<DatasetImageWithUpload[]>([]);
  const [epochs, setEpochs] = useState(20);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [batchSize, setBatchSize] = useState(4);
  const [isCaptioning, setIsCaptioning] = useState(false);
  const [trainingJobId, setTrainingJobId] = useState<number | null>(null);

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

  // ── Training job status polling ──
  const trainingStatusQuery = trpc.generate.jobStatus.useQuery(
    { jobId: trainingJobId! },
    {
      enabled: !!trainingJobId,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return 15000;
        if (data.status === "completed" || data.status === "failed") return false;
        return 15000;
      },
      retry: false,
    },
  );

  // ── Mutations ──
  const createMutation = trpc.models.create.useMutation({
    onSuccess: (data) => {
      toast.success("LoRA 訓練任務已建立");
      setTrainingJobId(data.jobId);
      historyQuery.refetch();
      statsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const captionMutation = trpc.models.captionImages.useMutation({
    onSuccess: (data) => {
      setDatasetImages(prev => prev.map((img, idx) => ({
        ...img,
        caption: data.captions[idx] || img.caption,
        captionGenerated: true,
      })));
      setIsCaptioning(false);
      toast.success("自動標註完成");
    },
    onError: (e) => {
      setIsCaptioning(false);
      toast.error("標註失敗：" + e.message);
    },
  });

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

  // ── Training form handlers ──
  const resetForm = useCallback(() => {
    setStep("dataset");
    setModelName("");
    setTriggerWord("");
    setDescription("");
    setDatasetImages([]);
    setEpochs(20);
    setLearningRate(0.0001);
    setBatchSize(4);
    setIsCaptioning(false);
    setTrainingJobId(null);
  }, []);

  const handleFileUpload = useCallback((angle: DatasetImageWithUpload["angle"]) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;

      const newImages: DatasetImageWithUpload[] = Array.from(files).map((file) => ({
        url: URL.createObjectURL(file),
        angle,
        file,
        uploading: true,
        uploaded: false,
      }));

      setDatasetImages((prev) => [...prev, ...newImages]);

      for (const img of newImages) {
        const file = img.file!;
        try {
          const { url, fileKey } = await uploadFileToS3(file);
          setDatasetImages((prev) =>
            prev.map((item) =>
              item.file === file
                ? { ...item, uploadedUrl: url, uploadedKey: fileKey, uploading: false, uploaded: true }
                : item
            )
          );
        } catch (err: unknown) {
          toast.error(`上傳失敗：${shortErrorMsg(err)}`, { duration: 5000 });
          setDatasetImages((prev) =>
            prev.map((item) =>
              item.file === file ? { ...item, uploading: false } : item
            )
          );
        }
      }
    };
    input.click();
  }, []);

  const removeImage = useCallback((idx: number) => {
    setDatasetImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleAutoCaptioning = useCallback(() => {
    const uploadedImages = datasetImages.filter(img => img.uploaded && img.uploadedUrl);
    if (uploadedImages.length === 0) {
      toast.error("請先等待圖片上傳完成");
      return;
    }
    setIsCaptioning(true);
    captionMutation.mutate({
      images: uploadedImages.map(img => ({
        url: img.uploadedUrl!,
        angle: img.angle,
      })),
    });
  }, [datasetImages, captionMutation]);

  const handleStartTraining = useCallback(() => {
    if (!modelName.trim()) { toast.error("請輸入模型名稱"); return; }
    if (!triggerWord.trim()) { toast.error("請設定觸發詞"); return; }

    const uploadedImages = datasetImages.filter(img => img.uploaded && img.uploadedUrl);
    if (uploadedImages.length < 3) {
      toast.error("至少需要 3 張已上傳的圖片");
      return;
    }

    createMutation.mutate({
      name: modelName,
      triggerWord,
      description,
      epochs,
      learningRate,
      batchSize,
      datasetImages: uploadedImages.map(img => ({
        url: img.uploadedUrl!,
        fileKey: img.uploadedKey!,
        angle: img.angle,
        caption: img.caption,
      })),
    });
  }, [modelName, triggerWord, description, epochs, learningRate, batchSize, datasetImages, createMutation]);

  const allUploaded = datasetImages.length > 0 && datasetImages.every(img => img.uploaded);
  const anyUploading = datasetImages.some(img => img.uploading);
  const currentStepIndex = FORGE_STEPS.findIndex((s) => s.id === step);

  const canProceed = () => {
    switch (step) {
      case "dataset": return modelName.trim() !== "" && datasetImages.length >= 3 && allUploaded;
      case "captioning": return triggerWord.trim() !== "";
      case "hyperparams": return true;
      case "training": return true;
      default: return false;
    }
  };

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
          onClick={() => { resetForm(); setTab("train"); }}
        >
          <Plus className="w-4 h-4" />
          新增訓練
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); if (v !== "detail") setSelectedModelId(null); }}>
        <TabsList className="rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="train" className="rounded-lg gap-1 text-xs">
            <Flame className="w-3 h-3" /> 訓練微調
          </TabsTrigger>
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
        {/* ═══ Training Tab ═══ */}
        {tab === "train" && (
          <motion.div
            key="train"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Replicate Connection Status (compact) */}
            {replicateStatusQuery.data && !replicateStatusQuery.data.connected && (
              <GlassCard>
                <div className="flex items-center gap-2 text-xs text-red-500">
                  <X className="w-4 h-4" />
                  <span>{replicateStatusQuery.data.message}</span>
                </div>
              </GlassCard>
            )}

            {/* Training Job Progress (visible when job is running) */}
            {trainingJobId && (
              <GlassCard>
                <div className="space-y-3 text-center py-4">
                  {trainingStatusQuery.data?.status === "completed" ? (
                    <>
                      <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
                      <h3 className="text-sm font-medium">訓練完成！LoRA 模型已就緒</h3>
                      <p className="text-xs text-muted-foreground">模型已成功訓練完成，可在工作室中使用觸發詞來呼叫。</p>
                      <div className="flex gap-2 justify-center">
                        <Button variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={() => { resetForm(); }}>
                          <Plus className="w-3 h-3" /> 訓練新模型
                        </Button>
                        <Button variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={() => setTab("history")}>
                          <Clock className="w-3 h-3" /> 查看紀錄
                        </Button>
                      </div>
                    </>
                  ) : trainingStatusQuery.data?.status === "failed" ? (
                    <>
                      <X className="w-10 h-10 text-red-500 mx-auto" />
                      <h3 className="text-sm font-medium text-red-500">訓練失敗</h3>
                      <p className="text-xs text-muted-foreground">{trainingStatusQuery.data?.errorMessage || "訓練過程中發生錯誤"}</p>
                      <Button variant="outline" className="rounded-xl gap-1.5 text-xs" onClick={() => resetForm()}>
                        重新開始
                      </Button>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
                      <h3 className="text-sm font-medium">模型訓練中...</h3>
                      <p className="text-xs text-muted-foreground">
                        {trainingStatusQuery.data?.progressMessage || "訓練任務已加入佇列，請稍候..."}
                      </p>
                      <div className="w-full max-w-md mx-auto bg-muted/40 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${trainingStatusQuery.data?.progress ?? 0}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        進度：{trainingStatusQuery.data?.progress ?? 0}% · 任務 ID: #{trainingJobId}
                      </p>
                    </>
                  )}
                </div>
              </GlassCard>
            )}

            {/* Training Wizard (hidden when job is active) */}
            {!trainingJobId && (
              <>
                {/* Step Indicator */}
                <div className="flex items-center gap-1">
                  {FORGE_STEPS.map((s, i) => (
                    <div key={s.id} className="flex items-center gap-1 flex-1">
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all w-full justify-center ${i <= currentStepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {s.icon}
                        <span className="hidden sm:inline">{s.label}</span>
                      </div>
                      {i < FORGE_STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                    </div>
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                    {/* ── Step 1: Dataset ── */}
                    {step === "dataset" && (
                      <GlassCard>
                        <div className="space-y-5">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">模型名稱 *</Label>
                            <Input placeholder="例如：角色 A" value={modelName} onChange={(e) => setModelName(e.target.value)} className="rounded-xl" />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">描述（選填）</Label>
                            <Textarea placeholder="角色的背景描述..." value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" rows={2} />
                          </div>
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">多角度資料集</Label>
                            <p className="text-xs text-muted-foreground">上傳至少 3 張不同角度的圖片，圖片會自動上傳至雲端儲存</p>
                            <div className="grid grid-cols-5 gap-2">
                              {ANGLES.map((angle) => {
                                const images = datasetImages.filter((img) => img.angle === angle.value);
                                const hasUploading = images.some(img => img.uploading);
                                return (
                                  <div key={angle.value} className="space-y-1.5">
                                    <span className="text-[11px] font-medium text-muted-foreground text-center block">{angle.label}</span>
                                    <button onClick={() => handleFileUpload(angle.value)} className="w-full aspect-square rounded-xl border-2 border-dashed border-border/50 hover:border-primary/30 transition-colors flex flex-col items-center justify-center gap-1 bg-muted/20 relative overflow-hidden">
                                      {images.length > 0 ? (
                                        <div className="relative w-full h-full">
                                          <img src={images[images.length - 1].uploadedUrl || images[images.length - 1].url} alt={angle.label} className="w-full h-full object-cover rounded-xl" loading="lazy" />
                                          <span className="absolute bottom-1 right-1 text-[10px] bg-black/50 text-white px-1.5 rounded-md">{images.length}</span>
                                          {hasUploading && (
                                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-xl">
                                              <Loader2 className="w-4 h-4 text-white animate-spin" />
                                            </div>
                                          )}
                                          {!hasUploading && images.every(i => i.uploaded) && (
                                            <div className="absolute top-1 left-1">
                                              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <>
                                          <Upload className="w-4 h-4 text-muted-foreground" />
                                          <span className="text-[10px] text-muted-foreground">上傳</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            {datasetImages.length > 0 && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">
                                    {datasetImages.filter(i => i.uploaded).length}/{datasetImages.length} 張已上傳
                                  </span>
                                  {anyUploading && (
                                    <span className="text-xs text-amber-600 flex items-center gap-1">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      上傳中...
                                    </span>
                                  )}
                                  {allUploaded && (
                                    <span className="text-xs text-green-600 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3" />
                                      全部上傳完成
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {datasetImages.map((img, idx) => (
                                    <div key={idx} className="relative w-12 h-12 rounded-lg overflow-hidden group">
                                      <img src={img.uploadedUrl || img.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                                      {img.uploading && (
                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                          <Loader2 className="w-3 h-3 text-white animate-spin" />
                                        </div>
                                      )}
                                      <button onClick={() => removeImage(idx)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                        <X className="w-3 h-3 text-white" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </GlassCard>
                    )}

                    {/* ── Step 2: Captioning ── */}
                    {step === "captioning" && (
                      <GlassCard>
                        <div className="space-y-5">
                          <div className="text-center py-2">
                            <Tag className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                            <h3 className="text-sm font-medium">自動標註與觸發詞</h3>
                            <p className="text-xs text-muted-foreground mt-1">AI 會自動為每張圖片生成描述標註</p>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">觸發詞 *</Label>
                            <Input placeholder="例如：char_a（唯一識別碼）" value={triggerWord} onChange={(e) => setTriggerWord(e.target.value)} className="rounded-xl font-mono" />
                            <p className="text-[11px] text-muted-foreground">在提示詞中使用此觸發詞來呼叫此角色</p>
                          </div>
                          <Button
                            onClick={handleAutoCaptioning}
                            disabled={isCaptioning || !allUploaded}
                            variant="outline"
                            className="w-full rounded-xl gap-2"
                          >
                            {isCaptioning ? (
                              <><Loader2 className="w-4 h-4 animate-spin" />AI 標註中...</>
                            ) : (
                              <><Tag className="w-4 h-4" />執行 AI 自動標註</>
                            )}
                          </Button>
                          <div className="rounded-xl bg-muted/30 p-4 space-y-2">
                            <h4 className="text-xs font-medium">標註結果</h4>
                            {datasetImages.slice(0, 5).map((img, idx) => (
                              <div key={idx} className="flex items-start gap-3 text-xs">
                                <img src={img.uploadedUrl || img.url} alt="" className="w-8 h-8 rounded-md object-cover shrink-0" loading="lazy" />
                                <div className="flex-1 min-w-0">
                                  {img.captionGenerated ? (
                                    <span className="text-foreground">{img.caption}</span>
                                  ) : isCaptioning ? (
                                    <span className="text-muted-foreground animate-pulse">AI 分析中...</span>
                                  ) : (
                                    <span className="text-muted-foreground/50">點擊「執行 AI 自動標註」生成描述</span>
                                  )}
                                </div>
                                {img.captionGenerated && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />}
                              </div>
                            ))}
                            {datasetImages.length > 5 && (
                              <p className="text-[10px] text-muted-foreground">...還有 {datasetImages.length - 5} 張圖片</p>
                            )}
                          </div>
                        </div>
                      </GlassCard>
                    )}

                    {/* ── Step 3: Hyperparameters ── */}
                    {step === "hyperparams" && (
                      <GlassCard>
                        <div className="space-y-5">
                          <div className="space-y-3">
                            <ZenTooltip tooltipKey="epochs"><Label className="text-sm font-medium">訓練輪數 (Epochs)</Label></ZenTooltip>
                            <div className="flex items-center gap-4">
                              <Slider value={[epochs]} onValueChange={([v]) => setEpochs(v)} min={5} max={50} step={5} className="flex-1" />
                              <span className="text-sm tabular-nums font-mono w-8 text-right">{epochs}</span>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <ZenTooltip tooltipKey="learningRate"><Label className="text-sm font-medium">學習率 (Learning Rate)</Label></ZenTooltip>
                            <div className="flex items-center gap-4">
                              <Slider value={[learningRate * 10000]} onValueChange={([v]) => setLearningRate(v / 10000)} min={1} max={10} step={1} className="flex-1" />
                              <span className="text-sm tabular-nums font-mono w-16 text-right">{learningRate.toFixed(4)}</span>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">批次大小 (Batch Size)</Label>
                            <div className="flex items-center gap-4">
                              <Slider value={[batchSize]} onValueChange={([v]) => setBatchSize(v)} min={1} max={16} step={1} className="flex-1" />
                              <span className="text-sm tabular-nums font-mono w-8 text-right">{batchSize}</span>
                            </div>
                          </div>
                          <div className="rounded-xl bg-muted/30 p-4">
                            <h4 className="text-xs font-medium mb-2">預估訓練資訊</h4>
                            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                              <span>資料集大小：{datasetImages.filter(i => i.uploaded).length} 張</span>
                              <span>預估時間：~{Math.ceil(epochs * datasetImages.length * 0.5)} 分鐘</span>
                              <span>訓練步驟：~{Math.min(Math.max(epochs * 30, 200), 2000)}</span>
                              <span>觸發詞：<code className="font-mono text-foreground">{triggerWord || "未設定"}</code></span>
                            </div>
                          </div>
                        </div>
                      </GlassCard>
                    )}

                    {/* ── Step 4: Confirm & Start Training ── */}
                    {step === "training" && (
                      <GlassCard>
                        <div className="space-y-5 text-center py-4">
                          <Flame className="w-10 h-10 text-orange-500 mx-auto" />
                          <h3 className="text-sm font-medium">確認訓練設定</h3>
                          <div className="rounded-xl bg-muted/30 p-4 text-left space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">模型名稱</span><span className="font-medium">{modelName}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">觸發詞</span><code className="font-mono text-xs">{triggerWord}</code></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">資料集</span><span>{datasetImages.filter(i => i.uploaded).length} 張圖片（已上傳至雲端）</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">訓練輪數</span><span>{epochs}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">學習率</span><span className="font-mono text-xs">{learningRate.toFixed(4)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">批次大小</span><span>{batchSize}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">訓練模型</span><code className="font-mono text-xs">ostris/flux-dev-lora-trainer</code></div>
                          </div>
                          <Button onClick={handleStartTraining} disabled={createMutation.isPending} className="w-full h-12 rounded-xl gap-2">
                            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
                            {createMutation.isPending ? "啟動中..." : "開始 Replicate LoRA 訓練"}
                          </Button>
                        </div>
                      </GlassCard>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Step Navigation */}
                {step !== "training" || !trainingJobId ? (
                  <div className="flex justify-between pt-2">
                    <Button variant="outline" className="rounded-xl gap-1 text-sm" onClick={() => { const idx = currentStepIndex - 1; if (idx >= 0) setStep(FORGE_STEPS[idx].id); }} disabled={currentStepIndex === 0}>
                      <ChevronLeft className="w-3.5 h-3.5" /> 上一步
                    </Button>
                    {currentStepIndex < FORGE_STEPS.length - 1 && (
                      <Button className="rounded-xl gap-1 text-sm" onClick={() => { const idx = currentStepIndex + 1; if (idx < FORGE_STEPS.length) setStep(FORGE_STEPS[idx].id); }} disabled={!canProceed()}>
                        {anyUploading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />上傳中...</> : <>下一步 <ChevronRight className="w-3.5 h-3.5" /></>}
                      </Button>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </motion.div>
        )}

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
                            aria-label={model.visibility === "team_shared" ? "設為私人" : "分享給團隊"}
                            title={model.status === "ready" ? (model.visibility === "team_shared" ? "設為私人" : "分享給團隊") : ""}
                            disabled={model.status !== "ready"}
                            onClick={() => toggleVisibility.mutate({
                              id: model.id,
                              visibility: model.visibility === "team_shared" ? "private" : "team_shared",
                            })}
                          >
                            {model.visibility === "team_shared" ? <Lock className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
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
                  在「訓練微調」頁籤中建立你的第一個 LoRA 模型
                </p>
                <Button variant="outline" className="mt-4 rounded-xl gap-1.5" onClick={() => { resetForm(); setTab("train"); }}>
                  <Plus className="w-4 h-4" /> 開始訓練
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
                      {(detailQuery.data.datasetImages as DatasetImageEntry[]).slice(0, 10).map((img, idx) => (
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
