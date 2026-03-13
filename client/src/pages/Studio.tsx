import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VibeCardWizard } from "@/components/VibeCardWizard";
import { GenerationControls } from "@/components/GenerationControls";
import { FrameTimeline } from "@/components/FrameTimeline";
import { LoadingRabbit } from "@/components/Mascots";
import { toast } from "sonner";
import { Image, Video, Music, Mic, Layers, Wand2, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { GenerationMode, GenerationType } from "@shared/types";

const GEN_TYPES: { value: GenerationType; label: string; icon: React.ReactNode }[] = [
  { value: "image", label: "圖片生成", icon: <Image className="w-4 h-4" /> },
  { value: "video", label: "影片生成", icon: <Video className="w-4 h-4" /> },
  { value: "audio", label: "音樂生成", icon: <Music className="w-4 h-4" /> },
  { value: "voice", label: "語音配音", icon: <Mic className="w-4 h-4" /> },
  { value: "multimodal", label: "多模態", icon: <Layers className="w-4 h-4" /> },
];

export default function Studio() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [generationType, setGenerationType] = useState<GenerationType>("image");
  const [mode, setMode] = useState<GenerationMode>("lightning");
  const [vibeCardIds, setVibeCardIds] = useState<string[]>([]);
  const [temperature, setTemperature] = useState(0.5);
  const [seed, setSeed] = useState("");
  const [firstFrame, setFirstFrame] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [musicStyle, setMusicStyle] = useState("ambient");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(null);

  const stableInput = useMemo(() => ({ limit: 50 }), []);

  const generateMutation = trpc.generate.multimodal.useMutation({
    onSuccess: (data) => {
      setResultUrl(data.resultUrl || null);
      setResultData(data.resultData);
      toast.success("生成完成！");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

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

  const toggleVibe = (id: string) => {
    setVibeCardIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      <LoadingRabbit visible={generateMutation.isPending} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">創作工作室</h1>
          <p className="text-sm text-muted-foreground mt-1">
            剩餘配額：{user?.remainingGenerations ?? 0} 次
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Input Area */}
        <div className="lg:col-span-2 space-y-5">
          {/* Generation Type Tabs */}
          <Tabs
            value={generationType}
            onValueChange={(v) => setGenerationType(v as GenerationType)}
          >
            <TabsList className="w-full grid grid-cols-5 h-auto rounded-[25px] bg-muted/50 p-1">
              {GEN_TYPES.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="rounded-[20px] data-[state=active]:bg-card data-[state=active]:shadow-sm flex items-center gap-1.5 text-xs sm:text-sm py-2"
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Prompt Box */}
            <div className="mt-4">
              <div className="healing-card bg-card p-4 space-y-3">
                <Textarea
                  placeholder="描述你想要創作的內容... 例如：一隻可愛的貓咪在花園裡追蝴蝶，溫暖的午後陽光"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="rounded-[20px] bg-muted/30 border-0 resize-none text-sm placeholder:text-muted-foreground/60"
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
                    <SelectTrigger className="rounded-[25px] w-40">
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
                    <SelectTrigger className="rounded-[25px] w-48">
                      <SelectValue placeholder="音樂風格" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ambient">環境音樂</SelectItem>
                      <SelectItem value="lofi">Lo-Fi</SelectItem>
                      <SelectItem value="classical">古典</SelectItem>
                      <SelectItem value="electronic">電子</SelectItem>
                      <SelectItem value="jazz">爵士</SelectItem>
                      <SelectItem value="healing">療癒</SelectItem>
                    </SelectContent>
                  </Select>
                </TabsContent>

                <TabsContent value="voice" className="mt-3">
                  <p className="text-xs text-muted-foreground">
                    選擇已訓練的語音模型，或使用預設語音
                  </p>
                </TabsContent>
              </div>
            </div>
          </Tabs>

          {/* Vibe Cards */}
          <div className="healing-card bg-card p-4">
            <VibeCardWizard selectedIds={vibeCardIds} onToggle={toggleVibe} />
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || !prompt.trim()}
            className="w-full h-12 rounded-[25px] text-base font-medium gap-2"
          >
            <Wand2 className="w-5 h-5" />
            {generateMutation.isPending ? "生成中..." : "開始創作"}
          </Button>
        </div>

        {/* Right: Controls + Result */}
        <div className="space-y-5">
          <div className="healing-card bg-card p-4">
            <GenerationControls
              temperature={temperature}
              onTemperatureChange={setTemperature}
              seed={seed}
              onSeedChange={setSeed}
              mode={mode}
              onModeChange={setMode}
            />
          </div>

          {/* Result Preview */}
          <AnimatePresence>
            {(resultUrl || resultData) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="healing-card bg-card p-4 space-y-3"
              >
                <h3 className="text-sm font-medium">生成結果</h3>
                {resultUrl && (
                  <div className="rounded-[20px] overflow-hidden">
                    <img
                      src={resultUrl}
                      alt="Generated"
                      className="w-full object-cover"
                    />
                  </div>
                )}
                {resultData && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {resultData.videoStatus != null && (
                      <p>{`影片狀態：${resultData.videoStatus}`}</p>
                    )}
                    {resultData.audioStatus != null && (
                      <p>{`音樂狀態：${resultData.audioStatus}`}</p>
                    )}
                    {resultData.voiceStatus != null && (
                      <p>{`語音狀態：${resultData.voiceStatus}`}</p>
                    )}
                  </div>
                )}
                <Button
                  variant="outline"
                  className="w-full rounded-[25px] gap-2"
                  onClick={() => toast.info("ZIP 匯出功能即將推出")}
                >
                  <Download className="w-4 h-4" />
                  匯出 ZIP 包
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
