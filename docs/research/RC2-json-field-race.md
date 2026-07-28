# RC2 — JSON 欄位 read-modify-write 競態

- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核範圍：world_storyboards.jobsJson/scenesJson、timeline_frames、creative_projects、director session JSON 等大 JSON 欄位的讀改寫路徑

## 方法與既有結論對照

先讀 `docs/research/V4-worldbuilding-generation-deepdive.md`、`docs/research/X1-project-spine-deepdive.md`、`docs/research/X8-worldbuilding-router-deepdive.md`，避免重複「新發現」。凡本次逐行覆核仍成立者，標記「延伸已知／已確認現況」並附精簡引用；未在既有文件出現的窗口才標「新發現」。

已知(prior，依任務指示不重複展開，僅供對照)：`deductUserPoints`/`refundUserPoints` FOR UPDATE 原子 + `atomicClaimJobRefund` CAS（健康）；`worldStoryboardRouter.updateJob` 對 `jobsJson[stepId]` 讀改寫的 app 層合併是 stale-read（W1，見下方「延伸已知」一節簡述現況）；`toggleVisibility` 獎勵 TOCTOU；`admin.updateUserQuota` 絕對值 SET 無 CAS；4-worker 只有 process-local boolean 鎖。

---

## 發現 1（高／新發現＋延伸已知）— `worldbuildingFrameworks.charactersJson`/`scenesJson` 的 AI 生成寫入是「讀取→LLM 生成（可達數十秒）→整欄覆寫」的無鎖 read-modify-write，且會與同表其餘 12 個 JSON 欄位的前端 debounce 整包存檔互撞

**cluster**: read-modify-write / lost-update
**hasProtection**: 無（`worldbuildingFrameworks` 整張表沒有 `version`/`updatedAt` 樂觀鎖欄位；寫入是無條件 `UPDATE ... WHERE id=?`）

**競態窗口（行號）**

- `server/services/worldbuildingGeneration.ts:350`（`generateCharacter` 讀 `world.charactersJson`）→ `:359-370`（呼叫 storyteller LLM，`withTimeout` 上限 60s，見同檔 `:172-221` 的 `withTimeout(...,60_000,...)` 慣例）→ `:372-378`（`characters = [...world.charactersJson, character]` 後整欄 `updateWorldbuildingFramework({ charactersJson: characters })` 覆寫）。
- 同模式：`:391-423`（`generateScene`，讀 `:392`、LLM `:401-412`、覆寫 `scenesJson` `:414-420`）。
- 寫入函式本身：`server/db.ts:3175-3185`（`updateWorldbuildingFramework`）純 `db.update(worldbuildingFrameworks).set(data).where(eq(id))`，無版本檢查、無 `JSON_ARRAY_APPEND`。
- 前端整包覆寫路徑：`client/src/pages/AnimationStudio.tsx:5462-5496`（`handlePatchWorld`，600ms debounce 後把 `characters/scenes/objects/linkedModelIds/styleProfiles/musicThemes/...` 等 15 個欄位一次性 PATCH 進 `worldbuilding.update`，見 `server/routers/worldbuilding.ts:155-209`，逐欄位 `charactersJson: p.characters`/`scenesJson: p.scenes` 全量取代，非 merge）。

**交錯後果**

