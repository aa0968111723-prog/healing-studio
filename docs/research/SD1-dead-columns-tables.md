# SD1 — 死欄位/死表
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:drizzle/schema.ts 全表 × 各欄位;Grep 使用點

## 方法論

1. 從 `drizzle/schema.ts`(4758 行,102 張 `mysqlTable`,1325 個欄位)抽取全表/全欄位清單。
2. 對每個候選欄位 / 表名,以 word-boundary grep 掃過 `server/ client/ shared/ db/ scripts/ tests/`(排除 `drizzle/schema.ts` 本身與 drizzle 自動產生的 `drizzle/relations.ts`,因為兩者只是「宣告」不是「使用」)。
3. 對「0 命中」與低命中(≤2)候選逐一 Read 上下文確認,排除下列假陽性:
   - 欄位以不同 DB 欄名對映(例如 JS 用 camelCase、實際 `int("snake_case")`),先確認兩種寫法都查過。
   - 欄位只在 raw SQL(字串)中以 snake_case 出現(例如 `email_verification_tokens`),需額外 grep 表名字串本身。
   - 欄位只被 seed/文件字串(`server/routers/learnHub.seed.ts`)提及,不算真正使用點。
4. 抽樣以「大表」與「已知可疑區」優先(userAiBrain 58 欄、agentPreferences 38 欄、system_settings 27 欄、teachingMaterials 29 欄、customBlocksCombo 26 欄……),非逐一 4758 行地毯式核對——務實抽樣,已在下方逐項標明查證深度。

---

## 嚴重度:高

### H1〔dead-table〕`agent_collaboration_steps` / `agent_collaboration_messages` 全表死碼(協作步驟與訊息持久化從未接線)

- **發現**:`drizzle/schema.ts:2506`(`agentCollaborationSteps`)與 `drizzle/schema.ts:2554`(`agentCollaborationMessages`)兩張表定義完整(索引、外鍵語意欄位齊全),但除了 `drizzle/schema.ts` 自身與自動產生的 `drizzle/relations.ts`(`drizzle/relations.ts:36-37,395-411`,純關聯宣告非使用),全 repo(`server/ client/ shared/`)**零讀零寫**。
- 已 Grep 確認實際負責協作流程的 `server/services/agentCollaborationOrchestrator.ts`(888 行)只 import 並使用 `agentCollaborationSessions`(`:39`,寫入於 `:440`)與 `agentCollaborationHandoffs`(`:40`,寫入於 `:680`),完全沒有 `steps`/`messages` 的 insert/select——即該協作引擎目前把「步驟」與「跨代理訊息」都留在記憶體,從未落地到這兩張表。
- **影響**:兩張表(含索引:`acst_collab_order_idx`、`acst_collab_status_idx`、`acst_agent_role_idx`、`acm_collab_timestamp_idx`、`acm_correlation_idx` 等共 9 個索引)完全是死重量——建表/索引成本、`drizzle-kit` schema diff 噪音、未來開發者誤以為「協作步驟有持久化審計」。
- **建議**:若協作步驟/訊息審計仍是既定需求→接線進 `agentCollaborationOrchestrator.ts`(半成品,補上 insert 呼叫);若已確定不做→連同 9 個索引一起 drop table。

### H2〔dead-table〕`agent_performance_metrics` 全表死碼

- **發現**:`drizzle/schema.ts:2623` 定義完整(`agentDateIdx` 索引),全 repo 除 schema.ts 外零命中,`server/services/agentCollaborationOrchestrator.ts` 與其他協作相關服務都未寫入任何一筆每日代理績效彙總。
- **影響**:同 H1——表 + 索引空轉。
- **建議**:確認是否仍在規劃中(可能是 orb 15 精靈績效儀表板的預留欄位);若無明確排程,建議標記 deprecated 並移除。

### H3〔dead-table〕`custom_blocks_combo`(26 欄)與活表 `block_combos` 疑似重工/廢棄前身

