# 🎬 /video 影片製作 — 完整規格（旗艦）

> **性質**：`/video` shell 的權威規格。引用 `00_設計系統/設計系統.md`（token/元件）與 `01_殼層/殼層規格.md`（脊椎 chrome）。
> **核心**：以下方**六步影片製作工作流**為 `/video` 的**權威使用者旅程**，與既有三欄 cockpit、確認門狀態機、提示詞庫「生成→存庫→重用」整合，**以本規格為準**。
> **視覺**：亮色暖光 Claude；**保留原系統**（class/版面/功能全留）。
> **事實基準**：`AI-Director-模擬`（VideoShell/GuidedJourney/util.computeGate）＋ `_research/03_code_reality_notes.md`（GitNexus 真實 procedure）＋ `director.today_登入後內部盤點.md`（真實內容）＋ `AI-Director_四大系統架構.md` §2①。
> **rev. L1** · 2026-06-06

---

## 1. 心智與版面

**心智**：把一個故事做成影片——世界觀 → 腳本 → 分鏡 → 生成 → 成片。**首頁＝三欄 cockpit**，頂部五階段 `StageBar`。

**三欄（桌機 grid 300 / 1fr / 348）**
| 欄 | 內容（元件） | 真實接點 |
|---|---|---|
| **左 · 專案＋索引上下文** | 專案卡（emoji/名/logline/進度）→ `ContextSource` 列（💾機/☁雲＋新鮮/過期）→ `ContextPacket`（token Meter＋TTL＋權限＋重建） | `creativeProject.get` · `contextPacket.compileProject/getLatest` · `data_source_connections` |
| **中 · 導演台＋確認門** | `PersonaSwitch`（平靜/創意/技術）→ **`GateCard`**（可量產/部分待補/全待補）→ 對話串 `ChatBubble`（CO-STAR×RAG，agent 署名）→ `ChatComposer` | `director.chat` · `vault.*`（gate）· `commander.createIntent` |
| **右 · 內存資料庫** | `MemoryDBTabs`（分鏡/角色/場景/筆記/資產/提示詞）→ 分鏡＝`ShotCard` 2 欄網格；角色＝`CharacterCard` | `worldStoryboard.*` · `worldbuilding` · `vault.*` · `assets.*` · `promptLibrary.*` |

階段條：世界觀→腳本→分鏡→生成→成片（`done`/`cur`/`todo`）；右上動作：金「引導式創作」(開 GuidedJourney)、clay「生成就緒鏡（n）」(`scheduleGeneration`)。

---

## 2. 權威使用者旅程：六步影片製作工作流

> 每步規格到：**畫面 · 所有狀態（空/載入/錯誤/長內容/權限）· 進入與離開條件 · 分支 · route/tRPC procedure**。整套**非線性**（見 Step 2）：可一步步、也可從任一階段切入。

### Step 1 — 腳本意圖（Script Intent）＋ 腳本專案資料庫
**畫面**：意圖卡（輸入框 placeholder「例：幫我規劃一支關於放下與呼吸的三分鐘療癒短片」＋「腳本目的/類型」下拉＋「記錄意圖」鈕）；旁註「**只記錄想法，不會立即生成或產生費用**」「未選專案則此意圖不綁定」。下方「腳本專案資料庫」列出既有腳本專案（可載入續作）。

**🌱 guided-from-zero 子流程（從 0 開始）**：若使用者沒有腳本／專案，導演台以引導式表單一步步帶完：
`(a) 目的/類型`（`director.videoScriptTypes` 取類型）→ `(b) 主題/一句話 logline` → `(c) 世界觀骨架`（時代/風格/受眾/平台；`worldbuilding`）→ `(d) 角色/場景初稿`（AI 共筆）→ `(e) 生成腳本初稿`（`director.generateVideoScript`）→ 寫入新專案。每步可「讓光球幫我寫」或「我自己填」。**這就是 `GuidedJourney` 的長腳本入口的擴充**（見 §5）。

**狀態**：
- *空*（無腳本專案）：EmptyState「還沒有腳本專案 · 從一句話開始，或貼上長腳本」＋兩 CTA（引導式 / 貼長腳本）。
- *載入*：腳本專案清單 Skeleton。
- *錯誤*：`director.listSessions` 失敗 → ErrorState 重試。
- *長內容*：腳本專案多 → 搜尋/分頁。
- *權限*：他人專案唯讀 → 鎖定態「唯讀 · 另存副本可編輯」。

