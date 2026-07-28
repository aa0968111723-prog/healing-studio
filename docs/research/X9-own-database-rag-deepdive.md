# X9 — 北極星① 自建資料庫 + RAG(teachingArchive + orbDatabaseTools)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/teachingArchive.ts(538)、server/services/orbDatabaseTools.ts(629)

---

## 0. 範圍與方法

本輪逐行讀完兩支指定檔案全文,並為了追完「發現→影響」的完整因果鏈,額外讀了直接被這兩支檔案呼叫/呼叫的下游檔案作**佐證**(非本輪主稽核對象,僅供交叉確認):
`server/services/teachingArchiveAccess.ts`、`teachingArchiveIngest.ts`、`teachingArchiveRag.ts`、`teachingArchiveSearch.ts`、`server/services/agentToolExecutor.ts`(db.* 橋接段 + `teachingArchive.search` case)、`server/config/orbToolRegistry.ts`、`server/services/security/ragInjectionGuard.ts`、`server/routers/realEarth.ts`、`server/db.ts`(對應函式)、`server/_core/trpc.ts`(rate-limit 前例)、`drizzle/schema.ts`(`teaching_materials`)。凡引用這些輔助檔案的證據,內文皆會明確標註「輔助檔案,非本輪主稽核範圍」。

判斷基準:實際程式碼為準,行號與片段皆逐一核對後才寫入;無法在本檔驗證的一律寫「未在本檔驗證」,不臆測。

---

## 1. 發現(依嚴重度排序)

### 🔴 CRITICAL — `realEarth.getLinkedMaterials` 完全繞過 teachingArchive 的 visibility 授權模型,外洩任何使用者的私有教材全文

**Cluster**:security-idor

**發現**

`teachingArchive.ts` 自己新增的三個 mutation/query(`linkRealEarthEntry`:461-489、`unlinkRealEarthEntry`:492-514、`getRealEarthLinks`:517-527)把「真實地球條目 ID」寫進 `teaching_materials.realEarthRefs`(JSON 陣列)。這三個入口本身都有正確走 `loadMaterialForWrite`/`loadMaterialForRead`(教材授權層),看起來沒問題。

但反向查詢入口 `realEarth.getLinkedMaterials`(`server/routers/realEarth.ts:294-300`,輔助檔案)完全沒有比照這個授權層:

```ts
// server/routers/realEarth.ts:294-300
getLinkedMaterials: protectedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ ctx, input }) => {
    const entryId = parseInt(input.id, 10);
    const materials = await db.findTeachingMaterialsByRealEarthRef(entryId);
    return materials;
  }),
```

底層查詢(`server/db.ts:5192-5208`,輔助檔案):

```ts
export async function findTeachingMaterialsByRealEarthRef(
  realEarthId: number
): Promise<TeachingMaterial[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()                      // ← 全欄位,無 column projection
    .from(teachingMaterials)
    .where(
      sql`JSON_CONTAINS(${teachingMaterials.realEarthRefs}, ${JSON.stringify(realEarthId)})`
    )
    .orderBy(desc(teachingMaterials.createdAt));
  return rows;
}
```

`db.select()` 無 column projection = 回傳 `teaching_materials` 整列,包含 `textContent`(可達 16MB 的完整逐字稿/開示全文)、`fileUrl`/`fileKey`(可能是私有 S3/R2 物件的簽發依據)、`userId`、`teamId`、`visibility`。查詢條件只有 `JSON_CONTAINS(realEarthRefs, id)`,**完全沒有** `visibility`/`userId`/`teamId` 任何過濾。

`realEarth.ts` 的 `get`/`list`/`search`(:51-79)本身是設計成「全 workspace 唯讀」的公開知識庫(這點合理,`real_earth_entries` 本來就不是使用者私有資料),任何登入者都能列舉/搜到 `realEarthId`。只要**任何一個使用者**曾經把自己的**私有(`visibility:"private"`)**教材透過 `linkRealEarthEntry` 連結到某個(公開可枚舉的)真實地球條目,**任何其他登入使用者**呼叫 `realEarth.getLinkedMaterials({ id })` 就能拿到該私有教材的完整內容,徹底繞過 `teachingArchiveAccess.ts` 的 owner/team_shared/public_disciples 三層授權矩陣。

前端目前沒有任何頁面呼叫 `getLinkedMaterials`(全 repo grep 僅 `realEarth.ts` 一處定義,無消費端),但這不影響漏洞成立——tRPC procedure 本身即是可直接呼叫的 API 端點,不因為 UI 沒接就不可達。

**影響**

