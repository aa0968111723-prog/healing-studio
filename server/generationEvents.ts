/**
 * Generation Events — In-memory EventEmitter for SSE-based real-time thought chain updates.
 *
 * The tRPC mutation emits events as each generation step completes.
 * The SSE endpoint streams those events to the frontend in real time.
 * This replaces the old pattern of returning the full thoughtChain only at the end.
 */

import { EventEmitter } from "events";
import { getOrbTraceId } from "./_core/logger";

// ─── SSE replay ring buffer ──────────────────────────────────────────────────
// Bounded per-channel buffer so late subscribers (client connects after
// "complete" was emitted) and reconnecting clients (Last-Event-ID) can catch
// up without BullMQ or any external store.

const RING_MAX = 64;
const RING_TTL_MS = 10 * 60 * 1000; // 10 minutes

type BufferedEntry = { seq: number; event: GenerationEvent; ts: number };

class ChannelBuffer {
  private items: BufferedEntry[] = [];
  private _seq = 0;

  push(event: GenerationEvent): number {
    this._seq += 1;
    this.items.push({ seq: this._seq, event, ts: Date.now() });
    if (this.items.length > RING_MAX) this.items.shift();
    return this._seq;
  }

  since(sinceSeq: number): BufferedEntry[] {
    const cutoff = Date.now() - RING_TTL_MS;
    return this.items.filter(e => e.seq > sinceSeq && e.ts >= cutoff);
  }

  clear() {
    this.items = [];
  }
}

export interface SubscribeOpts {
  /** Replay buffered events emitted after `sinceSeq` before registering the live listener. */
  replay?: boolean;
  /** Last stable seq the caller has seen; replay starts from seq > sinceSeq. */
  sinceSeq?: number;
}

export type ThoughtNodeEvent = {
  id: string;
  label: string;
  status: "queued" | "processing" | "completed" | "passed" | "error";
  detail: string;
  timestamp: number;
  reasoning?: string;
  confidence?: number;
  tokens?: number;
};

export type GenerationEventBase = { orbTraceId?: string };

export type GenerationEvent =
  | ({ type: "thought-update"; node: ThoughtNodeEvent } & GenerationEventBase)
  | ({ type: "progress"; progress: number; message: string } & GenerationEventBase)
  | ({ type: "complete"; thoughtChain: ThoughtNodeEvent[]; preview_url?: string } & GenerationEventBase)
  | ({ type: "error"; message: string; provider?: string; retryable?: boolean } & GenerationEventBase)
  | ({
      type: "step_complete";
      taskId: string;
      stepId: string;
      userId: number;
      at: number;
    } & GenerationEventBase)
  | ({
      type: "task_done";
      taskId: string;
      userId: number;
      at: number;
    } & GenerationEventBase)
  | ({
      type: "task_failed";
      taskId: string;
      userId: number;
      at: number;
      failureReason?: string;
      errorCode?: string;
    } & GenerationEventBase)
  | ({
      // DEF-AG1 Step Reflection telemetry: emitted whenever the
      // post-execution verifier rejects an otherwise 200-OK tool result
      // (all-black image / empty audio / missing URL / model-reported
      // error). Lets the front-end intent card surface "驗收失敗、自動
      // retry/replan" instead of leaving the user staring at a spinner.
      type: "step_verifier_failed";
      taskId: string;
      stepId: string;
      userId: number;
      toolName: string;
      errorCode: string;
      issueCount: number;
      at: number;
    } & GenerationEventBase)
  | ({
      // Agent loop v2 telemetry: chain runner started a bounded
      // continuation loop for an initial task. Carries the maxIterations
      // budget so dashboards can compare planned vs actual chain length.
      type: "chain_started";
      taskId: string;
      userId: number;
      maxIterations: number;
      at: number;
    } & GenerationEventBase)
  | ({
      // Agent loop v2 telemetry: chain runner exited with a terminal
      // stop reason. `iterations` is the number of tasks actually run
      // (1 for single-shot completion, 2 when a replan happened, …).
      // `durationMs` covers wall-clock from start of the first iteration
      // to the end of the last; useful for SLO tracking.
      type: "chain_completed";
      taskId: string;
      finalTaskId: string;
      userId: number;
      iterations: number;
      stopReason:
        | "completed"
        | "abort"
        | "needs_user"
        | "no_continuation_context"
        | "planner_no_task"
        | "max_iterations";
      durationMs: number;
      at: number;
    } & GenerationEventBase)
  | ({
      // AIDV-495: 意圖剛入佇列（createIntent 建完 orchestration run 後立即發）。
      // 讓前端 intent card 立刻進入「已排入」狀態而非停在空白。
      type: "task_queued";
      runId: number;
      userId: number;
      intent: string;
      at: number;
    } & GenerationEventBase)
  | ({
      // AIDV-495: fal.ai queue.submit 成功後發出（拿到 request_id 即代表
      // 任務已被 fal 接受並開始排隊/計算），讓前端進入「生成中」狀態。
      type: "task_in_progress";
      requestId: string;
      userId: number;
      modelId: string;
      at: number;
    } & GenerationEventBase);

