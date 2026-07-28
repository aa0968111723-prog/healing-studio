# X5 — brain.ts router 逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/brain.ts(1277 行)

範圍聲明:本文件聚焦 `brainRouter`(`server/routers/brain.ts`)本身的 API 層——授權邊界
(protectedProcedure vs adminProcedure)、輸入驗證契約、DB 交易/競態、計費文案正確性、死碼。
不重複 U4(`server/services/brainAutoRepair.ts` 服務層本身的 fal 級聯故障放大 / 缺 dedupKey 雜訊)、
X3(`modelPricing.ts` catalog 本身的定價公式/數值一致性)、W4(`brainPipeline.ts` 的
`getMyGraph`/`getSummary` 授權範圍問題)——只在必要處引用其結論作背景,並在其上新增本次逐行
深挖在 **router 層** 找到的、上述三份文件未觸及的具體發現。

方法:單一代理逐行實讀 `server/routers/brain.ts` 全文(1277 行,一次讀完),交叉核對
`server/_core/trpc.ts`(protectedProcedure/adminProcedure 定義)、
`server/services/brainAutoRepair.ts`(getErrorTraces/getProposals/getGenerationLogs/
createReflectionProposal/approveProposal 等實作,共 3034 行,重點段落逐行讀完)、
`drizzle/schema.ts`(userAiBrain、userModelSwitchLogs 表定義)、
`server/services/modelPricing.ts`(MODEL_PRICING_CATALOG maxPoints 抽查)、
`server/middleware/brainContext.ts`(getEngine().params 消費鏈)、
`client/src/pages/AdminPage.tsx`、`client/src/pages/admin/brain/tabs/*.tsx`、`client/src/App.tsx`
(前端呼叫端與路由守門,用來確認後端 procedure 等級是否對得上前端「誰看得到」的預期)。
禁止臆測,每條發現皆以 grep/讀檔結果為準。

---

## 0. 一句話總結

`brain.ts` 是「大腦組態 CRUD ＋ 自動修復/監控中心」的統一入口:`get`/`upsert`/`switchModel`/
`pricingSummary` 四個「使用者自己的大腦」端點正確地用 `eq(userAiBrain.userId, ctx.user.id)`
做了 owner 隔離,沒有 IDOR;但檔案後半段「5 大子系統」(警報/錯誤線索/優化提案/爬網研究/精準度
測試/生成活動記錄)裡,**寫入類操作全部正確掛 `adminProcedure`,讀取類操作卻幾乎全部只掛
`protectedProcedure`**——而這些讀取端點回傳的資料含有其他使用者的生成 prompt、錯誤訊息、
`resultUrl`,以及程式碼掃描產生的內部檔案路徑與程式碼片段。前端(`AdminPage.tsx:414-416`)
自己的註解寫得很清楚:「後端 procedure 仍是真正的權限線」——但這條防線在本檔案的讀取端點上
並不存在,任何已登入的 `role="user"` 帳號都能直接呼叫這些 procedure 讀到本應僅限 admin/leader
查看的跨用戶資料。此外,`orbVoicePreview`(真打 ElevenLabs 付費 TTS)完全沒有扣點與專屬速率
限制;`imageEngineParams` 等 4 個「引擎參數」JSON 欄位可寫可讀但全站沒有任何生成程式碼真的
讀取它們;`switchModel` 端點無人呼叫且其 Fal 引擎分支寫入時會撞上 MySQL enum 契約不符而必定
交易回滾。

---

## 1.【嚴重 CRITICAL】跨用戶生成紀錄/錯誤線索外洩——`errorTraces`/`diagnoseError`/`generationLogs` 只掛 protectedProcedure

**發現(附行號)**

```ts
// server/routers/brain.ts:915-926
errorTraces: protectedProcedure
  .input(z.object({ limit: ..., modality: ... }).optional())
  .query(({ input }) => getErrorTraces(input?.limit ?? 50, input?.modality)),

// server/routers/brain.ts:955-962
diagnoseError: protectedProcedure
  .input(z.object({ traceId: z.string() }))
  .query(({ input }) => {
    const diagnosis = diagnoseError(input.traceId);
    ...
  }),

// server/routers/brain.ts:1272-1276
generationLogs: protectedProcedure
  .input(z.object({ limit: ... }).optional())
  .query(({ input }) => getGenerationLogs(input?.limit ?? 100)),
```

三個 procedure 都只是 `protectedProcedure`(任何已登入使用者,無角色檢查),且底層函式**完全不
依 `ctx.user.id` 過濾**:

