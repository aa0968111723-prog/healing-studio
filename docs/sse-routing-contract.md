# SSE Bus Routing Contract — AIDV-708

> **Status**: Phase 1 complete (inventory + types). Phase 2 (unified router) tracked in AIDV-716.

## Overview

Three independent in-process SSE buses exist today. This document is the authoritative inventory of their event shapes, channels, and emitter locations. Phase 2 will merge them into a single routing layer using the `UnifiedSseEvent` envelope defined in `types/sse-events.ts`.

---

## Bus 1 — `generationBus`

**Source**: `server/generationEvents.ts`  
**Mechanism**: Node.js `EventEmitter` singleton, max 100 listeners  
**Channels**:
- `job:{jobId}` — per-background-job generation events (image/video/audio/voice)
- `model-training:{modelId}` — LoRA fine-tune training status updates
- User-scoped via `dualEmitForUser(userId, event)` — routes to user's SSE connection

**Event type**: `GenerationEvent` (union of 12 subtypes)

| `type` | Key payload fields | Purpose |
|---|---|---|
| `thought-update` | `node: ThoughtNodeEvent` | Streaming thought-chain node status |
| `progress` | `progress: number`, `message: string` | Generic progress percentage |
| `complete` | `thoughtChain`, `preview_url?` | Generation finished, preview ready |
| `error` | `message: string` | Terminal generation failure |
| `step_complete` | `taskId`, `stepId`, `userId`, `at` | Agent step finished |
| `task_done` | `taskId`, `userId`, `at` | Agent task completed successfully |
| `task_failed` | `taskId`, `userId`, `at` | Agent task terminated with failure |
| `step_verifier_failed` | `taskId`, `stepId`, `toolName`, `errorCode`, `issueCount`, `at` | DEF-AG1: verifier rejected tool result |
| `chain_started` | `taskId`, `userId`, `maxIterations`, `at` | Agent loop v2 chain begun |
| `chain_completed` | `taskId`, `finalTaskId`, `iterations`, `stopReason`, `durationMs`, `at` | Agent loop v2 chain exited |
| `task_queued` | `runId`, `userId`, `intent`, `at` | AIDV-495: intent entered the queue |
| `task_in_progress` | `requestId`, `userId`, `modelId`, `at` | fal.ai accepted the job |

**Feature flag**: `UNIFIED_GEN_EVENT_BUS` — when `true`, drops the legacy admin EventEmitter dual-write (see `dualEmitForUser`).

---

## Bus 2 — `orbChatProgress`

**Source**: `server/services/orbChatProgress.ts`  
**Mechanism**: In-memory `Map<requestId, OrbChatProgressEvent[]>`, TTL 60 s, max 64 events/request  
**Channels**: keyed by `requestId` (UUID per Orb chat HTTP request)

**Event type**: `OrbChatProgressEvent`

```ts
{
  seq: number;           // monotonically increasing within request
  at: number;            // Unix ms
  stage: OrbChatProgressStage;
  label: string;         // human-readable stage label
  detail?: Record<string, unknown>;
}
```

**Stages** (in typical pipeline order):

| `stage` | Description |
|---|---|
| `received` | Request received by server |
| `sanitizing` | Input text sanitization |
| `guarding_attachments` | Attachment security check |
| `extracting_pdf` | PDF text extraction |
| `selecting_provider` | AI provider selection |
| `analyzing_terms` | Term/keyword analysis |
| `researching_web` | Web research in progress |
| `planning` | Agent planning step |
| `calling_specialist` | Delegating to specialist sub-agent |
| `materializing_task` | Converting plan to executable task |
| `executing_tool` | Tool call in flight |
| `finalizing` | Response assembly |
| `error` | Pipeline error |

---

## Bus 3 — `agentEventBus`

**Source**: `server/services/agentEventBus.ts`  
**Mechanism**: Node.js `EventEmitter` singleton  
**Channels**:
- `collab:{collaborationId}` — multi-agent collaboration-scoped updates
- `project:{projectId}` — project-level agent activity

**Event types**: `AgentCollabEvent` | `AgentProjectEvent`

| Event | Channel | Key fields |
|---|---|---|
| `AgentCollabEvent` | `collab:{id}` | `type: "project_updated"`, `collaborationId`, `projectId?`, `version`, `updatedFields[]` |
| `AgentProjectEvent` | `project:{id}` | `type: "project_updated"`, `projectId`, `version`, `updatedFields[]`, `triggeredBy: "agent"\|"user"` |

---

## Phase 2 Target: `UnifiedSseEvent` Envelope

After Phase 2 merges the buses, every event arriving at a client SSE connection will be wrapped:

```ts
type UnifiedSseEvent =
  | { bus_id: "generation"; sequence_no: number; timestamp: number; payload: GenerationEvent }
  | { bus_id: "orb-chat";   sequence_no: number; timestamp: number; payload: OrbChatProgressEvent }
  | { bus_id: "agent";      sequence_no: number; timestamp: number; payload: AgentEvent };
```

Clients switch on `bus_id`, then the inner `payload.type` / `payload.stage`.

**Full type definitions**: `types/sse-events.ts`

---

## Migration Path (Phase 2 scope)

1. Introduce a `SseRouter` class that subscribes to all three buses and re-emits as `UnifiedSseEvent`.
2. Replace the three per-endpoint SSE handlers with a single `/api/sse` endpoint that uses `SseRouter`.
3. Update frontend consumers (generation stream, orb chat progress bar, agent activity panel) to read from the unified endpoint.
4. Remove the three individual SSE endpoints behind a feature flag (`UNIFIED_SSE_ROUTER`).
5. After 2 weeks with no rollbacks, delete the legacy endpoints.

**Blocked by**: AIDV-341/370 (Supabase Realtime). Implement with in-process EventEmitter first; swap to Supabase Realtime channels in a follow-up.

---

## Non-goals (Phase 1)

- No code changes to any existing bus emitter
- No client-side changes
- No new SSE endpoints
- No database schema changes