- 使用者 A 上傳一份私人靈修筆記(`visibility:"private"`)並連結到某個真實地球條目(例如某歷史地點),使用者 B(與 A 無任何團隊關係)只需呼叫 `realEarth.getLinkedMaterials({ id: <該條目ID> })` 即可讀到 A 的完整逐字稿、原始檔案 URL/Key。
- 這比先前稽核(K1-3/K1-4,見 `docs/research/K1-security-bugs.md`)發現的 `assets.teamAssets`/`models.teamModels` 洩漏還嚴重——那兩個至少要求 `visibility==="team_shared"` 才外洩;本案**連 `visibility` 都不檢查**,`private` 教材一樣中標。

**建議**

- `db.findTeachingMaterialsByRealEarthRef` 增加 `requestingUserId`/`teamIds` 參數,套用與 `getVisibleTeachingMaterialsByIds`(`server/db.ts:4225-4250`)相同的 visibility OR 條件。
- `realEarth.getLinkedMaterials` 改用 column projection(只回傳 `id`/`title`/`mediaType`/`sourceDate` 等安全欄位供前端列表用,不回傳 `textContent`/`fileUrl`/`fileKey`)。
- 補單元測試:B 非 A 的隊友,A 的 private 教材連結某公開條目後,B 呼叫 `getLinkedMaterials` 應看不到該教材(或該教材應被過濾掉)。

---

### 🟠 HIGH — 建立/更新教材完全沒有角色門檻,任何登入者都能以「師父開示」名義發佈全站公開內容

**Cluster**:injection(教材庫內容可信度 → 汙染其他使用者的檢索結果與 AI 助理引用)

**發現**

`createInputSchema`(:57-103)的 `visibility`(:100)、`speaker`(:92)、`lineage`(:84)、`sourceType`(:85)、`title`/`textContent` 全部是任何 `protectedProcedure` 使用者可自由填寫的欄位,`assertMediaPayload`(:127-152)僅檢查:

```ts
// server/routers/teachingArchive.ts:144-151
if (input.visibility === "team_shared" && !input.teamId) {
  throw new TRPCError({ code: "BAD_REQUEST", message: "設定為「團隊共享」時必須指定 teamId" });
}
```

對 `visibility === "public_disciples"`(全 workspace 公開,:47-51 定義)**沒有任何額外檢查**——不需要 `teamId`、不需要 `ctx.user.role`、不需要任何審核狀態欄位。全文 grep `teachingArchive.ts` 的 `role`/`admin`,唯一一處(:192)只用在**讀取時**計算 `canWrite` 旗標,完全沒有出現在 `create`/`update` 的授權判斷裡。

也就是說,任何剛註冊的普通帳號都能呼叫:

```ts
teachingArchive.create({
  mediaType: "text",
  textContent: "<任意內容,含捏造的教誨/危險建議>",
  title: "最新開示",
  speaker: "<冒充任何一位師父/講者姓名,自由文字,無白名單校驗>",
  sourceType: "discourse",
  visibility: "public_disciples",   // 免 teamId、免審核,立即全站可見
})
```

建立後立即出現在所有使用者的 `list`(scope="public"/未指定)、`search`(LIKE fallback 立刻命中;若日後補上文字類型的向量化——見下一則 northstar 發現——也會進 RAG)結果中,`speaker`/`lineage` 純自由文字、無任何權威來源比對。

**影響**

- 在「療癒/靈修教學」這種對「師父原話」真實性要求極高的產品情境下,任何低權限帳號都能捏造「開示」並讓其在全站可信通道(教材庫 + 光球 AI 助理搜尋引用,參見 :420-430 的文件字面「讓助理可以直接引用」)出現,構成內容真實性/社交工程風險,且無速率限制、無審核佇列、無事後標記機制。
- 與 `injection` 群集直接相關:一旦光球日後把 `search` 結果真的接進 LLM prompt(目前是否已接見下方 northstar 發現的存疑分析),被汙染的 `public_disciples` 內容即成為間接提示注入的來源。

**建議**

- `visibility === "public_disciples"` 至少要求 `ctx.user.role` 屬於白名單(例如 `teacher`/`admin`)或走審核佇列(先建立為 `pending_review`,由管理者核准後才轉 `public_disciples`)。
- `speaker` 欄位若要保留「掛名某位師父」的語意,應改為從一份受控的講者清單挑選,而非自由文字。

---

### 🟠 HIGH — 教材 ingestion(ElevenLabs 轉錄 / 未來 embedding)入口完全沒有速率限制或去重,可無限重複觸發真實付費 API 呼叫

**Cluster**:billing

**發現**

`create`(:220-291)對 `mediaType` 為 `pdf`/`audio`/`video` 且未提供 `textContent` 時,呼叫 `enqueueTeachingIngestion`(:281-288);`triggerIngestion`(:297-304)則是讓使用者**手動**對同一筆教材重跑一次:

