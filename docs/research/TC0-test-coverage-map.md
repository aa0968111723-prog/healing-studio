# TC0 — 測試覆蓋缺口地圖(頂級發現的回歸測試建議)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb

> 方法論:本盤點不臆測「有沒有測」。每一列的 `testFile` 都經過實際 Read/Grep 核對(檔案存在、對應行號內容確實測到 claim 所述行為)。找不到對應測試時明寫「none」或「需再查」,不猜。

---

## 1. 覆蓋概況

**子系統層級,誰有測、誰是零測試:**

| 子系統 | 測試現況 |
|---|---|
| 扣點/退款原子性(`deductUserPoints`/`refundUserPoints` FOR UPDATE、`atomicClaimJobRefund` CAS) | **良好** — `server/atomic-deduction.test.ts`、`server/services/postGenActions.refund.test.ts` 有並發回歸測試(W5) |
| `director.ts` claim-then-refund 順序(建卡/送出失敗/poll FAILED 兩條路徑) | **良好(結構性)** — `server/services/refundStatus.test.ts:400-497` 用原始碼字串位置斷言(source-invariant),鎖住呼叫順序,但不是執行時行為測試 |
| 影片類 catalog↔dispatcher 一致性(SSOT) | **良好,但範圍侷限於影片** — `server/services/__tests__/videoCatalogConsistency.test.ts` |
| agent-tool-executor 的 `requireConfirmation` 與 `fallbackTools` | **各自有測、組合未測** — `server/agent-tool-executor.test.ts:32-60`(單獨 requireConfirmation)、`:144-189`(單獨 fallback,兩個 tool 都沒設 requireConfirmation) |
| ProStudio ~20 個非同步端點(textToMusic/TTS/voice-clone/demucs/dubbing/avatar)完成時 FAILED/TIMEOUT 退款 | **零測試** — `server/routers/proStudio.ts` 無對應 `*.test.ts`;最近的 `aidv-620-suno-orphan-refund.test.ts` 明確只涵蓋同步送出失敗路徑 |
| `ai.chat`/orb 生成計費(dispatch* 是否扣點) | **零測試** — `server/routers/ai.ts` 無任何 `deductUserPoints`/`chargeForFalTask` 呼叫,也沒有測試斷言計費與否 |
| `models.ts` create/retrain/captionImages/autofillAngles 的 rate-limit + 扣點 | **僅測 auth/schema,未測計費** — `server/phase3-audit.test.ts:38-61` |
| `submitStudioJob` 寫入 costPoints 導致退款非保證 no-op | **零測試,且既有測試反向鎖死 bug 為規格** — `server/services/refundStatus.test.ts:63-72`、`server/aidv-771-orphan-refund.test.ts` |
| `orbCostGuard`/`orbBudgetGuard` 成本資料來源涵蓋主線生成(圖片/影片/訓練) | **guard 邏輯與 ai.chat/director.chat 接線有測,資料來源缺口未測** — `server/routers/__tests__/orbCostGuards.test.ts:119-155, 195-293` |
| `profile.updateQuotaJson` 授權範圍(admin-only vs 任意使用者、上限) | **零測試,且既有測試鎖死可被利用的行為為正確** — `server/phase2.test.ts:315-326`、`server/phase3-audit.test.ts:308-332` |
| `refundUserPoints`/`refundUserQuota` 內部交易失敗傳遞至 `refundRestoreFailed` | **catch block 呼叫順序有測(source-invariant),但根因(db.ts 交易吞例外)未測** — `server/services/refundStatus.test.ts:400-497`、`server/atomic-deduction.test.ts:71-75` |
| Stripe webhook 各事件實際寫入 entitlement | **零測試,現有測試自認是 stub** — `server/routes/__tests__/stripeWebhook.test.ts`(285 行,只測 HMAC 簽章/replay/fail-open-closed) |
| `modelPricing.ts` 9 個被標記缺 `freeSecondsInBase` 的線上模型 | **機制測了,具體模型 ID 未測** — `server/model-pricing-estimate.test.ts:5-26`(只測 stable-audio/kling/ace-step/elevenlabs) |
| `invokeLLM`(~30 檔主流量)寫回 `ai_usage_events`/`cost_ledger` | **零測試,且直接讀源碼確認呼叫端根本沒寫** — `server/cost-analytics.test.ts`(633 行,全部餵合成事件陣列,沒測事件從哪來);`server/_core/llm.ts` 確認零寫入呼叫 |
| catalog↔dispatcher 一致性(跨模態:音訊/3D/訓練/推理) | **零測試,只有影片類有** — 對照 `videoCatalogConsistency.test.ts` 的缺口鏡像 |