- **發現**:`drizzle/schema.ts:1637`(`customBlocksCombo`,對映實體表 `custom_blocks_combo`)26 個欄位中,除 `id/userId/name/description/modality/vibeCardIds/freeformPrompt/negativePrompt/compiledPrompt/parameterSnapshot/isPublic/forkCount/likeCount/useCount/tags/createdAt/updatedAt`(這些是共用識別詞,在別的活表中也出現,故不列 0 命中)外,該表獨有欄位 `subjectBlock`(`:1656`)、`styleBlock`(`:1666`)、`lightingBlock`(`:1676`)、`cameraBlock`(`:1686`)、`extraBlocks`(`:1706`)、`brainConfigSnapshot`(`:1734`)、`previewImageUrl`(`:1742`)、`isCurated`(`:1745`)全部 0 命中。
- 進一步 Grep `customBlocksCombo`(整表名)本身:全 repo 只出現在 `server/routers/learnHub.seed.ts:6459,8210,8212,8307`(文件/seed 字串),**沒有任何 `server/db.ts` 或 router 對它 select/insert/update**。
- 對照組:同概念的活表 `customBlocks`(`drizzle/schema.ts:996`)與 `blockCombos`(`:1025`)被 `server/services/voiceCompiler.ts`、`server/services/agentToolExecutor.ts`、`server/routers/proStudio.ts`、`client/src/components/design-kit/PromptVault.tsx`、`client/src/components/ProgressivePromptBuilder.tsx`、`client/src/pages/social/SocialBrandPage.tsx` 等大量使用。
- **影響**:`custom_blocks_combo` 是一張完整 26 欄的孤兒表,疑似是「積木組合」功能較早或平行的一次設計,後被 `customBlocks + blockCombos` 這對雙表取代,但舊表從未清理——除了佔用 schema 篇幅,也讓新進開發者混淆兩套「combo」概念哪個才是真實路徑。
- **建議**:cluster 同時標 `naming-drift`(與 `blockCombos` 高度同名易混淆)。建議 drop `custom_blocks_combo`,或若日後要重啟需先在文件澄清與 `blockCombos` 的分工。

### H4〔dead-table〕Email 驗證整條鏈路孤兒(`email_verification_tokens` 表 + Service + Mail 從未被呼叫)

- **發現鏈路(逐段 Grep 確認)**:
  1. `drizzle/schema.ts:233` 定義 `emailVerificationTokens`(對映 `email_verification_tokens`,遷移 `drizzle/0014_email_verification_tokens.sql`)。
  2. `server/services/auth/emailVerificationService.ts` 完整實作 `createVerificationToken`(`:43`)、`validateToken`(`:64`)、`markTokenAsUsed`(`:102`)、`invalidateUserTokens`(`:116`)、`cleanupExpiredTokens`(`:128`),全部以 **raw SQL 字串**操作 `email_verification_tokens`(非走 drizzle schema 物件,故該 schema 匯出物件本身也是死碼)。
  3. Grep 全 repo `emailVerificationService`/`EmailVerificationService`:唯一命中是 `server/routers/brainPipeline.ts:1689`,但該處只是一份**靜態架構清單**(`files: [...]` 字串陣列,描述服務地圖用,非 import/呼叫)。**沒有任何路由呼叫這個 service 的任一方法**。
  4. `server/services/auth/emailService.ts:218` 完整實作 `sendEmailVerification(email, token, newEmail)`,產生 `${baseUrl}/verify-email?token=...` 連結信件內容,但 `server/services/auth/AuthFacade.ts` 只呼叫 `emailService.sendPasswordReset`(`:310`)與 `emailService.sendPasswordChanged`(`:342`,`:381`),從未呼叫 `sendEmailVerification`。
  5. client 端 Grep `verify-email`:**零命中**——沒有對應頁面消化 `?token=` 參數。
