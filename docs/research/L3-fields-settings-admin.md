# L3 欄位字典：Settings / Admin / Dashboard / 認證頁（地毯掃描 wave L）

> 產生日期：2026-07-03 ｜ 任務單標示 commit：`4d137bdb907d67e6708ca360a66e89de0a6f2c2e`（HEAD 實測為 `ba321b789081a7e5bb2f7d9edfa86a23b158ffae`，兩者皆存在於 repo；本文以 HEAD 為準，沿用 H2 doc 的落差記法）
> 範圍：SettingsPage(8 分頁)、AgentPreferencesPage(12 分頁)、AdminPage(11 分頁)、AdminApiUsagePage(5 分頁)、AiBrainPipelinePage、AiBrainSettings(嵌入 admin/brain，7 子分頁)、DashboardPage(3 section)、CreditsInfoPage、LangSmithPage(5 分頁)、AccountSettingsPage(3 分頁)、ForgotPasswordPage、ResetPasswordPage
> 前情：01-features §3（功能盤點，本文做元件/欄位級）；H2 doc 的標記約定沿用：`⚰` 死欄位／死控制項、`👻` 隱藏能力（後端有、前端無 UI）、`≠` 前後端預設不一致

---

## 1. SettingsPage（/settings，8 分頁）

元件清單：Tabs(profile/dashboard/data/appearance/notifications/onboarding/feedback/admin)；profile 內嵌 AvatarStudio；dashboard/data/feedback 三分頁是 `lazy import` 整頁內嵌（DashboardPage/LangSmithPage/FeedbackPage）；admin 分頁只是 5 張導航卡（非表單）。

### 1.1 profile 分頁欄位表

| 欄位 | 型別 | state | 預設 | 範圍 | tRPC | 資料表欄位 | 備註 |
|---|---|---|---|---|---|---|---|
| 虛擬頭像 | AvatarStudio 元件 | — | user.avatarUrl | — | （元件內部自帶上傳） | users.avatarUrl | 唯讀顯示＋內嵌上傳 |
| 名稱/Email/角色/剩餘配額 | 純文字顯示 | — | — | — | 讀自 useAuth() | users.* | 唯讀，無編輯入口（改名在 AccountSettingsPage） |
| 偏好顯示名稱 | Input maxLength 40 | `personalPrefs.displayName` | "" | trim+slice(40) | settings.update→extraSettings.personal.displayName | system_settings.extraSettings(JSON) | 儲存於 JSON 副欄，非獨立 DB 欄 |
| 時區 | Input maxLength 80 | `personalPrefs.timezone` | Intl 偵測值 | trim+slice(80)，空字串 fallback "Etc/UTC" | settings.update→timezone（頂層欄） | system_settings.timezone | 唯一真的寫進頂層欄的個人化欄位 |
| 緊湊介面模式 | Switch | `personalPrefs.compactMode` | false | — | extraSettings.personal.compactMode | JSON | 立即套用 `.hs-compact` class |
| 生成前二次確認 | Switch | `personalPrefs.confirmBeforeGenerate` | false | — | extraSettings.personal.confirmBeforeGenerate | JSON | — |
| 個人簡介 | Textarea maxLength 180 | `personalPrefs.bio` | "" | — | extraSettings.personal.bio | JSON | — |
| 儲存偏好／還原未儲存變更 | Button ×2 | — | — | — | — | — | 還原鈕僅在 `personalPrefsDirty` 時可按 |
| 可愛表情模式 | Switch | `settings.orbCuteMode` | false | — | extraSettings.personal.orbCuteMode | JSON | 光球外觀 |
| 隨機互動飛行 | Switch | `settings.orbRandomFly` | false | — | extraSettings.personal.orbRandomFly | JSON | 桌面版限定 |

**⚰👻 重大落差**：`server/routers/settings.ts` 的 `update` zod 另收 **19 個頂層欄位**（uiTheme／accentColor／fontScale／reducedMotion／sidebarCollapsed／analyticsConsent／crashReportConsent／shareUsageData／showProfilePublicly／autoBackupEnabled／backupFrequency／backupRetentionDays／defaultModality／defaultCreativeMode／autoSaveHistory／nsfwFilter／emailNotifications／generationCompleteNotify／weeklyDigestEnabled／locale），`drizzle/schema.ts:1055-1108` 的 `system_settings` 表也都有對應欄位與 DB default，但 `PersonalSettingsContext.encodeServerPayload()`（client/src/contexts/PersonalSettingsContext.tsx:189-213）**只送 timezone + extraSettings.personal**，從未觸碰這 19 欄。全站也沒有第二個地方寫入它們（grep 全 client 無 `uiTheme`/`accentColor`/`nsfwFilter` 等的表單）。結論：這是後端 schema 完整、前端零 UI、且**沒有任何呼叫路徑**的整組死欄位（比 H2 doc 的「👻隱藏能力」更嚴重——H2 的隱藏能力至少 zod 會被同一支 mutation 的其他欄位帶到；這裡是完全沒被任何 mutate 呼叫觸及過）。

