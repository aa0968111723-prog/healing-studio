# FL4 — 死旗標/兩分支相同/client-server 不一致
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:全部旗標的讀取點;VITE_* client 旗標 vs server 對應

## 方法

Default 一律從定義檔讀出（`server/_core/env.validated.ts` 的 zod schema、
`client/src/lib/env.validated.ts` 的 zod schema、`.env.production`、`.env.example`），
再對每個旗標名做 `grep -rn` 找出所有讀取點（`serverEnv.X` / `clientEnv.X` /
`process.env.X` / `import.meta.env.X`），逐一核對「是否真的有讀取」「多個讀取點
default 是否一致」。讀不到 default 的一律標「需再查」，不臆測。

---

## 一、已知項目（本輪逐一核對，皆確認成立）

| 旗標 | 核對結果 |
|---|---|
| `ENABLE_RAG_INJECTION_GUARD` | 確認：`server/services/security/ragInjectionGuard.ts:55,64,68` — `process.env.ENABLE_RAG_INJECTION_GUARD` 未在 `env.validated.ts` schema 中定義（bypass 驗證層，直讀 `process.env`），程式碼註解與行為皆為**預設 OFF**（未設/空值 = OFF；需明確 `1/true/on/yes` 才開）。無 `.env.production` / `.env.example` 覆寫，故 prod 亦為 OFF。 |
| `ENABLE_COST_LEDGER` | 確認：`server/_core/env.validated.ts:679` 預設 `"false"`；`.env.production` 未設（沿用預設 OFF）；`.env.example:304` 顯式 `ENABLE_COST_LEDGER=false`。讀取點：`server/services/cost/ledger.ts:72`、`server/jobs/costLedgerReconcileJob.ts`（R4/W5 對應）。OFF＝完全不寫 cost_ledger。 |
| `ENABLE_ORB_QUOTA_GUARD`（orb quota guard 只管聊天層） | 確認：唯一讀取點 `server/routers/ai.ts:995-997`（`ai.chat` 路由內），default `false`。全文 grep 找不到 `orbTask.*` 執行層或其他路由讀取此旗標 — 僅 gate 聊天層，符合 GC2 描述。 |
| `FAL_WEBHOOK_FAIL_CLOSED` 單旗標控雙層 | 確認：`server/routes/webhookFal.ts:38-44` 的 `isFalWebhookFailClosed()` 被兩處呼叫 —（1）`verifyFalWebhookToken()` 第 121 行：旗標 OFF 時直接 `return true`（跳過 per-job token 強制）；（2）第 82 行：`FAL_WEBHOOK_SECRET` 未設時，`NODE_ENV==="production" && isFalWebhookFailClosed()` 才 fail-closed。同一 boolean 函式同時決定「token 強制」與「簽章 fail-closed」兩層行為，default `"true"`（`env.validated.ts:490`）。 |
| `ENABLE_PROJECT_HUB` prod OFF | 確認：`client/src/config/videoFlags.ts:67` `readFlag("VITE_ENABLE_PROJECT_HUB", false)` — client-only 建置旗標，default OFF；`.env.production` 未設對應變數，故 prod 沿用 OFF。讀取點：`StorySpineColumn.tsx:65` 掛載 `ProjectFlowGuide`。 |
| `ENABLE_4SHELL` prod ON（Y10） | 確認：`client/src/config/featureFlags.ts:58` `readFlag("VITE_ENABLE_4SHELL", true)` — 2026-06-20 起 code default 已改 ON；`.env.production:21` 顯式 `VITE_ENABLE_4SHELL=1`（prod ON，與 code default 一致，無 client/server 不一致）。**唯一觀察**：`.env.example:325` 仍寫 `VITE_ENABLE_4SHELL=0` 並在檔頭註解「全部預設 OFF/未設＝行為與線上完全一致」——這句話已經**過時**（code 現在預設 ON，`.env.production` 也是 ON），屬文件與現況脫節，非功能性 bug，但足以誤導新人以為「不設就是 OFF」。 |

---

## 二、旗標總表（全部旗標，含讀取點）

「狀態」欄：`active`=正常讀取且分支有效；`dead-flag`=定義但無下游讀取；
`client-server 不一致`=同名或同義旗標在不同端 default 不同；`semantic-trap`=
文件宣稱的行為與實際程式碼不符（旗標本身可能有效，但文件誤導）。

