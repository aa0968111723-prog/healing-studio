// ============================================================================
// shells/video/VideoCockpit.tsx — 導演座艙（3 欄旗艦）
// ----------------------------------------------------------------------------
// 左＝專案 + 索引上下文 ｜ 中＝導演台 + 確認門 + 階段條 ｜ 右＝專案資料庫（分鏡/角色/場景/筆記/資產/提示詞）
// 來源：AI-Director-模擬 shells/video/VideoShell.tsx，改寫為真實 repo 慣例
//   （TypeScript / React19 / Wouter / tRPC、@/* imports、shadcn/ui + Tailwind + lucide-react），
//   資料與動作全部走 P1 的 useProjectSpine()（真實 gateway / mock 種子，依旗標）。
//
// 狀態場景：loading（載入脈絡）/ error（脈絡失敗）/ empty（未選專案或空專案）/ success（座艙）。
// ============================================================================
import { useState, type ReactNode } from "react";
import { Wand2, Film, FolderOpen, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { ENABLE_DIRECTOR_CONSOLE } from "@/config/videoFlags";
import { StageBar } from "./StageBar";
import { ContextColumn } from "./columns/ContextColumn";
import { DirectorColumn } from "./columns/DirectorColumn";
import { DatabaseColumn } from "./columns/DatabaseColumn";
import { GuidedJourney } from "./GuidedJourney";
import { DirectorConsole } from "./DirectorConsole";

export function VideoCockpit() {
  const spine = useProjectSpine();
  const [guided, setGuided] = useState(false);
  const p = spine.project;

  // ── loading ──
  if (spine.loading && !p) {
    return (
      <CockpitShell>
        <Card className="glass-card-static">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">載入導演 cockpit…（聚合 creativeProject / worldbuilding / world_storyboards / vault）</div>
          </CardContent>
        </Card>
      </CockpitShell>
    );
  }

  // ── error ──
  if (spine.error && !p) {
    return (
      <CockpitShell>
        <Card className="glass-card-static border-destructive/40">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertTriangle className="size-8 text-destructive" />
            <div className="text-lg font-semibold">導演台連線中斷</div>
            <div className="max-w-md text-sm text-muted-foreground">{spine.error}</div>
            <Button variant="outline" size="sm" onClick={spine.reload}>
              <RefreshCw className="size-4" /> 重試
            </Button>
          </CardContent>
        </Card>
      </CockpitShell>
    );
  }

  // ── empty：未選專案 / 找不到 ──
  if (!p) {
    return (
      <CockpitShell>
        <Card className="glass-card-static">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="text-4xl">🎬</div>
            <div className="text-lg font-semibold">尚未選擇創作專案</div>
            <div className="max-w-md text-sm text-muted-foreground">
              先在頂部專案切換器選一個專案，或用「引導式創作」貼一份長腳本，自動拆幕 / 分鏡、抽角色與場景。
            </div>
            <Button onClick={() => setGuided(true)}>
              <Wand2 className="size-4" /> 開始引導式創作
            </Button>
          </CardContent>
        </Card>
        <GuidedJourney open={guided} onClose={() => setGuided(false)} />
      </CockpitShell>
    );
  }

  // ── empty：專案存在但完全空（無分鏡無角色）──
  const isBlank = p.shots.length === 0 && p.characters.length === 0;

  // Wave 0：非空專案 → 三欄導演台（旗標 ON 時）。導演台自帶頂部創作流程列＋引導式＋光球。
  if (!isBlank && ENABLE_DIRECTOR_CONSOLE) {
    return (
      <CockpitShell>
        <DirectorConsole />
      </CockpitShell>
    );
  }

  return (
    <CockpitShell>
      <StageBar onGuided={() => setGuided(true)} />

      {isBlank ? (
        <Card className="glass-card-static">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Film className="size-9 text-muted-foreground" />
            <div className="text-lg font-semibold">這個專案還是空的</div>
            <div className="max-w-md text-sm text-muted-foreground">
              貼一份長腳本，系統會自動拆幕、建議分鏡、抽出角色與場景，再走確認門 → 排程生成。
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setGuided(true)}>
                <Wand2 className="size-4" /> 開始引導式創作
              </Button>
              <Button variant="outline" onClick={() => spine.createProject("未命名創作", "影片")}>
                <FolderOpen className="size-4" /> 建立空白專案
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        // 3 欄：left(專案+上下文) / center(導演台+確認門) / right(資料庫)
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(300px,360px)]">
          <ContextColumn />
          <DirectorColumn />
          <DatabaseColumn />
        </div>
      )}

      <GuidedJourney open={guided} onClose={() => setGuided(false)} />
    </CockpitShell>
  );
}

/** 座艙外殼（統一外距/最大寬）。 */
function CockpitShell({ children }: { children: ReactNode }) {
  return <div className="flex-1 w-full space-y-4 p-4 sm:p-6">{children}</div>;
}

export default VideoCockpit;
