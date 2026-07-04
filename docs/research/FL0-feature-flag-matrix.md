# FL0 — 功能旗標矩陣（default/gates/安全控制/prod值/死旗標）

- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核方法：每筆 default 皆從定義檔（`server/_core/env.validated.ts`、`client/src/lib/env.validated.ts`）與 `.env.production`/`.env.example` 實讀後記錄；gate 依讀取點 grep 實際程式碼行為描述，不臆測。標「needs-check」者代表未能從檔案讀出確定值。
- 本次額外驗證（Bash 直讀，非沿用輸入 JSON）：
  - `.env.production`（repo 根目錄，實測 2026-07-03 內容）僅含 7 個 build-time `VITE_*` 旗標：`VITE_SITE_URL`、`VITE_ENABLE_4SHELL=1`、`VITE_SHELL_SOCIAL=1`、`VITE_SHELL_LEARN=1`、`VITE_SHELL_LEARN_RICH=1`、`VITE_SHELL_SETTINGS_RICH=1`、`VITE_ENABLE_VIDEO_COCKPIT=1`。**沒有任何後端 `ENABLE_*` 安全/計費旗標在此檔覆寫**——凡輸入清單中標「prodValue: 未覆寫」者，本次直接以此檔案內容核實無誤（該檔完全不含這些 key）。
  - `ENABLE_CODEX_TASKS` 雙分支矛盾親自核實：`env.validated.ts:565` schema default `"false"`；`providerRouter.ts:145` `flag("ENABLE_CODEX_TASKS", false)`（false）；但 `orbCodeTask.ts:30` `String(process.env.ENABLE_CODEX_TASKS ?? "true")`（true）——**同一旗標未設定時，两個讀取點吃到相反的隱含 default**，確認為真實矛盾，非誤讀。
  - `ENABLE_DIRECTOR_WORLD_CONTEXT` 親自核實：`director.ts:150-155` `isDirectorWorldContextEnabled()` 對 `process.env.ENABLE_DIRECTOR_WORLD_CONTEXT` 做 raw 讀取，未設定/空值 → `return false`；程式碼自身註解（`director.ts:140-141`）明載「預設 OFF＝零行為改變」。此旗標**未出現在 `env.validated.ts` schema 中**，與 `ENABLE_RAG_INJECTION_GUARD` 同屬「繞過 Zod 驗證層、純 raw process.env 讀取」的旗標家族。

---

## 1. 全旗標矩陣表

