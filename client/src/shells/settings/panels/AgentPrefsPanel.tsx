// ============================================================================
// shells/settings/panels/AgentPrefsPanel.tsx — 代理偏好（光球代理人 + 助手）
// ----------------------------------------------------------------------------
// 對映盤點 §3-14：/settings/agent（預設人格、行為、最近活動…）。
// 真實接點（protectedProcedure）：
//   agentPreferences.getPreferences() → 偏好物件                         ✅
//   agentPreferences.updatePreferences(partial) → 更新                   ✅
//   agentPreferences.getRecentActivity() → 最近活動（接受/取消/完成/失敗）✅
// persona（calm/creative/technical）對映導演 AI 三人格；input 以 as any 寬鬆化避免與
// 後端 UpdateSchema 緊耦合（對齊 P0 adapter「鬆綁 tRPC 邊界」慣例）。
// ============================================================================
import { Brain, Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PanelError } from "@/shells/_shared/PanelState";
// U-2（AIDV-92）逐殼採用 · /settings：旗標 ON 時人格選擇列改用 design-kit 亮色暖光 SettingRow
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有版＝線上零變化。人格分段按鈕群（控制項）兩版皆保留。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, SettingRow as DkSettingRow } from "@/components/design-kit";

const PERSONAS = [{ v: "calm", l: "平靜" }, { v: "creative", l: "創意" }, { v: "technical", l: "技術" }];

const SIX_AGENTS = [
  { emoji: "🎬", label: "導演 AI", role: "創作對話 · 三人格", status: "可用" },
  { emoji: "🧭", label: "總指揮", role: "意圖編排 · 先計畫", status: "可用" },
  { emoji: "📦", label: "Context Packet", role: "壓縮上下文", status: "可用" },
  { emoji: "🌐", label: "研究代理", role: "Sonar + Brave 引用", status: "待接" },
  { emoji: "👁", label: "感知代理", role: "模糊先反問", status: "可用" },
  { emoji: "🧮", label: "財財（成本）", role: "先估成本再確認", status: "可用" },
];

export function AgentPrefsPanel() {
  const utils = trpc.useUtils();
  const prefQ = trpc.agentPreferences.getPreferences.useQuery(undefined, { retry: false });
  const actQ = trpc.agentPreferences.getRecentActivity.useQuery(undefined, { retry: false });
  const update = trpc.agentPreferences.updatePreferences.useMutation({
    onSuccess: () => { toast.success("已更新代理偏好"); utils.agentPreferences.getPreferences.invalidate(); },
    onError: () => toast.error("更新失敗（需登入）"),
  });

  const pref: any = prefQ.data ?? {};
  const persona = pref.persona ?? pref.defaultPersona ?? "calm";
  const acts: any[] = (actQ.data as any)?.events ?? (actQ.data as any)?.items ?? [];

  const setPersona = (v: string) => update.mutate({ persona: v } as any);

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Brain className="h-4 w-4" />代理偏好</div>
          <span className="text-[11px] text-muted-foreground">agent_preferences · agent_model_picks</span>
        </div>
        <PersonaRow label="預設導演人格" desc="Calm / Creative / Technical（orbStore 思考球）">
          <div className="inline-flex rounded-lg border p-0.5">
            {PERSONAS.map((p) => (
              <button key={p.v} onClick={() => setPersona(p.v)} disabled={update.isPending}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${persona === p.v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {p.l}
              </button>
            ))}
          </div>
        </PersonaRow>
        {update.isPending && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />更新中…</div>}

        <div className="text-[11px] uppercase tracking-wide text-muted-foreground pt-1">六代理層狀態</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SIX_AGENTS.map((a) => (
            <div key={a.label} className="rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <b className="text-xs">{a.emoji} {a.label}</b>
                <Badge variant={a.status === "可用" ? "secondary" : "outline"} className="text-[10px]">{a.status}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{a.role}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* 最近活動 */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4" />最近活動</div>
        {actQ.isError ? (
          <PanelError compact message="讀取最近活動失敗，請稍後重試。" onRetry={() => actQ.refetch()} />
        ) : actQ.isLoading ? (
          <div className="text-xs text-muted-foreground" role="status" aria-busy="true">載入中…</div>
        ) : acts.length === 0 ? (
          <div className="text-xs text-muted-foreground">尚無活動（或未登入）。</div>
        ) : (
          <div className="max-h-64 overflow-auto divide-y">
            {acts.slice(0, 15).map((a, i) => (
              <div key={a.id ?? i} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="flex-1 truncate">{a.action ?? a.label ?? a.type ?? "活動"}</span>
                {a.status && <Badge variant="outline" className="text-[10px]">{a.status}</Badge>}
                <span className="text-[10px] text-muted-foreground">{a.createdAt ? new Date(a.createdAt).toLocaleDateString("zh-TW") : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** 人格選擇列：旗標 ON 時改用 design-kit 亮色暖光 SettingRow；OFF＝既有列＝零變化。人格分段按鈕群兩版皆在。 */
export function PersonaRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkSettingRow label={label} hint={desc}>{children}</DkSettingRow>
      </AidvKit>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4">
      <div><div className="text-sm font-medium">{label}</div>{desc && <div className="text-[11px] text-muted-foreground">{desc}</div>}</div>
      {children}
    </div>
  );
}

export default AgentPrefsPanel;
