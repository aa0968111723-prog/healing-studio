# Y7 — LearnHub + TeachingArchive 前端深挖(北極星①)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb(核對:`git diff 812f6fdb..HEAD -- server/routers/learnHub.ts server/routers/teachingArchive.ts client/src/pages/LearnHub.tsx client/src/pages/TeachingArchive.tsx` 為空,兩檔在此區間無變動,沿用 HEAD `47917e3a` 現況)
- 稽核檔案:client/src/pages/LearnHub.tsx(2770 行)、client/src/pages/TeachingArchive.tsx(1969 行)

## 範圍與方法

本輪逐行讀完兩支指定前端檔案全文。為核實「dead-ui / contract-mismatch」是否成立,額外實讀下列路由與後端檔案作交叉驗證(非主稽核對象,僅供佐證,皆已標明):`client/src/App.tsx`、`client/src/app/ShellRoutes.tsx`、`client/src/shells/shellRouteContract.ts`、`client/src/config/featureFlags.ts`、`client/src/shells/learn/{LearnShell,LearnHome,learnFlags}.tsx/ts`、`client/src/shells/learn/panels/LearnDocsPanel.tsx`、`client/src/shells/settings/admin/ContentTab.tsx`、`client/src/shells/settings/panels/AdminPanel.tsx`、`client/src/shells/settings/SettingsHome.tsx`、`.env.production`、`server/routers/learnHub.ts`、`server/routers/teachingArchive.ts`、`server/db.ts`、`server/services/siteKnowledge.ts`。

本文與既有稽核(`X6-learnhub-router-deepdive.md`、`X9-own-database-rag-deepdive.md`、`M3-connectors-workflows.md`、`L2-fields-learn.md`)重疊處一律標明「既有稽核確認」並附本輪獨立覆核結果;凡本輪新查到、前述文件未提及或未查完的因果鏈,標「本輪新增」。

---

## 發現(依嚴重度排序)

### 🔴 CRITICAL — 光球深連結 `[ACTION:navigate:/learn?docId=<id>]` 在正式環境完全是死指令;`LearnHub.tsx` 整支檔案(含全部文件/影片/測驗 CRUD)在正式環境 100% 不可達

**Cluster**:northstar-flow / dead-ui(本輪新增,獨立追完完整因果鏈——L2 已指出 LearnHub.tsx 是孤兒頁,但未追到「深連結格式本身也是死的」這一層)

**發現**

逐段核實路由優先序:

1. `client/src/App.tsx:244`:`{ENABLE_4SHELL && shellRoutes()}` 是 `<Switch>` 的**第一個子節點**;wouter `<Switch>` 取第一個 match 的 Route,故其產生的 Route 一律 shadow 掉後面的 Route。
2. `client/src/App.tsx:345-347` 的 `<Route path="/learn"><DashboardRoute component={LearnHub} /></Route>`(指向本次稽核的 `LearnHub.tsx`)在檔案內排在 `shellRoutes()` **之後**。
3. `client/src/shells/shellRouteContract.ts:19`:`SHELL_IDS = ["video", "social", "learn", "settings"]` 包含 `"learn"`。
4. `client/src/app/ShellRoutes.tsx:75-86`:對每個 `SHELL_ID` 掛載 `/${id}` 與 `/${id}/:rest*` 兩條 Route,故 `/learn` 與 `/learn/:rest*` 都由 `shellRoutes()` 搶先注冊。
5. `client/src/config/featureFlags.ts:58`:`ENABLE_4SHELL = readFlag("VITE_ENABLE_4SHELL", true)`——**預設 true**;`.env.production`(檔案根目錄)明確設 `VITE_ENABLE_4SHELL=1`、`VITE_SHELL_LEARN=1`、`VITE_SHELL_LEARN_RICH=1`,三者皆為正式環境實際生效值,非理論預設。
6. `client/src/shells/learn/learnFlags.ts:32`:`SHELL_LEARN_RICH = readFlag("VITE_SHELL_LEARN_RICH", true)`——同樣預設 true。
7. `client/src/shells/learn/LearnShell.tsx:27`:`if (!SHELL_LEARN_RICH) return <ShellFrame shell="learn" />`——這是唯一能落回舊版 `LearnHub.tsx` 的分支,但正式環境 `SHELL_LEARN_RICH` 恆為 true,此分支永不觸發。
8. `client/src/shells/learn/LearnShell.tsx:33,38`:富 shell 自己的 `<Switch>` 把 `/learn` 導向 `<LearnHome />`,`/learn/docs` 導向 `<LearnHome initial="hub" />`——都不是 `LearnHub.tsx`。

