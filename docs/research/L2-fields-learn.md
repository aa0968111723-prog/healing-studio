# L2 欄位字典：learn shell 逐欄逐元件地毯掃描

> 產生日期：2026-07-03 ｜ 地毯掃描 wave L
> commit：4d137bdb907d67e6708ca360a66e89de0a6f2c2e（任務單指定；HEAD 實測為 fc860b45a5，
> 兩者間 learn shell 相關檔案零差異 `git diff 4d137bd..HEAD -- <本文所涉檔案>` 已核對，故沿用 HEAD 現況）
> 範疇：LearnHub 全部頁面（LearnHome 七分頁＋LearnHub.tsx 完整版四分頁）、AIModelsHub、
> ModelWishlistPage、MyBrainPage、AgentCodexPage、TeachingArchive、TeamsPage、FeedbackPage、
> TutorialOverviewPage。對照 01-features.md §2（功能盤點，本文不重複其結論，只補元件/欄位級）。
>
> 標記約定（同 H2）：`⚰` 死欄位/未接線控制項、`👻` 隱藏能力（後端有/前端無 UI）、
> `≠` 前後端不一致、`(共)` 共用欄位。

---

## 0. 全站路由關鍵發現：LearnHub.tsx 與 AIModelsHub.tsx 在正式環境已是孤兒頁

這是本波最大發現，影響 §1、§2 的解讀，先講清楚再進欄位表。

**證據鏈**（`client/src/`）：
1. `.env.production:21,27,28`：`VITE_ENABLE_4SHELL=1`、`VITE_SHELL_LEARN=1`、`VITE_SHELL_LEARN_RICH=1`
   （三者皆預設/正式環境 ON，非理論值）。
2. `app/ShellRoutes.tsx:72-85`：`/learn` 與 `/learn/:rest*` 兩條 Route 由 `shellRoutes()`
   注冊在 `<Switch>` **第一個子節點**（`App.tsx:244`），wouter 取第一個 match，
   故永遠 shadow 掉 `App.tsx:345-350` 舊的 `<Route path="/learn">`（→`LearnHub.tsx`）與
   `<Route path="/ai-models-hub">`（→`AIModelsHub.tsx`）。
3. `shells/shellRouteTable.ts:103`：`{ from: "/ai-models-hub", to: "/learn/ai-models" }` 在
   `LEGACY_REDIRECTS` 裡，同樣搶在舊 Route 前生效 — 連直接打 `/ai-models-hub` 網址也會被
   redirect 到 `/learn/ai-models`，不會進到 `AIModelsHub.tsx`。
4. `shells/LearnShell.tsx` re-export `shells/learn/LearnShell.tsx`（P6 富 shell）；其內部
   `if (!SHELL_LEARN_RICH) return <ShellFrame shell="learn" />`（唯一能讀到
   `SHELL_SUBROUTES.learn`＝`P.LearnHub`/`P.AIModelsHub` 的路徑），但 `SHELL_LEARN_RICH`
   正式環境為 `true`，故該分支永不觸發。
5. 富 shell 自己的 `<Switch>`（`shells/learn/LearnShell.tsx:33-46`）把 `/learn` 導向
   `<LearnHome/>`、`/learn/ai-models` 導向 `<LearnHome initial="models"/>`
   （→`AIModelHubPanel.tsx`，一支完全重寫、更精簡的元件，非 `AIModelsHub.tsx`）。
6. Admin 內容分頁 `shells/settings/admin/ContentTab.tsx:55` 的「查看 AI 模型情報」按鈕
   `navigate("/learn/ai-models")` — 連 admin 治理入口本身連的也是簡化版 panel，佐證
   `AIModelsHub.tsx` 在站內已無任何導航路徑可達。

**結論**：在目前（且正式環境已核實）的旗標組合下，`client/src/pages/LearnHub.tsx`
（2770 行，四分頁：文件/提示詞/影片/測驗，含 admin CRUD、批次匯入）與
`client/src/pages/AIModelsHub.tsx`（3684 行，含比較器、自動研究面板、per-model 重新查證）
**兩支都是死碼／孤兒頁**——只有把 `VITE_SHELL_LEARN_RICH` 手動設回 `0` 才會被使用者觸及。
下面 §1.2、§2 仍照任務要求逐欄盤點（因其程式碼與欄位本身是「完整」的，只是不可達），
並在標題註明「（孤兒頁，僅 SHELL_LEARN_RICH=OFF 時可達）」。

---

## 1. LearnHub（/learn）

### 1.1 LearnHome 七分頁（`shells/learn/LearnHome.tsx` — 現行可達版本）

#### A. 元件/區塊清單

