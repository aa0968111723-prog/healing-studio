# GC4 — RAG授權矩陣 + spiritRouter 深挖
- 產生日期:2026-07-03
- 依據 commit:812fdb
- 稽核檔案:server/services/teachingArchiveRag.ts、server/services/teachingArchiveAccess.ts、server/routers/spiritRouter.ts

---

## 0. 範圍與方法

本輪逐行讀完三支指定檔案全文。為追完「發現→影響」因果鏈與完成任務指定的交叉比對
（對照 X9 的 `realEarth.getLinkedMaterials` 繞過案例、對照 X3 的 `spiritRouter→falDispatcher`
計費鏈、對照 G3 的精靈工具可達性 gate），額外讀了以下輔助檔案佐證（非本輪主稽核對象，
凡引用皆標「輔助檔案」）：`server/routers/teachingArchive.ts`、`server/routers/realEarth.ts`、
`server/services/teachingArchiveSearch.ts`、`server/services/spiritDispatcher.ts`、
`server/services/falDispatcher.ts`、`server/services/falModels.ts`、`server/_core/trpc.ts`、
`server/_core/rateLimiter.ts`、`server/_core/index.ts`、`server/services/spiritTools/planExecutorTools.ts`、
`server/subsystems/contextPackets/contextPacketService.ts`、
`server/subsystems/contextPackets/adapters/teamDataAdapter.ts`、
`server/subsystems/contextPackets/contracts.ts`、`server/services/security/ragInjectionGuard.ts`、
`server/subsystems/trainingTrack/trainingTrackService.ts`、`server/subsystems/trainingTrack/trainingTrackRouter.ts`、
`server/db.ts`（對應函式）、`server/services/__tests__/teachingArchiveAccess.test.ts`。

判斷基準：實際程式碼為準，行號與片段皆逐一核對後才寫入；無法在本檔驗證的一律寫
「未在本檔驗證」，不臆測。已知既有稽核文件（X9、X3、G3、X11、W9）視為背景，本輪只在
其上新增未被涵蓋的具體發現，並對已知發現做「現況仍成立」的複核。

---

## 1. 發現（依嚴重度排序）

### 🔴 CRITICAL（複核既有發現，非本輪新發現）— `realEarth.getLinkedMaterials` 完全繞過 teachingArchiveAccess 三層授權矩陣

**Cluster**：security-idor

**發現**

`teachingArchiveAccess.ts` 本身的三層矩陣（`loadMaterialForRead`:43-81、`loadMaterialForWrite`:87-137）
定義嚴謹：owner 永遠可讀寫、`team_shared` 需 `db.getTeamMembership` 真查驗（讀/寫皆放行任何角色，
寫入的「任何角色皆可改」是檔頭 12-16 行明文的設計選擇並有單元測試鎖定，見下方 negative results）、
`public_disciples` 讀取全 workspace 開放、寫入僅 owner 或該 team 的 owner/admin（116-131 行）。
`teachingArchive.ts` 自身的 9 個入口（`get`/`update`/`delete`/`triggerIngestion`/`accessLog`/`logView`/
`linkRealEarthEntry`/`unlinkRealEarthEntry`/`getRealEarthLinks`）也**全部**正確呼叫這兩個函式。

但 `server/routers/realEarth.ts:294-300` 的 `getLinkedMaterials` 完全不呼叫
`teachingArchiveAccess.ts` 的任何函式，直接呼叫 `db.findTeachingMaterialsByRealEarthRef`
(`server/db.ts:5192-5208`，輔助檔案，本輪重新核對現行行號仍一致)：

```ts
// server/db.ts:5199-5205（本輪重新核對，行號/內容與 X9 記錄一致）
const rows = await db
  .select()                      // 全欄位，無 column projection
  .from(teachingMaterials)
  .where(
    sql`JSON_CONTAINS(${teachingMaterials.realEarthRefs}, ${JSON.stringify(realEarthId)})`
  )
  .orderBy(desc(teachingMaterials.createdAt));
```

