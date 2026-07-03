# K4 — 死碼 / 不可達 / 契約不符 / 假測試 全站系統性掃描

- 產生日期:2026-07-03
- 依據 commit:`4d137bdb907d67e6708ca360a66e89de0a6f2c2e`
- 波次:**深挖 wave K:死碼與契約不符**
- 承接:01-features.md §7(既有死碼/半成品彙總)、G1(VideoCockpit)、G3(178 精靈 case 不可達)、G4(依賴/雜項)、H2(zod 契約 vs UI 落差);本文**不重複**上述已列項目(plans、部分 realEarth、teams.transferOwnership、UNIFIED_SSE_ROUTER、ENABLE_COST_LEDGER 等既有旗標清單、export router、composerTools/workflowAutomationTools、ImageStudio/VideoStudio 欄位落差),只收**新發現**。
- 方法:對 `server/routers.ts` 80 個 appRouter 命名空間逐一 grep 前端 `trpc.<ns>.` 呼叫比對零呼叫者;對 zod schema 逐欄核對 UI 消費;對 `client/src/config/featureFlags.ts`+`server/_core/featureFlags.ts`+`process.env.ENABLE_*` 逐一查讀取點;抽樣審讀 server/**/*.test.ts 的 mock 深度;對 `server/services/*.ts`(123 檔)/`client/src/components/*.tsx`(94 檔)逐檔 grep 站內零引用;對 `server/_core/index.ts` 的 30 個排程 job 追蹤資料寫入/讀取鏈。

---

## 1. router 註冊但前端零呼叫(新增 12 個完整命名空間 + 1 個誤判修正)

對 80 個 appRouter 命名空間逐一 `grep -r "trpc\.<ns>\." client/src`,**15 個回傳 0**;扣掉任務已知的 `plans`、`export`(01 §7 已列),以下為**新確認**、且複查過整個 repo(含 scripts/server 自身)確定無任何呼叫者的完整命名空間:

