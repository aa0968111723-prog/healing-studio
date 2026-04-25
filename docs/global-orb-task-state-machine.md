# Global Orb Task State Machine

## Task States
- `idle`
- `planning`
- `awaiting_approval`
- `approved`
- `executing`
- `paused`
- `recovering`
- `completed`
- `failed`
- `cancelled`
- `blocked`

## Core Fields
- `taskId`
- `planId`
- `traceId`
- `intent`
- `summaryForUser`
- `status`
- `currentStepId`
- `steps`
- `createdAt`
- `updatedAt`
- `completedAt`
- `failedReason`
- `approvalRequired`
- `preferredEngine`
- `usedMultimodalPlanner`
- `warnings`
- `auditEvents`

## Transitions
- create task → `task.created`
- needs approval → `task.awaiting_approval`
- approve → `task.approved` then `step.started`
- step done → `step.completed`
- all done → `task.completed`
- step fail → `step.failed` + `task.failed`
- retry budget exhausted → `task.recovering`
- user cancel → `task.cancelled`
- safety blocked → `task.blocked`

## Approval Rules
- `approvalRequired=true` task starts at `awaiting_approval`.
- approve 後才可進入 `approved/executing`。
- high-risk / code 任務不可自動執行。

## Recovery Flow
1. step failed → task `failed`
2. `retryBudget > 0` 可 retry 並消耗 budget
3. budget 用盡 → `recovering`
4. recovery 產生新 plan，需再次經過 `parseAndGatePlan`
5. high-risk recovery 不自動執行

## Memory Flow
- task `completed/failed/cancelled/blocked` 寫入 memory event：
  - `taskId`, `planId`, `traceId`, `outcome`, `usedEngine`, `actionTypes`, `failedReason`
- planner 僅讀最近 10 筆摘要，不塞大內容。

## Claude Code Collaboration Flow
- 若 `preferredEngine=claudeCode` 或 capabilities 含 `code/github/deploy`：
  - isolation 強制 `code`
  - task 強制 `awaiting_approval`
  - audit events:
    - `claudeCode.requested`
    - `claudeCode.plan_created`
    - `claudeCode.pr_ready` / `claudeCode.failed`

## Rollback Plan
1. `ENABLE_ORB_TASK_STATE_MACHINE=false`
2. `ENABLE_ORB_TASK_MEMORY=false`
3. `ENABLE_ORB_TASK_RECOVERY=false`
4. fallback 至舊 actions / `parseOrbReply`
5. revert 最近 task state machine wiring commit
6. redeploy Railway

