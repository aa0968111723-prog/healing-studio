// ============================================================================
// shells/video/canvas/AssetGenCanvas.tsx — 中欄畫布：2-3 多模態素材創作（站內生成 → fal）
// ----------------------------------------------------------------------------
// 站內生成走「既有 Generation 接縫」useSpine().adapters.generation.generate：
//   generate.estimateCost → submitStudioJob → 輪詢 jobStatus → recordGenResult（底層 imageStudio.* → fal.ai）。
//   先估成本 → 先扣後生成（原子）→ 失敗全額退還 + 回退鏈 hf→gemini→fal（事件以 toast 告知）。
//   接縫內部已 recordGenResult 回寫 digital_asset_library，產出落庫。
// 存庫走 promptLibrary.create（§9 生成→存庫→重用）。
// 注意：本畫布只做「自由素材」生成；綁定特定鏡頭的生成在「分鏡」畫布（ShotDetailCanvas）走
//   spine.generateShot，才會正確更新該鏡 gen 狀態/確認門（兩條路徑不混用，避免狀態不同步）。
// 上傳自有／外部 AI 帶入：正式 procedure 待後端（標示，不偽裝成已接）。
// ============================================================================
import { useState } from "react";
import { ImagePlus, Loader2, Sparkles, Save, Upload, Link2, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSpine } from "@/providers/SpineProvider";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { isCostBlockedError } from "@/adapters/genErrorToast";
import { useDirectorConsole } from "../DirectorConsoleProvider";
import { frameStyle } from "@/spine/seedVisual";
import { trpc } from "@/lib/trpc";
import type { GenResult } from "@/adapters/types";
// U-5（AIDV-95）採用片 · /video S2-3 生成：旗標 ON 時生成結果/載入/錯誤/待後端改用 design-kit
// 亮色暖光四態（LoadingState/ErrorState/EmptyState）+ Pill + Card；OFF（預設）＝既有 shadcn 版＝零變化。
// 動作接點（run / saveToVault / 切 tab）完全一致，僅換視覺殼。
import { ENABLE_VIDEO_GATE_KIT } from "@/config/videoFlags";
import { AidvKit, Card, Pill, LoadingState, ErrorState, EmptyState } from "@/components/design-kit";

const IMAGE_MODELS = ["nano-banana-2", "seedream-v4", "imagen4", "flux-pro/v1.1"];

type Tab = "gen" | "upload" | "external";

