# 00 — 討論議題卡總表(逐卡討論用・LIVING 文件)

- 產生日期:2026-07-03
- 依據 commit:`812f6fdb`(每次更新會遞增)
- 性質:把 A–X 各卷研究收斂成「一張張可逐一討論的議題卡」。**這是活文件**——每完成一波深挖就把新坐實發現補進來;等 Bruce 說「開始討論」時,本表即為討論議程,逐卡過。
- 規則:每張卡 = 一個可獨立決策的單位。嚴重度 P0=可利用/直接損失或硬前置,P1=高,P2=中,P3=衛生。**驗證狀態**標「對抗式已確認 / 待執行期驗證 / 已推翻(保留備查以免誇大)」。
- 出處欄指向詳細分冊;問題側總表另見 `00-summary.md §6 風險登記表`,解法側見 `M0-solution-blueprint.md`。

---

## 0. 怎麼用這張表

1. 先看 §1 速覽表(一頁掃完所有卡)。
2. 討論時按群組(計費 → 安全/IDOR → 注入 → 持久化 → 北極星功能 → 決策 → 衛生)逐卡過。
3. 每卡結尾有「**待決策**」——那是需要 Bruce 拍板的點,不是我自作主張的結論。
4. 「已推翻」卡刻意保留,證明研究有自我糾錯(例:雙重退款一度被誤報,經對抗式驗證推翻)。

---

## 1. 速覽表(全卡一頁)

| 卡號 | 群組 | 嚴重度 | 一句話 | 驗證狀態 |
|---|---|---|---|---|
| B-01 | 計費 | P0 | ~20 條 async 生成失敗保證扣款不退款 | 對抗式已確認(W5) |
| B-02 | 計費 | P1 | 記帳分裂,無單一真相源;cost_ledger 預設關且退款不記帳 | 對抗式已確認(W5) |
| B-03 | 計費 | **P0** | ai.chat/orb 生成結構上無法扣點(dispatch* 無 userId) | 對抗式已確認(W8,已升級) |
| B-04 | 計費 | P1 | 多條零計費生成派工路徑 | 已確認(U3) |
| B-05 | 計費 | P2 | Sonauto duration 計費操縱面 | 待執行期驗證 |
| B-06 | 計費 | — | ~~multimodal 內外層雙重退款~~ | **已推翻**(W5:核心為 FOR UPDATE + CAS) |
| S-01 | 安全/IDOR | P0 | `getBackgroundJob`/`updateBackgroundJob` 無 userId 過濾=背景 job IDOR 共同根因 | 對抗式已確認(W2+W3) |
| S-02 | 安全 | P1 | askForStudioPlan 繞過全站 action 安全閘 | 已確認(W1) |
| S-03 | 安全 | P1 | 30/33 director 端點無速率限制 | 已確認(W1) |
| S-04 | 安全 | P0 | skill 沙箱 RCE 面 | 已確認(U5) |
| S-05 | 安全 | P1 | CO-STAR Step1→Step2 注入繞過 guard | 已確認(U6) |
| S-06 | 安全 | P1 | image/video router owner-check bypass | 已確認(V1) |
| S-07 | 安全 | P1 | agentScopeGuard 角色授權形同虛設 + fail-open | 已確認(V3) |
| S-08 | 安全 | P2 | CREDENTIAL_ENCRYPTION_KEY 靜默 fallback 到 JWT_SECRET | 已確認(V3) |
| S-09 | 安全 | P2 | 純網域名稱時 SSRF guard 跳過 DNS 檢查 | 已確認(V3) |
| S-10 | 安全 | P2 | getMyGraph 對任何登入用戶過度暴露站內架構 | 已確認(W4) |
| I-01 | 注入 | P1 | pageContext(10k 自由文字)繞過 sanitizeOrbMessages | 已確認(W6),待 W8 補完 |
| I-02 | 注入 | P2 | discussSegment.imageUrl 未過 safeMediaUrl | 已確認(W1) |
| I-03 | 注入 | P2 | recentFeedback.note 無長度上限未清洗進 prompt | 已確認(W6) |
| PS-01 | 持久化 | P1 | orbTask FSM in-memory 重啟即失(擋自主續跑旗標) | 已確認(R15/G3) |
| PS-02 | 持久化 | P2 | batchGenerateWithSession jobsJson 讀改寫無鎖競態 | 已確認(W1) |
| PS-03 | 持久化 | P2 | learnHubOrbIndexCache 永不失效,admin 編輯後服務過期內容 | 已確認(W6) |
| NS-00 | 北極星 | P0前置 | 修 G3 178-tool gate=分鏡執行化與 AI 動手引導共同硬前置 | 已確認(M0/Q4) |
| NS-01 | 北極星 | 功能 | 解放 ProjectFlowGuide 五步引導、接光球 | 方案(M2) |
| NS-02 | 北極星 | 功能 | creativeProjectId 貫穿為 SSOT、禁猜最新一筆 | 方案(M1) |
| NS-03 | 北極星 | 功能 | 分鏡管線執行化(planPipeline→studio.* 工具) | 方案(M1) |
| NS-04 | 北極星 | 功能 | contextPackets 接上 ai.chat/director,AI 讀單一專案 | 方案(M2) |
| NS-05 | 北極星 | 功能 | compose 服務(唯一大件新建,需 ffmpeg vs 委外 spike) | 方案(M1/Q2) |
| NS-06 | 北極星 | 功能 | 連接器 UI 收斂 + Adobe/Canva MCP client | 方案(M3) |
| NS-07 | 北極星 | 功能 | 素材/目標/審批三柱綁 creativeProjectId | 方案(M4) |
| D-01 | 決策 | — | Phase 0/1 實作決策彙整 | 見 N1 |
| D-02 | 決策 | — | 架構決策(雙 DB、102 表 0 FK 等) | 見 N2 |
| D-03 | 決策 | — | 優先序決策 | 見 N3 |
| D-04 | 決策 | — | 成本/維運決策 | 見 N4 |
| HG-01 | 衛生 | P3 | LearnHub 孤兒頁 | 已確認(R14) |
| HG-02 | 衛生 | P3 | 系統告警無 UI 出口 | 已確認(R13) |
| HG-03 | 衛生 | P2 | GDPR 刪除/匯出鏈缺口 | 已確認(R2/R3) |
| B-07 | 計費 | P0 | webhook 安全網對 async 失敗不成立(併 B-01) | 對抗式已確認(W7) |
| B-08 | 計費 | P1 | 訓練/轉錄鏈觸發真實付費 API 零計費(燒錢) | 已確認(W9) |
| B-09 | 計費 | P2 | 訓練入口限流不對稱(models.ts 無配額) | 已確認(W9) |
| S-11 | 安全 | P2 | FAL_WEBHOOK_FAIL_CLOSED 單旗標控雙層防禦 | 已確認(W7) |
| S-12 | 安全 | P2 | JWT_SECRET 缺失 prod 僅 warn,webhook 可能無驗證 | 已確認(W7) |
| S-13 | 安全 | P2 | Replicate webhook 無 provider 簽章驗證 | 已確認(W7) |
| S-14 | 安全/IDOR | P1 | ai.codeTask.approve/cancel 無 owner 檢查 | 已確認(W8) |
| S-15 | 安全/IDOR | P1 | orbTask get/events/traceDebug 缺 owner 檢查 | 已確認(W8) |
| S-16 | 安全 | P1 | executeTools approved 布林由 client 提供繞人工閘 | 已確認(W8) |
| I-04 | 注入 | P1 | agentPlanner 從未清洗文字讀 urgent-skip 硬指令(免注入) | 已確認(W8) |
| PS-04 | 持久化 | P1 | 4 worker 多實例重複執行(無 CAS 認領) | 已確認(W9) |
| PS-05 | 持久化 | P1 | 孤兒訓練→同模型雙重訓練覆蓋(單實例可觸發) | 已確認(W9) |
| PS-06 | 持久化 | P2 | postGenComplete 冪等非 DB-CAS,webhook 重投重複寫資產 | 已確認(W7) |
| PS-07 | 持久化 | P2 | circuit breaker 永遠 CLOSED(吞錯) | 已確認(W9) |
| S-17 | 安全 | P1 | Google Drive OAuth token 明文欄位,未走 secretCrypto 加密 | Z1 盤點提出,待對抗式驗證(X10 可佐證) |
| S-18 | 安全 | P2 | skillRegistry withinTrustCeiling 對 reviewed 層 connector 檢查形同虛設 | Z1 盤點提出,待對抗式驗證 |