| 分頁 | 元件 | 用途 | 互動 |
|---|---|---|---|
| 🚀 新手路徑（`start`，FEATURE_LEARN_BEGINNER_PATH 預設 ON 才有此分頁） | `BeginnerPathPanel` | 5 步線性路徑卡＋persona 選擇器 | 打勾完成/重置/persona 切換/CTA 導覽（純前端 localStorage） |
| 研究代理（`research`） | `ResearchPanel` | Sonar+Brave 即時研究問答 | 輸入框＋送出鈕；`VITE_RESEARCH_PROVIDER` 預設 `mock`⚰（示範資料，非真研究） |
| 模型情報（`models`） | `AIModelHubPanel` | 115+ 模型瀏覽（簡化版，非 AIModelsHub.tsx） | 篩選×3＋搜尋＋五腦指派 select |
| 學習中心（`hub`） | `LearnDocsPanel` | 學習文件瀏覽（簡化版，非 LearnHub.tsx 四分頁） | 搜尋＋難度 select＋分類 chip；無詳情 Modal、無 admin CRUD |
| 積分（`credits`） | `CreditsUsagePanel` | 餘額/用量唯讀展示 | 純唯讀，無互動控制項 |
| API 金鑰（`keys`） | `ApiKeysPanel` | BYOMCP 佔位＋admin 平台金鑰狀態 | 純唯讀（isSet 燈號），無新增/測試/刪除 |
| 新聞（`news`） | `NewsPanel` | 情報新聞列表 | 純唯讀清單，**無分類/搜尋 UI**⚰（`news.list` 支援 `category` 參數但本面板固定 `{limit:20}` 未接） |

#### B. 欄位表

**models 分頁（AIModelHubPanel.tsx）**

| 欄位/控制項 | 型別 | 前端 state | 預設 | 範圍/選項 | tRPC 參數 | 備註 |
|---|---|---|---|---|---|---|
| 模態 | native select | `modality` | `"all"` | all/llm/image/video/audio/search/embed/agent | `aiModels.list({modality})` | |
| 廠商 | native select | `provider` | `"all"` | 從回傳資料動態推導 | `aiModels.list({provider})` | |
| 層級 | native select | `tier` | `"all"` | all/frontier/balanced/lightweight/open-source | `aiModels.list({tier})` | |
| 搜尋 | Input | `search` | `""` | 自由字（label/provider 前端 contains） | 無（純前端過濾，不送後端） | |
| 五腦指派 | native select ×5（director/analyst/storyteller/technician/curator） | 各 select 獨立 uncontrolled | `""` | 依角色 `BRAIN_ELIGIBLE_MODALITY` 過濾候選模型 | `agentModelPicks.recordPick({modality,modelId,source:"manual"})` | 未登入時 onError toast「需登入」 |

**research 分頁（ResearchPanel.tsx）**

| 欄位 | 型別 | state | 預設 | 備註 |
|---|---|---|---|---|
| 問題輸入框 | Input（Enter 送出） | `q` | 「影片跨鏡角色一致性怎麼做？」（預填範例） | |
| 研究鈕 | Button | `state` FSM | idle | disabled when loading |

**hub 分頁（LearnDocsPanel.tsx）**

| 欄位 | 型別 | state | 預設 | 選項 | tRPC |
|---|---|---|---|---|---|
| 搜尋 | Input | `search` | "" | 自由字 | `learnHub.list({search})` |
| 難度 | native select | `difficulty` | "" | 入門/進階/高級→`DIFF_MAP`轉 beginner/intermediate/advanced | `learnHub.list({difficulty})` |
| 分類 chip | button 群 | `category` | "" | 動態自 `learnHub.categories()` | `learnHub.list({category})` |

**PromptReferenceTab（提示詞庫，掛在 LearnHub.tsx 舊頁內，非 LearnHome 分頁——見 1.2）**

---

### 1.2 LearnHub.tsx 完整版四分頁（孤兒頁，僅 `SHELL_LEARN_RICH=0` 時可達）

#### A. 元件/區塊清單

| Tab | 元件/區塊 | 用途 | 互動 |
|---|---|---|---|
| docs | 文件列表格柵＋Hero 精選區＋搜尋/分類/難度篩選列＋詳情 Modal（`openDocId`）＋admin 新增/編輯/刪除 Dialog＋批次匯入（隱藏 file input＋`importDocsMut`） | 主文件庫 CRUD | 完整 |
| prompts | `PromptReferenceTab`（獨立元件，見下） | 提示詞庫瀏覽 | 完整 |
| videos | 影片列表＋詳情 Modal＋admin CRUD Dialog（`VideoForm`） | 影片學習區（**記憶體儲存，reboot 即丟**，AIDV-190） | 完整 |
| quizzes | 測驗列表＋作答流程（`currentQ/selectedAnswer/showExplanation/score/finished/answers`）＋admin CRUD Dialog（`QuizForm`） | 測驗（**成績不落任何儲存**，只存在 React state） | 完整 |

#### B. 欄位表

**主篩選列（docs tab，:2154-2266）**

| 欄位 | 型別 | state | 預設 | 選項/範圍 | tRPC | 備註 |
|---|---|---|---|---|---|---|
| 搜尋 | Input | `searchQuery` | "" | 支援 `?search=` 深連結預填 | `learnHub.list({search})` | |
| 分類 | select | `selectedCategory` | "all" | 動態 `CATEGORIES` | `learnHub.list({category})` | |
| 難度 | select | `selectedDifficulty` | "all" | beginner/intermediate/advanced | `learnHub.list({difficulty})` | |
| docId 深連結 | URL param | `openDocId` | URL `?docId=` | — | `learnHub.getById({id})` | 供光球 `[ACTION:navigate:/learn?docId=]` |
| 批次匯入 | 隱藏 file input（JSON） | `importInputRef` | — | JSON 陣列或 `{docs:[]}` | `learnHub.importDocs({docs})` | 格式錯誤 toast 攔截 |

