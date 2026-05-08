import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  Upload,
  Palette as PaletteIcon,
  Trash2,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// 8 preset avatars rendered as soft-gradient circles with an emoji glyph.
// Persisted as `preset:<id>` so the renderer can recreate them deterministically.
export const AVATAR_PRESETS: {
  id: string;
  label: string;
  emoji: string;
  background: string;
}[] = [
  { id: "cosmic-fox", label: "宇宙狐", emoji: "🦊", background: "linear-gradient(135deg,#a78bfa,#f0abfc)" },
  { id: "ocean-whale", label: "深海鯨", emoji: "🐳", background: "linear-gradient(135deg,#60a5fa,#22d3ee)" },
  { id: "forest-deer", label: "森林鹿", emoji: "🦌", background: "linear-gradient(135deg,#34d399,#bef264)" },
  { id: "sunset-cat", label: "夕陽貓", emoji: "🐱", background: "linear-gradient(135deg,#fb923c,#f472b6)" },
  { id: "moon-rabbit", label: "月光兔", emoji: "🐰", background: "linear-gradient(135deg,#cbd5e1,#a5b4fc)" },
  { id: "spark-orb", label: "光球", emoji: "✨", background: "linear-gradient(135deg,#facc15,#fde68a)" },
  { id: "lotus-zen", label: "蓮花", emoji: "🪷", background: "linear-gradient(135deg,#f472b6,#fda4af)" },
  { id: "galaxy", label: "星河", emoji: "🌌", background: "linear-gradient(135deg,#1e1b4b,#7c3aed)" },
];

export function getPresetById(id: string) {
  return AVATAR_PRESETS.find(p => p.id === id) ?? null;
}

/** Render avatar from any avatarUrl: preset id, http(s) URL, data URL, or null. */
export function AvatarRenderer({
  avatarUrl,
  fallback,
  className,
}: {
  avatarUrl: string | null | undefined;
  fallback: string;
  className?: string;
}) {
  if (avatarUrl?.startsWith("preset:")) {
    const preset = getPresetById(avatarUrl.slice("preset:".length));
    if (preset) {
      return (
        <Avatar className={className}>
          <AvatarFallback
            className="text-base"
            style={{ background: preset.background }}
          >
            {preset.emoji}
          </AvatarFallback>
        </Avatar>
      );
    }
  }
  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">
        {fallback}
      </AvatarFallback>
    </Avatar>
  );
}

const MAX_UPLOAD_BYTES = 60 * 1024;
const TARGET_AVATAR_PX = 256;

