// ============================================================================
// shells/AidvOrbMount.tsx — U-11 OrbAssistant 真站掛載（AIDV-114 第3片）
// ----------------------------------------------------------------------------
// 把 design-kit 的新光球（OrbAssistant，亮色暖光「另一種型態」）掛進全站 chrome。
//
// 行為（Bruce 2026-06-16 拍板「可變舊光球的另一種型態·同時都可以存在」）：
//   - 由 DashboardLayout 以 `ENABLE_AIDV_CHROME` 旗標 gate；**旗標 OFF（線上預設）
//     ＝本元件根本不掛＝線上零變化、舊 ProactiveOrbWidget 照舊**。
//   - 旗標 ON（走查 `?aidvchrome=1` 或部署 env）時新光球出現於**左下**，與舊光球
//     （右下）並存不互撞 → Bruce 可同時比對兩種型態。
//
// 本片＝**視覺實裝**：以靜態示範內容呈現新型態（情境提示／Flow 展示牆／提示詞庫空態
// ／主動泡泡），**尚未接 orb_* · spiritRouter · memoryManager**（資料 adapter＝後續片）。
// 純前端、零後端、可秒回滾。
// ============================================================================
import { OrbAssistant } from "@/components/design-kit";
import { VIDEO_DEFAULT } from "@/components/design-kit";

/** 視覺走查用的靜態示範內容（無 spine／無後端呼叫）。 */
const DEMO_PAGE = {
  pageLabel: "本頁",
  hints: [
    { id: "h1", icon: "💡", text: "這是新版光球助手的「另一種型態」——點上方分頁看本頁提示、提示詞庫與專注流。" },
    { id: "h2", icon: "✦", text: "目前為視覺走查（靜態示範），尚未接真實資料。" },
  ],
  flows: [
    { id: "f1", name: "成片工作流（示範）", steps: VIDEO_DEFAULT, current: 1 },
  ],
};

export function AidvOrbMount() {
  return (
    <OrbAssistant
      position="bl"
      name="光球助手"
      persona="calm"
      mood="idle"
      proactive={{ emoji: "✨", name: "光球助手", text: "我在這裡——點開看本頁提示、提示詞庫與專注流。", level: "hint" }}
      pageContext={DEMO_PAGE}
      promptVault={{ state: "empty" }}
    />
  );
}

export default AidvOrbMount;