查詢條件只有 `JSON_CONTAINS(realEarthRefs, id)`，不帶 `userId`/`teamId`/`visibility` 任何過濾，
`db.select()` 回傳整列（含 `textContent` 完整逐字稿、`fileUrl`/`fileKey`）。`real_earth_entries`
本身是全 workspace 可讀的公開知識庫（`realEarth.list`/`get`/`search` 皆 `protectedProcedure` 無
visibility 限制），任何登入使用者都能枚舉 `realEarthId`；只要**任一使用者**曾把自己的
`private` 教材透過 `teachingArchive.linkRealEarthEntry` 連到某條目，**任何其他使用者**呼叫
`realEarth.getLinkedMaterials({ id })` 就能拿到該私有教材全文，完全繞過本輪主稽核對象
`teachingArchiveAccess.ts` 的三層矩陣。前端目前無消費端呼叫此 procedure，但 tRPC procedure
本身即是可直接呼叫的 API 端點，不因 UI 未接線而不成立。

此發現與根因、程式碼片段、行號與 `docs/research/X9-own-database-rag-deepdive.md` §1 第一則
完全一致，本輪視為**已確認、現況未修復**，未發現任何緩解措施新增。

**影響**：使用者 A 的私有靈修筆記/教材全文（含原始檔案 URL/Key）可被與 A 無任何團隊關係的
使用者 B 直接讀取，是本輪三支目標檔案所建立的授權矩陣被同套系統內另一支路由器繞過的具體案例。

**建議**（與 X9 一致，本輪未提出新方案）：`findTeachingMaterialsByRealEarthRef` 加
`requestingUserId`/`teamIds` 參數並套用與 `getVisibleTeachingMaterialsByIds`
(`server/db.ts:4225-4250`) 相同的 visibility OR 條件；`getLinkedMaterials` 改用 column
projection，不回傳 `textContent`/`fileUrl`/`fileKey`。

---

### 🟠 HIGH（本輪新發現）— `spiritRouter.ts` 全部 9 個端點都只用 `protectedProcedure`，`spirit.invoke` 真實計費呼叫完全不受任何生成速率限制／並發上限保護

**Cluster**：billing

**發現**

`spiritRouter.ts:1-226` 全部端點（`listModels`/`invoke`/`plan`/`run`/`status`/`control`/`replan`/
`listRuns`/`runStep`）都宣告為 `protectedProcedure`（例如 `invoke`:100-108、`plan`:126-142、
`run`:144-165）。`server/_core/trpc.ts:67` 顯示 `protectedProcedure = t.procedure.use(requireUser)`
——只驗證登入，**不含任何速率限制中介層**。

對照同一支 `trpc.ts` 為「真實會打付費第三方 API」的生成端點特別建的三道速率限制：

```ts
// server/_core/trpc.ts:162-166
const requireGenerationLimit = t.middleware(async ({ ctx, next }) => {
  checkTrpcRateLimit(ctx.user.id, { limit: 5, windowMs: 60_000, label: "gen" }, ctx.res);
  ...
});
// :171-175 requireAudioGenerationLimit → 10 req/60s
// :190-233 requireVideoStudioLimit → 50/hr + 200/day + 單人 5 個/全站 20 個併發影片 job 上限
export const generationProcedure = brainProcedure.use(requireGenerationLimit);       // :180
export const audioGenerationProcedure = brainProcedure.use(requireAudioGenerationLimit); // :182
export const videoGenerationProcedure = generationProcedure.use(requireVideoStudioLimit); // :239
```

`imageStudio.ts`、`videoStudio.ts`、`proStudio.ts` 的每一個真實生成 mutation 都掛
`generationProcedure`/`videoGenerationProcedure`/`audioGenerationProcedure`（本輪逐一 grep 確認：
imageStudio.ts 22 處、videoStudio.ts 21 處、proStudio.ts 5 處皆為上述三種procedure之一，
無一使用裸 `protectedProcedure`）。`requireVideoStudioLimit` 的程式碼註解（AIDV-242/294/327）
明講理由：「GPU cost per call ($0.05–$0.5) 遠高於文字/圖片」，且特別設了併發 job 上限防「單一
使用者排隊無上限 GPU 任務」與「全站 GPU 耗盡」。

