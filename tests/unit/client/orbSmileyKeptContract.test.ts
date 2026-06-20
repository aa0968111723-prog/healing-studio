/**
 * orbSmileyKeptContract.test.ts
 *
 * 鎖住「笑臉留」這半邊契約 ——「光球只留笑臉光球」(ORB_SMILEY_ONLY) 的標題承諾
 * 有兩面：(A) 靜音其他主動提示、(B) **保留**右下笑臉助手光球本身與其功能。
 *
 * 其他測試已蓋好 (A) 的負面：
 *   - proactiveNotificationCenter.test.tsx：用 DashboardLayout 的真實運算式
 *     `proactiveGloballyEnabled && !ORB_SMILEY_ONLY` 掛載 → 主動精靈卡片全靜音。
 *   - aidvOrbProactiveBubble.test.tsx：第二顆光球 (AidvOrbMount) 在 proactiveBubble=false
 *     時不再冒主動泡泡。
 *
 * 但「笑臉留」(B) ——「ProactiveOrbWidget 這顆笑臉光球在 ORB_SMILEY_ONLY=ON 時仍掛載、
 * 功能不受影響」—— 在 PR 之前**沒有任何測試**斷言。aidvOrbProactiveBubble 斷言的是
 * 第二顆 (design-kit AidvOrbMount) 光球的 FAB 留著，不是 PR 標題講的那顆笑臉
 * ProactiveOrbWidget。本檔把 (B) 鎖成不變式。
 *
 * 做法（與 tests/unit/shared/orchestrator-boundary.test.ts 同調，源碼層結構不變式）：
 * ProactiveOrbWidget 是 4000+ 行、依賴 ~15 個 context 的元件，整顆 render 等於拉起整棵
 * provider 樹＝脆且慢；而它的到站／引導泡泡路徑 (OrbGuideContext.attachArrivalGuide)
 * 已在 orb-guide-arrival.test.tsx 用 OrbGuideProvider 直接驗過。真正缺的、且最穩的斷言是
 * 在 DashboardLayout 源碼這個**唯一渲染收斂點**上鎖住「笑臉光球的渲染條件不含 ORB_SMILEY_ONLY」
 * （旗標翻 ON 也不會把它拿掉），並反證「被靜音的兩個面其閘門才依賴 ORB_SMILEY_ONLY」。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

const DASHBOARD = "client/src/components/DashboardLayout.tsx";

/**
 * 取出 JSX 裡某個元件標籤所在的「渲染區塊」——從該元件出現處往回找最近的
 * 換行起點，往前到該標籤閉合（`/>` 或 `>`）為止，連同它前面同一個 `{cond && (...)}`
 * 的守衛條件一起回傳，方便檢查渲染閘門。回傳整個 DashboardLayout return 區的原文，
 * 由各 it 自行用更精準的 regex 斷言，避免脆弱的字串切片。
 */
function dashboardSource(): string {
  return readSource(DASHBOARD);
}

describe("「光球只留笑臉光球」— 笑臉留契約（ProactiveOrbWidget 仍掛載、功能不動）", () => {
  it("笑臉光球元件本體不引用 ORB_SMILEY_ONLY（旗標碰不到它＝不會被靜音/移除）", () => {
    const src = readSource("client/src/components/ProactiveOrbWidget.tsx");
    expect(src.includes("ORB_SMILEY_ONLY")).toBe(false);
  });

  it("笑臉光球的到站/引導泡泡路徑（OrbGuideContext）不引用 ORB_SMILEY_ONLY（功能不受旗標影響）", () => {
    const src = readSource("client/src/contexts/OrbGuideContext.tsx");
    expect(src.includes("ORB_SMILEY_ONLY")).toBe(false);
  });

  it("DashboardLayout 仍渲染 ProactiveOrbWidget（笑臉光球沒有被整顆拿掉）", () => {
    const src = dashboardSource();
    expect(/<ProactiveOrbWidget\b/.test(src)).toBe(true);
  });

  it("ProactiveOrbWidget 的渲染條件只看 user + 非 /agent，不含 ORB_SMILEY_ONLY（旗標 ON 也照掛）", () => {
    const src = dashboardSource();
    // 抓「掛載笑臉光球」那段守衛 + JSX：`{user && location !== "/agent" && (\n  <ProactiveOrbWidget ... />\n)}`
    // 用非貪婪比對從守衛條件到 <ProactiveOrbWidget 開標籤，斷言這段守衛沒有 ORB_SMILEY_ONLY。
    const match = src.match(
      /\{\s*user\s*&&\s*location\s*!==\s*["']\/agent["']\s*&&\s*\(\s*<ProactiveOrbWidget\b/,
    );
    expect(match).not.toBeNull();
  });

  it("整個 DashboardLayout 內，ORB_SMILEY_ONLY 只出現在『被靜音的面』(通知中心 globallyEnabled)，不出現在笑臉光球的渲染閘門", () => {
    const src = dashboardSource();
    // 被靜音的面：ProactiveNotificationCenter 的 globallyEnabled 必須依賴 !ORB_SMILEY_ONLY
    expect(/globallyEnabled=\{[^}]*!\s*ORB_SMILEY_ONLY[^}]*\}/.test(src)).toBe(true);

    // 反證：把笑臉光球那段（守衛 + 標籤 + 其 props 直到自閉合）抓出來，確認整段不含 ORB_SMILEY_ONLY。
    const orbBlock = src.match(
      /\{\s*user\s*&&\s*location\s*!==\s*["']\/agent["']\s*&&\s*\(\s*<ProactiveOrbWidget\b[\s\S]*?\/>\s*\)\s*\}/,
    );
    expect(orbBlock).not.toBeNull();
    expect(orbBlock![0].includes("ORB_SMILEY_ONLY")).toBe(false);
  });
});