**結論一**:`client/src/pages/LearnHub.tsx`(本次稽核對象,2770 行,四分頁:文件/提示詞/影片/測驗,含 admin 新增/編輯/刪除/批次匯入)在目前(且已核實為正式環境實際值)的旗標組合下,**沒有任何導航路徑可以到達**,只有手動把 `VITE_SHELL_LEARN_RICH` 改回 `0` 重新建置部署才會恢復可達——而這不是使用者/管理員在應用內可操作的開關,是建置期環境變數。(此點與 `L2-fields-learn.md` §0 的結論一致,本輪獨立重讀路由鏈後確認無誤。)

**本輪新增的追加因果鏈**——光球的深連結指令因此變成純粹的死指令,且即使有人手動觸發也看不到任何內容:

9. `server/services/siteKnowledge.ts:46,168`(輔助檔案,佐證):光球系統提示詞明確教導模型用 `[ACTION:navigate:/learn?docId=<id>]` 帶使用者深連到指定文件。
10. `client/src/shells/learn/LearnHome.tsx:42-45`(`readSub` 函式)與整個 `LearnHome` 元件(:49-87)只讀取 URL 的 `?sub=` 參數決定顯示哪個分頁,**全檔案 grep `docId` 零匹配**——`?docId=<id>` 這個 query 參數在正式環境的 `/learn` 落地元件裡完全沒有任何程式碼讀取它,不會有任何效果(既不開啟任何 Modal,也不錯誤提示)。
11. 即使使用者手動切到「學習中心」分頁(`/learn/docs` 或點 `?sub=hub`),渲染的是 `client/src/shells/learn/panels/LearnDocsPanel.tsx`,其 `DocCard`(:108-129)是純展示 `<div>`,**沒有任何 `onClick`**——雖然套用了 `hover:bg-muted/40 transition-colors` 這種暗示可互動的 CSS,但點擊該卡片沒有任何行為,無法看到文件全文、無詳情彈窗、無下載連結。全 repo 對比:此面板與 `LearnHub.tsx` 裡真正有 `onOpen`/`DocDetailModal` 完整詳情頁的 `DocCard`(`LearnHub.tsx:241-351`、`355-496`)是完全不同的兩個同名元件。

**影響**

- 北極星①「AI 讀單一專案上下文全程逐步引導」的一個具體實例——光球主動引用教材庫/學習文件並用深連結帶路——在「學習文件」這個內容類型上是完全斷裂的:AI 照著自己的系統提示詞產出 `[ACTION:navigate:/learn?docId=<id>]`,使用者點下去後看到的是「學習文件系統」首頁(預設研究代理分頁,或上次 `?sub=` 記住的分頁),完全沒有任何跡象顯示原本想開啟哪篇文件,也沒有任何錯誤訊息。
- 即使使用者靠自己手動瀏覽找到目標文件(「學習中心」分頁的卡片列表),卡片本身也無法點擊進入,只能看到 title+summary+badge,看不到文件全文/附件——這是最基本的「讀文件」需求都無法在生產環境完成。
- 連帶地,`LearnHub.tsx` 整支檔案內建的四個功能(文件詳情 Modal、admin 文件 CRUD + 批次匯入、完整的「影片學習區」CRUD+播放、完整的「學習測驗區」CRUD+作答流程、`PromptReferenceTab` 提示詞庫)全部是**寫好但無法被任何使用者觸及的程式碼**——其中「影片學習區」與「學習測驗區」在 `LearnHome` 六分頁(研究/模型/學習/積分/金鑰/新聞)裡完全沒有對應分頁(全 repo grep `videoList`/`quizList`/`"videos"`/`"quizzes"` 在 `client/src/shells/learn/` 目錄零匹配),意味著這兩個內容類型連讀取入口都不存在於生產環境,不只是編輯功能死掉。

**建議**

- 短期(不改資料模型):在 `LearnHome.tsx` 補上讀取 `?docId=` 的邏輯,轉發到 `LearnDocsPanel` 開啟對應文件的詳情視圖(可直接搬 `LearnHub.tsx` 的 `DocDetailModal` 元件邏輯過去);同時給 `LearnDocsPanel` 的 `DocCard` 補上 `onClick` 開啟詳情。
- 中期:決定「影片學習區」「學習測驗區」「提示詞庫」三個功能在新 6 分頁架構下的落點——若仍要保留,需要在 `LearnHome` 新增對應分頁並接上既有 `learnHub.videoList`/`quizList` 等 procedure(後端本身完好,見 `X6-learnhub-router-deepdive.md`);若確定棄用,應同步移除 `LearnHub.tsx` 整支孤兒檔案與其專屬 router procedure,避免死碼持續增加維護負擔與誤導後續開發者。
- 無論哪個方向,都應該修正 `ContentTab.tsx` 的「前往管理」承諾(見下一則發現)與此問題連動處理,不要分開修。

