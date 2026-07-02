// ============================================================================
// shells/settings/panels/ConnectionsPanel.tsx — U-12 連接器／個人資料庫治理
// （AIDV-115 Phase 1 · AIDV-148 Phase 2 整併版）
// ----------------------------------------------------------------------------
// /settings 第 6 籤「連接器」：把「個人資料來源」收進單一治理頁，餵 contextPacket 的允許來源。
// AIDV-148 整併決策（放行令）：本檔（PR #917 已掛載版）為唯一主版；
//   greenfield components/connectors/ConnectorsPanel（PR #918、未被任何頁引用）精華合流後退役：
//   · 四值狀態 Pill（ok/warn/bad/mute ← 原 HEALTH_PILL）映射到真實 status enum
//   · 狀態 dot 加 a11y（role=img + aria-label ← 原 StatusDot）
//   · ACL 治理列 ← 改接 project_data_access_rules 真資料（唯讀總覽，見 AclRulesSummary）
// 真實接點（皆既有 protectedProcedure，零後端改動）：
//   dataConnections.list({projectId?})  → 列出使用者連接（不含 credential）            ✅
//   dataConnections.test({id})          → 健檢、更新 status＋lastHealthCheckAt         ✅
//   dataConnections.setStatus({id,status}) → 啟用 / 停用                                ✅
//   dataConnections.delete({id})        → 刪除連接（含加密憑證，AIDV-185）             ✅
//   teams.list / teamData.listProjectAccessRules({teamId, projectId:null})
//     → 全站（團隊層級）資料存取規則唯讀總覽（成員可讀；編輯續留建立流程）            ✅
// 5 類連接器：②Google雲端(cloud) ③Notion(notes) ④其他MCP(mcp) 走真實 list；
//   ①本機 ⑤內部10G、④的 BYOMCP 權限/稽核、以及「新增連接」(OAuth/credential 走既有建立流程，
//   本頁不收金鑰) 皆為待建 → 標「待接」pill（前端不造表、不寫真實金鑰）。
// design-kit：旗標 ON 時連接器列改用亮色暖光 ProviderOption（圓點＝健康/故障）＋狀態 Pill；
//   OFF（受 ENABLE_4SHELL 守門）＝既有卡片。四態走共用 PanelState。
// ============================================================================
import { useMemo, useState } from "react";
import { Plug, Cloud, FileText, HardDrive, Database, ShieldCheck, Loader2, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { connectionStatusLabel, providerLabel, accessLevelLabel } from "@/components/create/teamDataFormat";
import { PanelLoading, PanelEmpty, PanelError } from "@/shells/_shared/PanelState";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, ProviderOption, Pill } from "@/components/design-kit";

/** 5 類連接器分類。kind 為 null＝後端表待建（標待接）；有 kind＝消費既有 dataConnections。 */
const CATEGORIES = [
  { id: "local", label: "本機檔案", icon: HardDrive, kind: null as string | null, auth: "限桌面 App", desc: "桌機版存取本機資料夾", pending: "桌機版待建" },
  { id: "cloud", label: "Google 雲端", icon: Cloud, kind: "cloud", auth: "OAuth", desc: "Google Drive 文件（唯讀）", pending: null as string | null },
  { id: "notes", label: "Notion", icon: FileText, kind: "notes", auth: "API 金鑰", desc: "Notion 筆記（唯讀）", pending: null as string | null },
  { id: "mcp", label: "其他 MCP 工具", icon: Plug, kind: "mcp", auth: "BYOMCP", desc: "自帶 MCP 連接", pending: "權限/稽核表待建（M5）" },
  { id: "internal", label: "內部資料庫", icon: Database, kind: null as string | null, auth: "平台內建", desc: "每人 10G 個人庫", pending: "每人 10G 待建" },
] as const;

/** status → ProviderOption 的健康圓點（active＝ok、其餘＝down）。 */
function isHealthy(status?: string): boolean {
  return status === "active";
}

/** status → design-kit Pill kind（greenfield HEALTH_PILL 精華，映射到真實 status enum）。 */
export function statusPillKind(status?: string): "ok" | "warn" | "bad" | "mute" {
  switch (status) {
    case "active":
      return "ok";
    case "pending":
      return "warn";
    case "error":
      return "bad";
    default: // disabled / 未知
      return "mute";
  }
}

/**
 * 不可逆刪除的守門（AIDV-148 修補）：抽成可測純函式。
 * confirmFn 回 true 才呼叫 mutate({id})；回 false（含 confirm 被嵌入環境抑制）零副作用。
 * 預設走 window.confirm；測試可注入假 confirmFn 釘住守門條件不被反轉/移除。
 */
