# IN4 — 前後端契約:設定/管理/認證/計費域
- 產生日期:2026-07-03
- 依據 commit:812f6fdb(taskcards 全庫慣用引用值;本機 `git log -1` 實測 HEAD 為 `7f4417da`,兩者 diff 對本次追蹤的 7 個 router + 5 個 client 檔無影響,以下行號皆以 HEAD 實測為準)
- 稽核接縫:server/routers/{auth,credits,plans,admin,apiUsage,rbac,teams}.ts ↔ client/src/pages/{SettingsPage,AdminPage,AdminApiUsagePage,ModelsPage}.tsx + hooks/useAuth.ts

## 讀法
本次稽核發現「頁面本身兩端字段對得上」不是這個域最大的風險——最大的風險出在**兩層路由切換**:
`ENABLE_4SHELL`(預設 ON)+ `SHELL_SETTINGS_RICH`(預設 ON,`.env.production:21,29` 生產環境明確雙開)會讓
`/admin`、`/admin/api-usage` 被 `LEGACY_REDIRECTS`(`client/src/shells/shellRouteTable.ts:111-113`)導向
`/settings/admin`、`/settings/admin/api-usage`,而 `/settings/admin` 在富 shell 下渲染的是全新的
`SettingsHome→AdminPanel`(`client/src/shells/settings/SettingsShell.tsx:36`),**不是**題目點名要查的
`AdminPage.tsx`。`AdminPage.tsx` 本體仍存在、仍會被 `shellRouteTable.ts:64` 當作 `/settings/admin` 的
fallback 元件表列,但只有把 `VITE_SHELL_SETTINGS_RICH` 退回 0 才會真的渲染到它——**生產環境預設看不到它**。
`AdminApiUsagePage.tsx` 則兩邊都会渲染(`SettingsShell.tsx:42` 直接 re-home 舊頁,無替代品),
`SettingsPage.tsx` 同理在 `SHELL_SETTINGS_RICH=ON` 下被 `SettingsHome` 取代。

因此以下依「實際會被使用者看到的介面」優先排序:F-1/F-2 是這層路由切換造成的**功能性退化**
(比純粹的欄位對不上更嚴重,直接是使用者能力消失);F-3/F-4 是本次新查獲、範圍明確落在題目七個
router 內的敏感欄位外洩;F-5 是一個具體、可重現的列舉值漂移 bug;之後是三個孤兒契約與若干
already-known 卡的現況確認。文末列「已驗證接得對的接縫」。

---