### 1.2 appearance 分頁欄位表

| 欄位 | 型別 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 外觀模式 | 4 張卡片按鈕 | `appearanceMode`(ThemeContext) | — | light/dark/auto/system | auto=場景連動 |
| 介面設計風格 | 2 張卡片按鈕 | `settings.designMode` | "minimalist"(新戶)／舊戶 fallback "classic" | minimalist/classic | 只影響 /agent 聊天頁版型 |
| 檢視模式（全站統一） | 3 按鈕 | `viewMode`(useViewMode) | "auto" | auto/desktop/mobile | 非 PersonalSettings，走獨立 hook/localStorage |
| 背景場景 | 4 張卡片 | `sceneOverride`(useCurrentScene) | null(自動) | nightSky/morning/cafe/deepSea | 依時段自動；可鎖定 |
| 靈感資源連結 ×4 | 外部連結按鈕 | — | — | — | Unsplash/Pexels/Dribbble/Coolors，純外連 |

### 1.3 notifications / onboarding / admin 分頁

| 欄位 | 型別 | state | 預設 | 備註 |
|---|---|---|---|---|
| 音效提示 | Switch | `settings.soundEnabled` | true | — |
| 桌面通知 | Switch | `settings.desktopNotif` | false | 內含瀏覽器 Notification 權限流程（default/granted/denied） |
| 發送測試通知 | Button | — | — | disabled 除非已 granted |
| 重新觀看全站引導 | Button | — | — | 清 3 個 localStorage key + 派發 `site-tour-start` |
| ResetAllToursButton | 元件 | — | — | 另一顆重置鈕，功能與上一顆部分重疊 |
| admin 分頁 | 5 張導航卡 | — | — | 全部導到 `/admin`／`/my-brain`／`/langsmith`，非表單，isAdmin 才顯示 |

---

## 2. AgentPreferencesPage（/settings/agent，12 分頁：overview/behavior/budget/perception/critic/roles/notify/voice/tools/pages/ui/schedule）

後端：`agentPreferencesRouter`（server/routers/agentPreferencesRouter.ts），表 `agent_preferences`（drizzle/schema.ts:81+）。

