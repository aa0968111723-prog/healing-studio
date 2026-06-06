// ============================================================================
// adapters/generation.trpc.ts — GenerationAdapter（真實 tRPC 版，預設）
// ----------------------------------------------------------------------------
// 🔧 GitNexus 校正（§D.2/§D.3，main HEAD 2888a36）：
//   影像/keyframe 統一入口 = inline `generate.*`（非 imageStudio.generate）：
//      generate.estimateCost → generate.submitStudioJob → 輪詢 generate.jobStatus
//      → generate.recordGenResult（回退鏈每跳的回寫落點）
//   底層逐模型在 imageStudio.<model>（seedreamV4/fluxKontext/nanoBananaPro/imagen4/sd35…）。
//   audio = proStudio.textToMusic / generateMusicSuno / compiledTextToMusic（音樂）、
//           proStudio.elevenLabsTTS / qwenTTS / qwenVoiceDesign（TTS）。
//   video = videoStudio.<model> 已有 ~29 逐模型，但「session/segment 狀態機」待建（M3）→
//           本 adapter 對 kind=video 丟 AdapterPendingError（誠實標示缺口，不假裝可用）。
//
// 【tRPC 邊界型別】procedure 名稱經 GitNexus 驗證存在；確切 zod 輸入 schema 於 P1 接線時
// 對真實 procedure 最終核對（整合指南 §5）。故此處介面為強型別、tRPC 呼叫邊界以
// `client as any` 寬鬆處理，確保此 dormant 檔在 P0 可獨立編譯、零猜測輸入欄位。
// ============================================================================
import type {
  AdapterDeps, GenerationAdapter, GenRequest, GenResult, GenEvent, GenError,
} from "./types";
import { AdapterError, AdapterPendingError } from "./types";
import type { ProviderId } from "@/spine/types";
import { getTrpcClient } from "./trpcClient";

const FALLBACK_CHAIN: ProviderId[] = ["hf", "gemini", "fal", "mock"];
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function toGenError(provider: ProviderId, err: unknown): GenError {
  const anyErr = err as { message?: string; data?: { httpStatus?: number } };
  return {
    provider,
    code: anyErr?.data?.httpStatus ? `HTTP_${anyErr.data.httpStatus}` : "ERR",
    http: anyErr?.data?.httpStatus ?? 0,
    msg: anyErr?.message ?? "generation failed",
  };
}