```ts
// server/services/brainAutoRepair.ts:1014-1018
export function getErrorTraces(limit = 50, modality?: string): ErrorTrace[] {
  let traces = errorTraces;              // 全站共用陣列,無 userId 篩選
  if (modality) traces = traces.filter(t => t.modality === modality);
  return traces.slice(0, limit);
}

// server/services/brainAutoRepair.ts:3032-3033
export function getGenerationLogs(limit = 100): GenerationLog[] {
  return generationLogs.slice(0, limit);  // 同樣無 userId 篩選
}
```

而 `ErrorTrace`/`GenerationLog` 型別本身含有其他使用者的個資等級欄位:

```ts
// server/services/brainAutoRepair.ts:94-99
export interface ErrorTrace {
  id: string;
  userId: number;
  modality: ...;
  engine: string;
  prompt: string;        // 使用者實際輸入的生成 prompt(最長 2000 字,見 brain.ts:934)
  errorMessage: string;
  ...
}

// server/services/brainAutoRepair.ts:3000-3009
export interface GenerationLog {
  id: string;
  userId: number;
  modality: ...;
  modelId: string;
  promptSnippet: string;   // 其他使用者的生成 prompt 片段
  resultUrl?: string;      // 其他使用者的生成結果連結
  success: boolean;
  sourceStudio: string;
  createdAt: number;
}
```

`diagnoseError` 同樣不驗證 `traceId` 是否屬於呼叫者,任何登入用戶帶入任意 `traceId` 即可取得
他人錯誤紀錄的根因分析(含 `prompt`/`errorMessage` 的診斷內容)。

**驗證前端預期**:這三個端點只在 admin 專用頁面被呼叫(`client/src/pages/admin/brain/tabs/
ErrorsTab.tsx:47,52`、`ResearchTab.tsx:36`),而 `AdminPage.tsx:414-416` 明確寫著:

```
// 管理員(admin)/組長(leader)才能進。leader 只能看「使用者管理」與「成本金流」
// 兩個分頁;其他 tab 即使透過 URL ?section= 也不會顯示對應內容(後端 procedure
// 仍是真正的權限線)。
```

且 `LEADER_VISIBLE_TABS = new Set(["users", "costs"])`——連 leader 角色在 UI 上都看不到
Errors/Research 分頁,只有 `admin` 能看。但後端 `errorTraces`/`diagnoseError`/`generationLogs`
連 `leaderOrAdminProcedure` 都不是,直接是最低門檻的 `protectedProcedure`。

**影響**:任何已註冊、最低權限的 `role="user"` 帳號(healing-studio 上最大宗的一般使用者),
只要照 tRPC 慣例直接呼叫 `trpc.brain.errorTraces.query()` / `trpc.brain.generationLogs.query()`
(繞過前端 UI,例如用瀏覽器 devtools 或自寫腳本帶上自己的登入憑證),即可讀到**全站所有使用者**
最近 200 筆生成紀錄的 `prompt`/`promptSnippet`/`resultUrl`/`errorMessage`,構成跨用戶隱私外洩。
對「healing」定位的內容創作平台而言,使用者 prompt 內容的敏感度可能相當高。

**建議**:把這三個 procedure 改為 `adminProcedure`(或至少 `leaderOrAdminProcedure`,對齊前端
`LEADER_VISIBLE_TABS` 的宣告);若產品上真的需要讓一般使用者查自己的錯誤/生成紀錄,應該另開
一支有 `eq(..., ctx.user.id)` 過濾的新端點,而不是放行整個全站陣列。

**cluster**:security-idor

---

## 2.【高 HIGH】監控中心其餘讀取端點同樣越權——`proposals`/`alerts`/`monitorSummary`/`autoRepairConfig`/`accuracyTests`/`researchResults`

**發現(附行號)**

```ts
// server/routers/brain.ts:868-870  monitorSummary
monitorSummary: protectedProcedure.query(() => getSystemSummary()),

// server/routers/brain.ts:875-877  autoRepairConfig
autoRepairConfig: protectedProcedure.query(() => getAutoRepairConfig()),

// server/routers/brain.ts:896-900  alerts
alerts: protectedProcedure.input(...).query(({ input }) => getAlerts(input?.limit ?? 50)),

// server/routers/brain.ts:970-978  proposals
proposals: protectedProcedure.input(...).query(({ input }) => getProposals(input?.status)),

// server/routers/brain.ts:1074-1078 researchResults
researchResults: protectedProcedure.input(...).query(({ input }) => getResearchResults(input?.limit ?? 50)),

// server/routers/brain.ts:1096-1100 accuracyTests
accuracyTests: protectedProcedure.input(...).query(({ input }) => getAccuracyTests(input?.limit ?? 50)),
```