但 `spirit.invoke` → `invokeSpiritModel`（`spiritDispatcher.ts:117-208`，輔助檔案）→
`dispatchFalTask`（`falDispatcher.ts`，輔助檔案）是**同一套** fal.ai 真實呼叫 + 真實扣點路徑
（`falDispatcher.ts:481-484`、`619-622` 呼叫 `reconcileCredits`/`deductCredits`，與
`videoStudio`/`imageStudio`/`proStudio` 底層共用同一個 `dispatchFalTask`/`orbCostGuard.ts`），
而且 `canSpiritCallFalModel`（`falModels.ts`，輔助檔案）授權的類別涵蓋 image/video/audio/voice/
training 全部類別（依精靈而異，見 G3 §2.1 fal 類別白名單欄）——包含 `videoGenerationProcedure`
特別設限的「影片/GPU 密集」類別本身。`falDispatcher.ts`、`orbCostGuard.ts` 全文 grep
`RateLimit`/`rateLimit`/`throttle`/`concurrency` 均 0 命中，確認**這條真實計費路徑本身完全沒有
速率限制或並發上限**，唯一的保護只剩 `spiritRouter.ts` 的 `protectedProcedure`。

（誠實補充：`server/_core/index.ts:555` 有 `app.use("/api/", rateLimiters.api)` 這條全站
`/api/` 前綴的通用限流——300 req / 15 min，登入時以 `user:<id>` 為 key（`rateLimiter.ts` 的
`buildRateLimitKey`），會涵蓋掛在 `/api/trpc`（`_core/index.ts:977`）之下的 `spirit.invoke`。
但這條通用限制遠鬆於專屬限制：300/15min ≈ 20 req/min 穩定速率，仍是 `videoGenerationProcedure`
5/min 共享桶的 4 倍、且完全沒有 50/hr、200/day、單人 5 個／全站 20 個併發影片 job 這幾層
GPU 專屬防護。也就是說並非「零保護」，而是「精心設計的多層 GPU 成本防護被降級成單一鬆散的
通用 API 防濫用閾值」。）

`spirit.plan`/`spirit.replan` 同樣值得注意：這兩個入口直接呼叫 `agentPlanner`（LLM 呼叫，
輔助檔案 `agentPlanner.ts`，本輪未逐行核對其內部but 由檔頭文件與 G3 交叉確認為
「唯一打 LLM 的 director 工具」同款直呼模式），對照 `aiChatProcedure`（`trpc.ts:178`，
20 req/60s 專為「director.chat / LLM 規劃」呼叫設的限制），`spirit.plan`/`spirit.replan`
同樣只掛 `protectedProcedure`，不受這個既有 LLM 呼叫限制保護。

**影響**

1. 任一登入使用者可對 `trpc.spirit.invoke({ spirit: "video-specialist", modelId: ..., prompt })`
   之類的呼叫發起遠高於 `videoStudio` 專屬限制允許的請求速率（受限於鬆散的全站 300/15min，
   而非影片類別特別設計的 5/min + 50/hr + 200/day + 併發上限），造成真實 GPU 成本的
   cost-DoS，且正是 `requireVideoStudioLimit` 註解明講要防的那個攻擊面（GPU 叢集耗盡、
   單人佇列無上限任務），但透過 `spirit.invoke` 這條平行路徑完全繞過。
2. `spirit.invoke` 真實扣點（`deductCredits`/`reconcileCredits`）與 `imageStudio`/`videoStudio`/
   `proStudio` 是同一套機制，代表這不是「另一套未串接計費的死路」而是「真的會花使用者與站方
   的錢，卻沒有姊妹端點享有的節流保護」——是本輪任務要求對照的 X3
   （`spiritRouter→falDispatcher`）計費鏈中，計費本身邏輯正確、但**存取速率**這個維度缺口。
3. `spirit.plan`/`spirit.replan` 直呼 LLM 卻不受 `aiChatProcedure` 的 20/min 保護，是同一類問題
   在推理成本（而非生成成本）上的對應版本。

**建議**

1. 為 `spirit.invoke` 套用 `videoGenerationProcedure`（或依 `modelConfig.category` 動態選用
   `generationProcedure`/`audioGenerationProcedure`/`videoGenerationProcedure`，若要精確區分
   類別需要在中介層之前先查表，可考慮把類別判斷提前或改用一個新的、涵蓋所有 fal 類別的
   `spiritGenerationProcedure`）。
