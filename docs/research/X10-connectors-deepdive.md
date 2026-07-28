# X10 — 北極星② 連接器(externalServices + drive + vault)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/externalServices.ts(307)、server/routers/drive.ts(125)、server/routers/vault.ts(128)

> 稽核方法:先逐行讀完三支 router 全文,再對每個 procedure 追下游依賴 ——
> `server/services/googleDrive.ts`(Drive OAuth / API 呼叫實作)、`server/db.ts`(ORM 層,
> 含 `userGoogleOauthTokens` / `consistencyVault` / `driveAssetLibraries` / `externalServiceSubscriptions`
> 的實際 CRUD)、`drizzle/schema.ts`(欄位型別、是否有加密標記)、`server/_core/secretCrypto.ts`
> (本專案既有的憑證加密機制,用來比對「該加密的東西有沒有真的走這條路」)、`server/_core/trpc.ts`
> (`adminProcedure`/`protectedProcedure` 的實際授權邏輯)、以及 `node_modules/drizzle-orm` 原始碼
> (驗證 `.set()` 對 `undefined` 欄位的實際行為,而非憑印象假設)。前端消費點以
> `client/src/components/DriveLibrarySection.tsx`、`ConsistencyVault.tsx`、`animation/SourcePicker.tsx`
> 及全站 grep 交叉確認「文件註解 vs 實際呼叫者是否存在」。所有行號皆對照 commit 812f6fdb 當下內容。
> **本報告不輸出任何真實密鑰/token 值,只描述儲存與傳輸機制。**

---

## 一、發現清單(依嚴重度排序)

### 1.〔HIGH · other〕Google Drive OAuth access/refresh token 以明文存入 DB,與站內既有的憑證加密機制不一致

- **檔案:行號**:`server/routers/drive.ts:18-19`(讀取)、`:31-34`(刪除)、`:56`(取用);
  實際儲存邏輯在 `server/services/googleDrive.ts:128-139`、`:172-203`;
  欄位定義在 `drizzle/schema.ts:548-569`;對照組在 `drizzle/schema.ts:3907-3908`
  與 `server/_core/secretCrypto.ts:1-24`。
- **證據**:

```ts
// drizzle/schema.ts:548-560 — user_google_oauth_tokens 欄位型別
export const userGoogleOauthTokens = mysqlTable("user_google_oauth_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  purpose: varchar("purpose", { length: 32 }).default("drive").notNull(),
  accessToken: text("accessToken").notNull(),   // ← 明文 text,無加密標記
  refreshToken: text("refreshToken"),           // ← 明文 text,無加密標記
  scope: text("scope").notNull(),
  ...
```

```ts
// server/services/googleDrive.ts:128-139 — 寫入時直接存 tokens.access_token 原文
export async function saveDriveTokens(userId: number, tokens: GoogleTokenResponse) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await db.upsertGoogleOauthToken({
    userId,
    purpose: DRIVE_TOKEN_PURPOSE,
    accessToken: tokens.access_token,     // ← 未經 encryptSecret() 就落地
    refreshToken: tokens.refresh_token ?? null,
    ...
```

```ts
// drizzle/schema.ts:3907-3908 — 姊妹系統(data_source_connections)的註解
/** 後端加密後的憑證;OAuth(如 Drive)為 null(憑證另存 userGoogleOauthTokens)。 */
encryptedCredentialRef: text("encryptedCredentialRef"),
```

  對照 `server/_core/secretCrypto.ts` 開頭註解:「安全用途:credential 一律只在後端加密保存
  (data_source_connections.encryptedCredentialRef)」——這句話本身就把 Drive OAuth token
  排除在加密機制之外。全站 grep `encryptSecret|decryptSecret` 只有 Notion 連線
  (`server/subsystems/contextPackets/connectionService.ts:191`)在用,`server/services/googleDrive.ts`
  與 `server/db.ts:1748-1801`(`upsertGoogleOauthToken`/`getGoogleOauthToken`/`deleteGoogleOauthToken`)
  全程沒有出現任何加解密呼叫。
