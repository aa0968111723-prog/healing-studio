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
