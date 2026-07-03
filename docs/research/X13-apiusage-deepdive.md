# X13 — apiUsage.ts 用量/計費追蹤逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/apiUsage.ts(728 行)

範圍聲明:本文件聚焦 `server/routers/apiUsage.ts` 本身(admin API 用量/計費儀表板的 tRPC 端點)。
為了判斷「數字準不準、能不能被操縱」,稽核過程中交叉讀取了其直接依賴的
`server/services/costAnalytics.ts`、`drizzle/schema.ts`(`ai_usage_events` / `provider_snapshots` /
`cost_aggregations` / `cost_ledger` / `rate_limit_rules` / `alert_configs`)、寫入端
`server/jobs/providerSnapshotJob.ts`、`server/routes/aiProxy.ts`、`server/jobs/apiUsageAlertJob.ts`、
`server/jobs/costLedgerReconcileJob.ts`,以及授權層 `server/_core/trpc.ts` / `shared/const.ts`。
所有跨檔案引用只作為「根因佐證」,發現本身的行號錨點以 `apiUsage.ts` 為主。

---

## 摘要

1. 最直接可證實的一個發現是**單純的 SQL 欄位名拼字錯誤**:`usageByProvider`(第 353 行)在原生 SQL
   子查詢裡把 `provider_snapshots.snapshotAt`(schema 實際欄位名,見 `drizzle/0008_admin_api_usage.sql:33`)
   誤打成 `snapshot_at`,而同一支檔案的另外兩處(第 278、579 行)都正確寫成 `snapshotAt`。MySQL
   對不存在的欄位不會靜默容錯,這條查詢一執行就會噴 `Unknown column 'snapshot_at'`,而
   `usageByProvider` 已確認掛在 `client/src/pages/AdminApiUsagePage.tsx` 的「依供應商拆解」分頁上,
   等於該分頁目前必定回 500。
2. `deepCost` 端點內部存在「兩個互相打架的『真實總成本』」:第 555-562 行特地寫了一段獨立、不受
   50,000 筆事件上限截斷的 `SUM(costUsd)` 查詢(註解明講是為了修「50k 取樣截斷」問題),但第
   600-604 行對外標示為「真實成本單一真值」的 `truth.totalUsd` 卻是用**可能被截斷的** `events`
   陣列算出來的 `reconciliation.truthTotalUsd`——當視窗內事件數 ≥ 50,000 筆時,這兩個欄位會回傳
   不同的數字,而被貼上「truth」標籤的那個反而是錯的(偏低)。
3. `provider_snapshots.balanceUsd` 這個欄位在整個後端**沒有任何寫入路徑**會賦值(`fal_ai`/`gemini`
   是明確的 TODO 佔位、`elevenlabs`/`suno` 的輪詢函式回傳物件本身就沒有 `balanceUsd` 這個 key),
   但 `overview`(第 282-284、300-309 行)把這個永遠是 `null` 的欄位 `?? 0` 成「$0.00」顯示在
   KPI 卡片與各供應商餘額列上,看起來像是「查過但真的是 0」,而不是「從未追蹤」。
4. `rate_limit_rules.upsert` 的 Zod schema(第 96 行)允許 `ruleType: "per_api_key"`,但實際擋
   請求的 `server/routes/aiProxy.ts:checkRateLimit()` 只實作了 `per_user` 與 `global` 兩種
   分支,從未處理 `per_api_key`;而且 `ai_usage_events.apiKeyId` 欄位在整個 `server/` 目錄
   從未被任何 INSERT 寫入過。也就是說,admin 在這支檔案的 UI 上能夠建立一條「per API key 限流/限
   額」規則,但這條規則**永遠不會生效**,任務指定要追的「API key 管理授權」在本檔案等於一個空殼。
5. `rate_limit_rules` / `alert_configs` 的 CRUD(upsert/delete,第 92-140、152-194 行)完全沒有
   呼叫任何 audit log(對照同專案 `server/routers/rbac.ts` 對 share/revoke 都會呼叫
   `recordAuditEvent`),schema 也沒有 `updatedBy` 欄位——這兩張表恰好是「花費/呼叫量的煞車皮」,
   被誰、何時放寬或刪除,沒有留下任何痕跡。
6. 也有幾項**已查證排除**的疑慮值得記錄,包含:全檔案的授權都正確掛在 `adminProcedure`、原生
   `sql` 樣板沒有注入風險、供應商金鑰從未透過此檔案外洩、`rate_limit_rules`/`alert_configs`
   本身並非死表(其餘規則確實有被消費)。詳見文末「已驗證排除的疑慮」。

