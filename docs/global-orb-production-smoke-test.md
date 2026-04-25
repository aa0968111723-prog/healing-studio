# Global Orb Production Smoke Test（Railway）

## Deployment Readiness（Env / Flags）

### 必要
- `GEMINI_API_KEY`（server-side only）

### 建議
- `LLM_ENGINE=auto`
- `ENABLE_SCHEMA_FIRST_PLANNER=true`
- `VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=true`
- `VITE_ENABLE_GLOBAL_AGENT_TELEMETRY=true`（若要觀測）

### 安全要求
- 不可新增 `VITE_GEMINI_API_KEY`
- 不可把 provider key 下發到 client
- 不可在 log / telemetry 寫出 API key

---

## A. Text-only baseline
**Prompt**：幫我做一支 30 秒短片

**Expected**
- `ai.chat` 200 OK
- `reply` 有內容
- `plannerStatus` 有值
- `planId` / `traceId` 有值
- 不自動執行 high-risk action
- `askBeforeAct` 正常

## B. Image upload
**Prompt**：請把這張圖做成 10 秒影片，風格要電影感

**Expected**
- `image_url` 到達後端
- `preferEngine="gemini"`
- 不 base64
- 有 AgentPlan v3 或 clarification
- workflow 需要 confirmation

## C. Audio upload
**Prompt**：請分析這段錄音，幫我做字幕與旁白企劃

**Expected**
- `file_url + audio mime_type` 到達後端
- `preferEngine="gemini"`
- 不 base64
- 不 crash

## D. Video upload
**Prompt**：請拆解這支影片的分鏡，並規劃短影音剪輯流程

**Expected**
- `file_url + video mime_type` 到達後端
- `preferEngine="gemini"`
- 多步驟流程 `tasked` 或 `askBeforeAct=true`

## E. PDF upload
**Prompt**：請把這份 PDF 改成 30 秒短影音腳本

**Expected**
- `file_url + application/pdf` 到達後端
- `preferEngine="gemini"`
- 產生 summary / script / storyboard 或 clarification

## F. Unsupported file
**Upload**：`.zip` / `.xlsx`

**Expected**
- 回覆：`這個格式我目前不能直接讀取，請轉成 PDF / PNG / MP3 / MP4，或貼文字內容。`
- 不進 planner
- 不進 LLM
- 不 crash

## G. Legacy fallback
**測試**
- planner invalid JSON
- 舊 `[ACTION:...]` marker

**Expected**
- `parseOrbReply` fallback 正常
- 舊功能不壞

## H. Safety
**測試**
- `submit requiresApproval=false`
- `reset requiresApproval=false`
- `applyPreset requiresApproval=false`
- `unknown action`
- `unknown tool`

**Expected**
- `blocked`
- `actions=[]`
- `askBeforeAct=true` 或 safe reply

---

## Observability Checklist
- response / log 至少有：
  - `traceId`
  - `planId`
  - `plannerStatus`
  - `preferredEngine`
  - `usedMultimodalPlanner`
  - `taskId`（tasked 時）
  - `warnings`
- log 不包含：
  - API keys
  - base64 blob
  - 大檔全文內容

---

## Failure Fallback Checklist
以下情境都應不 crash 且回安全 fallback：
- Gemini timeout
- Gemini key missing
- provider malformed JSON
- attachment URL 無法讀
- PDF 太大
- video/audio provider 不支援
- task materialization 失敗

期望：
- user-friendly fallback reply
- `actions=[]`
- 不 expose stack trace

---

## Rollback
1. `ENABLE_SCHEMA_FIRST_PLANNER=false`
2. `VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=false`
3. 強制使用 legacy `parseOrbReply`
4. revert 最新 agent planner wiring commit
5. 重新部署 Railway

