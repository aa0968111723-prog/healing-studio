# FL2 — 計費類旗標 default 稽核
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:ENABLE_COST_LEDGER/ORB_COST_GUARD/ORB_QUOTA_GUARD/ORB_BUDGET_GUARD/RETRY_CHAIN_COST_GUARD/ORB_IDEMPOTENCY_GUARD/COST_ATTRIBUTION/BUDGET_ALERTS/FREE_LLM_API_ENABLED/PREFER_CHEAP_MODELS

方法：每個旗標的 default 皆從 `server/_core/env.validated.ts` 的 zod schema 讀出（唯一定義預設值處），再 grep 讀取點確認 gate 什麼行為。`.env.production` 逐一 grep 過，**十個旗標全部未出現**（見文末〈.env.production 核對〉），故 prod 值＝default 值（未被覆寫）。

## 旗標表

| 旗標 | default | prod 值 | gate 什麼 | 安全/計費控制？ | 狀態 | 疑慮 |
|---|---|---|---|---|---|---|
| `ENABLE_COST_LEDGER` | **OFF**(`false`)<br>`env.validated.ts:679` | OFF（未覆寫，沿用 default） | `isCostLedgerEnabled()`（`server/services/cost/ledger.ts:71-77`）控制 `aiProxy.ts:559` 是否在既有 usage-event 落帳點「額外」寫一筆複式分錄到 `cost_ledger` 表；`costLedgerReconcileJob.ts:130` OFF 時直接 `skipped`。OFF＝完全不寫 ledger，零行為變化（純觀測旁寫，不影響既有扣點）。 | 是（記帳/稽核，非阻擋控制） | active（有讀取點、有測試、有實際接線） | **確認**：預設 OFF＝生產環境目前沒有複式分錄帳本在跑，只有舊的 `cost_aggregations`／`remainingGenerations`。且退款路徑 `refundUserPoints`（`server/db.ts`）未接 ledger（`env.validated.ts:675-677` 自陳），即使日後開了旗標，退款也不會產生 credit 列——記帳仍片面。此為既有已知設計缺口（R4/W5 已記錄），非新發現。 |
| `ENABLE_COST_ATTRIBUTION` | **ON**(`true`)<br>`env.validated.ts:688` | ON（未覆寫） | `isCostAttributionEnabled()`（`server/services/cost/costAttribution.ts:53-59`）控制 `aiProxy.ts:585-599` 與 `skillOrchestrator.ts:417` 是否把「落帳意圖」寫入 `cost_attribution_outbox`（member/project/workflow 維度歸屬，USD→TWD）；`costAttributionOutboxJob.ts:36` OFF 時 skip drain。demo/無 DB 時安全跳過。 | 否（內部觀測用，不對使用者收費，作者已載明） | active | 與 `ENABLE_COST_LEDGER` default 相反（ON vs OFF）是刻意設計：本旗標「內部用不收費」故預設開；ledger 因涉及真金流／退款接線未完整，預設關。註解已誠實說明二者差異，非矛盾。 |
| `ENABLE_ORB_COST_GUARD` | **ON**(`true`)<br>`env.validated.ts:569` | ON（未覆寫） | 僅接線在 `server/routers/ai.ts`：`costGuardEnabled`（`ai.ts:991-994`）控制 `ai.chat` 是否呼叫 `estimateOrbTaskCost()`（`ai.ts:2398-2410`）做事前成本估價與 telemetry。**只在 ai.chat 這條路徑**，`director.ts` 未接線本旗標。 | 是（成本估價/防護，聊天層） | active，但**client-server 不一致**風險低（純 server 旗標）；**覆蓋面不全**：只擋 `ai.chat`，不擋 `director.chat` | 預設雖 ON，但保護範圍僅限 orb chat 一條路徑，`director.chat` 走 `enforceMonthlyBudgetGate` 但沒有本旗標的逐請求成本估價/telemetry。與已知 GC2（orb quota guard 只管聊天層）同款「單路徑防護」模式，此為 COST_GUARD 版本的相同疑慮。 |
| `ENABLE_ORB_QUOTA_GUARD` | **OFF**(`false`)<br>`env.validated.ts:572` | OFF（未覆寫） | 同上僅接線在 `ai.ts`：`quotaGuardEnabled`（`ai.ts:995-998`）控制 `checkAndConsumeQuota("rapid_click", …)`（`ai.ts:1643-1683`，另於 `ai.ts:2049`、`ai.ts:2507` 讀取 quota 快照/二次檢查）。OFF 時無 rapid-click 節流。 | 是（防護，聊天層） | active | **確認已知 GC2**：orb quota guard 只管聊天層（`ai.chat`），`director.ts` 未接線本旗標，且**預設 OFF**——目前生產環境的 rapid-click 節流本身是關的，需人工開啟才生效。「只管聊天層」+「預設關」是兩層縮小的防護面，需同時留意。 |
| `ENABLE_ORB_BUDGET_GUARD` | **OFF**(`false`)<br>`env.validated.ts:418` | OFF（未覆寫） | `enforceMonthlyBudgetGate()`（`server/services/orbBudgetGuard.ts:113-125`）：OFF 直接 return（不查詢、不阻擋）；ON 時查 `cost_aggregations` 當月 SUM，超過 `AI_MONTHLY_BUDGET_USD`（預設 500 USD，`env.validated.ts:414`）即對 `ai.chat`（`ai.ts:565`）與 `director.chat`（`director.ts:246`）丟 `TOO_MANY_REQUESTS`。DB 不可用時 fail-open（`orbBudgetGuard.ts:82-85`）。 | 是（月度硬性金額阻擋，唯一覆蓋 ai.chat + director.chat 兩條路徑的計費控制） | active | **預設 OFF**：生產環境目前沒有月度預算硬阻擋，超支不會被擋（僅有 `ENABLE_BUDGET_ALERTS` 的告警，告警≠阻擋）。註解本身自陳「風險高，需 Bruce 明確開啟」，屬刻意設計但仍是「計費防護預設關」的一員，串 B-22 守衛失明。 |
| `ENABLE_RETRY_CHAIN_COST_GUARD` | **ON**(`true`)<br>`env.validated.ts:571` | ON（未覆寫） | `retryChainGuardEnabled`（`ai.ts:3142-3145`）：ON 時在 `orbTask.retry`（`ai.ts:3124` mutation）查最近 5 分鐘（`ai.ts:3150`）該使用者的 retry 累積成本（`aiUsageEvents`），超過門檻即擋。這是**唯一覆蓋 `orbTask.retry`** 的成本護欄（與 ORB_COST_GUARD/QUOTA_GUARD/IDEMPOTENCY_GUARD 只管 `ai.chat` 不同路徑）。 | 是（防護，retry-chain 專用） | active | 預設 ON 為正向；但要注意它與上面三個 chat 層護欄是**互斥覆蓋不同入口**——`ai.chat` 本身重試邏輯不會經過 `orbTask.retry` 路徑就不受本旗標保護，需合併看才知道全貌（非本次新發現，屬既有 W7 型樣：單旗標各管一段）。 |
| `ENABLE_ORB_IDEMPOTENCY_GUARD` | **OFF**(`false`)<br>`env.validated.ts:573` | OFF（未覆寫） | `idempotencyGuardEnabled`（`ai.ts:999-1003`）：ON 時對含生成類關鍵字（`ai.ts:1579-1581` 正則 生成/generate/video/image/audio/code/deploy/github…）或帶附件的請求算 `buildOrbIdempotencyKey`（`ai.ts:1582-1588`）找重複任務、擋重覆生成（計費意義：防止重複點擊造成雙重扣款/雙重生成成本）。OFF＝無此去重，僅 `ai.chat` 路徑有本檢查。 | 是（防護，計費相關：防重複扣款） | active | **預設 OFF**：生產環境目前沒有生成類請求的冪等去重，重複點擊/網路重試可能造成重複計費/重複生成成本，且僅限 `ai.chat`（`orbTask.retry`、`director.chat` 皆不受其保護）。與 ORB_QUOTA_GUARD 同屬「計費/防護預設關 + 覆蓋面窄」的疊加疑慮。 |
| `ENABLE_BUDGET_ALERTS` | **ON**(`true`)<br>`env.validated.ts:415` | ON（未覆寫） | `initApiUsageAlertCron()`（`server/jobs/apiUsageAlertJob.ts:254-268`）：OFF 時整個 15 分鐘告警 cron 不啟動（`alertConfigs` DB 設定保留不清除，`apiUsageAlertJob.ts:258`），僅是**告警**（Slack webhook，若 `ALERT_SLACK_WEBHOOK` 未設則靜默跳過，`env.validated.ts:406-408`），非阻擋。 | 否（僅告警，非硬控） | active | 預設 ON 為正向，但**告警本身依賴 `ALERT_SLACK_WEBHOOK` 是否設定**（`env.validated.ts:412` default 空字串）；旗標 ON 但未設 webhook＝cron 跑了也無人收到通知，等同無效告警。需另外確認 Railway 是否已設 `ALERT_SLACK_WEBHOOK`（本次未讀密鑰值，僅讀旗標本身；此為需再查項）。 |
| `FREE_LLM_API_ENABLED` | **OFF**(`false`)<br>`env.validated.ts:542` | OFF（未覆寫） | `llmRouter.ts:497-505`：ON 時把 `freellmapi`（第三方免費、無需金鑰、OpenAI 相容格式的 LLM，來源 github.com/tashfeenahmed/freellmapi）加入可用引擎清單，作為所有付費引擎失敗後的**最終備援**；`llmRouter.ts:772-800` 實際組裝該引擎設定，`apiKey` 傳空字串（`llmRouter.ts:795`）不帶 Authorization header；`FREE_LLM_API_URL` 有 SSRF guard（`llmRouter.ts:783-787` `assertSafeExternalUrl`，prod 嚴格擋 loopback/內網/IMDS）。 | 是（開放面控制：ON 會讓聊天請求外流到不受控的第三方免費端點，且該端點無金鑰驗證） | active | **預設 OFF 是正向**：生產環境目前不會把使用者請求送到這個無驗證的第三方免費 LLM 備援端點。若日後有人為了「省成本」在 Railway 開啟本旗標，等於把所有付費引擎都失敗時的請求（可能含使用者原始輸入）轉送到一個不受 Anthropic/OpenRouter 等契約保護、無金鑰驗證的外部服務——這是計費面「免費繞過」與資料外流面雙重疑慮，建議开啟前先評估資料外洩風險（本稽核僅讀 default，未讀是否曾被開啟過的 log）。 |
| `PREFER_CHEAP_MODELS` | **`"economy"`**（字串枚舉，非布林）<br>`env.validated.ts:594` | economy（未覆寫） | `resolveModelTier()`（`server/middleware/brainContext.ts:244-256`）解析成 `economy`/`balanced`/`premium`；`getActiveDefaultBrains()`/`getActiveDefaultEngines()`（`brainContext.ts:259-278`）依此回傳推理大腦與生成引擎的預設模型組合。economy＝省成本模型（預設）；balanced＝現狀（今對應舊行為）；premium＝director/storyteller/technician/curator/analyst/imageEngine 同 balanced，videoEngine 升級 Kling Pro、voiceEngine 升級 ElevenLabs Multilingual v2；未知值安全退回 economy 並 `console.warn`（`brainContext.ts:249-254`，同請求不重複洗版）。 | 是（計費控制：決定用哪一批模型，直接影響單次呼叫成本） | active | **確認 GC2**：預設 `economy`——生產環境目前預設走省成本模型組合，`balanced`（現狀行為/較貴）與 `premium`（更貴）都需顯式設定才會啟用。純 server 端旗標，讀取點在 `brainContext.ts`，未見 client 對應鏡像值，無 client-server 不一致疑慮；`env.validated.ts` 與 `.env.example`/`.env.production` 皆一致（未覆寫）。 |