| 命名空間 | 檔案 | 內容 | 證據(零呼叫) | 影響 |
|---|---|---|---|---|
| `orbCapabilities` | server/routers/orbCapabilitiesRouter.ts:32-67 | 光球能力 manifest API(list/suggestImageEditModels) | **router 自己的檔頭註解就寫明**「確認過 client 與 server 都沒人呼叫(0 callers)」(:39) | 整支 API 從寫好那天起就是死的,連作者自己都記錄了 |
| `apiKey` | server/routers/apiKeyRouter.ts(AIDV-276,全 81 行) | 程式化 API 金鑰 create/list/revoke(`aidv_<40hex>`,scopes video:create/read) | client/src 全站 0 個 `trpc.apiKey.` 呼叫;唯一同名字串命中是 SettingsPage 的 `admin.apiKeysStatus`(**不同功能**——那是後台顯示平台金鑰健康狀態,非本使用者級 CRUD) | 使用者永遠無法建立/查看/撤銷程式化金鑰,整個 AIDV-276 功能無 UI 入口 |
| `auditLog` | server/routers/auditLog.ts(AIDV-123,events+export) | Admin 稽核軌跡分頁查詢+CSV 匯出 | 0 呼叫;AdminPage 的 activity 分頁走的是別的資料源(users 使用統計),與此 router 無關 | 稽核資料寫得進去(recordAuditEvent 多處在用)、查不出來——只能靠 DB 直查 |
| `agentCapability` | server/routers/agentCapabilityRouter.ts(AIDV-323,256 行) | 動態代理 register/heartbeat/assign/listActive(依 capability+負載派工) | 0 呼叫;`server/routers/__tests__/multiAgentPipeline.integration.test.ts`(457 行)有完整測試但呼叫者是測試本身,非產品程式碼 | 見 §4——「測得很仔細的死碼」 |
| `agentWorkflow` | server/routers/agentWorkflowRouter.ts(AIDV-339,84 行) | reportValidation/getValidationState/clearValidation(給自動化 agent 回報 tsc/vitest 失敗) | 0 呼叫 | 見 §6——唯一寫入者死了,連帶讓下游 cron 空轉 |
| `orbTraces` | server/routers/orbTraces.ts(54 行) | 光球任務 trace 除錯:getTrace/listUserTraces/getTimeline/exportTrace(langfuse/langsmith/otlp)/analyzeFailures | 0 呼叫 | orbTaskTracer 服務有在記(executor 側稽核鏈路),但查詢/視覺化/匯出全無 UI,除錯資料只進不出 |
| `rbac` | server/routers/rbac.ts(AIDV-121,302 行) | **全部 4 個 procedure**:share / revokeShare / listShares / transferOwnership | 0 呼叫(不只任務已知的 transferOwnership 一個 procedure,share/revokeShare/listShares 這三個「純加法、不受旗標 gate」的也是 0) | 資料層顯式共享機制整組寫完(含擁有權驗證+稽核)但前端沒有任何「共享這個資源」按鈕,ENABLE_DATA_RBAC enforcement 旗標 OFF 之外,連建立共享關係的入口都不存在 |
| `webhook` | server/routers/webhook.ts(AIDV-269,223 行) | 創作者 webhook 訂閱管理:list/create/update/delete/deliveryHistory/test,含 SSRF 檢查+每人上限 5 個 | 0 呼叫;`client/src` 唯一命中的 "Webhook" 字串是 AssetsLibrary 篩選分類 label,與此 router 無關 | video.completed/video.failed 事件的第三方 webhook 通知整組功能沒有設定介面 |
| `externalServices` | server/routers/externalServices.ts(307 行) | 第三方服務訂閱管理(fal/ElevenLabs/Pinecone/LangSmith/Replicate):list/upsert/delete/summary(admin only) | 0 呼叫 | 與 G4 已列的孤兒 `config/pricing-table.json` 同一類「成本追蹤基建蓋了但沒人用」——11 個 AdminPage 分頁沒有一個對應這支 router |
| `system` | server/_core/systemRouter.ts(41 行) | health/engineStatus/notifyOwner | 0 呼叫;`server/_core/index.ts:892` 另有**獨立**的原生 Express `/api/health`,Railway 健康檢查走的是那支,不經 tRPC | `system.health`/`engineStatus` 整組零消費;`notifyOwner` procedure 本身零呼叫,但底層 `notifyOwner()` 函式其實活著——feedback.ts、modelWishesRouter.ts 直接呼叫該函式(繞過 tRPC 包裝) |
| `videoAnalytics` | server/routers/videoAnalyticsRouter.ts(AIDV-272,158 行) | track(播放事件)+getSummary(分析摘要) | 0 呼叫;VideoStudio/播放器全站無一處呼叫 `track` | 見下方「契約不符」——docstring 自稱「公開,支援匿名訪客」但程式碼已因 AIDV-821 改 protectedProcedure,文件與程式碼不同步;而且不管公開與否,反正零呼叫,`video_analytics` 表永遠是空的,`getSummary` 永遠回空結果 |
| `adminEval` | server/routers/adminRouter.ts(7 行) | runAgentEval(跑 BUILTIN_AGENT_EVAL_CASES) | 0 呼叫 | Eval 只能靠開發者直接 import `runAgentEval` 跑,AdminPage 沒有「跑評測」按鈕 |
| `musicSpecialist`(**修正 G3 誤判**) | server/routers/musicSpecialist.ts(113 行) | recommendEngine/listEngines/estimate/getRecentAssets | G3 文件寫「⚠️ 與 trpc.musicSpecialist.* 共用同一實作(router 活路)」——**經本次複查,client/src 全站 0 個 `musicSpecialist` 字元命中(含註解)**,連 ProStudio、OrbCreationStage 都沒有(檔頭註解明寫是為了這兩處寫的);對照同理由建的 `accountant` router 確實在 OrbUnifiedAssistant.tsx 有 3 處真呼叫,`musicSpecialist` 是唯一那個「說要給前端用、前端從未接線」的手足 | 更正 G3 §2.1 表格對 音音 一列「4 個另有 tRPC router 活路」的結論——那條活路從未被踩上去 |

