# Global Orb Memory + RAG

## Memory schema
- Defined in `shared/orb-memory.ts`.
- Core fields: `memoryId`, `userId|anonymousSessionId`, `traceId`, `planId`, `taskId`, `type`, `summary`, `source`, `confidence`, `tags`, `createdAt`, optional `expiresAt`, `metadata`.

## Memory types
- `user_preference`
- `successful_workflow`
- `failed_workflow`
- `prompt_pattern`
- `model_preference`
- `style_preference`
- `tool_feedback`
- `claude_code_task`
- `safety_event`
- `recovery_event`

## Safety rules
- Never store: API keys, secrets, passwords, credit card-like numbers, identity-card-like sensitive strings, raw private documents, raw full transcript/media content, base64 payloads.
- Secret-like strings are redacted and a `safety_event` is stored.

## Preference extraction
- `extractOrbPreferencesFromConversation()` detects language/style/output/model/workflow/risk/ClaudeCode hints from conversation summaries.
- Extracted preferences are low-risk, replaceable, and user-clearable.

## Planner prompt injection
Planner context now includes:
1. Current page
2. Available capabilities
3. Available tools
4. Recent user memory
5. Recent task outcomes
6. Safety constraints

## Self-optimization rules
- If failed workflow appears repeatedly (>=2), planner summary includes a hint to avoid same strategy and prefer alternative model/page/workflow.
- If successful workflows repeat (>=2), planner summary hints that similar flow can be prioritized.
- If tool failures repeat, planner summary warns about reliability and confirmation/fallback.

## User controls
- API endpoints under `ai.orbMemory`:
  - `recent`
  - `search`
  - `plannerSummary`
  - `deleteOne`
  - `clearForUser`

## Feature flags
- `ENABLE_ORB_LONG_TERM_MEMORY`
- `VITE_ENABLE_ORB_MEMORY_PANEL`

## Rollback plan
1. `ENABLE_ORB_LONG_TERM_MEMORY=false`
2. `VITE_ENABLE_ORB_MEMORY_PANEL=false`
3. Planner skips long-term memory context
4. ai.chat/task/executor continue normally
5. Legacy `parseOrbReply` fallback remains active