async function downscaleToDataUrl(file: File): Promise<string> {
  const reader = new FileReader();
  const dataUrl: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("讀取檔案失敗"));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  img.src = dataUrl;
  await new Promise((resolve, reject) => {
    img.onload = () => resolve(null);
    img.onerror = () => reject(new Error("無法載入圖片"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_AVATAR_PX;
  canvas.height = TARGET_AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("瀏覽器不支援 canvas");
  // Cover-crop to a square.
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_AVATAR_PX, TARGET_AVATAR_PX);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function AvatarStudio({
  currentAvatarUrl,
  fallbackInitial,
  onSaved,
}: {
  currentAvatarUrl: string | null | undefined;
  fallbackInitial: string;
  onSaved?: (next: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const updateAvatar = trpc.auth.updateAvatar.useMutation({
    onSuccess: data => {
      void utils.auth.me.invalidate();
      onSaved?.(data.avatarUrl);
    },
  });
  const generateImage = trpc.imageStudio.nanoBanana2.useMutation();

  const [tab, setTab] = useState<"preset" | "upload" | "ai">("preset");
  const [prompt, setPrompt] = useState(
    "可愛療癒的圓形虛擬頭像，柔和粉彩色，居中正面構圖，乾淨背景"
  );
  const [aiPreviewUrl, setAiPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePresetSelect = (presetId: string) => {
    updateAvatar.mutate(
      { avatarUrl: `preset:${presetId}` },
      {
        onSuccess: () => toast.success("已套用預設頭像"),
        onError: e => toast.error(e.message || "儲存失敗"),
      }
    );
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("請選擇圖片檔");
      return;
    }
    try {
      const dataUrl = await downscaleToDataUrl(file);
      if (dataUrl.length > MAX_UPLOAD_BYTES) {
        toast.error("壓縮後仍超過 60 KB，請改用更小的圖片");
        return;
      }
      updateAvatar.mutate(
        { avatarUrl: dataUrl },
        {
          onSuccess: () => toast.success("頭像已上傳"),
          onError: e => toast.error(e.message || "儲存失敗"),
        }
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "處理圖片失敗");
    }
  };

  const handleGenerate = async () => {
    setAiPreviewUrl(null);
    try {
      const result = await generateImage.mutateAsync({
        prompt,
        aspect_ratio: "1:1",
        num_images: 1,
      });
      const url = result.image_url;
      if (!url) {
        toast.error("生成失敗：未取得圖片");
        return;
      }
      setAiPreviewUrl(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失敗");
    }
  };

  const handleApplyAi = () => {
    if (!aiPreviewUrl) return;
    updateAvatar.mutate(
      { avatarUrl: aiPreviewUrl },
      {
        onSuccess: () => {
          toast.success("AI 頭像已套用");
          setAiPreviewUrl(null);
        },
        onError: e => toast.error(e.message || "儲存失敗"),
      }
    );
  };

  const handleClear = () => {
    updateAvatar.mutate(
      { avatarUrl: null },
      {
        onSuccess: () => toast.success("已恢復為姓名首字頭像"),
        onError: e => toast.error(e.message || "清除失敗"),
      }
    );
  };

  const isSaving = updateAvatar.isPending;
  const isGenerating = generateImage.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <AvatarRenderer
          avatarUrl={currentAvatarUrl}
          fallback={fallbackInitial}
          className="size-16"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">虛擬頭像</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            從預設挑選、上傳照片，或用 AI 生成獨一無二的頭像
          </p>
        </div>
        {currentAvatarUrl && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-lg gap-1"
            onClick={handleClear}
            disabled={isSaving}
          >
            <Trash2 className="w-3 h-3" /> 清除
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList className="rounded-xl bg-muted/40 p-1 h-auto gap-1">
          <TabsTrigger value="preset" className="rounded-lg gap-1 text-xs">
            <PaletteIcon className="w-3 h-3" /> 預設
          </TabsTrigger>
          <TabsTrigger value="upload" className="rounded-lg gap-1 text-xs">
            <Upload className="w-3 h-3" /> 上傳
          </TabsTrigger>
          <TabsTrigger value="ai" className="rounded-lg gap-1 text-xs">
            <Sparkles className="w-3 h-3" /> AI 生成
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preset" className="mt-3">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {AVATAR_PRESETS.map(p => {
              const isActive = currentAvatarUrl === `preset:${p.id}`;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetSelect(p.id)}
                  disabled={isSaving}
                  title={p.label}
                  className={cn(
                    "relative aspect-square rounded-full flex items-center justify-center text-xl transition-all",
                    "border hover:scale-105 active:scale-100",
                    isActive
                      ? "ring-2 ring-primary/60 border-primary/40"
                      : "border-border/40"
                  )}
                  style={{ background: p.background }}
                >
                  <span aria-hidden>{p.emoji}</span>
                  {isActive && (
                    <span className="absolute -bottom-1 -right-1 size-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="upload" className="mt-3 space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-lg gap-1"
            onClick={() => fileRef.current?.click()}
            disabled={isSaving}
          >
            <Upload className="w-3 h-3" /> 選擇圖片
          </Button>
          <p className="text-[11px] text-muted-foreground">
            自動壓縮為 256×256 JPEG（≤ 60 KB），存入資料庫後跨裝置同步。
          </p>
        </TabsContent>

        <TabsContent value="ai" className="mt-3 space-y-2">
          <Label className="text-xs text-muted-foreground">提示詞</Label>
          <Input
            value={prompt}
            maxLength={400}
            onChange={e => setPrompt(e.target.value)}
            placeholder="描述你想要的頭像風格"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="rounded-lg gap-1"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              {isGenerating ? "生成中" : "生成預覽"}
            </Button>
            {aiPreviewUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg gap-1"
                onClick={handleApplyAi}
                disabled={isSaving}
              >
                <Check className="w-3 h-3" /> 設為頭像
              </Button>
            )}
          </div>
          {aiPreviewUrl && (
            <div className="flex items-center gap-3 pt-1">
              <img
                src={aiPreviewUrl}
                alt="AI 預覽"
                className="size-20 rounded-full object-cover border border-border/40"
              />
              <p className="text-[11px] text-muted-foreground">
                預覽圖儲存自 fal 的暫存連結；按「設為頭像」後即套用至所有裝置。
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
