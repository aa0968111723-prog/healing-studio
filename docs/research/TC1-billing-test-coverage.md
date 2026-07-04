# TC1 — 計費/退款路徑測試覆蓋
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:server 內計費相關 *.test.ts + 對照計費群組發現(B-01/B-03/B-16/B-19/B-22/B-27/B-31/B-32/X3 定價)
- 方法:先用 Glob/Grep 找出實際存在的 *.test.ts,逐檔 Read 判斷測了什麼、斷言什麼,再比對 `docs/research/00-discussion-taskcards.md` 計費群組的頂級發現。不臆測未讀檔案的覆蓋範圍;讀不到 / 沒把握的一律標「需再查」。

---

## 0. 結論摘要(先講重點)

1. **核心扣款/退款函式紮實有測試**:`deductUserPoints`/`refundUserPoints`/`atomicClaimJobRefund` 的 FOR UPDATE + CAS 原子性、冪等性、並發搶鎖都有回歸測試背書(W5 negative result 成立)。
2. **「沒走這套」的邊緣路徑幾乎都沒有測試**:B-01(ProStudio async 完成期失敗不退款)、B-03(ai.chat/orb 結構性無法扣點)、B-16(models.ts 訓練 mutation 零限流零計費)、B-19(submitStudioJob 從不寫 costPoints)全部**查無對應測試檔**,修這些路徑時完全沒有回歸網。
3. **兩個特別危險的模式:測試把「現有錯誤行為」釘成「預期行為」**——
   - `server/atomic-deduction.test.ts:71-75` 明文斷言 `refundUserPoints` **永遠不 throw**(即使底層失敗),這正是 B-31「refund 吞錯」問題在最底層(db.ts)的根因,而且被測試鎖住了——修 B-31 必須連這個測試一起改,否則会直接測試失败。
   - `server/services/refundStatus.test.ts:63-71` 明文斷言「submitStudioJob 登錄型 resultJson(無 costPoints)→ none」是**正確**的推導結果——這其實是把 B-19 的病徵(沒有 costPoints 可退)寫成規格,而不是修正「submitStudioJob 該寫 costPoints」這個根因。
   - `server/phase2.test.ts:315-326`、`server/phase3-audit.test.ts:308-332` 明文斷言一般登入使用者呼叫 `profile.updateQuotaJson({image:10,...})` **應該成功**——沒有任何測試檢查上限或角色限制,等於把 B-27 的可利用面寫進測試合約。
4. **B-31 有一半被 AIDV-650 修過、但底層仍破**:`postGenActions.ts`/`director.ts` 的 catch 區塊「有」補寫 `refundRestoreFailed` 旗標(且有 source-invariant 測試守著,見 §3),但因為 `db.ts` 的 `refundUserPoints`/`refundUserQuota` 自己把內部 transaction 錯誤吞掉、從不 rethrow(且此行為本身被 `atomic-deduction.test.ts` 釘住),呼叫端的 catch 永遠進不去——**補償旗標仍是死碼**,只是死碼的位置從「呼叫端沒寫 catch」變成「呼叫端寫了 catch 但永遠不會觸發」。
5. **B-32(Stripe webhook 五個 handler 全是 stub)完全沒有回歸測試**:`stripeWebhook.test.ts` 只測簽章驗證/fail-open-closed,測試本身的註解直接承認「checkout.session.completed handler 的 stub log」——即測試知道這是 stub,但從未斷言「訂閱應該真的生效」,修 B-32 時没有任何現有測試会因为「entitlement 沒寫入」而失敗。
6. **X3 定價卡**:雙重計費機制的「公式」本身有正向回歸測試(`model-pricing-estimate.test.ts`),但 X3 點名的 9 個受影響 live 模型(如 `fal-ai/wan/v2.1/video-to-video`)**不在**該測試涵蓋範圍內;`videoCatalogConsistency.test.ts` 只護影片類別的 catalog↔dispatcher 一致性,音訊/3D/訓練/reasoning 皆無等效 CI 守門(與 X0/X3 文件描述一致)。`costAnalytics.ts` 的所有測試都是餵合成 events 陣列進純函式,完全沒有測試 `invokeLLM` 是否真的把成本寫回 `ai_usage_events`——實際查證 `server/_core/llm.ts` 的 `invokeLLM` 內文**確實沒有**任何寫入 `ai_usage_events`/`createApiUsageLog`/attribution 的呼叫,此結構性盲區零測試。
7. **B-22 部分有測試、部分沒有**:`orbCostGuards.test.ts` 紮實地用 source-invariant 測試守住「`ai.chat`/`director.chat` 有呼叫 `enforceMonthlyBudgetGate`」與 `decideBudget` 純函式的計算矩陣,但**沒有任何測試**驗證守衛的成本資料源涵蓋主流量生成端點(image/video/training 直接生成路徑),這正是 B-22「唯一資料源對主流量結構性失明」的核心主張——資料源盲區本身無測試。

