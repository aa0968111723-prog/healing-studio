/**
 * VideoProjectCreateDialog — 新建影片專案格式選擇（AIDV-252 / AIDV-255）
 *
 * 建立時讓使用者選擇畫面比例（16:9 / 9:16 / 1:1）＋輸出解析度（720p / 1080p；
 * 4K 需升級方案）＋幀率（24 / 30 / 60 fps）。
 * backend outputSpec（AIDV-260）已支援全欄位；此 UI 補上前端選擇路徑。
 */

import { useState } from "react";
import { Monitor, Smartphone, Square, Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toastError } from "@/lib/toastError";

type AspectRatio = "16:9" | "9:16" | "1:1";
type Resolution = "720p" | "1080p" | "4K";
type Fps = 24 | 30 | 60;

interface AspectOption {
  value: AspectRatio;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  preview: string;
}

const ASPECT_OPTIONS: AspectOption[] = [
  { value: "16:9", label: "橫式 16:9", desc: "YouTube / 簡報", icon: Monitor, preview: "aspect-video" },
  { value: "9:16", label: "直式 9:16", desc: "Reels / TikTok", icon: Smartphone, preview: "aspect-[9/16]" },
  { value: "1:1", label: "方形 1:1", desc: "Instagram", icon: Square, preview: "aspect-square" },
];

interface ResOption {
  value: Resolution;
  label: string;
  desc: string;
  pro?: boolean;
}

const RESOLUTION_OPTIONS: ResOption[] = [
  { value: "720p", label: "720p HD", desc: "社群 / 快速預覽" },
  { value: "1080p", label: "1080p FHD", desc: "YouTube / 廣告（推薦）" },
  { value: "4K", label: "4K UHD", desc: "數位看板 / 廣播", pro: true },
];

const FPS_OPTIONS: { value: Fps; label: string }[] = [
  { value: 24, label: "24 fps（電影感）" },
  { value: 30, label: "30 fps（標準）" },
  { value: 60, label: "60 fps（流暢動作）" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (videoProjectId: number, aspectRatio: AspectRatio) => void;
}

export function VideoProjectCreateDialog({ open, onClose, onCreated }: Props) {
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [fps, setFps] = useState<Fps>(30);

  const createMut = trpc.videoProject.create.useMutation({
    onSuccess(data) {
      onCreated(data.id, data.aspectRatio as AspectRatio);
      onClose();
    },
    onError(err) {
      toastError(err, "建立影片專案失敗，請稍後再試");
    },
  });

  function handleConfirm() {
    createMut.mutate({
      aspectRatio,
      outputSpec: { resolution, fps, codec: "h264" },
    });
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建影片專案</DialogTitle>
          <DialogDescription>
            選擇畫面比例與輸出規格——之後也可在設定中修改。
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="畫面比例" className="flex gap-3 mt-2">
          {ASPECT_OPTIONS.map(opt => {
            const Icon = opt.icon;
            const isActive = aspectRatio === opt.value;
            return (
              <button
                key={opt.value}
                role="radio"
                aria-checked={isActive}
                onClick={() => setAspectRatio(opt.value)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                )}
              >
                <div
                  className={cn("bg-muted rounded flex items-center justify-center w-full", opt.preview)}
                  style={{ maxHeight: 72, maxWidth: 72, margin: "0 auto" }}
                >
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 輸出解析度 */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">輸出解析度</div>
          <div className="flex gap-2">
            {RESOLUTION_OPTIONS.map(opt => {
              const isActive = resolution === opt.value && !opt.pro;
              return (
                <button
                  key={opt.value}
                  disabled={opt.pro}
                  onClick={() => !opt.pro && setResolution(opt.value)}
                  className={cn(
                    "flex-1 rounded-lg border-2 px-2.5 py-2 text-left text-xs transition-all",
                    opt.pro
                      ? "cursor-not-allowed border-dashed border-border opacity-50"
                      : isActive
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{opt.label}</span>
                    {opt.pro && (
                      <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300">
                        <Lock className="size-2.5" /> Pro
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 幀率 */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">幀率</div>
          <select
            aria-label="幀率選擇"
            value={fps}
            onChange={e => setFps(Number(e.target.value) as Fps)}
            className="w-full rounded-md border bg-background px-3 py-1.5 text-xs"
          >
            {FPS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">
            預設 1080p 30fps H.264 為最高相容性設定，適合大多數平台。
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={createMut.isPending}>取消</Button>
          <Button onClick={handleConfirm} disabled={createMut.isPending}>
            {createMut.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
            開始創作
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
