// @vitest-environment jsdom
/**
 * RefundDetailLink — AIDV-969（承 AIDV-650 驗收 3）
 * 驗收條件：
 * 1) 連結渲染條件矩陣：與徽章完全一致 —— full / partial / not_refunded 才渲染
 *    「點數紀錄」連結；none / unknown / 無資料 → 完全不渲染（不破壞 AIDV-650
 *    釘住的安靜降級行為）。
 * 2) pathname 白名單（仿 AIDV-966 模式）：連結目的地的 pathname 必須是
 *    「實存路由」—— 自 client/src/App.tsx 的 <Route path> 與
 *    shellRouteTable.ts 的 SHELL_SUBROUTES 靜態抽取，禁止死連結。
 * 3) query 參數可達性：?section=credits 必須是 DashboardPage 真正支援的分頁
 *    （源碼有 section === "credits" 渲染分支＋getInitialSection 讀 ?section=）。
 * 4) describeRefundSummary 摘要矩陣：「本任務扣點 X／退回 Y」只在有明確扣點
 *    事實時產生。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RefundDetailLink } from "./RefundDetailLink";
import {
  CREDITS_LEDGER_HREF,
  CREDITS_LEDGER_PATHNAME,
  describeRefundLedgerLink,
  describeRefundSummary,
  type JobRefundInfo,
} from "./refundStatus";

afterEach(() => cleanup());

const info = (overrides: Partial<JobRefundInfo>): JobRefundInfo => ({
  taskId: 1,
  chargedPoints: 0,
  refundedPoints: 0,
  refundStatus: "unknown",
  ...overrides,
});

// ─── 1) 連結渲染條件矩陣 ─────────────────────────────────────────────────────

describe("RefundDetailLink 渲染條件矩陣 (AIDV-969)", () => {
  it.each([
    ["full", { refundStatus: "full", chargedPoints: 30, refundedPoints: 30 }],
    ["partial", { refundStatus: "partial", chargedPoints: 30, refundedPoints: 10 }],
    ["not_refunded", { refundStatus: "not_refunded", chargedPoints: 30 }],
  ] as const)("%s → 渲染「點數紀錄」連結且 href 指向積分帳戶頁", (_name, o) => {
    render(<RefundDetailLink info={info(o)} />);
    const link = screen.getByRole("link");
    expect(link.textContent).toContain("點數紀錄");
    expect(link.getAttribute("href")).toBe(CREDITS_LEDGER_HREF);
    // 完整語意說明（title / aria-label）
    expect(link.getAttribute("title")).toContain("積分帳戶");
    expect(link.getAttribute("aria-label")).toContain("積分帳戶");
  });

  it("none / unknown / 無資料 → 完全不渲染（與徽章同步安靜降級）", () => {
    const { container: c1 } = render(
      <RefundDetailLink info={info({ refundStatus: "none" })} />
    );
    expect(c1.innerHTML).toBe("");
    cleanup();
    const { container: c2 } = render(
      <RefundDetailLink info={info({ refundStatus: "unknown" })} />
    );
    expect(c2.innerHTML).toBe("");
    cleanup();
    const { container: c3 } = render(<RefundDetailLink info={undefined} />);
    expect(c3.innerHTML).toBe("");
    cleanup();
    const { container: c4 } = render(<RefundDetailLink info={null} />);
    expect(c4.innerHTML).toBe("");
  });

  it("純函式層：describeRefundLedgerLink 與徽章顯示條件完全一致", () => {
    expect(describeRefundLedgerLink(info({ refundStatus: "full" }))).not.toBeNull();
    expect(describeRefundLedgerLink(info({ refundStatus: "partial" }))).not.toBeNull();
    expect(describeRefundLedgerLink(info({ refundStatus: "not_refunded" }))).not.toBeNull();
    expect(describeRefundLedgerLink(info({ refundStatus: "none" }))).toBeNull();
    expect(describeRefundLedgerLink(info({ refundStatus: "unknown" }))).toBeNull();
    expect(describeRefundLedgerLink(undefined)).toBeNull();
    expect(describeRefundLedgerLink(null)).toBeNull();
  });
});

// ─── 2) pathname 白名單（仿 AIDV-966：對照 App.tsx 實存路由，禁止死連結） ────

const repoRoot = path.resolve(__dirname, "../../..");

function readSource(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

/**
 * 站內實存路由（pathname 層級）：
 *   a. App.tsx 的 <Route path="…">（頂層路由，4SHELL OFF 回滾路徑）
 *   b. shellRouteTable.ts 的 SHELL_SUBROUTES / LEGACY_REDIRECTS 路徑（4SHELL ON）
 * 均以源碼靜態抽取（不執行模組），路由改名時本測試會即刻紅。
 */
function knownRoutePaths(): Set<string> {
  const out = new Set<string>();
  const appSrc = readSource("client/src/App.tsx");
  for (const m of appSrc.matchAll(/<Route\s+path="([^"]+)"/g)) out.add(m[1]);
  const tableSrc = readSource("client/src/shells/shellRouteTable.ts");
  for (const m of tableSrc.matchAll(/(?:path|from|to):\s*"([^"]+)"/g)) out.add(m[1]);
  return out;
}

