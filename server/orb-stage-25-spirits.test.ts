import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// 首頁光球創作劇場（OrbCreationStage）必須覆蓋全 25 位精靈，且每位精靈在
// scenario.spirits 中至少被引用一次 — 否則就是 demo 沒真實模擬「25 精靈 +
// 影像創作室」的全站光球互動，跟 shared/spiritsVisual.ts 的單一真實來源失
// 同步了。
//
// 這份測試直接讀檔案內容掃 SPIRITS map 與 scenarios 字面，不引入 React 元
// 件（OrbCreationStage 依賴 trpc / wouter / framer-motion，在 node 環境
// 無法直接 import），但仍能在合併前抓回兩種典型退化：
//   1. SPIRITS 漏一隻精靈（多在新增 AgentRole 時忘了同步首頁）。
//   2. 新精靈只進 map 但沒任何 scenario 用到它 — demo 看不到。
const STAGE_FILE = "client/src/components/home/OrbCreationStage.tsx";

const STAGE_SOURCE = readFileSync(STAGE_FILE, "utf8");

const SPIRIT_NICKNAMES = [
  // 6 specialist
  "圖圖",
  "影影",
  "音音",
  "聲聲",
  "練練",
  "學學",
  // 6 role
  "導導",
  "編編",
  "品品",
  "查查",
  "路路",
  "暖暖",
  // 3 proactive (original)
  "財財",
  "巧巧",
  "守守",
  // 10 newer spirits
  "律律",
  "安安",
  "帶帶",
  "群群",
  "總總",
  "記記",
  "細細",
  "步步",
  "靈靈",
  "體體",
] as const;

/** Pull the SPIRITS object body so we can assert each nickname is a real key
 *  rather than just incidentally appearing in a comment somewhere. */
function getSpiritsMapBody(): string {
  // The map is declared as
  //   const SPIRITS: Readonly<Record<SpiritNickname, SpiritMeta>> = {
  //     ...
  //   } as const;
  const startMarker = "const SPIRITS:";
  const startIdx = STAGE_SOURCE.indexOf(startMarker);
  expect(startIdx, "SPIRITS map declaration missing").toBeGreaterThan(-1);
  // Find the closing `} as const;` from there.
  const endIdx = STAGE_SOURCE.indexOf("} as const;", startIdx);
  expect(endIdx, "SPIRITS map terminator missing").toBeGreaterThan(startIdx);
  return STAGE_SOURCE.slice(startIdx, endIdx);
}

function getScenariosArrayBody(): string {
  // The array is `const SCENARIOS: readonly Scenario[] = [ ... ] as const;`
  const startMarker = "const SCENARIOS";
  const startIdx = STAGE_SOURCE.indexOf(startMarker);
  expect(startIdx, "SCENARIOS array declaration missing").toBeGreaterThan(-1);
  const endIdx = STAGE_SOURCE.indexOf("] as const;", startIdx);
  expect(endIdx, "SCENARIOS array terminator missing").toBeGreaterThan(startIdx);
  return STAGE_SOURCE.slice(startIdx, endIdx);
}

describe("OrbCreationStage — 25 精靈與影像創作室全站光球模擬", () => {
  it("SPIRITS map declares exactly the 25 expected spirits", () => {
    const body = getSpiritsMapBody();
    for (const nick of SPIRIT_NICKNAMES) {
      // Each entry looks like `<nick>:   { name: "<nick>", ...`
      expect(
        body.includes(`${nick}:`),
        `SPIRITS missing entry for ${nick}`,
      ).toBe(true);
    }
  });

  it("SPIRITS map has no duplicate or extra spirit keys", () => {
    const body = getSpiritsMapBody();
    // Count `name: "<nick>"` occurrences, since `nick:` could collide with
    // single-character substrings of comments. The map's structure ensures
    // each entry has both `<nick>:` *and* `name: "<nick>"`.
    for (const nick of SPIRIT_NICKNAMES) {
      const re = new RegExp(`name:\\s*"${nick}"`, "g");
      const matches = body.match(re) ?? [];
      expect(
        matches.length,
        `SPIRITS has ${matches.length} entries for ${nick} (expected 1)`,
      ).toBe(1);
    }
    // Total name: entries should equal 25 — guards against rogue extras.
    const totalNames = body.match(/name:\s*"[一-鿿]{2}"/g) ?? [];
    expect(totalNames.length).toBe(SPIRIT_NICKNAMES.length);
  });

  it("every spirit appears in at least one scenario cast", () => {
    const scenarios = getScenariosArrayBody();
    const unused: string[] = [];
    for (const nick of SPIRIT_NICKNAMES) {
      if (!scenarios.includes(`"${nick}"`)) {
        unused.push(nick);
      }
    }
    expect(
      unused,
      `unused spirits in scenarios: ${unused.join(", ")}`,
    ).toEqual([]);
  });

  it("exposes a sessionStorage handoff helper for the image studio", () => {
    expect(STAGE_SOURCE.includes("readImageStudioHandoff")).toBe(true);
    expect(STAGE_SOURCE.includes("orb-handoff-image-studio")).toBe(true);
    // The CTA copy users see on the home stage.
    expect(STAGE_SOURCE.includes("在影像創作室深度編輯")).toBe(true);
  });
});

describe("ImageStudio — 接手首頁光球的圖片交接", () => {
  const STUDIO_SOURCE = readFileSync("client/src/pages/ImageStudio.tsx", "utf8");

  it("imports readImageStudioHandoff from OrbCreationStage", () => {
    expect(
      STUDIO_SOURCE.includes("readImageStudioHandoff"),
      "ImageStudio must import the handoff reader so prompt prefills work",
    ).toBe(true);
  });

  it("calls the handoff reader and prefills both prompt and reference image", () => {
    // The mount effect should set prompt + (optionally) ref image so users
    // can keep iterating in edit / t2i tabs.
    expect(STUDIO_SOURCE.includes("readImageStudioHandoff()")).toBe(true);
    expect(STUDIO_SOURCE.includes("setPrompt(handoff.prompt)")).toBe(true);
    expect(STUDIO_SOURCE.includes("setRefImageUrl(handoff.referenceImageUrl)"))
      .toBe(true);
  });
});