---

### 🔴 CRITICAL — 管理後台「內容治理」承諾「編輯 / 匯入 / 新增於學習中心」,但目前生產環境沒有任何可達 UI 能建立/編輯/刪除/批次匯入 LearnHub 文件

**Cluster**:northstar-flow / dead-ui(本輪新增,承接上一則發現進一步指出「管理端」的具體斷點)

**發現**

- `client/src/shells/settings/admin/ContentTab.tsx:9`(檔頭註解):「內容『編輯 / 刪除 / 匯入』維持走既有 `/learn`、`/ai-models-hub` 頁(盤點既有功能),本分頁是治理總覽 + 入口」。
- 同檔 `:57-66`:「學習文件」卡片 `footer="編輯 / 匯入 / 新增於學習中心"`,按鈕 `onOpen={() => navigate("/learn/docs")}`。
- 此元件本身確實可達:`client/src/shells/settings/panels/AdminPanel.tsx:22,64` 掛載 `ContentTab`,`client/src/shells/settings/SettingsHome.tsx:23,76` 掛載 `AdminPanel`(`showAdmin && <TabsContent value="admin">`)——管理員從 `/settings` → 管理後台分頁 → 內容分頁,能看到這張卡片與按鈕。
- 但按鈕導去的 `/learn/docs`,依上一則發現,實際落地是 `LearnHome(initial="hub")` → `LearnDocsPanel.tsx`——**純唯讀**,沒有新增/編輯/刪除/匯入按鈕,`trpc` 呼叫只有 `learnHub.list`/`learnHub.categories`(逐行核對 `LearnDocsPanel.tsx` 全檔,無其他呼叫)。
- 全 client 端對 `learnHub.create`/`learnHub.update`/`learnHub.delete`/`learnHub.importDocs`/`learnHub.videoCreate`/`videoUpdate`/`videoDelete`/`quizCreate`/`quizUpdate`/`quizDelete` 做 grep,**唯一呼叫端是 `LearnHub.tsx`**(見上一則發現,已確認不可達)。

**影響**

- 管理員照著 UI 自己的文案操作(點「前往管理」),得到的畫面與承諾完全不符——這是一個「按鈕文案應驗自己走一遍」就能發現的具體 UI 缺陷,而不是隱晦的邊界案例。
- 實務後果:目前生產環境**完全沒有任何方式**可以新增一篇學習文件、修正錯字、下架過時內容,或批次匯入文件——這條「創作者/管理者維護自己知識庫」的路徑在 LearnHub 這一側是完全斷裂的,直接命中北極星①「連結/創建自己的資料庫」的核心訴求(管理面)。
- 與 `X6-learnhub-router-deepdive.md` 已指出的「DB 寫入失敗被吞」「兩個下游快取永不失效」等後端缺陷相比,這一則的嚴重度更高——因為後端那些問題至少「偶爾成功」,而本則是「入口本身完全不存在」,後端寫得再好也無法觸發。

**建議**

- 最小修復:在 `LearnDocsPanel.tsx` 或新的 `/learn/docs` 分頁下,替 `isAdmin` 使用者補上「新增/編輯/刪除/匯入」按鈕與對話框——可直接搬用 `LearnHub.tsx` 裡已經寫好的 `AdminDocForm`/匯入邏輯,不需要重新設計表單。
- 或者,若決定保留 `LearnHub.tsx` 作為「內容管理專用頁」,應該讓 `ContentTab.tsx` 的按鈕與 `App.tsx` 的路由都改指向一個**真正可達**的路徑(例如繞過 shell 攔截的專屬管理子路徑),而不是繼續指向被攔截的 `/learn/docs`。
- 兩種修法都需要同時處理上一則發現的「影片/測驗完全無讀取入口」問題,否則「內容管理」的承諾範圍仍不完整。

---

### 🟠 HIGH — TeachingArchive 搜尋框只做關鍵字 LIKE、非向量語意檢索,且與既有 NSX-1(text 教材永不向量化)疊加後,即使補上語意檢索,最輕量的「純文字」上傳路徑仍然搜不到

