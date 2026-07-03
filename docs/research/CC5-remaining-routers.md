# CC5 — 剩餘 router 深挖
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/langsmith.ts(947)、promptLibrary.ts(486)、promptCollection.ts(587)、sense.ts(395)、orbConversationsRouter.ts(557)、notes.ts(308)

> 核對:`git diff 812f6fdb HEAD -- <本波六檔>` 為空,六檔在兩個 commit 間內容完全一致,以下行號對兩個 commit 均有效(HEAD = e2238857)。
> 方法:六檔逐行手動閱讀(langsmith.ts 947 行全讀、其餘五檔各自全讀),對牽涉到的 `drizzle/schema.ts`、`server/db.ts`、`server/_core/trpc.ts`、`server/_core/rateLimiter.ts`、`server/services/orbConversationEnhancer.ts`/`orbClarificationEngine.ts`、`client/src/shells/settings/panels/ObservabilityPanel.tsx` 做定點交叉查證(非逐行審查),用以確認每個「看起來的閘門」是否真的接住東西。既有研究(G1-video-cockpit、M4-assets-goals-review、CC4-remaining-orb-services、K1-security-bugs)已提及的既知缺口,本文件只做「直接讀檔驗證是否仍成立」與「延伸範圍」,不重複邀功。

## 0. 六檔角色速覽

| 檔案 | 角色 | 授權模型 | 對外暴露面 |
|---|---|---|---|
| `langsmith.ts` | LangSmith 追蹤資料代理(全站 runs/健康度/模型對比/feedback/dataset/微調匯出) | **8 個 procedure 用 `protectedProcedure`(任何登入者)、僅 1 個(`addRunToDataset`)用 `adminProcedure`** | tRPC `langsmith.*`,前端 `LangSmithPage.tsx`/`ObservabilityPanel.tsx`/`LangsmithTab.tsx` |
| `promptLibrary.ts` | 個人提示詞庫(CRUD + 收藏 + 使用計數 + 公開廣場),已歷經 AIDV-121/AIDV-184 兩輪 IDOR 修補 | `protectedProcedure`(owner-scoped)+ `adminProcedure`(seed/backfill) | tRPC `promptLibrary.*` |
| `promptCollection.ts` | 站內 prompt 片段「收集」(個人 + team_shared),與 promptLibrary 語意刻意分離 | `protectedProcedure`,team_shared 走 `requireTeamMember` | tRPC `promptCollection.*` |
| `sense.ts` | 首頁微行為 → LLM 心理意圖推論(Sense Engine) | **`publicProcedure`(不需登入)**,直接觸發 LLM 呼叫 | tRPC `sense.inferIntent`,首頁 `OrbCreationStage.tsx`/`useIntentInference.ts` |
| `orbConversationsRouter.ts` | 光球多分頁對話持久化(session 列表/訊息分頁/append),已有 AIDV-157 lazy-create IDOR 修補 | `protectedProcedure`,owner-scoped(部分用 WHERE 內建 userId,部分用 select-then-act) | tRPC `orbConversations.*`,`/agent` 頁籤 UI |
| `notes.ts` | 專案筆記/行事曆(script/note/calendar_event)+ ICS 匯出 | `protectedProcedure`,owner-scoped(select-then-act) | tRPC `notes.*`,行事曆頁 |

---

## 1.【嚴重 / security-idor】`langsmith.ts` 8 個 procedure 用 `protectedProcedure` 而非 `adminProcedure`,任何登入者可讀取/匯出全站所有使用者的 LLM 對話原文

**發現**:`langsmithRouter`(`server/routers/langsmith.ts:186-947`)裡,除了 `addRunToDataset`(:621,`adminProcedure`)之外,其餘全部 8 個 procedure——`status`(:190)、`stats`(:224)、`listRuns`(:317)、`getRun`(:359)、`healthStats`(:381)、`createFeedback`(:523)、`listFeedback`(:551)、`listDatasets`(:588)、`modelComparison`(:682)、`exportFineTuningData`(:825)——一律用 `protectedProcedure`,即任何已登入使用者(不分角色)皆可呼叫。

