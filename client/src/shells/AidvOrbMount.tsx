// ============================================================================
// shells/AidvOrbMount.tsx — U-11 OrbAssistant 真站掛載＋資料 adapter
//   （AIDV-114 第3片＝掛載；第4片＝心情/本頁；第5片＝對話；第6片＝筆記；第7片＝提示詞庫/積分）
// ----------------------------------------------------------------------------
// 把 design-kit 的新光球（OrbAssistant，亮色暖光「另一種型態」）掛進全站 chrome，
// 並接既有資料源。由 DashboardLayout 以 `ENABLE_AIDV_CHROME` 旗標 gate；OFF（線上
// 預設）＝不掛＝線上零變化、舊 ProactiveOrbWidget 照舊；ON＝左下並存。
//
// 資料 adapter：
//   - 心情 mood ← `useOrbState()`（provider-safe）。
//   - 本頁標籤 ← `useLocation`。對話 ← `useGlobalOrbChat()`（唯讀）。
//   - 筆記 ← 既有 `open-notes-drawer` CustomEvent（純前端）。
//   - 提示詞庫 ← `trpc.promptLibrary.list`（唯讀查詢）。積分 ← `trpc.credits.myBalance`
//     （唯讀查詢）。兩者皆「碰後端讀取」，Bruce 2026-06-16 已拍板接入；唯讀、無新後端
//     邏輯、無 migration、仍旗標 OFF。
//
// 結構：`AidvOrbView`＝純呈現（props 驅動，可單測·不需 provider）；`AidvOrbMount`＝
// 容器（讀 hooks/tRPC → 餵 View）。
// ============================================================================
import { useLocation } from "wouter";
import { useOrbState, type OrbState } from "@/contexts/OrbStateContext";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { trpc } from "@/lib/trpc";
import {
  OrbAssistant, OrbChatTab, OrbPromptsTab, OrbCreditsTab, EmptyState, VIDEO_DEFAULT,
  type OrbChatMsg, type OrbMood, type OrbPromptItem,
} from "@/components/design-kit";

/* ─── 純對應（可單測）─────────────────────────────────────────────────────── */

/** 全站光球活動狀態 → 新光球心情。 */
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

/** 路由路徑 → 友善本頁標籤。 */
export function pathToPageLabel(path: string): string {
  const hit = PAGE_LABELS.find((p) => path === p.prefix || path.startsWith(`${p.prefix}/`));
  return hit?.label ?? "本頁";
}

/** 全站光球對話訊息（user/orb）→ 設計套件對話泡泡（取最近 N 筆）。 */
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

/** promptLibrary 資料列 → 提示詞分頁項目（title/content/useCount）。 */
export function toPromptItems(
  rows: { id: number | string; title: string; content: string; useCount?: number }[],
): OrbPromptItem[] {
  return rows.map((r) => ({ id: String(r.id), title: r.title, content: r.content, uses: r.useCount }));
}

/** tRPC 查詢狀態 → 分頁四態。 */
export function queryToTabState(
  q: { isLoading?: boolean; isError?: boolean; isEmpty?: boolean },
): "ready" | "loading" | "error" | "empty" {
  if (q.isError) return "error";
  if (q.isLoading) return "loading";
  if (q.isEmpty) return "empty";
  return "ready";
}

/* ─── 純呈現 View（props 驅動·可單測）──────────────────────────────────────── */

export interface AidvOrbViewProps {
  mood: OrbMood;
  pageLabel: string;
  chatMsgs: OrbChatMsg[];
  prompts: React.ComponentProps<typeof OrbPromptsTab>;
  credits: React.ComponentProps<typeof OrbCreditsTab>;
  onOpenNotes: () => void;
}

export function AidvOrbView({ mood, pageLabel, chatMsgs, prompts, credits, onOpenNotes }: AidvOrbViewProps) {
  const hints = [
    { id: "h1", icon: "💡", text: `你正在「${pageLabel}」——點上方分頁看本頁提示、提示詞庫與專注流。` },
    { id: "h2", icon: "✦", text: "心情/對話/提示詞庫/積分/筆記皆已接真實來源；本頁示範工作流仍為展示。" },
  ];
  return (
    <OrbAssistant
      position="bl"
      name="光球助手"
      persona="calm"
      mood={mood}
      proactive={{ emoji: "✨", name: "光球助手", text: "我在這裡——點開看本頁提示、提示詞庫與專注流。", level: "hint" }}
      pageContext={{ pageLabel, hints, flows: [{ id: "f1", name: "成片工作流（示範）", steps: VIDEO_DEFAULT, current: 1 }] }}
      tabContent={{
        chat: <OrbChatTab messages={chatMsgs} />,
        prompts: <OrbPromptsTab {...prompts} />,
        credits: <OrbCreditsTab {...credits} />,
        notes: (
          <EmptyState
            icon="📝"
            title="筆記在側邊抽屜裡"
            hint="點下方開啟筆記抽屜；在各處用「存到筆記」收藏的內容都會進到那裡。"
            action={{ label: "開啟筆記抽屜", onClick: onOpenNotes }}
          />
        ),
      }}
    />
  );
}

/* ─── 容器（讀 hooks/tRPC → 餵 View）────────────────────────────────────────── */

export function AidvOrbMount() {
  const orb = useOrbState();
  const chat = useGlobalOrbChat();
  const [location] = useLocation();

  // 唯讀查詢（碰後端讀取·Bruce 已拍板）。staleTime 降低重抓；不寫 DB、不扣款。
  const promptsQ = trpc.promptLibrary.list.useQuery(
    { page: 1, pageSize: 20 },
    { refetchOnWindowFocus: false, staleTime: 5 * 60_000 },
  );
  const creditsQ = trpc.credits.myBalance.useQuery(
    undefined,
    { refetchOnWindowFocus: false, staleTime: 5 * 60_000 },
  );

  const promptItems = toPromptItems(promptsQ.data?.items ?? []);
  const openNotesDrawer = () => {
    try {
      window.dispatchEvent(new CustomEvent("open-notes-drawer"));
    } catch {
      /* SSR / 無 window 安全略過 */
    }
  };

  return (
    <AidvOrbView
      mood={orbStateToMood(orb.state)}
      pageLabel={pathToPageLabel(location)}
      chatMsgs={toOrbChatMsgs(chat.messages ?? [])}
      prompts={{
        state: queryToTabState({ isLoading: promptsQ.isLoading, isError: promptsQ.isError, isEmpty: promptItems.length === 0 }),
        items: promptItems,
        onRetry: () => void promptsQ.refetch(),
      }}
      credits={{
        state: queryToTabState({ isLoading: creditsQ.isLoading, isError: creditsQ.isError }) as "ready" | "loading" | "error",
        remaining: creditsQ.data?.remaining,
        usedPct: creditsQ.data?.usedPct ?? 0,
        topModel: creditsQ.data?.topModel,
        onRetry: () => void creditsQ.refetch(),
      }}
      onOpenNotes={openNotesDrawer}
    />
  );
}

export default AidvOrbMount;
