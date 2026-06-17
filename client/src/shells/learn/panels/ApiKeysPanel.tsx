// ============================================================================
// shells/learn/panels/ApiKeysPanel.tsx — API 金鑰 / 自帶工具 BYOMCP
// ----------------------------------------------------------------------------
// 對映模擬「API 金鑰」分頁 + 開發計畫 §P6 BYOMCP（user_mcp_connections /
//   mcp_tool_permissions / mcp_tool_call_logs 三表待建，M5）。
// 現況：
//   - BYOMCP 使用者級入口＝待建 → 顯示「尚未開放」佔位（功能旗標可關，純加法）。
//   - 平台金鑰設定狀態（唯讀，不暴露 secret）＝admin.apiKeysStatus（adminProcedure）。
//     非 admin 看不到 → 僅顯示 BYOMCP 佔位，符合 RBAC。
// ============================================================================
import { KeyRound, Plug, ShieldCheck, ShieldOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelError } from "@/shells/_shared/PanelState";
// U-7（AIDV-97）：旗標 ON 時平台金鑰列改用 design-kit KeyRow（亮色暖光、唯讀無 test/delete）；
// OFF（預設）＝既有 border+Badge 格＝線上零變化。資料源（admin.apiKeysStatus）不動。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, KeyRow as DkKeyRow } from "@/components/design-kit";

/** 平台金鑰狀態列：ON＝design-kit KeyRow（isSet→已連/未設→未測）；OFF＝既有圖示+Badge 格。 */
export function KeyStatusRow({ name, label, module, isSet }: { name: string; label: string; module?: string; isSet?: boolean }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkKeyRow name={label || name} status={isSet ? "ok" : "idle"} />
      </AidvKit>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border p-2.5">
      {isSet
        ? <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
        : <ShieldOff className="h-4 w-4 text-muted-foreground shrink-0" />}
      <div className="min-w-0">
        <div className="text-xs font-medium truncate">{label}</div>
        <div className="text-[10px] text-muted-foreground truncate">{module}</div>
      </div>
      <Badge variant={isSet ? "secondary" : "outline"} className="ml-auto text-[10px]">
        {isSet ? "已設定" : "未設定"}
      </Badge>
    </div>
  );
}

export function ApiKeysPanel() {
  const { user } = useAuth();
  const role = (user as any)?.role as string | undefined;
  const isAdmin = role === "admin";

  // 只有 admin 查平台金鑰狀態；非 admin 不發此請求（RBAC）。
  const keysQ = trpc.admin.apiKeysStatus.useQuery(undefined, { retry: false, enabled: isAdmin });
  const keys: any[] = (keysQ.data as any[]) ?? [];

  return (
    <div className="space-y-4">
      {/* BYOMCP 使用者入口（待建佔位） */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4" />API 金鑰 / 自帶工具 BYOMCP</h3>
          <Badge variant="outline">待建（治理在 /settings）</Badge>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
          <Plug className="h-7 w-7 text-muted-foreground" />
          <div className="text-sm font-medium">BYOMCP 入口尚未開放</div>
          <div className="text-xs text-muted-foreground max-w-md">
            三張表（user_mcp_connections / mcp_tool_permissions / mcp_tool_call_logs）待建（M5）。
            可由管理員在 /settings → 管理後台 → 功能開關開啟。功能旗標可關，純加法。
          </div>
        </div>
      </Card>

      {/* 平台金鑰狀態（admin 唯讀） */}
      {isAdmin && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />平台金鑰狀態</div>
            <span className="text-[11px] text-muted-foreground">admin.apiKeysStatus · 只報 isSet，不暴露 secret</span>
          </div>
          {keysQ.isError ? (
            <PanelError compact message="讀取平台金鑰狀態失敗（需管理員權限）。" onRetry={() => keysQ.refetch()} />
          ) : keysQ.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {keys.map((k) => (
                <KeyStatusRow key={k.name} name={k.name} label={k.label} module={k.module} isSet={k.isSet} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default ApiKeysPanel;