這些 procedure 內部呼叫 LangSmith SDK 時**一律不帶任何使用者範圍**:`client.listRuns({ projectName: getProjectName(), ... })`(如 :202、:252、:342、:437、:724、:856)查的是**整個 LangSmith 專案**的 runs,沒有任何 `metadata.userId` 或等價欄位過濾;`getRun`(:359-370)接受任意 `runId` 字串直接 `client.readRun(input.runId)`,同樣沒有檢查這個 run 是否屬於呼叫者。

其中衝擊最大的是 `exportFineTuningData`(:825-946):它把全站 runs 的 `inputs.messages`(使用者原始輸入)與 `outputs.content`(AI 完整回覆)原樣組成 OpenAI fine-tuning 格式或 JSONL 直接回傳給呼叫者(:894-946)——換言之,**任何一個普通登入使用者,只要呼叫這個 query,就能下載全站(含其他使用者)近期對話的完整原文**。對照同檔案裡 `addRunToDataset`(把單一 run 寫入 LangSmith dataset)被正確標成 `adminProcedure`,顯示團隊清楚「動 LangSmith 資料需要 admin」這個原則,卻沒有把同一原則套用到「讀出/批次匯出全站對話內容」這個影響面明顯更大的動作上,是同檔案內部不一致的授權層級。

前端 `client/src/shells/settings/panels/ObservabilityPanel.tsx:7-9` 的註解明確寫著「RBAC:langsmith 任何登入者可看;背景任務/系統統計僅 admin(前端隱藏,後端再守)」——顯示團隊對「一般登入者可看 langsmith 統計」是有意識的決定,但這個決定的原始意圖看起來是「觀測儀表板的彙總統計」(如 `healthStats`/`stats`/`modelComparison` 的錯誤率、延遲、token 數),**並未涵蓋 `exportFineTuningData` 這種「下載其他使用者對話原文」的資料匯出動作**——兩者風險等級完全不同,不應共用同一個「langsmith 任何登入者可看」的判斷。

本文件檢索全庫,未找到任何 `langsmith.*` 的測試檔(`server/routers/__tests__/` 無 `langsmith` 相關檔案),這條授權路徑目前零測試覆蓋。

**影響**:任何一個免費/最低權限的登入使用者,都能:
1. 透過 `listRuns`/`getRun` 瀏覽全站所有其他使用者的 AI 對話 runs(含 prompt 全文、AI 回覆、metadata);
2. 透過 `exportFineTuningData` 一次批次匯出多達 500 筆(`limit` 上限,:828)其他使用者對話的完整訊息內容,格式化成可直接離站使用的 JSONL/OpenAI 訓練格式。

若這個站台的核心使用情境涉及使用者私人創作 prompt、個人議題陳述(產品定位含「療癒」相關的自我表露內容),這是一個橫跨全站使用者的隱私外洩面,而非單一資源的 IDOR。

**建議**:
1. 立刻把 `listRuns`/`getRun`/`stats`/`healthStats`/`modelComparison`/`exportFineTuningData`/`createFeedback`/`listFeedback`/`listDatasets` 全部改成 `adminProcedure`(或至少 `leaderOrAdminProcedure`),與 `addRunToDataset` 看齊,並更新 `ObservabilityPanel.tsx:9` 的註解與前端隱藏邏輯,使其與後端一致(目前註解本身承認「前端隱藏,後端再守」是既定模式,但這條路徑後端沒有真的守)。
2. 若產品上真的需要讓一般使用者看「自己的」AI 使用統計,應該另開一組以 `ctx.user.id` 過濾(或 LangSmith run metadata 打上 `userId` 再用 filter 字串限定,見發現 2)的 procedure,不要與「跨全站彙總/匯出」共用同一組無範圍查詢。
3. 補上針對授權邊界的測試(比照 `promptLibraryIdor.test.ts`/`orbConversationsLazyCreate.test.ts` 的既有測試模式)。

---

## 2.【高 / billing】`sense.inferIntent` 是無需登入的 `publicProcedure`,直接觸發真實 LLM 呼叫,後端無專屬節流,唯一防線是前端(可被繞過)的 client-side 節流

**發現**:`senseRouter.inferIntent`(`server/routers/sense.ts:355-394`)宣告為 `publicProcedure`(:355,理由寫在同行「使用 publicProcedure 因為未登入使用者也需要推論」),輸入僅需 `events`(最多 200 筆,:358)與 `summary`,只要 `events.length >= 3`(:364)就會呼叫 `inferUserIntent()`(:378),其內部對 `invokeLLM()`(:203-289)發起一次真實模型呼叫(45 秒逾時,:15-18)。