**新增統計**:80 個命名空間中 **15 個**(19%)前端零呼叫,扣掉任務已知的 2 個(plans/export),**新確認 12 個完整孤兒 router + 1 個 G3 誤判修正**,共影響 1,663 行後端程式碼(逐檔行數加總)。

---

## 2. zod 契約 vs UI 不符(新增:settings.update 的 13 個死欄位)

延續 H2(ImageStudio/VideoStudio 欄位字典),本次抽查 `settings.ts`(個人偏好設定,22 個 zod optional 欄位)vs 唯一寫入端 `client/src/shells/settings/panels/GeneralSettingsPanel.tsx`:

- **GeneralSettingsPanel 的 `save()`(:47-52)只送出 8 個欄位**:uiTheme、accentColor(UI 無控制項,只是回顯原值)、fontScale、reducedMotion、emailNotifications、generationCompleteNotify、weeklyDigestEnabled、locale/timezone。
- **zod schema 定義的另外 13 個欄位,全站(client+server 除 settings.ts/drizzle/schema.ts 本身)搜尋 0 引用**:`analyticsConsent`、`crashReportConsent`、`shareUsageData`、`showProfilePublicly`、`sidebarCollapsed`、`defaultModality`、`defaultCreativeMode`、`autoSaveHistory`、`nsfwFilter`、`autoBackupEnabled`、`backupFrequency`、`backupRetentionDays`、`extraSettings`(除了 PersonalSettingsContext.tsx 借用 extraSettings.personal 當額外儲存槽,非原始語意)。
  - 證據:`server/routers/settings.ts:43-68`(zod 定義)vs 全站 grep,每個欄位名只在 settings.ts + drizzle/schema.ts 出現,無第三處。
  - **`nsfwFilter`(預設 true)是最嚴重的一個**:欄位名稱與型別暗示「使用者可關閉 NSFW 內容過濾」,但沒有 UI 可改、也沒有任何生成/審核程式碼讀取這個使用者偏好去決定是否過濾——真正的內容審核走 `moderateOrbContent`(G3 §1.1 已載,per-step 強制審核,不吃這個 per-user 設定)。也就是說這個欄位**看起來像一個安全控制項,實際上完全不影響任何行為**。
  - **`autoBackupEnabled`/`backupFrequency`/`backupRetentionDays`/`lastBackupAt` 是一組偽裝成「per-user 可調備份設定」的死欄位**:同名概念的**真正**備份機制是 `server/jobs/dbSnapshotJob.ts`(ENABLE_DB_BACKUP 環境旗標,預設 ON,全站單一排程、非 per-user),兩者完全不相干——`dbSnapshotJob.ts` 全文 grep 不到 `backupFrequency`/`backupRetentionDays`/`system_settings`/`getSystemSettings` 任何一個字。使用者若真的去 API 層手動送 `settings.update({backupFrequency: "daily"})`,zod 會接受、DB 會寫入、但**沒有任何程式碼會再讀出來用**。
- 影響:22 個欄位中 13 個(59%)是死欄位;其中 nsfwFilter 屬於「看似安全控制、實則空轉」的高風險錯覺,backup 四欄屬於「兩套同名機制互不相干」的契約錯覺。

---

## 3. feature flag 空轉(新增:FeatureFlagService 12 選 10 未接線)

`server/_core/featureFlags.ts`(339 行)是一整套設計完整的 runtime flag 服務(env 覆寫→runtime overrides→cached default resolver,含 `getAllStatuses`/`logStartupState`/`FlagDisabledError` 優雅降級模式),定義 12 個旗標:`RAG_MEMORY`、`RESEARCH_MODE`、`ADVANCED_SEARCH`、`LLM_CACHE`、`REQUEST_DEDUP`、`PERFORMANCE_METRICS`、`IMAGE_GENERATION`、`VIDEO_GENERATION`、`AUDIO_GENERATION`、`VOICE_CLONING`、`MODEL_TRAINING`、`ORB_SCHEDULER`。

