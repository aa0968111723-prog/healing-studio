import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { AssetModelSubpageGuide } from "@/components/AssetModelSubpageGuide";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";

const LoraTrainer = lazy(() => import("./LoraTrainer"));
import { uploadFileToS3, shortErrorMsg } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Cpu,
  Plus,
  Upload,
  Tag,
  Settings2,
  Flame,
  ChevronRight,
  ChevronLeft,
  X,
  Loader2,
  Globe,
  Lock,
  Trash2,
  Gift,
  CheckCircle2,
  Wand2,
  Image,
  Video,
  Mic,
  BarChart3,
  Clock,
  Activity,
  Database,
  Eye,
  Sparkles,
  ChevronsUpDown,
  Zap,
} from "lucide-react";
import { GlassCard, ZenTooltip, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { motion, AnimatePresence } from "framer-motion";
import type { CharacterForgeStep, DatasetImage } from "@shared/types";
import { useAIState } from "@/contexts/AIStateContext";
import { useLocation } from "wouter";

const FORGE_STEPS: {
  id: CharacterForgeStep;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "dataset", label: "資料集", icon: <Upload className="w-4 h-4" /> },
  { id: "captioning", label: "自動標註", icon: <Tag className="w-4 h-4" /> },
  {
    id: "hyperparams",
    label: "超參數",
    icon: <Settings2 className="w-4 h-4" />,
  },
  { id: "training", label: "開始訓練", icon: <Flame className="w-4 h-4" /> },
];

const ANGLES = [
  { value: "front" as const, label: "正面" },
  { value: "side" as const, label: "側面" },
  { value: "back" as const, label: "背面" },
  { value: "expression" as const, label: "表情" },
  { value: "other" as const, label: "其他" },
];

// Extended DatasetImage with upload state
type DatasetImageWithUpload = DatasetImage & {
  file?: File;
  uploadedUrl?: string;
  uploadedKey?: string;
  uploading?: boolean;
  uploaded?: boolean;
  captionGenerated?: boolean;
};

