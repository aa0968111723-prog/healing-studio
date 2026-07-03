# X16 — 多代理協作(agentCollaborationOrchestrator + Router)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/services/agentCollaborationOrchestrator.ts(888)、server/routers/agentCollaborationRouter.ts(613)

---

## 0. 範圍與方法說明

本次為對抗式逐行稽核,聚焦題目指定的四個面向:**計費**(多代理=多次 LLM 呼叫是否受控)、**卡死/死鎖**(U6 曾指出的問題是否仍在)、**授權**(跨用戶存取)、**注入/狀態持久化/無上限迴圈**。

先查證:`git log 7f4417da..HEAD -- server/services/agentCollaborationOrchestrator.ts server/routers/agentCollaborationRouter.ts` 回傳為空 —— 代表這兩支檔案自 `docs/research/U6-costar-multiagent-deepdive.md` 逐行讀過之後**沒有任何 commit 再改動過**,兩份文件讀的是同一份程式碼。因此本文件的定位是:①對 U6 已列的、仍然成立的項目重新驗證並標註「已知/重驗」;②聚焦題目要的四個面向,補上 U6 未點出的**新發現**——其中最關鍵的兩條(見發現 1、2)是本次稽核挖出的、比 U6 已知問題更嚴重的跨用戶授權缺陷。為了不重複 U6 已詳列的證據,凡是 U6 已完整舉證的項目,本文件只重述結論並標明「(重驗,詳見 U6)」,不重複貼相同程式碼片段。

直接依賴、但不在稽核清單內、僅為理解上下文而讀的檔案:`server/services/agentDiscussionRunner.ts`(434 行,全讀)、`server/services/agentCommunicationBus.ts`(369 行,全讀)、`shared/agent-communication-protocol.ts`(458 行,全讀)、`shared/genId.ts`(全讀)、`drizzle/schema.ts`(`agentCollaborationSessions` 表定義段)、`server/_core/trpc.ts`(rate-limit middleware 段)、`server/_core/llm.ts`(cost 追蹤段)。

---

## 1. 發現清單(依嚴重度排序)

### 【Critical / security-idor】發現 1 — `startCollaboration` 把 `sharedContext.userId` / `sharedContext.collaborationId` 兩個信任欄位直接讓使用者輸入覆寫,任何已登入使用者可偽造或劫持他人的協作 session

**證據**

- `agentCollaborationRouter.ts:37` — 輸入 schema `sharedContext: z.record(z.string(), z.unknown()).optional()`,**沒有任何 key 白名單限制**。
- `agentCollaborationRouter.ts:48-55` 原樣把它傳給 orchestrator:
  ```ts
  const session = await AgentCollaborationOrchestrator.startCollaboration({
    userId: ctx.user.id,
    ...
    sharedContext: input.sharedContext || {},
  });
  ```
  router 這裡確實想把 `userId` 綁定成 `ctx.user.id`(可信值),但這個值只是 `AgentCollaborationRequest.userId`(平鋪欄位),不是最終決定值。
- `agentCollaborationOrchestrator.ts:387-396`:
  ```ts
  const contextSource = (request.context ?? request.sharedContext ?? {}) as Partial<AgentSharedContext>;
  const sessionId = contextSource.sessionId ?? request.sessionId ?? `session_${Date.now()}`;
  const baseContext: AgentSharedContext = {
    ...(contextSource as AgentSharedContext),
    sessionId,
  };
  const collaborationId = baseContext.collaborationId || generateCollaborationId();
  const session: CollaborationSession = {
    collaborationId,
    userId: baseContext.userId ?? request.userId,
    ...
  ```
  `baseContext.userId ?? request.userId` —— `??` 左式優先。只要 client 送的 `sharedContext` 裡帶了 `userId` 這個 key(合法的 `AgentSharedContext.userId?: number` 欄位),它就會**贏過**router 明明想強制設定的 `ctx.user.id`。同理 `collaborationId` 也是「若 client 給了就直接沿用」,而不是永遠呼叫 `generateCollaborationId()`。
