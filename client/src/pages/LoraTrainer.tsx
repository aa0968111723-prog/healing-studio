import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "@/components/VisualSoul";
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
  User,
  Smile,
  Palette,
  Mountain,
  Film,
  Mic,
  Video,
} from "lucide-react";
import { GlassCard, ZenTooltip, ZenSkeleton } from "@/components/ZenCoPilot";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import type { CharacterForgeStep, DatasetImage, TrainingModelType, TrainingEngine } from "@shared/types";
import { TRAINING_CATEGORIES, getTrainingCategory } from "@shared/types";

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

// ── Video upload entry ──────────────────────────────────────────────────────

type DatasetVideoEntry = {
  url: string;
  fileKey: string;
  caption?: string;
  file?: File;
  uploading?: boolean;
  uploaded?: boolean;
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

// ── Training type icon mapping ──────────────────────────────────────────────

const TRAINING_TYPE_ICONS: Record<string, React.ReactNode> = {
  image_subject: <User className="w-5 h-5" />,
  portrait_lora: <Smile className="w-5 h-5" />,
  style_lora: <Palette className="w-5 h-5" />,
  scene_lora: <Mountain className="w-5 h-5" />,
  video_lora: <Film className="w-5 h-5" />,
  voice_clone: <Mic className="w-5 h-5" />,
};

/** 模型類型中文標籤 */
const MODEL_TYPE_LABELS: Record<string, string> = {
  image_subject: "角色 / 主體",
  portrait_lora: "人像專訓",
  style_lora: "風格微調",
  scene_lora: "場景 / 環境",
  video_lora: "影片 LoRA",
  voice_clone: "語音複製",
};

/** 訓練引擎標籤 */
const ENGINE_LABELS: Record<string, string> = {
  replicate: "Replicate",
  fal: "Fal.ai",
};

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

  // ── AI Agent Integration ──
  const { aiState, setPageContext, personality } = useAIState();

  const [tab, setTab] = useState<"train" | "overview" | "history" | "detail">("train");
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);

  // ── Training type selection ──
  const [selectedTrainingType, setSelectedTrainingType] = useState<TrainingModelType>("image_subject");
  const currentCategory = getTrainingCategory(selectedTrainingType);

  // ── AI Agent: broadcast page context ──
  useEffect(() => {
    setPageContext({ pageId: "lora-trainer", pageLabel: "AI 模型訓練中心", activeTab: tab });
    return () => setPageContext(null);
  }, [tab, setPageContext]);

  // Resolve engine: for image_subject use replicate, others use fal
  const trainingEngine: TrainingEngine = selectedTrainingType === "image_subject" ? "replicate" : "fal";

  // ── Training form state ──
  const [step, setStep] = useState<CharacterForgeStep>("dataset");
  const [modelName, setModelName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [description, setDescription] = useState("");
  const [datasetImages, setDatasetImages] = useState<DatasetImageWithUpload[]>([]);
  const [datasetVideos, setDatasetVideos] = useState<DatasetVideoEntry[]>([]);
  const [epochs, setEpochs] = useState(20);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [batchSize, setBatchSize] = useState(4);
  const [trainingSteps, setTrainingSteps] = useState(1000);
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
    setDatasetVideos([]);
    setEpochs(20);
    setLearningRate(0.0001);
    setBatchSize(4);
    setTrainingSteps(1000);
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

  // ── Video upload handler (for video_lora type) ──
  const handleVideoUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;

      const newVideos: DatasetVideoEntry[] = Array.from(files).map((file) => ({
        url: URL.createObjectURL(file),
        fileKey: "",
        file,
        uploading: true,
        uploaded: false,
      }));

      setDatasetVideos((prev) => [...prev, ...newVideos]);

      for (const vid of newVideos) {
        const file = vid.file!;
        try {
          const { url, fileKey } = await uploadFileToS3(file);
          setDatasetVideos((prev) =>
            prev.map((item) =>
              item.file === file
                ? { ...item, url, fileKey, uploading: false, uploaded: true }
                : item
            )
          );
        } catch (err: unknown) {
          toast.error(`影片上傳失敗：${shortErrorMsg(err)}`, { duration: 5000 });
          setDatasetVideos((prev) =>
            prev.map((item) =>
              item.file === file ? { ...item, uploading: false } : item
            )
          );
        }
      }
    };
    input.click();
  }, []);

  const removeVideo = useCallback((idx: number) => {
    setDatasetVideos((prev) => prev.filter((_, i) => i !== idx));
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
    const uploadedVideos = datasetVideos.filter(v => v.uploaded);
    const totalData = uploadedImages.length + uploadedVideos.length;
    const minRequired = currentCategory?.minDatasetSize ?? 3;

    if (totalData < minRequired) {
      toast.error(`至少需要 ${minRequired} 份已上傳的訓練資料`);
      return;
    }

    createMutation.mutate({
      name: modelName,
      triggerWord,
      description,
      modelType: selectedTrainingType,
      trainingEngine,
      epochs: trainingEngine === "replicate" ? epochs : undefined,
      learningRate,
      batchSize: trainingEngine === "replicate" ? batchSize : undefined,
      steps: trainingEngine === "fal" ? trainingSteps : undefined,
      isStyle: selectedTrainingType === "style_lora",
      datasetImages: uploadedImages.map(img => ({
        url: img.uploadedUrl!,
        fileKey: img.uploadedKey!,
        angle: img.angle,
        caption: img.caption,
      })),
      datasetVideos: uploadedVideos.map(v => ({
        url: v.url,
        fileKey: v.fileKey,
        caption: v.caption,
      })),
    });
  }, [modelName, triggerWord, description, selectedTrainingType, trainingEngine, epochs, learningRate, batchSize, trainingSteps, datasetImages, datasetVideos, currentCategory, createMutation]);

  const allImagesUploaded = datasetImages.length === 0 || datasetImages.every(img => img.uploaded);
  const allVideosUploaded = datasetVideos.length === 0 || datasetVideos.every(v => v.uploaded);
  const allUploaded = (datasetImages.length > 0 || datasetVideos.length > 0) && allImagesUploaded && allVideosUploaded;
  const anyUploading = datasetImages.some(img => img.uploading) || datasetVideos.some(v => v.uploading);
  const totalDataCount = datasetImages.filter(i => i.uploaded).length + datasetVideos.filter(v => v.uploaded).length;
  const currentStepIndex = FORGE_STEPS.findIndex((s) => s.id === step);
  const minDatasetSize = currentCategory?.minDatasetSize ?? 3;

  const canProceed = () => {
    switch (step) {
      case "dataset": return modelName.trim() !== "" && totalDataCount >= minDatasetSize && allUploaded;
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
            <h1 className="text-xl font-semibold">AI 模型訓練中心</h1>
            <p className="text-xs text-muted-foreground">多類型 LoRA 微調訓練 · 支援 Replicate + Fal.ai 雙引擎</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VisualSoul size="sm" state={aiState} personality={personality} className="!w-6 !h-6" />
          <Button
            className="rounded-xl gap-1.5 text-sm"
            onClick={() => { resetForm(); setTab("train"); }}
          >
            <Plus className="w-4 h-4" />
            新增訓練
          </Button>
        </div>
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
            {/* Engine Connection Status (compact) */}
            {replicateStatusQuery.data && !replicateStatusQuery.data.connected && (
              <GlassCard>
                <div className="flex items-center gap-2 text-xs text-red-500">
                  <X className="w-4 h-4" />
                  <span>{replicateStatusQuery.data.message}</span>
                </div>
              </GlassCard>
            )}

            {/* ═══ Training Type Selector ═══ */}
            {!trainingJobId && (
              <GlassCard>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  選擇訓練類型
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {TRAINING_CATEGORIES.filter(c => c.type !== "voice_clone").map((cat) => (
                    <button
                      key={cat.type}
                      onClick={() => { resetForm(); setSelectedTrainingType(cat.type); }}
                      className={`relative rounded-xl border-2 p-3 text-left transition-all hover:border-primary/40 ${
                        selectedTrainingType === cat.type
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-border/40 bg-muted/10"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-2 text-center">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          selectedTrainingType === cat.type ? "bg-primary/10 text-primary" : "bg-muted/30 text-muted-foreground"
                        }`}>
                          {TRAINING_TYPE_ICONS[cat.type]}
                        </div>
                        <span className="text-xs font-medium leading-tight">{cat.labelZh}</span>
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-1.5 text-center leading-tight line-clamp-2">{cat.description}</p>
                      {selectedTrainingType === cat.type && (
                        <div className="absolute top-1.5 right-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                {currentCategory && (
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground bg-muted/20 rounded-lg p-2">
                    <span>引擎：<strong className="text-foreground">{ENGINE_LABELS[trainingEngine]}</strong></span>
                    <span>·</span>
                    <span>資料需求：{currentCategory.acceptsImages && "圖片"}{currentCategory.acceptsVideos && " + 影片"} · 最少 {currentCategory.minDatasetSize} 份</span>
                  </div>
                )}
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
                            <Input placeholder={`例如：${currentCategory?.labelZh || "模型"} A`} value={modelName} onChange={(e) => setModelName(e.target.value)} className="rounded-xl" />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">描述（選填）</Label>
                            <Textarea placeholder={`${currentCategory?.description || "模型的背景描述"}...`} value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" rows={2} />
                          </div>

                          {/* ── Image upload (for image-based training types) ── */}
                          {currentCategory?.acceptsImages && (
                            <div className="space-y-3">
                              <Label className="text-sm font-medium flex items-center gap-1.5">
                                {TRAINING_TYPE_ICONS[selectedTrainingType]}
                                {selectedTrainingType === "image_subject" || selectedTrainingType === "portrait_lora"
                                  ? "多角度資料集"
                                  : "訓練圖片集"}
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                上傳至少 {minDatasetSize} 張圖片，圖片會自動上傳至雲端儲存
                              </p>

                              {/* Angle-based upload for character/portrait */}
                              {(selectedTrainingType === "image_subject" || selectedTrainingType === "portrait_lora") ? (
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
                              ) : (
                                /* Simple grid upload for style/scene/video */
                                <button
                                  onClick={() => handleFileUpload("other")}
                                  className="w-full py-8 rounded-xl border-2 border-dashed border-border/50 hover:border-primary/30 transition-colors flex flex-col items-center justify-center gap-2 bg-muted/20"
                                >
                                  <Upload className="w-6 h-6 text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground">點擊上傳訓練圖片</span>
                                  <span className="text-[10px] text-muted-foreground/70">支援 JPG, PNG, WebP</span>
                                </button>
                              )}

                              {/* Uploaded images preview */}
                              {datasetImages.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">
                                      {datasetImages.filter(i => i.uploaded).length}/{datasetImages.length} 張圖片已上傳
                                    </span>
                                    {anyUploading && (
                                      <span className="text-xs text-amber-600 flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        上傳中...
                                      </span>
                                    )}
                                    {allUploaded && !anyUploading && (
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
                          )}

                          {/* ── Video upload (for video_lora type) ── */}
                          {currentCategory?.acceptsVideos && (
                            <div className="space-y-3">
                              <Label className="text-sm font-medium flex items-center gap-1.5">
                                <Video className="w-4 h-4" />
                                影片資料集
                              </Label>
                              <p className="text-xs text-muted-foreground">上傳訓練影片（支援 MP4, MOV, WebM），影片會自動分析並提取特徵</p>
                              <button
                                onClick={handleVideoUpload}
                                className="w-full py-8 rounded-xl border-2 border-dashed border-border/50 hover:border-primary/30 transition-colors flex flex-col items-center justify-center gap-2 bg-muted/20"
                              >
                                <Film className="w-6 h-6 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">點擊上傳訓練影片</span>
                                <span className="text-[10px] text-muted-foreground/70">支援 MP4, MOV, WebM</span>
                              </button>
                              {datasetVideos.length > 0 && (
                                <div className="space-y-2">
                                  <span className="text-xs text-muted-foreground">
                                    {datasetVideos.filter(v => v.uploaded).length}/{datasetVideos.length} 部影片已上傳
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    {datasetVideos.map((vid, idx) => (
                                      <div key={idx} className="relative w-24 h-16 rounded-lg overflow-hidden group bg-muted/30 flex items-center justify-center">
                                        {vid.uploading ? (
                                          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                                        ) : vid.uploaded ? (
                                          <>
                                            <Film className="w-5 h-5 text-muted-foreground" />
                                            <span className="absolute bottom-0.5 left-1 text-[8px] text-white bg-black/50 px-1 rounded">影片 {idx + 1}</span>
                                            <CheckCircle2 className="absolute top-0.5 left-0.5 w-3 h-3 text-green-400" />
                                          </>
                                        ) : (
                                          <X className="w-4 h-4 text-red-400" />
                                        )}
                                        <button onClick={() => removeVideo(idx)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                          <X className="w-3 h-3 text-white" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
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
                          {/* Replicate-specific: epochs + batch size */}
                          {trainingEngine === "replicate" && (
                            <>
                              <div className="space-y-3">
                                <ZenTooltip tooltipKey="epochs"><Label className="text-sm font-medium">訓練輪數 (Epochs)</Label></ZenTooltip>
                                <div className="flex items-center gap-4">
                                  <Slider value={[epochs]} onValueChange={([v]) => setEpochs(v)} min={5} max={50} step={5} className="flex-1" />
                                  <span className="text-sm tabular-nums font-mono w-8 text-right">{epochs}</span>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <Label className="text-sm font-medium">批次大小 (Batch Size)</Label>
                                <div className="flex items-center gap-4">
                                  <Slider value={[batchSize]} onValueChange={([v]) => setBatchSize(v)} min={1} max={16} step={1} className="flex-1" />
                                  <span className="text-sm tabular-nums font-mono w-8 text-right">{batchSize}</span>
                                </div>
                              </div>
                            </>
                          )}

                          {/* Fal.ai-specific: steps */}
                          {trainingEngine === "fal" && (
                            <div className="space-y-3">
                              <Label className="text-sm font-medium">訓練步驟數 (Steps)</Label>
                              <div className="flex items-center gap-4">
                                <Slider value={[trainingSteps]} onValueChange={([v]) => setTrainingSteps(v)} min={200} max={3000} step={100} className="flex-1" />
                                <span className="text-sm tabular-nums font-mono w-12 text-right">{trainingSteps}</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground">建議 800–2000 步。步驟越多品質越好，但耗時更長。</p>
                            </div>
                          )}

                          {/* Shared: learning rate */}
                          <div className="space-y-3">
                            <ZenTooltip tooltipKey="learningRate"><Label className="text-sm font-medium">學習率 (Learning Rate)</Label></ZenTooltip>
                            <div className="flex items-center gap-4">
                              <Slider value={[learningRate * 10000]} onValueChange={([v]) => setLearningRate(v / 10000)} min={1} max={10} step={1} className="flex-1" />
                              <span className="text-sm tabular-nums font-mono w-16 text-right">{learningRate.toFixed(4)}</span>
                            </div>
                          </div>

                          {/* Summary */}
                          <div className="rounded-xl bg-muted/30 p-4">
                            <h4 className="text-xs font-medium mb-2">預估訓練資訊</h4>
                            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                              <span>訓練類型：{MODEL_TYPE_LABELS[selectedTrainingType]}</span>
                              <span>訓練引擎：{ENGINE_LABELS[trainingEngine]}</span>
                              <span>資料集：{totalDataCount} 份</span>
                              {trainingEngine === "replicate" ? (
                                <span>訓練步驟：~{Math.min(Math.max(epochs * 30, 200), 2000)}</span>
                              ) : (
                                <span>訓練步驟：{trainingSteps}</span>
                              )}
                              <span>觸發詞：<code className="font-mono text-foreground">{triggerWord || "未設定"}</code></span>
                              <span>學習率：<code className="font-mono text-foreground">{learningRate.toFixed(4)}</code></span>
                            </div>
                          </div>
                        </div>
                      </GlassCard>
                    )}

                    {/* ── Step 4: Confirm & Start Training ── */}
                    {step === "training" && (
                      <GlassCard>
                        <div className="space-y-5 text-center py-4">
                          <div className="flex items-center justify-center gap-2">
                            {TRAINING_TYPE_ICONS[selectedTrainingType]}
                            <Flame className="w-10 h-10 text-orange-500" />
                          </div>
                          <h3 className="text-sm font-medium">確認訓練設定</h3>
                          <div className="rounded-xl bg-muted/30 p-4 text-left space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-muted-foreground">訓練類型</span><span className="font-medium">{MODEL_TYPE_LABELS[selectedTrainingType]}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">訓練引擎</span><span className="font-medium">{ENGINE_LABELS[trainingEngine]}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">模型名稱</span><span className="font-medium">{modelName}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">觸發詞</span><code className="font-mono text-xs">{triggerWord}</code></div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">資料集</span>
                              <span>
                                {datasetImages.filter(i => i.uploaded).length > 0 && `${datasetImages.filter(i => i.uploaded).length} 張圖片`}
                                {datasetImages.filter(i => i.uploaded).length > 0 && datasetVideos.filter(v => v.uploaded).length > 0 && " + "}
                                {datasetVideos.filter(v => v.uploaded).length > 0 && `${datasetVideos.filter(v => v.uploaded).length} 部影片`}
                              </span>
                            </div>
                            {trainingEngine === "replicate" && (
                              <>
                                <div className="flex justify-between"><span className="text-muted-foreground">訓練輪數</span><span>{epochs}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">批次大小</span><span>{batchSize}</span></div>
                              </>
                            )}
                            {trainingEngine === "fal" && (
                              <div className="flex justify-between"><span className="text-muted-foreground">訓練步驟</span><span>{trainingSteps}</span></div>
                            )}
                            <div className="flex justify-between"><span className="text-muted-foreground">學習率</span><span className="font-mono text-xs">{learningRate.toFixed(4)}</span></div>
                          </div>
                          <Button onClick={handleStartTraining} disabled={createMutation.isPending} className="w-full h-12 rounded-xl gap-2">
                            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
                            {createMutation.isPending ? "啟動中..." : `開始 ${ENGINE_LABELS[trainingEngine]} 訓練`}
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
            {/* Training Engine Status */}
            <GlassCard>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-muted-foreground" />
                  <h3 className="text-sm font-medium">訓練引擎狀態</h3>
                </div>
              </div>
              {replicateStatusQuery.isLoading ? (
                <ZenSkeleton lines={2} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Replicate */}
                  <div className="rounded-xl bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-medium">Replicate</span>
                      {replicateStatusQuery.data?.engines?.replicate?.connected ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500 ml-auto" />
                      ) : (
                        <X className="w-3 h-3 text-red-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{replicateStatusQuery.data?.engines?.replicate?.message ?? "未知"}</p>
                    {replicateStatusQuery.data?.trainingModel && (
                      <code className="text-[10px] font-mono text-muted-foreground">{replicateStatusQuery.data.trainingModel}</code>
                    )}
                  </div>
                  {/* Fal.ai */}
                  <div className="rounded-xl bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-medium">Fal.ai</span>
                      {replicateStatusQuery.data?.engines?.fal?.connected ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500 ml-auto" />
                      ) : (
                        <X className="w-3 h-3 text-red-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{replicateStatusQuery.data?.engines?.fal?.message ?? "未知"}</p>
                    <code className="text-[10px] font-mono text-muted-foreground">支援影片 / 風格 / 場景 LoRA</code>
                  </div>
                </div>
              )}
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

            {/* Training Pipeline Overview */}
            <GlassCard>
              <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                多類型 LoRA 訓練管線
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {[
                  { step: "1", title: "選擇類型", desc: "角色 / 人像 / 風格 / 場景 / 影片", icon: <Cpu className="w-4 h-4" /> },
                  { step: "2", title: "上傳資料集", desc: "圖片 + 影片 → S3 儲存", icon: <Database className="w-4 h-4" /> },
                  { step: "3", title: "提交訓練", desc: "Replicate / Fal.ai 雙引擎", icon: <Flame className="w-4 h-4" /> },
                  { step: "4", title: "自動完成", desc: "輪詢狀態 → LoRA 就緒", icon: <RefreshCw className="w-4 h-4" /> },
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

            {/* Training Types Overview */}
            <GlassCard>
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                支援的訓練類型
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {TRAINING_CATEGORIES.filter(c => c.type !== "voice_clone").map((cat) => (
                  <div key={cat.type} className="rounded-xl bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      {TRAINING_TYPE_ICONS[cat.type]}
                      <span className="text-xs font-medium">{cat.labelZh}</span>
                      <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded-md text-muted-foreground ml-auto">{ENGINE_LABELS[cat.defaultEngine]}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{cat.description}</p>
                    <p className="text-[9px] text-muted-foreground/70">
                      {cat.acceptsImages && "📷 圖片"}{cat.acceptsVideos && " + 🎬 影片"} · 最少 {cat.minDatasetSize} 份
                    </p>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Per-type Stats */}
            {statsQuery.data?.byType && Object.keys(statsQuery.data.byType).length > 0 && (
              <GlassCard>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  各類型模型統計
                </h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(statsQuery.data.byType).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-1.5 rounded-lg bg-muted/20 px-2.5 py-1.5">
                      {TRAINING_TYPE_ICONS[type] || <Database className="w-3.5 h-3.5" />}
                      <span className="text-xs">{MODEL_TYPE_LABELS[type] || type}</span>
                      <span className="text-xs font-bold text-primary">{count}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}
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

                      {/* Type + Engine badge */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-muted/40 px-1.5 py-0.5 rounded-md">
                          {TRAINING_TYPE_ICONS[model.modelType] || <Database className="w-3 h-3" />}
                          {MODEL_TYPE_LABELS[model.modelType] || model.modelType}
                        </span>
                        {model.trainingEngine && (
                          <span className="text-[9px] bg-muted/30 px-1.5 py-0.5 rounded-md text-muted-foreground">
                            {ENGINE_LABELS[model.trainingEngine] || model.trainingEngine}
                          </span>
                        )}
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
                        {model.epochs > 0 && <span>輪數: {model.epochs}</span>}
                        <span>學習率: {model.learningRate.toFixed(4)}</span>
                        <span>步驟: {model.steps}</span>
                        <span>
                          圖片: {model.datasetImageCount} 張
                          {(model.datasetVideoCount ?? 0) > 0 && ` + ${model.datasetVideoCount} 影片`}
                        </span>
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
