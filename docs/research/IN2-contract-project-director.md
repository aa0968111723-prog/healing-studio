# IN2 — 前後端契約:專案/導演/分鏡域
- 產生日期:2026-07-03
- 依據 commit:7f4417daaacbf24510dc20d88dba9aae71b2883c（HEAD 實測；任務單指定的
  `812f6fdb` 在本 repo 歷史中不存在 `git cat-file -t 812f6fdb` 回 fatal，故改用
  實際 HEAD，特此註明避免誤導）
- 稽核接縫:server/routers/{creativeProject,director,worldStoryboard,worldbuilding,videoProject}.ts
  ↔ client/src/pages/{Studio,DirectorAI}.tsx + contexts/ProjectsContext.tsx

> 方法論：每個發現都先讀「兩端」實際程式碼再下結論；行號皆為本次讀取當下的實際行號。
> 找不到兩端證據的一律標「未在兩端驗證」，不臆測。

---

## 摘要

本輪聚焦 creativeProjectId / storyboardId 等關鍵鍵在 server↔client 間的實際傳遞，
以及 `productionStatus` 狀態機欄位在 schema / 型別 / 實際寫入路徑三方是否一致。

結論：**C-02（batchGenerateWithSession 不傳 storyboardId）在 HEAD 仍原樣存在**；
另外發現一個先前未列管、且證據最扎實的新問題 —— **`world_storyboards.productionStatus`
欄位同時被兩套互不相容的列舉「治理」**：一套是 `shared/worldbuilding-animation.ts`
的 7 值管線階段列舉（zod schema + TS 型別），另一套是 `shared/video-state-machines.ts`
的 6 值 session 狀態機（`SESSION_STATUSES`，實際被 `queueForVideo` /
`updateSessionStatus` / `batchGenerateWithSession` 寫入資料庫）。兩者對同一個
varchar(32) 欄位各自為政，`rowToStoryboard` 用 `as` 轉型掩蓋了這個裂縫。

同時確認 DirectorAI.tsx 的主聊天入口從未把 `projectId` 傳給 `director.chat`——
而在同一個 commit 裡，`client/src/adapters/commander.trpc.ts` 的程式碼註解明確
記載「這個確切的 bug 已經被抓到並修好」，但修法只套用在 spine adapter，主頁面
`DirectorAI.tsx` 自己的呼叫點仍是舊版、沒有修。

也確認了多個「接得對」的正向結果（見文末），並非全盤皆是斷點。

---

## 發現一覽（依嚴重度排序）

### 1. 〔field-inconsistency｜高〕`world_storyboards.productionStatus` 兩套互不相容列舉同治一欄

**接縫斷點兩端：**
- 端 A（型別/zod 契約，7 值管線階段）：
  `shared/worldbuilding-animation.ts:208-215`（`WorldStoryboard.productionStatus` TS 型別：
  `"planning" | "generating_frames" | "refining" | "rendering_video" | "composing_audio" | "final_compose" | "completed"`）
  與 `shared/worldbuilding-animation.ts:362-372`（`worldStoryboardInputSchema.productionStatus`
  zod `.enum([...])`，同一組 7 值，供 `worldStoryboard.create` / `worldStoryboard.update`
  兩個公開 procedure 做輸入驗證）。
- 端 B（實際執行期寫入，6 值 session 狀態機）：
  `shared/video-state-machines.ts:73-91`（`SESSION_STATUSES = ["planning","in_progress","paused","completed","failed","cancelled"]`
  + `SESSION_NEXT_STATES` 轉移表）被
  `server/routers/worldStoryboard.ts:608`（`queueForVideo` 直接
  `db.createWorldStoryboard({ ..., productionStatus: "in_progress", ... })`）、
  `server/routers/worldStoryboard.ts:353-378`（`updateSessionStatus` procedure，
  input `z.enum(SESSION_STATUSES)`，寫入 `input.status` 可為 `in_progress/paused/failed/cancelled`）、
  以及 `server/routers/director.ts:1236-1239`／`1360-1363`／`1406-1409`
  （`batchGenerateWithSession` 把 `productionStatus` 寫成 `"in_progress"` /
  `"failed"` / `"completed"`）三處實際寫入資料庫。