同一批資料的**寫入**端點全部正確掛 `adminProcedure`(`dismissAlert:903`、`resolveError:945`、
`approveProposal:1017`、`rejectProposal:1045`、`addResearchToLearnHub:1081`、
`runAccuracyTest:1103`、`runAllAccuracyTests:1127`),形成「寫入有守門、讀取沒守門」的不對稱。
更明顯的對照組是同一份程式碼掃描資料:

```ts
// server/routers/brain.ts:1223-1235 —— 正確掛 adminProcedure
lastCodeScan: adminProcedure.query(() => {
  const result = getLastScanResult();
  ...
  findings: result.findings.slice(0, 100),   // 含 codeSnippet/filePath
});
```

`lastCodeScan`(admin-only)與 `proposals`(protectedProcedure)回傳的是**同一類別**的資料——
`createProposal` 的 input(`brain.ts:1003-1006`)與 `ReflectionProposal` 型別都含
`filePath`/`lineNumber`/`codeSnippet`——但一個守 admin、一個對所有登入用戶開放,是同一份檔案
內部自相矛盾的授權設計。

**影響**:任何一般使用者可直接讀到內部程式碼路徑/片段(`proposals` 內 `code_quality`/
`security_fix` 類提案往往帶有真實 `filePath:lineNumber` 與命中片段)、系統告警內容
(`alerts`,可能含供應商連線失敗訊息等維運細節)、以及全站精準度測試/爬網研究歷史——這些是
內部維運/程式碼掃描資訊,對外流出可作為攻擊者的偵察情報,且與 `AdminPage.tsx` 宣告的
leader/admin 專屬定位不符。

**建議**:比照 `lastCodeScan` 的模式,把這六個讀取端點全部升級為 `adminProcedure` 或
`leaderOrAdminProcedure`(依 `LEADER_VISIBLE_TABS` 決定實際門檻)。

**cluster**:security-idor

---

## 3.【高 HIGH】`createProposal`/`reportError` 讓一般使用者能寫入「管理員信任」的 AI 反省/GitHub Issue 管線

**發現(附行號)**

```ts
// server/routers/brain.ts:981-1009  任何登入用戶都能建立優化提案
createProposal: protectedProcedure
  .input(z.object({
    category: z.enum([... "security_fix", "code_quality", ...]),
    title: z.string().min(2).max(200),
    description: z.string().max(8000),
    ...
    filePath: z.string().max(500).optional(),
    codeSnippet: z.string().max(2000).optional(),
  }))
  .mutation(({ input }) => createReflectionProposal(input)),

// server/routers/brain.ts:929-942  任何登入用戶都能寫入錯誤線索(且會自動觸發外呼+建提案)
reportError: protectedProcedure
  .input(z.object({ modality:..., engine:z.string(), prompt:z.string().max(2000),
    errorMessage:z.string().max(2000), ... }))
  .mutation(({ ctx, input }) => recordErrorTrace({ ...input, userId: ctx.user.id })),
```

`reportError` 自己的文件註解寫「供其他 router 呼叫,或管理員手動回報」,但實作掛的是
`protectedProcedure`,任何登入用戶都能直接呼叫,而非僅限伺服器內部呼叫或管理員。
`recordErrorTrace` 內部會 `void autoSearchForFix(full)`(`brainAutoRepair.ts:959`),對外打一次
真實 Brave/Perplexity 搜尋 API,且成功時會用 `createReflectionProposal` 自動生出一筆
`accuracy_fix` 提案(`brainAutoRepair.ts:995-1006`)。

批准時,提案內容會被逐字組進真實 GitHub Issue 的 body(`proposalToIssueBody`,
`brainAutoRepair.ts:1932-1971`):

```ts
lines.push("## 命中片段");
lines.push("```");
lines.push(p.codeSnippet);   // 使用者可控字串,未跳脫 ``` 圍欄
lines.push("```");
```

`p.codeSnippet`/`p.description` 都可由 `createProposal` 呼叫者(任何登入用戶)完全控制,若內容
本身包含 ` ``` ` 就能跳脫程式碼圍欄,在 GitHub Issue 內插入任意 Markdown/連結(對審核 Issue 的
管理員或協作者構成社交工程/連結釣魚風險)。