> 「往前做」的 NS(北極星功能)/ D(決策)/ SYS(架構策略)卡已移至 `00-devzone.md`;本表專責稽核問題卡。
> 註:X 波(17 檔地毯掃描)完成後,新坐實卡會續補到各群組並更新本表。

---

## 2. 計費群組(計費失效重點群)

> 主題:**計費並非「核心函式壞掉」,而是「邊緣路徑漏接」。** W5 對抗式驗證確認核心 `deductUserPoints`/`refundUserPoints` 是 `SELECT...FOR UPDATE` 原子 + `atomicClaimJobRefund` CAS 冪等,紮實;問題出在「沒走這套」的 async 生成路徑與未接線的記帳。

### 卡 B-01 ·【P0】async 生成失敗保證扣款不退款
- 群組:計費 ｜ 驗證:對抗式已確認(W5,非 race、保證觸發,比雙重退款更該修)
- 出處:`W2-prostudio-router-deepdive.md`、`W5-billing-core-atomicity-deepdive.md`、`U3-fal-dispatch-webhook-deepdive.md`
- 現況:~20 條 ProStudio async 端點(textToMusic/TTS/voice-clone/demucs/dubbing/avatar…)不建 `backgroundJobs` row,共用 `checkAudioStatus` 輪詢,其 FAILED/TIMEOUT 分支**無退款邏輯**;refund-on-throw 只蓋同步 submit 失敗。
- **待決策**:(a) 是否列第 0 波止血?(b) 統一改走 `backgroundJobs` + `atomicClaimJobRefund`,還是逐條補退款?(c) webhook 安全網是否可靠(W7 正在查)。

### 卡 B-02 ·【P1】記帳分裂,無單一真相源
- 群組:計費 ｜ 驗證:對抗式已確認(W5,呼應 R4)
- 出處:`W5-...`、`R4-cost-ledger-deepdive.md`
- 現況:`users.remainingGenerations` 是唯一活 balance(可變 int、無不可變流水);`cost_ledger`(雙分錄、冪等)預設 OFF,且即使開,`refundUserPoints` 不寫 credit 分錄(env.validated.ts 自述缺口)→ balance 漂移時無法重建。
- **待決策**:是否把 cost_ledger 設為預設 ON 並補退款分錄?是否需要一次性對帳工具?

### 卡 B-03 ·【P1】LLM 成本未計入點數 / ai.chat 疑繞過計費
- 群組:計費 ｜ 驗證:待 W8 收斂(U2 已提出)
- 出處:`U2-ai-chat-orchestration-deepdive.md`、`R1-llm-router-deepdive.md`、(W8 進行中)
- 現況:ai.chat 主聊天路徑疑未扣點;LLM 成本無 idempotency。W8 正逐一核對 ai.ts 每個 LLM procedure 的「有計費 vs 零計費」。
- **待決策**:主聊天要不要計費?若不計費,成本天花板怎麼設(對照 S-03 無限流)。

### 卡 B-04 ·【P1】多條零計費生成派工路徑
- 群組:計費 ｜ 驗證:已確認(U3)
- 出處:`U3-fal-dispatch-webhook-deepdive.md`
- 現況:falDispatcher/webhook 深挖列出三條零扣點生成路徑。
- **待決策**:是刻意(內部/試用)還是漏接?要不要統一收斂到單一計費入口。

### 卡 B-05 ·【P2】Sonauto duration 計費操縱面
- 群組:計費 ｜ 驗證:待執行期驗證
- 出處:`W2-...`
- 現況:Sonauto 收費由使用者可控 `duration` 欄計算,但該模型自述不支援該欄。
- **待決策**:改用伺服端實際時長計費。

### 卡 B-06 ·【已推翻】multimodal 內外層雙重退款
- 群組:計費 ｜ 驗證:**已推翻**(保留備查)
- 經過:W3(單檔視角)推斷 multimodal 8 處內層退款會被外層 catch 再退一次、`refundUserPoints` 無鎖 → 可反覆兌現。W5 深挖核心函式後推翻:核心為 `SELECT...FOR UPDATE` 原子,多完成路徑一律走 `atomicClaimJobRefund` CAS,有並發回歸測試背書。**HEAD 812f6fdb 不成立。**
- 意義:示範對抗式驗證有效(避免把誇大發現寫進決議)。真正的計費痛點是 B-01 的「失敗不退」而非「重複退」。

---

## 3. 安全/IDOR 群組(安全高風險重點群)

### 卡 S-01 ·【P0・一修多治】背景 job IDOR 共同根因
- 群組:安全/IDOR ｜ 驗證:對抗式已確認(W2+W3 兩獨立證據匯到同一根因)
- 出處:`W2-...`(checkMusicSunoStatus)、`W3-generate-router-deepdive.md`(jobStatus,已確認被 ModelsPage/LoraTrainer 實際呼叫)
- 現況:`db.getBackgroundJob`/`updateBackgroundJob`(db.ts)**不以 userId 過濾**,任何以此為底的 job 狀態端點都可被猜 id 跨用戶讀/改;可鏈成「竊取他人生成結果 + 零扣點」。
- **待決策**:在 db 層加 userId 過濾(一次修多處),還是逐端點補 owner 檢查?列第 0 波?

### 卡 S-02 ·【P1】askForStudioPlan 繞過 action 安全閘
- 群組:安全 ｜ 驗證:已確認(W1)
- 出處:`W1-director-router-deepdive.md`、`Q4-orb-tools-full-registry.md`
- 現況:LLM 回應不過 parseAndGatePlan/moderateOrbContent;navigate 無白名單;submit 由前端 dispatchMany 直接 handleGenerate,僅靠預設關的 confirmBeforeGenerate。光球 director.* 工具橋接同端點,攻擊面不只 Studio 按鈕。
- **待決策**:把此路徑接回安全閘;confirmBeforeGenerate 預設開?

### 卡 S-03 ·【P1】30/33 director 端點無速率限制
- 群組:安全/成本 ｜ 驗證:已確認(W1)
- 出處:`W1-...`
- 現況:重量級 LLM 端點掛無限流 brainProcedure;5 處 segments 陣列無 .max() 上限。與 B-03 合看=成本失控面。
- **待決策**:統一套限流 + 陣列上限。

### 卡 S-04 ·【P0】skill 沙箱 RCE 面
- 群組:安全 ｜ 驗證:已確認(U5)
- 出處:`U5-skill-system-security-deepdive.md`
- **待決策**:沙箱強化 / 停用未使用能力 / 加審核閘。

### 卡 S-05〜S-10（安全其餘,詳見各卷)
- S-05 CO-STAR 注入繞過 guard(U6)｜S-06 image/video owner-check bypass(V1)｜S-07 agentScopeGuard 授權形同虛設+fail-open(V3)｜S-08 CREDENTIAL_ENCRYPTION_KEY fallback JWT_SECRET(V3)｜S-09 純網域 SSRF 跳過 DNS(V3)｜S-10 getMyGraph 過度暴露架構(W4)。
- **待決策**:併為「安全止血波(第 0 波)」一起排,還是分票逐修?

---

## 4. 注入群組

- I-01 pageContext 10k 自由文字繞過 sanitizeOrbMessages(W6,W8 補完)｜I-02 discussSegment.imageUrl 未過 safeMediaUrl(W1)｜I-03 recentFeedback.note 未清洗進 prompt(W6)。
- 共同主題:**「使用者可控文字被當系統權威事實塞進 prompt」**,現有 sanitize 只蓋 messages 主路徑,旁路未蓋。
- **待決策**:把所有進 system prompt 的使用者可控欄位統一過同一 sanitize/標記為 untrusted。

---

## 5. 持久化群組

