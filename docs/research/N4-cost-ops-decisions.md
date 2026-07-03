# N4 — 成本/商業/營運決策卡(決策提議 wave N)

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 定位:**決策提議 wave N**——不做研究,只把 A-cost-integrations.md、H1-model-costs.md、B-infra.md、G4-misc-audit.md、00-summary.md §4 已查到的架構事實,轉成可拍板的決策卡。本文件不新增程式碼證據,僅整理引用(檔案:行號一律回原文件查);不編造任何未在 repo 出現過的數字。
- 讀法:每張卡「依據」欄一律標注 **[架構推估]**(從程式碼結構/計價表推導出的量級與方向,尚未對過真帳單)或 **[需實測]**(判斷正確與否依賴 §7 待補的外部數字)。

---

## 決策卡 1:大腦 5 slot 預設模型檔次(最大 LLM 成本槓桿)

**決策點**:`user_ai_brain` 五個推理槽(director/analyst/storyteller/technician/curator)中 **4 個預設 `anthropic/claude-opus-4.7`**——是否把預設降到 Sonnet/Haiku 檔?哪些槽該保留 Opus?

**依據**(H1 §2.1、§2.2;A §2.3):
- `drizzle/schema.ts:1337-1415` 四槽(director/storyteller/technician/curator)預設值皆為 `anthropic/claude-opus-4.7`;僅 analyst 預設 `perplexity/sonar-pro`。
- 內建 USD/MTok 估價表(`_core/llm.ts:599-641`,[架構推估],僅供內部歸屬非真帳單):Opus 4.7 = $15/$75(輸入/輸出每 MTok);Sonnet 4.6 = $3/$15;Haiku 4.5 = $0.8/$4。**Opus 對 Haiku 的檔次價差約 19 倍**(H1 §2.2 算出單回合 $0.120 vs $0.0064)。
- 光球 `ai.chat` **本身不扣使用者點數**(ai.ts 無 `estimatePoints`/`deductUserPoints` 呼叫)——LLM 成本 100% 由平台吸收,只在 LangSmith 記帳,不像圖/影/音生成有 credits 擋。也就是說,這個槓桿沒有使用者側的自然煞車。
- 長對話(輸入 10k tok 含歷史)Opus 每回合 ≈ $0.225;H1 估算「重度使用者一天 50 回合 ≈ $11」([架構推估],假設輸入 3k/輸出 1k tok,實際 token 量隨對話長度浮動)。

**選項**:
- (a) 全面降檔:5 槽全改 Sonnet 或 Haiku 級,Opus 只留作使用者手動切換選項。
- (b) 分槽降檔:依用途留 Opus——例如 director/storyteller(需要創意品質、長篇故事編排)留 Opus 或 Sonnet;technician/curator(較機械性的任務:技術檢查、資料整理)降到 Haiku。
- (c) 不動預設值,改用 `PREFER_CHEAP_MODELS`(economy/balanced/premium,.env.example)全域旗標做粗粒度切換。
- (d) 維持現狀,只加強告警(見決策卡 5)。

**建議**:(b) 分槽降檔為優先——technician(技師,溫度 0.2,偏工具性任務)、curator(策展人)兩槽先降到 Sonnet 或 Haiku,對「品質敏感度」影響最小;director/storyteller 涉及使用者直接感知的敘事/創意品質,建議先降到 Sonnet(而非直接 Haiku),搭配使用者可手動升級到 Opus 的入口(pricing 頁已有 `credits.pricingCatalog` 公開目錄可支撐這個 UI)。哪個槽該留 Opus 最終仍需要**實際 A/B 或人工品質抽測**,不能只憑架構判斷——本卡的降檔建議是「先降最不敏感的兩槽,觀察品質回饋」,不是「全面一次降到底」。

**省多少(量級)**:[架構推估] 若把 4 個 Opus 槽全降到 Sonnet 檔,單回合估價從 $0.120 降到 $0.024(降幅約 80%);全降到 Haiku 則降到 $0.0064(降幅約 95%,H1 §2.2)。**這是內建估價表口徑,不是真帳單**——實際 OpenRouter/Anthropic 帳單降幅需按對話量與槽位分佈實測(見卡 7)。