### F-1 [critical] broken-handoff — 生產環境預設下,`AdminPage.tsx` 呼叫的 6 個 admin procedure 已無任何存活 UI 入口
- **client 端(舊契約,現預設不可達)**:`client/src/pages/AdminPage.tsx:280-282`(`admin.teamCostSummary`)、`:295-298`(`admin.systemDailyTrend`)、`:291-294`(`admin.apiProviderBreakdown`)、`:299-302`(`admin.allGenerationHistory`)、`:390-397`(`admin.updateAutoCreditPolicy`)、`:398-401`(`admin.runAutoCreditNow`)
- **server 端(procedure 仍在,仍可被呼叫)**:`server/routers/admin.ts:43-62`(`updateAutoCreditPolicy`,`leaderOrAdminProcedure`)、`:64-67`(`runAutoCreditNow`)、`:75-116`(`teamCostSummary`)、`:134-138`(`allGenerationHistory`)、`:144-146`(`apiProviderBreakdown`)、`:148-152`(`systemDailyTrend`)
- **路由切換證據**:`client/src/app/ShellRoutes.tsx:47-89`(shellRoutes() 把 `LEGACY_REDIRECTS` 排在 `<Switch>` 最前,shadow 掉 App.tsx 舊 `<Route path="/admin">`)、`client/src/shells/shellRouteTable.ts:111-113`(`/admin`→`/settings/admin`、`/admin/api-usage`→`/settings/admin/api-usage`)、`client/src/shells/settings/SettingsShell.tsx:23-36`(`SHELL_SETTINGS_RICH` ON 時 `/settings/admin` 渲染 `SettingsHome(initial="admin")` 而非 `P.AdminPage`)、`client/src/shells/settings/panels/AdminPanel.tsx:27-33`(新後台只剩 5 個分頁:users/content/flags/data-repair/audit,無「成本金流」「自動給點」「生成紀錄」「API 供應商拆解」「每日趨勢」對應分頁)、`.env.production:21`(`VITE_ENABLE_4SHELL=1`)、`.env.production:29`(`VITE_SHELL_SETTINGS_RICH=1`)
- **影響**:「使用者・積分」分頁收斂進新後台後,原本 10 分頁 `AdminPage.tsx` 裡的「成本金流」(team cost 拆解 + USD/TWD 換算)、「自動給點政策」(per-user 排程 + 立即執行)、「生成紀錄」(全站 generation history 稽核)、「API 供應商拆解」與「每日趨勢圖」**在正式站(`VITE_ENABLE_4SHELL=1` + `VITE_SHELL_SETTINGS_RICH=1` 皆為目前 `.env.production` 實際值)下沒有任何可達的 UI 入口**——不是後端拿掉了這些能力(procedure 仍完整可呼叫、仍可用 API client 手動打),而是前端富 shell 遷移時把「10 分頁精簡為 6 治理面(＋觀測移到上層)」,但成本/自動給點/生成紀錄/供應商拆解/趨勢圖這五類實質沒有被精簡進新分頁,是直接消失,且沒有任何「功能已搬遷/待建」的告示(對照 `DataRepairTab.tsx:53-56` 明確承認「無 dataRepair procedure」的誠實作法,這五個反而是無聲消失)。唯一還原方式是替 Railway 設 `VITE_SHELL_SETTINGS_RICH=0` 整頁退回舊 UI(連帶失去新後台其他改善)。
- **建議**:短期在 `AdminPanel.tsx` 加回這五類(或至少加一個「舊版完整後台」逃生分頁連結到 `/admin?legacy=1` 之類機制保留 `AdminPage.tsx` 可達性);中期把 `ADMIN_TABS`/`ADMIN_TAB_MIN_ROLE` 與 admin.ts 實際 14 個 procedure 做一次逐條映射表,避免下一次遷移再次無聲丟功能。

---

