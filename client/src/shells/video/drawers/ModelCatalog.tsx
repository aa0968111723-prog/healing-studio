// ============================================================================
// shells/video/drawers/ModelCatalog.tsx — 2-13 單模型遊樂場「統一目錄頁」（W1-5）
// ----------------------------------------------------------------------------
// 取代原本 ConsoleDrawers 內 flat 的 PlaygroundBody（strangler：邏輯併入、不丟功能）。
// 兩層資料，責任分明：
//   • 權威層（registry 為準）：UNIFIED_MODEL_REGISTRY —— 系統真正叫得動的生成模型，
//     依領域分頁、依供應商過濾、可搜尋；用 ModelCard 呈現。registry 永遠先顯示，
//     不受情報層載入/失敗影響（＝目錄頁的單一真實來源）。
//   • 情報層（catalog 當情報層）：aiModels.list（自動研究 catalog）—— 只做兩件事：
//       (1) 對得上 modelId/apiId 的型號 enrich（tagline / 官網 / 事實查核新鮮度 / 精選）；
//       (2) 頂部覆蓋率資訊條（共幾筆、已查證、待更新）。對不上＝不編造情報。
// 選型後對「文字生圖 / 圖生圖 / 畫質放大」可就地試生成（沿用既有 generation 接縫 → fal）；
// 其餘領域導向對應 studio/畫布。零後端變更；全程在 ENABLE_4SHELL=ON 之下才可達。
// ============================================================================
import { useMemo, useState } from "react";
import { ImagePlus, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useSpine } from "@/providers/SpineProvider";
import { frameStyle } from "@/spine/seedVisual";
import { PanelEmpty, PanelError } from "@/shells/_shared/PanelState";
// AIDV-160：成本守門中止（免費引擎不可用、不無聲跨界扣付費點）非硬失敗 → 顯示冷靜的
// 「未扣點」toast 而非紅色「試生成失敗」，與其他生成入口一致。
import { isCostBlockedError } from "@/adapters/genErrorToast";
import {
  ModelCard, DOMAIN_META, type CatalogModelView, type ModelDomainId, type ModelIntel,
} from "@/shells/_shared/ModelCard";
import { UNIFIED_MODEL_REGISTRY } from "@shared/unifiedModelRegistry";

/** 可就地試生成的領域（走既有 image generation 接縫；其餘導向對應 studio）。 */
const TRIALABLE: ReadonlySet<ModelDomainId> = new Set<ModelDomainId>([
  "text-to-image", "image-to-image", "image-upscale",
]);

/** 領域分頁顯示順序（只渲染 registry 真有的領域）。 */
const DOMAIN_ORDER: ModelDomainId[] = [
  "text-to-image", "image-to-image", "image-to-video", "video-to-video",
  "image-upscale", "image-to-3d", "image-to-world", "audio-music",
  "voice-tts", "fine-tune-training",
];

