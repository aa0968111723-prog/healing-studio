// ============================================================================
// shells/AidvOrbMount.tsx — U-11 OrbAssistant 真站掛載＋唯讀資料 adapter
//   （AIDV-114 第3片＝掛載；第4片＝心情/本頁；第5片＝對話分頁；第6片＝筆記分頁開抽屜）
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
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { OrbAssistant, OrbChatTab, EmptyState, VIDEO_DEFAULT, type OrbChatMsg, type OrbMood } from "@/components/design-kit";

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

/** 全站光球對話訊息（user/orb）→ 設計套件對話泡泡（取最近 N 筆，純對應）。 */
export function toOrbChatMsgs(
  messages: { role: "user" | "orb"; text: string; at: number }[],
  limit = 20,
): OrbChatMsg[] {
  return messages.slice(-limit).map((m, i) => ({
    id: `${m.at}-${i}`,
    role: m.role === "user" ? "user" : "agent",
    text: m.text,
  }));
}

export function AidvOrbMount() {
  const orb = useOrbState();
  const chat = useGlobalOrbChat();
  const [location] = useLocation();
  const mood = orbStateToMood(orb.state);
  const pageLabel = pathToPageLabel(location);
  const chatMsgs = toOrbChatMsgs(chat.messages ?? []);

  // 筆記分頁：沿用既有「筆記抽屜」CustomEvent 契約（與舊光球同一條），純前端、零後端。
  const openNotesDrawer = () => {
    try {
      window.dispatchEvent(new CustomEvent("open-notes-drawer"));
    } catch {
      /* SSR / 無 window 安全略過 */
    }
  };

  const hints = [
    { id: "h1", icon: "💡", text: `你正在「${pageLabel}」——點上方分頁看本頁提示、提示詞庫與專注流。` },
    { id: "h2", icon: "✦", text: "心情接全站狀態、對話接近期往來、筆記可開抽屜；提示詞庫/積分需讀後端，待拍板後接。" },
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
      tabContent={{
        chat: <OrbChatTab messages={chatMsgs} />,
        notes: (
          <EmptyState
            icon="📝"
            title="筆記在側邊抽屜裡"
            hint="點下方開啟筆記抽屜；在各處用「存到筆記」收藏的內容都會進到那裡。"
            action={{ label: "開啟筆記抽屜", onClick: openNotesDrawer }}
          />
        ),
        credits: (
          <EmptyState
            icon="◈"
            title="積分餘額待接"
            hint="積分餘額需讀後端（credits），屬碰後端讀取——待 Bruce 拍板後接（同提示詞庫）。"
          />
        ),
      }}
    />
  );
}

export default AidvOrbMount;