| 旗標 | default | prod 值 | gate（做什麼、檔案:行號） | 安全/計費控制？ | 狀態 | 疑慮 |
|---|---|---|---|---|---|---|
| `ENABLE_COST_LEDGER` | off | false（未覆寫，`.env.production` 無此 key） | `aiProxy.ts:559` 是否寫複式分錄到 `cost_ledger`；`costLedgerReconcileJob.ts:130` OFF 時 skip 對帳。判定：`ledger.ts:71-77` `isCostLedgerEnabled()` | 是（計費） | active，已對抗式驗證 confirmed | 生產環境目前無複式帳本；退款路徑 `refundUserPoints` 未接 ledger（`env.validated.ts:675-677` 自陳），即使開旗標也片面記帳 |
| `ENABLE_COST_ATTRIBUTION` | on | true（未覆寫） | `aiProxy.ts:585-599`、`skillOrchestrator.ts:417` 是否寫 `cost_attribution_outbox`；`costAttributionOutboxJob.ts:36` OFF 時 skip drain | 否（內部觀測） | active | 與 `ENABLE_COST_LEDGER`（OFF）對照一致，屬刻意設計非矛盾 |
| `ENABLE_ORB_COST_GUARD` | on | true（未覆寫） | `ai.ts:991-994` 控制 `ai.chat` 是否呼叫 `estimateOrbTaskCost()`（`ai.ts:2398-2410`）做事前估價；`director.ts` 未讀取本旗標 | 是 | active | 只擋 `ai.chat`，`director.chat` 無本旗標估價/telemetry，只受 `ENABLE_ORB_BUDGET_GUARD` 保護 |
| `ENABLE_ORB_QUOTA_GUARD` | **off** | false（未覆寫） | `ai.ts:995-998` 控制 `checkAndConsumeQuota("rapid_click",...)`（`ai.ts:1643-1683`、`2049`、`2507`）。僅 `ai.chat`，不含 `orbTask` 執行層 | 是 | active，已對抗式驗證 confirmed（兩次） | GC2 已知項：僅管聊天層；且預設 OFF——生產環境 rapid-click 節流目前關閉，需人工開啟 |
| `ENABLE_ORB_BUDGET_GUARD` | **off** | false（未覆寫） | `orbBudgetGuard.ts:113-125` `enforceMonthlyBudgetGate()`：OFF 直接 return；ON 時查 `cost_aggregations` 當月 SUM 超過 `AI_MONTHLY_BUDGET_USD`（預設 500）即擋 `ai.chat`（`ai.ts:565`）與 `director.chat`（`director.ts:246`）。DB 不可用 fail-open | 是 | active，已對抗式驗證 confirmed | 唯一覆蓋 `ai.chat`+`director.chat` 兩入口的月度硬阻擋，但預設 OFF——目前超支不會被硬擋，只有 `ENABLE_BUDGET_ALERTS` 的告警 |
| `ENABLE_RETRY_CHAIN_COST_GUARD`（即 `RETRY_CHAIN_COST_GUARD`） | on | true（未覆寫） | `ai.ts:3142-3145` 查最近 5 分鐘（`3150`）該用戶 retry 累積成本，超門檻擋 `orbTask.retry`（`3124` mutation）。唯一覆蓋 `orbTask.retry` 的成本護欄 | 是 | active | 與 `ORB_COST_GUARD`/`QUOTA_GUARD`/`IDEMPOTENCY_GUARD` 管不同入口，需合併看才知全貌覆蓋面（W7 型樣：多旗標各管一段） |
| `ENABLE_ORB_IDEMPOTENCY_GUARD`（即 `ORB_IDEMPOTENCY_GUARD`） | **off** | false（未覆寫） | `ai.ts:999-1003` ON 時對生成類請求（正則 `1579-1581`）算 `buildOrbIdempotencyKey`（`1582-1588`）擋重複任務。僅 `ai.chat` | 是 | active，已對抗式驗證 confirmed | 生產環境目前無生成類請求冪等去重，重複點擊/重試有重複計費/重複生成風險；`orbTask.retry`/`director.chat` 皆不受保護 |
| `ENABLE_COST_ATTRIBUTION`（重複列，別名 `COST_ATTRIBUTION`） | on | true | 同上 | 否 | active | 同上 |
| `ENABLE_BUDGET_ALERTS`（即 `BUDGET_ALERTS`） | on | true（未覆寫） | `apiUsageAlertJob.ts:254-268` `initApiUsageAlertCron()`：OFF 時 15 分鐘告警 cron 不啟動。僅告警（依賴 `ALERT_SLACK_WEBHOOK` 是否設定，未設則靜默跳過），非阻擋 | 否 | active | `ALERT_SLACK_WEBHOOK` 預設空字串（`env.validated.ts:412`）——旗標 ON 但若 Railway 未設此 webhook，cron 跑了也無人收到通知。**此 webhook 是否已在 Railway 設定，本次未讀密鑰值，需再查** |
| `FREE_LLM_API_ENABLED` | off | false（未覆寫） | `llmRouter.ts:497-505` 是否把 `freellmapi`（第三方免費、無金鑰）加入可用引擎清單作最終備援；`772-800` 組裝設定（`apiKey` 傳空字串），`FREE_LLM_API_URL` 有 SSRF guard（`783-787`） | 是 | active，已對抗式驗證 confirmed | 預設 OFF 是正向；若日後開啟，付費引擎失敗後請求（含使用者輸入）會外流到無驗證第三方端點——計費繞過＋資料外流雙重面 |
| `PREFER_CHEAP_MODELS` | economy（非布林，字串枚舉） | "economy"（未覆寫） | `brainContext.ts:244-256` `resolveModelTier()`；`259-278` 依分層決定大腦/引擎模型組合，直接影響單次呼叫成本 | 是 | active | 預設 economy（省成本）；未知值安全退回 economy 並 warn（`249-254`）；純 server 端，無 client 鏡像 |
| `ENABLE_PROJECT_HUB` / `VITE_ENABLE_PROJECT_HUB` | off | **false**（`.env.production` 無此 key，確認未覆寫） | `client/src/config/videoFlags.ts:67` → `StorySpineColumn.tsx:65` 掛載 `ProjectFlowGuide` | 否（功能開關） | active | prod OFF（已知項核對成立） |
| `VITE_ENABLE_4SHELL` | on | **1**（`.env.production:2` 實測 `VITE_ENABLE_4SHELL=1`） | `client/src/config/featureFlags.ts:58` → `App.tsx` shell routing 總開關 | 否 | active | prod ON（Y10 核對成立）；`.env.example` 仍寫 0 且檔頭聲稱「預設 OFF」已過時，文件與現況脫節 |
| `ENABLE_RAG_INJECTION_GUARD` | **off** | 需再查（`.env.production` 無此 key，Railway 後端變數未知；schema 未定義，raw process.env 讀取） | `server/services/security/ragInjectionGuard.ts:67-72`（`isRagInjectionGuardEnabled()`），實際消費點：`costarService.ts:95`、`planningService.ts:255`、`scriptGenerationService.ts:146`、`spiritPromptEnhancer.ts:24` — RAG 記憶注入 LLM 前的 prompt injection 中和 | 是（安全） | active，已對抗式驗證 confirmed | 安全控制預設 OFF（X8 已知項核對成立）；未在 `env.validated.ts` schema 定義，bypass 驗證層 |
| `ENABLE_DIRECTOR_WORLD_CONTEXT` | **off** | 需再查（同上，schema 外、raw 讀取，`.env.production` 無此 key） | `server/routers/director.ts:150-155` `isDirectorWorldContextEnabled()`：OFF 時 chat 即使帶 `projectId` 也不載入世界框架、不注入 system prompt。程式碼自陳「預設 OFF＝零行為改變」（`140-141`） | 是（成本＋一致性控制，注入摘要另有 `DIRECTOR_CHAT_WORLD_CONTEXT_MAX_CHARS=5000` 上限，`director.ts:168`） | active（本次新驗證，非輸入 JSON 原有項） | 與 client 端 `VITE_ENABLE_WORLD_STYLE_INJECTION` 語意不同（一為 LLM 文字脈絡注入、一為圖像提示詞風格前綴），命名相近易混淆但不可互通（`director.ts:143-146` 自陳） |
| `ENABLE_CODEX_TASKS` | **雙分支矛盾**（見下） | 需再查（Railway 後端變數未知；`.env.production` 無此 key） | `providerRouter.ts:145` `flag("ENABLE_CODEX_TASKS", false)`（registry enabled 欄位 default **false**）；`orbCodeTask.ts:30` `String(process.env.ENABLE_CODEX_TASKS ?? "true")`（實際送任務 gate default **true**）；schema `env.validated.ts:565` default `"false"` | 是（功能開關，決定 code task 是否真的送出） | **both-branches-same／矛盾（本次親自核實）** | 同一旗標未設定時：provider registry 認為已停用，但 `orbCodeTask.isCodeCollaborationEnabled()` 卻放行——兩處互相矛盾，是本次任務要求點名的具體不一致案例，建議統一為同一 default |
| `VITE_ENABLE_CLAUDE_CODE_TASKS`（client） | on | 需再查 | `client/src/lib/env.validated.ts:25` 定義（default true）；`clientEnv.VITE_ENABLE_CLAUDE_CODE_TASKS` 全 repo零讀取 | 否（形同虛設） | **client-server-mismatch** | server 端 `ENABLE_CLAUDE_CODE_TASKS` 真的被 `providerRouter.ts:127`/`orbCodeTask.ts:26` 讀取（default true 一致），但 client 對應開關從未被任何元件消費——前端形同有獨立開關實則不生效，行為完全由 server 端決定 |
| `VITE_ENABLE_ORB_MEMORY_PANEL`（client） | off | false（`.env.production` 無此 key） | `client/src/lib/env.validated.ts:24` 定義；全 repo 找不到 `OrbMemoryPanel` 元件或消費點 | 否 | **dead-flag** | 功能可能從未落地或已移除，旗標殘留 |
| `VITE_APP_ID` / `VITE_APP_TITLE` / `VITE_APP_LOGO` / `VITE_OAUTH_PORTAL_URL`（client） | 空字串 | 未覆寫 | `client/src/lib/env.validated.ts:16-19` 定義；`clientEnv.*` 全 repo 零讀取 | 否 | **dead-flag** | 前兩者程式碼註解自承 legacy Manus OAuth 變數；後兩者連 legacy 說明都沒有，純屬定義卻從未接上任何 UI |
| `FEATURE_ADVANCED_SEARCH` / `FEATURE_RAG_MEMORY` / `FEATURE_RESEARCH_MODE`（schema 欄位） | 空字串 | 未覆寫 | schema 定義於 `env.validated.ts:731-733`；`serverEnv.FEATURE_*` 全 repo 零讀取。真正生效邏輯在 `server/_core/featureFlags.ts:190-208` 用 `process.env["FEATURE_"+name]` 動態直讀＋各自 `defaultResolver` | 否（純裝飾） | **dead-flag（schema 欄位本身）** | 三個 zod schema 欄位可安全移除而不影響任何行為；但底層 `featureFlags.ts` 機制本身是活的（見下方第 4 節） |
| `ENABLE_ADVANCED_SEARCH` / `ENABLE_RAG_MEMORY` / `ENABLE_RESEARCH_MODE`（使用者側別名） | needs-check | needs-check | 文件（`env.validated.ts:727-730`、`ragMemory.ts:136,206`、`ai.ts:1347-1348`）宣稱由 `selfRepairEnv()` 自動重命名為 `FEATURE_*`，但 `ALIASES` 表（`env.validated.ts:90-97`）實際只有 5 組不相關別名（`NTHROPIC_API_KEY`/`ANTROPIC_API_KEY`/`NVIDA_API`/`FAL_KEY`/`AUTH_SECRET`），**無此三筆映射** | 否 | **semantic-trap，已對抗式驗證 confirmed** | 使用者依文件設定 `ENABLE_RAG_MEMORY=false` 等變數名完全無效；真實 default 走 `featureFlags.ts:92-117` 的 `Boolean(PINECONE_API_KEY)` 等金鑰存在性推斷，與文件描述的「兩種寫法皆可生效」不符；`ADVANCED_SEARCH` 經 grep `isEnabled("ADVANCED_SEARCH")` 零命中，比原描述更嚴重、是完全死旗標 |
| `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` / `VITE_ENABLE_GLOBAL_ORB_EXECUTOR`（client） | needs-check | needs-check | `clientEnv` schema 驗證 vs 實際生效路徑（`vite.config.ts` define + `index.html` 樣板 / `useGlobalOrbExecutor.ts` 直讀 `import.meta.env`）是兩條平行路徑；`clientEnv.*` 零讀取，但底層變數透過另一機制生效 | 否 | both-branches-same（目前 default 巧合相同，非矛盾） | `clientEnv` 驗證是裝飾性的，未來若只改其中一處 default 會產生實質不一致，建議收斂為單一路徑 |