| 分頁 | 欄位/控制項 | state | 預設 | 範圍/選項 | tRPC 欄位 | 備註 |
|---|---|---|---|---|---|---|
| overview | 快速預設卡（OrbAgentPresetCards）／光球記得你（OrbMemoryDashboard）／最近活動（OrbAgentActivityFeed limit15） | — | — | — | 讀 `getPreferences`/`getRecentActivity` | 純顯示＋一鍵套用預設 |
| behavior | 行為模式 3 卡（純聊天/半自動/自動） | `mode` | "semi_auto" | pure_chat/semi_auto/auto | 映射 confirmationPolicy | UI 簡化層，實際存的是 policy |
| behavior›進階 | 確認策略 4 選項(radio，展開後才顯示) | `confirmationPolicy` | "confirm_high_risk" | always_approve/confirm_high_risk/confirm_all/manual | confirmationPolicy | `confirm_all` 在簡化 3 卡模式下無法選到（POLICY_TO_MODE 把它併進 semi_auto），只能在展開進階才選 |
| behavior | 單次任務最多自動步驟 | Input number | `maxAutoStepsPerTask` | 5 | 1–20 | maxAutoStepsPerTask | — |
| behavior | 允許自動執行風險等級 | checkbox×3 | `allowedRiskLevels` | ["low","medium"] | low/medium/high | allowedRiskLevels | 前端強制至少保留 "low" |
| behavior | 不跳頁、原地執行 | Switch | `stayOnPageMode` | false | — | stayOnPageMode | — |
| budget | 啟用成本守門員 | Switch | `costBudgetEnabled` | false | — | costBudget(null↔物件) | 關閉時整包送 null |
| budget | 單次工作流上限(點數) | Input number | `perWorkflowCap` | "" | 0–100000 | costBudget.perWorkflowCap | 留空=不限 |
| budget | 剩餘可用點數 | Input number | `remainingCredits` | "" | 0–1,000,000 | costBudget.remainingCredits | 留空=不限 |
| budget | 風險 tier 強制確認門檻 | Select | `confirmAtTierOrAbove` | "" | free/cheap/medium/expensive/premium | costBudget.confirmAtTierOrAbove | — |
| budget | 純資訊模式（永遠不擋） | Switch | `budgetAlwaysAllow` | false | — | costBudget.alwaysAllow | — |
| perception | 啟用感知迴圈 | Switch | `perceptionEnabled` | true | — | perceptionEnabled | — |
| perception | 嚴格度 | radio×3 | `perceptionStrictness` | "balanced" | lenient/balanced/strict | perceptionStrictness | — |
| critic | 啟用自我批判 | Switch | `criticEnabled` | false | — | criticEnabled | — |
| critic | 重規劃門檻分數 | Input number | `criticRefineBelow` | 75 | 0–100 | criticRefineBelow | 只有 criticEnabled=true 才顯示 |
| roles | 啟用多角色自動切換 | Switch | `roleAutoSwitch` | true | — | roleAutoSwitch | — |
| roles | 節奏覆寫 | radio×4 | `pacingOverride` | "auto" | auto/patient/balanced/impatient | pacingOverride | — |
| roles | 偏好檢視卡（PreferenceInspectorCard） | — | — | — | `getDistilledProfile` | 顯示信心/節奏/偏好模型/避開模型/動作接受率，唯讀+「重新蒸餾」按鈕 |
| notify | 任務完成/失敗通知 | Switch×2 | `notifyOnCompletion`/`notifyOnError` | true/true | — | 同名欄 | — |
| voice | 啟用語音回覆／自動啟動語音／偏好語音 | Switch×2＋按鈕×5 | `voiceEnabled`/`voiceAutoActivate`/`preferredVoiceName` | false/false/"Puck" | Puck/Charon/Kore/Fenrir/Aoede | voiceEnabled/voiceAutoActivate/preferredVoiceName | — |
| tools | 白名單／黑名單 | Textarea+快選 chips | `autoApproveCsv`/`blockedCsv` | "" | 逗號/換行分隔，`*`=全部 | autoApproveTools/blockedTools(array) | ToolQuickSelectChips 呼叫 `listAvailableTools` |
| pages | 每頁代理開關 + 細模動作黑名單 | Switch+checkbox 網格 | `disabledPageAgents`/`disabledActionsByPage` | []/{}  | APP_PAGE_REGISTRY 動態頁清單 × 15 種動作類型 | 同名欄 | 兩層粒度：整頁關閉／單頁內逐動作封鎖 |
| ui | 代理人總開關／跨頁工作流開關 | 3 選按鈕×2 | `orbAgentEnabled`/`workflowsEnabled` | null/null | null(跟隨env)/true/false | 同名欄 | — |
| ui | 浮動光球位置 | 4 按鈕 | `orbWidgetCorner` | "bottom-right" | 四角 | orbWidgetCorner | — |
| ui | 自訂歡迎訊息 | Input maxLength 280 | `orbWelcomeMessage` | "" | — | orbWelcomeMessage(nullable) | 清空=null=用預設 |
| ui | Cmd+K 快捷鍵／主動建議 | Switch×2 | `orbShortcutEnabled`/`orbProactiveSuggestions` | true/true | — | 同名欄 | — |
| schedule | 已排程任務清單＋新增(ID/Cron/任務描述) | Input×3+Button | 本地 state | — | `orbScheduler.scheduleJob`/`unscheduleJob`/`listJobs` | — | 是另一支 router（非 agentPreferencesRouter），但同頁呈現 |

**👻 隱藏能力**（zod/DB 完整、頁面上完全無 UI）：
- `mutedSpirits`／`favoriteSpirits`（drizzle:162-163，array，15 精靈靜音/最愛清單）——後端 `updatePreferences` zod 收，前端 12 個分頁沒有任何一處可勾選/顯示；只能靠其他頁面（若有）或直接 API 呼叫寫入。
- `proactiveTriggerSettings`（drizzle:172，每個主動通知事件的 enabled/minIntervalMs/requireAck）——同樣 zod 完整（server/routers/agentPreferencesRouter.ts:79-89），頁面無對應表單。
- `onboardingCompletedAt`——zod 接受 Date/ISO string/null，前端從未讀寫（可能由 `OrbOnboardingDialog` 直接寫，但本頁「重置」與此無關聯 UI）。

---

## 3. AdminPage（/admin，11 分頁；leader 僅見 users/costs）

### 3.1 元件/區塊清單

overview（StatCard×6＋30天趨勢長條圖）、users（篩選列＋每人一張卡）、activity（每人統計卡）、api（金鑰狀態卡＋供應商拆解＋即時呼叫紀錄，SSE 自動刷新）、costs（團隊總額卡＋每人積分分配條）、generations（生成歷史卡片列）、jobs（背景任務卡片列）、feedback（回饋卡片＋狀態 Select）、brain（內嵌 `AiBrainSettings`，見 §6）、ai-research（`AiSiteResearchPanel`：掃描控制＋GitHub 整合狀態＋提案審核清單＋研究資料清單）、skills（`SkillRegistryTab`：技能表格＋安裝 Dialog）。