- **影響**:這正是北極星②「連結自己的工具」的核心信任假設——使用者把自己的 Google Drive
  授權給 Healing Studio,系統承諾安全保管這把鑰匙。但目前 access_token / refresh_token
  是以純文字存進 MySQL,一旦發生 DB 備份外流、唯讀複本外洩、或任何未來的 SQL 注入/誤設定
  導致的資料列讀取,攻擊者不需要破解任何加密層就能直接拿到可用的 Drive OAuth 憑證
  (`drive.readonly` + `drive.metadata.readonly` scope),並以受害者身分讀取其整個
  Google Drive 內容——而站內其實已經有一套 AES-256-GCM + scrypt 派生金鑰、支援金鑰輪替的
  `secretCrypto.ts` 機制,目前卻只套用在 Notion 一種 connector 上,Drive 這條(目前唯一
  真正上線的)連接器反而被排除在外。這是「有鎖但沒鎖對地方」的落差。
- **建議**:把 `upsertGoogleOauthToken`/`getGoogleOauthToken` 兩端接上
  `encryptSecret`/`decryptSecret`(比照 `connectionService.ts` 對 Notion 的作法),
  或至少把 `accessToken`/`refreshToken` 欄位遷移到 `data_source_connections.encryptedCredentialRef`
  這條既有的加密路徑,讓「OAuth 為 null」這句註解不再是永久例外。

---

### 2.〔MEDIUM · other〕`drive.disconnect` 只刪本地 DB 列,從未呼叫 Google 撤銷端點

- **檔案:行號**:`server/routers/drive.ts:31-34`。
- **證據**:

```ts
// server/routers/drive.ts:31-34
disconnect: protectedProcedure.mutation(async ({ ctx }) => {
  await db.deleteGoogleOauthToken(ctx.user.id, "drive");
  return { success: true };
}),
```

  全站 grep `revoke` 與 `oauth2.googleapis.com/revoke`(見 `server/services/googleDrive.ts`
  全文、`server/routes`、`server/_core/oauth.ts`)皆無任何呼叫 Google
  `https://oauth2.googleapis.com/revoke` 端點的程式碼——`revokeRefreshToken`/`revokeAllUserRefreshTokens`
  等既有函式(`server/db.ts:5227-5249`)撤銷的是「本站自己簽發的 session refresh token」,
  跟 Google 這把 OAuth token 是兩回事。
- **影響**:使用者在 UI 點「取消連結 Drive」後,系統端只是刪掉自己資料庫裡的那筆記錄,
  但 Google 那端核發的 access_token(通常一小時內仍有效)與 refresh_token(除非使用者
  自行去 Google 帳戶頁撤銷,否則長期有效)**依然是活的**。若疑慮 1(明文儲存)所述的
  外洩情境已經發生在「取消連結」之前,取消連結這個動作完全無法讓外洩的憑證失效——
  對使用者而言「已中斷連線」的認知與系統實際狀態不一致。
- **建議**:`disconnect` 刪除 DB 記錄前,先用被刪除記錄裡的 `accessToken`/`refreshToken`
  呼叫 `POST https://oauth2.googleapis.com/revoke?token=...`,即使呼叫失敗也不擋住本地刪除
  (fail-open on the DB side, but at least attempt revocation)。

---

### 3.〔MEDIUM · injection〕`listFolder` 的 `folderId` 未消毒,直接接進 Drive API 的 `q` 查詢字串

- **檔案:行號**:`server/routers/drive.ts:97-124`(呼叫端);實際組字串在
  `server/services/googleDrive.ts:266-281`。
- **證據**:

```ts
// server/routers/drive.ts:97-104 — 只驗證長度,不驗證內容格式
listFolder: protectedProcedure
  .input(
    z.object({
      folderId: z.string().min(1).max(128),
      pageToken: z.string().optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    })
  )
```