**文件新增/編輯 Dialog（DocForm，:505-572）**

| 欄位 | 型別 | state | 預設 | 範圍 | tRPC 參數 | 資料表欄位（`learn_modules`） | 備註 |
|---|---|---|---|---|---|---|---|
| 標題 * | Input | `title` | "" | 必填 | `title` | `title varchar(200)` | |
| 摘要 * | Textarea | `summary` | "" | 必填（前端擋） | `summary` | `summary varchar(500)` | |
| 內容 * | （上層傳入，未截圖但同表單） | `content` | "" | 必填 | `content` | `content mediumtext` | |
| 分類 | Select | `category` | "getting-started" | `CATEGORIES` 排除 all | `category` | `category varchar(32)` | |
| 難度 | Select | `difficulty` | "beginner" | beginner/intermediate/advanced | `difficulty` | `difficulty enum` | |
| 閱讀分鐘 | number input | `readingMinutes` | 5 | 任意數字 | `readingMinutes` | `readingMinutes int default 5` | |
| 標籤 | Input（逗號分隔字串） | `tags` | "" | 自由字→split(",") | `tags` | `tags json` | |
| 精選 | Switch | `featured` | false | — | `featured` | `featured boolean` | |
| 外部連結 | Input | `externalUrl` | "" | URL | `externalUrl` | `externalUrl varchar(500)` | |
| 作者 | Input | `authorName` | "" | 自由字 | `authorName` | `authorName varchar(100)` | |
| 附件 | Textarea（JSON 陣列文字） | `attachmentsText` | `"[]"` | 需合法 JSON，`type` 限 image/video/pdf/audio | `attachments` | `attachments json` | 貼錯 JSON 前端 toast 擋 |

**影片新增/編輯 Dialog（VideoForm，:955-996）**：欄位同 DocForm 骨架（title*/summary/videoUrl*/category/difficulty/durationMinutes/tags/featured/authorName），分類排除 `api-docs`；mutation 走 `learnHub.videoCreate/videoUpdate` — **落記憶體陣列，無資料表**。

**測驗新增/編輯 Dialog（QuizForm，:1481-1544+）**：title*/summary/category/difficulty/estimatedMinutes/tags/featured/authorName + **questionsJson**（Textarea 直接編輯 JSON 陣列，格式 `{id,question,options[],correctIndex,explanation}`，前端僅驗證能 `JSON.parse` 且非空陣列，**無逐題結構驗證**⚰）；mutation `learnHub.quizCreate/quizUpdate` — 同樣純記憶體。

**PromptReferenceTab.tsx（提示詞庫，獨立於 LearnHub.tsx 之外的元件，掛 prompts tab）**

| 欄位 | 型別 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 搜尋 | Input | `search` | "" | title/summary/prompt/tags 全文 contains | 純前端過濾（`PROMPT_REFERENCE_LIBRARY` 靜態資料，非 DB） |
| 模態 chip | button 群 | `selectedModality` | "all" | `PROMPT_REFERENCE_MODALITIES` | |
| 難度 chip | button 群 | `selectedDifficulty` | "all" | beginner/intermediate/advanced | |
| 複製提示詞/複製負面提示詞 | Button | — | — | — | `copyToClipboard` |
| 存到我的詞庫 | Button | `savingId` | null | 需登入 | `promptLibrary.create({title,content,category,tags,isPublic:false,modelHint,language})` |

---

## 2. AIModelsHub（/ai-models-hub、/learn/ai-models 皆 redirect 到簡化版；本體孤兒頁見 §0）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| Hero＋統計卡（模型總數/廠商/精選/已自動查核） | 總覽 | `useAnimatedCount` 純視覺 |
| `AutoResearchPanel`（自動研究面板） | 排程狀態＋admin 手動觸發 | 見下表 |
| `FeaturedSpotlight` | 精選模型輪播 | 僅在無篩選時顯示 |
| `DiscoveriesPanel`（本期新發現） | 展示 cron 找到的新模型/論文/更新 | admin「立即發現」鈕 |
| `CrossModelUpdatesFeed` | 跨模型近期更新流 | 僅在無篩選時顯示，點擊開詳情 |
| 篩選列（modality tabs＋provider pills＋tier pills＋搜尋＋清除） | 主篩選 | 見下表 |
| 模型格柵 `ModelCard` | 每卡含「加入比較」勾選 | 最多 4 款 |
| `ReleasesTimeline` | 發佈時間軸 | 點擊開詳情 |
| `NewsStrip` | 即時新聞條 | 唯讀 |
| `CompareBar`（浮動比較列）＋`ComparisonView`（全螢幕比較表） | 2-4 款並列比較 | 見下 |
| 模型詳情 Dialog（`openModel`） | 單模型全細節＋per-model「重新研究」鈕（admin） | `aiModels.refreshOne` |
| `ScheduleEditorDialog` | 排程 cron 編輯（picker/raw 雙模式） | 見下表 |

### B. 欄位表

**主篩選列（:3175-3547）**

