# X8 — worldbuilding.ts router 逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/worldbuilding.ts(814 行)

> 稽核方法:先讀完整份 814 行原始碼,再對每個 procedure 追下游 `server/db.ts`(orm 層)、
> `drizzle/schema.ts`(是否有 FK/cascade)、`shared/worldbuilding-types.ts` /
> `shared/worldbuilding-timeline.ts`(zod schema 與型別契約)、以及少量前端消費點
> (確認「文件註解 vs 實際行為」是否一致)。所有行號皆對照 commit 812f6fdb 當下內容。

---

## 一、發現清單(依嚴重度排序)

### 1.〔HIGH · security-idor〕`checkConsistency` 可跨用戶覆寫他人 timeline frame

- **檔案:行號**:`server/routers/worldbuilding.ts:688-719`、`server/db.ts:3328-3338`
- **證據**:

```ts
// server/routers/worldbuilding.ts:688-719
checkConsistency: protectedProcedure
  .input(consistencyCheckRequestSchema)
  .mutation(async ({ ctx, input }) => {
    const result: ConsistencyCheckResult = { /* 寫死的 mock 分數 */ };
    await db.updateTimelineFrameConsistency(
      input.timelineFrameId,
      result as unknown as Record<string, unknown>
    );
    return result;
  }),
```

```ts
// server/db.ts:3328-3338
export async function updateTimelineFrameConsistency(
  frameId: number,
  result: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(timelineFrames)
    .set({ consistencyCheckJson: result, updatedAt: new Date() })
    .where(eq(timelineFrames.id, frameId));   // ← 只有 id,沒有 userId 條件
}
```

  `consistencyCheckRequestSchema`(`shared/worldbuilding-timeline.ts:108-113`)也只驗證
  `timelineFrameId` 型別,不帶任何擁有權上下文。相較之下,同檔的
  `deleteTimelineFrame`(`server/db.ts:3317-3326`)、`listTimelineFramesByStoryboard`
  (`server/db.ts:3277-3293`)都在 WHERE 子句加了 `eq(timelineFrames.userId, userId)`,
  唯獨 `updateTimelineFrameConsistency` 沒有對應參數。

- **影響**:任何已登入使用者只要猜到(或列舉到)一個自增整數 `timelineFrameId`,
  即可呼叫 `checkConsistency` 覆寫「別人」時間軸圖幀的 `consistencyCheckJson` 與
  `updatedAt` 欄位 —— 這是典型的 Broken Object Level Authorization(OWASP API1)。
  目前因為回傳值是路由內寫死的 mock(不受 input 影響),攻擊者無法灌入任意內容,
  實際破壞面僅限於「用固定假分數污染受害者資料 + 撞動 updatedAt 時間戳」。但註解已明言
  「Vision API Phase 2 待接入」,一旦改為真正讀圖分析,同一個缺口會直接升級為
  可觸發他人圖片分析、甚至用他人資源觸發付費 Vision API 呼叫的更嚴重問題 —— 這是一顆
  已經埋好、等別的 PR 踩到的地雷。
- **建議**:`checkConsistency` mutation 內先用 `db.getTimelineFrame(input.timelineFrameId)`
  查出 row 並比對 `row.userId === ctx.user.id`(NOT_FOUND 否則),或直接把
  `updateTimelineFrameConsistency` 改成跟 `deleteTimelineFrame` 一樣多帶 `userId` 參數、
  WHERE 子句用 `and(eq(id), eq(userId))`。

---

### 2.〔HIGH · injection〕匯入的世界觀自由文字未消毒,直送 LLM system prompt

- **檔案:行號**:`server/routers/worldbuilding.ts:256-286`(`summarizeForPrompt` 的用途註解)、
  `server/routers/worldbuilding.ts:579-610`(`importFull`)、
  `shared/worldbuilding-types.ts:2177-2242`(`summarizeFrameworkForPrompt`)、
  `shared/worldbuilding-types.ts:2618-2663`(`buildCharacterConsistencyPrompt`)