### A. Server 旗標（`server/_core/env.validated.ts`）

| 旗標 | default | prod 值(.env.production) | gate 什麼（讀取點） | 安全/計費控制 | 狀態 | 疑慮 |
|---|---|---|---|---|---|---|
| `ENABLE_GENERATION_LOCK` | `"true"` | 未設(沿用ON) | `server/_core/generationLock.ts:405` | 否（便利鎖） | active | — |
| `ENABLE_ASSET_R2_CASCADE_DELETE` | `"true"` | 未設 | routers asset.delete（`serverEnv.ENABLE_ASSET_R2_CASCADE_DELETE`） | 否 | active | — |
| `SSE_OWNERSHIP_LOCKDOWN` | `"true"` | `.env.example` 建議 true；`.env.production` 未設 | SSE 訂閱鎖門 | **是（IDOR 修補）** | active | — |
| `MIGRATION_FAIL_CLOSED` | `"false"` | 未設 | migration 開機門 | **是（安全/可用性取捨，預設 fail-open）** | active | **安全控制預設 OFF**：migration 真實失敗時預設仍放行開機（沿用舊行為） |
| `CONTENT_SAFETY_FAIL_CLOSED` | `"true"` | 未設 | `checkSafety`（`server/routers.ts`）、`videoStudio.wanTextToVideo` | **是（內容審核，預設 fail-closed）** | active | 與多數旗標「預設 OFF」方向相反，刻意設計 |
| `ENABLE_BUDGET_ALERTS` | `"true"` | 未設 | 用量告警 cron | 否（告警，非硬阻擋） | active | — |
| `ENABLE_ORB_BUDGET_GUARD` | `"false"` | 未設 | `ai.chat`/`director.chat` 月度硬阻擋（AIDV-124） | **是（計費硬控制，預設 OFF）** | active | **安全/計費控制預設 OFF** |
| `STRIPE_WEBHOOK_FAIL_CLOSED` | `""`（空＝依環境判斷） | 未設 | Stripe webhook 驗章 | **是** | active | 空值語意特殊：留空＝僅 production fail-closed，dev/test fail-open；非傳統 boolean-with-default |
| `ENABLE_SCHEMA_FIRST_PLANNER` | `"true"` | 未設 | orb planner | 否 | active | — |
| `VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS` | `"true"` | 未設 | **雙端共讀**：client `useGlobalOrbExecutor.ts:39`（`import.meta.env`）＋ server `routers/ai.ts:962`（`process.env` 直讀，同名變數） | 否 | active | 命名為 `VITE_*` 但被 server runtime 直接讀取（非僅 build-time inject）；是刻意設計成「同一開關兩端共用」，defaults 一致（true/true），非不一致，但命名易誤導人以為僅前端生效 |
| `VITE_ENABLE_GLOBAL_AGENT_TELEMETRY` | `"false"` | 未設 | `shared/global-agent-orchestrator.ts:669` | 否 | active | 同上，`VITE_*` 命名但無 client 端 `clientEnv` 定義對應項（client 端無對照 schema 欄位，純靠 shared 模組直讀） |
| `ENABLE_ORB_TASK_STATE_MACHINE` | `"true"` | 未設 | `routers/ai.ts:966`、`featureFlags.ts:163`(`ORB_SCHEDULER` defaultResolver) | 否 | active | — |
| `ENABLE_ORB_TASK_MEMORY` | `"true"` | 未設 | `routers/ai.ts` | 否 | active | — |
| `ENABLE_ORB_TASK_RECOVERY` | `"true"` | 未設 | `routers/ai.ts` | 否 | active | — |
| `ENABLE_ORB_TASK_EXECUTOR` | `"true"` | 未設 | `routers/ai.ts` 8 處讀取點（3064/3110/3128/3189/3204/3284/3299/3322），皆 `?? true` | 否 | active | 8 處讀取點 default 一致（皆 `true`），非不一致 |
| `ENABLE_ORB_LONG_TERM_MEMORY` | `"true"` | 未設 | `routers/ai.ts` | 否 | active | — |
| `ENABLE_ORB_CODE_COLLABORATION` | `"true"` | 未設 | `server/services/orbCodeTask.ts:23` | 否 | active | — |
| `ENABLE_CLAUDE_CODE_TASKS` | `"true"` | 未設 | `providerRouter.ts:127`（`flag(...,true)`）＋ `orbCodeTask.ts:26`（`?? "true"`） | 否 | active | 兩讀取點 default 一致（true/true） |
| `ENABLE_CODEX_TASKS` | `"false"` | 未設 | `providerRouter.ts:145`（`flag(...,false)`）**vs** `orbCodeTask.ts:30`（`?? "true"`） | 否 | **client-server 不一致（server 內部兩讀取點不一致）** | **⚠ 真實發現**：`providerRouter.ts` 的 provider registry 把 `codex` provider 標為 `enabled:false`（預設關），但真正決定「能否送出 codex 代理任務」的 gate 函式 `isCodeCollaborationEnabled()`（`orbCodeTask.ts:29-32`）在旗標未設時 fallback 是 `"true"`，即**預設放行**。同一旗標、同一 codebase、兩處 default 相反，屬於典型「兩端各判各的」（非 client/server，而是 server 內兩個讀取點語意分歧）。若管理者只看 provider registry 以為 codex 已關閉，實際 orbCodeTask 送出路徑仍會放行。 |
| `ENABLE_ORB_PROVIDER_ROUTER` | `"true"` | 未設 | `routers/ai.ts:987-990` | 否 | active | — |
| `ENABLE_LLM_FALLBACK` | `"true"` | 未設 | LLM engine fallback chain | 否 | active | — |
| `ENABLE_ORB_COST_GUARD` | `"true"` | 未設 | `routers/ai.ts:991-994` | 是（成本防護，預設 ON） | active | — |
| `ENABLE_RETRY_CHAIN_COST_GUARD` | `"true"` | 未設 | orbTask.retry 成本護欄 | 是 | active | — |
| `ENABLE_ORB_QUOTA_GUARD` | `"false"` | 未設 | 見上（GC2，僅 `ai.chat`） | **是（預設 OFF）** | active | **安全/計費控制預設 OFF** |
| `ENABLE_ORB_IDEMPOTENCY_GUARD` | `"false"` | 未設 | `routers/ai.ts:999-1003` | 否 | active | — |
| `ENABLE_ORB_WEB_RESEARCH` | `"true"` | `.env.example` 顯式 true | `ai.chat` 研究階段（Brave+GitHub fallback） | 否 | active | — |
| `ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY` | `"true"` | 未設 | `routers/ai.ts:977-981` | 否 | active | — |
| `ENABLE_GLOBAL_AGENT_TOOL_REGISTRY` | `"true"` | 未設 | `routers/ai.ts:982-986` | 否 | active | — |
| `ENABLE_AGENT_DLQ` | `"true"` | 未設 | `pollDlq` 排程心跳 | 否 | active | — |
| `ENABLE_AGENT_SCOPE_GUARD` | `"true"` | 未設 | `server/services/orbTaskStateMachine.ts:49` | **是（角色範圍強制）** | active | — |
| `PREFER_CHEAP_MODELS` | `"economy"` | 未設 | 模型成本分層 | 是（成本） | active | 非 boolean，字串枚舉；未知值 fallback economy |
| `ENABLE_DATA_RBAC` | `"false"` | 未設 | `assets.teamAssets` 等代表性接點（RBAC 授權過濾） | **是（存取控制，預設 OFF）** | active | **安全控制預設 OFF**（作者已在註解中誠實揭露：全站未接線，僅示範接點） |
| `ENABLE_COST_LEDGER` | `"false"` | `.env.example` 顯式 false | 見上 | 是（計費／稽核） | active | **安全/計費控制預設 OFF**（已知項） |
| `ENABLE_COST_ATTRIBUTION` | `"true"` | `.env.example` 顯式 true | `server/services/cost/costAttribution.ts:54`、`aiProxy.ts:579` | 否（內部觀測，不對使用者收費） | active | — |
| `TWD_PER_USD` | `""` | `.env.example` = `32` | 匯率換算 | 否 | active（非 boolean） | — |
| `OPENPOSE_API_KEY` gate 無 | — | — | — | — | N/A | `.env.example:239` 明言「保留為佔位，不會被任何服務讀取，可留空」——**API 金鑰本身即為文件承認的死變數**，非 boolean flag 但性質相同（定義了卻無讀取點），需和金鑰區分但一併記錄 |
| `ENABLE_SIGNED_URL_UPLOAD` | `"true"` | 未設 | signed-URL 直傳三段式流程 | 否 | active | — |
| `ENABLE_PROMPT_ASSET_LINKS` | `"true"` | 未設 | `server/services/postGenActions.ts:45`（寫入端） | 否 | active | 讀取 procedure（`promptLibrary.linkedAssets`／`assets.linkedPrompts`）明確**不掛**此旗標（`assets.ts:67`、`promptLibrary.ts:364`），僅寫入端受控——這是**設計上刻意**的單邊 gate，非 bug，但稽核時容易誤判為「兩分支不一致」，已在程式碼註解中誠實聲明，故不列為疑慮。 |
| `FEATURE_ADVANCED_SEARCH` | `""` | 未設 | **無**（見下方死旗標分析） | — | **dead-flag** | 見下節詳述 |
| `FEATURE_RAG_MEMORY` | `""` | `.env.example` 顯式 false | **無**（見下方死旗標分析） | — | **dead-flag** | 見下節詳述 |
| `FEATURE_RESEARCH_MODE` | `""` | `.env.example` 顯式 true | **無**（見下方死旗標分析） | — | **dead-flag** | 見下節詳述 |
| `ENABLE_DIRECTOR_WORLD_CONTEXT` | 未在 schema 定義；程式碼 fallback OFF | `.env.example` 顯式 `0` | `server/routers/director.ts:150-151,253` | 否 | active（bypass 驗證層） | 未經 zod 驗證（直讀 `process.env`），但功能正常、唯一讀取點 |
| `ENABLE_RAG_INJECTION_GUARD` | 未在 schema 定義；程式碼 fallback OFF | 未設 | `server/services/security/ragInjectionGuard.ts:68` | **是（prompt injection 防護，預設 OFF）** | active（bypass 驗證層） | 已知項，見上；**安全控制預設 OFF** |
| `FAL_WEBHOOK_FAIL_CLOSED` | `"true"` | 未設 | 見上 | **是** | active | 已知項 |

