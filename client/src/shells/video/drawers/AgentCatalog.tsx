// ============================================================================
// shells/video/drawers/AgentCatalog.tsx — I-1 光球接精靈：能力＋成本目錄（AIDV-79）
// ----------------------------------------------------------------------------
// 導演台光球目前只是狀態燈。第一步（零後端）：把背後 LIVE 的精靈/模型編排「攤開來看」——
//   選一位專精精靈 → 列它可用的 fal 模型（spirit.listModels）＋每個模型的**預估成本**
//   （director.estimateSegmentCost）。唯讀、不觸發生成、不扣點，落實「成本常駐」UI 原則。
// 真正派工（對光球說「生這顆鏡頭」→ 批准閘門 → spirit.invoke 派工 → 回填分鏡）＝
//   Phase 2 後端待補（需 dispatch mutation）。
// drawer 由 ConsoleDrawers 掛載、光球選單開啟；ENABLE_4SHELL 之下才可達。
// ============================================================================
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import { SPIRIT_FAMILY, getPrimaryNicknameForRole, type AgentRole } from "@shared/orb-agent-roles";

type Modality = "image" | "video" | "audio" | "voice";

/** 只列「專精」家族（圖/影/音/聲/訓…）——真正會去打 fal 模型的精靈。 */
const SPIRITS = (Object.entries(SPIRIT_FAMILY) as Array<[AgentRole, string]>)
  .filter(([, fam]) => fam === "specialist")
  .map(([role]) => ({ role, nick: getPrimaryNicknameForRole(role) }));

/** 模型 category → 成本估算 modality（estimatePoints 以 modelId 計價，modality 多為標示用，故寬鬆對映即可）。 */
function catToModality(cat: string | undefined): Modality {
  const c = (cat ?? "").toLowerCase();
  if (c.includes("video")) return "video";
  if (c.includes("voice") || c.includes("speech") || c.includes("tts")) return "voice";
  if (c.includes("music") || c.includes("audio") || c.includes("sound")) return "audio";
  return "image";
}

export function AgentCatalogBody() {
  const [spirit, setSpirit] = useState<AgentRole>(SPIRITS[0]?.role ?? "image-specialist");

  const list = trpc.spirit.listModels.useQuery({ spirit }, { staleTime: 60_000 });
  const models = list.data?.models ?? [];

  const tasks = useMemo(
    () => models.map((m) => ({ modality: catToModality(m.category), modelId: m.modelId })),
    [models],
  );
  const cost = trpc.director.estimateSegmentCost.useQuery(
    { tasks },
    { enabled: tasks.length > 0, staleTime: 60_000 },
  );
  const costByModel = useMemo(() => {
    const map = new Map<string, { points: number; available: boolean }>();
    for (const c of cost.data ?? []) map.set(c.modelId, { points: c.points, available: c.available });
    return map;
  }, [cost.data]);

  return (
    <div className="space-y-4 pt-4">
      {/* 精靈選擇 */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">挑一位專精精靈，看它能用哪些模型＋預估成本</div>
        <select
          aria-label="選擇精靈"
          value={spirit}
          onChange={(e) => setSpirit(e.target.value as AgentRole)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
        >
          {SPIRITS.map((s) => (
            <option key={s.role} value={s.role}>{s.nick}（{s.role}）</option>
          ))}
        </select>
      </div>

      {/* 模型目錄（四態） */}
      {list.isLoading ? (
        <PanelLoading count={4} className="h-16 rounded-lg" label="讀取精靈可用模型…" />
      ) : list.isError ? (
        <PanelError message="精靈模型讀取失敗（spirit.listModels）。" onRetry={() => void list.refetch()} />
      ) : models.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          這位精靈目前沒有可用的 fal 模型。換一位試試。
        </p>
      ) : (
        <div className="space-y-2">
          {models.map((m) => {
            const c = costByModel.get(m.modelId);
            return (
              <div key={m.modelId} className="rounded-lg border bg-card/60 px-2.5 py-2">
                <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium">{m.label}</span>
                  {m.tier && <Badge variant="outline" className="text-[9px]">{m.tier}</Badge>}
                  {m.category && <Badge variant="secondary" className="text-[9px]">{m.category}</Badge>}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {cost.isLoading ? "估算中…" : c ? `約 ${c.points} 點${c.available ? "" : "（暫不可用）"}` : "—"}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">{m.modelId}</div>
                {m.description && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{m.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
        Phase 1（零後端 · 唯讀）：只列精靈可用模型與<span className="font-medium">預估</span>成本，<span className="font-medium">不觸發生成、不扣點</span>。
        對光球說「把這顆鏡頭生出來」→ 批准閘門 → 精靈派工（spirit.invoke）→ 回填分鏡＝Phase 2 後端待補。
      </p>
    </div>
  );
}

export default AgentCatalogBody;
