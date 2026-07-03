# X7 — showcase.ts 社群/展示逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/showcase.ts(994 行)

> 稽核方法:逐行讀檔(994 行全讀)+ 對照 `drizzle/schema.ts`(featuredShowcase / featuredShowcaseComments / generationHistory 三張表定義)+ 前端呼叫端(`ShowcaseMasonry.tsx`、`PortfolioDetailDialog.tsx`、`HistoryPage.tsx`)+ 全庫 grep 交叉驗證每個「疑似缺口」是否真的無人補上。所有行號皆對照本次讀檔結果標注,未直接讀到程式碼的推測一律標記「未在本檔驗證」。

---

## 發現總覽(依嚴重度排序)

| # | 嚴重度 | 標題 | Cluster |
|---|--------|------|---------|
| 1 | High | 私密個人動作(書籤/評分)被當作「公開展示」同意,無告知、無選擇 | security-idor |
| 2 | Medium | `listComments` 未檢查 parent `isActive`,下架/移除作品的留言仍永久公開可讀 | security-idor |
| 3 | Medium | `promote` 每日 5 件配額為 check-then-insert,無交易/唯一約束防護,可並發繞過 | persistence |
| 4 | Medium | `promote` / `addComment` 寫入的使用者文字(標題/描述/留言)完全未經任何內容審核即直接公開 | other |
| 5 | Low | `likeCount` / `forkCount` 全庫無任何寫入端點,「熱門排序」公式形同死碼,且與 LearnHub 教材描述的「按讚即時更新」互動不符 | deadcode |
| 6 | Low | `addComment` / `deleteComment` 的計數器更新與主動作不在同一交易內 | persistence |
| 7 | Low | `byAesthetics` 對外開放、無流量限制的多重前導萬用字元 LIKE 掃描,存在查詢放大 DoS 疑慮 | other |
| 8 | Low | `promote` 未檢查同一 `historyId` 是否已提交過,可重複提交同一作品刷配額 | other |

---

## 發現 1(High)— 私密個人動作被隱性轉為「公開發布同意」

**檔案:行號**
- `server/routers/showcase.ts:16-20`、`76-84`(設計說明註解)
- `server/routers/showcase.ts:173-180`(`fetchFallbackHistory` 可見性述詞)
- `server/routers/showcase.ts:355-409`(`getById` 對負值 id 套用相同述詞)
- 對照 `drizzle/schema.ts:935-990`(`generationHistory` 表定義,**沒有** `isPublic` / `visibility` 欄位)
- 對照 `drizzle/schema.ts:1748`、`1791`、`1879`(`customBlocks`、`promptCollection` 等其他表都有明確 `isPublic` / `visibility` 欄位 — 本專案原本就有「顯式旗標」的慣例)
- `client/src/pages/HistoryPage.tsx:628-654`(書籤按鈕與星等元件的實際 UI,無任何「公開」相關文案)

**程式碼佐證**

```ts
// server/routers/showcase.ts:173-180
const conditions = [
  isNotNull(generationHistory.resultUrl),
  ne(generationHistory.resultUrl, ""),
  or(
    eq(generationHistory.isBookmarked, true),
    gte(generationHistory.userRating, 4)
  )!,
];
```

```ts
// client/src/pages/HistoryPage.tsx:629-644 — 書籤按鈕，純粹是「我的收藏」UI，無公開提示
<button onClick={... toggleBookmark.mutate({ id: item.id, isBookmarked: !item.isBookmarked }) ...}>
  {item.isBookmarked ? <BookmarkCheck .../> : <Bookmark .../>}
</button>
```

**影響**

`generation_history` 是使用者的私人生成紀錄表,欄位定義中**沒有**任何 `isPublic` / `visibility` 欄位(對照同一個 schema 檔案裡 `customBlocks`、`promptCollection`、素材庫等表都明確有 `isPublic` 或 `visibility` 欄位,可見這是本專案原本的設計慣例,`generation_history` 是例外)。`showcase.list` / `trending` / `byModality` / `getById` 四個 **publicProcedure**(匿名可呼叫)在策展精選庫湊不滿頁時,會自動把使用者對自己作品按下的「收藏」或「打 4~5 星」視為「同意公開展示」,直接把該筆紀錄的原始提示詞(`prompt`)、成品 URL、縮圖用負值 id 包裝後回傳給任何未登入訪客。