節流檢查:
- 本檔本身**沒有任何** `checkTrpcRateLimit`/使用者身份/session 驗證呼叫。
- 全域路由層,`app.use("/api/", rateLimiters.api)`(`server/_core/index.ts:555`)是唯一涵蓋 `/api/trpc/sense.inferIntent` 的限流器,規格是「300 req / 15 分鐘」且**以 IP 為 key**(`server/_core/rateLimiter.ts:59-63`,tier 說明見 :12「General API 300 req/15min」)——這是給全站一般 API 的寬鬆上限,並非針對「會觸發真實 LLM 呼叫」的端點特別設計;程式碼裡定義好的 `llm` tier(60 req/15min,:54-58)**從未被掛到任何路徑上**(`grep rateLimiters\.` 只找到 `.auth`/`.upload`/`.api`/`.proxyDownload` 四種掛載,`server/_core/index.ts:528-555,792`,`llm` tier 是死配置)。
- 唯一針對「同一次瀏覽 session 最多推論 3 次、間隔 ≥60 秒」的節流邏輯,是前端 `client/src/hooks/useIntentInference.ts:12` 的 `sessionStorage` 計數器——這是**純前端**防抖,任何直接對 `POST /api/trpc/sense.inferIntent`(或用腳本組 events payload)發送請求的呼叫者可以完全繞過,只受制於前述的 IP 級 300/15min 上限。

**影響**:因為完全不需要登入,攻擊面等同於任何能連上網站的人(含用腳本偽造 `events`/`summary` 陣列滿足 `events.length>=3` 門檻即可),都能在不建立帳號、不留下使用者身份的情況下反覆呼叫這個端點,每次呼叫都消耗一次真實 LLM API 額度(成本記在公司帳上)。目前唯一的煞車是共用的、非 LLM 特化的 300 req/15min IP 限流,對於使用代理輪替 IP 的自動化濫用幾乎沒有防禦力,且該限流器本身是給「一般 API」設計的寬鬆值,並非為「這個端點每次呼叫都真花錢」這個特性校準。

**建議**:
1. 把已定義但從未掛載的 `rateLimiters.llm`(60/15min)掛到 `/api/trpc/sense.inferIntent`(或更保守的值,因為完全匿名);評估是否也該掛到其他未受 `llm` tier 保護、但同樣會觸發真實模型呼叫的 `publicProcedure`。
2. 評估這個公開推論功能是否真的需要對「完全未登入」的訪客開放到能無限次呼叫的程度——若首頁引導流程只需要少量、有意義的推論次數,可以考慮加入伺服器端 session/cookie 級節流(不只是 client-side sessionStorage),或要求一個輕量匿名 session token 由伺服器核發並計數。
3. 若決定維持公開,至少應在後端補一個獨立於 `rateLimiters.api` 的呼叫計數(比照 `checkTrpcRateLimit` 的模式,以 IP 或匿名裝置指紋為 key),避免與其他一般 API 呼叫共用同一個 300 次額度桶。

---

## 3.【中 / billing】`orbConversationsRouter.appendMessages` 每次前端聊天回合都背景觸發一次額外 LLM 呼叫(intent 分類),且該呼叫的核心輸出已由 CC4 證實恆為空值——是被浪費掉的真實成本,且本身無獨立節流

**發現**:`appendMessages`(`server/routers/orbConversationsRouter.ts:418-515`)在寫入訊息後,對每次成功呼叫(只要能在這批 messages 裡找到一則 `role==="user"` 的訊息,:501-502)都會 fire-and-forget 呼叫 `orbConversationEnhancer.processConversationTurn(...)`(:504-511)。

追下去:`processConversationTurn`(`server/services/orbConversationEnhancer.ts:66-105+`)第一步(:76-81)就呼叫 `orbClarificationEngine.identifyIntent(...)`,而 `identifyIntent`(`server/services/orbClarificationEngine.ts:207-335`)內部有一段明確標註「LLM-backed intent classification」的區塊(:218-233),對 LLM 發起真實呼叫。也就是說,**每一次使用者在 `/agent` 分頁送出一則訊息、client 呼叫 `appendMessages` 持久化這一輪對話,後端就會在 `ai.chat` 本身的 LLM 呼叫之外,再多打一次獨立的意圖分類 LLM 呼叫**。