```ts
// server/routers/teachingArchive.ts:297-304
triggerIngestion: protectedProcedure
  .input(z.object({ id: z.number().int().positive() }))
  .mutation(async ({ ctx, input }) => {
    await loadMaterialForWrite(input.id, { userId: ctx.user.id });
    logAccess(input.id, ctx.user.id, "reingest");
    const jobId = await enqueueTeachingIngestion(input.id, ctx.user.id);
    return { ok: true, jobId };
  }),
```

兩個入口都只用普通 `protectedProcedure`,**沒有任何 `checkTrpcRateLimit`**。對照同一個檔案(`server/_core/trpc.ts:168-182`,輔助檔案)已經為「audio 生成」這類真實付費第三方呼叫特別做了 `requireAudioGenerationLimit`(AIDV-622 註解明講「guard against cost-DoS on paid proStudio mutations」),`teachingArchive` 這兩個一樣會觸發真實付費呼叫(ElevenLabs Scribe 轉錄、以及未來的 Gemini embedding,見 `teachingArchiveIngest.ts:106-112`/`teachingArchiveRag.ts:111`,輔助檔案)的入口卻完全沒有比照。

更嚴重的是 `enqueueTeachingIngestion`(`teachingArchiveIngest.ts:41-70`,輔助檔案)本身也沒有「這筆素材是否已經有 queued/processing 任務」的冪等檢查——它只檢查 `row.textContent` 是否已存在(有就整個跳過,見下一則發現),對「已經有一個 job 在跑」完全沒有防護:

```ts
// server/services/teachingArchiveIngest.ts:59-69(輔助檔案)
await db.updateTeachingMaterial(materialId, { transcriptionStatus: "pending" });
const jobId = await db.createBackgroundJob({
  jobType: "teaching_archive_ingestion",
  status: "queued",
  userId,
  resultJson: { materialId },
});
return jobId;
```

任何一次 `triggerIngestion` 呼叫,只要素材當下沒有 `textContent`(例如上一次轉錄失敗),就會無條件再插一筆新 `backgroundJobs`。使用者對同一筆失敗的音檔連續點擊「重試」5 次(或用 API 直接連打),`teachingArchiveIngestionWorker`(cron,輔助檔案)就會對**同一份音檔**跑 5 次 ElevenLabs 轉錄——全部是站方真實付費支出。

另外 `fileUrl` 的 schema 驗證(:65-69)只限定 `^https?://`,不限定必須是本站 storage 網域,意味著使用者可指定任意外部 https 音檔/影片 URL 觸發轉錄(下游 `elevenLabsExtended.ts::transcribe` 有呼叫 `assertSafeUrl` 擋內網/雲端 metadata host,SSRF 面已有防護,屬正向結果,見下方「已排除疑慮」),但沒有任何檔案時長/大小上限檢查就送進轉錄 API,搭配無速率限制,構成成本失控的攻擊面。

**影響**

- 惡意或單純心急的使用者可對同一份素材重複觸發轉錄,造成站方 ElevenLabs/未來 Gemini embedding 帳單非線性增長,且無法從目前程式碼歸因「這筆帳單是哪個使用者造成的重複呼叫」(`backgroundJobs` 沒有去重鍵)。
- 與既有稽核(`docs/research/W9-cron-workers-deepdive.md` 發現 3)交叉確認:該輪已指出 `teaching_archive_ingestion`/`model_training` 全鏈路完全沒有扣點/退款機制(站方全額吸收成本),本輪進一步確認**連最基本的請求速率限制都沒有**,兩個問題疊加=無成本上限的付費 API 呼叫。

**建議**

- 比照 `requireAudioGenerationLimit` 的作法,為 `teachingArchive.create`(僅 pdf/audio/video 且無 textContent 分支)與 `triggerIngestion` 加上每小時/每日速率限制。
- `enqueueTeachingIngestion` 呼叫前先查詢該 `materialId` 是否已有 `status IN ('queued','processing')` 的同類型 job,若有則直接回傳既有 `jobId`,不重複建立。

---

### 🟠 HIGH — `mediaType:"text"` 教材永遠不會被向量化,RAG 語意檢索對「教材庫」最主要的內容類型完全失效

**Cluster**:northstar

**發現**

`create`(:220-291)只在以下條件才會觸發 ingestion(進而觸發 embedding):

```ts
// server/routers/teachingArchive.ts:240-244
const needsIngestion =
  !input.textContent &&
  (input.mediaType === "pdf" ||
    input.mediaType === "audio" ||
    input.mediaType === "video");
```

`mediaType === "text"` 的素材依 `assertMediaPayload`(:130-136)**必定**已經有 `textContent`(否則直接 400),所以 `needsIngestion` 恆為 `false`,`create` 完全不會呼叫 `enqueueTeachingIngestion`。

