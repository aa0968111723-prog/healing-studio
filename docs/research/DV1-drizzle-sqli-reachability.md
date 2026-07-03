# DV1 — drizzle-orm SQL identifier 注入可達性
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:npm 弱點在本 repo 的可達性分析

## 弱點摘要

- **套件**:`drizzle-orm`
- **已知弱點**:`<0.45.2` — SQL injection via improperly escaped SQL **identifiers**(欄位名/表名等識別碼,非一般參數化 value)
- **repo 安裝版本**:`0.44.7`(package.json:95 `"drizzle-orm": "^0.44.5"`,package-lock.json 解析為 `drizzle-orm@0.44.7`)→ 落在弱點版本區間內
- **依賴型態**:**直接依賴**(`dependencies`,非 devDependencies),是本 repo 的主要 ORM(`server/db.ts:2` `drizzle(...)` from `drizzle-orm/mysql2`)

## 使用點盤點(檔案:行號)

實查全 repo 對 `drizzle-orm` 的使用方式,鎖定「識別碼」相關的三種危險模式:

### 1. `sql\`...\`` 樣板(146 處,遍布 `server/db.ts`、`server/routers/*.ts`、`server/services/*.ts`)
逐一檢視後,**全部**屬於下列安全模式之一:
- 欄位/表物件直接內插,如 `sql\`${apiUsageLogs.createdAt} >= ...\`` — drizzle 對 schema 物件會走參數化/內部安全渲染,不是使用者輸入的裸字串。
- 純值內插,如 `sql\`${cutoff}\``、`sql\`${wishId}\``、`sql\`${JSON.stringify(tag)}\`` — 這些是 **value**,drizzle 會參數化綁定,不受本弱點影響(本弱點只影響「識別碼」路徑)。
- 固定 SQL 片語常數,如 `sql\`NOW()\``、`sql\`CURRENT_TIMESTAMP\``、`sql\`COUNT(*)\`` — 開發者寫死的字串,無使用者輸入。

未發現任何 `sql\`` 樣板把「使用者可控字串」當**表名/欄名**直接嵌入。

### 2. `sql.raw()` / `sql.identifier()` — repo 內唯一一處
- **檔案:行號**:`server/db.ts:2041`
  ```ts
  sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)`
  ```
- 這是 repo **唯一** 一處 `sql.raw`/`sql.identifier` 用法(`grep -rn "sql\.raw\|sql\.identifier"` 全 repo 僅此一筆)。
- `days` 來源:`server/db.ts:2029` `const days = Math.max(1, Math.min(90, Math.trunc(opts?.days ?? 7)));` — 在進入 `sql.raw` 前已被 `Math.trunc` + `Math.min/Math.max` 限制為 **1–90 的整數**,非任意字串。呼叫鏈:`server/routers/dashboard.ts:15,52` → `db.getUserDailyTrend(ctx.user.id)`(僅傳 `userId`,`days` 用預設值,連攻擊者可控參數都沒有傳入)。
- 姊妹函式 `getUserDailyTrendRange`(`server/db.ts:2052-2074`,供 `server/services/spiritTools/accountantTools.ts:362,767,773` 呼叫)做同樣的 clamp,且**根本沒用** `sql.raw`,直接用參數化 `sql\`${days}\``。
- 此外,`sql.raw` 這裡塞的是**數值**(DATE_SUB 的 INTERVAL 天數),不是「識別碼」(欄名/表名),就算 clamp 失效也不是本弱點(identifier escaping)所描述的攻擊面,頂多是數值型 SQLi(而且已被 clamp 擋死)。
- **判定**:此處不可達(clamp 使其非攻擊者可控字串;且非 identifier 用法)。

### 3. `orderBy(...)`(173 處)
逐一檢視所有 `orderBy` 呼叫,分兩類:
- **絕大多數**:直接傳入 schema 欄位物件常數,如 `.orderBy(desc(users.createdAt))`、`.orderBy(asc(digitalAssetLibrary.createdAt))` — 欄位名在編譯期寫死,使用者輸入無法觸及。
- **唯一「可設定排序」的案例**:`server/db.ts:3774-3777`(`listModelWishes`)
  ```ts
  const orderClause =
    options.sort === "latest"
      ? [desc(modelWishes.createdAt)]
      : [desc(modelWishes.voteCount), desc(modelWishes.createdAt)];
  ...
  .orderBy(...orderClause)   // db.ts:3800
  ```
  `options.sort` 只是一個 **白名單列舉**(`"votes" | "latest"`,`server/db.ts:3758`),用來在兩組「寫死的欄位物件」之間二選一,使用者輸入的字串**從未**被當成欄名/識別碼傳給 drizzle——不管傳什麼值,落不到白名單就走 else 分支。無識別碼注入面。
  另一處類似模式:`server/db.ts:4991,5041-5049`(realEarth `sortBy: "date_desc"|"date_asc"|"title"`)也是同款「列舉字串 → if/else 選 schema 欄位物件」,非動態識別碼。