2. 為 `spirit.plan`/`spirit.replan` 套用 `aiChatProcedure`。
3. 若短期不便重構 procedure 型別鏈（`invoke` 目前直接吃 `ctx.user.id`，不需要
   `ctx.brain`，套用 `generationProcedure` 需要接受 `brainProcedure` 的額外開銷），至少應在
   `invokeSpiritModel`/`spiritRouter.invoke` 內部手動呼叫一次
   `checkTrpcRateLimit(ctx.user.id, { limit: 5, windowMs: 60_000, label: "gen" })`
   等同等效節流，避免使用者透過「@精靈聊天」這條「活路」（G3 用語）繞過工作室頁面的既有防護。

---

### 🟡 MEDIUM（本輪新發現，延伸 X9 已知模式）— `teachingArchive.delete` 的文件承諾（僅 owner/團隊管理員）與實際授權（team_shared 任何角色皆可刪）不一致

**Cluster**：contract-mismatch

**發現**

`teachingArchive.ts:363` 的註解：

```ts
/** 刪除資料（owner 或團隊管理員可刪；僅刪 metadata，S3 物件保留） */
delete: protectedProcedure
  ...
  .mutation(async ({ ctx, input }) => {
    const { material } = await loadMaterialForWrite(input.id, { userId: ctx.user.id });
    ...
    await db.deleteTeachingMaterial(input.id);
```

`delete` 呼叫的是 `loadMaterialForWrite`（本輪主稽核對象 `teachingArchiveAccess.ts:87-137`），
其 `team_shared` 分支（105-114 行）對「任何角色」的團隊成員一律放行（檔頭 12-16 行明文
這是刻意設計：「團隊池內所有成員都能編輯彼此的素材」），並不要求 `role === "owner" || "admin"`。
也就是說：一個剛加入團隊、角色是最低權限 `member` 的使用者，可以**永久刪除**同團隊
`team_shared` 教材（`db.deleteTeachingMaterial` 是硬刪除 metadata row，`fileUrl`/`fileKey`
指向的實體檔案雖保留但 DB 記錄不可逆消失），與註解宣稱的「owner 或團隊管理員可刪」矛盾。

這與 `docs/research/X9-own-database-rag-deepdive.md` 已抓到的 `accessLog`（:389-392 註解
「只有 owner 或團隊管理員看得到」但同樣沿用 `loadMaterialForWrite` 因而任何成員可見）是
**同一種**文件/實作落差模式，本輪在 `delete` procedure 上找到第二個實例，代表這不是單一
筆誤而是 `teachingArchive.ts` 內對「team_shared 任何角色皆可寫」這個設計選擇在多處註解裡
被反覆低估／忘記的系統性文件債。

**影響**

- 團隊擁有者若依照程式碼註解的字面意思，誤以為只有自己或 admin 能刪除團隊素材，可能對
  「member 也能刪」毫無防備——刪除是不可逆操作（相較於 accessLog 只是資訊揭露層級），
  風險層級更高：一個心懷不滿或誤操作的一般成員可以刪光整個團隊池的教材 metadata。
- 後續開發者若依照這兩處錯誤註解「修正」程式碼去限制成 owner/admin-only，會意外**破壞**
  檔頭 12-16 行明文的既有設計意圖；反之若依照 `teachingArchiveAccess.ts` 的真實行為去理解
  `delete`，則現有 UI/文件對使用者的權限說明是誤導的。兩種修復方向互相矛盾，凸顯這處文件債
  需要先由產品/工程共同拍板「team_shared 的刪除權限到底該不該收斂到 admin-only」，而非各自
  按字面修正。

**建議**

- 若「任何成員皆可刪」是最終設計意圖：把 `delete` 與 `accessLog` 這兩處註解都改成與
  `update` 一致的措辭（如 `update` 註解「owner / 同隊成員 / 團隊管理員可改」，準確反映
  `loadMaterialForWrite` 行為）。
- 若刪除操作理應比一般編輯更嚴格：在 `delete` procedure 內對 `team_shared` 素材額外檢查
  `membership.role === "owner" || "admin"`（不修改 `loadMaterialForWrite` 本身，避免動到
  `update` 等其他呼叫端的既有行為），並補一則單元測試鎖住這個更嚴格的刪除門檻。

---

### 🟡 MEDIUM（本輪新發現，跨檔案綜合）— RAG 注入防護模型把 `team_data`（教材庫）列為「受信任」不做 sanitize，其信任假設的根基已被 X9 證明不成立；目前尚未流向任何 LLM prompt，屬潛伏而非現行風險

**Cluster**：injection

**發現**