1. **同一 AI 生成端點自己跟自己競速**：使用者對同一世界觀連續（或雙擊）呼叫兩次 `generateCharacter`（或分別呼叫 `generateCharacter`/`generateScene` 但共用 `charactersJson`/各自欄位不衝突則無事，此處指同欄位）。兩次呼叫都在 `:350` 讀到同一份舊 `charactersJson`（長度 N），LLM 各自跑完後都算出「舊陣列 + 1 筆新角色」（長度 N+1），先寫入者的角色會被後寫入者的「舊陣列+1」整欄覆寫掉——後者的 `updateWorldbuildingFramework` 呼叫看不到前者剛寫入的角色，寫回去的陣列仍是「N+1」，但那 1 筆是後者自己生成的，前者生成的角色永久消失於資料庫，即使 API 回應對兩次呼叫都回傳 `{ character }` 顯示成功。因為 LLM 呼叫窗口可達數十秒，這不是理論性競態，是高機率在「AI 批次產生多名角色」這種正常使用情境下觸發。
2. **AI 生成 vs. 使用者編輯 debounce 存檔**（`docs/research/V4-worldbuilding-generation-deepdive.md` 第 5 節已記錄核心機制，本次覆核 `AnimationStudio.tsx:5499-5518` 的 `onSuccess`「把生成結果 merge 回本地 draft」修補（AIDV-198）仍只縮小視窗、未消除：`generateCharacter` 的網路回應抵達到 `onSuccess` 執行完成之間，若另一次編輯的 600ms debounce 存檔恰好觸發，該次存檔用「尚未併入新角色」的 draft 整欄覆寫 `charactersJson`，伺服器剛落庫的 AI 角色被覆蓋消失（使用者當下畫面仍顯示該角色，因本地 state 之後仍會 merge，但下次重整頁面即消失）。此修補只覆蓋 `characters`/`scenes` 兩個欄位的 `onSuccess`，`objectsJson`/`researchEntriesJson`/`soundLibraryJson`/`uploadedAssetsJson` 等其餘欄位若未來有類似「伺服器端非同步寫入」來源（例如訓練完成 webhook 寫 `linkedModelIds`），完全沒有對應的 draft-merge 保護，同一根因會直接命中。

**建議**

- 短期：把 `generateCharacter`/`generateScene` 的寫入改成 SQL 層原子 `JSON_ARRAY_APPEND(charactersJson, '$', CAST(? AS JSON))`，不依賴 app 層讀到的陣列基準，兩個併發請求都能各自把自己生成的一筆原子疊加進去，不會互相覆寫。
- 中期：比照 `creativeProjects` 幫 `worldbuildingFrameworks` 加 `version` 欄位；`worldbuilding.update` 的整包 PATCH 走 `WHERE id=? AND version=?` CAS（衝突回 409，前端已有 `creativeProject.update` 的 409 處理可參考）；`generateCharacter`/`generateScene` 寫入前後夾 `expectedVersion` 或改用上面的 `JSON_ARRAY_APPEND`（兩者擇一即可解決各自的競態面）。

---

## 發現 2（高／新發現）— `worldStoryboardRouter.update` 對 `scenesJson` 是整陣列覆寫，`world_storyboards` 全表無版本欄位；Q1 規格文件已明訂「近期先用整包 patch，樂觀鎖留待後續卡」

**cluster**: read-modify-write / lost-update
**hasProtection**: 無（`world_storyboards` 無 `version` 欄位；`updateWorldStoryboard` 是無條件 `WHERE id=?`）

**競態窗口（行號）**

- `server/routers/worldStoryboard.ts:181-212`（`update`）：`const existing = await db.getWorldStoryboard(input.id)`（:182，僅用來檢查 ownership，未比對任何版本戳記）→ `p.scenes !== undefined ? { scenesJson: p.scenes } : {}`（:196）→ `db.updateWorldStoryboard(input.id, {...})`（:187-210）。
- 寫入函式：`server/db.ts:3243-3253`（`updateWorldStoryboard`）純 `db.update(worldStoryboards).set(data).where(eq(id))`。
- Schema 確認：`drizzle/schema.ts:3548-3588`（`worldStoryboards` 表定義）沒有 `version` 欄位（對照 `creativeProjects` 在 `:3709-3710` 有 `version: int(...).default(0)` + AIDV-316 樂觀鎖註解）。

**交錯後果**

