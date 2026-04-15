/**
 * Generation Events — In-memory EventEmitter for SSE-based real-time thought chain updates.
 *
 * The tRPC mutation emits events as each generation step completes.
 * The SSE endpoint streams those events to the frontend in real time.
 * This replaces the old pattern of returning the full thoughtChain only at the end.
 */

import { EventEmitter } from "events";

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

export type GenerationEvent =
  | { type: "thought-update"; node: ThoughtNodeEvent }
  | { type: "progress"; progress: number; message: string }
  | { type: "complete"; thoughtChain: ThoughtNodeEvent[] }
  | { type: "error"; message: string };

class GenerationEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners (one per active SSE connection)
    this.emitter.setMaxListeners(100);
  }

  /** Emit an event for a specific job */
  emit(jobId: number, event: GenerationEvent) {
    this.emitter.emit(`job:${jobId}`, event);
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
