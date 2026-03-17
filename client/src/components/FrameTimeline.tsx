import { useState } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useMobile";
import { motion } from "framer-motion";
import { uploadFileToS3 } from "@/lib/upload";
import { toast } from "sonner";

type FrameTimelineProps = {
  firstFrame: string | null;
  lastFrame: string | null;
  onFirstFrameChange: (url: string | null) => void;
  onLastFrameChange: (url: string | null) => void;
};

export function FrameTimeline({
  firstFrame,
  lastFrame,
  onFirstFrameChange,
  onLastFrameChange,
}: FrameTimelineProps) {
  const isMobile = useIsMobile();
  const [activeSlot, setActiveSlot] = useState<"first" | "last" | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  const handleFileUpload = async (slot: "first" | "last", file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(prev => ({ ...prev, [slot]: true }));
    try {
      const { url } = await uploadFileToS3(file);
      if (slot === "first") onFirstFrameChange(url);
      else onLastFrameChange(url);
    } catch (err: any) {
      toast.error(`上傳失敗：${err.message}`);
    } finally {
      setUploading(prev => ({ ...prev, [slot]: false }));
    }
  };

  const handleFileSelect = (slot: "first" | "last") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFileUpload(slot, file);
    };
    input.click();
  };

  const FrameSlot = ({
    label,
    frame,
    slot,
    onClear,
  }: {
    label: string;
    frame: string | null;
    slot: "first" | "last";
    onClear: () => void;
  }) => (
    <motion.div
      whileTap={{ scale: 0.97 }}
      className={`relative flex-1 aspect-video rounded-[25px] border-2 border-dashed transition-all overflow-hidden ${
        activeSlot === slot ? "border-primary bg-primary/5" : "border-border bg-muted/30"
      } ${frame ? "border-solid" : ""}`}
      onClick={() => {
        if (isMobile && !frame) {
          setActiveSlot(slot);
          handleFileSelect(slot);
        }
      }}
      onDragOver={(e) => {
        if (!isMobile) {
          e.preventDefault();
          setActiveSlot(slot);
        }
      }}
      onDragLeave={() => setActiveSlot(null)}
      onDrop={(e) => {
        if (!isMobile) {
          e.preventDefault();
          setActiveSlot(null);
          const file = e.dataTransfer.files[0];
          if (file) handleFileUpload(slot, file);
        }
      }}
    >
      {uploading[slot] ? (
        <div className="flex flex-col items-center justify-center h-full gap-2">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <span className="text-xs text-muted-foreground">上傳中...</span>
        </div>
      ) : frame ? (
        <>
          <img src={frame} alt={label} className="w-full h-full object-cover" />
          <Button
            variant="outline"
            size="icon"
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/80"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <X className="w-3 h-3" />
          </Button>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-1 p-2">
          <ImagePlus className="w-6 h-6 text-muted-foreground" />
          <span className="text-xs text-muted-foreground text-center">{label}</span>
          {!isMobile && (
            <button
              onClick={() => handleFileSelect(slot)}
              className="text-xs text-primary hover:underline mt-1"
            >
              或點擊上傳
            </button>
          )}
        </div>
      )}
    </motion.div>
  );

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">影片時間軸</h3>
      <div className="flex gap-3 items-center">
        <FrameSlot
          label="首幀"
          frame={firstFrame}
          slot="first"
          onClear={() => onFirstFrameChange(null)}
        />
        {/* Timeline connector */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-4 h-0.5 bg-border" />
          <div className="w-2 h-2 rounded-full bg-primary/40" />
          <div className="w-8 h-0.5 bg-border" />
          <div className="w-2 h-2 rounded-full bg-primary/40" />
          <div className="w-4 h-0.5 bg-border" />
        </div>
        <FrameSlot
          label="末幀"
          frame={lastFrame}
          slot="last"
          onClear={() => onLastFrameChange(null)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {isMobile ? "點擊選擇首幀和末幀圖片" : "拖放或點擊上傳首幀和末幀圖片，AI 會在兩者之間生成過渡影片"}
      </p>
    </div>
  );
}