---

## 2. 🔴 頂級確認發現中缺回歸測試者清單(最重要輸出 —— 修這些時必須同 PR 補測試)

以下 **7 項**列為 `untestedTopCount`,修復時若不同 PR 補測試,極容易在下一次重構中悄悄回歸:

### (1) B-01 — ProStudio ~20 個非同步端點完成時 FAILED/TIMEOUT 未退款
- **critical path**:textToMusic/TTS/voice-clone/demucs/dubbing/avatar 等非同步生成任務,輪詢到 FAILED/TIMEOUT 時是否呼叫 `refundJobIfBilled`
- **現況**:`server/routers/proStudio.ts` 沒有任何 `*.test.ts`;唯一鄰近測試 `server/aidv-620-suno-orphan-refund.test.ts` 明確只 scope 同步送出失敗,不涵蓋完成時輪詢失敗
- **建議測試**:針對 `checkAudioStatus` 的 TIMEOUT/FAILED 分支,斷言呼叫 `refundJobIfBilled`,至少覆蓋一個代表性模態
- **回歸風險**:修復目前是零回歸負擔(沒有測試會因修復而變紅),但也代表修完之後,未來重構可以在完全不被察覺的情況下再次打破這個修復點

### (2) B-03 — `ai.chat`/orb 生成計費完全無測試釘住
- **critical path**:`dispatch*` 系列是否對 `ai.chat`/orb 對話生成扣點
- **現況**:`server/routers/ai.ts` 零 `deductUserPoints`/`chargeForFalTask` 呼叫,也沒有測試對「該不該扣」表態
- **建議測試**:為 `ai.chat` 目前的計費決策(收費或明確記錄零收費+成本上限)寫一條釘住測試
- **回歸風險**:未來重構若靜默加上或拿掉 `ai.chat` 計費,沒有任何測試會發現

### (3) B-16(涵蓋/升級 B-09)— `models.ts` create/retrain/captionImages/autofillAngles 的 rate-limit + 扣點
- **critical path**:四個會觸發真實付費 Replicate/fal 呼叫的 mutation 的節流與扣點
- **現況**:`server/phase3-audit.test.ts:38-61` 只測 auth/schema(未認證拒絕、angle enum 驗證),完全沒有 rate-limit 或 `deductUserPoints` 斷言
- **建議測試**:比照 `atomic-deduction.test.ts` 的 tRPC 層 mock 手法,為四個 mutation 補 rate-limit + 扣點斷言
- **回歸風險**:這些端點會觸發真實付費呼叫,rate-limit/計費的修復或退化目前對 CI 完全不可見

### (4) B-19 — `submitStudioJob` 寫入 costPoints,退款非保證 no-op(且既有測試把 bug 鎖成規格)
- **critical path**:`submitStudioJob` 建立的 job 若寫了 `costPoints`,失敗時退款邏輯是否正確處理
- **現況**:`server/services/refundStatus.test.ts:63-72` 明確斷言「`submitStudioJob` 登錄型 resultJson(無 costPoints)→ none」為正確行為;`server/aidv-771-orphan-refund.test.ts` 明確排除 `submitStudioJob` 於三個已知計費站點之外
- **建議測試**:先決定 `submitStudioJob` 該不該寫 `costPoints`;若修復,**必須同 PR** 更新 `refundStatus.test.ts:63-72` 的期望值,並新增 `submitStudioJob` 建卡的端到端退款測試
- **回歸風險**:**這是本清單中風險最結構性的一項** —— 現有測試主動把 bug 編碼成規格(spec),修 B-19 若不同步改測試,CI 會直接變紅;若只改 production code 不改測試,測試會繼續「通過」但驗證的是舊(錯誤)行為