| 欄位/控制項 | 型別 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 模態分頁 | button 群 | `activeModality` | "all" | all/text/image/video/audio/multimodal/agent/deep-research | deep-research 走 `category` 欄位而非 `modality` |
| 廠商 | pill 群 | `activeProvider` | "all" | 動態自 `allProviders`（伺服器+靜態聯集） | |
| 層級 | pill 群 | `activeTier` | "all" | `TIER_FILTERS` | |
| 搜尋 | Input | `search` | "" | 對 name/apiId/tagline/description/provider/tags/useCases/benchmarks/latestUpdates 全文 contains | 純前端過濾，`aiModels.list` 一次抓全表 |
| 清除篩選 | button | — | — | 重置四欄 | 僅 `hasActiveFilters` 時顯示 |
| 光球代理 capability | `agentCapabilities` | — | — | setTab/search/setParam(provider/tier)/reset | `pagePath:"/ai-models-hub"`⚰（硬編碼舊路徑，與現行不可達路由不一致，純殘留） |

**AutoResearchPanel 管理員按鈕（:2547-2806）**

| 控制項 | 觸發 | tRPC | gate | 備註 |
|---|---|---|---|---|
| 「只刷新過期 (N)」 | `refreshStale.mutate()` | `aiModels.refreshStale` | isAdmin；`inProgress`/其他 mutation pending 時 disabled | N=stale+pending+error 計數 |
| 「手動執行完整研究」 | `refreshAll.mutate()` | `aiModels.refreshAll` | isAdmin | 進行中會顯示「研究進行中…」並鎖死 |
| 調整排程（時鐘 icon） | 開 `ScheduleEditorDialog` | — | isAdmin | |
| 「上次有 N 個錯誤」摺疊 | `showErrors` 開關 | — | 無 gate（純前端） | 最多顯示 50 筆 |
| 「立即發現」（DiscoveriesPanel） | `runDiscovery.mutate()` | `aiModels.runDiscovery` | isAdmin | |
| 「重新研究」（單模型，ModelCard/詳情 Modal 各一份） | `refreshOne.mutate()` | `aiModels.refreshOne` | isAdmin | 出現兩處程式碼幾乎重複（:361, :1269），可考慮抽共用 hook |

**ScheduleEditorDialog（:2313-2450+）**

| 欄位 | 型別 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 模式 | 內部切換 | `mode` | `parsed?"picker":"raw"` | picker/raw | cron 解析不出標準樣式時強制 raw |
| 預設頻率 | Select | `preset` | `parsed?.preset ?? "daily"` | daily/weekday/weekly | |
| 星期 | Select（僅 weekly） | `weekday` | `parsed?.weekday ?? 0` | 0-6 | |
| 小時 | Select | `hour` | `parsed?.hour ?? 3` | 0-23 | |
| 分鐘 | Select | `minute` | `parsed?.minute ?? 30` | 0-59 | |
| 原始 cron | Input | `rawCron` | 現行 cron 字串 | 自由字（5 段） | raw 模式手動輸入 |
| 儲存 | Button | — | — | — | `aiModels.setSchedule` |

**ComparisonView（2-4 款比較表，:2887+）**：純唯讀比較列（廠商/模態/層級/發佈/上下文/Input單價/Output單價/計價單位/Top benchmark/視覺輸入/工具呼叫/程式執行/網頁搜尋/Prompt快取/Batch API…），無任何輸入欄位、無編輯功能，僅展示。

---

## 3. ModelWishlistPage（/learn/model-wishlist — 現行可達，全接線完整）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| 許願 Dialog（`showCreate`） | 建立新許願 | 表單，見下 |
| 篩選列 | 模態/狀態/排序 | Select×3 |
| 許願清單卡片 | 投票/刪除/查看站方回覆/admin 治理 | 見下 |
| `AdminNoteEditor` Dialog | admin 撰寫「站方回覆」 | Textarea＋清除/儲存 |

### B. 欄位表

**許願建立表單（Dialog，:198-277）**

| 欄位 | 型別 | state | 預設 | 範圍/選項 | tRPC 參數 | 資料表欄位（`model_wishes`） | 備註 |
|---|---|---|---|---|---|---|---|
| 模型名稱 * | Input | `modelName` | "" | ≤191 字 | `modelName` | 對應欄位 | disabled 直到非空白 |
| 廠商 | Input | `provider` | "" | ≤128 字，可選 | `provider` | | |
| 模態 | Select | `modality` | "other" | 9 選項（text/image/video/audio/voice/3d/multimodal/embedding/other） | `modality`（zod enum） | | |
| 理由 | Textarea | `reason` | "" | ≤2000 字，可選 | `reason` | | |
| 參考連結 | Input type=url | `referenceUrl` | "" | ≤2048 字，可選 | `referenceUrl` | | |

**篩選列（:117-137, 280-329）**

| 欄位 | 型別 | state | 預設 | 選項 | tRPC |
|---|---|---|---|---|---|
| 模態 | Select | `modalityFilter` | "all" | 同上 9 選項+all | `modelWishes.list({modality})`（`publicProcedure`，未登入也可查） |
| 狀態 | Select | `statusFilter` | "all" | pending/under_review/planned/added/rejected+all | `modelWishes.list({status})` |
| 排序 | Select | `sort` | "votes" | votes/latest | `modelWishes.list({sort})` |