- **影響**:這是一條「後端 100% 做完(token 產生/驗證/清除 + 寄信 + DB 表),前端與路由 0% 接線」的完整孤兒功能,比單一死欄位嚴重——`email_verification_tokens` 表在生產環境理論上永遠是空表(沒有任何 create 呼叫路徑能寫入一筆 row)。連帶使 `users.emailVerified` 欄位的唯一寫入來源只剩 OAuth 供應商回傳的 claim(`server/_core/oauth.ts:289`),而非站內「換信箱→驗證」流程。
- **建議**:若「換 email 需驗證」仍是產品需求→在對應的 email 變更路由接上 `emailVerificationService` + `sendEmailVerification` + 新增 `/verify-email` 頁面(三處都要,缺一則整條仍是死的);若已改用其他驗證機制(例如純 OAuth)→整條(表 + service + mail 樣板)可安全下架。

### H5〔dead-table〕`subscription_plans` + `plansRouter` 後端完整、前端 0 個呼叫

- **發現**:`drizzle/schema.ts:746` 定義 `subscriptionPlans`(`priceMonthly:752`、`quotaAllocation:753` 皆為表內唯二 0 命中欄位)。`server/db.ts:2368`(`getActivePlans`)、`server/db.ts:2377`(`getPlanById`)、`server/routers/plans.ts`(`plansRouter.list`/`getById`,掛載於 `server/routers.ts:482`)三層都齊全,但 Grep `trpc.plans`/`router.plans` 於 `client/src` **零命中**——沒有任何頁面呼叫 `plans.list` 或 `plans.getById`。
- **影響**:整張表(含 `priceMonthly`/`quotaAllocation`/`features`/`tier` 等定價欄位)目前對產品完全不可見;真正在跑的訂閱狀態改讀 `userSubscriptions`(`server/db.ts:2399-2403`),`subscriptionPlans` 疑似是較早的定價方案雛型,未接上任何前端定價頁或後台方案管理介面。
- **建議**:若計費頁面規劃中要用→補前端定價頁 + admin 方案 CRUD UI;若已棄用→router 與表一併下架,减少「看起來有計費系統,其實沒人用」的誤導。

---

## 嚴重度:中

### M1〔dead-column〕`agent_preferences` 5 個「specialist agent」欄位(migration 0032)全死

- **發現**:`drizzle/schema.ts:152-156`——`preferredSpecialistAgent`(:152)、`specialistAutoActivate`(:153)、`specialistProactiveMode`(:154)、`specialistLearningEnabled`(:155)、`disabledSpecialistAgents`(:156)。皆源自 `drizzle/0032_agent_preferences_specialist_columns.sql`(該遷移註解本身寫著「`server/routers/agentPreferencesRouter.ts` already added it」,暗示原意是要接線)。
- Grep 全 repo(含 `agentPreferencesRouter.ts`)零命中,除 schema.ts 定義行外無第二處。
- **對照(negative result)**:同一張表的 `mutedSpirits`(`:162`)、`favoriteSpirits`(`:163`)**並非死欄位**——已 Grep 確認在 `client/src/components/AgentSettingsSheet.tsx`(:185-247 UI 開關)、`client/src/components/DashboardLayout.tsx`、`client/src/contexts/GlobalOrbChatContext.tsx`、`client/src/pages/AgentChat.tsx`、`server/routers/agentCollaborationRouter.ts`、`server/services/agentToolExecutor.ts` 等處被完整讀寫,是活欄位。(先前文件 `docs/research/L3-fields-settings-admin.md:260` 曾把 `agentPreferences` 的孤兒欄位歸類提及 mutedSpirits/favoriteSpirits 語境相近,經本次逐欄核實,這兩個具體欄位目前是活的,只有 5 個「specialist」欄位死——特此更正,避免誤刪活欄位。)
- **建議**:5 個 specialist 欄位若對應「專科代理」偏好功能仍要做→接進 `agentPreferencesRouter.ts` 與呼叫端(`server/services/agentToolExecutor.ts`/`agentCollaborationOrchestrator.ts` 的代理選派邏輯);否則下架。

### M2〔dead-column, 更正既有 L3 基線〕`system_settings` 死欄位重新核實:確認 13 欄全死 + 2 欄半死,而非文件記載的 19 欄全死

