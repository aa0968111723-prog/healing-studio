# EH1 — 吞掉的錯誤
- 產生日期:2026-07-03
- 依據 commit:812fb6fd
- 稽核範圍:server 各 service/router 的 try/catch;找空 catch、catch 只 console.warn/log 後續行、catch 回傳預設值掩蓋失敗

> 註:啟動時工作目錄 HEAD 實際為 `0cb8a860`（812fb6fd 存在於歷史但非目前 checkout 的
> commit）。本輪掃描以目前 checkout 的原始碼為準,結論不受影響,提醒 reviewer 對照時
> 留意版本差異。

## 方法
對 `server/` 下 209 個含 `catch` 的檔案抽取所有 catch 區塊(去除 `__tests__`/`*.test.ts`),
過濾出「無 `throw`/無 `.reject(`」的區塊,再依三種模式分類人工複核:①完全空/只有註解、
②catch 內只有 `console.*`、③catch 回傳字面預設值(`null`/`[]`/`{}`/`false`/`0`/`""`)。
逐一開檔讀上下文判斷是否為「刻意設計的降級/驗證回傳」還是「吞掉真失敗、上游誤以為成功」。

---

## 發現(依嚴重度排序)

### 1〔CRITICAL｜false-success + swallowed-error〕生成完成後寫入資產庫/歷史失敗完全零紀錄,且完成旗標照設,永不重試
- **檔案**:`server/services/postGenActions.ts:351-396`(資產庫,catch 於 393-395)、`server/services/postGenActions.ts:398-429`(生成歷史,catch 於 426-428)、`server/services/postGenActions.ts:494-560`(`runPostGenForJob`)
- **失敗情境**:`doPostGenComplete()` 在 `resultUrl` 存在時呼叫 `db.createDigitalAsset(...)`(第 353 行)寫入「數位資產庫」。若這次 DB 寫入失敗(逾時、連線瞬斷、鎖等待逾時等暫時性錯誤),第 393-395 行的 `catch { // 靜默忽略 }` 完全吞掉——**連一行 `console.*` 都沒有**(對照同檔其餘步驟,這是全檔案唯一完全沒有 log 的 catch)。`doPostGenComplete` 不會 rethrow,呼叫端 `runPostGenForJob`(第 537-560 行)在它之後無條件把 `resultJson.postGenComplete=true` 寫回 DB(第 554 行),即使前面的資產庫寫入早已失敗。
- **被吞後的壞狀態**:使用者的 ImageStudio/VideoStudio/ProStudio 生成明明成功(`backgroundJob.status=completed`,前端顯示完成),但該筆生成**不會出現在「我的資產庫」**,`generation_history`(第 398-429 行,catch 同樣零 log)也可能同時漏寫。因為 `postGenComplete` 旗標已設為 true,`webhookFal`/`checkStudioJob` 之後任何重跑都會被冪等檢查短路(第 499 行 `if (meta.postGenComplete === true) return false;`)——**沒有第二次機會,永久漏帳,且伺服器日誌裡連一條線索都留不下**。這正是此檔案 header 註解(第 9-12 行)描述「資產庫永遠是空的」曾經修過的同一個 bug,現在以「靜默」的方式可能重新發生。
- **建議**:① 為每個內部寫入步驟的 catch 至少補 `console.error` 並帶 jobId/userId,方便事後排查;② `postGenComplete` 旗標應區分「完全成功」vs「部分失敗」(例如另加 `postGenPartialFailure` 欄位),失敗時允許背景任務重試而非永久短路;③ 針對資產庫/歷史寫入失敗建立告警(非僅 log)。

### 2〔CRITICAL｜false-success〕Stripe Webhook 事件處理器全為 stub,且先回 200 才處理,錯誤只 console.error
- **檔案**:`server/routes/stripeWebhook.ts:168-256`(五個 handler 全為 TODO stub)、`:278-324`(先 `res.status(200)` 再處理,catch 於 321-323)
- **失敗情境**:`handleCheckoutSessionCompleted`/`handleInvoicePaid`/`handleInvoicePaymentFailed`/`handleSubscriptionUpdated`/`handleSubscriptionDeleted`(第 168-256 行)目前**只 `console.log`,函式體其餘皆是 `// TODO: 實作...`**,沒有任何寫入 `userSubscriptions` 或解鎖功能的邏輯。同時端點在驗完簽章後立即 `res.status(200).json({received:true})`(第 279 行),之後才進 `try{...}catch(err){console.error(...)}`(第 281-323 行)處理事件——一旦未來把真正邏輯填進這些 handler,任何處理錯誤都會被這個 catch 吞掉,只留一行 console.error,而 Stripe 因為已經收到 200 不會重試。
- **被吞後的壞狀態**:**現況**——使用者完成 Stripe 付款,系統回應 Stripe「已接收」,但完全沒有任何 entitlement/訂閱狀態被建立或更新;`invoice.payment_failed`/`customer.subscription.deleted` 同樣不會降級或停權。若前端有任何「已付款即解鎖」的 UI 邏輯依賴這條 webhook,使用者會看到「付款成功」但功能沒解鎖,或反過來訂閱早已取消/扣款失敗但系統仍認為使用者有效——這是典型的「回報成功、系統實際沒做事」。**日後補上真實邏輯後**,任何處理期間的錯誤(DB 寫入失敗等)一樣會被靜默吞掉且 Stripe 不會重試,問題會複製到「3」的模式。
- **建議**:① 補齊 entitlement 邏輯前,對外部/財務稽核應明確標示此端點「尚未生效」,避免誤以為訂閱系統已上線;② 未來實作時比照下面第 3 項建議,對 200 之後的處理失敗要有補償/重試/告警機制,不能只 console.error。