**Cluster**:northstar-flow(既有稽核確認 + 本輪獨立覆核至伺服器層)

**發現**

- `TeachingArchive.tsx:188-213` 的主查詢是 `trpc.teachingArchive.list.useQuery({ ..., search: filters.search?.trim() || undefined, ... })`。
- 本輪追到伺服器層:`server/routers/teachingArchive.ts:159-166` 的 `list` procedure 呼叫 `db.listTeachingMaterialsForUser`;`server/db.ts`(該函式內,約 :4082-4085)對 `filters.search` 的處理是:
  ```ts
  if (filters.search) {
    const like = `%${escapeLikePattern(filters.search)}%`;
    conditions.push(
      sql`(${teachingMaterials.title} LIKE ${like} OR ${teachingMaterials.description} LIKE ${like} OR ${teachingMaterials.textContent} LIKE ${like})`
    );
  }
  ```
  純字面 LIKE,非向量相似度檢索——本輪獨立在伺服器層核實,與 `L2-fields-learn.md`/`X9-own-database-rag-deepdive.md` 的既有結論一致。
- 真正做「向量優先、LIKE fallback」的是另一支 procedure `teachingArchive.search`(`teachingArchive.ts:420-459`);本輪對 `TeachingArchive.tsx` 全檔 grep `teachingArchive.search`,**零呼叫**——此頁面的搜尋框從未使用它。該 procedure 唯一的前端消費者是 video 導演台的 `TeachingArchiveGrounding.tsx` 抽屜(既有稽核 L2 §6 已載,本輪未重新讀該抽屜檔案,列為未在本檔驗證)。
- 疊加 `X9-own-database-rag-deepdive.md` 已確認的 northstar 發現(NSX-1,`teachingArchive.ts:240-244`):`mediaType:"text"` 的素材(即 `TeachingArchive.tsx` 的 `UploadDialog` 「純文字輸入」分頁,:1089-1108,標榜「直接輸入文字,不需上傳」的最輕量路徑)`needsIngestion` 恆為 `false`,永遠不會觸發 `enqueueTeachingIngestion`,因此永遠不會被 `upsertTeachingMaterialVectors` 向量化。

**影響**

- 即使未來把 `TeachingArchive.tsx` 的搜尋框改接 `teachingArchive.search`(語意檢索),對「純文字輸入」這個最方便、UX 上最推薦的上傳路徑(不需上傳檔案、不需等轉錄)仍然完全無效——語意搜尋 0 命中,只能靠 LIKE 字面比對。
- 使用者體驗上:上傳一段開示逐字稿(文字模式),之後用不同措辭搜尋(例如原文用「鬆開罣礙」,搜尋打「放下執著」),目前的 LIKE 搜尋找不到,未來就算補上語意搜尋介面也一樣找不到——因為這篇資料從建立那一刻起就沒有被送進 Pinecone。

**建議**

- 見 `X9-own-database-rag-deepdive.md` 對 NSX-1 的建議:`create`/`update` 對 `mediaType:"text"` 應直接(或透過 backgroundJobs 非同步)呼叫 `upsertTeachingMaterialVectors`,不應只綁定在「抽文/轉錄」這條路徑上。
- 前端層面:待後端補齊向量化後,`TeachingArchive.tsx` 的搜尋框應該改呼叫 `teachingArchive.search`(或伺服器端讓 `list` 內部改用向量優先邏輯,前端 API 不必變),否則即使資料已被向量化,使用者透過本頁搜尋仍然感受不到語意檢索的價值。

---

### 🟠 HIGH — TeachingArchive 頁面對「已抽文」狀態的呈現,與「AI 助理能否引用」的實際情況不一致,且伺服器契約沒有欄位可以讓前端區分兩者

**Cluster**:contract-mismatch / uiux-defect(本輪新增)

**發現**