- PS-01 orbTask FSM in-memory 重啟即失(R15/G3)——**開任何「AI 自主續跑」旗標前必做持久化**,否則引導到一半蒸發｜PS-02 jobsJson 讀改寫無鎖競態(W1)｜PS-03 learnHubOrbIndexCache 永不失效(W6)。
- **待決策**:FSM 持久化列為自主續跑功能的前置卡。

---

## 6. 北極星功能群組 →（已移至研究討論開發專區)

> NS 系列(北極星一條龍開發卡 NS-00〜NS-07)屬「往前做」的開發卡,已移到 **`00-devzone.md` §A**。速覽表(§1)仍保留其列作全域索引;細節與狀態流水線見 DEVZONE。

---

## 7. 決策卡 →（已移至研究討論開發專區)

> D 系列(D-01〜D-04,拍板用)屬「往前做」的決策卡,已移到 **`00-devzone.md` §C**。

---

## 8. 衛生群組

- HG-01 LearnHub 孤兒頁(R14)｜HG-02 告警無 UI 出口(R13)｜HG-03 GDPR 刪除/匯出鏈缺口(R2/R3,不阻塞北極星但屬法遵)。

---

## 9. 待補清單(需 Bruce 提供的外部數據,研究無法從 repo 得知)

- Railway 實際用量/帳單(部署問題本次不處理,交 Railway 客服)。
- 團隊真實使用回饋 / 每週專案完成率(北極星指標,見 S5)。
- 各第三方 API 實際單價與方案(用以校準 B-02/X3 定價卡)。
- 目標使用者規模與付費模式(用以定 credits/團隊池策略,見 S1/S2)。

---

## 10. W7/W9 新增卡(2026-07-03 續補)

> W7(webhook 計費安全網)與 W9(cron/worker)完成,新增下列坐實卡。**W7 直接證實 B-01 無安全網可救**(同根因兩症狀),W9 揭露訓練/轉錄鏈的零計費燒錢面。

### 卡 B-07 ·【P0・併入 B-01】webhook 安全網對 async 失敗不成立
- 群組:計費 ｜ 驗證:對抗式已確認(W7)
- 出處:`W7-webhook-billing-safetynet-deepdive.md`
- 現況:webhook **有到、簽章+token 雙驗證也過**,但那族端點從未 `createBackgroundJob`,`webhookFal.ts:191-196` 在 extractJobId/findProcessingJobByRequestId 找不到綁定 job 時**靜默丟棄**,`refundJobIfBilled` 從未被呼叫。與 B-01 輪詢端「不退款」是同一資料層斷鏈的兩種症狀。
- **待決策**:確認修 B-01 時「補建 backgroundJob 綁定」即可同時關掉輪詢端與 webhook 端兩個漏口。

### 卡 B-08 ·【P1】訓練/轉錄鏈觸發真實付費 API 零計費(燒錢面)
- 群組:計費 ｜ 驗證:已確認(W9)
- 出處:`W9-cron-workers-deepdive.md`
- 現況:`modelTrainingWorker`(Replicate 訓練)、`teachingArchiveIngestionWorker`(ElevenLabs 轉錄 + Gemini embedding)三個真實付費 API 全鏈路查無扣款/退款。好處是失敗不用退,壞處是可被無限觸發真實 GPU/API 成本。
- **待決策**:訓練/轉錄要不要計費或設用量上限?(對照 B-09 限流不對稱)

### 卡 B-09 ·【P2】訓練入口限流不對稱
- 群組:計費/安全 ｜ 驗證:已確認(W9)
- 出處:`W9-...`
- 現況:`routers/models.ts` 訓練建立入口無任何配額/限流,`routers/loraTrainer.ts` 平行入口卻有每小時 3 次限流。
- **待決策**:兩入口統一限流。

### 卡 PS-04 ·【P1】4 個 worker 多實例重複執行
- 群組:持久化 ｜ 驗證:已確認(W9)
- 出處:`W9-...`
- 現況:mediaArchivalCron/modelTrainingWorker/teachingArchiveIngestionWorker/assetCleanupJob 只有 process-local boolean 鎖,DB 層無 CAS「認領」,多實例部署會同一任務多 process 重跑,且都沒呼叫既存的 `warnIfMultiInstanceSingleton`。
- **待決策**:worker 認領改 DB CAS;或明確限單實例並接告警。

### 卡 PS-05 ·【P1・單實例可觸發】孤兒訓練→同模型雙重訓練覆蓋
- 群組:持久化/計費 ｜ 驗證:已確認(W9)
- 出處:`W9-...`(`modelTrainingWorker.ts:274-286`)
- 現況:送出 Replicate 訓練與寫回 predictionId 之間若 crash,卡住任務會被重置 queued 重跑;`webhookReplicate.ts` 以 modelId(非 predictionId)判終態 → 同模型可能真實訓練兩次且結果互相覆蓋。**單實例即可觸發**。
- **待決策**:以 predictionId 判終態 + 送出前先寫 claim。

### 卡 PS-06 ·【P2】postGenComplete 冪等非 DB-CAS,webhook 重投重複寫資產
- 群組:持久化 ｜ 驗證:已確認(W7)
- 出處:`W7-...`
- 現況:`runPostGenForJob` 的 postGenComplete 冪等旗標是「讀後才寫」而非 DB CAS,webhook 重複投遞可能重複寫資產庫/歷史(非計費風險)。

### 卡 PS-07 ·【P2】circuit breaker 永遠 CLOSED(吞錯)
- 群組:持久化/可靠性 ｜ 驗證:已確認(W9)
- 出處:`W9-...`
- 現況:circuit breaker 因內層錯誤全被 catch 吞掉,幾乎永遠 CLOSED,防護形同虛設;教學檔向量化失敗 fire-and-forget 靜默吞錯不反映在狀態欄。

### 卡 S-11〜S-13(webhook 安全,詳見 W7)
- S-11 `FAL_WEBHOOK_FAIL_CLOSED` 單旗標同時控簽章驗證與 capability token 兩層防禦,誤設致雙層同時失效｜S-12 `JWT_SECRET` 缺失於 production 只 `console.warn` 不擋啟動,缺失時 Suno/Replicate webhook(僅單層 token、無 vendor 簽章)完全無驗證｜S-13 Replicate webhook 未驗證 provider 自身簽章(目前 LoRA 訓練未計費故非退款缺口,但屬驗證缺口)。
- **待決策**:併入安全止血波;JWT_SECRET 缺失改為 production 拒絕啟動。

> W7/W9 確認紮實可靠(negative results,不需修):`atomicClaimJobRefund` 真 CAS、三個 webhook 終態守門、`JSON_MERGE_PATCH` 併發保護、assetCleanup TTL 邊界與兩段式安全閥(旗標預設 OFF + dry-run 預設 ON)。

---

## 10.5 MCP 原生 / 自建系統策略卡 →（已移至研究討論開發專區)

> SYS-01(Bruce 提「自建 MCP 原生系統」+ 參考 8 個 MCP)屬「往前做」的架構策略卡,已移到 **`00-devzone.md` §B**;8 MCP 對照與四路線矩陣由 Z 波 `Z1-mcp-architecture-strategy.md` 產出。

---

## 10.6 W8 新增卡(ai.ts 逐行深挖)

> W8 坐實並升級 B-03,並新增三張安全卡與一張注入卡。

### 卡 B-03(升級)·【P0】ai.chat/orb 觸發的生成結構上無法扣點
- 群組:計費 ｜ 驗證:對抗式已確認(W8)
- 出處:`W8-ai-router-deepdive.md`、`U2-ai-chat-orchestration-deepdive.md`、`falDispatcher.ts:480/727-800`、`orbTaskExecutor.ts:19-49`
- 現況:`executeOrbTask` 呼叫的 `dispatchImage/Video/AudioGeneration` 參數型別**沒有 userId 欄**,使 `dispatchFalTask` 的 `if (typeof input.userId === "number")` 扣點判斷恆為 false;`executeGenerateImage` 更完全繞過 dispatcher 直打 fal 原始 API。ai.chat/executeTools/reportTaskStep/orbTask.* **沒有一條路徑計費**,與 director.ts(W1 完整計費)、proStudio.ts(chargeForFalTask 33 處)鮮明對照。
- **待決策**:orb 觸發生成要不要計費?若要,dispatch* 補 userId 貫穿 + 統一走 dispatchFalTask。與 S-03(director 無限流)合看=成本失控總面。

