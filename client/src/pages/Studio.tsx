import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProgressivePromptBuilder, createEmptyPromptOutput, type PromptBuilderOutput } from "@/components/ProgressivePromptBuilder";
import { ImageWorkspace, createDefaultImageState, type ImageWorkspaceState } from "@/components/workspaces/ImageWorkspace";
import { VideoWorkspace, createDefaultVideoState, type VideoWorkspaceState } from "@/components/workspaces/VideoWorkspace";
import { AudioWorkspace, createDefaultAudioState, type AudioWorkspaceState } from "@/components/workspaces/AudioWorkspace";
import { VoiceWorkspace, createDefaultVoiceState, type VoiceWorkspaceState } from "@/components/workspaces/VoiceWorkspace";
import { ConsistencyVault, type VaultItem } from "@/components/ConsistencyVault";
import { GenerationControls } from "@/components/GenerationControls";
import { ZenProgressOverlay, GlassCard, ZenSkeleton, BottomSheet } from "@/components/ZenCoPilot";
import { toast } from "sonner";
import {
  Image, Video, Music, Mic, Wand2, Download,
  PanelRightOpen, PanelRightClose, Layers, Settings2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/useMobile";
import { PROGRESS_MESSAGES } from "@shared/types";
import { PromptStrengthBar } from "@/components/PromptStrengthBar";
import type { GenerationMode, GenerationType } from "@shared/types";

// ─── Tab Config ─────────────────────────────────────────────────────────────

const MODALITY_TABS: { value: GenerationType; label: string; icon: React.ReactNode }[] = [
  { value: "image", label: "圖片", icon: <Image className="w-4 h-4" /> },
  { value: "video", label: "影片", icon: <Video className="w-4 h-4" /> },
  { value: "audio", label: "音樂", icon: <Music className="w-4 h-4" /> },
  { value: "voice", label: "語音", icon: <Mic className="w-4 h-4" /> },
];

// ─── Studio Page ────────────────────────────────────────────────────────────

export default function Studio() {
  const { user } = useAuth();
  const isMobile = useIsMobile();

  // ── Shared state ──
  const [activeModality, setActiveModality] = useState<GenerationType>("image");
  const [mode, setMode] = useState<GenerationMode>("lightning");
  const [promptBuilder, setPromptBuilder] = useState<PromptBuilderOutput>(createEmptyPromptOutput);
  const [temperature, setTemperature] = useState(0.5);
  const [seed, setSeed] = useState("");
  const [loraWeight, setLoraWeight] = useState(0.7);

  // ── Modality-specific state ──
  const [imageState, setImageState] = useState<ImageWorkspaceState>(createDefaultImageState);
  const [videoState, setVideoState] = useState<VideoWorkspaceState>(createDefaultVideoState);
  const [audioState, setAudioState] = useState(createDefaultAudioState);
  const [voiceState, setVoiceState] = useState(createDefaultVoiceState);

  // ── UI state ──
  const [vaultOpen, setVaultOpen] = useState(false);
  const [controlsSheetOpen, setControlsSheetOpen] = useState(false);
  const [vaultSheetOpen, setVaultSheetOpen] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(null);

  // ── Progress ──
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  // ── Mutation ──
  const utils = trpc.useUtils();
  const generateMutation = trpc.generate.multimodal.useMutation({
    onSuccess: (data) => {
      setResultUrl(data.resultUrl || null);
      setResultData(data.resultData);
      setProgress(100);
      setProgressMessage("生成完成");
      setTimeout(() => setProgress(0), 1500);
      toast.success("生成完成");
      // Invalidate auth.me to refresh remainingGenerations across the entire UI
      utils.auth.me.invalidate();
    },
    onError: (error) => {
      setProgress(0);
      setProgressMessage("");
      toast.error(error.message);
    },
  });

  // ── Progress simulation ──
  useEffect(() => {
    if (!generateMutation.isPending) return;
    const messages = PROGRESS_MESSAGES[activeModality] || PROGRESS_MESSAGES.image;
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
  }, [generateMutation.isPending, activeModality]);

  // ── Populate from Director AI ──
  useEffect(() => {
    const studioData = sessionStorage.getItem("sendToStudio");
    if (studioData) {
      try {
        const data = JSON.parse(studioData);
        if (data.prompt) {
          setPromptBuilder(prev => ({
            ...prev,
            rawPrompt: data.prompt,
            compiledPrompt: data.prompt,
          }));
        }
        if (data.generationType) setActiveModality(data.generationType);
        if (data.musicStyle) setAudioState(prev => ({ ...prev, musicStyle: data.musicStyle }));
        if (data.voiceText) setVoiceState(prev => ({ ...prev, text: data.voiceText }));
        // Also populate audioScript into voice workspace
        if (data.audioScript) setVoiceState(prev => ({ ...prev, text: data.audioScript }));
        sessionStorage.removeItem("sendToStudio");
        toast.success("已從導演 AI 載入腳本");
      } catch { /* ignore */ }
    }
  }, []);

  // ── Handle Generate ──
  const handleGenerate = useCallback(() => {
    const prompt = promptBuilder.compiledPrompt || promptBuilder.rawPrompt;
    if (!prompt.trim() && activeModality !== "voice") {
      toast.error("請輸入創作描述");
      return;
    }
    if (activeModality === "voice" && !voiceState.text.trim()) {
      toast.error("請輸入要轉換為語音的文字");
      return;
    }

    generateMutation.mutate({
      prompt: activeModality === "voice" ? voiceState.text : prompt,
      generationType: activeModality,
      mode,
      vibeCardIds: promptBuilder.vibeCardIds,
      temperature,
      seed: seed ? parseInt(seed) : undefined,
      // Image workspace params
      ...(activeModality === "image" && {
        aspectRatio: imageState.aspectRatio,
        negativePrompt: imageState.negativePrompt || undefined,
        styleReferenceUrl: imageState.styleReferenceUrl,
        vibeReferenceUrl: imageState.vibeReferenceUrl,
      }),
      // Video workspace params
      ...(activeModality === "video" && {
        videoDurationSeconds: parseInt(videoState.duration),
        firstFrameUrl: videoState.firstFrameUrl,
        lastFrameUrl: videoState.lastFrameUrl,
        characterRefUrl: videoState.characterRefUrl,
        cameraMotion: videoState.cameraMotion,
      }),
      // Audio workspace params
      ...(activeModality === "audio" && {
        musicStyle: audioState.musicStyle,
        isInstrumental: audioState.isInstrumental,
        lyrics: audioState.lyrics || undefined,
        audioDuration: audioState.duration,
        audioEnergy: audioState.energy,
      }),
      // Voice workspace params
      ...(activeModality === "voice" && {
        voiceModelId: voiceState.voiceActorId,
        voiceText: voiceState.text,
        voiceSpeed: voiceState.speed,
        voiceStability: voiceState.stability,
        voiceEmotionType: voiceState.emotionType,
        voiceEmotionIntensity: voiceState.emotionIntensity,
      }),
    });
  }, [promptBuilder, activeModality, mode, temperature, seed, imageState, videoState, audioState, voiceState, generateMutation]);

  // ── Vault drag handler ──
  const handleVaultSelect = useCallback((item: VaultItem) => {
    if (activeModality === "video") {
      if (!videoState.firstFrameUrl) {
        setVideoState(prev => ({ ...prev, firstFrameUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為首幀`);
      } else if (!videoState.characterRefUrl) {
        setVideoState(prev => ({ ...prev, characterRefUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為角色參考`);
      } else {
        toast.info("首幀和角色參考已設定，請先清除再載入");
      }
    } else if (activeModality === "image") {
      if (!imageState.styleReferenceUrl) {
        setImageState(prev => ({ ...prev, styleReferenceUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為風格參考`);
      } else {
        toast.info("風格參考已設定，請先清除再載入");
      }
    }
    if (isMobile) setVaultSheetOpen(false);
  }, [activeModality, videoState, imageState, isMobile]);

  const showLoraWeight = activeModality === "video"
    ? !!(videoState.firstFrameUrl || videoState.characterRefUrl)
    : activeModality === "image"
    ? !!(imageState.styleReferenceUrl)
    : false;

  return (
    <div className="space-y-5">
      <ZenProgressOverlay
        visible={generateMutation.isPending}
        progress={progress}
        message={progressMessage}
      />

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">創作工作室</h1>
          <p className="text-xs text-muted-foreground mt-1">
            剩餘配額：<span className="tabular-nums font-medium">{user?.remainingGenerations ?? 0}</span> 次
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isMobile && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1.5 text-xs"
              onClick={() => setControlsSheetOpen(true)}
            >
              <Settings2 className="w-3.5 h-3.5" />
              參數
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl gap-1.5 text-xs"
            onClick={() => isMobile ? setVaultSheetOpen(true) : setVaultOpen(!vaultOpen)}
          >
            {vaultOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            一致性保險庫
          </Button>
        </div>
      </div>

      {/* ── Main Layout ── */}
      <div className="flex gap-5">
        {/* ── Left: Main Canvas ── */}
        <div className={`flex-1 space-y-5 transition-all ${vaultOpen && !isMobile ? "max-w-[calc(100%-300px)]" : ""}`}>

          {/* Modality Tabs */}
          <Tabs
            value={activeModality}
            onValueChange={(v) => setActiveModality(v as GenerationType)}
          >
            <TabsList className="w-full grid grid-cols-4 h-auto rounded-xl p-1" style={{
              background: "rgba(255,255,255,0.4)",
              border: "1px solid rgba(255,255,255,0.5)",
            }}>
              {MODALITY_TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm flex items-center gap-1.5 text-xs py-2.5 transition-all"
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Progressive Prompt Builder (shared across all modalities except voice) */}
          {activeModality !== "voice" && (
            <GlassCard hover={false}>
              <ProgressivePromptBuilder
                value={promptBuilder}
                onChange={setPromptBuilder}
                modality={activeModality}
              />
              {/* Prompt Strength Evaluator (LLM-as-a-Judge) */}
              <div className="mt-3 pt-3 border-t border-border/20">
                <PromptStrengthBar
                  prompt={promptBuilder.compiledPrompt || promptBuilder.rawPrompt}
                  modality={activeModality as "image" | "video" | "audio" | "voice"}
                  onApplyOptimized={(optimized) => {
                    setPromptBuilder(prev => ({
                      ...prev,
                      rawPrompt: optimized,
                      compiledPrompt: optimized,
                    }));
                    toast.success("已套用 AI 優化提示詞");
                  }}
                />
              </div>
            </GlassCard>
          )}

          {/* Modality-Specific Workspace */}
          <GlassCard hover={false}>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                {activeModality === "image" && <><Image className="w-4 h-4 text-primary" /> 圖片工作區</>}
                {activeModality === "video" && <><Video className="w-4 h-4 text-primary" /> 影片工作區 (Veo 3.1)</>}
                {activeModality === "audio" && <><Music className="w-4 h-4 text-primary" /> 音樂工作區 (Suno)</>}
                {activeModality === "voice" && <><Mic className="w-4 h-4 text-primary" /> 語音工作區 (ElevenLabs)</>}
              </h3>
              <div className="h-px bg-border/30 my-3" />

              {activeModality === "image" && (
                <ImageWorkspace value={imageState} onChange={setImageState} />
              )}
              {activeModality === "video" && (
                <VideoWorkspace value={videoState} onChange={setVideoState} />
              )}
              {activeModality === "audio" && (
                <AudioWorkspace value={audioState} onChange={setAudioState} />
              )}
              {activeModality === "voice" && (
                <VoiceWorkspace value={voiceState} onChange={setVoiceState} />
              )}
            </div>
          </GlassCard>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="w-full h-12 rounded-xl text-sm font-medium gap-2 shadow-md hover:shadow-lg transition-all"
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
                <GlassCard className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">生成結果</h3>
                  {resultUrl && (
                    <div className="rounded-xl overflow-hidden shadow-sm">
                      <img src={resultUrl} alt="Generated" className="w-full object-cover" />
                    </div>
                  )}
                  {resultData && (
                    <div className="text-xs text-muted-foreground space-y-1.5 p-3 rounded-lg bg-muted/20">
                      {resultData.videoStatus != null && (
                        <p className="flex items-center gap-2">
                          <Video className="w-3 h-3" />
                          影片：{String(resultData.videoStatus)}
                        </p>
                      )}
                      {resultData.audioStatus != null && (
                        <p className="flex items-center gap-2">
                          <Music className="w-3 h-3" />
                          音樂：{String(resultData.audioStatus)}
                        </p>
                      )}
                      {resultData.voiceStatus != null && (
                        <p className="flex items-center gap-2">
                          <Mic className="w-3 h-3" />
                          語音：{String(resultData.voiceStatus)}
                        </p>
                      )}
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

        {/* ── Right Panel: Controls (desktop) ── */}
        {!isMobile && (
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
                showLoraWeight={showLoraWeight}
              />
            </GlassCard>
          </div>
        )}

        {/* ── Right Panel: Consistency Vault (desktop) ── */}
        <AnimatePresence>
          {vaultOpen && !isMobile && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="shrink-0 overflow-hidden"
            >
              <GlassCard hover={false} className="h-full">
                <ConsistencyVault
                  onSelect={handleVaultSelect}
                  compact
                />
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Mobile Bottom Sheets ── */}
      {isMobile && (
        <>
          <BottomSheet
            open={controlsSheetOpen}
            onClose={() => setControlsSheetOpen(false)}
            title="生成參數"
          >
            <GenerationControls
              temperature={temperature}
              onTemperatureChange={setTemperature}
              seed={seed}
              onSeedChange={setSeed}
              mode={mode}
              onModeChange={setMode}
              loraWeight={loraWeight}
              onLoraWeightChange={setLoraWeight}
              showLoraWeight={showLoraWeight}
            />
          </BottomSheet>

          <BottomSheet
            open={vaultSheetOpen}
            onClose={() => setVaultSheetOpen(false)}
            title="一致性保險庫"
          >
            <ConsistencyVault
              onSelect={handleVaultSelect}
            />
          </BottomSheet>
        </>
      )}
    </div>
  );
}
