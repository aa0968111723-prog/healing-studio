/**
 * agentEventBus.ts — AIDV-331 State Broadcast / AIDV-325 Per-Project SSE
 *
 * In-process EventEmitter for multi-agent collaboration state changes.
 * Decoupled from generationEvents to avoid mixing concerns — collaboration
 * events track session-level state (handoffs, completions) rather than
 * per-step thought chains.
 *
 * Two channels:
 *   collab:{collaborationId} — AIDV-331: session-scoped handoffs/completions
 *   project:{projectId}      — AIDV-325: project mutation broadcast for stale-snapshot prevention
 *
 * Consumers: agentEventsRoute.ts SSE endpoints.
 */

import { EventEmitter } from "events";

export type AgentCollabEvent = {
  type: "project_updated";
  collaborationId: string;
  projectId?: number;
  version: number;
  updatedFields: string[];
};

/** AIDV-325: broadcast event emitted whenever a videoProject is mutated. */
export type AgentProjectUpdatedEvent = {
  type: "project_updated";
  projectId: number;
  version: number;
  updatedFields: string[];
  triggeredBy: "agent" | "user";
};

/**
 * AIDV-467 Issue 6: intermediate task status broadcast on the per-project SSE channel.
 * Emitted when an agent is selected for a video project task so the creator
 * can see queued → assigned progression without polling.
 */
export type AgentTaskStatusEvent = {
  type: "agent_task_status";
  projectId: number;
  status: "queued" | "in_progress" | "assigned";
  agentId?: string;
  runId?: number;
};

export type AgentProjectEvent = AgentProjectUpdatedEvent | AgentTaskStatusEvent;

class AgentEventBus {
  private ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(512);
  }

  emit(event: AgentCollabEvent): void {
    this.ee.emit(`collab:${event.collaborationId}`, event);
  }

  subscribe(collaborationId: string, listener: (event: AgentCollabEvent) => void): () => void {
    const key = `collab:${collaborationId}`;
    this.ee.on(key, listener);
    return () => this.ee.off(key, listener);
  }

  /** AIDV-325: broadcast a project mutation to all per-project subscribers. */
  emitForProject(event: AgentProjectEvent): void {
    this.ee.emit(`project:${event.projectId}`, event);
  }

  /** AIDV-325: subscribe to mutations of a specific project. Returns an unsubscribe function. */
  subscribeToProject(
    projectId: number,
    listener: (event: AgentProjectEvent) => void
  ): () => void {
    const key = `project:${projectId}`;
    this.ee.on(key, listener);
    return () => this.ee.off(key, listener);
  }
}

export const agentEventBus = new AgentEventBus();
