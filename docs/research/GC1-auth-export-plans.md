# GC1 — auth/export/plans router 深挖(CC0 缺口)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/auth.ts(41)、server/routers/export.ts(56)、server/routers/plans.ts

> 稽核方法:逐行讀檔 + 追蹤呼叫鏈(server/_core/context.ts、server/_core/googleAuth.ts、server/db.ts、drizzle/schema.ts、client/src/_core/hooks/useAuth.ts 等),用 grep 驗證「有無其他呼叫端」與「欄位是否敏感」,不臆測。每筆發現皆為對抗式驗證後仍成立者;無法在本次範圍內驗證的部分已明記「未在本檔驗證」。

---

## 發現 1(critical / cluster: other)— `auth.me` 回傳整筆 User row,含 passwordHash / twoFactorSecret / icsFeedToken;前端再整包存入 localStorage 明文

**發現**
`server/routers/auth.ts:9`:
```
me: publicProcedure.query(opts => opts.ctx.user),
```
`opts.ctx.user` 的型別與內容來自 `server/_core/context.ts:22`(`user = await authenticateRequest(opts.req)`)→ `server/_core/googleAuth.ts:481`(`const user = await db.getUserByOpenId(payload.sub)`)→ `server/db.ts:495-503` 的 `getUserByOpenId`:
```
const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
```
`select()` 未指定欄位,等於整表 SELECT *。`drizzle/schema.ts:23-76` 的 `users` table 定義中包含:
- `passwordHash`(line 31,varchar 255,本地帳密雜湊)
- `twoFactorSecret`(line 33,varchar 64,TOTP base32 明碼種子)
- `twoFactorEnabled`(line 35)
- `icsFeedToken`(line 58,行事曆 ICS feed 的裸 bearer token)
- `orbMemorySummary`(line 60,使用者 AI 對話濃縮摘要)

`auth.ts` 沒有 `.output()` schema、沒有欄位白名單,直接把這顆完整 row 序列化回傳給任何呼叫 `auth.me` 的 client。

本地帳密登入確實有在用(非僅 Google OAuth 死路徑):`server/services/auth/AuthFacade.ts`、`server/routes/localAuth.ts`、`server/routes/passwordResetRoutes.ts` 均會寫入/驗證 `passwordHash`、`twoFactorSecret`,故這些欄位在正式資料庫中對本地帳號使用者是有值的,非恆為 null。

且此路由碼庫本身已明確意識到這個風險並在別處做了正確處理——`server/db.ts:2076-2080` 的 `getUserAccountInfo()` 註解直寫:「取 accountant 算預算/自動加值狀況需要的欄位 — 不回傳整個 user row(**省記憶體 + 避免外洩 passwordHash / 2FA secret**)」,並改用 `db.select({ remainingGenerations: ..., quotaJson: ... })` 的欄位白名單。`auth.me` 未套用同樣的模式。

前端再把這包含密鑰的完整物件整包持久化:`client/src/_core/hooks/useAuth.ts:57-61`
```js
const state = useMemo(() => {
  localStorage.setItem(
    "manus-runtime-user-info",
    JSON.stringify(meQuery.data)
  );
  ...
```
`meQuery.data` 即 `trpc.auth.me` 的回傳值(line 16-19,`trpc.auth.me.useQuery(...)`),沒有任何 CAPTURE/開發旗標保護,正式環境每次執行皆會寫入 `localStorage`(明碼、非 httpOnly、任何同源 JS 皆可讀)。

`grep` 確認 `trpc.auth.me` 在 client 端被大量元件呼叫(`AgentSettingsSheet.tsx`、`AvatarStudio.tsx`、`GlobalOrbChatContext.tsx`、`usePreferredStudioModel.ts`、`useAuth.ts`、`AgentPreferencesPage.tsx`、`Studio.tsx` 等),幾乎是全站通用的登入狀態檢查點,並非邊角端點。同時 `grep` 確認前端從未使用 `.passwordHash` / `.twoFactorSecret` / `.icsFeedToken` / `.orbMemorySummary` 任何一個欄位 — 這些資料是純粹的無用外洩,沒有對應的產品功能在消費它。

**影響**
- 每次呼叫 `auth.me`(幾乎每次頁面載入/切換分頁都會觸發),passwordHash 與 twoFactorSecret 都會經網路明文送到 client,並被寫入該分頁的 `localStorage`。
- 只要網站任何其他角落存在 XSS(不需要是 auth.ts 本身),攻擊腳本讀 `localStorage.getItem("manus-runtime-user-info")` 即可一次拿到:密碼雜湊(可離線暴力破解)+ TOTP 種子(可長期產生合法 2FA 驗證碼、且不會因使用者改密碼而失效,除非額外重置 2FA)+ ICS feed token(可長期讀該使用者行事曆)。等於把「任一頁面 XSS」升級成「帳號永久接管、繞過 2FA」。
- 即使沒有 XSS,`localStorage` 內容仍可能被瀏覽器擴充功能、共用裝置的下一位使用者、或裝置備份/同步機制間接取得。