### 卡 S-14 ·【P1】ai.codeTask.approve/cancel 無 owner 檢查
- 群組:安全/IDOR ｜ 驗證:已確認(W8,`ai.ts:3357-3362`)
- 現況:資料模型無 userId,任何登入使用者可核准/取消他人的 Claude Code 修改任務。
- **待決策**:補 owner 檢查(併入 S-01 背景 job IDOR 同一波)。

### 卡 S-15 ·【P1】orbTask get/events/traceDebug 缺 owner 檢查
- 群組:安全/IDOR ｜ 驗證:已確認(W8)
- 現況:同一 orbTask router 7 個寫入端點有 owner 檢查,但 get/events/traceDebug 三個查詢端點漏掉(AIDV-885 修復遺漏)→ 可讀他人任務內容/軌跡。

### 卡 S-16 ·【P1】ai.executeTools 的 approved 布林由 client 提供,繞人工確認閘
- 群組:安全 ｜ 驗證:已確認(W8)
- 現況:`approved` 由客戶端直接提供、無 token 驗證,可直接滿足 `agentToolExecutor.ts` 的 `requiresHuman` 確認閘。與 W1 askForStudioPlan 同類「client 端旗標被當安全邊界」,但更直接。
- **待決策**:人工確認閘改伺服端狀態/簽章 token,不信任 client 布林。

### 卡 I-04 ·【P1】agentPlanner 從未清洗文字讀「urgent-skip/mode」硬指令(免注入技巧)
- 群組:注入 ｜ 驗證:已確認(W8,`agentPlanner.ts:391-402`)
- 現況:`input.context`(10k 自由文字)在 ai.ts 至少 4 條路徑(:1252/:1864/:2036/:2470)繞過 `sanitizeOrbMessages`(:1543);agentPlanner 用正則從這段未清洗文字解讀「使用者選擇模式」與「urgent skip」硬指令 → 客戶端只需塞固定字串即可讓伺服端自組「跳過澄清、直接執行」的系統提示詞,**不需 prompt injection 技巧**。`pageSnapshot.*` 為第三個同類注入面。
- **待決策**:併入 I-01;所有進 system prompt 的 client 可控欄位統一過 sanitize 並標 untrusted;硬指令解讀不得取自未清洗文字。

---

## 10.7 X 波地毯掃描新增卡(17 檔 + 對抗式驗證,詳見 `X0-carpet-scan-synthesis.md`)

> X 波逐檔深挖 17 檔,50 條 critical/high 經對抗式驗證 → **40 確認、9 推翻、1 待驗**。以下按群組列確認卡;完整佐證(檔案:行號、原→訂正嚴重度、建議)見 X0 與各 X 分冊。**三個討論主軸**:①計費雙向壞(有的不收有的超收) ②IDOR 是系統性重複模式(5 CRITICAL 同形) ③RAG 對文字教材根本沒建索引。

### 計費(X 波新增,接續計費失效群組)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| B-10 | modelPricing.ts:3301+ | 高 | **反向新面**:9 個 live 模型時長費+起跳費雙重計費,使用者被**超收**(如 5 秒影片應 15pts 實收 ~30) |
| B-11 | costAnalytics.ts:39-47 | **P0** | `invokeLLM`(~30 檔主流量:orb/導演/世界觀)繞過 `ai_usage_events`,成本分析結構性看不到→對帳不可信 |
| B-12 | modelPricing.ts:3279 | 高 | 目錄查無 modelId 一律回退固定 5pts;dispatch 目錄與計費目錄兩份不同步→計費失真 |
| B-13 | brain.ts:731-791 | 高 | `orbVoicePreview` 直呼 ElevenLabs TTS 零計費,限流比同類寬鬆 ~30 倍 |
| B-14 | teachingArchive.ts:240+ | 高 | 教材 ingestion 無限流、無冪等,可重複觸發真實付費 ElevenLabs 轉錄 |
| B-15 | falTrainer.ts:328-345 | **P0** | fal 訓練 `subscribe()` 無 timeout/requestId,本地逾時後遠端任務與計費續跑、無法查詢/取消 |
| B-16 | models.ts create/retrain/captionImages/autofillAngles | **P0** | 四個觸發真實 Replicate/fal 訓練·生成的 mutation **零限流零計費**(涵蓋並升級 B-09) |
| B-17/B-18 | apiUsage.ts | 中 | 對帳用截斷版 events 自相矛盾;供應商餘額恆 $0 假顯示無標示 |

### 安全/IDOR(X 波新增,5 CRITICAL 同形——最高優先主題)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| S-19 | realEarth.ts:294-300 | **P0** | `getLinkedMaterials` 繞過三層授權,任意登入者枚舉 id 讀**他人私有教材全文** |
| S-20 | agentCollaborationOrchestrator.ts:387-410, 603-691 | **P0×2** | 協作 session 的 userId/collaborationId 為 client 可控→**偽造/劫持竄改他人 session**,無錯誤提示 |
| S-21 | brain.ts:915-926,955-962,1272-1276 | **P0** | `errorTraces`/`diagnoseError`/`generationLogs` 僅需登入→跨用戶讀全站 prompt/錯誤/resultUrl |
| S-22 | models.ts:20-52 | **P0** | `team_shared` 只查 visibility 不查 teamId→任何登入者讀他人模型 `trainedLoraUrl`/訓練圖 |
| S-23 | loraTrainer.ts:152-168 | **P0** | `trainWithReplicate` 繞過肖像權同意書(models.ts create 有,此路徑沒有) |
| S-24 | agentToolExecutor.ts:828-849 | 高 | connector fallbackTools 降級路徑繞過 `requireConfirmation` 授權閘 |
| S-25 | showcase.ts:173-180,355-409 | 高 | publicProcedure 把「收藏/評分」當公開同意,無 userId 範圍→洩他人 prompt/resultUrl |
| S-26 | worldbuilding.ts:688-719 | 中 | `checkConsistency` 無 owner 檢查,可覆寫他人 timelineFrame |
| S-27 | teachingArchive.ts:100-152 | 高 | `public_disciples` 發佈無角色/審核門檻,任意新帳號可冒名汙染全站教材庫/RAG 語料 |
| S-28 | creativeProject.ts:170-262 | 中 | create/update 不驗 worldFramework/Storyboard/directorSession id 擁有權(與 link 端不對稱) |

> S-01 更新:X0 確認 `getBackgroundJob`/`updateBackgroundJob` 確實無 userId 過濾為共同根因,但抽查 `models.trainingStatus` 已補檢查→**需對 30+ 呼叫點做一次性逐點稽核**,不可假設全壞或全對。

### 持久化(X 波新增)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| PS-08 | video-state-machines.ts:113-116 | 高 | `productionStatus` 雙狀態機共用,`canTransitionSession` 遇未知狀態拋未攔截 500(一般用戶可達) |
| PS-09 | creativeProject.ts:292-326 | 高 | **資料汙染**:`duplicate()` 共用 `worldStoryboardId`,編輯副本分鏡直接改到原專案 |
| PS-10 | learnHub.ts | 中 | 4 個 mutation 不失效下游快取(含 learnHubOrbIndexCache),重啟前服務過期內容 |
| PS-11 | learnHub.ts:596+ | 高 | DB 寫入失敗只 console.warn 假成功→刪除復活/新增消失/編輯還原,管理員收假成功 |
| PS-12 | loraTrainer.ts:241-281 | 高 | Step4 失敗遺失 trainingId 無法追蹤;failed 不佔額度可立即重排付費任務 |

### 注入(X 波新增)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| I-05 | brain.ts:929-1009 | 中 | `proposalToIssueBody` code fence 未跳脫→管理員核准後 Markdown 注入真實 GitHub Issue |
| I-06 | worldbuilding.ts:256-610 | 中 | `importFull` 自由文字未消毒進 script prompt;清洗層 `ENABLE_RAG_INJECTION_GUARD` 預設 OFF 等同無防護 |