- `agentCollaborationOrchestrator.ts:410`:`this.activeSessions.set(collaborationId, session)` —— 這行**在 DB 寫入之前**就執行,且沒有「這個 key 是否已存在」的檢查,單純覆寫 Map。
- `agentCollaborationOrchestrator.ts:421-454` DB 寫入包在 try/catch,失敗只記 log,註解明寫「Continue even if persistence fails - in-memory session is still valid」(:453)。`drizzle/schema.ts:2437` `collaborationId` 是 `varchar(64).primaryKey()` —— 若攻擊者選了一個已存在的 `collaborationId`,DB insert 會因主鍵衝突丟例外並被吞掉,**但第 410 行的記憶體覆寫早已生效,不受 DB 失敗影響**。

**兩種可直接重現的攻擊路徑**

1. **偽造他人歷史記錄(低成本,不需猜 ID)**:攻擊者呼叫 `startCollaboration`,`sharedContext: { userId: <目標使用者的數字 ID> }`,`collaborationId` 留空(走 `generateCollaborationId()`,不衝突)。DB insert 會成功(全新主鍵),於是 `agentCollaborationSessions` 表裡出現一筆 `userId = 受害者`、`taskDescription = 攻擊者任意內容` 的真實資料列。受害者下次呼叫 `listUserCollaborations`(`agentCollaborationRouter.ts:207-219`,只用 `eq(agentCollaborationSessions.userId, ctx.user.id)` 篩選)會直接看到這筆攻擊者塞進去的假協作紀錄。
2. **即時劫持受害者現有 session(需另外猜到/取得受害者真實 collaborationId)**:攻擊者額外在 `sharedContext` 帶 `collaborationId: <受害者現有的 collaborationId>` 且 `userId: <受害者 ID>`。記憶體 Map 第 410 行會把受害者原本的 `CollaborationSession` 物件整個換成攻擊者建的新物件(`taskDescription`、`sharedContext`、`participatingAgents` 全部替換),但因為 `userId` 也被同步偽造回受害者本人,受害者之後呼叫 `getCollaborationStatus`(其擁有權檢查 `session.userId !== ctx.user.id`,:103-108)會**通過檢查、拿到攻擊者灌入的內容**,完全沒有 FORBIDDEN 錯誤可以示警——受害者只會看到自己「協作 session 的內容被誰亂改了」而毫無異狀提示。

**影響**:這是一個完整可用的跨用戶授權繞過(IDOR)+ 內容注入鏈——根因是 `AgentSharedContext` 開了 `[key: string]: unknown` 開放索引簽名(`shared/agent-communication-protocol.ts:85`),而 `startCollaboration` 把整個使用者可控的 `sharedContext` 物件直接展開(spread)去覆寫本應由伺服器信任層決定的 `userId`/`collaborationId`。攻擊面只需要「一個已登入帳號 + 目標使用者的數字 ID(变体1不需猜 collaborationId)」,門檻非常低。

**建議**:在 `startCollaboration` 內,`userId`/`collaborationId`/`sessionId` 這三個安全相關欄位必須在展開 `contextSource` **之後**用可信值強制覆寫回去(即 `{ ...baseContext, userId: request.userId, collaborationId: generateCollaborationId() }` 的寫法反過來,可信欄位放在展開之後),或直接從 `contextSource` 中 `delete` 掉這些保留 key 再合併。若日後真的需要支援「client 指定既有 collaborationId 續接」的合法場景,應改為顯式查詢並驗證擁有權後才允許續接,而不是靜默覆寫。

---

### 【Critical / security-idor】發現 2 — `executeProtocolHandoff` 的 `extraContext` 同樣可覆寫 `collaborationId`,讓攻擊者用自己的 session 當跳板去改寫另一個使用者的 live session

**證據**

- `agentCollaborationRouter.ts:548-556` 輸入 schema:
  ```ts
  z.object({
    collaborationId: z.string().min(1),
    fromAgent: z.string().min(1).max(40).optional(),
    whenHint: z.string().max(120).optional(),
    extraContext: z.record(z.string(), z.unknown()).optional(),
  })
  ```
  同樣是無 key 限制的 `z.record`。