追下游(輔助檔案):唯一呼叫 `upsertTeachingMaterialVectors`(向量化/embedding)的地方是 `teachingArchiveIngest.ts:131`,而它只在 `doExtraction`(:90-138)內被呼叫,`doExtraction` 只被 `runTeachingIngestion`(:76-88)呼叫,`runTeachingIngestion` 只被 `teachingArchiveIngestionWorker`(cron)消費 `enqueueTeachingIngestion` 產生的 job 呼叫。全 repo grep `upsertTeachingMaterialVectors` 僅此一處呼叫點(已核對,見下方「方法」段落的 grep 紀錄)。

換言之:**任何以 `mediaType:"text"` 直接建立的教材(這是「純文字開示」——這類產品裡最典型、最核心的內容型態),從建立那一刻起就永遠不會進 Pinecone 向量索引**,`teachingArchive.search`(:432-459)呼叫的 `searchTeachingArchive`(輔助檔案)第一步向量查詢(`queryTeachingArchiveVectors`)對這些素材必定 0 命中,只能靠 LIKE fallback(關鍵字完全命中)撈到。

**影響**

- 北極星①「連結/創建自己的資料庫」的核心賣點是「AI 能對你上傳的知識做語意理解式檢索」,但對最主要的內容類型(直接貼文字開示,不需上傳檔案、UX 上最輕量的路徑)這個賣點完全不成立——退化成關鍵字比對,使用者問「師父對放下執著怎麼說」若原文用詞是「鬆開罣礙」,LIKE 搜尋找不到,向量搜尋本該能找到卻因為這條內容根本沒被索引而一樣找不到。
- 且沒有任何錯誤訊息或狀態欄位告知使用者「這篇文字未被向量化」——`transcriptionStatus` 對 text 類型固定是 `"completed"`(:260-261),使用者會誤以為已完整索引。

**建議**

- `create`/`update` 對 `mediaType:"text"` 且 `textContent` 有值(或被修改)時,應直接(或透過同一個 backgroundJobs 佇列非同步)呼叫 `upsertTeachingMaterialVectors`,不應該只綁定在「抽文/轉錄」這條路徑上——文字類型不需要抽文,但仍需要嵌入。

---

### 🟡 MEDIUM — `triggerIngestion`(手動重跑)在最常見的重試情境下靜默 no-op,回報 `ok:true` 卻沒有真的做任何事

**Cluster**:deadcode

**發現**

`triggerIngestion` 的文件註解明講用途(:293-296):「自動流程失敗時、或之後想重抓更高品質的轉錄時可以呼叫」。但它呼叫的 `enqueueTeachingIngestion`(`teachingArchiveIngest.ts:41-70`,輔助檔案)一開頭就是:

```ts
// server/services/teachingArchiveIngest.ts:50-57(輔助檔案)
if (row.textContent && row.textContent.trim().length > 0) {
  if (row.transcriptionStatus !== "completed") {
    await db.updateTeachingMaterial(materialId, { transcriptionStatus: "completed" });
  }
  return null;   // ← 不建立任何 job,直接跳過
}
```

只要這筆教材**已經有** `textContent`(不論是自動抽取完成、還是使用者原本就有填,也不論品質好壞),`enqueueTeachingIngestion` 就會直接 `return null`,完全不建立新的 `backgroundJobs`。而 `triggerIngestion` 的路由層(:297-304)對這個 `null` 沒有任何特殊處理,原樣回傳 `{ ok: true, jobId: null }`。

**影響**

- 文件承諾的「想重抓更高品質的轉錄」這個使用情境(最典型:自動轉錄品質不佳,使用者按「重新轉錄」按鈕)**完全無效**——按鈕呼叫成功、後端回 `ok:true`,但實際上什麼都沒發生,使用者會誤以為已經在重跑。只有「轉錄真的失敗、`textContent` 是空的」這一種情境下才會真的排新工作。
- 這是路由層(教材庫「重跑」入口)與服務層(`enqueueTeachingIngestion` 的冪等判斷)之間的契約落差:路由層以為呼叫這個函式=「請求重新抽取」,服務層卻把它實作成「只在沒有文字時才抽取」。

**建議**

- 拆分兩種語意:`enqueueTeachingIngestion`(自動流程,已有文字則跳過,現有行為維持)vs. 新增 `forceReingest`(手動觸發,忽略既有 `textContent`,直接排新 job 並在完成後覆蓋舊文字/向量)。`triggerIngestion` 路由改呼叫後者。
- 或至少讓路由層在 `jobId === null` 時回傳一個明確訊息(例如 `{ ok: true, jobId: null, skipped: "already has text content" }`),而不是讓前端誤判為「已重新排隊」。

---

### 🟡 MEDIUM — `accessLog` 的註解宣稱「僅 owner 或團隊管理員」可見,實作卻讓任何一般團隊成員都能看到彼此的檢視/下載紀錄