### B. Client 旗標（`client/src/lib/env.validated.ts` — `clientEnv`）

| 旗標 | default | prod 值 | 讀取點 | 狀態 | 疑慮 |
|---|---|---|---|---|---|
| `VITE_APP_ID` | `""` | 未設 | 僅 schema／`raw` 物件建構，`clientEnv.VITE_APP_ID` **零消費者** | **dead-flag** | 註解自承「legacy Manus OAuth 變數」，已不需要 |
| `VITE_APP_TITLE` | `""` | 未設 | 同上，**零消費者** | **dead-flag** | 無任何 `document.title` 或 UI 讀取，純定義 |
| `VITE_APP_LOGO` | `""` | 未設 | 同上，**零消費者** | **dead-flag** | 同上 |
| `VITE_OAUTH_PORTAL_URL` | `""` | 未設 | 同上，**零消費者** | **dead-flag** | 註解自承 legacy |
| `VITE_API_BASE_URL` | `""` | 未設 | `client/src/main.tsx:117` | active | — |
| `VITE_ANALYTICS_ENDPOINT` | `""` | 未設 | `client/src/main.tsx:92` | active | — |
| `VITE_ANALYTICS_WEBSITE_ID` | `""` | 未設 | `client/src/main.tsx:93` | active | — |
| `VITE_ENABLE_GLOBAL_ORB_EXECUTOR` | `"true"` | 未設 | 實際讀取點是 `client/src/agent/useGlobalOrbExecutor.ts:40` 的 `import.meta.env.VITE_ENABLE_GLOBAL_ORB_EXECUTOR`（**繞過 `clientEnv`**，直讀 raw env，default 同為 true） | active（但 `clientEnv.VITE_ENABLE_GLOBAL_ORB_EXECUTOR` 本身零讀取） | `clientEnv` 驗證層是「裝飾性」——實際生效的是另一條直讀路徑，兩份 default 目前一致（true），但日後若只改其中一處 default 會產生真正不一致 |
| `VITE_ENABLE_ORB_MEMORY_PANEL` | `"false"` | 未設 | **零消費者**（無 `clientEnv.` 讀取、無 raw `import.meta.env` 讀取、對應元件 `OrbMemoryPanel` 在 repo 中不存在） | **dead-flag** | 功能可能已移除或從未實作，旗標仍留在 schema |
| `VITE_ENABLE_CLAUDE_CODE_TASKS` | `"true"` | 未設 | **零消費者**（`clientEnv.VITE_ENABLE_CLAUDE_CODE_TASKS` 全 repo 零讀取） | **dead-flag** | 與 server 端 `ENABLE_CLAUDE_CODE_TASKS`（`providerRouter.ts`/`orbCodeTask.ts`）同名意圖但**client 端從未真正接線**——即所謂「client VITE_ 旗標與 server 對應旗標不同步」的具體案例：client 定義了對應開關卻無 UI 讀它 |
| `VITE_POSTHOG_KEY` | `""` | 未設 | 真正生效路徑是 `vite.config.ts:183-184` 的 `define` 注入 + `client/index.html:111` 的 `%VITE_POSTHOG_KEY%` 樣板替換，**不經過 `clientEnv`** | active（機制上），但 `clientEnv.VITE_POSTHOG_KEY` 本身零讀取 | 同 `VITE_ENABLE_GLOBAL_ORB_EXECUTOR`，`clientEnv` schema 對此欄位是裝飾性驗證 |
| `VITE_POSTHOG_HOST` | `"https://us.i.posthog.com"` | 未設 | 同上（`vite.config.ts:186-187`、`index.html:52,114`），不經 `clientEnv` | 同上 | 同上 |
| `VITE_GITHUB_REPO` | `"aa0968111723-prog/healing-studio"` | 未設 | `client/src/lib/github-url.ts`（4 處） | active | — |
| `VITE_GITHUB_REF` | `"main"` | 未設 | `client/src/lib/github-url.ts`（2 處） | active | — |