// ─── Model Analysis Dialog ──────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  ready: {
    text: "就緒",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  training: {
    text: "訓練中",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  failed: {
    text: "失敗",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  pending: { text: "佇列中", className: "bg-muted text-muted-foreground" },
  queued: { text: "佇列中", className: "bg-muted text-muted-foreground" },
  processing: {
    text: "處理中",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  completed: {
    text: "完成",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  cancelled: { text: "已取消", className: "bg-muted text-muted-foreground" },
};

const MODEL_TYPE_LABELS: Record<string, string> = {
  image_subject: "角色主體",
  style_lora: "風格 LoRA",
  voice_clone: "語音複製",
};

const ANGLE_LABELS: Record<string, string> = {
  front: "正面",
  side: "側面",
  back: "背面",
  expression: "表情",
  other: "其他",
};

const MODEL_GUIDE_SECTIONS = [
  {
    id: "start",
    title: "第一次建立模型，建議流程",
    summary: "先建立最小可用版本，再透過分析報告微調。",
    bullets: [
      "先上傳 3~8 張不同角度的圖片，先求穩定再追求數量。",
      "觸發詞使用唯一代碼（例：char_amy）避免與常見詞衝突。",
      "先以預設超參數訓練，完成後再透過重訓優化。",
    ],
  },
  {
    id: "quality",
    title: "如何提升生成穩定度",
    summary: "降低資訊噪音、提高資料一致性，效果會更穩。",
    bullets: [
      "資料集盡量保持同一角色、近似光線與清晰輪廓。",
      "避免一次混入太多風格，先訓練主體再訓練風格 LoRA。",
      "每次只調整 1 個參數，便於比對品質變化。",
    ],
  },
  {
    id: "team",
    title: "團隊共享最佳實務",
    summary: "共享前先補齊說明，讓其他成員可直接套用。",
    bullets: [
      "在描述中附上推薦提示詞、禁用情境與版本標記。",
      "建議命名格式：用途/角色/版本（例：ad-hero-v2）。",
      "使用完成後查看分析面板，追蹤使用次數與狀態。",
    ],
  },
] as const;

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_LABELS[status] ?? {
    text: status,
    className: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${info.className}`}
    >
      {info.text}
    </span>
  );
}

function ModelAnalysisDialog({
  modelId,
  open,
  onOpenChange,
}: {
  modelId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const analysisQuery = trpc.models.getAnalysis.useQuery(
    { id: modelId },
    { enabled: open, retry: false }
  );

  const data = analysisQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            模型詳細分析
          </DialogTitle>
        </DialogHeader>

        {analysisQuery.isLoading ? (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
            <p className="hs-p !mb-0 text-muted-foreground">
              載入分析資料中...
            </p>
          </div>
        ) : analysisQuery.isError ? (
          <div className="py-12 text-center">
            <X className="w-8 h-8 text-red-500 mx-auto mb-3" />
            <p className="hs-p !mb-0 text-red-500">
              載入失敗：{analysisQuery.error?.message}
            </p>
          </div>
        ) : data ? (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-6 pb-4">
              {/* Model Overview */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 hs-h3 !mb-0">
                  <Cpu className="w-4 h-4 text-muted-foreground" />
                  基本資訊
                </div>
                <div className="rounded-xl bg-muted/30 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="hs-h3-lg !mb-0">{data.model.name}</span>
                    <StatusBadge status={data.model.status} />
                  </div>
                  {data.model.description && (
                    <p className="hs-p !mb-0 text-muted-foreground">
                      {data.model.description}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">模型類型</span>
                      <span className="font-medium">
                        {MODEL_TYPE_LABELS[data.model.modelType] ??
                          data.model.modelType}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">可見性</span>
                      <span className="font-medium flex items-center gap-1">
                        {data.model.visibility === "team_shared" ? (
                          <>
                            <Globe className="w-3 h-3" /> 團隊共享
                          </>
                        ) : (
                          <>
                            <Lock className="w-3 h-3" /> 私人
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">使用次數</span>
                      <span className="font-medium">
                        {data.model.usageCount} 次
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">建立日期</span>
                      <span className="font-medium">
                        {new Date(data.model.createdAt).toLocaleDateString(
                          "zh-TW"
                        )}
                      </span>
                    </div>
                    {data.model.replicatePredictionId && (
                      <div className="flex justify-between col-span-2">
                        <span className="text-muted-foreground">
                          Replicate ID
                        </span>
                        <code className="font-mono text-[11px]">
                          {data.model.replicatePredictionId}
                        </code>
                      </div>
                    )}
                    {data.model.trainedLoraUrl && (
                      <div className="flex items-center gap-1.5 col-span-2 mt-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-[11px] text-green-700">
                          LoRA 權重已就緒
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Training Configuration */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 hs-h3 !mb-0">
                  <Settings2 className="w-4 h-4 text-muted-foreground" />
                  訓練配置
                </div>
                <div className="rounded-xl bg-muted/30 p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        觸發詞
                      </span>
                      <div className="text-sm font-mono font-medium">
                        {data.config.triggerWord || "—"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        訓練輪數
                      </span>
                      <div className="text-sm font-medium">
                        {data.config.epochs || "—"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        學習率
                      </span>
                      <div className="text-sm font-mono font-medium">
                        {data.config.learningRate
                          ? data.config.learningRate.toFixed(4)
                          : "—"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        批次大小
                      </span>
                      <div className="text-sm font-medium">
                        {data.config.batchSize || "—"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        訓練步驟
                      </span>
                      <div className="text-sm font-medium">
                        {data.config.steps || "—"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        資料集大小
                      </span>
                      <div className="text-sm font-medium">
                        {data.datasetImages.length} 張圖片
                      </div>
                    </div>
                  </div>
                  {data.config.submittedAt && (
                    <div className="mt-3 pt-3 border-t border-border/30 flex gap-4 text-xs text-muted-foreground">
                      <span>
                        提交時間：
                        {new Date(data.config.submittedAt).toLocaleString(
                          "zh-TW"
                        )}
                      </span>
                      {data.config.completedAt && (
                        <span>
                          完成時間：
                          {new Date(data.config.completedAt).toLocaleString(
                            "zh-TW"
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* Dataset Gallery */}
              {data.datasetImages.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 hs-h3 !mb-0">
                    <Database className="w-4 h-4 text-muted-foreground" />
                    訓練資料集（{data.datasetImages.length} 張）
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {data.datasetImages.map((img, idx) => (
                      <div
                        key={idx}
                        className="group relative aspect-square rounded-lg overflow-hidden bg-muted/30"
                      >
                        <img
                          src={img.url}
                          alt={img.caption || `Dataset ${idx + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[9px] text-white leading-tight line-clamp-2">
                            {img.caption || img.angle}
                          </span>
                        </div>
                        <span className="absolute top-1 left-1 text-[9px] bg-black/50 text-white px-1 rounded">
                          {ANGLE_LABELS[img.angle] ?? img.angle}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Training Jobs History */}
              <section className="space-y-3">
                <div className="flex items-center gap-2 hs-h3 !mb-0">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  訓練歷程（{data.trainingJobs.length} 筆任務）
                </div>
                {data.trainingJobs.length > 0 ? (
                  <div className="space-y-2">
                    {data.trainingJobs.map(job => (
                      <div
                        key={job.id}
                        className="rounded-xl bg-muted/30 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground">
                              #{job.id}
                            </span>
                            <StatusBadge status={job.status} />
                          </div>
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(job.createdAt).toLocaleString("zh-TW")}
                          </span>
                        </div>
                        <Progress value={job.progress} className="h-1.5" />
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground truncate flex-1">
                            {job.progressMessage || "—"}
                          </span>
                          <span className="text-muted-foreground tabular-nums ml-2">
                            {job.progress}%
                          </span>
                        </div>
                        {job.errorMessage && (
                          <p className="hs-small !mb-0 text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-2 py-1">
                            {job.errorMessage}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                    尚無訓練紀錄
                  </div>
                )}
              </section>
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function ModelsPage() {
  const { aiState, setPageContext, personality } = useAIState();
  const [, navigate] = useLocation();

  // 全站新手引導
  usePageTour("models");

  // 頁面分頁：角色鍛造所 | 模型訓練中心
  const [pageTab, setPageTab] = useState<"forge" | "trainer">("forge");

  useEffect(() => {
    if (pageTab === "forge") {
      setPageContext({ pageId: "models", pageLabel: "模型庫" });
      return () => setPageContext(null);
    }
  }, [pageTab, setPageContext]);

  const [tab, setTab] = useState("my");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<CharacterForgeStep>("dataset");
  const [modelName, setModelName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [description, setDescription] = useState("");
  const [datasetImages, setDatasetImages] = useState<DatasetImageWithUpload[]>(
    []
  );
  const [epochs, setEpochs] = useState(20);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [batchSize, setBatchSize] = useState(4);
  const [isUploading, setIsUploading] = useState(false);
  const [isCaptioning, setIsCaptioning] = useState(false);
  const [trainingJobId, setTrainingJobId] = useState<number | null>(null);
  const [analysisModelId, setAnalysisModelId] = useState<number | null>(null);
  const [guideOpenId, setGuideOpenId] = useState<string | null>("start");

  // ── 訓練進度輪詢 ──
  const trainingStatusQuery = trpc.generate.jobStatus.useQuery(
    { jobId: trainingJobId! },
    {
      enabled: !!trainingJobId,
      refetchInterval: query => {
        const data = query.state.data;
        if (!data) return 15000;
        if (data.status === "completed" || data.status === "failed")
          return false;
        return 15000;
      },
      retry: false,
    }
  );

  const myModelsQuery = trpc.models.myModels.useQuery(undefined, {
    retry: false,
  });
  const teamModelsQuery = trpc.models.teamModels.useQuery(undefined, {
    retry: false,
  });

  const createMutation = trpc.models.create.useMutation({
    onSuccess: data => {
      toast.success("角色模型訓練任務已建立");
      setTrainingJobId(data.jobId);
      myModelsQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const toggleVisibility = trpc.models.toggleVisibility.useMutation({
    onSuccess: () => {
      myModelsQuery.refetch();
      teamModelsQuery.refetch();
      toast.success("已更新，分享模型可獲得額外配額");
    },
  });

  const deleteModel = trpc.models.delete.useMutation({
    onSuccess: () => {
      myModelsQuery.refetch();
      toast.success("已刪除");
    },
  });

  const retrainMutation = trpc.models.retrain.useMutation({
    onSuccess: data => {
      setTrainingJobId(data.jobId);
      myModelsQuery.refetch();
      toast.success("重新訓練已啟動");
    },
    onError: e => toast.error("重新訓練失敗：" + e.message),
  });

  const syncStatusMutation = trpc.models.syncReplicateStatus.useMutation({
    onSuccess: data => {
      myModelsQuery.refetch();
      if (data.status === "ready") toast.success(`訓練完成！LoRA 已就緒`);
      else if (data.status === "failed") toast.error("訓練失敗，可以重試");
      else toast.info(`狀態已同步：${data.message}`);
    },
    onError: e => toast.error("同步失敗：" + e.message),
  });

  const captionMutation = trpc.models.captionImages.useMutation({
    onSuccess: data => {
      // Update captions on dataset images
      setDatasetImages(prev =>
        prev.map((img, idx) => ({
          ...img,
          caption: data.captions[idx] || img.caption,
          captionGenerated: true,
        }))
      );
      setIsCaptioning(false);
      toast.success("自動標註完成");
    },
    onError: e => {
      setIsCaptioning(false);
      toast.error("標註失敗：" + e.message);
    },
  });

  const resetForm = () => {
    setStep("dataset");
    setModelName("");
    setTriggerWord("");
    setDescription("");
    setDatasetImages([]);
    setEpochs(20);
    setLearningRate(0.0001);
    setBatchSize(4);
    setIsUploading(false);
    setIsCaptioning(false);
    setTrainingJobId(null);
  };

  const currentStepIndex = FORGE_STEPS.findIndex(s => s.id === step);

  // ── Upload files to S3 when added ──
  const handleFileUpload = useCallback(
    (angle: DatasetImageWithUpload["angle"]) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.onchange = async e => {
        const files = (e.target as HTMLInputElement).files;
        if (!files) return;

        const newImages: DatasetImageWithUpload[] = Array.from(files).map(
          file => ({
            url: URL.createObjectURL(file),
            angle,
            file,
            uploading: true,
            uploaded: false,
          })
        );

        setDatasetImages(prev => [...prev, ...newImages]);

        // Upload each file to S3
        for (let i = 0; i < newImages.length; i++) {
          const file = newImages[i].file!;
          try {
            const { url, fileKey } = await uploadFileToS3(file);
            setDatasetImages(prev =>
              prev.map(img =>
                img.file === file
                  ? {
                      ...img,
                      uploadedUrl: url,
                      uploadedKey: fileKey,
                      uploading: false,
                      uploaded: true,
                    }
                  : img
              )
            );
          } catch (err: any) {
            toast.error(`上傳失敗：${shortErrorMsg(err)}`, { duration: 5000 });
            setDatasetImages(prev =>
              prev.map(img =>
                img.file === file ? { ...img, uploading: false } : img
              )
            );
          }
        }
      };
      input.click();
    },
    []
  );

  const removeImage = (idx: number) => {
    setDatasetImages(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Auto-caption via LLM when entering captioning step ──
  const handleAutoCaptioning = useCallback(() => {
    const uploadedImages = datasetImages.filter(
      img => img.uploaded && img.uploadedUrl
    );
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

  // ── Start training with real data ──
  const handleStartTraining = useCallback(() => {
    if (!modelName.trim()) {
      toast.error("請輸入模型名稱");
      return;
    }
    if (!triggerWord.trim()) {
      toast.error("請設定觸發詞");
      return;
    }

    const uploadedImages = datasetImages.filter(
      img => img.uploaded && img.uploadedUrl
    );
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
      // Send all uploaded image URLs and their captions
      datasetImages: uploadedImages.map(img => ({
        url: img.uploadedUrl!,
        fileKey: img.uploadedKey!,
        angle: img.angle,
        caption: img.caption,
      })),
    });
  }, [
    modelName,
    triggerWord,
    description,
    epochs,
    learningRate,
    batchSize,
    datasetImages,
    createMutation,
  ]);

  const allUploaded =
    datasetImages.length > 0 && datasetImages.every(img => img.uploaded);
  const anyUploading = datasetImages.some(img => img.uploading);

  const canProceed = () => {
    switch (step) {
      case "dataset":
        return (
          modelName.trim() !== "" && datasetImages.length >= 3 && allUploaded
        );
      case "captioning":
        return triggerWord.trim() !== "";
      case "hyperparams":
        return true;
      case "training":
        return true;
      default:
        return false;
    }
  };

  const models = tab === "my" ? myModelsQuery.data : teamModelsQuery.data;
  const isLoading =
    tab === "my" ? myModelsQuery.isLoading : teamModelsQuery.isLoading;

  // ── PageAgent（光球可以代操分頁切換與導航）──────────────────────
  const MODELS_TAB_OPTIONS = useMemo(
    () => [
      { id: "my", label: "我的模型", meta: { bestFor: "版本治理", tip: "依用途標記 stable / experimental" } },
      { id: "team", label: "團隊共享", meta: { bestFor: "跨團隊復用", tip: "附註推薦參數與禁用情境" } },
    ],
    []
  );
  const MODELS_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set(["/studio", "/image-studio", "/lora-trainer", "/assets"]),
    []
  );
  const modelsAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換模型分頁",
        currentId: tab,
        options: MODELS_TAB_OPTIONS,
        hint: "my（我的模型）或 team（團隊共享）",
      },
      {
        action: "navigate",
        label: "前往相關頁面",
        hint: "可導航到 /studio、/image-studio、/lora-trainer、/assets",
      },
    ],
    [tab, MODELS_TAB_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "models",
    pageLabel: "角色鍛造所",
    pagePath: "/models",
    capabilities: modelsAgentCapabilities,
    state: {
      tab,
      myModelsCount: myModelsQuery.data?.length ?? 0,
      teamModelsCount: teamModelsQuery.data?.length ?? 0,
      trainingJobId,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          if (action.tabId !== "my" && action.tabId !== "team") {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          setTab(action.tabId);
          return { ok: true, message: `切到「${action.tabId}」分頁` };
        }
        case "navigate": {
          const path = action.path;
          if (!MODELS_NAV_ALLOWLIST.has(path)) {
            return { ok: false, reason: `navigation blocked: ${path}` };
          }
          navigate(path);
          return { ok: true, message: `已導航到 ${path}` };
        }
        case "reset": {
          setTab("my");
          return { ok: true, message: "已回到我的模型" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on models: ${action.type}`,
          };
      }
    },
  });

  return (
    <div className="space-y-6">
      {/* 頁面切換標籤 */}
      <div className="flex items-center gap-1 border-b border-border/50 pb-0">
        <button
          type="button"
          onClick={() => setPageTab("forge")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            pageTab === "forge"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Cpu className="w-4 h-4" />
          角色鍛造所
        </button>
        <button
          type="button"
          onClick={() => setPageTab("trainer")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
            pageTab === "trainer"
              ? "bg-primary/10 text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="w-4 h-4" />
          模型訓練中心
        </button>
      </div>

      {pageTab === "trainer" ? (
        <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
          <LoraTrainer />
        </Suspense>
      ) : (
        <>
          <AssetModelSubpageGuide page="models" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Cpu className="w-5 h-5 text-muted-foreground" />
          <h1 className="hs-h2 !mb-0">角色鍛造所</h1>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={open => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button className="rounded-xl gap-1.5 text-sm">
              <Plus className="w-4 h-4" />
              新增角色
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <VisualSoul size="sm" personality={personality} />
                角色鍛造精靈
              </DialogTitle>
            </DialogHeader>

            {/* Step Indicator */}
            <div className="flex items-center gap-1 mb-6">
              {FORGE_STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center gap-1 flex-1">
                  <div
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all w-full justify-center ${i <= currentStepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {s.icon}
                    <span className="hidden sm:inline">{s.label}</span>
                  </div>
                  {i < FORGE_STEPS.length - 1 && (
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                  )}
                </div>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {step === "dataset" && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">模型名稱</Label>
                      <Input
                        placeholder="例如：角色 A"
                        value={modelName}
                        onChange={e => setModelName(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        描述（選填）
                      </Label>
                      <Textarea
                        placeholder="角色的背景描述..."
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        className="rounded-xl"
                        rows={2}
                      />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">
                        多角度資料集
                      </Label>
                      <p className="hs-small !mb-0 text-muted-foreground">
                        上傳至少 3 張不同角度的圖片，圖片會自動上傳至雲端儲存
                      </p>
                      <div className="grid grid-cols-5 gap-2">
                        {ANGLES.map(angle => {
                          const images = datasetImages.filter(
                            img => img.angle === angle.value
                          );
                          const hasUploading = images.some(
                            img => img.uploading
                          );
                          return (
                            <div key={angle.value} className="space-y-1.5">
                              <span className="text-[11px] font-medium text-muted-foreground text-center block">
                                {angle.label}
                              </span>
                              <button
                                onClick={() => handleFileUpload(angle.value)}
                                className="w-full aspect-square rounded-xl border-2 border-dashed border-border/50 hover:border-primary/30 transition-colors flex flex-col items-center justify-center gap-1 bg-muted/20 relative overflow-hidden"
                              >
                                {images.length > 0 ? (
                                  <div className="relative w-full h-full">
                                    <img
                                      src={
                                        images[images.length - 1].uploadedUrl ||
                                        images[images.length - 1].url
                                      }
                                      alt={angle.label}
                                      className="w-full h-full object-cover rounded-xl"
                                      loading="lazy"
                                    />
                                    <span className="absolute bottom-1 right-1 text-[10px] bg-black/50 text-white px-1.5 rounded-md">
                                      {images.length}
                                    </span>
                                    {hasUploading && (
                                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-xl">
                                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                                      </div>
                                    )}
                                    {!hasUploading &&
                                      images.every(i => i.uploaded) && (
                                        <div className="absolute top-1 left-1">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                                        </div>
                                      )}
                                  </div>
                                ) : (
                                  <>
                                    <Upload className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-[10px] text-muted-foreground">
                                      上傳
                                    </span>
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
                              {datasetImages.filter(i => i.uploaded).length}/
                              {datasetImages.length} 張已上傳
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
                              <div
                                key={idx}
                                className="relative w-12 h-12 rounded-lg overflow-hidden group"
                              >
                                <img
                                  src={img.uploadedUrl || img.url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                                {img.uploading && (
                                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                    <Loader2 className="w-3 h-3 text-white animate-spin" />
                                  </div>
                                )}
                                <button
                                  onClick={() => removeImage(idx)}
                                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                >
                                  <X className="w-3 h-3 text-white" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {step === "captioning" && (
                  <div className="space-y-5">
                    <div className="text-center py-4">
                      <Tag className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                      <h3 className="hs-h3 !mb-0">自動標註與觸發詞</h3>
                      <p className="hs-small !mb-0 text-muted-foreground mt-1">
                        AI 會自動為每張圖片生成描述標註
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">觸發詞 *</Label>
                      <Input
                        placeholder="例如：char_a（唯一識別碼）"
                        value={triggerWord}
                        onChange={e => setTriggerWord(e.target.value)}
                        className="rounded-xl font-mono"
                      />
                      <p className="hs-small !mb-0 text-muted-foreground">
                        在提示詞中使用此觸發詞來呼叫此角色
                      </p>
                    </div>

                    {/* Auto-caption button */}
                    <Button
                      onClick={handleAutoCaptioning}
                      disabled={isCaptioning || !allUploaded}
                      variant="outline"
                      className="w-full rounded-xl gap-2"
                    >
                      {isCaptioning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          AI 標註中...
                        </>
                      ) : (
                        <>
                          <Tag className="w-4 h-4" />
                          執行 AI 自動標註
                        </>
                      )}
                    </Button>

                    <div className="rounded-xl bg-muted/30 p-4 space-y-2">
                      <h4 className="hs-small !mb-0 font-medium">標註結果</h4>
                      {datasetImages.slice(0, 5).map((img, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 text-xs"
                        >
                          <img
                            src={img.uploadedUrl || img.url}
                            alt=""
                            className="w-8 h-8 rounded-md object-cover shrink-0"
                            loading="lazy"
                          />
                          <div className="flex-1 min-w-0">
                            {img.captionGenerated ? (
                              <span className="text-foreground">
                                {img.caption}
                              </span>
                            ) : isCaptioning ? (
                              <span className="text-muted-foreground animate-pulse">
                                AI 分析中...
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">
                                點擊「執行 AI 自動標註」生成描述
                              </span>
                            )}
                          </div>
                          {img.captionGenerated && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                          )}
                        </div>
                      ))}
                      {datasetImages.length > 5 && (
                        <p className="hs-small !mb-0 text-muted-foreground">
                          ...還有 {datasetImages.length - 5} 張圖片
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {step === "hyperparams" && (
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <ZenTooltip tooltipKey="epochs">
                        <Label className="text-sm font-medium">
                          訓練輪數 (Epochs)
                        </Label>
                      </ZenTooltip>
                      <div className="flex items-center gap-4">
                        <Slider
                          value={[epochs]}
                          onValueChange={([v]) => setEpochs(v)}
                          min={5}
                          max={50}
                          step={5}
                          className="flex-1"
                        />
                        <span className="text-sm tabular-nums font-mono w-8 text-right">
                          {epochs}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <ZenTooltip tooltipKey="learningRate">
                        <Label className="text-sm font-medium">
                          學習率 (Learning Rate)
                        </Label>
                      </ZenTooltip>
                      <div className="flex items-center gap-4">
                        <Slider
                          value={[learningRate * 10000]}
                          onValueChange={([v]) => setLearningRate(v / 10000)}
                          min={1}
                          max={10}
                          step={1}
                          className="flex-1"
                        />
                        <span className="text-sm tabular-nums font-mono w-16 text-right">
                          {learningRate.toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <ZenTooltip tooltipKey="batchSize">
                        <Label className="text-sm font-medium">
                          批次大小 (Batch Size)
                        </Label>
                      </ZenTooltip>
                      <div className="flex items-center gap-4">
                        <Slider
                          value={[batchSize]}
                          onValueChange={([v]) => setBatchSize(v)}
                          min={1}
                          max={16}
                          step={1}
                          className="flex-1"
                        />
                        <span className="text-sm tabular-nums font-mono w-8 text-right">
                          {batchSize}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-4">
                      <h4 className="hs-small font-medium mb-2">
                        預估訓練資訊
                      </h4>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>
                          資料集大小：
                          {datasetImages.filter(i => i.uploaded).length} 張
                        </span>
                        <span>
                          預估時間：~
                          {Math.ceil(epochs * datasetImages.length * 0.5)} 分鐘
                        </span>
                        <span>
                          訓練步驟：~
                          {epochs * Math.ceil(datasetImages.length / batchSize)}
                        </span>
                        <span>
                          觸發詞：
                          <code className="font-mono text-foreground">
                            {triggerWord || "未設定"}
                          </code>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {step === "training" && (
                  <div className="space-y-5 text-center py-6">
                    {trainingJobId ? (
                      <>
                        {/* ── 即時訓練進度顯示 ── */}
                        {trainingStatusQuery.data?.status === "completed" ? (
                          <>
                            <div className="flex justify-center">
                              <CheckCircle2 className="w-12 h-12 text-green-500" />
                            </div>
                            <h3 className="hs-h3 !mb-0">
                              訓練完成！模型已就緒
                            </h3>
                            <p className="hs-p !mb-0 text-muted-foreground">
                              模型已成功訓練完成，可在工作室的素材抽屜中直接使用。
                            </p>
                            <Button
                              onClick={() => {
                                setDialogOpen(false);
                                resetForm();
                                myModelsQuery.refetch();
                              }}
                              className="w-full h-12 rounded-xl gap-2"
                            >
                              <CheckCircle2 className="w-4 h-4" /> 返回模型列表
                            </Button>
                          </>
                        ) : trainingStatusQuery.data?.status === "failed" ? (
                          <>
                            <div className="flex justify-center">
                              <X className="w-12 h-12 text-red-500" />
                            </div>
                            <h3 className="hs-h3 !mb-0 text-red-500">
                              訓練失敗
                            </h3>
                            <p className="hs-p !mb-0 text-muted-foreground">
                              {trainingStatusQuery.data?.errorMessage ||
                                "訓練過程中發生錯誤，請重試或聯繫支援。"}
                            </p>
                            <Button
                              onClick={() => {
                                setDialogOpen(false);
                                resetForm();
                              }}
                              variant="outline"
                              className="w-full h-12 rounded-xl gap-2"
                            >
                              關閉
                            </Button>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-center">
                              <Loader2 className="w-12 h-12 text-primary animate-spin" />
                            </div>
                            <h3 className="hs-h3 !mb-0">模型訓練中...</h3>
                            <p className="hs-p !mb-0 text-muted-foreground">
                              {trainingStatusQuery.data?.progressMessage ||
                                "訓練任務已加入佇列，請稍候..."}
                            </p>
                            {/* 進度條 */}
                            <div className="w-full bg-muted/40 rounded-full h-3 overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
                                style={{
                                  width: `${trainingStatusQuery.data?.progress ?? 0}%`,
                                }}
                              />
                            </div>
                            <p className="hs-small !mb-0 text-muted-foreground">
                              進度：{trainingStatusQuery.data?.progress ?? 0}% ·
                              任務 ID: #{trainingJobId}
                            </p>
                            <Button
                              onClick={() => {
                                setDialogOpen(false);
                                resetForm();
                              }}
                              variant="outline"
                              className="w-full h-12 rounded-xl gap-2"
                            >
                              最小化（背景繼續訓練）
                            </Button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex justify-center">
                          <VisualSoul size="lg" personality={personality} />
                        </div>
                        <h3 className="hs-h3 !mb-0">確認訓練設定</h3>
                        <div className="rounded-xl bg-muted/30 p-4 text-left space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              模型名稱
                            </span>
                            <span className="font-medium">{modelName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              觸發詞
                            </span>
                            <code className="font-mono text-xs">
                              {triggerWord}
                            </code>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              資料集
                            </span>
                            <span>
                              {datasetImages.filter(i => i.uploaded).length}{" "}
                              張圖片（已上傳至雲端）
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              訓練輪數
                            </span>
                            <span>{epochs}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              學習率
                            </span>
                            <span className="font-mono text-xs">
                              {learningRate.toFixed(4)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              批次大小
                            </span>
                            <span>{batchSize}</span>
                          </div>
                        </div>
                        <Button
                          onClick={handleStartTraining}
                          disabled={createMutation.isPending}
                          className="w-full h-12 rounded-xl gap-2"
                        >
                          {createMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Flame className="w-4 h-4" />
                          )}
                          {createMutation.isPending ? "啟動中..." : "開始訓練"}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {step !== "training" && (
              <div className="flex justify-between mt-6 pt-4 border-t border-border/30">
                <Button
                  variant="outline"
                  className="rounded-xl gap-1 text-sm"
                  onClick={() => {
                    const idx = currentStepIndex - 1;
                    if (idx >= 0) setStep(FORGE_STEPS[idx].id);
                  }}
                  disabled={currentStepIndex === 0}
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> 上一步
                </Button>
                <Button
                  className="rounded-xl gap-1 text-sm"
                  onClick={() => {
                    const idx = currentStepIndex + 1;
                    if (idx < FORGE_STEPS.length) setStep(FORGE_STEPS[idx].id);
                  }}
                  disabled={!canProceed()}
                >
                  {anyUploading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      上傳中...
                    </>
                  ) : (
                    <>
                      下一步 <ChevronRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card/70 p-4 md:p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="hs-h3 !mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              模型細膩導覽
            </p>
            <p className="hs-small !mb-0 text-muted-foreground">
              使用折疊式導覽，依照你的熟悉度展開需要的步驟與建議。
            </p>
          </div>
          <Badge variant="secondary" className="rounded-full">
            UI/UX Guide
          </Badge>
        </div>

        <div className="space-y-2">
          {MODEL_GUIDE_SECTIONS.map(section => {
            const isOpen = guideOpenId === section.id;
            return (
              <Collapsible
                key={section.id}
                open={isOpen}
                onOpenChange={open => setGuideOpenId(open ? section.id : null)}
                className="rounded-xl border border-border/70 bg-background/70"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full px-3 py-3 text-left flex items-center justify-between gap-3 hover:bg-muted/40 rounded-xl transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium">{section.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {section.summary}
                      </p>
                    </div>
                    <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3 pb-3">
                  <ul className="space-y-1.5 list-disc pl-5">
                    {section.bullets.map(item => (
                      <li key={item} className="text-xs text-muted-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </section>

      <p className="hs-small !mb-0 text-muted-foreground">
        訓練專屬角色模型，確保跨場景的角色一致性。模型就緒後可在工作室的素材抽屜中直接使用。
      </p>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="my" className="rounded-lg gap-1 text-xs">
            <Lock className="w-3 h-3" /> 我的模型
          </TabsTrigger>
          <TabsTrigger value="team" className="rounded-lg gap-1 text-xs">
            <Globe className="w-3 h-3" /> 團隊共享
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Models Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <GlassCard key={i} hover={false}>
              <ZenSkeleton lines={4} />
            </GlassCard>
          ))}
        </div>
      ) : models && models.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map(model => (
            <GlassCard key={model.id}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="hs-h3 !mb-0 truncate">{model.name}</h3>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${model.status === "ready" ? "bg-zen-sage/30 text-green-700" : model.status === "training" ? "bg-zen-peach/30 text-amber-700" : model.status === "failed" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}
                  >
                    {model.status === "ready"
                      ? "就緒"
                      : model.status === "training"
                        ? "訓練中"
                        : model.status === "failed"
                          ? "失敗"
                          : "佇列中"}
                  </span>
                </div>
                {(() => {
                  const cfg = model.configJson as Record<
                    string,
                    unknown
                  > | null;
                  const tw = cfg?.triggerWord;
                  if (!tw) return null;
                  return (
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3 h-3 text-muted-foreground" />
                      <code className="text-xs font-mono text-muted-foreground">
                        {String(tw)}
                      </code>
                    </div>
                  );
                })()}
                {model.description && (
                  <p className="hs-small !mb-0 text-muted-foreground line-clamp-2">
                    {model.description}
                  </p>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {model.visibility === "team_shared" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-md">
                      <Gift className="w-2.5 h-2.5" /> 共享
                    </span>
                  )}
                  {(model as any).usageCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/20 px-2 py-0.5 rounded-md">
                      使用 {(model as any).usageCount} 次
                    </span>
                  )}
                  {(model as any).trainedLoraUrl && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-700 bg-green-50 px-2 py-0.5 rounded-md">
                      ✓ LoRA 權重已就緒
                    </span>
                  )}
                </div>
                {/* Training status indicator for "training" state */}
                {model.status === "training" && (
                  <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 text-center">
                    <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
                    正在 Replicate 上訓練中，約需 20-60 分鐘
                  </div>
                )}
                {/* Use in Studio buttons */}
                {model.status === "ready" && (
                  <div className="flex gap-1.5">
                    {model.modelType === "voice_clone" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 text-xs gap-1 rounded-lg"
                        onClick={() => {
                          sessionStorage.setItem(
                            "applyModel",
                            JSON.stringify({
                              id: model.id,
                              name: model.name,
                              modelType: model.modelType,
                              triggerWord:
                                (model.configJson as any)?.triggerWord || "",
                            })
                          );
                          navigate("/pro-studio");
                          toast.success(
                            `已套用語音模型「${model.name}」至專業創作室`
                          );
                        }}
                      >
                        <Mic className="w-3 h-3" />
                        套用至專業創作室
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-7 text-xs gap-1 rounded-lg"
                          onClick={() => {
                            sessionStorage.setItem(
                              "applyModel",
                              JSON.stringify({
                                id: model.id,
                                name: model.name,
                                modelType: model.modelType,
                                triggerWord:
                                  (model.configJson as any)?.triggerWord || "",
                                loraUrl:
                                  (model as any).trainedLoraUrl ||
                                  (model.configJson as any)?.loraUrl ||
                                  "",
                              })
                            );
                            navigate("/studio");
                            toast.success(
                              `已套用模型「${model.name}」，前往創作工作室`
                            );
                          }}
                        >
                          <Wand2 className="w-3 h-3" />
                          套用至工作室
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 rounded-lg"
                          title="在圖片工作室使用此模型（LoRA 注入）"
                          onClick={() => {
                            sessionStorage.setItem(
                              "applyModel",
                              JSON.stringify({
                                id: model.id,
                                name: model.name,
                                modelType: model.modelType,
                                triggerWord:
                                  (model.configJson as any)?.triggerWord || "",
                                loraUrl: (model as any).trainedLoraUrl || "",
                              })
                            );
                            navigate("/image-studio");
                            toast.success(
                              `已套用模型「${model.name}」至圖片工作室`
                            );
                          }}
                        >
                          <Image className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 rounded-lg"
                          title="在影片工作室使用觸發詞"
                          onClick={() => {
                            sessionStorage.setItem(
                              "applyModel",
                              JSON.stringify({
                                id: model.id,
                                name: model.name,
                                modelType: model.modelType,
                                triggerWord:
                                  (model.configJson as any)?.triggerWord || "",
                              })
                            );
                            navigate("/video-studio");
                            toast.success(
                              `已套用模型「${model.name}」至影片工作室`
                            );
                          }}
                        >
                          <Video className="w-3 h-3" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {/* Sync / Retrain buttons for non-ready models */}
                {tab === "my" &&
                  (model.status === "training" ||
                    model.status === "pending") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs gap-1 rounded-lg"
                      disabled={syncStatusMutation.isPending}
                      onClick={() =>
                        syncStatusMutation.mutate({ modelId: model.id })
                      }
                    >
                      {syncStatusMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Settings2 className="w-3 h-3" />
                      )}
                      同步訓練狀態
                    </Button>
                  )}
                {tab === "my" && model.status === "failed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-xs gap-1 rounded-lg text-amber-600 border-amber-300"
                    disabled={retrainMutation.isPending}
                    onClick={() =>
                      retrainMutation.mutate({ modelId: model.id })
                    }
                  >
                    {retrainMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Flame className="w-3 h-3" />
                    )}
                    重新訓練
                  </Button>
                )}
                {/* View Analysis button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-xs gap-1 rounded-lg"
                  onClick={() => setAnalysisModelId(model.id)}
                >
                  <Eye className="w-3 h-3" />
                  詳細分析
                </Button>
                <div className="flex items-center justify-between pt-2 border-t border-border/30">
                  <span className="text-[11px] text-muted-foreground">
                    {model.createdAt &&
                      new Date(model.createdAt).toLocaleDateString("zh-TW")}
                  </span>
                  {tab === "my" && (
                    <div className="flex gap-1">
                      {model.status === "ready" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 rounded-lg"
                          title={
                            model.visibility === "private"
                              ? "分享給團隊"
                              : "設為私人"
                          }
                          onClick={() =>
                            toggleVisibility.mutate({
                              id: model.id,
                              visibility:
                                model.visibility === "private"
                                  ? "team_shared"
                                  : "private",
                            })
                          }
                        >
                          {model.visibility === "private" ? (
                            <Globe className="w-3.5 h-3.5" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 rounded-lg text-destructive"
                        onClick={() => deleteModel.mutate({ id: model.id })}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <VisualSoul size="lg" personality={personality} />
          <h3 className="hs-h3 !mb-0 mt-6">尚無角色模型</h3>
          <p className="hs-p !mb-0 text-muted-foreground mt-2 max-w-sm">
            {tab === "my"
              ? "點擊「新增角色」開始訓練你的第一個角色模型"
              : "還沒有團隊共享的模型"}
          </p>
        </div>
      )}

      {/* Model Analysis Dialog */}
      {analysisModelId !== null && (
        <ModelAnalysisDialog
          modelId={analysisModelId}
          open={true}
          onOpenChange={open => {
            if (!open) setAnalysisModelId(null);
          }}
        />
      )}
        </>
      )}
    </div>
  );
}
