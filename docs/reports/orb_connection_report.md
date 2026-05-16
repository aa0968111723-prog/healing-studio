# Orb Assistant & Global Agent — Connection Audit Report

**Date**: 2026-04-25  
**Branch**: `claude/fix-orb-assistant-qMqZU`  
**Scope**: 全站光球助手（ProactiveOrbWidget）、全站光球代理（GlobalOrbChatContext / PageAgentContext）及後端 `ai.chat` 路由的完整審查與修復。

---

## 1. 審查摘要

### 1.1 各頁面光球助手按鈕 ✅

`ProactiveOrbWidget` 由 `GlobalOrbChatProvider` 統一渲染（位於 `client/src/contexts/GlobalOrbChatContext.tsx` line ~969），並透過 `App.tsx` 的 Provider 堆疊覆蓋全站所有路由。因此所有頁面均自動具備光球 UI。

| 頁面 | 光球按鈕 | GlobalOrbChat |
|------|---------|---------------|
| 首頁 (`/`) | ✅ | ✅ |
| 創作工作室 (`/studio`) | ✅ | ✅ |
| 圖片工作室 (`/image-studio`) | ✅ | ✅ |
| 影片工作室 (`/video-studio`) | ✅ | ✅ |
| 專業工作室 (`/pro-studio`) | ✅ | ✅ |
| 導演 AI (`/director`) | ✅ | ✅ |
| 教學總覽 (`/tutorial`) | ✅ | ✅ (本次新增) |
| 其餘 24 個功能頁面 | ✅ | ✅ |

---

## 2. 已完成修復項目

### 2.1 缺失的 PageAgent 註冊 — `TutorialOverviewPage`

**問題**：`TutorialOverviewPage.tsx` 未呼叫 `useRegisterPageAgent`，光球無法在此頁面執行導覽動作。

**修復**：
- `client/src/pages/TutorialOverviewPage.tsx` — 新增 `useRegisterPageAgent`，帶入 `navigate` capability，支援跳轉至 8 個目標頁面。
- `shared/appRegistry.ts` — 新增 `tutorial-overview` 條目（`supportsPageAgent: true`），使 `GLOBAL_AGENT_CAPABILITY_REGISTRY` 自動生成對應 capability。

### 2.2 全站 Agent Kill Switch

**問題**：無環境旗標可在不停機狀態下關閉光球動作執行，緊急情況下只能回退到純聊天模式。

**修復**：

**前端** (`client/src/contexts/GlobalOrbChatContext.tsx`)：
- 新增 `readOrbAgentEnabled()` 函數，讀取 `VITE_ENABLE_ORB_AGENT` 環境變數。
- `ORB_AGENT_ENABLED = false` 時，`sendMessage` 在收到後端回覆後跳過所有動作派送（pendingWorkflow、pendingExecutorTask、pendingCodeTask、executeActions 均不觸發）。
- Context value 新增 `orbAgentEnabled: boolean`，UI 元件可據此顯示「純聊天模式」提示。

**後端** (`server/routers.ts` — `ai.chat` mutation)：
- 新增 `ENABLE_ORB_AGENT` flag 讀取（讀取 `process.env` 及 `serverEnv`）。
- 當 flag 為 `false` 時，跳過全部 planner 邏輯，直接呼叫 `invokeLLM` 返回純文字回覆，`actions: []`。

**環境變數設定**：
```bash
# 關閉全站 Agent 動作（光球只提供聊天）
VITE_ENABLE_ORB_AGENT=false   # 前端
ENABLE_ORB_AGENT=false        # 後端

# 開啟（預設值）
VITE_ENABLE_ORB_AGENT=true
ENABLE_ORB_AGENT=true
```

---

## 3. 現有功能確認

### 3.1 多模態附件 ✅

`shared/orb-chat-multimodal.ts` 已實作：
- 圖片 → `{ type: "image_url", image_url: { url, detail: "auto" } }`
- 音訊 / 影片 / PDF → `{ type: "file_url", file_url: { url, mime_type } }`

後端 `ai.chat` 使用 `OrbChatRouterMessageSchema` 驗證並保留附件結構。`attachmentGuard.kinds` 決定 `routeIntent`（`planner_multimodal` / `planner_pdf`），並引導 Provider Router 選擇 Gemini 引擎。

### 3.2 破壞性動作確認卡 ✅

