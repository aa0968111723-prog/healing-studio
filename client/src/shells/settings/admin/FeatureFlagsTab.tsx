// ============================================================================
// shells/settings/admin/FeatureFlagsTab.tsx — 功能開關（即時影響全站）
// ----------------------------------------------------------------------------
// 對映模擬 admin「功能開關 Feature Flags」。
// 兩層旗標，誠實標示來源（不誇大）：
//   (A) 建置時旗標（P0 @/config/featureFlags 的 FEATURE_FLAGS）：ENABLE_4SHELL / SHELL_*。
//       來源＝Vite env，**唯讀**顯示（要改需改 .env 重 build；不可由 UI 即時切）。
//   (B) 執行時治理旗標：寫入 settings.extraSettings.featureFlags（settings.update）。
//       對映 adapter 對應表「adminSetFlag → settings.update（system_settings）」。
//       未來把 (A) 的來源從 import.meta.env 換成 system_settings 時，呼叫端不動。
// RBAC：本分頁僅 admin 可見（見 rbac.ADMIN_TAB_MIN_ROLE.flags = admin）。
// ============================================================================
import { useEffect, useState } from "react";
import { Flag, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PanelError } from "@/shells/_shared/PanelState";
// U-2（AIDV-92）逐殼採用 · /settings：旗標 ON 時執行時功能開關列改用 design-kit 亮色暖光 SettingRow
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有版＝線上零變化。Switch 控制項兩版皆保留。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, SettingRow as DkSettingRow } from "@/components/design-kit";

// 執行時治理旗標（存 settings.extraSettings.featureFlags）。
const RUNTIME_FLAGS: { key: string; label: string; desc: string }[] = [
  { key: "research", label: "研究代理（Sonar+Brave）", desc: "/learn 研究面板開關" },
  { key: "byomcp", label: "BYOMCP 自帶工具", desc: "開啟 /learn 的 API 金鑰／外部 MCP 入口（待建）" },
  { key: "ambient", label: "Ambient 氛圍", desc: "站台體驗開關" },
  { key: "focusFlow", label: "FocusFlow 專注流", desc: "站台體驗開關" },
  { key: "onboarding", label: "意圖式進站（首頁）", desc: "關閉則首頁直接進 /video" },
];

export function FeatureFlagsTab() {
  const utils = trpc.useUtils();
  const getQ = trpc.settings.get.useQuery(undefined, { retry: false });
  const update = trpc.settings.update.useMutation({
    onSuccess: () => { toast.success("已更新功能開關"); utils.settings.get.invalidate(); },
    onError: () => toast.error("更新失敗（需管理員）"),
  });

  const [runtime, setRuntime] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const extra = (getQ.data as any)?.extraSettings;
    if (extra?.featureFlags) setRuntime(extra.featureFlags as Record<string, boolean>);
  }, [getQ.data]);

  const toggle = (key: string) => {
    const next = { ...runtime, [key]: !runtime[key] };
    setRuntime(next);
    update.mutate({ extraSettings: { featureFlags: next } } as any);
  };

  return (
    <div className="space-y-4">
      {/* (A) 建置時旗標：唯讀 */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4" />建置時旗標（唯讀）</div>
          <span className="text-[11px] text-muted-foreground">來源：Vite env · 改需重 build</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {Object.entries(FEATURE_FLAGS).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border p-2.5">
              <span className="text-xs font-mono">{k}</span>
              <Badge variant={v ? "secondary" : "outline"} className="text-[10px]">{v ? "ON" : "OFF"}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* (B) 執行時治理旗標：可即時切（settings.update） */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Flag className="h-4 w-4" />執行時功能開關</div>
          <span className="text-[11px] text-muted-foreground">settings.update · extraSettings.featureFlags</span>
        </div>
        {getQ.isError && (
          <PanelError compact message="讀取現有功能開關失敗（需管理員）；以下為預設值。" onRetry={() => getQ.refetch()} />
        )}
        {RUNTIME_FLAGS.map((f) => (
          <FlagRow key={f.key} label={f.label} desc={f.desc}>
            <Switch checked={!!runtime[f.key]} onCheckedChange={() => toggle(f.key)} disabled={update.isPending} />
          </FlagRow>
        ))}
        {update.isPending && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />寫入中…</div>}
        <p className="text-[11px] text-muted-foreground">註：站台級（全使用者）治理待 P3 把旗標來源移到 `system_settings`；目前 extraSettings 為使用者級草案。</p>
      </Card>
    </div>
  );
}

/** 執行時功能開關列：旗標 ON 時改用 design-kit 亮色暖光 SettingRow；OFF＝既有列＝零變化。Switch 控制項兩版皆在。 */
export function FlagRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
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

export default FeatureFlagsTab;