### 3.2 users 分頁——每位使用者卡片欄位/操作

| 欄位/操作 | 型別 | state | 範圍 | tRPC | 資料表欄位 | 備註/死欄位 |
|---|---|---|---|---|---|---|
| 角色 | Select | `u.role` | user/leader/admin | `admin.updateRole`(adminProcedure) | users.role | **`disabled={!isAdmin}`**——leader 看不到可互動 |
| 配額 | Input number＋更新鈕 | `quotaInputs[u.id]` | ≥0（zod 只有 min(0)，無上限） | `admin.updateQuota`(adminProcedure) | users.remainingGenerations | ⚰ **更新鈕只 `disabled={updateQuota.isPending}`，沒有 `!isAdmin` 判斷**——leader 進 users 分頁能點，會被後端 403 拒絕（前端無錯誤提示外的特殊處理，僅走 toast.error 顯示伺服器訊息）|
| 自動給點：啟用/關閉 | Select | `autoCreditEnabledInputs[u.id]` | on/off | `admin.updateAutoCreditPolicy`(leaderOrAdminProcedure) | users.autoCreditEnabled | leader 可操作（政策上開放） |
| 每期點數 | Input number | `autoCreditAmountInputs[u.id]` | 0–100000（zod int） | 同上 | users.autoCreditAmount | 啟用時點數不可為 0（前端擋） |
| 週期天數 | Input number | `autoCreditIntervalInputs[u.id]` | 1–365 | 同上 | users.autoCreditIntervalDays | — |
| 儲存自動給點 | Button | — | — | 同上 | — | 三個輸入合併一次送出 |
| 立即執行自動給點 | Button（分頁級） | — | — | `admin.runAutoCreditNow`(leaderOrAdminProcedure) | — | 一次跑 500 筆 due 使用者 |
| 搜尋 / 篩選 | Input＋Select | `userSearch`/`autoCreditFilter` | all/enabled/disabled | 純前端 filter | — | — |

### 3.3 其餘分頁欄位重點

| 分頁 | 表格欄 | 操作按鈕 | tRPC | 備註 |
|---|---|---|---|---|
| overview | 總使用者/總生成/總API呼叫/總成本/背景任務(進行中/失敗)/數位資產 6 張卡＋30天長條圖 | — | `admin.systemStats`/`systemDailyTrend` | 純顯示 |
| activity | 姓名/角色/最後登入/API呼叫/生成次數/資產數/花費/剩餘配額 | — | `admin.userActivity` | 純顯示 |
| api | 13 支 env key 狀態燈(只回 boolean)／供應商呼叫數+tokens+成功率+費用／最近呼叫紀錄(供應商/類型/模型/使用者/耗時/tokens/錯誤訊息/費用) | 刷新鈕／「深度成本分析」外連 `/admin/api-usage` | `admin.apiKeysStatus`/`apiProviderBreakdown`/`usageLogs` | 純顯示 |
| costs | 團隊總積分/USD/TWD＋每人請求數/tokens/積分佔比條/積分/USD/TWD | — | `admin.teamCostSummary` | leaderOrAdmin 可見 |
| generations | 模態圖示/使用者/時間/提詞前兩行/花費點數/耗時/收藏徽章 | — | `admin.allGenerationHistory`(limit100) | 純顯示 |
| jobs | 類型/狀態徽章/使用者/進度%/進度訊息/時間/錯誤訊息 | — | `admin.allBackgroundJobs`(limit50) | 純顯示，無取消/重試操作 |
| feedback | 標題/描述/分類/優先度/功能區域/座標標記/截圖 | 狀態 Select(open/in_progress/resolved/closed) | `feedback.all`/`feedback.updateStatus` | — |
| ai-research | 提案：嚴重度/分類/來源/標題/檔案路徑:行號/描述/程式碼片段/狀態/信心% | 核准並連結GitHub／拒絕／重試建立Issue／加入學習庫；掃描指令Input／啟動AI全站研究／快速掃描(topN25) | `brain.proposals`/`approveProposal`/`rejectProposal`/`runFullSiteResearch`/`runCodeScan`/`researchResults`/`addResearchToLearnHub`/`monitorSummary`/`githubConfigStatus`/`testGithubConnection`/`retryGithubIssue` | 嚴重度/來源雙篩選 Select |
| skills | 技能ID/名稱/版本/信任等級(Select，official鎖死)/狀態圖示/需重審圖示 | 安裝技能(貼 JSON manifest+信任等級+來源URL)／信任等級 Select／啟用停用切換鈕 | `skillRegistry.listSkills`/`installSkill`/`updateSkillTrust`/`setSkillStatus` | — |