### (5) B-27 — `profile.updateQuotaJson` 授權範圍可被任意使用者利用(且既有測試鎖死為正確)
- **critical path**:是否應限 admin-only、`remainingGenerations` 寫入上限
- **現況**:`server/phase2.test.ts:315-326`、`server/phase3-audit.test.ts:308-332` 明確斷言「一般使用者用合法輸入如 `image:10` 應該成功」為正確行為,完全沒有上限或角色測試
- **建議測試**:新增上限/角色拒絕測試;修復(admin-only 或移除 `remainingGenerations` 寫入權)落地時**必須同時編輯這兩個既有測試檔**
- **回歸風險**:與 B-19 同型 —— 既有測試把可被利用的行為鎖成契約,修復若不同 PR 改測試會直接讓 CI 變紅或(更糟)讓測試繼續驗證錯誤行為

### (6) B-32 — Stripe webhook 處理器實際寫入 entitlement 完全無測試
- **critical path**:`checkout.session.completed`/`invoice.paid`/`payment_failed`/`subscription.updated`/`deleted` 是否正確寫入使用者訂閱/權益表
- **現況**:`server/routes/__tests__/stripeWebhook.test.ts`(285 行)只測 HMAC 簽章/replay/fail-open-closed;唯一碰到 handler 內容的斷言只檢查一個 log 字串,測試自己的註解也承認這是 stub
- **建議測試**:新增整合測試,斷言合法 `checkout.session.completed`/`invoice.paid` 事件後,`userSubscriptions`(或對應 entitlement 表)被正確寫入/更新
- **回歸風險**:目前沒有任何測試會因修復 B-32 而變紅,但同樣沒有測試能在 entitlement 邏輯補上後,擋住未來的回歸

### (7) X3(C2)— `invokeLLM`(~30 檔 orb/director/worldbuilding 主流量)完全不寫成本記錄
- **critical path**:`invokeLLM` 的出口路徑(或其呼叫端)是否把成本寫回 `ai_usage_events`/`cost_ledger`
- **現況**:`server/cost-analytics.test.ts`(633 行)全部是純函式測試,餵合成事件陣列,從未測試事件從哪裡來;直接讀 `server/_core/llm.ts` 源碼確認 `invokeLLM` 零 `ai_usage_events`/`createApiUsageLog`/attribution 寫入呼叫
- **建議測試**:新增測試斷言 `invokeLLM` 出口(或呼叫端)確實寫入成本記錄
- **回歸風險**:這是完全的資料黑洞,雙向零測試覆蓋 —— 修復或進一步破壞都對 CI 不可見,影響面是 orb/director/worldbuilding 主流量的成本歸因

---

### 額外三項(partial,未列入 untestedTopCount 但同樣需要留意)

| 發現 | 現況 | 建議測試 |
|---|---|---|
| B-22(cost guard 資料來源盲區) | `server/routers/__tests__/orbCostGuards.test.ts:119-155, 195-293` 測了 guard 邏輯本身與 `ai.chat`/`director.chat` 接線,但「guard 的成本資料來源是否涵蓋直接圖片/影片/訓練生成端點」這個結構性盲區(B-22 的真正缺陷)完全未測 | 新增測試驗證 guard 的成本資料來源涵蓋主線生成端點,不只 `ai.chat`/`director.chat` |
| X3(C1,模型定價 double-billing) | `server/model-pricing-estimate.test.ts:5-26` 機制對 stable-audio/kling/ace-step/elevenlabs 測了,9 個被標記缺 `freeSecondsInBase` 的線上模型 ID 未涵蓋 | 把 X3 標記的 9 個模型 ID 加入 `model-pricing-estimate.test.ts`,修復後鎖住正確 `freeSecondsInBase` 值 |
| X3(H3,跨模態 catalog 一致性) | `videoCatalogConsistency.test.ts` 只測影片類,音訊/3D/訓練/推理無對應測試 | 仿照 `videoCatalogConsistency.test.ts` 建立跨模態一致性測試,已知缺口(如 `fal-ai/tripo3d`、`fal-ai/flux/dev/controlnet` 退回 flat 5pts)目前無 CI 閘門 |
| S-24(agentToolExecutor fallback 繞過 requireConfirmation) | `server/agent-tool-executor.test.ts:32-60` 單獨測 requireConfirmation,`:144-189` 單獨測 fallback,但兩個測試裡的 primary/fallback tool 都沒設 `requireConfirmation`,組合情境完全沒測 | 新增組合測試:primary tool 設 `requireConfirmation:true`,觸發 fallback,驗證確認閘門沒被繞過 |

