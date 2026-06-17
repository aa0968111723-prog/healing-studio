// ============================================================================
// shells/settings/panels/ConnectionsPanel.tsx — U-12 連接器／個人資料庫治理（AIDV-115）
// ----------------------------------------------------------------------------
// /settings 第 6 籤「連接器」：把「個人資料來源」收進單一治理頁，餵 contextPacket 的允許來源。
// 真實接點（皆既有 protectedProcedure，零後端改動）：
//   dataConnections.list({projectId?})  → 列出使用者連接（不含 credential）            ✅
//   dataConnections.test({id})          → 健檢、更新 status                             ✅
//   dataConnections.setStatus({id,status}) → 啟用 / 停用                                ✅
// 5 類連接器：②Google雲端(cloud) ③Notion(notes) ④其他MCP(mcp) 走真實 list；
//   ①本機 ⑤內部10G、④的 BYOMCP 權限/稽核、以及「新增連接」(OAuth/credential 走既有建立流程，
//   本頁不收金鑰) 皆為待建 → 標「待接」pill（前端不造表、不寫真實金鑰）。
// design-kit：旗標 ON 時連接器列改用亮色暖光 ProviderOption（圓點＝健康/故障）；
//   OFF（預設，受 ENABLE_4SHELL 守門）＝既有卡片＝線上零變化。四態走共用 PanelState。
// ============================================================================
import { Plug, Cloud, FileText, HardDrive, Database, ShieldCheck, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { connectionStatusLabel, providerLabel } from "@/components/create/teamDataFormat";
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

  const conns: any[] = Array.isArray(q.data) ? q.data : [];
  const byKind = (kind: string | null) => (kind ? conns.filter((c) => c.kind === kind) : []);
  const busy = test.isPending || setStatus.isPending;

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
            />
          ))}
        </div>
      )}

      {/* ACL 範圍（Phase 1 唯讀摘要 + 待接） */}
      <Card className="p-5 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4" />存取範圍 ACL</div>
          <PendingPill text="全站編輯器待接" />
        </div>
        <p className="text-xs text-muted-foreground">
          連接器可依「專案 / 團隊」範圍化存取（project_data_access_rules）。專案級規則目前於建立流程內的
          「團隊資料 / 資料來源」面板維護；全站級總覽待接。
        </p>
      </Card>
    </div>
  );
}

/** 單一分類卡：有 kind＝列出既有連接（測試 / 啟停，真實接點）；無 kind 或待建項＝待接 pill。 */
export function CategoryCard({
  cat, connections, busy, onTest, onToggle,
}: {
  cat: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; kind: string | null; auth: string; desc: string; pending: string | null };
  connections: any[];
  busy?: boolean;
  onTest: (id: number) => void;
  onToggle: (id: number, next: "active" | "disabled") => void;
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
              busy={busy}
              onTest={() => onTest(c.id)}
              onToggle={() => onToggle(c.id, isHealthy(c.status) ? "disabled" : "active")}
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

/** 連接器列：旗標 ON＝design-kit ProviderOption（圓點＝健康/故障）；OFF＝既有列＝零變化。測試/啟停兩版皆在。 */
export function ConnectorRow({
  name, status, busy, onTest, onToggle,
}: {
  name: string; status?: string; busy?: boolean; onTest: () => void; onToggle: () => void;
}) {
  const healthy = isHealthy(status);
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <div className="flex items-center gap-1.5">
          <div className="flex-1"><ProviderOption name={name} status={healthy ? "ok" : "down"} onTest={onTest} /></div>
          <button type="button" disabled={busy} onClick={onToggle} className="rounded-[8px] border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)] disabled:opacity-50">
            {healthy ? "停用" : "啟用"}
          </button>
        </div>
      </AidvKit>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border p-2.5">
      <span className={`size-2 rounded-full shrink-0 ${healthy ? "bg-emerald-500" : "bg-muted-foreground"}`} />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <Badge variant={healthy ? "secondary" : "outline"} className="text-[10px]">{connectionStatusLabel(status ?? "pending")}</Badge>
      <button type="button" disabled={busy} onClick={onTest} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50">測試</button>
      <button type="button" disabled={busy} onClick={onToggle} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50">{healthy ? "停用" : "啟用"}</button>
      {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
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

export default ConnectionsPanel;