### F-2 [critical] contract-mismatch — 前端 RBAC 契約宣稱「使用者・積分」分頁 leader 可看,後端兩個關鍵 procedure 卻是 admin 專屬,leader 進分頁 100% 只看到錯誤
- **client 端契約(宣稱 leader 可用)**:`client/src/shells/settings/rbac.ts:30-37`(`ADMIN_TAB_MIN_ROLE.users = "leader"`,註解明寫「使用者列表 leader 可看；改角色(updateRole)僅 admin」)、`client/src/shells/settings/admin/UsersCreditsTab.tsx:6-10`(檔頭註解列 `admin.allUsers`/`admin.updateQuota`/`admin.updateRole`/`admin.updateAutoCreditPolicy` 皆標 ✅)、`:34-40`(`trpc.admin.allUsersPaginated.useInfiniteQuery` 無角色判斷直接呼叫)、`:43-46`(`trpc.admin.updateQuota.useMutation`)、`:82-83`(+500/-100 按鈕僅 `disabled={quota.isPending}`,**無** `!isAdmin` 檔位,leader 點得到)
- **server 端實際守門**:`server/routers/admin.ts:18-27`(`allUsersPaginated: adminProcedure`)、`:29-39`(`updateQuota: adminProcedure`)——`adminProcedure`(`server/_core/trpc.ts:69-88`)嚴格要求 `role === "admin"`,leader 一律 `FORBIDDEN`,與同檔 `leaderOrAdminProcedure`(`:95-...`)刻意分流的兩級授權完全不同級
- **影響**:leader 角色使用者打開「管理後台 → 使用者・積分」分頁時,`AdminPanel.tsx:39`(`roleAtLeast(role,"leader")`)放行進入分頁,`UsersCreditsTab.tsx:34` 立刻對 `admin.allUsersPaginated` 發請求,後端因非 admin 回 `FORBIDDEN`,前端顯示 `usersQ.isError` 分支「需要管理員權限。」(`UsersCreditsTab.tsx:67-69`)——即整個分頁對 leader 而言**列表永遠是空的、只顯示一行錯誤**,+500/-100 調配額按鈕即使渲染出來、leader 點下去也會因 `updateQuota` 同為 `adminProcedure` 而失敗。三處獨立文件(`rbac.ts` 註解、`UsersCreditsTab.tsx` 檔頭註解、`AdminPanel.tsx:8` 「使用者・積分=leader+」)都明確記載「leader 應該能看＋調額度」的設計意圖,但實作從未接上——這不是「忘記寫 RBAC」,是**RBAC 契約寫對了、procedure 授權等級沒跟著配**。與此形成對照的是同一檔案內 `admin.updateAutoCreditPolicy`(`admin.ts:43`)正確用了 `leaderOrAdminProcedure`,證明專案清楚兩級區分,只是 `allUsersPaginated`/`updateQuota` 這兩個沒套用。
- **建議**:若產品意圖真的是「leader 可看清單＋調配額,只有改角色鎖 admin」,把 `admin.allUsersPaginated`/`admin.updateQuota` 改成 `leaderOrAdminProcedure`(`updateRole` 維持 `adminProcedure` 不動);若意圖是「leader 不該碰使用者財務資料」,則應把 `ADMIN_TAB_MIN_ROLE.users` 改回 `"admin"`、拿掉三處註解裡的錯誤宣稱。兩者選一,現況是「宣稱與實作互相打臉」。
- **附帶小發現(同一份 `ADMIN_TAB_MIN_ROLE`,field-inconsistency,severity low,不單獨計分)**:`rbac.ts:32` 定義了 `credits: "leader"` 門檻,但 `AdminPanel.tsx:27-33` 的 `ADMIN_TABS` 陣列裡**沒有 `key: "credits"` 這個分頁**——`teamCostSummary`(F-1 已記錄同一批消失功能)原本掛在這個 tab key 下,新分頁表精簡時連對應的 RBAC 門檻設定都一起變成死設定,未清除。

---