**判定為何是斷點而非單純巧合：**
`generating_frames` / `refining` / `rendering_video` / `composing_audio` / `final_compose`
這 5 個「管線階段」值在整個 `server/` `shared/` `client/src/` 目錄中，除了型別/schema
定義本身之外**從未被任何程式碼寫入或讀取**（`grep -rn "generating_frames\|rendering_video\|composing_audio\|final_compose"`
只命中 `shared/worldbuilding-animation.ts` 自己兩處）——也就是說「型別聲稱的 7 值」
從未真正被實作使用；真正被寫入資料庫的是 `in_progress/paused/failed/cancelled`
這 4 個「型別完全不認得」的值。`worldStoryboard.ts:63` 的 `rowToStoryboard`：
```ts
productionStatus: row.productionStatus as WorldStoryboard["productionStatus"],
```
用 `as` 把資料庫原始字串（實際可能是 `"in_progress"`）強制斷言成只包含 7 值的型別，
編譯期完全查不出這個矛盾。

**影響：**
- 任何未來想透過公開的 `worldStoryboard.update({ patch: { productionStatus } })`
  寫入 `"in_progress"` 等 session 狀態值的呼叫都會被 `worldStoryboardInputSchema.partial()`
  的 zod enum 擋下（400），**只有繞過 schema 的內部呼叫（queueForVideo /
  updateSessionStatus / batchGenerateWithSession）才寫得進去**——新舊兩條路徑事實上
  互斥卻共用一個資料庫欄位。
- 任何依賴 `WorldStoryboard["productionStatus"]` TS 型別做窮盡 switch（例如
  `case "planning": ... case "completed": ...`)的未來消費端，會對 `"in_progress"` /
  `"failed"` 落到 default 分支或型別系統完全不會提醒的漏判——因為型別系統的認知
  與資料庫實際內容不同源。
- 本次稽核範圍內（Studio.tsx / DirectorAI.tsx / ProjectsContext.tsx）三個檔案目前
  **都沒有讀取 `productionStatus`**（見下方「已驗證接得對」段落的反向確認），
  所以現階段尚未在這三個追蹤頁面上炸出可見 bug；但 `worldStoryboardRouter.get`
  的回傳型別本身已經是假的，任何新頁面依此型別開發都會被誤導。

**建議：**
統一到 `SESSION_STATUSES`（實際在跑的那一套），把 `shared/worldbuilding-animation.ts`
裡的 `WorldStoryboard.productionStatus` 型別與 `worldStoryboardInputSchema.productionStatus`
zod enum 改成從 `shared/video-state-machines.ts` 匯入 `SESSION_STATUSES`，並淘汰從未
被使用的 5 個管線階段值（或者如果那 5 個值是規劃中但尚未實作的功能，就该在
`rowToStoryboard` 加執行期驗證/ 警告，而不是用 `as` 靜默轉型）。

---

### 2. 〔dead-seam｜高〕DirectorAI.tsx 主聊天入口從未傳 `projectId`，AIDV-152 世界觀注入在主頁面形同死碼

**接縫斷點兩端：**
- 端 A（server 契約，支援 `projectId` 並依旗標注入世界觀）：
  `server/routers/director.ts:235-241`（`director.chat` 輸入 schema 的
  `projectId: z.number().int().positive().nullable().optional()`，註解明講
  「AIDV-152：可選的當前 active project id」）與
  `server/routers/director.ts:253-258`（`isDirectorWorldContextEnabled() && input.projectId`
  才會呼叫 `loadProjectWorldContext` 把世界觀摘要注入 system prompt）。