---

## 1. 關鍵路徑 × 覆蓋狀態總表

| # | 關鍵路徑 | 覆蓋狀態 | 對應發現 | 主要測試檔:行號 | 回歸風險(untested 時) |
|---|---|---|---|---|---|
| 1 | `deductUserPoints`/`refundUserPoints` FOR UPDATE 原子性 + `atomicClaimJobRefund` CAS 冪等 | **tested** | (負向結果,呼應 B-06 已推翻) | `server/atomic-deduction.test.ts:276-299`(SQL pattern)、`server/services/postGenActions.refund.test.ts:81-148`(並發 CAS)、`server/services/refundStatus.test.ts` 全檔 | — |
| 2 | ProStudio ~20 個 async 端點(textToMusic/TTS/voice-clone/demucs/dubbing/avatar…)完成期 FAILED/TIMEOUT 分支退款 | **untested** | B-01 | 無對應測試檔(`server/routers/proStudio.ts` 查無任何 `*.test.ts`) | 修 `checkAudioStatus` 的 TIMEOUT/FAILED 分支(`proStudio.ts:1700-1703` 附近)時,無法自動偵測「加了退款邏輯卻漏了某個 modality 分支」或「改壞了 CAS 順序」;唯一同族測試(`aidv-620-suno-orphan-refund.test.ts`)明確聲明只涵蓋 Suno **同步送出失敗**,不含非同步完成期失敗 |
| 3 | ai.chat/orb 主聊天生成路徑扣點(`dispatch*` 是否帶 userId 並實際扣點) | **untested** | B-03 | 無;`server/routers/ai.ts` 全檔查無 `deductUserPoints`/`chargeForFalTask` 呼叫,亦無任何 `*.test.ts` 斷言「ai.chat 觸發生成時應該扣點」 | 若之後要修「main chat 該不該計費」,目前沒有測試會因為「加了計費」或「維持零計費」而失敗——決策落地後極易被下一次重構悄悄改回原狀,無法察覺 |
| 4 | `models.ts` 的 `create`/`retrain`/`captionImages`/`autofillAngles` 限流與計費 | **untested**(僅測 auth/schema) | B-16(涵蓋並升級 B-09) | `server/phase3-audit.test.ts:38-61` 只測未登入拒絕 + enum 驗證,**不含**任何限流或扣點斷言 | 這四個會觸發真實 Replicate/fal 付費呼叫的 mutation,若之後補限流/計費又不慎被 revert,現有測試不會抓到;captionImages 已有測試但只覆蓋輸入驗證層,無法反映「零限流零計費」是否被修好 |
| 5 | `submitStudioJob` 寫入 `costPoints`(讓失敗退款不再保證 no-op) | **untested**(且有反向釘死測試) | B-19 | `server/services/refundStatus.test.ts:63-72` 明確斷言「submitStudioJob 登錄型 resultJson(無 costPoints)→ none」為正確結果;`server/aidv-771-orphan-refund.test.ts:95-118` 明確把 submitStudioJob 排除在「計費站點」清單外(`billingSitesChecked` 只鎖 3 個站點:generate 同步/非同步 + director) | 若日後修 B-19、讓 submitStudioJob 也寫 `costPoints`,現有的 refundStatus 測試(63-72 行)會直接測試失敗——必須同修測試,否則會被誤判成「改壞了東西」而擋下正確的修法;目前也沒有任何測試驗證「submitStudioJob 建立的 job 失敗後,退款是否真的發生」 |
| 6 | `orbCostGuard.checkRetryChainCost` + `orbBudgetGuard.enforceMonthlyBudgetGate` 資料源涵蓋主流量生成端點 | **partial**(guard 本身邏輯有測,資料源盲區無測試) | B-22 | `server/routers/__tests__/orbCostGuards.test.ts:119-155`(retry-chain guard 接線)、`:195-293`(`decideBudget` 純函式矩陣 + `ai.chat`/`director.chat` 接線 invariant) | `decideBudget` 計算本身回歸有保障,但沒有任何測試驗證「圖片/影片/訓練直接生成端點的花費是否被計入 `enforceMonthlyBudgetGate` 的資料源」——這正是 B-22 的核心結構性盲區,即使日後接上其他生成端點的守衛呼叫,也沒有測試驗證資料源本身涵蓋了主流量 |
| 7 | `profile.updateQuotaJson` 授權範圍(是否應限 admin / 上限) | **untested**(且有反向釘死測試) | B-27 | `server/phase2.test.ts:315-326`、`server/phase3-audit.test.ts:308-332` 只測「未登入拒絕」+「負值拒絕」+「合法值(image:10 等)成功」;**沒有**任何測試檢查上限或非 admin 角色應否被拒 | 現有測試把「一般登入使用者可自設 `remainingGenerations`」釘成合約行為的一部分(「accepts valid profile.updateQuotaJson input」斷言 `success:true`)。修 B-27(改成 admin-only 或移除寫 `remainingGenerations` 的能力)會直接讓這兩個既有測試失敗,必須同修 |
| 8 | `refundUserPoints`/`refundUserQuota` 內部 transaction 失敗時是否正確傳播錯誤,讓呼叫端能補寫 `refundRestoreFailed` | **partial**(旗標寫入邏輯有 source-invariant 測試,但根因路徑被反向釘死) | B-31 | 產出方測試:`server/services/refundStatus.test.ts:400-419`(`postGenActions.refundJobIfBilled` catch 內必須含 `refundRestoreFailed: true` 的原始碼不變量)、`:465-497`(`director.ts` 兩條退款站點同款不變量);消費方測試:`:238-263`(`deriveJobRefundStatus` 正確把 `refundRestoreFailed` 降級為 `not_refunded`)。**根因處反向釘死**:`server/atomic-deduction.test.ts:71-75`「refundUserPoints contract → should not throw when DB is unavailable」 | `db.ts:898-921` 的 `refundUserPoints`(以及 `:769-796` 的 `refundUserQuota`)自己 `catch(error){ console.error(...) }`、從不 rethrow;`postGenActions.ts:596-615`/`director.ts:3340-3390` 的 catch 因此永遠不會被觸發,`refundRestoreFailed` 旗標在真實失敗情境下**仍是死碼**。目前沒有任何測試模擬「DB 存在但 transaction 因鎖等待逾時/斷線而失敗」這個情境並驗證 `refundRestoreFailed` 真的被寫入——唯一相關測試(`atomic-deduction.test.ts:71-75`)反而斷言「不論如何都不能 throw」,若要修就必須先改這個既有 contract 測試 |
| 9 | Stripe webhook 五個 handler(checkout.session.completed/invoice.paid/payment_failed/subscription.updated/deleted)是否真的寫入 `userSubscriptions`/生效點數 | **untested** | B-32 | `server/routes/__tests__/stripeWebhook.test.ts` 全檔(285 行)只測 HMAC 簽章驗證、replay 防護、fail-open/fail-closed 開關;`:126-132` 的斷言只是確認 log 內容含 `"checkout.session.completed"` 字串(即確認它是 stub),從未斷言任何 entitlement 邏輯生效 | 修 B-32(讓 handler 真的寫入訂閱/點數)完全沒有回歸網——不會有任何既有測試因為「entitlement 邏輯終於生效」而失敗,但也沒有測試會在「改壞了 entitlement 邏輯」時抓到 |
| 10 | `modelPricing.ts` 9 個受影響 live 模型(時長費+起跳費雙重計費,如 `fal-ai/wan/v2.1/video-to-video`) | **partial**(機制有正向回歸測試,受影響的具體 model id 不在測試範圍內) | X3(C1) | `server/model-pricing-estimate.test.ts:5-26`(用 `fal-ai/stable-audio`/`elevenlabs` 系列驗證 baseline+溢收公式正確) | 測試證明「有 `freeSecondsInBase` 的條目算法正確」,但 X3 點名的 9 個缺 `freeSecondsInBase` 的 live 模型不在測試清單內——若日後補上這些條目的 `freeSecondsInBase`,沒有既有測試會驗證修對了;若之後不慎在其他模型上又漏設該欄位,現有測試也不會抓到(它只覆蓋自己列出的模型 id) |
| 11 | `invokeLLM`(~30 檔主流量:orb/導演/世界觀)成本寫回 `ai_usage_events`/`cost_ledger` | **untested** | X3(C2) | `server/cost-analytics.test.ts` 全檔(633 行)只測純函式(`categorizeEndpoint`/`summarizeBy*`/`detectRetryChains` 等)吃合成 event 陣列的邏輯,不測試 event 從哪裡來;`server/_core/llm.ts` 內文查證 `invokeLLM`(:1573 起)完全沒有任何 `ai_usage_events`/`createApiUsageLog`/attribution 寫入呼叫 | costAnalytics 對帳/報表的計算邏輯本身回歸有保障,但「reasoning 類主流量成本完全看不到」這個資料缺口本身沒有測試——修 X3(C2)(讓 `invokeLLM` 出口統一寫入)不會被任何既有測試擋下,但也没有測試會在「不小心又漏接某個呼叫路徑」時抓到 |
| 12 | `catalog`↔`dispatcher` modelId 一致性(全模態) | **partial**(僅影片類別有 CI 守門) | X3(H3) | `server/services/__tests__/videoCatalogConsistency.test.ts:31-40+` 只驗證 `ALL_VIDEO_ROUTER_IDS`/`ALL_VIDEO_PRICING_IDS` 對 `MODEL_PRICING_CATALOG` | 音訊/語音/TTS/3D/訓練/reasoning 類別的 catalog↔dispatcher 鍵不同步(已知會靜默退回 5pts,X3 §H3)完全沒有等效測試;`fal-ai/tripo3d`、`fal-ai/flux/dev/controlnet` 等已知缺口不會被任何 CI 擋下 |
| 13 | `agentToolExecutor` connector fallbackTools 降級路徑是否繞過 `requireConfirmation` | **partial**(直接路徑測了,fallback 組合未測) | S-24(計費守衛旁支,列入供對照) | `server/agent-tool-executor.test.ts:32-60`(直接工具的 `requireConfirmation` 正確擋下)、`:144-189`(fallback 成功案例,但主/備工具皆無 `requireConfirmation`) | 沒有測試組合「主工具 `requireConfirmation:true` + fallback 降級」這個情境,無法驗證 S-24 描述的「fallback 繞過人工確認閘」是否已修/是否會回歸 |

