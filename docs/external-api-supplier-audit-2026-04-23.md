# 外部 API 供應商深度盤點（餐廳比喻版）

> 盤點日期：2026-04-23（UTC）
> 盤點範圍：`server/` 與 `client/src/` 中 `fetch` / `axios` 呼叫、AI 供應商代理、OAuth、背景任務、限流與觀測。

---

## 0) 快速結論（先給老闆看的）

- 我們已經有一個「中央叫貨櫃檯」`/api/ai/:provider/*`，會幫忙塞 API key、做 provider 規則、記錄每次叫貨耗時與狀態，這是很好的基礎。  
- 但目前仍有不少路徑是「直接打給供應商」，沒有統一走中央櫃檯，所以**重試、timeout、記錄、配額控制的品質不一致**。  
- 長工時菜色（尤其 fal 圖片/影片）已經有 queue 模式，但 Gemini 某些流程仍是同步等待，尖峰時容易讓客人卡在前台。  
- 最大隱患：**供應商呼叫策略碎片化**（有些有 retry/timeout/trace，有些只有 throw error）。

---

## 1) 🚚 聯絡供應商的電話有通嗎？（連線健康度）

### 1-1. 電話號碼與通行證（URL / API Key）

#### 已做得好的地方
- `aiProxy` 有固定供應商白名單與 base URL（fal/gemini/elevenlabs/suno），不讓任意域名穿透，並且在 key 缺失時回 503 + 指引。  
- `env.validated` 會定義多組 API key，缺值時用 OARS 風格警告，而不是直接炸掉整個服務。  
- Google OAuth 流程會檢查 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`，缺值直接報錯，避免默默用空值送出。

#### 風險點
- 關鍵 API key 大多採「空字串 default」策略（不是 hard fail），如果某條呼叫路徑漏了 guard，會出現晚期失敗（執行到外部請求才爆）。  
- `fetch` 呼叫分散在多個 router/service，雖然很多地方有檢查 key，但不是全部都經過統一入口。

---

### 1-2. 供應商不接電話（Timeout / Retry / 502 行為）

#### 已做得好的地方
- `safeApiCall` 有可重試錯誤判定（429、5xx、timeout、網路錯誤）+ 指數退避 + timeout 包裝 + retry 後成功/失敗日誌。  
- `aiProxy` 對上游有 120 秒超時；超時回 504，其他錯誤回 502，至少不會無限等。  
- LoRA 訓練輪詢（Replicate）採背景執行 + 失敗時繼續下次輪詢，且有 1 小時上限。

#### 風險點
- `aiProxy` 本身沒有 retry，只是一次轉發；若供應商偶發 502/503，請求立即失敗。  
- `GeminiMediaClient` 多數 `fetch` 是單次呼叫（沒有 retry 包裝，timeout 也不一致），穩定度仰賴供應商當下狀態。  
- 部分 route 的同步 `fetch` 沒有統一 fallback，尖峰時仍可能讓前端感覺「卡死後報錯」。

---

### 1-3. 有沒有監視器（Logger / Latency / 使用紀錄）

#### 已做得好的地方
- `aiProxy` 會記錄 `status / latencyMs / endpoint / provider` 到 DB（`aiUsageEvents`），並同步送 PostHog 與 LangSmith trace。  
- `imageStudio` 的 queue submit/status/result 與 fal run 都有 `traceToolRun`，錯誤也有 `recordErrorTrace`。  
- `safeApiCall` 會輸出 retry 過程與最終耗時。

#### 風險點
- 不同服務的 log 格式不完全一致，後續做跨供應商 SLO 儀表板時，資料清洗成本高。  
- 若呼叫未經 `aiProxy`，成本欄位目前常為 `0`，無法真正防止「信用卡刷爆」。

---

## 2) 📈 餐廳爆滿時是否要升級叫貨系統？（擴充性 / 承載）

### 2-1. 防刷盾牌（Rate Limiter）

#### 已有盾牌
- 全域 Express `apiLimiter`：所有 `/api/` 15 分鐘 300 次 / IP。  
- `aiProxy` 另有 DB 規則（per_user / global、每日次數與每日成本上限），超限回 429 並記錄 `rate_limited`。

#### 仍有缺口
- 只有走 `aiProxy` 的供應商呼叫會吃到「每日成本/次數」規則；直連供應商的路徑容易繞過細粒度控管。

---

### 2-2. 排隊叫號（同步等待 vs 背景任務）

#### 已有排隊機制
- `imageStudio` 已支援 fal queue submit -> 回 `request_id` -> 前端再查 status/result，這是正確的「號碼牌模式」。  
- LoRA 訓練有背景 worker 與 DB 狀態流，屬於長任務後台化。

#### 仍有缺口
- Gemini 媒體流程（例如 `generateVideoSync`）仍可能在請求內輪詢等待，若客人同時大量下單，連線與 worker 會被長時間占住。

---

### 2-3. 更換供應商彈性（Adapter 能力）

#### 目前優勢
- `modelClients` 已有 client class + `safeApiCall`，本質上是 adapter 雛形（Fal/Suno/ElevenLabs/Replicate）。
- `aiProxy` 把 key 注入與供應商 base URL 抽象化，也是可擴充點。

#### 目前阻礙
- 仍存在多處「直接 fetch 特定供應商 URL」的業務碼；若要新增 OpenAI/Anthropic，會重複複製 timeout/retry/logic。  
- 抽象層不夠一致：有些走 SDK、有些走 raw fetch、有些走 proxy，替換成本偏高。

---

## 3) 盤點結論：最大隱患與第一步行動

### 最大隱患（一句話）
**不是沒有防護，而是防護「分散且不一致」：同一間餐廳裡，有的幫廚走標準叫貨流程、有的直接打私人電話，導致穩定性與成本控管難以保證。**

### 建議第一步（具體且可落地）
建立一個「**Supplier Gateway 統一出入口**」（可先從 server 端 service 層開始）：
1. 所有外部 AI 呼叫（Gemini / ElevenLabs / Replicate / fal / Suno）強制走同一個 `callSupplier()`。
2. `callSupplier()` 內建：key 檢查、timeout、retry、錯誤分類、latency 記錄、成本估算欄位。
3. 舊路徑先從「高花費 + 高流量」的 2 條開始遷移（建議：Gemini media + 任一 fal 直連路徑）。
4. 在 PR 驗收標準加入：**新增外部 API 呼叫不得直接 fetch provider URL**（lint 或 code review checklist）。

這一步不需要重寫整個廚房，但能先把「電話紀錄、重打策略、刷卡上限」集中到同一張總機台，後續接 OpenAI/Anthropic 只要新增 adapter 即可。

---

## 4) 補充：本次掃描統計
- `server` 內 `fetch(`：92 處。
- `server` 內 `axios`：3 處（集中在 legacy `sdk.ts`）。
- `client/src` 內 `fetch(`：116 處（多數是打本服務 API，不一定外部供應商）。
