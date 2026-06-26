/**
 * orbChatProgress.coverage.test.ts
 *
 * 守住「OrbChatProgressStage 宣告的每個 stage,server 端 router 都實際
 * 會呼 emitOrbChatProgress」這條不變式。
 *
 * 上一輪有兩個 stage(`researching_web` 與 `calling_specialist`)被宣
 * 告、UI 端 OrbThinkingTimeline 有對應 emoji,但 server router 從來沒
 * 發 — 結果是使用者跑 web research 或精靈 hand-off 時,時間軸完全
 * 跳過那兩段,看起來像「卡住沒事在做」。
 *
 * 用 source-text 掃描把這條規則升級成測試:每個宣告的 stage 至少要在
 * routers.ts 出現一次 emitOrbChatProgress(_, "<stage>", ...) 呼叫。
 * (寫成 source 掃描而非整合測,因為整個 ai.chat handler 需要 DB / auth /
 * LLM / Pages,在純 unit 環境跑不起來。)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  emitOrbChatProgress,
  readOrbChatProgress,
  __unsafe_resetOrbChatProgressForTests,
  type OrbChatProgressStage,
} from "../orbChatProgress";

const ALL_STAGES: OrbChatProgressStage[] = [
  "received",
  "sanitizing",
  "guarding_attachments",
  "extracting_pdf",
  "selecting_provider",
  "researching_web",
  "planning",
  "calling_specialist",
  "materializing_task",
  "executing_tool",
  "finalizing",
  "error",
];

describe("OrbChatProgressStage 與 router 同步", () => {
  const repoRoot = path.resolve(__dirname, "../../..");
  // ai.chat handler was extracted to server/routers/ai.ts; emitOrbChatProgress
  // calls live there, not in the top-level routers.ts aggregator.
  const routersSrc = readFileSync(
    path.join(repoRoot, "server/routers/ai.ts"),
    "utf8"
  );

  it.each(ALL_STAGES)(
    'router 至少有一處 emit("%s", ...) 呼叫',
    stage => {
      // 接受 emitOrbChatProgress(<id>, "stage", ...) 的所有變體
      const pattern = new RegExp(
        `emitOrbChatProgress\\s*\\(\\s*[A-Za-z_][A-Za-z0-9_]*\\s*,\\s*"${stage}"`
      );
      expect(routersSrc).toMatch(pattern);
    }
  );
});

describe("orbChatProgress runtime", () => {
  it("emit + read 對得上、seq 單調遞增", () => {
    __unsafe_resetOrbChatProgressForTests();
    const reqId = "req-test-1";
    emitOrbChatProgress(reqId, "received", "收到請求");
    emitOrbChatProgress(reqId, "researching_web", "搜尋網路中…");
    emitOrbChatProgress(reqId, "calling_specialist", "召喚 圖圖", {
      role: "image-specialist",
    });
    const events = readOrbChatProgress(reqId, 0);
    expect(events).toHaveLength(3);
    expect(events.map(e => e.stage)).toEqual([
      "received",
      "researching_web",
      "calling_specialist",
    ]);
    expect(events.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(events[2].detail).toEqual({ role: "image-specialist" });
  });

  it("emit 接受所有宣告的 stage(編譯期 + runtime 都不報錯)", () => {
    __unsafe_resetOrbChatProgressForTests();
    const reqId = "req-test-2";
    for (const stage of ALL_STAGES) {
      emitOrbChatProgress(reqId, stage, `label-${stage}`);
    }
    const events = readOrbChatProgress(reqId, 0);
    expect(events.map(e => e.stage)).toEqual(ALL_STAGES);
  });

  it("requestId 為空時 silent no-op,不丟", () => {
    expect(() =>
      emitOrbChatProgress(undefined, "received", "x")
    ).not.toThrow();
    expect(() => emitOrbChatProgress(null, "received", "x")).not.toThrow();
    expect(() => emitOrbChatProgress("", "received", "x")).not.toThrow();
  });
});