這條背景鏈的產出目前是被浪費的:`docs/research/CC4-remaining-orb-services.md`(發現 3)已逐行證實 `identifyIntent` 的 `primaryIntent` 欄位宣告後從未被賦值(`orbClarificationEngine.ts:213` 宣告、:264-276 兩個分支都沒有賦值),永遠是 `undefined`,寫進 DB 與回傳給呼叫方的都是空值。本檔在此基礎上新增的觀察是:**觸發這條「結果注定空」的 LLM 鏈路的入口,正是本檔案(`orbConversationsRouter.appendMessages`)的 fire-and-forget 呼叫,且這個呼叫沒有自己的節流或抽樣邏輯**——只要 `appendMessages` 被呼叫(每次 append 最多 20 則訊息一批,:422),只要批次裡有一則 user 訊息就會觸發,沒有「這個 conversation 最近已經分類過、跳過」之類的節流或去重。

**影響**:每一輪使用者聊天訊息,背後除了主要對話 LLM 呼叫外,還隱含一次「注定產出空值」的意圖分類呼叫——這是持續、與訊息量近乎 1:1 疊加的真實成本(token 用量),且產出的 `primaryIntent` 從未被任何下游消費者實際用上(`clarificationEngineTools.ts:33`、`orbConversationEnhancer.ts:85` 兩個消費點拿到的都是 `undefined`)。這比 CC4 原本定位的「契約不符/回傳空值」問題更進一步——從「有 bug」延伸到「這個 bug 目前正在持續花錢」。

**建議**:
1. 短期:先修 CC4 已指出的 `primaryIntent` 賦值缺漏(讓分類結果至少真的被使用),避免持續產生零效益的呼叫。
2. 中期:評估是否每一輪對話都需要重新做意圖分類——若同一 conversation 短時間內已分類過且無明顯話題轉變,可加入節流/快取(比照 `langsmith.ts` 已有的 60 秒 TTL cache 模式),降低背景呼叫頻率。
3. 在 `appendMessages` 或 `processConversationTurn` 入口加上與 `checkTrpcRateLimit` 同款的 per-user 節流,避免使用者短時間內狂送短訊息時背景 LLM 呼叫量不受控疊加。

---

## 4.【中 / northstar】`notes.ts`、`promptLibrary.ts`、`promptCollection.ts` 三檔的核心資料表均無 `creativeProjectId` 掛勾欄位,讀取一律是 user 級全量查詢——notes.ts 部分為 M4 已載的既知缺口,promptLibrary/promptCollection 屬未被既有文件涵蓋的同型延伸

**發現**:直接讀 schema 確認三張表的欄位:
- `project_notes_calendar`(`drizzle/schema.ts:487-538`)—— 全部欄位含 `userId`(:491)、`noteType`/`status`/`scheduledDate`等,**沒有任何 project/creativeProjectId 欄位**;對應地,`notes.ts` 的 `list`(:49-92)、`summary`(:96-156)、`exportIcs`(:161-202)三個查詢入口全部呼叫 `db.getProjectNotesByUser(ctx.user.id, 500)`(`server/db.ts:1628-1637`,WHERE 只有 `eq(userId, userId)`),回傳「這個使用者的全部筆記」,無法依專案篩選。這與 `docs/research/G1-video-cockpit.md:100,141` 和 `docs/research/M4-assets-goals-review.md:76-78`(「`vault.list`、`notes.list` 目前是 user 級全量查詢,無 `projectId` 參數」)已載的結論**一致且經本次直接讀檔重新驗證仍然成立**,非新發現。
- `prompt_library`(`drizzle/schema.ts:1781-1804`)——同樣只有 `userId`(:1785)+ 內容/分類/標籤欄位,**沒有 creativeProjectId**;`promptLibrary.ts` 的 `list`(:63-108)/`listPublic`(:111-159)/`getById`(:162-218)全部以 `userId`(或 `isPublic`)為唯一範圍,無專案維度。M4 文件(§3、§4.2)僅點名 `notes.list`/`vault.list` 需要補 `projectId` scope,**未提及 `promptLibrary`**——本檔案確認同一種缺口同樣存在於提示詞庫,屬於 M4 §4.2 範圍應該延伸涵蓋、但目前文件未列出的對象。
- `prompt_collection`(`drizzle/schema.ts:1852-1909`)——欄位含 `userId`/`visibility`/`teamId`(團隊共享用),**同樣沒有 creativeProjectId**;`promptCollection.ts` 的 `listMine`(:203-255)/`listTeam`(:261-320)分別以 user/team 為範圍,同樣無專案維度可篩。此檔連 M4 文件都未提及,是本次新確認的同型缺口第三例。

