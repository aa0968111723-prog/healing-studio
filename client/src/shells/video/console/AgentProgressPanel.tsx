// ============================================================================
// shells/video/console/AgentProgressPanel.tsx — AIDV-358 代理即時狀態面板
// ----------------------------------------------------------------------------
// 讓創作者看見哪個代理正在做什麼（圖像/影片/配音…），解決代理對創作者完全不透明問題。
// 資料來源：trpc.generate.myJobs（每 5s polling；顯示活躍 + 最近 5 分鐘已完成任務）
// 純前端輪詢、設計門自動通過（零新後端）。SSE 升級待 AIDV-344（Supabase Realtime 就緒後）。
// ============================================================================
import { useMemo } from "react";
import { Bot, CheckCircle2, XCircle, Loader2, Clock, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { PanelError } from "@/shells/_shared/PanelState";

const JOB_LABELS: Record<string, string> = {
  image: "圖像生成",
  video: "影片生成",
  audio: "配音",
  voice: "語音",
  zip_export: "成片匯出",
  multimodal: "多模態",
  model_training: "模型訓練",
  teaching_archive_ingestion: "素材整理",
};

const RECENT_MS = 5 * 60_000;

function relativeTime(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s 前`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m 前` : `${Math.round(min / 60)}h 前`;
}

export function AgentProgressPanel() {
  const jobs = trpc.generate.myJobs.useQuery(undefined, {
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  const visible = useMemo(() => {
    if (!jobs.data) return [];
    const now = Date.now();
    return jobs.data
      .filter(j => {
        if (j.status === "queued" || j.status === "processing") return true;
        return now - new Date(j.updatedAt).getTime() < RECENT_MS;
      })
      .slice(0, 5);
  }, [jobs.data]);

  const activeCount = visible.filter(j => j.status === "queued" || j.status === "processing").length;

  return (
    <Card className="glass-card-static">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="size-4 text-primary" /> 代理活動
          {activeCount > 0 ? (
            <Badge variant="secondary" className="ml-auto animate-pulse text-[10px]">
              {activeCount} 活躍
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto text-[10px]">空閒</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {jobs.isError ? (
          <PanelError compact message="代理狀態讀取失敗" onRetry={() => jobs.refetch()} />
        ) : jobs.isLoading ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> 讀取代理狀態…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" /> 無活躍代理 · 提交任務後代理狀態會顯示在這裡。
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map(j => (
              <li key={j.id} className="rounded-lg border bg-muted/30 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  {j.status === "processing" && (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                  )}
                  {j.status === "queued" && (
                    <Clock className="size-3.5 shrink-0 text-amber-500" />
                  )}
                  {j.status === "completed" && (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                  )}
                  {j.status === "failed" && (
                    <XCircle className="size-3.5 shrink-0 text-destructive" />
                  )}
                  {j.status === "cancelled" && (
                    <AlertCircle className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {JOB_LABELS[j.jobType] ?? j.jobType} Agent
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {relativeTime(j.createdAt)}
                  </span>
                </div>

                {j.progressMessage && (
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {j.progressMessage}
                  </p>
                )}

                {j.status === "processing" && j.progress > 0 && (
                  <Progress value={j.progress} className="mt-1.5 h-1" />
                )}

                {j.status === "failed" && j.errorMessage && (
                  <p className="mt-1 truncate text-[10px] text-destructive">
                    {j.errorMessage.slice(0, 80)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          每 5 秒自動更新 · 顯示活躍中及最近 5 分鐘的任務
        </p>
      </CardContent>
    </Card>
  );
}

export default AgentProgressPanel;