**Cluster**:deadcode

**發現**

`accessLog` procedure 的註解(:389-392):

```ts
/**
 * 取得單一教材的存取稽核日誌(最近 N 筆)— 只有 owner 或團隊管理員看得到。
 * 給敏感素材的擁有者用來追蹤「最近誰看過 / 下載過」。
 */
accessLog: protectedProcedure
  .input(z.object({ id: z.number().int().positive(), limit: z.number().int().min(1).max(200).default(50) }))
  .query(async ({ ctx, input }) => {
    await loadMaterialForWrite(input.id, { userId: ctx.user.id });
    return db.listTeachingMaterialAccessLogs(input.id, input.limit);
  }),
```

它重用 `loadMaterialForWrite`(`teachingArchiveAccess.ts:87-137`,輔助檔案),但該函式對 `visibility === "team_shared"` 的判斷是(:105-114,輔助檔案):

```ts
// team_shared — 同隊任何成員都可改(含 member)
if (material.visibility === "team_shared" && material.teamId !== null) {
  const membership = await db.getTeamMembership(material.teamId, ctx.userId);
  if (membership) {
    return { material, viaTeamId: material.teamId, membership };   // ← 任何角色都放行,不檢查 role
  }
}
```

也就是說,對 `team_shared` 素材,**任何角色**的團隊成員(不只 admin/owner)都能通過 `loadMaterialForWrite`,因此也都能呼叫 `accessLog` 看到「誰在什麼時候看過/搜尋命中過/下載過」這份素材——與路由層自己寫的「只有 owner 或團隊管理員看得到」矛盾。

**影響**

- 屬於資訊揭露層級的落差,不是資料外洩(本來這些成員就有權限讀寫這份素材本身),但會讓一般成員看到同隊其他成員的「瀏覽行為模式」(誰、何時查看/搜尋了什麼),這類存取模式資訊通常會被視為需要更高權限才能查看的稽核資料。與程式碼自身文件承諾不一致,容易誤導後續開發者以為既有更嚴格保護。

**建議**

- 若要落實註解的承諾,`accessLog` 應額外檢查 `membership.role === "owner" || membership.role === "admin"`(比照 `get` procedure 裡計算 `canWrite` 時對 `public_disciples` 案例的做法,:190-194),而非直接重用 `loadMaterialForWrite`。
- 或者,若「team_shared 全體成員可看彼此存取紀錄」是刻意設計(如同 `teachingArchiveAccess.ts` 檔頭承認的「團隊池內所有成員都能編輯彼此的素材」設計選擇的延伸),應更新路由層註解讓文件與行為一致。

---

### 🟡 MEDIUM — 語意檢索(Pinecone)以「素材擁有者」而非「搜尋者」分 namespace,team_shared/public_disciples 素材永遠無法被隊友的向量搜尋命中

**Cluster**:northstar

**發現**

`teachingArchive.search`(:432-459)呼叫 `searchTeachingArchive`(`teachingArchiveSearch.ts`,輔助檔案),第一步呼叫 `queryTeachingArchiveVectors(args.userId, ...)`——**用搜尋者自己的 userId** 查 Pinecone namespace:

```ts
// teachingArchiveRag.ts:171-193(輔助檔案)
export async function queryTeachingArchiveVectors(userId: number, query: string, topK = 20) {
  ...
  namespace: namespaceForUser(userId),   // ← 搜尋者的 namespace
  ...
}
```

但向量寫入時(`upsertTeachingMaterialVectors`,`teachingArchiveRag.ts:85-153`,輔助檔案)用的是**素材擁有者**的 namespace:

```ts
// teachingArchiveRag.ts:100-102(輔助檔案)
const namespace = namespaceForUser(material.userId);   // ← 擁有者的 namespace,不是搜尋者
```

當使用者 B 搜尋隊友 A 上傳、設成 `team_shared`(B 有權限讀取)的教材時,向量其實躺在 `teaching-{A.userId}` namespace 裡,B 用自己的 `teaching-{B.userId}` namespace 去查,**永遠查不到**。`searchTeachingArchive` 的邏輯是「向量有命中就直接回傳、不再 fallback 到 LIKE」(:135-170,輔助檔案),所以只要 B 自己的素材裡剛好有任何一筆(哪怕分數很低、跟問題根本不相關)命中向量搜尋,就會直接回傳這批弱相關結果,完全不會嘗試用 LIKE 去撈 A 那份真正相關的 team_shared 教材。

**影響**

- 團隊協作場景下(這正是 `team_shared`/`public_disciples` 存在的目的),語意檢索實質上只對「自己上傳的素材」有效,隊友貢獻的知識庫內容在向量搜尋層完全不可見,只能靠運氣(自己剛好 0 命中)才會 fallback 到 LIKE 撈到。這直接削弱「大家一起餵養、AI 一起查詢」這個北極星協作情境的價值。