前端「收藏」按鈕與星等元件(`HistoryPage.tsx`)呈現的語意純粹是「我的收藏 / 我的評分」這種私人整理動作,附近沒有任何「公開到首頁」「所有人可見」之類的告知或選擇權。對一個名為「healing studio」、內容涉及使用者情緒/自我表達提示詞的產品而言,使用者很可能會在完全不知情的狀況下把包含私人語境的提示詞和作品公開給全網任何人瀏覽——這是「私密→公開」可見性判斷的 **fail-open**(以隱性訊號取代顯式同意),雖然程式碼註解顯示這是刻意的產品設計(為了不讓首頁空白），但仍構成一個未取得使用者明確同意即擴大曝光範圍的存取控制缺口。

**建議**
- 至少在書籤/評分 UI 旁加入明確告知(例如「加入書籤的高評分作品可能出現在首頁展示牆」),並提供使用者可關閉此行為的偏好設定;
- 中長期建議在 `generation_history` 補上顯式 `isPublic`/`consentToShowcase` 欄位,比照 `customBlocks`/`promptCollection` 的慣例,而非用「書籤 OR 評分≥4」作為公開意圖的代理訊號。

---

## 發現 2(Medium)— `listComments` 未檢查作品是否仍 `isActive`,下架後留言依然永久公開

**檔案:行號**
- `server/routers/showcase.ts:800-849`(`listComments` 完整實作,尤其 819-824 的 `conditions`)
- 對照 `server/routers/showcase.ts:414-419`(`getById` 有檢查 `isActive`)
- 對照 `server/routers/showcase.ts:868-877`(`addComment` 新增留言前有檢查 `isActive`)
- `server/routers/showcase.ts:761-792`(`removeItem`,把 `isActive` 設為 `false` 屬軟刪除,留言表本身不受影響)

**程式碼佐證**

```ts
// server/routers/showcase.ts:819-824
const conditions = [
  eq(featuredShowcaseComments.showcaseId, input.showcaseId),
];
if (typeof input.cursor === "number" && input.cursor > 0) {
  conditions.push(lt(featuredShowcaseComments.id, input.cursor));
}
// 注意：這裡完全沒有 eq(featuredShowcase.isActive, true) 或對應的 join/子查詢
```

```ts
// server/routers/showcase.ts:761-789 — removeItem 只是軟刪除
await db
  .update(featuredShowcase)
  .set({ isActive: false })
  .where(eq(featuredShowcase.id, input.id));
```

**影響**

`getById` 與 `list`/`byModality` 對 `featuredShowcase` 一律加上 `eq(isActive, true)` 過濾,`addComment` 新增留言前也會確認 `isActive=true`,顯示這是全檔案一致遵守的「下架後應該連帶隱藏」慣例。但 `listComments` 是唯一沒有加上這道過濾的查詢端點:只要知道(或枚舉)`showcaseId`,即使該作品已被作者用 `removeItem` 下架(`isActive=false`),過去累積的所有留言(留言內容、留言者 `userId`、暱稱、頭像)依然可以透過 `showcase.listComments({ showcaseId })` 永久公開讀取,即便 `showcase.getById`/`showcase.list` 都已經回報 `NOT_FOUND`。

這既是一個「使用者下架後仍留有殘留公開資料」的隱私問題,也是一個「內容審核繞過」的路徑——若未來有管理端把違規作品設為 `isActive=false` 下架,其下的留言串仍會原封不動繼續公開,沒有被一併下架。

**建議**
在 `listComments` 加入與 `getById`/`addComment` 一致的 `featuredShowcase.isActive=true` 檢查(可用 join 或先查一次 `featuredShowcase` 是否 active),讓下架語意在讀路徑上保持一致。

---

## 發現 3(Medium)— `promote` 每日 5 件配額為 check-then-insert,存在並發繞過(TOCTOU race)

**檔案:行號**
- `server/routers/showcase.ts:683-703`(配額檢查)
- `server/routers/showcase.ts:712-726`(寫入 `featuredShowcase`)

**程式碼佐證**

```ts
// server/routers/showcase.ts:687-703
const todayCount = await db
  .select({ count: sql<number>`COUNT(*)` })
  .from(featuredShowcase)
  .where(
    and(
      eq(featuredShowcase.curatorUserId, userId),
      sql`${featuredShowcase.createdAt} >= ${todayStart}`
    )
  );

const count = Number((todayCount[0] as any)?.count ?? 0);
if (count >= 5) {
  throw new TRPCError({ code: "TOO_MANY_REQUESTS", ... });
}
// ... 中間沒有交易鎖 ...
await db.insert(featuredShowcase).values({ ... });
```

**影響**

配額檢查(`SELECT COUNT(*)`)與寫入(`INSERT`)之間沒有資料庫交易(`db.transaction`)或唯一約束把關。若同一使用者同時發出多個 `promote` 併發請求,每個請求都可能在別的請求提交前讀到同一份「count < 5」快照,導致單日提交數超過設計上限的 5 件。影響範圍侷限在展示牆灌水/垃圾內容,非金流損失,故列為 Medium。

**建議**
把「查詢當日數量」與「寫入新紀錄」包進同一個資料庫交易,或改用 `INSERT ... SELECT COUNT(*) < 5` 的原子寫法/加上 per-user-per-day 的唯一鍵約束。

---

## 發現 4(Medium)— `promote` / `addComment` 寫入的使用者文字無任何內容審核即直接公開

**檔案:行號**
- `server/routers/showcase.ts:644-729`(`promote`:`title`/`description` 直接來自使用者輸入,`zod` 只做長度限制,無內容檢查)
- `server/routers/showcase.ts:856-901`(`addComment`:`content` 同樣只做 `trim().min(1).max(500)`,無內容檢查)
- 對照 `server/services/security/contentModeration.ts:1-60`(說明其涵蓋範圍僅止於 `server/routers.ts` 的 `checkSafety`(generate.* 提示詞)與 `videoStudio.ts` 的 fal safety checker,**未提及**本檔案任何端點)

**程式碼佐證**

```ts
// server/routers/showcase.ts:646-650
.input(
  z.object({
    historyId: z.number(),
    title: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
  })
)
```

```ts
// server/routers/showcase.ts:858-861
.input(
  z.object({
    showcaseId: z.number().int().positive(),
    content: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
  })
)
```

**影響**

`promote` 的 `title`/`description` 一旦通過長度檢查即立刻寫入 `featuredShowcase` 並在下一次 `list` 查詢時對全網匿名使用者可見,`addComment` 的留言內容同理即時公開,兩者都沒有呼叫任何字串內容過濾/審核機制(已搜尋全庫僅有的 `contentModeration.ts`,其註解明確說明只接在生成安全門,不含本檔)。任何登入使用者都能把任意文字(包含騷擾、有害或違規內容)直接發佈到首頁精選展示或留言區,沒有審核佇列或事後檢舉/下架流程可依循(至少在本檔案範圍內未見)。

**建議**
評估是否要在 `promote`/`addComment` 寫入前串接既有的 LLM 內容審核(`resolveSafetyFallback` 或等價機制),或至少提供管理端/使用者檢舉後的下架 API(目前 `removeItem` 只有作者本人可觸發,無第三方檢舉/管理員強制下架路徑存在於本檔)。

---

## 發現 5(Low)— `likeCount`/`forkCount` 全庫無寫入端點,「熱門排序」形同死碼

**檔案:行號**
- `server/routers/showcase.ts:236-239`(`LIST_FIELDS` 內的 `likeCount`/`forkCount`)
- `server/routers/showcase.ts:456-462`(`trending` 排序公式 `likeCount*2 + forkCount*3`)
- `server/routers/showcase.ts:966-971`(`stats` 對 `likeCount`/`forkCount` 做 SUM 聚合)
- 全庫 grep(`server/` 目錄)找不到任何對 `featuredShowcase.likeCount`/`forkCount` 的 `UPDATE`/`SET` 敘述,也找不到任何 `like`/`unlike`/`toggleLike`/`fork` procedure
- `client/src/components/PortfolioDetailDialog.tsx:286-310` 只讀顯示這兩個數字(Heart/GitFork 圖示),無點擊事件
- `server/routers/learnHub.seed.ts:8604` 教材文字寫著「按讚互動:點擊愛心按鈕,likeCount 即時更新」——與實際程式碼行為不符

**影響**

`showcase.ts` 定義的「熱門」排序公式、統計摘要都仰賴 `likeCount`/`forkCount`,但整個 `server/` 目錄內完全沒有任何端點會遞增這兩個欄位(除了負值 fallback 列的 `isBookmarked ? 1 : 0` 這個合成值)。也就是說,`trending` 端點宣稱的「按讚數 + fork 數加權排序」實際上恆等於「僅按 `sortWeight`/`id` 排序」,前端顯示的愛心/分支數字對真正的精選作品(非 fallback)永遠是資料庫預設值 0(除非有人直接操作資料庫)。LearnHub 教材(`learnHub.seed.ts`)甚至把「點擊愛心按鈕即時更新」寫成一個已完成的功能描述,與程式碼行為不符,屬於契約不符/死碼。

**建議**
若「按讚」本來就是規劃中但尚未實作的功能,建議要嘛儘速補上 `like`/`unlike` mutation(含防重複按讚的唯一鍵),要嘛從排序公式與教材文字中移除「按讚驅動熱門排序」的敘述,避免內部文件與實際行為長期不一致。

---

## 發現 6(Low)— `addComment`/`deleteComment` 計數器更新與主動作非同一交易

**檔案:行號**
- `server/routers/showcase.ts:886-897`(新增留言 + `commentCount + 1`,兩個獨立 `await`)
- `server/routers/showcase.ts:938-948`(刪除留言 + `GREATEST(commentCount - 1, 0)`,兩個獨立 `await`)

**影響**

兩處都是「先做主動作、再更新分母計數」的兩段式寫法,沒有包在 `db.transaction` 內。若第一個 `await` 成功、第二個因例外(連線中斷等)失敗,會導致 `commentCount` 與實際留言數量長期不同步。`deleteComment` 一側有 `GREATEST(...,0)` 防止負數,但沒有機制能反向「多算」的情況做自我修正;`addComment` 一側則完全沒有補償機制。屬於資料一致性瑕疵而非安全漏洞,嚴重度低。

**建議**
兩段操作包進同一 `db.transaction`,或改用 `INSERT ... ON DUPLICATE` / 觸發器讓計數自動與明細表同步,避免手動維護的分母計數器長期漂移。

---

## 發現 7(Low)— `byAesthetics` 對外開放的多重前導萬用字元 LIKE 查詢,存在查詢放大疑慮

**檔案:行號**
- `server/routers/showcase.ts:552-636`(整個 `byAesthetics` 端點)
- `server/routers/showcase.ts:567-589`(`likeConditions` 與 `matchScore` 各自針對每個 aesthetics tag 產生 3 個 `LIKE '%...%'` 條件,`aesthetics` 陣列上限 20,兩處各自展開等於單一請求最多產生 ~120 個前導萬用字元 LIKE 判斷)
- `server/_core/trpc.ts:50`(`publicProcedure = t.procedure`,未掛任何 rate-limit middleware)

**影響**

`byAesthetics` 是 `publicProcedure`(匿名可呼叫),每次請求最多可帶 20 個 `aesthetics` 字串,每個字串都會在 `title`/`description`/`originalPrompt` 三個文字欄位上各產生一次 `LIKE '%tag%'`(前導萬用字元,索引用不上),且同樣的比對邏輯在 `matchScore` 計算裡又重覆一次。單一請求即可讓資料庫對 `featured_showcase` 全表做多達上百次字串掃描,而本檔案與 `trpc.ts` 均未見任何速率限制或每請求開銷上限控制。雖然目前用途是 Gemini Director 的美學重排(`ShowcaseMasonry.tsx` 有實際呼叫,非孤兒端點),但作為匿名可達端點,仍是一個可被濫用做查詢放大 DoS 的面。

**建議**
評估對 `byAesthetics` 加上速率限制,或將多欄位多標籤的 LIKE 比對改為預先建立的 tag 索引表/全文檢索,降低單一請求可觸發的資料庫工作量。

---

## 發現 8(Low)— `promote` 未檢查同一 `historyId` 是否已提交過

**檔案:行號**
- `server/routers/showcase.ts:656-681`(只驗證 `historyId` 屬於該使用者且有 `resultUrl`,未查詢 `featuredShowcase` 是否已存在相同 `generatedItemId` 的 active 紀錄)

**影響**

使用者可以對同一筆 `generationHistory` 重複呼叫 `promote`,每次都會在 `featuredShowcase` 產生一筆新紀錄(佔用每日 5 件配額、灌水展示牆),沒有防重複提交的檢查。影響侷限在展示牆內容品質/配額浪費,非資料外洩或跨用戶存取問題。

**建議**
寫入前查一次是否已有 `curatorUserId=userId AND generatedItemId=historyId AND isActive=true` 的紀錄,存在則直接回傳既有結果或報錯提示「已提交過」。

---

## 已驗證排除的疑慮(Negative Results)

以下項目經逐行檢視後**確認未構成漏洞**,記錄以避免重複稽核:

1. **`getById` 負值 id 的 IDOR 已修復**(`server/routers/showcase.ts:355-409`)— 程式碼註解與邏輯顯示這是 `commit 21e28705`(`fix(AIDV-609)`)修的:負值 id 對應 `generation_history` 私有列時,查詢會套用與 `fetchFallbackHistory` 完全一致的「有成品 URL 且(已加書籤 OR 評分≥4)」可見性述詞,不符合條件即回 `NOT_FOUND`,不存在匿名任意讀取他人未公開生成紀錄的問題(此點與發現 1 討論的是「該可見性規則本身是否合理」,並非「該規則有沒有被正確套用」——套用本身是正確的)。

2. **`promote`/`removeItem`/`myItems` 均正確以 `ctx.user.id` 綁定擁有權**——`promote`(644-673)驗證 `historyId` 屬於呼叫者;`removeItem`(761-777)驗證 `id` 屬於呼叫者的 `curatorUserId` 才允許下架;`myItems`(734-756)查詢條件即為 `eq(curatorUserId, userId)`。三者皆無跨用戶存取/竄改他人資料的路徑。

3. **`deleteComment` 正確做作者本人檢查**(`server/routers/showcase.ts:908-936`)——先查出留言的 `userId`,`!== ctx.user.id` 則回 `FORBIDDEN`,無法刪除他人留言。

4. **SQL 注入面已檢視、未發現漏洞**——`byAesthetics`(567-608)的 `LIKE` pattern 與 `fetchFallbackHistory`(186-193)/`byAesthetics`(601-608)的 `NOT IN (...)` id 清單都是透過 drizzle 的 `` sql`...` `` 樣板標籤插入,樣板內的 JS 值一律被參數化綁定而非字串拼接,加上 `excludeIds`/`aesthetics` 皆先經過 `z.array(z.number())`/`z.array(z.string())` 驗證,未發現可拼接任意 SQL 的路徑。

5. **`commentCount` 遞增/遞減本身是原子 SQL 運算**(`sql\`${featuredShowcase.commentCount} + 1\``、`GREATEST(...,0)`)——雖然發現 6 指出「主動作+計數器更新」這兩步不在同一交易內,但計數器運算式本身不是「先讀出再寫回」的 read-modify-write,不存在單純併發讀寫導致的丟失更新(lost update)問題。

6. **`list`/`byModality`/`trending` 的分頁上限均由 zod 強制**(`limit.max(MAX_PAGE_SIZE=48)`、`trending.limit.max(20)`),不存在可傳入超大 `limit` 造成單次查詢無上限放大的問題。

7. **`imageUrl`/`thumbnailUrl` 是否可被使用者竄改成任意字串(如 `javascript:` URI)一事,未在本檔驗證**——`promote` 端點只是把 `generationHistory.resultUrl`/`thumbnailUrl` 原樣複製進 `featuredShowcase`(712-726),這兩個欄位的產生與驗證邏輯在 `generate.ts`/`history.ts`,超出本檔案範圍,依規則 2 不臆測其安全性,留待後續針對該檔案的稽核確認。

---

## 附註:資料表對照

- `featured_showcase`(`drizzle/schema.ts:1202-1294`):`isActive` 預設 `true`、`likeCount`/`forkCount`/`commentCount` 均為整數計數器且無外部欄位級唯一約束防止內容重複。
- `featured_showcase_comments`(`drizzle/schema.ts:1300-1317`):`showcaseId` 僅有一般索引(`fsc_showcase_created_idx`),**沒有**資料庫層級的外鍵約束指向 `featured_showcase.id`,`addComment`(866-884)靠應用層手動查詢確認存在才寫入,以彌補缺少 FK 的風險(此為既有正確做法,非本次新發現的問題)。
- `generation_history`(`drizzle/schema.ts:935-990`):無 `isPublic`/`visibility` 欄位,呼應發現 1。