- 目前**已出貨前端**只用 `worldStoryboard.update` 改 `name`（`client/src/pages/AnimationStudio.tsx:5724-5726` 的 `renameStoryboard`），未見任何呼叫端把 `scenes` 放進 `patch`——`p.scenes` 這條整包覆寫路徑目前對終端使用者不可觸達，經 API 直接呼叫仍可觸發（`update` 是 `protectedProcedure`，僅檢查 ownership，未限制欄位）。
- 但 `docs/research/Q1-scene-assembly-editor-spec.md:193`（「首個 PR」段落）與 `:277-283`、`:306`、`:316` 明文把「前端讀出整份 `scenes[]`，patch 進當前幕改動，整包送 `update({ id, patch: { scenes } })`」訂為**即將落地的第一版逐幕編輯器實作路線**，並在 `:325` 明寫「§5-4 的樂觀鎖/`version` 欄——留待後續卡」。也就是說，一旦這張後續卡沒有先於編輯器上線前完成，逐幕編輯器一上線就會立即出現「兩個分頁/兩次快速儲存互相蓋掉對方場景編輯」的遺失更新——雙擊儲存、逾時自動重試、或使用者開兩個分頁編輯同一分鏡，都會讓後寫入的整包 `scenes[]` 覆蓋前一次已存的變更，且無任何 409/衝突提示。

**建議**

- 在 Q1 規劃的逐幕編輯器 PR 落地**之前**，把 `worldStoryboards` 補上 `version` 欄位並讓 `worldStoryboard.update` 採用與 `creativeProjects.update` 相同的 `expectedVersion` CAS 模式（該模式已經在本庫驗證過、有現成的前端 409 處理慣例可直接複用），避免重蹈 Q1 §5-4 明知故犯的技術債。
- 若編輯器需要更細粒度的併發（多人同時改不同幕），比 CAS 更好的長期方案是把「新增/刪除/搬動單一 scene」拆成獨立 procedure，用 `JSON_MERGE_PATCH`/`JSON_SET` 對 `$.scenes[n]` 做原子操作，而非整份陣列 PATCH。

---

## 發現 3（高／新發現）— `director.saveSession` 的 update-in-place 路徑對 `project_notes_calendar.content`（gzip 後的完整導演對話 JSON）是無條件整欄覆寫，無版本/時間戳檢查

**cluster**: lost-update
**hasProtection**: 無

**競態窗口（行號）**

- `server/routers/director.ts:381-427`（`saveSession`）：當 `input.id` 有值時，`:400`（`db.getProjectNote(input.id)`，僅用於 ownership + `isDirectorSessionNote` 檢查）→ `:411-415`（`db.updateProjectNote(input.id, { title, content: encodeDirectorSessionData(input.sessionData), tags })`，`sessionData` 是呼叫方本地持有的**完整**對話/腳本 JSON 字串，長度上限 2MB，`:389`）。
- 寫入函式：`server/db.ts:1666-1676`（`updateProjectNote`）純 `db.update(projectNotesCalendar).set(data).where(eq(id))`，無 `updatedAt`/版本比對。
- `project_notes_calendar` schema（`drizzle/schema.ts:487-526`）本身沒有樂觀鎖欄位。

**交錯後果**

- 若同一使用者對同一 session id 幾乎同時發出兩次 `saveSession`（雙分頁同開一個導演對話、或前端自動儲存計時器與手動「儲存」按鈕重疊觸發、或網路重試造成重複請求），兩次呼叫都各自持有自己那份**完整**本地 `sessionData`（例如分頁 A 少了分頁 B 之後新增的訊息，反之亦然），寫入 DB 的順序決定哪一份完整覆蓋另一份——輸家分頁裡使用者輸入的訊息/腳本修改會被無聲永久抹除，且呼叫方（前端）拿到的是 200 OK 成功回應，沒有任何衝突訊號。
- 現況核對（避免臆測）：目前程式碼中兩個已知呼叫點（`client/src/pages/DirectorAI.tsx:6547`、`:6564` 與 `client/src/shells/video/canvas/ScriptCanvas.tsx:81-87`）呼叫 `saveSessionMut.mutate({...})` 時**均未傳入 `id`**，全部走「一律新增一列」的 create 分支（`server/routers/director.ts:419-426`），因此 update-in-place 分支目前對已出貨前端不可觸達——但該分支程式碼本身完全沒有併發防護，一旦任何呼叫端（含未來版本、其他前端/行動端、或直接呼叫 tRPC 的腳本）開始傳 `id`（router 註解 `:377-379` 本身就是為了「重複儲存同一 session 不再堆疊出多列」而設計、明示鼓勵傳 `id` 的用法），即會立即命中此處的無鎖整欄覆寫。是否有其他尚未掃到的呼叫端傳入 `id`（例如自動儲存草稿功能）**需執行期驗證**（全庫原始碼搜尋僅命中上述兩處呼叫點）。

