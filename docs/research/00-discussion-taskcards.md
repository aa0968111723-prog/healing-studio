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
| B-03 | 計費 | P1 | LLM 成本未計入點數 / ai.chat 疑繞過計費 | 待 W8 收斂 |
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

> 註:X 波(17 檔地毯掃描)與 W7/W8/W9 完成後,新坐實卡會續補到下方各群組,並更新本速覽表。

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

## 6. 北極星功能群組(解放/接線,非重造)

> 主軸見 `M0-solution-blueprint.md`:**零件八成已在,被旗標與單一殼鎖住;全程用 `creativeProjectId` 串成一條龍就是「不跑偏」的地基。**

- **NS-00【P0前置】修 G3 178-tool gate**:分鏡管線執行化(NS-03)與 AI 動手引導共同硬前置;不先修,體驗會蓋在「規劃會過、執行必敗」的假成功上。
- NS-01 解放 ProjectFlowGuide 五步引導接光球(M2)｜NS-02 creativeProjectId 為 SSOT、禁猜最新一筆(M1)｜NS-03 分鏡管線執行化(M1)｜NS-04 contextPackets 接 ai.chat/director(M2)｜NS-05 compose 服務(唯一大件,需 ffmpeg vs 委外 spike,Q2)｜NS-06 連接器 UI 收斂 + Adobe/Canva MCP(M3)｜NS-07 素材/目標/審批三柱綁專案(M4)。
- **待決策**:是否採 M0 的分階段路線(Phase 0 修 gate → Phase 1 單幕端到端+AI 讀專案 → Phase 2 引導解放+逐幕三軌+審 → Phase 3 拼接輸出打包+目標+連接器)。

---

## 7. 決策卡(N 波,拍板用)

- D-01 Phase 0/1 實作決策(`N1-...`)｜D-02 架構決策(`N2-...`,雙 DB、102 表 0 FK)｜D-03 優先序決策(`N3-...`)｜D-04 成本/維運決策(`N4-...`)。
- 這四張是「怎麼做」的選項題,討論時搭配對應功能卡一起看。

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

## 11. 更新記錄

- 2026-07-03 `812f6fdb`:建立本表,seed 自 A–W 波 + M/N/R/S 方案決策卷。
- 2026-07-03 `812f6fdb`(續):補 W7/W9 卡(B-07〜B-09、PS-04〜PS-07、S-11〜S-13)。X 波(17 檔)與 W8 完成後續補。