**投票/管理控制**：投票鈕（`vote`/`unvote`，交易+唯一索引防重複，見 `modelWishVotes` 表）；刪除（owner 或 admin，`window.confirm` 二次確認）；admin 專屬：狀態 Select（5 值，`updateStatus`）＋站方回覆 Dialog（`adminNote`，可清除為 null，避免覆蓋他人剛改的 status——mutation 只送 `adminNote` 不含 `status`，設計上刻意分離避免競態）。

---

## 4. MyBrainPage（/learn/my-brain — 純展示頁，現行可達）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| `SummaryBar` | 自動刷新開關＋狀態篩選 | 見下 |
| `PipelineCanvas` | 6 層腦組態關係圖（5 推理大腦/4 生成引擎/16 Fal 任務引擎） | 節點可點擊查看說明 |

### B. 欄位表

| 欄位 | 型別 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 自動刷新 | Switch | `autoRefresh` | true | on/off | `refetchInterval` 30s（true 時）/false（off） |
| 狀態篩選 | 按鈕群（SummaryBar 內） | `statusFilter` | "all" | all / PipelineNodeStatus 各值 / "issues" | 再點同一值會回退 all（toggle） |
| 手動刷新 | Button | — | — | — | `graphQuery.refetch()` |

> 本頁**唯一**呼叫 `brainPipeline.getMyGraph`；真正 CRUD `user_ai_brain` 的表單在 AdminPage
> 的 `AiBrainSettings`（brain 分頁），本頁無寫入能力（as designed，符合 01-features 結論）。
> 光球 capability 僅 `navigate`，且有硬編碼 allowlist（4 個目的地）防止亂跳頁。

---

## 5. AgentCodexPage（/learn/codex — 零後端，現行可達）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| `CodexStatsBar` | 條目總數/精靈/頁面/主動觸發 統計 | 純展示 |
| 今日特輯卡（`pickFeatureOfTheDay`） | 每日固定隨機一條 | 點擊跳轉該卡片 |
| 搜尋列＋分類 chip | 篩選 ~480 條目 | 見下 |
| 「複製為 markdown」 | 複製目前篩選結果 | `buildCodexMarkdown` |
| `EntryCard`（×N） | 條目卡：title/summary/aliases/examples/相關條目 | 命中欄位高亮、範例點擊預填光球輸入框或直接導頁 |

### B. 欄位表

| 欄位 | 型別 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 搜尋 | Input | `query` | URL `?q=` 或 "" | 自由字，含同義詞展開 | 同步進 URL（`history.replaceState`，不污染 history） |
| 分類 chip | button 群 | `activeCategory` | "all" | `CODEX_CATEGORY_ORDER`（spirit/skill/page/workflow/tool/handoff/trigger 等） | |
| URL hash 深連結 | `#entryId` | `highlightedId` | URL hash 解碼 | — | 5 秒後自動解除紅框 |
| 範例按鈕 | button | — | — | — | 有 `pagePath` 且非 `quickAction` → 直接 `navigate`；否則 dispatch `orb-prefill-input` 事件預填光球輸入框 |

> 全頁無 tRPC 呼叫；資料來自 `shared/agent-codex` 建置期聚合，可離線顯示（與 01-features 結論一致）。

---

## 6. TeachingArchive「資料庫」（/learn/teaching-archive — 現行可達，本波重點）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| 視野切換（4 chip：全部/我的私人/團隊共享/全workspace公開） | scope 篩選 | 見下 |
| 五維篩選列（搜尋/檔案類型/來源/分類/主題） | list 篩選 | 見下 |
| 「選圖訓練 LoRA」/「新增資料」按鈕 | 進入多選模式／開上傳 Dialog | |
| 素材格柵 `MaterialCard` | 展示卡，選取模式下可勾選（僅圖片可選） | 點擊開詳情或勾選 |
| 多選浮動 footer | 顯示已選張數，≥4 張才能訓練 | 「訓練 LoRA」「取消」 |
| `UploadDialog` | 批次上傳（拖拉/多檔）+ 純文字輸入雙模式 | 見下（本波重點） |
| `DetailDialog` | 素材詳情、轉文字狀態、手動 reingest、刪除、存取稽核 | 見下 |
| `TrainLoraDialog` | 選取圖片送 Replicate 訓練 LoRA | 見下 |
| `AccessLogSection`（嵌詳情內） | 展開才打 `accessLog` query（403 靜默隱藏） | 展開/收合 |

### B. 欄位表

**五維篩選列 + 視野切換（:165-471）**

| 欄位/控制項 | 型別 | state | 預設 | 範圍/選項 | tRPC 參數 | 備註 |
|---|---|---|---|---|---|---|
| 視野（scope） | chip×4 | `filters.scope` | undefined（全部） | mine/team/public/undefined | `teachingArchive.list({scope})` | 支援 URL `?scope=` 深連結預填；團隊 chip 顯示團隊數量 badge |
| 搜尋 | Input | `filters.search` | "" | 對標題/描述/內文 LIKE | `teachingArchive.list({search})` | 非向量搜尋（見下方 search procedure 說明） |
| 檔案類型 | FilterSelect | `filters.mediaType` | undefined | text/pdf/document/image/video/audio/presentation | `teachingArchive.list({mediaType})` | 支援 URL `?mediaType=` |
| 來源 | FilterSelect | `filters.sourceType` | undefined | discourse/group_practice/class/ceremony/publication/interview/other | `teachingArchive.list({sourceType})` | |
| 分類 | FilterSelect | `filters.lineage` | undefined | 動態自 `teachingArchive.lineages()` | `teachingArchive.list({lineage})` | |
| 主題 | FilterSelect | `filters.topic` | undefined | 動態自 `teachingArchive.topics()` | `teachingArchive.list({topic})` | |
| 清除篩選 | Button | — | — | 重置全部 filters | — | 僅有值時顯示 |
| pending 輪詢 | `refetchInterval` | — | — | — | 有 pending/processing 轉文字狀態時 3s 輪詢，否則不輪詢 | |