### C. `.env.production` 專屬 4-shell 旗標（P0 restructure）

| 旗標 | code default（`featureFlags.ts`/`videoFlags.ts`/`learnFlags.ts`/`settingsFlags.ts`） | prod 值 | 一致性 |
|---|---|---|---|
| `VITE_ENABLE_4SHELL` | `true`（2026-06-20 起） | `1` | 一致 |
| `VITE_SHELL_SOCIAL` | 需再查（`SpineProvider.tsx` 讀取，未逐行核對其 `readFlag` fallback） | `1` | 需再查 fallback 是否也是 ON |
| `VITE_SHELL_LEARN` | 需再查 | `1` | 需再查 |
| `VITE_SHELL_LEARN_RICH` | 需再查（`learnFlags.ts` 提及"預設 ON"） | `1` | 註解稱預設 ON，與 prod 一致 |
| `VITE_SHELL_SETTINGS_RICH` | 需再查（`settingsFlags.ts` 提及"預設 ON"） | `1` | 註解稱預設 ON，與 prod 一致 |
| `VITE_ENABLE_VIDEO_COCKPIT` | `videoFlags.ts:42` 註解稱「預設 ON，但只在 `ENABLE_4SHELL=ON` 時才可達」 | `1` | 一致 |

`.env.example` 對照組（`VITE_ENABLE_4SHELL=0`／`VITE_SHELL_SOCIAL=0`）僅為「範本展示 P0 剛落地時的保守值」，與目前 code default（ON）及 `.env.production`（ON）不同調，屬**文件過時**而非程式行為 bug（見上方已知項一節）。

