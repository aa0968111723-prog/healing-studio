/**
 * QuickGenerateButtons —— 直接從世界觀 UI 一鍵呼叫全站共用的站內生成服務（不直連外部功能）
 *
 * 4 個按鈕：
 *   - 🎨 生成圖像（Fal.ai：imageStudio.nanoBanana2 / nanoBananaPro）
 *   - 🎬 生成影片（videoStudio.klingImageToVideo）
 *   - 🎵 生成音樂（proStudio.textToMusic）
 *   - 🎙️ 生成語音（proStudio.elevenLabsTTS）
 *
 * 全部都是 useMutation 包裝，成功後回呼產出 URL（asyncPolling 的會回呼 request_id）。
 */

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";

// ─── 圖像生成（同步回 URL） ────────────────────────────────────────────────

type ImageAspectRatio =
  | "auto"
  | "16:9"
  | "1:1"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "4:1"
  | "1:4"
  | "21:9";

const VALID_IMAGE_ASPECT_RATIOS: ImageAspectRatio[] = [
  "auto",
  "16:9",
  "1:1",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "4:1",
  "1:4",
  "21:9",
];

function coerceAspectRatio(ar?: string): ImageAspectRatio | undefined {
  if (!ar) return undefined;
  return (VALID_IMAGE_ASPECT_RATIOS as string[]).includes(ar)
    ? (ar as ImageAspectRatio)
    : undefined;
}

export function GenerateImageButton({
  prompt,
  refImageUrl,
  aspectRatio,
  label = "生成圖像",
  onSuccess,
  disabled,
  initialModel = "nanoBanana2",
  showModelPicker = true,
}: {
  prompt: string;
  refImageUrl?: string;
  aspectRatio?: string;
  label?: string;
  onSuccess: (url: string) => void;
  disabled?: boolean;
  initialModel?: "nanoBanana2" | "nanoBananaPro" | "seedreamV4" | "imagen4";
  showModelPicker?: boolean;
}) {
  const [model, setModel] = useState<"nanoBanana2" | "nanoBananaPro" | "seedreamV4" | "imagen4">(initialModel);
  const nanoBanana2Mut = trpc.imageStudio.nanoBanana2.useMutation();
  const nanoBananaProMut = trpc.imageStudio.nanoBananaPro.useMutation();
  const seedreamV4Mut = trpc.imageStudio.seedreamV4.useMutation();
  const imagen4Mut = trpc.imageStudio.imagen4.useMutation();

  const mut = useMemo(() => {
    if (model === "nanoBananaPro") return nanoBananaProMut;
    if (model === "seedreamV4") return seedreamV4Mut;
    if (model === "imagen4") return imagen4Mut;
    return nanoBanana2Mut;
  }, [model, nanoBanana2Mut, nanoBananaProMut, seedreamV4Mut, imagen4Mut]);

  const modelLabel =
    model === "nanoBananaPro"
      ? "nano-banana-pro"
      : model === "seedreamV4"
        ? "seedream-v4"
        : model === "imagen4"
          ? "imagen4"
          : "nano-banana-2";

  const onMutSuccess = (data: { image_url?: string | null; images?: string[] | null }) => {
    const url = data.image_url ?? data.images?.[0];
    if (url) {
      toast.success(`Fal.ai 圖像已生成（${modelLabel}）`);
      onSuccess(url);
    } else {
      toast.error("回應缺少圖像 URL");
    }
  };

  return (
    <div className="flex items-center gap-1">
      {showModelPicker && (
        <Select value={model} onValueChange={v => setModel(v as typeof model)}>
          <SelectTrigger className="h-7 w-[132px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nanoBanana2" className="text-xs">Fal · Nano Banana 2</SelectItem>
            <SelectItem value="nanoBananaPro" className="text-xs">Fal · Nano Banana Pro</SelectItem>
            <SelectItem value="seedreamV4" className="text-xs">Fal · SeeDream V4</SelectItem>
            <SelectItem value="imagen4" className="text-xs">Fal · Imagen 4</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          mut.mutate(
            {
              prompt,
              aspect_ratio: coerceAspectRatio(aspectRatio),
              image_urls: refImageUrl ? [refImageUrl] : undefined,
              num_images: 1,
            },
            {
              onSuccess: onMutSuccess,
              onError: e => toast.error(`生成失敗：${e.message}`),
            }
          )
        }
        disabled={disabled || mut.isPending || !prompt.trim()}
        className="h-7 text-xs"
        title={prompt ? `Prompt: ${prompt.slice(0, 80)}…` : "需要 prompt"}
      >
        {mut.isPending ? (
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
        ) : (
          <Sparkles className="w-3 h-3 mr-1" />
        )}
        {label}
      </Button>
    </div>
  );
}

// ─── i2v（async polling，回 request_id） ──────────────────────────────────

export function GenerateVideoButton({
  imageUrl,
  prompt,
  durationSec = 5,
  label = "圖轉影",
  onJobStarted,
  disabled,
}: {
  imageUrl: string;
  prompt: string;
  durationSec?: number;
  label?: string;
  onJobStarted: (requestId: string) => void;
  disabled?: boolean;
}) {
  const mut = trpc.videoStudio.klingImageToVideo.useMutation({
    onSuccess: data => {
      toast.success("已送出 i2v 任務，等待背景處理");
      onJobStarted(data.request_id);
    },
    onError: e => toast.error(`送出失敗：${e.message}`),
  });
  // 該模型僅接受 "5" 或 "10"
  const kdur: "5" | "10" = durationSec > 7 ? "10" : "5";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() =>
        mut.mutate({
          imageUrl,
          prompt,
          duration: kdur,
        })
      }
      disabled={disabled || mut.isPending || !imageUrl}
      className="h-7 text-xs"
    >
      {mut.isPending ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : (
        <Sparkles className="w-3 h-3 mr-1" />
      )}
      {label}
    </Button>
  );
}

