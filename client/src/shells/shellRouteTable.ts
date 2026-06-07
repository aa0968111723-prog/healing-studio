// ============================================================================
// shells/shellRouteTable.ts — 4-shell 路由對照表（單一真相源）
// ----------------------------------------------------------------------------
// 這是「舊路由 → 新 shell 前綴」收編 + 相容導向的唯一資料來源：
//   - SHELL_SUBROUTES：每個 shell 內部的 canonical sub-route（新前綴 → 既有頁面）。
//   - LEGACY_REDIRECTS：舊路徑 → 新 canonical 路徑（ENABLE_4SHELL=ON 時生效，shadow 舊 Route）。
//   - CROSS_SHELL_TOPLEVEL：明確「不收編、維持頂層」的路由（group=project/assets + 公開/standalone）。
//
// ShellRoutes.tsx 與 tests/scan-shell-routes.mjs 都讀這張表 → 對照表、相容導向、parity 檢查
// 三者永遠同步、不會漂移。
//
// 收編依據：shared/appRegistry.ts 的 group（GitNexus §B.4 實測：create9/project9/learn9/
// settings9/assets7/orb3/train1）對映整合指南 §4.2。
// ============================================================================
import type { ComponentType } from "react";
import type { ShellId } from "@/spine/types";
import * as P from "@/app/lazyPages";

export interface ShellSubRoute {
  /** 新 canonical 路徑（絕對，含 shell 前綴）。 */
  path: string;
  /** 要渲染的既有頁面元件（lazy）。 */
  component: ComponentType;
  /** 是否為該 shell 的 index（裸前綴 redirect 目標）。 */
  index?: boolean;
}

export interface LegacyRedirect {
  /** 舊路徑（App.tsx 既有 Route 的 path）。 */
  from: string;
  /** 新 canonical 路徑。 */
  to: string;
  /** wouter 動態參數名（如 storyboardId）；有則做參數轉址。 */
  param?: string;
}

// ── 每個 shell 的內部 sub-route（新前綴 → 既有頁面）─────────────────────────────
export const SHELL_SUBROUTES: Record<ShellId, ShellSubRoute[]> = {
  video: [
    { path: "/video/director", component: P.DirectorAI, index: true },
    { path: "/video/create", component: P.CreationHub },
    { path: "/video/studio", component: P.Studio },
    { path: "/video/playground", component: P.Playground },
    { path: "/video/animation", component: P.AnimationStudio },
    { path: "/video/animation/:storyboardId", component: P.AnimationStudio },
    { path: "/video/image", component: P.ImageStudio },
    { path: "/video/video", component: P.VideoStudio },
    { path: "/video/pro", component: P.ProStudio },
    { path: "/video/light-orb", component: P.LightOrbCreationStudio },
  ],
  learn: [
    { path: "/learn", component: P.LearnHub, index: true },
    { path: "/learn/ai-models", component: P.AIModelsHub },
    { path: "/learn/model-wishlist", component: P.ModelWishlistPage },
    { path: "/learn/my-brain", component: P.MyBrainPage },
    { path: "/learn/codex", component: P.AgentCodexPage },
    { path: "/learn/teaching-archive", component: P.TeachingArchive },
    { path: "/learn/teams", component: P.TeamsPage },
    { path: "/learn/feedback", component: P.FeedbackPage },
  ],
  settings: [
    { path: "/settings", component: P.SettingsPage, index: true },
    { path: "/settings/agent", component: P.AgentPreferencesPage },
    { path: "/settings/admin", component: P.AdminPage },
    { path: "/settings/admin/api-usage", component: P.AdminApiUsagePage },
    { path: "/settings/admin/brain-pipeline", component: P.AiBrainPipelinePage },
  ],
  social: [
    // 社群系統②：0 專屬實作（新建）。P0 僅佔位骨架；實 UI 為 P5。
  ],
};

/** shell 內部「舊→新」轉址（在 shell 自己的 Switch 內處理，例如 /settings/ai-brain）。 */
export const SHELL_INTERNAL_REDIRECTS: Record<ShellId, LegacyRedirect[]> = {
  video: [],
  learn: [],
  settings: [
    // 既有 /settings/ai-brain → /admin（AdminRedirect）；4-shell 下 admin 收編到 /settings/admin。
    { from: "/settings/ai-brain", to: "/settings/admin" },
  ],
  social: [],
};

// ── 舊路徑 → 新 canonical（App-level 相容導向；ENABLE_4SHELL=ON 時 shadow 舊 Route）──
export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  // → video
  { from: "/director", to: "/video/director" },
  { from: "/create", to: "/video/create" },
  { from: "/studio", to: "/video/studio" },
  { from: "/playground", to: "/video/playground" },
  { from: "/animation", to: "/video/animation" },
  { from: "/animation/:storyboardId", to: "/video/animation", param: "storyboardId" },
  { from: "/image-studio", to: "/video/image" },
  { from: "/video-studio", to: "/video/video" },
  { from: "/pro-studio", to: "/video/pro" },
  { from: "/light-orb-studio", to: "/video/light-orb" },
  // → learn
  { from: "/ai-models-hub", to: "/learn/ai-models" },
  { from: "/model-wishlist", to: "/learn/model-wishlist" },
  { from: "/my-brain", to: "/learn/my-brain" },
  { from: "/codex", to: "/learn/codex" },
  { from: "/teaching-archive", to: "/learn/teaching-archive" },
  { from: "/teams", to: "/learn/teams" },
  { from: "/feedback", to: "/learn/feedback" },
  // → settings
  { from: "/admin", to: "/settings/admin" },
  { from: "/admin/api-usage", to: "/settings/admin/api-usage" },
  { from: "/admin/brain-pipeline", to: "/settings/admin/brain-pipeline" },
];

/**
 * 明確「不收編、維持頂層」的路由（文件用途；ShellRoutes 不碰這些，App.tsx 原樣保留）。
 * 依 GitNexus §4.2：group=project/assets 為跨 shell 脊椎資源，四 shell 共讀，不歸單一 shell。
 * 另含公開landing與 standalone 認證頁。
 */
export const CROSS_SHELL_TOPLEVEL: string[] = [
  "/",                       // Home（公開 landing）
  "/assets", "/models", "/shared", "/notes", "/dashboard",          // assets/project 脊椎
  "/creative-projects", "/projects", "/projects/:id",               // project 脊椎
  "/agent",                                                          // 全域代理（orb）
  "/focus-flow", "/unorganized", "/tutorial-overview",              // 跨切面/過渡
  "/forgot-password", "/reset-password", "/account-settings", "/process", // standalone
  // 既有內部轉址（App.tsx 已有，維持不動）：/worldbuilding, /vault, /calendar, /history,
  // /lora-trainer, /langsmith, /background-tasks, /credits, /prompt-library, /prompt-collection,
  // /learn/tutorial-overview, /settings/ai-brain
];

/** 給 scan / parity 檢查用：所有新 canonical 路徑（含 shell 掛載前綴）。 */
export function allShellCanonicalPaths(): string[] {
  const subs = (Object.keys(SHELL_SUBROUTES) as ShellId[]).flatMap((id) =>
    SHELL_SUBROUTES[id].map((r) => r.path),
  );
  const mounts = (Object.keys(SHELL_SUBROUTES) as ShellId[]).flatMap((id) => [`/${id}`, `/${id}/:rest*`]);
  return [...new Set([...mounts, ...subs])];
}
