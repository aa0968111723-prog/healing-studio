// ============================================================================
// shells/learn/panels/AIModelHubPanel.tsx — AI 模型情報專區（115 模型瀏覽器）
// ----------------------------------------------------------------------------
// 對映盤點 §3-12：模型總數 115 / 廠商 35 / 精選 26 / 自動研究覆蓋率。
// 真實接點：
//   aiModels.list({modality?,provider?,tier?}) → { models[], meta{total,verifiedCount,
//     staleCount,coverage,lastResearchAt,...} }                                   ✅
//   agentModelPicks.recordPick({modality,modelId,source}) — 五腦指派              ✅
// 篩選（模態 / 廠商 / 層級）走後端 input；搜尋字串走前端即時過濾。
// ============================================================================
import { useMemo, useState } from "react";
import { Cpu, Search, Sparkles, ShieldCheck, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAIN_ROLES, BRAIN_ELIGIBLE_MODALITY, type BrainRole } from "../learnContent";
// U-2（AIDV-92）逐殼採用 · /learn：旗標 ON 時系統概覽統計卡改用 design-kit 亮色暖光 StatCard
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有 Card 版＝零變化。
// icon 折進 label（design-kit StatCard 的 label 為 ReactNode）以零資訊損失保留圖示。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, StatCard as DkStatCard } from "@/components/design-kit";

const MODALITIES = ["all", "llm", "image", "video", "audio", "search", "embed", "agent"];
const TIERS = ["all", "frontier", "balanced", "lightweight", "open-source"];

function field<T = any>(m: any, ...keys: string[]): T | undefined {
  for (const k of keys) if (m?.[k] != null) return m[k] as T;
  return undefined;
}

