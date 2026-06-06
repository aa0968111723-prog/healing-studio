// ============================================================================
// shells/settings/SettingsHome.tsx — /settings 富首頁（五分頁聚合）
// ----------------------------------------------------------------------------
// 對映模擬 settings shell：一般 / 生成引擎 / 代理偏好 / 觀測 / 管理後台。
// 收編開發計畫「設定四分五裂」痛點 → 全站設定/治理/觀測單一入口。
// 管理後台分頁僅 leader|admin 顯示（RBAC）。分頁同步 URL ?sub= 供深連結。
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { Settings, Hand, Brain, Gauge, Shield } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useRole, roleAtLeast } from "./rbac";
import { GeneralSettingsPanel } from "./panels/GeneralSettingsPanel";
import { ProviderPanel } from "./panels/ProviderPanel";
import { AgentPrefsPanel } from "./panels/AgentPrefsPanel";
import { ObservabilityPanel } from "./panels/ObservabilityPanel";
import { AdminPanel } from "./panels/AdminPanel";

const BASE_TABS = [
  { key: "general", label: "一般", icon: Settings },
  { key: "provider", label: "生成引擎", icon: Hand },
  { key: "agent", label: "代理偏好", icon: Brain },
  { key: "obs", label: "觀測", icon: Gauge },
] as const;

type TabKey = "general" | "provider" | "agent" | "obs" | "admin";

function readSub(search: string, allowed: string[], fallback: TabKey): TabKey {
  const v = new URLSearchParams(search).get("sub");
  return (v && allowed.includes(v) ? v : fallback) as TabKey;
}

/** initial：canonical 子路徑（如 /settings/admin）指定的預設分頁；URL ?sub= 優先。 */
export function SettingsHome({ initial = "general" }: { initial?: TabKey }) {
  const role = useRole();
  const showAdmin = roleAtLeast(role, "leader");
  const tabs = useMemo(
    () => [...BASE_TABS, ...(showAdmin ? [{ key: "admin" as const, label: "管理後台", icon: Shield }] : [])],
    [showAdmin],
  );
  const allowed = tabs.map((t) => t.key);

  const search = useSearch();
  const [sub, setSub] = useState<TabKey>(() => readSub(search, allowed, allowed.includes(initial) ? initial : "general"));
  useEffect(() => { setSub(readSub(search, allowed, allowed.includes(initial) ? initial : "general")); }, [search, initial, allowed.join(",")]);

  const onChange = (v: string) => {
    setSub(v as TabKey);
    const sp = new URLSearchParams(window.location.search);
    sp.set("sub", v);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
  };

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-4 animate-in fade-in duration-300">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">⚙ 設定</h1>
        <p className="text-sm text-muted-foreground mt-1">統管全站四 shell：外觀 / 生成引擎 / 代理 / 觀測 / 治理</p>
      </div>

      <Tabs value={sub} onValueChange={onChange} className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" className="mt-4"><GeneralSettingsPanel /></TabsContent>
        <TabsContent value="provider" className="mt-4"><ProviderPanel /></TabsContent>
        <TabsContent value="agent" className="mt-4"><AgentPrefsPanel /></TabsContent>
        <TabsContent value="obs" className="mt-4"><ObservabilityPanel /></TabsContent>
        {showAdmin && <TabsContent value="admin" className="mt-4"><AdminPanel /></TabsContent>}
      </Tabs>
    </div>
  );
}

export default SettingsHome;