### F-3 [high] contract-mismatch / S-00 延伸確認 — `auth.me` 全列洩漏現況不變;新查獲 `admin.allUsers`/`admin.allUsersPaginated` 把同一批敏感欄位(passwordHash/twoFactorSecret/icsFeedToken)洩漏給**每一位 admin**,涵蓋**全站所有使用者**(非僅本人)
- **S-00 現況確認(auth.me,未變,GC1 已記錄,此處僅在本次追蹤檔案內重新驗證)**:`server/routers/auth.ts:9`(`me: publicProcedure.query(opts => opts.ctx.user)`)回傳 `TrpcContext.user`(`server/_core/context.ts:10`,型別 `User`,`drizzle/schema.ts:78` `typeof users.$inferSelect`,含 `passwordHash`(schema.ts:31)、`twoFactorSecret`(schema.ts:33)、`icsFeedToken`(schema.ts:58))未做欄位白名單。`server/_core/googleAuth.ts:481` → `db.getUserByOpenId`(`server/db.ts:495-504`,`db.select().from(users)...`,全欄位)證實整條鏈路無投影。前端 `client/src/_core/hooks/useAuth.ts:58-61` 把 `meQuery.data` 整包 `JSON.stringify` 寫入 `localStorage`(key `manus-runtime-user-info`)。本次在追蹤範圍內的 `SettingsPage.tsx` 逐一核對,實際只讀了 `user?.role`(:307)、`user?.avatarUrl`(:653)、`user?.name`(:654,669,721)、`user?.email`(:677)、`user?.remainingGenerations`(:691)五個欄位,**驗證「前端根本沒用到 passwordHash/twoFactorSecret/icsFeedToken/orbMemorySummary/quotaJson」這個既有結論在本次追蹤頁面內成立,純多餘外洩無新增用途**。
- **新查獲部分(admin.allUsers / admin.allUsersPaginated,GC1/S-00 未提及此端點,B-25 亦未涵蓋)**:`server/routers/admin.ts:13-15`(`allUsers: adminProcedure.query(() => db.getAllUsers())`)、`:18-27`(`allUsersPaginated`)。`db.getAllUsers()`(`server/db.ts:568-572`)與 `db.getAllUsersPaginated()`(`:575-589`)皆為 `db.select().from(users)`——同一張表、同一組敏感欄位、**零投影**,回傳陣列筆數上看 10000 筆(`getAllUsers` 硬編 limit)。
- **client 端消費(兩條線都在追蹤範圍內)**:`client/src/pages/AdminPage.tsx:210`(`admin.allUsers`)在 :437-471 實際使用 `u.autoCreditEnabled`/`u.autoCreditNextAt`/`u.autoCreditAmount`/`u.name`/`u.email`/`u.id`——比 `auth.me` 多用了幾個欄位,但 `passwordHash`/`twoFactorSecret`/`icsFeedToken`/`orbMemorySummary` 仍完全未被讀取;`client/src/shells/settings/admin/UsersCreditsTab.tsx:34,52,55,76-80`(`admin.allUsersPaginated`)更只用 `id`/`name`/`email`/`role`/`remainingGenerations` 五欄,且該檔案型別直接宣告成 `const users: any[]`(:52),完全無型別邊界防護。
- **影響**:任一 admin 帳號登入後台「使用者・積分」分頁,瀏覽器 Network tab / React Query cache 就拿到**全站每一位使用者**的 `passwordHash`(本地帳密雜湊)、`twoFactorSecret`(TOTP 明碼種子)、`icsFeedToken`(該使用者私人行事曆 ICS feed 的有效 bearer token,無需其他驗證即可用來訂閱該使用者行事曆)。比起 `auth.me` 只洩漏「自己」的密鑰,這是**洩漏所有人**的密鑰給每一個 admin 的瀏覽器分頁——攻擊面從「self-XSS」升級為「任一 admin 端點被入侵 = 全站帳密雜湊 + 全體 2FA 種子 + 全體行事曆 token 外流」。已知修法(`server/db.ts` 內 `getUserAccountInfo` 風格的欄位白名單投影,GC1 已指出此範例)未套用到 `getAllUsers`/`getAllUsersPaginated`。
- **建議**:立即把 `getAllUsers`/`getAllUsersPaginated` 改成欄位白名單(id/name/email/role/remainingGenerations/autoCredit*/createdAt/lastSignedIn 等治理必需欄位),與 `getUserActivitySummary`(見下方「已驗證接得對的接縫」)同款寫法;`auth.me` 修法維持 GC1 既有建議。

---

### F-4 [high] field-inconsistency — `DataRepairTab.tsx` 的「卡住任務」篩選條件命中值不存在於 DB enum,永遠漏抓真正卡住的 processing 任務
- **client 端**:`client/src/shells/settings/admin/DataRepairTab.tsx:22-27`
  ```
  const jobsQ = trpc.admin.allBackgroundJobs.useQuery({ limit: 100 }, { retry: false });
  const stuck = all.filter((j) => {
    const s = String(j.status ?? "");
    return s === "failed" || s === "running" || s === "queued";
  });
  ```
