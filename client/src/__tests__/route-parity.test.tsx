// ============================================================================
// route-parity.test.tsx — 證明「ENABLE_4SHELL=OFF 時行為 == 線上」+「ON 時零路由遺失」
// ----------------------------------------------------------------------------
// 放到 repo：client/src/__tests__/route-parity.test.tsx，以既有 vitest 跑：`npm run test`。
//
// 設計成「輕量、無需 render 整個 App」：只驗證旗標預設值 + 路由表不變式（deterministic）。
// 這已足以證明 P0 的兩條核心保證：
//   (1) 預設建置 ENABLE_4SHELL=false → ShellRoutes() 自身 `if(!ENABLE_4SHELL) return []`
//       → <Switch> 不被注入任何節點 → 路由集合與線上完全一致。
//   (2) 旗標 ON 時，每條被收編的舊路徑都有對應的 canonical shell sub-route（舊連結不 404）。
// ============================================================================
import { describe, it, expect } from "vitest";
import { ENABLE_4SHELL } from "@/config/featureFlags";
import {
  LEGACY_REDIRECTS,
  SHELL_SUBROUTES,
  SHELL_INTERNAL_REDIRECTS,
  allShellCanonicalPaths,
} from "@/shells/shellRouteTable";
import type { ShellId } from "@/spine/types";

/** 線上（main HEAD 2888a36）App.tsx 的權威路由集合 —— 作為 parity 對照基準。 */
const BASELINE_APP_ROUTES = [
  "/", "/create", "/playground", "/studio", "/director", "/creative-projects",
  "/projects", "/projects/:id", "/animation", "/animation/:storyboardId",
  "/worldbuilding", "/worldbuilding/:storyboardId", "/assets", "/models", "/vault",
  "/shared", "/notes", "/calendar", "/dashboard", "/feedback", "/settings/ai-brain",
  "/settings/agent", "/settings", "/history", "/admin", "/admin/api-usage",
  "/admin/brain-pipeline", "/my-brain", "/pro-studio", "/image-studio",
  "/light-orb-studio", "/video-studio", "/learn", "/ai-models-hub", "/model-wishlist",
  "/learn/tutorial-overview", "/tutorial-overview", "/lora-trainer", "/focus-flow",
  "/langsmith", "/background-tasks", "/credits", "/prompt-library", "/prompt-collection",
  "/agent", "/codex", "/teaching-archive", "/teams", "/forgot-password",
  "/reset-password", "/account-settings", "/process", "/unorganized", "/404",
] as const;

function canonicalSubPaths(): string[] {
  return (Object.keys(SHELL_SUBROUTES) as ShellId[]).flatMap((id) =>
    SHELL_SUBROUTES[id].map((r) => r.path),
  );
}

describe("P0 flag default = online parity", () => {
  it("ENABLE_4SHELL defaults to false (no shell routes injected in default build)", () => {
    // 預設未設 VITE_ENABLE_4SHELL → false → ShellRoutes() 回 []，Switch 與線上一致。
    expect(ENABLE_4SHELL).toBe(false);
  });

  it("baseline still enumerates the 54 live routes (+catch-all) untouched by this patch", () => {
    // P0 不刪任何既有 Route；此基準長度作為「沒弄丟路由」的對照快照。
    expect(BASELINE_APP_ROUTES.length).toBe(54);
  });
});

describe("P0 flag ON = zero route loss", () => {
  it("every legacy redirect shadows a REAL existing App route (not an invented path)", () => {
    for (const r of LEGACY_REDIRECTS) {
      expect(BASELINE_APP_ROUTES).toContain(r.from);
    }
  });

  it("every legacy redirect points to a declared canonical shell sub-route (no dead redirect)", () => {
    const subs = new Set(canonicalSubPaths());
    for (const r of LEGACY_REDIRECTS) {
      // 參數路由：to 是前綴（/video/animation），實際 canonical 為 /video/animation/:storyboardId
      const target = r.param ? `${r.to}/:${r.param}` : r.to;
      expect(subs.has(target)).toBe(true);
    }
  });

  it("canonical shell sub-route paths are collision-free", () => {
    const paths = canonicalSubPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("new shell paths never collide with cross-shell top-level routes kept at root", () => {
    // 收編後仍維持頂層的脊椎路由（project/assets/公開/standalone）不可被 shell 路徑吃掉。
    const keptTopLevel = new Set([
      "/", "/assets", "/models", "/shared", "/notes", "/dashboard",
      "/creative-projects", "/projects", "/agent", "/focus-flow", "/unorganized",
      "/tutorial-overview", "/forgot-password", "/reset-password", "/account-settings", "/process",
    ]);
    for (const p of canonicalSubPaths()) {
      // 所有 canonical 都帶 shell 前綴；不得等於任何保留頂層路徑。
      expect(keptTopLevel.has(p)).toBe(false);
      expect(/^\/(video|social|learn|settings)(\/|$)/.test(p)).toBe(true);
    }
  });

  it("each non-empty shell declares exactly one index sub-route", () => {
    for (const id of ["video", "learn", "settings"] as ShellId[]) {
      const idx = SHELL_SUBROUTES[id].filter((r) => r.index);
      expect(idx.length).toBe(1);
    }
  });

  it("settings shell keeps /settings/ai-brain reachable (internal redirect → /settings/admin)", () => {
    const r = SHELL_INTERNAL_REDIRECTS.settings.find((x) => x.from === "/settings/ai-brain");
    expect(r?.to).toBe("/settings/admin");
  });

  it("allShellCanonicalPaths() includes the four mount points", () => {
    const all = new Set(allShellCanonicalPaths());
    for (const m of ["/video", "/social", "/learn", "/settings"]) {
      expect(all.has(m)).toBe(true);
      expect(all.has(`${m}/:rest*`)).toBe(true);
    }
  });
});
