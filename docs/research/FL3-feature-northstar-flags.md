# FL3 — 功能/北極星旗標 default + 環境落差
- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核範圍：ENABLE_PROJECT_HUB（videoFlags）/4SHELL/DIRECTOR_WORLD_CONTEXT/WORLDBUILDING_PERSIST/WORLD_STYLE_INJECTION/SCHEMA_FIRST_PLANNER/ORB_AGENT/ORB_TASK_*/ORB_LONG_TERM_MEMORY/RAG_MEMORY 等

## 方法論
- Default 一律從「定義檔」讀出：伺服器旗標查 `server/_core/env.validated.ts`（Zod schema `.default(...)`）；
  少數繞過 schema、直讀 `process.env.X` 的旗標（見下方「未進中央 schema」小節）以其讀取點函式的 fallback 值為準。
  前端旗標查 `client/src/config/*.ts` 的 `readFlag(key, fallback)` 呼叫。
- Prod 值：查 `.env.production`（僅含 `VITE_*` 建置期公開旗標，Railway build 時被 COPY 進 image）。
  伺服器端旗標（非 `VITE_*`）**不在** `.env.production`（此檔案明確聲明只放可公開建置旗標），
  其 Railway 正式環境變數本身不在 repo 內、AI 讀不到——若 repo 各 env 範本檔皆未設，一律標「未見覆寫，理論回退 code default（Railway 實際值需再查）」。
- `.env.example` / `dev-environment/.env.dev.example` 是**本機開發範本**，非正式站真值來源，用來比對「dev 慣例值 vs prod 值」是否有落差。

---

## 旗標總表