**UploadDialog — 共用分類欄位（file / text 兩模式共用，:806-907, 1112-1263）**

| 欄位 | 型別 | state | 預設 | 範圍/選項 | tRPC 參數 | 資料表欄位（`teaching_materials`） | 備註 |
|---|---|---|---|---|---|---|---|
| 描述 | Textarea | `shared.description` | "" | ≤10,000 字 | `description` | | |
| 分類（lineage） | Input | `shared.lineage` | "" | ≤128 字自由文字 | `lineage` | | |
| 來源類型 | Select | `shared.sourceType` | "discourse" | 7 選項（同篩選列） | `sourceType`（zod default discourse） | | |
| 日期 | Input type=date | `shared.sourceDate` | "" | YYYY-MM-DD（zod regex 驗證） | `sourceDate` | | |
| 講授地點 | Input | `shared.sourceLocation` | "" | ≤255 字 | `sourceLocation` | | |
| 主題 | Input | `shared.topic` | "" | ≤128 字 | `topic` | | |
| 講者 | Input | `shared.speaker` | `DEFAULT_SPEAKER`("") | ≤128 字 | `speaker` | | |
| 標籤 | Input（逗號/頓號/空白分隔字串） | `shared.tagsInput` | "" | 每則 ≤64 字，≤32 則 | `tags`（split 後陣列） | | |
| 可見範圍 | Select | `shared.visibility` | "private" | private/team_shared/public_disciples | `visibility`（zod default private） | | 切離 team_shared 會自動清空 `teamId` |
| 共享團隊 | Select（僅 visibility=team_shared 顯示） | `shared.teamId` | null | 動態自 `teams.list()` | `teamId` | | 無團隊時顯示「請先建立/加入團隊」提示 |
| 連續新增 | Switch | `continuousMode` | false | — | — | 開啟後送出成功不關窗、保留分類欄位，只清 entries/textForm |

**UploadDialog — 檔案模式專屬（file tab）**

| 欄位 | 型別 | state | 備註 |
|---|---|---|---|
| 拖拉/選檔區 | 隱藏 file input，`multiple` | `entries: FileEntry[]` | accept 依偵測媒體類型（`ACCEPT_BY_MEDIA`） |
| 每檔標題 | （卡片內可編輯，程式碼在 1109 行後未逐行截圖，但由 `patchEntry` 更新） | `entry.title` | 預設 `deriveTitleFromFileName` |
| 逐檔進度/狀態 | 進度條 | `entry.progress/status` | queued→uploading→saving→done/error |

**UploadDialog — 純文字模式專屬（text tab，:1089-1108）**

| 欄位 | 型別 | state | 預設 | tRPC | 備註 |
|---|---|---|---|---|---|
| 標題 * | Input | `textForm.title` | "" | `title` | 必填（前端擋） |
| 內文 * | Textarea rows=10 | `textForm.textContent` | "" | `textContent`（≤500,000 字） | 必填（前端擋） |

**後端有、前端不送/不顯示的欄位（👻，`createInputSchema` 全量對照，`teachingArchive.ts:57-103`）**

| 欄位 | zod | 前端現況 |
|---|---|---|
| `thumbnailUrl` | url 選填 | UploadDialog 無此欄位輸入，恆不送 |
| `durationSeconds` / `pageCount` | int 選填 | 無前端輸入（理論上應由 ingest worker 補寫，前端不填） |
| `isFeatured` | boolean default false | 無精選開關 UI（對照 LearnHub 文件有「精選」Switch，本頁無對應） |
| `sortOrder` | int default 0 | 無排序欄位 UI |

**`update` mutation（`teachingArchiveRouter.update` = `createInputSchema.partial()`）⚰**：
grep 全 client 端零呼叫 —— `DetailDialog` 只有刪除/reingest/查看，**完全沒有編輯表單**；
一旦誤填分類資訊（如分類/主題/講者打錯字），使用者無法透過 UI 修正，只能刪除重傳。

**TrainLoraDialog（:1403-1560）**

| 欄位 | 型別 | state | 預設 | 範圍 | tRPC 參數 |
|---|---|---|---|---|---|
| 模型名稱 * | Input | `modelName` | "圖片 LoRA" | 必填 | `loraTrainer.trainWithReplicate({modelName})` |
| 觸發詞 * | Input | `triggerWord` | "STYLE" | 必填，建議英數大寫 | `triggerWord` |
| 模型類型 | Select | `modelType` | "portrait_lora" | portrait_lora/image_subject/style_lora/scene_lora | `modelType` |
| 訓練步數 | number input | `steps` | 1000 | 100-10,000 | `steps` |
| 圖片 URL 陣列 | 由已選取的圖片卡自動組成，非手動輸入 | — | — | 需 ≥4 張（前端擋，選取模式的浮動 footer 也擋） | `imageUrls` |