- `TeachingArchive.tsx:367-370`(頁首標語):「上傳 PDF、文件、圖片、影片、語音、簡報等素材並分類保存。**PDF 自動抽文、語音／影片自動轉文字後,AI 助理就能引用內容回答。**」——此標語把「抽文/轉文字完成」與「AI 能引用」直接劃上等號。
- `TeachingArchive.tsx:731-759` 的 `TranscriptionBadge`:對 `status === "completed"` 一律顯示綠色 `<CheckCircle2>` + 文字「已抽文」。
- 伺服器層核實(`server/routers/teachingArchive.ts:258-263`):`mediaType:"text"` 且有 `textContent`(建立此類型的必要條件,見 `assertMediaPayload`)時,`transcriptionStatus` **直接寫死 `"completed"`**,不經過任何抽取/embedding 流程。
- 但依上一則發現(承接 NSX-1),`mediaType:"text"` 的素材從未呼叫 `enqueueTeachingIngestion`,因此從未被向量化——`transcriptionStatus:"completed"` 只反映「已有文字內容」,不反映「已可被語意檢索/AI 引用」。
- 伺服器回傳給前端的欄位(`teaching_materials` 表 + `TEACHING_MATERIAL_SUMMARY_COLUMNS` 投影,`server/db.ts` 對照)裡**沒有任何** `vectorStatus`/`embeddingStatus`/`isVectorized` 一類欄位(全檔 grep 確認)——前端就算想額外顯示「是否已向量化」也無資料可用。

**影響**

- 使用者用「純文字輸入」建立教材後,卡片與詳情頁都顯示「已抽文」的完成態綠色勾勾,依頁首標語的邏輯合理推論「這篇已經可以被 AI 助理引用回答」——但實際上(見上一則發現)這篇內容從未進入向量索引,只能靠使用者在頁面內自己用 LIKE 關鍵字搜到。這是一個具體的「使用者被 UI 誤導、對系統能力有錯誤預期」案例,且無法從目前的 API 回應資料修正(client 沒有可用欄位)。
- 這比單純的「功能缺失」更麻煩:功能缺失至少使用者知道「還沒做」,而這裡是 UI 主動釋放「已完成」的錯誤信號。

**建議**

- 伺服器層(呼應 X9 對 NSX-1 的建議路徑):文字類型補上向量化後,再視需要新增一個獨立欄位(如 `ragIndexedAt`/`vectorStatus`)明確區分「文字已就緒」與「已進入語意索引」。
- 前端層面(即使後端尚未補齊向量化,也可以先做):`TranscriptionBadge` 或詳情頁補一個獨立的「AI 可搜尋」狀態指示,不要讓「已抽文」這個字面完成態暗示語意可搜尋性;或至少把頁首標語改得更精確(例如註明「純文字目前只能被關鍵字搜尋命中,語意檢索支援中」),避免過度承諾。

---

### 🟠 HIGH — `teachingArchive.update` 後端功能完整(含跨團隊搬移驗證),前端零呼叫;`isFeatured`/`sortOrder` 等欄位後端已接入實際排序邏輯,前端完全無從設定或查看

**Cluster**:contract-mismatch / dead-ui(既有稽核 M3/L2 已指出「前端零呼叫」,本輪獨立覆核伺服器端實作完整度 + 新增 isFeatured/sortOrder 已被 ORDER BY 使用的佐證)

**發現**

- 本輪對 `client/src/pages/TeachingArchive.tsx` 全檔 grep `teachingArchive\.update`,**零匹配**——`DetailDialog`(:1565-1784)只有查看(唯讀欄位展示)、重跑抽文(`reingestMut`)、刪除(`deleteMut`)三個動作,沒有任何編輯表單。
- 伺服器端本輪逐行核對 `server/routers/teachingArchive.ts:307-388` 的 `update` procedure:功能完整,包含
  - 透過 `loadMaterialForWrite` 做 owner/team_shared membership 授權;
  - 若 `patch.teamId` 換了新團隊,會額外驗證使用者是否為新團隊成員(:319-330);
  - 跨欄位驗證:`visibility` 改成 `team_shared` 卻沒有 `teamId` 會擋下來(:333-345 附近,函式落款於同一 procedure)。
  - `updateInputSchema = createInputSchema.partial()`(:103),意味著 `createInputSchema` 的每一個欄位理論上都能被 `update` 修改。