export function confirmDelete(
  id: number,
  mutate: (args: { id: number }) => void,
  confirmFn: (msg: string) => boolean = (m) => window.confirm(m),
): void {
  if (confirmFn("確定刪除此連接？將一併刪除後端加密保存的憑證。")) {
    mutate({ id });
  }
}

/** lastHealthCheckAt ISO → 顯示字串（無效/缺值回 null，不渲染）。 */
export function healthCheckLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `上次健檢 ${d.toLocaleString()}`;
}

export function ConnectionsPanel() {
  const utils = trpc.useUtils();
  // projectId 省略＝個人層級連接（不綁特定專案）。publicShape：list 不含 credential。
  const q = trpc.dataConnections.list.useQuery({}, { retry: false, staleTime: 30_000 });

  const test = trpc.dataConnections.test.useMutation({
    onSuccess: () => { toast.success("已健檢連接"); utils.dataConnections.list.invalidate(); },
    onError: (e) => toast.error(e.message || "健檢失敗"),
  });
  const setStatus = trpc.dataConnections.setStatus.useMutation({
    onSuccess: () => { toast.success("已更新連接狀態"); utils.dataConnections.list.invalidate(); },
    onError: (e) => toast.error(e.message || "更新狀態失敗"),
  });
  // AIDV-148：曝露既有 delete 端點（AIDV-185 後端已含加密憑證一併刪除）。
  const del = trpc.dataConnections.delete.useMutation({
    onSuccess: () => { toast.success("已刪除連接（含加密憑證）"); utils.dataConnections.list.invalidate(); },
    onError: (e) => toast.error(e.message || "刪除連接失敗"),
  });

  const conns: any[] = Array.isArray(q.data) ? q.data : [];
  const byKind = (kind: string | null) => (kind ? conns.filter((c) => c.kind === kind) : []);
  const busy = test.isPending || setStatus.isPending || del.isPending;

  return (
    <div className="space-y-4">
      {/* 標題 + 個人資料庫說明 */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Plug className="h-4 w-4" />連接器 / 個人資料庫</div>
          <Badge variant="outline" className="text-[10px]">5 類來源 · 餵 contextPacket</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          連接你的外部資料來源（雲端 / 筆記 / MCP 工具）。連上後可被「整理資料來源」收進專案的允許上下文。
          憑證只送後端加密保存，本頁不顯示也不收金鑰。
        </p>
      </Card>

      {/* 四態：載入 / 錯誤 / 內容（每類內可空） */}
      {q.isLoading ? (
        <PanelLoading label="載入連接器…" />
      ) : q.isError ? (
        <PanelError message="讀取連接器失敗（需登入）。" onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <CategoryCard
              key={cat.id}
              cat={cat}
              connections={byKind(cat.kind)}
              busy={busy}
              onTest={(id) => test.mutate({ id })}
              onToggle={(id, next) => setStatus.mutate({ id, status: next })}
              onDelete={(id) => confirmDelete(id, (args) => del.mutate(args))}
            />
          ))}
        </div>
      )}

      {/* ACL 範圍：全站（團隊層級）規則唯讀總覽（project_data_access_rules 真資料） */}
      <AclOverviewSection />
    </div>
  );
}

/** 單一分類卡：有 kind＝列出既有連接（測試 / 啟停 / 刪除，真實接點）；無 kind 或待建項＝待接 pill。 */
export function CategoryCard({
  cat, connections, busy, onTest, onToggle, onDelete,
}: {
  cat: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; kind: string | null; auth: string; desc: string; pending: string | null };
  connections: any[];
  busy?: boolean;
  onTest: (id: number) => void;
  onToggle: (id: number, next: "active" | "disabled") => void;
  onDelete?: (id: number) => void;
}) {
  const Icon = cat.icon;
  const buildable = cat.kind != null;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" />{cat.label}</div>
        <Badge variant="outline" className="text-[10px] shrink-0">{cat.auth}</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">{cat.desc}</p>

      {/* 待建分類（本機 / 內部 10G）：整類標待接 */}
      {!buildable ? (
        <div className="flex items-center gap-2"><PendingPill text={cat.pending ?? "待建"} /></div>
      ) : connections.length === 0 ? (
        <PanelEmpty icon={<Plug className="h-5 w-5" />} title="尚未連接" hint="從建立流程連上後在此治理。" />
      ) : (
        <div className="space-y-2">
          {connections.map((c) => (
            <ConnectorRow
              key={c.id}
              name={providerLabel(c.provider)}
              status={c.status}
              lastHealthCheckAt={c.lastHealthCheckAt}
              busy={busy}
              onTest={() => onTest(c.id)}
              onToggle={() => onToggle(c.id, isHealthy(c.status) ? "disabled" : "active")}
              onDelete={onDelete ? () => onDelete(c.id) : undefined}
            />
          ))}
        </div>
      )}

      {/* mcp 類的 BYOMCP 權限/稽核待建 */}
      {cat.pending && buildable && (
        <div className="flex items-center gap-2 pt-1"><PendingPill text={cat.pending} /></div>
      )}

      {/* 新增連接：OAuth / credential 走既有建立流程（本頁不收金鑰）→ 標待接 */}
      {buildable && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" />新增連接於建立流程進行（不在此收金鑰）
        </div>
      )}
    </Card>
  );
}