**⚰ 重複 UI 意外發現**：AdminPage 頂層「ai-research」分頁（`AiSiteResearchPanel`）與 §6 AiBrainSettings 內嵌的 `proposals`／`research` 子分頁（`client/src/pages/admin/brain/tabs/ProposalsTab.tsx`／`ResearchTab.tsx`）**呼叫同一組 tRPC**（`brain.proposals`/`approveProposal`/`rejectProposal`/`researchResults`/`addResearchToLearnHub`），是兩套獨立畫的 UI 對應同一份後端資料——管理員可能在其中一個介面核准/拒絕提案，另一個介面的快取要等各自 `invalidate` 才會同步，介面上也沒有互相提示「已在別處處理」。屬功能重工＋潛在困惑，非死碼但值得合併。

---

## 4. AdminApiUsagePage（/admin/api-usage，5 分頁）

| 分頁 | 欄位/控制項 | tRPC | 備註 |
|---|---|---|---|
| overview | KPI卡×4（本月呼叫/本月費用/…）＋每日費用堆疊面積圖 | `apiUsage.overview` | 純顯示 |
| providers | 開始/結束日期篩選＋每供應商配額/剩餘/餘額卡＋近期費用長條圖 | `apiUsage.usageByProvider` | 純顯示 |
| deep-cost | 模態/Top-N端點/Top-N使用者/狀態分布/延遲p50-p99/7×24熱力圖/浪費金額/月底投影/catalog vs 實際差異 | `apiUsage`下多支 costAnalytics 服務 | 純顯示分析頁，無表單 |
| **rate-limit** | 見下表 | `apiUsage.rateLimits.{list,upsert,delete}` | CRUD |
| billing | 日期篩選＋CSV匯出＋帳單明細表(供應商/端點/日期/呼叫數/單位數/費用) | `apiUsage.billing` | CSV 走 `toCsvRow` 防公式注入 |

### 4.1 rate-limit 新增規則表單（RateLimitTab）

| 欄位 | 型別 | state | 預設 | 選項 | zod（upsert） | 備註 |
|---|---|---|---|---|---|---|
| 規則類型 | Select | `form.ruleType` | "global" | global/per_user/per_api_key | ruleType(enum，必填) | — |
| 目標ID | Input | `form.targetId` | "" | — | targetId(≤128，選填) | 僅 ruleType≠global 時顯示 |
| 供應商 | Select | `form.provider` | "all" | all/fal_ai/gemini/elevenlabs/suno | provider(≤32，選填) | "all"→送 undefined |
| 每日呼叫上限 | Input number | `form.dailyCallLimit` | "" | int ≥0 | dailyCallLimit(選填) | — |
| 每日費用上限 | Input number step .01 | `form.dailyCostLimitUsd` | "" | ≥0 | dailyCostLimitUsd(選填) | — |
| 新增 | Button | — | — | — | 呼叫 upsert（永遠 id=undefined→只會 insert） | — |

規則列表操作：僅「刪除」（Trash icon）；**⚰ 無「編輯」入口**——`upsert` 的 zod 明明支援帶 `id` 更新既有規則、`isActive` 開關、以及 **`monthlyCostLimitUsd`**（server/routers/apiUsage.ts:97），但 `RateLimitTab` 表單完全沒有這三者的 UI：新增表單永遠不帶 `id`（只能新增不能改）、沒有月費上限欄位、沒有停用/啟用開關（規則一旦建立只能整條刪除）。三個都是 👻 隱藏能力。

### 4.2 alert_configs 告警規則——⚰ 整組前端不存在

`server/routers/apiUsage.ts:143-195` 有完整的 `alerts` 子路由：`list`（adminProcedure）／`upsert`（`alertType: budget|quota|anomaly`、`provider`、`thresholdPct 0-100`、`monthlyBudgetUsd`、`isActive`，支援帶 id 更新）／`delete`。全站（`client/src` 全文搜尋 `apiUsage.alerts`／`alertConfig`）**查無任何前端呼叫這組 API**——AdminApiUsagePage 的 5 個分頁裡沒有「告警規則」分頁或表單，其他頁面也沒有。01-features §3.4 記載「告警規則(alert_configs)CRUD 完整」，經本次逐欄核實：**CRUD 完整是指後端 router，前端完全沒有對應介面**，管理員無法透過 UI 設定或查看任何告警規則，只能靠 `server/jobs/apiUsageAlertJob.ts` 的 cron（且受 `ENABLE_BUDGET_ALERTS` gate）去讀一張永遠是空表或只能靠手動寫 SQL/API 塞資料的表。這是本次掃描最大的一個「完全孤兒」後端功能。

---

## 5. AiBrainPipelinePage（/admin/brain-pipeline）