- **背景**:`docs/research/L3-fields-settings-admin.md:28` 稱 `system_settings` 的 19 個頂層欄位(`uiTheme` 起)「後端 schema 完整、前端零 UI、且沒有任何呼叫路徑」,並指 `PersonalSettingsContext.encodeServerPayload()` 只送 `timezone + extraSettings.personal`,全站無第二處寫入。
- **本次核實(逐欄 Grep + Read)發現該基線已過時**:`client/src/shells/settings/panels/GeneralSettingsPanel.tsx`(`git log` 顯示最早於 2026-06-06/2026-06-15 提交,早於 L3 文件的 2026-07-03 產出日期)透過 `trpc.settings.update`(`:34,45-53`)**實際送出** `uiTheme`(:61)、`fontScale`(:67)、`reducedMotion`(:73)、`emailNotifications`(:81)、`generationCompleteNotify`(:84)、`weeklyDigestEnabled`(:87)六欄,並各自有真實 UI 控制項(`<select>`/`<Switch>`)。此面板掛載於 `client/src/shells/settings/SettingsHome.tsx`,而其前提旗標 `ENABLE_4SHELL` 已於 2026-06-20 起**預設 ON**(`client/src/config/featureFlags.ts:58`),即此面板在預設組態下是可達的,非 dead code。另 `timezone` 由 `PersonalSettingsContext.tsx`(:26,113-116,196)寫入,亦非死欄位。
- **重新核實後的死欄位清單(`drizzle/schema.ts:1055-1119`)**:
  - **全死(13 欄,API zod 收但無任何 UI/邏輯寫入,亦無行為消費者)**:`sidebarCollapsed`(:1068)、`analyticsConsent`(:1071)、`crashReportConsent`(:1072)、`shareUsageData`(:1073)、`showProfilePublicly`(:1074)、`autoBackupEnabled`(:1077)、`backupFrequency`(:1078)、`backupRetentionDays`(:1081)、`lastBackupAt`(:1082)、`defaultModality`(:1085)、`defaultCreativeMode`(:1093)、`autoSaveHistory`(:1100)、`nsfwFilter`(:1101)。已 Grep 確認 `nsfwFilter` 在生成流程(`server/routers/generate.ts` 等)完全沒有讀取判斷,即使欄位存在也不會真的過濾內容。
  - **半死(2 欄,GeneralSettingsPanel.tsx 讀出存進 draft、mutate 時原樣送回,但沒有對應 UI 控制項讓使用者改它,故實質上永遠是預設值來回搬)**:`accentColor`(:1063)、`locale`(:1111)。
  - **結論**:死欄位總數應為「13 全死 + 2 半死」,與 L3 文件的「19」有落差,主因是 GeneraSettingsPanel.tsx 在 L3 文件產出前已上線且旗標預設 ON,文件未涵蓋到此檔案。建議下次稽核以本文件(SD1)為準,或請 L3 文件維護者複查後更新該行。
- **建議**:13 個全死欄位若無明確路線圖(備份排程、NSFW 過濾、多模態預設)→標記 deprecated;`accentColor`/`locale` 若要保留需求→補上 UI 選色器/語系選單,否則兩者也應下架以免誤導。

### M3〔dead-column〕`users.emailVerifiedAt`

- **發現**:`drizzle/schema.ts:37`,源自 `drizzle/0015_add_email_verification_fields.sql:3`。全 repo 除 schema.ts 外零命中(連 H4 提到的 `emailVerificationService.ts` 都只操作 `email_verification_tokens` 表本身,從未 `UPDATE users SET emailVerifiedAt = ...`)。
- **影響**:即使 H4 的驗證流程日後被接線,目前的實作也不會回填這個時間戳——`emailVerified`(布林)有人讀(`server/db.ts:5415`,GDPR 匯出用),但沒有人寫入為 true 的路徑之外,`emailVerifiedAt` 從頭到尾無人碰。
- **建議**:與 H4 一併處理;若確定不需要「驗證時間」的精確記錄,只留布林即可,drop 此欄。

### M4〔dead-column〕`user_ai_brain.globalPreferences`

