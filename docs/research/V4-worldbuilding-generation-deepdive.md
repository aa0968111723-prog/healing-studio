# V4 — 世界觀/分鏡生成鏈逐行深挖（對抗式，wave V）

- 產生日期：2026-07-03
- 依據 commit：`1b711050`（原指示標註 `7f4417da`，該 hash 於本 repo 不存在，已改記錄實際 HEAD）
- 波次：**逐檔深挖 wave V**
- 範圍：`server/services/worldbuildingGeneration.ts`（全 459 行）、`server/routers/worldStoryboard.ts`（全 711 行）、`server/routers/worldbuilding.ts`（全 814 行）、`server/services/compositionSuggestionService.ts`（全 232 行）、`shared/qualityCoachEngine.ts`（全 1033 行）、`shared/worldbuilding-generation-tasks.ts`/`worldbuilding-agent-workflow.ts`/`worldbuilding-result-mapping.ts`/`worldbuilding-progress.ts`/`worldbuilding-readiness.ts`（節選）、`shared/worldbuilding-animation.ts`（`planAnimationPipeline`/`buildFramePrompt`/`seedStoryboardSkeleton` 段落）、`server/db.ts`（對應寫入函式）、`server/_core/trpc.ts`（procedure 分級）。
- 方法：先讀 `G2-worldbuilding-detail.md`、`Q1-scene-assembly-editor-spec.md`、`M1-project-spine-assembly.md`、`01-features.md §1.6`、`H1-model-costs.md §6`（零扣點主題）避免重複；逐行實讀上述檔案 + 交叉驗證 db.ts 對應函式 + 抽查既有測試是否真的覆蓋到問題路徑。
- 標記約定：【新發現】本波首次證實；【延伸已知】既有文件已提過主題，本波補上本鏈具體實例/證據；【已知】純引用不重複展開。

---

## 1. 【新發現／高／正確性＋架構斷點】`createFromSegments`/`queueForVideo` 產生的 storyboard 恆無 frames，讓 planPipeline 與生成任務清單都算出「零工作量」

**證據**：`server/routers/worldStoryboard.ts:465-482`（`createFromSegments`）與 `:567-582`（`queueForVideo`）建立的每個 `StoryboardScene` 一律 `frames: []`、`audioClips: []`（唯一填的是 title/actionDescription/characterBeats）。而 `shared/worldbuilding-animation.ts:637-641` 的 `planAnimationPipeline` 對每個 scene 是 `for (const frame of scene.frames)` 才產生 t2i/refine/i2v 步驟（:648-726），`for (const clip of scene.audioClips)` 才產生 music/voice/sfx 步驟（:730-807）；`allVideoStepIds.length > 0` 才產生最終合成步驟（:834）。三個條件全部依賴 frames/audioClips 非空。全 repo 只有 `seedStoryboardSkeleton`（:1402 起，實際塞 frame 在 :1554）會真的填 frames。同一個「零工作量」缺陷也感染 `shared/worldbuilding-generation-tasks.ts:35-41`（`buildWorldbuildingGenerationTasks` 的 `for (const sb of storyboards) for (const sc of sb.scenes) for (const fr of sc.frames)` 三層迴圈同樣吃不到任何 frame）。

**影響**：「Director 腳本 → 分鏡 → 動畫管線」這條 M1/G2 認定的橋接路徑（`createFromSegments`/`queueForVideo`，router 註解自稱 AIDV-151「讓 VideoStudio 可逐鏡生成」），在資料層面從一開始就是空的——即使 M1 提議的 `storyboardPipelineRunner` 真的被實作出來，對這兩條路徑產生的 storyboard 按「編排動畫管線」也只會算出 0 步驟、$0 估價，因為根本沒有 frame 可轉成生成任務。這比 G2 已指出的「plan 工具名無 server 對應」更底層：即使把執行器接上，這批 storyboard 依然無事可做。而 G2/Q1 也已證實 AnimationStudio 沒有任何「幫既有幕新增 frame」的 UI（Q1 §2 的「逐幕組裝編輯器」正是要補這塊，但目前僅是規格文件、未落地）——所以這兩條 hand-off 路徑目前是**資料死路**，不是「缺執行器」而已。

---

