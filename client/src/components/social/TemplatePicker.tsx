// ============================================================================
// components/social/TemplatePicker.tsx — 版型/風格庫（重用 block_combos，零新表）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §3.3。
//   風格模板（怎麼生）＝ block_combos；版面範本（怎麼排）＝ showcase 範本牆。
// 透過 P0 DataStore 接縫 listTemplates()（真實接點 blockCombos.list / showcase.templates 待建）
// 載入版型；每張以 palette 漸層做縮圖。STEP 1 of the 版型→品牌鎖→生成→匯出 flow。
// ============================================================================
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSpine } from "@/providers/SpineProvider";
import type { Template } from "@/spine/types";

interface TemplatePickerProps {
  value: string | null;
  onChange: (id: string) => void;
  className?: string;
}

export function TemplatePicker({ value, onChange, className }: TemplatePickerProps) {
  const spine = useSpine();
  const [templates, setTemplates] = useState<Template[] | null>(null);

  useEffect(() => {
    let alive = true;
    spine.adapters.dataStore
      .listTemplates()
      .then((t) => alive && setTemplates(t.length ? t : FALLBACK_TEMPLATES))
      .catch(() => alive && setTemplates(FALLBACK_TEMPLATES));
    return () => {
      alive = false;
    };
  }, [spine.adapters.dataStore]);

  if (!templates) {
    return (
      <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)} role="listbox" aria-label="版型庫">
      {templates.map((t) => {
        const selected = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            className={cn(
              "group relative overflow-hidden rounded-lg border text-left transition",
              selected ? "ring-2 ring-primary border-primary" : "hover:border-primary/50",
            )}
          >
            <div
              className="flex aspect-[4/5] items-end p-2"
              style={{ background: `linear-gradient(150deg, ${t.palette[0]}, ${t.palette[1]})` }}
            >
              <span className="text-sm font-semibold text-white drop-shadow">{t.name}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <span className="text-muted-foreground">{t.kind}</span>
              <Badge variant="outline" className="px-1 py-0 text-[10px]">
                {t.ratio}
              </Badge>
            </div>
            {selected && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                <Check className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 接縫回空（如 showcase.templates 未建）時的內建版型，確保 UI 永遠可用（設計 §3.3）。 */
const FALLBACK_TEMPLATES: Template[] = [
  { id: "tpl_quote", name: "語錄卡", ratio: "1:1", palette: ["#04122B", "#0D1B2A"], kind: "語錄" },
  { id: "tpl_story", name: "限動", ratio: "9:16", palette: ["#0D1B2A", "#E9C46A"], kind: "限動" },
  { id: "tpl_cover", name: "封面", ratio: "16:9", palette: ["#04122B", "#4ED6D6"], kind: "封面" },
  { id: "tpl_carousel", name: "懶人包", ratio: "4:5", palette: ["#1b2a4a", "#5EC59D"], kind: "圖文卡" },
  { id: "tpl_event", name: "活動海報", ratio: "4:5", palette: ["#2A1B3D", "#E9C46A"], kind: "海報" },
  { id: "tpl_news", name: "時事卡", ratio: "1:1", palette: ["#04122B", "#F5A623"], kind: "時事" },
];

export default TemplatePicker;