- 端 B（client 實際呼叫，缺 `projectId`）：
  `client/src/pages/DirectorAI.tsx:3406-3413`：
  ```ts
  chatMutation.mutate({
    messages: newMessages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role, content: m.content })),
    saveToNotes,
    personality,
  });
  ```
  全檔案唯一一處 `chatMutation.mutate(...)` 呼叫（`grep -n "chatMutation\.mutate"` 只命中此行），
  且 `worldCtx`（`useWorldContext()`，已在 `DirectorAI.tsx:2385` 取得，內含
  `worldCtx.currentProjectId` — 見 `client/src/contexts/WorldContextContext.tsx:34`）
  在同一個元件作用域內完全可用，卻沒有被帶進這次呼叫。

**這不是臆測 —— 同一份程式碼裡有另一處已經修過同樣的洞，證明這是已知缺陷模式：**
`client/src/adapters/commander.trpc.ts:29-41` 的註解逐字寫著：
> 「AIDV-152：契約對齊。server director.chat 的 input schema 是
> `{ messages, saveToNotes, personality, projectId? }`……修正前送舊欄位會被 Zod 擋下，
> projectId 永遠到不了 server，世界框架注入路徑形同死碼」，
並在 `commander.trpc.ts:40` 實際加上 `projectId: input.projectId ?? undefined`。
也就是說：**這個確切的「projectId 傳不到 server」缺陷，已經在 spine/commander 這條
呼叫路徑上被發現並修好，但 DirectorAI.tsx 自己的主聊天呼叫點（本次稽核追蹤的檔案）
從未套用同一個修法**。

**影響：**
即使未來把 `ENABLE_DIRECTOR_WORLD_CONTEXT` 旗標打開，DirectorAI 頁面主聊天視窗
（使用者最常互動的介面）依然完全不會注入世界觀摘要——旗標對這條路徑而言永遠等效於
關閉。使用者在 `/director-ai` 頁面聊天時得不到 AIDV-152 承諾的「跨頁面世界觀上下文」，
即使他們已經在 `WorldContextContext` 選定了 active project。

**建議：**
`chatMutation.mutate({ ..., projectId: worldCtx.currentProjectId ?? undefined })`，
與 `commander.trpc.ts:40` 採同一寫法。

---

### 3. 〔dead-seam/broken-wiring｜高，C-02 現況確認〕`batchGenerateWithSession` 仍未收到 `storyboardId`

**接縫斷點兩端：**
- 端 A（server，storyboardId 為可選、有才會做 session 狀態機追蹤）：
  `server/routers/director.ts:1199`（`storyboardId: z.number().int().positive().optional()`）
  與 `server/routers/director.ts:1202-1240`（`if (storyboardId !== undefined) { ... 轉移
  productionStatus → in_progress、寫 jobsJson ... }`，否則整段落 skip，行為等同舊版
  `batchGenerateCostar`）。
- 端 B（client 唯一呼叫點，未帶 `storyboardId`）：
  `client/src/pages/DirectorAI.tsx:4051-4059`：
  ```ts
  batchCostarMut.mutate({
    segments: segmentsWithoutCostar.map(s => ({
      id: s.id, index: s.index, rawText: s.rawText, storyboard: s.storyboard,
    })),
    personality,
  });
  ```
  （`batchCostarMut` 定義於 `DirectorAI.tsx:2907`，型別為
  `trpc.director.batchGenerateWithSession.useMutation`）。

**現況：** 與任務單所列 C-01/C-02 先驗記錄一致，HEAD 上仍未修。全檔案搜尋
`batchCostarMut\.` 只有這一個 `.mutate(` 呼叫，且該元件作用域內找不到任何
`storyboardId` 狀態（`grep -n "storyboardId" DirectorAI.tsx` 完全 0 命中）——
DirectorAI.tsx 目前的資料模型裡根本沒有「當前分鏡板 id」這個概念可傳，
因為分鏡板是後於 CO-STAR 生成才透過 `createFromSegments`/`queueForVideo`
建立的（見下一則發現）。