---

## 2. 🔴 安全/計費控制預設 OFF 清單

以下是本次矩陣中**出廠即關閉的防護／計費機制**——生產環境目前完全不受這些控制保護，除非人工手動開啟：

| 旗標 | 管什麼 | 目前後果 | 對應已知項 |
|---|---|---|---|
| `ENABLE_COST_LEDGER` | 複式分錄成本帳本 | 生產環境無複式帳本記帳；退款路徑 `refundUserPoints` 即使開旗標也片面記帳（自陳缺陷 B-11） | X8 系列 / 已知項核對成立 |
| `ENABLE_ORB_QUOTA_GUARD` | `ai.chat` 的 rapid-click 配額節流 | 快速連點無節流；且即使開啟也只管聊天層，不含 `orbTask` 執行層 | GC2 已知項核對成立 |
| `ENABLE_ORB_BUDGET_GUARD` | `ai.chat`＋`director.chat` 兩入口的**月度硬阻擋**（唯一覆蓋兩入口者） | 生產環境目前超支**不會被硬擋**，只剩 `ENABLE_BUDGET_ALERTS` 的告警（而告警本身還依賴未知是否設定的 `ALERT_SLACK_WEBHOOK`） | 本次分析中風險最高的單一發現 |
| `ENABLE_ORB_IDEMPOTENCY_GUARD` | 生成類請求（video/image/audio/code/deploy 等）冪等去重 | 重複點擊/重試有重複計費、重複生成風險；且僅限 `ai.chat`，`orbTask.retry`／`director.chat` 完全不受保護 | 守衛失明，覆蓋面窄 |
| `ENABLE_RAG_INJECTION_GUARD` | RAG 記憶注入 LLM 前的 prompt injection 中和 | 生產環境目前對 Director costar/planning/script generation、orb planner/replan、spirit prompt enhancer 的記憶內容**不做注入中和** | X8 已知項核對成立 |
| `ENABLE_DIRECTOR_WORLD_CONTEXT` | Director chat 是否載入世界框架注入 system prompt | 目前零行為改變（設計上刻意預設 OFF，非缺陷），但一旦開啟需注意雙階段（研究＋創作）各注入一次、每輪計費兩次的成本特性 | 本次新驗證項，非缺陷但需留意開啟後的計費影響 |
| `FREE_LLM_API_ENABLED` | 是否允許無金鑰第三方免費 LLM 作最終備援 | 目前正確關閉；但若日後為省成本開啟，會讓所有付費引擎失敗後的請求（含使用者輸入）外流到無驗證第三方端點——計費繞過＋資料外流雙重面 | 開啟前需評估的預防性項目 |