對照 M1(`docs/research/M1-project-spine-assembly.md` §6「防跑偏機制」第 1 條)明確要求「所有新增 procedure 一律以 `creativeProjectId`…作為必要輸入參數」作為單一專案主幹方案的紀律;M4(§0「一句話設計立場」)則把 `creativeProjectId` 定位為素材/目標/評論共用的「同一把鑰匙」。notes/promptLibrary/promptCollection 三張表目前完全在這把鑰匙之外運作——不是「掛錯」,而是「從未掛」,三者都停留在「user 級倉庫」而非「專案可過濾的素材」狀態,與 M4 診斷的「素材管理在資料模型上就不存在,只有素材倉庫」(M4 §1.1)是同一種缺口的三個實例。

**影響**:創作者在專案詳情頁無法看到「這個專案相關的筆記/腳本」「這個專案收藏的提示詞」,只能拿到帳號全量列表自己用肉眼比對——與 M4 診斷的核心產品缺口(「不會跑偏」需要每筆資料能回答「這屬於哪個專案」)完全對應。這不是安全漏洞,而是本波深挖確認的**產品架構缺口延伸範圍**:目前已知需要補 `creativeProjectId` 的清單應該是「`digital_asset_library` + `consistency_vault` + `project_notes_calendar` + `prompt_library` + `prompt_collection`」五張表,而非 M4 原文只列的前三張。

**建議**:
1. 若採納 M4 §4.2 建議的共用 helper(`server/lib/scopeToProject.ts`)方案,補齊清單時應把 `prompt_library`/`prompt_collection` 一併納入設計範圍,而非只修 `notes`/`vault`。
2. 兩張 prompt 表的「可選 `creativeProjectId`」設計應遵循 M4 §4.1 已定調的「不做強制,綁定是可選動作」原則,避免造成現有大量無專案脈絡的提示詞收藏被追溯要求分類的摩擦。
3. 短期不阻塞:三檔目前的 owner-scoped 查詢本身沒有安全問題(讀者只能看自己的資料),純粹是「專案視角缺席」的產品缺口,可與既有 M4 路線圖階段 0-2 一併排入,不需要獨立於既有規劃之外緊急處理。

---

## 5.【低 / injection】`langsmith.listRuns` 的 `search`/`tag` 篩選以字串拼接組成 LangSmith filter DSL,僅跳脫雙引號,未跳脫其餘運算子字元

**發現**:`listRuns`(`server/routers/langsmith.ts:317-354`)組 LangSmith 的 filter 查詢字串時:
```ts
if (input.search) filters.push(`search("${input.search.replace(/"/g, '\\"')}")`);   // :336-337
if (input.tag)    filters.push(`has(tags, "${input.tag.replace(/"/g, '\\"')}")`);   // :338-339
```
只把使用者輸入裡的 `"` 字元轉成 `\"`,其餘 LangSmith filter DSL 的保留字元(括號、逗號、`and`/`or`/`eq`/`has` 等運算子關鍵字)完全不做任何處理就直接嵌入查詢字串。理論上使用者可以在 `search`/`tag` 輸入內容裡構造出跳脫預期述詞邊界的片段(例如提前閉合 `search(...)` 再接自訂的 `and`/`or` 子句),讓最終送往 LangSmith API 的 filter 字串包含呼叫者原本不該能表達的查詢邏輯。

**影響**:由於發現 1 已經證實這個端點對任何登入使用者本來就無範圍限制地暴露全站 runs,這裡的 filter 注入**不構成額外的權限提升**(反正整個資料集本就已經對呼叫者開放),實際風險僅止於「呼叫者可以組出比原本 UI 預期更複雜/非法的查詢字串」,可能造成的後果是 LangSmith API 回錯誤(目前碼有 try/catch 吞掉,:350-352,不會 500 到使用者)或極端情況下查詢邏輯被繞過篩選條件——但因為底層資料本就無授權邊界,危害面有限。

