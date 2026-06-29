// ============================================================================
// shells/video/VideoCockpitFrame.tsx — P2 /video 旗艦外框（座艙版 ShellFrame）
// ----------------------------------------------------------------------------
// 取代 P0 ShellFrame 的 video 版本：DashboardLayout（shell scope）＋ ProjectSpineProvider
//（P1 脊椎資料層）＋ 內部 Switch。差異只有一點：**/video 首頁與 /video/director 由導演座艙
//   渲染**，其餘 studio 子路由（create/studio/playground/animation/image/video/pro/light-orb）
//   仍沿用 P0 的「re-home 既有頁面」（重用 P0 的 SHELL_SUBROUTES.video + ShellPage，不重寫頁）。
//
// 旗標：本元件只在 VideoShell 判斷 ENABLE_VIDEO_COCKPIT=ON 後才被渲染；而 VideoShell 本身
//   只在 ENABLE_4SHELL=ON 時被 ShellRoutes 掛載 → 座艙永遠在雙旗標之下，OFF 時完全不可達。
// ============================================================================
import { Switch, Route } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import NotFound from "@/pages/NotFound";
import { ShellPage } from "@/app/navigation";
import { SHELL_SUBROUTES } from "@/shells/shellRouteTable";
import { ProjectSpineProvider } from "@/spine/ProjectSpineProvider";
import { VideoCockpit } from "./VideoCockpit";
import { SSEFallbackBanner } from "@/components/SSEFallbackBanner";
import { AgentStatusBar } from "@/components/AgentStatusBar";
import { AgentQuotaBar } from "@/components/AgentQuotaBar";

/** 由座艙接管的路徑（其餘 video 子路由維持 P0 re-home）。 */
const COCKPIT_PATHS = ["/video", "/video/director", "/video/cockpit"];

export function VideoCockpitFrame() {
  // 非座艙的既有 studio 子路由（沿用 P0 路由表，不重寫頁面）。
  const studioSubs = SHELL_SUBROUTES.video.filter((s) => !COCKPIT_PATHS.includes(s.path));

  return (
    <DashboardLayout shell="video">
      <SSEFallbackBanner />
      <AgentQuotaBar />
      <AgentStatusBar />
      <ProjectSpineProvider>
        <Switch>
          {/* 旗艦座艙：/video、/video/director、/video/cockpit 同一畫面 */}
          {COCKPIT_PATHS.map((p) => (
            <Route key={p} path={p}>
              <VideoCockpit />
            </Route>
          ))}
          {/* 其餘 video 子路由：re-home 既有頁面（P0 行為） */}
          {studioSubs.map((s) => (
            <Route key={s.path} path={s.path}>
              <ShellPage component={s.component} />
            </Route>
          ))}
          {/* 裸 /video 已由上方接管；保險：未知子路徑 → NotFound */}
          <Route component={NotFound} />
        </Switch>
      </ProjectSpineProvider>
    </DashboardLayout>
  );
}

export default VideoCockpitFrame;