- `createInputSchema`(:57-103)明確包含 `thumbnailUrl`(:73-77)、`durationSeconds`(:78)、`pageCount`(:79)、`isFeatured`(:101)、`sortOrder`(:102)——本輪逐行核對 `TeachingArchive.tsx` 的 `UploadDialog`(:788-1305)與 `DetailDialog`(:1565-1784),確認**這五個欄位在前端完全沒有對應的輸入框或唯讀顯示**(`UploadDialog` 的「分類資訊」區塊只有描述/分類/來源類型/日期/地點/主題/講者/標籤/可見範圍/團隊,`MaterialCard`/`DetailDialog` 也沒有精選星號或排序相關 UI)。
- 本輪新增佐證:`isFeatured`/`sortOrder` 並非只是「後端接受但沒用到」的死欄位,而是**真的接入排序邏輯**——`server/db.ts` 的 `listTeachingMaterialsForUser`(用於 `list` procedure 的排序,:4140-4141)與另一支給 AI 用的完整版函式(:4202-4203)都用 `.orderBy(desc(teachingMaterials.isFeatured), desc(teachingMaterials.sortOrder), desc(teachingMaterials.createdAt))`。也就是說,這是一個「有真實效果、但使用者永遠無法操作,甚至無法得知它存在」的排序機制——所有教材的 `isFeatured` 恆為預設 `false`、`sortOrder` 恆為預設 `0`,排序實質上退化成純 `createdAt` 排序,但程式碼本身以為自己支援「精選置頂」。

**影響**

- 使用者上傳教材後,分類/主題/講者/描述打錯字或想調整可見範圍,唯一的修正方式是**刪除重傳**(且刪除是「移除 metadata,檔案本體仍保留在儲存空間」,見 `DetailDialog` 的刪除確認文案 :1756-1760,意味著重傳等於留下一份無主的孤兒檔案在儲存空間)。
- 「精選教材置頂」這個看似已經做好一半(後端排序邏輯已寫)的功能,對使用者而言完全不存在——不知道有這個概念,也無從使用。

**建議**

- 依 M3 建議:`DetailDialog` 補上編輯表單(可重用 `UploadDialog` 的分類欄位子集,呼叫 `teachingArchive.update`),優先解決「刪除重傳」這個最痛的可用性缺口。
- 若 `isFeatured`/`sortOrder` 短期內不打算開放給一般使用者設定,至少應該讓管理員/owner 能夠切換(比照 `LearnHub.tsx` 既有的「精選」`Switch` UI 樣式,`AdminDocForm` 已有先例可抄),否則這段排序邏輯形同技術負債。

---

### 🟡 MEDIUM — LearnHub.tsx 深連結開啟失敗(文件已被刪除/getById 404)時沒有任何錯誤提示,`?docId=` 殘留在網址列

**Cluster**:uiux-defect(本輪新增;因 LearnHub.tsx 整體不可達,此問題目前是「雙重死碼」,但一旦上一則 CRITICAL 發現被修復、頁面重新可達,此缺口會立即變成真實使用者體驗問題,故仍列出)

**發現**

- `LearnHub.tsx:2210-2213`:
  ```ts
  const { data: openDocData } = trpc.learnHub.getById.useQuery(
    { id: openDocId! },
    { enabled: !!openDocId, retry: false }
  );
  ```
- `LearnHub.tsx:2711`:`{openDocId && openDocData && (<DocDetailModal ... />)}`——只有 `openDocData` 存在時才渲染 Modal。
- 若 `openDocId` 對應的文件已被刪除(伺服器層 `getById` 拋 404/`NOT_FOUND`,`server/routers/learnHub.ts` 對應 procedure 邏輯,未在本檔逐行重新核對,採信 X6 既有稽核已核實的行為),`openDocData` 永遠是 `undefined`,`retry:false` 代表也不會重試——Modal 完全不渲染,沒有任何 toast/錯誤訊息,使用者只會看到「什麼都沒發生」,網址列的 `?docId=<已刪除id>` 也不會被清除(對照 `LearnHub.tsx:2714-2727` 的 `onClose` 邏輯是在**成功打開後關閉時**才清 URL,404 情境下這段程式碼根本不會被執行到)。
- 這與 `X6-learnhub-router-deepdive.md` 已指出的「寫入端從未讓 orb 快取失效」問題直接複合:AI 可能基於過期快取推薦一個已刪除文件的 `[ACTION:navigate:/learn?docId=<id>]`,使用者點擊後靜默失敗、毫無線索。

**影響**

- 對最終使用者而言,「AI 推薦的連結點下去沒反應」是不透明、難以自行排查的失敗模式,容易被誤認為「網站壞了」而非「這篇文件被下架了」。

**建議**

- 在 `getById` query 的 `onError`(或改用 React Query v5 的 `isError` 狀態)中顯示一則 toast(例如「這篇文件已不存在或已被下架」),並清除網址列的 `?docId=` 參數,避免使用者重新整理時再次觸發同樣的靜默失敗。

---

### 🟢 LOW — LearnHub.tsx 匯入的附件 URL(`attachments[].url`)未限制 scheme,`DocDetailModal` 直接把它當 `href`/`src` 渲染