| 嚴重度 | 編號 | 一句話 | Cluster |
|---|---|---|---|
| High | H1 | `usageByProvider` 子查詢欄位名打錯(`snapshot_at` vs `snapshotAt`),整個「依供應商」分頁必定噴 SQL 錯誤 | other |
| High | H2 | `deepCost.truth.totalUsd` 用可能被 50k 截斷的樣本計算,與同回應內已修好的 `window.totalCostUsd` 互相矛盾 | billing |
| High | H3 | `provider_snapshots.balanceUsd`(及 fal_ai/gemini 的 quota/remaining/nextInvoice)從未被任何程式碼寫入,却被顯示成「$0.00」真實餘額 | billing |
| Medium | M1 | `rateLimitRules.ruleType="per_api_key"` 在 CRUD 層開放輸入,但下游執行端從未實作,`apiKeyId` 也從未被寫入——「API Key 管理授權」形同空殼 | deadcode |
| Medium | M2 | `rateLimits`/`alerts` 的 upsert/delete 無任何 audit log,計費煞車可被無痕鬆綁或刪除 | billing |
| Medium | M3 | `overview`(cost_aggregations)、`deepCost`(ai_usage_events)、`costAttribution`(cost_ledger)三個端點各自唯讀不同底表算「本月總花費」,專案自己的 `costLedgerReconcileJob.ts` 承認這兩兩之間會 drift,但三端點互不校驗也不揭露 | billing |
| Medium | M4 | `costAttribution` 在 `ENABLE_COST_LEDGER` 預設關閉(`env.validated.ts:679` 預設 `"false"`)時會安靜回全 0,回應中沒有欄位區分「功能未開」與「真的沒有花費」 | northstar |
| Medium | M5 | 日期視窗建構混用「local time 的年月日建構子」與「UTC 解析的 `new Date("YYYY-MM-DD")`」,若部署時區非 UTC,預設視窗與明確帶日期的視窗會有時區偏移(未在本檔驗證實際部署 TZ) | billing |

---

## High

### H1 — `usageByProvider` 子查詢欄位名拼字錯誤,整支查詢會噴 SQL 錯誤

**發現**

`server/routers/apiUsage.ts:348-355`:

```ts
348	      const snapshots = await db
349	        .select()
350	        .from(providerSnapshots)
351	        .where(
352	          sql`(${providerSnapshots.provider}, ${providerSnapshots.snapshotAt}) IN (
353	            SELECT provider, MAX(snapshot_at) FROM ${providerSnapshots} GROUP BY provider
354	          )`
355	        );
```

第 353 行的原生 SQL 子句寫死 `MAX(snapshot_at)`(snake_case),但 `drizzle/schema.ts:2088-2105` 對
`providerSnapshots` 表的欄位定義是:

```ts
2100	    snapshotAt: timestamp("snapshotAt").defaultNow().notNull(),
```