- `agentCollaborationRouter.ts:558-580`:router 先用 `input.collaborationId` 查 session 並驗證 `session.userId === ctx.user.id`(:558-567)——**但這個檢查只驗證了攻擊者自己那個 session 的擁有權**,`extraContext` 本身完全沒被檢查或過濾就傳進 orchestrator(:574-580)。
- `agentCollaborationOrchestrator.ts:603-614`(`executeProtocolHandoff`):
  ```ts
  const mergedContext = {
    ...session.sharedContext,
    ...(args.extraContext ?? {}),
  };
  const handoff: AgentHandoff = {
    fromAgent: args.fromAgent,
    toAgent: picked.to,
    reason: picked.reason,
    context: mergedContext,
    nextAction: picked.when,
  };
  await this.executeHandoff(handoff);
  ```
  這裡的 `session` 是攻擊者自己合法擁有、且通過 router 檢查的那個 session；但 `mergedContext.collaborationId` 若被 `args.extraContext.collaborationId` 覆寫成別人的 ID,傳給 `executeHandoff` 的 `handoff.context.collaborationId` 就變成攻擊者指定的任意字串。
- `agentCollaborationOrchestrator.ts:629-647`(`executeHandoff`):
  ```ts
  const session = Array.from(this.activeSessions.values()).find(
    s => s.sharedContext.collaborationId === handoff.context.collaborationId
  );
  if (!session) { ...; return; }
  session.currentAgent = handoff.toAgent;
  if (!session.participatingAgents.includes(handoff.toAgent)) {
    session.participatingAgents.push(handoff.toAgent);
  }
  session.sharedContext = handoff.context;
  ```
  這裡是**用 `handoff.context.collaborationId` 全表掃描找 session**,完全沒有比對呼叫者的 `userId`。只要攻擊者知道(或猜到)受害者真實存在的 `collaborationId`,這段程式碼就會找到受害者的 session,並且:①把受害者的 `currentAgent` 換成攻擊者挑的 agent;②把攻擊者選的 agent 塞進受害者的 `participatingAgents`;③**用攻擊者的 `mergedContext` 整個蓋掉受害者的 `sharedContext`**(受害者原本的 `originalIntent`/`generatedAssets`/`learnedPreferences` 等全部遺失,換成攻擊者控制的內容)。
- `agentCollaborationOrchestrator.ts:666-691`:DB 更新用的是 `session.collaborationId`(此時 `session` 已是**受害者**那個真正的物件),所以 DB 也會被寫入受害者列——`.where(eq(agentCollaborationSessions.collaborationId, session.collaborationId))`,把受害者真實那筆 DB row 的 `currentAgent`/`participatingAgents`/`sharedContext` 都改掉,`version` 樂觀鎖照樣 +1。
- `agentCollaborationOrchestrator.ts:654-655`:`createHandoffMessage(handoff, session.collaborationId)` 把訊息 publish 到 bus,`correlationId = session.collaborationId`(受害者真實 ID)——受害者之後呼叫 `getCollaborationMessages`(`agentCollaborationRouter.ts:377-380`,只用 `correlationId` 篩選,擁有權檢查在更早一步已經通過因為是受害者自己查自己的 session)會**直接在自己的協作對話串裡看到這則攻擊者偽造的 handoff 訊息**,`fromAgent` 欄位還可以是攻擊者任填的任意字串(`fromAgent: z.string().min(1).max(40).optional()`,未限定於合法 `AgentRole` enum,只在 router 用 `as AgentRole` 硬轉型)。

**影響**:與發現 1 同根因(開放索引簽名 + 展開覆寫),但攻擊路徑不同——這裡是**用自己的合法 session 當「跳板」**,透過 `extraContext.collaborationId` 讓底層的 `executeHandoff` 誤把另一個使用者的 session 當成操作目標。前置條件只需要:①攻擊者自己有一個 `status: "active"` 的 session(2 個 API call 就能建好,見發現 1 附近的 `startCollaboration`);②知道/猜到受害者的真實 `collaborationId`。一旦成立,攻擊者可以竄改受害者 session 的 `currentAgent`、`sharedContext`、`participatingAgents`,並讓偽造內容**透過 DB 與 bus 兩條路徑持久化,且對受害者完全不可見/無異常提示**(沒有任何 FORBIDDEN 或警告)。