```ts
// server/services/googleDrive.ts:271-280
const params: Record<string, string> = {
  q: `'${folderId}' in parents and trashed = false`,   // ← folderId 未做單引號逸出
  pageSize: String(pageSize),
  orderBy: "folder,name",
  ...
```

  對照同檔 `getDriveFolder`(`googleDrive.ts:255-264`)把 `folderId` 丟進
  `encodeURIComponent()` 當 URL path,是正確做法;但 `listDriveFolder` 把同一個
  `folderId` 直接字串插值進 Drive 的 query language(`q` 參數),完全沒有逸出處理。
- **影響**:`folderId` 若帶單引號或 Drive 查詢運算子(如 `' or fullText contains '`、
  `' or mimeType != 'x`),可以跳脫「只列出指定資料夾底下項目」這個查詢邊界,讓
  `listFolder` 這個原本應該被單一資料夾限制住的瀏覽端點,變成可對呼叫者自己整個 Drive
  做任意條件搜尋的端點。由於用的是**呼叫者自己**的 OAuth access token(`getValidDriveAccessToken(ctx.user.id)`,
  `drive.ts:106`),不會造成跨用戶越權(受害者仍是自己的 Drive scope),但破壞了
  「這個 API 應該只能瀏覽你已釘選的資料夾」這個介面契約,也是教科書等級的
  「使用者輸入未逸出直接組進結構化查詢語言」寫法,值得列管避免日後被複製貼上到
  真正有跨用戶風險的地方。
- **建議**:對 `folderId` 做白名單驗證(Drive 檔案 ID 只會是 `[A-Za-z0-9_-]` 組成,無需
  單引號等特殊字元),或至少在組 `q` 前對單引號做 `replace(/'/g, "\\'")` 逸出。

---

### 4.〔MEDIUM · persistence〕`externalServices.upsert` 的 `apiKeyStatus`/`riskLevel` 帶 zod `.default()`,partial update 會被靜默覆寫回預設值

- **檔案:行號**:`server/routers/externalServices.ts:36,39`(schema 定義)、
  `:124-151`(upsert handler);行為依據
  `node_modules/drizzle-orm/utils.js:81-92`(`mapUpdateSet` 對 `undefined` 的處理)。
- **證據**:

```ts
// server/routers/externalServices.ts:28-41
const ServiceUpsertInput = z.object({
  id: z.number().int().positive().optional(),
  serviceName: z.string().min(1).max(64),
  planName: z.string().max(128).optional(),
  monthlyCostUsd: z.number().min(0).max(99999).optional(),      // 無 default → 可正確跳過
  billingCycle: z.enum(BILLING_CYCLES).optional(),               // 無 default → 可正確跳過
  ...
  apiKeyStatus: z.enum(API_KEY_STATUSES).default("unknown"),     // ← 有 default,永不為 undefined
  ...
  riskLevel: z.enum(RISK_LEVELS).default("medium"),               // ← 有 default,永不為 undefined
  ...
});
```

```ts
// server/routers/externalServices.ts:138-144 — 更新分支
if (input.id) {
  await db
    .update(externalServiceSubscriptions)
    .set(values)                          // values.apiKeyStatus / riskLevel 一定有值
    .where(eq(externalServiceSubscriptions.id, input.id));
  return { id: input.id, action: "updated" as const };
}
```

```js
// node_modules/drizzle-orm/utils.js:81-92 — 已對照原始碼確認的實際行為
function mapUpdateSet(table, values) {
  const entries = Object.entries(values).filter(([, value]) => value !== void 0)...
```

  `mapUpdateSet` 只會跳過真正 `=== undefined` 的欄位;由於 zod 的 `.default()` 讓
  `apiKeyStatus`/`riskLevel` 在解析階段就已經被填成 `"unknown"`/`"medium"`,永遠不會是
  `undefined`,所以每一次 `upsert(id=...)` 呼叫都會無條件把這兩欄寫回 SET 子句——即使
  呼叫端本意只是想改 `notes` 或 `planName`。相對地,`monthlyCostUsd`/`billingCycle`/
  `apiKeyEnvVar`/`workspaceName`/`ownerEmail`/`notes`/`nextRenewalDate` 都沒有 `.default()`,
  在被省略時會維持 `undefined`,能被 `mapUpdateSet` 正確跳過、不動到既有值。