- **server/schema 端真值**:`drizzle/schema.ts:301-309`(`backgroundJobs.status` = `mysqlEnum(["queued","processing","completed","failed","cancelled"])`)——**沒有 `"running"` 這個值**,進行中任務一律是 `"processing"`。`server/db.ts:3092-3100`(`getAllBackgroundJobs`,`select()` 直接回傳原始列,`status` 欄位原樣傳遞)、`server/routers/admin.ts:154-158`(`allBackgroundJobs: adminProcedure...`)未做值轉換。
- **影響**:`s === "running"` 這個分支永遠不會命中(DB 裡從未出現過這個字串),於是「卡住 / 失敗任務」清單只會顯示 `failed` 與 `queued`,**任何卡在 `processing` 超過預期時間的任務(定義上最典型的「卡住」情境)完全被這個診斷面板漏掉**,管理員會誤以為系統目前沒有卡住的任務。
- **交叉印證(同一份資料,兩個其他消費端都寫對了,證明這是 `DataRepairTab.tsx` 自己的迴歸,不是 enum 本身有歧義)**:`client/src/pages/AdminPage.tsx:1445-1456`(`statusColors` 物件正確含 `processing` 鍵)、`client/src/shells/settings/StatusPill.tsx:18`(`mapStatus()` 正確把 `"processing"` 併入 warn 分類,且此元件本身就是 `DataRepairTab`/`ObservabilityPanel` 共用元件的檔頭註解所指的來源)。`DataRepairTab.tsx` 是唯一一處把篩選邏輯獨立內嵌、繞開 `StatusPill.mapStatus()` 共用邏輯的地方,才引入這個字面值漂移。
- **建議**:把 `stuck` 的判斷改成 `s === "failed" || s === "processing" || s === "queued"`,或直接匯入 `StatusPill.mapStatus()` 的分類結果(`kind === "warn" || kind === "bad"`)避免同一組狀態值在兩處各寫一份、其中一份漂移。

---

### F-5 [high] dead-seam — `plansRouter`(訂閱方案)整條契約全站零呼叫,孤兒端點
- **server 端**:`server/routers/plans.ts:7-17`(`plansRouter = router({ list, getById })`),`list` 呼叫 `db.getActivePlans()`、`getById` 呼叫 `db.getPlanById(id)`(`server/db.ts:2368-2386`),兩者都對真實存在、有資料的 `subscriptionPlans` 表做查詢——**不是空殼表**,是有底層資料但沒有任何前端畫面在讀的完整功能。
- **client 端**:對 `client/src/` 全樹搜尋 `trpc.plans.`,**零命中**(`grep -rn "trpc\.plans\." client/src/` 無結果;唯一含 `plans` 字樣的匹配是 `TeamModelTrainingPanel.tsx`/`ProjectAccessRulesPanel.tsx`/`PromptCollectionPage.tsx`/`TeamsPage.tsx`/`TeachingArchive.tsx` 呼叫的是 `trpc.teams.*`,與 `plansRouter` 無關,誤判排除)。本次委託追蹤的四頁(`SettingsPage`/`AdminPage`/`AdminApiUsagePage`/`ModelsPage`)皆未呼叫。
- **影響**:`plans.list`/`plans.getById` 是完全建好但沒有任何 UI 消費的訂閱方案查詢 API——若產品線期望使用者能在 `/settings` 看到「目前方案 / 升級選項」,這塊完全沒接;若方案功能已被砍掉,這是應清理的死碼(含底層 `subscriptionPlans` 表與資料)。
- **建議**:向產品確認訂閱方案功能現況——若在建置中,補上 `SettingsPage.tsx` 的方案顯示區塊；若已棄用,一併評估是否要清掉 `plansRouter`/`subscriptionPlans` 表。

---

