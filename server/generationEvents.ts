/**
 * Generation Events — In-memory EventEmitter for SSE-based real-time thought chain updates.
 *
 * The tRPC mutation emits events as each generation step completes.
 * The SSE endpoint streams those events to the frontend in real time.
 * This replaces the old pattern of returning the full thoughtChain only at the end.
 */

import { EventEmitter } from "events";
import { getOrbTraceId } from "./_core/logger";

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
  | ({ type: "complete"; thoughtChain: ThoughtNodeEvent[] } & GenerationEventBase)
  | ({ type: "error"; message: string } & GenerationEventBase)
  | ({
      type: "step_complete";
      taskId: string;
      stepId: string;
      userId: number;
      at: number;
    } & GenerationEventBase)
  | ({
      type: "task_done" | "task_failed";
      taskId: string;
      userId: number;
      at: number;
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
    } & GenerationEventBase);

class GenerationEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners (one per active SSE connection)
    this.emitter.setMaxListeners(100);
  }

  /** Emit an event for a specific job */
  emit(jobId: number, event: GenerationEvent) {
    const orbTraceId = event.orbTraceId ?? getOrbTraceId() ?? undefined;
    this.emitter.emit(`job:${jobId}`, { ...event, orbTraceId });
  }

  /** Subscribe to events for a specific job. Returns unsubscribe function. */
  subscribe(
    jobId: number,
    listener: (event: GenerationEvent) => void
  ): () => void {
    const channel = `job:${jobId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.removeListener(channel, listener);
    };
  }

  /** Clean up all listeners for a job (call after generation completes) */
  cleanup(jobId: number) {
    this.emitter.removeAllListeners(`job:${jobId}`);
  }

  // ─── 模型訓練專用通道 ────────────────────────────────────────────────────
  // 訓練狀態存在 fineTunedModels 表（不是 backgroundJobs），
  // 用獨立 model-training:<modelId> channel 避免與 generation 混在一起。

  emitTraining(modelId: number, event: GenerationEvent) {
    this.emitter.emit(`model-training:${modelId}`, event);
  }

  subscribeTraining(
    modelId: number,
    listener: (event: GenerationEvent) => void
  ): () => void {
    const channel = `model-training:${modelId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.removeListener(channel, listener);
    };
  }

  cleanupTraining(modelId: number) {
    this.emitter.removeAllListeners(`model-training:${modelId}`);
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