**需要 Bruce 拍板/提供的**:
- 拍板:5 槽分別要哪個檔次(全降 vs 分槽降),以及是否要保留使用者手動切 Opus 的入口。
- 提供:目前 OpenRouter/Anthropic 帳單能否按 model 拆分光球用量?若能,可先看 4 槽的實際 token 分佈再決定降檔幅度,而非先降再看。

---

## 決策卡 2:LLM_CACHE 擴面

**決策點**:`LLM_CACHE` 旗標預設 ON,但全站僅 2 處標 `cacheable:true`(`orbContextLookup.ts:153`、`orbClarificationEngine`)——要擴大到哪些呼叫點?

**依據**(A §2.3、§5.1 第 5 項;[架構推估]):
- 快取基礎設施(`llm.ts:1649-1652,1888`)已存在且預設開,只是覆蓋面窄,屬於「已寫好、沒接上」的低成本延伸,不需要新架構。
- 候選加點:站內知識查詢(learnHub 問答)、模型目錄問答(`aiModels`/`models.ts` 常見問句)、`evaluate.ts` 的 prompt-judge 同題重評(H1/A 都提到 eval 是真燒 LLM 的重複呼叫)、光球周邊的 `orbLLMReplan`/`orbVoiceProcessor`/`orbGuide`(A §2.3 列出這幾處目前未快取)。

**選項**:
- (a) 只加「確定性高、答案穩定」的呼叫點(站內知識查詢、模型目錄問答)——低風險。
- (b) 連同 `evaluate.ts` prompt-judge、eval runner 一起加快取,順便降低 CI/本地跑 eval 的真實花費(卡 6 提到 eval 是真 token 燒)。
- (c) 全部光球周邊呼叫都加(風險:orbLLMReplan/orbGuide 涉及對話狀態,快取鍵設計不慎會回覆錯誤上下文)。

**建議**:(a)+(b)。優先加開放性最低、重複率最高的兩類(知識查詢、eval 同題重評),風險最低但可能是重複命中率最高的兩類;(c)先不做,因為對話類呼叫的快取鍵(cache key)需要把完整對話上下文/使用者狀態都納入,設計不慎會導致回覆串話,值得另開一張卡評估快取鍵設計後再做。

**省多少(量級)**:[架構推估] 重複問答(相同站內知識問句、相同模型目錄查詢)零成本命中,但目前無法從 repo 估算「重複率」——這是全站流量模式決定的,需要實測(卡 7)。可以確定的是:方向必然是淨省,且擴面本身零基礎建設成本(旗標已存在)。

**需要 Bruce 拍板/提供的**:
- 拍板:是否連 eval prompt-judge 一起加快取(會影響 eval 結果的「新鮮度」,需確認 eval 目的是回歸測試還是即時品質檢查)。
- 提供:目前有無 API 呼叫的問句重複率數據(如 admin「API 用量」頁能否按 prompt 內容分組)?若無,此決策只能先做再觀察效果,無法先算 ROI。

---

## 決策卡 3:導演批次放大器 + budget/quota guard

**決策點**:`director.autoGenerateFromSegments` 一鍵可觸發上百筆 fal 任務(60 段 storyboard × 全模態),而 `ENABLE_ORB_QUOTA_GUARD`/`ENABLE_ORB_BUDGET_GUARD`/`ENABLE_ORB_IDEMPOTENCY_GUARD` **預設 OFF**——開哪些 guard?配額政策怎麼定(現行 `orbQuota.ts:29` 40 次/天/人,記憶體版;Supabase `creator_job_throttle` 20 tasks/hr)?

**依據**(A §2.6、§3.4;H1 §4 導演批次表;[架構推估]):
- H1 算出:60 段全模態一鍵預設引擎組合 ≈ **3,900 pts ≈ $39.0**(用內建計費表估,非真帳單);若勾 `useImageAsFirstFrame` 改用 i2v 引擎 ≈ **4,260 pts ≈ $42.6**;若段長 10 秒 ≈ **6,840 pts ≈ $68**。這是「單次點擊」的量級,不是月費。
- 這個 mutation **只預檢餘額,不即時扣點**(director.ts:2384-2402);實際扣點發生在逐任務派工時。也就是說,預檢通過後,60 段全模態的任務會真的被排入佇列逐一執行、逐一扣點——沒有一個「總開關」能在中途因為預算超標而攔下整批。
- 點數不對應真錢(Stripe 未啟用,A §3.4)——現行 40 次/天配額是「內部限流」而非「成本回收」,超支風險完全由平台吸收。
- 三個 guard 都已寫好、都是旗標即可開,無需新開發(A §2.6、§5.1 第 7 項)。