- **發現**:`drizzle/schema.ts:1543`(58 欄最大表之一)。全 repo 唯一命中除 schema.ts 外是 `server/brain-context.test.ts:193,325,494`——三處皆為測試 fixture 內的 `globalPreferences: null` 佔位,用來滿足型別完整性,並非真正業務邏輯讀取它。
- **建議**:確認 `buildBrainContext` 系列函式是否曾規劃要合併「跨引擎全域偏好」;若無,清理測試 fixture 中的佔位欄位並 drop DB 欄。

### M5〔dead-column〕`api_usage_logs` 4 個細粒度欄位從未被任何呼叫端填入

- **發現**:`drizzle/schema.ts:673`(`audioCharacters`)、`:674`(`sunoCredits`)、`:679`(`requestPayload`)、`:693`(`modalityParams`)。已追蹤 `createApiUsageLog`(`server/db.ts:1875`)僅有的 3 個呼叫點(`server/routers/generate.ts:530,1288,1503`),逐一確認皆只傳入 `userId/requestType/apiProvider/tokensUsed/estimatedCostUsd/responseStatus/errorMessage/generationsDeducted` 等欄位,即使是音訊/語音生成分支也不填 `audioCharacters`/`sunoCredits`。
- **影響**:per-modality 計費稽核(尤其 Suno 音樂生成的信用額度追蹤)看似有 schema 支援,實際上這條資料從未被寫入,任何依賴這 4 欄的報表/對帳都會拿到全 NULL。
- **建議**:若音訊/語音計費稽核仍是需求→在 `generate.ts` 對應音訊分支補寫;否則欄位下架瘦身。

### M6〔dead-column〕`ai_usage_events.apiKeyId` / `unitType`——`api_keys` 與用量事件的連結從未建立

- **發現**:`drizzle/schema.ts:2067`(`apiKeyId`)、`:2070`(`unitType`)。已追蹤兩個實際 insert 點:`server/routes/aiProxy.ts:305`(rate-limit 分支)與 `:533`(正常記帳分支),皆未帶 `apiKeyId`/`unitType`。而 `apiKeys` 表(`schema.ts:4701`)本身是活的(API 金鑰管理功能存在)。
- **影響**:代表「某支 API Key 各自的用量歸因」目前無法從 `aiUsageEvents` 反查——`apiUsage.ts` 路由的各種彙總(`server/routers/apiUsage.ts`)全部只能以 `userId`/`provider` 分組,無法以 key 分組,是一個介於「死欄位」與「半成品功能」之間的落差。
- **建議**:若要支援「依 API Key 拆帳」→在 `aiProxy.ts` 兩個 insert 點补上 `apiKeyId`(需先解析呼叫方用的是哪把 key)與 `unitType`;否則下架兩欄。

### M7〔dead-column〕`user_model_switch_logs.toParams` / `switchedAt`

- **發現**:`drizzle/schema.ts:1589`(`toParams`)、`:1605`(`switchedAt`)。實際唯一 insert 點 `server/routers/brain.ts:554-561` 只寫入 `userId/brainSlot/fromModel/toModel/reason/switchSource`,不含這兩欄。
- **建議**:若要保留「切換當下的模型參數快照」與「精確切換時間(區分於 `createdAt`)」→補寫;否則下架。

### M8〔dead-column〕`orb_workflow_template_ratings.wasHelpful` / `completedSuccessfully`

- **發現**:`drizzle/schema.ts:3286`(`wasHelpful`)、`:3287`(`completedSuccessfully`)。表本身是活的(`server/services/orbWorkflowEngine.ts:798-820` 的 `rateTemplate()` 有讀有寫),但該函式的 `.values({...})`(`:799-804`)只填 `templateId/userId/rating/comment`,兩個布林欄位從未被設定,永遠是 DB default/NULL。
- **建議**:若要做「有幫助/是否成功完成」的二次分析→在 `rateTemplate()` 簽章加參數並補寫;否則下架。

### M9〔migration-schema-mismatch,已知延伸〕`deleteUserAccount` 逐表核實:至少 7 張表的欄名假設與實體 DB 欄位不符,且失敗點在迭代序中第一個就會觸發