### 3〔HIGH｜false-success + lost-error-context〕Fal/Replicate/Suno webhook 統一採「先回 200、後處理、catch 只 console.error」,DB 寫入失敗即無告警且供應商不再重試
- **檔案**:`server/routes/webhookFal.ts:166-361`(ack 於 166,catch 於 359-361)、`server/routes/webhookReplicate.ts:73-183`(ack 於 73,catch 於 180-182)、`server/routes/webhookSuno.ts:133-283`(ack 於 133,catch 於 279-280)
- **失敗情境**:三支 webhook 都在驗證通過後**先送出 `res.status(200).json({received:true})`**,再進 `try{...}` 執行 `updateBackgroundJob(...)`/`updateFineTunedModel(...)`/`runPostGenForJob(...)`/`refundJobIfBilled(...)` 等關鍵寫入。任何一步在此期間拋錯(例如 DB 連線暫時失敗),都會落到最外層 `catch(err){ console.error(...) }`,**沒有任何重試、補償或告警**;而供應商(fal.ai/Replicate/Suno)因為已經收到 2xx 不會重送這個事件。
- **被吞後的壞狀態**:供應商端任務其實已完成(或失敗),但本地 `backgroundJobs`/`fineTunedModels` 狀態沒更新成功——使用者畫面卡在「生成中/訓練中」;若失敗發生在 `webhookFal.ts` 的 completed 分支(第 288-303 行 `updateBackgroundJob`→`runPostGenForJob`)之間,資產庫寫入與退款判斷都不會執行。部份工作室仍有 5 秒輪詢(`checkStudioJob`)作為備援,可能自行追上狀態,但這條回補路徑**是否對所有 studio/所有訓練流程都存在、多快能追上,需執行期驗證**——目前找不到程式碼保證每條路徑都有輪詢備援(尤其 LoRA/Fal 訓練走 webhook-only)。
- **建議**:① 200 之前完成的關鍵寫入盡量提前(認證通過後、ack 前先寫,只有非關鍵的下游動作延後);② 對「ack 後處理失敗」建立監控告警(不只 console.error);③ 確認並文件化每條 studio/訓練流程是否都有輪詢備援可自我修復。

### 4〔HIGH｜lost-error-context,涉及金流〕退款失敗且補寫審計旗標也失敗時,完全沒有可查的持久化紀錄
- **檔案**:`server/services/postGenActions.ts:596-616`(`refundJobIfBilled`,外層 catch 於 599,內層 catch 於 611-613)
- **失敗情境**:使用者已被扣點的任務失敗,`refundJobIfBilled` 先 CAS 搶鎖(第 594 行)避免重複退款,再呼叫 `db.refundUserPoints(...)`(第 598 行)。若退款寫入本身失敗,程式在第 601-604 行印一行 `console.error`,並嘗試在第 610 行寫入 `refundRestoreFailed:true` 供事後人工稽核——但**這次補救寫入本身又包在 `catch { // 靜默忽略 }`(第 611-613 行)**,若它也失敗,系統裡**沒有任何持久化紀錄**指出「這個使用者被扣了點數但沒退成功」,唯一線索是那行可能被日誌輪替沖掉的 console.error。
- **被吞後的壞狀態**:使用者被扣款(點數/金錢等價物)卻拿不到成品也拿不回點數,且系統本身認為「已搶到退款鎖」(refunded 旗標為 true 或至少已標記處理過),`deriveJobRefundStatus` 可能因缺少 `refundRestoreFailed` 旗標而誤判為「已退款」,客服申訴時完全查無實據。
- **建議**:雙重失敗時應寫入一個獨立、不依賴同一次交易的告警管道(例如寫死一筆到專門的 `refund_failures` 表或觸發外部告警),不能讓兩層都用同一種「靜默 catch」互為備援。