| 旗標 | Default（定義檔） | Prod 值（`.env.production`） | Gate 什麼 | 安全/計費控制？ | 狀態 | 疑慮 |
|---|---|---|---|---|---|---|
| **ENABLE_PROJECT_HUB**（client, `VITE_ENABLE_PROJECT_HUB`） | **OFF**（`false`）— `client/src/config/videoFlags.ts:67` `readFlag("VITE_ENABLE_PROJECT_HUB", false)` | 未設 → 回退 code default = **OFF** | Story Spine 頂端「創作流程嚮導」（世界觀→劇本→分鏡→生成四步）；`client/src/shells/video/console/StorySpineColumn.tsx:65` `{ENABLE_PROJECT_HUB && <ProjectFlowGuide .../>}`；子元件 `WorldLinkPicker.tsx` 亦掛在此旗標之下 | 否（功能可見性） | **active，dev/prod 落差** | **北極星相關**：`dev-environment/.env.dev.example:28` 顯式設 `VITE_ENABLE_PROJECT_HUB=1`（開發者本機看得到嚮導），但 `.env.production` 完全未列此變數 → 正式站沿用 code default OFF。這正是題目點名的「開發看得到、正式看不到」範例。且此功能整體仍在 `ENABLE_4SHELL` 傘下才可達（雙層 gate，4SHELL 目前 prod ON，所以唯一擋門的就是 PROJECT_HUB 這層）。 |
| **ENABLE_4SHELL**（client, `VITE_ENABLE_4SHELL`） | **ON**（`true`，2026-06-20 起）— `client/src/config/featureFlags.ts:58` `readFlag("VITE_ENABLE_4SHELL", true)` | `.env.production:21` 顯式 `VITE_ENABLE_4SHELL=1` → **ON** | 4-shell 路由總開關：`/video /social /learn /settings` 掛載 + 舊路徑相容導向（`App.tsx` / `shells/shellRouteTable.ts`）；`ENABLE_AIDV_CHROME` 亦被此旗標鎖死（`featureFlags.ts:127-128`，4SHELL OFF 則 chrome 強制 OFF） | 否 | **active，but both-branches-same**（見疑慮） | Code default 已於 2026-06-20 改為 ON，`.env.production` 的 `VITE_ENABLE_4SHELL=1` 現已是**冗餘**設定（拿掉也不變）。真正的落差在 `.env.example`（本機範本）仍寫 `VITE_ENABLE_4SHELL=0`（`.env.example:325`，且該檔头注解稱「全部預設 OFF/未設＝零行為改變」——**此注解已過期**，因為 code default 早已翻成 ON，只有「複製 .env.example 成 .env 並顯式帶入 0」的本機開發者才會退回舊介面）。文件與 code default 不同步，屬「文件落後於 code」的稽核疑慮，非安全性問題。 |
| **DIRECTOR_WORLD_CONTEXT**（server, `ENABLE_DIRECTOR_WORLD_CONTEXT`） | **OFF**（未設為 falsy）— `server/routers/director.ts:150-155` `isDirectorWorldContextEnabled()`：`raw` 為空字串/undefined 一律回 `false` | `.env.production` 未列（此檔只含 VITE_* 建置旗標，且 DIRECTOR_WORLD_CONTEXT 本就是伺服器旗標不會在此檔）；`.env.example:215` 顯式 `ENABLE_DIRECTOR_WORLD_CONTEXT=0` | `director.chat` procedure：帶 `projectId` 時是否 best-effort 載入該專案世界框架摘要並注入 system prompt（`director.ts:253` `if (isDirectorWorldContextEnabled() && input.projectId)`） | 否（純聊天品質功能，載入失敗吞錯不擋 chat） | **active，⚠️ 未進中央 schema** | **北極星相關**：此旗標**完全不在** `server/_core/env.validated.ts` 的 Zod schema 中（`grep ENABLE_DIRECTOR_WORLD_CONTEXT server/_core/env.validated.ts` 零命中）——直接讀 raw `process.env`，繞過 OARS 警告與集中管理。實際 Railway 正式環境是否有人手動設過此變數**需再查**（repo 內無法確認 Railway dashboard 實際值），但**根據 repo 內所有 env 範本檔案，都沒有把它設成 ON**，故目前推定正式站上「導演聊天注入世界框架」這個北極星功能是 **OFF**。 |
| **WORLDBUILDING_PERSIST**（`ENABLE_WORLDBUILDING_PERSIST`） | **不存在此旗標** | 不適用 | 世界觀 DB 持久化（worldbuildingRouter 8 個端點） | 不適用 | **dead-flag / 從未實作**（比 grep-未讀更徹底：連旗標名稱都只出現在測試檔的一句註解裡） | `server/routers/__tests__/worldbuildingRouter.test.ts:4`：「HEAD 版本已實作 DB 持久化（**無** ENABLE_WORLDBUILDING_PERSIST flag guard）」——全 repo 除此測試註解外，找不到任何 `ENABLE_WORLDBUILDING_PERSIST` 的環境變數宣告或讀取點。**世界觀持久化目前是無條件開啟（unconditional），不受任何旗標保護**——這代表題目所列的「北極星旗標組」裡，這一項其實從未被實作成旗標，稽核時不應誤認為「有個關閉開關」；若日後要下線/回退持久化，目前**沒有旗標可用**，只能改碼。 |
| **WORLD_STYLE_INJECTION**（client, `VITE_ENABLE_WORLD_STYLE_INJECTION`） | **OFF**（`false`）— `client/src/config/videoFlags.ts:59` `readFlag("VITE_ENABLE_WORLD_STYLE_INJECTION", false)` | 未設 → 回退 code default = **OFF** | 生成提示詞是否自動 prepend 世界的預設 style profile（繪風/色票/燈光/trigger word），注入點在 `client/src/spine/worldStyle.ts:12`（client 端 dispatch 前純函式組前綴） | 否 | **active，dev/prod 落差** | `dev-environment/.env.dev.example:32` 顯式 `VITE_ENABLE_WORLD_STYLE_INJECTION=1`（開發者看得到跨鏡視覺一致注入），`.env.production` 未列 → 正式站 OFF。與 PROJECT_HUB 同型態的「dev ON / prod OFF」落差，且此為**純前端**旗標，伺服器端無對應開關或校驗——若之後要做「伺服器強制注入」需另立 server 端旗標（仿 `ENABLE_DIRECTOR_WORLD_CONTEXT` 的模式），目前完全靠 client 自律。 |
| **SCHEMA_FIRST_PLANNER**（server, `ENABLE_SCHEMA_FIRST_PLANNER`） | **ON**（`"true"`）— `server/_core/env.validated.ts:555` | 未列於 `.env.production`/`.env.example`/`dev.example` → 各環境一致回退 code default = **ON** | `ai.chat` 是否用 schema-first agent planner（`server/routers/ai.ts:957-960` 讀值，`:1327` 消費；`:1931,:2860,:2870` 與 `capabilityRegistryEnabled && toolRegistryEnabled` 聯集決定是否走 legacy fallback） | 否 | **active，dev/prod 一致（皆 ON）** | 無環境落差；純粹是「全環境預設開」的功能旗標。 |
| **ORB_AGENT**（server `ENABLE_ORB_AGENT` + client `VITE_ENABLE_ORB_AGENT`） | **ON**（雙邊 fallback 皆 `true`）— server: `server/routers/ai.ts:943-946` `isFlagEnabled(process.env.ENABLE_ORB_AGENT ?? (serverEnv as Record<string,string\|undefined>).ENABLE_ORB_AGENT, true)`；client: `client/src/contexts/GlobalOrbChatContext.tsx:2142-2149` `readOrbAgentEnabled()`（未命中 falsy 字串即回 `true`） | 兩邊皆未列於任何 env 範本 → 回退 code default = **ON（雙邊一致）** | 光球代理人總開關：env=OFF 時全域強制關閉（`ai.ts:950-955` `!envOrbAgentEnabled → false`，使用者無法覆寫開回）；使用者個人偏好只能在 env=ON 時把自己降級成純聊天模式 | **是（kill switch，管理員層級）** | **active，⚠️ 未進中央 schema** | `ENABLE_ORB_AGENT` **不在** `env.validated.ts` schema 內；`ai.ts:944` 的 `(serverEnv as Record<string,string\|undefined>).ENABLE_ORB_AGENT` 這段型別轉型形同虛設——因為 Zod `.merge()` schema 解析後會**丟棄未宣告欄位**，`serverEnv.ENABLE_ORB_AGENT` 恆為 `undefined`，實際只吃 `process.env.ENABLE_ORB_AGENT`。功能正確（因為最終仍讀得到 raw process.env），但這行程式碼本身有誤導性（看起來像有 schema 保障，其實沒有），且此旗標拿不到 OARS 缺失警告/自我修復。 |
| **ORB_TASK_STATE_MACHINE**（`ENABLE_ORB_TASK_STATE_MACHINE`） | **ON**（`"true"`）— `env.validated.ts:558` | 未列於任何 env 檔 → 回退 = **ON** | `ai.ts:965-968` 讀值；`_core/featureFlags.ts:163` `ORB_SCHEDULER` 的 `defaultResolver` 也直接讀此值（`=== "true"`）決定排程任務是否自動跑 | 否 | active，dev/prod 一致 | — |
| **ORB_TASK_MEMORY**（`ENABLE_ORB_TASK_MEMORY`） | **ON**（`"true"`）— `env.validated.ts:559` | 未列 → **ON** | `ai.ts:969-972,1005-1007`：OFF 時 `recentTaskMemorySummary` 回文字 "Task memory disabled."，不查任務記憶摘要 | 否 | active，一致 | — |
| **ORB_TASK_RECOVERY**（`ENABLE_ORB_TASK_RECOVERY`） | **ON**（`"true"`）— `env.validated.ts:560` | 未列 → **ON** | `ai.ts:3136-3139`：`orbTask.retry` mutation 內，OFF 時跳過 recovery-plan 產生 | 否 | active，一致 | — |
| **ORB_TASK_EXECUTOR**（`ENABLE_ORB_TASK_EXECUTOR`） | **ON**（`"true"`）— `env.validated.ts:561` | 未列 → **ON** | `orbTask.approve`/`orbTask.cancel`/`orbTask.retry` 三個 mutation 共用同一開關（`ai.ts:3063-3067,3109-3113,3127-3131`，OFF 時直接 `return null`/`{task:null,recoveryPlan:null}`，任務 FSM 完全不可操作）——**這是任務層唯一的總閘**，OFF 會讓整條 orb 多步任務執行鏈失效 | 否（可用性開關，非計費/安全） | active，一致 | 這是「單一旗標控多入口」型態（approve/cancel/retry 三處都各自呼叫 `isFlagEnabled` 判斷，寫法重複但語意一致，非 bug）。 |
| **ORB_LONG_TERM_MEMORY**（`ENABLE_ORB_LONG_TERM_MEMORY`） | **ON**（`"true"`）— `env.validated.ts:562`；另有獨立讀取點 `server/services/orbMemory.ts:43` `process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? "true"`（同預設，未經 schema） | 未列 → **ON** | `ai.ts:973-976,1008-1010,1023-1025`：OFF 時 `recentOrbMemories=[]`、`memoryContext={summary:"Long-term memory disabled.", memoryInjected:false}`，等同關閉 Pinecone-backed 長期記憶注入 planner | 否 | active，一致 | 讀取點分散在兩個檔案各自寫一次 `?? "true"` fallback，但兩處預設值相同，屬「重複但無害」，非 both-branches-same 問題。 |
| **RAG_MEMORY**（`FEATURE_RAG_MEMORY`，經 `featureFlags.isEnabled("RAG_MEMORY")`） | **依 PINECONE_API_KEY 是否存在動態決定**（非固定 boolean）— `server/_core/featureFlags.ts:92-96` `defaultResolver: () => Boolean(serverEnv.PINECONE_API_KEY)`；**只有**顯式設定環境變數 `FEATURE_RAG_MEMORY`（`server/_core/featureFlags.ts:190-194`，前綴規則 `FEATURE_${name}`）才會覆蓋這條動態預設 | `.env.production` 未列 `FEATURE_RAG_MEMORY`（此檔只放 VITE_* 建置旗標，RAG_MEMORY 是伺服器執行期旗標，本就不會出現在這裡）；Railway 正式環境實際 `FEATURE_RAG_MEMORY` 與 `PINECONE_API_KEY` 設定值**需再查**（repo 無法讀 Railway secrets） | `server/services/ragMemory.ts:136,206`：OFF 時直接跳過 Pinecone 寫入/查詢（新記憶不寫、也不回檢索結果） | 否（品質功能，非安全控制） | **active，需再查（環境變數依賴金鑰存在與否，非純靜態 default）** | **北極星相關，最需澄清的一項**：`.env.example:206` 顯式寫 `FEATURE_RAG_MEMORY=false`（本機模板告訴新開發者關掉），但 `env.validated.ts:727-728` 的註解宣稱「selfRepairEnv() 會把使用者設定的 `ENABLE_RAG_MEMORY` 自動重命名為 `FEATURE_RAG_MEMORY`」——**此說法與實際程式碼不符**：`selfRepairEnv()` 的 `ALIASES` 表（`env.validated.ts:90-97`）只處理 `NTHROPIC_API_KEY`/`ANTROPIC_API_KEY`/`NVIDA_API`/`FAL_KEY`/`AUTH_SECRET` 五個別名，**完全沒有** `ENABLE_RAG_MEMORY`→`FEATURE_RAG_MEMORY` 這條映射。若有人依照這段過期註解在 Railway 設定 `ENABLE_RAG_MEMORY=true` 期待生效，**該設定會被完全忽略**，實際仍落回 `Boolean(PINECONE_API_KEY)` 這條動態預設——這是文件與程式碼不同步造成的**語意陷阱（semantic-trap）**，屬本次稽核發現的獨立疑慮，建議另開卡修正註解或補上該別名映射。 |
| **RAG_INJECTION_GUARD**（`ENABLE_RAG_INJECTION_GUARD`，供比對，非本次新查） | **OFF**（未設為 falsy）— `server/services/security/ragInjectionGuard.ts:55-68`，仿 `director.ts` 同型態 | `.env.production`/`.env.example` 均未列 → **OFF** | Context packet 注入防護（`subsystems/contextPackets/contracts.ts:17`：旗標 OFF＝現有拼接位元相同，不做未中和旁系副本檢查） | **是（安全控制，但預設 OFF）** | **已知確認**（題目 X8） | 與 `RAG_MEMORY`（Pinecone 記憶）是**完全不同的兩個旗標**，名稱都含 "RAG" 容易混淆——`RAG_INJECTION_GUARD` 管的是「prompt injection 防護」，`RAG_MEMORY` 管的是「要不要用 Pinecone 記住使用者偏好」，稽核時務必分開處理，勿因命名相似誤判為同一開關。同樣**不在**中央 Zod schema 內，直讀 process.env。 |