- **逐一 grep `featureFlags.isEnabled(...)` / `.require(...)` / `.withFallback(...)` 的呼叫點,全站只有 3 個檔案在用,且只餵了 2 個旗標名**:`teachingArchiveRag.ts`(RAG_MEMORY ×3)、`ragMemory.ts`(RAG_MEMORY ×2)、`ai.ts:1351`(RESEARCH_MODE ×1)。
- **其餘 10 個旗標(ADVANCED_SEARCH、LLM_CACHE、REQUEST_DEDUP、PERFORMANCE_METRICS、IMAGE_GENERATION、VIDEO_GENERATION、AUDIO_GENERATION、VOICE_CLONING、MODEL_TRAINING、ORB_SCHEDULER)定義完整的 `fallbackHint`(如 IMAGE_GENERATION 寫「Image generation endpoints will return 503」、MODEL_TRAINING 寫「Model training jobs will be rejected」),但全站沒有任何程式碼呼叫 `isEnabled()`/`require()` 檢查這些旗標名**——真正的圖像/影片/音訊生成、LoRA 訓練端點走的是別條路徑(falDispatcher 直接檢查 API key 是否存在),完全不經過這個 FeatureFlagService。
- 證據:`server/_core/featureFlags.ts:91-166`(FLAG_DEFINITIONS 12 個定義)vs `grep -rln "featureFlags\.\(isEnabled\|require\|withFallback\)"` 全站僅 3 檔;`logStartupState()` 在 `server/_core/index.ts:385` 開機會呼叫、印出全部 12 個旗標的 enabled/disabled 狀態到 log,但除了 RAG_MEMORY/RESEARCH_MODE 外,其餘 10 個的 log 輸出**對任何行為都沒有影響**——是純觀察性的裝飾輸出。
- 影響:這是一整套「看起來像全站生成開關總閘」的基礎設施,83%(10/12)是純裝飾;若有人真的把 `FEATURE_IMAGE_GENERATION=false` 設進環境變數,以為能緊急關閉圖像生成,**實際上什麼都不會發生**——圖像生成端點完全不檢查這個旗標。

---

## 4. 假測試(新增:four-area-audit.test.ts 全檔案級假測試)

延續 G3 對 `planExecutorTools.test.ts` 等「mock 掉 executeOrbToolCalls 導致零覆蓋」的發現,本次對 server/**/*.test.ts(365 檔)做抽樣審讀。**結論:多數重度 mock 的測試(webhookFal/webhookSuno、contentModerationWiring、orb-3d-routing 等)其實只 mock 外部 I/O 邊界(db/S3/fal/LLM 上游),核心業務邏輯(參數映射、fail-open/fail-closed 分支、審核閘)是真跑的——不是假測試。真正的重災區是少數幾個「審計風格」檔案:**

### 4.1 旗艦案例:`server/four-area-audit.test.ts`(225 行,30 個 it,33 個 expect)

全檔案針對「角色鍛鍊所/一致性保險箱/創意排程/共享空間」四大區塊聲稱做前後端接線稽核,但:

