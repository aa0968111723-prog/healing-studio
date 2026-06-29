/**
 * VideoProjectCreateDialog — 新建影片專案格式選擇（AIDV-252）
 *
 * 在新建影片專案時讓使用者選擇畫面比例（16:9 / 9:16 / 1:1），
 * 解鎖 Reels/TikTok 垂直影片市場。
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

type AspectRatio = "16:9" | "9:16" | "1:1";

interface Option {
  value: AspectRatio;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  preview: string;
}

const OPTIONS: Option[] = [
  {
    value: "16:9",
    label: "橫式 16:9",
    desc: "YouTube / 簡報",
    icon: Monitor,
    preview: "aspect-video",
  },
  {
    value: "9:16",
    label: "直式 9:16",
    desc: "Reels / TikTok",
    icon: Smartphone,
    preview: "aspect-[9/16]",
  },
  {
    value: "1:1",
    label: "方形 1:1",
    desc: "Instagram",
    icon: Square,
    preview: "aspect-square",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (videoProjectId: number, aspectRatio: AspectRatio) => void;
}

export function VideoProjectCreateDialog({ open, onClose, onCreated }: Props) {
  const [selected, setSelected] = useState<AspectRatio>("16:9");

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
    createMut.mutate({ aspectRatio: selected });
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>選擇影片畫面比例</DialogTitle>
          <DialogDescription>
            選擇後即可開始創作——之後也可在設定中修改。
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 mt-2">
          {OPTIONS.map(opt => {
            const Icon = opt.icon;
            const isActive = selected === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setSelected(opt.value)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                )}
              >
                <div
                  className={cn(
                    "bg-muted rounded flex items-center justify-center w-full",
                    opt.preview
                  )}
                  style={{ maxHeight: 80, maxWidth: 80, margin: "0 auto" }}
                >
                  <Icon className="size-5 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
              </button>
            );
          })}
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