**建議**
1. `auth.me` 改為欄位白名單投影(比照 `getUserAccountInfo` 的模式),只回傳前端實際會用到的安全欄位(id/name/email/role/avatarUrl/quotaJson/remainingGenerations/onboardingDone 等),或在 db 層新增 `getSafeUserByOpenId`,永遍不 `select()` 全表。
2. 移除 `useAuth.ts` 對 `meQuery.data` 整包寫入 `localStorage` 的邏輯,若必須快取,僅快取上述白名單後的安全欄位。
3. 若已存在的舊 session 已把敏感欄位寫入使用者瀏覽器 `localStorage`,修復後仍應考慮強制輪替所有本地帳號的 `twoFactorSecret` 與 `icsFeedToken`(passwordHash 只能靠使用者改密碼緩解)。

---

## 發現 2(medium / cluster: security-idor)— `export.getJobUrl` 用 NOT_FOUND vs FORBIDDEN 區分「不存在」與「非本人」,形成任務 ID 存在性 oracle

**發現**
`server/routers/export.ts:27-38`:
```ts
getJobUrl: protectedProcedure
  .input(z.object({ jobId: z.number().int().positive() }))
  .query(async ({ ctx, input }) => {
    const job = await db.getBackgroundJob(input.jobId);
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任務不存在" });      // line 31
    if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });        // line 32
    ...
```
`job.userId !== ctx.user.id` 的所有權檢查確實存在、且在回傳 URL 之前執行 —— 沒有「他人資料被匯出」的直接漏洞。但錯誤碼刻意區分「id 不存在」(NOT_FOUND)與「id 存在但不是你的」(FORBIDDEN),任何已登入使用者只要遍歷 `jobId`(自增整數),即可用回應碼分辨出哪些 job id 屬於「存在且屬於別人」——洩漏了平台任務數量/活躍度等中繼資訊(非任務內容本身)。

這與同檔第二個端點、以及本碼庫既有的防列舉慣例明顯不一致:
- 同檔 `getJobUrls`(批次版,`server/routers/export.ts:41-55`)對「不存在」與「非本人」一律 `continue` 跳過(line 50),回應中兩者不可區分。
- `server/db.ts:2222-2226` 的 `getBackgroundJobsRefundMeta` 註解明確寫著這是刻意設計:「SQL 端強制 userId = 本人 —— 非本人的任務 id 不會出現在結果內(呼叫端據此回 unknown,與不存在的 id **不可區分**,防 IDOR 枚舉)」。

`getJobUrl`(單筆版)沒有遵守這個已在同一 codebase 確立的模式。

**影響**
- 影響僅限「任務 ID 是否存在/屬於他人」的列舉,不會外洩 URL 或影片內容本身,嚴重度為中低。
- 但因該端點是 `protectedProcedure`(僅需任一有效登入即可呼叫),任何平台使用者皆可對外送出探測請求,不需要是他人好友或有其他關聯權限。

**建議**
把 `getJobUrl` 的「不存在」與「非本人」合併為同一錯誤碼(例如統一回 `NOT_FOUND`),與 `getJobUrls` / `getBackgroundJobsRefundMeta` 的既有防列舉慣例保持一致。

---

## 發現 3(low-medium / cluster: deadcode)— `export.ts` 整個路由(`getJobUrl`/`getJobUrls`)在 repo 內找不到任何呼叫端

**發現**
`server/routers/export.ts` 檔頭註解標示 `AIDV-237`,路由已掛載於 `server/routers.ts:48,319`(`export: exportRouter`),為即時可呼叫的 API。但對整個 repo(含 `client/`)搜尋 `getJobUrl` 字串,除了 `export.ts` 自身的定義外沒有任何其他檔案出現;搜尋 `trpc.export.` 在 `client/src` 下也是零結果。也就是說,這兩支「已上線且已通過所有權檢查」的端點,目前沒有任何前端(或其他已知呼叫端)在使用。

**影響**
- 本身不是漏洞,但代表這是一段「活的、可被任何登入使用者直接打 API 呼叫、卻沒有產品流程在用、因此也不會被日常 QA / 監控自然覆蓋」的攻擊面 —— 上面發現 2 的列舉問題就位於這段沒人盯的路徑上。
- 維護成本:未來若這兩支被重新啟用或前端接上,需連帶重新審視發現 2。

