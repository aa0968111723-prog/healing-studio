// Batch Generation Dialog Component - to be merged into DirectorAI.tsx

import { memo } from "react";
import type { ScriptSegment } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  X,
  Zap,
  Image,
  Film,
  Music,
  Mic,
  Volume2,
  CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const BatchGenerationDialog = memo(function BatchGenerationDialog({
  open,
  onClose,
  segments,
  options,
  onOptionsChange,
  onStartGeneration,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  segments: ScriptSegment[];
  options: {
    modalities: Array<"image" | "video" | "audio" | "voice" | "sfx">;
    imageSettings: { aspectRatio: string; negativePrompt: string };
    videoSettings: { useImageAsFirstFrame: boolean };
    audioSettings: { isInstrumental: boolean };
    voiceSettings: { voiceSpeed: number; voiceStability: number };
    mode: "lightning" | "deep_precision";
  };
  onOptionsChange: (options: any) => void;
  onStartGeneration: () => void;
  isPending: boolean;
}) {
  if (!open) return null;

  const toggleModality = (mod: "image" | "video" | "audio" | "voice" | "sfx") => {
    const newMods = options.modalities.includes(mod)
      ? options.modalities.filter(m => m !== mod)
      : [...options.modalities, mod];
    onOptionsChange({ ...options, modalities: newMods });
  };

  const totalSegments = segments.length;
  const totalTasks = totalSegments * options.modalities.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold">批次生成多模態內容</h2>
                <p className="text-xs text-muted-foreground">
                  從腳本自動分配到 AI 生成模型
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modality Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">選擇生成模態</Label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: "image" as const, label: "圖像", icon: Image, color: "text-blue-600" },
                { value: "video" as const, label: "影片", icon: Film, color: "text-purple-600" },
                { value: "audio" as const, label: "音樂", icon: Music, color: "text-pink-600" },
                { value: "voice" as const, label: "語音", icon: Mic, color: "text-green-600" },
                { value: "sfx" as const, label: "音效", icon: Volume2, color: "text-amber-600" },
              ].map(mod => (
                <button
                  key={mod.value}
                  onClick={() => toggleModality(mod.value)}
                  className={cn(
                    "p-3 rounded-xl border-2 transition-all flex items-center gap-2",
                    options.modalities.includes(mod.value)
                      ? "border-purple-400 bg-purple-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  )}
                >
                  <mod.icon className={cn("w-5 h-5", mod.color)} />
                  <span className="text-sm font-medium">{mod.label}</span>
                  {options.modalities.includes(mod.value) && (
                    <CheckCircle2 className="w-4 h-4 ml-auto text-purple-600" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Image Settings */}
          {options.modalities.includes("image") && (
            <div className="space-y-3 p-4 bg-blue-50/50 rounded-xl border border-blue-100">
              <div className="flex items-center gap-2">
                <Image className="w-4 h-4 text-blue-600" />
                <Label className="text-sm font-semibold">圖像設定</Label>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">長寬比</Label>
                <select
                  value={options.imageSettings.aspectRatio}
                  onChange={e =>
                    onOptionsChange({
                      ...options,
                      imageSettings: {
                        ...options.imageSettings,
                        aspectRatio: e.target.value,
                      },
                    })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="16:9">16:9 寬螢幕</option>
                  <option value="1:1">1:1 正方形</option>
                  <option value="4:3">4:3 標準</option>
                  <option value="9:16">9:16 直立</option>
                </select>
              </div>
            </div>
          )}

          {/* Video Settings */}
          {options.modalities.includes("video") && (
            <div className="space-y-3 p-4 bg-purple-50/50 rounded-xl border border-purple-100">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-purple-600" />
                <Label className="text-sm font-semibold">影片設定</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={options.videoSettings.useImageAsFirstFrame}
                  onCheckedChange={checked =>
                    onOptionsChange({
                      ...options,
                      videoSettings: { useImageAsFirstFrame: checked },
                    })
                  }
                />
                <Label className="text-xs">使用生成的圖像作為首幀（圖生視頻）</Label>
              </div>
            </div>
          )}

          {/* Audio Settings */}
          {options.modalities.includes("audio") && (
            <div className="space-y-3 p-4 bg-pink-50/50 rounded-xl border border-pink-100">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-pink-600" />
                <Label className="text-sm font-semibold">音樂設定</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={options.audioSettings.isInstrumental}
                  onCheckedChange={checked =>
                    onOptionsChange({
                      ...options,
                      audioSettings: { isInstrumental: checked },
                    })
                  }
                />
                <Label className="text-xs">純音樂（無人聲）</Label>
              </div>
            </div>
          )}

          {/* Generation Mode */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">生成模式</Label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: "lightning" as const, label: "閃電模式", desc: "快速生成" },
                { value: "deep_precision" as const, label: "深度精準", desc: "高品質" },
              ].map(mode => (
                <button
                  key={mode.value}
                  onClick={() => onOptionsChange({ ...options, mode: mode.value })}
                  className={cn(
                    "p-3 rounded-xl border-2 transition-all text-left",
                    options.mode === mode.value
                      ? "border-purple-400 bg-purple-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  )}
                >
                  <div className="text-sm font-medium">{mode.label}</div>
                  <div className="text-xs text-muted-foreground">{mode.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-purple-600">{totalSegments}</div>
                <div className="text-xs text-muted-foreground">分鏡段落</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-pink-600">{options.modalities.length}</div>
                <div className="text-xs text-muted-foreground">模態類型</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-600">{totalTasks}</div>
                <div className="text-xs text-muted-foreground">總生成任務</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 rounded-xl"
              onClick={onClose}
              disabled={isPending}
            >
              取消
            </Button>
            <Button
              className="flex-1 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white gap-2"
              onClick={onStartGeneration}
              disabled={options.modalities.length === 0 || isPending}
            >
              {isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  規劃中...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  開始批次生成
                </>
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
});
