// ============================================================================
// shells/_shared/ModelCard.tsx — 統一模型卡（W1-5 單模型遊樂場統一目錄頁）
// ----------------------------------------------------------------------------
// 純展示卡，給「統一模型目錄」用。資料分兩層：
//   • 權威層（registry 為準）：modelId / label / provider / domain / tier / 優勢 /
//     不適合 —— 來自 shared/unifiedModelRegistry（系統真正叫得動的模型）。
//   • 情報層（catalog 當情報層，可選）：tagline / 官網 / 事實查核新鮮度 / 精選 ——
//     對得上 catalog（aiModels.list）的型號才有；對不上就只顯示權威層，不編造情報。
//
// 【嚴格加法 / 零風險】只 import 既有 ui 原語與 lucide；不 import server/、drizzle/、
//   @shared/schema。元件純展示、無副作用；只在 ENABLE_4SHELL=ON 掛載的 shell 內被用到。
// ============================================================================
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** 領域識別（與 unifiedModelRegistry.ModelDomain 對齊；於 _shared 重列以免反向相依 schema）。 */
export type ModelDomainId =
  | "image-upscale"
  | "text-to-image"
  | "image-to-image"
  | "image-to-3d"
  | "image-to-world"
  | "image-to-video"
  | "video-to-video"
  | "audio-music"
  | "voice-tts"
  | "fine-tune-training";

/** 領域的白話標籤＋表情（給工程小白也看得懂）。 */
export const DOMAIN_META: Record<ModelDomainId, { emoji: string; label: string }> = {
  "text-to-image": { emoji: "🖼", label: "文字生圖" },
  "image-to-image": { emoji: "🎛", label: "圖生圖 / 控制" },
  "image-upscale": { emoji: "🔬", label: "畫質放大" },
  "image-to-3d": { emoji: "🧊", label: "圖生 3D" },
  "image-to-world": { emoji: "🌐", label: "3D 世界" },
  "image-to-video": { emoji: "🎬", label: "圖生影片" },
  "video-to-video": { emoji: "🎞", label: "影片轉影片" },
  "audio-music": { emoji: "🎵", label: "音樂 / 音效" },
  "voice-tts": { emoji: "🎙", label: "語音 / 配音" },
  "fine-tune-training": { emoji: "🧪", label: "微調訓練" },
};

const TIER_LABEL: Record<string, string> = { fast: "極速", standard: "標準", premium: "旗艦" };

const FRESHNESS_LABEL: Record<string, { label: string; cls: string }> = {
  verified: { label: "已查證", cls: "text-emerald-600 dark:text-emerald-400" },
  "auto-checked": { label: "自動查核", cls: "text-emerald-600 dark:text-emerald-400" },
  stale: { label: "情報待更新", cls: "text-amber-600 dark:text-amber-400" },
  pending: { label: "情報待補", cls: "text-muted-foreground" },
  error: { label: "查核失敗", cls: "text-destructive" },
};

/** 情報層（catalog 對得上才有；對不上＝undefined）。 */
export interface ModelIntel {
  tagline?: string;
  officialUrl?: string;
  /** factCheck.status：verified / auto-checked / stale / pending / error。 */
  freshness?: string;
  featured?: boolean;
}

/** 卡片的統一檢視模型（權威層 + 可選情報層）。 */
export interface CatalogModelView {
  modelId: string;
  label: string;
  provider: string;
  domain: ModelDomainId;
  tier?: "fast" | "standard" | "premium";
  strengths: string[];
  avoidWhen: string[];
  intel?: ModelIntel;
}

export function ModelCard({
  model,
  selected = false,
  onSelect,
}: {
  model: CatalogModelView;
  selected?: boolean;
  onSelect?: (modelId: string) => void;
}) {
  const dm = DOMAIN_META[model.domain];
  const intel = model.intel;
  const fresh = intel?.freshness ? FRESHNESS_LABEL[intel.freshness] : undefined;

  return (
    <button
      type="button"
      data-testid="modelcard"
      data-model-id={model.modelId}
      aria-pressed={selected}
      onClick={() => onSelect?.(model.modelId)}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-healing",
        selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/50",
      )}
    >
      {/* 標題列 */}
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-sm">{dm.emoji}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{model.label}</span>
        {intel?.featured && <Badge variant="secondary" className="shrink-0 text-[9px]">精選</Badge>}
        {model.tier && <Badge variant="outline" className="shrink-0 text-[9px]">{TIER_LABEL[model.tier] ?? model.tier}</Badge>}
      </div>

      {/* 領域 / 供應商 / modelId */}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Badge variant="outline" className="shrink-0 text-[9px]">{dm.label}</Badge>
        <span className="shrink-0">{model.provider}</span>
        <span className="ml-auto min-w-0 truncate font-mono text-[9px]">{model.modelId}</span>
      </div>

      {/* 優勢 chips（權威層） */}
      {model.strengths.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {model.strengths.slice(0, 3).map((s) => (
            <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{s}</span>
          ))}
        </div>
      )}

      {/* 情報層（對得上 catalog 才出現） */}
      {intel ? (
        <div data-testid="modelcard-intel" className="mt-0.5 space-y-1 rounded-lg border border-dashed bg-card/60 p-1.5">
          {intel.tagline && <div className="line-clamp-2 text-[10px] leading-relaxed text-foreground/80">{intel.tagline}</div>}
          <div className="flex items-center gap-2 text-[9px]">
            {fresh && (
              <span className={cn("inline-flex items-center gap-0.5", fresh.cls)}>
                <ShieldCheck aria-hidden="true" className="size-2.5" /> {fresh.label}
              </span>
            )}
            {intel.officialUrl && (
              <a
                href={intel.officialUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-auto inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                官網 <ExternalLink aria-hidden="true" className="size-2.5" />
              </a>
            )}
          </div>
        </div>
      ) : null}
    </button>
  );
}

export default ModelCard;