## 2. 【新發現／高／正確性】`updateJob` 的 `updateWorldStoryboardJobAtomic` 用未跳脫的 JSON path 組字串，遇到 `planAnimationPipeline` 真實 stepId 格式必定丟 MySQL 錯誤

**證據**：`server/db.ts:3255-3267`：
```ts
const jsonPath = `$.${stepId}`;
...
sql`UPDATE world_storyboards SET jobsJson = JSON_SET(COALESCE(jobsJson, '{}'), ${jsonPath}, ...)`
```
`stepId` 直接字串內插進 JSON path，沒有雙引號跳脫。而 `planAnimationPipeline`（`shared/worldbuilding-animation.ts`）產生的**所有** stepId 都帶冒號與連字號：`t2i:${scene.id}:${frame.id}`（:648）、`refine:${scene.id}:${frame.id}`（:684）、`i2v:${scene.id}:${frame.id}`（:706）、`music:${scene.id}:${clip.id}`（:740）、`voice:${scene.id}:${clip.id}`（:763）、`sfx:${scene.id}:${clip.id}`（:789）、`compose-audio:${scene.id}`（:811）。MySQL JSON path 的 keyname 只接受 ECMAScript identifier（字母/數字/底線/`$`）或雙引號包起來的字串；冒號與連字號都不合法，未加引號會直接拋 `ER_INVALID_JSON_PATH`（3143）。

**為何沒被抓到**：`server/routers/__tests__/worldStoryboardQueue.test.ts:19-27` 把 `updateWorldStoryboardJobAtomic` 整個 mock 掉，測試用的 `stepId` 一律是良性的 `"seg-a"`/`"seg-b"`（:229-267，無冒號無連字號），從未用過 `planAnimationPipeline` 真實產出的 stepId 格式跑過這條寫入路徑。

**影響**：G2 已指出 `updateJob`「除測試外 0 呼叫者」；本波證實：就算未來接上執行器（M1 提議）依 plan 的 stepId 呼叫 `updateJob` 回寫進度，**第一次呼叫就會在 DB 層炸掉**——這不是「還沒接」而是「接了會壞」，且現有測試的 happy-path stepId 掩蓋了這個問題，必須連同軌 B 實作一起修（改用 `JSON_QUOTE`/物件 key 動態組 SQL，或直接用 Drizzle 的 jsonb 操作而非手刻 path 字串）。

---

## 3. 【新發現／高／安全（Broken Access Control）】`checkConsistency` 對 `timelineFrameId` 完全無 ownership 檢查，任何登入者可覆寫他人時間軸幀的一致性欄位

**證據**：`server/routers/worldbuilding.ts:688-719`（`checkConsistency`）直接 `db.updateTimelineFrameConsistency(input.timelineFrameId, result)`，中間沒有任何 `db.getTimelineFrame` + `row.userId !== ctx.user.id` 檢查（對照同檔案其餘 15 個端點幾乎都有這行）。而 `server/db.ts:3328-3338`（`updateTimelineFrameConsistency`）的 SQL `WHERE` 子句只有 `eq(timelineFrames.id, frameId)`，**完全沒有 userId 過濾**。`consistencyCheckRequestSchema`（`shared/worldbuilding-timeline.ts:108-111`）的輸入只是 `{ timelineFrameId: number, checkTypes?: [...] }`，任何登入使用者傳入任意數字 id 即可觸發寫入。

**影響**：雖然 G2 已指出這條 procedure 本身是硬編碼 mock（回應內容固定），但**授權層的洞是獨立問題**——任何使用者可對「猜到／列舉到」的任意 `timelineFrameId`（跨帳號）發動寫入，覆蓋別人時間軸幀的 `consistencyCheckJson`。目前因為回傳內容固定（無使用者輸入回顯進 DB），實害有限，但這是一個真正的 IDOR 寫入漏洞，一旦這條 mock 換成真實分析（寫入使用者可控內容，或未來這條路徑被複用在別處）風險會放大。修法：比照同檔案其他端點，先 `db.getTimelineFrame` 拿 row 驗證 `row.userId === ctx.user.id` 才允許更新。

---

## 4. 【新發現／中／安全】`uploadTimelineFrame`、`saveComposition` 同樣缺 ownership 檢查，形成同檔案內「部分端點嚴謹、部分端點完全不查」的不一致模式