`shouldAskBeforeAct()` 函數（`shared/global-agent-orchestrator.ts`）自動攔截：
- `submit`、`reset`、`applyPreset` — 需確認
- `runWorkflow` 多步驟或包含破壞性步驟 — 需確認

前端透過 `WorkflowConfirmationCard` 元件呈現確認 UI，使用者按「開始執行」後才真正派送動作。

### 3.3 parseOrbReply Fallback ✅

`server/services/orbReplyParser.ts` 的 `parseOrbReply()` 已整合在 `ai.chat` router 的 fallback 路徑（planner 失效時使用），確保即使 schema-first planner 失敗，`[ACTION:...]` 格式的回覆仍能被解析。

### 3.4 工作流程任務時間線 ✅

`WorkflowExecutionFloatingPanel` 元件即時顯示：
- 進度條（完成步驟數 / 總步驟數）
- 每個步驟的狀態（pending → running → completed / failed）
- 失敗原因與可重試按鈕

取消支援：`cancelPendingWorkflow()` 在確認前可取消；`orbExecutor.cancelTask()` 在執行中可中斷。

---

## 4. 測試覆蓋

### 新增測試檔案

| 檔案 | 說明 |
|------|------|
| `server/orb-chat-multimodal.test.ts` | 已存在，完整覆蓋多模態附件 pipeline（已有 377 行）|
| `server/orb-agent-killswitch.test.ts` | 新增：`isDangerousAction`、`shouldAskBeforeAct`、`workflowsEnabled` 旗標讀取 |
| `server/orb-page-agent-registration.test.ts` | 新增：`APP_PAGE_REGISTRY` shape、`GLOBAL_AGENT_CAPABILITY_REGISTRY` 驗證、tutorial-overview 確認 |

### 測試場景覆蓋

| 場景 | 測試 |
|------|------|
| 純文字訊息 → string content | `orb-chat-multimodal.test.ts` |
| 圖片附件 → `image_url` part | `orb-chat-multimodal.test.ts` |
| 音訊附件 → `file_url` + mime | `orb-chat-multimodal.test.ts` |
| 影片附件 → `file_url` + mime | `orb-chat-multimodal.test.ts` |
| PDF 附件 → `file_url` + mime | `orb-chat-multimodal.test.ts` |
| 不支援格式 → 友善錯誤訊息 | `orb-chat-multimodal.test.ts` |
| submit 動作觸發確認卡 | `orb-agent-killswitch.test.ts` |
| 多步驟 workflow 觸發確認卡 | `orb-agent-killswitch.test.ts` |
| 安全動作不觸發確認卡 | `orb-agent-killswitch.test.ts` |
| workflows flag 關閉 | `orb-agent-killswitch.test.ts` |
| PageRegistry shape 驗證 | `orb-page-agent-registration.test.ts` |
| tutorial-overview 已註冊 | `orb-page-agent-registration.test.ts` |
| 破壞性 cap requiresApproval=true | `orb-page-agent-registration.test.ts` |

---

## 5. 待辦事項（Phase 4+）

| 項目 | 優先度 |
|------|--------|
| AdminPage / LangSmithPage 加入 agent 支援（管理員專用 capabilities） | 低 |
| E2E 測試（Playwright）：完整光球聊天流程 | 中 |
| 聊天面板訊息搜尋功能 | 低 |
| 按日期分組顯示訊息歷史 | 低 |
| 語音輸入（Web Speech API） | 低 |
| LocalStorage 跨頁連續性手動驗證 | 中 |

---

## 6. 修改檔案清單

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `client/src/contexts/GlobalOrbChatContext.tsx` | 修改 | 新增 kill switch (`VITE_ENABLE_ORB_AGENT`)、`orbAgentEnabled` context 欄位 |
| `client/src/pages/TutorialOverviewPage.tsx` | 修改 | 新增 `useRegisterPageAgent` 與 navigate capability |
| `shared/appRegistry.ts` | 修改 | 新增 `tutorial-overview` 條目 |
| `server/routers.ts` | 修改 | 新增 `ENABLE_ORB_AGENT` kill switch、chat-only fallback |
| `server/orb-agent-killswitch.test.ts` | 新增 | kill switch 及 askBeforeAct 單元測試 |
| `server/orb-page-agent-registration.test.ts` | 新增 | PageAgent 註冊合約測試 |

---

*最後更新：2026-04-25 — claude/fix-orb-assistant-qMqZU*