| 控制項 | 型別 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 自動刷新 | Switch(SummaryBar內) | `autoRefresh` | true | — | 開啟時 30s 輪詢 `brainPipeline.getGraph` |
| 狀態篩選 | Select | `statusFilter` | "all" | 依 StatusFilter type(ok/degraded/down 等) | — |
| 視圖模式 | 按鈕組 | `viewMode` | "brain" | site/brain/operate/full（頁首文案提到 4 種） | 影響 PipelineCanvas 展開粒度 |
| 重新檢測 | Button | — | — | — | 觸發 `brainPipeline.runPatrol`（真實 ping）完成後 refetch 圖 |

純視覺化＋admin-only navigate 白名單，無資料寫入表單。

---

## 6. AiBrainSettings（嵌入 AdminPage「brain」分頁，內部另有 7 子分頁：config/alerts/errors/proposals/research/accuracy/langsmith）

### 6.1 config 子分頁——5 邏輯推理大腦（左側）＋4 生成引擎（左側）＋供應商健康/定價/ping（右側，未逐欄展開）

| 角色 | 欄位 | 型別 | state | 預設 | 範圍 | tRPC(`brain.upsert`) | 備註 |
|---|---|---|---|---|---|---|---|
| director/analyst/storyteller/technician/curator（各一組） | 模型 | Select（依 catalog 動態選項） | `xxxModel` | 各角色不同(如 director="anthropic/claude-opus-4.7") | REASONING_MODEL_ALLOWLIST[role] | xxxModel | zod `.refine` 檢查白名單 |
| 同上 | 溫度 Temperature | Slider | `xxxTemp` | director 0.7／analyst 0.3／storyteller 0.9／technician 0.2／curator 0.8 | 0–1 step .05（=zod min0 max1） | xxxTemperature | — |
| 同上 | Top P | Slider | `xxxTopP` | 0.9/0.8/0.95/0.7/0.9 | 0–1 step .05 | xxxTopP | — |
| 同上 | 啟用 | Switch | `xxxEnabled` | true | — | xxxEnabled | — |
| 同上 | 系統提示詞(選填) | Textarea | `xxxSystemPrompt` | "" | — | xxxSystemPrompt(nullable) | 留空＝用預設 |
| image/video/audio/voice（各一組） | 引擎 | Select | `xxxEngine` | image="fal-ai/flux-pro/v1.1" 等 | 依 catalog | xxxEngine | — |
| 同上 | 啟用 | Switch | `xxxEnabled` | true | — | xxxEnabled | — |
| 同上 | 引擎參數(JSON) | Textarea(JSON.stringify) | `xxxEngineParams` | "" | 自由 JSON | xxxEngineParams | 純文字編輯 raw JSON，無 schema 校驗提示，貼錯格式要送出才知道 |
| — | fal 各任務子引擎覆寫 | `falTaskEngines`(Record) | `FAL_TASK_DEFAULTS` | — | — | — | 每個 fal 任務類型可各自指定引擎，未在本表逐一展開（超出 L3 時間預算，見「未查完」） |

### 6.2 其餘 6 子分頁（alerts/errors/proposals/research/accuracy/langsmith）——僅盤點分頁存在與資料源，未逐欄

| 子分頁 | 元件檔 | 資料源(tRPC) | 備註 |
|---|---|---|---|
| alerts | `admin/brain/tabs/AlertsTab.tsx`(184行) | 未逐讀 | 命名易與 §4.2 的 `apiUsage.alerts`（budget/quota/anomaly 告警）混淆——實際上是「大腦健康告警」，非同一資料 |
| errors | `ErrorsTab.tsx`(346行) | `brain.errorTraces` 等 | 支援從 brain-pipeline 的 NodeDetailSheet 帶 `?brainTab=errors&trace=<id>` 深連結聚焦 |
| proposals | `ProposalsTab.tsx`(144行) | `brain.proposals`/`approveProposal`/`rejectProposal` | 與 AdminPage「ai-research」分頁重複，見 §3.3 結尾 |
| research | `ResearchTab.tsx`(255行) | `brain.errorTraces`/`researchResults`/`webSearch`/`addResearchToLearnHub` | 同上，`webSearch` mutation 為此子分頁獨有，AdminPage 版本沒有 |
| accuracy | `AccuracyTab.tsx`(234行) | 未逐讀 | — |
| langsmith | `admin/brain/tabs/LangsmithTab.tsx`(204行) | 未逐讀 | 與獨立 LangSmithPage（§9）功能可能重疊，未比對 |

---

## 7. DashboardPage（/dashboard，3 section：dashboard/credits/langsmith）

