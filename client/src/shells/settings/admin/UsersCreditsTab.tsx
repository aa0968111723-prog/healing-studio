// ============================================================================
// shells/settings/admin/UsersCreditsTab.tsx — 使用者 / 積分管理（後台真的能改）
// ----------------------------------------------------------------------------
// 對映盤點 §3-17 後台「使用者管理 / 成本金流」。
// 真實接點（皆 server inline admin router）：
//   admin.allUsers() → 全部使用者                                  ✅ adminProcedure
//   admin.updateQuota({userId, amount}) → 設定配額（積分）          ✅ adminProcedure
//   admin.updateRole({userId, role}) → 改角色（user|leader|admin）  ✅ adminProcedure（admin 專屬）
//   admin.updateAutoCreditPolicy({...}) → 自動給點（leaderOrAdmin） ✅ leaderOrAdminProcedure
// RBAC：列表 leader 可看；改角色僅 admin（按鈕對 leader 隱藏/禁用）。後端 procedure 仍強制。
// ============================================================================
import { Users, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useRole } from "../rbac";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
// U-2（AIDV-92）逐殼採用 · /settings：旗標 ON 時使用者身分（名稱/email/角色）改用 design-kit AdminUserRow
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有版＝線上零變化。
// 僅取其身分顯示；積分（千分位）span 與 +500/-100/角色下拉等功能控制項照舊，一個都不掉。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, AdminUserRow } from "@/components/design-kit";

const ROLES = ["user", "leader", "admin"] as const;

export function UsersCreditsTab() {
  const role = useRole();
  const isAdmin = role === "admin";
  const utils = trpc.useUtils();

  // AIDV-618: cursor-paginated query — replaces unbounded allUsers
  const usersQ = trpc.admin.allUsersPaginated.useInfiniteQuery(
    { limit: 50 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      retry: false,
    }
  );

  const refresh = () => utils.admin.allUsersPaginated.invalidate();
  const quota = trpc.admin.updateQuota.useMutation({
    onSuccess: () => { toast.success("已調整配額"); refresh(); },
    onError: (e) => toast.error(`配額調整失敗：${e.message}`),
  });
  const roleMut = trpc.admin.updateRole.useMutation({
    onSuccess: () => { toast.success("已更新角色"); refresh(); },
    onError: (e) => toast.error(`角色更新失敗：${e.message}`),
  });

  const users: any[] = usersQ.data?.pages.flatMap((p) => p.items) ?? [];

  const adjust = (u: any, delta: number) => {
    const current = Number(u.remainingGenerations ?? u.quota ?? u.credits ?? 0);
    const next = Math.max(0, current + delta);
    quota.mutate({ userId: Number(u.id), amount: next });
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" />使用者 / 積分管理</div>
        <span className="text-[11px] text-muted-foreground">{usersQ.isLoading ? "…" : `${users.length} 位`}</span>
      </div>

      {usersQ.isError && (
        <div className="flex items-center gap-2 text-xs text-destructive"><ShieldAlert className="h-3.5 w-3.5" />需要管理員權限。</div>
      )}

      {usersQ.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
      ) : (
        <div className="divide-y">
          {users.map((u) => {
            const credits = Number(u.remainingGenerations ?? u.quota ?? u.credits ?? 0);
            const uRole = u.role ?? "user";
            return (
              <div key={u.id} className="flex flex-wrap items-center gap-2 py-2">
                <UserIdentity name={u.name ?? u.displayName ?? `#${u.id}`} email={u.email ?? "—"} role={uRole} />
                <span className="font-mono text-xs text-amber-600 w-16 text-right tabular-nums">{credits.toLocaleString()}</span>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={quota.isPending} onClick={() => adjust(u, 500)}>+500</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={quota.isPending} onClick={() => adjust(u, -100)}>-100</Button>
                {/* 改角色：僅 admin */}
                <select
                  className="h-7 rounded-md border bg-background px-1.5 text-[11px] disabled:opacity-50"
                  value={uRole}
                  disabled={!isAdmin || roleMut.isPending}
                  title={isAdmin ? "更改角色" : "僅管理員可改角色"}
                  onChange={(e) => roleMut.mutate({ userId: Number(u.id), role: e.target.value as (typeof ROLES)[number] })}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            );
          })}
          {users.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">無使用者資料。</div>}
        </div>
      )}

      {usersQ.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs"
          disabled={usersQ.isFetchingNextPage}
          onClick={() => usersQ.fetchNextPage()}
        >
          {usersQ.isFetchingNextPage ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />載入中…</> : "載入更多"}
        </Button>
      )}

      {(quota.isPending || roleMut.isPending) && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />寫入中…</div>
      )}
      {!isAdmin && (
        <p className="text-[11px] text-muted-foreground">你是 <b>{role}</b>：可看清單與調配額；<b>更改角色（updateRole）</b>為 admin 專屬。</p>
      )}
    </Card>
  );
}

/** 使用者身分顯示：旗標 ON 時改用 design-kit AdminUserRow（名稱/email/角色 Pill）；OFF＝既有版＝零變化。
 *  僅取身分顯示；積分與配額/角色控制項由呼叫端保留在同列，不丟。 */
export function UserIdentity({ name, email, role }: { name: string; email: string; role: string }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div className="flex-1 min-w-[160px]"><AdminUserRow name={name} email={email} role={role} /></div>
      </AidvKit>
    );
  }
  return (
    <div className="flex-1 min-w-[160px]">
      <div className="text-xs font-semibold">{name} <span className="text-muted-foreground font-normal">· {role}</span></div>
      <div className="text-[11px] text-muted-foreground truncate">{email}</div>
    </div>
  );
}

export default UsersCreditsTab;