**建議**

- Pinecone query 改用 metadata filter 而非 namespace 隔離跨使用者可見性——例如把所有可見素材（含 team_shared/public_disciples）的 metadata 都帶 `visibility`/`teamId`,搜尋時對「搜尋者自己 + 其所屬 teamIds + public」的 namespace 集合做多次 query 再合併排序,或改成單一共用 namespace 搭配 metadata filter(`userId in [...]` OR `visibility=public_disciples`),取代目前的按擁有者分 namespace 設計。

---

### 🟡 MEDIUM — `teachingArchive.search` 極可能是光球代理無法真正呼叫到的「半成品」工具(交叉引用既有稽核,本輪未獨立完整覆核到底)

**Cluster**:northstar

**發現**

`teachingArchive.ts` 檔頭(:420-430)明確把 `search` procedure 定位為「給光球 / AI 助理檢索教材庫用」,並說明要讓光球能呼叫,需在 `ORB_TOOL_REGISTRY_JSON` 環境變數登記一條(:427-430)。

本輪讀 `server/config/orbToolRegistry.ts` 全文(:34-51)確認:`getOrbToolRegistry()` 只從環境變數 `ORB_TOOL_REGISTRY_JSON` 解析,未設定時回傳空陣列——這個機制是給「外部 HTTP API 工具」用的(`toolSchema` 要求 `endpoint: z.string().url()`)。而 `agentToolExecutor.ts:2997` 的 `case "teachingArchive.search"` 是**另一條完全不同的 in-process dispatch 路徑**(同檔案內建的 switch-case,不經過 `ORB_TOOL_REGISTRY_JSON`)。本輪未逐行追蹤「送給 LLM 的 function-declaration/tool 清單」實際組裝終端(不在本次兩支指定檔案範圍內,追下去需要展開 planner/prompt 組裝等大量額外檔案),因此**無法在本檔獨立驗證**這個 case 目前是否真的出現在 LLM 可呼叫的工具清單裡。

交叉引用既有稽核文件(僅供參考,非本輪自行覆核結論):
- `docs/research/G3-orb-tools-spirits.md:168`:「teachingArchive.search(1 個,**未註冊**;→teachingArchiveSearch...router 半邊活、orb tool 半邊死)」
- `docs/research/Q4-orb-tools-full-registry.md:204`:「teachingArchive.search | Y(case存在) | N(未註冊給LLM) | N(gate只認studio./director.) | 雙重孤兒」

兩份先前獨立稽核(方法不同)都得出「LLM 目前呼叫不到這個工具」的結論,與本輪讀到的架構(`ORB_TOOL_REGISTRY_JSON` 是另一套機制、agentToolExecutor 的 switch-case 沒有對應的「已登記工具清單」佐證其可達性)方向一致,但**本輪未獨立重新從頭逐行驗證到底**,故信心標記為「中」,嚴重度先列 medium,若日後有人專門追完 LLM tool-declaration 組裝鏈,應重新核實此項是否該升級為 high(若確認完全不可達,代表北極星①「AI 主動引用你的資料庫」這個核心體驗目前對教材庫是完全不通的死路)。

**影響**

- 若上述交叉引用屬實,則「光球可以引用教材庫」這個文件明載的能力,在目前程式路徑下對使用者是不存在的——使用者上傳、標記、分類好的教材,AI 助理實際上呼叫不到 `search` 工具,只能靠使用者自己在 UI 手動搜尋。這與「連結/創建自己的資料庫」這個北極星的「AI 主動使用」核心訴求有落差。

**建議**

- 找到 LLM tool-declaration 組裝的實際終端檔案,確認 `teachingArchive.search` 是否確實在其中列出;若否,補上登記讓光球真正能呼叫這個既有、已寫好權限收斂的搜尋工具(不需要重新開發,只是把已存在的 case 接上 LLM 可見的工具清單)。

---

### 🟡 MEDIUM — `orbDatabaseTools.ts` 檔頭宣稱「透過 orbQuota 做速率限制」,但全檔與其唯一呼叫端都沒有實際接上

**Cluster**:deadcode

**發現**

檔頭註解(orbDatabaseTools.ts:6-11):

```ts
/**
 * Security-first design:
 * - All queries are user-scoped (userId filtering)
 * - Predefined query templates only (no arbitrary SQL)
 * - Read-only operations (SELECT only)
 * - Rate limiting via orbQuota integration      ← 宣稱項目
 * - Full audit trail via orbTaskTracer          ← 宣稱項目
 */
```