**證據**：
- `uploadTimelineFrame`（worldbuilding.ts:643-673）拿 `input.storyboardId` 直接 `db.createTimelineFrame`，從未驗證該 storyboardId 是否屬於 `ctx.user.id`（沒有呼叫 `db.getWorldStoryboard` 做 ownership check）。
- `saveComposition`（worldbuilding.ts:753-776）拿 `input.worldId`/`input.storyboardId` 直接 `db.createSceneComposition`，同樣沒有驗證 worldId 屬於呼叫者。

對照組：同檔案 `get`/`update`/`delete`/`queryEntities`（部分）/`exportFull`/`getCompositionSuggestions`（:799-802 有 `world.userId !== ctx.user.id` 檢查）都嚴謹地做了 ownership 檢查。

**影響**：實際外洩面有限（因為讀取端 `listTimelineFrames`/`listCompositions` 都同時用 `storyboardId/worldId + userId` 兩個條件過濾，攻擊者插入的偽造列只會回顯給攻擊者自己），但仍是：(a) 可對任意存在的他人 `storyboardId`/`worldId` 掛入資料造成污染、列舉他人 id 是否存在（FK 若失敗會報錯，等於 id 探測 oracle）；(b) 這是同一支 router 檔案內「三個端點漏查、其餘全部嚴查」的不一致模式，屬於防禦性程式撰寫的系統性疏漏，非單一個案。建議統一補上 `loadFramework`/`getWorldStoryboard` ownership check（`worldStoryboard.ts` 已有現成的 `loadFramework` helper可仿效）。

---

## 5. 【新發現／高／正確性，資料遺失風險】世界觀 JSON 欄位全走「整欄覆寫、無版本檢查」的盲寫模式，AI 生成寫入與前端 debounce 自動存檔之間仍有競態窗口

**證據**：`server/db.ts:3175-3185`（`updateWorldbuildingFramework`）純粹 `db.update(...).set(data).where(eq(id))`，無 `updatedAt`/version 欄位做樂觀鎖；`worldbuildingGeneration.ts:372-378`（`generateCharacter` procedure）是「讀一次 world.charactersJson → LLM 跑最長 60 秒（:172-221 `withTimeout(...,60_000,...)`）→ 用讀到的舊陣列 +1 筆新角色整欄覆寫寫回」的 read-modify-write。前端 `AnimationStudio.tsx:5462-5496`（`handlePatchWorld`）是「600ms debounce → 整包 15 個 JSON 欄位一起 PATCH」。AIDV-198（已修復，`AnimationStudio.tsx:5499-5518` 的 `onSuccess` 已把生成結果 merge 回本地 draft）縮小了競態窗口，但**沒有消除**：若使用者在 AI 生成呼叫完成的那一刻（`generateCharacter` mutation 的網路回應抵達、`onSuccess` 尚未把新角色併入本地 `draft` 之前）恰好觸發了另一次編輯（例如同時改了世界描述），該次 debounce 存檔會用「尚未包含新角色」的 draft 整欄覆寫 `charactersJson`，把伺服器端剛寫入的 AI 生成角色蓋掉——使用者會看到 UI 顯示新角色（因為本地 state 之後仍會 merge 顯示），但下一次重新整理頁面，該角色其實已經在資料庫消失（除非使用者之後又觸發了一次 debounce 存檔把當時已經 merge 好的 draft 存回去）。窗口比修復前窄很多（僅剩「LLM 回應抵達到 onSuccess 執行」之間的極短時間），但架構性成因（無版本鎖、整欄覆寫）沒解決，對 `scenesJson`/`styleProfilesJson`/`musicThemesJson` 等所有走同一支 `updateWorldbuildingFramework` 的欄位都適用。

另外，`db.ts` 這批函式開頭清一色 `if (!db) return;`——`updateWorldbuildingFramework`（:3179-3180）DB 連線異常時**靜默 no-op**、不拋錯，但 `worldbuildingGeneration.ts` 的 `generateCharacter`/`generateScene` procedure 並未檢查這個寫入是否真的發生，LLM 呼叫成功即回傳 `{ character }` 給前端顯示成功 toast——若當下資料庫短暫不可用，使用者會看到「生成成功」卻完全沒有落庫，且無任何錯誤訊號。