**安全/計費控制預設 OFF 合計：7 項**（`ENABLE_COST_LEDGER`、`ENABLE_ORB_QUOTA_GUARD`、`ENABLE_ORB_BUDGET_GUARD`、`ENABLE_ORB_IDEMPOTENCY_GUARD`、`ENABLE_RAG_INJECTION_GUARD`、`ENABLE_DIRECTOR_WORLD_CONTEXT`、`FREE_LLM_API_ENABLED`）。其中 `ENABLE_ORB_BUDGET_GUARD` 的風險層級最高——它是唯一同時覆蓋 `ai.chat` 與 `director.chat` 兩條主要入口的月度硬阻擋，OFF 狀態下生產環境對整體 AI 支出**沒有任何自動硬性上限**。

---

## 3. 死旗標／無效旗標／語意陷阱

| 類型 | 旗標 | 問題 |
|---|---|---|
| dead-flag（schema 裝飾） | `FEATURE_ADVANCED_SEARCH` / `FEATURE_RAG_MEMORY` / `FEATURE_RESEARCH_MODE` | zod schema 定義存在（`env.validated.ts:731-733`），但 `serverEnv.FEATURE_*` 全 repo 零讀取；真正生效邏輯繞過 schema，走 `featureFlags.ts` 動態 `process.env["FEATURE_"+name]` 直讀。**這三個 schema 欄位本身可安全移除**，不影響任何行為 |
| dead-flag（client） | `VITE_ENABLE_ORB_MEMORY_PANEL` | schema 定義存在但全 repo 找不到 `OrbMemoryPanel` 元件或任何消費點，功能可能從未落地或已移除 |
| dead-flag（client） | `VITE_APP_ID` / `VITE_APP_TITLE` / `VITE_APP_LOGO` / `VITE_OAUTH_PORTAL_URL` | 定義存在，零讀取。前兩者是 legacy Manus OAuth 殘留（程式碼自承），後兩者連說明都沒有 |
| both-branches-same（矛盾，非死旗標） | `ENABLE_CODEX_TASKS` | **本次親自核實**：`providerRouter.ts:145` 的 registry `enabled` 欄位 default `false`，但 `orbCodeTask.ts:30` 實際送出任務的 gate 卻 `?? "true"`（default true）。同一環境變數未設定時，兩處讀出相反結果——這不是「死」而是「活的矛盾」，行為取決於呼叫路徑經過哪一段程式碼，是本次任務要求具體點名的不一致案例 |
| client-server-mismatch | `VITE_ENABLE_CLAUDE_CODE_TASKS` | client 端定義 default true 但零讀取（形同虛設）；server 端對應的 `ENABLE_CLAUDE_CODE_TASKS` 才是真正決定行為者（`providerRouter.ts:127`/`orbCodeTask.ts:26`，default true）。前端使用者若切換此開關**完全無效** |
| 語意陷阱（semantic-trap） | `ENABLE_ADVANCED_SEARCH` / `ENABLE_RAG_MEMORY` / `ENABLE_RESEARCH_MODE` | 多處文件與程式碼註解（`env.validated.ts:727-730`、`ragMemory.ts:136,206`、`ai.ts:1347-1348`）宣稱有 `selfRepairEnv()` 自動重命名別名到 `FEATURE_*`，但實際 `ALIASES` 表（`env.validated.ts:90-97`）查無此三筆映射。使用者依文件設定這些變數名**完全無效**；真實生效值改由 `featureFlags.ts` 的金鑰存在性推斷（如 `Boolean(PINECONE_API_KEY)`）決定，與文件描述機制不符 |
| both-branches-same（裝飾性驗證） | `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` / `VITE_ENABLE_GLOBAL_ORB_EXECUTOR` | `clientEnv` schema 驗證與實際生效路徑（`vite.config.ts` define / `useGlobalOrbExecutor.ts` 直讀 `import.meta.env`）是两條平行路徑，目前 default 巧合相同，屬隱性風險（非目前缺陷） |
| 命名反向（用戶提示，需在程式碼中額外核對） | `TWO_FACTOR_NOT_ENABLED` 類型 | 使用者指令中提及此類「反向命名」旗標作為範例；本次矩陣資料未包含該確切旗標名於 codebase 中被發現的證據，**列為需再查項**，不臆測其是否存在 |