**建議**

- `project_notes_calendar` 加 `version` 欄位（或至少讓 `saveSession` 的 update 分支比對呼叫方回傳的 `updatedAt` 時間戳），`updateProjectNote` 針對 director-session 這條路徑改用 CAS `WHERE id=? AND version=?`，衝突時回 409 讓前端提示「另一分頁已更新，請重新載入」。
- 在此之前，若要啟用/開發任何會傳 `id` 的自動儲存功能，務必先補上此保護，避免把目前「不可觸達所以安全」的程式碼路徑實際打開後才發現無鎖。

---

## 發現 4（中／延伸已知，確認現況）— `creativeProject.link` 繞過 AIDV-316 樂觀鎖，與 `update` 的併發保護範圍不一致

**cluster**: other（樂觀鎖保護範圍不一致，非典型 JSON read-modify-write，但同屬 `creative_projects` 併發稽核範圍，附帶確認）
**hasProtection**: 部分（`creativeProjects` 有 `version` 欄位且 `update` 端點正確走 CAS；`link` 端點無條件跳過）

**現況核對**：`docs/research/X1-project-spine-deepdive.md` M3 節已完整記錄且行號與現況一致——`server/routers/creativeProject.ts:332-345`（`link` 的 input schema 無 `expectedVersion`）、`:369-379`（呼叫 `updateCreativeProject` 未傳 `opts`）、`server/db.ts:3456-3471`（`updateCreativeProject` 在 `opts?.expectedVersion` 為 `undefined` 時退化為無條件覆寫，但仍執行 `version + 1`）。本次覆核程式碼行為與 X1 描述相符，未發現差異，故不重複展開，僅確認現況仍然成立、且與本次 RC2「JSON 欄位」掃描範圍相關（`link` 雖然改的是純量 FK 欄位而非 JSON 陣列，但它與 `update` 共用同一張表、同一個 `version` 計數器，`link` 的無條件遞增會讓另一個乖乖帶 `expectedVersion` 的 `update` 呼叫方收到非預期 409，屬於同一表併發保護的系統性缺口）。

**建議**：同 X1 原建議——讓 `link` 也接受並轉傳 `expectedVersion`，或至少文件明載「`link` 刻意不受版本保護」。

---

## 已正確保護（negative results）

以下路徑經覆核**沒有**發現本輪關注的 read-modify-write 遺失更新問題，附上判準：