全檔(1-629 行)grep `orbQuota`/`checkAndConsumeQuota`/`orbTaskTracer` 皆 0 匹配。其唯一呼叫端 `dispatchDatabaseTool`(`agentToolExecutor.ts:900-970`,輔助檔案)同樣沒有呼叫這兩者——對照同檔案第 1016 行確實有針對「generation」類別呼叫 `checkAndConsumeQuota`,證明 `orbQuota` 模組本身存在且在別處有被正確使用,但 db.* 這條路徑完全沒接上。`dispatchDatabaseTool` 唯一的節流手段是 `(opts.blockedTools ?? []).includes(call.name)` 這個使用者手動封鎖清單(:671),不是速率限制,也不是稽核追蹤。

**影響**

- 屬於「文件承諾 vs 實作」的落差——不算資料外洩(因為底層查詢確實是 SELECT-only、user-scoped,本身安全),但意味著光球若在單一對話 turn 內被誘導反覆呼叫 `db.*` 系列工具(例如 LLM 規劃迴圈失控重試),目前沒有任何請求數上限會擋下來,只受限於上層 LLM 呼叫本身的節奏。
- 若之後真的接上 orbQuota,現有稱述至少描述了「本應如此」的設計意圖,不是無中生有,修復成本低。

**建議**

- 若目前設計本就不需要對唯讀查詢做速率限制,更新檔頭註解移除「Rate limiting via orbQuota integration」與「Full audit trail via orbTaskTracer」這兩條不實宣稱,避免誤導後續維護者。
- 若確實需要,在 `dispatchDatabaseTool` 呼叫 `executeDbQuery` 前加上 `checkAndConsumeQuota("db_query", { userId: opts.userId })` 或等價的每分鐘呼叫數上限。

---

## 2. 已驗證排除的疑慮(Negative Results)

以下項目是本輪針對「授權邊界 / SQL 注入 / 危險操作 / 成本失控」等假設逐一查證後,**確認未發現問題**或**已有防護**的項目,列出以避免報告偏頗:

1. **`orbDatabaseTools.ts` 全檔確實是純唯讀(SELECT-only)**:對 `db\.(delete|insert|update)\(` 等模式全檔 grep 0 匹配(1-629 行逐行核對過),沒有任何 DROP/DELETE/UPDATE/INSERT 路徑,與檔頭「Read-only operations (SELECT only)」的宣稱一致。光球無法透過此檔案的任何 query template 修改或刪除資料。

2. **無 SQL 注入面**:全部查詢走 Drizzle 型別化 query builder(`eq`/`like`/`and`/`gt`),唯一一處原生 `sql\`\`` 樣板(:438,`get_active_jobs` 的 `IN ('queued','processing')`)內嵌的是寫死字面值、不是任何使用者輸入,不構成注入面。所有 `LIKE` 查詢(:220、300、529)都先經過 `escapeLikePattern()`(`server/db.ts:5501-5503`,輔助檔案)跳脫 `%`/`_`/`\`,避免萬用字元語意混淆(該函式本身邏輯正確:`raw.replace(/[\\%_]/g, ch => \`\\${ch}\`)`)。

3. **`db.*` 工具的 `userId` 無法被 LLM 呼叫參數覆寫**:`agentToolExecutor.ts:913-917`(輔助檔案)的參數組裝是 `{ ...args, userId: opts.userId }`——`args` 先展開、`userId` 鍵在後面,確保永遠以「已驗證的登入使用者 ID」覆蓋掉呼叫參數裡任何 `args.userId`。即使惡意/被操弄的 LLM 工具呼叫嘗試在 `args` 帶入別人的 `userId`,實際執行時一律被伺服器端的 `opts.userId` 蓋過,不構成 IDOR。此橋接同時也是唯一呼叫 `orbDatabaseTools.executeDbQuery` 的入口。

4. **`teachingArchive.ts` 自身的讀寫授權矩陣一致且正確覆蓋所有 CRUD 入口**:`get`/`update`/`delete`/`triggerIngestion`/`accessLog`/`logView` 全數透過 `loadMaterialForRead`/`loadMaterialForWrite`(`teachingArchiveAccess.ts`)做 owner/team_shared membership/public_disciples 三層判斷,`list`/`lineages`/`topics`/`search` 則透過 `db.ts` 對應函式(`listTeachingMaterialsForUser`/`listTeachingMaterialLineages`/`listTeachingMaterialTopics`/`searchTeachingMaterialsForUser`/`getVisibleTeachingMaterialsByIds`,輔助檔案)套用一致的 visibility OR 條件。**沒有重複發現先前稽核(K1-3/K1-4)在 `assets.ts`/`models.ts` 找到的「只憑 `visibility==="team_shared"` 就放行任何登入者、不查真團隊」漏洞**——本檔案這幾個入口都確實有查 `getTeamMembership`。