**影響**：延伸/深化 AIDV-198 已知主題，但指出該修復只是「縮小視窗」不是「消除競態」，根因（無 optimistic concurrency control）仍在；並新增「DB 不可用時的假成功」這個獨立風險點。

---

## 6. 【新發現／中／架構完整性】`mapGenerationResultToWorldbuildingPatch` 是完全孤兒的「回寫地圖」——連自己的邏輯層都沒人呼叫

**證據**：全 repo 搜尋 `mapGenerationResultToWorldbuildingPatch`/`worldbuilding-result-mapping`，唯二命中是 `shared/worldbuilding-result-mapping.ts`（定義本身）與 `tests/unit/shared/worldbuilding-result-mapping.test.ts`（單元測試）。`server/` 與 `client/` 皆無任何 import。

**影響**：這比 G2 已指出的「`execute_worldbuilding_task(_batch)` 的 `internal_model` 模式回『尚未啟用』」更深一層——G2 講的是「執行層沒接」，本波證實：**就算執行層接上了，把生成結果（imageUrl/videoUrl）轉換成該寫回 `character.referenceLibrary`/`scene.establishingShotUrl`/`storyboard.frames`/`storyboard.audioClips`/`world.uploadedAssets` 的映射邏輯也已經寫好、測過，卻從未被任何呼叫端使用**。也就是說「世界觀批次生成→寫回世界觀 JSON」這條回寫路徑，從「執行器」到「執行結果映射」到「實際落庫」三層都各自獨立缺失，且中間層（映射函式）是唯一已經寫好但被晾在一邊的部分——最容易優先接上的一塊。

---

## 7. 【新發現／中／成本控管，延伸已知「LLM 零扣點」主題】本鏈 LLM 端點不只不扣點，部分還缺乏既有的通用限流層級

**證據**：`H1-model-costs.md §6` 已確立「光球/導演/精靈 LLM 呼叫全部 0 pts」的既有主題。本波在世界觀生成鏈補上具體實例並發現一個更嚴重的組合：`server/_core/trpc.ts:151`（`brainProcedure`）僅含 `requireBrain`，沒有任何速率限制；只有再包一層 `aiChatProcedure`/`generationProcedure`/`audioGenerationProcedure`（:177-182）才有 20/5/10 次每分鐘限制。`worldbuildingGeneration.ts:341,383,425`（`generateCharacter`/`generateScene`/`generateStoryboard`）全部直接用裸 `brainProcedure`，**不套用任何速率限制**——`generateCharacter`/`generateScene` 各觸發一次最長 60 秒的 LLM 呼叫（:172-221 `withTimeout`），使用者可無限併發呼叫。更甚者，`worldbuilding.ts:796`（`getCompositionSuggestions`）用的是**連 `brainProcedure` 都不是**的裸 `protectedProcedure`（連 `ctx.brain` 都沒注入，`compositionSuggestionService.ts` 內 `invokeLLM` 呼叫也確實沒有帶入任何 `model`/brain 參數，等同繞過使用者的引擎設定），一樣是 0 扣點、0 限流、60 秒逾時（`compositionSuggestionService.ts:200-220`）。

**影響**：這是「LLM 完全不扣點」既有主題在世界觀鏈的具體案例，但額外指出：這幾個端點連其他 LLM 端點都有的「共用 20/min 節流」都沒有套用，是本鏈特有、比一般已知情況更寬鬆的成本 DoS 面——每次呼叫在使用者測還是免費，但背後有真實 LLM API 費用（60 秒逾時代表允許相對重的請求），無任何節流閘門。

---

## 8. 【新發現／低／正確性】`qualityCoachEngine.ts` 的「場景」維度關鍵字表把常用單字「在」列為命中詞，直接牴觸該檔自述的保守命中原則

