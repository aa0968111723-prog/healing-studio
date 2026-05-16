// @vitest-environment jsdom
/**
 * tests/unit/client/orb-thinking-timeline.test.tsx
 *
 * 真實可用性測試:模擬 server emit → client read → UI render 的完整路徑。
 * 確認 11 個宣告 stage 都能在使用者眼前正確顯示 emoji + label,而不是
 * 只有 unit test 過、UI 渲染時 fallback 成 "·"。
 *
 * 上游(server)的 emit coverage 由
 * `server/services/__tests__/orbChatProgress.coverage.test.ts` 守住。
 * 下游(client)的渲染由本檔守住。兩端對得上才算真正可用。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrbThinkingTimeline } from "@/components/orb/OrbThinkingTimeline";
import type { OrbChatProgressEvent } from "@/contexts/GlobalOrbChatContext";

const ALL_STAGES: OrbChatProgressEvent["stage"][] = [
  "received",
  "sanitizing",
  "guarding_attachments",
  "extracting_pdf",
  "selecting_provider",
  "researching_web",
  "planning",
  "calling_specialist",
  "materializing_task",
  "finalizing",
  "error",
];

const STAGE_LABEL: Record<OrbChatProgressEvent["stage"], string> = {
  received: "收到請求",
  sanitizing: "檢查訊息中…",
  guarding_attachments: "檢查附件中…",
  extracting_pdf: "讀取 PDF 內文中…",
  selecting_provider: "選擇模型中…",
  researching_web: "搜尋網路中…",
  planning: "規劃步驟中…",
  calling_specialist: "召喚 圖圖",
  materializing_task: "整理任務步驟…",
  finalizing: "整理回應…",
  error: "發生錯誤…",
};

const EXPECTED_EMOJI: Record<OrbChatProgressEvent["stage"], string> = {
  received: "🌟",
  sanitizing: "🧹",
  guarding_attachments: "📎",
  extracting_pdf: "📄",
  selecting_provider: "🧭",
  researching_web: "🔍",
  planning: "🧠",
  calling_specialist: "🎨",
  materializing_task: "📋",
  finalizing: "✨",
  error: "⚠️",
};

function buildEvent(
  seq: number,
  stage: OrbChatProgressEvent["stage"]
): OrbChatProgressEvent {
  return { seq, at: Date.now(), stage, label: STAGE_LABEL[stage] };
}

describe("OrbThinkingTimeline 端到端渲染", () => {
  it("空事件時顯示 fallback「光球思考中…」", () => {
    render(<OrbThinkingTimeline events={[]} />);
    expect(screen.getByText("光球思考中…")).toBeTruthy();
  });

  it("至多顯示最近 6 個事件(避免長 trace 蓋掉聊天視窗)", () => {
    const events = ALL_STAGES.map((s, i) => buildEvent(i + 1, s));
    expect(events.length).toBeGreaterThan(6);
    render(<OrbThinkingTimeline events={events} reduceMotion />);
    // 「收到請求」是第 1 個 stage,被截在 6-event 視窗外、不應渲染
    expect(screen.queryAllByText("收到請求")).toHaveLength(0);
    // 最後 6 個 stage 必須都看得到 — 這正是 ai 代理修復後新增的
    // researching_web、calling_specialist 等的可見性保證
    const visible = events.slice(-6);
    for (const ev of visible) {
      expect(screen.getAllByText(ev.label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it.each(ALL_STAGES)(
    "stage=%s 渲染對應 emoji + label,不退化成 fallback ·",
    stage => {
      const event = buildEvent(1, stage);
      const { container } = render(
        <OrbThinkingTimeline events={[event]} reduceMotion />
      );
      expect(screen.getAllByText(STAGE_LABEL[stage]).length).toBeGreaterThanOrEqual(1);
      // emoji 在獨立 span 裡,用 textContent 抓
      const emojiNodes = Array.from(
        container.querySelectorAll('span[aria-hidden="true"]')
      ).map(el => el.textContent?.trim());
      expect(emojiNodes).toContain(EXPECTED_EMOJI[stage]);
      expect(emojiNodes).not.toContain("·"); // fallback 不該觸發
    }
  );

  it("calling_specialist 帶 detail 時 label 仍正確顯示「召喚 X」", () => {
    // 模擬 server emit「召喚 圖圖 → 編編 → 品品」這種團隊鏈
    const event: OrbChatProgressEvent = {
      seq: 1,
      at: Date.now(),
      stage: "calling_specialist",
      label: "召喚 圖圖 → 編編 → 品品",
      detail: { role: "image-specialist", confidence: 0.85, teamSize: 3 },
    };
    render(<OrbThinkingTimeline events={[event]} reduceMotion />);
    expect(
      screen.getAllByText("召喚 圖圖 → 編編 → 品品").length
    ).toBeGreaterThanOrEqual(1);
  });

  it("researching_web 帶 intent reason detail 時 label 顯示「搜尋網路中…」", () => {
    const event: OrbChatProgressEvent = {
      seq: 1,
      at: Date.now(),
      stage: "researching_web",
      label: "搜尋網路中…",
      detail: { intent: "matched:explicit_search", explicit: true },
    };
    render(<OrbThinkingTimeline events={[event]} reduceMotion />);
    expect(screen.getAllByText("搜尋網路中…").length).toBeGreaterThanOrEqual(1);
  });
});
