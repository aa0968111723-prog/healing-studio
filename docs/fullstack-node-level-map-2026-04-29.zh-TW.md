# Healing Studio 前後端現況（節點級對照版）

日期：2026-04-29  
目的：把「Director AI 健康面板」的節點，具體對應到程式檔案、單/雙向資料流、失敗點與排查起手式。

## A. 先給你結論（下一步重點）

1. 你現在需要的不是再抽象描述，而是「**每個節點可追到哪個檔案、哪條 API、哪個事件通道**」。
2. 本文件把前端節點、後端節點、外部節點拆成「可落地排查矩陣」。
3. 若要再往下，我建議直接做第 3 步：在 Director AI 面板節點上新增「開啟對應 source link + 最近 20 筆 trace」。

---

## B. 節點級全鏈路矩陣（Frontend → Backend → Provider）

| 面板節點 | 前端入口 | 後端入口 | 服務層/資料層 | 通道型態 | 常見故障 | 立即排查 |
|---|---|---|---|---|---|---|
| 前端頁面（Studio/Director） | `client/src/App.tsx` 路由 + lazy 頁面 | `/api/trpc` | 各 router procedure | 單向（HTTP） | 404 路由漂移 / query key 不一致 | 檢查 route path、Network URL、tRPC procedure 名稱 |
| 前端光球聊天 | `GlobalOrbChatContext` / `ProactiveOrbWidget` | `appRouter.ai.*` | `agentToolExecutor`、`orbTask*` | 單向 + 準雙向（SSE） | 任務建立成功但 UI 不更新 | 檢查 SSE 訂閱是否存活、taskId 是否一致 |
| 頁面助手（PageAgent） | `PageAgentContext` + 各頁 `useRegisterPageAgent` | `orbGuide.* / ai.*` | planner + tool registry | 單向（HTTP） | capability 註冊有，但 action 不執行 | 檢查 action schema 與 server tool 名稱對齊 |
| 影像/影片/音訊生成 | `ImageStudio/VideoStudio/ProStudio` | 對應 studio router | `falDispatcher` | 單向啟動 + webhook 回流 + SSE | provider 任務完成但前端仍 pending | 檢查 webhook 是否打進來、job 狀態是否回寫 |
| 語音互動 | `useOrbVoice` | `/ws/orb-voice` | `orbVoiceGateway` | 雙向（WebSocket） | token 有效但 ws 斷線 | 檢查 ws upgrade、token query、proxy 設定 |
| 素材上傳 | `AssetsLibrary` / `AssetsQuickDrawer` | `uploadRoute` | storage 抽象（R2/S3/GCS） | 單向（HTTP upload） | MIME/大小被擋 | 檢查檔案類型、大小、server allowlist |
| 外部回呼 | 無（被動） | `webhookFal`、`stripeWebhook` | 任務/帳務回寫 | 反向入站（Webhook） | 簽章或 URL 錯誤 | 檢查 provider webhook URL/secret 與 server log |

---

## C. 單向/雙向/反向入站的「實際代碼對照」

## C1) 單向：tRPC（主交易通道）
- 前端 tRPC 型別 client：`client/src/lib/trpc.ts`。
- 前端實際 endpoint：`client/src/main.tsx` 指向 `/api/trpc`。
- 後端掛載點：`server/_core/index.ts` 使用 `createExpressMiddleware` 掛在 `/api/trpc`。
- Router 聚合入口：`server/routers.ts`。

**意義**：你大多數頁面功能（查詢、送出任務、設定）都先經過這條通道，這是「主血管」。

## C2) 準雙向：SSE（進度推播）
- 後端路由：`server/sseRoute.ts`。
- 後端事件源：`generationEvents`（由生成流程產生事件）。
- 典型用途：背景生成任務從 queued → processing → completed 的 UI 同步。

**意義**：SSE 壞掉時，最常見現象是「後端其實做完了，但前端一直轉圈」。

## C3) 雙向：WebSocket（語音）
- 前端連線：`client/src/hooks/useOrbVoice.ts`（`/ws/orb-voice?token=...`）。
- 後端處理：`server/_core/index.ts` 建立 `WebSocketServer`，交給 `server/ws/orbVoiceGateway.ts`。

**意義**：語音互動與低延遲控制不應硬塞在 tRPC，WS 的存在是正確分工。

## C4) 反向入站：Webhook
- fal webhook 路由在 `server/_core/index.ts` 掛載。
- 路由實作在 `server/routes/webhookFal.ts`。
- 付款回呼在 `server/routes/stripeWebhook.ts`。

**意義**：只要外部任務是非同步完成，就必須依靠反向入站通道，不是前端輪詢可以完全取代。

---

## D. 以「你畫面的 51 節點」落地成可量測健康指標

你現在面板有顏色分類（正常/需優化/損壞/異常），下一步要補「可觀測量」。

每個節點至少加 5 個欄位：
1. `successRate_15m`
2. `p95LatencyMs`
3. `errorCodeTop3`
4. `lastFailureAt`
5. `traceSampleIds[]`

這樣點節點時，才是「證據導向」而不是只看燈號。

---

## E. 下一步（你說的「下一步」我直接拆成可執行）

## Step 1（立即可做，低風險）
在 Director AI 節點詳細面板新增：
- 「對應前端檔案」
- 「對應後端 procedure / route」
- 「對應 service 函式」
- 「最近 20 筆 traceId」

## Step 2（1~2 天）
把 tRPC / SSE / WS / webhook 事件統一一個 correlationId（建議 `orbTraceId`），並落到 log 與 DB（至少 backgroundJobs / orbTasks）。

## Step 3（2~4 天）
做「節點診斷按鈕」：
- 一鍵跑最小探測請求（ping procedure / 測 webhook 驗章 / 測 ws 握手）
- 回傳建議修復腳本（對應 env key、provider URL、timeout）。

---

## F. 你可以如何使用這份文件（實務）

- 新人 onboarding：先看 B/C 區，直接知道每種通道去哪裡看。
- incident 排查：先判斷故障屬於單向、準雙向、雙向、反向入站哪一類。
- 技術債治理：先從「大檔 + 高流量節點」優先拆分（例如 App route 聚合頁、大型 router）。