**建議**:`executeHandoff` 不應該用 `handoff.context.collaborationId` 重新查 session——應該讓呼叫端(`executeProtocolHandoff`)把已經驗證過擁有權的 `session` 物件(或至少其 Map key)直接傳進去,徹底移除「用 payload 裡的欄位反查」這個可被覆寫的環節。次要防線:在合併 `extraContext` 前先過濾掉 `collaborationId`/`userId`/`sessionId` 等保留 key,或合併後強制把 `mergedContext.collaborationId` 覆寫回 `session.sharedContext.collaborationId`(即信任值放在展開之後)。

---

### 【High / billing】發現 3 — `startCollaboration` / `startAutoDiscussion` 完全沒有 rate limit 或併發 session 上限,而 `startAutoDiscussion` 每次呼叫最多觸發 5 次序列 LLM 呼叫

**證據**

- `agentCollaborationRouter.ts:13` 只 `import { router, protectedProcedure } from "../_core/trpc";`——**兩個 mutation 都只掛 `protectedProcedure`**(:31、:426),沒有使用 `_core/trpc.ts` 裡現成的 `aiChatProcedure`(20 req/60s,見 `trpc.ts:155-157`)、`requireGenerationLimit`(5 req/60s)、或 `requireVideoStudioLimit` 那種「查 DB 目前進行中任務數」的併發上限模式(`trpc.ts:190-220`,`MAX_CONCURRENT_VIDEO_JOBS`)。
- `agentCollaborationOrchestrator.ts:802-806` 有現成的 `getUserSessions(userId)` 可以查「這個使用者目前有幾個 active 協作」,但全 repo 只有 `server/services/spiritTools/orchestratorTools.ts:73,177` 呼叫它(給「總總」精靈匯報用),**router 從未用它做過任何上限檢查**。
- `agentDiscussionRunner.ts:271-275`:`maxRounds` 硬夾在 1–5,`timeoutMsPerTurn` 硬夾在 5000–60000ms;每一輪都會 `await invokeLLM({...maxTokens: 600...})`(:320-336)。也就是**每呼叫一次 `startAutoDiscussion`,背景最多跑 5 次真實 LLM 呼叫**(:493-508 用 `void runAutoDiscussion(...).catch(...)` fire-and-forget,router 立刻回應,不等 runner 跑完)。
- 沒有任何機制阻止同一使用者在極短時間內重複呼叫 `startAutoDiscussion`——每次呼叫都是獨立的 fire-and-forget 背景任務,彼此不互相排隊或計數。

**影響**:這是全案唯一「多代理 = 多次 LLM 費用」的真實放大點,且完全不受節流保護。同一使用者若在 client 端連續呼叫 `startAutoDiscussion`(例如寫個簡單迴圈打 100 次),伺服器會不加限制地並行展開最多 `100 × 5 = 500` 次真實 LLM API 呼叫(`invokeLLM`,`preferEngine: "auto"`),對照 `_core/llm.ts` 只把成本記到 LangSmith(`cost_usd`,:740,純觀測用途,不會擋下呼叫本身),這是純粹的「公司對外部 LLM API 支出」風險,而非使用者點數計費出錯——但站方既有的其他「一次呼叫可能觸發多次外部付費呼叫」端點(影片生成、圖片生成、語音生成)全部都掛了 `checkTrpcRateLimit` 或 DB 併發上限查詢(`trpc.ts:162-220`),唯獨這兩支協作端點是例外。

**建議**:比照 `requireGenerationLimit`/`requireVideoStudioLimit` 的既有模式,替 `startCollaboration`/`startAutoDiscussion` 加上每分鐘請求數限制,並用既有的 `getUserSessions()` 或查 `agentCollaborationSessions` 表加上「同使用者同時最多 N 個 active 協作」的併發上限檢查。

---

### 【Medium / deadcode(契約不符)】發現 4 — `maxRounds` 上限三方不一致:router schema 允許 24、runner 實際硬夾 5、預設值文件寫 3 (重驗,詳見 U6 §5)