**建議**
確認此路由是否仍在規劃中的功能(若是,補上前端呼叫與對應測試;若已廢棄,移除或標記 deprecated),並在重新啟用前一併修掉發現 2。

---

## 發現 4(low-medium / cluster: deadcode + contract-mismatch)— `plans.ts` / `subscriptionPlans` 是一套與實際計費機制脫節、無前端消費者的孤兒方案系統;`getById` 與 `list` 的可視範圍規則也不一致

**發現**
`server/routers/plans.ts` 只有兩個 `publicProcedure`:
```ts
list: publicProcedure.query(async () => db.getActivePlans()),          // line 8-10
getById: publicProcedure.input(z.object({ id: z.number() })).query(... db.getPlanById(input.id)), // line 12-16
```
`db.getActivePlans()`(`server/db.ts:2368-2375`)有套 `where(eq(subscriptionPlans.isActive, true))` 過濾;但 `db.getPlanById()`(`server/db.ts:2377-2386`)完全沒有 `isActive` 過濾,單看 id 就回傳,兩個手足端點的「可視範圍」規則不一致(欄位本身不敏感 —— `drizzle/schema.ts:746-764` 顯示 `subscriptionPlans` 只有 name/tier/priceMonthly/quotaAllocation/features/isActive/createdAt,無使用者個資,故此不一致目前影響有限)。

更根本的問題是:
- 全 repo 搜尋 `trpc.plans.` / `subscriptionPlans` / `priceMonthly` / `quotaAllocation`,`client/src` 下沒有任何頁面呼叫 `plans.list` 或 `plans.getById`。
- 現有前端「定價/積分」頁面(`client/src/pages/CreditsInfoPage.tsx:275`)實際呼叫的是 `trpc.credits.pricingCatalog`(`server/routers/credits.ts:10-47`),資料來源是 `getAllPricingByCategory()`(`server/services/modelPricing.ts`,以模型為單位的用量計點,與 `subscriptionPlans` 的「方案/月費/quota」概念完全不同的商業模式)。
- repo 內找不到任何對 `subscription_plans` 資料表的 seed/insert 腳本(僅有建表 migration `drizzle/0002_flat_dorian_gray.sql`),測試(`server/phase2.test.ts:256-271`)也只斷言「不會 throw / 回傳陣列或物件」,未斷言任何實際方案內容 —— 與「這張表目前很可能是空的、或即使有資料也無人驗證正確性」的推論一致(此點未逐一查證正式環境資料庫內容,標記為合理推論而非確證)。
- 實際的訂閱/計費動作(Stripe)落在 `server/routes/stripeWebhook.ts`,與 `plans.ts`/`subscriptionPlans` 無任何程式碼關聯(`grep planId/subscriptionPlans` 未命中該檔)。

**影響**
- `plans.ts` 對外是兩支公開、可匿名呼叫的 API,但沒有對應產品功能與資料一致性驗證 —— 若未來有人依賴這張表做真實計費授權判斷,會直接繼承一套從未被驗證過、可能為空/過期的資料。
- `getById` 略過 `isActive` 過濾的不一致,是典型的「手足端點行為契約不同步」,雖然目前欄位不敏感、影響低,但屬於契約錯配類型的缺口,日後若表內新增敏感欄位(例如成本/毛利率)風險會放大。

**建議**
1. 確認 `plans.ts` + `subscriptionPlans` 是否為已棄用的舊計費模型;若已被 `credits.ts` + Stripe 取代,建議移除或明確標記 deprecated,避免未來被誤用為計費授權依據。
2. 若仍要保留,`getPlanById` 應比照 `getActivePlans` 加上 `isActive` 過濾(或在文件中明確定義兩者刻意不同的原因)。

---

## 發現 5(low / cluster: persistence)— `updateAvatar` 的長度驗證以 UTF-16 字元數為界,未對齊 DB TEXT 欄位的位元組上限

**發現**
`server/routers/auth.ts:19-22`:
```ts
avatarUrl: z.string().max(64 * 1024).nullable(),
```
`.max()` 檢查的是 JS 字串的 UTF-16 code unit 數,而 `drizzle/schema.ts:56` 對應的 `avatarUrl` 欄位型別是 `text("avatarUrl")` —— MySQL `TEXT` 型別上限為 65,535 **bytes**,非字元數。若字串中大量使用多位元組字元(例如附加在 `https://` 前綴後的大量 emoji/CJK),可以在通過 65536 字元的 Zod 檢查的同時,其 UTF-8 編碼位元組數超過 65,535,導致 `db.updateUserAvatar()`(`server/db.ts:600-610`)的 UPDATE 在 DB 層截斷或丟出錯誤(視 sql_mode 而定),此路徑未見額外的 try/catch,可能以未預期的 500 呈現給使用者。