**選項**:
- (a) 三個 guard 全開(quota + budget + idempotency),搭配 `AI_MONTHLY_BUDGET_USD`(預設 500,`apiUsageAlertJob.ts:255`)校準到實際團隊規模。
- (b) 只開 budget guard(防單月超支),quota/idempotency 維持 OFF——風險是短時間內單一使用者仍可能重複送出同一批次(idempotency 沒開)造成重複扣點/重複產出。
- (c) 全部維持 OFF,只靠現有 15 分鐘 Slack 告警(`apiUsageAlertJob.ts`,被動、事後)。

**建議**:(a)。三個 guard 都是「已存在、無需開發」的低風險開關,現況（c）是「有告警無防線」——Slack 告警只能在超支後通知,無法阻止批次繼續執行。budget guard 尤其該優先開,因為它直接對應「單次點擊 $39-68」這種尖峰事件的防線;idempotency guard 則是防止使用者因網路重試/雙擊而重複觸發整批。

**配額政策怎麼定**:現行 40 次/天/人是「生成次數」配額,不是「金額」配額——對圖片生成(每次 $0.01-0.05)和批次導演生成(單次可達 $39-68)一視同仁地算「1 次」,配額設計與實際成本量級脫節。建議把配額政策從「次數」改為「當日已花點數上限」,或至少對批次生成類操作(`autoGenerateFromSegments`)另訂更低的「批次次數/天」上限,而非與單張圖生成共用同一個 40 次額度。**這是政策設計問題,而非單純開關**,需要 Bruce 定調團隊每人每日可接受的成本上限量級。

**省多少/花多少(量級)**:[架構推估] 開 guard 本身不省錢,是「防止尖峰失控」的保險——省下的是「沒設防線時,一次誤觸發/重複點擊造成的 $39-68 級尖峰意外支出」,量級取決於配額上限怎麼定。

**需要 Bruce 拍板/提供的**:
- 拍板:`AI_MONTHLY_BUDGET_USD` 設多少(現預設 500,是否符合團隊規模);配額政策是否改成「金額制」而非「次數制」。
- 提供:目前 40 次/天配額的實際命中率(A §4.9 已列為待補)——若命中率很低,代表配額形同虛設,調整優先度可以往後放;若命中率高,代表使用者已經在頂配額,調整需要更謹慎溝通。

---

## 決策卡 4:cron 白燒止血

**決策點**:`braveLearnFetcher`/`learnDocSyncer` 的 LLM 產出只進記憶體、重啟即丟;`apiHealthMonitor` 每日 ≈120 次付費 Gemini 精準度抽測——哪些 cron 該降頻/落 DB/關閉?

**依據**(A §2.1 cron baseline 表;[架構推估],量級來自程式碼常數,非帳單):
- `apiHealthMonitor.ts:69-72` + `brainAutoRepair.ts:2468-2545`:每 20 tick(約 60 分鐘)跑一輪 5 次真 Gemini `generateContent`(≤256 output tokens/次),24 小時共約 **120 次**付費呼叫;此間隔雖可經 admin API 調整,但**只存在記憶體,重啟即歸零回 3 分鐘週期**(apiHealthMonitor.ts:80,247)——調整不持久是這個問題的核心,不只是頻率設太高。
- `braveLearnFetcher.ts`(每日 04:00,10 固定主題 × Brave Search + LLM 整理)與 `learnDocSyncer.ts`(週一 03:00,近 7 天新聞 → Gemini 合成 ≤3 篇)兩支的產出**只寫進記憶體陣列**,重啟(部署/健檢重啟)即消失——這代表花掉的 LLM/Search 呼叫費完全沒有留下對應的持久價值,是「可完全避免的浪費」而非「線性隨用量」的正常支出。
- `modelCatalogResearchJob` 已有先例:2026-05 已從「每日 64 模型全驗」降為 stale-only,且提供 `DISABLE_MODEL_RESEARCH_CRON=1` 整支關閉、`MODEL_RESEARCH_CRON_SCHEDULE` 可覆寫排程——同樣的治理模式可套用到另外兩支。