**證據**(重新核對,行號與 U6 記錄一致、程式碼未變):`agentCollaborationRouter.ts:434` 的 zod 是 `z.number().int().min(1).max(24).optional()`,註解寫「最多 24」;`agentDiscussionRunner.ts:271` 實際執行 `Math.max(1, Math.min(input.maxRounds ?? DEFAULT_MAX_ROUNDS, 5))`,硬性上限是 **5**;`agentCollaborationRouter.ts:522-524` 把 `input.maxRounds ?? 3` **原樣 echo 回前端**當作回應欄位。

**影響**:API 合約(schema 允許填到 24)與實際執行(永遠不會超過 5)不一致,前端若依 `startAutoDiscussion` 的回傳值顯示「已設定 24 輪討論」,使用者體感會是「怎麼提早結束」。因為 runner 有把上限鎖在 5,這**不會**造成發現 3 之外的額外費用放大,純粹是契約/文件層級的落差。

**建議**:把 `agentCollaborationRouter.ts:434` 的 `.max(24)` 改成 `.max(5)` 對齊真實行為,或反過來把 runner 的硬夾上限做成可設定的常數並同步兩處。

---

### 【Medium / persistence】發現 5 — `cancelCollaboration` 沒有 `await` 就呼叫 `completeCollaboration`,API 回「已取消」時 DB 寫入可能還沒完成

**證據**:`agentCollaborationRouter.ts:276-289`:
```ts
const cancelledAt = Date.now();
AgentCollaborationOrchestrator.completeCollaboration(
  input.collaborationId,
  { success: false, output: { cancelled: true, reason: input.reason }, ... }
);

logger.info("collaboration_cancelled", {...});

return {
  success: true,
  message: "協作已取消",
};
```
`completeCollaboration` 是 `async` 方法(`agentCollaborationOrchestrator.ts:717`),內部真正的 DB `update`(:747-755)包在 `await`,但這裡呼叫端**既沒有 `await`,也沒有 `.catch()`**,是一個未處理的浮動 Promise。對照同一個 orchestrator 方法在 `agentDiscussionRunner.ts:410` 的呼叫點是 `await AgentCollaborationOrchestrator.completeCollaboration(...)`——同一支方法,兩個呼叫端一個等一個不等。

**影響**:記憶體內的 `session.status` 確實會在 `completeCollaboration` 函式體第一個 `await` 之前同步設定完(:730-731,JS 的 async function 語意保證這段跑在被呼叫的當下),所以 in-memory 讀路徑(`getCollaborationStatus` 的 fast path)不會有問題;但 DB 的 `update`(:747-755)是非同步排隊執行,若使用者在收到「協作已取消」的回應後立刻呼叫**只走 DB、不查記憶體**的 `listUserCollaborations`(:214-219),存在一個時間窗口 DB 仍顯示 `status: "active"`,與 API 剛回覆的訊息矛盾。若該次 DB 寫入本身失敗(`catch` 區塊只記 log,:769-774),使用者也完全不會被告知「取消其實沒有寫進資料庫」。

**建議**:在 `cancelCollaboration`(以及理想上其他呼叫 `completeCollaboration`/DB 寫入方法但沒等待的地方)補上 `await`,讓 API 回應真正反映持久化結果;DB 寫入失敗時應該讓呼叫端知道(至少記一個可觀測的失敗率指標),而不是無聲吞掉。

---

### 【Medium / persistence】發現 6 — `activeSessions` 純記憶體、無週期性回收,且 router 的 `cancelCollaboration` 沒有 DB fallback,殭屍 session 無法透過 API 收尾 (在 U6 §8 基礎上,補上 router 層的具體後果)

**證據**:`agentCollaborationOrchestrator.ts:53` `private activeSessions: Map<string, CollaborationSession>`;唯一的清理時機是 `completeCollaboration` 成功跑過之後才排的 1 小時 `setTimeout`(:778-780)——**若一個 session 從未呼叫 `completeCollaboration`/`cancelCollaboration`(例如 process 重啟、呼叫端邏輯漏掉),它會永遠留在 Map 裡,沒有任何 TTL 掃描器**(U6 §8 已完整記錄此點,本次重讀程式碼確認未變)。