- **背景**:已知 DI-01——`deleteUserAccount` 因表名↔欄位名不符而全 rollback。本次對 `server/db.ts:5300-5370` 的 `USER_OWNED_TABLES`(69 張表)逐一比對 `drizzle/schema.ts` 內對應表的「使用者欄位」實際 DB 欄名,`server/db.ts:5387` 的刪除語句固定寫死 `` DELETE FROM `${table}` WHERE userId = ? ``。
- **具體不符清單(逐一核對 schema.ts 定義)**:
  - `fine_tuned_model_consents`——實際欄名 `user_id`(`drizzle/schema.ts:2414` 起,欄位定義 `userId: int("user_id")`),非 `userId`。
  - `agent_collaboration_sessions`——`drizzle/schema.ts:2438`:`userId: int("user_id")`。
  - `orb_conversations`——`drizzle/schema.ts:2713`附近:`userId: int("user_id")`。
  - `data_source_connections`——`drizzle/schema.ts:3893`:欄位是 `ownerUserId`(DB 欄名同名 `ownerUserId`),沒有 `userId` 欄。
  - `real_earth_entries`——`drizzle/schema.ts:4244`起(`createdBy` 出現於 `:4320` 附近一帶):使用者欄是 `createdBy`,沒有 `userId` 欄。
  - `cost_aggregations`——`drizzle/schema.ts:2111`:整張表**沒有任何使用者層級欄位**(只有 `provider/endpoint/date/callCount/totalUnits/totalCostUsd` 等聚合欄),是站台級彙總表,不該出現在 `USER_OWNED_TABLES` 清單。
  - `cost_ledger`——`drizzle/schema.ts:2159`:以 `accountKey`(varchar)標識帳務主體,沒有 `userId` 欄。
- **關鍵放大點**:`USER_OWNED_TABLES` 陣列(`server/db.ts:5300`)中,`cost_aggregations` 排在第 31 個位置,**早於** `cost_ledger`(32)、`fine_tuned_model_consents`(37)、`agent_collaboration_sessions`(38)、`orb_conversations`(39)、`data_source_connections`(56)、`real_earth_entries`(59)。由於 `for...of` 迴圈依序執行且中間沒有 try/catch(`server/db.ts:5384-5392` 只有 `finally` 用於重設 `FOREIGN_KEY_CHECKS`,沒有攔截例外),第一次執行到 `` DELETE FROM `cost_aggregations` WHERE userId = ? `` 就會因「Unknown column 'userId' in where clause」拋出 SQL 錯誤,整個 `manager.executeTransaction` 連帶失敗回滾——這代表 `deleteUserAccount`(`server/routers/profile.ts:32` 呼叫)**目前對任何使用者呼叫都會 100% 失敗**,而不是「部分使用者、部分表殘留」的機率性問題。GDPR「被遺忘權」刪帳號功能實質上完全不可用。
- **建議**:優先修正順序——① 把 `cost_aggregations`/`cost_ledger` 從 `USER_OWNED_TABLES` 移除(它們本來就不含使用者資料,不該被這樣刪);② 對 `fine_tuned_model_consents`/`agent_collaboration_sessions`/`orb_conversations` 改用 `user_id`;③ 對 `data_source_connections` 改用 `ownerUserId`;④ 對 `real_earth_entries` 改用 `createdBy`;⑤ 建議整體改為「每表宣告自己的刪除子句」而非單一字串樣板,避免同類回歸。

---

## 嚴重度:低

### L1〔naming-drift,擴充已知基線〕drizzle 遷移檔重號不只 0008,共 6 組(12 個檔案共用 6 個編號)

- **已知基線**:`0008_admin_api_usage` 與 `0008_numerous_mother_askani` 重號。
- **本次擴充發現**(核對 `drizzle/meta/_journal.json` 的 `idx` 與檔名前綴):除 0008 外,另有 5 組檔名數字前綴重複、但 `_journal.json` 內部以不同 `idx` 區分而未真正衝突的情況:
  - `0033_agent_model_picks.sql`(journal `idx:33`)與 `0033_add_plan_status_to_sessions.sql`(journal `idx:73`)。
  - `0067_creative_projects.sql`(`idx:60`)與 `0067_repair_worldbuilding_v4_columns.sql`(`idx:80`)。
  - `0080_agent_concurrency_registry.sql`(`idx:92`)與 `0080_refresh_tokens.sql`(`idx:96`)。
  - `0081_orchestration_priority_scope.sql`(`idx:93`)與 `0081_user_workflows.sql`(`idx:97`)。
  - `0082_learn_modules.sql`(`idx:94`)与 `0082_data_source_expiry.sql`(`idx:98`)。
