# PR #321 Phase 0 Recon Report

Date: 2026-05-02
Branch: `codex/orb-agent-capability-enhancement`

## 1) `executeCurrentStepTools` callers

### Definition
- `server/services/orbTaskOrchestrator.ts` exports `executeCurrentStepTools`.

### Runtime callers
- `server/routers.ts`
  - Direct call inside task execution flow (`const toolRun = await executeCurrentStepTools(...)`).
- `server/services/orbTaskOrchestrator.ts`
  - `runOrbTaskToCompletion` internally calls `executeCurrentStepTools` for each loop step.
- `server/routes/webhooks.ts`
  - Webhook path directly invokes `executeCurrentStepTools(...)`.

### Import / metadata references (non-runtime direct call)
- `server/routers.ts` import statement.
- `server/routers/brainPipeline.ts` serviceFunction metadata strings mention `executeCurrentStepTools`.

### Test callers
- `server/services/__tests__/orbTaskOrchestrator.test.ts`
- `server/orb-task-orchestrator.test.ts`
- `server/routes/__tests__/webhooks.test.ts` uses mocked export wiring.

---

## 2) `parseAndGatePlan` implementation + callers

### Implementation location
- `shared/agent-plan-adapter.ts`
  - Function: `export function parseAndGatePlan(rawPlannerOutput: unknown): GatedAgentPlanResult`

### Runtime callers
- `server/services/agentPlanner.ts`
  - Planner response parsing/gating path calls `parseAndGatePlan(rawContent)`.
- `server/services/orbTaskStateMachine.ts`
  - Recovery branch builds and gates recovery plan via `parseAndGatePlan({...})`.

### Test callers
- `server/agent-plan-v3.test.ts`
- `server/orb-task-state-machine.test.ts`
- `server/services/__tests__/orbTaskStateMachine.test.ts`

### Documentation references
- `docs/global-orb-code-collaboration.md`
- `docs/global-orb-agent-qa.md`
- `docs/global-orb-task-state-machine.md`

---

## 3) `searchOrbMemoriesWithRag` implementation + router usage

### Implementation
- `server/services/orbMemory.ts`
  - Function: `export async function searchOrbMemoriesWithRag(args)`
  - Behavior: vector retrieval via `retrieveFromRag(...)` + keyword fallback merge.
- `server/services/ragMemory.ts`
  - Adapter used by orb memory layer: `queryRagMemory(args)`.

### Current router usage status
- **Yes, currently called by router**.
- `server/routers.ts`
  - Imports `searchOrbMemoriesWithRag`.
  - Exposes RPC route calling:
    - `return searchOrbMemoriesWithRag({ userId: ctx.user.id, query: input.query, limit: input.limit });`

### Planner/orchestrator injection status
- No evidence from current grep that planner entry path is calling `searchOrbMemoriesWithRag` before plan decomposition.

---

## 4) Public APIs: modality coherence + content moderation

## `shared/orb-modality-coherence.ts`

### Exported types/functions
- `export type ModalityHint = "image" | "video" | "audio" | "voice" | "text" | null;`
- `export interface ModalityCoherenceResult`
  - `declared: ModalityHint`
  - `selected: ModalityHint`
  - `mismatch: boolean`
  - `message: string`
- `export function checkModalityCoherence(args: { userText: string; steps: Array<PlannerStepLike>; }): ModalityCoherenceResult`

### Input/Output schema summary
- Input:
  - `userText`: user request text for modality inference.
  - `steps`: planner-like steps with optional `action.type/modality/path` and `pagePath`.
- Output:
  - Returns inferred declared modality vs selected modality and mismatch signal.
  - Unknown/insufficient signals return non-mismatch with empty message.

## `shared/orb-content-moderation.ts`

### Exported types/functions
- `export type ModerationCategory = "violence" | "hate" | "explicit" | "self-harm";`
- `export type ModerationAction = "block" | "warn" | "pass";`
- `export interface ModerationFinding`
  - `category`, `pattern`, `excerpt`
- `export interface ModerationResult`
  - `action`, `findings`, `text`
- `export function moderateOrbContent(text: string): ModerationResult`

### Input/Output schema summary
- Input:
  - `text`: plain text payload.
- Output:
  - `pass`: unchanged text.
  - `block`: replacement safe message + findings.
  - `warn`: prefixed warning text + findings.

---

## 5) Recon conclusion vs PR #321 readiness

1. Required hook points for Phase 1/2 are available:
   - Step execution central point: `executeCurrentStepTools` in orchestrator.
   - Plan gate central point: `parseAndGatePlan` in adapter.
2. Existing safety modules are present but currently not wired into orchestrator execution path.
3. RAG memory search exists and is router-accessible, but planner prefetch injection appears missing.

