// ============================================================================
// shells/learn/panels/ApiKeysPanel.tsx — API 金鑰 / 自帶工具 BYOMCP
// ----------------------------------------------------------------------------
// 對映模擬「API 金鑰」分頁 + 開發計畫 §P6 BYOMCP（user_mcp_connections /
//   mcp_tool_permissions / mcp_tool_call_logs 三表待建，M5）。
// 現況：
//   - BYOMCP 使用者級入口＝待建 → 顯示「尚未開放」佔位（功能旗標可關，純加法）。
//   - 平台金鑰設定狀態（唯讀，不暴露 secret）＝admin.apiKeysStatus（adminProcedure）。
//     非 admin 看不到 → 僅顯示 BYOMCP 佔位，符合 RBAC。
//
// U-7（AIDV-97）逐殼採用 · /learn：旗標 ON 時平台金鑰列改用 design-kit 亮色暖光 KeyRow
//（token 化、Pill 狀態徽章），BYOMCP 佔位改用 design-kit EmptyState；四態（載入 Skeleton／
//   空 EmptyState／錯誤 PanelError／正常 KeyRow）齊備，與 chrome 同一個 ENABLE_AIDV_CHROME
//   開關。OFF（預設行為基準）＝既有 shadcn 列＝逐像素零變化。
// ============================================================================
import { KeyRound, Plug, ShieldCheck, ShieldOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelError, PanelEmpty } from "@/shells/_shared/PanelState";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, KeyRow as DkKeyRow } from "@/components/design-kit";

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
        {/* BYOMCP 待建：旗標 ON 走 design-kit 亮色暖光 EmptyState（lucide icon 保留，非 emoji）；OFF＝既有虛線佔位＝零變化。 */}
        {ENABLE_AIDV_CHROME ? (
          <PanelEmpty
            icon={<Plug aria-hidden="true" className="h-5 w-5" />}
            title="BYOMCP 入口尚未開放"
            hint="三張表（user_mcp_connections / mcp_tool_permissions / mcp_tool_call_logs）待建（M5）。可由管理員在 /settings → 管理後台 → 功能開關開啟。功能旗標可關，純加法。"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
            <Plug className="h-7 w-7 text-muted-foreground" />
            <div className="text-sm font-medium">BYOMCP 入口尚未開放</div>
            <div className="text-xs text-muted-foreground max-w-md">
              三張表（user_mcp_connections / mcp_tool_permissions / mcp_tool_call_logs）待建（M5）。
              可由管理員在 /settings → 管理後台 → 功能開關開啟。功能旗標可關，純加法。
            </div>
          </div>
        )}
      </Card>

      {/* 平台金鑰狀態（admin 唯讀） */}
      {isAdmin && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />平台金鑰狀態</div>
            <span className="text-[11px] text-muted-foreground">admin.apiKeysStatus · 只報 isSet，不暴露 secret</span>
          </div>
          {/* 四態：錯誤 / 載入 / 空 / 正常。錯誤與載入兩版共用；空與正常列依旗標切 design-kit。 */}
          {keysQ.isError ? (
            <PanelError compact message="讀取平台金鑰狀態失敗（需管理員權限）。" onRetry={() => keysQ.refetch()} />
          ) : keysQ.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
            </div>
          ) : keys.length === 0 ? (
            <PanelEmpty
              icon={<KeyRound aria-hidden="true" className="h-5 w-5" />}
              title="尚無平台金鑰設定"
              hint="後端未回傳任何金鑰項目（admin.apiKeysStatus 為空）。"
            />
          ) : (
            <KeyGrid keys={keys} />
          )}
        </Card>
      )}
    </div>
  );
}

/**
 * 平台金鑰格：旗標 ON＝design-kit 亮色暖光 KeyRow（token 化、Pill 狀態徽章；唯讀，不帶
 * 測試/刪除動作，符合 admin.apiKeysStatus「只報 isSet」語意），label/module 兩段資訊
 * 以「label · module」併入 KeyRow 的 name 零損失保留；OFF（預設）＝既有 shadcn 列＝零變化。
 */
export function KeyGrid({ keys }: { keys: any[] }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {keys.map((k) => (
            <DkKeyRow
              key={k.name}
              name={`${k.label}${k.module ? ` · ${k.module}` : ""}`}
              status={k.isSet ? "ok" : "idle"}
            />
          ))}
        </div>
      </AidvKit>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {keys.map((k) => (
        <div key={k.name} className="flex items-center gap-2 rounded-lg border p-2.5">
          {k.isSet
            ? <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            : <ShieldOff className="h-4 w-4 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <div className="text-xs font-medium truncate">{k.label}</div>
            <div className="text-[10px] text-muted-foreground truncate">{k.module}</div>
          </div>
          <Badge variant={k.isSet ? "secondary" : "outline"} className="ml-auto text-[10px]">
            {k.isSet ? "已設定" : "未設定"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

export default ApiKeysPanel;
