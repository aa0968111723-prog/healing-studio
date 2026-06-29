// ============================================================================
// shells/video/VideoCockpit.tsx — 導演座艙（W3-G 後：DirectorConsole 常開）
// ----------------------------------------------------------------------------
// 狀態場景：loading / error / empty（未選或空專案）/ success（DirectorConsole）。
// W3-G：刪 columns/* 舊三欄＋ENABLE_DIRECTOR_CONSOLE 旗標（AIDV-52）。
// AIDV-252：新建專案前先選格式（16:9 / 9:16 / 1:1）。
// ============================================================================
import { useState, type ReactNode } from "react";
import { Wand2, Film, FolderOpen, AlertTriangle, RefreshCw, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
} from "@/contexts/PageAgentContext";
import { GuidedJourney } from "./GuidedJourney";
import { DirectorConsole } from "./DirectorConsole";
import { VideoProjectCreateDialog } from "@/components/VideoProjectCreateDialog";
import { trpc } from "@/lib/trpc";

export function VideoCockpit() {
  const spine = useProjectSpine();
  const [guided, setGuided] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [videoProjectId, setVideoProjectId] = useState<number | null>(null);
  const p = spine.project;

  // AIDV-684: 若 requestExport 已快取輸出 URL，顯示下載按鈕
  const exportUrlQ = trpc.videoProject.getExportUrl.useQuery(
    { projectId: videoProjectId! },
    { enabled: videoProjectId != null, retry: false, refetchOnWindowFocus: false }
  );

  useRegisterPageAgent({
    pageId: "video-studio",
    pageLabel: "導演座艙",
    pagePath: "/video",
    capabilities: [
      {
        action: "navigate",
        label: "導航",
        hint: "導航到影片子頁面，例如 /video/video（影片工作室）、/video/image（圖片工作室）",
      },
    ],
    state: {
      modality: "video-cockpit",
      hasProject: !!p,
      projectTitle: p?.name ?? null,
      shotCount: p?.shots.length ?? 0,
      characterCount: p?.characters.length ?? 0,
      loading: spine.loading,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "navigate" && action.path) {
        return { ok: true, message: `導航到 ${action.path}` };
      }
      return { ok: false, reason: `導演座艙不支援動作 "${action.type}"` };
    },
  });

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

  // 非空專案 → DirectorConsole（W3-G：常開，AIDV-52）
  if (!isBlank) {
    const exportData = exportUrlQ.data;
    return (
      <CockpitShell>
        {exportData?.downloadUrl && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400">
            <Download className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">成片已就緒</span>
            <a
              href={exportData.downloadUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold hover:underline shrink-0"
            >
              下載影片
            </a>
          </div>
        )}
        <DirectorConsole />
      </CockpitShell>
    );
  }

  // 空白專案
  return (
    <CockpitShell>
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
            <Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
              <FolderOpen className="size-4" /> 建立空白專案
            </Button>
          </div>
        </CardContent>
      </Card>
      <GuidedJourney open={guided} onClose={() => setGuided(false)} />
      <VideoProjectCreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(vpId, _aspectRatio) => {
          setVideoProjectId(vpId);
          spine.createProject("未命名創作", "影片");
        }}
      />
    </CockpitShell>
  );
}

/** 座艙外殼（統一外距/最大寬）。 */
function CockpitShell({ children }: { children: ReactNode }) {
  return <div className="flex-1 w-full space-y-4 p-4 sm:p-6">{children}</div>;
}

export default VideoCockpit;
