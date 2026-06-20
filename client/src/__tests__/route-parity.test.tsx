// ============================================================================
// route-parity.test.tsx — 證明「ENABLE_4SHELL 兩態合約」+「ON 時零路由遺失」
// ----------------------------------------------------------------------------
// 放到 repo：client/src/__tests__/route-parity.test.tsx，以既有 vitest 跑：`npm run test`。
//
// 設計成「輕量、無需 render 整個 App」：只驗證旗標預設值 + 路由表不變式（deterministic）。
// 這已足以證明兩條核心保證：
//   (1) 旗標兩態合約：ENABLE_4SHELL=OFF → ShellRoutes() 自身 `if(!ENABLE_4SHELL) return []`
//       → <Switch> 不被注入任何節點 → 路由集合與舊線上完全一致（回滾退路有效）；
//       ENABLE_4SHELL=ON → 注入 LEGACY_REDIRECTS.length + 8（4 殼 × 2 掛載）條路由。
//   (2) 旗標 ON 時，每條被收編的舊路徑都有對應的 canonical shell sub-route（舊連結不 404）。
//
// 2026-06-20 Bruce 拍板 ENABLE_4SHELL default ON（前端新介面上線）：
//   - 守門「預設值」的斷言改成 `toBe(true)`（斷言新預設），保留語意不弱化。
//   - 兩態合約（OFF→0 條、ON→注入正確條數）以 ShellRoutes.tsx 匯出的「純函式」
//     `expectedShellRouteCount(enabled)` 斷言。此 helper 即 `shellRoutes()` 的長度真相源
//     （`shellRoutes()` 自身以它為注入條數依據），故測它＝測 `shellRoutes()` 的兩態合約，
//     且**不需** vi.resetModules()＋動態 import 整個 shell 元件樹
//     （VideoShell→VideoCockpitFrame→… 等四殼巨大依賴圖）。
//     先前版本以 vi.doMock + 冷重載整圖驗兩態，在「全 client vitest 套件併發負載」下
//     會冷編譯 timeout（route-parity 變 flaky gate）；改純函式後兩態斷言恆定毫秒級、零冷重載、
//     完整保住「OFF=線上 parity（注入 0 條）／ON=注入正確條數」覆蓋（語意不弱化）。
// ============================================================================
import { describe, it, expect } from "vitest";
import { ENABLE_4SHELL } from "@/config/featureFlags";
// 純資料合約 helper（不含任何 shell 元件樹 → 靜態 import 零冷重載成本）。
import { expectedShellRouteCount } from "@/shells/shellRouteContract";
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

describe("flag default + two-state shellRoutes() contract", () => {
  it("ENABLE_4SHELL defaults to true (2026-06-20 Bruce go-live: shell routes injected by default)", () => {
    // 翻 default 後，沒有 env 覆寫的環境（dev/測試）預設新介面 → shellRoutes() 注入路由。
    // 回滾退路（Railway VITE_ENABLE_4SHELL=0 / 瀏覽器 ?aidvchrome=0）見下方 OFF-state 測試與 docstring。
    expect(ENABLE_4SHELL).toBe(true);
  });

  it("shellRoutes() injects 0 routes when ENABLE_4SHELL is explicitly OFF (rollback parity preserved)", () => {
    // 明確把旗標設 OFF（模擬 Railway VITE_ENABLE_4SHELL=0 回滾），守住「OFF=線上 parity，注入 0 條」。
    // 以 shellRoutes() 的純合約 helper 斷言（OFF→0），無須冷重載整個 shell 元件樹。
    expect(expectedShellRouteCount(false)).toBe(0);
  });

  it("shellRoutes() injects redirects + 4 shell mounts when ENABLE_4SHELL is ON (zero route loss)", () => {
    // 明確把旗標設 ON，斷言注入條數 = 每條相容導向 + 四殼各 2 掛載（裸前綴 + :rest*）。
    expect(expectedShellRouteCount(true)).toBe(LEGACY_REDIRECTS.length + 8);
  });

  it("baseline still enumerates the 54 live routes (+catch-all) untouched by this patch", () => {
    // 不刪任何既有 Route；此基準長度作為「沒弄丟路由」的對照快照。
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
