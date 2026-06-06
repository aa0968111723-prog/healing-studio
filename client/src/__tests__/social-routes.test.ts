// ============================================================================
// tests/social-routes.test.ts — /social 路由收編 + 旗標閘門 + 第6接縫預設（加法/parity）
// ----------------------------------------------------------------------------
// 證明 P5 的接線「嚴格加法 + 旗標包覆 + 零路由遺失」：
//   1) SHELL_SUBROUTES.social 恰為 4 條 canonical（/social index + studio/brand/publish）。
//   2) social 為 greenfield：LEGACY_REDIRECTS 無任一條 from/to 觸及 /social*（無舊路由可丟）。
//   3) 旗標閘門：SHELL_META.social.enabled === SHELL_SOCIAL（預設 OFF → 顯示「已關閉」佔位）。
//   4) 不改其他 shell：video/learn/settings 路由數不變（加法不破壞）。
//   5) 第 6 接縫 createPosting() 預設 mock（零金鑰可演）。
// 放 client/src/__tests__/，vitest 跑。
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  SHELL_SUBROUTES, SHELL_INTERNAL_REDIRECTS, LEGACY_REDIRECTS, allShellCanonicalPaths,
} from "@/shells/shellRouteTable";
import { SHELL_BY_ID } from "@/config/shells";
import { SHELL_SOCIAL } from "@/config/featureFlags";
import { createPosting } from "@/adapters/posting";

describe("/social 路由收編", () => {
  it("social 恰有 4 條 canonical sub-route", () => {
    expect(SHELL_SUBROUTES.social).toHaveLength(4);
  });

  it("index = /social；其餘為 studio/brand/publish", () => {
    const paths = SHELL_SUBROUTES.social.map((r) => r.path);
    expect(paths).toEqual(["/social", "/social/studio", "/social/brand", "/social/publish"]);
    const index = SHELL_SUBROUTES.social.find((r) => r.index);
    expect(index?.path).toBe("/social");
  });

  it("每條 sub-route 都有 component", () => {
    for (const r of SHELL_SUBROUTES.social) expect(r.component).toBeDefined();
  });

  it("allShellCanonicalPaths 含 social 掛載點與 sub-routes", () => {
    const all = allShellCanonicalPaths();
    expect(all).toContain("/social");
    expect(all).toContain("/social/studio");
    expect(all).toContain("/social/brand");
    expect(all).toContain("/social/publish");
  });
});

describe("greenfield · 零路由遺失（加法）", () => {
  it("LEGACY_REDIRECTS 無任一條觸及 /social*（無舊路由被收編＝無可丟）", () => {
    const touchesSocial = LEGACY_REDIRECTS.some(
      (r) => r.from.startsWith("/social") || r.to.startsWith("/social"),
    );
    expect(touchesSocial).toBe(false);
  });

  it("social 無 shell 內部轉址（無歷史包袱）", () => {
    expect(SHELL_INTERNAL_REDIRECTS.social).toEqual([]);
  });

  it("不改其他 shell：video=10 / learn=8 / settings=5", () => {
    expect(SHELL_SUBROUTES.video).toHaveLength(10);
    expect(SHELL_SUBROUTES.learn).toHaveLength(8);
    expect(SHELL_SUBROUTES.settings).toHaveLength(5);
  });
});

describe("旗標閘門", () => {
  it("SHELL_META.social.enabled 由 SHELL_SOCIAL 控制（預設 OFF）", () => {
    expect(SHELL_BY_ID.social.enabled).toBe(SHELL_SOCIAL);
    // 測試環境未設 VITE_SHELL_SOCIAL → 預設 false → ShellFrame 顯示「已關閉」佔位。
    expect(SHELL_SOCIAL).toBe(false);
  });
});

describe("第 6 條接縫 · PostingProvider", () => {
  it("createPosting() 預設 mock", () => {
    const { meta } = createPosting();
    expect(meta.posting).toBe("mock");
  });

  it("mock publish 立即發 → posted + 假 permalink + 成本 0", async () => {
    const { posting } = createPosting();
    const res = await posting.publish({
      postId: "p1",
      channel: "ig",
      copy: { headline: "hi" },
      assets: [{ assetId: "a1", ratioPreset: "ig_square" }],
    });
    expect(res.status).toBe("posted");
    expect(res.costUsd).toBe(0);
    expect(res.ref.permalink).toContain("instagram.com");
  });

  it("mock publish 帶 scheduledAt → scheduled", async () => {
    const { posting } = createPosting();
    const res = await posting.publish({
      postId: "p2",
      channel: "fb",
      copy: { headline: "hi" },
      assets: [],
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(res.status).toBe("scheduled");
  });
});
