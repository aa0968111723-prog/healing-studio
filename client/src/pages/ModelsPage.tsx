import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Cpu, Plus, Upload, Tag, Settings2, Flame, ChevronRight, ChevronLeft, X, Loader2, Globe, Lock, Trash2, Gift } from "lucide-react";
import { GlassCard, ZenTooltip, ZenSkeleton, ZenOrb } from "@/components/ZenCoPilot";
import { motion, AnimatePresence } from "framer-motion";
import type { CharacterForgeStep, DatasetImage } from "@shared/types";

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

export default function ModelsPage() {
  const [tab, setTab] = useState("my");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<CharacterForgeStep>("dataset");
  const [modelName, setModelName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [description, setDescription] = useState("");
  const [datasetImages, setDatasetImages] = useState<DatasetImage[]>([]);
  const [epochs, setEpochs] = useState(20);
  const [learningRate, setLearningRate] = useState(0.0001);
  const [batchSize, setBatchSize] = useState(4);

  const myModelsQuery = trpc.models.myModels.useQuery(undefined, { retry: false });
  const teamModelsQuery = trpc.models.teamModels.useQuery(undefined, { retry: false });

  const createMutation = trpc.models.create.useMutation({
    onSuccess: () => {
      toast.success("角色模型訓練已啟動");
      setDialogOpen(false);
      resetForm();
      myModelsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
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

  const resetForm = () => {
    setStep("dataset");
    setModelName("");
    setTriggerWord("");
    setDescription("");
    setDatasetImages([]);
    setEpochs(20);
    setLearningRate(0.0001);
    setBatchSize(4);
  };

  const currentStepIndex = FORGE_STEPS.findIndex((s) => s.id === step);

  const handleFileUpload = (angle: DatasetImage["angle"]) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        Array.from(files).forEach((file) => {
          const url = URL.createObjectURL(file);
          setDatasetImages((prev) => [...prev, { url, angle }]);
        });
      }
    };
    input.click();
  };

  const removeImage = (idx: number) => {
    setDatasetImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleStartTraining = () => {
    if (!modelName.trim()) { toast.error("請輸入模型名稱"); return; }
    if (!triggerWord.trim()) { toast.error("請設定觸發詞"); return; }
    createMutation.mutate({
      name: modelName,
      triggerWord,
      description,
      epochs,
      learningRate,
      batchSize,
    });
  };

  const canProceed = () => {
    switch (step) {
      case "dataset": return modelName.trim() !== "" && datasetImages.length >= 3;
      case "captioning": return triggerWord.trim() !== "";
      case "hyperparams": return true;
      case "training": return true;
      default: return false;
    }
  };

  const models = tab === "my" ? myModelsQuery.data : teamModelsQuery.data;
  const isLoading = tab === "my" ? myModelsQuery.isLoading : teamModelsQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Cpu className="w-5 h-5 text-zen-smoke" />
          <h1 className="text-xl font-semibold">角色鍛造所</h1>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="rounded-xl gap-1.5 text-sm">
              <Plus className="w-4 h-4" />
              新增角色
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ZenOrb size="sm" />
                角色鍛造精靈
              </DialogTitle>
            </DialogHeader>

            {/* Step Indicator */}
            <div className="flex items-center gap-1 mb-6">
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
                {step === "dataset" && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">模型名稱</Label>
                      <Input placeholder="例如：禪意角色 A" value={modelName} onChange={(e) => setModelName(e.target.value)} className="rounded-xl" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">描述（選填）</Label>
                      <Textarea placeholder="角色的背景描述..." value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl" rows={2} />
                    </div>
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">多角度資料集</Label>
                      <p className="text-xs text-muted-foreground">上傳至少 3 張不同角度的圖片，以確保角色一致性</p>
                      <div className="grid grid-cols-5 gap-2">
                        {ANGLES.map((angle) => {
                          const images = datasetImages.filter((img) => img.angle === angle.value);
                          return (
                            <div key={angle.value} className="space-y-1.5">
                              <span className="text-[11px] font-medium text-muted-foreground text-center block">{angle.label}</span>
                              <button onClick={() => handleFileUpload(angle.value)} className="w-full aspect-square rounded-xl border-2 border-dashed border-border/50 hover:border-primary/30 transition-colors flex flex-col items-center justify-center gap-1 bg-muted/20">
                                {images.length > 0 ? (
                                  <div className="relative w-full h-full">
                                    <img src={images[images.length - 1].url} alt={angle.label} className="w-full h-full object-cover rounded-xl" />
                                    <span className="absolute bottom-1 right-1 text-[10px] bg-black/50 text-white px-1.5 rounded-md">{images.length}</span>
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
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {datasetImages.map((img, idx) => (
                            <div key={idx} className="relative w-12 h-12 rounded-lg overflow-hidden group">
                              <img src={img.url} alt="" className="w-full h-full object-cover" />
                              <button onClick={() => removeImage(idx)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <X className="w-3 h-3 text-white" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {step === "captioning" && (
                  <div className="space-y-5">
                    <div className="text-center py-4">
                      <Tag className="w-8 h-8 text-zen-smoke mx-auto mb-3" />
                      <h3 className="text-sm font-medium">自動標註與觸發詞</h3>
                      <p className="text-xs text-muted-foreground mt-1">系統會自動為每張圖片生成描述標註</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">觸發詞 *</Label>
                      <Input placeholder="例如：zen_char_a（唯一識別碼）" value={triggerWord} onChange={(e) => setTriggerWord(e.target.value)} className="rounded-xl font-mono" />
                      <p className="text-[11px] text-muted-foreground">在提示詞中使用此觸發詞來呼叫此角色</p>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-4 space-y-2">
                      <h4 className="text-xs font-medium">自動標註預覽</h4>
                      {datasetImages.slice(0, 3).map((img, idx) => (
                        <div key={idx} className="flex items-center gap-3 text-xs">
                          <img src={img.url} alt="" className="w-8 h-8 rounded-md object-cover" />
                          <span className="text-muted-foreground">
                            {img.angle === "front" ? "正面照，自然光線" : img.angle === "side" ? "側面照，輪廓清晰" : img.angle === "back" ? "背面照，整體輪廓" : img.angle === "expression" ? "表情特寫，情緒豐富" : "其他角度"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {step === "hyperparams" && (
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
                      <ZenTooltip tooltipKey="batchSize"><Label className="text-sm font-medium">批次大小 (Batch Size)</Label></ZenTooltip>
                      <div className="flex items-center gap-4">
                        <Slider value={[batchSize]} onValueChange={([v]) => setBatchSize(v)} min={1} max={16} step={1} className="flex-1" />
                        <span className="text-sm tabular-nums font-mono w-8 text-right">{batchSize}</span>
                      </div>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-4">
                      <h4 className="text-xs font-medium mb-2">預估訓練資訊</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>資料集大小：{datasetImages.length} 張</span>
                        <span>預估時間：~{Math.ceil(epochs * datasetImages.length * 0.5)} 分鐘</span>
                        <span>訓練步驟：~{epochs * Math.ceil(datasetImages.length / batchSize)}</span>
                        <span>觸發詞：<code className="font-mono text-foreground">{triggerWord || "未設定"}</code></span>
                      </div>
                    </div>
                  </div>
                )}

                {step === "training" && (
                  <div className="space-y-5 text-center py-6">
                    <div className="flex justify-center"><ZenOrb size="lg" /></div>
                    <h3 className="text-base font-medium">確認訓練設定</h3>
                    <div className="rounded-xl bg-muted/30 p-4 text-left space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">模型名稱</span><span className="font-medium">{modelName}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">觸發詞</span><code className="font-mono text-xs">{triggerWord}</code></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">資料集</span><span>{datasetImages.length} 張圖片</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">訓練輪數</span><span>{epochs}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">學習率</span><span className="font-mono text-xs">{learningRate.toFixed(4)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">批次大小</span><span>{batchSize}</span></div>
                    </div>
                    <Button onClick={handleStartTraining} disabled={createMutation.isPending} className="w-full h-12 rounded-xl gap-2">
                      {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flame className="w-4 h-4" />}
                      {createMutation.isPending ? "啟動中..." : "開始訓練"}
                    </Button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {step !== "training" && (
              <div className="flex justify-between mt-6 pt-4 border-t border-border/30">
                <Button variant="outline" className="rounded-xl gap-1 text-sm" onClick={() => { const idx = currentStepIndex - 1; if (idx >= 0) setStep(FORGE_STEPS[idx].id); }} disabled={currentStepIndex === 0}>
                  <ChevronLeft className="w-3.5 h-3.5" /> 上一步
                </Button>
                <Button className="rounded-xl gap-1 text-sm" onClick={() => { const idx = currentStepIndex + 1; if (idx < FORGE_STEPS.length) setStep(FORGE_STEPS[idx].id); }} disabled={!canProceed()}>
                  下一步 <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-xs text-muted-foreground">訓練專屬角色模型，確保跨場景的角色一致性。模型就緒後可在工作室的素材抽屜中直接使用。</p>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl bg-muted/40 p-1">
          <TabsTrigger value="my" className="rounded-lg gap-1 text-xs"><Lock className="w-3 h-3" /> 我的模型</TabsTrigger>
          <TabsTrigger value="team" className="rounded-lg gap-1 text-xs"><Globe className="w-3 h-3" /> 團隊共享</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Models Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (<GlassCard key={i} hover={false}><ZenSkeleton lines={4} /></GlassCard>))}
        </div>
      ) : models && models.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model) => (
            <GlassCard key={model.id}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold truncate">{model.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${model.status === "ready" ? "bg-zen-sage/30 text-green-700" : model.status === "training" ? "bg-zen-peach/30 text-amber-700" : model.status === "failed" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"}`}>
                    {model.status === "ready" ? "就緒" : model.status === "training" ? "訓練中" : model.status === "failed" ? "失敗" : "佇列中"}
                  </span>
                </div>
                {(() => {
                  const cfg = model.configJson as Record<string, unknown> | null;
                  const tw = cfg?.triggerWord;
                  if (!tw) return null;
                  return (
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3 h-3 text-muted-foreground" />
                      <code className="text-xs font-mono text-muted-foreground">{String(tw)}</code>
                    </div>
                  );
                })()}
                {model.description && <p className="text-xs text-muted-foreground line-clamp-2">{model.description}</p>}
                {model.visibility === "team_shared" && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-md">
                    <Gift className="w-2.5 h-2.5" /> 共享
                  </span>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-border/30">
                  <span className="text-[11px] text-muted-foreground">{model.createdAt && new Date(model.createdAt).toLocaleDateString("zh-TW")}</span>
                  {tab === "my" && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={() => toggleVisibility.mutate({ id: model.id, visibility: model.visibility === "private" ? "team_shared" : "private" })}>
                        {model.visibility === "private" ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg text-destructive" onClick={() => deleteModel.mutate({ id: model.id })}>
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
          <ZenOrb size="lg" />
          <h3 className="text-base font-medium mt-6">尚無角色模型</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            {tab === "my" ? "點擊「新增角色」開始訓練你的第一個角色模型" : "還沒有團隊共享的模型"}
          </p>
        </div>
      )}
    </div>
  );
}