- **影響**:任何只想局部更新(例如只改備註)卻沒有把當前 `apiKeyStatus`/`riskLevel`
  一併帶入 payload 的呼叫,都會把這兩個欄位靜默重置為預設值——健康監控好不容易標記成
  `"invalid"` 的 key 狀態、或標記成 `"high"` 風險的服務,都可能被一次無關的編輯操作
  意外打回 `"unknown"`/`"medium"`。目前(見發現 5)整個 router 沒有任何前端呼叫者,
  所以這個缺口暫時不會被觸發,但只要有人依照文件註解接一個管理 UI 或腳本做局部編輯,
  這顆地雷就會立刻踩到,而且是靜默資料損毀(不會報錯,只是資料悄悄變了)。
- **建議**:把 `apiKeyStatus`/`riskLevel` 的 `.default(...)` 拿掉、改成 `.optional()`,
  讓「呼叫端沒傳」與「呼叫端明確要設成 unknown/medium」在型別層面可以被區分;或是在
  `upsert` handler 內對 `update` 分支,凡是輸入未提供的欄位一律從 `undefined` 補回,
  不要仰賴 zod 的 schema-level default 去填充「更新」語意的欄位。

---

### 5.〔MEDIUM · deadcode〕整個 `externalServicesRouter` 沒有任何前端呼叫者;`updateApiKeyStatus` 宣稱的「健康監控 job」呼叫者不存在

- **檔案:行號**:`server/routers/externalServices.ts:1-13`(檔頭註解)、`:169-186`
  (`updateApiKeyStatus` procedure)。
- **證據**:

```ts
// server/routers/externalServices.ts:8-12
// 功能:
//   - list      : 列出所有外部服務訂閱(admin only)
//   ...
//   - updateApiKeyStatus : 更新 API key 健康狀態(由健康監控 job 呼叫)
```

```ts
// server/routers/externalServices.ts:169-186
updateApiKeyStatus: adminProcedure
  .input(z.object({ apiKeyEnvVar: z.string(), status: z.enum(API_KEY_STATUSES) }))
  .mutation(async ({ input }) => { ... }),
```

  全站 grep(`client/`、`server/jobs/`、`server/routers.ts` 以外的任何呼叫點)找不到任何
  `trpc.externalServices.*` 或 `api.externalServices.*` 的呼叫;`client/` 底下 grep
  `ExternalService`/`externalService` 完全零命中(`DriveLibrarySection.tsx` 有 `trpc.drive.*`、
  `ConsistencyVault.tsx` 有 `trpc.vault.*`,唯獨 externalServices 沒有任何 `.tsx` 消費者)。
  唯一提到這個 router 的地方是 `server/routers/learnHub.seed.ts`(給 AI 學習用的文件字串),
  不是真正的呼叫端。`server/jobs/` 底下也沒有任何檔案呼叫 `updateApiKeyStatus` 或直接
  update `externalServiceSubscriptions.apiKeyStatus`。
- **影響**:`list`/`summary`/`upsert`/`delete`/`updateApiKeyStatus`/`seedDefaults` 六個
  procedure 目前是一個完全孤兒的後端功能——admin 介面沒做、健康監控 job 沒接,檔頭註解
  描述的使用情境(「由健康監控 job 呼叫」)在目前這份 commit 裡不成立。這代表 `seedDefaults`
  種進去的十筆服務資料(fal.ai、ElevenLabs、Pinecone…)其 `apiKeyStatus` 欄位永遠停留在
  種子時寫死的 `"valid"`/`"unknown"`,不會隨真實金鑰健康狀態更新——若團隊誤以為這個表格
  是「即時的」金鑰健康儀表板,會做出錯誤判斷。
- **建議**:若這是暫緩上線的功能,建議在檔頭註解加註「(尚未接前端 / 尚無健康監控 job,
  資料需手動維護)」,避免對「由健康監控 job 呼叫」信以為真;若近期要上線,則
  `updateApiKeyStatus` 需要一個實際的 cron/job 呼叫者,並補上一個至少能 `list`/`upsert`
  的最小管理頁面。

---