`dashboard` section 全唯讀：4 張統計卡（剩餘積分/總請求數/已消耗積分/今日請求）＋7日趨勢折線圖＋模態圓餅圖＋「請光球分析」按鈕（把 insights 摘要塞進聊天）。查詢：`trpc.dashboard.myStats`／`dashboard.insights`。無任何輸入欄位或 mutation。`credits`/`langsmith` section 分別內嵌 CreditsInfoPage／LangSmithPage（見 §8/§9，非重複定義，同一元件多處掛載）。

---

## 8. CreditsInfoPage（/credits）

純資訊頁：`trpc.credits.pricingCatalog`＋`credits.myBalance` 兩支唯讀查詢，渲染分類卡片(可展開/收合)＋FAQ 手風琴(`FAQItem`)。**零表單欄位、零 mutation**。PageAgent 只提供 navigate 白名單（6 個路徑）。

---

## 9. LangSmithPage（/langsmith 或 /dashboard?section=langsmith，5 分頁：overview/traces/comparison/datasets/export）

| 分頁 | 欄位/控制項 | state | 預設 | 選項 | tRPC | 備註 |
|---|---|---|---|---|---|---|
| overview | 連線狀態徽章＋健康統計 | — | — | — | `langsmith.healthStats`/`status` | 純顯示 |
| traces | Run 類型篩選 | Select | `runType` | undefined(全部) | all/llm/chain/tool/retriever | `listRuns` | — |
| traces | 僅錯誤切換 | Button(當Switch用) | `errorOnly` | false | — | `listRuns` | — |
| traces | 搜尋/標籤 | Input×2 | `search`/`tag` | ""/"" | — | `listRuns` | — |
| traces›詳情Dialog | 存入Dataset：Dataset名稱 | Input | `saveDatasetName` | "" | — | `addRunToDataset` | 需先選一筆 run |
| traces›回饋Dialog | 回饋說明(選填) | Textarea | `feedbackComment` | "" | — | `createFeedback`(score 1=讚/0=踩) | 只有二元評分，無 1-5 分等級 UI（zod 是否支援連續分數未查） |
| comparison | sampleSize 固定 100，無 UI 可調 | — | — | — | `modelComparison` | ⚰ sampleSize 寫死在程式碼，非使用者可調參數 |
| datasets | Run ID／Dataset名稱 | Input×2 | `addDialogRunId`/`addDialogDataset` | ""/"" | — | `addRunToDataset` | 與 traces 詳情內的存入功能重複（兩處都能做同一件事） |
| export | 導出格式 | Select | `format` | "openai" | openai/jsonl | `exportFineTuningData` | — |
| export | 最低評分 | Input number step .1 | `minScore` | 0.5 | 0–1 | 同上 | — |
| export | 數量上限 | Input number | `limit` | 50 | 1–500 | 同上 | 手動觸發(`enabled:false`)，按「搜尋優質案例」才查詢 |
| export | 下載 | Button | — | — | — | 產生 .json/.jsonl 檔案下載 | 需先執行過搜尋才有資料可下載 |

---

## 10. AccountSettingsPage（/account-settings，3 分頁：profile/security/activity）

| 分頁 | 欄位 | 型別 | state | 驗證 | 端點(REST，非 tRPC) | 備註 |
|---|---|---|---|---|---|---|
| profile | Email | Input(disabled) | `user.email` | — | — | 唯讀，文案明示「無法更改」 |
| profile | 顯示名稱 | Input | `name` | — | `PATCH /api/auth/profile` | 儲存鈕 `disabled={name === user?.name}` 防空提交 |
| profile›危險區域 | 刪除帳號 | Button→Dialog | `showDeleteDialog`/`deleteConfirmText` | 需手打 "DELETE MY ACCOUNT" 完全相符 | `profile.deleteAccount`(tRPC) | 唯一走 tRPC 的操作，其餘本頁都是裸 fetch |
| security | 目前密碼／新密碼／確認新密碼 | Input password ×3 | `currentPassword`/`newPassword`/`confirmPassword` | 新密碼需 8+碼含大小寫/數字/符號(`isStrongPassword`，5條件全過) | `POST /api/auth/change-password` | **強度顯示與送出門檻不一致**：`getPasswordStrength()` 只要 5 條件過 3 條就顯示「中」，但 `isStrongPassword()`(送出檢查)要求 5 條件全過——使用者看到「密碼強度：中」仍可能被擋在送出門檻外，這點與 ResetPasswordPage 共用同一套邏輯(§11) |
| security | 兩步驟驗證(2FA) | `TwoFactorSettings`元件 | 見下 | — | `/api/auth/2fa/{status,setup,verify,disable}` | 無備援/恢復碼 UI（後端也未查到 backupCode 欄位，非隱藏能力，屬未實作） |
| activity | 登入記錄列表(裝置/瀏覽器/OS/IP/成功失敗/時間) | — | `loginHistory` | — | `GET /api/auth/login-history?limit=10` | 純顯示 |
| activity | 匯出個人資料 | Button | `exportLoading` | — | `profile.exportData`(tRPC) | 下載 JSON |