**Cluster**:client-security(本輪新增;因整支檔案目前不可達,實際風險趨近於零,但若上述 CRITICAL 發現被修復重新上線,此問題會同時復活,故列出供日後修復時一併處理)

**發現**

- `server/routers/learnHub.ts:573-580` 的 `attachments` schema:`url: z.string().url()`——zod 的 `.url()` 驗證是呼叫原生 `new URL()` 建構子是否丟錯,`new URL("javascript:alert(1)")` **不會**拋錯(`javascript:` 是合法 URL scheme),故此驗證不會擋下 `javascript:` URI。
- `LearnHub.tsx:433-440`(`DocDetailModal` 內附件區塊):
  ```tsx
  <a href={asset.url} target="_blank" rel="noopener noreferrer">下載 / 開啟</a>
  ```
  直接把 admin 填入的 `asset.url` 當 `href` 渲染,沒有 scheme allowlist 檢查。
- 對照同檔 `createInputSchema`(`server/routers/teachingArchive.ts:65-77`,TeachingArchive 這一側)特地用 `.refine(u => /^https?:\/\//i.test(u), ...)` 額外擋 `javascript:`/`data:`/`file:`,而 `learnHub.ts` 的 `attachments.url` 沒有比照這個作法——是同一產品內兩套不同嚴謹度的 URL 驗證。

**影響**

- 若 admin 帳號被盜用,或(呼應既有稽核 X6 已列為 HIGH 的發現)透過未清洗的 `importDocs` 塞入惡意 `attachments.url`,理論上能讓「下載 / 開啟」連結執行 `javascript:` payload;`target="_blank"` + `rel="noopener noreferrer"` 會限制其存取 `window.opener`,但不阻止在新分頁內執行。因為整支頁面目前不可達,此風險目前無法在生產環境觸發。

**建議**

- 若日後恢復 `LearnHub.tsx` 的可達性,`learnHub.ts` 的 `attachments.url`(以及 `externalUrl`)schema 應比照 `teachingArchive.ts` 的 `fileUrl`/`thumbnailUrl` 做法,加上 `^https?://` 的 `.refine()`。

---

## 已驗證排除的疑慮(negative results)

1. **LearnHub.tsx 的 Markdown 渲染無 stored XSS**:`renderMarkdown()`(`LearnHub.tsx:174-237`)在做任何正則轉換前,先呼叫 `escapeHtml()`(:166-172)把 `& < > "` 全部轉義,之後才套用 markdown 樣式的正則替換——本輪重新逐行核對這個順序,確認轉義發生在正則替換**之前**,使用者輸入無法在 `dangerouslySetInnerHTML`(:413-418)產生的 HTML 中被解讀成標籤。與 `X6-learnhub-router-deepdive.md` 既有結論一致。
2. **TeachingArchive.tsx 對 `textContent`/`description` 等使用者輸入一律走 JSX 文字插值,非 `dangerouslySetInnerHTML`**:`DetailDialog`(:1633-1640)、`MaterialCard`(:704-709)皆用 `{item.textContent}`/`{item.description}` 直接插入 JSX,由 React 自動 escape,本輪確認全檔(1969 行)沒有任何 `dangerouslySetInnerHTML` 出現,不構成 XSS 面。
3. **`teachingArchive.update` 的伺服器端授權與跨欄位驗證邏輯本身正確、完整**(僅是前端未接):本輪逐行核對 `server/routers/teachingArchive.ts:307-388`,確認換團隊時有驗證新團隊 membership、`visibility`/`teamId` 組合有做一致性檢查——問題純粹是前端零呼叫(見上方發現),不是後端邏輯本身有缺陷。
4. **`/teaching-archive` 路由本身不受 §1 CRITICAL 發現的 shell 攔截問題影響**:本輪核對 `App.tsx:387-389` 的 `<Route path="/teaching-archive">` 與 `shells/learn/LearnShell.tsx:44` 的 `<Route path="/learn/teaching-archive"><ShellPage component={P.TeachingArchive} /></Route>`——`"teaching-archive"` 不在 `SHELL_IDS`(`["video","social","learn","settings"]`)清單裡,且 `/learn/:rest*` 的萬用比對在富 shell **內部**的 `<Switch>` 才生效(該內部 Switch 明確列出 `/learn/teaching-archive` 這條子路徑,對映到同一支 `TeachingArchive.tsx`),故 `TeachingArchive.tsx` 在生產環境確實可達,不同於 `LearnHub.tsx` 的孤兒頁狀況——兩者不可混為一談。
5. **`teachingArchive.list`/`teachingArchive.get`/`triggerIngestion`/`delete`/`logView`/`accessLog` 這幾個 `TeachingArchive.tsx` 實際呼叫的 procedure,伺服器端確實存在且參數形狀與前端呼叫一致**:本輪對照 `TeachingArchive.tsx` 各處 `trpc.teachingArchive.*.useQuery`/`useMutation` 呼叫與 `server/routers/teachingArchive.ts` 對應 procedure 的 input schema,未發現欄位名稱或型別不一致的 contract-mismatch。
6. **`TrainLoraDialog`(TeachingArchive.tsx:1403-1560)呼叫的 `loraTrainer.trainWithReplicate` 不在本輪稽核範圍內獨立核實**——本輪只確認前端呼叫的欄位形狀(`modelName`/`modelType`/`triggerWord`/`steps`/`imageUrls`)與其 UI 表單一致,未深入 `loraTrainer` router/service 本身,不計入本文結論,亦不代表已排除該路由自身可能存在的問題(未在本檔驗證)。