- **11/33(33%)assertion 是純字面 `expect(true).toBe(true)`**(:15、:55、:59、:93、:97、:107、:143、:147、:157、:161、:179 等),測試標題聲稱驗證具體事實(如「models router should have myModels procedure」:7、「Calendar uses notes.list to fetch all notes」:106),但函式體從不呼叫任何真實 API、不 import 真實 router 去驗證——**無論後端程式碼變成什麼樣,這 11 個測試永遠是綠燈**。
- 其餘 22 個「非 true.toBe(true)」的 assertion 也大多是**自我循環驗證**:例如 :18-34「models.create should accept dataset images for LoRA」自己手寫一個 `schema = {...}` 物件字面量,然後 `expect(schema.datasetImages).toHaveLength(1)`——這是在驗證「我剛寫的物件有一個元素」,從未 import 或呼叫真正的 `models.create` zod schema/procedure;:36-40「vault CRUD operations should be complete」自己宣告 `const operations = ["list","create","update","delete"]` 再逐一 `expect(op).toBeTruthy()`——這是驗證字串字面量非空,與 vault router 是否真的有這 4 個 procedure 毫無關係。
- **對照組(同樣命名 `*-audit.test.ts` 但寫得對的例子)**:`server/phase3-audit.test.ts`(418 行,32 個 it)是真測試——`import { appRouter } from "./routers"` 後用 `appRouter.createCaller(ctx)` 打真實 procedure,斷言 `.rejects.toThrow()`、驗證 zod enum 真的拒絕非法值(:41-61)。這證明同一個「-audit.test.ts」命名慣例下,測試品質落差極大,不能只看檔名判斷。
- 全站 `expect(true).toBe(true)` 字面量:`grep -rc` 只命中 3 個檔案(`server/four-area-audit.test.ts` ×11、`server/services/__tests__/agentDelegationService.test.ts` ×1、`server/_core/videoIdorConvergence.test.ts` ×1),後兩者的其他 assertion 是真的(videoIdorConvergence 的那一句是「兩種情境都已覆蓋」的收尾判斷,不是主要邏輯洞;agentDelegationService.test.ts 檔頭直接自稱 "placeholder",是唯一一個 it block 且誠實標註)。

### 4.2 統計估計(基於抽樣,非全數 602 檔逐一審讀)

- 抽樣方法:①全文比對 `expect(true).toBe(true)` 字面量(3 檔命中);②抽查 vi.mock 數量前 20 名的「重度 mock」檔案(webhookFal/webhookSuno/contentModerationWiring/directorBatchSession/multiAgentPipeline/brain-auto-repair/orb-3d-routing 等 20 檔逐檔讀取);③抽查 `*audit*.test.ts`/`*wiring*.test.ts` 命名慣例的檔案(9 檔)。
- 抽樣所見:**20+9=29 個抽查檔案中,只有 1 個(four-area-audit.test.ts)屬於「整檔案級」假測試**;其餘要嘛正確地只 mock 外部邊界(webhookFal/Suno、contentModerationWiring、orb-3d-routing),要嘛雖然測試對象本身是死碼但測試邏輯是真的(agentCapabilityRouter 的 multiAgentPipeline.integration.test.ts——見下方交叉引用)。
- **保守估計**:602 個測試檔中,像 four-area-audit.test.ts 這種「整檔案自我循環驗證、核心斷言恆真」的假測試檔案規模約在 **個位數到十餘檔(1-2%)**,而非系統性問題;真正該關注的反而是「測試品質很好、但測試對象是零呼叫者死碼」這一類(見下方)——`server/routers/__tests__/multiAgentPipeline.integration.test.ts`(457 行、11 個 it、完整 in-memory DB 模擬)把 §1 列出的 `agentCapability` router(0 前端呼叫)測得非常仔細,是「測試寫得認真但測的東西沒人用」的代表案例,這比「假測試」更隱蔽——CI 綠燈會讓人誤以為這是活躍維護中的核心功能。

---

## 5. 孤兒元件/服務

### 5.1 server/services 零引用(全站 grep,含測試自身路徑排除)

| 服務 | 行數 | 內容 | 證據 |
|---|---|---|---|
| `collaborativeTaskPlanner.ts` | 405 | 把複雜任務拆解成多代理子任務+建協作執行計畫,import `AgentCollaborationOrchestrator` | 全站(除自身)0 引用 |
| `skillOrchestrator.ts` | 453 | AIDV-128 S-3:執行 official Skills workflow preset(讀 OFFICIA_SKILLS→驗證→dispatchOfficialSkill→寫 `orbWorkflowStepExecutions`→失敗重試+ConfirmGate 人工確認暫停) | 全站(除自身)0 引用;是三者中設計最完整的一個,連 DB schema 欄位都配好了 |
| `modelRouter.ts` | 23 | `executeModelTask`:依 `MODEL_CAPABILITY_REGISTRY` 查模型→查 env key→dispatch | 全站(除自身)0 引用 |

