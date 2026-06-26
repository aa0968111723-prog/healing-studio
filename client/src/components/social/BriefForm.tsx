// ============================================================================
// components/social/BriefForm.tsx — S2 五問 brief 表單
// ----------------------------------------------------------------------------
// AIDV-96 U-6 · /social 九步旅程 S2 實裝。
// 五問（目的/受眾/品牌聲音/關鍵訊息/視覺方向），每題可 AI 代寫。
// Seam：Commander → director.chat（directorReply）。
// 旗標 ENABLE_AIDV_CHROME ON＝design-kit .aidv-kit scope + 暖光；OFF＝沿用既有 shadcn 樣式。
// ============================================================================
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSpine } from "@/providers/SpineProvider";
import { AidvKit, Eyebrow } from "@/components/design-kit";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";

export interface BriefData {
  purpose: string;
  audience: string;
  voice: string;
  message: string;
  direction: string;
}

const FIELDS: { key: keyof BriefData; label: string; placeholder: string }[] = [
  { key: "purpose", label: "目的（這篇貼文要達成什麼？）", placeholder: "例：推廣新品、提升品牌知名度…" },
  { key: "audience", label: "受眾（說給誰聽？）", placeholder: "例：25–35 歲上班族、熱愛療癒感的手作人…" },
  { key: "voice", label: "品牌聲音（語氣風格）", placeholder: "例：溫暖、簡潔、有故事感、不說教…" },
  { key: "message", label: "關鍵訊息（最重要的一句話）", placeholder: "例：每一刻，都值得被好好記住。" },
  { key: "direction", label: "視覺方向（畫面想呈現的感覺）", placeholder: "例：自然光、淺米色調、繪本感插圖…" },
];

interface BriefFormProps {
  value: BriefData;
  onChange: (data: BriefData) => void;
  className?: string;
}

/** S2 五問 brief 表單（可 AI 代寫）。Seam：Commander → director.chat。 */
export function BriefForm({ value, onChange, className }: BriefFormProps) {
  const spine = useSpine();
  const [writing, setWriting] = useState<keyof BriefData | null>(null);

  async function aiWrite(field: keyof BriefData) {
    const fieldMeta = FIELDS.find((f) => f.key === field)!;
    setWriting(field);
    try {
      const reply = await spine.adapters.commander.directorReply({
        persona: "calm",
        message: `幫我寫「${fieldMeta.label}」的內容（50 字內，繁體中文，針對社群貼文）。已知資訊：${JSON.stringify(value)}`,
      });
      onChange({ ...value, [field]: reply.text });
      toast.success("AI 已填入", { description: fieldMeta.label });
    } catch {
      toast.error("AI 代寫失敗", { description: "可手動填寫，或稍後重試" });
    } finally {
      setWriting(null);
    }
  }

  const fields = (
    <div className={cn("space-y-4", className)}>
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`brief-${f.key}`} className="text-xs font-medium">
              {f.label}
            </Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-xs"
              disabled={writing !== null}
              aria-label={`光球幫我寫「${f.label}」`}
              onClick={() => aiWrite(f.key)}
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              {writing === f.key ? "撰寫中…" : "光球幫我寫"}
            </Button>
          </div>
          <Textarea
            id={`brief-${f.key}`}
            rows={2}
            placeholder={f.placeholder}
            value={value[f.key]}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            aria-live="polite"
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">※ 只記錄 brief，不立即生成或產生費用。</p>
    </div>
  );

  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div className="mb-3">
          <Eyebrow>S2 · 五問 brief</Eyebrow>
        </div>
        {fields}
      </AidvKit>
    );
  }
  return fields;
}
