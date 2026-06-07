// ============================================================================
// shells/settings/SettingsShell.tsx — /settings 富 shell（P6/橫貫；建在 P0 之上）
// ----------------------------------------------------------------------------
// 與 P0 的關係：
//   - P0 的 shells/SettingsShell.tsx（薄包裝）改為 re-export 本檔（見本包 edits/）。
//   - ENABLE_4SHELL 仍是總開關（OFF → 整個 /settings shell 不掛載）。
//   - SHELL_SETTINGS_RICH=OFF → 退回 P0 ShellFrame（純 re-home 既有頁），零行為改變。
//
// 富 shell 結構（沿用 P0 ShellFrame「DashboardLayout + 內部 Switch + ShellPage」慣例）：
//   /settings                  → SettingsHome（五分頁：一般/生成引擎/代理/觀測/管理後台）★富 UI
//   /settings/agent            → SettingsHome(agent)
//   /settings/admin            → SettingsHome(admin)   （canonical；舊 /admin redirect 落點）
//   /settings/ai-brain         → 內部轉址 /settings/admin（沿用 P0 SHELL_INTERNAL_REDIRECTS 語意）
//   /settings/admin/api-usage  → re-home P.AdminApiUsagePage（既有 rich 頁，不重寫）
//   /settings/admin/brain-pipeline → re-home P.AiBrainPipelinePage（既有 rich 頁）
// ============================================================================
import { Switch, Route } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import NotFound from "@/pages/NotFound";
import { ShellPage, NavigateRedirect } from "@/app/navigation";
import * as P from "@/app/lazyPages";
import { ShellFrame } from "@/shells/ShellFrame";
import { SHELL_SETTINGS_RICH } from "./settingsFlags";
import { SettingsHome } from "./SettingsHome";

export function SettingsShell() {
  // 退回 P0：旗標關閉時用既有 ShellFrame（純 re-home，與 P0 行為一致）。
  if (!SHELL_SETTINGS_RICH) return <ShellFrame shell="settings" />;

  return (
    <DashboardLayout shell="settings">
      <Switch>
        {/* ── P6 富首頁與 canonical 分頁深連結 ───────────────────────────── */}
        <Route path="/settings"><SettingsHome /></Route>
        <Route path="/settings/agent"><SettingsHome initial="agent" /></Route>
        <Route path="/settings/admin"><SettingsHome initial="admin" /></Route>

        {/* shell 內相容導向（沿用 P0：/settings/ai-brain → /settings/admin） */}
        <Route path="/settings/ai-brain"><NavigateRedirect to="/settings/admin" /></Route>

        {/* ── 既有深頁 re-home（沿用 P0 lazyPages；不重寫頁面，維持 parity）──── */}
        <Route path="/settings/admin/api-usage"><ShellPage component={P.AdminApiUsagePage} /></Route>
        <Route path="/settings/admin/brain-pipeline"><ShellPage component={P.AiBrainPipelinePage} /></Route>

        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

export default SettingsShell;