---

## 未查完部分(誠實聲明)

- `client/src/shells/video/drawers/TeachingArchiveGrounding.tsx`(唯一呼叫 `teachingArchive.search` 的消費端)本輪未讀取,僅依既有稽核(L2)引用其存在與呼叫關係,未獨立核實其呼叫細節與 UI 呈現。
- `server/routers/learnHub.ts` 的 `getById`/`videoGetById`/`quizGetById` procedure 對「找不到」情境的確切錯誤碼(`NOT_FOUND` vs 其他)本輪沿用 X6 既有稽核的結論,未重新逐行核對本次任務範圍外的該 router 全文。
- `LearnHub.tsx` 的 `UploadDialog`(教材匯入 file input)與 `EntryCard`(檔案模式逐檔進度)渲染細節與 `TeachingArchive.tsx` 的 `TrainLoraDialog` 呼叫鏈路,已逐行讀取但未做執行期(瀏覽器)實測,僅靜態程式碼閱讀結論。
- 本文未重新驗證 `server/routers/learnHub.ts`/`teachingArchive.ts` 除本文引用行號外的其餘授權/速率限制/成本控制面向——這些已由 `X6-learnhub-router-deepdive.md`、`X9-own-database-rag-deepdive.md` 覆蓋,本文不重複稽核,僅在與前端 UI 直接相關處引用其結論並標明「既有稽核確認」。

---

## 附錄:發現與行號速查

| 嚴重度 | 標題 | Cluster | 檔案:行號 |
|---|---|---|---|
| CRITICAL | LearnHub.tsx 整檔在正式環境不可達 + `?docId=` 深連結是死指令 | northstar-flow / dead-ui | App.tsx:244,345-347;shellRouteContract.ts:19;ShellRoutes.tsx:75-86;featureFlags.ts:58,70;learnFlags.ts:32;LearnShell.tsx:27,33,38;LearnHome.tsx:42-45;LearnDocsPanel.tsx:108-129;siteKnowledge.ts:46,168 |
| CRITICAL | 管理後台「內容治理」承諾的編輯/匯入/新增入口實際落在唯讀面板 | northstar-flow / dead-ui | ContentTab.tsx:9,57-66;AdminPanel.tsx:22,64;SettingsHome.tsx:23,76 |
| HIGH | TeachingArchive 搜尋僅 LIKE,疊加 NSX-1(text 永不向量化) | northstar-flow | TeachingArchive.tsx:188-213;teachingArchive.ts:159-166,240-244,420-459;db.ts(listTeachingMaterialsForUser search 分支) |
| HIGH | 「已抽文」badge 誤導使用者以為文字已可被 AI 引用 | contract-mismatch / uiux-defect | TeachingArchive.tsx:367-370,731-759;teachingArchive.ts:258-263 |
| HIGH | teachingArchive.update 前端零呼叫;isFeatured/sortOrder 已入排序邏輯但前端無從設定 | contract-mismatch / dead-ui | TeachingArchive.tsx(全檔 grep 0 update);teachingArchive.ts:57-103,307-388;db.ts:4140-4141,4202-4203 |
| MEDIUM | 深連結 404 時無錯誤提示,`?docId=` 殘留網址列 | uiux-defect | LearnHub.tsx:2210-2213,2711,2714-2727 |
| LOW | 附件 URL 無 scheme 限制,`<a href>` 直接渲染 | client-security | learnHub.ts:573-580;LearnHub.tsx:433-440 |
