# Orb Workflow Confirmation Card — Cross-Page Execution QA Checklist

> **Issue #160 follow-up.** The deterministic state-machine pieces of the
> Workflow Confirmation Card pipeline are pinned by
> `server/workflow-confirmation.test.ts` (25 tests). Everything else in this
> document still needs human QA — the cells noted below cannot be reliably
> automated without a real browser, real router, real SSE channel, and real
> page-agent dispatch.

## Scope

The cross-page agent UX flow under test:

```
ai.chat (planner)
   │  status=converted, askBeforeAct=true, runWorkflow action
   ▼
WorkflowConfirmationCard          ← user sees the plan, must click Start
   │  Start            → executeActions(plan.actions) + setPendingWorkflow(null)
   │  Cancel / Revise  → setPendingWorkflow(null)
   ▼
WorkflowExecutionFloatingPanel    ← progress bar, current step, errors
   │  navigate / setMode / submit dispatched per step
   ▼
completeWorkflow / failWorkflowAtCurrentStep
```

## What is already automated (do not re-test by hand)

`server/workflow-confirmation.test.ts` pins:

- `findWorkflowAction` selects `runWorkflow` from a mixed action list.
- `workflowStepsToState("pending"|"running")` initial states.
- `buildPendingWorkflowPlan` preserves order, total, intent, full action list.
- `buildWorkflowExecutionState` seeds the first step as running.
- `advanceWorkflowStep` cross-page reducer (idempotent on `startedAt`,
  preserves prior `completedAt`, accepts orchestrator label/path updates).
- `failWorkflowAtCurrentStep` only paints the current step red, freezes
  the workflow, leaves earlier completed steps completed and later
  pending steps pending.
- `completeWorkflow` fills 100%, defends `currentIndex` against
  degenerate `total=0`, write-once `completedAt`.
- Start / Cancel / Revise transitions at the data-model level.

## What this checklist covers (human QA only)

Real-browser behaviour the unit tests cannot exercise:

1. UI layering and visibility (z-index, modal stacking).
2. Real router navigation and the page-agent bus on the destination page.
3. SSE / orchestrator delivery across page changes.
4. Toast / message thread updates on Start / Cancel / Revise.
5. Approval card variants (Executor, Code task) co-existing with the
   Workflow card.

---

## Pre-flight setup

- [ ] Build a fresh client: `npm run build` (or `npm run dev`).
- [ ] Sign in with a non-admin user (so quota / cost guard apply).
- [ ] DevTools → Network → keep open. Filter for `ai.chat` and `/api/agent/`.
- [ ] DevTools → Console → no red errors before starting.
- [ ] Verify three feature flags are **on** (default behaviour):
  - `ENABLE_SCHEMA_FIRST_PLANNER` (or unset)
  - `ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY`
  - `ENABLE_GLOBAL_AGENT_TOOL_REGISTRY`

---

## Test 1 — Happy path: 30-second short video

**Prompt:** `幫我做一支 30 秒短片`

### Confirmation card appears

- [ ] Card slides in at **bottom-right**, ~`380px` wide.
- [ ] Heading reads `需要你的確認`, name shows `短片創作流程` (or
      planner-chosen label).
- [ ] Step preview shows up to 5 steps; remaining steps shown as
      `還有 N 步…` if the plan is longer.
- [ ] Three buttons visible and enabled: `取消` / `修改計畫` / `開始執行`.
- [ ] Card is **above** the orb sphere itself (z-index: card `z-[85]` >
      sphere): the orb's halo does **not** clip the card.
- [ ] No background scrolling locked; user can still scroll the page
      under the card.

### Click 開始執行 (Start)

- [ ] Confirmation card disappears.
- [ ] Orb chat thread shows: `✅ 已確認，開始執行「短片創作流程」。我會依序完成 N 步。`
- [ ] **WorkflowExecutionFloatingPanel** appears bottom-right
      (~`360px` wide, `z-[80]`).
- [ ] Progress bar visible, percent = 0%, status label `執行中`.
- [ ] First step shown as `目前步驟` with the orchestrator's label.

### Cross-page navigation actually fires

- [ ] First action is `navigate:/studio` (or planner-chosen path).
- [ ] Browser URL bar changes to `/studio`.
- [ ] Floating panel **persists** through the route change — does not
      flash / unmount / reset.
- [ ] Progress bar updates: step 0 marked complete, step 1 marked running,
      percent advances proportionally to `completedCount/total`.

### Per-step page-agent dispatch

- [ ] Step `setMode` actually flips the destination page's mode tab/state
      (verify visually on `/studio`).
- [ ] Step `submit` actually triggers a generation request (verify in
      Network tab).
- [ ] Each step's `pageAgent.reportFeedback` POST goes through (Network
      tab → `/api/agent/feedback` or equivalent — wording may differ in
      your build).

### Completion

- [ ] All steps end as `●` (emerald-300 dot, completed).
- [ ] Progress bar at 100%.
- [ ] Status label flips to `已完成`.
- [ ] Floating panel can be dismissed via `關閉`.

---

## Test 2 — Cancel before execution

