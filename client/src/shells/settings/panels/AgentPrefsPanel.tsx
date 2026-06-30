// ============================================================================
// shells/settings/panels/AgentPrefsPanel.tsx — 代理偏好（光球代理人 + 助手）
// ----------------------------------------------------------------------------
// 對映盤點 §3-14：/settings/agent（預設人格、行為、最近活動…）。
// 真實接點（protectedProcedure）：
//   directorPreferences.get() → { personality, preferredFormat }         ✅（承載三人格）
//   directorPreferences.update({ personality }) → 更新並真持久化          ✅
//   agentPreferences.getRecentActivity() → 最近活動（接受/取消/完成/失敗）✅
// persona（calm/creative/technical）＝ ai_director_preferences.personality。
// 早期版本誤打 agentPreferences.updatePreferences({ persona })，但該 UpdateSchema
// 無 persona 欄、zod .strip() 會靜默丟掉 → 永不持久化；改走 directorPreferences 並
// 移除 as any，讓型別在編譯期擋下契約不符（AIDV-612）。
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

const PERSONAS: { v: "calm" | "creative" | "technical"; l: string }[] = [
  { v: "calm", l: "平靜" },
  { v: "creative", l: "創意" },
  { v: "technical", l: "技術" },
];

const SIX_AGENTS = [
  { emoji: "🎬", label: "導演 AI", role: "創作對話 · 三人格", status: "可用" },
  { emoji: "🧭", label: "總指揮", role: "意圖編排 · 先計畫", status: "可用" },
  { emoji: "📦", label: "Context Packet", role: "壓縮上下文", status: "可用" },
  { emoji: "🌐", label: "研究代理", role: "Sonar + Brave 引用", status: "待接" },
  { emoji: "👁", label: "感知代理", role: "模糊先反問", status: "可用" },
  { emoji: "🧮", label: "財財（成本）", role: "先估成本再確認", status: "可用" },
];

// 後端 getRecentActivity 回 { events:[{ id, at, status, actionType, note, pageId }] }（agentPreferencesRouter.ts:198-215）。
type ActivityEvent = {
  id: number;
  at: number;
  status: string;
  actionType: string;
  note: string | null;
  pageId: string | null;
};

// 導演三人格（calm/creative/technical）由 directorPreferences 承載
// （ai_director_preferences.personality）。agentPreferences 沒有 persona 欄位，
// 寫進去會被 zod .strip() 靜默丟掉、永不持久化 —— 故人格的讀寫都走 directorPreferences。
type Persona = "calm" | "creative" | "technical";

export function AgentPrefsPanel() {
  const utils = trpc.useUtils();
  const dirPrefQ = trpc.directorPreferences.get.useQuery(undefined, { retry: false });
  const actQ = trpc.agentPreferences.getRecentActivity.useQuery(undefined, { retry: false });
  const update = trpc.directorPreferences.update.useMutation({
    onSuccess: () => { toast.success("已更新代理偏好"); utils.directorPreferences.get.invalidate(); },
    onError: () => toast.error("更新失敗（需登入）"),
  });

  const persona: Persona = dirPrefQ.data?.personality ?? "calm";
  const acts: ActivityEvent[] = actQ.data?.events ?? [];

  const setPersona = (v: Persona) => update.mutate({ personality: v });

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
                <span className="flex-1 truncate">{a.actionType || "活動"}{a.pageId ? ` · ${a.pageId}` : ""}</span>
                {a.status && <Badge variant="outline" className="text-[10px]">{a.status}</Badge>}
                <span className="text-[10px] text-muted-foreground">{a.at ? new Date(a.at).toLocaleDateString("zh-TW") : ""}</span>
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
