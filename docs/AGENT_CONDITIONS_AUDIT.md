# Orb Agent Conditions Audit

Status as of the latest commit on `claude/site-wide-ai-proxy-cNzdX`.
This file records what the orb agent already does, what was added in
this PR, and what is intentionally deferred.

## Coverage matrix (40 conditions)

### A. Core agent loop — ✅ 7/7
1. Goal understanding / clarification — `agent-plan-schema.ts:128-144`
2. Schema-first planning (v1 + v3) — `shared/agent-plan-adapter.ts:380-505`
3. Tool use / function calling — `shared/global-agent-tools.ts`, `server/services/agentToolExecutor.ts`
4. Action execution + cross-page dispatch — `shared/global-agent-orchestrator.ts:172-235`
5. Observation / feedback collection — `shared/agent-actions.ts:561-593`
6. Reflection / self-correction — `server/services/orbTaskStateMachine.ts:283-320`
   (now with auto-retry + replan trigger — see "Added in this PR")
7. Termination conditions — `shared/orb-task-state-machine.ts:1-15`

### B. Safety & governance — 10/10
8. Confirmation gates ✅ — `shared/global-agent-orchestrator.ts:79-119`
9. Authorization ✅ **(upgraded)** — `agentPreferences.confirmationPolicy`,
   `autoApproveTools`, `blockedTools`, `disabledPageAgents` (per-page),
   plus new `disabledActionsByPage` (per-page × per-action 細模許可).
   Server filters actions before they ship; UI editor under
   `/settings/agent` → 頁面權限 tab.
10. Audit logs ✅ — `shared/orb-task-state-machine.ts:17-40`
11. Cost guard ✅ — `server/services/orbCostGuard.ts`
12. Quota / rate limits ✅ — `server/services/orbQuota.ts`
13. Cancellation ✅ — `cancelOrbAgentTask` in state machine
14. Rollback / undo ✅ **(upgraded)** — `compensationAction` now propagates
    plan → task; `failOrbAgentStep` emits `step.rollback_pending` audit
    event when retries exhaust + step has compensation; new
    `markStepRollback(taskId, stepId, status)` for the client to report
    completion.
15. Prompt-injection defense ✅ — `shared/orb-prompt-defense.ts`
16. PII redaction ✅ — `shared/orb-memory.ts:41-83`
17. Output content moderation ✅ **(added)** — `shared/orb-content-moderation.ts`
    pattern-based check (violence / hate / explicit / self-harm).
    Block strips actions and replaces reply; warn prepends a banner.
    Wired into both planner-converted and legacy fallback reply paths.

### C. Reliability — 6/6
18. Idempotency ✅ — `server/services/orbIdempotency.ts`
19. Retry policy ✅ **(upgraded)** — `computeRetryBackoffMs(attempt)` exponential
    backoff with jitter, capped 30s, in `shared/orb-task-state-machine.ts`
20. Fallback chains ✅ — `server/services/providerRouter.ts`
21. Timeout handling ✅ **(added)** — `runStepWithTimeout` in
    `server/services/orbTaskStateMachine.ts`; `DEFAULT_STEP_TIMEOUT_MS = 60s`;
    on timeout the step auto-retries via the new failOrbAgentStep flag
22. Partial failure recovery ✅ **(upgraded)** — `failOrbAgentStep(taskId,
    stepId, reason, { allowAutoRetry: true })` schedules a backoff retry
    instead of immediately hard-failing the task
23. State persistence ✅ — task store + memory store

### D. Observability — 4/4
24. Tracing ✅ — `traceId` propagates plan → task → audit
25. Metrics 🟡 → ✅ — telemetry events (`orb.prompt_defense.triggered`,
    `step.retry_scheduled`, `step.timeout`, `agent.message`, etc.)
26. Step replay ✅ — `OrbTaskAuditEvent[]`
27. Debug surfaces ✅ — LangSmith integration + `/admin/brain-pipeline`

### E. Context management — 5/5
28-32. Conversation history, memory hierarchy, page context, user prefs,
    context window — all green; `summarizeRecentMemoryForPlanner` now
    surfaces `memoryId + source` so citations work

### F. Quality — 3/4 (was 2/4)
33. Schema validation ✅
34. Hallucination guards ❌ — **deferred** (see below)
35. Citation / source tracking ✅ — `citations` field on plan schemas;
    planner prompt instructs LLM to cite memoryId; surfaced in
    `OrbParsedReply.citations`.
36. Multi-modal coherence ✅ **(added)** — `shared/orb-modality-coherence.ts`
    detects mismatch between user-declared modality (中/英 keyword) and
    planner-selected modality (`setModality` action or page route);
    appends `coherence.message` to `plan.warnings` and emits
    `orb.modality.mismatch` telemetry.

