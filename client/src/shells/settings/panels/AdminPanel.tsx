// ============================================================================
// shells/settings/panels/AdminPanel.tsx — 管理後台（RBAC 子分頁）
// ----------------------------------------------------------------------------
// 對映盤點 §3-17（10 分頁後台）。本包收斂為 6 治理面（brief 指定）：
//   使用者・積分 / 內容 / 功能開關 / 資料修復 / 稽核（＋觀測在 /settings 上層分頁）。
// RBAC（rbac.ts，對齊後端 procedure 守門）：
//   - 整個後台僅 leader | admin 可見（user 看不到此分頁）。
//   - 子分頁再依 ADMIN_TAB_MIN_ROLE 過濾：使用者・積分=leader+；內容/開關/修復/稽核=admin。
// 真正權限由後端 adminProcedure / leaderOrAdminProcedure 強制；前端僅 UX 隱藏。
// ============================================================================
import { useMemo, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// U-2（AIDV-92）逐殼採用 · /settings：旗標 ON 時後台子分頁條改用 design-kit 亮色暖光 SubTabs；
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有 TabsList＝線上零變化。內容切換仍由 radix Tabs 負責。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, SubTabs as DkSubTabs } from "@/components/design-kit";
import { useRole, roleAtLeast, canSeeAdminTab } from "../rbac";
import { UsersCreditsTab } from "../admin/UsersCreditsTab";
import { ContentTab } from "../admin/ContentTab";
import { FeatureFlagsTab } from "../admin/FeatureFlagsTab";
import { DataRepairTab } from "../admin/DataRepairTab";
import { AuditTab } from "../admin/AuditTab";

const ADMIN_TABS = [
  { key: "users", label: "使用者・積分" },
  { key: "content", label: "內容" },
  { key: "flags", label: "功能開關" },
  { key: "data-repair", label: "資料修復" },
  { key: "audit", label: "稽核" },
] as const;

export function AdminPanel() {
  const role = useRole();

  // 後台整體門檻：leader | admin。
  if (!roleAtLeast(role, "leader")) {
    return (
      <Card className="p-8 flex flex-col items-center gap-3 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium">需要管理員 / 組長權限</div>
        <div className="text-xs text-muted-foreground max-w-sm">你目前角色為 <b>{role}</b>。管理後台僅對 leader / admin 開放。</div>
      </Card>
    );
  }

  const visibleTabs = useMemo(() => ADMIN_TABS.filter((t) => canSeeAdminTab(role, t.key)), [role]);
  const [tab, setTab] = useState<string>(visibleTabs[0]?.key ?? "users");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        <span className="font-semibold">管理後台</span>
        <Badge variant="secondary" className="text-[10px]">{role}</Badge>
        <span className="text-[11px] text-muted-foreground">管理使用者配額、角色權限、內容、功能開關、修復與稽核</span>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <AdminTabStrip tabs={visibleTabs} active={tab} onSelect={setTab} />
        <TabsContent value="users" className="mt-4"><UsersCreditsTab /></TabsContent>
        <TabsContent value="content" className="mt-4"><ContentTab /></TabsContent>
        <TabsContent value="flags" className="mt-4"><FeatureFlagsTab /></TabsContent>
        <TabsContent value="data-repair" className="mt-4"><DataRepairTab /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/** 後台子分頁條：旗標 ON 時改用 design-kit 亮色暖光 SubTabs；OFF＝既有 radix TabsList＝零變化。
 *  兩版皆呼叫同一 onSelect；內容切換仍由 radix Tabs 的 value/TabsContent 負責。 */
export function AdminTabStrip(
  { tabs, active, onSelect }: { tabs: readonly { key: string; label: string }[]; active: string; onSelect: (v: string) => void },
) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkSubTabs tabs={tabs.map((t) => ({ id: t.key, label: t.label }))} active={active} onSelect={onSelect} />
      </AidvKit>
    );
  }
  return (
    <TabsList className="flex flex-wrap h-auto">
      {tabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}
    </TabsList>
  );
}

export default AdminPanel;