### 北極星缺口(X 波新增)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| NSX-1 | teachingArchive.ts:240-244 | 高 | **RAG 對主要內容型態失效**:`mediaType:"text"` 教材永不向量化,語意檢索只能靠 LIKE(北極星① 地基缺口) |
| NSX-2 | videoCompiler.ts:467+ | 中 | `CAMERA_VECTORS` 自我轉場假陽性;Step7「修正」改的欄位 prompt 根本沒讀→死碼誤導,不影響輸出 |

### 待驗(修 gate 即引爆的休眠地雷)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| U-1 | orbWorkflowEngine.ts:522-538 | 待驗(低) | `runWorkflow` 硬編碼 `approved:true` 繞 `requiresHuman`;**目前呼叫路徑不可達**(X0 獨立裁決),但修 gate/新增入口時同 PR 必須補核准檢查 |

> X11(rbac-teams)/X12(output-assets)本波無 critical/high,但非零發現:X12 有 `toggleVisibility` 獎勵點數 TOCTOU 重複發放、assets title/description 缺 sanitize(medium),建議排後續。詳見各分冊。

---

## 10.8 Y 波前端地毯掃描新增卡(詳見 `Y0-frontend-carpet-scan-synthesis.md`)

> 10 頁前端深挖,73 findings,20 可證偽項對抗式驗證 **0 推翻(7 下修)**。前端從 client 側**坐實了多個伺服端發現的真實可達性**(不再是理論)。北極星流程實況見 Y0 §1 圖 與 DEVZONE。

### 前端計費/契約(坐實伺服端計費失效的 client 源頭)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| B-19 | generate.ts:2143-2169(submitStudioJob) | **P0** | `submitStudioJob` 從不寫 `costPoints`→ImageStudio/ProStudio 幾乎全部背景任務**失敗退款保證 no-op**(這就是 B-01 的 client 源頭實證) |
| B-20 | ImageStudio.tsx:3712-3751 / generate.ts:2259-2307 | **P0** | rodin3d/hunyuanWorld 結果解析恆 null→**誤判失敗並觸發退款嘗試**;另三支 3D 副輸出格式全不可見(extractFalMediaUrl 缺 model_mesh/world_file) |
| C-01 | VideoStudio.tsx:4968-4993 | 高 | 「回到導演 AI」永遠送 `resultUrl:null`(5 分頁 reportState 缺 video_url)→生成結果連不回腳本卡 |
| C-02 | DirectorAI.tsx:2907 / director.ts:1199-1240 | 高 | `batchGenerateWithSession` 呼叫端從不傳 storyboardId→AIDV-50 session 追蹤 100% 不觸發(且遮蔽了 W1 jobsJson 競態) |

### 前端 client-security(坐實 IDOR/確認閘為活躍可達路徑)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| S-29 | GlobalOrbChatContext.tsx:5373-5410,3357-3358 | **P0** | `runWorkflow` 顯式傳 `requireConfirmation:false` 使 `??` 安全網失效→逐步確認/成本閘門被繞(「client 布林當安全邊界」在前端被**重造**,非歷史遺留) |
| S-30 | GlobalOrbChatContext.tsx:4605-4613 | 高 | composer 自然語言路徑同樣硬編碼 `requireConfirmation:false`,行內註解宣稱由 preferences 決定但程式碼根本沒讀 |
| S-31 | ProStudio.tsx:4067(proStudio.ts:1688-1820) | 高 | **坐實 S-01/W2**:checkAudioStatus IDOR 是活躍呼叫路徑,`request_id` 還明碼顯示在畫面上(方便枚舉) |
| S-32 | generate.ts:1536-1540 | 高 | **坐實 W3**:jobStatus 無 owner 檢查,ImageStudio/ProStudio 背景任務可被連號 jobId 枚舉 |

### 前端死 UI / 北極星閘(CONFIRMED)
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| FE-01 | LearnHub.tsx / App.tsx:244 | **P0** | 整個 LearnHub(北極星① 自己的資料庫 UI)正式環境 100% 不可達,被 4-shell 路由 shadow;光球深連結 `?docId=` 是死指令 |
| FE-02 | shells/settings/SettingsShell.tsx:26-49 | **P0** | `/settings` 富殼把 AdminPage/AgentPreferencesPage/SettingsPage 全變孤兒頁,連唯一「重置/重看引導」入口都不可達 |
| FE-03 | ImageStudio:4408 / ProStudio:4747 / VideoStudio:5096 / DirectorAI:4522 | 高 | 「素材」快速開啟按鈕四處皆用永久 `hidden` class,AssetsQuickDrawer 全站不可達(北極星⑦ 素材管理入口死) |
| FE-04 | ProjectsContext.tsx:168-177 | 高 | **違反「不跑偏」**:pickActive() 未釘選時靜默 fallback 成「最新更新一筆」專案,還是生產預設路徑 |
| FE-05 | DriveLibrarySection.tsx:59-297 | 高 | Google Drive 連接前端兩套互不同步資料模型(`dataSourceConnections` vs `driveAssetLibraries`),同授權兩處各自記帳 |

> Y4(animation)產出髒資料(唯一 finding 是字面 "test"),**建議重跑**;Y0 已排除不計入結論。imageStudio 全部 23 支生成 mutation 零點數扣除(交叉印證 V1/U3)。

---

## 10.9 CC 波覆蓋補完新增卡(詳見 CC1-CC5 + `CC0-completeness-critic.md`)

| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| S-33 | langsmith.ts | **P0** | 8/9 procedure 用 protectedProcedure(非 admin)→**任何登入者可讀取/批次匯出全站所有使用者 LLM 對話原文**(重大外洩) |
| S-34 | orbClarificationEngine.ts(recordAnswer) | **P0** | 更新澄清紀錄無 userId 擁有權檢查→跨用戶 IDOR 寫入 |
| B-21 | sense.ts(inferIntent) | 高 | publicProcedure 免登入直接觸發真實 LLM 呼叫,llm tier 定義但從未掛載節流 |
| SSOT-1 | shared/agent-plan-safety.ts、agent-plan-schema.ts、agent-actions.ts | 高 | **W1 navigate 無白名單的 SSOT 根因**:AgentPlanV3 漏了 v1 的 `isSafeInternalPath`;23 種 action 僅 15/16 受風控(execute_task+7 新動作脫離);generateCharacter/Scene/Storyboard 未判破壞性卻觸發真實 LLM+DB 寫入;appRegistry.supportedActions 與 hasCapabilityForPage 雙向脫鉤都判錯 |
| FE-06 | AnimationStudio.tsx | **P0** | Rules-of-Hooks 違規:條件式 return 後仍有 7 個 hook→**首次載入/建第一個世界必定 React crash** |
| FE-07 | AnimationStudio.tsx | 高 | creativeProjectId/worldFrameworkId 完全未貫穿(與 DirectorAI 脊椎脫鉤);AI 生成角色/場景只有 page-agent 能觸發,人類 UI 無按鈕(死 UI) |
| PS-13 | orbTaskStore.ts | 中 | 持久化每次讀取整表同步落地→R15 FSM 止血成本被低估 |

> **CC0 完整性批判重點**(見 `CC0-completeness-critic.md`):(1) 尚未稽核:`auth.ts`/`export.ts`(GC 波處理中)、`credits.ts`/`plans.ts`/orb 計費守衛層(GC 波)、`connectionService`/`secretCrypto`(GC 波)。(2) 13 條「wave 內部初篩未對抗驗證」的高影響主張待補驗,最優先:DirectorAI projectId 範疇化(NS-09 地基所本)、VideoCockpit 遺棄專案資料遺失、PageAgentContext 確認閘/navigate 白名單。(3) 無互斥矛盾;X 波 9 條推翻只有計數缺內容;背景 job IDOR 30+ 呼叫點逐點稽核仍待辦。(4) 新增待補外部數據:各 `ENABLE_*` 旗標在生產的實際值 repo 內不可知。(5) 信心評級:計費雙向壞=高(auth/credits 補完前殘餘中)、IDOR 系統性=高、北極星前端斷點=高/後端執行細節=中。