5. **建立/更新素材掛到某團隊時,有驗證使用者真的是該團隊成員**:`create`(:225-238)與 `update`(:320-331)在 `teamId` 有值時都先 `db.getTeamMembership` 查證,避免「假裝把素材塞進別人團隊」。

6. **`update` 的 patch 組裝不會被塞入未預期欄位**:`updateInputSchema` 是 `createInputSchema.partial()` 這個 Zod schema 的解析結果,未宣告的欄位(如 `userId`)會被 Zod 預設行為剝除(未使用 `.passthrough()`),`for...of Object.entries(input.patch)` 迴圈能複製的鍵一定是 schema 允許的鍵,無法透過 `patch` 竄改 `userId`/`id` 等敏感欄位。

7. **`fileUrl`/`thumbnailUrl` 有 scheme 限制,且下游 SSRF 防護存在(輔助檔案佐證,非本檔驗證範圍)**:teachingArchive.ts 本身(:65-69、74-78)用 zod `.refine` 強制只接受 `http(s)://`,擋掉 `javascript:`/`data:`/`file:`。下游實際發出請求的兩處(`pdfTextExtractor.ts` 的 `assertSafeUrl`、`elevenLabsExtended.ts:479` 的 `assertSafeUrl(params.audioUrl)`,皆輔助檔案)都在真正 `fetch()` 前擋下私有網段/loopback/link-local/雲端 metadata host(含 IPv4-mapped IPv6 繞過樣式),SSRF 面有做防護,非本輪主稽核範圍但讀碼確認防護邏輯存在。

8. **光球唯一接上的 teachingArchive 工具是唯讀 `search`,且其輸出依既有分析未進入 LLM prompt**:`agentToolExecutor.ts:2997` 的 `case "teachingArchive.search"` 只做查詢、不做任何寫入,`userId` 同樣取自 `opts.userId`(已驗證身分),非 LLM 可控。`server/services/security/ragInjectionGuard.ts:32-39` 檔內文件明確記載該路徑的 snippet「只當 tool result data 回傳給前端 OrbSearchCard render、不進任何 LLM prompt」,本輪未獨立重新逐行追完下游 replan/prompt 組裝以完全證實此點,但該檔案的分析本身相當具體(指名下游 replan recap 只序列化受信任執行狀態),可信度較高。若此分析成立,則即使 `create`/`update` 缺乏角色門檻讓惡意內容混入(見前述 HIGH 發現),至少不會透過這條路徑直接造成「AI 被檢索內容劫持指令」式的提示注入——殘留風險集中在「內容真實性對人類讀者的欺騙」而非「劫持 AI 推理」。

9. **`realEarthId`/`teamId` 等外鍵沒有做存在性驗證,但屬資料完整性而非安全問題**:`linkRealEarthEntry`(:462-489)不驗證 `realEarthId` 是否真的存在於 `real_earth_entries`,可能產生指向不存在條目的孤兒參照;`create`/`update` 對 `teamId` 已有 membership 檢查(見上),不受此影響。此項列為 low,不計入結構化輸出。

---

## 3. 附註:嚴重度排序總表

| 嚴重度 | 標題 | Cluster | 檔案:行號 |
|---|---|---|---|
| CRITICAL | realEarth.getLinkedMaterials 外洩任意使用者私有教材全文 | security-idor | server/routers/realEarth.ts:294-300(根因於 teachingArchive.ts:461-489) |
| HIGH | 建立/更新教材無角色門檻,可冒名發佈全站公開「開示」 | injection | server/routers/teachingArchive.ts:100-101、127-152 |
| HIGH | ingestion 觸發入口無速率限制/去重,可無限重複觸發付費轉錄 | billing | server/routers/teachingArchive.ts:240-244、297-304 |
| HIGH | mediaType:"text" 教材永遠不會被向量化 | northstar | server/routers/teachingArchive.ts:240-244 |
| MEDIUM | triggerIngestion 在最常見情境下靜默 no-op | deadcode | server/routers/teachingArchive.ts:293-304 |
| MEDIUM | accessLog 註解與實作不符,一般團隊成員可看彼此存取紀錄 | deadcode | server/routers/teachingArchive.ts:389-403 |
| MEDIUM | 向量搜尋以擁有者分 namespace,team_shared/public 素材對隊友不可見 | northstar | server/routers/teachingArchive.ts:432-459(根因於 teachingArchiveRag.ts) |
| MEDIUM | teachingArchive.search 可能是光球呼叫不到的半成品(交叉引用,信心中等) | northstar | server/routers/teachingArchive.ts:420-430 |
| MEDIUM | orbDatabaseTools.ts 檔頭宣稱的 rate limiting 未實作 | deadcode | server/services/orbDatabaseTools.ts:10 |

共 1 CRITICAL、3 HIGH、5 MEDIUM。另有 1 項 LOW(realEarthId 未驗證存在性)未計入結構化輸出。