### 6.〔MEDIUM · injection〕`vault.ts` 的 `imageUrl` 未做 URL 格式/協定驗證,外部內容被當可信參考圖直接落地並流向下游生成管線

- **檔案:行號**:`server/routers/vault.ts:43-65`(`create`)、`:67-92`(`update`)、
  `:108-127`(`exportToAssets`)。
- **證據**:

```ts
// server/routers/vault.ts:43-53
create: protectedProcedure
  .input(
    z.object({
      name: z.string().min(1).max(128),
      itemType: z.enum(["character", "scene"]),
      imageUrl: z.string().min(1),         // ← 只驗證非空字串,無 .url()、無協定/host 白名單
      fileKey: z.string().optional(),
      tags: z.array(z.string().max(32)).max(20).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  )
```

```ts
// server/routers/vault.ts:118-125 — 匯出時原樣搬進 digitalAssetLibrary.fileUrl,未重新驗證
const assetId = await db.createDigitalAsset({
  userId: ctx.user.id,
  title: `[保險庫] ${item.name}`,
  description: `從一致性保險庫匯出 (${item.itemType})`,
  assetType: "image",
  fileUrl: item.imageUrl,       // ← 直接沿用 create 時存進去、未經格式驗證的字串
  fileKey: item.fileKey || "",
});
```

  另由全站 grep(非本次稽核檔案,標記為「未在 vault.ts/drive.ts/externalServices.ts
  本檔驗證,僅作為下游影響參考」)可見 `server/routers/generate.ts:558-587` 會把同一個
  `vaultChar.imageUrl`/`vaultScene.imageUrl` 原樣指派給生成請求的
  `characterRefUrl`/`firstFrameUrl`/`styleReferenceUrl`,但該檔案在該處確實補了
  `vaultChar.userId !== ctx.user.id` 的擁有權檢查(generate.ts:566-568,
  :599-601),沒有發現跨用戶越權;至於這條 URL 最終有沒有被任何伺服器端 fetch
  (SSRF 的關鍵一步),不在本次三檔案的稽核範圍內,未驗證。
- **影響**:`vault.create`/`vault.update` 允許任何已登入使用者把 `imageUrl` 設成任意字串
  ——不要求是合法 URL、不限制協定(`http`/`https` 以外的值也能通過)、不限制 host。
  這是外部內容(使用者宣稱的圖片位置)被當成可信資料落地並在多處(`exportToAssets`、
  以及範圍外的 `generate.ts` 生成管線)重複使用的起點。若任一下游環節曾經或未來對
  這個字串做伺服器端 `fetch()`(例如把參考圖下載後轉檔、或送進某個會 fetch URL 的
  影像模型 API),使用者能把 `imageUrl` 指到內網位址(如雲端 metadata endpoint)發起
  SSRF;即使目前沒有找到這樣的 fetch 呼叫,`vault.ts` 本身作為入口完全沒有做任何協定/host
  層面的防線,是這條潛在攻擊鏈裡「最容易補、卻完全沒補」的第一道關卡。
- **建議**:`imageUrl` 至少改用 `z.string().url()`,並在 handler 內對協定做白名單
  (只允許 `https:`,拒絕 `http:`/`file:`/`data:`/`javascript:` 等),有能力的話進一步限制
  host 必須是本站已知的 R2/CDN 網域,避免使用者把任意字串包裝成「參考圖網址」流入下游。

---

## 二、已驗證排除的疑慮(Negative Results)

以下項目經逐行核對後,**未發現**任務要求聚焦的風險,列出以避免報告只有壞消息:

1. **vault.ts 的 IDOR 防線是完整的**:`update`(`vault.ts:77-84`)、`delete`(`:97-103`)、
   `exportToAssets`(`:111-117`)三個會動別人資料的入口,都先 `db.getVaultItem(input.id)`
   撈出 row 再比對 `item.userId !== ctx.user.id`,不符即丟 `NOT_FOUND`,模式一致、沒有
   任何一個入口漏掉這道檢查。