**連鎖孤兒**:`shared/model-capability-registry.ts` 的 `MODEL_CAPABILITY_REGISTRY` 匯出**只有 `modelRouter.ts` 一個消費者**(grep 全站僅 2 檔命中:定義檔本身+ modelRouter.ts),而 `modelRouter.ts` 本身又是零呼叫孤兒——這是一條「shared 註冊表 → 孤兒 service → 無人呼叫」的兩層死鏈,與已知的 composerTools/workflowAutomationTools(G3)同屬一類但這次是全新的三個檔案。

### 5.2 client/src/components 零引用(94 個頂層 .tsx 逐檔比對)

| 元件 | 行數 | 內容 | 備註 |
|---|---|---|---|
| `Mascots.tsx` | 12 | 檔頭自述「Legacy compatibility — all mascot components are replaced by ZenCoPilot,this file re-exports the Zen components so existing imports don't break」 | **連這個相容性 re-export 殼本身都零引用**——它想保護的舊 import 路徑早就沒人在用了,是「防止破壞」的防禦碼變成了雙重死碼 |
| `SpiritHandoffIndicator.tsx` | 198 | 完整的「{精靈A} 💡→🎨 {精靈B}:handoff 原因」動畫過場 UI,對應 G3 §2.4 的 `spirit-handoff-protocol.ts` 資料結構 | G3 已指出 handoff 協議「純 data,實跑仍由 orchestrator 決定」——這裡補上：連給人看的視覺化元件都寫好了,但從未被任何頁面掛載,handoff 事件目前完全不可視 |
| `FrameTimeline.tsx` | 168 | 圖片上傳時間軸 UI(上傳/移除/loading 狀態) | 零引用 |
| `PageSidebar.tsx` | 179 | 可收合側欄元件(展開/收合按鈕) | 零引用 |
| `VibeCardWizard.tsx` | 100 | 氛圍/心情卡片選擇精靈,import `VIBE_CARDS` | 零引用;VIBE_CARDS 本身在 ImageStudio 的 VibeSelector 另有消費者,只是這個 wizard 版本沒人用 |
| `ScrollToTop.tsx` | 63 | 捲動超過門檻才出現的回頂部按鈕 | 零引用 |
| `OrbFloatButton` | — | 01 §7 已列(重申,非新發現) | — |

共 6 個新發現的零引用頂層元件(合計 705 行)+ 1 個既有已知項。

---

## 6. cron 註冊但實際空轉(新發現:agentDlqPoller 監控一個永遠不會有新資料的表)

`server/jobs/agentDlqPoller.ts`(59 行)每 5 分鐘呼叫 `pollDlq()`(:49 `cron.schedule("*/5 * * * *", runPoll)`,`ENABLE_AGENT_DLQ` 預設 true 恆啟動),檢查 `agent_dlq` 表未解決條目數、有則 warn 提示人工介入。

**追資料鏈發現:全站唯一寫入 `agent_dlq` 的呼叫是 `insertDlqEntry`(server/services/agentDlq.ts),而 `insertDlqEntry` 唯一呼叫者是 `server/routers/agentWorkflowRouter.ts` 的 `reportValidation` procedure**(grep 全站確認:`insertDlqEntry` 只出現在 agentDlq.ts 定義處+agentDlq.test.ts+agentWorkflowRouter.ts 這三處)。而 §1 已確認 `agentWorkflow`(含 `reportValidation`)**全站零呼叫者**——沒有前端、沒有腳本、沒有其他 server 程式碼會去打這支 procedure。