**進入**：意圖進站「做完整影片」或 Rail `/video`。**離開**：記錄意圖（不綁定）／載入腳本專案／完成 guided-from-zero → 進 Step 2。
**route/procedure**：`/video`、`/video/director`；`director.videoScriptTypes` · `director.importScript` · `director.generateVideoScript` · `director.analyzeScriptOverview` · `director.saveSession/listSessions/loadSession` · `creativeProject.create`。

### Step 2 — 非線性入口（Non-linear Entry · 階段導覽/進度軌）
**畫面**：`StageBar` 即進度軌；**任一階段可點擊跳入**。跳階時系統檢查該階段前置：缺料 → 彈「補齊精靈」列出缺項，提供「回頭引導」或「就地快速補」。
**驗證規則（跳階自動補齊）**：
- 跳「分鏡」但無腳本 → 引導回 Step 1（或就地貼腳本）。
- 跳「生成」但角色未定版 → 確認門擋下（§3），列待補角色＋「上傳參考」。
- 跳「成片」但無已核准鏡 → 提示「先核准關鍵影格」。
**狀態**：每階段標 `done`/`cur`/`todo`；缺料階段標 `⚠ 待補 N 項`。*長內容*：階段多時 `StageBar` 可橫向捲動。
**進入/離開**：任意；**不變量**＝跳階不丟已完成資料（脊椎持有）。
**procedure**：讀 `creativeProject.get`（stageIndex）＋ 各階段資料表存在性檢查（`worldStoryboard.listByWorld` 等）。

### Step 3 — 多模態素材創作（Multimodal Asset Creation）
**畫面**：素材來源選擇器 `SourceSelector`（`Seg` 三選一）＋ 生成/匯入區 ＋ 右側結果（掛 §7 生成→存庫→重用）。
- **站內生成**：選模型（圖：Z-Image-Turbo/FLUX/Qwen-Edit；影：Kling/Wan/Veo…；音：Suno/ElevenLabs）→ 提示詞（可「智慧編譯提詞」）→ **先估成本** → 生成。
- **上傳自有**：拖放/選檔 → 寫資產庫（`sourceStudio:'upload'`）。
- **外部 AI 帶入**：貼 URL / 匯入外部 AI 結果 → 資產庫（`sourceStudio:'external'`，標「外部來源·未經站內估算」）。

**狀態（每來源都要）**：
- *站內生成*：idle（待輸入）/ estimating（估成本中）/ generating（掃光＋輪詢）/ done（產出＋seed/provider）/ error（HTTP/格式；回退 hf→gemini→fal 以 toast 告知）/ 積分不足（擋下，去 `/learn/credits`）。
- *上傳*：空 / 上傳中（進度）/ 失敗（型別·大小）/ 成功。
- *外部帶入*：空 / 抓取中 / 失敗（URL 無效）/ 成功。
- *權限*：無生成權 → 鎖定態。
**進入**：Step 2 任一創作階段。**離開**：素材入庫 → Step 4。
**procedure**：**生成統一入口 `generate.*`**：`generate.estimateCost → prepareJob/submitStudioJob → jobStatus/checkStudioJob → recordGenResult`；底層 `imageStudio.<model>`(28)／`videoStudio.<model>`(~29)／`proStudio.*`。導演編排：`director.generateSegmentCostar / batchGenerateCostar / executeGenerationTask / pollGenerationTask`。上傳/外部→ `assets.*` → `digital_asset_library`。

### Step 4 — 打包素材 ＋ 簡易初剪（Rough-cut）
**畫面（rough-cut UI，待建）**：時間軌（片段排序、拖曳）＋ 裁切點（trim in/out）＋ 配對（影格↔配音/配樂）＋ 預覽播放。左側素材箱（本專案資產），右側軌道。
**狀態**：*空*（無素材：EmptyState「先到上一步生成或匯入素材」）/ *載入*（資產載入 Skeleton）/ *編輯中*（拖曳/裁切即時）/ *渲染中*（合成預覽 progress）/ *錯誤*（合成失敗重試）/ *長內容*（多片段→軌道捲動、縮放）。
**進入**：素材就緒。**離開**：rough-cut 完成 → Step 5。
**procedure**：素材取自 `assets.*`／`digital_asset_library`；配樂/配音 `proStudio.textToMusic/elevenLabsTTS/qwenTTS`；段落編排對映 **`video_generation_sessions`/`video_segment_jobs`（M3 待建狀態機）** ＋ 復用 `director.batchGenerateCostar`。⚠ 標記：rough-cut 編輯器＝**新建 UI**（資產與配樂 procedure 已存在）。