## `.env.production` 核對

逐一 grep 十個旗標名於 `/home/user/healing-studio/.env.production`：**全部零命中**（僅命中 `.env.example` 的 `ENABLE_COST_ATTRIBUTION=true`、`ENABLE_COST_LEDGER=false`，皆與 schema default 相同，非額外覆寫來源）。`.env.production` 本身只出現 `VITE_ENABLE_4SHELL=1`、`VITE_ENABLE_VIDEO_COCKPIT=1` 等與本次範圍無關的旗標。結論：**十個旗標的 prod 值＝env.validated.ts default 值**，無 Railway 環境變數覆寫證據（僅讀本 repo 內 `.env.production` 檔案，不代表 Railway 後台實際環境變數——若 Railway 後台另有設定但未同步進本檔，仍可能與此表不同，此為需再查項）。

## 重點結論（計費/安全控制預設 OFF 者）

以下五個旗標為**計費或防護相關且預設 OFF**，串 B-22（守衛失明）/ B-11（記帳失明）：

1. `ENABLE_COST_LEDGER`（OFF）— 記帳失明：複式分錄帳本目前不寫。
2. `ENABLE_ORB_QUOTA_GUARD`（OFF）— 守衛失明：`ai.chat` 的 rapid-click 節流不生效，且即使開啟也只管聊天層（GC2 已確認）。
3. `ENABLE_ORB_BUDGET_GUARD`（OFF）— 守衛失明：月度預算硬阻擋不生效，超支目前只有告警（`ENABLE_BUDGET_ALERTS`）沒有阻擋。
4. `ENABLE_ORB_IDEMPOTENCY_GUARD`（OFF）— 守衛失明：生成類請求無冪等去重，重複點擊/重試有重複計費/重複生成風險，且僅限 `ai.chat`。
5. `FREE_LLM_API_ENABLED`（OFF）— 預設關閉是正向；一旦開啟即開放請求外流到無驗證第三方免費 LLM 端點，屬「開啟後」的濫用/外洩面，非目前生產風險。

`ENABLE_ORB_COST_GUARD`、`ENABLE_RETRY_CHAIN_COST_GUARD`、`ENABLE_COST_ATTRIBUTION`、`ENABLE_BUDGET_ALERTS` 預設 ON，`PREFER_CHEAP_MODELS` 預設 `economy`（省成本）——這五個對應 GC2 所提「economy 分層」與既有防護正常運作的部分皆已核實。

## 需再查（未臆測，明確標註待補查項）

- `ALERT_SLACK_WEBHOOK` 是否已在 Railway 生產環境設定（本檔僅讀出 schema default 為空字串，未讀任何金鑰值，也未存取 Railway 後台）——若未設，`ENABLE_BUDGET_ALERTS=true` 只是空轉。
- Railway 後台是否對本次十個旗標中任一項做了不在本 repo `.env.production` 內、僅存在雲端後台的環境變數覆寫（本稽核僅能核對 repo 內檔案，無法讀取雲端實際環境變數）。