export function AssetGenCanvas() {
  const sp = useSpine();
  const spine = useProjectSpine();
  const console_ = useDirectorConsole();
  const p = spine.project!;
  const savePrompt = trpc.promptLibrary.create.useMutation();

  const [tab, setTab] = useState<Tab>("gen");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(IMAGE_MODELS[0]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<(GenResult & { prompt: string }) | null>(null);

  const run = async () => {
    if (!prompt.trim() || status === "running") return;
    const seed = 1000 + Math.floor(Math.random() * 9000);
    setStatus("running");
    setResult(null);
    try {
      const res = await sp.adapters.generation.generate(
        {
          kind: "image",
          prompt: prompt.trim(),
          seed,
          provider: sp.provider,
          model,
          projectId: Number(p.id) || undefined,
        },
        (e) => {
          if (e.type === "estimate") toast(`先估成本：$${e.costUsd.toFixed(3)}`, { description: "先扣後生成 · 失敗全額退還" });
          else if (e.type === "fail") toast.warning(`${e.provider} 生成失敗`, { description: `HTTP ${e.error.http} · 自動回退` });
          else if (e.type === "fallback") {
            toast(`自動回退引擎：${e.provider} → ${e.next}`, {
              // AIDV-160：白話說明跨到哪個 provider、是否扣點（同付費層回退才會走到這裡）。
              description: e.crossesToPaid
                ? `改用付費引擎 ${e.next}（會扣點）`
                : `改用同層引擎 ${e.next}（同付費層，計費方式不變）`,
            });
          } else if (e.type === "cost-blocked") {
            // AIDV-160：免費引擎不可用，守門不無聲跨付費 → 明確告知、不扣點。
            toast.error("免費引擎暫時無法使用 · 未扣點", { description: e.reason });
          }
        },
      );
      setResult({ ...res, prompt: prompt.trim() });
      setStatus("done");
      toast.success("生成完成 · 已寫回資產庫", { description: `${res.model} · seed ${res.seedUsed} · ${res.provider}` });
    } catch (err) {
      // AIDV-160：成本守門中止不是硬失敗——友善「免費引擎暫時無法使用 · 未扣點」
      // toast 已於上方事件處理器顯示。回 idle（可改選引擎重試），且**不**再 fire
      // 通用「生成失敗」toast，避免雙 toast 與矛盾的硬失敗語氣（恰好一個冷靜 toast）。
      if (isCostBlockedError(err)) { setStatus("idle"); return; }
      setStatus("error");
      toast.error("生成失敗", { description: err instanceof Error ? err.message : "全部 provider 皆失敗，積分已退還" });
    }
  };

  const saveToVault = () => {
    if (!result) return;
    const title = result.prompt.slice(0, 40);
    savePrompt.mutate(
      { title, content: result.prompt, category: "image", modelHint: result.model },
      {
        onSuccess: () => toast.success("已存入提示詞庫 · 可重用", { description: "promptLibrary.create" }),
        onError: (e) => toast.error("存庫失敗", { description: e.message }),
      },
    );
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ImagePlus className="size-3.5 text-primary" /> 多模態素材 · 自由素材生成（綁定鏡頭請到「分鏡」畫布）
      </div>

      {/* 來源 tab */}
      <div className="flex gap-1.5">
        <Button size="sm" variant={tab === "gen" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setTab("gen")}>站內生成</Button>
        <Button size="sm" variant={tab === "upload" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setTab("upload")}>
          <Upload className="size-3" /> 上傳自有
        </Button>
        <Button size="sm" variant={tab === "external" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setTab("external")}>
          <Link2 className="size-3" /> 外部 AI 帶入
        </Button>
      </div>

      {tab === "gen" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">模型</span>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {IMAGE_MODELS.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-muted-foreground" onClick={() => console_.setCanvasMode("shot")}>
              <Film className="size-3.5" /> 去分鏡生成
            </Button>
          </div>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="輸入提示詞…（必填）"
            className="min-h-[88px] resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPrompt((v) => (v.trim() || "雪山晨霧空景") + "，療癒繪本風，暖色調，留白構圖，柔和晨光")}>
              <Sparkles className="size-3.5" /> 智慧編譯提詞
            </Button>
            <span className="text-[10px] text-muted-foreground">引擎：{sp.provider} · 先估再生成</span>
            <Button size="sm" className="ml-auto" onClick={() => void run()} disabled={status === "running" || !prompt.trim()}>
              {status === "running" ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} 估算成本並生成
            </Button>
          </div>

          {/* 旗標 ON：生成中 / 失敗用 design-kit 四態（載入/錯誤）；OFF＝既有 toast 流程不另呈現。 */}
          {ENABLE_VIDEO_GATE_KIT && status === "running" && (
            <AidvKit><LoadingState label="生成中…先估成本 · 先扣後生成 · 失敗全額退還" /></AidvKit>
          )}
          {ENABLE_VIDEO_GATE_KIT && status === "error" && (
            <AidvKit>
              <ErrorState
                title="生成失敗"
                message="全部 provider 皆失敗，積分已退還。可調整提示詞後重試。"
                onRetry={() => void run()}
              />
            </AidvKit>
          )}

          {result && status === "done" && (
            ENABLE_VIDEO_GATE_KIT ? (
              <AidvKit>
                <Card className="flex gap-3 p-3">
                  <div className="size-24 shrink-0 rounded-[12px] border border-[var(--line)]" style={{ background: frameStyle(result.seedUsed, 0) }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[var(--text)]">生成完成</span>
                      <Pill kind="ok">已寫回資產庫</Pill>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                      {result.model} · seed {result.seedUsed} · {result.provider} · ${result.costUsd.toFixed(3)}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={saveToVault} disabled={savePrompt.isPending}>
                        <Save className="size-3.5" /> 存入提示詞庫
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setResult(null); setStatus("idle"); }}>
                        再生一張
                      </Button>
                    </div>
                  </div>
                </Card>
              </AidvKit>
            ) : (
              <div className="flex gap-3 rounded-xl border bg-card/60 p-3">
                <div className="size-24 shrink-0 rounded-lg" style={{ background: frameStyle(result.seedUsed, 0) }} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">生成完成</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {result.model} · seed {result.seedUsed} · {result.provider} · ${result.costUsd.toFixed(3)}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={saveToVault} disabled={savePrompt.isPending}>
                      <Save className="size-3.5" /> 存入提示詞庫
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setResult(null); setStatus("idle"); }}>
                      再生一張
                    </Button>
                  </div>
                </div>
              </div>
            )
          )}
        </>
      )}

      {tab !== "gen" && (
        ENABLE_VIDEO_GATE_KIT ? (
          <AidvKit>
            <Card className="p-5">
              <div className="mb-3 flex justify-center"><Pill kind="mute">待後端</Pill></div>
              <EmptyState
                icon={tab === "upload" ? <Upload className="size-5" aria-hidden /> : <Link2 className="size-5" aria-hidden />}
                title={tab === "upload" ? "上傳自有素材" : "外部 AI 帶入"}
                hint={tab === "upload"
                  ? "正式上傳 procedure 待後端（現況走 R2/S3 直傳；digital_asset_library 尚無 upload sourceStudio 值）。"
                  : "外部匯入 procedure 待後端（digital_asset_library 尚無 external sourceStudio 值）。外部素材不扣積分、進分鏡仍走確認門。"}
              />
            </Card>
          </AidvKit>
        ) : (
          <div className="rounded-xl border border-dashed bg-card/40 p-5 text-center">
            <Badge variant="outline" className="mb-2 text-[10px]">待後端</Badge>
            <div className="text-sm font-medium">
              {tab === "upload" ? "上傳自有素材" : "外部 AI 帶入"}
            </div>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {tab === "upload"
                ? "正式上傳 procedure 待後端（現況走 R2/S3 直傳；digital_asset_library 尚無 upload sourceStudio 值）。"
                : "外部匯入 procedure 待後端（digital_asset_library 尚無 external sourceStudio 值）。外部素材不扣積分、進分鏡仍走確認門。"}
            </p>
          </div>
        )
      )}
    </div>
  );
}

export default AssetGenCanvas;