### Step 5 — 確認與反覆修改（Gate ＋ Revision Loop）
**畫面**：確認門 `GateCard`（§3）＋ 逐鏡 `ShotCard` 核准；修訂迴圈：改設定 → 受影響鏡標 `stale` → 重生 → 重新核准。
**狀態**：ready/partial/blocked（門）；鏡：done/stale/error；*修訂*（改角色設定 → 連動標記過期）；*權限*（核准權限）。
**進入**：rough-cut 後或任何階段回頭。**離開**：關鍵影格全核准 → Step 6。
**procedure**：`vault.update`（approval / 鎖臉 / 角色升級——payload 表達，無專屬 setApproval/setLocks）；`vault.list`；重生走 `generate.*`；估成本 `director.estimateSegmentCost`。

### Step 6 — 完成專案（Deliver / Export / Archive）
**畫面**：成片卡（縮圖＋時長＋已用模型/成本彙整）＋ 匯出（解析度/格式）＋ 歸檔（寫回專案 timeline）＋ 分享到精選（→ 脊椎/`/social/publish`）。
**狀態**：*空*（無已核准成片：提示回 Step 5）/ *匯出中*（progress）/ *完成*（下載/連結）/ *錯誤*（匯出失敗重試）。
**進入**：核准完成。**離開**：匯出/歸檔 → 專案 timeline；可回任一步續作（非線性）。
**procedure**：成片與資產 `assets.*`／`digital_asset_library`（`project_asset_links` P4 待建，現用 `digital_asset_library.projectId`）；歸檔回寫 `creativeProject.update`；精選 `featured_showcase`（UI 待建）。

---

## 3. 確認門狀態機（唯一品管脊椎）

**三態**（`GateCard`，逐鏡 `computeGate`）：
- `ready` 可量產（teal/ok）、`partial` 部分待補（gold/warn）、`blocked` 全待補（bad）。

**規則（與 util.computeGate 一致）**：`route==='text'` 或 無角色 或 無可解析參考 → `ready`；否則計算「`precise` 且 `locked`」角色數 okCount：全部 → `ready`、0 → `blocked`、其餘 → `partial`。

**升級解鎖流程（demo）**：
`惹瓊巴 ⚠估算/未鎖` → 〔上傳參考照〕`uploadReference` → 角色升 `✅精準` ＋ 四鎖（臉/髮/服裝/配飾）全開 ＋ LoRA `未訓練→排隊中` → 受影響鏡 gate 由 `partial/blocked → ready` → 解鎖「生成」。
**改設定連動**：`changeCharacterSetting` → 引用該角色的 `done` 鏡標 `stale`（灰化＋過期待重生）。

**鐵則（永遠顯示）**：角色未定版不進分鏡 · 關鍵影格未核准不跑 i2v · **媒體生成前先估成本**。
**真實接點**：approval/鎖/升級皆 `vault.update`（payload）；估成本 `director.estimateSegmentCost`。

---

## 4. ShotCard 狀態機（鏡號 S0X 為唯一主鍵）

| status | thumb | 動作（由 gate × status 驅動） |
|---|---|---|
| `idle`/`queued` | 佔位（🌄文字生 / 🔒角色參考）＋seed | gate `ready`→「生成」；否則 tag「待補：{角色}」 |
| `generating` | clay 掃光＋spinner「生成中…」 | — |
| `done` | 生成圖（`frameStyle(seed,variant)`）＋seedtag「seed N · provider」 | 「同 seed 重生」；未核准→金「核准」 |
| `stale` | 灰化＋「過期待重生」 | 金「重生（已過期）」 |
| `error` | 紅底＋「生成失敗」 | 「重試」 |

**gate pill**：ready/partial/blocked；approved → info「已核准」。  
**真實接點**：生成 `generate.*`（估→送→輪詢→recordGenResult）；核准 `vault.update`；重生同 seed＝一致性保證。