---

## 已知事項覆核（依題目要求「確認即可」，本次逐一在程式碼中覆核，結論一致）

| 已知事項 | 覆核結果 | 佐證 |
|---|---|---|
| `ENABLE_RAG_INJECTION_GUARD` 預設 OFF（X8） | **確認** | `server/services/security/ragInjectionGuard.ts:55-68`；`env.validated.ts` 無此欄位（繞過 schema，raw `process.env`） |
| `ENABLE_COST_LEDGER` 預設 OFF（R4/W5） | **確認** | `env.validated.ts:679` `z.string().optional().default("false")`；讀取點 `server/services/cost/ledger.ts:64-72`（HARD SAFETY 註解：只在旗標 ON 時被接線端呼叫）；`.env.production` 未列，`.env.example:304` 顯式 `ENABLE_COST_LEDGER=false` |
| Orb quota guard 只管聊天層（GC2） | **確認** | `ENABLE_ORB_QUOTA_GUARD` 預設 `"false"`（`env.validated.ts:572`），`quotaGuardEnabled` 只在 `server/routers/ai.ts` 的 `ai.chat` mutation 內被消費（行 1643/1683/2049/2507），對 `orbTask.*`（approve/cancel/retry，行 3047 起）整段搜尋**零命中** `quotaGuard`/`ENABLE_ORB_QUOTA_GUARD`——任務執行層完全不受此旗標約束，僅聊天層受控 |
| `FAL_WEBHOOK_FAIL_CLOSED` 單旗標控雙層（W7） | **確認** | `server/routes/webhookFal.ts`：第 82 行控「HMAC 簽章 fail-closed」（production 未設 `FAL_WEBHOOK_SECRET` 時擋）；第 121 行 `verifyFalWebhookToken()` 開頭 `if (!isFalWebhookFailClosed()) return true;` 控「per-job capability token 強制驗證」——兩層共用同一個 `isFalWebhookFailClosed()` 函式（`webhookFal.ts:38-44`），預設 `"true"`（`env.validated.ts:490`） |
| `ENABLE_PROJECT_HUB` prod OFF | **確認** | 見上表；`.env.production` 未列，code default `false`（`videoFlags.ts:67`），`dev-environment/.env.dev.example:28` 卻顯式設 1 → 典型 dev/prod 落差 |
| `ENABLE_4SHELL` prod ON（Y10） | **確認，但補充細節** | `.env.production:21` 顯式 `VITE_ENABLE_4SHELL=1`；**且** code default 本身已於 2026-06-20 起同步翻成 `true`（`featureFlags.ts:58`），故 `.env.production` 的顯式設定目前是冗餘（拿掉也一樣 ON）。真正落差在 `.env.example`（本機範本）仍寫 `0`，屬文件過期而非正式站問題 |

