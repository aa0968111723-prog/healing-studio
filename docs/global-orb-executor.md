# Global Orb Executor

## Architecture
- `client/src/agent/GlobalOrbExecutor.ts` is the deterministic browser executor.
- `client/src/agent/useGlobalOrbExecutor.ts` wires executor with `PageAgentContext`, navigation, and `ai.orbTask.*` APIs.
- `GlobalOrbChatContext` now renders approval and step-by-step execution panels.

## Approval flow
- Executor checks task-level and step-level approval before execution.
- High-risk actions (`submit/reset/applyPreset`) are never auto-executed.
- Confirmation card shows summary, steps, risk, affected pages, and Approve/Cancel/Edit actions.

## Cross-page execution
- If `step.pagePath !== currentPage`, executor navigates first.
- It waits for page readiness with timeout (configurable in hook).
- Timeout fails safely with a user-facing reason; no infinite wait.

## Recovery flow
- Failed step is recorded with reason and telemetry.
- Retry uses remaining `retryBudget` and calls `orbTask.retry`.
- Replan action pre-fills recovery prompt with `failedStep` + `failedReason`.
- Recovery plan still goes through planner + gate flow.

## Claude Code handoff
- If task `isolation="code"` or `preferredEngine="claudeCode"`, browser executor refuses code execution.
- UI shows handoff requirement; user must approve before off-browser handling.
- No secrets/API keys/base64 payloads are shown in telemetry metadata.

## Telemetry
- Emits:
  - `executor.started`
  - `executor.step.started`
  - `executor.step.completed`
  - `executor.step.failed`
  - `executor.paused`
  - `executor.cancelled`
  - `executor.recovery.requested`
  - `executor.completed`
- Metadata is sanitized to remove secret-like fields and large/base64 payloads.

## Feature flags
- `VITE_ENABLE_GLOBAL_ORB_EXECUTOR`
- `ENABLE_ORB_TASK_EXECUTOR`
- `VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS`

## Rollback
1. `VITE_ENABLE_GLOBAL_ORB_EXECUTOR=false`
2. `ENABLE_ORB_TASK_EXECUTOR=false`
3. `VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=false`
4. Keep plan-only mode in chat
5. Keep legacy `parseOrbReply` fallback active