---

## 5. GuidedJourney（長腳本/從零 → 拆片）

**modal 三步**（`step`=input·loading·review），同時服務 Step 1 的 guided-from-zero：
- **input**：貼長腳本（含「填入範例腳本」＝惹瓊巴/淡大）；或從零的引導表單入口。`textarea`＋「自動拆解」。
- **loading**：「commander 正在拆解腳本 · Deterministic→Cache→RAG…」spinner。
- **review**：`STEP2 確認拆解（n 幕 · m 鏡）`＋角色 pill（👤）＋場景 pill（🎬）＋逐鏡 `.src`（🔒ref/🌄text＋route＋場景）＋確認門註（抽出角色預設 ⚠估算，未定版不生成）；名稱 input；底「寫入目前專案」/「建立新專案再寫入」/「返回」。
**狀態**：input（空/已填）/ loading / review（長內容→幕內捲動）/ error（拆解失敗重試）。
**真實接點**：**過渡版 breakdown** ＝ `director.analyzeScriptOverview` ＋ `director.generateVideoScript` ＋ `worldStoryboard.createFromSegments`（`director.breakdown` 為 M3 待建，正式版取代）；寫入 `creativeProject.create` ＋ `worldStoryboard.createFromSegments` ＋ `contextPacket.compileProject`。

---

## 6. 內存資料庫六分頁（`MemoryDBTabs`）
分鏡（`ShotCard` 2 欄）｜角色（`CharacterCard`：來源分級 Pill＋四鎖＋LoRA＋上傳參考/改設定）｜場景（`.listrow` exterior/interior/named-place＋鎖）｜筆記（加筆記＋列表，綁鏡號）｜資產（`AssetRow`：鏡號/模型/來源/provider/成本/時間）｜提示詞（§7 提示詞庫）。  
**真實接點**：`worldStoryboard.*` · `worldbuilding`(charactersJson/scenesJson) · `vault.*` · `notes.*` · `assets.*` · `promptLibrary.*`。

---

## 7. 生成 → 存庫 → 重用（在 /video 的掛載）
引用 `設計系統.md §9`。/video 的每個「提示詞→生成」步驟（Step 3 生成、ShotCard 生成、GuidedJourney 後續生成）旁掛 `SaveToVault`；右欄「提示詞」分頁＝`VaultBrowser`（瀏覽/搜尋/再生成/插入/fork）。
**真實持久化（非 mock）**：存庫 `promptLibrary.create`（prompt 全文＋params＋assetId＋tags＋sourceWorkflow:'video'＋projectId）；產出寫回 `generate.recordGenResult` → `digital_asset_library`（provider/modelId/seed/cost）；再生成 `generate.*`。狀態：存檔中/成功/失敗/重複（§設計系統 §9.2）。

---

## 8. 四態 ＋ RWD（/video 專屬）
- **cockpit 四態**：`success`（三欄有料）／`empty`（🎬「這個專案還是空的」＋開始引導式創作）／`loading`（載入導演 cockpit · 向脊椎請求中）／`error`（導演台連線中斷 · tRPC `director.*` ＋重試）。
- **RWD**：桌機三欄；平板收單欄＋`.cockpit-tabs`（左欄/導演台/資料庫）；手機上下堆疊（中欄優先）、shots 2→（≤430）1 欄、persona 說明隱藏、msgs ≤46vh。

---

## 9. Route / tRPC Procedure 對映總表（GitNexus 校驗）