**影響**:
1. 一般使用者可偽造任意 `category`/`severity`/`title`/`description`/`filePath`/`codeSnippet`
   的「優化提案」混入管理員審核佇列(與發現 2 的 `proposals` 讀取洩漏疊加,還能讓所有其他使用者
   看到);
2. 若管理員誤信任這是系統自動偵測產生而核准,攻擊者控制的內容會被逐字寫進公司真實 GitHub repo
   的 Issue(使用 `GITHUB_TOKEN`),且程式碼圍欄可被跳脫進行 Markdown 注入;
3. `reportError` 每次呼叫都會觸發一次真實外部搜尋 API 呼叫,無專屬速率限制,可被用來對
   `errorTraces`(見發現 1)/`reflectionProposals` 佇列灌入雜訊或消耗第三方搜尋 API 額度。

**建議**:`createProposal` 應要求 admin 或至少記錄/區隔「使用者提交」來源(目前
`ProposalSource` 型別已定義多種來源但 `createProposal` 未傳入,一律落為預設 `"manual"`,
與管理員自己手動建立的提案無法區分);`proposalToIssueBody` 對 `codeSnippet`/`description` 中的
```` ``` ```` 應做逃逸或改用不會被使用者輸入打斷的圍欄字元;`reportError` 若真的只想給「其他
router/管理員」用,應收緊到伺服器內部呼叫或 `adminProcedure`,並在觸發 `autoSearchForFix` 前
做速率限制。

**cluster**:injection

---

## 4.【高 HIGH】`orbVoicePreview` 是真金白銀的 ElevenLabs 呼叫,但零扣點、零專屬節流

**發現(附行號)**

```ts
// server/routers/brain.ts:731-791
orbVoicePreview: protectedProcedure
  .input(z.object({ text: z.string().min(1).max(300), voiceId: ..., modelId: ..., ... }))
  .mutation(async ({ input }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    ...
    const url = `${resolveProviderBaseUrl("elevenlabs")}/v1/text-to-speech/${input.voiceId}`;
    const res = await fetch(url, { method: "POST", headers: { "xi-api-key": apiKey, ... }, ... });
    ...
    return { audioBase64: `data:audio/mpeg;base64,${base64}`, ... };
  }),
```

`brain.ts` 全檔搜尋 `charge|deduct|refund|points|balance` **零命中**——`orbVoicePreview` 沒有
任何扣點呼叫。對照同樣呼叫 ElevenLabs TTS 的 `proStudio.ts`:

```ts
// server/routers/proStudio.ts:791 起 elevenLabsTTS
elevenLabsTTS: audioGenerationProcedure   // 10 req / 60s per user(server/_core/trpc.ts:169-174)
  .input(...)
  .mutation(async ({ ctx, input }) => {
    ...
    const charged = await chargeForFalTask(ctx.user.id, "elevenlabs/...");  // 真的扣點
    ...
  }),
