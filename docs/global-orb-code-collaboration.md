# Global Orb Code Collaboration (Claude Code / Codex)

## Flow
User request -> AgentPlan v3 -> parseAndGatePlan -> OrbTask(tasked) -> CodeTask(awaiting_approval) -> user approve -> Claude Code/Codex handoff prompt -> PR/test report -> memory + telemetry + rollback.

## CodeTask schema
Defined in `shared/orb-code-task.ts` with fields:
- `codeTaskId`, `taskId`, `planId`, `traceId`
- `provider`, `repository`, `branchName`, `baseBranch`
- `status`, `title`, `objective`
- `filesAllowed`, `filesForbidden`
- `acceptanceCriteria`, `testCommands`
- `riskLevel`, `requiresHuman`
- `prUrl`, `prNumber`, `commitSha`
- `summary`, `rollbackPlan`, timestamps

## Approval flow
- All code/github/deploy tasks are `requiresHuman=true`.
- Default status is `awaiting_approval`.
- Cannot run before approval.
- Cancelled/blocked/merged tasks cannot continue mutation.

## GitHub PR tracking
- `attachPr` validates GitHub PR URL pattern.
- Stores PR URL + PR number + branch + review/merge statuses.
- Supports manual status updates for review/merge/failure.

## Safety rules
- No auto-merge.
- No production secrets mutation.
- No adding VITE_* secrets.
- No API key/token/credential leakage in prompts/telemetry/memory.
- High-risk areas (auth/payment/deploy/db/user-data/upload security) are marked `riskLevel=high` and require approval.

## Forbidden files / secrets
- `.env`, `.env.local`, `**/secrets/**`, `**/credentials/**` are forbidden defaults.
- Prompt builders include forbidden file constraints.

## Memory rules
- On merged/failed code task, write memory `claude_code_task` or `codex_task` summary.
- Store only compact summaries, tests, rollback, PR URL, risk.
- Never store secrets/tokens/credentials/full huge diffs.

## Telemetry
Events:
- `codeTask.created`
- `codeTask.approved`
- `codeTask.running`
- `codeTask.pr_created`
- `codeTask.review_required`
- `codeTask.merged`
- `codeTask.failed`
- `codeTask.cancelled`

Fields include trace/plan/task/codeTask/provider/repo/branch/prNumber/risk/outcome/duration (when available), with secret redaction.

## Feature flags
- `ENABLE_ORB_CODE_COLLABORATION`
- `ENABLE_CLAUDE_CODE_TASKS`
- `ENABLE_CODEX_TASKS`

When off:
- keep plan preview only
- do not create executable external write actions
- ai.chat remains stable
- legacy fallback remains active

## Rollback
1. `ENABLE_ORB_CODE_COLLABORATION=false`
2. `ENABLE_CLAUDE_CODE_TASKS=false`
3. `ENABLE_CODEX_TASKS=false`
4. keep Orb plan-only responses
5. keep legacy parseOrbReply fallback