export function makeGenerationTrpc(deps: AdapterDeps): GenerationAdapter {
  // tRPC 邊界寬鬆化（見檔頭說明）。介面對外仍強型別。
  const client = getTrpcClient() as unknown as any;

  async function estimateCost(req: GenRequest): Promise<{ costUsd: number }> {
    try {
      // 🔧 generate.estimateCost（段落級替代：director.estimateSegmentCost）
      const r = await client.generate.estimateCost.query({
        kind: req.kind, prompt: req.prompt, model: req.model, provider: req.provider ?? deps.getProvider(),
      });
      return { costUsd: Number(r?.costUsd ?? r?.cost ?? 0) };
    } catch (err) {
      throw new AdapterError("estimateCost failed", { seam: "generation", procedure: "generate.estimateCost", cause: err });
    }
  }

  /** 對單一 provider 跑一次完整 job：submit → poll → 回 GenResult。 */
  async function runJob(provider: ProviderId, req: GenRequest, onEvent: (e: GenEvent) => void): Promise<GenResult> {
    const startedAt = Date.now();

    // ── audio：走 proStudio（非 generate.* job）──────────────────────────────
    if (req.kind === "audio") {
      // 🔧 音樂預設 proStudio.textToMusic；TTS 走 proStudio.elevenLabsTTS（中文保底）。
      const isTts = /tts|配音|語音|voice/i.test(req.prompt ?? "");
      const proc = isTts ? "elevenLabsTTS" : "textToMusic";
      const r = await client.proStudio[proc].mutate({ prompt: req.prompt, seed: req.seed, provider });
      return {
        ok: true, provider, seedUsed: Number(r?.seed ?? req.seed),
        model: String(r?.model ?? `proStudio.${proc}`), costUsd: Number(r?.costUsd ?? 0),
        latencyMs: Date.now() - startedAt, assetUrl: r?.url ?? r?.assetUrl, jobId: r?.jobId,
      };
    }

    // ── video：M3 session/segment 狀態機待建（GitNexus 確認缺口）──────────────
    if (req.kind === "video") {
      throw new AdapterPendingError(
        "影片 session/segment 狀態機待建（videoStudio 逐模型已存在，缺 generateSegment 編排）",
        { seam: "generation", procedure: "videoStudio.generateSegment", milestone: "M3" },
      );
    }

    // ── image / keyframe：generate.* 非同步 job ──────────────────────────────
    // 🔧 generate.submitStudioJob（kind=keyframe 走 i2i edit 模型，由 model 指定）
    const submit = await client.generate.submitStudioJob.mutate({
      kind: req.kind, prompt: req.prompt, seed: req.seed, provider,
      model: req.model, shotNo: req.shotNo, projectId: req.projectId,
    });
    const jobId: string = String(submit?.jobId ?? submit?.id ?? "");
    onEvent({ type: "queued", jobId, provider });

    // 🔧 輪詢 generate.jobStatus（亦有 checkStudioJob 為相容別名）
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let last: any = submit;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      last = await client.generate.jobStatus.query({ jobId });
      const status = String(last?.status ?? "");
      onEvent({ type: "poll", jobId, status });
      if (status === "done" || status === "succeeded" || status === "completed") break;
      if (status === "error" || status === "failed") {
        throw new AdapterError(`job ${jobId} ${status}`, { seam: "generation", procedure: "generate.jobStatus", provider });
      }
    }

    const result: GenResult = {
      ok: true, provider,
      seedUsed: Number(last?.seed ?? req.seed),
      model: String(last?.model ?? req.model ?? "imageStudio"),
      costUsd: Number(last?.costUsd ?? 0),
      latencyMs: Date.now() - startedAt,
      assetUrl: last?.assetUrl ?? last?.url,
      jobId,
    };

    // 🔧 generate.recordGenResult — 回退鏈每一跳的回寫落點（asset_generation_events / 資產庫）
    try {
      await client.generate.recordGenResult.mutate({
        jobId, projectId: req.projectId, shotNo: req.shotNo, kind: req.kind,
        provider, model: result.model, costUsd: result.costUsd, seed: result.seedUsed, assetUrl: result.assetUrl,
      });
    } catch {
      /* 回寫失敗不阻斷生成結果回傳；由 Storage seam / 背景修復補償 */
    }
    return result;
  }

  async function generate(req: GenRequest, onEvent: (e: GenEvent) => void = () => {}): Promise<GenResult> {
    // 估價先行（失敗不阻斷生成，僅略過事件）
    try { const est = await estimateCost(req); onEvent({ type: "estimate", costUsd: est.costUsd }); } catch { /* noop */ }

    const preferred = req.provider ?? deps.getProvider();
    const chain = [preferred, ...FALLBACK_CHAIN.filter((p) => p !== preferred)];
    const faults = deps.getFaults();
    let lastErr: unknown = null;

    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i];
      if (faults[provider]) {
        // 故障注入（demo/測試）：視同該 provider 失敗，直接回退。
        const error = { provider, code: "FAULT_INJECTED", http: 503, msg: `${provider} 故障注入` };
        onEvent({ type: "fail", provider, error });
        if (chain[i + 1]) onEvent({ type: "fallback", provider, next: chain[i + 1] });
        lastErr = new AdapterError(error.msg, { seam: "generation", provider });
        continue;
      }
      onEvent({ type: "attempt", provider, step: i });
      try {
        const res = await runJob(provider, req, onEvent);
        onEvent({ type: "success", provider, res, fellBack: provider !== preferred });
        return res;
      } catch (err) {
        if (err instanceof AdapterPendingError) throw err; // 缺口錯誤不該被回退吞掉
        lastErr = err;
        onEvent({ type: "fail", provider, error: toGenError(provider, err) });
        if (chain[i + 1]) onEvent({ type: "fallback", provider, next: chain[i + 1] });
      }
    }
    throw new AdapterError("全部 provider 皆失敗", { seam: "generation", procedure: "generate.submitStudioJob", cause: lastErr });
  }

  return { estimateCost, generate };
}
