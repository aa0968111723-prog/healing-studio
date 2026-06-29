/**
 * VideoProjectCreateDialog — 新建影片專案格式選擇（AIDV-252 / AIDV-255）
 *
 * 建立時讓使用者選擇畫面比例（16:9 / 9:16 / 1:1）＋輸出解析度（720p / 1080p；
 * 4K 需升級方案）＋幀率（24 / 30 / 60 fps）。
 * backend outputSpec（AIDV-260）已支援全欄位；此 UI 補上前端選擇路徑。
 */

import { useState } from "react";
import { Monitor, Smartphone, Square, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toastError } from "@/lib/toastError";
import {
  OutputSpecSelector,
  OUTPUT_SPEC_DEFAULT,
  type OutputSpecValue,
} from "@/components/OutputSpecSelector";

type AspectRatio = "16:9" | "9:16" | "1:1";

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

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (videoProjectId: number, aspectRatio: AspectRatio) => void;
}

export function VideoProjectCreateDialog({ open, onClose, onCreated }: Props) {
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [outputSpec, setOutputSpec] = useState<OutputSpecValue>(OUTPUT_SPEC_DEFAULT);

  const entitlement = trpc.videoProject.outputSpecEntitlement.useQuery(undefined, {
    enabled: open,
  });
  const isPaid = entitlement.data?.isPaid ?? false;

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
    // 防呆：非付費方案若殘留 4K（理論上 selector 已停用），降回 1080p。
    const safeSpec: OutputSpecValue =
      !isPaid && outputSpec.resolution === "4K"
        ? { ...outputSpec, resolution: "1080p" }
        : outputSpec;
    createMut.mutate({ aspectRatio, outputSpec: safeSpec });
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

        <div className="mt-4 border-t border-border pt-4">
          <div className="text-sm font-medium mb-2">輸出規格</div>
          <OutputSpecSelector
            value={outputSpec}
            onChange={setOutputSpec}
            isPaid={isPaid}
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose} disabled={createMut.isPending}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={createMut.isPending}>
            {createMut.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
            開始創作
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