`server/subsystems/contextPackets/contracts.ts:8-22` 的安全不變量明文：「`kind !== "team_data"`
的來源內容一律視為 untrusted...team_data 受信任不過 guard」；`contextPacketService.ts:133-144`
的 `sanitizeUntrustedRefs` 實作與此一致——`kind === "team_data"`（即本輪主稽核對象
`teachingArchiveRag.ts`/`teachingArchiveSearch.ts` 檢索出的教材）**直接跳過**
`sanitizeContextPacketField`（`ragInjectionGuard.ts` 的提示注入中和函式），Drive/Notion 等
外部來源才會被中和。這個「team_data 天生可信」的假設，建立在「teaching_materials 的內容是
團隊自己上傳、可信賴」這個前提上。

但本輪任務要求交叉對照的 `docs/research/X9-own-database-rag-deepdive.md` 已用 HIGH 嚴重度
證明這個前提不成立：`teachingArchive.create`/`update`（輔助檔案）對 `visibility:"public_disciples"`
（全 workspace 公開）**沒有任何角色門檻**——任何剛註冊的普通帳號都能自由填寫 `textContent`、
`speaker`（可冒名任何講者，無白名單）、`lineage` 並立即讓內容進入教材庫。`team_shared` 一樣
只需要是該 team 的任何角色成員（見本文件前一則發現）即可寫入。也就是說「team_data 內容可信」
與「team_data 的作者身分/內容真實性完全不受控」這兩個假設同時成立於同一套系統，形成隱性
依賴斷裂：RAG 注入防護的信任邊界劃分（team_data vs 外部來源）與教材庫本身的內容管控現況
（任何登入者皆可自由發佈）並不對齊。

本輪同時獨立核對了「這是否已是現行可觸發的注入風險」——`contracts.ts:19-22` 與
`ragInjectionGuard.ts:32-38`（檔內文件）都明文記載：`summaryMarkdown`/`sourceRefs`
（`teamDataAdapter.ts` 產出、`contextPacketService.compileProjectContextPacket` 組裝）
**目前只進 UI**（`TeamDataSourcesPanel`/`teamDataSummary`），本輪追蹤其唯一下游消費端
`getProjectContextSummary`（`projectContextService.ts:115-169`，輔助檔案）確認它只是
`creativeProject.ts:157` 的一個**查詢型** tRPC 端點回傳值，在 `costarService.ts`/
`scriptGenerationService.ts`/`planningService.ts`（ragInjectionGuard.ts 檔頭列出的三條
「已接線」LLM 注入點）grep `teamData`/`contextPacket`/`ProjectContextSummary` 均 0 命中——
確認目前**沒有**任何路徑把教材庫檢索內容送進 LLM system prompt。與 X9 negative result #8
（`teachingArchive.search` 的 snippet 只進 `OrbSearchCard` UI、不進 LLM prompt）是同一個結論
在不同下游消費端（`agentToolExecutor` 的 search case vs `contextPacketService` 的
context packet）上的獨立複核，兩條路徑目前都不構成間接提示注入。

**影響**

- 現況：不構成可利用的注入漏洞（negative result，見下方彙整）。
- 潛伏風險：`contracts.ts:19-22` 自己也承認這只是「暫時如此」（"⏳ fence：...未來若新增
  『進 LLM prompt』的真實路徑，才於該注入點改呼叫 guardRetrievedContext"）。一旦未來有人
  依 `TODO(training-track)`（`contextPacketService.ts:178`：「之後可在此把 deterministic 拼接
  換成 cheap-LLM 摘要」）或任何其他理由把 `summaryMarkdown`/`sourceRefs` 接進真正的 LLM
  prompt，`sanitizeUntrustedRefs` 對 `team_data` 的「跳過」邏輯不會自動變嚴格——而屆時教材庫
  內容的作者仍然是「任何登入者皆可自由填寫」（X9 HIGH 尚未修復），兩個問題疊加就會變成真正
  可利用的間接提示注入（惡意使用者發佈一則含注入樣式的 `public_disciples`「開示」，等待
  某天 team_data 被接進生成 prompt 後生效）。這是一個「今天安全、修復 X9 之前都不該掉以輕心」
  的耦合風險，值得在修 X9 時一併評估是否要提前把 `team_data` 也納入 sanitize（哪怕暫不 fence）。

**建議**

