// ============================================================================
// shells/settings/admin/AuditTab.tsx — 稽核日誌（活動紀錄 + 平台金鑰狀態）
// ----------------------------------------------------------------------------
// 對映盤點 §3-17 後台「活動紀錄 / API·資料庫」+ 模擬 admin「稽核日誌」。
// 真實接點（adminProcedure）：
//   admin.usageLogs({limit}) → 全站用量 / 操作日誌（當稽核流）   ✅
//   admin.apiKeysStatus() → 平台金鑰是否設定（只報 isSet，不暴露 secret）✅
// RBAC：本分頁僅 admin（rbac.ADMIN_TAB_MIN_ROLE.audit = admin）。
// ============================================================================
import { ScrollText, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function AuditTab() {
  const logsQ = trpc.admin.usageLogs.useQuery({ limit: 100 }, { retry: false });
  const keysQ = trpc.admin.apiKeysStatus.useQuery(undefined, { retry: false });

  const logs: any[] = (logsQ.data as any[]) ?? (logsQ.data as any)?.items ?? [];
  const keys: any[] = (keysQ.data as any[]) ?? [];

  return (
    <div className="space-y-4">
      {/* 平台金鑰狀態 */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" />平台金鑰狀態</div>
          <span className="text-[11px] text-muted-foreground">admin.apiKeysStatus · 不暴露 secret</span>
        </div>
        {keysQ.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 rounded-lg" />)}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {keys.map((k) => (
              <div key={k.name} className="flex items-center gap-2 rounded-lg border p-2.5">
                {k.isSet ? <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" /> : <ShieldOff className="h-4 w-4 text-muted-foreground shrink-0" />}
                <div className="min-w-0"><div className="text-xs font-medium truncate">{k.label}</div><div className="text-[10px] text-muted-foreground truncate">{k.module}</div></div>
                <Badge variant={k.isSet ? "secondary" : "outline"} className="ml-auto text-[10px]">{k.isSet ? "已設定" : "未設定"}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 稽核 / 用量日誌 */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><ScrollText className="h-4 w-4" />稽核 / 活動日誌</div>
          <Badge variant="outline">{logsQ.isLoading ? "…" : `${logs.length} 筆`}</Badge>
        </div>
        {logsQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
        ) : logs.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">無日誌（或需管理員權限）。</div>
        ) : (
          <div className="max-h-80 overflow-auto divide-y">
            {logs.map((a, i) => {
              const ts = a.createdAt ?? a.ts ?? a.date;
              const actor = a.userId ?? a.actor ?? a.userEmail ?? "—";
              const action = a.requestType ?? a.action ?? a.kind ?? a.type ?? "事件";
              const detail = a.model ?? a.detail ?? a.apiProvider ?? "";
              return (
                <div key={a.id ?? i} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className="text-[10px] text-muted-foreground w-20 shrink-0">{ts ? new Date(ts).toLocaleDateString("zh-TW") : "—"}</span>
                  <span className="text-[10px] text-muted-foreground w-16 truncate shrink-0">{String(actor)}</span>
                  <span className="flex-1 truncate"><b>{action}</b>{detail ? <span className="text-muted-foreground"> · {detail}</span> : null}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

export default AuditTab;
