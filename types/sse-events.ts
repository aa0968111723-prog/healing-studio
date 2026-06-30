/**
 * Unified SSE event types — AIDV-708 Phase 1
 *
 * Documents and unifies the three in-process SSE buses:
 *   1. generationBus   — server/generationEvents.ts          (keyed by job / user / model-training)
 *   2. orbChatProgress — server/services/orbChatProgress.ts  (keyed by requestId, in-memory Map)
 *   3. agentEventBus   — server/services/agentEventBus.ts    (keyed by collab / project)
 *
 * Phase 2 will wire these into a single router; Phase 1 is pure type/doc alignment.
 */

// ── Common envelope ───────────────────────────────────────────────────────────

/**
 * Discriminator identifying which bus produced the event.
 * Used by the Phase-2 router to route to the correct downstream handler.
 */
export type SseBusId = "generation" | "orb-chat" | "agent";

/**
 * Common metadata present on every event after the Phase-2 unified router wraps them.
 * Individual bus types below do NOT yet include this — it is added at the routing layer.
 */
export type SseEnvelope = {
  bus_id: SseBusId;
  /** Monotonically increasing per-connection sequence number for gap detection. */
  sequence_no: number;
  /** Unix timestamp (ms) when the event was emitted. */
  timestamp: number;
};

// ── Bus 1: generationBus ──────────────────────────────────────────────────────
// Source: server/generationEvents.ts
// Channels: job:{jobId} | model-training:{modelId} | (user-SSE via dualEmitForUser)

export type ThoughtNodeStatus = "queued" | "processing" | "completed" | "passed" | "error";

export type ThoughtNodeEvent = {
  id: string;
  label: string;
  status: ThoughtNodeStatus;
  detail: string;
  timestamp: number;
  reasoning?: string;
  confidence?: number;
  tokens?: number;
};

export type GenerationEventBase = { orbTraceId?: string };

export type GenerationEventType =
  | "thought-update"
  | "progress"
  | "complete"
  | "error"
  | "step_complete"
  | "task_done"
  | "task_failed"
  | "step_verifier_failed"
  | "chain_started"
  | "chain_completed"
  | "task_queued"
  | "task_in_progress"
  | "segment_started"
  | "segment_completed";

export type GenerationEvent =
  | ({ type: "thought-update"; node: ThoughtNodeEvent } & GenerationEventBase)
  | ({ type: "progress"; progress: number; message: string } & GenerationEventBase)
  | ({ type: "complete"; thoughtChain: ThoughtNodeEvent[]; preview_url?: string } & GenerationEventBase)
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
      type: "chain_started";
      taskId: string;
      userId: number;
      maxIterations: number;
      at: number;
    } & GenerationEventBase)
  | ({
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
      type: "task_queued";
      runId: number;
      userId: number;
      intent: string;
      at: number;
    } & GenerationEventBase)
  | ({
      type: "task_in_progress";
      requestId: string;
      userId: number;
      modelId: string;
      at: number;
    } & GenerationEventBase)
  | ({
      // AIDV-527: 導演 AI 批次生成 — 單一分鏡任務已開始派送 fal
      type: "segment_started";
      segmentId: string;
      segmentIndex: number;
      of: number;
      stage: string;
      userId: number;
      at: number;
    } & GenerationEventBase)
  | ({
      // AIDV-527: 導演 AI 批次生成 — 單一分鏡任務已完成（webhook 回傳 OK）
      type: "segment_completed";
      segmentId: string;
      segmentIndex: number;
      of: number;
      stage: string;
      duration_ms: number;
      userId: number;
      at: number;
    } & GenerationEventBase);

// ── Bus 2: orbChatProgress ────────────────────────────────────────────────────
// Source: server/services/orbChatProgress.ts
// Channels: in-memory Map keyed by requestId (TTL 60 s, max 64 events/request)

export type OrbChatProgressStage =
  | "received"
  | "sanitizing"
  | "guarding_attachments"
  | "extracting_pdf"
  | "selecting_provider"
  | "analyzing_terms"
  | "researching_web"
  | "planning"
  | "calling_specialist"
  | "materializing_task"
  | "executing_tool"
  | "finalizing"
  | "error";

export type OrbChatProgressEvent = {
  seq: number;
  at: number;
  stage: OrbChatProgressStage;
  label: string;
  detail?: Record<string, unknown>;
};

// ── Bus 3: agentEventBus ──────────────────────────────────────────────────────
// Source: server/services/agentEventBus.ts
// Channels: collab:{collaborationId} | project:{projectId}

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

export type AgentEvent = AgentCollabEvent | AgentProjectEvent;

// ── Unified AgentEvent (Phase-2 target shape) ─────────────────────────────────
// After Phase 2 merges the buses, every event arriving at the client will be
// wrapped in this envelope so consumers can switch on `bus_id` + `event_type`.

export type UnifiedSseEvent =
  | (SseEnvelope & { bus_id: "generation"; payload: GenerationEvent })
  | (SseEnvelope & { bus_id: "orb-chat"; payload: OrbChatProgressEvent })
  | (SseEnvelope & { bus_id: "agent"; payload: AgentEvent });
