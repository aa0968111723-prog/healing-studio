// ============================================================================
// shells/video/console/CreationFlowBar.tsx — 頂部創作流程列 ＋ 常駐確認門/成本儀表
// ----------------------------------------------------------------------------
// 一體成形主軸：頂部流程列串起子系統（點階段 → 切中欄畫布，不整頁離場）。常駐儀表＝
//   確認門讀數 + 成本階梯（provider 階梯／估點／退款風險），只有高成本/刪除/權限才用 modal。
// 流程列反映「可設定工作流」當前啟用步驟集（console_.steps）。
// ============================================================================
import { useMemo, useState } from "react";
import { Wand2, Zap, Wrench, Check, Coins, Brain, Download, PackageOpen, Captions, Star } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole } from "../DirectorConsoleProvider";
import { countGate, isShotGeneratable } from "@/spine/gate";
import { ReadinessChip } from "./ReadinessChip";
import type { ProviderId } from "@/spine/types";
import { trpc } from "@/lib/trpc";
// U-2（AIDV-92）逐殼採用 · /video S2：旗標 ON 時頂部創作流程列改用 design-kit 亮色暖光 FlowBar
// （與 ReadinessChip／ShotPanel／ConfirmGate 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝沿用既有版＝零變化。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, FlowBar as DkFlowBar } from "@/components/design-kit";

/** 生成引擎成本階梯（B 案；對齊原型 PROVIDERS · $/張）。 */
const PROVIDER_LADDER: { id: ProviderId; label: string; cost: number }[] = [
  { id: "hf", label: "HF", cost: 0.012 },
  { id: "gemini", label: "Gemini", cost: 0.02 },
  { id: "fal", label: "fal", cost: 0.04 },
  { id: "mock", label: "Mock", cost: 0 },
];

function AiBrainChip() {
  const { data } = trpc.apiUsage.textLlmStatus.useQuery(undefined, { staleTime: 60_000, retry: false });
  const status = data?.status ?? "offline";
  return (
    <span
      title={status === "online" ? "OpenRouter 已設定" : status === "degraded" ? "僅 Anthropic 備援" : "文字 LLM 未設定"}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status === "online" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        status === "degraded" && "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        status === "offline" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <Brain className="size-3" />
      AI 腦&thinsp;·&thinsp;{status === "online" ? "線上" : status === "degraded" ? "降級" : "離線"}
    </span>
  );
}