/** 連接器列：旗標 ON＝design-kit ProviderOption（圓點＝健康/故障）＋四值狀態 Pill（greenfield 精華）；
 *  OFF＝既有列。測試/啟停/刪除、上次健檢時間兩版皆在。 */
export function ConnectorRow({
  name, status, lastHealthCheckAt, busy, onTest, onToggle, onDelete,
}: {
  name: string; status?: string; lastHealthCheckAt?: string | null; busy?: boolean;
  onTest: () => void; onToggle: () => void; onDelete?: () => void;
}) {
  const healthy = isHealthy(status);
  const checkedAt = healthCheckLabel(lastHealthCheckAt);
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="flex-1"><ProviderOption name={name} status={healthy ? "ok" : "down"} onTest={onTest} /></div>
            <Pill kind={statusPillKind(status)} dot>{connectionStatusLabel(status ?? "pending")}</Pill>
            <button type="button" disabled={busy} onClick={onToggle} className="rounded-[8px] border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)] disabled:opacity-50">
              {healthy ? "停用" : "啟用"}
            </button>
            {onDelete && (
              <button type="button" aria-label={`刪除連接 ${name}`} disabled={busy} onClick={onDelete} className="rounded-[8px] border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)] disabled:opacity-50">
                <Trash2 aria-hidden className="h-3 w-3" />
              </button>
            )}
          </div>
          {checkedAt && <div className="pl-1 text-[10px] text-[var(--muted-2)]" title={lastHealthCheckAt ?? undefined}>{checkedAt}</div>}
        </div>
      </AidvKit>
    );
  }
  return (
    <div className="rounded-lg border p-2.5 space-y-1">
      <div className="flex items-center gap-2">
        <span
          role="img"
          aria-label={connectionStatusLabel(status ?? "pending")}
          className={`size-2 rounded-full shrink-0 ${healthy ? "bg-ok" : "bg-muted-foreground"}`}
        />
        <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
        <Badge variant={healthy ? "secondary" : "outline"} className="text-[10px]">{connectionStatusLabel(status ?? "pending")}</Badge>
        <button type="button" disabled={busy} onClick={onTest} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50">測試</button>
        <button type="button" disabled={busy} onClick={onToggle} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50">{healthy ? "停用" : "啟用"}</button>
        {onDelete && (
          <button type="button" aria-label={`刪除連接 ${name}`} disabled={busy} onClick={onDelete} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50">刪除</button>
        )}
        {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      {checkedAt && <div className="pl-4 text-[10px] text-muted-foreground/80" title={lastHealthCheckAt ?? undefined}>{checkedAt}</div>}
    </div>
  );
}

/** 待接標示：旗標 ON＝design-kit Pill（mute）；OFF＝既有 Badge。文案一致。 */
export function PendingPill({ text }: { text: string }) {
  if (ENABLE_AIDV_CHROME) {
    return <AidvKit><Pill kind="mute" dot>{text}</Pill></AidvKit>;
  }
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">待接 · {text}</Badge>;
}

// ============================================================================
// ACL 存取範圍（AIDV-148：接 project_data_access_rules 真資料 · 唯讀總覽）
// ----------------------------------------------------------------------------
// 容器（AclOverviewSection）查 teams.list ＋ teamData.listProjectAccessRules
// （projectId:null＝團隊層級規則，後端 IS NULL 過濾；任一成員可讀）。
// 展示（AclRulesSummary）純 props、離線可測。編輯續留建立流程（後端強制 owner/admin）。
// ============================================================================