---

## 北極星旗標 prod 值一覽（速查，回答「正式站到底開了沒」）

| 北極星功能 | Prod 是否開啟 | 依據 |
|---|---|---|
| DIRECTOR_WORLD_CONTEXT（導演聊天注入世界框架） | **推定 OFF**（各 env 範本均未開，Railway 實際值需再查） | `.env.example:215` 顯式 0；`.env.production` 未列（伺服器旗標不進此檔）；code default OFF |
| PROJECT_HUB（創作流程嚮導 / 世界觀→劇本→分鏡→生成脊椎） | **OFF** | `.env.production` 未列，code default OFF；僅 `dev-environment/.env.dev.example` 開 1 |
| RAG_MEMORY（Pinecone 長期記憶） | **需再查**（動態取決於 Railway 是否設了 `PINECONE_API_KEY` 或顯式 `FEATURE_RAG_MEMORY`；`.env.example` 範本傾向 false，但那只是本機模板不代表 Railway 真值） | `featureFlags.ts:92-96,190-194` |

---

## 補充：繞過中央 Zod schema 的旗標（架構觀察，非單一 bug）

以下旗標**完全不在** `server/_core/env.validated.ts` 的 schema 中宣告，皆是各自檔案直讀 `process.env.X`（有各自的 fallback 邏輯，功能上不算壞，但拿不到 OARS 缺失警告、拿不到 self-repair 別名修正、且讓「全站旗標清單」不再單一入口）：
`ENABLE_DIRECTOR_WORLD_CONTEXT`、`ENABLE_RAG_INJECTION_GUARD`、`ENABLE_ORB_AGENT`、`ENABLE_WORLDBUILDING_PERSIST`（本項連讀取點都不存在，見上表 dead-flag 說明）。
建議日後新增伺服器端旗標一律走 `env.validated.ts` 集中宣告，避免旗標盤點需要逐檔案 grep 才能找全。
