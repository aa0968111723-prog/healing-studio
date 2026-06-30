// ============================================================================
// shells/video/panels/AssetsPanel.tsx — 數位資產庫（對映 digital_asset_library）
// ----------------------------------------------------------------------------
// 唯讀清單：生成回寫的資產（kind / 鏡號 / 模型 / 來源工作室 / provider / 成本 / 時間）。
// 每次 generateShot 成功會在脊椎 assets 前插一筆（樂觀），真實版同步走 generate.recordGenResult。
//
// AIDV-12（其餘可接子系統接真實 procedure）：
//   旗標 ENABLE_SUBSYSTEM_REAL_DATA OFF（預設）＝既有路徑＝讀脊椎本地 p.assets，位元相同。
//   旗標 ON ＝改以**已存在**的 assets.myAssets（唯讀 digital_asset_library）直連真實資產；
//     四態鐵律：載入中／錯誤一律回退既有脊椎本地集合（additive，不刪既有 fallback）。
// ============================================================================
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import type { AssetRow } from "@/spine/types";
// U-5（AIDV-95）/video S3 四態：空態改用共用 Empty（→ PanelEmpty，旗標 ON 時為 design-kit
// 亮色暖光 EmptyState），與 Shot/Character/Scene 面板一致；座艙在 ENABLE_4SHELL（預設 OFF）之下＝線上零變化。
import { Empty } from "./ShotPanel";
// AIDV-12：旗標 ON 才走真實 procedure；trpc useQuery 與既有面板（AgentCatalog/FlowTv）同型樣。
import { trpc } from "@/lib/trpc";
import { ENABLE_SUBSYSTEM_REAL_DATA } from "@/config/videoFlags";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";

function assetIcon(kind: AssetRow["kind"]) {
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  return "🖼";
}

/** server assetType（image|video|audio|voice|script|zip_bundle）→ 脊椎 GenKind（image|video|audio|keyframe）。 */
function toKind(assetType: unknown): AssetRow["kind"] {
  if (assetType === "video") return "video";
  if (assetType === "audio" || assetType === "voice") return "audio";
  return "image"; // image / script / zip_bundle / 其它 → 以 image 圖示佔位
}

/** digital_asset_library row（assets.myAssets）→ 脊椎 AssetRow（純展示映射；缺欄給安全預設）。 */
function rowToAsset(a: Record<string, unknown>): AssetRow {
  return {
    id: String(a.id ?? ""),
    kind: toKind(a.assetType),
    // 真實表無「鏡號」欄；以資產標題佔位，維持列首主標可讀（純展示）。
    shotNo: typeof a.title === "string" ? a.title : undefined,
    provider: (a.provider as AssetRow["provider"]) ?? "hf",
    modelId: String(a.modelId ?? ""),
    sourceStudio: String(a.sourceStudio ?? "unknown"),
    costUsd: 0, // digital_asset_library 不存單筆成本（成本在生成任務側）；展示為 0。
    ts: a.createdAt ? new Date(a.createdAt as string | number).toLocaleDateString() : "",
  };
}

/** 純展示：資產列（空集合 → 共用 Empty）。OFF 路徑與 ON 就緒態共用，確保渲染一致。 */
function AssetList({ assets }: { assets: AssetRow[] }) {
  if (assets.length === 0) {
    return <Empty icon="🗂" title="尚無資產" desc="生成或上傳後，產出會自動回寫到這裡。" />;
  }
  return (
    <div className="space-y-2">
      {assets.map((a) => (
        <div key={a.id} className="flex items-center gap-2 rounded-xl border p-2.5">
          <span className="text-lg leading-none">{assetIcon(a.kind)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{a.shotNo || a.kind} · {a.modelId}</div>
            <div className="text-[10px] text-muted-foreground">{a.sourceStudio} · {a.provider} · ${a.costUsd}</div>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{a.ts}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 旗標 ON：真實資產庫（assets.myAssets）。載入中／錯誤一律回退既有脊椎本地集合（fallback），
 * 不讓查詢失敗變成「假空白」；就緒態以真實列覆蓋。
 */
function RealAssetsBody({ fallback }: { fallback: AssetRow[] }) {
  const q = trpc.assets.myAssets.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  if (q.isLoading) {
    // 既有脊椎已有本地集合 → 直接顯示（避免閃 skeleton）；無則顯示載入骨架。
    return fallback.length > 0 ? <AssetList assets={fallback} /> : <PanelLoading count={4} className="h-14 rounded-xl" label="讀取數位資產庫…" />;
  }
  if (q.isError) {
    // 錯誤：回退既有脊椎集合（additive 保留現狀）；空時給可重試的錯誤態。
    return fallback.length > 0 ? (
      <AssetList assets={fallback} />
    ) : (
      <PanelError message="資產庫讀取失敗（assets.myAssets）。" onRetry={() => void q.refetch()} />
    );
  }
  const rows = (q.data?.items ?? []).map(rowToAsset);
  return <AssetList assets={rows} />;
}

export function AssetsPanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  // 旗標 OFF（預設）＝既有路徑：讀脊椎本地 p.assets（位元相同）。
  if (!ENABLE_SUBSYSTEM_REAL_DATA) {
    return <AssetList assets={p.assets} />;
  }
  // 旗標 ON：真實 procedure，載入中／錯誤回退脊椎本地集合。
  return <RealAssetsBody fallback={p.assets} />;
}

export default AssetsPanel;