describe("RefundDetailLink pathname 白名單 (AIDV-969 · 仿 AIDV-966)", () => {
  it("連結 pathname 是 App.tsx／shellRouteTable 實存路由（禁止死連結）", () => {
    const routes = knownRoutePaths();
    expect(routes.size).toBeGreaterThan(10); // 抽取器本身有效
    const pathname = CREDITS_LEDGER_HREF.split(/[?#]/)[0];
    expect(pathname).toBe(CREDITS_LEDGER_PATHNAME);
    expect(
      routes.has(pathname),
      `連結 pathname「${pathname}」不在 App.tsx / shellRouteTable 實存路由`
    ).toBe(true);
  });

  it("?section=credits 是 DashboardPage 真正支援的分頁（query 可達性）", () => {
    const q = CREDITS_LEDGER_HREF.split("?")[1] ?? "";
    const section = new URLSearchParams(q).get("section");
    expect(section).toBe("credits");
    const dashSrc = readSource("client/src/pages/DashboardPage.tsx");
    // getInitialSection 讀 ?section= 決定初始分頁
    expect(dashSrc).toContain('params.get("section")');
    // section === "credits" 有對應渲染分支（CreditsInfoPage）
    expect(dashSrc).toContain('section === "credits"');
  });

  it("App.tsx 既有 /credits 捷徑仍導向同一落點（與本連結語意一致）", () => {
    const appSrc = readSource("client/src/App.tsx");
    expect(appSrc).toContain('<Route path="/credits">');
    expect(appSrc).toContain(`to="${CREDITS_LEDGER_HREF}"`);
  });
});

// ─── 3.5) VideoStudio 完成/失敗畫面掛點（AIDV-969 修補：spec ① /video 相關畫面） ──
//
// 驗收 ① 明列「與 /video 相關完成/失敗畫面加導向該頁的連結」。此連結為
// 純靜態導向（固定 CREDITS_LEDGER_HREF，不依賴 refund 資料、不需 jobId），
// 與「refund 條件顯示」（RefundDetailLink）是兩件事。以源碼靜態抽取釘住
// 掛點存在，掛點被移除或改用死常數時本測試即刻紅。

describe("VideoStudio 完成/失敗畫面掛「點數紀錄」連結 (AIDV-969 · spec ①)", () => {
  const videoSrc = readSource("client/src/pages/VideoStudio.tsx");

  it("自 refundStatus 匯入 CREDITS_LEDGER_HREF（單一事實來源，禁止硬編字串）", () => {
    expect(videoSrc).toContain(
      'import { CREDITS_LEDGER_HREF } from "@/components/refundStatus"'
    );
  });

  it("完成＋失敗畫面各掛一個 href={CREDITS_LEDGER_HREF} 靜態連結（至少 2 處）", () => {
    const mounts = videoSrc.match(/href=\{CREDITS_LEDGER_HREF\}/g) ?? [];
    expect(mounts.length).toBeGreaterThanOrEqual(2);
    // 完成畫面掛點（VideoPlayer 動作列）與失敗畫面掛點（AsyncVideoPoller 失敗卡）
    expect(videoSrc).toContain("AIDV-969：完成畫面 → 點數紀錄");
    expect(videoSrc).toContain("AIDV-969：失敗畫面 → 點數紀錄");
  });

  it("連結文字為「點數紀錄」且不帶 jobId（誠實靜態導向）", () => {
    expect(videoSrc).toContain("點數紀錄 →");
    // href 為固定常數，不得拼接 jobId / request_id query
    expect(videoSrc).not.toMatch(/CREDITS_LEDGER_HREF\s*\+/);
    expect(videoSrc).not.toMatch(/\$\{CREDITS_LEDGER_HREF\}/);
  });
});

// ─── 4) 點數異動摘要矩陣 ─────────────────────────────────────────────────────

describe("describeRefundSummary 摘要矩陣 (AIDV-969)", () => {
  it("full → 「本任務扣點 30 點・已退回 30 點」", () => {
    expect(
      describeRefundSummary(
        info({ refundStatus: "full", chargedPoints: 30, refundedPoints: 30 })
      )
    ).toBe("本任務扣點 30 點・已退回 30 點");
  });

  it("partial → 「本任務扣點 30 點・已退回 10 點」", () => {
    expect(
      describeRefundSummary(
        info({ refundStatus: "partial", chargedPoints: 30, refundedPoints: 10 })
      )
    ).toBe("本任務扣點 30 點・已退回 10 點");
  });

  it("not_refunded → 「本任務扣點 30 點・已退回 0 點」", () => {
    expect(
      describeRefundSummary(info({ refundStatus: "not_refunded", chargedPoints: 30 }))
    ).toBe("本任務扣點 30 點・已退回 0 點");
  });

  it("none / unknown / 無資料 → null（安靜降級，絕不渲染誤導摘要）", () => {
    expect(describeRefundSummary(info({ refundStatus: "none" }))).toBeNull();
    expect(describeRefundSummary(info({ refundStatus: "unknown" }))).toBeNull();
    expect(describeRefundSummary(undefined)).toBeNull();
    expect(describeRefundSummary(null)).toBeNull();
  });
});
