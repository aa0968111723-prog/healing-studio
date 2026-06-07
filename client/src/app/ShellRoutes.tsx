// ============================================================================
// app/ShellRoutes.tsx — 旗標控制的 4-shell 路由層（注入 App.tsx 的 <Switch>）
// ----------------------------------------------------------------------------
// 用法（App.tsx 的 <Switch> 第一個子節點）：
//     <Switch>
//       {ENABLE_4SHELL && shellRoutes()}   // OFF → false（被 React 忽略）；ON → Route[]
//       <Route path="/" component={Home} />
//       ...既有 54 條 Route 一條不動...
//     </Switch>
//
// 為什麼放第一個：wouter <Switch> 取「第一個 match 的子節點」。把 shell 掛載與相容導向
// 放最前，ENABLE_4SHELL=ON 時它們會 shadow 同路徑的舊 Route（如 /director 先被導向
// /video/director）；OFF 時整段是 false，Switch 完全照舊 → 零行為改變。
//
// wouter（repo patched 3.7.1）的 <Switch> 以 flattenChildren 攤平陣列/Fragment，故這裡
// 回傳的 Route[] 會被逐一視為 Switch 子節點正確比對（patch 也據此填 window.__WOUTER_ROUTES__）。
// ============================================================================
import { Route } from "wouter";
import type { ReactElement } from "react";
import { ENABLE_4SHELL } from "@/config/featureFlags";
import { NavigateRedirect } from "@/app/navigation";
import { LEGACY_REDIRECTS } from "@/shells/shellRouteTable";
import { VideoShell } from "@/shells/VideoShell";
import { SocialShell } from "@/shells/SocialShell";
import { LearnShell } from "@/shells/LearnShell";
import { SettingsShell } from "@/shells/SettingsShell";

const SHELL_COMPONENTS = {
  video: VideoShell,
  social: SocialShell,
  learn: LearnShell,
  settings: SettingsShell,
} as const;

/**
 * 回傳 4-shell 的 Route 陣列（相容導向 + shell 掛載）。
 * ENABLE_4SHELL=OFF 時回 []（防禦性；App.tsx 也會以 `ENABLE_4SHELL &&` 短路）。
 */
export function shellRoutes(): ReactElement[] {
  if (!ENABLE_4SHELL) return [];

  const routes: ReactElement[] = [];

  // ① 舊路徑 → 新 canonical（shadow 既有同路徑 Route）
  for (const r of LEGACY_REDIRECTS) {
    if (r.param) {
      // 參數轉址：/animation/:storyboardId → /video/animation/:storyboardId
      const param = r.param;
      routes.push(
        // params 用 any：wouter 各版本 render-prop 參數型別不一，any callback 對其皆相容，
        // 避免綁定特定 wouter 型別匯出（如 RouteComponentProps）造成編譯風險。
        <Route key={`redir:${r.from}`} path={r.from}>
          {(params: any) => <NavigateRedirect to={`${r.to}/${params?.[param] ?? ""}`} />}
        </Route>,
      );
    } else {
      routes.push(
        <Route key={`redir:${r.from}`} path={r.from}>
          <NavigateRedirect to={r.to} />
        </Route>,
      );
    }
  }

  // ② 四個 shell 掛載點：裸前綴 + 萬用子路徑（:rest* 攤平 0..n 段）
  for (const id of Object.keys(SHELL_COMPONENTS) as (keyof typeof SHELL_COMPONENTS)[]) {
    const Shell = SHELL_COMPONENTS[id];
    routes.push(
      <Route key={`mount:${id}`} path={`/${id}`}>
        <Shell />
      </Route>,
    );
    routes.push(
      <Route key={`mount:${id}/*`} path={`/${id}/:rest*`}>
        <Shell />
      </Route>,
    );
  }

  return routes;
}