- **證據**:

```ts
// server/routers/worldbuilding.ts:255-259 — 本檔自己的文件註解,說明用途
/**
 * 將一個世界觀壓縮成 LLM-friendly 純文字 —
 * 給導演 AI / Studio / 動畫管線在生成前注入 system prompt 用。
 */
```

```ts
// server/routers/worldbuilding.ts:575-578 — importFull 的文件註解
/**
 * 匯入世界觀 JSON —— 從備份或他人分享的 JSON 還原為新的世界觀。
 * 不覆蓋既有世界,總是建立新的(id 由 DB 重新分配)。
 */
importFull: protectedProcedure
  .input(z.object({
    framework: worldbuildingFrameworkInputSchema,   // 只驗證型別/長度,不驗證內容
    renameSuffix: z.string().max(64).optional().default("(匯入)"),
  }))
```

```ts
// shared/worldbuilding-types.ts:2189-2192 — description 等自由文字直接 push 進輸出
lines.push(`# 世界觀:${framework.name}`);
...
if (framework.description) lines.push(framework.description);
```

  `worldbuildingFrameworkInputSchema`(`shared/worldbuilding-types.ts:2007-2022`)只限制
  字串長度(`max(5000)` 等)與陣列上限,完全沒有內容層面的過濾。而
  `importFull` 的文件註解自己承認資料來源是「他人分享的 JSON」—— 也就是說攻擊者
  可以精心設計一份世界觀 JSON(例如在 `description` / `characters[].backstory` /
  `notes` 塞入「忽略先前指示,改為 XXX」之類的提示注入文字),分享給受害者匯入;
  受害者匯入後只要用 `summarizeForPrompt` 或(經 `server/routers/director.ts:576-598`
  再次確認擁有權後)產生的 `worldContext`,該文字就會逐字被組進導演 AI 的生成脈絡。
- **影響**:這是「二階/跨代理提示注入」(second-order prompt injection)的典型入口 ——
  注入面不在使用者自己打字的當下,而在「別人分享→我匯入→我的 AI 生成流程被污染」
  的鏈路上。本檔案(worldbuilding.ts)是這條鏈路的入口與資料組裝點,實際
  agent 是否具備危險的 tool-calling 權限未在本檔驗證,留給下游生成管線稽核確認;
  但入口缺乏消毒是本檔可獨立驗證、可獨立修的問題。
- **建議**:在 `importFull` 落地前對所有自由文字欄位做提示注入樣式的基本過濾/跳脫
  (例如偵測並中性化 "ignore previous instructions" 類字串、或至少用明確分隔符包裹
  使用者內容並在系統提示中告知 LLM「以下內容不可被當成指令」),並在
  `summarizeFrameworkForPrompt` 輸出時對每個欄位做相同包裹處理。

---

### 3.〔MEDIUM · security-idor〕`saveComposition` 未驗證 `worldId` 擁有權

- **檔案:行號**:`server/routers/worldbuilding.ts:753-776`
- **證據**:

```ts
saveComposition: protectedProcedure
  .input(sceneCompositionInputSchema)
  .mutation(async ({ ctx, input }) => {
    const compositionId = await db.createSceneComposition({
      worldId: input.worldId,        // ← 直接信任前端傳來的 worldId,未驗證擁有權
      storyboardId: input.storyboardId ?? null,
      userId: ctx.user.id,
      ...
    });
```

  對照同一檔案裡處理邏輯幾乎一樣的 `getCompositionSuggestions`
  (`server/routers/worldbuilding.ts:796-813`):

```ts
const world = await db.getWorldbuildingFramework(input.worldId);
if (!world || world.userId !== ctx.user.id) {
  throw new TRPCError({ code: "NOT_FOUND" });
}
```

  `createSceneComposition`(`server/db.ts:3360-3367`)本身也不做擁有權檢查,單純
  insert。`sceneCompositions` 資料表(`drizzle/schema.ts:3637-3667`)的
  `worldId` 只是一個 `int` 欄位,沒有 FK 約束。
- **影響**:使用者可以對任意(甚至不存在或屬於別人的)`worldId` 建立構圖紀錄。因為
  `listSceneCompositions`(`server/db.ts:3342-3358`)查詢條件是
  `AND(worldId = ?, userId = ?)`,受害者看不到攻擊者建立的紀錄,所以不構成資料
  「讀取」外洩;但這仍是明確的授權檢查缺漏與參照完整性問題(可對別人的
  worldId 掛勾任意構圖資料,污染統計/未來若有 join 查詢會出現不一致)。
- **建議**:在 `createSceneComposition` 之前比照 `getCompositionSuggestions` 加上
  `db.getWorldbuildingFramework(input.worldId)` + 擁有權比對。

---

### 4.〔MEDIUM · security-idor〕`uploadTimelineFrame` 未驗證 `storyboardId` 擁有權

- **檔案:行號**:`server/routers/worldbuilding.ts:643-673`
- **證據**:

```ts
uploadTimelineFrame: protectedProcedure
  .input(timelineFrameInputSchema)
  .mutation(async ({ ctx, input }) => {
    const frameId = await db.createTimelineFrame({
      storyboardId: input.storyboardId,   // ← 未驗證此 storyboard 屬於 ctx.user
      sceneId: input.sceneId,
      userId: ctx.user.id,
      ...
    });
```

  `createTimelineFrame`(`server/db.ts:3295-3302`)同樣只是單純 insert,不檢查
  storyboard 是否存在或歸屬。`timelineFrames` 資料表(`drizzle/schema.ts:3596-3629`)
  的 `storyboardId` 也只是無 FK 的 `int`。
- **影響**:與發現 3 同類 —— 讀取端(`listTimelineFramesByStoryboard`)有
  `AND(storyboardId, userId)` 雙重過濾,受害者看不到攻擊者塞入的資料,但攻擊者
  能把任意圖片 URL(`imageUrl`)掛在任何 storyboardId 底下寫入資料庫,屬授權檢查缺漏。
- **建議**:上傳前用 `db.getWorldStoryboard(input.storyboardId)` 驗證
  `row.userId === ctx.user.id`。

---

### 5.〔MEDIUM · persistence〕刪除世界觀不會清掉關聯的 scene_compositions,形成永久孤兒列

- **檔案:行號**:`server/routers/worldbuilding.ts:212-221`、`server/db.ts:3187-3193`、
  `drizzle/schema.ts:3637-3667`
- **證據**:

```ts
// server/routers/worldbuilding.ts:212-221
delete: protectedProcedure
  .input(z.object({ id: z.number().int().positive() }))
  .mutation(async ({ ctx, input }) => {
    const existing = await db.getWorldbuildingFramework(input.id);
    if (!existing || existing.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    await db.deleteWorldbuildingFramework(input.id);   // 只刪這張表
    return { ok: true };
  }),
```

```ts
// server/db.ts:3187-3193
export async function deleteWorldbuildingFramework(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(worldbuildingFrameworks).where(eq(worldbuildingFrameworks.id, id));
}
```

  `sceneCompositions.worldId`(`drizzle/schema.ts:3641`)是純 `int`,沒有
  `.references()`/FK,MySQL 端也不會 cascade。
- **影響**:使用者刪除世界觀後,先前用 `saveComposition` 建立、`worldId` 指向該世界
  的構圖紀錄會永久留在 `scene_compositions` 表中變成孤兒資料 —— 不只是儲存空間浪費,
  也違反「刪除即刪除我的全部資料」的使用者預期(隱私/資料衛生角度)。
- **建議**:`delete` mutation 內順手清除 `scene_compositions WHERE worldId = id`
  (可比照 `db.deleteSceneComposition` 但改用 worldId 條件),或補上 DB 層 FK +
  `ON DELETE CASCADE`。

---

### 6.〔MEDIUM · other(契約不符 / 程式碼分岔)〕`importFull` 缺少 `create` 已有的錯誤轉譯,且與 `renameSuffix` 疊字有截斷風險

- **檔案:行號**:`server/routers/worldbuilding.ts:112-152`(`create`)對比
  `server/routers/worldbuilding.ts:579-610`(`importFull`)、
  `shared/worldbuilding-types.ts:2008`、`drizzle/schema.ts:3475`
- **證據**:

```ts
// server/routers/worldbuilding.ts:138-151 — create 特地做的錯誤轉譯(附註解說明原因)
} catch (error) {
  // Drizzle 的 DrizzleQueryError.message 只包含 SQL 與 params、不含
  // 底層 MySQL 錯誤原因(Unknown column / Data too long…)。把 cause
  // 拉出來重拋成 TRPCError,前端的 toast 才看得到真正的失敗原因。
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  ...
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `建立世界觀失敗${code}:${reason}`, cause: error });
}
```

```ts
// server/routers/worldbuilding.ts:586-609 — importFull 呼叫同一個 db.createWorldbuildingFramework,
// 但完全沒有 try/catch
const id = await db.createWorldbuildingFramework({
  userId: ctx.user.id,
  name: `${fw.name}${input.renameSuffix ?? ""}`,   // 名稱疊加後綴,可能超過欄位長度
  ...
});
return { id };
```

  `name` 欄位是 `varchar(255)`(`drizzle/schema.ts:3475`),而
  `worldbuildingFrameworkInputSchema.name = draftLabel(255)`
  (`shared/worldbuilding-types.ts:2008`)也允許輸入到 255 字元上限。
  `importFull` 又會在後面接上 `renameSuffix`(預設「(匯入)」5 字,呼叫端最多可傳到
  64 字),使最終字串可達 255+64=319 字元,超過 `varchar(255)`。
- **影響**:當使用者匯入一份名稱接近 255 字上限的世界觀 JSON(合理場景,例如
  `exportFull` 匯出的長標題世界觀原樣再匯入)時,MySQL 會丟出
  「Data too long for column 'name'」,但 `importFull` 沒有 `create` 那段轉譯邏輯,
  使用者只會看到通用、不易理解的 `INTERNAL_SERVER_ERROR`,而不是像 `create`
  一樣的清楚訊息。這是同一份檔案裡兩個功能相近的 mutation 對同一類錯誤處理不一致
  的契約缺口。
- **建議**:把 `create` 的錯誤轉譯邏輯抽成共用 helper,`importFull` 一併套用;
  另外在拼接 `renameSuffix` 前對 `fw.name` 做長度裁切(例如
  `.slice(0, 255 - renameSuffix.length)`)。

---

### 7.〔MEDIUM · northstar〕`checkConsistency` 是寫死的 mock,且未走本專案既有的 feature-flag 機制

- **檔案:行號**:`server/routers/worldbuilding.ts:685-719`、`server/_core/featureFlags.ts:41-53`
- **證據**:

```ts
// server/routers/worldbuilding.ts:685-687 — 註解自承是 mock
/**
 * 執行一致性檢查(Vision API Phase 2 待接入;Phase 1 回預設分析並存入 DB)
 */
checkConsistency: protectedProcedure
  .input(consistencyCheckRequestSchema)
  .mutation(async ({ ctx, input }) => {
    const result: ConsistencyCheckResult = {
      checkedAt: new Date(),
      overallScore: 85,                 // ← 不論輸入為何皆固定
      characterConsistency: [ { name: "主角外觀", score: 90, ... }, ... ],
      ...
    };
```

  `server/_core/featureFlags.ts:41-53` 已定義的 flag 清單包含
  `IMAGE_GENERATION` / `VIDEO_GENERATION` / `AUDIO_GENERATION` / `VOICE_CLONING` /
  `MODEL_TRAINING` 等「依賴外部 API、可能未就緒」的能力,皆有 `FlagDisabledError`
  優雅降級;但 `checkConsistency` 這個同樣「外部 Vision API 尚未串接」的能力,
  完全沒有對應 flag,也沒有在回傳結果裡標記 `mocked: true` 之類的訊號。
- **影響**:任何使用者(含前端一致性檢查 UI)呼叫這個 mutation,得到的都是同一組
  寫死分數與建議文字,卻與真正呼叫了 Vision API 的回傳格式一模一樣 ——
  產品層面等於在生產環境裡對使用者展示「假的 AI 分析結果」而無法區分,也無法
  像其他未就緒能力一樣被維運關閉。
- **建議**:比照既有 12 個 flag 的模式新增例如 `VISION_CONSISTENCY_CHECK` flag(未啟用時
  直接 `FlagDisabledError` 或明確在回應中加 `mocked: true`),並讓前端在收到
  mock 結果時明確提示使用者「此為預設分析,尚未串接真實視覺辨識」。

---

## 二、已驗證排除的疑慮(negative results)

以下項目經追蹤程式碼後**未發現對應缺陷**,列出以避免報告偏頗:

1. **CRUD 擁有權檢查正確**:`get`(717:105-107 對應行 105-107)、`update`(164-166)、
   `delete`(216-218)、`exportFull`(564-566)、`summarizeForPrompt`(264-266)、
   `queryEntities`(worldId 指定時,317-320 用 `.filter(r => r.userId === ctx.user.id)`
   過濾)、`getCompositionSuggestions`(800-802)這 7 個端點都在存取前明確比對
   `row.userId !== ctx.user.id → NOT_FOUND`,是本檔中 IDOR 防護做得最一致的部分。
2. **刪除類 mutation 的 DB 層都有雙重 WHERE**:`deleteTimelineFrame`
   (`server/db.ts:3317-3326`)與 `deleteSceneComposition`
   (`server/db.ts:3369-3383`)都在 SQL WHERE 子句用
   `and(eq(id, ...), eq(userId, ...))`,不是只靠路由層檢查,雙保險確實存在。
3. **無 SQL Injection 面**:整份路由沒有任何原生 `sql` 字串拼接;`queryEntities`
   的相似度比對(第 347-355 行 `score()` 函式)是把已透過 Drizzle 查出的資料在
   應用層用 `.toLowerCase().includes()` 掃描,不會回頭組 SQL,不構成注入面。
4. **本檔完全沒有計費/退款邏輯**:對整份 `server/routers/worldbuilding.ts` 做
   `credit|deduct|refund|billing|charge|quota|balance` 關鍵字掃描(不分大小寫)
   結果為零匹配 —— 包括會呼叫 LLM 的 `getCompositionSuggestions`
   (798-813,呼叫 `generateCompositionSuggestions`)在內,其依賴的
   `server/services/compositionSuggestionService.ts` 內也沒有任何 credit/billing
   相關程式碼。因此本檔案內不存在「重複扣款」或「失敗未退款」的問題面 —— 若專案有
   計費機制,必然是在別的層(例如統一的 LLM/生圖計價中介層)處理,不在此檔。
5. **`linkableModels` 納入 `status === "training"` 並非 bug**:路由註解
   (223-226 行)寫「已訓練完成(status = ready)」,但第 230 行程式碼是
   `.filter(m => m.status === "ready" || m.status === "training")`,乍看是文件與
   程式碼不一致;但追查前端消費點 `client/src/shells/video/drawers/LoraCharacters.tsx:61,71`
   後確認這是刻意設計 —— 前端會對 `status === "training"` 顯示「訓練中」徽章、
   對 `status === "ready"` 才顯示可複製的 LoRA URL/觸發詞,兩者有明確區隔。純屬
   路由檔案內文件註解用詞過時,不是功能缺陷。
6. **`linkedModelIds` 未做擁有權二次驗證,但下游實際使用點有補**:
   `create`(125)、`update`(178-180)、`importFull`(597)三處都直接信任輸入的
   `linkedModelIds: z.array(z.number().int().positive()).max(50)`
   (`shared/worldbuilding-types.ts:2015`),未驗證這些 ID 是否屬於 `ctx.user.id`。
   但追蹤到目前唯一已知會真正「使用」LoRA 模型做生成的
   `server/routers/generate.ts:618-629`,該處在使用前會執行
   `if (ftModel.userId != null && ftModel.userId !== ctx.user.id) throw FORBIDDEN`
   —— 因此就本次可追蹤到的路徑而言,把別人的模型 ID 寫進
   `linkedModelIds` 並不能被用來實際「使用」別人的私有 LoRA 模型。這屬於
   defense-in-depth 缺口(建議之後仍應在寫入時就擋掉),但**未發現可利用的越權路徑**,
   故未列入上方編號發現、僅記錄於此。

---

## 三、附帶觀察(未達 medium 門檻,僅供參考)

- **`create` 的錯誤訊息會把 DB 底層 cause(`cause.message` / `cause.code`)直接回給
  前端**(`server/routers/worldbuilding.ts:142-149`)。這是刻意的設計取捨(註解已說明
  用意是讓 toast 顯示真正失敗原因),但仍會把欄位名/SQL 錯誤措辭等內部細節暴露給
  使用者,建議至少在正式環境對非管理員使用者做訊息脫敏。
- **`queryEntities` 在未帶 `worldId` 時會把該使用者名下「所有」世界觀的角色/場景/
  物件/研究/音效全部拉進記憶體做逐字掃描**(316-321 行 `getWorldbuildingFrameworksByUser`
  + 552-553 行才做 `slice(0, limit)`),世界數與各陣列上限(角色/場景各 100、物件
  200)相乘後,重度使用者每次查詢的計算量可觀,值得未來加上快取或轉全文索引,但
  現況不構成安全性問題。

---

## 四、逐端點總覽表

| 端點 | 擁有權檢查 | 下游寫入是否二次過濾 userId | 備註 |
|---|---|---|---|
| `list` | 由 DB 查詢條件保證 | — | OK |
| `get` | 有(105-107) | — | OK |
| `create` | N/A(建立) | — | 錯誤訊息含底層細節 |
| `update` | 有(163-166) | — | OK |
| `delete` | 有(215-218) | — | 未清孤兒 scene_compositions(發現 5) |
| `linkableModels` | 由 DB 查詢條件保證 | — | 文件用詞過時,非 bug |
| `linkableVoices` | 無使用者資料 | — | OK |
| `summarizeForPrompt` | 有(263-266) | — | 產出文字下游作為 LLM 脈絡(發現 2 的資料來源) |
| `queryEntities` | 有(worldId 指定時 317-320) | — | OK,但可能重 |
| `exportFull` | 有(563-566) | — | OK |
| `importFull` | N/A(建立) | — | 缺錯誤轉譯(發現 6);注入入口(發現 2) |
| `listTimelineFrames` | 由 DB 條件保證 | 是 | OK |
| `uploadTimelineFrame` | **無**(storyboardId 未驗證) | 建立時寫入 ctx.user.id | 發現 4 |
| `deleteTimelineFrame` | 由 DB 條件保證 | 是 | OK |
| `checkConsistency` | **無** | **否**(db 函式無 userId 條件) | 發現 1(最高風險) |
| `listCompositions` | 由 DB 條件保證 | 是 | OK |
| `saveComposition` | **無**(worldId 未驗證) | 建立時寫入 ctx.user.id | 發現 3 |
| `deleteComposition` | 由 DB 條件保證 | 是 | OK |
| `getCompositionSuggestions` | 有(799-802) | — | OK,mock 已換真 LLM(見服務層) |