**選項**:
- (a) 先讓 braveLearnFetcher/learnDocSyncer 的產出落 DB(接進既有 `learn_modules`/類似結構),讓已花的錢至少換到持久價值,再視內容使用率決定是否降頻。
- (b) 在落 DB 之前,先直接降頻或暫停這兩支(反正產出重啟就丟,現在等於白燒),等有資源接 DB 落地後再恢復。
- (c) apiHealthMonitor 精準度抽測:把間隔從約 60 分鐘拉長到 6-24 小時一輪,並且讓這個間隔設定持久化(寫 DB/env 而非純記憶體),避免每次重啟就打回預設。

**建議**:(b)+(c)。braveLearnFetcher/learnDocSyncer 兩支「先停或降頻,等落 DB 後再開」邏輯最直接——目前的錢是在買一個會被重啟清空的東西,沒有立即恢復的急迫性;(c)是最沒有爭議的一步,精準度抽測的目的(健康監控)在 6-24 小時一輪仍然能達成,且應該讓間隔設定寫進持久層而非記憶體,才能真正把「~120 次/日」降到個位數到十位數量級,而不是每次重啟又打回原狀。

**省多少(量級)**:[架構推估] apiHealthMonitor 若從約 60 分鐘一輪(相當於每日 24 輪 × 5 次 = 120 次)拉長到 6 小時一輪(每日 4 輪 × 5 次 = 20 次)或 24 小時一輪(5 次/日),付費呼叫量降至約 1/6 到 1/24;每次呼叫是 ≤256 output tokens 的 Gemini 小型呼叫,單次成本本身很低,此項省下的**絕對金額量級偏小**,主要價值是「消除持續存在的浪費」而非「大幅降低帳單」。braveLearnFetcher/learnDocSyncer 停用後省下的是「10 次 Brave 查詢 + 約 10 次 LLM 整理/日」+「週一額外 1 輪新聞合成」——同樣屬於小額但持續的浪費,量級需搭配 Brave/Gemini 實際帳單才能算出具體金額(卡 7)。

**需要 Bruce 拍板/提供的**:
- 拍板:是否認可「先停,等落 DB 再開」的順序,還是希望維持產出（即使會丟失）以保留 UI 上「有內容」的觀感。
- 拍板:精準度抽測間隔目標值(6 小時?24 小時?),以及是否值得投入把該設定改為持久化。

---

## 決策卡 5:R2 只進不出

**決策點**:Cloudflare R2 儲存無 lifecycle rule、`assetCleanupJob` 因保留政策未設而近乎空轉、`db-backups/` 每日 +1 檔不清舊——要不要設 R2 lifecycle rule?

**依據**(A §2.4;[架構推估],存量趨勢方向明確,絕對值待補):
- `dbSnapshotJob.ts:25-28`:每日 mysqldump→gzip(約 1-3MB)PUT 進 `db-backups/`,程式明確不清舊檔,註解本身承認「靠 R2 lifecycle rule」處理——也就是說這是一個**已知但尚未落地**的待辦事項,不是新發現。
- `digital_asset_library.expiresAt` 欄位已存在(0058 migration),但保留政策未實際設定 → `assetCleanupJob` 形同空轉,媒體資產存量只增不減。
- `mediaArchivalService`「雙存」機制(A §2.4):每筆生成 = 1 次下載 + 1 次 R2 寫入 + 永久存量增加,fal CDN 檔案非永久所以 R2 副本是必要的,但沒有下游清理出口。
- R2 的計費特徵是「儲存 GB-月 + Class A/B 操作次數,egress 免費」——這是本架構對媒體平台有利的紅利,但紅利只在「儲存增量可控」時才划算;無限累積會讓儲存費本身變成單調遞增的固定成本。
- `r2SnapshotJob` 每日已在收集 `r2_storage_snapshots`/`r2_object_catalog` 資料(A §4 第 5 項)——這代表「R2 現在用多少」這件事本身是可查的,只是需要去查(見卡 7)。

**選項**:
- (a) 設定兩條 lifecycle rule:`db-backups/` 保留 N 天自動刪除;`generated/`(或對應資產路徑)依 `expiresAt` 欄位邏輯設定分層/刪除。
- (b) 只先做 `db-backups/`(範圍小、風險低、明確有時間戳可判斷),資產類保留政策留給後續「熱冷分層」決策(A §5.2 第 3 項,需要存取頻率數據才能做冷儲存決策)。
- (c) 暫不設 lifecycle,先查 `r2_storage_snapshots` 現值評估急迫性。