**死旗標／矛盾／語意陷阱合計：約 8-9 組**（依算法分組：3 個 schema 裝飾欄位算一組、2 個純 client 死旗標組、1 個矛盾、1 個 client-server mismatch、1 個語意陷阱組、1 個裝飾性驗證組）。

---

## 4. 北極星功能在 prod 到底開沒開

| 功能 | 判定 | 依據 |
|---|---|---|
| **PROJECT_HUB**（`VITE_ENABLE_PROJECT_HUB`） | **OFF** | `.env.production` 實測內容（本次直讀）不含此 key；`videoFlags.ts:67` 的 `readFlag("VITE_ENABLE_PROJECT_HUB", false)` 落回 default false。已知項核對成立 |
| **DIRECTOR_WORLD_CONTEXT**（`ENABLE_DIRECTOR_WORLD_CONTEXT`） | **OFF**（生產環境未設定，落回 default OFF） | 本次新驗證：`.env.production` 不含此 key（後端變數，且此檔僅列 client build-time `VITE_*` 變數，看不到 Railway 後端環境變數的真實值）；程式碼 default 為 OFF，`director.ts:140-141` 自陳「預設 OFF＝零行為改變」。**Railway 後端實際是否手動覆寫此變數，本次無法從 repo 檔案確認，標記需再查** |
| **RAG_MEMORY**（`FEATURE_RAG_MEMORY` / 民間別名 `ENABLE_RAG_MEMORY`） | **需再查（推斷傾向 OFF 或視金鑰而定）** | 真正生效邏輯不走 schema，而是 `featureFlags.ts:92-95` 的 `defaultResolver: Boolean(PINECONE_API_KEY)`——即 default 值取決於生產環境是否設定了 `PINECONE_API_KEY`。本次 repo 內 `.env.production` 不含後端 API 金鑰（該檔只放 build-time `VITE_*`），`.env.example:176` 僅示範性列出 `PINECONE_API_KEY=your-pinecone-api-key` 佔位。**無法從 repo 檔案確認 Railway 上是否真的設有 `PINECONE_API_KEY`，故此功能在 prod 是否開啟需向 Bruce/Railway 控制台核對，不臆測** |