---

## 2. 對 00-discussion-taskcards.md 計費群組發現的逐一比對

| 發現 | 一句話 | 測試現況(本輪查證) |
|---|---|---|
| **B-01** | ~20 條 async 生成失敗保證扣款不退款 | **untested**。`server/routers/proStudio.ts` 全檔無對應 `*.test.ts`。唯一鄰近的 `aidv-620-suno-orphan-refund.test.ts` 明確聲明範圍僅限「`createBackgroundJob` 失敗」這個孤兒點數子案例,且註解本身承認「其餘 30 處呼叫點都是同步 submit 失敗保護,不在本卡範圍」——完成期(webhook FAILED / TIMEOUT)分支的退款邏輯完全沒有回歸測試。 |
| **B-02** | 記帳分裂,無單一真相源 | 未逐檔深挖(超出本輪聚焦的 9 個發現),`server/services/cost/ledger.test.ts`(471 行)有測 ledger 雙分錄/冪等機制本身,但未驗證「`remainingGenerations` 漂移時能否用 ledger 重建」這個 B-02 的核心主張。標**需再查**。 |
| **B-03** | ai.chat/orb 生成結構上無法扣點(dispatch* 無 userId) | **untested**。`server/routers/ai.ts` 全檔查無 `deductUserPoints`/`chargeForFalTask`,亦無任何測試斷言 ai.chat 應/不應扣點。`orbCostGuards.test.ts` 測的是「呼叫 Perplexity/Brave 節流時帶 userId」(H2)與「per-user 20RPM 限流」(H4),與「扣點」是不同機制,不能視為 B-03 的覆蓋。 |
| **B-16** | models.ts 四個訓練/生成 mutation 零限流零計費 | **untested**(僅測輸入驗證)。`server/phase3-audit.test.ts:38-61` 只測 `captionImages` 的 auth 拒絕與 enum 驗證,`retrain`/`create`/`autofillAngles` 連這層都沒有專門測試。限流與計費斷言全缺。 |
| **B-19** | submitStudioJob 從不寫 costPoints→失敗退款保證 no-op | **untested,且被反向釘死**。見上表 #5;`refundStatus.test.ts:63-72` 把「無 costPoints → none」當正確推導,`aidv-771-orphan-refund.test.ts:95-118` 明確把 submitStudioJob 排除在計費站點清單之外。 |
| **B-22** | orbCostGuard/orbBudgetGuard 資料源對主流量結構性失明 | **partial**。`orbCostGuards.test.ts` 測了 guard 本身的純函式邏輯與「有掛在 ai.chat/director.chat 上」的接線 invariant,但沒有測試檢查這兩個守衛的成本資料源是否涵蓋圖片/影片/訓練等直接生成端點——這正是發現的核心主張,資料源盲區本身零測試。 |
| **B-27** | profile.updateQuotaJson 讓任何登入者自設 remainingGenerations | **untested,且被反向釘死**。`server/routers/profile.ts` 本身無專屬測試檔;僅存在於 `phase2.test.ts`/`phase3-audit.test.ts` 的路由總測試中,且這些測試明確斷言「合法輸入(如 image:10)由一般使用者呼叫應該成功」,未測任何上限或角色限制。修此洞需同步修改這兩處既有測試。 |
| **B-31** | refund 吞錯不 throw,補償旗標成死碼 | **partial,根因處被反向釘死**。旗標寫入邏輯(`postGenActions.ts`/`director.ts` 的 catch 內容)有 source-invariant 測試(`refundStatus.test.ts:400-497`)、消費端(`deriveJobRefundStatus`)有完整純函式矩陣測試,但根因(`db.ts` 的 `refundUserPoints`/`refundUserQuota` 從不 rethrow)本身被 `atomic-deduction.test.ts:71-75` 的「should not throw when DB is unavailable」契約測試鎖住——這個契約沒有區分「DB 不存在」與「DB 存在但 transaction 失敗」兩種情境,而 B-31 描述的正是後者。實測驗證:`db.ts:915-920`/`:790-795` 的 catch 塊只有 `console.error`,無 rethrow,呼叫端的補償邏輯確實無法觸發。 |
| **B-32** | Stripe webhook 五個 handler 全是 console.log stub | **untested**。`stripeWebhook.test.ts` 全檔只測簽章驗證/replay/fail-open-closed,測試註解本身承認驗的是「stub log」,從未斷言任何 entitlement 邏輯生效。 |
| **X3(定價)** | 21 條缺 `freeSecondsInBase` 雙重計費(9 個 live 模型受影響)/ costAnalytics 對 invokeLLM 主流量結構性失明 / catalog↔dispatcher 不同步僅退回 5pts | **partial**。雙重計費公式機制本身有正向回歸測試(`model-pricing-estimate.test.ts`),但 9 個受影響 live 模型不在測試清單內;`costAnalytics.ts` 純函式邏輯測試完整但資料來源(`invokeLLM` 從不寫 `ai_usage_events`,實測驗證於 `server/_core/llm.ts`)零測試;catalog↔dispatcher 一致性僅影片類別有 CI(`videoCatalogConsistency.test.ts`),音訊/3D/訓練/reasoning 全無等效測試,與 X0/X3 文件描述完全一致。 |

