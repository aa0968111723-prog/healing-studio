// ============================================================================
// shells/settings/StatusPill.tsx — 任務狀態徽章（U-2 / AIDV-92 逐殼採用 · /settings）
// ----------------------------------------------------------------------------
// 旗標 ON 時用 design-kit 亮色暖光 Pill（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；
// OFF（預設）＝既有 shadcn Badge＝線上零變化。狀態文字原樣顯示，不改判讀。
// 由 ObservabilityPanel（背景任務）與 DataRepairTab（卡住/失敗任務）共用，避免重複映射。
// ============================================================================
import { Badge } from "@/components/ui/badge";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, Pill } from "@/components/design-kit";

type PillKind = "ok" | "warn" | "bad" | "mute";
type BadgeVariant = "secondary" | "destructive" | "outline";

/** 任務狀態 → (Pill kind, Badge variant)。未知狀態落 mute/outline。 */
function mapStatus(status: string): { kind: PillKind; variant: BadgeVariant } {
  const s = status.toLowerCase();
  if (s === "done" || s === "completed" || s === "success") return { kind: "ok", variant: "secondary" };
  if (s === "failed" || s === "error") return { kind: "bad", variant: "destructive" };
  if (s === "running" || s === "queued" || s === "pending" || s === "processing") return { kind: "warn", variant: "outline" };
  return { kind: "mute", variant: "outline" };
}

/** 任務狀態徽章：旗標 ON→design-kit Pill（帶 dot）；OFF→既有 shadcn Badge。狀態文字原樣保留。 */
export function StatusPill({ status }: { status: React.ReactNode }) {
  const text = status == null || status === "" ? "—" : String(status);
  const { kind, variant } = mapStatus(text);
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <Pill kind={kind} dot>{text}</Pill>
      </AidvKit>
    );
  }
  return <Badge variant={variant} className="text-[10px]">{text}</Badge>;
}

export default StatusPill;