/** teamData.listProjectAccessRules 回傳列（前端消費子集）。 */
export interface AclRuleLike {
  id: number;
  materialId: number | null;
  connectionId: number | null;
  accessLevel: string;
}

/** ACL 規則唯讀摘要（純展示，mock 可驗）：團隊預設 / 連接級 / 素材級。 */
export function AclRulesSummary({ rules }: { rules: AclRuleLike[] }) {
  const teamDefault = rules.find((r) => r.materialId == null && r.connectionId == null);
  const connectionRules = rules.filter((r) => r.connectionId != null);
  const materialRules = rules.filter((r) => r.materialId != null);
  if (rules.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        此團隊尚未設定全站（團隊層級）規則；專案級規則於建立流程的「資料存取規則」維護。
      </p>
    );
  }
  return (
    <ul className="space-y-1.5" aria-label="全站資料存取規則">
      <li className="flex items-center gap-2 text-xs">
        <span className="w-28 shrink-0 text-muted-foreground">團隊預設層級</span>
        <Badge variant="secondary" className="text-[10px]">
          {accessLevelLabel(teamDefault?.accessLevel ?? "summary_only")}
        </Badge>
        {!teamDefault && <span className="text-[10px] text-muted-foreground">（未設定，沿用預設）</span>}
      </li>
      {connectionRules.map((r) => (
        <li key={r.id} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-muted-foreground" title={`連接 #${r.connectionId}`}>連接 #{r.connectionId}</span>
          <Badge variant="outline" className="text-[10px]">{accessLevelLabel(r.accessLevel)}</Badge>
        </li>
      ))}
      {materialRules.length > 0 && (
        <li className="text-[11px] text-muted-foreground">
          另有 {materialRules.length} 條素材級規則（於建立流程維護）。
        </li>
      )}
    </ul>
  );
}

/** ACL 總覽容器：選團隊 → 讀團隊層級規則（唯讀；四態齊備）。無團隊＝中性提示。 */
export function AclOverviewSection() {
  const teamsQuery = trpc.teams.list.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const teams: { id: number; name: string; role?: string }[] = teamsQuery.data ?? [];
  const [teamId, setTeamId] = useState<number | null>(null);
  const effectiveTeamId = teamId ?? teams[0]?.id ?? null;
  const currentTeam = useMemo(
    () => teams.find((t) => t.id === effectiveTeamId) ?? null,
    [teams, effectiveTeamId],
  );

  const rulesQuery = trpc.teamData.listProjectAccessRules.useQuery(
    { teamId: effectiveTeamId as number, projectId: null },
    { enabled: effectiveTeamId != null, retry: false, staleTime: 30_000 },
  );

  return (
    <Card className="p-5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />存取範圍 ACL</div>
        <Badge variant="outline" className="text-[10px]">唯讀 · 編輯於建立流程</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        連接器可依「專案 / 團隊」範圍化存取（project_data_access_rules）。此處為全站（團隊層級）
        規則總覽；規則編輯於建立流程的「資料存取規則」面板（後端強制 owner / admin）。
      </p>

      {teamsQuery.isLoading ? (
        <PanelLoading count={2} label="載入團隊…" />
      ) : teamsQuery.isError ? (
        <PanelError message="讀取團隊失敗（需登入）。" onRetry={() => teamsQuery.refetch()} />
      ) : teams.length === 0 ? (
        <p className="text-xs text-muted-foreground" role="status">尚無團隊（個人使用免設 ACL；建立團隊後可在此檢視規則）。</p>
      ) : (
        <div className="space-y-2">
          {teams.length > 1 && (
            <Select
              value={effectiveTeamId != null ? String(effectiveTeamId) : undefined}
              onValueChange={(v) => setTeamId(Number(v))}
            >
              <SelectTrigger className="h-7 w-full text-[12px]" aria-label="選擇團隊">
                <SelectValue placeholder="選擇團隊" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)} className="text-[12px]">
                    {t.name}{t.role ? `（${t.role}）` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {currentTeam && teams.length === 1 && (
            <p className="text-[11px] text-muted-foreground">團隊：{currentTeam.name}</p>
          )}
          {rulesQuery.isLoading ? (
            <PanelLoading count={2} className="h-6 rounded" label="載入規則…" />
          ) : rulesQuery.isError ? (
            <PanelError message="讀取存取規則失敗。" onRetry={() => rulesQuery.refetch()} />
          ) : (
            <AclRulesSummary rules={(rulesQuery.data ?? []) as AclRuleLike[]} />
          )}
        </div>
      )}
    </Card>
  );
}

export default ConnectionsPanel;
