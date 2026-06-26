// ============================================================================
// components/social/TemplateCard.tsx — S1 設計類型卡網格（四態：空/載入/結果/錯誤）
// ----------------------------------------------------------------------------
// AIDV-96 U-6 · /social 九步旅程 S1 實裝。
// 升級自 TemplatePicker：加四態（空/載入/結果/錯誤）+ design-kit 暖光視覺。
// Seam：DataStore → showcase.templates（真實接縫）／FALLBACK_TEMPLATES（離線兜底）。
// 旗標 ENABLE_AIDV_CHROME OFF＝沿用既有樣式；ON＝design-kit .aidv-kit scope + 暖光。
// ============================================================================
import { useEffect, useState } from "react";
import { Check, RefreshCw, LayoutGrid } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSpine } from "@/providers/SpineProvider";
import { AidvKit, Pill, Eyebrow } from "@/components/design-kit";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import type { Template } from "@/spine/types";

interface TemplateCardItemProps {
  template: Template;
  selected: boolean;
  onSelect: (id: string) => void;
}

function TemplateCardItem({ template, selected, onSelect }: TemplateCardItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(template.id)}
      className={cn(
        "group relative overflow-hidden rounded-xl border text-left transition-all duration-200",
        selected
          ? ENABLE_AIDV_CHROME
            ? "ring-2 ring-[var(--clay)] border-[var(--clay)]"
            : "ring-2 ring-primary border-primary"
          : "hover:border-primary/50",
      )}
    >
      <div
        className="flex aspect-[4/5] items-end p-2.5"
        style={{ background: `linear-gradient(150deg, ${template.palette[0]}, ${template.palette[1]})` }}
      >
        <span className="text-sm font-semibold text-white drop-shadow">{template.name}</span>
      </div>
      <div className="flex items-center justify-between px-2 py-1.5 text-xs">
        <span className="text-muted-foreground">{template.kind}</span>
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
            ENABLE_AIDV_CHROME ? "border-[var(--line)] text-[var(--muted)]" : "border-muted text-muted-foreground",
          )}
        >
          {template.ratio}
        </span>
      </div>
      {selected && (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 rounded-full p-0.5",
            ENABLE_AIDV_CHROME ? "bg-[var(--clay)] text-[var(--on-clay)]" : "bg-primary text-primary-foreground",
          )}
        >
          <Check className="h-3 w-3" aria-hidden />
        </span>
      )}
    </button>
  );
}

interface TemplateCardGridProps {
  value: string | null;
  onChange: (id: string) => void;
  className?: string;
}

/** S1 設計類型卡網格（四態：載入/空/結果/錯誤）。Seam：DataStore → showcase.templates。 */
export function TemplateCardGrid({ value, onChange, className }: TemplateCardGridProps) {
  const spine = useSpine();
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    spine.adapters.dataStore
      .listTemplates()
      .then((t) => {
        if (!alive) return;
        const list = t.length ? t : FALLBACK_TEMPLATES;
        setTemplates(list);
        setStatus(list.length ? "ready" : "empty");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [spine.adapters.dataStore]);

  function retry() {
    setStatus("loading");
    spine.adapters.dataStore
      .listTemplates()
      .then((t) => {
        const list = t.length ? t : FALLBACK_TEMPLATES;
        setTemplates(list);
        setStatus(list.length ? "ready" : "empty");
      })
      .catch(() => setStatus("error"));
  }

  const inner = () => {
    if (status === "loading") {
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
          ))}
        </div>
      );
    }
    if (status === "error") {
      return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          {ENABLE_AIDV_CHROME ? (
            <Pill kind="bad">載入失敗 · showcase.templates</Pill>
          ) : (
            <span className="text-sm text-destructive">載入版型失敗</span>
          )}
          <Button size="sm" variant="outline" onClick={retry}>
            <RefreshCw className="h-4 w-4" /> 重試
          </Button>
        </div>
      );
    }
    if (status === "empty") {
      return (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <LayoutGrid className="h-10 w-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">尚無範本（showcase.templates 待建）</p>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="listbox" aria-label="設計類型版型庫">
        {templates.map((t) => (
          <TemplateCardItem key={t.id} template={t} selected={value === t.id} onSelect={onChange} />
        ))}
      </div>
    );
  };

  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit className={className}>
        <div className="mb-3">
          <Eyebrow>S1 · 設計類型</Eyebrow>
        </div>
        {inner()}
      </AidvKit>
    );
  }
  return <div className={className}>{inner()}</div>;
}

/** 離線兜底版型（showcase.templates 未建時確保 UI 永遠可用）。 */
const FALLBACK_TEMPLATES: Template[] = [
  { id: "tpl_quote", name: "語錄卡", ratio: "1:1", palette: ["#04122B", "#0D1B2A"], kind: "語錄" },
  { id: "tpl_story", name: "限動", ratio: "9:16", palette: ["#0D1B2A", "#E9C46A"], kind: "限動" },
  { id: "tpl_cover", name: "封面", ratio: "16:9", palette: ["#04122B", "#4ED6D6"], kind: "封面" },
  { id: "tpl_carousel", name: "懶人包", ratio: "4:5", palette: ["#1b2a4a", "#5EC59D"], kind: "圖文卡" },
  { id: "tpl_event", name: "活動海報", ratio: "4:5", palette: ["#2A1B3D", "#E9C46A"], kind: "海報" },
  { id: "tpl_news", name: "時事卡", ratio: "1:1", palette: ["#04122B", "#F5A623"], kind: "時事" },
];