**建議**:(b)。`db-backups/` 的保留天數判斷不需要額外數據——只要決定「N 天」即可上 lifecycle rule,這是本卡中最沒有依賴、最快能做的一步;資產類的冷熱分層涉及「使用者還會不會回來看這個資產」的判斷,需要先查 `r2_storage_snapshots`/`r2_object_catalog`(已在收集,直接查詢即可)搭配存取頻率再決定分層策略或清理政策,不建議在沒有實際 GB 數字前貿然對使用者資產設自動刪除規則(誤刪風險 > 省下的儲存費)。

**省多少(量級)**:[架構推估] `db-backups/`:1-3MB/天,若已累積數月至年,規模是 MB 到低 GB 級,R2 儲存單價本身不高,此項**絕對金額量級很小**,但屬於零風險、零依賴、可以立刻做的清理。媒體資產存量增速取決於生成量(卡 3 提到批次生成單次可達數十到上百筆),長期是**成長最快的儲存塊**,冷熱分層的潛在節省需要拿到 §7 的 R2 帳單/GB 數字才能估計量級。

**需要 Bruce 拍板/提供的**:
- 拍板:`db-backups/` 保留天數(例如 30/60/90 天)。
- 提供:`r2_storage_snapshots` 現值(bucket 總 GB、物件數趨勢)——已在 DB 裡,只是需要有人去查詢並回報,才能判斷資產類 lifecycle 的急迫性與規則設計。

---

## 決策卡 6:CodeRabbit / CI 帳單

**決策點**:CI 已恢復(GitHub Actions runner 復活,B §4.2/00-summary 提到的 runner 層問題已解);CodeRabbit 撞免費審查上限——免費版 vs $0.25/檔 usage-based vs $30/月 Pro,對 15-20 人團隊哪個划算?

**依據**([需實測] 本卡涉及的 CodeRabbit 定價與方案細節不在 repo 內,以下只能基於「已知的 PR/檔案量級」做結構性推理,不代表 CodeRabbit 官方報價;需與 CodeRabbit 官網/帳單頁核對):
- B §4.2:CI 只有唯一 workflow `pr-gate.yml`,四關(tsc/check:routes/check:navigation/vitest);未見 CodeRabbit 相關 workflow 檔案出現在本次讀過的文件中——CodeRabbit 的接線方式(GitHub App 還是 workflow)本身**待確認**,不能從已讀文件斷言。
- 00-summary/F 文件(未在本次讀取範圍內)提到 PR 數量約 89 個、其中多為殭屍 PR——若 CodeRabbit 按「每個 PR 的變更檔案數」計費(usage-based $0.25/檔),PR 數量與每個 PR 的檔案變動量是決定帳單的兩個變數,而殭屍 PR 清理(F 文件建議關閉 71 個殭屍 PR)會直接降低 usage-based 方案的帳單基數。
- 15-20 人團隊規模下,若以「每人每週開 1-2 個 PR、每 PR 平均 5-10 個檔案」估算([需實測] 這是假設情境非 repo 事實),月 PR 檔案量級可能落在數百檔,usage-based 在 PR 量大且檔案多的情況下可能超過 Pro 方案的固定 $30/月。

**選項**:
- (a) 維持免費版,但先執行 F 文件建議的殭屍 PR 清理(關閉 71 個殭屍 PR),看清理後是否還會撞到免費上限——如果不撞,不需要付費。
- (b) 升級到 usage-based($0.25/檔),適合 PR 量小但偶爾大檔案變動的團隊。
- (c) 升級到 $30/月 Pro(固定費),適合 PR 量穩定且較高頻的團隊,帳單可預測。
- (d) 停用 CodeRabbit,改為只靠 PR gate 四關 + 人工 review(現有 code-review/security-review 技能也可覆蓋部分審查需求)。

**建議**:先做 (a)——這是零成本的一步,且 00-summary 已經指出殭屍 PR 清理是流程地基的第一步(F §4、00-summary 第 0 步),清理後很可能免費額度就夠用,不需要立刻決定付費方案。若清理後仍撞上限,再依實際 PR/檔案量對比 usage-based 與 Pro 兩者的損益平衡點(找到「每月檔案數 × $0.25 = $30」的臨界點,約 120 檔/月是損益平衡參考線,[需實測] 需以 CodeRabbit 實際計費規則核實,不同方案可能有額外功能差異非純價格比較)。