### F-6 [medium] dead-seam — `rbacRouter`(資源共享/移轉擁有權)整條契約全站零呼叫;另有同名前端工具檔造成命名混淆風險
- **server 端**:`server/routers/rbac.ts:115-302`(`rbacRouter = router({ listShares, share, revokeShare, transferOwnership })`),四個 procedure 皆為 `protectedProcedure` + owner 驗證 + `recordAuditEvent`,`transferOwnership` 另受 `ENABLE_DATA_RBAC` 旗標保護(`:241-289`)——功能完整、非佔位程式碼。
- **client 端**:對 `client/src/` 全樹搜尋 `trpc.rbac.`,**零命中**。追蹤範圍四頁與 `useAuth.ts` 均未呼叫。
- **命名混淆(未在兩端驗證,僅提醒)**:`client/src/shells/settings/rbac.ts` 是完全不同的東西——純前端 `useRole()`/`roleAtLeast()`/`canSeeAdminTab()` UI 顯示工具(對照 F-2),與 server 的 `rbacRouter`(資料層資源共享)**同名但零關聯**。日後若有人以為「前端 rbac.ts 已經對接 server rbacRouter」,會誤判此契約狀態;本報告予以澄清避免誤導。
- **影響**:AIDV-121(資料層 RBAC 基礎版)已完整實作 server 端共享/撤銷/移轉擁有權能力,但無任何入口讓使用者觸發——功能對終端使用者不可見,「成員離開時把素材交接避免孤兒」這個 `transferOwnership` 設計的核心情境(檔頭註解明寫)目前無法達成,因為沒有 UI 呼叫它。
- **建議**:確認是否有其他前端(如專案/素材管理頁,不在本次四頁範圍)預計串接此 router;若目前完全沒有排期,在 router 檔頭補一行「待接 UI」的現況註記,避免與已完工功能混淆。

---

### F-7 [medium] dead-seam — `apiUsageRouter` 11 個端點中有 5 個(alerts CRUD/snapshots/costAttribution/usageEvents/providerReadiness)全站零呼叫
- **server 端**:`server/routers/apiUsage.ts:143-195`(`alertConfigRouter`,list/upsert/delete 三個 procedure)、`:625-640`(`snapshots`)、`:646-727`(`costAttribution`,AIDV-14/191 的 TWD 成本歸屬彙總)、`:398-440`(`usageEvents`,分頁事件日誌)、`:200-227`(`providerReadiness`)。
- **client 端**:`client/src/pages/AdminApiUsagePage.tsx` 實際呼叫的只有 `overview`(:121)、`usageByProvider`(:218)、`rateLimits.{list,upsert,delete}`(:310-317)、`billing`(:457)、`deepCost`(:577)——**六個**。對 `client/src/` 全樹搜尋 `trpc.apiUsage.alerts`/`.snapshots`/`.costAttribution`/`.usageEvents`/`.providerReadiness`,**全部零命中**;`textLlmStatus` 雖也未被本頁使用,但確認被 `client/src/shells/video/console/CreationFlowBar.tsx` 呼叫,非死碼。
- **影響**:與同檔案內結構幾乎一致的 `rateLimitRouter`(CRUD,已接 UI,:308-443)相比,`alertConfigRouter`(同款 CRUD 結構,:143-195)完全沒有對應的告警規則管理面板——功能已在後端建好卻沒有入口;`costAttribution`(專案/成員/工作流程 TWD 成本歸屬,AIDV-14 標記為重要治理需求)也是完整建好、零呼叫;`usageEvents`(原始事件分頁瀏覽,供 debug 用)與 `snapshots`(單一供應商歷史快照)兩者的資料在 `overview`/`deepCost` 已有摘要形式呈現,但沒有更細顆粒度的鑽取入口。
- **建議**:`AdminApiUsagePage.tsx` 目前的分頁結構(Overview/Providers/RateLimit/Billing/DeepCost)可以直接加一個「告警規則」分頁複用 `RateLimitTab` 的 UI 骨架呼叫 `alerts.*`;`costAttribution` 建議併入 `DeepCostTab` 或另開一個「成本歸屬」分頁,避免這塊 AIDV-14/191 特別花力氣做的歸屬邏輯繼續閒置。