**影響：** 「批次 CO-STAR」按鈕永遠走 `storyboardId === undefined` 分支，
AIDV-50 承諾的 session 狀態機追蹤（`jobsJson` 逐段記錄 voice/music asset、
`productionStatus` 轉移）在這顆最常被點的按鈕上完全不會發生；只有先建好
storyboard 之後（此時 CO-STAR 通常已經生成過）才有意義，形成雞生蛋問題。

**建議：** 需要先解決「分鏡板何時建立」的產品流程問題，而不只是補傳一個 id——
目前的呼叫順序（先批次 CO-STAR、後 createFromSegments 建分鏡板）與
`batchGenerateWithSession` 設計假設的順序（先有 storyboardId、再批次生成並回寫）相反。

---

### 4. 〔broken-handoff｜中〕分鏡板建立後從未透過 `creativeProject.link` 回寫，與 SSOT 脫鉤

**接縫斷點兩端：**
- 端 A（server 明確提供「把 storyboard 綁回 project」的機制）：
  `server/routers/creativeProject.ts:332-381`（`link` mutation，接受
  `worldStoryboardId`/`worldFrameworkId`/`directorSessionId`，驗證擁有權後寫回
  `creative_projects` 該列）——這是唯一能讓 `creative_projects.worldStoryboardId`
  指向新分鏡板的路徑（`world_storyboards` 資料表本身沒有 `creativeProjectId`
  外鍵，見 `drizzle/schema.ts:3548-3588`，關聯完全單向仰賴 `creative_projects` 那側）。
- 端 B（client 建立分鏡板的兩個呼叫點，皆只 navigate，不 link）：
  `server/routers/worldStoryboard.ts:402-499`（`createFromSegments`）與
  `server/routers/worldStoryboard.ts:506-614`（`queueForVideo`）分別由
  `client/src/pages/DirectorAI.tsx:2800-2809`（`createStoryboardMut`，
  `onSuccess` 只 `toast.success(...)` + `navigate('/animation/'+data.id)`）與
  `client/src/pages/DirectorAI.tsx:2811-2828`（`queueForVideoMut`，`onSuccess`
  只 `toast.success(...)` + `navigate('/video-studio?queue='+data.id)`）呼叫；
  兩處都拿得到新建分鏡板的 `data.id`，但**全檔案沒有任何一次呼叫
  `trpc.creativeProject.link.mutate(...)`**（`grep -n "creativeProject\.link"
  client/src/pages/DirectorAI.tsx` 0 命中；同樣的 `creativeProject.link` 呼叫
  確實存在於 `client/src/pages/CreativeProjectPage.tsx:163` 與
  `client/src/spine/ProjectSpineProvider.tsx:469-480`，證明這條線是「別的地方接得到，
  DirectorAI 這裡沒接」）。

**影響：** 使用者在導演台完成腳本 → 送入分鏡/影片佇列的完整流程後，
`ProjectsContext`/`WorldContextContext` 的 SSOT（`creative_projects.worldStoryboardId`）
完全不知道剛才建立的分鏡板存在。任何依賴 `worldCtx.currentProject.worldStoryboardId`
或 `ProjectsContext` 的 `binding.storyboard` 顯示（`client/src/contexts/ProjectsContext.tsx:119-121`）
的 UI，在此流程後仍顯示舊值或空值，除非使用者事後手動到 `/creative-projects` 頁面
重新連結。

**建議：** 在 `createStoryboardMut`/`queueForVideoMut` 的 `onSuccess` 裡，
若當前有 `worldCtx.currentProjectId`，補一次
`utils.creativeProject.link.mutate({ id: worldCtx.currentProjectId, worldStoryboardId: data.id })`
（best-effort，失敗只告警不擋主流程，可仿 `ProjectSpineProvider.tsx:469-480` 的寫法）。