---

## 10.10 GC 波缺口補完新增卡(auth/計費守衛/憑證/RAG,詳見 GC1-GC4)

> 🔴 **全案最高優先在此波出現**:GC 波 8 確認 0 推翻,封閉計費守衛層並揪出認證層密鑰外洩。

### 卡 S-00 ·【P0・全案最嚴重】auth.me 洩漏 passwordHash/2FA 種子 + 前端明文 localStorage
- 群組:安全 ｜ 驗證:對抗式已確認(GC1)
- 出處:`GC1-auth-export-plans.md`、`server/routers/auth.ts:9`、`client/src/_core/hooks/useAuth.ts:58-61`
- 現況:`me: publicProcedure.query(ctx => ctx.user)` 無欄位白名單,**直接回傳整列 users**(含 `passwordHash`、`twoFactorSecret` TOTP 明碼種子、`icsFeedToken`);前端把整包寫入 `localStorage` 明文。auth.me 全站高頻呼叫→**任何一處 XSS 即可讀出密碼雜湊 + 永久繞過 2FA**(密碼重設也救不回)。codebase 自身 `db.ts:2076-2080` 已明文承認要避免此洩漏並在別處正確做欄位投影,auth.me 沒跟進;前端根本沒用到這些欄位=純多餘外洩。
- **待決策**:立即改欄位白名單投影(有現成 getUserAccountInfo 範例可抄)+ 前端停止整包落地。**建議列第 0 波第一張票**。

### 其餘 GC 卡
| 卡 | 檔案:行號 | 嚴重度 | 一句話 |
|---|---|---|---|
| B-22 | orbCostGuard.ts:127-151 | **P0** | 封閉計費守衛層:checkRetryChainCost + enforceMonthlyBudgetGate 唯一資料源對主流量結構性失明→**兩道即時守衛實務上永不觸發** |
| B-23 | db.ts:826-827 | 高 | `deductUserPoints`/`refundUserPoints` 硬編 500 點上限,與 catalog 高價模型(sora 600/kling 550/訓練 2000-5000)矛盾→**系統性少收**(坐實 X5 §7 懸念;修 B-16 時的地雷) |
| B-24 | orbBudgetGuard.ts:104-125 | 高 | monthly budget gate 只掛 ai.chat/director.chat,擋不到直接生成/訓練花費(含 B-16 零計費入口) |
| B-25 | credits.ts:55-82 | 高 | credits.myBalance/財財精靈報表資料源 api_usage_logs 只由舊版 generate.ts 餵→對 orb+15 精靈失明,低餘額提醒對主要花費失效 |
| S-35 | secretCrypto.ts:44-51 | 高 | CREDENTIAL_ENCRYPTION_KEY 未設靜默 fallback JWT_SECRET→**輪替 JWT_SECRET(常規資安動作)會靜默且不可逆打壞所有 Notion 憑證**,消費端吞掉解密失敗無告警(升級 S-08) |
| S-36 | spiritRouter.ts:100-165 | 高 | 全 9 端點裸 protectedProcedure,spirit.invoke 真實 fal 計費繞過 generationProcedure 速率限制+GPU 並發上限→cost-DoS |

> GC 也複核 X9 realEarth 教材外洩(S-19)**現況未變**;釐清 E「orb quota guard 預設關」只管聊天層,派工當下的每日生成上限不受旗標影響永遠啟用(negative result)。orbQuota 三類配額生產零呼叫卻把假「剩餘配額」寫進 planner 提示詞。

---

## 10.11 DV 波依賴弱點卡(11 npm 弱點可達性,詳見 `DV0-dependency-remediation-plan.md`)

> 低噪音結論:11 個 critical/high 中只有 1 個 prod 可達——避免「36 個弱點」的假恐慌。

### 卡 DEP-01 ·【P1・今天可修】ws 未鑑權即跑脆弱 frame 解析
- 群組:安全/依賴 ｜ 驗證:已確認(DV 波,`server/_core/index.ts:1071,1075-1081` + `server/ws/orbVoiceGateway.ts:20-27`)
- 現況:ws 8.20.0(弱點範圍 8.0.0-8.20.1);`/ws/orb-voice` upgrade handler 只檢查 pathname、**未鑑權就 handleUpgrade**,token 驗證在連線建立後才做→未登入網路端可送 tiny fragmented frames 觸發記憶體洩漏/DoS。
- **待決策**:升 ws 到 patched 8.x(公開 API 不變低風險)+ **把 token 驗證移到 handleUpgrade 之前**(升版修不到的架構問題)。
- 其餘:langsmith reachable-limited(升版一次解 2 CVE);axios/drizzle-orm 防禦性升版;protobufjs/undici/form-data/@grpc/fast-xml-builder 經查 **not-reachable**(識別碼固定 schema、只送 JSON、死碼鏈);vite/vitest dev-only。**立即低風險升版清單:ws / langsmith / axios / drizzle-orm。**

---

## 10.12 IN 波接縫稽核新增卡(24 確認 0 推翻,詳見 `IN0-integration-seam-map.md`)

> 接縫地圖揭露一個系統性反模式:**「正確的零件已存在,只是兩端沒接上」**——大量後端能力 client 從不呼叫,大量 client 期待後端不回。

### 卡 S-37 ·【P0】admin.allUsers/allUsersPaginated 洩全站 passwordHash/2FA 給任何 admin
- 群組:安全 ｜ 驗證:已確認(IN 波,`server/routers/admin.ts:13-27` + `server/db.ts:568-589` 全欄位無白名單)
- 現況:與 S-00 同型態但**範圍更廣**——admin 使用者清單回傳每個使用者整列(含 passwordHash/twoFactorSecret/icsFeedToken),前端只用 id/name/email/role。任一 admin 帳號被盜或前端 XSS 即洩全站憑證。
- **待決策**:與 S-00 一起用「集中式欄位投影/DTO 白名單」統一修(對齊 IA0 SYS-02 top-5)。

### 其餘 IN 確認卡
| 卡 | 兩端 | 嚴重度 | 一句話 |
|---|---|---|---|
| B-26 | ImageStudio.tsx:3820 ↔ generate.ts:2414 / postGenActions.ts:238 | 高 | recordGenResult 契約缺 costCredits→每筆生成成本被寫死 1 點(記帳失真) |
| SEAM-01 | imageStudio.ts:1397-1511 ↔ ImageStudio.tsx(零呼叫) | 高 | **正確路徑閒置**:checkImageStatus 有正確 estimatePoints 記帳+持久化,client 卻改走阻塞式 falQueueRun→正確計費被繞過 |
| C-03 | VideoStudio:4985 / ProStudio:4346 ↔ DirectorAI:2422 | 高 | resultUrl:null 交接擴及 ProStudio(C-01 延伸)→生成結果連不回導演卡 |
| C-04 | director.ts:235-258 ↔ DirectorAI.tsx:3406 | 高 | 主聊天呼叫從不傳 projectId→AIDV-152 世界觀注入在主頁面形同死碼 |
| DEADSEAM | teachingArchive update/RealEarth/isFeatured、plans、jobStatus 系列 | 中-高 | 一整群後端完整實作但 client 零呼叫(死接縫);教材編輯/精選/RealEarth 連結前端無入口 |
| FE-08 | DataRepairTab.tsx:22 ↔ schema.ts:301(enum) | 高 | 用不存在的 "running" 狀態篩卡住任務(真值 "processing")→**永遠漏抓真正卡住的任務** |
| FE-09 | App.tsx/OrbGuideContext ↔ AssetsLibrary.tsx:241 | 高 | /assets?section=vault\|tasks\|prompts\|collection 深連結整組死(getInitialSection 硬編 "assets") |
| S-38 | rbac.ts:30 ↔ admin.ts:18-39(adminProcedure) | 高 | 前端宣稱 leader 可看使用者/積分分頁,後端 admin 專屬→leader 分頁 100% FORBIDDEN |
| FE-10 | AdminPage.tsx:280 ↔ SettingsShell(4shell ON) | 高 | 4shell+rich 旗標 ON→AdminPage 6 個 admin procedure 無存活 UI 入口(接續 FE-02 shell shadow) |
| TA-vec | teachingArchive.ts:240 ↔ TranscriptionBadge:731 | 高 | vectorStatus 概念兩端皆不存在,語意可搜尋性被誤植進 transcriptionStatus→「已抽文」綠徽章誤導(NSX-1 的 UI 面) |