- 未發現任何 `orderBy`/`groupBy`/`.$dynamic()` 把 request body/query 的原始欄位名字串直接丟給 drizzle 當識別碼。（`grep -rn "\.\$dynamic\("` 全 repo 0 筆。）

### 4. 動態 column/table 選取、raw identifier 拼接
- 全 repo 搜尋 `\.from(sql`、`\.from(\`...\``、`sql.identifier` 均 0 筆,無「動態表名」透過 drizzle 傳遞的案例。
- 唯一一處「表名字串內插進 SQL」在 `server/db.ts:5387`:
  ```ts
  for (const table of USER_OWNED_TABLES) {
    await conn.execute(`DELETE FROM \`${table}\` WHERE userId = ?`, [userId]);
  }
  ```
  但這 **不是 drizzle-orm 的 API**——是底層 `mysql2` connection 的原生 `.execute()`(`server/db.ts:5381` `manager.executeTransaction(async (conn) => ...)`),跟本弱點(drizzle-orm identifier escaping)無關。且 `table` 來自 `server/db.ts:5340-5370` 硬編碼的 `as const` 表名陣列(`USER_OWNED_TABLES`),不接受任何呼叫端參數,亦非使用者可控。

## 可達性判定

**not-reachable**

- (a) 直接依賴:是(`drizzle-orm@0.44.7`,`dependencies`,版本落在弱點區間 `<0.45.2`)。
- (b) 脆弱函式路徑(identifier 未跳脫)是否被呼叫:**否**。repo 內沒有任何地方把使用者可控字串當「欄位名/表名」傳給 `sql\`\``、`sql.raw`、`sql.identifier`、`orderBy`、`.$dynamic()` 或其他 identifier 建構 API。所有 `orderBy` 都是編譯期寫死的欄位物件;唯二「可被使用者影響排序」的案例(`listModelWishes` 的 `sort`、realEarth 的 `sortBy`)都是白名單列舉,只在寫死的欄位物件之間二選一,使用者字串本身從不進入 SQL 識別碼位置。
- (c) 攻擊者可控輸入來源:無對應觸發點。唯一存在的 `sql.raw`(`server/db.ts:2041`)吃的是 clamp 過的天數(數值,非識別碼),且該路徑的呼叫鏈(`dashboard.ts` → `getUserDailyTrend(userId)`)根本沒有把 `days` 從外部請求傳入,一律用預設值 7。
- (d) prod/dev:drizzle-orm 本身是 prod runtime 依賴(啟動 DB 連線、幾乎所有 router 都用它),但由於 (b)(c) 均不成立,弱點路徑本身在 prod 不可達。
- (e) 修法與破壞性風險:
  - **修法**:`npm install drizzle-orm@^0.45.2`(或更新的 patch/minor)。`drizzle-kit@0.31.4` 需一併確認相容性(通常 drizzle-kit 對應同代 drizzle-orm minor 版本即可,建議同時檢查其 changelog)。
  - **破壞性風險**:低。0.44 → 0.45.x 為 minor 升級,主要是修 identifier escaping,API 表面預期不變;但因 repo 有 100+ 個檔案 import `drizzle-orm`、大量 `sql\`\``/`orderBy`/`relations` 用法,仍建議跑一輪型別檢查(`tsc --noEmit`)+ 現有的 `server/**/*.test.ts`(尤其 `server/orphan-migrations-journal.test.ts`、`server/migration-prod-pending-block.test.ts` 這類碰 migration/schema 的測試)確認無 breaking change,再上線。

## 結論

本 repo **未觸及** drizzle-orm `<0.45.2` 的 SQL identifier 注入弱點路徑——弱點需要「使用者可控字串被當成欄位名/表名」,但實查全部 146 處 `sql\`\``、173 處 `orderBy`、唯一 1 處 `sql.raw` 後,識別碼位置全部是編譯期寫死的 schema 欄位物件或白名單列舉,沒有任何攻擊者輸入(HTTP body/query/上傳/webhook)能到達識別碼位置。仍建議升級到 `>=0.45.2` 作為縱深防禦(避免未來新增程式碼不慎引入動態識別碼時才發現已含已知 CVE),但目前判定為 **not-reachable**,非緊急阻斷項。