export function AIModelHubPanel() {
  const [modality, setModality] = useState("all");
  const [provider, setProvider] = useState("all");
  const [tier, setTier] = useState("all");
  const [search, setSearch] = useState("");

  // aiModels.list 是 publicProcedure；無金鑰也能讀（fallback baseline catalog）。
  const q = trpc.aiModels.list.useQuery(
    { modality, provider, tier },
    { retry: false, staleTime: 60_000 },
  );

  const data: any = q.data ?? {};
  const models: any[] = Array.isArray(data) ? data : data.models ?? [];
  const meta = data.meta ?? {};

  // 廠商清單（從目前回傳推導，供篩選下拉）。
  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const m of models) { const p = field<string>(m, "provider"); if (p) set.add(p); }
    return ["all", ...Array.from(set).sort()];
  }, [models]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return models;
    return models.filter((m) => {
      const label = String(field(m, "label", "name", "modelId", "id") ?? "").toLowerCase();
      const prov = String(field(m, "provider") ?? "").toLowerCase();
      return label.includes(term) || prov.includes(term);
    });
  }, [models, search]);

  const featuredCount = useMemo(
    () => models.filter((m) => Boolean(field(m, "featured", "isFeatured"))).length,
    [models],
  );
  const vendorCount = Math.max(0, providers.length - 1);

  return (
    <div className="space-y-4">
      {/* 統計卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Cpu className="h-4 w-4" />} label="模型總數" value={meta.total ?? models.length} />
        <StatCard icon={<Sparkles className="h-4 w-4" />} label="廠商" value={vendorCount || "—"} />
        <StatCard icon={<Sparkles className="h-4 w-4" />} label="精選" value={featuredCount || "—"} />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="已查核覆蓋率"
          value={meta.coverage != null ? `${Math.round(Number(meta.coverage) * (Number(meta.coverage) <= 1 ? 100 : 1))}%` : "—"}
        />
      </div>

      {/* 五腦指派 */}
      <BrainAssignment models={models} />

      {/* 篩選列 */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cpu className="h-4 w-4" />模型庫 / 願望清單
            <span className="text-xs font-normal text-muted-foreground">
              {q.isLoading ? "載入中…" : `${visible.length} / ${meta.total ?? models.length} 個`}
            </span>
          </div>
          {meta.lastResearchAt && (
            <span className="text-[11px] text-muted-foreground">
              上次研究 {new Date(meta.lastResearchAt).toLocaleString("zh-TW")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Selector label="模態" value={modality} onChange={setModality} options={MODALITIES} />
          <Selector label="廠商" value={provider} onChange={setProvider} options={providers} />
          <Selector label="層級" value={tier} onChange={setTier} options={TIERS} />
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋模型 / 廠商…"
              className="pl-8 h-9"
            />
          </div>
        </div>

        {q.isError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <RefreshCw className="h-3.5 w-3.5" />讀取模型清單失敗，已回退 baseline。
          </div>
        )}

        {q.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {visible.map((m, i) => <ModelCard key={field(m, "modelId", "id") ?? i} m={m} />)}
            {visible.length === 0 && (
              <div className="col-span-full py-10 text-center text-sm text-muted-foreground">
                無符合條件的模型。
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/** 系統概覽統計卡：旗標 ON 時改用 design-kit 亮色暖光 StatCard（icon 折進 label 保留）；OFF＝既有 Card＝零變化。 */
export function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkStatCard label={<span className="inline-flex items-center gap-1.5">{icon}{label}</span>} value={value} />
      </AidvKit>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </Card>
  );
}

function ModelCard({ m }: { m: any }) {
  const label = field<string>(m, "label", "name", "modelId", "id") ?? "未命名";
  const provider = field<string>(m, "provider") ?? "—";
  const modality = field<string>(m, "modality") ?? "";
  const tier = field<string>(m, "tier") ?? "";
  const featured = Boolean(field(m, "featured", "isFeatured"));
  const ctx = field<number>(m, "contextTokens", "contextWindow");
  return (
    <div className="rounded-xl border p-3 hover:bg-muted/40 transition-colors">
      <div className="flex items-start justify-between gap-1">
        <b className="text-xs leading-tight">{label}</b>
        {featured && <Badge variant="secondary" className="text-[10px] shrink-0">精選</Badge>}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1.5">
        {provider}{modality ? ` · ${modality}` : ""}{tier ? ` · ${tier}` : ""}
      </div>
      {ctx ? <div className="text-[10px] text-muted-foreground mt-0.5">脈絡 {Number(ctx).toLocaleString()} tok</div> : null}
    </div>
  );
}

function Selector({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border bg-background px-2 text-xs"
      >
        {options.map((o) => <option key={o} value={o}>{o === "all" ? "全部" : o}</option>)}
      </select>
    </label>
  );
}

// ── 五腦指派（agentModelPicks.recordPick）─────────────────────────────────────
function BrainAssignment({ models }: { models: any[] }) {
  const recordPick = trpc.agentModelPicks.recordPick.useMutation({
    onSuccess: () => toast.success("已記錄五腦指派"),
    onError: () => toast.error("指派失敗（需登入）"),
  });

  const eligibleFor = (role: BrainRole) =>
    models.filter((m) => BRAIN_ELIGIBLE_MODALITY[role].includes(String(field(m, "modality") ?? "")));

  const assign = (role: BrainRole, modelId: string, modality: string) => {
    if (!modelId) return;
    // 寬鬆 input（避免與後端 enum 緊耦合；對齊 P0 adapter「鬆綁 tRPC 邊界」慣例）。
    recordPick.mutate({ modality, modelId, source: "manual" } as any);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm font-semibold mb-3">
        🧠 五腦指派
        <span className="text-xs font-normal text-muted-foreground">user_ai_brain · agent_model_picks</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {BRAIN_ROLES.map((role) => {
          const eligible = eligibleFor(role);
          return (
            <div key={role} className="rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <b className="text-xs">{role}</b>
                <Badge variant="outline" className="text-[10px]">{eligible.length} 可選</Badge>
              </div>
              <select
                className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-xs"
                defaultValue=""
                disabled={recordPick.isPending || eligible.length === 0}
                onChange={(e) => {
                  const m = eligible.find((x) => String(field(x, "modelId", "id")) === e.target.value);
                  if (m) assign(role, String(field(m, "modelId", "id")), String(field(m, "modality") ?? ""));
                }}
              >
                <option value="" disabled>{eligible.length ? "選擇模型…" : "無可指派模型"}</option>
                {eligible.map((m) => {
                  const id = String(field(m, "modelId", "id"));
                  return <option key={id} value={id}>{field(m, "label", "name") ?? id}</option>;
                })}
              </select>
            </div>
          );
        })}
      </div>
      {recordPick.isPending && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
          <Loader2 className="h-3 w-3 animate-spin" />記錄中…
        </div>
      )}
    </Card>
  );
}

export default AIModelHubPanel;