> **接縫反模式根因**(對照 IA0 根因):同一個 productionStatus 被兩套 enum 治理(PS-08 確認)、resultUrl/costCredits/projectId/storyboardId 這些「串接鍵」在交接點被丟成 null/不傳。修法方向 = 契約收斂 + 串接鍵必填。

---

## 10.13 RC 波並發競態卡 + 附帶查獲的免費點數繞過(詳見 `RC0-concurrency-race-map.md`)

### 卡 B-27 ·【P0・免費無限點數・一行 tRPC 可利用】profile.updateQuotaJson 讓任何登入者自設 remainingGenerations
- 群組:計費 ｜ 驗證:**主迴圈親自讀碼確認**(`server/routers/profile.ts:8-20` + `server/db.ts:932-944`)
- 現況:`profile.updateQuotaJson` 是 `protectedProcedure`(任何登入者,非 admin),input 只 `.min(0)` **無上限**;`updateUserQuotaJson(ctx.user.id, ...)` 無條件把**自己的** `remainingGenerations` 設為 `image+video+audio+voice`。`remainingGenerations` 正是全站唯一活計費餘額(W5)→ **任何使用者呼叫 `updateQuotaJson({image:9e6,...})` 即可自給近乎無限免費生成點數。**
- 這是 RC1 競態發現(無鎖絕對值 SET)背後更嚴重的授權問題:不只 lost-update,是「使用者可自寫計費餘額」。
- **待決策**:立即改——此端點應為 admin 專屬,或移除;若保留使用者自訂配額語意,絕不可寫 `remainingGenerations`。**建議與 S-00 同列第 0 波第一批。**

### 其餘 RC 確認卡
| 卡 | 檔案 | 嚴重度 | 一句話 |
|---|---|---|---|
| B-28 | db.ts updateBackgroundJob | 高 | 無狀態守衛(無 WHERE status),webhook/polling/staleJobChecker 三完成路徑互相覆蓋終態;staleJobChecker 用舊快照可把剛完成的 job 打回 queued/failed→抹掉成品連結 |
| B-29 | models.ts:727-751 toggleVisibility | 高 | 分享獎勵 check-then-act TOCTOU(與 X12 assets 同構複製到 models 表),並發雙擊重複發模型分享獎勵(refundUserQuota 只保護加點不保護資格判斷) |
| B-30 | assets.ts:233-267 toggleVisibility | 高 | X12 獎勵 TOCTOU 覆核 HEAD **仍未修**;digitalAssetLibrary 無 version/CAS。與 B-29 合併 CAS 化修 |
| RC-rbac | rbac.ts:144-285 | 中 | share 與 transferOwnership 無互斥:移轉「清空全部共享」的原子性可被並發 share 繞過,留孤兒授權 |
| RC-idem | orbIdempotency.ts | 高 | 請求/任務去重為 process-local Map,多實例下同 requestId 路由到不同副本各判為新→重複觸發付費生成+LLM(需執行期確認副本數) |
| RC-code | orbCodeTask.ts | 中 | codeTaskStore 零持久化 in-memory Map,跨 worker 不可見、重啟即失,且未呼叫 warnIfMultiInstanceSingleton |

> **單實例即會壞**(不需擴容):B-27、B-28、B-29、B-30、RC-rbac。**需多實例才出事**:RC-idem、RC-code。優先上鎖 3(RC0):profile.updateQuotaJson(併 B-27 授權修)、分享獎勵 CAS(assets+models 合併)、updateBackgroundJob 狀態守衛。既有 deduct/refund/atomicClaimJobRefund 為 FOR UPDATE+CAS **健康**(negative result)。

---

## 10.14 PF 波效能/資源卡(15 確認 0 推翻,詳見 `PF0-performance-map.md`)

> 分層明確:**現在就痛(攻擊者可觸發或架構缺陷)** vs **規模大才痛**。

### 現在就痛(優先)
| 卡 | 檔案 | 嚴重度 | 一句話 |
|---|---|---|---|
| PERF-01 | geminiMedia.ts | **P1** | 圖生影下載**使用者可控 URL**(firstFrameUrl 無 `.url()`/網域限制)**零位元組上限**→單一請求 arrayBuffer 整包進記憶體+base64 膨脹 1.33x→**記憶體 DoS(且 SSRF 面)**,不需規模 |
| PERF-02 | internalMedia.ts | 高 | persistExternalMediaUrl 的 10MB 上限僅在有 Content-Length 時生效,chunked 來源(webhook localizeResultUrls 遞迴 walk 也走此路)90 秒視窗內完全不受限(與 PERF-01 同源缺陷,共用修法) |
| PERF-06 | ragMemory.ts/teachingArchiveRag.ts | 中 | 每次 RAG 互動都對 Pinecone 打未快取查詢→從第一天每個生成前後多付一次網路往返(架構缺快取) |

### 規模大才痛(需負載驗證門檻)
| 卡 | 檔案 | 嚴重度 | 一句話 |
|---|---|---|---|
| PERF-03 | orbMemory.ts:36,121-278 | 高 | 對話記憶用**全站共用、永不淘汰的行程內陣列**,每輪對話線性全掃;成本正比全站累積量而非單使用者;且多實例不一致 |
| PERF-04 | ai.chat(ai.ts:1064,1494) | 高 | 每則訊息無條件:全量撈使用者整個 digital_asset_library(無 limit)+ 對 api_usage_logs 打**無索引** GROUP BY 聚合 |
| PERF-05 | teachingArchive.list / admin.userActivity / feedback.all / background_jobs 併發檢查 | 高-中 | 無界查詢群:公開教材池無分頁、admin userActivity 全表 users×4 子查詢、feedback 全站整包;`background_jobs` 併發檢查用 jobType+status **無索引**(全表歷史掃描,無歸檔) |
| PERF-07 | mediaArchival/assetCleanup/tagAssets | 中-低 | N+1/缺索引:backgroundJobId 與 fileKey 欄位無索引;tagAssets 迴圈逐筆 UPDATE 且 assetIds 無長度上限(對照 export.max(50) 慣例) |

> 優先修 3(PF0):PERF-01+PERF-02(下載位元組上限,同源)、PERF-03(orbMemory TTL/容量上限)。negative:assetCleanup dry-run 預設關、orbVoice 單 frame 有 maxPayload、internalMedia 正常 Content-Length 情境有效。

---

## 10.15 EH 波失敗模式卡(8 確認 2 推翻,詳見 `EH0-failure-mode-map.md`)

> 四個系統性反模式:(A) DB 寫入/退款失敗只 log 仍視為成功 (B) webhook 先 ack 200 後處理失敗即消失 (C) 完成判定不驗證產出完整性 (D) 非同步啟動鏈外層 promise 無人接手(agentToolExecutor 已有 F3 修復範本)。

### 卡 B-31 ·【P0・帳目說謊】refund 吞錯不 throw,補償旗標成死碼
- 群組:計費 ｜ 驗證:對抗式已確認(EH 波,`server/db.ts` refundUserPoints/refundUserQuota + postGenActions.ts:596 / director.ts:3342)
- 現況:atomicClaimJobRefund 先寫 refunded=true 鎖 → refundUserPoints/Quota 內部 transaction 若失敗,catch **只 console.error 不 rethrow** → 呼叫端 try/catch 永遠進不了 catch → `refundRestoreFailed` 補償旗標永不寫入 → deriveJobRefundStatus 回報「full 已全額退款」,但 `remainingGenerations` 從未加回。**錢包永久少記,且稽核記錄本身佐證「已退款」,人工難察覺。**
- **待決策**:refund 失敗必須 rethrow 並寫 refundRestoreFailed;補一次性對帳掃描找歷史受害者。與 GC2/W5 計費群組同批。

