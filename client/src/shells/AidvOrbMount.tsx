// ============================================================================
// shells/AidvOrbMount.tsx — U-11 OrbAssistant 真站掛載＋唯讀資料 adapter
//   （AIDV-114 第3片＝掛載；第4片＝唯讀 adapter）
// ----------------------------------------------------------------------------
// 把 design-kit 的新光球（OrbAssistant，亮色暖光「另一種型態」）掛進全站 chrome，
// 並以**唯讀**方式接既有前端 orb 狀態（不碰後端、不寫狀態）。
//
// 行為（Bruce 2026-06-16 拍板「可變舊光球的另一種型態·同時都可以存在」）：
//   - 由 DashboardLayout 以 `ENABLE_AIDV_CHROME` 旗標 gate；旗標 OFF（線上預設）
//     ＝本元件根本不掛＝線上零變化、舊 ProactiveOrbWidget 照舊。
//   - 旗標 ON 時新光球出現於左下，與舊光球（右下）並存。
//
// 唯讀 adapter（第4片）：
//   - 心情 mood ← `useOrbState()`（全站光球狀態廣播；provider-safe，無 provider 回 idle）。
//   - 本頁標籤 ← 目前路由（`useLocation`）。
//   - 主動泡泡文字 ← orb 狀態的 message（若有）。
//   仍**未寫任何狀態、未呼叫後端**；6 分頁的真實資料（提示詞庫/對話/積分/筆記）＝後續片。
// ============================================================================
import { useLocation } from "wouter";
import { useOrbState, type OrbState } from "@/contexts/OrbStateContext";
import { OrbAssistant, VIDEO_DEFAULT, type OrbMood } from "@/components/design-kit";

/** 全站光球活動狀態 → 新光球心情（純對應，可單測）。 */
export function orbStateToMood(s: OrbState): OrbMood {
  switch (s) {
    case "thinking":
    case "searching":
    case "listening":
      return "thinking";
    case "executing":
      return "working";
    case "success":
      return "done";
    case "idle":
    case "error":
    default:
      return "idle";
  }
}

const PAGE_LABELS: { prefix: string; label: string }[] = [
  { prefix: "/video", label: "影片工作室" },
  { prefix: "/social", label: "社群" },
  { prefix: "/learn", label: "學習" },
  { prefix: "/settings", label: "設定" },
  { prefix: "/agent", label: "導演對話" },
];

/** 路由路徑 → 友善本頁標籤（純對應，可單測）。 */
export function pathToPageLabel(path: string): string {
  const hit = PAGE_LABELS.find((p) => path === p.prefix || path.startsWith(`${p.prefix}/`));
  return hit?.label ?? "本頁";
}

/** 視覺走查用的靜態示範分頁內容（提示詞庫/對話/積分/筆記真實資料＝後續片）。 */
const DEMO_FLOW = { id: "f1", name: "成片工作流（示範）", steps: VIDEO_DEFAULT, current: 1 };

export function AidvOrbMount() {
  const orb = useOrbState();
  const [location] = useLocation();
  const mood = orbStateToMood(orb.state);
  const pageLabel = pathToPageLabel(location);

  const hints = [
    { id: "h1", icon: "💡", text: `你正在「${pageLabel}」——點上方分頁看本頁提示、提示詞庫與專注流。` },
    { id: "h2", icon: "✦", text: "光球心情已接全站狀態（待命／思考／工作／完成）；分頁資料為視覺示範，尚未接真實來源。" },
  ];

  return (
    <OrbAssistant
      position="bl"
      name="光球助手"
      persona="calm"
      mood={mood}
      proactive={{
        emoji: "✨",
        name: "光球助手",
        text: orb.message ?? "我在這裡——點開看本頁提示、提示詞庫與專注流。",
        level: "hint",
      }}
      pageContext={{ pageLabel, hints, flows: [DEMO_FLOW] }}
      promptVault={{ state: "empty" }}
    />
  );
}

export default AidvOrbMount;