---

## 三、死旗標詳述（定義了卻從未被讀取）

### 3.1 `FEATURE_ADVANCED_SEARCH` / `FEATURE_RAG_MEMORY` / `FEATURE_RESEARCH_MODE`（server）— 確認死

- **定義**：`server/_core/env.validated.ts:731-733`，皆 `z.string().default("")`，屬 `multimodalSchema`，故 `serverEnv.FEATURE_ADVANCED_SEARCH` 等三個屬性存在。
- **實際生效機制**：`server/_core/featureFlags.ts:189-193` 的 `isEnabled()` 讀的是 **`process.env[\`FEATURE_${name}\`]`**（動態組字串，`name` 為 `"RAG_MEMORY"`/`"RESEARCH_MODE"`/`"ADVANCED_SEARCH"` 等 `FeatureFlagName`），這是**直接讀 `process.env`**，完全繞過 `serverEnv`／zod 驗證層。
- 全 repo grep `serverEnv.FEATURE_ADVANCED_SEARCH` / `serverEnv.FEATURE_RAG_MEMORY` / `serverEnv.FEATURE_RESEARCH_MODE`：**零命中**（除 schema 定義本行外）。
- **結論**：這三個 zod schema 欄位屬於**已定義但從未被讀取的死欄位**——功能本身（RAG_MEMORY / RESEARCH_MODE / ADVANCED_SEARCH 三個 feature flag）確實有效，但生效路徑是 `featureFlags.ts` 直讀 `process.env.FEATURE_*`，与 `env.validated.ts` 裡驗證過的同名欄位是**兩條平行、互不相干的路徑**——`serverEnv.FEATURE_*` 純屬裝飾，可安全移除而不影響任何行為。

