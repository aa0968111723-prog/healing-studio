// ============================================================================
// shells/video/canvas/VoiceAmbientCanvas.tsx — 中欄畫布：2-5 配音 / 環境音（接真實 proStudio.*）
// ----------------------------------------------------------------------------
// 真實 procedure（typed trpc hooks → fal.ai 非同步佇列）：
//   proStudio.qwenTTS（無需額外金鑰，FAL_API_KEY 即可）— 預設配音路徑
//   proStudio.elevenLabsTTS（需 ELEVENLABS_API_KEY，無則 PRECONDITION_FAILED）
//   proStudio.soundEffects（環境音 / 音效）
// 成本原子性：先以 generate.estimateCost 估點（不扣）→ 確認 → proStudio.* 提交（伺服器先扣、
//   失敗全額退）。提交後進 background_jobs 非同步佇列，完成後在資產庫。
// AIDV-254：旁白語音風格選擇器 — proStudio.voiceStyles（既有 elevenLabsExtended /
//   Qwen 內建聲線目錄）→ 選定後以 qwenTTS.voice / elevenLabsTTS.voice_id 傳參；
//   「系統預設」不傳參＝與既有行為位元相同（加性、預設不變）。
// ============================================================================
import { useState } from "react";
import { Mic, Waves, Loader2, Coins, CircleCheck, WifiOff, CheckCircle2, AlertCircle, AudioLines } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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

/**
 * AIDV-254 語音風格選擇器的「系統預設」哨兵值（Radix SelectItem 不允許空字串）。
 * 選此值時提交請求**不帶** voice / voice_id 參數 → 請求體與加此功能前位元相同。
 */
export const VOICE_STYLE_DEFAULT = "__default__";

/**
 * AIDV-254：把（引擎 × 文字 × 語音風格）組成 proStudio.* 提交輸入（純函式，doSubmit 唯一來源）。
 *   - qwenTTS        → { text, voice }（Qwen 預訓練聲線名稱）
 *   - elevenLabsTTS  → { text, voice_id }（ElevenLabs voice_id）
 *   - soundEffects   → 不吃聲線（環境音），維持既有 500 字截斷＋固定秒數
 * 「系統預設」（VOICE_STYLE_DEFAULT）→ voice/voice_id 為 undefined＝序列化後不出現在
 * 請求體，與加此功能前的請求位元相同（加性、預設不變）。
 */
export function buildVoiceSubmitInput(engine: Engine, text: string, voiceStyle: string) {
  const chosenVoice = voiceStyle !== VOICE_STYLE_DEFAULT ? voiceStyle : undefined;
  if (engine === "qwenTTS") {
    return { engine, input: { text, voice: chosenVoice } } as const;
  }
  if (engine === "elevenLabsTTS") {
    return { engine, input: { text, voice_id: chosenVoice } } as const;
  }
  return {
    engine,
    input: { text: text.slice(0, 500), duration_seconds: AMBIENT_DURATION_SEC },
  } as const;
}

export function VoiceAmbientCanvas() {
  const utils = trpc.useUtils();
  const qwen = trpc.proStudio.qwenTTS.useMutation();
  const eleven = trpc.proStudio.elevenLabsTTS.useMutation();
  const sfx = trpc.proStudio.soundEffects.useMutation();

  const [engine, setEngine] = useState<Engine>("qwenTTS");
  const [text, setText] = useState("");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState<{ requestId: string; credits: number } | null>(null);
  // AIDV-254：語音風格（旁白聲線）。預設＝系統預設（不傳參數，行為與既有完全相同）。
  const [voiceStyle, setVoiceStyle] = useState<string>(VOICE_STYLE_DEFAULT);
  const meta = ENGINES.find((e) => e.id === engine)!;

  // AIDV-254：既有語音清單（elevenLabsExtended builtin voices ＋ Qwen 內建聲線）。
  // 唯讀目錄、快取 10 分鐘；查詢失敗時選擇器僅剩「系統預設」＝行為不變。
  const voiceStylesQ = trpc.proStudio.voiceStyles.useQuery(undefined, {
    staleTime: 600_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const voiceOptions =
    engine === "elevenLabsTTS"
      ? voiceStylesQ.data?.elevenlabs ?? []
      : engine === "qwenTTS"
        ? voiceStylesQ.data?.qwen ?? []
        : [];
  const selectedVoice = voiceOptions.find((v) => v.id === voiceStyle);

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
      // AIDV-254：語音風格傳參 — 統一走 buildVoiceSubmitInput（「系統預設」不帶參數
      // ＝與既有請求位元相同；指定聲線時 Qwen 走 voice、ElevenLabs 走 voice_id）。
      const built = buildVoiceSubmitInput(engine, t, voiceStyle);
      let res: { request_id: string; estimated_credits: number };
      if (built.engine === "qwenTTS") res = await qwen.mutateAsync(built.input);
      else if (built.engine === "elevenLabsTTS") res = await eleven.mutateAsync(built.input);
      else res = await sfx.mutateAsync(built.input);
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
              onClick={() => { setEngine(e.id); setEstimate(null); setSubmitted(null); setVoiceStyle(VOICE_STYLE_DEFAULT); }}
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

      {/* AIDV-254：旁白語音風格選擇器 — 只在 TTS 引擎顯示（環境音無聲線概念）。
          清單來自既有 proStudio.voiceStyles（elevenLabsExtended / Qwen 內建聲線）；
          「系統預設」＝不傳 voice 參數＝與加此功能前行為位元相同。 */}
      {!meta.ambient && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <AudioLines className="size-3.5 text-primary" aria-hidden /> 語音風格
          </span>
          <Select value={voiceStyle} onValueChange={(v) => { setVoiceStyle(v); setSubmitted(null); }}>
            <SelectTrigger className="h-8 w-56 text-xs" aria-label="語音風格">
              <SelectValue placeholder="系統預設" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={VOICE_STYLE_DEFAULT} className="text-xs">
                系統預設{engine === "qwenTTS" ? "（Vivian・中文女聲）" : ""}
              </SelectItem>
              {voiceOptions.map((v) => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  {v.name} · {v.gender === "female" ? "女聲" : "男聲"} · {v.language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {voiceStylesQ.isError && (
            <span className="text-[10px] text-muted-foreground">聲線清單載入失敗 · 仍可用系統預設</span>
          )}
          {selectedVoice && (
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={selectedVoice.description}>
              {selectedVoice.description}
            </span>
          )}
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