### 5〔MEDIUM｜swallowed-error,呼應已知 loraTrainer 問題但為不同位置〕訓練失敗時「標記為 failed」本身失敗,狀態永久卡住且零紀錄
- **檔案**:`server/services/loraTrainer.ts:380-392`(catch 於 380,內層 `.catch(() => {})` 於 385)、`server/services/falTrainer.ts:422-432`(`.catch(() => {})` 於 426)、`server/subsystems/trainingTrack/trainingTrackService.ts:243-247`(`.catch(() => {})` 於 244)
- **失敗情境**:三處都是「訓練流程整體異常」的最外層 catch,嘗試呼叫 `updateFineTunedModel(modelId, {status:"failed"})` 把模型標成失敗,但這個呼叫本身包了 `.catch(() => {})`。若這次「標記失敗」的 DB 寫入也失敗(例如同一波 DB 抖動導致原始錯誤與這次補救都失敗),**沒有任何額外 log** 記下「連標記失敗都失敗了」。
- **被吞後的壞狀態**:模型列在 DB 中的 `status` 停留在寫入失敗前的狀態(通常是 `training`/`pending`),使用者的「我的模型」頁面永遠顯示訓練中,不會被之後任何流程清理(除非有獨立的逾時掃描 job)。與已知的「loraTrainer Step4 失敗遺失 trainingId」為相鄰但不同的缺口:那個是「輪詢中途丟失 trainingId 導致追蹤斷線」,這裡是「連最後一道保險（標記失敗）都可能悄悄失效」。
- **建議**:最後一道 `updateFineTunedModel` 失敗時至少 `console.error` 留痕,並讓背景巡檢 job(如有)能掃到「長時間停在 training 且無對應活躍任務」的記錄並修正。

### 6〔MEDIUM｜swallowed-error〕doPostGenComplete 內多個子步驟(去重更新/提示詞關聯/監控日誌/推薦回填)全數零 log 靜默失敗
- **檔案**:`server/services/postGenActions.ts:138-145`(useCount 累計)、`:383-391`(prompt↔asset 關聯)、`:432-444`(AI 監控室)、`:452-464`(推薦模型接受度回填)
- **失敗情境**:這幾處的 catch 內註解明確寫「靜默忽略」(第 344、390、443 行等),且**沒有搭配任何 `console.*`**——與同檔案第 476-481 行的媒體歸檔失敗好歹有 `console.warn` 形成對比。
- **被吞後的壞狀態**:個別影響較小(useCount 統計失真、prompt↔asset 關聯遺漏、AI 監控室漏記、模型推薦權重回填失敗),但因為完全沒有 log,長期而言這些子系統的資料完整性會緩慢劣化且無法追蹤成因,只能靠使用者反映「怎麼提示詞庫用量看起來不對」之類的間接症狀才會被發現。
- **建議**:比照第 476 行的寫法,至少補 `console.warn` 並帶關鍵 id,方便日後排查資料漂移的源頭。

### 7〔LOW｜需執行期驗證〕computeBalance 對 DB 錯誤回傳 0,目前無正式呼叫端但為高風險模式
- **檔案**:`server/services/cost/ledger.ts:485-507`
- **失敗情境**:`computeBalance` 在 DB 查詢失敗時 `catch { return 0; }`(第 504-506 行),函式註解甚至明講「永不 throw」是設計决定。
- **被吞後的壞狀態**:目前搜尋全庫,`computeBalance` 除了 `ledger.test.ts` 外**沒有任何生產程式碼呼叫它**(需執行期驗證是否有計畫中但尚未接線的呼叫點,或未來會接上某個餘額查詢/放行判斷)。若日後被接到「餘額足夠才放行」這類判斷,DB 暫時故障時回 0 可能造成誤判(fail-closed 擋下正常使用者,或若邏輯相反則 fail-open 讓沒有真實餘額判斷的操作通過)——目前無法從現有呼叫點判斷方向,列為低嚴重度、待接線時重新評估。
- **建議**:若之後要接線使用,呼叫端應能區分「真的餘額是 0」與「查詢失敗退回的 0」,避免對兩種語意混用。

---

## 已正確處理錯誤(negative results)

- **`server/services/assetCleanupService.ts:75-101`(`runAssetCleanup`)**:單筆資產清理失敗時 `catch { result.errors++; }`,錯誤被計數並回傳在 `AssetCleanupResult.errors` 給呼叫端,不是完全吞掉;且刪除物件本身具冪等性(不存在不算錯),搭配下一輪 cron 重試,屬於合理的「盡力而為＋可觀測」設計。
- **`server/db.ts:438-493`(`upsertUser`)**:真正的 DB 寫入錯誤在第 489-492 行 `console.error` 之後仍 `throw error` 向上拋,不會被隱藏;只有「完全沒有配置 DB」(demo/無 `DATABASE_URL`)的分支(第 441-444 行)才靜默返回,這是全庫一致採用、且在多處註解明講的 demo-mode 慣例,非個案疏漏。
- **`server/services/orbCostGuard.ts`**:整份檔案掃描不到任何吞錯的 catch,扣點/回沖點數的錯誤會如常傳播給呼叫端處理。
- **`server/services/audit/auditLog.ts:99-127`(`writeAuditEvent`)**:catch 內確有 `console.warn` 記下失敗的 action/target(非空 catch),且此「best-effort 永不影響主流程」是檔案開頭大段註解明講的刻意設計決策,不是意外遺漏;唯一缺口是「無告警管道」,已在稽核範圍外的既有已知問題中隱含,此處不重複計分,僅在此註記其設計是有意為之。
- **`server/routes/webhookReplicate.ts:105-120` 的終態守門**:已完成/已失敗的模型收到遲到或重複的 webhook 會被明確短路並記 log(而非誤覆寫),避免了「重複終態覆寫」這類次生問題。