1. **`creativeProjects.update`（純 CAS 呼叫路徑）** — `server/routers/creativeProject.ts:212-262` 正確把呼叫方讀到的 `expectedVersion` 傳給 `db.updateCreativeProject`（`server/db.ts:3456-3471`），SQL 為 `WHERE id=? AND version=?`，衝突時 `updated=false` → 端點丟 `CONFLICT`（409）。這是本庫本次掃描範圍內唯一同時具備「呼叫方帶版本」+「DB 層原子 WHERE 比對」兩要素的正確 CAS 範例（前提是呼叫方確實傳入 `expectedVersion`；`link` 端點不傳的問題見發現 4）。
2. **`updateWorldStoryboardJobAtomic`（`jobsJson` 單一 step 的 DB 層寫入）** — `server/db.ts:3255-3267` 用 `JSON_SET(COALESCE(jobsJson,'{}'), $.stepId, CAST(? AS JSON))`，對「把某個 step 的完整物件寫回該 JSON path」這個寫入動作本身是原子的（不會因為併發寫入不同 step 而互相打架，也不會把整個 `jobsJson` 打包覆寫）。注意：呼叫端 `updateJob`（`worldStoryboard.ts:324-350`）組裝要寫入的 step 物件時，仍是從呼叫當下讀到的 `row.jobsJson[stepId]` 做 app 層合併（stale-read），這正是任務描述中「已知」的 W1（`jobsJson` 讀改寫無鎖）成因——本節只確認**寫入原語本身**是正確的 JSON_SET 範例，不代表整條 `updateJob` 呼叫鏈已無競態（W1 仍成立，依指示不重複展開）。
3. **`timelineFrames`（`tags`/`title`/`description` 等描述性欄位）** — 全庫搜尋 `server/routers/worldbuilding.ts` 只有 `create`（`uploadTimelineFrame`）、`delete`、`checkConsistency`（`consistencyCheckJson` 整欄覆寫但內容為每次呼叫全新產生，非取自舊值修改）三種寫入，**不存在**任何「讀出 tags 陣列→改一項→整包寫回」的 update procedure，故不構成本輪關注的 lost-update 面（`checkConsistency` 另有獨立的 IDOR 問題，見 `V4-worldbuilding-generation-deepdive.md` 第 3 節，非併發範疇，不在此報告重複列出）。
4. **`sceneCompositions`（`elementsJson`/`aiSuggestionsJson`）** — `server/routers/worldbuilding.ts:753-776`（`saveComposition`）只呼叫 `db.createSceneComposition`（永遠新增一列），全庫未找到任何 `updateSceneComposition`/`update` mutation，因此不存在對既有 `elementsJson` 的讀改寫路徑。
5. **`worldStoryboardRouter.planPipeline` 的 `pipelinePlanJson` 覆寫** — `server/routers/worldStoryboard.ts:284-311` 每次呼叫都用當下的 `scenesJson`/framework 重新呼叫 `planAnimationPipeline` 產生**全新**的 plan 物件再整欄寫回，語意上是「重新計算並取代」而非「讀取舊 plan 修改一部分」，因此併發呼叫下「後寫入者的全新 plan 蓋過前者」是預期行為（重新規劃本該以最新一次為準），不構成 lost-update。

---

## 附錄：涉及檔案清單

- `server/routers/worldStoryboard.ts`（`update:174-212`、`updateJob:314-350`、`planPipeline:284-311`）
- `server/routers/worldbuilding.ts`（`update:155-209`、`checkConsistency:688-719`、`saveComposition:753-776`）
- `server/services/worldbuildingGeneration.ts`（`generateCharacter:341-381`、`generateScene:383-423`）
- `server/routers/director.ts`（`saveSession:381-427`、`encodeDirectorSessionData:98-102`）
- `server/routers/creativeProject.ts`（`update:212-262`、`link:332-381`）
- `server/db.ts`（`updateWorldStoryboard:3243-3253`、`updateWorldStoryboardJobAtomic:3255-3267`、`updateWorldbuildingFramework:3175-3185`、`updateProjectNote:1666-1676`、`updateCreativeProject:3456-3471`、`updateTimelineFrameConsistency:3328-3338`）
- `drizzle/schema.ts`（`worldbuildingFrameworks:3470-3534`、`worldStoryboards:3548-3588`、`timelineFrames:3596-3629`、`sceneCompositions:3637-3664`、`creativeProjects:3678-3728`、`projectNotesCalendar:487-526`）
- `client/src/pages/AnimationStudio.tsx`（`handlePatchWorld:5462-5496`、`generateCharacterMutation:5499-5508`、`generateSceneMutation:5510-5518`、`renameStoryboard:5724-5726`）
- `client/src/pages/DirectorAI.tsx`（`saveSessionMut` 呼叫點 `:6547`、`:6564`）
- `client/src/shells/video/canvas/ScriptCanvas.tsx`（`saveSession.mutate:81-87`）
- 交叉引用：`docs/research/V4-worldbuilding-generation-deepdive.md`（第 5 節）、`docs/research/X1-project-spine-deepdive.md`（M3 節）、`docs/research/Q1-scene-assembly-editor-spec.md`（`:193`、`:277-283`、`:306`、`:325`）
