# Global Orb Capability Registry

## 目的
讓 Global Orb 在全站可安全操作，且 planner 只能使用「已註冊」能力與工具，避免亂編 action/tool。

## 頁面能力（Page Capabilities）
- 能力來源：`shared/global-agent-capabilities.ts`
- 以 `APP_PAGE_REGISTRY` 中 `supportsPageAgent=true` 的頁面自動展開能力集合。  
- 每筆能力包含：
  - `id`, `pageId`, `pagePath`, `label`, `description`
  - `actionType`, `riskLevel`, `requiresApproval`
  - `inputSchema`, `outputExpectation`
  - `supportedModalities`, `enabled`

## Action Type 說明（核心）
- `fillPrompt`
- `setModel`
- `setMode`
- `setModality`
- `setParam`
- `applyPreset`
- `submit`
- `reset`
- `navigate`
- `openDialog`
- `search`
- `runWorkflow`

## Tool Registry
- 定義檔：`shared/global-agent-tools.ts`
- 目前支援：
  - `media.transcribe`
  - `media.caption`
  - `media.storyboard`
  - `media.summarizePdf`
  - `media.extractPrompt`
  - `github.review`
  - `github.pr.create`
  - `deploy.preview`
  - `code.modifyWithClaudeCode`
- 每個 tool 含：
  - `riskLevel`
  - `requiresHuman`
  - `allowedArgsSchema`
  - `executionTarget`（ui/server/claudeCode/external）

## Risk 規則
- 未註冊 action/tool：`blocked`
- 頁面無對應 capability：`blocked` 或 clarification
- `submit/reset/applyPreset`：高風險 + 需人工確認
- GitHub/deploy/code write：高風險 + 需人工確認
- ClaudeCode：`tasked` + `requiresHuman=true`

## PageAgent Registration Checklist
每個頁面至少提供：
- `pageId`
- `pageLabel`
- `pagePath`
- `capabilities`
- `state snapshot`
- action handlers（能接收 fill/set/submit/reset 等）

## 新增新頁面能力
1. 在 `APP_PAGE_REGISTRY` 加入頁面（`supportsPageAgent=true`）
2. 在頁面註冊 PageAgent snapshot（包含 capability/state）
3. 若需要新 actionType，先擴充 shared action schema 與 safety gate
4. 補測試（registry + planner + safety + fallback）

## 新增 ClaudeCode Tool
1. 在 `shared/global-agent-tools.ts` 註冊 tool name
2. 設定 `riskLevel=high`, `requiresHuman=true`, `executionTarget=claudeCode`
3. 在 state machine 寫入 claude audit event
4. 補 safety gate 測試與 tasked flow 測試

## Feature Flags / Rollback
- `ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY`
- `ENABLE_GLOBAL_AGENT_TOOL_REGISTRY`

關閉任一 flag：
- `ai.chat` 仍可聊天
- 走 legacy fallback（`parseOrbReply`）
- 不 crash