1. 短期：在 `sanitizeUntrustedRefs` 的 `team_data` 分支旁補一則顯眼註解，指向 X9 的
   `public_disciples`/`team_shared` 無角色門檻發現，明確記錄「此信任假設的前提尚未成立」，
   避免未來有人在不知情下把 `summaryMarkdown` 接進 LLM prompt 時漏掉這個依賴。
2. 中期：待 X9 的「`public_disciples` 需角色門檻或審核佇列」修復後，此信任假設才真正成立；
   在那之前，若要提前防禦，可考慮讓 `team_data` 也走 `sanitizeContextPacketField`（neutralize
   only、不 fence，維持 `contracts.ts` 現有「不誤包」鐵則），把「信任」降級為「至少中和」。

---

### 🟢 LOW（跨參考 G3，負向結果為主，附帶一個小缺口）— `spirit.invoke` 是精靈唯一確定可達的生成路徑，但 M15 輸入必要性檢查未涵蓋 training 類別

**Cluster**：other

**發現**

對照 `docs/research/G3-orb-tools-spirits.md` 的核心結論（`agentToolExecutor.ts` 的 194 個工具
case 中僅 37 個可達，178 個精靈專屬工具因 gate 前綴問題「入口不通」），本輪確認
`spiritRouter.invoke` 是 G3 §2.1 表格標註的「活路」之一：它不經過 `executeOrbToolCalls`／
`dispatchStudioTool` 那套 gate，而是 `spiritRouter.ts:100-108` 直接呼叫
`spiritDispatcher.invokeSpiritModel`（`spiritDispatcher.ts:117-208`）→
`canSpiritCallFalModel` 類別白名單檢查（186-199 行）→ `dispatchFalTask`（202-207 行）。
這條路徑不受「178 個孤兒工具」問題影響，是 G3 所述「圖圖只能打圖」模態限制真正生效之處
（`canSpiritCallFalModel` 而非 executor 的字串前綴 gate）。**這是負向結果**：`spirit.invoke`
本身可達性與模態授權設計正確、與 spiritRouter.ts 檔頭「授權雙保險」的自述（Step 2 授權檢查
+ dispatchFalTask 內再檢查一次）一致。

順帶發現一個小缺口：`spiritDispatcher.ts:89-115` 的 `describeRequiredInputForCategory`
（M15 fail-fast，防止「聲聲被要求 voice cloning 卻沒帶 audioUrl」這類使用者體驗問題）
明確只覆蓋 `image-to-*`/`video-to-*`/`audio-to-text` 三種 category，113 行註解自陳
「training 與其他 *-to-* 都另有路徑，目前不在這個 dispatcher 走，先不加」。但實際上
`falDispatcher.ts:915-930` 的 `dispatchLoRATraining` 與 `spiritDispatcher.invokeSpiritModel`
底層都走同一個泛用 `dispatchFalTask`（`category: "training"` 一樣可以被
`canSpiritCallFalModel` 放行、被 `spirit.invoke` 呼叫到，見練練 training-specialist 的 fal
類別白名單），意味著若練練透過 `spirit.invoke` 被呼叫但呼叫端沒帶 `imageUrl`（LoRA 訓練通常
需要參考圖片），不會走 M15 的友善 fail-fast，而是直接送進 `dispatchFalTask`、很可能在
fal.ai 端收到 422 之類的原始錯誤。**本輪未進一步驗證** training 類別呼叫 `dispatchFalTask`
的完整成功路徑（是否真的需要同步等待完成、`timeoutMs` 是否足夠訓練這類長時間任務），
標記為「未在本檔驗證」，不列入結構化嚴重度統計，僅供後續稽核參考。

**影響**：極小——僅影響「練練透過 @聊天做 LoRA 訓練且忘記附圖」時的錯誤訊息友善度，
不是安全或計費問題。

**建議**：若確認 training 類別確實會被 `spirit.invoke` 呼叫到，於
`describeRequiredInputForCategory` 補一個 `category === "training"` 分支要求 `imageUrl`。

---

## 2. 已驗證排除的疑慮（Negative Results）

以下是本輪針對「授權矩陣嚴謹性 / 跨租戶洩漏 / RAG 注入 / 計費授權 / 精靈可達性」逐一查證後
**確認未發現問題**的項目：