### 3.2 「ENABLE_ADVANCED_SEARCH / ENABLE_RAG_MEMORY / ENABLE_RESEARCH_MODE 別名」——文件宣稱之行為不存在（semantic-trap）

- `server/_core/env.validated.ts:727-730` 註解明言：
  > 「selfRepairEnv() 會把使用者設定的 `ENABLE_ADVANCED_SEARCH` / `ENABLE_RAG_MEMORY` / `ENABLE_RESEARCH_MODE` 自動重命名為以下三個標準名稱，因此兩種寫法皆可生效。」
- 實際檢視 `selfRepairEnv()` 的 `ALIASES` 表（`env.validated.ts:90-97`），只有 5 組別名：`NTHROPIC_API_KEY`、`ANTROPIC_API_KEY`、`NVIDA_API`、`FAL_KEY`、`AUTH_SECRET` → 對應到 `ANTHROPIC_API_KEY`/`NVIDIA_API`/`FAL_API_KEY`/`JWT_SECRET`。**完全沒有** `ENABLE_ADVANCED_SEARCH`→`FEATURE_ADVANCED_SEARCH` 這類重命名邏輯。
- `ragMemory.ts:136,206` 的程式碼註解也重複這個「別名」說法（"FEATURE_RAG_MEMORY（別名 ENABLE_RAG_MEMORY）"），但同樣查無對應程式碼實作。
- **結論（semantic-trap）**：若使用者依照這段註解，在 Railway 設定 `ENABLE_RAG_MEMORY=false` 想關閉 RAG，**完全不會生效**（因為沒有任何程式碼讀取 `ENABLE_RAG_MEMORY` 這個變數名，也沒有把它改寫成 `FEATURE_RAG_MEMORY`）。必須直接設定 `FEATURE_RAG_MEMORY=false` 才有效。這是文件與程式碼不同步造成的「使用者側死旗標」，風險等級中——不是安全控制，但會讓維運人員誤以為已關閉某功能。

### 3.3 `ENABLE_CODEX_TASKS` 兩讀取點 default 互斥（server 內部不一致，非 client/server）

已於上表列出，重申關鍵事實：
- `server/services/providerRouter.ts:145` → `flag("ENABLE_CODEX_TASKS", false)`（**default OFF**，且與 `env.validated.ts:565` 的 schema default `"false"` 一致）
- `server/services/orbCodeTask.ts:30` → `String(process.env.ENABLE_CODEX_TASKS ?? "true")`（**default ON**）
- 兩處都在 `server/` 內，都可能在同一次請求鏈路中被查詢（provider 選擇 vs 實際送出任務的 gate），**default 值相反**。若 `ENABLE_CODEX_TASKS` 環境變數完全未設定（多數環境即是如此），`providerRouter` 認為 codex 停用，但 `orbCodeTask.isCodeCollaborationEnabled()` 認為 codex 啟用——這是一個貨真價實的「兩分支/兩讀取點不一致」漏洞，建議修正 `orbCodeTask.ts:30` 的 fallback 為 `"false"` 以符合 schema 與 provider registry 的既定 default。

