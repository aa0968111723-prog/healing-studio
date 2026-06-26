// ============================================================================
// components/social/SourceSelector.tsx — S3 素材收集（三選一 + 授權 HOLD gate）
// ----------------------------------------------------------------------------
// AIDV-96 U-6 · /social 九步旅程 S3 實裝。
// 素材來源選擇：站內生成 / 上傳自有 / 外部熱門；外部來源未授權標 HOLD gate。
// Seam：DataStore → assets.* / news.list（外部熱門）。
// 旗標 ENABLE_AIDV_CHROME ON＝design-kit .aidv-kit scope + 暖光；OFF＝沿用既有樣式。
// ============================================================================
import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Globe, Library, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpine } from "@/providers/SpineProvider";
import { AidvKit, Pill, Eyebrow } from "@/components/design-kit";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import type { NewsItem } from "@/spine/types";

type SourceKind = "internal" | "upload" | "external";

interface SourceItem {
  id: string;
  kind: SourceKind;
  label: string;
  sublabel?: string;
  authorized: boolean;
}

const KIND_TABS: { id: SourceKind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "internal", label: "站內生成", Icon: Library },
  { id: "upload", label: "上傳自有", Icon: Upload },
  { id: "external", label: "外部熱門", Icon: Globe },
];

interface SourceSelectorProps {
  /** 當 HOLD 狀態變更時通知父層（true=有未授權素材）。 */
  onHoldChange?: (hasHold: boolean) => void;
  className?: string;
}

/** S3 素材收集：三選一 + 授權 HOLD gate。外部來源未授權不可進 S4。 */
export function SourceSelector({ onHoldChange, className }: SourceSelectorProps) {
  const spine = useSpine();
  const [activeKind, setActiveKind] = useState<SourceKind>("internal");
  const [items, setItems] = useState<SourceItem[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setItems(null);

    (async () => {
      try {
        let loaded: SourceItem[] = [];
        if (activeKind === "external") {
          const news = await spine.adapters.dataStore.listNews();
          loaded = (news as NewsItem[]).map((n) => ({
            id: n.id,
            kind: "external" as SourceKind,
            label: n.title,
            sublabel: n.source,
            authorized: false,
          }));
        } else if (activeKind === "internal") {
          // 站內生成：DataStore assets.* 待建；顯示已知條目（mock）。
          loaded = [
            { id: "int_placeholder", kind: "internal", label: "站內生成素材（DataStore assets.* 待建）", authorized: true },
          ];
        }
        // upload: 空（拖曳上傳 Storage seam 待建）
        if (alive) {
          setItems(loaded);
          setStatus("ready");
        }
      } catch {
        if (alive) setStatus("error");
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeKind, spine.adapters.dataStore]);

  const hasHold = (items ?? []).some((item) => !item.authorized);
  useEffect(() => {
    onHoldChange?.(hasHold);
  }, [hasHold, onHoldChange]);

  const inner = (
    <div className={cn("space-y-3", className)}>
      {/* Kind tabs */}
      <div role="tablist" aria-label="素材來源">
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
          {KIND_TABS.map(({ id, label, Icon }) => {
            const active = activeKind === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setActiveKind(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all",
                  active
                    ? ENABLE_AIDV_CHROME
                      ? "bg-[var(--clay)] text-[var(--on-clay)] shadow-sm"
                      : "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content area */}
      {status === "loading" && (
        <div className="space-y-2" aria-label="載入中" aria-live="polite">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-md border border-destructive/30 p-3 text-sm text-destructive" role="alert">
          載入失敗（orbProxy.unifiedSearch / news.list）
        </div>
      )}

      {status === "ready" && activeKind === "upload" && (
        <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          <Upload className="h-8 w-8 opacity-40" aria-hidden />
          <p>拖曳或點擊上傳素材</p>
          <p className="text-xs">（Storage seam 待建，實作後此處可上傳）</p>
        </div>
      )}

      {status === "ready" && activeKind !== "upload" && (
        <div className="space-y-2" aria-live="polite">
          {(items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">目前無素材。</p>
          ) : (
            (items ?? []).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-md border bg-card p-2.5 text-sm"
              >
                {item.authorized ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.label}</p>
                  {item.sublabel && <p className="truncate text-xs text-muted-foreground">{item.sublabel}</p>}
                </div>
                {!item.authorized && (
                  ENABLE_AIDV_CHROME ? (
                    <Pill kind="warn" dot>授權待確認 · HOLD</Pill>
                  ) : (
                    <span className="shrink-0 rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      HOLD
                    </span>
                  )
                )}
              </div>
            ))
          )}
        </div>
      )}

      {hasHold && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
          role="alert"
        >
          ⚠ 外部素材授權未確認 — 解除所有 HOLD 後方可進入 S4 生成。
        </div>
      )}
    </div>
  );

  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div className="mb-3">
          <Eyebrow>S3 · 收集素材</Eyebrow>
        </div>
        {inner}
      </AidvKit>
    );
  }
  return inner;
}