1. **`teachingArchiveAccess.ts` 的三層矩陣本身定義嚴謹且有單元測試鎖定**：
   `server/services/__tests__/teachingArchiveAccess.test.ts` 完整覆蓋 owner/team_shared
   （member 與 admin 兩種角色）/public_disciples 六種讀寫組合，包括「team_shared 一般成員
   可寫（設計選擇）」與「public_disciples 即使是 team 成員、非 admin 也不可寫」兩個容易
   搞錯的邊界案例，測試斷言與本輪逐行讀碼的理解完全一致，未發現矩陣定義本身的邏輯漏洞。

2. **向量檢索（`teachingArchiveRag.ts`）不會造成跨租戶洩漏**：`upsertTeachingMaterialVectors`
   用**素材擁有者**的 `userId` 分 Pinecone namespace（:102 `namespaceForUser(material.userId)`），
   `queryTeachingArchiveVectors` 用**搜尋者自己**的 `userId` 查詢（:192），兩者不對稱是
   `teachingArchiveSearch.ts`/X9 已指出的「team_shared 對隊友向量搜尋不可見」northstar 級別
   體驗缺口（本輪確認現況未變、仍成立，非新發現），但反過來看，這個不對稱設計的副作用是
   **搜尋者永遠只能查到自己 namespace 裡的向量**（即自己上傳的素材），不可能因為命名空間
   誤配置而查到別人的私有教材向量——本輪未發現任何跨使用者向量污染的路徑。`searchTeachingArchive`
   （輔助檔案）在向量命中後還會再過 `getVisibleTeachingMaterialsByIds`（`db.ts:4225-4250`）
   套用 visibility OR 條件做第二層防禦，即使未來 namespace 設計改變，這層 defense-in-depth
   仍在。

3. **`teamDataAdapter.ts`（`contextPacketService` 的內部素材 adapter）對 `teachingArchiveSearch`
   的結果做了 defense-in-depth**：先呼叫已內建可見性過濾的 `searchTeachingArchive`，再逐筆
   重新呼叫本輪主稽核對象 `loadMaterialForRead`（`teamDataAdapter.ts:94`），確認「理論上
   search 已過濾，但仍再驗一次」的雙重檢查確實存在於程式碼中，不是文件空談。

4. **`trainingTrackService.collectTeamTrainingImages`（讀取 `team_shared` 圖片教材給團隊
   LoRA 訓練用）在呼叫前一定先驗證團隊成員身分**：`previewTeamTrainingDataset`（:130）與
   `startTeamModelTraining`（:159，要求 owner/admin）皆先呼叫 `assertTeamMember`/
   `assertTeamAdmin`，函式本身文件宣稱「caller 需先驗成員身分」在實際呼叫端確實兌現，
   不構成繞過三層矩陣的路徑。

5. **`spiritRouter.plan`/`run`/`status`/`control`/`replan`/`runStep` 對 plan 的擁有權皆有
   IDOR 檢查**：`planExecutorTools.ts` 的 in-memory `PLAN_STORE` 在 `runPlan`(:536)、
   `executeStep`(:659)、`getStatus`(:702)、`controlPlan`(:741)、`replanOnFailure`(:820)
   五處全部檢查 `plan.userId !== input.userId` 並拒絕跨使用者存取，未發現使用者可用猜測/
   枚舉 `planId` 讀取或操控他人 plan 的路徑（`planId` 本身用 `randomUUID()` 產生，本輪未
   逐行核對其產生點但一致認定為不可猜測的 UUID）。

6. **`spiritRouter.run` 的高風險步驟核可閘（`approveHighRisk`）確實已落地，非文件空談**：
   `planExecutorTools.ts:549-565` 的邏輯與檔頭「P1 review on PR #642」註解、`spiritRouter.ts`
   本身 149-155 行的參數註解完全對應——高風險步驟（`riskLevel:"high"` 或
   `requiresHuman:true`）在未帶 `approveHighRisk:true` 時確實會被攔在 `awaiting_approval`
   狀態、不會 dispatch 任何工具，程式碼與文件承諾一致。

7. **`spiritDispatcher.invokeSpiritModel` 的「雙保險」授權設計與檔頭自述一致**：Step 2
   （186-199 行）用 `canSpiritCallFalModel` 先擋一輪給更早的 fail-fast 錯誤訊息，
   `dispatchFalTask`/`falModels.ts` 內部（輔助檔案，本輪未逐行覆核第二層，但 spiritRouter.ts
   檔頭 8-10 行與 G3 §2.2 皆獨立確認這是真正生效的模態限制點）理論上會再檢查一次，未發現
   「精靈能呼叫類別外模型」的繞過路徑。