---

### 5. 〔dead-seam/low｜資訊性〕Studio.tsx 與 ProjectsContext / WorldContextContext 完全零接觸

**兩端證據：**
- `client/src/pages/Studio.tsx` 全檔案（3998 行）沒有任何一處
  `import { useProjects }` / `import { useWorldContext }` / `ProjectsContext`
  / `worldFrameworkId`（`grep` 0 命中）。
- 唯一與本稽核域路由相關的 tRPC 呼叫是
  `client/src/pages/Studio.tsx:1341`（`trpc.director.askForStudioPlan.useMutation()`），
  其輸入輸出（`server/routers/director.ts:3429-3543`）本身不含
  `creativeProjectId`/`worldFrameworkId` 欄位，純粹是「當前工作室狀態 → 建議 actions」，
  與專案/世界觀綁定無關。

**判定：** 這比較像是「這個頁面設計上就沒有這個功能」而非傳輸中斷的斷點——
Studio.tsx 是四模態快速生成台，本身沒有 project-aware 的 UI（不像 DirectorAI.tsx
有 `worldCtx`/`worldbuildingSelectedId`）。列在此處是為了明確排除「Studio.tsx 應該
要接但沒接上」的疑慮：**目前的證據顯示它從設計上就是獨立於 creativeProject 體系
之外，不構成本次任務單定義的斷點**，但如果產品意圖是「Studio 生成的素材應能歸屬到
當前 active project」，這會是一個需要新增功能（而非修 bug）的缺口。

---

### 6. 〔other/低｜猜最新一筆模式，非本次重點斷點〕worldsForStepperQuery 用 `worldsList[0]` 兜底

**兩端證據：**
- `client/src/pages/DirectorAI.tsx:4409-4418`：
  ```ts
  const worldsForStepperQuery = trpc.worldbuilding.list.useQuery(...);
  const focusedWorld =
    worldsList.find(w => w.id === worldbuildingSelectedId) ??
    worldsList[0] ?? null;
  ```
- `server/routers/worldbuilding.ts:95-98`（`list` 呼叫
  `db.getWorldbuildingFrameworksByUser`）與
  `server/db.ts:3163-3173`（`.orderBy(desc(worldbuildingFrameworks.updatedAt))`）
  確認 `worldsList[0]` 語意上等於「最近更新的世界觀」，與 NS-02 提到的
  「猜最新一筆」為同一手法。

**影響評估：** 僅影響 `/director-ai` 頁面世界觀分頁 stepper 上顯示的角色數/場景數
計數（`stepperCounts.characters`/`stepperCounts.scenes`），屬展示用途；當
`worldbuildingSelectedId` 未設且使用者實際綁定的世界觀不是最近更新的那個時，
計數會顯示錯誤的世界觀資料，但不影響任何寫入/生成邏輯（那些都走
`overrideWorldId ?? worldbuildingSelectedId ?? worldCtx.worldFrameworkId`
三層 fallback，不受此列表排序影響）。列為低嚴重度、僅供延伸追蹤。

---

## 已驗證「接得對」的接縫（negative results）

以下皆為兩端實際讀取後確認欄位名稱、型別、語意一致，未發現斷點：

1. **`creativeProject.get` ↔ `WorldContextContext`**
   `server/routers/creativeProject.ts:53-74`（`rowToData`）+ `:110-147`（`get`
   procedure，含 `worldFrameworkName` 於 `:146`）與
   `client/src/contexts/WorldContextContext.tsx:121-127`（`projectQuery`）+
   `:178-188`（`currentProject` 映射）——欄位 `id/title/directorSessionId/
   worldFrameworkId/worldStoryboardId/worldFrameworkName/status` 一一對應。

