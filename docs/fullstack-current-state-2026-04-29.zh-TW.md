# Healing Studio 前後端現況全景盤點（深度版）

日期：2026-04-29  
範圍：前端（React/Vite）↔ BFF（Express+tRPC）↔ AI Provider / Webhook / 即時通道

## 1) 系統拓樸（你圖上的「前端 → 後端 → AI 大腦」）

```text
Browser (Wouter SPA + React Query + tRPC Client)
  ├─ 單向請求：HTTP /api/trpc (query/mutation)
  ├─ 單向上傳：HTTP /api/upload
  ├─ 雙向/準雙向：SSE /api/sse/*（伺服器推播）
  └─ 雙向：WebSocket /ws/orb-voice

Express App (server/_core/index.ts)
  ├─ tRPC AppRouter（主業務）
  ├─ Upload / Download / AI Proxy / OAuth / Auth 等 REST routes
  ├─ Webhook 入站（fal / Stripe）
  └─ Cron/排程（健康檢查、同步、警報、自動配額）

Service Layer
  ├─ falDispatcher（影像/影片/音訊/TTS 統一路由）
  ├─ modelClients（多供應商調度）
  ├─ orbTaskStateMachine / orbMemory / agent planner
  └─ provider health / quota / idempotency

Data Layer
  ├─ MySQL + Drizzle ORM
  └─ 物件儲存（R2/S3/GCS 抽象）
```

---

## 2) 前端現況（路由、狀態、與後端耦合）

### 2.1 路由與頁面分層
- 首頁 `Home` 為 eager load，其餘多數頁面採 `lazy()` + `Suspense`，代表前端已做按需分包與載入骨架。  
- 主要創作線頁面為 `/studio`、`/director`、`/image-studio`、`/video-studio`、`/pro-studio`，並有 `/admin`、`/dashboard`、`/assets` 等營運頁。  
- 舊路徑被 redirect 到新資訊架構（例如 `vault/shared/history/prompt-library` 轉進 `/assets?section=*`），降低路由碎裂。  

### 2.2 全域 Provider 與跨頁能力
- App 最外層掛了多個 Context Provider：主題、素材抽屜、個人偏好、Page Agent、Global Orb Chat、Orb Guide、Focus/Ambient 等，表示系統不是單頁孤島，而是「跨頁狀態協作」。  
- 這種設計可支援你畫面中的「全站儀表板」：同一顆光球/助手可跨頁取得上下文與操作入口。

### 2.3 前端到後端資料通道
- tRPC client 直接綁 `AppRouter` 型別，前後端 schema 同步（型別單源）。  
- `main.tsx` 將 client endpoint 指向 `/api/trpc`，屬於同源 BFF 模式，減少 CORS 與版本漂移風險。  

---

## 3) 後端現況（接線總機 + 模組化業務）

### 3.1 入口與中介層
- 入口在 `server/_core/index.ts`：統一掛載 helmet、compression、rate limit、trace/logger、error handler。  
- `createExpressMiddleware` 將 tRPC 掛在 `/api/trpc`；另有 upload、SSE、fal webhook、stripe webhook、ai proxy 等路由。

### 3.2 Router 與領域分割
- `server/routers.ts` 導入大量子 router（brain / proStudio / imageStudio / videoStudio / loraTrainer / director / admin 等），是「單入口、多領域」BFF。
- 這讓前端每個功能頁可以對應一段清晰 API namespace，減少前端直接耦合外部 provider。

### 3.3 服務層現況
- 系統已明確把多模態生成集中在 `falDispatcher`，並在 router 註解標示不再直呼舊 compiler，代表「統一派發」已成主幹。  
- 有 provider health、quota、idempotency、telemetry sanitize 等配套，顯示已考慮實務維運（配額、重試、敏感資訊遮罩）。

---

## 4) 單向 vs 雙向資料流（你要求的「單雙向細節」）

## 4.1 單向流（Request → Response）
1. 前端 mutation/query 呼叫 `/api/trpc/*`。
2. Router 驗證參數（zod）與權限（public/protected/admin procedure）。
3. 服務層調用模型供應商或 DB。
4. 回傳結果給前端（必要時附本地化後媒體 URL）。

適用：一般查詢、設定更新、啟動生成任務。

## 4.2 準雙向流（Server Push via SSE）
1. 前端訂閱 `/api/sse/*`（HTTP 長連線）。
2. 後端透過事件匯流（generation events）把任務進度推到客戶端。
3. 前端不必輪詢即可更新 UI（例如生成進度卡、狀態徽章）。

適用：中長任務進度、背景工作狀態。

## 4.3 全雙向流（WebSocket）
1. 前端 `useOrbVoice` 連到 `/ws/orb-voice?token=...`。
2. 後端 `orbVoiceGateway` 處理雙向語音控制封包。
3. 可達成更低延遲的語音互動與即時控制。

適用：語音互動、即時對話控制。

## 4.4 反向入站流（Provider → 你的後端）
1. 你送任務給外部 provider（如 fal）。
2. provider 以 webhook 回呼你的 `/api/.../webhook`。
3. 後端回寫任務狀態/結果，再由 SSE/查詢反饋到前端。

適用：外部非同步任務完成通知。

---

## 5) 你目前畫面（AI 大腦組態管線）對應到程式現況

- 你畫面顯示「前端頁面 → 後端路由 → AI/代理 → 外部模型 API」的健康鏈路，與現行程式的分層一致。  
- 後端確實同時存在：
  - Router 層（業務入口）
  - Service 層（供應商派發/狀態機/記憶）
  - 入站 webhook 與出站 SSE/WS 通道
- 代表這不是單純 UI 假資料，而是可對應到真實的進出站路由與事件機制。

---

## 6) 現況優勢與風險（實話版）

### 優勢
- 前端路由與 Provider 架構成熟，可支援跨頁代理/助手。  
- 後端以 tRPC 聚合，型別同步佳，前後端協作效率高。  
- 已具備三種資料通道（RPC、SSE、WS）與 webhook 回流，適合 AI 任務型產品。  

### 風險/技術債
- `server/routers.ts` 與部分頁面（如 Director / Studio 類）檔案體積偏大，長期維護與 onboarding 成本高。  
- 多 Provider 並行下，若沒有進一步「跨 provider 統一 trace id / SLA 分層告警」，運維判讀會逐漸複雜。  
- 準雙向（SSE）與雙向（WS）並存，若前端缺少統一 connection-state store，可能出現狀態不同步（UI 顯示與後端真實狀態短暫偏差）。

---

## 7) 建議你下一步加強（若要「更正確、更深入、可運維」）

1. **建立單一「鏈路觀測 ID」**：每次前端觸發任務都帶 `traceId`，串到 tRPC、dispatcher、provider、webhook、SSE/WS。  
2. **把健康儀表板節點資料改為可追溯證據**：每個節點點開要看到最近 N 次請求成功率、P95 延遲、最近錯誤範例。  
3. **前端 connection-state 中央化**：把 tRPC loading、SSE 狀態、WS 狀態統一到一個 store，避免多頁各自判斷。  
4. **大檔分割策略**：先從 router / page 各挑 1 個超大檔，按「schema、service call、ui sections」拆分，降低回歸風險。