### 卡 B-32 ·【P0・收款無效果】Stripe webhook 五個 handler 全是 console.log stub
- 群組:計費 ｜ 驗證:已確認(EH 波,`server/routes/stripeWebhook.ts`)
- 現況:checkout.session.completed/invoice.paid/payment_failed/subscription.updated/deleted **全部只 console.log+TODO,不寫任何 userSubscriptions**;端點驗簽即回 200。**收款事件被接收但完全沒有 entitlement 邏輯生效**(與 B-27 自給點數、B-22 守衛失明合看=整個變現層形同虛設)。
- **待決策**:訂閱付款→點數/方案的核心邏輯需實作;確認目前是否有其他路徑補上,還是付費真的沒發點。

### 其餘 EH 確認卡
| 卡 | 檔案 | 嚴重度 | 一句話 |
|---|---|---|---|
| EH-01 | postGenActions.ts doPostGenComplete | **P0** | 資產/歷史寫入失敗 **catch 完全靜默(連 console 都沒)**,仍設 postGenComplete=true 永不重試→永久漏帳、使用者看到完成但資產庫空、無日誌可查 |
| EH-02 | webhookFal/Replicate/Suno | 高 | 統一先 ack 200 才處理,DB 寫入失敗只最外層 console.error 且供應商不再重試→任務供應商端完成但本地卡住、資產未存、退款未觸發(輪詢備援能否救需執行期驗證) |
| EH-03 | falTrainer.ts / loraTrainer.ts | 高 | 訓練完成但 outputUrl 解析 null 仍標 ready/completed→前端顯示「LoRA 就緒」允許套用空 LoRA,到下游生成才失敗,已耗訓練費無補償 |
| EH-04 | models.ts:249-499 / modelTrainingWorker.ts | 高 | 訓練啟動 `import().then()` 缺外層 catch→import 失敗成 unhandled rejection、backgroundJob 永卡 queued/processing 無限重置迴圈永不標 failed(agentToolExecutor F3 有現成修法) |
| EH-05 | postGenActions void 呼叫(generate/proStudio/videoStudio/director 多處) | 高 | runPostGenForJob/refundJobIfBilled 全 void 無 .catch,函式開頭 db.getBackgroundJob 無保護→DB 抖動併發 unhandled rejection 累積達 storm 閾值(50/60s)可觸發 **process.exit(1) 全站重啟**(需執行期驗證機率) |
| EH-06 | models.ts/assets.ts toggleVisibility | 高 | 分享獎勵加點與旗標非原子雙寫:旗標寫入失敗→重複發;或退款吞錯誤判成功→旗標鎖死永不補發(與 B-29/B-30 同源) |

> negative:本輪推翻 2 條。優先 3(EH0):B-31 refund 吞錯(帳目可信度影響最廣)、EH-01 postGen 靜默漏帳、EH-04 import catch(成本低有範本)。

---

## 10.16 FL 波旗標矩陣卡(27 旗標,詳見 `FL0-feature-flag-matrix.md`)

### 卡 FL-01 ·【P1】7 個安全/計費控制出廠即關,且 prod 不覆寫
- 群組:安全/計費/維運 ｜ 驗證:對抗式已確認(FL 波,`server/_core/env.validated.ts` + `.env.production` 實測)
- 現況:以下防護 **default OFF 且 `.env.production` 未覆寫任何後端旗標**→正式站全關:`ENABLE_COST_LEDGER`(複式帳本,B-11 記帳失明)、`ENABLE_ORB_QUOTA_GUARD`(rapid-click 節流,僅 ai.chat)、**`ENABLE_ORB_BUDGET_GUARD`**(唯一涵蓋 ai.chat+director.chat 的月度硬擋,風險最高)、`ENABLE_ORB_IDEMPOTENCY_GUARD`(生成冪等去重,關=重複點擊重複計費)、`ENABLE_RAG_INJECTION_GUARD`(注入中和,X8)、`ENABLE_DIRECTOR_WORLD_CONTEXT`(北極星世界脈絡)、`FREE_LLM_API_ENABLED`(關是正向)。
- **待決策**:哪些該改 default ON(建議至少 ORB_BUDGET_GUARD + ORB_IDEMPOTENCY_GUARD + RAG_INJECTION_GUARD);與計費群組(B-22/B-31)、注入群組(I-06)同批決定。⚠️ 這些「守衛預設關」正是為何 B-22 守衛實務上不觸發的旗標層原因。

### 其餘 FL 卡
| 卡 | 旗標 | 嚴重度 | 一句話 |
|---|---|---|---|
| FL-02 | ENABLE_CODEX_TASKS | 中 | **雙分支矛盾**:`providerRouter.ts:145` default false(認為已停用) vs `orbCodeTask.ts:30` default true(實際放行)→同旗標未設時兩處行為相反 |
| FL-03 | FEATURE_ADVANCED_SEARCH/RAG_MEMORY/RESEARCH_MODE 等 | 低 | 死旗標:zod schema 定義但 serverEnv 零讀取(真正邏輯走 process.env 動態直讀);多個 VITE_* client 旗標(ORB_MEMORY_PANEL/APP_ID/OAUTH_PORTAL_URL)定義卻零消費 |
| FL-04 | 北極星 prod 開關 | 高 | **正式站北極星功能沒開**:`ENABLE_PROJECT_HUB`(五步嚮導)prod OFF(dev ON 落差)、`DIRECTOR_WORLD_CONTEXT` OFF、`WORLD_STYLE_INJECTION` OFF;RAG_MEMORY 綁 PINECONE_API_KEY 是否設(待 Railway 查) |

> 這解釋了 Y0 北極星前端斷點的「旗標層」成因:功能碼在,但 prod 旗標關著。優先改 default 3(FL0):ORB_BUDGET_GUARD、統一 CODEX_TASKS 雙分支、擴大 ORB_IDEMPOTENCY_GUARD 覆蓋。待補外部數據:RAG_MEMORY 的 PINECONE_API_KEY 在 Railway 是否設(研究無法從 repo 得知)。

---

## 11. 更新記錄

- 2026-07-03 `812f6fdb`:建立本表,seed 自 A–W 波 + M/N/R/S 方案決策卷。
- 2026-07-03 `812f6fdb`(續):補 W7/W9 卡(B-07〜B-09、PS-04〜PS-07、S-11〜S-13)。
- 2026-07-03 `b743d2ac`(續):補 SYS-01 並將 NS/D/SYS「往前做」卡移至 `00-devzone.md`(研究討論開發專區),本表專責稽核問題卡。
- 2026-07-03 `b743d2ac`(續):補 W8 卡(B-03 升級 P0、S-14〜S-16、I-04)。
- 2026-07-03 `b743d2ac`(續):補 Z 波 S-17/S-18;X 波地毯掃描 40 條確認卡(B-10〜B-18、S-19〜S-28、PS-08〜PS-12、I-05/I-06、NSX-1/NSX-2、U-1),詳見 `X0-carpet-scan-synthesis.md`。
- 2026-07-03 `b743d2ac`(續):Y 波前端地毯掃描 20 可證偽項 0 推翻,補前端卡(B-19/B-20、C-01/C-02、S-29〜S-32、FE-01〜FE-05),詳見 `Y0-frontend-carpet-scan-synthesis.md`。
- 2026-07-03 `b743d2ac`(續):CC 波覆蓋補完 16 確認,補卡 S-33/S-34(langsmith 全站對話外洩、orbClarification IDOR)、B-21、SSOT-1(W1 navigate 根因)、FE-06/FE-07(AnimationStudio crash)、PS-13,並收 CC0 完整性批判。
- 2026-07-03 `b743d2ac`(續):GC 波缺口補完 8 確認 0 推翻,補 **S-00(auth.me 洩 passwordHash/2FA=全案最高優先)**、B-22〜B-25(計費守衛層對主流量失明+硬編 500 上限少收=封閉計費群組)、S-35(憑證金鑰輪替打壞)、S-36(spiritRouter cost-DoS)。**至此 W+X+Y+Z+CC+GC 全波落地,CC0 點名缺口全數補完,研究飽和。**