// ─── 音樂生成（async polling） ───────────────────────────────────────────

export function GenerateMusicButton({
  prompt,
  durationSec = 30,
  label = "生成音樂",
  onJobStarted,
  disabled,
}: {
  prompt: string;
  durationSec?: number;
  label?: string;
  onJobStarted: (requestId: string) => void;
  disabled?: boolean;
}) {
  const mut = trpc.proStudio.textToMusic.useMutation({
    onSuccess: data => {
      toast.success(`已送出音樂生成任務（${data.model}），預估 ${data.estimated_credits} 點`);
      onJobStarted(data.request_id);
    },
    onError: e => toast.error(`送出失敗：${e.message}`),
  });
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() =>
        mut.mutate({
          prompt,
          duration: durationSec,
        })
      }
      disabled={disabled || mut.isPending || !prompt.trim()}
      className="h-7 text-xs"
    >
      {mut.isPending ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : (
        <Sparkles className="w-3 h-3 mr-1" />
      )}
      {label}
    </Button>
  );
}

// ─── 語音 TTS 試聽（async polling） ──────────────────────────────────────

export function GenerateVoiceButton({
  text,
  voiceId,
  engine,
  label = "試聽配音",
  onJobStarted,
  disabled,
}: {
  text: string;
  voiceId?: string;
  engine?: "turbo-v2.5" | "flash-v2.5" | "multilingual-v2" | "eleven-v3";
  label?: string;
  onJobStarted: (requestId: string) => void;
  disabled?: boolean;
}) {
  const mut = trpc.proStudio.elevenLabsTTS.useMutation({
    onSuccess: data => {
      toast.success(`已送出 TTS 任務，預估 ${data.estimated_credits} 點`);
      onJobStarted(data.request_id);
    },
    onError: e => toast.error(`送出失敗：${e.message}`),
  });
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() =>
        mut.mutate({
          text,
          voice_id: voiceId,
          engine: engine ?? "multilingual-v2",
        })
      }
      disabled={disabled || mut.isPending || !text.trim()}
      className="h-7 text-xs"
    >
      {mut.isPending ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : (
        <Sparkles className="w-3 h-3 mr-1" />
      )}
      {label}
    </Button>
  );
}