export function CreationFlowBar({ onGuided }: { onGuided: () => void }) {
  const spine = useProjectSpine();
  const console_ = useDirectorConsole();
  const p = spine.project!;
  const [exportOpen, setExportOpen] = useState(false);

  const gate = useMemo(() => countGate(p.shots, p.characters, p.scenes), [p]);
  // 可排程數＝與 spine.scheduleGeneration 同一判準（就緒、未過期、未生成），避免「按鈕顯示 N 但點了說沒有」。
  const schedulable = useMemo(
    () => p.shots.filter((s) => isShotGeneratable(s, p.characters, p.scenes) && s.gen.status !== "done").length,
    [p],
  );
  const activeSteps = useMemo(() => console_.steps.filter((s) => s.enabled), [console_.steps]);

  // AIDV-226/232：所有鏡頭生成完成時顯示「匯出素材包」CTA；點擊後展示逐鏡下載連結。
  const exportableShots = useMemo(
    () => p.shots.filter((s) => s.gen.status === "done" && s.gen.assetUrl),
    [p.shots],
  );
  const allDone = p.shots.length > 0 && p.shots.every((s) => s.gen.status === "done");

  return (
    <>
    <Card className="glass-card-static">
      <CardContent className="space-y-3 py-3">
        {/* 創作流程列（一體成形主軸） */}
        <div className="flex flex-wrap items-center gap-2">
          {ENABLE_AIDV_CHROME ? (
            // 旗標 ON：頂部流程列改用 design-kit FlowBar（薄 adapter WorkflowStep→DkWorkflowStep 取 4 欄）。
            // current＝目前畫布模式對應的啟用步驟索引（找不到退 0）；onJump 接回既有「待後端 toast / setCanvasMode」。
            <AidvKit className="flex flex-1">
              <DkFlowBar
                steps={activeSteps.map((s) => ({ id: s.id, name: s.name, required: s.required, enabled: s.enabled }))}
                current={Math.max(0, activeSteps.findIndex((s) => s.canvasMode === console_.canvasMode))}
                onJump={(i) => {
                  const st = activeSteps[i];
                  if (!st) return;
                  if (st.pending) { toast(`「${st.name}」待後端`, { description: "此步驟尚無後端接點，先佔位。" }); return; }
                  if (st.canvasMode) console_.setCanvasMode(st.canvasMode);
                }}
              />
            </AidvKit>
          ) : (
            <ol className="flex flex-1 flex-wrap items-center gap-1">
              {activeSteps.map((st, i) => {
                const active = st.canvasMode === console_.canvasMode;
                const done = i < p.stageIndex;
                return (
                  <li key={st.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (st.pending) { toast(`「${st.name}」待後端`, { description: "此步驟尚無後端接點，先佔位。" }); return; }
                        if (st.canvasMode) console_.setCanvasMode(st.canvasMode);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-healing",
                        active && "bg-primary text-primary-foreground shadow-sm",
                        !active && done && "bg-primary/15 text-primary",
                        !active && !done && "bg-muted text-muted-foreground hover:bg-muted/70",
                      )}
                      title={st.pending ? "待後端" : undefined}
                    >
                      <span className="inline-flex size-4 items-center justify-center rounded-full bg-background/30 text-[10px]">
                        {done ? <Check className="size-3" /> : i + 1}
                      </span>
                      {st.name}
                      {!st.required && <span className="text-[9px] opacity-70">可選</span>}
                    </button>
                    {i < activeSteps.length - 1 && <span className="mx-0.5 h-px w-3 bg-border" aria-hidden />}
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => console_.openDrawer("workflow")}>
              <Wrench className="size-4" /> 工作流
            </Button>
            <Button variant="outline" size="sm" onClick={onGuided}>
              <Wand2 className="size-4" /> 引導式創作
            </Button>
            {allDone && exportableShots.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
                <PackageOpen className="size-4" /> 匯出素材包（{exportableShots.length}）
              </Button>
            )}
            <Button size="sm" onClick={() => spine.scheduleGeneration()} disabled={schedulable === 0}>
              <Zap className="size-4" /> 生成就緒鏡（{schedulable}）
            </Button>
          </div>
        </div>

        {/* 常駐確認門 + 成本儀表 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-2.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">確認門</span>
            <ReadinessChip state="ready" label={`可量產 ${gate.ready}`} />
            <ReadinessChip state="partial" label={`部分 ${gate.partial}`} />
            <ReadinessChip state="blocked" label={`擋下 ${gate.blocked}`} />
          </div>

          <div className="flex items-center gap-1.5">
            <Coins className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">成本階梯</span>
            {PROVIDER_LADDER.map((pv) => (
              <button
                key={pv.id}
                type="button"
                onClick={() => spine.setProvider(pv.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-healing",
                  spine.provider === pv.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50",
                )}
                title={`切換生成引擎 → ${pv.label}`}
              >
                {pv.label} ${pv.cost}
              </button>
            ))}
          </div>

          <span className="text-muted-foreground">
            先估成本 · 失敗 <span className="text-emerald-600 dark:text-emerald-400">全額退還</span>
            {gate.stale > 0 && <span className="ml-2 text-amber-600 dark:text-amber-400">· {gate.stale} 鏡過期</span>}
          </span>

          <AiBrainChip />
        </div>
      </CardContent>
    </Card>

    {/* AIDV-226/232：素材包下載對話框 — 逐鏡下載連結 + 全部下載 */}
    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="size-5" /> 匯出素材包
          </DialogTitle>
          <DialogDescription>
            {exportableShots.length} 個鏡頭已生成完畢。點 ★ 指定封面幀（社群媒體上傳封面），點「下載」取得個別媒體檔，或「全部下載」依序開啟所有連結。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {exportableShots.map((sh) => {
            const isCover = p.coverShotId === sh.id;
            return (
              <div key={sh.id} className={cn(
                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
                isCover && "border-primary bg-primary/5",
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary shrink-0">{sh.no}</span>
                  <span className="truncate text-foreground">{sh.title}</span>
                  {sh.gen.provider && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">{sh.gen.provider}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* AIDV-246：封面幀選擇按鈕（★ 選取／取消） */}
                  <button
                    type="button"
                    onClick={() => spine.setCoverShot(isCover ? null : sh.id)}
                    title={isCover ? "取消封面選擇" : "設為封面"}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                      isCover
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Star className={cn("size-3", isCover && "fill-primary")} />
                    {isCover ? "封面" : "設封面"}
                  </button>
                  <a
                    href={`/api/media/download?url=${encodeURIComponent(sh.gen.assetUrl!)}&filename=${encodeURIComponent(`${sh.no}.mp4`)}`}
                    download
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1",
                      "text-[11px] font-medium text-foreground hover:bg-muted transition-colors",
                    )}
                  >
                    <Download className="size-3" /> 下載
                  </a>
                </div>
              </div>
            );
          })}
        </div>
        {/* AIDV-234：字幕 / CC 區段——明確標示「待語音軌就緒」，不靜默 no-op */}
        <div className="border-t pt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Captions className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">字幕 / CC（SRT · VTT）</span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-600 dark:text-amber-400">待語音軌</span>
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            自動字幕需先完成語音配音（voiceCompiler）。語音功能啟用後，此處將提供 .srt / .vtt 下載，符合 YouTube / TikTok CC 要求。
          </p>
        </div>

        {exportableShots.length > 1 && (
          <div className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                exportableShots.forEach((sh, i) => {
                  setTimeout(() => {
                    const a = document.createElement("a");
                    a.href = `/api/media/download?url=${encodeURIComponent(sh.gen.assetUrl!)}&filename=${encodeURIComponent(`${sh.no}.mp4`)}`;
                    a.download = `${sh.no}.mp4`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }, i * 400);
                });
              }}
            >
              <Download className="size-4" /> 全部下載（{exportableShots.length} 個，依序開啟）
            </Button>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              瀏覽器可能提示允許多個下載，請點「允許」。
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

export default CreationFlowBar;
