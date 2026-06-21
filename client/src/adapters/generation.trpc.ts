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
import { AdapterError, AdapterPendingError, AdapterCostBlockedError } from "./types";
import type { ProviderId } from "@/spine/types";
import { getTrpcClient } from "./trpcClient";
import {
  ENABLE_COST_CONSENT_GUARD, providerCostTier, isFreeProvider, isPaidProvider,
} from "./costTier";

const FALLBACK_CHAIN: ProviderId[] = ["hf", "gemini", "fal", "mock"];
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 成本層級感知的回退鏈（AIDV-160 成本同意原則）。
 *
 * 守門 ON（預設）時：
 *   - preferred 為 **免費**（mock）→ 回退候選只保留其他「免費」provider（今天只有 mock 一個 →
 *     沒有同層替代）。**絕不把付費 provider 接到免費引擎後面**，杜絕「免費引擎失敗 →
 *     無聲換 hf 生成扣點」。
 *   - preferred 為 **付費**（hf/gemini/fal）→ 回退候選只保留其他「付費」provider，
 *     維持 hf↔gemini↔fal 既有便利；剔除尾端 mock（避免付費任務莫名落到 prod 不可用的免費兜底）。
 *
 * 守門 OFF（VITE_ENABLE_COST_CONSENT_GUARD=0）→ 回到舊行為：preferred + 全鏈（含跨層）。
 *
 * 不論開關，preferred 永遠是鏈首（使用者選定的引擎一定先嘗試）。
 */
export function buildProviderChain(
  preferred: ProviderId,
  fullChain: ProviderId[] = FALLBACK_CHAIN,
): ProviderId[] {
  const tail = fullChain.filter((p) => p !== preferred);
  if (!ENABLE_COST_CONSENT_GUARD) {
    return [preferred, ...tail];
  }
  // 同成本層級才允許自動回退（免費只回退免費；付費只回退付費）。
  const sameTier = tail.filter((p) => providerCostTier(p) === providerCostTier(preferred));
  return [preferred, ...sameTier];
}

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
    // 🔒 成本層級感知回退鏈（AIDV-160）：免費只回退免費、付費只回退付費；
    //    免費引擎絕不無聲跨界回退到付費 provider 扣點。守門 OFF 才回到舊全鏈行為。
    const chain = buildProviderChain(preferred, FALLBACK_CHAIN);
    const faults = deps.getFaults();
    let lastErr: unknown = null;

    /**
     * 守門中止：使用者選定的免費引擎失敗/不可用，且鏈內無同層（免費）替代 →
     * 不跨界、不生成、不扣點，丟 AdapterCostBlockedError。fail 方向永遠是「不扣費」。
     */
    const blockIfFreeExhausted = (provider: ProviderId): never => {
      const reason =
        "您選的免費引擎暫時無法使用。為避免在未經同意下改用付費引擎並扣點，已停止生成（不扣點）。請改選其他引擎或稍後再試。";
      onEvent({ type: "cost-blocked", provider, reason });
      throw new AdapterCostBlockedError(reason, {
        seam: "generation", provider, procedure: "generate.submitStudioJob",
      });
    };

    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i];
      const next = chain[i + 1];
      const isLast = i === chain.length - 1;
      if (faults[provider]) {
        // 故障注入（demo/測試）：視同該 provider 失敗，直接回退。
        const error = { provider, code: "FAULT_INJECTED", http: 503, msg: `${provider} 故障注入` };
        onEvent({ type: "fail", provider, error });
        lastErr = new AdapterError(error.msg, { seam: "generation", provider });
        // 守門：免費引擎失敗且已無同層替代（鏈尾）→ 不跨界扣點，明確中止。
        if (ENABLE_COST_CONSENT_GUARD && isFreeProvider(preferred) && isLast) {
          blockIfFreeExhausted(provider);
        }
        if (next) {
          onEvent({
            type: "fallback", provider, next,
            crossesToPaid: isPaidProvider(next) && isFreeProvider(provider),
          });
        }
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
        // 守門：免費引擎失敗且已無同層替代（鏈尾）→ 不跨界扣點，明確中止。
        if (ENABLE_COST_CONSENT_GUARD && isFreeProvider(preferred) && isLast) {
          blockIfFreeExhausted(provider);
        }
        if (next) {
          onEvent({
            type: "fallback", provider, next,
            crossesToPaid: isPaidProvider(next) && isFreeProvider(provider),
          });
        }
      }
    }
    throw new AdapterError("全部 provider 皆失敗", { seam: "generation", procedure: "generate.submitStudioJob", cause: lastErr });
  }

  return { estimateCost, generate };
}