### G. Multi-agent / coordination — 4/4 ✅
37. Sub-agent delegation ✅
38. Parallel execution ✅ **(opt-in runtime added)** —
    `shared/orb-dag-scheduler.ts` provides topological-batch + concurrency
    cap with same-page race protection (two UI dispatches on the same path
    are guaranteed to land in different batches). `executeGlobalWorkflow`
    delegates to `executeWorkflowParallel` only when:
      a. `VITE_ENABLE_ORB_PARALLEL_SCHEDULER=true` env flag is set, AND
      b. at least one workflow step declares `dependsOn`.
    Otherwise it falls through to the existing sequential loop. Cycle
    detection in the scheduler triggers an automatic fall-back to
    sequential. Concurrency cap defaults to 3 (override via
    `VITE_ORB_PARALLEL_CONCURRENCY`).
39. Inter-agent messaging ✅ **(now actively used)** — Claude Code lifecycle
    in `orbTaskStateMachine.ts` emits `agent.message` audit entries with
    structured `InterAgentMessage` payloads on:
      - Task creation: orb → claude-code request/task.handoff,
        claude-code → orb response/plan.acknowledged
      - Task completion: claude-code → orb response/pr_ready
      - Task failure: claude-code → orb response/task.failed
      - Task cancellation: orb → claude-code (or codex) request/task.cancel
    Plain UI tasks emit no agent.message events (kept lean by design).
40. Handoff to human ✅

## Tally
- Before sprint: 32/40 fully done (80%)
- After first follow-up commit: 38/40 fully done (95%)
- After second follow-up commit: 40/40 covered (38 ✅ + 2 🟡)
- After this commit: **39/40 fully done (97.5%)** — parallel exec runtime
  shipped opt-in; only gap left is hallucination guard (Gap 34), deferred
  pending embedding / vector-store infra decision.

## Deferred gaps (require dedicated sprint)

### Parallel step execution (gap 38) — ✅ shipped opt-in
Status: implementation landed in `shared/orb-dag-scheduler.ts` and the
`executeWorkflowParallel` branch of `shared/global-agent-orchestrator.ts`.
Disabled by default (env flag `VITE_ENABLE_ORB_PARALLEL_SCHEDULER`) so
operations can decide when to flip after browser e2e validation.

Race-coverage tests live in `server/orb-dag-scheduler.test.ts`:
empty / single-step inputs, same-page sequencing under mixed-page
interleaving, explicit dependsOn linearisation, diamond DAG fan-out /
fan-in, cycle detection, concurrency cap, batch-N-before-N+1 ordering,
and first-failure surfacing.

Browser-level e2e (Playwright) is the remaining manual step before
flipping the env flag in production.

### Hallucination / fact-checking guards (gap 34)
**Why deferred**: Needs an embedding-based similarity check or fact
database lookup. Significant infrastructure (vector DB, embedding
provider, similarity threshold tuning).

**Implementation sketch**:
1. Add `factCheckResults?: Array<{ claim, verdict, source }>` to plan output.
2. Server post-processes LLM reply: extract claims via small classifier,
   compare against `siteKnowledge.SITE_PAGES_KNOWLEDGE` + `orb-memory`
   embeddings.
3. If any claim is `unsupported` or `contradicted`, prepend a banner to
   the reply and bump `decisionMode` to `clarification`.
4. Cache fact-check results by claim hash to keep latency reasonable.

### Output content moderation (gap 17)
**Why deferred**: Decision pending on which moderator to use (Claude
moderation API vs OpenAI Moderation vs Llama Guard). Add a thin
`server/services/contentModeration.ts` wrapper once chosen, then call
it before returning replies in `ai.chat`.

### Deeper RBAC scoping (gap 9)
**Why deferred**: Current model (per-tool whitelist + per-page disable +
confirmationPolicy) is enough for solo users. Multi-tenant / team
permissions need a separate role schema; not blocking the orb agent
itself.

## Changelog of files in this PR
- `shared/orb-prompt-defense.ts` — new
- `server/orb-prompt-defense.test.ts` — new
- `server/orb-task-state-machine-extras.test.ts` — new
- `shared/orb-task-state-machine.ts` — extends step + audit types, adds
  `computeRetryBackoffMs`, `DEFAULT_STEP_TIMEOUT_MS`, `InterAgentMessage`
- `server/services/orbTaskStateMachine.ts` — `failOrbAgentStep` gains
  auto-retry support, new `runStepWithTimeout` and `recordAgentMessage`
- `server/services/orbReplyParser.ts` — exposes `citations`
- `server/services/agentPlanner.ts` — system prompt instructs citations
- `server/routers.ts` — wires prompt-injection defense + per-user kill switch
- `shared/agent-plan-schema.ts` — adds `citations` to v1 + v3 schemas
- `shared/orb-memory.ts` — surfaces `memoryId` + `source` to planner

## Remaining manual verification
- DB migration `0017_agent_preferences_extend.sql` must be applied on
  production (`npm run db:push`).
- E2E tests in `tests/e2e/` need Playwright installed in CI.
- Visual confirmation of orb widget corner switching on real browser.