**共同盲點**：三者中兩者（PROJECT_HUB 確認 OFF、DIRECTOR_WORLD_CONTEXT 推斷 OFF）目前生產環境都是關閉狀態，屬「北極星功能尚未對外開放」的預期狀態；RAG_MEMORY 則因其 default 機制罕見地綁定金鑰存在性而非布林旗標本身，是本矩陣中**最需要人工二次確認**的一項。

---

## 5. 給 Bruce：最該立刻改 default 的 3 個旗標

1. **`ENABLE_ORB_BUDGET_GUARD`（建議由 OFF → ON）**
   目前是生產環境**唯一**同時覆蓋 `ai.chat` 與 `director.chat` 兩條主要 AI 入口的月度硬阻擋，OFF 狀態下超支沒有任何自動硬性上限，只剩 `ENABLE_BUDGET_ALERTS` 的軟性告警（且告警本身還依賴未知是否設定的 `ALERT_SLACK_WEBHOOK`）。這是本次矩陣中風險最高、覆蓋面最大的單一項目，建議優先評估開啟（`orbBudgetGuard.ts:9-16` 註解本身已寫「需 Bruce 明確開啟」）。

2. **`ENABLE_CODEX_TASKS`（建議：統一雙分支 default，而非改變值本身）**
   `providerRouter.ts` 與 `orbCodeTask.ts` 對同一環境變數的隱含 default 互相矛盾（false vs true），行為取決於呼叫路徑經過哪段程式碼，是本次要求具體點名的「兩處讀取行為不一致」案例。無論最終決定開或關，都應讓兩處 fallback 值一致，避免「registry 認為停用、實際任務卻放行」的邏輯裂縫。