- **影響**:drizzle-kit 實際套用順序完全依 `_journal.json` 的 `idx`(功能上未壞),但檔名前綴數字已經與實際套用序完全脫鉤——例如 `0033_add_plan_status_to_sessions.sql` 實際在第 73 棒才套用,若有人依檔名字串排序(`ls`、`sort`)或憑檔名猜測套用順序 / 對照 `drizzle/meta/00XX_snapshot.json` 除錯,會得到錯誤結論。屬於「表面命名」與「實際狀態」脫鉤的 naming-drift,建議日後產生遷移檔一律用 `drizzle-kit generate` 走正常流程避免手動撞號。
- **建議**:非急迫,但建議在下次批次遷移時把檔名重新對齊 `idx`(重新命名,不改內容),或至少在 README/遷移指南註記「檔名數字前綴不等於套用順序,以 `_journal.json.idx` 為準」。

### L2〔migration-schema-mismatch,已知延伸〕`drizzle/schema.ts` 宣告 0 個 `.references()`,但至少 7 個遷移在 DB 層真的建了 FOREIGN KEY

- **已知基線**:102 表 0 FK。
- **本次核實**:`drizzle/schema.ts:1817` 註解明文「不在 schema 掛 references()(全檔慣例:schema 無 FK 宣告);DB 層 FK 由[遷移管理]」,即這是刻意的設計決定,並非疏漏。但進一步 Grep `drizzle/*.sql` 發現以下遷移**確實**在 DB 層加了 `FOREIGN KEY`/`CONSTRAINT ... REFERENCES`:
  - `drizzle/0027_agent_collaboration_persistence.sql`——`agent_collaboration_*` 系列表對 `users(id)`、`agent_collaboration_sessions(collaboration_id)` 的 4 條 FK(含 `ON DELETE CASCADE`/`SET NULL`)。
  - `drizzle/0039_orb_long_term_memory.sql`——`orb_memory_assoc_from_fk`/`orb_memory_assoc_to_fk` 對 `orb_long_term_memories(id)`。
  - `drizzle/0040_orb_intent_clarification.sql`——`orb_clarif_intent_fk` 對 `orb_intent_logs(id)`。
  - `drizzle/0042_orb_workflow_templates.sql`——`orb_workflow_exec_template_fk` 對 `orb_workflow_templates(id)`。
  - `drizzle/0044_orb_template_ratings_and_alerts.sql`——`orb_tmpl_rating_template_fk` 對 `orb_workflow_templates(id)`。
  - `drizzle/0055_teaching_archive_fk.sql`——`teaching_materials`/`teams`/`team_memberships`/`teaching_material_access_log` 共 7 條 FK 對 `users(id)`/`teams(id)`/`teaching_materials(id)`。
  - `drizzle/0075_prompt_assets.sql`——`pa_promptId_fk`/`pa_assetId_fk` 對 `prompt_library(id)`/`digital_asset_library(id)`(以 `information_schema` 防禦式判斷是否已存在才 ADD)。
- **影響**:「102 表 0 FK」這句話對 `drizzle/schema.ts` 的**宣告層**成立,但對**實體 DB 約束**不成立——上述 7 個遷移涉及的表在正式 DB 上有真實 FK 與 `ON DELETE CASCADE/SET NULL` 行為,這與 M9 提到的 `deleteUserAccount` 硬刪除邏輯(`SET FOREIGN_KEY_CHECKS = 0` 繞過檢查)之間的交互作用需要注意:硬刪除繞過 FK 檢查,但這些 CASCADE 規則若在其他一般寫入路徑上生效,行為會與「schema.ts 看起來沒有任何級聯關係」的直覺不符。
- **建議**:在 `drizzle/schema.ts` 的表註解補上「本表在 DB 層有 FK,見遷移 00XX」提示,避免下一個讀 schema.ts 的人誤判關聯完全不存在。

