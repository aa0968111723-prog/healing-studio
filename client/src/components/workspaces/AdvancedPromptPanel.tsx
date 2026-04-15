import { useState } from "react";
import type { Modality } from "@/stores/workspaceStore";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Code, ChevronDown, ChevronUp, Eye, Edit3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AdvancedPromptPanelProps {
  compiledPrompt: string;
  advancedPrompt: string;
  onAdvancedPromptChange: (value: string) => void;
  override: boolean;
  onOverrideChange: (value: boolean) => void;
  negativePrompt: string;
  onNegativePromptChange: (value: string) => void;
  modality: Modality;
}

const negativePromptPlaceholders: Record<Modality, string> = {
  image: "描述你不想出現的元素（例：模糊、變形、低品質）",
  video: "描述你不想要的動作或效果（例：晃動、跳切、失真）",
  music: "描述你不想要的音樂元素（例：人聲、噪音、失真）",
  voice: "描述你不想要的語音特徵（例：機械感、顫抖、過快）",
};

export function AdvancedPromptPanel({
  compiledPrompt,
  advancedPrompt,
  onAdvancedPromptChange,
  override,
  onOverrideChange,
  negativePrompt,
  onNegativePromptChange,
  modality,
}: AdvancedPromptPanelProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");

  return (
    <div className="bg-white/30 backdrop-blur-sm border border-white/50 rounded-xl">
      {/* Header / Toggle */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-center justify-between px-3 py-2",
          "text-xs text-muted-foreground hover:bg-white/60 transition-colors rounded-xl"
        )}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Code className="h-3.5 w-3.5" />
          進階提示詞
          {override && (
            <Eye className="h-3 w-3 text-amber-600" />
          )}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Collapsible body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">
              {/* a. Compiled Prompt Preview */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  編譯後提示詞預覽
                </Label>
                <pre
                  className={cn(
                    "rounded-xl bg-white/40 border border-white/60 p-2",
                    "text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words",
                    "max-h-32 overflow-y-auto text-muted-foreground select-all"
                  )}
                >
                  {compiledPrompt || "（尚無編譯結果）"}
                </pre>
              </div>

              {/* b. Override Toggle */}
              <div className="flex items-center justify-between gap-2 rounded-xl bg-white/40 border border-white/60 px-3 py-2">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="override-switch"
                    className="text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="h-3 w-3" />
                    覆寫模式
                  </Label>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    啟用後將使用下方自訂提示詞替代自動編譯結果
                  </p>
                </div>
                <Switch
                  id="override-switch"
                  checked={override}
                  onCheckedChange={onOverrideChange}
                />
              </div>

              {/* c. Advanced Prompt Textarea */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  自訂提示詞 / 附加修飾
                </Label>
                <Textarea
                  placeholder="在此輸入額外的提示詞修飾或完全自訂提示詞..."
                  value={advancedPrompt}
                  onChange={(e) => onAdvancedPromptChange(e.target.value)}
                  rows={3}
                  className="rounded-xl bg-white/40 border-white/60 text-xs resize-none"
                />
              </div>

              {/* d. Negative Prompt Textarea */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  負面提示詞
                </Label>
                <Textarea
                  placeholder={negativePromptPlaceholders[modality]}
                  value={negativePrompt}
                  onChange={(e) => onNegativePromptChange(e.target.value)}
                  rows={2}
                  className="rounded-xl bg-white/40 border-white/60 text-xs resize-none"
                />
              </div>

              {/* e. Reference Notes */}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  參考備註
                </Label>
                <Textarea
                  placeholder="權重筆記、風格參考或其他備忘..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="rounded-xl bg-white/40 border-white/60 text-xs resize-none"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