**DetailDialog（唯讀展示 + 動作按鈕，:1565-1780）**：顯示描述/內文（text 類型）/檔案預覽
（`FilePreview`）/轉文字狀態（`TranscriptionSection`）/講者/日期/地點/檔案大小/可見範圍/
建立時間/標籤；動作：「重跑」（reingest，僅 pdf/audio/video 且狀態 failed/completed 時顯示，
`canWrite` 才有）、刪除（二次確認 AlertDialog）、`AccessLogSection`（展開才查詢，20 筆
`view/download/search_hit` 等 action）。

**RealEarth 關聯 procedures（`link`/`unlink` 等，:462-527）**：grep 全 client 端零呼叫，
本頁與全站皆無 UI 入口（唯一 UI 在 video 導演台抽屜「真實地球研究」，且僅 search，不含
link/unlink）——與 01-features 結論一致，本波逐行核實確認。

**`teachingArchive.search`（向量語意搜尋 procedure）**：本頁的搜尋輸入框走 `list({search})`
（LIKE），**不是**呼叫這支語意搜尋；真正呼叫 `search` procedure 的地方只有
`shells/video/drawers/TeachingArchiveGrounding.tsx`（video 導演台的「教材庫接地」抽屜，
供光球在生成流程中 grounding 用），與教學文件頁本身無關。

---

## 7. TeamsPage（/learn/teams — 現行可達）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| 團隊列表（`TEAMS_COLLAB` OFF 時的簡化卡片版） | 點擊開詳情 | |
| `TeamsBoard`（`TEAMS_COLLAB` ON 時） | 看板式視圖，含 tasks 欄 | **tasks 恆空陣列**⚰（`boardTeams` 硬編碼 `tasks: []`），旗標預設 OFF |
| `CreateTeamDialog` | 建團隊 | 見下 |
| `TeamDetailDialog` | 成員列表/加成員/移除/離開/解散 | 見下 |

### B. 欄位表

**建立團隊 Dialog**

| 欄位 | 型別 | state | 預設 | tRPC |
|---|---|---|---|---|
| 團隊名稱 * | Input | `name` | "" | `teams.create({name})` |
| 描述 | Textarea rows=3 | `description` | "" | `teams.create({description})`（可選） |

**加入新成員（僅 owner/admin 可見）**

| 欄位 | 型別 | state | 預設 | 範圍 | tRPC | 備註 |
|---|---|---|---|---|---|---|
| userId | Input type=number | `addUserId` | "" | ≥1 整數，需同 workspace | `teams.addMember({teamId,userId,role})` | 「Phase 2 簡化版」註解自承，未來要做 email 邀請 |
| 角色 | Select | `addRole` | "member" | member/admin | `teams.addMember({role})` | |

**移除/離開/解散**：`removeMember`/`leave`/`delete` 皆走 `AlertDialog` 二次確認；
移除需 canManage（owner/admin）且對象非 owner；解散僅 owner 可見。

**⚰ 後端有、前端無 UI 的能力**：`teams.ts:198` `transferOwnership`、`teams.ts:229`
`updateMemberRole`（僅能在建立時選 member/admin，事後**無法改角色**，也無法轉移 owner
身份）——grep 全 client 端零呼叫，逐行核實確認 01-features 既有結論。

---

## 8. FeedbackPage（/learn/feedback — 現行可達）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| 建立回饋 Dialog | 4 欄表單 | 見下 |
| 回饋列表（`myFeedbacks`） | 唯讀展示自己送出的回饋 | 分類/優先級/狀態 badge |
| 光球 PageAgent capability | fillPrompt/setParam/submit | 供光球代填代送 |

### B. 欄位表

**建立回饋 Dialog（4 欄，全部送出）**

| 欄位 | 型別 | state | 預設 | 選項 | tRPC 參數 |
|---|---|---|---|---|---|
| 標題 | Input | `title` | "" | 自由字（僅前端擋非空白，未見長度上限 UI 提示） | `feedback.create({title})` |
| 描述 | Textarea rows=4 | `description` | "" | 自由字 | `feedback.create({description})` |
| 類別 | Select | `category` | "general" | bug/feature_request/quality_issue/general | `feedback.create({category})` |
| 優先級 | Select | `priority` | "medium" | low/medium/high/critical | `feedback.create({priority})` |

**⚰ 後端有、本頁不送的擴充欄位（`server/routers/feedback.ts:27-46`）**：
`featureArea`（≤120字）、`pageContext`（含 `landmark.rect` 物件，紀錄使用者點擊當下的頁面/
座標脈絡）、`screenshotKey`（server 端另有 `isKeyOwnedByUser` 歸屬驗證）——
grep 確認這三欄的**唯一**呼叫端是 `components/QuickFeedbackButton.tsx`（`ENABLE_QUICK_FEEDBACK`
浮鈕，預設 ON）與光球，FeedbackPage 本體的 Dialog 完全沒有截圖/頁面脈絡欄位的 UI。
即：站內存在兩條回饋建立路徑，欄位集合不對等。

> 建立速率限制（10 次/時）為後端層行為，本頁無對應的「已用額度」顯示 UI（使用者只會在
> 超過限制時收到 mutation onError 的 toast，無事先提示）。

