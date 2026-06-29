/**
 * sseRouter.ts — AIDV-716 Phase 2 SSE bus consolidation
 *
 * SseRouter wires generationBus and agentEventBus for one client connection
 * and re-emits events wrapped in the UnifiedSseEvent envelope.
 *
 * Rollback: unset UNIFIED_SSE_ROUTER env (server) and VITE_UNIFIED_SSE_ROUTER
 * (client) → /api/sse returns 404, clients fall back to the three legacy
 * endpoints with zero code change.
 */

import { generationBus } from "../generationEvents";
import { agentEventBus, type AgentCollabEvent, type AgentProjectEvent } from "./agentEventBus";
import type { GenerationEvent, UnifiedSseEvent } from "../../types/sse-events";

export type SseRouterOpts = {
  jobId?: number;
  modelId?: number;
  collaborationId?: string;
  projectId?: number;
};

export class SseRouter {
  private seqNo = 0;
  private readonly cleanups: Array<() => void> = [];
  private destroyed = false;

  constructor(
    private readonly onEvent: (e: UnifiedSseEvent) => void,
    opts: SseRouterOpts,
  ) {
    this.wire(opts);
  }

  private next(): number {
    return ++this.seqNo;
  }

  private wire(opts: SseRouterOpts): void {
    const { jobId, modelId, collaborationId, projectId } = opts;

    if (jobId !== undefined) {
      this.cleanups.push(
        generationBus.subscribe(jobId, (payload: GenerationEvent) => {
          if (!this.destroyed) {
            this.onEvent({
              bus_id: "generation",
              sequence_no: this.next(),
              timestamp: Date.now(),
              payload,
            });
          }
        }),
      );
    }

    if (modelId !== undefined) {
      this.cleanups.push(
        generationBus.subscribeTraining(modelId, (payload: GenerationEvent) => {
          if (!this.destroyed) {
            this.onEvent({
              bus_id: "generation",
              sequence_no: this.next(),
              timestamp: Date.now(),
              payload,
            });
          }
        }),
      );
    }

    if (collaborationId !== undefined) {
      this.cleanups.push(
        agentEventBus.subscribe(collaborationId, (payload: AgentCollabEvent) => {
          if (!this.destroyed) {
            this.onEvent({
              bus_id: "agent",
              sequence_no: this.next(),
              timestamp: Date.now(),
              payload,
            });
          }
        }),
      );
    }

    if (projectId !== undefined) {
      this.cleanups.push(
        agentEventBus.subscribeToProject(projectId, (payload: AgentProjectEvent) => {
          if (!this.destroyed) {
            this.onEvent({
              bus_id: "agent",
              sequence_no: this.next(),
              timestamp: Date.now(),
              payload,
            });
          }
        }),
      );
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
  }
}
