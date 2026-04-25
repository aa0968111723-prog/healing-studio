# Global Orb AI Agent QA（部署前回歸）

## 範圍
- 使用者輸入 / 附件
- `Global Orb` 前端
- `ai.chat` router
- `runSchemaFirstAgentPlanner()`
- `AgentPlan v3` / `parseAndGatePlan()`
- confirmation / task / actions / feedback / telemetry

---

## 測試案例與預期

### 1) Text-only baseline
**Prompt**
- 幫我做一支 30 秒短片

**預期**
- `ai.chat` 正常回覆。
- response 含：`plannerStatus`, `planId`, `traceId`。
- 不自動執行 high-risk workflow。
- `askBeforeAct` 與 confirmation card 流程正常。

### 2) Image upload
**Prompt**
- 請把這張圖做成 10 秒影片，風格要電影感

**預期**
- `image/png`、`image/jpeg` 保持 `image_url`。
- 不 flatten 成純文字、不轉 base64。
- planner `preferEngine="gemini"`。
- `routing.capabilities` 包含 `multimodal`（或等價 multimodal routing）。
- 若涉及生成，`askBeforeAct=true`。

### 3) Audio upload
**Prompt**
- 請分析這段錄音，幫我做字幕與旁白企劃

**預期**
- `audio/mpeg`、`audio/webm` 保持 `file_url + mime_type`。
- planner 使用 Gemini。
- 不轉 base64。
- 回 transcription / caption / voice workflow plan 或 clarification。
- 不自動執行 high-risk workflow。

### 4) Video upload
**Prompt**
- 請拆解這支影片的分鏡，並規劃短影音剪輯流程

**預期**
- `video/mp4` 保持 `file_url + mime_type`。
- planner 使用 Gemini。
- 產生 storyboard / edit plan。
- 多步驟流程為 `tasked` 或 `askBeforeAct=true`。

### 5) PDF upload
**Prompt**
- 請把這份 PDF 改成 30 秒短影音腳本

**預期**
- `application/pdf` 保持 `file_url + mime_type`。
- planner 使用 Gemini。
- 產生 summary / script / storyboard steps。
- PDF 無法讀取時回 clarification，不 crash。

### 6) Unsupported file fallback
**檔案**
- `.zip` / `.xlsx`

**預期**
- 回覆固定文案：  
  `這個格式我目前不能直接讀取，請轉成 PDF / PNG / MP3 / MP4，或貼文字內容。`
- 不進 planner、不送 LLM、不 crash。

### 7) 安全規則
**預期**
- `submit requiresApproval=false` → blocked
- `reset requiresApproval=false` → blocked
- `applyPreset requiresApproval=false` → blocked
- `unknown action` → blocked
- `unknown tool` → blocked
- `code/github/deploy` capability → `tasked + preferredEngine=claudeCode + requiresHuman=true`

### 8) Legacy fallback
**預期**
- planner invalid JSON → fallback `parseOrbReply()`
- 舊 `[ACTION:...]` 仍可運作
- 舊 Orb chat 不因 v3 失效

### 9) ai.chat 最小回傳欄位
**預期**
- `reply`
- `actions`
- `askBeforeAct`
- `suggestions`
- `plannerStatus`
- `planId`
- `traceId`
- `taskId`（tasked 時）或 `taskDraft`
- `preferredEngine`
- `warnings`

---

## Railway 環境檢查清單
- [ ] `GEMINI_API_KEY` 僅存在 server env，不進 client bundle。
- [ ] 沒有新增 `VITE_GEMINI_API_KEY`。
- [ ] browser network payload 無 provider API key。
- [ ] audio/video/pdf 不以 base64 注入 LLM payload。
- [ ] `LLM_ENGINE=auto`（或既有 provider routing）不被破壞。
- [ ] fallback 行為保留：`parseOrbReply`、AgentPlan v1 compatibility。

---

## Rollback Plan
1. 關閉 schema-first planner feature flag（若環境已提供）。
2. 關閉 Global Agent workflows flag（若環境已提供）。
3. 強制走 legacy `parseOrbReply` fallback 路徑。
4. 回滾最近 agent planner 相關 commit（含 router plumbing 與 planner schema wiring）。
5. 驗證 smoke tests：
   - text-only chat
   - `[ACTION:...]` legacy marker
   - 既有生成 API（image/video/audio/voice）