export function ModelCatalogBody() {
  const sp = useSpine();
  const [domain, setDomain] = useState<ModelDomainId | "all">("all");
  const [provider, setProvider] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<number | null>(null);

  // 情報層：catalog（aiModels.list）。registry 不依賴它，載入/失敗都不擋目錄。
  const catalog = trpc.aiModels.list.useQuery(undefined, { staleTime: 5 * 60_000 });

  // 以 catalog 的 id / apiId 建索引，給權威層做 exact-match enrich（不模糊比對，不編造）。
  const intelById = useMemo(() => {
    const map = new Map<string, ModelIntel>();
    for (const m of catalog.data?.models ?? []) {
      const intel: ModelIntel = {
        tagline: m.tagline,
        officialUrl: m.officialUrl,
        freshness: m.factCheck?.status,
        featured: m.featured,
      };
      if (m.id) map.set(m.id.toLowerCase(), intel);
      if (m.apiId) map.set(m.apiId.toLowerCase(), intel);
    }
    return map;
  }, [catalog.data]);

  // 權威層 = 為準：把 registry 正規化成卡片檢視 + enrich。
  const models = useMemo<CatalogModelView[]>(
    () =>
      UNIFIED_MODEL_REGISTRY.map((m) => ({
        modelId: m.modelId,
        label: m.label,
        provider: m.provider,
        domain: m.domain as ModelDomainId,
        tier: m.tier,
        strengths: m.strengths,
        avoidWhen: m.avoidWhen,
        intel: intelById.get(m.modelId.toLowerCase()),
      })),
    [intelById],
  );

  const domains = useMemo<ModelDomainId[]>(() => {
    const present = new Set(models.map((m) => m.domain));
    return DOMAIN_ORDER.filter((d) => present.has(d));
  }, [models]);

  const providers = useMemo<string[]>(() => {
    const within = domain === "all" ? models : models.filter((m) => m.domain === domain);
    return Array.from(new Set(within.map((m) => m.provider))).sort();
  }, [models, domain]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (domain !== "all" && m.domain !== domain) return false;
      if (provider !== "all" && m.provider !== provider) return false;
      if (q) {
        const hay = [m.label, m.modelId, m.provider, ...m.strengths].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [models, domain, provider, search]);

  const selectedModel =
    filtered.find((m) => m.modelId === selected) ?? models.find((m) => m.modelId === selected) ?? null;

  const run = async () => {
    if (!prompt.trim() || busy || !selectedModel) return;
    const s = 1000 + Math.floor(Math.random() * 9000);
    setBusy(true);
    setSeed(null);
    try {
      const res = await sp.adapters.generation.generate({
        kind: "image", prompt: prompt.trim(), seed: s, provider: sp.provider, model: selectedModel.modelId,
      });
      setSeed(res.seedUsed);
      toast.success("試生成完成", { description: `${res.model} · seed ${res.seedUsed} · ${res.provider}` });
    } catch (e) {
      // AIDV-160：免費引擎不可用 → 守門中止（不扣點），不是硬失敗 → 冷靜提示、不紅。
      if (isCostBlockedError(e)) {
        toast.error("免費引擎暫時無法使用 · 未扣點", { description: e.message });
        return;
      }
      toast.error("試生成失敗（generation 接縫）", { description: e instanceof Error ? e.message : "無回應" });
    } finally {
      setBusy(false);
    }
  };

  const meta = catalog.data?.meta;

  return (
    <div className="space-y-3 pt-4">
      {/* 兩層責任一句話（白話） */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        清單以 <span className="font-medium text-foreground">registry 為準</span>（系統叫得動的模型）；
        <span className="font-medium text-foreground">catalog 當情報層</span> 只替對得上的型號補情報。
      </p>

      {/* 情報層覆蓋率條（四態：載入 / 錯誤 / 就緒；錯誤不擋下方目錄） */}
      {catalog.isError ? (
        <PanelError
          compact
          message="情報層讀取失敗（aiModels.list）— 以下仍為 registry 權威清單。"
          onRetry={() => void catalog.refetch()}
        />
      ) : (
        <div
          data-testid="catalog-intel-strip"
          className="rounded-lg border border-dashed bg-muted/30 px-2.5 py-1.5 text-[10px] text-muted-foreground"
        >
          {catalog.isLoading || !meta
            ? "情報層載入中…（registry 清單不受影響）"
            : `情報層 catalog：共 ${meta.total} 筆 · 已查證 ${meta.verifiedCount} · 待更新 ${meta.staleCount}`}
        </div>
      )}

      {/* 領域分頁 */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        <Button
          size="sm"
          variant={domain === "all" ? "secondary" : "ghost"}
          className="h-6 shrink-0 px-2 text-[11px]"
          onClick={() => { setDomain("all"); setProvider("all"); }}
        >
          全部
        </Button>
        {domains.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={domain === d ? "secondary" : "ghost"}
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => { setDomain(d); setProvider("all"); }}
          >
            {DOMAIN_META[d].emoji} {DOMAIN_META[d].label}
          </Button>
        ))}
      </div>

      {/* 供應商過濾（多於一個才出現） */}
      {providers.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant={provider === "all" ? "outline" : "ghost"} className="h-6 px-2 text-[10px]" onClick={() => setProvider("all")}>
            全部供應商
          </Button>
          {providers.map((p) => (
            <Button key={p} size="sm" variant={provider === p ? "outline" : "ghost"} className="h-6 px-2 text-[10px]" onClick={() => setProvider(p)}>
              {p}
            </Button>
          ))}
        </div>
      )}

      {/* 搜尋 ＋ 計數 */}
      <div className="flex items-center gap-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋型號 / 供應商 / 優勢…" className="h-8 text-xs" />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{filtered.length}/{models.length}</span>
      </div>

      {/* 選型詳情 ＋ 試生成 */}
      {selectedModel && (
        <div data-testid="model-detail" className="space-y-2 rounded-xl border bg-card/60 p-2.5">
          <div className="text-xs font-semibold">{selectedModel.label} · {DOMAIN_META[selectedModel.domain].label}</div>
          <div className="break-all font-mono text-[10px] text-muted-foreground">{selectedModel.modelId}</div>
          {selectedModel.strengths.length > 0 && (
            <div className="text-[10px]"><span className="text-muted-foreground">優勢：</span>{selectedModel.strengths.join("、")}</div>
          )}
          {selectedModel.avoidWhen.length > 0 && (
            <div className="text-[10px]"><span className="text-muted-foreground">不適合：</span>{selectedModel.avoidWhen.join("、")}</div>
          )}
          {TRIALABLE.has(selectedModel.domain) ? (
            <>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="提示詞 · 試生成一張（走既有 generation 接縫 → fal）"
                className="min-h-[60px] text-sm"
              />
              <Button size="sm" onClick={() => void run()} disabled={busy || !prompt.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} 試生成（{selectedModel.label}）
              </Button>
              {seed !== null && (
                <div className="flex items-center gap-3 rounded-xl border bg-card/60 p-2.5">
                  <div className="size-16 shrink-0 rounded-lg" style={{ background: frameStyle(seed, 0) }} />
                  <div className="font-mono text-[10px] text-muted-foreground">seed {seed} · {sp.provider}</div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/30 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
              此領域（{DOMAIN_META[selectedModel.domain].label}）的試生成走對應 studio / 畫布；此處先提供模型情報與選型。
            </div>
          )}
        </div>
      )}

      {/* 目錄（registry 為準；情報層失敗也照常顯示） */}
      {filtered.length === 0 ? (
        <PanelEmpty
          icon={<Sparkles className="size-6" />}
          title={<span className="text-xs">查無符合的模型</span>}
          hint="換個領域 / 供應商，或清除搜尋。清單以 registry 為準。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {filtered.map((m) => (
            <ModelCard
              key={`${m.domain}:${m.modelId}`}
              model={m}
              selected={selected === m.modelId}
              onSelect={(id) => { setSelected((prev) => (prev === id ? null : id)); setSeed(null); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ModelCatalogBody;