| 畫面/動作 | 真實 route | 真實 procedure（✅存在／❌待建／⚠改名） | 資料表 |
|---|---|---|---|
| cockpit 首頁 | `/video`（舊 `/create`,`/director`） | `creativeProject.get` ✅ · `contextPacket.compileProject` ✅ | `creative_projects`·`context_packets` |
| 導演對話 | `/video/director` | `director.chat` ✅ · `director.quickActions` ✅ | director session |
| 腳本類型/匯入/初稿 | `/video/director` | `director.videoScriptTypes`✅·`importScript`✅·`generateVideoScript`✅·`analyzeScriptOverview`✅ | — |
| 拆片（breakdown） | guided | ❌`director.breakdown`(M3) → 過渡 `analyzeScriptOverview`+`generateVideoScript`+`worldStoryboard.createFromSegments`✅ | `world_storyboards` |
| 世界觀/角色/場景 | `/video/world`（舊 `/animation`） | `worldbuilding`✅（charactersJson/scenesJson） | `worldbuilding_frameworks` |
| 分鏡管線 | `/video/storyboard` | `worldStoryboard.create/createFromSegments/planPipeline/seedSkeleton`✅ | `world_storyboards`(S0X) |
| 確認門/鎖/核准/升級 | cockpit | `vault.update`✅（無 setApproval/setLocks，payload 表達）·`vault.list/exportToAssets`✅ | `consistency_vault` |
| 估成本 | 生成前 | `director.estimateSegmentCost`✅·`generate.estimateCost`✅ | — |
| 影像/keyframe 生成 | `/video/image`（舊 `/image-studio`） | `generate.*`✅（estimate/prepareJob/submitStudioJob/jobStatus/recordGenResult）·底層 `imageStudio.<model>`✅ | `digital_asset_library`·`generation_history` |
| 影片生成執行 | `/video/studio`（舊 `/video-studio`） | `videoStudio.<model>`✅·`director.generateSegmentCostar/batchGenerateCostar/executeGenerationTask/pollGenerationTask`✅；❌session/segment 狀態機(M3) | ❌`video_generation_sessions`/`video_segment_jobs`(待建) |
| 配音/配樂（初剪） | `/video/pro`（舊 `/pro-studio`） | `proStudio.textToMusic/generateMusicSuno/elevenLabsTTS/qwenTTS/soundEffects`✅ | — |
| 角色 LoRA | `/video/train`（舊 `/lora-trainer`,`/models`） | `loraTrainer.trainWithReplicate`✅·`models.myModels/create/retrain/trainingStatus`✅（現走 Replicate，待轉 HF） | `fine_tuned_models` |
| 提示詞庫存/重用 | 右欄/生成旁 | `promptLibrary.create`✅·`blockCombos.create`✅·`generate.recordGenResult`✅·`assets.*`✅ | `prompt_library`·`block_combos`·`digital_asset_library` |
| 排程就緒鏡 | 頂部動作/⌘K | 復用 `director.batchGenerateCostar`✅·`background_jobs`✅ | `background_jobs` |
| 編排紀錄 | （觀測） | `commander.createIntent/getRun/listRunsByProject`✅ | `orchestration_runs` |
| 研究 i2v 一致性 | ⌘K → `/learn/research` | `orbProxy.unifiedSearch`✅ | — |

> ⚠ 待 `_GitNexus程式碼真實對照表.md` 產出後逐條再核對（任務 #12）；上表已先以 `_research/03_code_reality_notes.md` 校驗。

---

## 10. 真實內容回填（不得用假資料）
- **TopBar 積分** 1379 pts（使用者 ruce B / 管理員）；**ProjectSwitcher** 作用「禪修短片企劃」（進行中）等 5 專案。
- **cockpit demo 專案** 惹瓊巴傳（🏔，stageIndex 2）：角色 密勒日巴（✅精準·LoRA已完成）/ 惹瓊巴（⚠估算）/ 山神（⚠未確認）；場景 雪山道/閉關洞/村莊；鏡 S01–S06（route text/ref、seed、approval）。
- **進度卡** 42% · 步驟「完成第一版分鏡，正在挑配樂」· 綁定（世界觀 v1 / 腳本對話 / 30 秒禪修分鏡）。
- **淡大動畫**：另一真實腳本來源（八幕分鏡，見 `_Obsidian同步_AIDirector/淡大動畫專案/`）可作 guided 範例。

---

## 11. 增補（rev. L1.1）：工作流為可設定範本 ＋ 導演 AI 一條龍 ＋ 光球助手

> 依 `實站截圖觀察.md` 校正（主介面已亮色，順勢精緻化）＋ 新增可設定工作流。引用 `00_設計系統/設計系統.md §14`。

