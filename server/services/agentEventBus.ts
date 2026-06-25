/**
 * agentEventBus.ts — AIDV-331 State Broadcast
 *
 * In-process EventEmitter for multi-agent collaboration state changes.
 * Decoupled from generationEvents to avoid mixing concerns — collaboration
 * events track session-level state (handoffs, completions) rather than
 * per-step thought chains.
 *
 * Consumers: agentEventsRoute.ts SSE endpoint.
 */

import { EventEmitter } from "events";

export type AgentCollabEvent = {
  type: "project_updated";
  collaborationId: string;
  projectId?: number;
  version: number;
  updatedFields: string[];
};

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
}

export const agentEventBus = new AgentEventBus();