在此基礎上新補一個 router 層的具體後果:`agentCollaborationRouter.ts:247-322`(`cancelCollaboration`)**只用** `AgentCollaborationOrchestrator.getSessionStatus(input.collaborationId)`(:249-251)查 session,找不到就直接丟 `NOT_FOUND`(:253-258)——沒有像 `getCollaborationStatus`(:120-148)那樣的 DB fallback。這代表:若 Railway 重啟導致記憶體 Map 清空(而 DB row 仍卡在 `status: "active"`,即殭屍 row),使用者**完全沒有辦法透過 `cancelCollaboration` 這個 API 把這個殭屍協作標記為取消**——只能眼睜睜看著 `listUserCollaborations` 裡永遠有一筆「進行中」但其實早已死掉的協作。

**影響**:殭屍 session 對使用者體感是「這個協作永遠卡在進行中,點取消還說找不到」,且沒有任何自我修復路徑。

**建議**:比照 `getCollaborationStatus` 已有的 DB fallback 寫法,替 `cancelCollaboration` 加上「記憶體找不到就退回查 DB、且狀態仍是 active 時允許直接把 DB row 標記為 cancelled」的分支;長期建議是加一支排程,定期把「DB 顯示 active 但記憶體裡完全沒有對應 session」且超過某個時限的 row 標記為過期失敗。

---

### 【Medium / deadcode】發現 7 — `findBestAgent()` 連同它依賴的評分邏輯,在全 repo 找不到任何呼叫者;`agentHasCapability`/`findAgentForTool` 兩個 import 同樣零使用

**證據**:`agentCollaborationOrchestrator.ts:462-526`(`findBestAgent`,65 行,含工具/領域/專長三維評分演算法)。以下指令在整個 repo(server/client/shared/tests)搜尋 `.findBestAgent(` / `findBestAgent(` 只命中函式本體自己那一行(`grep -rn "findBestAgent(" --include="*.ts" --include="*.tsx"` 只回傳 `agentCollaborationOrchestrator.ts:462`)。另外 `agentCollaborationOrchestrator.ts:27` import 的 `agentHasCapability` 與 :32 import 的 `findAgentForTool`,在同檔案內外也都找不到任何呼叫點(全 repo grep 同樣只命中定義處/import 處)。

交叉核對:U6 §3 已證實 `server/services/collaborativeTaskPlanner.ts` 是全站零呼叫者的孤兒模組;本次重新確認該檔案雖然 `import { AgentCollaborationOrchestrator } from "./agentCollaborationOrchestrator"`(:13),但 `grep -n "AgentCollaborationOrchestrator\." collaborativeTaskPlanner.ts` 同樣沒有任何呼叫——也就是說,`findBestAgent` 這個「依工具/領域/專長挑最適合 agent」的完整評分演算法,原本看起來就是設計給 `collaborativeTaskPlanner` 這類任務分解模組用的,但**兩邊都沒有真正接上**,形成一組互相對應但都沒被執行過的孤兒程式碼。

**影響**:純維護成本 / 認知負擔問題——不影響目前線上行為(沒人呼叫就沒有風險),但容易讓後續開發者誤以為「協作路由已經有一套依能力挑人的邏輯在跑」,實際上『挑 agent』這件事目前只透過 `SPIRIT_COLLAB_PROTOCOL` 靜態表(`pickBestHandoff`/`pickNextAgent`)完成,`findBestAgent` 完全不在真實路徑上。

**建議**:若無接上計畫,直接刪除 `findBestAgent` 與兩個未使用的 import 以降低維護面;若未來要接上,`collaborativeTaskPlanner.ts` 是最直接的候選呼叫端(U6 §3 已指出它的 `createCollaborationRequests()` 產物本來就該送進 orchestrator)。

---

### 【Medium / northstar】發現 8 — `startAutoDiscussion` 驅動的多代理討論完全不带工具呼叫,15 位精靈在這條路徑上只能「發表意見」,無法真的執行任何 `studio.*`/`accountant.*` 動作