---

## 3. 已有良好測試的(negative — 避免重複投入)

以下項目**已有紮實回歸測試**,修復或重構相關邏輯時應信任既有測試網,**不需要**額外新增覆蓋:

- **B-06(已被推翻)**:`deductUserPoints`/`refundUserPoints` 的 FOR UPDATE 原子性 + `atomicClaimJobRefund` CAS 冪等性 —— `server/atomic-deduction.test.ts:276-299`(SQL pattern 驗證,含 FOR UPDATE 存在性斷言)、`server/services/postGenActions.refund.test.ts:81-148`(W5 並發測試:兩條/三條同時打同一 job,驗證只退款一次)。此發現已被推翻,現有測試已足夠鎖死正確行為,**不需再投入**。
- **`director.ts` claim-then-refund 呼叫順序**(建卡失敗、送出失敗、poll FAILED 的 snapshot/recompute 兩條路徑):`server/services/refundStatus.test.ts:400-497` 用原始碼字串位置斷言鎖住「先 claim 後 refund」與「refund 失敗補寫 `refundRestoreFailed`」的順序,涵蓋 AIDV-968/AIDV-650 相關站點。注意這是 source-invariant(檢查原始碼字串位置),非執行時行為測試,但已足以擋住「順序被意外調換」這類回歸。
- **影片類 catalog↔dispatcher 一致性**:`server/services/__tests__/videoCatalogConsistency.test.ts` 對 T2V/I2V/V2V/ENHANCE/CONTROL 全系列 router ID 與 UI 顯示 ID 做 SSOT 比對,任何漂移會在 CI 立即失敗。此範圍(影片)已無需重複建設,缺口在別的模態(見上表)。

---

## 4. 北極星一條龍端到端測試

**需再查。** 本次盤點聚焦計費/退款/授權/catalog 一致性相關測試檔,未系統性搜尋「北極星一條龍」(完整使用者旅程,如:登入→建案→生成→輪詢→交付→計費入帳的端到端串接)是否存在對應的 e2e/integration 測試。從已讀到的測試檔案性質判斷,現有測試多是單元測試(mock 依賴、tRPC caller 直呼、原始碼字串斷言),**未看到**明確標示為端到端/integration 等級、實際串起多個路由與服務層的北極星流程測試。建議下一輪稽核專門搜尋 `*.e2e.*`、`*.integration.*`、`playwright`/`cypress` 等關鍵字確認。

---

## 5. 給 Bruce:修復第 0/1 波時最該優先補的 3 類回歸測試

1. **「既有測試把 bug 鎖成規格」類(B-19、B-27)最優先** —— 這兩項不是單純「補測試」,而是修復本身**必須同 PR** 改掉 `refundStatus.test.ts:63-72`、`phase2.test.ts:315-326`、`phase3-audit.test.ts:308-332` 的既有斷言,否則要嘛 CI 直接變紅要嘛測試繼續驗證錯誤行為。這類「測試即需要一併重寫」的情況比單純「缺測試」風險更高,因為修復者可能誤以為測試綠燈代表修復正確。

2. **計費資料黑洞類(B-03、X3-C2、B-32)** —— `ai.chat` 計費決策、`invokeLLM` 成本記錄、Stripe webhook entitlement 寫入,三者共通點是「雙向零測試覆蓋」:現在沒測試會因修復而變紅,但修完之後也沒有任何東西擋住未來重構把它再次打破。這類地方修復時**必須新增釘住測試**(pin test),否則等於白修。

3. **ProStudio 非同步完成時退款(B-01)** —— 這是唯一一個「涉及真實金流且影響面最廣(~20 個端點)」但完全沒有對應測試檔的項目。建議先寫一條代表性模態(如 TTS 或 demucs)的 `checkAudioStatus` TIMEOUT/FAILED → `refundJobIfBilled` 測試作為範本,驗證修復手法後再橫向鋪開到其餘模態,避免修一個漏一批。