**建議**:比照 `escapeLikePattern`(`server/db.ts:5501-5503`)的做法,為 LangSmith filter DSL 寫一個對應的跳脫/白名單驗證函式(或改用 LangSmith SDK 若有提供的結構化 filter 建構 API,避免手刻字串拼接),與發現 1 的授權修復一併處理。

---

## 6.【低 / other】`promptLibrary.ts`/`promptCollection.ts` 的 `update`/`delete`/`toggleFavorite`/`setVisibility` 系列 mutation 採「先 SELECT 驗證 owner、再用純 id 執行 UPDATE/DELETE」的非原子模式,與同批次 `orbConversationsRouter.ts` 的「UPDATE/DELETE 直接把 userId 寫進 WHERE」模式不一致

**發現**:
- `promptLibrary.update`(`server/routers/promptLibrary.ts:243-266`)先用 `and(eq(id,id), eq(userId, ctx.user.id))`(:255)查一次確認擁有權,但真正執行的 `db.update(promptLibrary).set({...fields}).where(eq(promptLibrary.id, id))`(:260-263)**只用 id**,沒有重複比對 `userId`。`delete`(:269-303)的模式相同(:275-278 檢查、:283 純 id 刪除)。
- `promptCollection.ts` 的 `update`(:402-434)、`delete`(:437-467)、`toggleFavorite`(:470-502)三個 mutation 是同一個模式:SELECT 帶 `userId` 條件驗證(如 :413-422),但最終的 `db.update(...)`/`db.delete(...)` 一律只用 `eq(id, id)`(如 :429-432、:463-465、:497-500)。
- 對照組:同一批次稽核的 `orbConversationsRouter.ts` 的 `update`(:283-291)、`delete`(:326-341)、`clearMessages`(:538-554)全部把 `eq(userId, ctx.user.id)` 直接寫進最終執行的 UPDATE/DELETE 的 WHERE 子句本身,不依賴「先前有做過 SELECT 檢查」這件事,是更原子、更具縱深防禦的寫法。

**影響**:目前這兩張表(`prompt_library`/`prompt_collection`)都沒有任何「轉移擁有權」的 mutation,`userId` 欄位在正常流程下不可變,因此 SELECT-then-mutate 之間不存在真正可被觸發的競態窗口——**本檔案驗證後判斷這在現狀下不是可利用的漏洞**。但這是比較弱的縱深防禦寫法:任何未來重構(例如把 `update`/`delete` 邏輯抽成共用函式被其他呼叫端引用、或不小心刪掉前面的 SELECT 檢查區塊)都會直接產生 IDOR,而不會被最終的 SQL 述詞攔下來——即「安全性完全依賴呼叫順序寫對,而非資料庫層的述詞本身」。

**建議**:低優先度、可併入下次觸碰這兩個檔案的 PR 一併處理:把最終 `db.update(...)`/`db.delete(...)` 的 `.where(eq(id, id))` 一律改成 `.where(and(eq(id, id), eq(userId, ctx.user.id)))`,並用 `affectedRows === 0` 判斷 NOT_FOUND(比照 `orbConversationsRouter.update`:292-299 的既有寫法),讓兩個檔案內部、以及跨檔案的寫法一致。

---

## 7. Negative Results(已核對、無問題的部分)

