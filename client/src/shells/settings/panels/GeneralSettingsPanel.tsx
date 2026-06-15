// ============================================================================
// shells/settings/panels/GeneralSettingsPanel.tsx — 一般設定（外觀 / 通知 / 帳號）
// ----------------------------------------------------------------------------
// 對映盤點 §3-13：個人設定（外觀 / 通知 / 帳號資訊）。含「主題」。
// 真實接點（protectedProcedure）：
//   settings.get() → { uiTheme, accentColor, fontScale, reducedMotion, emailNotifications,
//                      generationCompleteNotify, weeklyDigestEnabled, locale, timezone, ... } ✅
//   settings.update(partial) → 持久化（db.upsertSystemSettings）                              ✅
//   auth.me() → 帳號資訊（名稱 / email / role / 剩餘配額）                                      ✅
// 主題寫入 settings.uiTheme（既有 ThemeProvider 讀此來源套用），不重造主題狀態。
// ============================================================================
import { useEffect, useState } from "react";
import { Palette, Bell, Users, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
// U-2（AIDV-92）逐殼採用 · /settings：旗標 ON 時設定列改用 design-kit 亮色暖光 SettingRow
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有版＝零變化。
// 設計門（ui-ux-pro-max --domain ux）命中「Input Labels(High)：控制項需有可見標籤」→ 兩版皆標籤可見。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, SettingRow as DkSettingRow } from "@/components/design-kit";

const THEMES = [{ v: "system", l: "跟隨系統" }, { v: "light", l: "淺色（溫潤大地）" }, { v: "dark", l: "深色（深藍宇宙）" }];
const FONT = [{ v: "small", l: "小" }, { v: "medium", l: "中" }, { v: "large", l: "大" }];

export function GeneralSettingsPanel() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const getQ = trpc.settings.get.useQuery(undefined, { retry: false });
  const update = trpc.settings.update.useMutation({
    onSuccess: () => { toast.success("已儲存設定"); utils.settings.get.invalidate(); },
    onError: () => toast.error("儲存失敗（需登入）"),
  });

  // 本地草稿（讀取後填入，可改、按儲存才送）
  const [draft, setDraft] = useState<any>(null);
  useEffect(() => { if (getQ.data && !draft) setDraft({ ...(getQ.data as any) }); }, [getQ.data, draft]);
  const d = draft ?? {};
  const set = (k: string, v: any) => setDraft((p: any) => ({ ...(p ?? {}), [k]: v }));

  const save = () => {
    if (!draft) return;
    update.mutate({
      uiTheme: d.uiTheme, accentColor: d.accentColor, fontScale: d.fontScale,
      reducedMotion: !!d.reducedMotion, emailNotifications: !!d.emailNotifications,
      generationCompleteNotify: !!d.generationCompleteNotify, weeklyDigestEnabled: !!d.weeklyDigestEnabled,
      locale: d.locale, timezone: d.timezone,
    } as any);
  };

  return (
    <div className="space-y-4">
      {/* 外觀 */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Palette className="h-4 w-4" />外觀</div>
        <SettingsRow label="主題" desc="深藍宇宙（暗）／溫潤大地（淺，次要色調）">
          <select value={d.uiTheme ?? "system"} onChange={(e) => set("uiTheme", e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-xs">
            {THEMES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow label="字級" desc="介面字體縮放">
          <select value={d.fontScale ?? "medium"} onChange={(e) => set("fontScale", e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-xs">
            {FONT.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </SettingsRow>
        <SettingsRow label="降低動態效果" desc="reduced motion（無障礙）">
          <Switch checked={!!d.reducedMotion} onCheckedChange={(v) => set("reducedMotion", v)} />
        </SettingsRow>
      </Card>

      {/* 通知 */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4" />通知</div>
        <SettingsRow label="Email 通知" desc="重要事件以 email 通知">
          <Switch checked={!!d.emailNotifications} onCheckedChange={(v) => set("emailNotifications", v)} />
        </SettingsRow>
        <SettingsRow label="生成完成通知" desc="生成任務完成時通知">
          <Switch checked={!!d.generationCompleteNotify} onCheckedChange={(v) => set("generationCompleteNotify", v)} />
        </SettingsRow>
        <SettingsRow label="每週摘要" desc="每週用量 / 進度摘要">
          <Switch checked={!!d.weeklyDigestEnabled} onCheckedChange={(v) => set("weeklyDigestEnabled", v)} />
        </SettingsRow>
      </Card>

      {/* 帳號 */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" />帳號</div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label="名稱" value={(user as any)?.name ?? (user as any)?.displayName ?? "—"} />
          <Field label="電子郵件" value={(user as any)?.email ?? "—"} />
          <Field label="角色" value={<Badge variant="secondary">{(user as any)?.role ?? "user"}</Badge>} />
          <Field label="剩餘配額" value={`${(user as any)?.remainingGenerations ?? "—"} 次`} />
        </div>
        <p className="text-[11px] text-muted-foreground">帳號設定（/account-settings）建議併入此分頁（盤點：與此重複）。→ 目標 Supabase Auth。</p>
      </Card>

      {/* 儲存列 */}
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={update.isPending || !draft}>
          {update.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          儲存偏好
        </Button>
        <Button variant="outline" onClick={() => setDraft(getQ.data ? { ...(getQ.data as any) } : null)} disabled={update.isPending}>
          還原未儲存變更
        </Button>
        {getQ.isError && <span className="text-[11px] text-muted-foreground">（未登入 → 設定唯讀）</span>}
      </div>
    </div>
  );
}

/** 設定列：旗標 ON 時改用 design-kit 亮色暖光 SettingRow（label/hint/控制項分欄）；OFF＝既有版＝零變化。 */
export function SettingsRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkSettingRow label={label} hint={desc}>{children}</DkSettingRow>
      </AidvKit>
    );
  }
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div><div className="text-sm font-medium">{label}</div>{desc && <div className="text-[11px] text-muted-foreground">{desc}</div>}</div>
      {children}
    </div>
  );
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-xs font-medium mt-0.5">{value}</div>
    </div>
  );
}

export default GeneralSettingsPanel;