8. **`teachingArchive.search`（本輪主稽核對象間接消費端）的檢索結果不進 LLM prompt，
   本輪從 `ragInjectionGuard.ts` 自身文件獨立複核，信心由 X9 的「中」提升為「高」**：
   `ragInjectionGuard.ts:32-38` 的檔頭明確記載這個判斷背後的具體理由（下游 replan recap
   只序列化受信任執行狀態、snippet 只回顯給 UI），本輪未發現與此文件矛盾的呼叫路徑。

9. **`teachingArchive.ts` 的 CRUD 入口對 `teamId` 皆有真實 membership 驗證**（`create`:227-238、
   `update`:320-331），未發現「假裝把素材塞進別人團隊」的路徑；此為 X9 已列的 negative
   result，本輪重新核對現行行號一致，未變化。

---

## 3. 未查證 / 需人工確認事項

1. `spiritDispatcher.ts`/`falModels.ts` 內 `canSpiritCallFalModel` 的完整類別比對邏輯本輪
   未逐行覆核到底（僅讀了呼叫點與型別簽章），若其內部有邊界情況（例如某精靈的白名單字串
   比對用 `startsWith` 而非精確相等，可能誤放行相鄰類別），未在本檔驗證。
2. `agentPlanner.ts`（`spirit.plan`/`spirit.replan` 底層呼叫的 LLM 規劃器）本身是否有內建
   token 預算/長度上限保護，本輪未讀取此檔案，只確認 tRPC 層無速率限制。
3. `PLAN_STORE` 的 `planId` 產生方式（`randomUUID()`）本輪未逐行核對是否有任何路徑會讓
   `planId` 變得可預測或外洩（例如記錄在日誌/URL 中被第三方取得）。
4. training 類別經 `spirit.invoke` 呼叫 `dispatchFalTask` 的完整成功路徑（是否需要背景
   輪詢、`timeoutMs` 是否足夠涵蓋訓練時長）未驗證到底，見 §1 LOW 發現。
5. `app.use("/api/", rateLimiters.api)`（`_core/index.ts:555`）與 tRPC 中介層
   (`_core/index.ts:977` 起) 在同一支檔案內的實際 Express middleware 註冊順序，本輪依程式
   碼由上而下的自然執行順序推定前者會先套用到 `/api/trpc/*`，但未追蹤是否有任何條件式
   provisioning（例如環境變數關閉）會讓這條全站限流在特定部署模式下失效。

---

## 4. 附註：嚴重度排序總表

| 嚴重度 | 標題 | Cluster | 檔案:行號 |
|---|---|---|---|
| CRITICAL（複核） | realEarth.getLinkedMaterials 繞過三層授權矩陣，外洩私有教材全文 | security-idor | server/routers/realEarth.ts:294-300（根因於 server/services/teachingArchiveAccess.ts 未被複用）|
| HIGH（新） | spiritRouter 全端點無專屬速率限制，spirit.invoke 真實計費呼叫繞過 generationProcedure 系列 GPU 成本防護 | billing | server/routers/spiritRouter.ts:100-165；server/_core/trpc.ts:162-239 |
| MEDIUM（新） | teachingArchive.delete 文件承諾與 loadMaterialForWrite 實際授權不符（team_shared 任何角色可刪） | contract-mismatch | server/routers/teachingArchive.ts:363-371；server/services/teachingArchiveAccess.ts:105-114 |
| MEDIUM（新，跨檔案） | RAG 注入防護把 team_data 列為信任來源，但其信任前提（X9 已證明）不成立；現行未達 LLM prompt | injection | server/subsystems/contextPackets/contracts.ts:8-22；contextPacketService.ts:133-144 |
| LOW（跨參考） | spirit.invoke 是可達活路（正向），但 M15 輸入必要性檢查未涵蓋 training 類別 | other | server/services/spiritDispatcher.ts:89-115 |

共 1 CRITICAL（複核既有）、1 HIGH（新）、2 MEDIUM（新）、1 LOW（跨參考，未計入嚴重項統計）。