**Prompt:** `幫我做一支 30 秒短片`

- [ ] Confirmation card appears as in Test 1.
- [ ] Click **取消**.
- [ ] Card disappears immediately.
- [ ] Orb thread shows `已取消「短片創作流程」，我不會執行任何跨頁操作。`
- [ ] No `WorkflowExecutionFloatingPanel` ever mounts.
- [ ] Browser URL does **not** change.
- [ ] Network tab: no `/api/agent/run` or `setMode` / `submit` calls fired.

---

## Test 3 — Revise before execution

**Prompt:** `幫我做一支 30 秒短片`

- [ ] Confirmation card appears.
- [ ] Click **修改計畫**.
- [ ] Card disappears.
- [ ] Orb chat panel **opens** (if it was minimised).
- [ ] Input field is pre-filled with:
      `請幫我修改這個流程：短片創作流程\n原始需求：…\n我想調整：`
- [ ] Orb thread shows: `可以，我先暫停這個流程。請告訴我你想修改哪裡…`
- [ ] No `WorkflowExecutionFloatingPanel` mounts.
- [ ] Sending the revision prompt triggers a fresh `ai.chat` round trip
      (Network tab: a new `ai.chat` request).
- [ ] The new round may or may not produce a new confirmation card — verify
      the loop closes cleanly either way (card OR plain text reply).

---

## Test 4 — Step failure mid-execution (red banner)

Trigger by either:
- killing the LLM provider for one step (DevTools → Network → block
  `*.fal.ai/*` or `generativelanguage.googleapis.com/*`), or
- choosing a prompt that the planner is known to route to a missing model.

- [ ] On Start, panel mounts and progresses to step 1.
- [ ] When the failing step lands, `목前步驟` block shows the **rose-200**
      error text (`workflowExecution.error`).
- [ ] The failed step's row gets the `×` glyph (rose-300).
- [ ] **Earlier completed steps stay green** — they are NOT repainted red.
- [ ] **Later pending steps stay grey** — they are NOT repainted red.
- [ ] Status label becomes `失敗`.
- [ ] Progress bar stops advancing.
- [ ] Orb thread shows `⚠️ 我找到要做的事，但執行時遇到問題：…` with the
      raw failure reason.
- [ ] Panel can still be dismissed via `關閉`.

---

## Test 5 — z-index and modal layering

The card should reliably sit above other floating UI but below blocking
modals. Re-run Test 1 with these conditions:

- [ ] On a page that has its own bottom-right toaster (`Sonner`/`shadcn`
      toast), the confirmation card is **not occluded**.
- [ ] Open `BackgroundTasksDrawer` (or any side drawer): card is still
      visible (or, if intentionally hidden, this is documented in
      release notes).
- [ ] Open `ArticleDialog` / `FeatureDetailDialog` / `ManusDialog`: a true
      blocking modal **may** cover the card; verify the card returns to
      visible after the modal closes.
- [ ] On mobile width (`width <= 480px`), card max-width is
      `calc(100vw-2rem)` and does not overflow the viewport.

z-index ladder for reference (production code in
`client/src/contexts/GlobalOrbChatContext.tsx`):

| Component                          | z-index   |
| ---------------------------------- | --------- |
| `CodeTaskCard`                     | `z-[87]`  |
| `ExecutorConfirmationCard`         | `z-[86]`  |
| `WorkflowConfirmationCard`         | `z-[85]`  |
| `ExecutorProgressPanel`            | `z-[84]`  |
| `WorkflowExecutionFloatingPanel`   | `z-[80]`  |
| Orb sphere itself                  | < `z-[80]`|

- [ ] Verify the ladder visually — when an Executor approval and a
      Workflow confirmation arrive at the same time, the **Executor card
      sits on top** of the workflow card.

---

## Test 6 — Multiple cards co-existing

Trigger a `tasked` plan (Executor approval) and a `converted` plan
(Workflow confirmation) in the same session.

- [ ] Both cards visible simultaneously without overlap (one anchored
      bottom-left, one bottom-right).
- [ ] Approving the Executor card does **not** dismiss the Workflow card.
- [ ] Cancelling either card only clears its own pending state.

---

## Telemetry checks (Issue #165 + #160 cross-cutting)

After each test, in the `ai.chat` response payload (Network tab → response
body), verify:

- [ ] `plannerStatus` is one of `converted` / `clarification` / `tasked` —
      NOT `fallback-legacy` / `fallback-planner-error` /
      `fallback-schema-disabled`. If it is, see PR #185 / Issue #165 — the
      schema-first planner did not run.
- [ ] `telemetry.events` does NOT contain `planner.exception`.
- [ ] `traceId` and `planId` are present on every confirmation card —
      these get printed in the `ExecutorConfirmationCard` and should
      surface in the floating panel for debugging.

---

## Sign-off

| Tester | Date | Build SHA | Result |
| ------ | ---- | --------- | ------ |
|        |      |           |        |

If any cell is **red**, file a follow-up issue and link it back here.
If everything is green, paste the PR # that signed off in the row above and
close the QA gate on Issue #160.