**省多少/花多少(量級)**:[需實測] 本卡缺乏兩個關鍵輸入才能給出確定建議:CodeRabbit 免費額度的具體上限值(次數/月或審查行數)、以及 PR 清理後的實際月 PR/檔案量。在沒有這兩個數字前,任何具體省錢金額都是猜測,不列。

**需要 Bruce 拍板/提供的**:
- 提供:CodeRabbit 目前的方案與帳單(免費版撞的上限具體是什麼、目前每月實際審查量)。
- 提供:F 文件建議的殭屍 PR 清理是否已執行、執行後的 PR/月開啟量趨勢。
- 拍板:團隊對「自動化 code review」的必要性排序(相對於已有的 code-review/security-review 技能與人工 review)。

---

## 決策卡 7:npm 依賴漏洞(2 critical / 9 high)

**決策點**:`npm audit` 顯示 2 critical + 9 high + 23 moderate + 2 low,共 36 個漏洞——排哪些先修、怎麼排程?

**依據**(G4 §1;程式碼事實,非架構推估——這是實測執行 `npm audit --json` + `npm audit fix --dry-run` 的結果):
- **可直接 `npm audit fix`(不加 `--force`,不動 package.json 語意版本)修掉的部分**:covers protobufjs(critical,RCE,經 `@google-cloud/speech` 間接引入,prod 有載入 STT 功能,dry-run 顯示可安全升到 7.6.4)、axios(high,21 個 advisory 含 prototype-pollution、SSRF via NO_PROXY 繞過、cookie ReDoS,直接依賴且是 server 對外呼叫主力,dry-run 升 1.18.1)、ws(high,記憶體耗盡 DoS,直接依賴 WebSocket 用,dry-run 升 8.21.0)、`@grpc/grpc-js`、`fast-xml-builder`、`form-data`、`undici`(dev 限定)、頂層 `vite`——這一批共同特徵是 dry-run 已驗證在既有 semver 範圍內、無需改 package.json 版本宣告。
- **需要人工大版決策、不能一鍵 fix 的三顆**:
  - `vitest 2.1.9`(critical):漏洞是「UI server 監聽時可讀取並執行任意檔案」,但 G4 已核實 repo 的 scripts 只用 `vitest run`、從未啟動 `--ui` server,**實務暴露面低**;修復需升到 vitest 4(major),連帶修掉 vite-node 內捆的 vite 5.4.21。
  - `drizzle-orm 0.44.7`(high):**SQL injection via 未正確跳脫的 SQL identifier**,這是 prod ORM、直接依賴,102 張表都經過它——G4 判定這是「最該修的一顆」,fix 版本 0.45.2 因 0.x 語意被 npm 標記為 major,需手動改 `package.json` 版本後跑滿 610 個測試 + migration 演練(MIGRATION_FAIL_CLOSED 防線在,壞了會擋部署而非靜默壞資料,風險可控)。
  - `langsmith 0.3.87`(high):public prompt pull 反序列化不受信 manifest,G4 已核實**專案只用它做 tracing、不 pull public prompt**,實際暴露低,可考慮先手動升 `langsmith ^0.6` 而不動 `@langchain/core` 的 major。

**選項**:
- (a) 先跑一輪 `npm audit fix`(非 force)清掉可自動修的一批(protobufjs/axios/ws/grpc-js/fast-xml-builder/form-data/undici/vite),這批風險最低、覆蓋面最廣(2 個高風險直接依賴 axios/ws + 1 個 critical 間接依賴 protobufjs)。
- (b) 排一張卡手動升級 `drizzle-orm` 到 0.45.2,搭配全量測試 + migration 演練。
- (c) 排一張卡手動升 `langsmith` 到 0.6.x(先不動 `@langchain/core` major)。
- (d) 排一張卡評估 `vitest` 2→4 大版遷移(含 vite-node 內捆 vite 一併解決)。
- (e) 把 `npm audit --audit-level=high` 加進 pr-gate 或獨立 cron workflow,避免這份清單下個月就過期(G4 §1.4 第 3 點已指出 CI 目前完全沒有依賴稽核)。