**證據**:`agentDiscussionRunner.ts:320-329` 呼叫 `invokeLLM` 時的參數是 `{ messages, runName, temperature: 0.65, preferEngine: "auto", maxTokens: 600 }`——**沒有傳 `tools` 欄位**。核對 `server/_core/llm.ts` 的 `InvokeParams` 型別確實支援 `tools?: Tool[]`(:1518 附近有 `toolsToAnthropic`/tool_choice 邏輯,可見底層是支援 function-calling 的),但這條路徑刻意/疏漏地沒有把任何工具傳進去。同時 `agentCollaborationOrchestrator.ts` 的 `initializeAgentCapabilities()`(:64-331)替每位精靈登記了看起來很豐富的 `availableTools`(例如 `accountant.estimate`/`accountant.workflowEstimate` 等 6 個工具、`qualityCoach.diagnose` 等 4 個工具、`plan-executor` 的 `studio.*`/`media.*`),但這整份能力表在「自動討論」這條唯一真的會執行 LLM 呼叫的路徑上完全用不到——`buildMessagesForAgent`(`agentDiscussionRunner.ts:169-190`)組出的訊息只有人設 system prompt + 歷史對話文字,沒有任何工具定義傳給模型,模型自然無法在回覆裡發起 tool call。

**影響**:「15 精靈自動討論」這個對外功能,實質上是一個多角色輪流發表看法的文字接龍(每人限 4-6 句、`maxTokens: 600`),而不是「多個專精 agent 真的協作完成任務」——後者需要的是每位精靈能實際呼叫工具、寫入資產、觸發下一步動作,但目前這條路徑連 `tools` 參數都沒傳。這與 U6 §9 已指出的「capability 表列的工具經 `agentToolExecutor.ts` 的閘門大多不可達」是同一個更大缺口的兩面:一邊是「就算工具可達,這個功能也沒去呼叫它」,一邊是「就算想呼叫,大部分工具名稱本來就打不到」。兩者疊加代表「多代理協作」目前作為北極星能力,離「真的能協作把事情做完」還有相當距離。

**建議**:若產品目標是讓精靈在討論中真的能執行動作,需要在 `runAutoDiscussion` 的 `invokeLLM` 呼叫裡接上對應精靈的 `availableTools` 定義並處理 tool call 結果;若目前只是刻意做成「意見交流展示」,建議在 UI/文件層級明確標示這是模擬討論而非任務執行,避免使用者預期落差。

---

## 2. 次要 / 低嚴重度觀察(不列入結構化 findings,僅記錄)

- **`startCollaboration` 的 `taskDescription` 沒有長度上限**(`agentCollaborationRouter.ts:34`,只有 `min(1)`),對照 `startAutoDiscussion` 的 `prompt` 有 `max(2000)`(:429)——同一個路由檔內兩個相似欄位驗證強度不一致,前者理論上可塞入極大字串持久化進 `agentCollaborationSessions.taskDescription`(`text` 型別,DB 層面不會擋)。風險是儲存空間濫用,而非本檔內可驗證的注入路徑(是否有下游把它塞進 LLM prompt 未在本檔驗證)。
- **討論輪次會被「跳過的候選人」偷偷吃掉**(重驗,詳見 U6 §6):`agentDiscussionRunner.ts:302-314` 的 `continue` 讓「被靜音/不在白名單跳過」與「真的發言一輪」共用同一個 `round` 計數器,使用者設的 `maxRounds` 數字與實際「有意見產出」的輪次會不一致,程式碼未變,問題仍在。
- **`SPIRIT_COLLAB_PROTOCOL` 表尾語法瑕疵、`chief-orchestrator` 為純入口節點**(重驗,詳見 U6 §10):屬 `shared/orb-agent-roles.ts`,非本次稽核檔案範圍,僅承接 U6 結論、未重新核對。

---

## 3. 已驗證排除的疑慮(Negative Results)