**結論**:`agentDlqPoller` 這支 cron 從系統上線至今,每 5 分鐘跑一次,**`agent_dlq` 表永遠是空的**,`pollDlq()` 永遠回傳 `escalated=0 retried=0 decisions=0`,對應的 warn 分支永遠不會觸發。這是一個「監控端做好了、被監控的資料源從未被啟用」的完整空轉鏈,且與 §1 的 `agentWorkflow` 死 router 是同一條斷鏈的兩端——修 §1 的死 router(接上真正的 agent 回報流程)才能讓這支 cron 真正產生意義。

---

## 7. 統計彙總

| 類別 | 新發現數量 | 規模 |
|---|---|---|
| 完全零呼叫的 tRPC router(不含已知 plans/export) | 12 個命名空間 + 1 個 G3 誤判修正 | 1,663 行後端程式碼 |
| zod 契約定義但無 UI/無讀取的死欄位 | settings.update 22 欄中 13 個(59%) | 1 個 router,含 1 個安全性錯覺(nsfwFilter)+1 組雙軌錯覺(backup 4 欄) |
| feature flag 服務定義但未接線 | FeatureFlagService 12 個旗標中 10 個(83%) | 1 個核心 flag service(339 行),影響「緊急關閉生成」類運維假設 |
| 假測試(整檔案級) | 1 個確認(four-area-audit.test.ts) + 抽樣估計全站約 1-2%(個位數~十餘檔/602) | 33 個 assertion 中 11 個恆真 |
| 孤兒服務(server/services) | 3 個(collaborativeTaskPlanner/skillOrchestrator/modelRouter) | 881 行 + 1 條 shared 註冊表連鎖死鏈 |
| 孤兒元件(client/src/components 頂層) | 6 個新增 | 705 行 |
| cron 空轉 | 1 個確認鏈(agentDlqPoller ← agentWorkflowRouter 死 router) | 每 5 分鐘一次的恆零結果排程 |

**跨類別交叉發現**(本次獨有價值):§1 的 `agentWorkflow` 死 router 直接導致 §6 的 cron 空轉;§1 的 `agentCapability` 死 router 反而被 §4 提到的 `multiAgentPipeline.integration.test.ts` 測得極其仔細(457 行測試 vs 0 個真實呼叫者)——是「良好測試覆蓋率」與「零產品使用」共存的具體案例,提醒不能只看測試覆蓋率判斷程式碼是否活著。

---

## 8. 未查完部分

- §1 只查了「命名空間層級零呼叫」;80 個 router 中「有呼叫但只用了一半 procedure」的更細粒度落差(如 H2 對 imageStudio/videoStudio 做的欄位級比對)未對其餘 78 個 router 逐一複查,只抽查了 settings.ts。
- §3 只逐一核對了 `server/_core/featureFlags.ts` 這一套 FeatureFlagService(12 旗標);`process.env.ENABLE_*` 裸讀的 60+ 個環境旗標(未經此 service 包裝的)只做關鍵字列舉,未逐一核對「兩分支行為是否相同」。
- §4 假測試估計基於 29 個抽樣檔案(20 重度 mock + 9 audit/wiring 命名慣例),未對 602 個測試檔(或 server 內 365 個)逐檔全文讀取;不同抽樣策略可能發現更多或更少假測試檔案。
- §5 只對 `server/services` 頂層 123 檔與 `client/src/components` 頂層 94 檔做零引用掃描;`client/src/pages/`、`client/src/shells/`、`server/services/spiritTools/`(30 檔,G3 已覆蓋)、`server/jobs/` 內部子模組未做同等孤兒掃描。
- §6 只追了 `agentDlqPoller` 一條鏈;其餘 29 個排程 job(`server/_core/index.ts` SCHEDULED_MAINTENANCE_JOBS)未逐一核對其讀寫表是否真的有其他生產者/消費者。
- 未實測執行(無資料庫連線環境):所有結論皆基於靜態 grep + 程式碼閱讀,未實際啟動伺服器驗證「零呼叫」在執行期是否有例外路徑(如測試環境專用的呼叫、feature-flag 後才顯示的隱藏 UI 入口)。
