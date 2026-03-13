import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VibeCardWizard } from "@/components/VibeCardWizard";
import { GenerationControls } from "@/components/GenerationControls";
import { FrameTimeline } from "@/components/FrameTimeline";
import { ZenProgressOverlay, GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { toast } from "sonner";
import { Image, Video, Music, Mic, Layers, Wand2, Download, PanelRightOpen, PanelRightClose, GripVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/useMobile";
import { BottomSheet } from "@/components/ZenCoPilot";
import { PROGRESS_MESSAGES } from "@shared/types";
import type { GenerationMode, GenerationType } from "@shared/types";

const GEN_TYPES: { value: GenerationType; label: string; icon: React.ReactNode }[] = [
  { value: "image", label: "圖片", icon: <Image className="w-4 h-4" /> },
  { value: "video", label: "影片", icon: <Video className="w-4 h-4" /> },
  { value: "audio", label: "音樂", icon: <Music className="w-4 h-4" /> },
  { value: "voice", label: "語音", icon: <Mic className="w-4 h-4" /> },
  { value: "multimodal", label: "多模態", icon: <Layers className="w-4 h-4" /> },
];

export default function Studio() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [prompt, setPrompt] = useState("");
  const [generationType, setGenerationType] = useState<GenerationType>("image");
  const [mode, setMode] = useState<GenerationMode>("lightning");
  const [vibeCardIds, setVibeCardIds] = useState<string[]>([]);
  const [temperature, setTemperature] = useState(0.5);
  const [seed, setSeed] = useState("");
  const [loraWeight, setLoraWeight] = useState(0.7);
  const [firstFrame, setFirstFrame] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [musicStyle, setMusicStyle] = useState("ambient");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [assetSheetOpen, setAssetSheetOpen] = useState(false);

  // Progress simulation
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  const assetsQuery = trpc.assets.myAssets.useQuery(undefined, { retry: false });
  const modelsQuery = trpc.models.myModels.useQuery(undefined, { retry: false });

  const generateMutation = trpc.generate.multimodal.useMutation({
    onSuccess: (data) => {
      setResultUrl(data.resultUrl || null);
      setResultData(data.resultData);
      setProgress(100);
      setProgressMessage("生成完成");
      setTimeout(() => setProgress(0), 1500);
      toast.success("生成完成");
    },
    onError: (error) => {
      setProgress(0);
      setProgressMessage("");
      toast.error(error.message);
    },
  });

  // Simulate progress steps
  useEffect(() => {
    if (!generateMutation.isPending) return;
    const messages = PROGRESS_MESSAGES[generationType] || PROGRESS_MESSAGES.image;
    let step = 0;
    const interval = setInterval(() => {
      if (step < messages.length) {
        const pct = Math.min(10 + (step + 1) * (80 / messages.length), 90);
        setProgress(Math.round(pct));
        setProgressMessage(messages[step]);
        step++;
      }
    }, 2000);
    setProgress(5);
    setProgressMessage("初始化...");
    return () => clearInterval(interval);
  }, [generateMutation.isPending, generationType]);

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error("請輸入創作描述");
      return;
    }
    generateMutation.mutate({
      prompt,
      generationType,
      mode,
      vibeCardIds,
      temperature,
      seed: seed ? parseInt(seed) : undefined,
      musicStyle: generationType === "audio" ? musicStyle : undefined,
    });
  };

  const toggleVibe = useCallback((id: string) => {
    setVibeCardIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }, []);

  // Populate from Director AI (via sessionStorage)
  useEffect(() => {
    const studioData = sessionStorage.getItem("sendToStudio");
    if (studioData) {
      try {
        const data = JSON.parse(studioData);
        if (data.prompt) setPrompt(data.prompt);
        if (data.generationType) setGenerationType(data.generationType);
        if (data.musicStyle) setMusicStyle(data.musicStyle);
        sessionStorage.removeItem("sendToStudio");
        toast.success("已從導演 AI 載入腳本");
      } catch { /* ignore */ }
    }
  }, []);

  const handleDragAsset = (url: string) => {
    if (!firstFrame) {
      setFirstFrame(url);
      toast.success("已設為首幀參考圖");
    } else {
      toast.info("首幀已有圖片，請先清除");
    }
  };

  return (
    <div className="space-y-6">
      <ZenProgressOverlay
        visible={generateMutation.isPending}
        progress={progress}
        message={progressMessage}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">創作工作室</h1>
          <p className="text-xs text-muted-foreground mt-1">
            剩餘配額：<span className="tabular-nums font-medium">{user?.remainingGenerations ?? 0}</span> 次
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-1.5 text-xs"
          onClick={() => isMobile ? setAssetSheetOpen(true) : setDrawerOpen(!drawerOpen)}
        >
          {drawerOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
          素材抽屜
        </Button>
      </div>

      <div className="flex gap-6">
        {/* Main Canvas */}
        <div className={`flex-1 space-y-5 transition-all ${drawerOpen && !isMobile ? "max-w-[calc(100%-280px)]" : ""}`}>
          {/* Generation Type Tabs */}
          <Tabs
            value={generationType}
            onValueChange={(v) => setGenerationType(v as GenerationType)}
          >
            <TabsList className="w-full grid grid-cols-5 h-auto rounded-xl bg-muted/40 p-1">
              {GEN_TYPES.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm flex items-center gap-1.5 text-xs py-2"
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Prompt Box */}
            <div className="mt-4">
              <GlassCard hover={false} className="space-y-3">
                <Textarea
                  placeholder="描述你想要創作的內容..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="rounded-xl bg-transparent border-0 resize-none text-sm placeholder:text-muted-foreground/50 focus-visible:ring-0"
                />

                {/* Type-specific controls */}
                <TabsContent value="video" className="mt-3 space-y-3">
                  <FrameTimeline
                    firstFrame={firstFrame}
                    lastFrame={lastFrame}
                    onFirstFrameChange={setFirstFrame}
                    onLastFrameChange={setLastFrame}
                  />
                  <Select defaultValue="8">
                    <SelectTrigger className="rounded-xl w-40 text-sm">
                      <SelectValue placeholder="影片長度" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4">4 秒</SelectItem>
                      <SelectItem value="8">8 秒</SelectItem>
                      <SelectItem value="16">16 秒（遞迴）</SelectItem>
                      <SelectItem value="30">30 秒（遞迴）</SelectItem>
                    </SelectContent>
                  </Select>
                </TabsContent>

                <TabsContent value="audio" className="mt-3">
                  <Select value={musicStyle} onValueChange={setMusicStyle}>
                    <SelectTrigger className="rounded-xl w-48 text-sm">
                      <SelectValue placeholder="音樂風格" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ambient">環境音樂</SelectItem>
                      <SelectItem value="lofi">Lo-Fi</SelectItem>
                      <SelectItem value="classical">古典</SelectItem>
                      <SelectItem value="electronic">電子</SelectItem>
                      <SelectItem value="jazz">爵士</SelectItem>
                      <SelectItem value="cinematic">電影配樂</SelectItem>
                    </SelectContent>
                  </Select>
                </TabsContent>

                <TabsContent value="voice" className="mt-3">
                  <p className="text-xs text-muted-foreground">
                    選擇已訓練的語音模型，或使用預設語音
                  </p>
                </TabsContent>
              </GlassCard>
            </div>
          </Tabs>

          {/* Vibe Cards */}
          <GlassCard hover={false}>
            <VibeCardWizard selectedIds={vibeCardIds} onToggle={toggleVibe} />
          </GlassCard>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || !prompt.trim()}
            className="w-full h-12 rounded-xl text-sm font-medium gap-2"
          >
            <Wand2 className="w-4 h-4" />
            {generateMutation.isPending ? "生成中..." : "開始創作"}
          </Button>

          {/* Result Preview */}
          <AnimatePresence>
            {(resultUrl || resultData) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GlassCard className="space-y-3">
                  <h3 className="text-sm font-medium">生成結果</h3>
                  {resultUrl && (
                    <div className="rounded-xl overflow-hidden">
                      <img src={resultUrl} alt="Generated" className="w-full object-cover" />
                    </div>
                  )}
                  {resultData && (
                    <div className="text-xs text-muted-foreground space-y-1">
                      {resultData.videoStatus != null && <p>影片：{String(resultData.videoStatus)}</p>}
                      {resultData.audioStatus != null && <p>音樂：{String(resultData.audioStatus)}</p>}
                      {resultData.voiceStatus != null && <p>語音：{String(resultData.voiceStatus)}</p>}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="w-full rounded-xl gap-2 text-sm"
                    onClick={() => toast.info("ZIP 匯出功能即將推出")}
                  >
                    <Download className="w-4 h-4" />
                    匯出 ZIP 包
                  </Button>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Panel: Controls (desktop) */}
        <div className="hidden lg:block w-72 shrink-0 space-y-5">
          <GlassCard hover={false}>
            <GenerationControls
              temperature={temperature}
              onTemperatureChange={setTemperature}
              seed={seed}
              onSeedChange={setSeed}
              mode={mode}
              onModeChange={setMode}
              loraWeight={loraWeight}
              onLoraWeightChange={setLoraWeight}
              showLoraWeight={firstFrame !== null}
            />
          </GlassCard>
        </div>

        {/* Asset Drawer (desktop) */}
        <AnimatePresence>
          {drawerOpen && !isMobile && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="shrink-0 overflow-hidden"
            >
              <GlassCard hover={false} className="h-full">
                <h3 className="text-sm font-semibold mb-3">素材抽屜</h3>
                <p className="text-[11px] text-muted-foreground mb-3">
                  拖放角色或素材到首幀/參考圖區域
                </p>

                {/* Character Profiles */}
                <div className="space-y-2 mb-4">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">角色模型</h4>
                  {modelsQuery.isLoading ? (
                    <ZenSkeleton lines={2} />
                  ) : modelsQuery.data && modelsQuery.data.length > 0 ? (
                    modelsQuery.data.filter(m => m.status === "ready").map((model) => (
                      <div
                        key={model.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", model.fileUrl || "");
                        }}
                        className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 cursor-grab hover:bg-muted/50 transition-colors"
                      >
                        <GripVertical className="w-3 h-3 text-muted-foreground/50" />
                        <div className="w-8 h-8 rounded-lg bg-zen-lavender/20 flex items-center justify-center text-xs font-medium">
                          {model.name.charAt(0)}
                        </div>
                        <span className="text-xs truncate">{model.name}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-muted-foreground">尚無就緒的角色模型</p>
                  )}
                </div>

                {/* Recent Assets */}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">最近素材</h4>
                  {assetsQuery.isLoading ? (
                    <ZenSkeleton lines={3} />
                  ) : assetsQuery.data && assetsQuery.data.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {assetsQuery.data.slice(0, 6).map((asset) => (
                        <div
                          key={asset.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", asset.fileUrl || "");
                          }}
                          onClick={() => handleDragAsset(asset.fileUrl || "")}
                          className="aspect-square rounded-lg overflow-hidden cursor-grab hover:ring-2 hover:ring-primary/30 transition-all bg-muted/30"
                        >
                          {asset.fileUrl ? (
                            <img src={asset.fileUrl} alt={asset.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                              {asset.assetType}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">尚無素材</p>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Controls Bottom Sheet */}
      {isMobile && (
        <>
          <GlassCard hover={false}>
            <GenerationControls
              temperature={temperature}
              onTemperatureChange={setTemperature}
              seed={seed}
              onSeedChange={setSeed}
              mode={mode}
              onModeChange={setMode}
              loraWeight={loraWeight}
              onLoraWeightChange={setLoraWeight}
              showLoraWeight={firstFrame !== null}
            />
          </GlassCard>

          <BottomSheet
            open={assetSheetOpen}
            onClose={() => setAssetSheetOpen(false)}
            title="素材抽屜"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground">角色模型</h4>
                {modelsQuery.data && modelsQuery.data.filter(m => m.status === "ready").length > 0 ? (
                  modelsQuery.data.filter(m => m.status === "ready").map((model) => (
                    <button
                      key={model.id}
                      onClick={() => {
                        handleDragAsset(model.fileUrl || "");
                        setAssetSheetOpen(false);
                      }}
                      className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 w-full text-left"
                    >
                      <div className="w-10 h-10 rounded-lg bg-zen-lavender/20 flex items-center justify-center font-medium">
                        {model.name.charAt(0)}
                      </div>
                      <span className="text-sm">{model.name}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">尚無就緒的角色模型</p>
                )}
              </div>
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground">最近素材</h4>
                {assetsQuery.data && assetsQuery.data.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {assetsQuery.data.slice(0, 9).map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => {
                          handleDragAsset(asset.fileUrl || "");
                          setAssetSheetOpen(false);
                        }}
                        className="aspect-square rounded-lg overflow-hidden bg-muted/30"
                      >
                        {asset.fileUrl ? (
                          <img src={asset.fileUrl} alt={asset.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                            {asset.assetType}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">尚無素材</p>
                )}
              </div>
            </div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
