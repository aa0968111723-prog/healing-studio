// ============================================================================
// shells/video/DirectorConsole.tsx — Wave 0 三欄導演台（重構後 /video 首頁）
// ----------------------------------------------------------------------------
// 左 Story Spine（專案→場景→鏡頭 S0X→任務樹）｜中 創作畫布（模式驅動）｜右 Context Sidecar
//（Context Packet / 確認門 / 成本 / 版本 diff / 評論）。頂部 CreationFlowBar＝一體成形主軸＋
// 常駐確認門/成本儀表。光球 Ambient Copilot 四態浮於右下。抽屜（提示詞庫/遊樂場/工作流/設定）
// 以 split-view 疊層、不整頁離場。所有資料/動作走既有脊椎與 adapter 接縫，flag-gated。
//
// 只在 ENABLE_4SHELL=ON ＋ ENABLE_VIDEO_COCKPIT=ON ＋ ENABLE_DIRECTOR_CONSOLE=ON 且專案非空時
// 由 VideoCockpit 掛載；OFF 任一 → 完全不可達（零行為改變保證）。
// ============================================================================
import { useState } from "react";
import { DirectorConsoleProvider, useDirectorConsole } from "./DirectorConsoleProvider";
import { CreationFlowBar } from "./console/CreationFlowBar";
import { CockpitColumns } from "./console/CockpitColumns";
import { StorySpineColumn } from "./console/StorySpineColumn";
import { CreationCanvas } from "./console/CreationCanvas";
import { ContextSidecar } from "./console/ContextSidecar";
import { AmbientOrb } from "./console/AmbientOrb";
import { ConsoleDrawers } from "./drawers/ConsoleDrawers";
import { GuidedJourney } from "./GuidedJourney";

export function DirectorConsole() {
  return (
    <DirectorConsoleProvider>
      <ConsoleInner />
    </DirectorConsoleProvider>
  );
}

function ConsoleInner() {
  const console_ = useDirectorConsole();
  const [guided, setGuided] = useState(false);

  return (
    <div className="space-y-4">
      <CreationFlowBar onGuided={() => setGuided(true)} />

      <CockpitColumns
        showSidecar={console_.showSidecar}
        spine={<StorySpineColumn onGuided={() => setGuided(true)} />}
        canvas={<CreationCanvas onGuided={() => setGuided(true)} />}
        context={<ContextSidecar />}
      />

      <AmbientOrb />
      <ConsoleDrawers />
      <GuidedJourney open={guided} onClose={() => setGuided(false)} />
    </div>
  );
}

export default DirectorConsole;
