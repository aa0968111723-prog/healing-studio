/**
 * ScriptGeneratePanel.tsx — Phase 2: 從 brief 直接生成影片腳本
 * ────────────────────────────────────────────────────────────────────────────
 * 與 ScriptImportPanel 平行的入口：使用者選擇影片類型（短/長/社群/動畫/深度
 * 討論），輸入一段創作 brief，系統呼叫 director.generateVideoScript 生成
 * 結構化的分鏡段落。輸出 shape 與 importScript 完全相同，後續流程通用。
 *
 * 若 WorldContext 有啟用的創作專案，當前世界觀框架 id 會自動帶入，後端
 * 會把該世界觀的角色 / 場景 / 風格設定當成 system prompt 的第一段。
 */

import { useState, useCallback, memo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useWorldContext } from "@/contexts/WorldContextContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Globe2, Loader2, Wand2 } from "lucide-react";

type Personality = "calm" | "creative" | "technical";

type VideoScriptType =
  | "short_video"
  | "long_video"
  | "social"
  | "animation"
  | "deep_discussion";

interface GeneratedScript {
  id: string;
  title: string;
  rawContent: string;
  sourceFormat: string;
  type: VideoScriptType;
  typeLabel: string;
  worldFrameworkId: number | null;
  worldContextUsed: boolean;
  segments: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface ScriptGeneratePanelProps {
  /** 共用 importScript 的後續 hook：把生成好的 segments 餵進主畫面 */
  onGenerated: (script: GeneratedScript) => void;
  personality: Personality;
}

export const ScriptGeneratePanel = memo(function ScriptGeneratePanel({
  onGenerated,
  personality,
}: ScriptGeneratePanelProps) {
  const worldCtx = useWorldContext();
  const [brief, setBrief] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<VideoScriptType>("short_video");

  const typesQuery = trpc.director.videoScriptTypes.useQuery(undefined, {
    staleTime: Infinity,
  });

  const generateMut = trpc.director.generateVideoScript.useMutation({
    onSuccess: data => {
      onGenerated(data as GeneratedScript);
      const worldHint = data.worldContextUsed ? "（已帶入世界觀）" : "";
      toast.success(
        `已生成「${data.title}」${worldHint} — ${data.segments.length} 個分鏡`
      );
    },
    onError: e => toast.error("生成失敗：" + e.message),
  });

  const handleSubmit = useCallback(() => {
    if (!brief.trim()) {
      toast.error("請輸入創作 brief");
      return;
    }
    if (!title.trim()) {
      toast.error("請輸入腳本標題");
      return;
    }
    generateMut.mutate({
      brief: brief.trim(),
      title: title.trim(),
      type,
      worldFrameworkId: worldCtx.worldFrameworkId ?? undefined,
      personality,
    });
  }, [brief, title, type, worldCtx.worldFrameworkId, personality, generateMut]);

  const typeOptions = typesQuery.data ?? [];
  const selectedType = typeOptions.find(t => t.id === type);

  return (
    <div className="rounded-2xl border border-border/40 bg-card/40 p-4 sm:p-5 space-y-4 backdrop-blur-sm">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="hs-h3 !mb-0 flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-primary" />
          從 brief 直接生成影片腳本
        </h3>
        <span className="text-2xs text-muted-foreground">
          不需先寫腳本 — 給概念，AI 直接出分鏡
        </span>
      </div>

      {/* World context hint */}
      {worldCtx.isActive && worldCtx.currentProject ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <Globe2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-muted-foreground">
            將自動帶入世界觀：
            <span className="font-medium text-foreground">
              {worldCtx.currentProject.worldFrameworkName ?? "（未綁定框架）"}
            </span>
          </span>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-2xs text-muted-foreground">
          提示：在「創作專案」頁面選定一個專案後，生成時會自動帶入該世界觀的角色與場景設定。
        </div>
      )}

      {/* Title */}
      <div className="space-y-1.5">
        <Label className="text-xs">腳本標題</Label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="例：黑暗森林追逐戰"
          maxLength={255}
          className="w-full rounded-lg border border-border/50 bg-card/50 px-3 py-2 text-sm placeholder:text-muted-foreground/50 outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong) focus-visible:border-(--ring-healing-strong) transition-shadow"
        />
      </div>

      {/* Type picker */}
      <div className="space-y-1.5">
        <Label className="text-xs">影片類型</Label>
        <Select
          value={type}
          onValueChange={v => setType(v as VideoScriptType)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map(t => (
              <SelectItem key={t.id} value={t.id}>
                <div className="flex items-center gap-2">
                  <span>{t.label}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {t.defaultSegmentCount} 段 / {t.defaultTotalDurationSec}s
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedType && (
          <p className="text-2xs text-muted-foreground whitespace-pre-line pt-1">
            {selectedType.guidance.split("\n").slice(0, 2).join("\n")}
          </p>
        )}
      </div>

      {/* Brief */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">創作 brief</Label>
          <span className="text-2xs text-muted-foreground">
            {brief.length.toLocaleString()} 字
          </span>
        </div>
        <Textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          placeholder={
            "描述你想做的影片：\n· 主題 / 故事概念\n· 想傳達的情緒或訊息\n· 視覺風格偏好\n· 目標觀眾"
          }
          rows={8}
          maxLength={20_000}
          className="resize-y"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={generateMut.isPending || !brief.trim() || !title.trim()}
        className="w-full"
      >
        {generateMut.isPending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            生成中（約 30-60 秒）…
          </>
        ) : (
          <>
            <Sparkles className="mr-2 size-4" />
            生成腳本
          </>
        )}
      </Button>
    </div>
  );
});