2. **`worldbuilding.summarizeForPrompt` ↔ `WorldContextContext`**
   `server/routers/worldbuilding.ts:260-286`（回傳
   `{ summary, characterPrefixes, scenePrefixes, globalNegativePrompt }`）與
   `client/src/contexts/WorldContextContext.tsx:144-163`（消費
   `raw?.summary`、`raw?.globalNegativePrompt`）——一致。

3. **`worldbuilding.list` ↔ DirectorAI stepper**
   `server/routers/worldbuilding.ts:45-90`（`rowToData` 含 `id/characters/scenes`）
   與 `client/src/pages/DirectorAI.tsx:4413-4424`（`.id`/`.characters?.length`/
   `.scenes?.length`）——一致。

4. **`director.chat` 回傳形狀 ↔ DirectorAI 消費**
   `server/services/director/costarService.ts:321`（`return { research, script,
   personality }`）與 `client/src/pages/DirectorAI.tsx:3350-3372`（消費
   `data.research`/`data.script`/`data.script.proactiveQuestion`）——一致
   （唯獨如發現 2 所述，輸入端缺 `projectId`）。

5. **`worldStoryboard.createFromSegments` / `queueForVideo` 回傳 ↔ DirectorAI 消費**
   `server/routers/worldStoryboard.ts:498`（`{ id, sceneCount, totalDurationSec }`）
   `:613`（同形狀）與 `client/src/pages/DirectorAI.tsx:2802-2825`（消費
   `data.sceneCount`/`data.id`/toast 文案）——一致（唯獨如發現 4 所述，
   回傳的 `id` 沒有被進一步用來 `link` 回專案）。

6. **`director.askForStudioPlan` ↔ Studio.tsx**
   `server/routers/director.ts:3536-3542`（回傳 `{ actions, rationale,
   rawResponse }`）與 `client/src/pages/Studio.tsx:1345-1371`（消費
   `result.actions`/`result.rationale`，並透過 `pageAgent.dispatchMany` 執行）——一致。

7. **`batchGenerateCostar`/`batchGenerateWithSession` 的 `resultMap` ↔ DirectorAI 消費**
   `server/routers/director.ts:1163`（`return { results: resultMap }`）
   `:1430`（同形狀）與 `client/src/pages/DirectorAI.tsx:2908-2921`
   （`data.results`，逐筆檢查 `"context" in entry`）——一致。

8. **專案狀態列舉 ↔ 前端狀態映射**
   `server/routers/creativeProject.ts:24-29`（`projectStatusSchema`：
   concept/production/review/complete）與
   `client/src/contexts/ProjectsContext.tsx:84-89`（`SERVER_TO_CLIENT_STATUS`
   窮盡映射這 4 個值，無漏項）——一致（`review→active` 為已知有損映射，
   程式碼註解已自陳，非隱藏斷點）。

---

## 範圍外、未在兩端驗證事項

- **C-01（VideoStudio→DirectorAI resultUrl:null）**：`VideoStudio.tsx` 不在本次任務單
  列管的檔案範圍內，故沒有針對它重新查證。順帶查過的
  `server/routers/director.ts:3104-3314`（`pollGenerationTask`，DirectorAI.tsx 內部
  輪詢用）本身回傳 `resultUrl` 欄位與 `DirectorAI.tsx:1608-1614` 消費一致，兩端命名
  相符——但這是 DirectorAI 自己的獨立輪詢管線，跟 C-01 描述的
  VideoStudio→DirectorAI 交接是否為同一條路徑，**未在兩端驗證**，不可假定 C-01
  已被此結果覆蓋或解決。
- **`videoProject.ts` 的 `creativeProjectId` 欄位**：`server/routers/videoProject.ts:70,85`
  接受並持久化 `creativeProjectId`，但 `Studio.tsx`／`DirectorAI.tsx` 兩個追蹤檔案
  完全沒有呼叫 `trpc.videoProject.*`（全文搜尋 0 命中）。是否有其他頁面
  （如 `VideoStudio.tsx`）正確填入此欄位，**未在兩端驗證**，不在本次任務單檔案範圍內。