---

### F-8 [low] 範圍註記(非缺陷)— `ModelsPage.tsx` 與本次七個 router 中的六個(auth 除外經由全站共用不算)完全無交集;`credits`/`plans`/`teams`/`rbac` 的真正 client 端在題目範圍外
- 對 `client/src/pages/ModelsPage.tsx` 全文搜尋 `trpc.`,命中的全部是 `trpc.models.*`(LoRA/自訓模型)與 `trpc.generate.jobStatus`——**沒有任何 `auth`/`credits`/`plans`/`admin`/`apiUsage`/`rbac`/`teams` 呼叫**。`ModelsPage.tsx` 實際上是自訓模型管理頁,與本次追蹤的「設定/管理/認證/計費」域是不同的功能域;題目把它與這七個 router 並列稽核,在本次程式碼裡**未在兩端驗證**出對應關係。
- 附帶確認:`credits.myBalance`/`credits.pricingCatalog`/`credits.jobRefundStatus` 三者皆非死碼——分別在 `client/src/pages/CreditsInfoPage.tsx`、`client/src/components/DashboardLayout.tsx`、`client/src/shells/learn/panels/CreditsUsagePanel.tsx`、`client/src/components/RefundStatusBadge.tsx` 等檔案被呼叫,只是都不在本次點名的四個頁面內,故列為「未在兩端驗證」而非「dead-seam」。`teams.ts` 同理,真正呼叫者是 `TeamsPage.tsx`(learn shell 下)、`TeamModelTrainingPanel.tsx`、`ProjectAccessRulesPanel.tsx`,不在本次四頁範圍。
- **建議**:若後續要稽核「積分餘額顯示是否正確」,正確的目標檔案組合是 `credits.ts` ↔ `CreditsInfoPage.tsx`/`DashboardLayout.tsx`/`CreditsUsagePanel.tsx`,而非本次指定的四頁。

---

### 已知卡現況確認(本次範圍內複核,非新發現)
- **S-00**(`auth.me` 洩 passwordHash/2FA):在本次追蹤檔案內**現況不變、已於 F-3 重新驗證**——`auth.ts:9`、`useAuth.ts:58-61`、`SettingsPage.tsx` 實際只用 5 欄位,與 GC1 原始判定一致。
- **B-25**(`credits.myBalance`/財財精靈資料源只餵舊版 `generate.ts`):`credits.ts:55-82` → `db.getUserCostSummary`(`db.ts:1940-1970`)確認仍是查 `apiUsageLogs` 表(舊版 generate.ts 專用寫入路徑),**現況不變**;但 `myBalance` 本身不在本次四頁的呼叫清單內(見 F-8),故僅重新核對 server 端現況,client 端消費者需另案追蹤。
- **SSOT-1**(`appRegistry.supportedActions`↔`hasCapabilityForPage`):對本次七個 router 檔 + 四個 client 頁 + `useAuth.ts` 搜尋 `supportedActions`/`hasCapabilityForPage`,**零命中,未在兩端驗證**,本次不予延伸。
- **C-01/C-02/B-19**(VideoStudio/DirectorAI/ProStudio 相關):與本次「設定/管理/認證/計費」域完全不同功能域,本次七個 router + 四頁範圍內無交集,**未在兩端驗證,不予評論**。

---

## 已驗證接得對的接縫(negative results)