**影響**
僅使用者對自己帳號的寫入自傷,不構成跨使用者風險,嚴重度低;主要是健壯性/資料完整性缺口。

**建議**
把驗證上限改用 `Buffer.byteLength(value, "utf8")` 計算位元組數,或直接調降 `.max()` 門檻至留有安全餘裕的字元數(如 20000),並確保 DB 寫入失敗時回傳可讀的 400/BAD_REQUEST 而非未處理的 500。

---

## Negative Results(對抗式驗證後排除的可能性,附證據)

1. **JWT 驗證無 fail-open**:`server/_core/googleAuth.ts:179-214` 的 `verifySessionToken()` 有三層 fallback(嚴格 aud → 無 aud 相容 → trim 前原始密鑰相容),但每一層都要求對應密鑰的合法 HMAC 簽章通過才回傳 payload,沒有「簽章驗證失敗仍放行」的分支;`getJwtSecret()`(line 56-82)在 `NODE_ENV==="production"` 下對缺失/過短密鑰採 fail-fast(`throw`),不會靜默退回開發用密鑰。**未在本檔驗證**:實際部署環境是否保證 `NODE_ENV=production` 被正確設置。
2. **Demo 模式非任意帳號繞過**:`authenticateRequest()`(`server/_core/googleAuth.ts:439-494`)的 demo 自動登入分支要求 cookie 內有一顆「用正確 JWT_SECRET 簽出、`sub==="demo-user-001"`」的合法 token 才會生效(line 452-463),且僅在 `!process.env.DATABASE_URL` 時才進入該分支 —— 不是無條件放行,也不能冒充任意其他使用者,只能取得固定的低權限 demo 帳號。
3. **`export.ts` 兩支端點皆有做 ownership 檢查**:`getJobUrl`(line 32)與 `getJobUrls`(line 50)在回傳任何 URL 前都比對 `job.userId === ctx.user.id`,找不到能匯出他人影片 URL 的路徑。批次端點另有 `.max(50)` 上限(line 42),無 IN 子句無界放大疑慮。
4. **三支路由涉及的 db.ts 函式均為 Drizzle 參數化查詢**(`getUserByOpenId`/`updateUserAvatar`/`getBackgroundJob`/`getBackgroundJobsByIds`/`getActivePlans`/`getPlanById`),未見字串拼接 SQL,無 injection cluster 發現。
5. **`plans.ts` 無需 owner 檢查**:回傳內容為全域方案目錄(`drizzle/schema.ts:746-764`,name/tier/priceMonthly/quotaAllocation/features/isActive/createdAt),不含使用者個資,本質上就該公開,故無 IDOR 疑慮(欄位可視範圍不一致的問題已列在發現 4)。
6. **`avatarUrl` 未見注入路徑**:值只允許 `preset:`/`http(s)://`/`data:image/` 前綴(`server/routers/auth.ts:27-36`),server 端從未對其發起 fetch(`grep avatarUrl` 於 server 僅見 select/display,無 SSRF 路徑);client 端僅有的兩處渲染(`client/src/components/AppleDock.tsx:430,932`、`client/src/components/teams/TeamAtoms.tsx:52`)皆用純 `<img src>`,非 `dangerouslySetInnerHTML`。**未在本檔驗證**:client 端是否還有其他渲染路徑(此為抽樣檢查,非窮舉三檔案外的所有前端組件)。
7. **CSRF**:`server/_core/index.ts` 約 577-601 行有一道全域 origin/referer 檢查中介層涵蓋非 tRPC/webhook 的狀態改變請求;`auth.logout` 為 `publicProcedure`(允許未登入呼叫),但因 SameSite cookie 政策(`server/_core/cookies.ts:46-52`)與上述 origin guard 疊加,標準表單 CSRF 難以觸發。**未在本檔逐行驗證**:該 origin guard 是否覆蓋所有 tRPC mutation 路徑(此檔在三個目標路由範圍外,僅作背景查證)。

---

## 附:三檔案逐一小結

| 檔案 | 行數 | 核心風險 | 對應發現 |
|---|---|---|---|
| `server/routers/auth.ts` | 41 | `me` 過度回傳整列 User(含密鑰),`updateAvatar` 長度驗證單位不對齊 DB | 發現 1(critical)、發現 5(low) |
| `server/routers/export.ts` | 56 | 所有權檢查完整,但單筆端點的錯誤碼形成列舉 oracle,且整個路由無實際呼叫端 | 發現 2(medium)、發現 3(low-medium) |
| `server/routers/plans.ts` | 17 | 無 owner 疑慮,但整套與實際計費機制脫節、手足端點可視範圍不一致 | 發現 4(low-medium) |