2. **drive.ts 的刪除路徑在 DB 層就有雙重條件**:`removeLibrary`(`drive.ts:90-95`)呼叫
   `db.deleteDriveLibrary(input.id, ctx.user.id)`,其實作(`server/db.ts:1823-1831`)
   WHERE 子句用 `and(eq(id), eq(userId))`,不是只在路由層檢查、DB 層另外裸奔的模式,
   屬於較紮實的雙保險寫法。
3. **Drive API 呼叫不存在對任意 host 的 SSRF**:`DRIVE_API_BASE` 是寫死常數
   (`server/services/googleDrive.ts:29`),`folderId`/`pageToken` 等使用者輸入只會被
   `encodeURIComponent()` 後接在固定 host 的 path 或 query 上(`getDriveFolder`
   `googleDrive.ts:255-264`、`driveFetch` `:236-253`),沒有任何路徑允許使用者輸入
   決定要打向哪個 host——發現 3 的查詢語言注入問題不涉及跨 host SSRF。
4. **externalServices.ts 從未存過真正的密鑰值**:`apiKeyEnvVar` 欄位存的是環境變數的
   **名稱**(如字面量字串 `"FAL_API_KEY"`,見 `externalServices.ts:199` 等
   `seedDefaults` 種子資料),不是密鑰本身;通篇 307 行找不到任何 `sk-`/`AKIA`/
   `-----BEGIN` 樣式的字串或欄位,設計上就不持有真正機密值,沒有洩漏面。
5. **admin-only 端點確實有做角色檢查**:`externalServices.ts` 六個 procedure 全部掛
   `adminProcedure`,其中介層(`server/_core/trpc.ts:69-88`)在
   `next()` 前明確檢查 `isAdmin(ctx.user.role)`,不是只掛名字沒做事的殼子。
6. **partial update 的欄位清空問題只侷限在發現 4 提到的兩個欄位**:已對照
   `node_modules/drizzle-orm/utils.js:81-92` 原始碼確認 `mapUpdateSet` 會正確過濾
   `undefined`,`monthlyCostUsd`/`planName`/`billingCycle`/`nextRenewalDate`/
   `apiKeyEnvVar`/`workspaceName`/`ownerEmail`/`notes` 這些沒有 zod `.default()`
   的欄位在被省略時不會被意外清空或覆寫——問題不是普遍性的,只集中在有 `.default()`
   的 `apiKeyStatus`/`riskLevel`。
7. **`ownerEmail` 純粹是備註欄位,不構成越權面**:全站 grep `ownerEmail` 只出現在
   `externalServices.ts:38,133` 與文件種子字串,沒有任何權限判斷邏輯讀取這個欄位,
   不會被用來做「假冒 owner」之類的授權繞過。
8. **Drive OAuth token refresh 邏輯沒有明顯的過期誤用**:`getValidDriveAccessToken`
   (`googleDrive.ts:172-203`)用 60 秒 leeway 判斷是否需要刷新,刷新成功後立刻
   `upsertGoogleOauthToken` 落地新 token 才回傳,沒有發現「回傳一個其實已過期的
   access token」的路徑。
9. **`drive.status` 不會把原始 token 值吐回前端**:回傳物件只有
   `{ connected, scope, expiresAt, hasRefreshToken }`(`drive.ts:23-28`),
   `accessToken`/`refreshToken` 本身沒有被序列化進回應。

---

## 三、小結

三支 router 裡,`vault.ts` 的擁有權(owner)防線寫得最紮實,是三檔中最乾淨的一份;
`drive.ts` 的資料庫層擁有權檢查與 token 刷新邏輯也合格,主要缺口出在**它呼叫的
`googleDrive.ts`/`db.ts` 這兩層對 OAuth 憑證的保存與生命週期管理**(明文儲存 + 從不
真正撤銷),這兩點直接命中北極星②「連結自己的工具」要成立所必須的信任基礎,建議優先處理;
`externalServices.ts` 本身沒有直接的授權漏洞,但存在「文件宣稱的呼叫者不存在」與
「zod default 污染 partial update」兩個契約層級的問題,加上整個 router 目前無人呼叫,
建議在真正推上線前一併修掉,否則會把 bug 一起帶進生產。
