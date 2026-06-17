/* AI Director · 連接器／個人資料庫 5 類治理面板（/settings/connections＋ACL＋BYOMCP）
   ----------------------------------------------------------------------------
   AIDV-115 / U-12 · Wave U 視覺實裝。
   · 連接器卡（狀態 dot＝connected/disconnected/error）、5 類治理分組、
     ACL 權限列（角色＋可見性 Toggle）、健康狀態 Pill。
   · 全走 design-kit primitives（Button/Pill/Toggle/Card）＋四態
     （EmptyState/LoadingState/ErrorState/Skeleton），不寫死 hex（CSS 變數）。
   · 純前端唯讀 props（mock 離線可驗）；不接後端、零金鑰。
   · 元件須用在 <AidvKit> 內，token 才解析成設計套件原義。
   · a11y：lucide-react SVG、icon-only aria-label、焦點環、動效尊重 reduced-motion。
   rev. U-12 · 2026-06-17 */
import * as React from "react";
import {
  Cpu,
  Database,
  Plug,
  Server,
  Lock,
  Wifi,
  WifiOff,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { AidvKit } from "../design-kit/AidvKit";
import { Card, Pill, Toggle } from "../design-kit/primitives";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Skeleton,
} from "../design-kit/states";
import {
  type Connector,
  type ConnectorCategory,
  type ConnectorHealth,
  type ConnectorStatus,
  type AclEntry,
  CATEGORY_META,
  CATEGORY_ORDER,
  HEALTH_LABEL,
  ROLE_LABEL,
} from "./connectorsTypes";
import { CONNECTORS_BYOMCP_ENABLED } from "./connectorsFlags";

/* ---------------- 對應表（純樣式 token，不寫死 hex） ---------------- */

const CATEGORY_ICON: Record<ConnectorCategory, LucideIcon> = {
  model: Cpu,
  storage: Database,
  source: Plug,
  byomcp: Server,
  vault: Lock,
};

/** 狀態 dot 顏色（走 CSS 變數）＋無障礙文字。 */
const STATUS_META: Record<
  ConnectorStatus,
  { color: string; label: string; Icon: LucideIcon }
> = {
  connected: { color: "var(--ok)", label: "已連線", Icon: Wifi },
  disconnected: { color: "var(--muted-2)", label: "未連線", Icon: WifiOff },
  error: { color: "var(--bad)", label: "連線錯誤", Icon: AlertTriangle },
};

/** 健康 Pill 種類映射（沿用 design-kit Pill kind）。 */
const HEALTH_PILL: Record<ConnectorHealth, "ok" | "warn" | "bad" | "mute"> = {
  healthy: "ok",
  degraded: "warn",
  down: "bad",
  unknown: "mute",
};

/* ---------------- 狀態 dot ---------------- */

function StatusDot({ status }: { status: ConnectorStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      role="img"
      aria-label={m.label}
      title={m.label}
      className="inline-flex h-[10px] w-[10px] flex-none rounded-full ring-2 ring-[var(--surface)]"
      style={{ background: m.color }}
    />
  );
}

/* ---------------- ACL 權限列（角色＋可見性 Toggle） ---------------- */

export function AclRow({
  connectorName,
  entry,
  onToggle,
}: {
  connectorName: string;
  entry: AclEntry;
  onToggle?: (role: AclEntry["role"], next: boolean) => void;
}) {
  const roleLabel = ROLE_LABEL[entry.role];
  return (
    <div className="flex items-center justify-between gap-3 py-[6px]">
      <span className="text-[12.5px] text-[var(--text-soft)]">{roleLabel}</span>
      <Toggle
        on={entry.visible}
        label={`${connectorName} · ${roleLabel} 可見性`}
        onClick={() => onToggle?.(entry.role, !entry.visible)}
      />
    </div>
  );
}

/* ---------------- 連接器卡 ---------------- */