### 3.4 Client `clientEnv` 死欄位

- `VITE_APP_ID`、`VITE_APP_TITLE`、`VITE_APP_LOGO`、`VITE_OAUTH_PORTAL_URL`：`client/src/lib/env.validated.ts:16-19` 定義，`clientEnv.*` 全 repo零讀取（前兩者/後者皆為 legacy 遺留，其中 `VITE_APP_ID`/`VITE_OAUTH_PORTAL_URL` 程式碼註解已自承 legacy；`VITE_APP_TITLE`/`VITE_APP_LOGO` 則連 legacy 說明都沒有，純粹是「定義了卻從未接上任何 UI」）。
- `VITE_ENABLE_ORB_MEMORY_PANEL`：`client/src/lib/env.validated.ts:24` 定義，全 repo 找不到任何 `OrbMemoryPanel` 元件或此旗標的消費點——功能可能從未落地或已移除，旗標留存。
- `VITE_ENABLE_CLAUDE_CODE_TASKS`：`client/src/lib/env.validated.ts:25` 定義，`clientEnv.VITE_ENABLE_CLAUDE_CODE_TASKS` 全 repo零讀取。**這正是任務要求特別留意的「client VITE_ 旗標與 server 對應旗標不同步」案例**：server 端確實有 `ENABLE_CLAUDE_CODE_TASKS`（`providerRouter.ts:127`、`orbCodeTask.ts:26`，皆 default true 且真的被讀取），但 client 對應的 `VITE_ENABLE_CLAUDE_CODE_TASKS` 只存在於 schema、從未被任何前端元件讀取——即前端「看似有一個開關可以獨立關閉 UI 上的 Claude Code 任務入口」，但實際上該開關完全不生效，前端行為完全由 server 端旗標決定。

### 3.5 `clientEnv` 對 PostHog / GlobalOrbExecutor 是裝飾性驗證（非死但值得注意）

`VITE_POSTHOG_KEY`、`VITE_POSTHOG_HOST`、`VITE_ENABLE_GLOBAL_ORB_EXECUTOR` 三者在 `clientEnv` schema 內定義且做了 zod 驗證，但**實際生效路徑完全繞過 `clientEnv`**：
- PostHog 走 `vite.config.ts` 的 `define` 注入 + `index.html` 樣板字串替換（`%VITE_POSTHOG_KEY%`）。
- GlobalOrbExecutor 走 `useGlobalOrbExecutor.ts` 直接讀 `import.meta.env.VITE_ENABLE_GLOBAL_ORB_EXECUTOR`。

目前兩條路徑（`clientEnv` schema 與實際直讀點）的 default 值恰好相同，因此**尚未**造成行為不一致，但這是一個「隱性風險」：若日後有人只改 `clientEnv` schema 的 default（例如做程式碼審查時誤以為改了這裡就會生效），實際行為不會變，因為真正的讀取點在別的地方。建議之後統一改為單一讀取入口。

---

## 四、需再查（default 讀不到 / 未逐行核對）

- `VITE_SHELL_SOCIAL`、`VITE_SHELL_LEARN` 兩者的 code-side `readFlag` fallback 值未逐行核對（只核對了 `VITE_SHELL_LEARN_RICH`/`VITE_SHELL_SETTINGS_RICH`/`ENABLE_4SHELL`/`ENABLE_PROJECT_HUB`/`ENABLE_VIDEO_COCKPIT` 的實際程式碼），需再查 `SpineProvider.tsx`、`shellRouteTable.ts` 內對應 `readFlag(...)` 呼叫的第二參數。
- `.env.production` 中列出的 `VITE_SHELL_SOCIAL=1`、`VITE_SHELL_LEARN=1` 之 code default 是否也是對應值，僅由檔頭註解「以下程式碼預設已 ON」推論，未逐行 grep 驗證，故標記需再查以符合稽核規則（不臆測）。

---

## 五、安全/計費控制預設 OFF 一覽（風險提示，需特別標注）

以下旗標若「未設定」即維持 **OFF**，代表對應的安全或計費硬控制在預設情境下**不生效**（多數是刻意的漸進式 rollout 設計，非疏失，但仍需集中列出供維運確認）：