3. **`ENABLE_ORB_IDEMPOTENCY_GUARD`（建議由 OFF → ON，同時擴大覆蓋面）**
   生成類請求（video/image/audio/code/deploy）目前無冪等去重，重複點擊/網路重試有實質重複計費與重複生成風險；且即使開啟也只保護 `ai.chat`，`orbTask.retry` 與 `director.chat` 完全不受保護。建議先在 `ai.chat` 開啟驗證效果，再評估補齊其餘兩入口的冪等保護。

**需再查（default 或 prod 真實值本次無法從 repo 檔案確認）的項目清單**：
- `ENABLE_DIRECTOR_WORLD_CONTEXT` 在 Railway 生產環境的實際覆寫值（repo 內 `.env.production` 只含前端 build-time 變數，看不到後端變數真值）
- `FEATURE_RAG_MEMORY` 的實際生效狀態，取決於 Railway 是否設有 `PINECONE_API_KEY`（本次未讀取任何密鑰值，僅確認 repo 內 `.env.example` 為佔位符）
- `ENABLE_BUDGET_ALERTS` 告警是否真的送達，取決於 `ALERT_SLACK_WEBHOOK` 是否在 Railway 設定（default 空字串，本次未讀密鑰值）
- `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` / `VITE_ENABLE_GLOBAL_ORB_EXECUTOR` 的真實生產值（走 `clientEnv` 以外的平行路徑，本次僅確認機制存在雙軌，未逐一核實 Railway 端實際數值）
- `TWO_FACTOR_NOT_ENABLED` 類反向命名旗標是否存在於 codebase 中——本次矩陣資料未提供其被發現的具體證據，不臆測其存在或狀態