1. **`admin.systemStats` ↔ `AdminPage.tsx`**:`server/db.ts:2866-2906` 回傳 `{totalUsers,totalGenerations,totalApiCalls,totalCost,totalJobs,activeJobs,failedJobs,totalAssets,totalFeedbacks}`,`AdminPage.tsx:612-639` 逐一讀取 `stats.totalUsers`/`totalGenerations`/`totalApiCalls`/`totalCost`/`totalJobs`/`activeJobs`/`failedJobs`/`totalAssets`,**九個回傳欄位對上八個被讀取欄位,完全吻合,無多餘無缺漏**(`totalFeedbacks` 未被此頁使用,但不構成缺陷)。
2. **`admin.userActivity` ↔ `AdminPage.tsx`**:`server/db.ts:2933-2953` 用 `db.select({...})` **正確做欄位白名單投影**(userId/name/email/role/remainingGenerations/createdAt/lastSignedIn/totalApiCalls/totalCost/totalGenerations/totalAssets),不是整列 `users` 表——與 F-3 的 `getAllUsers`/`getAllUsersPaginated` 形成鮮明對照,證明專案內部知道正確寫法、只是沒有全面套用。`AdminPage.tsx:989-1019` 讀取的 `a.userId`/`a.name`/`a.role`/`a.lastSignedIn`/`a.email` 全部對得上。
3. **`admin.teamCostSummary` ↔ `AdminPage.tsx`**:`server/routers/admin.ts:93-116` 回傳 `totals: {usd,twd,credits,requests,tokens}`,`AdminPage.tsx:1278-1301` 讀取 `costQuery.data.totals.credits`/`.usd`/`.twd`(經 `formatTwd`)/`.requests`/`.tokens`,五個欄位全部吻合。
4. **`admin.apiKeysStatus` ↔ `AuditTab.tsx`**:`server/routers/admin.ts:183-188` 回傳 `{name,label,module,isSet}`,`AuditTab.tsx:47-51` 逐一讀取 `k.name`/`k.label`/`k.module`/`k.isSet`,完全吻合;檔頭註解「不暴露 secret」與實作一致(僅回 boolean)。
5. **`admin.usageLogs` ↔ `AuditTab.tsx`**:`server/db.ts:1930-1938` 對 `apiUsageLogs` 表做 `select()`,client 讀取的 `a.createdAt`/`a.userId`/`a.requestType`/`a.model`/`a.apiProvider`(`AuditTab.tsx:74-77`)在 `drizzle/schema.ts:656-696` 全部是真實欄位(含 `model` varchar,:689)——`a.ts`/`a.date`/`a.actor`/`a.userEmail`/`a.detail`/`a.kind`/`a.type` 等 fallback 欄位雖不存在,但因主欄位一定命中,不構成實際缺陷,純防禦性寫法。
6. **`apiUsage.overview`/`usageByProvider`/`rateLimits`/`billing`/`deepCost` ↔ `AdminApiUsagePage.tsx`**:逐一核對 `OverviewTab`(:120-210)、`ProvidersTab`(:214-304)、`RateLimitTab`(:308-...)、`BillingTab`(:453-542)、`DeepCostTab`(:572-...)讀取的欄位(`monthCalls`/`monthCost`/`totalBalance`/`errorRate24h`/`dailyCosts`/`providerBalances`/`providers[].latestSnapshot`/`.recentCosts`/`rows[].provider/endpoint/date/callCount/totalUnits/totalCostUsd`/`window`/`projection`/`waste`/`latency` 等),與 `server/routers/apiUsage.ts:247-728` 的回傳物件逐欄比對**無一處不符**,是本次追蹤範圍內契約品質最好的一組。
7. **`admin.apiKeysStatus`/`admin.systemStats` 的 RBAC gate 表達一致**:`ObservabilityPanel.tsx:32-33`(`enabled: isAdmin`)與後端 `adminProcedure` 一致,不像 F-2 那樣有落差。

---

## 附註:各項嚴重度與 cluster 對照

| 編號 | cluster | 嚴重度 |
|---|---|---|
| F-1 | broken-handoff | critical |
| F-2 | contract-mismatch | critical |
| F-3 | contract-mismatch(S-00 延伸) | high |
| F-4 | field-inconsistency | high |
| F-5 | dead-seam | high |
| F-6 | dead-seam | medium |
| F-7 | dead-seam | medium |
| F-8 | other(範圍註記) | low/informational |