**證據**：`shared/qualityCoachEngine.ts:222`（`image.scene.keywords`）與 `:293`（`video.scene.keywords`）的關鍵字陣列第一項都是單一漢字 `"在"`。`parseDimensions`（:522-538）判斷方式是 `entry.keywords.find(kw => lower.includes(kw.toLowerCase()))`——純 substring 比對。中文「在」是極高頻字，出現在「現在」「正在」「自在」「存在」「在意」「在乎」等大量與「場景/地點」完全無關的詞裡；只要使用者輸入含有任何一個帶「在」的詞，`scene` 維度就會被誤判為「已命中」。這與檔案開頭的設計原則（:187-190）「關鍵字刻意過於保守——寧可漏，不可錯命中：給使用者錯誤的『你已寫了風格』會比『你還沒寫風格』更傷信任」直接矛盾——`scene` 是核心 4 維度之一（權重 15/100，`DIMENSION_WEIGHTS.scene = 15`，:549），一旦被系統性誤判為命中，`scorePrompt`/`rewritePrompt`/`detectStruggle` 都會低估「缺場景」的頻率，使用者實際上完全沒描述場景也可能拿到偏高分數、且不會被建議補場景。

**影響**：純函式邏輯錯誤，會系統性弱化這個「補洞版」品質教練引擎（本檔案本身就是為了修正舊版 char-Jaccard 偏誤而寫）在 image/video 兩個模態的核心判準之一；修法很直接（拿掉單字 `"在"`，換成 `"在...(具體地點/介系詞短語)"` 這類至少 2 字以上、語意更綁定地點的詞，或乾脆移除、改用其他關�— keywords 已有 `"窗台"`「海邊」等具體詞可承擔）。

---

## 9. 【延伸已知／中】`generateStoryboard` 名不符實、`checkConsistency` 為 mock——本波重新確認且補上呼叫鏈細節

G2 §3.2 已指出 `worldbuildingGeneration.generateStoryboard`（:425-458）不呼叫 LLM，只 insert 一列 `scenesJson: []` 的空分鏡；`worldbuilding.checkConsistency`（:688-719）是硬編碼 mock。本波逐行確認無誤，未發現與 G2 描述不同之處，僅新增：這兩個端點都用 `.mutation` 回傳固定/空結果，**前端沒有任何方式分辨「LLM 生成失敗降級」與「本來就是空殼設計」**——`generateStoryboardMutation`（AnimationStudio.tsx:5520-5529）收到 `{storyboardId}` 一律 toast「分鏡已生成」成功，用詞與真正 AI 生成無異，對使用者造成錯誤心智模型（以為敘述已經被理解並轉成分鏡結構）。

---

## 10. 【新發現／低／程式碼異味】`worldbuilding-generation-tasks.ts` 把整條 prompt 字串當成 `uid()` 的 id 參數

**證據**：`shared/worldbuilding-generation-tasks.ts:43`（`uid("voice", v)`）與 `:44`（`uid("music", m)`），其中 `v`/`m` 是 `productionPackage.json.voiceDirections`/`musicPromptSeeds` 陣列裡的**完整字串內容**（旁白台詞、配樂描述），並非穩定 id。對照同檔角色/場景任務正確地傳 `c.id`/`s.id`（:25,33）。`uid = (prefix, id) => \`${prefix}-${id || random}\`` 的設計意圖顯然是接受一個短 id；這裡誤用內容當 id，會產生極長、含標點/空白的「id」字串。

**影響**：目前下游消費（`WorldbuildingAgentExecutionPanel.tsx`/`buildAgentWorkflowFromGenerationTasks`）用 `idx`（陣列位置）重新組 step id，沒有直接依賴這個畸形 id，所以暫無功能性影響，但若未來任何程式碼把這個 id 當 key 做去重/查找（例如兩筆一模一樣的配樂描述會產生相同的「id」造成 React key 衝突或去重誤判），會是一個等著被踩的地雷。

---

## 11. 【新發現／低／狀態機gap】`updateJob` 對「首次寫入某 stepId」完全跳過狀態機檢查

**證據**：`server/routers/worldStoryboard.ts:331-340`：
```ts
const currentStatus = existingJobs[input.stepId]?.status as ...;
if (currentStatus !== undefined && !canTransitionSegment(currentStatus, input.status)) {
  throw new TRPCError(...);
}
```
只有「該 stepId 之前已經有紀錄」才會做 `canTransitionSegment` 驗證；第一次寫入任何 stepId 時 `currentStatus === undefined`，不管 `input.status` 傳什麼（哪怕是 `SEGMENT_STATUSES` 列表中代表終態的值，如直接跳到 `completed`/`failed`）都會被接受。