1. **每個 router 端點對「輸入的 `collaborationId` 本身」都有做擁有權檢查**——`getCollaborationStatus`(:103-108 記憶體路徑、:143-148 DB fallback 路徑)、`cancelCollaboration`(:261-266)、`getCollaborationMessages`(:367-372)、`executeProtocolHandoff`(:562-563)全部都有 `session.userId !== ctx.user.id` 或等價檢查。發現 1、2 的漏洞**不是**「忘了檢查擁有權」,而是「檢查的是對的欄位,但後續的物件展開讓另一個攻擊者可控欄位(`sharedContext.userId`/`extraContext.collaborationId`)偷偷把操作目標換掉」——兩者性質不同,值得區分清楚。
2. **`agentDiscussionRunner.ts` 的主迴圈確實有界**:`maxRounds` 在 :271 被 `Math.max(1, Math.min(..., 5))` 強制夾在 1–5 之間,不存在無限迴圈或無限遞迴的風險;`pickNextAgent`(:129-162)的 `spokenSet` 確保同一位精靈同一輪討論不會被選中兩次,不會有 A→B→A→B 的無窮反覆。
3. **每輪 LLM 呼叫都有逾時保護**:`agentDiscussionRunner.ts:320-336` 用 `Promise.race` 搭配 `timeoutMs`(clamp 在 5000–60000ms,:272-275)包住 `invokeLLM`,單一精靈卡住時會在時限內以 `stoppedReason: "llm-error"` 收尾並仍然呼叫 `completeCollaboration`(:410),不會讓整條 runner 掛死到底或讓 session 卡在 `active` 狀態(不像 U6 §2 指出的 `multiAgentIntegration.ts` 那條路徑——那邊的卡死是「壓根沒人跑」,這裡是「有跑但會逾時收尾」,兩者不是同一個問題)。
4. **`AgentCommunicationBus` 的訊息歷史有自我清理機制**:`maxHistorySize = 1000`(:29)+ 24 小時 TTL(`HISTORY_RETENTION_MS`,:30,`cleanupExpiredMessages`,:170-185),不會無限增長——這點與 `agentCollaborationOrchestrator.activeSessions`(發現 6)形成對比:同一支協作子系統裡,「訊息匯流排」有界、「session 表」無界,只有後者是真問題。
5. **`deliverToAgent`/`broadcastToAll` 對每個訂閱者的 handler 都個別包了 try/catch**(`agentCommunicationBus.ts:113-127`),單一訂閱者拋錯只會被記錄,不會讓 `publish()` 整體失敗或波及其他訂閱者收不到訊息。
6. **兩個檔案本身都沒有使用者點數(credit)扣款或退款邏輯**——所有 LLM 呼叫成本只透過 `_core/llm.ts` 的 `trackLangSmithSDK`(:645-750)寫入 `cost_usd` 供觀測,屬於「公司對外部 LLM API 的實際支出」記錄,不是「使用者點數/額度」的計費系統。因此本次稽核在這兩支檔案裡**沒有找到**「多扣使用者點數不退還」型態的計費 bug;真正的風險型態是發現 3 描述的「呼叫頻率完全不受限,導致外部 API 支出可被無限放大」,兩者性質不同,不應混為一談。

---

## 4. 未讀完 / 缺讀聲明

- 未逐行核對 `SPIRIT_COLLAB_PROTOCOL`/`pickBestHandoff` 的評分演算法本體(busyRoles/recentRoles 扣分細節)——僅讀了 `agentCollaborationOrchestrator.ts` 對它的呼叫端用法,承接 U6 的「未讀完」聲明。
- `session.sharedContext` 的內容(尤其是發現 1、2 裡被攻擊者污染的部分)是否會在其他消費端(例如 `multiAgentIntegration.ts`、未來若真的接上 `runAutoDiscussion` 之外的執行路徑)被原樣塞進某個 LLM 的 system/user prompt,造成二次注入——這件事**未在本檔驗證**,因為那些消費端不在本次稽核清單內。
- `drizzle/schema.ts` 裡 `agentCollaborationSessions.version` 樂觀鎖欄位的完整併發語意(是否有任何寫入路徑會因為 `version` 不符而真正擋下衝突寫入,或只是單純遞增計數)未深入核對——本檔看到的三處 `.set({ ..., version: sql\`...+1\` })`(:689、:753、:830)都沒有搭配 `WHERE version = ?` 的樂觀鎖比對條件,只是遞增,是否等同「樂觀鎖形同虛設」未在本檔完整驗證,僅記錄觀察供後續稽核追蹤。
- `server/services/spiritTools/orchestratorTools.ts` 呼叫 `getUserSessions`/`getProtocolHandoffsFor` 的完整上下文未逐行讀,只確認了呼叫點存在。