也就是 DB 實際欄位字面量是 `snapshotAt`(camelCase,`drizzle/0008_admin_api_usage.sql:33` 建表語句
`` `snapshotAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP `` 可佐證),沒有任何 `casing:
"snake_case"` 轉換設定(`server/db.ts:306` 的 `drizzle({...})` 呼叫未帶 `casing` 選項)。同一支檔案
另外兩處寫法都是對的:

```ts
277-278 (overview):
        sql`(${providerSnapshots.provider}, ${providerSnapshots.snapshotAt}) IN (
          SELECT provider, MAX(snapshotAt) FROM ${providerSnapshots} GROUP BY provider

578-579 (deepCost):
          sql`(${providerSnapshots.provider}, ${providerSnapshots.snapshotAt}) IN (
            SELECT provider, MAX(snapshotAt) FROM ${providerSnapshots} GROUP BY provider
```

只有第 353 行(`usageByProvider`)是唯一的例外,型態上是複製貼上時的手誤,而非刻意的相容處理。

**影響**

- MySQL 對查詢裡引用不存在的欄位不會靜默忽略或回退,會直接丟出
  `ER_BAD_FIELD_ERROR: Unknown column 'snapshot_at' in 'field list'`,這個錯誤會一路往上拋穿
  `adminProcedure.query`,變成 tRPC `INTERNAL_SERVER_ERROR`。
- `usageByProvider` 已確認被 `client/src/pages/AdminApiUsagePage.tsx:218` 的
  `trpc.apiUsage.usageByProvider.useQuery(...)` 呼叫,即後台「依供應商拆解使用量」分頁,目前
  應該是**每次載入都會出錯**,而不是資料不準——是完全打不開。
- 沒有任何測試檔案引用 `usageByProvider`(`grep -rl usageByProvider` 只命中這支檔案與呼叫它的
  前端頁面),代表這條路徑目前沒有自動化守門,只能靠人工發現。

**建議**

把第 353 行的 `snapshot_at` 改成 `snapshotAt`,與第 278、579 行的既有正確寫法對齊;並補一條
針對 `usageByProvider` 的最小整合測試(可用 sqlite/mysql test container 起一張 `provider_snapshots`
表跑一次這條查詢),避免同一類「原生 SQL 手寫欄位名」的手誤未來再度回歸且無人發現。

---

### H2 — `deepCost` 回應內「兩個真實總成本」互相矛盾(50k 截斷偏差)

**發現**

`server/routers/apiUsage.ts:529-543` 限制單次最多拉 50,000 筆 `ai_usage_events`(依 `createdAt`
倒序取最新 50k 筆):

```ts
529	      // 限制掃描量級：最多 50,000 筆事件，避免 admin dashboard 拖垮 DB
530	      const rows = await db
531	        .select({...})
532	        .from(aiUsageEvents)
533	        .where(whereClause)
534	        .orderBy(desc(aiUsageEvents.createdAt))
543	        .limit(50_000);
```

第 555-562 行**特地**另開一條不受這個上限截斷的獨立 SUM 聚合,註解明講這是為了修正取樣偏差:

```ts
555	      // AIDV-191：真實視窗總成本用獨立 SUM 聚合（同 WHERE、不受 50k 取樣截斷）
556	      const [aggRow] = await db
557	        .select({
558	          totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageEvents.costUsd}), 0)`,
559	        })
560	        .from(aiUsageEvents)
561	        .where(whereClause);
562	      const trueTotalCostUsd = Number(aggRow?.totalCostUsd ?? 0);
```

但第 590 行的帳單對帳邏輯,是拿**同一組可能被截斷的 `events` 陣列**去算:

```ts
590	      const reconciliation = reconcileWithProviderInvoices(events, invoices);
```

`reconcileWithProviderInvoices`(`server/services/costAnalytics.ts:974-1035`)內部用
`events.reduce`/迴圈把 `costUsd` 累加成 `recordedByProvider`(第 978-985 行),再取
`Math.max(totalRecorded, totalInvoiced)` 當作 `truthTotalUsd`(第 1025 行)——這裡的
`totalRecorded` 完全沒有用到第 562 行剛修好的 `trueTotalCostUsd`。

回應組裝處(`apiUsage.ts:592-605`)把兩者並列輸出、卻各自宣稱自己是「真的」:

```ts
597	          totalCostUsd: Math.round(trueTotalCostUsd * 1_000_000) / 1_000_000,
598	          truncated: events.length >= 50_000,
...
601	        truth: {
602	          source: "ai_usage_events.costUsd + provider_snapshots.nextInvoice",
603	          totalUsd: reconciliation.truthTotalUsd,
604	        },
```

**影響**

- 當查詢視窗(預設「當月迄今」,或呼叫端自訂 `startDate`/`endDate`)內事件數 ≥ 50,000 筆時,
  `window.totalCostUsd`(第 597 行,正確)與 `truth.totalUsd`(第 603 行,被截斷、偏低)會回傳
  不同數字,且後者才是明確標示給人看「單一真值」的欄位——名實不符,越是流量大、越接近月底、
  越需要精準對帳的時刻,這個「truth」欄位越不可信。
- 同一批被截斷的 `events` 也餵給 `topUsers`/`byCategory`/`byStatus`/`waste`/`heatmap`/
  `catalogVsActual`/`endpointTrends`/`costDistribution`/`retryChains`/`byFeature`/
  `savingsSuggestions`(第 606-620 行)——這些子報表在截斷發生時全部只看得到「時間窗內最近的
  50k 筆」,可能系統性低估活動較早、但呼叫量大的使用者/端點的花費占比,且沒有個別欄位提示
  「這張表也被截斷了」(只有頂層 `window.truncated` 一個布林值)。
- 每 provider 的對帳缺口 `gapUsd`/`gapPct`(來自 `reconciliation.perProvider`)在截斷情況下也會
  被低估的 `recorded` 拉大(顯得平台記錄比供應商帳單少很多),可能造成誤判「平台漏記」的假警報,
  或反向掩蓋真正的漏記。

**建議**

`reconcileWithProviderInvoices` 的呼叫應該改吃第 562 行已經算好的 `trueTotalCostUsd`(至少
`ProviderRecon.recordedCostUsd` 的加總口徑要對齊),或是在 `truth.totalUsd` 為截斷情境時明確
改用 `trueTotalCostUsd` 覆寫,並在回應加一個 `truth.truncated` / `reconciliation.truncated`
欄位讓前端能提示「此對帳結果為近似值」。如果要保留 per-provider 明細對帳,per-provider 的
SUM 也應該像第 556-562 行一樣各自開獨立聚合查詢,而不是重複使用受限的 `events` 陣列。

---

### H3 — `provider_snapshots.balanceUsd` 從未被寫入,卻顯示為真實「$0.00」餘額

**發現**

`apiUsage.ts:282-284`(`overview`)與 `apiUsage.ts:300-309`(`providerBalances` 陣列)都把
`balanceUsd` 用 `?? 0` 轉成數字直接輸出:

```ts
282	    const totalBalance = latestSnapshots.reduce((sum, s) => {
283	      return sum + Number(s.balanceUsd ?? 0);
284	    }, 0);
...
300	    const providerBalances = latestSnapshots.map(s => ({
301	      provider: s.provider,
302	      tier: s.tier,
303	      quota: Number(s.quota ?? 0),
304	      remaining: Number(s.remaining ?? 0),
305	      balanceUsd: Number(s.balanceUsd ?? 0),
306	      pct: s.quota && Number(s.quota) > 0
307	        ? Math.round((Number(s.remaining ?? 0) / Number(s.quota)) * 100)
308	        : null,
309	    }));
```

交叉檢查唯一負責寫入 `provider_snapshots` 的 `server/jobs/providerSnapshotJob.ts`:

```ts
26	async function pollElevenLabs(): Promise<{
27	  tier?: string; quota?: number; remaining?: number; balanceUsd?: number;
28	  nextInvoice?: {...}; extraData?: Record<string, unknown>;
29	}> {
...
46	    return {
47	      tier: String(data.tier ?? ""),
48	      quota: Number(data.character_limit ?? 0),
49	      remaining: Number(data.character_limit ?? 0) - Number(data.character_count ?? 0),
50	      nextInvoice: data.next_invoice ? {...} : undefined,
51	      extraData: {...},
52	    };
```

`pollElevenLabs()` 的實際回傳物件**沒有 `balanceUsd` 這個 key**;`pollSuno()`
(`providerSnapshotJob.ts:64-91`)回傳物件同樣沒有 `balanceUsd`;`fal_ai`/`gemini` 兩支則整段是
佔位字串:

```ts
122	        } else if (provider === "fal_ai") {
123	          // TODO: Implement fal.ai usage API polling when pricing/estimate endpoint is available
124	          snapshotData = {
125	            tier: "pay-as-you-go",
126	            extraData: { note: "fal.ai usage tracked via proxy gateway" },
127	          };
128	        } else if (provider === "gemini") {
129	          // TODO: Implement GCP Cloud Billing API polling for Gemini costs
130	          snapshotData = {
131	            tier: "pay-as-you-go",
132	            extraData: { note: "Gemini usage tracked via GCP billing" },
133	          };
```

四個供應商裡沒有任何一個會讓 `snapshotData.balanceUsd` 有值,寫入 DB 時
(`providerSnapshotJob.ts:141`)一律是 `snapshotData.balanceUsd?.toString() ?? null` → 永遠 `null`。
同理,`fal_ai`/`gemini` 的 `quota`/`remaining`/`nextInvoice` 也永遠是 `null`(只有
`elevenlabs`/`suno` 的 `quota`/`remaining` 是真實輪詢值,且只有 `elevenlabs` 有機會填到
`nextInvoice`)。

**影響**

- `overview.totalBalance`(admin 儀表板的 KPI 卡片)結構上**永遠是 `$0.00`**,不管四個供應商的
  真實帳戶餘額是多少——因為求和的來源欄位從頭到尾沒有任何寫入路徑。這不是「資料還沒同步」的暫時
  現象,是永久性的。
- `providerBalances[].balanceUsd` 同樣對四個供應商都固定顯示 `0`,`pct`(額度使用率)對
  `fal_ai`/`gemini` 也固定是 `null`,呈現上與「查過、確實是 0」或「額度用滿」無法區分,容易讓
  admin 誤判帳戶健康度(例如以為 fal.ai 額度充足,實際上完全沒有在追蹤)。
- `deepCost.reconciliation`(H2 段引用的 `reconcileWithProviderInvoices`)拿的
  `invoices[].invoiceUsd` 只有 `elevenlabs` 有機會非 null,`fal_ai`/`gemini`/`suno` 永遠
  `null` → 這三個供應商的 `gapUsd`/`gapPct` 永遠是 `null`,也就是「帳單對帳」這個賣點功能對
  多數供應商(尤其 fal_ai 通常是圖片/影片生成的主要花費來源、gemini 是文字 LLM 的主要花費來源)
  完全沒有真正對過帳。

**建議**

短期:`overview`/`providerBalances` 對 `balanceUsd`/`quota`/`remaining`/`nextInvoice` 全為 `null`
的供應商,回傳 `null`(而非 `?? 0`),前端改顯示「未追蹤」而不是「$0」,避免誤導。中期:把
`providerSnapshotJob.ts` 裡 fal_ai/gemini 的 TODO 補完(fal.ai 有 usage/estimate 端點、Gemini
可接 GCP Cloud Billing API),否則這個檔案裡「深度成本」面板標榜的「帳單對帳」對兩大主要供應商
只是裝飾。

---

## Medium

### M1 — `ruleType: "per_api_key"` 與 `apiKeyId` 全鏈路都是空殼,「API Key 管理授權」名不副實

**發現**

`apiUsage.ts:92-104`(`rateLimitRouter.upsert` 的輸入 schema):

```ts
93	    .input(
94	      z.object({
95	        id: z.number().int().positive().optional(),
96	        ruleType: z.enum(["per_user", "per_api_key", "global"]),
97	        targetId: z.string().max(128).optional(),
```

`per_api_key` 是三個合法值之一,admin 可以透過這支 router 建立這種規則並存進
`rate_limit_rules` 表。但唯一真正「擋請求」的執行端 `server/routes/aiProxy.ts:checkRateLimit()`
(122-249 行)只認得兩種 `ruleType`:

```ts
156	    for (const rule of rules) {
157	      if (rule.ruleType === "per_user" && userId) {
...
223	      if (rule.ruleType === "global") {
```

整支 `aiProxy.ts` 檔案沒有任何 `if (rule.ruleType === "per_api_key")` 分支,也沒有任何地方
讀取或比對 `apiKeyId`。進一步交叉確認 `aiUsageEvents.apiKeyId`(`drizzle/schema.ts:2067`)欄位
本身:

```
grep -rn "apiKeyId" server --include=*.ts   →   只命中 schema 定義本身,server 目錄下沒有任何
                                                 INSERT / .values({...apiKeyId...}) 寫入這個欄位
```

**影響**

- Admin 在這支檔案的管理介面建立一條「per_api_key」規則(例如想針對某個外洩/被濫用的 API key
  設每日花費上限),存進 DB 後**永遠不會被拿來擋任何請求**——因為 `apiKeyId` 本身永遠是
  `NULL`,就算 `checkRateLimit` 有支援 `per_api_key`,也沒有任何一筆 `ai_usage_events` 帶有
  可比對的 `apiKeyId` 可用。
- 這正好命中本次任務要追的「API key 管理授權」焦點:此檔案暴露出的「API Key」維度管理能力,
  從輸入驗證層一路到底層資料表都沒有真正落地,是一個看得到 CRUD UI、但完全不會生效的假控制項。

**建議**

短期:在 `rateLimitRouter.upsert` 的 Zod schema 拒絕 `ruleType: "per_api_key"`(或至少在
UI/回應加警告字樣),避免 admin 誤以為設定生效。長期:若真要支援「per API key」限流,需要先確立
「API key」這個概念在系統裡的真實來源(目前平台的呼叫全部走伺服器端環境變數金鑰,並沒有終端使用
者可核發/管理的個人 API key),把 `aiUsageEvents.apiKeyId` 的寫入路徑補齊,再讓
`checkRateLimit` 加上對應分支。

---

### M2 — 計費煞車(rate limits / alerts)CRUD 無任何 audit trail

**發現**

`apiUsage.ts:92-140`(`rateLimitRouter.upsert`/`delete`)與 `apiUsage.ts:152-194`
(`alertConfigRouter.upsert`/`delete`)四個 mutation 都只做 DB `update`/`insert`/`delete`,
沒有任何一處呼叫審計相關函式:

```ts
105	    .mutation(async ({ input }) => {
106	      const db = await requireDb();
107	      if (input.id) {
108	        await db
109	          .update(rateLimitRules)
110	          .set({...})
111	          .where(eq(rateLimitRules.id, input.id));
112	        return { id: input.id };
113	      }
...
134	  delete: adminProcedure
135	    .input(z.object({ id: z.number().int().positive() }))
136	    .mutation(async ({ input }) => {
137	      const db = await requireDb();
138	      await db.delete(rateLimitRules).where(eq(rateLimitRules.id, input.id));
139	      return { success: true };
140	    }),
```

對照同專案內另一支同樣管理敏感設定的 router `server/routers/rbac.ts`,其
share/revokeShare/transferOwnership 等 mutation 都會呼叫 `recordAuditEvent(...)`
(`rbac.ts:174, 211, 287`)。`rate_limit_rules`/`alert_configs` 的 schema 定義
(`drizzle/schema.ts:2262-2292`)本身也沒有 `updatedBy`/`createdBy` 之類欄位可回溯操作者,只有
`createdAt`/`updatedAt` 時間戳。

**影響**

- `rate_limit_rules`/`alert_configs` 正是本檔案唯一會真的影響「花費是否被擋下」的守門設定
  (已在「已驗證排除的疑慮」確認兩表確實有被 `aiProxy.ts`/`apiUsageAlertJob.ts` 消費,並非死表)。
  一旦有人(惡意內部人員、或被盜用的 admin session)刪除或放寬 `dailyCostLimitUsd`/
  `monthlyCostLimitUsd` 規則,平台在事後**完全無法追出是誰、何時做的**,只能看到規則本身消失或
  數字變大這個「結果」。
- 這直接對應任務關切的「能否被操縱」:操縱的手法不需要繞過 `adminProcedure`(攻擊者本來就要有
  admin 權限),但一旦拿到 admin 權限,關掉/放寬計費煞車是「零痕跡」的。

**建議**

比照 `rbac.ts` 的既有型樣,在四個 mutation 成功後呼叫 `recordAuditEvent`(記錄 actor、變更前後
值、目標 rule id),並考慮替 `rate_limit_rules`/`alert_configs` schema 補上 `updatedBy` 欄位。

---

### M3 — 三個端點各自唯讀不同底表算「本月總花費」,drift 已知但未互相校驗

**發現**

同一支檔案裡,「這個月花了多少錢」這個概念被三個不同的端點、用三張不同的底表各自算一次:

- `overview`(第 255-261 行)用 `cost_aggregations`:
  ```ts
  255	    const [monthStats] = await db
  256	      .select({
  257	        totalCalls: sql<number>`COALESCE(SUM(${costAggregations.callCount}), 0)`,
  258	        totalCost: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)`,
  259	      })
  260	      .from(costAggregations)
  261	      .where(gte(costAggregations.date, monthStart));
  ```
- `deepCost`(第 555-562 行)用 `ai_usage_events` 的獨立 SUM(即 H2 提到的 `trueTotalCostUsd`)。
- `costAttribution`(第 677-686 行)用 `cost_ledger` 的 posted debit/credit 淨額:
  ```ts
  677	      const groupRows = await db
  678	        .select({
  679	          accountKey: costLedger.accountKey,
  680	          netUsd: sql<string>`SUM(CASE WHEN ${costLedger.entryType} = 'debit' THEN ${costLedger.amount} ELSE -${costLedger.amount} END)`,
  ...
  686	        .groupBy(costLedger.accountKey);
  ```

專案本身其實已經知道 `cost_aggregations` 與 `cost_ledger` 這兩本帳「應該一致但可能 drift」,
`server/jobs/costLedgerReconcileJob.ts:1-9` 的檔頭註解寫得很直白:

```
4  *   (A) cost_ledger 的 posted debit 總額（append-only 雙分錄帳本，AIDV-153）
5  *   (B) cost_aggregations 的 totalCostUsd 總額（SUM(ai_usage_events.costUsd)，AIDV-14）
6  * 兩者應一致（ledger debit 並行於 aggregations 寫入，同一筆 usage 成本）。差額即
7  * drift，記 log 告警（Slack/console）——基礎版「只偵測、不自動修」
```

但這個偵測結果只送 Slack/console,`apiUsage.ts` 的三個端點彼此之間完全沒有交叉核對,也沒有把
`costLedgerReconcileJob` 算出的 drift 數字暴露在任何一個 tRPC 回應裡。

**影響**

- admin 打開「總覽」看到的月費用(來自 `cost_aggregations`)、打開「深度成本」看到的月費用
  (來自 `ai_usage_events`)、打開「成本歸屬」看到的月費用(來自 `cost_ledger`,且只在
  `ENABLE_COST_LEDGER=true` 時才有資料,見 M4)三者理論上該相等,實務上可能因為聚合 job 的
  時間差、`cost_ledger` 的 outbox 重試延遲、或 M2 提到的個別 provider 資料缺口而不同,而
  儀表板上沒有任何提示告訴 admin「這三個數字為什麼不一樣」。
- 這正是任務要追的「對帳一致性」的核心風險:同一個後台、同一個時間窗,三個分頁給出三個不同的
  「本月花費」,而使用者無從判斷該信哪一個。

**建議**

至少在 `overview`/`deepCost`/`costAttribution` 的回應裡各自標明資料來源(`overview` 目前完全
沒有 source 說明;`deepCost` 已有 `truth.source` 字串但如 H2 所述本身有截斷問題;
`costAttribution` 也沒有標明來源),並考慮把 `costLedgerReconcileJob` 目前只送 Slack 的
drift 數字,一併暴露成 `overview` 或 `deepCost` 回應的一個欄位,讓前端能在數字對不上時主動提示。

---

### M4 — `costAttribution` 在 ledger 功能關閉時安靜回全 0,無法與「真的沒花費」區分

**發現**

`apiUsage.ts:646-727`(`costAttribution` 端點)完全依賴 `cost_ledger` 表(`status='posted'`)算
分項成本,沒有任何地方檢查或回傳 `isCostLedgerEnabled()` 的狀態:

```ts
668	      const conditions = [
669	        eq(costLedger.status, "posted"),
670	        gte(costLedger.createdAt, start),
671	        lte(costLedger.createdAt, end),
672	      ];
...
715	      const limited = summary.slice(0, input?.limit ?? 100);
716	      return {
717	        rate,
718	        dimension: input?.dimension ?? "all",
719	        window: { start: start.toISOString(), end: end.toISOString() },
720	        totalCostTwd: Number(...),
721	        totalCostUsd: Number(...),
722	        rows: limited,
723	      };
```

而寫入 `cost_ledger` 的唯一路徑(`server/routes/aiProxy.ts:559`)是用旗標
`isCostLedgerEnabled()` 擋門,該旗標的定義(`server/_core/env.validated.ts:679`)預設關閉:

```
679:  ENABLE_COST_LEDGER: z.string().optional().default("false"),
```

`server/services/cost/ledger.ts:64` 的註解也明講「預設 OFF」。也就是說,只要部署環境沒有明確把
`ENABLE_COST_LEDGER` 設成真值,`cost_ledger` 表就不會有資料寫入(本次審查未取得實際部署環境變數,
無法確認生產環境目前是否已開啟此旗標)。

**影響**

- 若目前部署未開啟 `ENABLE_COST_LEDGER`,`costAttribution` 端點會對所有 `dimension`
  (project/member/workflow)回傳 `rows: []`、`totalCostTwd: 0`、`totalCostUsd: 0`——這個回應
  形狀與「這段時間真的沒有任何 AI 花費」完全無法區分,admin 可能誤判「本月成本歸屬全部是 0」,
  而不知道其實是這個子系統根本沒有在記錄。
- 回應裡沒有任何 `enabled`/`ledgerActive` 之類欄位可以讓前端做出「功能未啟用」與「查詢結果為
  空」的 UI 區分。

**建議**

在回應裡加一個明確欄位(例如 `ledgerEnabled: isCostLedgerEnabled()`),讓前端在旗標關閉時顯示
「此功能尚未啟用」而非一張空白的成本歸屬表。

---

### M5 — 日期視窗建構混用 local time 與 UTC 解析,時區偏移風險(未在本檔驗證實際部署 TZ)

**發現**

檔案內建構「預設日期範圍」一律用 `new Date(year, month, day)` 這種以**伺服器 process 當地時區**
解讀的建構子:

```ts
251	    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);          // overview
515	      const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);      // deepCost
663	      const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);      // costAttribution
```

而呼叫端明確帶 `startDate`/`endDate` 字串時,一律用 `new Date("YYYY-MM-DD")`,依 ECMA-262 規範
這種格式一律解析成 **UTC 午夜**:

```ts
361-362 (usageByProvider): new Date(input.startDate) / new Date(input.endDate)
414, 416 (usageEvents):     new Date(input.startDate) / new Date(input.endDate)
459-460 (billing):          new Date(input.startDate) / new Date(input.endDate)
516-517 (deepCost):         new Date(input.startDate) / new Date(input.endDate)
664-666 (costAttribution):  new Date(input.startDate) / new Date(input.endDate)
```

本次審查沒有在 repo 內(`Dockerfile`、`railway.toml`、`server/` 程式碼)找到任何 `TZ=` 環境變數
設定,無法確認實際部署容器的 process 時區是否為 UTC;若容器預設即 UTC,則此問題不會顯現(local
建構子與 UTC 解析會得到同一個結果)。

**影響(視部署 TZ 而定,未於本檔驗證)**

- 若伺服器 process 時區不是 UTC(例如設成 `Asia/Taipei`,UTC+8),「不帶日期參數的預設視窗」
  (以 local time 當月 1 號 00:00 為界)與「明確帶 `startDate=本月1號` 的視窗」(以 UTC 當月 1
  號 00:00 為界,換算成台北時間是當天上午 8 點)會相差到 8 小時,導致同一個查詢意圖、只是
  「有沒有帶日期參數」的差別,就能算出不同的當日/當月總額,直接影響「對帳一致性」。
- 若容器時區本身就是 UTC(常見的 Node/Docker 預設),此問題目前不會造成實際偏差,列為「條件式」
  發現而非必然成立。

**建議**

統一日期解析路徑:預設視窗與明確輸入都改用同一種建構方式(建議一律以 UTC 為準,例如
`new Date(Date.UTC(year, month, day))` 取代 `new Date(year, month, day)`),避免行為隨部署環境
時區設定而變動;若已確定部署環境固定為 UTC,至少應在程式碼加註解明講此前提,避免未來遷移到其他
時區部署時悄悄破功。

---

## 已驗證排除的疑慮(Negative Results)

以下項目是本次任務明確要求追查、但逐行核對後**沒有發現問題**的部分,列出以避免只報壞消息:

1. **授權正確且一致**:`apiUsageRouter` 內除 `textLlmStatus`(第 233 行,刻意用
   `protectedProcedure`,只回傳粗粒度的 `status`/布林值,不含任何用量或費用資料)外,所有端點
   (`overview`/`usageByProvider`/`usageEvents`/`billing`/`deepCost`/`snapshots`/
   `costAttribution`,以及巢狀的 `rateLimitRouter`/`alertConfigRouter` 內每一個 procedure)都
   明確掛在 `adminProcedure`。`adminProcedure` 的判定邏輯(`server/_core/trpc.ts:69-88`)呼叫
   單一真實來源 `isAdmin()`(`shared/const.ts:32-34`,嚴格只認 `role === "admin"`),與其他
   router 共用同一函式,沒有發現各自手寫 `role === "admin"` 導致邏輯漂移的情況。巢狀 router
   掛載(`rateLimits: rateLimitRouter` 第 443 行、`alerts: alertConfigRouter` 第 446 行)沒有
   繞過權限檢查,因為每個子 procedure 各自宣告了 `adminProcedure`,不是繼承自掛載路徑。
2. **沒有發現 SQL Injection / 上下文污染風險**:檔案內多處使用 drizzle 的原生
   `` sql`...` `` 樣板(第 277-280、352-354、578-581、680-681 行),但所有動態內插值不是
   drizzle 的 Column/Table 物件(會被正確轉成加引號的識別字)、就是純值(例如 `${rate}`,會被
   當成綁定參數而非字串拼接)。所有使用者輸入(日期字串、`provider` 列舉、`endpoint` 字串)
   都是透過 `eq`/`gte`/`lte` 等 drizzle helper 走參數化查詢,沒有發現把使用者輸入直接字串拼接
   進原生 SQL 的路徑。
3. **供應商金鑰不會外洩**:`providerReadiness`(第 200-227 行)與 `textLlmStatus`
   (第 233-244 行)只回傳「是否已設定」的布林值與環境變數**名稱**(如 `"FAL_API_KEY"`),
   從未回傳金鑰值、片段或前綴,符合稽核規則「連接器/憑證檔案只描述機制不輸出值」的要求。
4. **`rate_limit_rules` / `alert_configs` 並非死表**:交叉確認後,`rate_limit_rules` 確實被
   `server/routes/aiProxy.ts:checkRateLimit()`(122-249 行)在每次 AI 呼叫前讀取並實際擋門
   (fail-closed:查不到 DB 就直接擋);`alert_configs` 確實被
   `server/jobs/apiUsageAlertJob.ts`(155-258 行)的排程 job 讀取並在超過門檻時觸發告警。
   本檔案暴露的 CRUD 介面(`rateLimits`/`alerts` 子路由)有真實的下游效果,不是純裝飾性 UI
   ——例外只有 M1 提到的 `per_api_key` 這個特定分支。
5. **分頁/上限大致合理**:`usageEvents`(`limit` 1–100,預設 50)、`deepCost.topN`(1–100,
   預設 20)、`snapshots.limit`(1–100,預設 24)、`costAttribution.limit`(1–500,預設 100)
   都有明確上界,沒有發現可無限增大單次查詢筆數的參數。唯一的例外是 `usageByProvider` 的
   `allCosts` 查詢(第 365-375 行)與 `billing`(第 464-475 行)在未帶日期篩選時沒有
   `.limit()`,屬於效率面的低嚴重度觀察(已於下方補記),不影響資料正確性或授權邊界。

---

## 補記(Low,未列入結構化 findings)

- `usageByProvider` 的 `allCosts` 查詢(第 365-375 行)與 `billing`(第 464-475 行)在呼叫端
  未帶 `startDate`/`endDate` 時沒有 `.limit()`,會把 `cost_aggregations` 全表(依 provider+date
  group by 後)拉進 Node 記憶體,`usageByProvider` 還只是為了在 JS 端 slice 出每個供應商前 30
  筆(第 387 行)。隨著營運時間拉長,這會是一次全表掃描 + 全量資料搬移到應用層,只為了丟棄
  大部分結果,屬於效率/可用性風險而非資料正確性問題。
- `costAttribution` 把淨額 `Math.max(0, Number(r.netUsd ?? 0))` 直接夾到 0(第 696-697 行),
  若某個 project/member/workflow 的退款(credit)總額大於原始扣款(debit)總額(理論上不應
  發生,但沒有額外的異常偵測),會被無聲地顯示成「花費 $0」,而不是提示「淨值為負,可能有超額
  退款」。
- `rateLimitRouter.upsert` 的 `provider` 欄位是自由字串(第 98 行 `z.string().max(32)`),沒有
  限制在 `AI_PROVIDERS` 列舉內;若 admin 打錯大小寫或名稱(如 `"Gemini"` 而非 `"gemini"`),
  `aiProxy.ts:checkRateLimit()` 的 `eq(rateLimitRules.provider, provider)` 永遠不會匹配,規則
  會靜默失效,但 UI 上看起來像是已經設定成功。