export function ConnectorCard({
  connector,
  onToggleAcl,
}: {
  connector: Connector;
  onToggleAcl?: (
    connectorId: string,
    role: AclEntry["role"],
    next: boolean,
  ) => void;
}) {
  const status = STATUS_META[connector.status];
  return (
    <Card
      pad
      hover
      role="group"
      aria-label={`連接器 ${connector.name}`}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <StatusDot status={connector.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-[var(--text)]">
              {connector.name}
            </span>
            <status.Icon
              aria-hidden
              size={13}
              className="flex-none text-[var(--muted)]"
            />
          </div>
          {connector.detail && (
            <div className="mt-[2px] truncate text-[12px] text-[var(--muted)]">
              {connector.detail}
            </div>
          )}
        </div>
        <Pill kind={HEALTH_PILL[connector.health]} dot>
          {HEALTH_LABEL[connector.health]}
        </Pill>
      </div>

      <div className="border-t border-dashed border-[var(--line)] pt-2">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[.18em] text-[var(--muted-2)]">
          ACL · 角色可見性
        </div>
        <div className="divide-y divide-[var(--hair)]">
          {connector.acl.map((entry) => (
            <AclRow
              key={entry.role}
              connectorName={connector.name}
              entry={entry}
              onToggle={(role, next) => onToggleAcl?.(connector.id, role, next)}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ---------------- 治理分組（5 類其一） ---------------- */

function CategoryGroup({
  category,
  connectors,
  onToggleAcl,
}: {
  category: ConnectorCategory;
  connectors: Connector[];
  onToggleAcl?: ConnectorCardOnToggle;
}) {
  const meta = CATEGORY_META[category];
  const Icon = CATEGORY_ICON[category];
  return (
    <section aria-label={`治理分組 ${meta.label}`} className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <span className="flex size-7 flex-none items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] text-[var(--clay)]">
          <Icon aria-hidden size={15} />
        </span>
        <h3 className="text-[13px] font-semibold text-[var(--text)]">
          {meta.label}
        </h3>
        <span className="font-mono text-[11px] text-[var(--muted-2)]">
          {connectors.length}
        </span>
      </header>
      {connectors.length === 0 ? (
        <Card pad className="text-[12px] text-[var(--muted)]">
          此分組尚無連接器
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {connectors.map((c) => (
            <ConnectorCard key={c.id} connector={c} onToggleAcl={onToggleAcl} />
          ))}
        </div>
      )}
    </section>
  );
}

type ConnectorCardOnToggle = (
  connectorId: string,
  role: AclEntry["role"],
  next: boolean,
) => void;

/* ---------------- 主面板（四態出口齊備） ---------------- */

export interface ConnectorsPanelProps {
  /** 唯讀連接器清單（mock 離線可驗）。 */
  connectors?: Connector[];
  /** 四態：loading / error 由殼層傳入決定出口。 */
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** ACL Toggle 唯讀回呼（純視覺，不寫後端）。 */
  onToggleAcl?: ConnectorCardOnToggle;
  /** 空態主要動作（如：新增連接器）。 */
  onAddConnector?: () => void;
}

/** /settings/connections 連接器治理面板（已自帶 <AidvKit> scope）。 */
export function ConnectorsPanel({
  connectors,
  loading = false,
  error = null,
  onRetry,
  onToggleAcl,
  onAddConnector,
}: ConnectorsPanelProps) {
  // 四態出口（依序）：載入 → 錯誤 → 空 → 內容。
  const body = (() => {
    if (loading) {
      return (
        <div aria-label="載入連接器中">
          <LoadingState label="載入連接器治理面板…" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} h={120} rounded={16} />
            ))}
          </div>
        </div>
      );
    }
    if (error) {
      return <ErrorState message={error} onRetry={onRetry} />;
    }
    if (!connectors || connectors.length === 0) {
      return (
        <EmptyState
          icon={<Plug aria-hidden size={20} />}
          title="尚未連接任何服務"
          hint="連接模型供應商、儲存、資料源、BYOMCP 或個人資料庫以開始治理。"
          action={
            onAddConnector
              ? { label: "新增連接器", onClick: onAddConnector }
              : undefined
          }
        />
      );
    }

    // 依 5 類分組；BYOMCP 受旗標控制（預設 OFF＝隱藏，零回歸）。
    const visibleCategories = CATEGORY_ORDER.filter(
      (cat) => cat !== "byomcp" || CONNECTORS_BYOMCP_ENABLED,
    );
    return (
      <div className="flex flex-col gap-7">
        {visibleCategories.map((cat) => (
          <CategoryGroup
            key={cat}
            category={cat}
            connectors={connectors.filter((c) => c.category === cat)}
            onToggleAcl={onToggleAcl}
          />
        ))}
      </div>
    );
  })();

  return (
    <AidvKit as="section" aria-label="連接器治理面板" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="font-mono text-[10px] uppercase tracking-[.26em] text-[var(--clay)]">
          /settings/connections
        </div>
        <h2 className="text-[18px] font-semibold text-[var(--text)]">
          連接器 · 治理
        </h2>
        <p className="text-[12.5px] text-[var(--muted)]">
          5 類治理分組 · 連線狀態 · 健康 · ACL 角色可見性（唯讀視覺）
        </p>
      </header>
      {body}
    </AidvKit>
  );
}

export default ConnectorsPanel;