2FA 元件（TwoFactorSettings）三態機：idle→setup(顯示secret+otpauth連結+6碼輸入)→enabled(輸入6碼才能停用)。啟用/停用皆需輸入當前動態碼，無「記住此裝置」選項。

---

## 11. ForgotPasswordPage / ResetPasswordPage

| 頁面 | 欄位 | 驗證 | 端點 | 備註 |
|---|---|---|---|---|
| ForgotPasswordPage | Email | HTML5 required | `POST /api/auth/forgot-password` | 429→固定文案「請求過於頻繁」；成功一律顯示同一句「若該Email存在會收到信」（防列舉），可「重新發送」 |
| ResetPasswordPage | 新密碼／確認密碼 | 同 AccountSettingsPage 的 `isStrongPassword`(5條件全過)，強度顯示邏輯同樣是「≥3條過=中」——**同一套不一致邏輯在兩頁各自重複貼一份**（未抽共用 util） | `GET /api/auth/verify-reset-token`(進頁先驗token)／`POST /api/auth/reset-password` | token 取自 URL `?token=`；驗證失敗給「重新申請」導向 forgot-password；成功 3 秒後自動導回首頁 |

---

## 12. 跨頁小結（給後續 wave 引用）

- **完全孤兒後端功能**（後端 CRUD 完整、前端 0 個入口）：`apiUsage.alerts`（budget/quota/anomaly 告警規則，§4.2）；`agentPreferences` 的 `mutedSpirits`/`favoriteSpirits`/`proactiveTriggerSettings`（§2）；`system_settings` 的 19 個頂層欄位（uiTheme 起，§1.1）。三組加總，是本次掃描面積最大的「後端做完、前端沒接」缺口，比 H2 doc 記錄的「每模型幾個隱藏欄位」規模大一個量級（這裡是整組功能，不是單一參數）。
- **前後端權限不一致的死/危控制項**：AdminPage users 分頁「配額更新」按鈕沒有 `!isAdmin` disable（角色 Select 有），leader 進 users 分頁可點但後端 403（§3.2）。
- **CRUD 半成品**：RateLimitTab 只能新增/刪除，不能編輯既有規則或改 `isActive`/`monthlyCostLimitUsd`（§4.1）。
- **重複 UI（同資料兩套介面）**：AI 提案審核（AdminPage「ai-research」vs AiBrainSettings「proposals」+「research」，§3.3/§6.2）；LangSmith 存入 Dataset（traces 詳情 Dialog vs datasets 分頁表單，§9）。
- **UX 一致性小問題**：密碼強度顯示「中」但送出要求全通過，AccountSettingsPage 與 ResetPasswordPage 各自複製一份同樣邏輯（§10/§11）。
- **純唯讀頁**（零表單/零 mutation，符合預期非缺陷）：DashboardPage 的 dashboard section（§7）、CreditsInfoPage（§8）。

---

## 13. 未查完部分（缺讀聲明）

- AiBrainSettings 的 6 個子分頁（alerts/errors/proposals/research/accuracy/langsmith，共 1367 行）僅盤點分頁存在與資料源，**未逐欄位讀完**（尤其 AlertsTab 的告警規則欄位、AccuracyTab 的精準度測試表單、ErrorsTab 的錯誤篩選器）——與 §4.2 的 `apiUsage.alerts` 是否為同一機制或另一套告警系統，需下一輪確認。
- `falTaskEngines`（AiBrainSettings 的 fal 任務級引擎覆寫 Record）未展開逐一任務類型欄位。
- AdminApiUsagePage 的 `DeepCostTab`（572-1150 行左右，約 580 行）只讀了功能清單（Top-N/熱力圖/浪費金額/月底投影等），未逐一小節位置與互動細節（是否有可調參數如 Top-N 筆數、日期範圍是否影響全部子卡）。
- LangSmithPage 的 `ComparisonTab`／`OverviewTab` 內部圖表細節與 `PROVIDER_LABELS`/健康分數計算未深入。
- AccountSettingsPage 的 2FA 是否有「備援碼」在後端 totpService.ts 完全沒查（初步 grep 未見 backupCode，判斷為未實作而非隱藏，但未讀 totpService.ts 原始碼確認）。
- AgentPreferencesPage 的 `ScheduleTab`（orbScheduler router）只讀了前端表單，未核對 `orbScheduler.scheduleJob` 的後端 zod（cron 格式驗證、任務描述長度上限等）。
- SettingsPage 的 `AvatarStudio` 元件（頭像上傳）未展開內部欄位（裁切/格式限制等）。