---

## 9. TutorialOverviewPage（/tutorial-overview — 100% 靜態零後端）

### A. 元件/區塊清單

| 區塊 | 用途 | 互動 |
|---|---|---|
| 「啟動全站新手教學」/「用光球開始互動教學」 | 導覽入口 | Button×2 |
| 分站導覽卡（5 軌：welcome/learn/director/image-studio/video-studio） | 各軌「開始導覽」/「前往頁面」 | 橫向捲動卡片 |
| 功能教學入口（5 張：學習文件/導演AI/圖片/影片/音樂配音） | 快速跳轉 | Button |
| 光球 PageAgent | `navigate`，硬編碼 8 個目的地 allowlist | |

### B. 欄位表

無表單/篩選/輸入欄位——全頁純導覽按鈕，狀態只有 `useSiteOnboarding().startTour()` 寫入
`SiteOnboardingContext`（client-only，見 01-features「進度存 client」結論）。

---

## 10. 死欄位/未接線控制項彙總（本波新增，供後續 wave 引用）

| 位置 | 項目 | 性質 |
|---|---|---|
| 全站路由 | `LearnHub.tsx`（四分頁完整版）與 `AIModelsHub.tsx`（含比較器/研究面板） | **孤兒頁**：正式環境旗標下無任何導航路徑可達，只有手動關 `SHELL_LEARN_RICH` 才會用到 |
| AIModelsHub.tsx | `pagePath:"/ai-models-hub"`（PageAgent 註冊） | 硬編碼舊路徑殘留，與現況不可達路由不一致 |
| LearnHome / NewsPanel | `news.list({category})` 篩選能力 | 👻 後端支援分類篩選，前端固定 `{limit:20}` 未接 UI |
| LearnHub.tsx（孤兒頁） | 測驗 `questionsJson` Textarea | ⚰ 僅驗證 JSON 合法性，無逐題結構（options 陣列長度/correctIndex 範圍）驗證 |
| LearnHub.tsx（孤兒頁） | 影片/測驗 CRUD | 半成品：純記憶體儲存，redeploy 即丟（AIDV-190，01-features 既有結論） |
| TeachingArchive | `teachingArchive.update` mutation | ⚰ 後端有完整 `createInputSchema.partial()`，前端零呼叫，DetailDialog 無編輯表單 |
| TeachingArchive | `thumbnailUrl`/`durationSeconds`/`pageCount`/`isFeatured`/`sortOrder` | 👻 zod 接受但 UploadDialog 無對應輸入欄位 |
| TeachingArchive | RealEarth `link`/`unlink` 等 procedures | 👻 全站零 UI（僅 video 抽屜有唯讀 search） |
| TeachingArchive | `teachingArchive.search`（向量語意搜尋） | 頁內搜尋走 LIKE `list({search})`，語意搜尋只服務 video 導演台抽屜 |
| TeamsPage | `transferOwnership`、`updateMemberRole` | ⚰ 後端完整，前端零呼叫；成員角色僅能在加入當下決定，事後無法改 |
| TeamsPage | `TeamsBoard` 的 `tasks` 欄 | ⚰ 恆硬編碼空陣列；`TEAMS_COLLAB` 預設 OFF |
| FeedbackPage | `featureArea`/`pageContext`/`screenshotKey` | 本頁建立表單不送；僅 `QuickFeedbackButton` 浮鈕與光球會填 |
| ResearchPanel（LearnHome） | 研究 adapter | `VITE_RESEARCH_PROVIDER` 預設 `mock`，非真 Sonar+Brave（需手動切 `trpc`） |

---

## 11. 未查完部分（誠實聲明）

- LearnHub.tsx 的 `UploadDialog` 檔案模式逐檔標題編輯 UI（:1063-1089 之間細節）與
  `EntryCard` 完整 render 未逐行截圖，僅讀取 state/handler 部分。
- AIModelsHub.tsx 的 `FeaturedSpotlight`、`CrossModelUpdatesFeed`、`ReleasesTimeline`、
  `NewsStrip`、模型詳情 Dialog（`openModel` render）內部 JSX 細節未逐行讀（僅讀 state 掛鉤與
  按鈕邏輯），`ComparisonView` 完整 rows 清單（能力欄位之後半段）未讀到底。
- TeachingArchive 的 `FilePreview`、`TranscriptionSection`、`MaterialCard` 三個子元件內部
  render 細節（非表單，純展示）未逐行讀。
- LearnHome 各 panel 內 design-kit（`ENABLE_AIDV_CHROME` ON 版）視覺差異僅讀程式碼註解，
  未實機截圖比對兩版 UI。
- 未驗證 `teachingArchive.accessLog`/`teams.members` 等唯讀 procedure 在資料庫層的實際
  欄位型別（僅讀 router 端 zod 與呼叫點，未逐一核對 `drizzle/schema.ts` 每張表的完整欄位列）。
- 未實測執行任何頁面（純靜態程式碼閱讀），旗標預設值以 `client/src/config/featureFlags.ts`
  與 `.env.production` 為準，未在瀏覽器實跑驗證 runtime override（如 `?learnbeginnerpath=0`
  query override 之類）是否有其他隱藏開關來源。