class GenerationEventBus {
  private emitter = new EventEmitter();
  private buffers = new Map<string, ChannelBuffer>();

  constructor() {
    // Allow many listeners (one per active SSE connection)
    this.emitter.setMaxListeners(100);
  }

  private getOrCreateBuf(channel: string): ChannelBuffer {
    let buf = this.buffers.get(channel);
    if (!buf) {
      buf = new ChannelBuffer();
      this.buffers.set(channel, buf);
    }
    return buf;
  }

  /** Emit an event for a specific job */
  emit(jobId: number, event: GenerationEvent) {
    const orbTraceId = event.orbTraceId ?? getOrbTraceId() ?? undefined;
    const channel = `job:${jobId}`;
    const richEvent = orbTraceId !== undefined ? { ...event, orbTraceId } : { ...event };
    const seq = this.getOrCreateBuf(channel).push(richEvent);
    // Attach seq as non-enumerable so JSON.stringify and toEqual in tests ignore
    // it, while sseRoute.ts can still read it for the SSE `id:` field.
    Object.defineProperty(richEvent, "_seq", { value: seq, enumerable: false });
    this.emitter.emit(channel, richEvent);
  }

  /** Subscribe to events for a specific job. Returns unsubscribe function. */
  subscribe(
    jobId: number,
    listener: (event: GenerationEvent) => void,
    opts?: SubscribeOpts
  ): () => void {
    const channel = `job:${jobId}`;

    if (opts?.replay) {
      const buf = this.buffers.get(channel);
      if (buf) {
        const past = buf.since(opts.sinceSeq ?? 0);
        // Delay via microtask so caller can save the unsubscribe ref before
        // replayed events fire, avoiding a potential early-unsubscribe TDZ.
        queueMicrotask(() => {
          for (const { seq, event } of past) {
            const replayEvent = { ...event };
            Object.defineProperty(replayEvent, "_seq", { value: seq, enumerable: false });
            listener(replayEvent as GenerationEvent);
          }
        });
      }
    }

    this.emitter.on(channel, listener);
    return () => {
      this.emitter.removeListener(channel, listener);
    };
  }

  /** Clean up all listeners and buffer for a job (call after generation completes) */
  cleanup(jobId: number) {
    const channel = `job:${jobId}`;
    this.emitter.removeAllListeners(channel);
    this.buffers.get(channel)?.clear();
    this.buffers.delete(channel);
  }

  // ─── 模型訓練專用通道 ────────────────────────────────────────────────────
  // 訓練狀態存在 fineTunedModels 表（不是 backgroundJobs），
  // 用獨立 model-training:<modelId> channel 避免與 generation 混在一起。

  emitTraining(modelId: number, event: GenerationEvent) {
    const channel = `model-training:${modelId}`;
    const seq = this.getOrCreateBuf(channel).push(event);
    const richEvent = { ...event };
    Object.defineProperty(richEvent, "_seq", { value: seq, enumerable: false });
    this.emitter.emit(channel, richEvent);
  }

  subscribeTraining(
    modelId: number,
    listener: (event: GenerationEvent) => void,
    opts?: SubscribeOpts
  ): () => void {
    const channel = `model-training:${modelId}`;

    if (opts?.replay) {
      const buf = this.buffers.get(channel);
      if (buf) {
        const past = buf.since(opts.sinceSeq ?? 0);
        queueMicrotask(() => {
          for (const { seq, event } of past) {
            const replayEvent = { ...event };
            Object.defineProperty(replayEvent, "_seq", { value: seq, enumerable: false });
            listener(replayEvent as GenerationEvent);
          }
        });
      }
    }

    this.emitter.on(channel, listener);
    return () => {
      this.emitter.removeListener(channel, listener);
    };
  }

  cleanupTraining(modelId: number) {
    const channel = `model-training:${modelId}`;
    this.emitter.removeAllListeners(channel);
    this.buffers.get(channel)?.clear();
    this.buffers.delete(channel);
  }
}

// Singleton
export const generationBus = new GenerationEventBus();

export let generationEventBus: EventEmitter = new EventEmitter();
generationEventBus.setMaxListeners(100);

export function setGenerationEventBusForTests(bus: EventEmitter): void {
  generationEventBus = bus;
}

export function emitGenerationEvent(event: GenerationEvent): void {
  generationEventBus.emit("generation", event);
}

/**
 * AIDV-173: Dual-emit for user-scoped task events (chain/step/task_done/failed).
 *
 * Default (UNIFIED_GEN_EVENT_BUS unset or "false"):
 *   → emits to generationBus user-SSE channel AND legacy admin EventEmitter.
 * When UNIFIED_GEN_EVENT_BUS=true:
 *   → emits only to generationBus (admin stream dropped = unified mode active).
 *
 * Rollback: unset UNIFIED_GEN_EVENT_BUS → reverts to dual-write with admin stream.
 */
export function dualEmitForUser(userId: number, event: GenerationEvent): void {
  generationBus.emit(userId, event);
  const unified = process.env.UNIFIED_GEN_EVENT_BUS?.trim().toLowerCase();
  if (unified !== "true" && unified !== "1" && unified !== "on") {
    emitGenerationEvent(event);
  }
}