**建議**:(a) 立即做——這是零風險、dry-run 已驗證的一輪修復,直接解決 1 個 critical + 2 個 high 的直接依賴風險(protobufjs 經由已在用的 `@google-cloud/speech` STT 路徑、axios 是 server 對外呼叫主力、ws 是 WebSocket 直接暴露面)。(b) 次優先——drizzle-orm 的 SQL injection 是三顆手動項裡風險最高的(prod ORM、覆蓋全部 102 表),應盡快排上開發排程,搭配現有 610 個測試與 migration fail-closed 防線降低升級風險。(c)(d) 可排在其後,兩者實際暴露面經 G4 核實都偏低(vitest 只用 `run` 不用 `--ui`;langsmith 不 pull public prompt)。(e) 建議與 (a) 同批做,避免下次盤點又要重新跑一輪 audit 才知道現況。

**省多少/花多少(量級)**:這不是「省錢」決策而是「風險消除」決策——(a) 幾乎零成本(dry-run 已證明不破壞既有版本約束,只需執行+跑測試確認);(b)(c)(d) 的成本是**工程時間**(測試回歸 + migration 演練),不是金錢支出,量級上 (b) 因牽涉全部 102 表與 610 測試,工程時間成本最高但也最值得投入(修的是 SQLi,對外部使用者的請求路徑直接暴露)。

**需要 Bruce 拍板/提供的**:
- 拍板:(a) 的執行時間點(建議儘快,零風險);(b)(d) 的排程優先序與負責人。
- 拍板:是否採納 (e),把 audit 排進 CI——這是流程層決策,不需要額外數據即可拍板。

---

## 決策卡 8:待補外部數據清單(能把「架構推估」變真帳單的最小集合)

以下是**必須由 Bruce 或有 Railway/供應商後台權限的人回家後補的數字**,依「能推進哪張決策卡」分組列出,而非泛泛的待補清單重複(00-summary §4 已有總表,這裡只列與本文件 8 張決策卡直接掛鉤、且優先度最高的子集):

| # | 需要的數字 | 從哪查 | 推進哪張決策卡 |
|---|---|---|---|
| 1 | OpenRouter/Anthropic 用量頁按 model 拆分的光球對話 token 量 | OpenRouter dashboard、Anthropic console | 卡 1(驗證降檔實際省多少,而非只看內建估價表) |
| 2 | 站內問答/eval 呼叫的重複率(能否從 admin API 用量頁按 prompt 內容分組) | admin「API 用量」頁、`api_usage_logs` 表 | 卡 2(LLM_CACHE 擴面的實際命中率預估) |
| 3 | 40 次/天配額實際命中率、光球對話量、批次生成(`autoGenerateFromSegments`)實際觸發頻率 | `api_usage_logs`/`generation_history` 表查詢 | 卡 3(配額政策該不該從次數制改金額制) |
| 4 | Brave Search、Gemini(健康監測用)、NewsAPI/NewsData 的月帳單或用量頁 | 各供應商後台 | 卡 4(cron 降頻的實際金額省幅) |
| 5 | `r2_storage_snapshots`/`r2_object_catalog` 現值(bucket 總 GB、物件數趨勢、Class A/B 月操作數、目前月費) | Cloudflare R2 dashboard,或直接查詢這兩張表(已在收集資料) | 卡 5(db-backups 保留天數、資產冷熱分層是否值得做) |
| 6 | CodeRabbit 目前方案、實際撞到的上限值、月審查量 | CodeRabbit dashboard/帳單頁 | 卡 6(方案選擇的損益平衡點) |
| 7 | fal.ai 分模型月帳單(尤其影片類 Veo3/Kling/Sora 級用量) | fal.ai dashboard | 卡 1、3(驗證「批次生成=帳單大頭」的假設與實際量級) |
| 8 | Railway 目前月費、RAM 峰值/常駐水位、是否掛 Redis addon | Railway dashboard | 不直接對應本文件卡,但是 00-summary §4.1 已列的固定成本底座,影響所有決策的「整體帳單基準」 |

**未查證部分(誠實聲明)**:
- CodeRabbit 的接線方式(GitHub App/獨立 workflow)、免費額度具體規則,本次未在 repo 內找到對應設定檔佐證,卡 6 的建議結構性成分較高、量化部分明確標「[需實測]」。
- CI runner 復活後的實際穩定性(是否會再度秒掛)未重新驗證,僅採信使用者陳述「已恢復」。
- Suno 第三方 proxy、ElevenLabs 訂閱、Pinecone、Supabase 的實際月費完全未查(00-summary §4 已列,本文件未重複展開,只在卡 8 表格中列出與本文件決策直接相關的最小子集)。