### L3〔dead-column〕`digital_asset_library.isPublicRecycled`

- **發現**:`drizzle/schema.ts:352`。全 repo 除定義行外零命中。
- **建議**:確認是否為「公開回收桶」功能的殘留欄位規劃;若無下文,下架。

### L4〔dead-column,write-only〕`r2_object_catalog.objectKey` / `news_articles.authorUserId` 只寫不讀

- **發現**:`objectKey`(`drizzle/schema.ts:1960`)在 `server/jobs/r2SnapshotJob.ts:102` 有寫入,但全 repo 無任何讀取端(select 出來後使用)。`authorUserId`(`drizzle/schema.ts:1176`)在 `server/jobs/newsFetcher.ts:934` 寫入固定值 `null`,同樣無讀取端。
- **影響**:較低——資料有寫入路徑,只是目前沒有消費者,不算完全孤兒,但也不算「活」欄位。這兩項僅完成單向抽樣核實(命中 1-2 次),深度不若上述項目,標記「需再查」是否有計畫中的讀取端(例如未來的資產來源追溯 UI、新聞作者頁)。
- **建議**:低優先;若近期無讀取端規劃,可考慮先不動,列入下次稽核觀察名單。

---

## Negative Results(核實後確認「並非死碼」,避免誤刪)

1. `agentPreferences.mutedSpirits` / `favoriteSpirits`——heavily wired(見 M1),與舊文件語境易誤解為孤兒,經核實是活欄位。
2. `system_settings.uiTheme / fontScale / reducedMotion / emailNotifications / generationCompleteNotify / weeklyDigestEnabled / timezone`——經核實透過 `GeneralSettingsPanel.tsx` + `PersonalSettingsContext.tsx` 是活欄位(見 M2),原 L3 文件「19 欄全死」的說法對這 7 欄已過時。
3. `apiUsageLogs`、`aiUsageEvents`、`userModelSwitchLogs`、`orbWorkflowTemplateRatings` 四張表本身皆是活表(有真實 insert/select 呼叫鏈),只有各自 1-4 個細節欄位死(見 M5-M8)——不應誤判整表為死表。
4. `customBlocks` / `blockCombos`(注意非 `customBlocksCombo`)是活表,大量前後端呼叫點,勿與 H3 死表混淆。
5. `subscriptionPlans` 的 `name/tier/isActive` 等欄位技術上仍被 `getActivePlans()`/`getPlanById()` select 出來(只是整條路由無人呼叫,見 H5)——是「整個路由孤兒」而非單欄死碼問題。

---

## 統計摘要

| 類別 | 數量 | 備註 |
|---|---|---|
| 全表死碼(H1-H5) | 5 表 | agent_collaboration_steps、agent_collaboration_messages、agent_performance_metrics、custom_blocks_combo、email_verification_tokens(+ 附屬孤兒 service/mail)、subscription_plans(+ 孤兒 router)——實際 6 個對象,5 個嚴重度分組 |
| 死欄位(M1-M8, L3-L4) | 約 30 欄 | 含 system_settings 13 全死 + 2 半死之更正計數 |
| migration-schema-mismatch(M9, L2) | 2 大類 | deleteUserAccount 7 表欄名不符;schema 宣告 0 FK 但實體有 7 處遷移建了 FK |
| naming-drift(L1) | 6 組 | drizzle 遷移檔號重複(擴充已知的 0008 單組為 6 組) |
| Negative results | 5 項 | 避免誤刪的活欄位/活表澄清 |

抽樣未覆蓋部分(誠實聲明):`teachingMaterials`(29 欄)、`worldbuildingFrameworks`(22 欄)、`modelTrainingConsents`(27 欄)、`realEarthEntries`(20 欄)等大表僅做了表層級與部分欄位的頻率掃描,未逐欄 Read 上下文核實,若需更高信心建議下一輪針對這些表做同等深度的逐欄核查——此處列為「需再查」而非「已確認死/活」。
