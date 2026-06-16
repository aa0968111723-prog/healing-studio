// ============================================================================
// shells/video/panels/AssetsPanel.tsx — 數位資產庫（對映 digital_asset_library）
// ----------------------------------------------------------------------------
// 唯讀清單：生成回寫的資產（kind / 鏡號 / 模型 / 來源工作室 / provider / 成本 / 時間）。
// 每次 generateShot 成功會在脊椎 assets 前插一筆（樂觀），真實版同步走 generate.recordGenResult。
// ============================================================================
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import type { AssetRow } from "@/spine/types";
// U-5（AIDV-95）/video S3 四態：空態改用共用 Empty（→ PanelEmpty，旗標 ON 時為 design-kit
// 亮色暖光 EmptyState），與 Shot/Character/Scene 面板一致；座艙在 ENABLE_4SHELL（預設 OFF）之下＝線上零變化。
import { Empty } from "./ShotPanel";

function assetIcon(kind: AssetRow["kind"]) {
  if (kind === "video") return "🎬";
  if (kind === "audio") return "🎵";
  return "🖼";
}

export function AssetsPanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  if (p.assets.length === 0) {
    return <Empty icon="🗂" title="尚無資產" desc="生成或上傳後，產出會自動回寫到這裡。" />;
  }
  return (
    <div className="space-y-2">
      {p.assets.map((a) => (
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

export default AssetsPanel;