---

## 3. 已有良好測試(negative results,避免誇大問題)

以下路徑經查證**確實有紮實的回歸測試**,修改時有測試網接住,列出以免報告失焦、誤導成「全站計費都沒測試」:

1. **`deductUserPoints`/`refundUserPoints` 原子性(SELECT...FOR UPDATE)** — `server/atomic-deduction.test.ts:276-299` 直接斷言原始碼含 `FOR UPDATE`/`currentCredits < toDeduct` 等關鍵不變量;`:165-215` 有 tRPC 層級的成功/失敗模擬測試。
2. **`atomicClaimJobRefund` CAS 冪等 + 並發安全** — `server/services/postGenActions.refund.test.ts:103-148` 用 `Promise.all` 模擬兩條、三條並發失敗路徑同時打同一 job,驗證 `refundUserPoints` 只呼叫一次。
3. **`deriveJobRefundStatus` 純函式矩陣** — `server/services/refundStatus.test.ts` 全檔(587 行)覆蓋 none/not_refunded/partial/full 全狀態、超退 clamp、字串型別旗標、浮點漂移收斂等邊角,是本次稽核中覆蓋密度最高的計費測試檔之一。
4. **AIDV-771/AIDV-620「孤兒點數」守衛** — `server/aidv-771-orphan-refund.test.ts`(generate.ts 同步/非同步 + director.ts)、`server/aidv-620-suno-orphan-refund.test.ts`(proStudio.ts generateMusicSuno)用原始碼結構不變量守住「扣點 → try → createBackgroundJob → catch → 退款 → rethrow」順序,這是與 B-01 相鄰但範圍不同的子問題,已有良好覆蓋。
5. **Stripe webhook 簽章驗證層** — `stripeWebhook.test.ts` 對 HMAC 簽章、時間戳 replay 防護、密鑰未設時 fail-open/fail-closed 切換有完整且精確的測試(9 個案例),這一層本身是健康的,問題只在 handler 內容(B-32)。
6. **`decideBudget` 預算判斷純函式** — `orbCostGuards.test.ts:195-249` 完整覆蓋邊界(=/<lt;/>/0/負數預算)。
7. **`model-pricing-estimate.test.ts` 的雙重計費防護機制本身** — 對已列入測試清單的模型(stable-audio/kling/ace-step/elevenlabs 系列),baseline 免費時長與溢收公式的計算正確性有回歸保障。
8. **影片類別 catalog↔dispatcher 一致性** — `videoCatalogConsistency.test.ts` 對影片模態的 SSOT 一致性有完整 CI 守門,漂移會立即被抓到(僅範圍侷限於影片,如 §1 #12 所述)。
9. **`agentToolExecutor` 的 requireConfirmation(直接路徑)** — `agent-tool-executor.test.ts:32-60` 正確驗證未核准的高風險工具呼叫被擋下;`allowlist`/origin 檢查(NODE_ENV 分支、dev localhost 自動放行等)有全面測試,只是尚未組合 fallback 降級情境(見 §1 #13)。

---

## 4. 建議補的回歸測試(優先序,對照發現)

1. **B-31(帳目說謊,P0)**:在 `server/atomic-deduction.test.ts` 新增「DB 存在但 transaction 內部拋錯」情境(用 mock transaction 讓 `db.transaction` 的 callback 內 reject),驗證修復後 `refundUserPoints`/`refundUserQuota` **應該 rethrow**;同時更新現有「should not throw when DB is unavailable」測試,拆分成「無 DB → 不 throw」與「有 DB 但失敗 → 應 throw」兩個獨立案例,避免修復被既有契約測試擋下。
2. **B-27(免費無限點數,P0)**:在 `profile.updateQuotaJson` 補「一般使用者呼叫上限值(如 9e6)應被拒絕或不得寫入 `remainingGenerations`」的測試,並視最終決策(admin-only 或移除寫入能力)同步修改 `phase2.test.ts:315-326`/`phase3-audit.test.ts:308-332` 目前釘死「一般使用者合法輸入應成功」的斷言。
3. **B-32(收款無效果,P0)**:在 `stripeWebhook.test.ts` 或新檔補「`checkout.session.completed`/`invoice.paid` 觸發後,`userSubscriptions`(或等價 entitlement 表)應被寫入/更新」的整合測試,取代目前只驗證「log 字串含 handler 名稱」的弱斷言。
4. **B-01(P0)**:為 `proStudio.ts` 補一個測試檔,至少覆蓋 `checkAudioStatus` 的 `TIMEOUT`/`FAILED` 分支應呼叫 `refundJobIfBilled`(比照 `webhookFal.test.ts:205-232` 對 `refundJobIfBilledMock` 的斷言方式),涵蓋 textToMusic/TTS/voice-clone/demucs/dubbing/avatar 等至少一個代表性 modality。
5. **B-19(P0)**:先決定 submitStudioJob 是否該寫 `costPoints`;若修,需同步更新 `refundStatus.test.ts:63-72` 的期望值,並新增「submitStudioJob 建立的 job 完成期失敗 → 實際退款」的端到端測試。
6. **B-16(P0)**:為 `models.ts` 的 `create`/`retrain`/`captionImages`/`autofillAngles` 補限流與扣點斷言(目前只有 auth/schema 驗證),比照 `atomic-deduction.test.ts` 的 tRPC 層模擬手法。
7. **B-22(P0)**:補一個測試驗證 `enforceMonthlyBudgetGate`/`checkRetryChainCost` 的成本資料源是否涵蓋圖片/影片/訓練直接生成端點(目前只驗證接線在 ai.chat/director.chat 上,資料源盲區完全沒測)。
8. **X3(C1,定價雙重計費)**:把 X3 點名的 9 個受影響 live 模型(如 `fal-ai/wan/v2.1/video-to-video`)加入 `model-pricing-estimate.test.ts` 的測試清單,鎖住 `freeSecondsInBase` 補齊後的正確計費值。
9. **X3(C2,invokeLLM 成本黑洞)**:補一個測試驗證 `invokeLLM` 出口(或其呼叫端)應該把成本寫回 `ai_usage_events`/`cost_ledger`(目前完全沒有測試涵蓋這條資料流)。
10. **X3(H3,跨模態 catalog 一致性)**:仿照 `videoCatalogConsistency.test.ts`,建一份涵蓋音訊/3D/訓練/reasoning 的跨模態 catalog↔dispatcher 一致性測試。
11. **S-24(agentToolExecutor fallback 繞過確認閘)**:在 `agent-tool-executor.test.ts` 補「主工具 `requireConfirmation:true` + fallback 降級」組合情境的測試。

---

## 5. 需再查(本輪未深入,不臆測)

- **B-02**(記帳分裂/cost_ledger 是否能重建 balance 漂移)——`ledger.test.ts` 測了機制本身但未逐行核對「重建」場景,需再查。
- **B-04/B-05/B-08/B-09/B-11/B-12/B-13/B-14/B-15/B-17/B-18/B-21/B-23〜B-30(除 B-27 外)/EH-01〜EH-06** 等計費相關子發現的測試覆蓋——本輪聚焦於任務指定的 9 個發現,未逐一查證其餘計費群組卡片的測試檔,需再查。
- **FL-01(7 個安全/計費旗標預設關)**——本質是環境變數/部署配置問題而非程式碼路徑,查無任何測試讀取 `.env.production` 或斷言旗標的生產環境預設值,是否需要專屬測試需再議。
