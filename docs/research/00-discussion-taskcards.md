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

## 11. 更新記錄

- 2026-07-03 `812f6fdb`:建立本表,seed 自 A–W 波 + M/N/R/S 方案決策卷。
- 2026-07-03 `812f6fdb`(續):補 W7/W9 卡(B-07〜B-09、PS-04〜PS-07、S-11〜S-13)。
- 2026-07-03 `b743d2ac`(續):補 SYS-01 並將 NS/D/SYS「往前做」卡移至 `00-devzone.md`(研究討論開發專區),本表專責稽核問題卡。
- 2026-07-03 `b743d2ac`(續):補 W8 卡(B-03 升級 P0、S-14〜S-16、I-04)。
- 2026-07-03 `b743d2ac`(續):補 Z 波 S-17/S-18;X 波地毯掃描 40 條確認卡(B-10〜B-18、S-19〜S-28、PS-08〜PS-12、I-05/I-06、NSX-1/NSX-2、U-1),詳見 `X0-carpet-scan-synthesis.md`。至此 W+X+Z 波深挖全數落地。
