// ============================================================================
// shells/video/canvas/VoiceAmbientCanvas.tsx — 中欄畫布：2-5 配音 / 環境音（接真實 proStudio.*）
// ----------------------------------------------------------------------------
// 真實 procedure（typed trpc hooks → fal.ai 非同步佇列）：
//   proStudio.qwenTTS（無需額外金鑰，FAL_API_KEY 即可）— 預設配音路徑
//   proStudio.elevenLabsTTS（需 ELEVENLABS_API_KEY，無則 PRECONDITION_FAILED）
//   proStudio.soundEffects（環境音 / 音效）
// 成本原子性：先以 generate.estimateCost 估點（不扣）→ 確認 → proStudio.* 提交（伺服器先扣、
//   失敗全額退）。提交後進 background_jobs 非同步佇列，完成後在資產庫。
// ============================================================================
import { useState } from "react";
import { Mic, Waves, Loader2, Coins, CircleCheck, WifiOff, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
// U-5 續（AIDV-149）採用片 · /video S6 配音/環境音：旗標 ON 時送出成功態改用 design-kit 暖光 Card + Pill；OFF＝沿用原版。
import { ENABLE_VIDEO_GATE_KIT } from "@/config/videoFlags";
import { AidvKit, Card as DkCard, Pill } from "@/components/design-kit";

type Engine = "qwenTTS" | "elevenLabsTTS" | "soundEffects";

const ENGINES: { id: Engine; label: string; needsKey?: boolean; ambient?: boolean }[] = [
  { id: "qwenTTS", label: "配音 · Qwen TTS（無需金鑰）" },
  { id: "elevenLabsTTS", label: "配音 · ElevenLabs（需金鑰）", needsKey: true },
  { id: "soundEffects", label: "環境音 / 音效", ambient: true },
];

/** 環境音預設秒數：估算與提交共用同一值，避免「估點 < 實扣」。 */
const AMBIENT_DURATION_SEC = 6;

export function VoiceAmbientCanvas() {
  const utils = trpc.useUtils();
  const qwen = trpc.proStudio.qwenTTS.useMutation();
  const eleven = trpc.proStudio.elevenLabsTTS.useMutation();
  const sfx = trpc.proStudio.soundEffects.useMutation();

  const [engine, setEngine] = useState<Engine>("qwenTTS");
  const [text, setText] = useState("");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<{ requestId: string; credits: number } | null>(null);
  const meta = ENGINES.find((e) => e.id === engine)!;

  const busy = qwen.isPending || eleven.isPending || sfx.isPending;

  // AIDV-860: fal.ai provider health — stale 60s, non-blocking
  const providerStatusQ = trpc.brain.providerSystemStatus.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 90_000,
    refetchOnWindowFocus: false,
  });
  const falDown =
    !providerStatusQ.isLoading &&
    !!providerStatusQ.data &&
    providerStatusQ.data.affectedProviders.includes("fal");
  // ElevenLabs routes directly (not fal.ai), so only qwenTTS + soundEffects are blocked when fal is down.
  const currentEngineDown = falDown && engine !== "elevenLabsTTS";

  const doEstimate = async () => {
    if (!text.trim()) return;
    setSubmitted(null);
    try {
      const r = await utils.generate.estimateCost.fetch(
        meta.ambient
          ? { generationType: "audio", durationSec: AMBIENT_DURATION_SEC }
          : { generationType: "voice", charCount: text.trim().length },
      );
      const pts = readPts(r);
      setEstimate(pts);
      toast(`估算成本：約 ${pts} pts`, { description: "確認後先扣後生成 · 失敗全額退還" });
    } catch (e) {
      toast.error("估算失敗", { description: e instanceof Error ? e.message : "generate.estimateCost 無回應" });
    }
  };

  const doSubmit = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      let res: { request_id: string; estimated_credits: number };
      if (engine === "qwenTTS") res = await qwen.mutateAsync({ text: t });
      else if (engine === "elevenLabsTTS") res = await eleven.mutateAsync({ text: t });
      else res = await sfx.mutateAsync({ text: t.slice(0, 500), duration_seconds: AMBIENT_DURATION_SEC });
      setSubmitted({ requestId: res.request_id, credits: res.estimated_credits });
      toast.success("已送出生成佇列", { description: `已扣 ${res.estimated_credits} pts（失敗全額退還）· 背景處理中` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "proStudio 無回應";
      toast.error("送出失敗", {
        description: meta.needsKey && /key|金鑰|PRECONDITION/i.test(msg) ? "需要 ELEVENLABS_API_KEY（待後端設定）" : msg,
      });
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {meta.ambient ? <Waves className="size-3.5 text-primary" /> : <Mic className="size-3.5 text-primary" />}
        配音 / 環境音 · proStudio → fal.ai
        <span role="status" aria-live="polite" className="ml-auto flex items-center gap-1 text-[10px]">
          {providerStatusQ.isError ? (
            <><AlertCircle className="size-3 text-destructive" aria-hidden="true" /><span className="text-destructive">狀態查詢失敗</span></>
          ) : !providerStatusQ.isLoading && providerStatusQ.data && (
            falDown
              ? <><WifiOff className="size-3 text-destructive" aria-hidden="true" /><span className="text-destructive">fal 離線</span></>
              : <><CheckCircle2 className="size-3 text-green-600" aria-hidden="true" /><span className="text-green-600">fal 正常</span></>
          )}
        </span>
      </div>

      {falDown && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span>配音引擎目前無法使用（fal.ai 服務中斷），包含 <strong>Qwen TTS</strong> 與<strong>環境音</strong>。ElevenLabs 金鑰可用時可嘗試直連。</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {ENGINES.map((e) => {
          const isFalBased = e.id !== "elevenLabsTTS";
          const isDown = falDown && isFalBased;
          return (
            <Button
              key={e.id}
              size="sm"
              variant={engine === e.id ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => { setEngine(e.id); setEstimate(null); setSubmitted(null); }}
            >
              {falDown && (
                <span
                  className={`inline-block size-1.5 rounded-full shrink-0 mr-1 ${isDown ? "bg-destructive" : "bg-amber-400"}`}
                  aria-hidden
                />
              )}
              {e.label}
            </Button>
          );
        })}
      </div>

      {meta.needsKey && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          ElevenLabs 需 <span className="font-mono">ELEVENLABS_API_KEY</span>（後端設定）；未設定會回 PRECONDITION_FAILED。
          {falDown ? " Qwen TTS / 環境音目前不可用（fal.ai 中斷），有金鑰時 ElevenLabs 仍可嘗試。" : " 無金鑰請改用 Qwen TTS。"}
        </div>
      )}

      <Textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setEstimate(null); }}
        placeholder={meta.ambient ? "描述環境音 / 音效（如：雪山風聲、溪流、寺院鐘聲）…" : "輸入要配音的旁白文字…"}
        className="min-h-[100px] resize-none text-sm"
        maxLength={meta.ambient ? 500 : 5000}
      />

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void doEstimate()} disabled={busy || !text.trim()}>
          <Coins className="size-4" /> 估算成本
        </Button>
        {estimate !== null && <Badge variant="secondary" className="text-[10px]">約 {estimate} pts</Badge>}
        <Button size="sm" className="ml-auto" onClick={() => void doSubmit()} disabled={busy || !text.trim() || currentEngineDown}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} 確認生成
        </Button>
      </div>

      {submitted && (
        ENABLE_VIDEO_GATE_KIT ? (
          <AidvKit>
            <DkCard className="border-[rgba(92,138,85,.26)] bg-[var(--ok-tint)]" role="status" aria-live="polite" aria-label="配音送出成功">
              <div className="flex items-center gap-2 px-[14px] py-[10px] text-[12px]">
                <CircleCheck className="size-4 text-[var(--ok)] shrink-0" aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-[var(--ok)]">已送出佇列</span>
                  <span className="ml-1 font-mono text-[10px] text-[var(--text-mute)]">{submitted.requestId.slice(0, 18)}…</span>
                </span>
                <Pill kind="ok">已扣 {submitted.credits} pts</Pill>
              </div>
              <p className="px-[14px] pb-[10px] font-mono text-[9.5px] text-[var(--muted-2)]">完成後輸出至資產庫 · 失敗全額退還</p>
            </DkCard>
          </AidvKit>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border bg-card/60 p-3 text-xs">
            <CircleCheck className="size-4 text-emerald-500" />
            <span className="flex-1">
              已送出佇列 · <span className="font-mono text-[10px] text-muted-foreground">{submitted.requestId.slice(0, 18)}…</span>
              <span className="ml-1 text-muted-foreground">已扣 {submitted.credits} pts · 完成後在資產庫</span>
            </span>
          </div>
        )
      )}
    </div>
  );
}

/** 從 generate.estimateCost 多形輸出取點數。 */
function readPts(r: unknown): number {
  const o = r as { pointsCost?: number; points?: number; pointsBreakdown?: { total?: number } } | null;
  return Math.round(o?.pointsCost ?? o?.points ?? o?.pointsBreakdown?.total ?? 0);
}

export default VoiceAmbientCanvas;
