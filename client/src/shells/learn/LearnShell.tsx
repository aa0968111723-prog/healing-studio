// ============================================================================
// shells/learn/LearnShell.tsx — /learn 富 shell（P6；建在 P0 之上）
// ----------------------------------------------------------------------------
// 與 P0 的關係：
//   - P0 的 shells/LearnShell.tsx（薄包裝）改為 re-export 本檔（見本包 edits/）。
//   - ENABLE_4SHELL 仍是總開關（OFF → 整個 /learn shell 不掛載）。
//   - SHELL_LEARN_RICH=OFF → 退回 P0 ShellFrame（純 re-home 既有頁），零行為改變。
//
// 富 shell 結構（沿用 P0 ShellFrame 的「DashboardLayout + 內部 Switch + ShellPage」慣例）：
//   /learn                → LearnHome（六分頁：研究/模型/學習/積分/金鑰/新聞）★P6 新富 UI
//   /learn/ai-models      → LearnHome(models)   （canonical；舊 /ai-models-hub redirect 落點）
//   /learn/research|news|credits|docs → LearnHome(對應分頁)
//   其餘既有深頁（model-wishlist/my-brain/codex/teaching-archive/teams/feedback）
//                         → 沿用 P0 lazyPages re-home（不重寫頁面，維持 parity）
// ============================================================================
import { Switch, Route } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import NotFound from "@/pages/NotFound";
import { ShellPage } from "@/app/navigation";
import * as P from "@/app/lazyPages";
import { ShellFrame } from "@/shells/ShellFrame";
import { SHELL_LEARN_RICH } from "./learnFlags";
import { LearnHome } from "./LearnHome";

export function LearnShell() {
  // 退回 P0：旗標關閉時用既有 ShellFrame（純 re-home，與 P0 行為一致）。
  if (!SHELL_LEARN_RICH) return <ShellFrame shell="learn" />;

  return (
    <DashboardLayout shell="learn">
      <Switch>
        {/* ── P6 富首頁與 canonical 分頁深連結 ───────────────────────────── */}
        <Route path="/learn"><LearnHome /></Route>
        <Route path="/learn/ai-models"><LearnHome initial="models" /></Route>
        <Route path="/learn/research"><LearnHome initial="research" /></Route>
        <Route path="/learn/news"><LearnHome initial="news" /></Route>
        <Route path="/learn/credits"><LearnHome initial="credits" /></Route>
        <Route path="/learn/docs"><LearnHome initial="hub" /></Route>

        {/* ── 既有深頁 re-home（沿用 P0 lazyPages；不重寫頁面，維持 parity）──── */}
        <Route path="/learn/model-wishlist"><ShellPage component={P.ModelWishlistPage} /></Route>
        <Route path="/learn/my-brain"><ShellPage component={P.MyBrainPage} /></Route>
        <Route path="/learn/codex"><ShellPage component={P.AgentCodexPage} /></Route>
        <Route path="/learn/teaching-archive"><ShellPage component={P.TeachingArchive} /></Route>
        <Route path="/learn/teams"><ShellPage component={P.TeamsPage} /></Route>
        <Route path="/learn/feedback"><ShellPage component={P.FeedbackPage} /></Route>

        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

export default LearnShell;