- **`orbConversationsRouter.ts` 的 IDOR 防護整體紮實**:`loadOrLazyCreateConversation`(:75-157)明確處理「PK 存在但屬於別人」→ `FORBIDDEN`(:93-98)、併發 insert 撞鍵的 idempotent 回讀(:133-147)兩種邊界情形,並有專屬測試 `orbConversationsLazyCreate.test.ts` 鎖住四條不變式;`getMessages`/`delete`/`clearMessages` 全部先做 owner-scoped 存在性檢查才動作。除發現 3(背景 LLM 成本)外未發現其餘問題。
- **`promptLibrary.ts` 的 IDOR 修補歷史扎實且有測試鎖定**:`getById` 的 RBAC 旗標 ON/OFF 兩條分支(:173-217)、`incrementUseCount` 的 owner-or-public 述詞(:339-353)均有對應測試(`promptLibraryEnforcement.test.ts`、`promptLibraryIdor.test.ts`)驗證過,且 `ENABLE_DATA_RBAC` 目前預設 OFF(`server/services/authz/resourceAccess.ts:161-162`),生產環境現況等同原本嚴格的 owner-only 行為,未發現旗標接線錯誤。
- **`promptCollection.ts` 的 team_shared 存取控制正確**:`setVisibility`(:541-586)在切換成 `team_shared` 前一定呼叫 `requireTeamMember`(:574)驗證呼叫者確實是目標 team 成員,`listTeam`(:261-320)指定 `teamId` 時同樣先驗證成員身份(:274)才查詢,未發現繞過路徑。
- **未發現 SQL 注入**:六檔中所有動態 SQL 只出現在 `promptLibrary.backfillAssetLinks`(:397-454,adminProcedure,SQL 內容全部是固定 join,無使用者輸入插值)與 `orbConversationsRouter`/`promptCollection`/`promptLibrary` 的 `sql\`... + ${col} ...\`` 原子遞增寫法(如 useCount/messageCount),均為 drizzle 參數化寫法,未見字串拼接進 SQL 主體。
- **`notes.ts` 的 `update`/`delete` 本身有做 owner 檢查**(:266-269、:301-304),`db.ts` 的底層 `updateProjectNote`/`deleteProjectNote`(:1666-1682)雖如發現 6 同型的非原子模式,但同樣因 `userId` 不可變而非目前可利用的漏洞。
- **`scriptJsonSchema` 的邊界驗證(AIDV-652,`notes.ts:15-44`)** 正確限制序列化大小(256KB)與巢狀深度(20 層),未發現繞過方式(superRefine 對所有寫入路徑生效,`create`/`update` 皆套用同一 schema)。
- **`sense.ts` 的 LLM 輸出走嚴格 `json_schema`(`strict:true`,:210-285)**,`extractMessageJson`/`extractJsonObjectFromText` 對非預期格式有 fallback(:329-341),未發現因惡意 `meta` 內容導致的伺服器端錯誤或資訊洩漏——注入風險僅止於「使用者可能操縱回傳給自己的推論結果內容」,自我導向、無跨使用者影響,未列為獨立發現。
- **旗標鎖住檢查**:六檔中唯一明確的功能旗標是 `promptLibrary.getById` 依賴的 `ENABLE_DATA_RBAC`(:173),已於上方確認預設 OFF、行為符合預期;`langsmith.ts`/`sense.ts`/`orbConversationsRouter.ts`/`notes.ts`/`promptCollection.ts` 均未發現被功能旗標鎖住但旗標從未開啟的死路徑。
- **死碼**:未在六個 router 檔案本身發現明顯死碼(未使用的 export、恆假分支);`langsmith.ts:200-208` 的 `status` procedure 有一個建構後即棄用的 `runs` 陣列(僅用於觸發一次連線測試),屬極輕微的命名/寫法瑕疵,不影響功能,未列為正式發現。

---

## 附:嚴重度排序總覽

| # | 嚴重度 | cluster | 檔案:行號 | 一句話 |
|---|---|---|---|---|
| 1 | 嚴重 | security-idor | langsmith.ts:190-946 | 8/9 procedure 用 protectedProcedure,任何登入者可讀/匯出全站所有使用者對話原文 |
| 2 | 高 | billing | sense.ts:355(+ rateLimiter.ts:54-63,index.ts:555) | 公開匿名端點直接觸發真實 LLM 呼叫,無專屬節流,`llm` tier 定義了但從未掛載 |
| 3 | 中 | billing | orbConversationsRouter.ts:504 → orbConversationEnhancer.ts:76 → orbClarificationEngine.ts:218-233 | 每輪聊天背景多打一次分類 LLM,產出依 CC4 已證恆為空值,純浪費且無節流 |
| 4 | 中 | northstar | notes.ts / promptLibrary.ts / promptCollection.ts(schema 全檔) | 三表均無 creativeProjectId,notes 為 M4 已載缺口重驗證,promptLibrary/promptCollection 為新確認同型延伸 |
| 5 | 低 | injection | langsmith.ts:334-340 | listRuns 的 search/tag 篩選字串拼接進 LangSmith filter DSL,僅跳脫雙引號 |
| 6 | 低 | other | promptLibrary.ts:260-263,283 / promptCollection.ts:429-432,463-465,497-500 | update/delete 系列 mutation 最終 SQL 未重複比對 userId,依賴前置 SELECT 檢查,現狀非可利用但縱深防禦較弱 |
