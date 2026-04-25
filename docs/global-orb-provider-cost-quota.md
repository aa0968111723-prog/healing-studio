# Global Orb Provider / Cost / Quota Guard

## Provider Router 架構
- 入口：`server/services/providerRouter.ts`
- Provider 欄位：`id`, `label`, `kind`, `enabled`, `priority`, 能力旗標、`timeoutMs`, `retryBudget`, `requiredEnvKeys`, `fallbackProviderIds`。
- 支援 provider：`gemini`, `default_llm`, `claudeCode`, `codex`, `fal`, `elevenlabs`, `suno`, `minimax`, `disabled`。

## Provider health 狀態
- `healthy`, `degraded`, `disabled`, `missing_key`, `rate_limited`, `timeout`, `unknown_error`。
- `providerHealth.ts` 會在 timeout/rate-limit/error 時更新健康度。
- `GEMINI_API_KEY` 缺失會被判定為 `missing_key`。
- reason 會做 secret redaction，不可輸出 API key。

## Provider 選擇規則
- planner image/audio/video/pdf → Gemini。
- code/github/deploy → ClaudeCode 或 Codex。
- image generation / video generation → FAL（失敗可 fallback）。
- voice/TTS → ElevenLabs。
- music → Suno。
- text low-risk → default LLM。
- provider 不健康時自動 fallback；若全部不可用，回 `provider_unavailable`。

## Cost Guard 規則
- 入口：`server/services/orbCostGuard.ts`
- 估算依據：provider、modality、附件大小、輸出類型、token/duration/asset、cross-page 步數、retry 次數。
- 高成本（video、code/deploy、多資產、重試超過 1 次、跨頁多步）→ `requiresHuman=true` + `askBeforeAct=true`。

## Quota / rate limit 規則
- 入口：`server/services/orbQuota.ts`
- 每日使用者額度：planner / generation / multimodal_analysis / code_task。
- Session 10 秒內 rapid-click throttle。
- Provider 1 分鐘內 rate limit bucket。
- task retry limit：>1 即阻擋。

## Attachment size limit
- image 10MB
- audio 20MB
- video 40MB
- pdf 12MB
- unsupported MIME 直接 block
- 友善訊息：
  - 「這個檔案太大，我目前無法直接處理。請壓縮後再上傳，或先轉成較短的 MP3 / MP4 / PDF 摘要。」
- 禁止把大檔案 base64 內容直接送入 LLM。

## Idempotency
- 入口：`server/services/orbIdempotency.ts`
- key 組成：user/session + normalized intent + attachment URL hash。
- 短時間重複任務不重建 task，改回傳重複任務提示／既有 task。

## Telemetry
新增事件：
- `provider.selected`
- `provider.fallback_used`
- `provider.unavailable`
- `provider.rate_limited`
- `provider.timeout`
- `provider.recovered`
- `quota.allowed`
- `quota.blocked`
- `cost.estimated`
- `cost.approval_required`
- `idempotency.duplicate_detected`
- `attachment.too_large`

禁止記錄：API key、secret、完整檔案內容、base64 原文、credentials。

## UI fallback messages
- 高成本：
  - 「這個流程可能會使用較多生成額度，包含影片生成或多步驟工作流。我需要你確認後再執行。」
- provider unavailable：
  - 「目前這個模型服務暫時不可用，我可以改用替代模型，或稍後再試。」
- quota exceeded：
  - 「你今天的此類任務額度已用完，可以改成較小的任務，或明天再試。」
- duplicate task：
  - 「我發現你剛剛已送出相同任務，為了避免重複扣額度，我先沿用既有任務進度。」

## Railway env checklist
- `ENABLE_ORB_PROVIDER_ROUTER`
- `ENABLE_ORB_COST_GUARD`
- `ENABLE_ORB_QUOTA_GUARD`
- `ENABLE_ORB_IDEMPOTENCY_GUARD`
- `GEMINI_API_KEY`
- `FAL_KEY` / `FAL_API_KEY`
- `ELEVENLABS_API_KEY`
- `SUNO_API_KEY`
- `NVIDIA_API`
- `ENABLE_CLAUDE_CODE_TASKS`
- `ENABLE_CODEX_TASKS`

## Rollback plan
1. `ENABLE_ORB_PROVIDER_ROUTER=false`
2. `ENABLE_ORB_COST_GUARD=false`
3. `ENABLE_ORB_QUOTA_GUARD=false`
4. `ENABLE_ORB_IDEMPOTENCY_GUARD=false`

Rollback 後：
- 回到既有 provider 路由
- 保留 AgentPlan v3 safety + askBeforeAct
- 保留 legacy parseOrbReply fallback
- 不可讓 ai.chat crash