### 11.1 §2 的六步 ＝「預設工作流範本」，非寫死流程
- 六步（腳本意圖／非線性入口／多模態素材／打包初剪／確認修改／完成專案）為 **`/video` 預設範本**；使用者可用 **WorkflowBuilder**（設計系統 §14.2）**新增／刪除／重排／啟用停用**步驟。
- **必經步驟**（腳本意圖·多模態素材·確認修改·完成專案）不可刪/停；**可選**（非線性入口·打包初剪）與步驟庫（世界觀設定／LoRA／配音配樂／發佈／同儕審閱）可調。
- 頂部一條龍流程列（`StageBar`）**反映當前啟用步驟集**；§2 Step2 非線性跳階驗證不變。
- 入口：StageBar 右側「🛠 工作流」開 `WorkflowBuilder`；存成自訂範本（per 專案 / per 範本）/ 重設回預設。
- 真實資料：步驟自訂持久化 **待補（歸後端）**＝ `user_workflows`/`workflow_steps`（候選接點 `workflowEngine.*`/`planExecutor.*`，待 GitNexus 核對）。

### 11.2 導演 AI ＝ 一頁完成（實站校正）
- 中欄導演台在 `PersonaSwitch` 下加**模式分頁**：`對話模式 / 腳本分析 / 規劃模式 / 世界觀`（對映 `director.chat` / `director.analyzeScriptOverview` / `director.planning*` / `worldbuilding`）。
- **一條龍流程列**＝ `StageBar`（呼應實站標語「對話→腳本→世界觀→分鏡→生成，全部在這頁完成，不再跳頁」）。
- **右欄 Storyboard 可隱藏**（「隱藏/顯示 Storyboard」切換；隱藏時 cockpit 收為兩欄）。
- 工具：模板 / 對話紀錄 / 自動存筆記（Toggle）/ 隱藏 Storyboard。
- 頂部 warning chip：**「未綁定專案則不保存」**（對應 Step1 意圖不綁定）。

### 11.3 世界觀內嵌完成度（/director 內）
- 「世界觀」模式分頁＝ `WorldPanel`：**角色 / 場景 / 風格** 三組各一條完成度 Meter＋`N/M`（如 角色 2/5、場景 2/3、整體 4/15）。
- 兩入口：「**空白新增**」「**貼劇本 · AI 全自動**」（後者＝ GuidedJourney 拆片）。對映 `worldbuilding`(charactersJson/scenesJson)。

### 11.4 光球助手（精靈系統真身）
- 右下常駐光球浮球（亮色玻璃）＋主動泡泡（如「守守」提醒提示詞庫未用）＋情境 6 分頁（本頁/提示詞/對話/專注流/積分/筆記）。
- `提示詞` 分頁＝ §7 的 `VaultBrowser`；`本頁` 含 **Flow 展示牆**（可重跑工作流）。詳見設計系統 §14.1。

### 11.5 積分原子性（生成 UX 明示）
- **先估成本 → 確認 → 先扣 → 生成 → 失敗全額退還**（原子）；最小 1pts / 上限 500pts；不涉真實金錢。
- toast 明示：`已扣 N pts`／失敗 `已全額退還 N pts`。對映 `director.estimateSegmentCost` ＋ 伺服器端扣/退（非前端 procedure）。

### 11.6 Step3／Step4 詳規格 →《初剪與素材來源規格.md》
- **素材來源選擇器**（站內生成／上傳自有／外部 AI 帶入，三路徑全狀態＋驗證＋格式限制）與 **rough-cut 初剪編輯器**（排序/裁切/配對/預覽/匯出打包＋確認門硬擋）詳規格見同資料夾 `初剪與素材來源規格.md`；互動原型已實作於 `_reference原型/index.html`（app2.js 擴充層）。
- **已依《網站細節深掘.md》§6/§8 回填**：`background_jobs` jobType 8 值（`image/video/audio/voice/zip_export/multimodal/model_training/teaching_archive_ingestion`）、status 5 值（`queued/processing/completed/failed/cancelled`）、斷路器（3 連敗開路/冷卻 10 分/reaper 15 分收割 ≤3 次重試）；**打包對映真實 jobType `zip_export` ✅**；生成完成走 **postGenActions `doPostGenComplete`** 一次寫 4 處（含 prompt ≥4 字**自動寫 `prompt_library`**）。

*本檔 read-only；六步工作流為 /video 權威旅程（可由 WorkflowBuilder 自訂），與確認門/ShotCard 狀態機、提示詞庫、光球助手整合；procedure 以 GitNexus 校驗＋網站細節深掘回填為準。*
