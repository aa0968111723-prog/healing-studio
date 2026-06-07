// ============================================================================
// app/lazyPages.ts — shell 用的延遲載入頁面登錄表
// ----------------------------------------------------------------------------
// 用 repo 既有的 lazyWithRetry（@/lib/lazyWithRetry）延遲載入既有頁面，import 路徑與
// App.tsx 完全一致。shell 透過本表 re-home 既有頁面 —— 不重寫任何頁面、不複製頁面邏輯，
// 只是把同一批頁面元件掛到新的 /video|/learn|/settings 前綴下。
//
// 注意：同一頁面在 App.tsx 與此處各有一個 lazy 包裝，但兩者指向「同一個動態 import 模組」，
// 瀏覽器/Vite 會快取該 chunk，不會重複下載；僅多一個極小的 lazy 包裝物件，可忽略。
// ============================================================================
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";

// ── video shell 頁面（group: create / train / orb-創作）──────────────────────
export const CreationHub = lazy(() => import("@/pages/CreationHub"));
export const Playground = lazy(() => import("@/pages/Playground"));
export const Studio = lazy(() => import("@/pages/Studio"));
export const DirectorAI = lazy(() => import("@/pages/DirectorAI"));
export const AnimationStudio = lazy(() => import("@/pages/AnimationStudio"));
export const ProStudio = lazy(() => import("@/pages/ProStudio"));
export const ImageStudio = lazy(() => import("@/pages/ImageStudio"));
export const LightOrbCreationStudio = lazy(() => import("@/pages/LightOrbCreationStudio"));
export const VideoStudio = lazy(() => import("@/pages/VideoStudio"));

// ── learn shell 頁面（group: learn）─────────────────────────────────────────
export const LearnHub = lazy(() => import("@/pages/LearnHub"));
export const AIModelsHub = lazy(() => import("@/pages/AIModelsHub"));
export const ModelWishlistPage = lazy(() => import("@/pages/ModelWishlistPage"));
export const MyBrainPage = lazy(() => import("@/pages/MyBrainPage"));
export const AgentCodexPage = lazy(() => import("@/pages/AgentCodexPage"));
export const TeachingArchive = lazy(() => import("@/pages/TeachingArchive"));
export const TeamsPage = lazy(() => import("@/pages/TeamsPage"));
export const FeedbackPage = lazy(() => import("@/pages/FeedbackPage"));

// ── settings shell 頁面（group: settings / admin）───────────────────────────
export const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
export const AgentPreferencesPage = lazy(() => import("@/pages/settings/AgentPreferencesPage"));
export const AdminPage = lazy(() => import("@/pages/AdminPage"));
export const AdminApiUsagePage = lazy(() => import("@/pages/AdminApiUsagePage"));
export const AiBrainPipelinePage = lazy(() => import("@/pages/AiBrainPipelinePage"));

// ── social shell 頁面（group: social 新建；P5 社群圖文系統②）─────────────────
// 非 re-home 既有頁：這四頁是 P5 新建（pages/social/*）。lazy 包裝＝與其他 shell 一致。
export const SocialCockpit = lazy(() => import("@/pages/social/SocialCockpitPage"));
export const SocialStudio = lazy(() => import("@/pages/social/SocialStudioPage"));
export const SocialBrand = lazy(() => import("@/pages/social/SocialBrandPage"));
export const SocialPublish = lazy(() => import("@/pages/social/SocialPublishPage"));