**影響**：與 G2 指出的「`updateJob` 除測試外 0 呼叫者」放在一起看，這是「當它真的被接上執行器使用時」的邊角案例：一個惡意或有 bug 的呼叫者可以讓任何 step 一開局就是終態，繞過原本設計的「queued→running→completed/failed」單向流轉保護。範圍小但值得在軌 B 落地時一併修（例如限定首次寫入只能是 `queued`/`running`）。

---

## 12. 綜合：這條鏈離「分鏡→逐幕可執行一條龍」還差什麼（回應 M1 判斷）

M1 已把「軌 B：pipeline runner」列為核心里程碑，本波證實實際缺口比 M1 描述的更深，是**四層獨立斷點疊加**，任一層不修都無法打通：

1. **資料源頭**：`createFromSegments`/`queueForVideo`（Director 腳本→分鏡的兩條主要橋接路徑）產生的 scene 恆無 frames/audioClips（本文 §1）——這是 M1 完全沒討論到的層次，M1 假設「資料形狀已經是三軌對齊的形狀，不必重新設計 schema」，但沒注意到**只有 `seedSkeleton` 這一條建立路徑會真的填資料**，另外兩條產生的是空殼。
2. **規劃層**：`planAnimationPipeline` 純函式本身沒問題，但輸入是空殼時輸出也是空殼（0 步驟）。
3. **執行層**：G2 已證實的「plan 工具名無 server 對應」；即使接上 `executeOrbToolCalls`（M1 提議），
4. **回寫層**：`updateJob` 的 JSON path 組字串一寫入真實 stepId 就會炸（本文 §2）；就算修好，生成結果要轉譯回 storyboard/worldbuilding JSON 欄位的映射邏輯（`mapGenerationResultToWorldbuildingPatch`）雖然寫好但零呼叫端（本文 §6）。

換句話說：M1 提出的「軌 B pipeline runner」新檔如果只解決「執行層」，跑起來會在「資料源頭全空」與「回寫 JSON path 語法錯誤」兩處立即卡住——這兩個問題都不在 M1 現有討論範圍內，需要一併排進同一個里程碑，否則軌 B 落地後第一次真實試跑（無論走 seedSkeleton 生成的 storyboard 還是 createFromSegments 生成的）都會馬上暴露新錯誤。

---

## 未讀完 / 範圍外

- `server/services/spiritTools/qualityCoachTools.ts` 只讀了前 60 行（工具包裝層），完整四個工具（diagnose/rewrite/compare/getTemplates）的輸入驗證細節未逐行覆核。
- `shared/worldbuilding-production-package.ts`（62 行，`voiceDirections`/`musicPromptSeeds` 實際產生邏輯）、`shared/worldbuilding-readiness.ts`（51 行）、`shared/worldbuilding-actions.ts`（57 行）、`shared/worldbuilding-inspiration.ts`（58 行）、`shared/visual-inspiration-selector.ts`、`shared/model-capability-registry.ts` 只讀了型別/開頭，未逐行核對內部計算邏輯是否有進一步 bug。
- `shared/worldbuilding-progress.ts` 只讀了前 120 行（權重表 + `isCharacterRich` 開頭），`scenes`/`style`/`music`/`voice` 四個類別的評分函式與整體 `calculateWorldbuildingProgress` 聚合邏輯未讀。
- `shared/worldbuilding-animation.ts` 全檔 1700+ 行僅針對性讀了 `planAnimationPipeline`（:616-870 附近）、`buildFramePrompt`（:440-560 附近）、`seedStoryboardSkeleton` 局部（:1100-1720 附近的挑選函式與部分 skeleton 生成邏輯），`validateStoryboardTimeline`、`summarizeStoryboardForPrompt`、`collectActiveLoraIds`、`buildMusicPrompt` 等其餘函式未逐行核對。
- 未驗證 `checkTrpcRateLimit`（`server/_core/trpcRateLimit.ts`）本身的實作細節（例如是否有全站預設下限會意外套用到裸 `brainProcedure`）。
- 未對 `db.ts` 中與本鏈相關函式之外的其餘 200+ 個 `if (!db) return` 做系統性盤點（本文僅指出本鏈兩個具體受影響函式）。