| 旗標 | 控制內容 | 預設 |
|---|---|---|
| `ENABLE_RAG_INJECTION_GUARD` | prompt injection 防護（RAG 記憶注入前中和） | **OFF** |
| `ENABLE_COST_LEDGER` | 複式記帳成本帳本（審計用） | **OFF** |
| `ENABLE_ORB_BUDGET_GUARD` | 月度 AI 預算硬阻擋（超額擋 `ai.chat`/`director.chat`） | **OFF** |
| `ENABLE_ORB_QUOTA_GUARD` | 使用者配額硬阻擋（僅聊天層，GC2） | **OFF** |
| `ENABLE_DATA_RBAC` | 資料層存取控制（canAccess 過濾，防跨使用者資料外洩） | **OFF**（作者已誠實揭露僅示範接點，未全站接線） |
| `MIGRATION_FAIL_CLOSED` | migration 失敗時擋開機 | **OFF**（沿用 fail-open 舊行為） |

以下則是**刻意反向設計**（安全控制預設 ON，需明確關閉才會 fail-open，與上表方向相反，一併列出避免誤讀）：

| 旗標 | 控制內容 | 預設 |
|---|---|---|
| `CONTENT_SAFETY_FAIL_CLOSED` | 內容審核逾時/錯誤時擋下內容 | **ON** |
| `FAL_WEBHOOK_FAIL_CLOSED` | fal webhook token 強制 + 簽章 fail-closed（雙層） | **ON** |
| `SSE_OWNERSHIP_LOCKDOWN` | SSE 訂閱擁有權檢查 | **ON** |
| `ENABLE_AGENT_SCOPE_GUARD` | 代理角色範圍強制 | **ON** |

---

## 摘要

- 稽核了 server（`env.validated.ts`）與 client（`env.validated.ts`）兩份 zod schema 共計 60+ 個旗標，加上 `.env.production`/`.env.example` 中的 4-shell 系列旗標，逐一 grep 讀取點。
- **已知六項全部核對成立**，其中 `ENABLE_4SHELL` 額外發現 `.env.example` 檔頭註解已過時（非功能性 bug）。
- **新發現 3 類問題**：
  1. **死旗標（server）**：`FEATURE_ADVANCED_SEARCH`/`FEATURE_RAG_MEMORY`/`FEATURE_RESEARCH_MODE` 三個 zod schema 欄位從未被讀取（真正生效邏輯在 `featureFlags.ts` 動態組字串直讀 `process.env`，繞過驗證層）。
  2. **文件宣稱與實作不符（semantic-trap）**：`env.validated.ts` 註解宣稱 `ENABLE_ADVANCED_SEARCH`/`ENABLE_RAG_MEMORY`/`ENABLE_RESEARCH_MODE` 會被 self-repair 自動改名成 `FEATURE_*`，但 `selfRepairEnv()` 的 `ALIASES` 表中根本沒有這三筆映射——使用者依文件設定這些變數名完全無效。
  3. **同一旗標兩讀取點 default 互斥**：`ENABLE_CODEX_TASKS` 在 `providerRouter.ts`（default false）與 `orbCodeTask.ts`（default true）行為相反，屬於本次任務最具體的「旗標無效/兩分支不一致」案例。
  4. **死旗標（client）**：`VITE_APP_ID`/`VITE_APP_TITLE`/`VITE_APP_LOGO`/`VITE_OAUTH_PORTAL_URL`/`VITE_ENABLE_ORB_MEMORY_PANEL`/`VITE_ENABLE_CLAUDE_CODE_TASKS` 六個 `clientEnv` 欄位全 repo 零消費者；其中 `VITE_ENABLE_CLAUDE_CODE_TASKS` 正是任務點名的「client VITE_ 旗標與 server 對應旗標不同步」範例——server 端同名意圖旗標存在且生效，client 端對應開關形同虛設。
  5. **裝飾性驗證（非死但需留意）**：`VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST`/`VITE_ENABLE_GLOBAL_ORB_EXECUTOR` 的 `clientEnv` schema 驗證與實際生效路徑（`vite.config.ts` define / `index.html` 樣板 / 直讀 `import.meta.env`）是兩條平行路徑，目前 default 巧合一致，未來單改一處會產生實質不一致風險。