```

`brain.ts` 只 `import { router, protectedProcedure, adminProcedure } from "../_core/trpc"`
(`brain.ts:10`),完全沒有引入 `audioGenerationProcedure`,所以 `orbVoicePreview` 唯一受到的節流
是掛在 `/api/`(涵蓋 `/api/trpc/*`)前綴的全站泛用 `rateLimiters.api`(300 req / 15 min,
`server/_core/rateLimiter.ts:47-53`、`server/_core/index.ts:555`),比同類付費 TTS 功能實際使用
的 `audioGenerationProcedure`(10 req/60s ≈ 150 req/15min)還要寬鬆一倍,且完全不消耗使用者
點數餘額。

**影響**:任一已登入帳號可在 15 分鐘內免費、無扣點地觸發最多約 300 次真實 ElevenLabs TTS 呼叫
(每次最長 300 字元),消耗站方 ElevenLabs 用量與費用,且完全繞過站內「生成要扣點」的計費模型。

**建議**:比照 `elevenLabsTTS` 的模式,把 `orbVoicePreview` 改掛 `audioGenerationProcedure`(或
專屬更嚴格的節流)並視產品需求決定是否扣點(即使是「預覽」也建議至少收極低點數或走更嚴格
per-user 每日上限,而非完全免費疊加全站泛用節流)。

**cluster**:billing

---

## 5.【中 MEDIUM】4 個「引擎參數」JSON 欄位可寫可讀,但全站沒有任何生成程式碼真的消費它們

**發現(附行號)**

`upsert` 接受並持久化四個模態的自訂參數:

```ts
// server/routers/brain.ts:362-365, 375-378, 388-391, 401-404
imageEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
videoEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
audioEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
voiceEngineParams: z.record(z.string(), z.unknown()).nullable().optional(),
```

`get` 也把它們原樣回傳給前端(`brain.ts:260`:`params: row ? ((row as any)[`${slot}Params`] ?? null) : null`)。
`server/middleware/brainContext.ts:719-727` 會把 DB 裡的 `*Params` 讀出並掛到
`ctx.brain.getEngine(slot).params` 上。**但對全 server 目錄搜尋 `getEngine(...)*.params` 的用法**:

```
$ grep -rn "getEngine\([^)]*\)\.params" server
server/brain-context.test.ts:210:  expect(brain.getEngine("imageEngine").params).toEqual({ steps: 50 });
```

**只有測試檔案讀取過 `.params`**——`proStudio.ts`/`videoStudio.ts`/`imageStudio.ts`/`director.ts`
等真正呼叫 Fal/生成 API 的程式碼,一律只讀 `.getEngine(slot).engine`(模型 ID 字串,見
`director.ts:1685-1688`、`proStudio.ts:839`),完全沒有任何一處讀取 `.params` 並套用到實際
生成請求。`videoStudio.ts:369` 唯一出現的同名區域變數 `params` 來自
`mapOutputSpecWithMeta(modelId, outputSpec)`,與 `videoEngineParams` 無關。

**影響**:使用者在「我的大腦」設定頁配置的自訂生成參數(如 image 的 `steps`/`cfgScale`/
`negativePrompt`,video 的 `duration`/`fps`/`motionStrength`,audio 的 `genre`/`tempo`,voice 的
`stability`/`speed`)全部寫入 DB、也能讀回顯示,製造出「這個設定有效」的錯覺,但實際生成時
**完全不會被套用**——這是一個 API 契約與實際生成行為脫鉤的死碼/假功能。

**建議**:要嘛在 `proStudio.ts`/`videoStudio.ts`/`imageStudio.ts` 的實際生成呼叫處讀取並套用
`ctx.brain.getEngine(slot).params`,要嘛(若產品已決定放棄此功能)從 `upsert`/`get` 的 schema
與前端設定 UI 中移除,避免使用者對「自訂參數」產生錯誤預期。

**cluster**:deadcode

---

## 6.【中 MEDIUM】`switchModel` 端點全站無人呼叫,且 Fal 引擎分支寫入時必定觸發 DB enum 契約違反

**發現(附行號)**

```ts
// server/routers/brain.ts:511-529 —— switchModel 明確支援 16 個 Fal 任務欄位
} else if (rawUpdateField.endsWith("Engine")) {
  const isFalTask = FAL_TASK_FIELD_ALLOWLIST.has(rawUpdateField);
  const allowedForField = isFalTask
    ? FAL_FIELD_ALLOWLISTS[rawUpdateField]
    : GENERATION_ENGINE_ALLOWLIST[...];
  if (!allowedForField || !allowedForField.has(nextModel)) {
    throw new TRPCError({ code: "BAD_REQUEST", ... });
  }
}
...
// server/routers/brain.ts:554-561 —— 交易內寫入 switch log
await tx.insert(userModelSwitchLogs).values({
  userId: ctx.user.id,
  brainSlot: input.brainSlot as InsertUserModelSwitchLog["brainSlot"],  // 純型別斷言,無執行期驗證
  fromModel: input.fromModel,
  toModel: nextModel,
  reason: input.reason ?? `手動切換 ${input.brainSlot}`,
  switchSource: input.switchSource,
});
```

但 `userModelSwitchLogs.brainSlot` 的實際 DB 型別是 **9 個值的 MySQL enum**,完全不含任何
`fal*Engine` 欄位名:

```ts
// drizzle/schema.ts:1567-1577
brainSlot: mysqlEnum("brainSlot", [
  "director", "analyst", "storyteller", "technician", "curator",
  "imageEngine", "videoEngine", "audioEngine", "voiceEngine",
]).notNull(),
```

也就是說,若呼叫 `switchModel` 時 `brainSlot` 傳入 16 個 Fal 任務欄位之一(例如
`"falTextToImageEngine"`),第 511-529 行的驗證邏輯會**判定合法並放行**,但 554-561 行的
`userModelSwitchLogs` 寫入會因 enum 不接受該值而拋出 DB 錯誤——由於整段包在
`db.transaction`(`brain.ts:535-562`)內,連同前面已成功的 `userAiBrain` 更新都會被回滾。
這條分支目前是**必定失敗的死碼**。

進一步確認可及性:

```
$ grep -rln "switchModel" client/src server --include=*.ts --include=*.tsx
server/routers/brain.ts
```

`switchModel` 全站(前端 + 後端其他檔案)**無任何呼叫方**,也沒有專屬測試——不只是 Fal 分支
死碼,整個 procedure 目前都是孤兒端點。

**影響**:若未來前端接上「切換 Fal 任務引擎」的 UI 並串接這支既有 `switchModel`,使用者每次
切換都會得到伺服器錯誤且大腦組態的更新會被回滾(使用者體驗上像「存檔失敗」),需要先修
`userModelSwitchLogs.brainSlot` enum(加入 16 個 fal 欄位名)或在寫 log 前對 Fal 分支另外分流
處理才能用。

**建議**:短期(不使用此端點前):在 PR 描述/todo 標明此已知限制,避免被誤用;中期:若要接上
Fal 引擎切換,擴充 `userModelSwitchLogs.brainSlot` enum 或改用 `varchar` + 應用層驗證;若確定
`switchModel` 本身已被 `upsert` 取代而不再需要,考慮直接移除，減少維護面。

**cluster**:deadcode

---

## 7.【中 MEDIUM】`pricingSummary` 的「上限 500 pts/次」文案與同一回應內的 catalog 資料自相矛盾

**發現(附行號)**

```ts
// server/routers/brain.ts:641-645
return {
  ...
  allPricingByCategory: ALL_PRICING_BY_CATEGORY,   // 完整 catalog,逐分類分組
  rateNote: "1 USD ≈ 100 pts(點數)。最低扣 1 pt,上限 500 pts/次。",
};
```

`ALL_PRICING_BY_CATEGORY` 來自 `getAllPricingByCategory()`(`modelPricing.ts:3486-3500`),對
`MODEL_PRICING_CATALOG` **逐一分類、不做任何過濾**。但 catalog 裡多筆條目的 `maxPoints`
明顯超過 500:

```
server/services/modelPricing.ts:540   fal-ai/sora(t2v)              maxPoints: 600
server/services/modelPricing.ts:2781  (查得 800)
server/services/modelPricing.ts:2029  fal-ai/turbo-flux-trainer     maxPoints: 1000
server/services/modelPricing.ts:1969  fal-ai/sd3-lora-training      maxPoints: 1500
server/services/modelPricing.ts:1923  ...LoRA 訓練類                maxPoints: 2000
server/services/modelPricing.ts:1939/2014  ...                      maxPoints: 2500(×2)
server/services/modelPricing.ts:1954  fal-ai/dreambooth-flux        maxPoints: 3000
server/services/modelPricing.ts:1999  fal-ai/hunyuan-video-lora-training maxPoints: 4000
server/services/modelPricing.ts:1984  fal-ai/cogvideox-lora-training maxPoints: 5000
```

`estimatePoints()`(`modelPricing.ts:3268` 起)在計算完 base/加乘後,是 clamp 到
**每個模型自己的** `[minPoints, maxPoints]`,而不是任何全站統一的 500 常數
(全 `server/` 目錄搜尋不到 `扣除上限`/`deductionCap`/`spendCap` 一類的獨立 500 硬上限守門
邏輯)。`pricingSummary` 回傳的同一個 JSON 物件裡,`allPricingByCategory.training` 分類下就能
直接看到 `maxPoints: 5000` 的條目,與同物件的 `rateNote` 聲稱的「上限 500 pts/次」字面矛盾。

**影響**:這是暴露給前端 Studio 頁面(「本次生成預估費用」)的文案,若使用者依此文案理解
「單次生成最多扣 500 點」,實際上（假設真正的扣點邏輯——不在本檔驗證——確實依 catalog 的
`maxPoints` clamp)LoRA 訓練類操作可能被扣到數千點,造成計費預期落差。真正的扣點/防護邏輯落在
`proStudio.ts` 的 `chargeForFalTask` 等函式,是否在扣點當下另外套用了一個真正的 500 硬上限,
**未在本檔驗證**;但至少可以確認:`brain.ts` 自己回傳的靜態文案與自己回傳的 catalog 資料
在字面上互相矛盾。

**建議**:若 500 只是「一般生成」的典型上限,`rateNote` 應該加註排除訓練/長影片類別,或把
文案改成動態依 `allPricingByCategory` 算出的真實最大值,而不是寫死一個與同一 payload 內數據
不符的常數。

**cluster**:billing

---

## 8.【中 MEDIUM】`upsert` 的 check-then-act 沒有交易保護,與 `switchModel` 的作法不一致

**發現(附行號)**

```ts
// server/routers/brain.ts:450-467 —— 沒有 db.transaction 包裹
const existing = await db
  .select({ id: userAiBrain.id })
  .from(userAiBrain)
  .where(eq(userAiBrain.userId, ctx.user.id))
  .limit(1);

if (existing.length > 0) {
  await db.update(userAiBrain).set(updateSet).where(eq(userAiBrain.userId, ctx.user.id));
} else {
  await db.insert(userAiBrain).values({ userId: ctx.user.id, ...updateSet } as any);
}
```

對照 `switchModel` 對**結構完全相同**的 check-then-act 明確用 `db.transaction` 包裹,並在註解
中說明理由(`brain.ts:533-534`):「兩段寫入包成單一交易…任一步驟失敗時整個交易回滾,不留孤兒
日誌或不一致狀態」。`upsert` 雖然只有單一寫入目標(沒有 switchModel 那樣的雙表寫入),但
select-then-branch 本身仍是傳統的 TOCTOU:同一使用者兩個併發請求(如雙分頁、重複提交)都可能
在各自事務外读到 `existing.length === 0`,雙雙嘗試 `insert`,其中一個會因
`userAiBrain.userId` 的 `.unique()` 約束（`drizzle/schema.ts:1339`）而失敗。

**影響**:最壞情況是併發下其中一個請求收到未預期的 DB 唯一鍵衝突錯誤(而非資料損毀,因為
unique 約束兜底),使用者體感是「儲存失敗」需要重試;不是資料一致性災難,但與同檔案內
`switchModel` 已經展示過的「該包 transaction 就包」的最佳實踐不一致。

**建議**:比照 `switchModel`,把 `upsert` 的 select-then-branch 也包進 `db.transaction`,或改用
MySQL 原生 `INSERT ... ON DUPLICATE KEY UPDATE`(drizzle 的 upsert helper)消除競態視窗。

**cluster**:persistence

---

## 9.【中 MEDIUM】5 個 systemPrompt 欄位沒有長度上限,與檔案內其餘文字欄位的驗證慣例不一致

**發現(附行號)**

```ts
// server/routers/brain.ts:307,318,329,340,351
directorSystemPrompt: z.string().nullable().optional(),
analystSystemPrompt: z.string().nullable().optional(),
storytellerSystemPrompt: z.string().nullable().optional(),
technicianSystemPrompt: z.string().nullable().optional(),
curatorSystemPrompt: z.string().nullable().optional(),
```

同一份 `upsert` schema 裡,其餘所有自由文字欄位都有明確 `.max()`:例如
`createProposal.description` 最長 8000(`brain.ts:995`)、`codeSnippet` 最長 2000
(`brain.ts:1006`)、`reportError.prompt`/`errorMessage` 最長 2000(`brain.ts:934-935`)。唯獨
5 個 `*SystemPrompt` 欄位完全沒有長度限制,對應 DB 欄位是 `text()`(`drizzle/schema.ts:1356`
等,MySQL TEXT 最大 64KB)。

**影響**:使用者可寫入任意長度(受限於 tRPC/express body size,`express.json({ limit: "4mb" })`,
`server/_core/index.ts:977`)的自訂 system prompt,一次寫入即可逼近該上限,對 DB 欄位造成儲存
壓力;若這些 `systemPrompt` 之後被原樣組進實際 LLM 呼叫的 system message(該消費路徑本檔案
未涵蓋、**未在本檔驗證**),缺乏長度與內容守門本身就是一個潛在的、使用者可完全覆寫 AI
人格系統提示的注入面。

**建議**:比照檔案內其他文字欄位的慣例,為 5 個 `*SystemPrompt` 補上合理的 `.max()`(例如
2000–4000 字),並在實際消費處(brainContext / 對應 LLM 呼叫)確認有做基本的內容過濾。

**cluster**:injection

---

## 已驗證排除的疑慮(negative results)

- **`get`/`upsert`/`switchModel`/`pricingSummary` 沒有 IDOR**:四個「使用者自己的大腦組態」
  端點全部正確用 `eq(userAiBrain.userId, ctx.user.id)` 做查詢/更新條件(`brain.ts:204,454,461,
  539,546,590`),沒有讓 client 帶入他人 `userId` 的參數,不存在傳統「用 id 取他人資源」式 IDOR。
- **`adminProcedure` 本身沒有繞過漏洞**:`server/_core/trpc.ts:65-77` 的 `adminProcedure`
  中介層確實會檢查 `isAdmin(ctx.user.role)` 並在非 admin 時丟 `FORBIDDEN`,本檔案內掛
  `adminProcedure` 的 14 個 mutation/query(`dismissAlert`、`resolveError`、`approveProposal`、
  `rejectProposal`、`addResearchToLearnHub`、`runAccuracyTest`、`runAllAccuracyTests`、
  `runFullSiteResearch`、`runCodeScan`、`lastCodeScan`、`githubConfigStatus`、
  `testGithubConnection`、`retryGithubIssue`、`toggleAutoRepair`、`setMonitorInterval`)沒有
  發現繞過方式。
- **`switchModel` 的 DB 寫入有交易保護**:`brain.ts:535-562` 用 `db.transaction` 包住「大腦組態
  更新」與「切換日誌寫入」兩段寫入,任一步驟失敗會整個回滾,不會留下孤兒日誌或不一致狀態
  ——這是本檔案內值得參考的正確模式(可惜沒有同樣套用到發現 8 的 `upsert`)。
- **`githubConfigStatus` 沒有洩漏真實 token**:回傳只有 `hasToken: Boolean(serverEnv.GITHUB_TOKEN)`
  等布林/字串中繼資訊(`server/services/githubIssueClient.ts:136-156`),不會把
  `GITHUB_TOKEN` 原始值送回前端。
- **`orbVoicePreview`/`pingProviders` 沒有把 API Key 回傳給前端**:`ELEVENLABS_API_KEY`/
  `GEMINI_API_KEY`/`FAL_API_KEY` 只在伺服器端組 header/URL 呼叫第三方(`brain.ts:743-857`),
  回應物件裡只有 `audioBase64`/`latencyMs`/`ok`/`error`,沒有任何一處把金鑰值寫回 response——
  符合檔案開頭「不暴露任何 API Key」的宣告。
- **模型/引擎白名單驗證一致**:`upsert`/`switchModel` 對模型 ID 一律透過
  `REASONING_MODEL_ALLOWLIST`/`GENERATION_ENGINE_ALLOWLIST`/`FAL_FIELD_ALLOWLISTS` 做
  `.refine()` 或執行期比對(`brain.ts:298-422,499-529`),沒有發現可以繞過白名單寫入任意模型
  字串到 DB 的路徑(發現 6 的 Fal-enum 契約不符是「合法值仍然失敗」,不是「非法值被接受」)。
- **靜態 payload 只算一次,無效能疑慮**:`STATIC_CATALOG_PAYLOAD`(`brain.ts:159-188`)與
  `ALL_PRICING_BY_CATEGORY`(`brain.ts:152`)都在模組載入時 `Object.freeze()` 算好一次,而非
  每次請求重算,是合理的效能實踐,不構成發現。
- **`webSearch`/`accuracyTests`/`researchResults` 沒有發現金鑰外洩**:`webSearch` mutation
  (`brain.ts:1062-1071`)呼叫的 Brave/Perplexity API key 只在伺服器端使用,回應內容只有搜尋
  結果的 `title`/`summary`/`url`,沒有把金鑰或原始上游回應體回傳給前端。

## 未在本檔驗證(留待其他檔案/波次)

- `imageEngineParams` 等欄位「應該」被套用到哪個生成呼叫、以及是否真的完全不會被使用(除了
  grep 到的 0 筆生產程式碼引用外)是否有透過其他未被本次搜尋涵蓋的路徑(如動態 key 存取)間接
  消費,未做進一步的執行期驗證。
- `directorSystemPrompt` 等欄位在 `director.ts`(或其他呼叫 LLM 的 router)內究竟如何被組進
  system message、是否有額外的內容過濾層,不在本檔案範圍。
- 發現 7 提到的「單筆扣點是否真的有一個獨立於 catalog `maxPoints` 之外的全站 500 硬上限」,
  真正的扣點/防護邏輯在 `proStudio.ts` 的 `chargeForFalTask` 等函式,未在本檔驗證。
- `costAnalytics.ts`/`modelPricing.ts` catalog 本身的定價公式正確性已由 X3 深挖,本文件不重複。
- `brainAutoRepair.ts` 服務層本身的 fal 級聯故障放大、`autoSearchForFix` 缺 dedupKey 等問題已由
  U4 深挖,本文件不重複。
