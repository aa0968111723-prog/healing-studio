# M4 — 素材管理 + 創作目標管理 + 審改協作:方案設計(方案設計 wave M)

- 產生日期:2026-07-03
- 依據 commit:`7d1752bd`
- 性質:**方案設計(非診斷)**——本文件不重新盤點現況,現況與缺口全部引用 `docs/research/00-summary.md`、`D-adoption.md`、`02-fullstack.md`、`G2-worldbuilding-detail.md`、`L4-fields-spine-global.md`、`I-debt-dormant.md`、`C-uiux.md`(已產生於同日 commit `aef4214`,本文件視為同一批研究的延伸決議)
- 讀者:決定「下一步做什麼、怎麼做、按什麼順序做」的產品/技術決策者
- 範圍:**素材管理**(讓專案內素材一目了然、綁定各幕)、**創作目標管理**(要做什麼片、可追蹤進度、不跑偏)、**審改協作**(看→評→改→批准,D 診斷的最大斷點)三者作為同一套方案設計,而非三個獨立功能

---

## 0. 一句話設計立場

**不新建一套「協作系統」,而是給既有的「單一專案主幹」(creative_projects)裝上三個關節:素材掛得上專案、目標追得了進度、審改留得下痕跡。** 三者共用同一把鑰匙——`creativeProjectId`——素材、目標、評論、集合全部繞著它轉,這樣「不跑偏」不是一句口號,而是每次寫入都必須回答「這屬於哪個專案的哪個目標」。

---

## 1. 本質對齊

北極星本質(00-summary/D-adoption 共同結論):**這是一套供給側(生成產能)已達業界水準、需求側(審改協作)全斷的平台**。本質定義要求「做到快速運用【素材管理】和【創作目標管理】、不會跑偏,一步步建構達到最終成品」——拆解成三個可驗證的產品命題:

1. **快速運用素材管理**:創作者在專案裡找素材不需要「靠口耳相傳」(D §2.1 用詞)。今天素材進 `digital_asset_library` 但不綁定 `creative_projects`(G1/C 已證:AssetsLibrary 是全站單一資產池,my/team 二分,無專案維度),等於「素材管理」在資料模型上就不存在——只有「素材倉庫」。
2. **創作目標管理**:今天沒有「這個專案要做哪幾幕/哪些片段、做到哪了」的任何資料結構——`orchestration_runs`(Commander 意圖收件匣)是 skeleton(D §2.2:只寫 pending,無分類無下游),`world_storyboards.scenesJson` 有 `StoryboardScene.status`(draft→in_review→approved→rendering→rendered/needs_revision,G2 §2.3)但只在世界觀/分鏡場景下存在,一般創作專案(非走 AnimationStudio 的)完全沒有目標追蹤。
3. **不跑偏**:00-summary 診斷「三套專案體系同場」(creative_projects/video_projects/world_storyboards 橋接鬆散,I-debt-dormant #13)、「入口分散」(D §2.1:7 條生成路徑各自為政)——這些正是「跑偏」的資料面根因:沒有單一目標清單可對照,創作者与素材各自漂流。**目標管理不是額外的管理負擔,而是防跑偏的產品化機制本身**:每次生成、每次審批、每次歸檔都被要求掛回某個目標項,漂移會在寫入當下就被結構攔下來,而不是靠事後盤點才發現。
4. **審改是本質缺口的核心**:D-adoption 明確定位「brief→生成→審→改→交付」在「審」處全斷,是「能用但沒融入日常」的臨界點;00-summary 把它列為 00 §3 第 2 波(1-3 個月)「補審」;I-debt-dormant §2.4 列為「補一段就通」的三條斷鏈之一(量級 L-XL)。本方案把「審」的最小可行版本(狀態機+評論+集合,D §3.2-1/D §4.9)嵌進素材-目標架構,而不是外掛獨立審批系統——這樣審批天然知道「在審哪個專案的哪個目標的哪個素材」,不需要額外的關聯層。

**對齊結論**:三個功能表面是三塊(素材/目標/審改),但資料本質是一件事——**給 `creative_projects` 補上「素材掛得上、目標排得出、狀態審得動」三根柱子**,讓「一步步建構達到最終成品」有一條看得見的主幹,而不是分散在 7 個入口、3 套專案體系、0 個目標結構裡。

---

## 2. 目標狀態(驗收標準)

| 維度 | 目標狀態(可驗收的行為描述) |
|---|---|
| 素材一目了然 | 打開任一 `creative_projects` 詳情頁,看到「這個專案目前有的素材」——不用去 /assets 全站池子裡用 sourceStudio/日期猜;素材可標「屬於第幾幕/哪個目標項」 |
| 素材綁定各幕 | 一張生成的圖/一段影片/一軌音樂,可以掛到 `world_storyboards.scenesJson` 的某個 scene,或掛到創作目標的某個子項;「這張圖是給哪一幕用的」有資料可查,不是靠檔名/記憶 |
| 創作目標可追蹤進度 | 專案下能列出「要做的片段/任務清單」,每項有狀態(未開始/進行中/待審/已核准/已交付),打開專案能一眼看到「還有幾項沒做完、卡在哪」 |
| 團隊能審/評/批准 | 素材有狀態機(draft→in_review→approved/rejected)、可留評論(誰在什麼時間對哪個素材說了什麼)、審批動作留痕(誰批准/駁回、何時);不需要下載後跑去外部工具讨论 |
| 不跑偏 | 生成、審批、交付的每一步,系統都能回答「這對應哪個創作目標」;偏離目標清單之外的產出天然「沒有掛點」,在專案視圖裡會顯眼(未分類區),而不是悄悄混入輸出 |

---

## 3. 重用什麼(附 path)

方案刻意最大化重用——D-adoption/I-debt-dormant 都指出「資料基礎多半已在,缺的是三張小表+UI」(I §2.4-3)。逐項列出可直接接手的既有資產:

| 既有資產 | Path | 現況能重用的部分 | 需要補的關聯 |
|---|---|---|---|
| **digital_asset_library** | `drizzle/schema.ts:331`、procedure `server/routers/assets.ts:15` | 資產本體、visibility(private/team_shared)、sourceStudio/modelId 溯源、fileUrl/fileKey/thumbnailUrl、tags/category(0045 notesCurator 已加) | 缺 `creativeProjectId`(專案綁定)、缺 `sceneId`/`targetItemId`(幕/目標項綁定)、缺 `status`(審核狀態) |
| **consistency_vault** | `drizzle/schema.ts:719`、procedure `server/routers/vault.ts:8` | 角色/場景一致性錨點(itemType character/scene)、`exportToAssets` 已有跨表寫入前例(可仿造做「素材→目標項」掛勾動作) | `vault.list`(:49)現況 user 級無專案過濾(G1 已載);錨點本身可作為「幕」的視覺定義來源,但目前無 projectId 可篩 |
| **resource_shares** | `drizzle/schema.ts:4432` | `resourceType` enum(project/asset/prompt/material)+ `sharedWithType`(user/team)+ `role`(viewer/editor)——**RBAC 資料模型已完整**,只是 enforcement 旗標 `ENABLE_DATA_RBAC` OFF(02 §9.3) | 開旗標(shadow mode 先行,I §2.1 建議);新增 resourceType 值涵蓋審核相關資源(如 comment 需要時) |
| **teams / team_memberships** | `drizzle/schema.ts:4146`、`:4165` | owner/admin/member 三級角色已在、`teamId` 可作團隊範圍鍵 | transferOwnership/updateMemberRole 前端未接(I §2.2,量級 S,可獨立小 PR 先做) |
| **creative_projects.metadata** | `drizzle/schema.ts:3678`,`metadata: json(...)`(:3706,"預留擴充欄位") | 官方註解已預留給未來擴充——**創作目標清單可先落在這個 JSON 欄做 v1**,不用等 migration 就能原型驗證 | 待驗證量大後升級成獨立表(見 §4.5) |
| **studio_recipes** | `drizzle/schema.ts:2774`、procedure `server/routers/studio.ts:12-113` | 「配方」payload(blocks/thoughtIslands/advancedPrompt/references/promptStrength/generationParams)已可保存重跑組態,是 D §3.3 提到 team 模板化的雛形 | 目前 `userId` 單人所有,無 `teamId`/`visibility`——升級為 team 模板需加共享欄位(見 §4.6) |
| **world_storyboards.scenesJson.StoryboardScene.status** | `shared/worldbuilding-animation.ts:153-185`(引自 G2 §2.3) | **已有 draft→in_review→approved→rendering→rendered/needs_revision 狀態機定義**——這是本方案「資產狀態機」設計的既有先例,直接沿用同一組狀態值,不重新發明 | 目前只在分鏡場景存在,且無評論/無 UI 驅動狀態切換(G2 已證「時間軸唯讀,不能逐項編輯」);本方案需要把同款狀態機下放到 `digital_asset_library` 層 |
| **generation_history / background_jobs** | `drizzle/schema.ts`(02 §5) | jobId 譜系(同 prompt 重 roll 天然成版本組,D §4.9 對照 Frame.io version stacking)、bookmark/rate 已有 | 可作為「集合」的自動候選來源(同一任務鏈的產出天然可分到同一集合) |
| **generationBus / SSE 事件源** | `server/routes/sseRoute.ts:82`(02 §8) | 生成完成事件已存在,可低成本掛「有素材待審」的通知出口(D §3.1-3 已建議同一基建做生成完成 Slack 通知) | 新增「狀態變更/被評論/被指派」事件類型 |
| **@xyflow/dagre** | 依賴已在(00-overview、I §2.3) | brain-pipeline 已用來畫圖,可低成本複用做「目標項→素材→版本」關聯圖,呼應業界 node-canvas 心智模型(D §4.5) | 屬於 UI 加值,非本方案第一階段必要 |

---

## 4. 要補什麼(最小新增)

原則:**能加欄位不建表,能建小表不建子系統**。以下按「風險/工作量」由小到大排列。

### 4.1 專案—素材綁定關聯(核心新增 #1)

`digital_asset_library` 新增可空欄位:
- `creativeProjectId int NULL`(索引 `dal_projectId_idx`)——素材可選擇性掛到專案,不掛=維持現況(全站池)
- `targetItemId int NULL`(索引,連 §4.5 的創作目標項表)——素材可選擇性掛到某個目標項/某一幕
- 讀取 procedure(`assets.myAssets`/`teamAssets`)新增可選 `projectId` 篩選參數——**這同時解掉 G1 §... 提到「notes.list/vault.list 無專案過濾」同型缺口**,設計上把 `projectId` 篩選做成共用 helper(建議 `server/lib/scopeToProject.ts`),之後 notes/vault 用同一支 helper 補齊(見 §4.2)。

不做:不要求「每筆素材都必須綁專案」——現況大量素材是探索性生成,強制綁定會製造摩擦;綁定是可選動作(生成時預選當前專案、或事後在專案頁「加入這個素材」)。

### 4.2 讀取 scope 到專案(最小新增 #2,呼應 G1 缺口)

`vault.list`、`notes.list` 目前是 user 級全量查詢,無 `projectId` 參數(G1 已載)。補法:
- 兩個 procedure 都加可選 `projectId` 入參,SQL 加 `WHERE userId=? [AND projectId=?]`
- `consistency_vault` 需先加 `creativeProjectId int NULL` 欄位(同 §4.1 手法);`project_notes_calendar` 若无对应欄位需一併補(需先查证該表是否已有專案關聯欄位,若無則同法新增)
- 前端專案詳情頁的「素材」「筆記」「一致性錨點」三個分頁改呼叫帶 `projectId` 的版本

### 4.3 資產狀態機(核心新增 #3,審改迴圈第一件)

不新建表,`digital_asset_library` 加:
- `reviewStatus mysqlEnum("draft","in_review","approved","rejected") DEFAULT "draft"`
- `reviewedBy int NULL`、`reviewedAt timestamp NULL`、`reviewNote text NULL`(駁回原因/批准備註,單欄够用,不需要独立表)

沿用 §3 表格已指出的既有先例——`StoryboardScene.status` 的狀態值命名習慣(draft/in_review/approved),不重新發明詞彙,降低团队学习成本。

procedure:`assets.updateReviewStatus({ id, status, note })`——限 team admin/owner 或素材擁有者可呼叫(掛 `resource_shares.role==="editor"` 或 team role 判斷,复用 §3 RBAC 資料)。

### 4.4 評論表(核心新增 #4,審改迴圈第二件)

新表 `asset_comments`:
```
id, assetId(FK digital_asset_library), userId, teamId NULL,
content text, mentionedUserIds json NULL, createdAt, updatedAt
索引:assetId_idx、userId_idx
```
最小 procedure:`assetComments.list({assetId})`、`create({assetId, content, mentionedUserIds})`、`delete({id})`(僅本人)。**不做**:不做逐幀/逐座標標注(Frame.io 級 frame-accurate annotation)——D §4.9 已明言這是進階功能,本方案第一階段只求「有地方留言」,把 80% 的審改需求(D §3.2-1「不求 frame-accurate,先讓迴圈在站內閉合」)用最小結構打穿。

`@提及` 沿用 §3 SSE 事件源掛通知出口(不做新通知系統,複用 generationBus 同款 pattern)。

### 4.5 創作目標 tracker(核心新增 #5)

新表 `creative_project_goals`(命名避開與既有「target」欄位混淆):
```
id, creativeProjectId(FK), title, description NULL,
sceneRef varchar NULL(可選填 world_storyboards sceneId 字串,弱關聯不做外鍵,對齊 MySQL 現況 0 外鍵的既有模式),
status mysqlEnum("todo","in_progress","in_review","approved","done") DEFAULT "todo",
orderIndex int DEFAULT 0(手動排序),
assignedUserId int NULL,
dueDate NULL,
createdAt, updatedAt
索引:creativeProjectId_idx、status_idx
```
procedure:`projectGoals.list/create/update/reorder/delete`(比照 `creativeProject.*` 既有命名慣例,`server/routers/creativeProject.ts`)。

**v1 可先不建表**:若要更快驗證,可先把目標清單塞進 `creative_projects.metadata`(已預留 json 欄,§3 已載)做原型,量大后(单专案目标数>~30 或需要跨专案查询時)再升級成獨立表——這是唯一建議「先斜線後正式」的一項,因為目標清單结构简单、变动频繁,適合先在既有欄位驗證再决定 schema。

### 4.6 集合/精選(核心新增 #6,審改迴圈第三件)

新表 `asset_collections` + `asset_collection_items`:
```
asset_collections: id, creativeProjectId NULL, teamId NULL, userId(建立者),
  name, description NULL, createdAt, updatedAt
asset_collection_items: id, collectionId(FK), assetId(FK), orderIndex, addedAt
```
用途對齊 D §3.2-2「交付集合」與 D §4.9 業界 Collections 通則:把「已核准的素材」策展成一個可命名的交付包,既有 JSZip 匯出(02 §5)升級成「集合級」匯出——**不新建匯出機制,只是把既有 ZIP 邏輯的輸入從『勾選清單』換成『集合 id 展開的素材清單』**。

`studio_recipes` 團隊模板化(D §3.3、I §2.3 建議)複用同一手法:加 `teamId int NULL`、`visibility mysqlEnum("private","team_shared")`,`studio.recipes` 的 list procedure 加 team 分支——這是「非技術隊友按鈕跑固定管線」的最小實現,不需要等長期的 workflow-as-API 願景(D §3.3-4)。

### 4.7 明確不做(避免范围蔓延)

- 不做 frame-accurate 標注/座標評論(D 已定調非本階段)
- 不做多階段審批工作流引擎(如需要「兩人核准才算過」,先用 `reviewedBy` 單人批准跑通,流程需求明確后再加 `approval_steps` 表)
- 不做团队级 credit 池化(業界對照 Runway/D §3 §4.2 提到,屬於成本治理議題,不在本次素材/目標/審改範圍)
- 不做 Jira/外部工具雙向同步(D §2.4 已定調短期只做單向連結欄位,若要做,是 Commander 收件匣的任務,不在本方案)

---

## 5. 分階段路線 + 首個 PR

### 5.0 前置依赖(不阻塞本方案启动,但影响时序)
- CI 恢复(00-summary §3 第 0 步)——本方案任何 PR 都需要能過 gate 再合;若 CI 仍卡关,先以 draft PR 形式推进不合并。

### 階段 0(1 個 PR,≤3 天):結果動線先接上專案維度
> 這一步不新建審改功能,只是把 §4.1「專案—素材綁定」做出來——因為沒有這根柱子,後面所有審改/目標都無處掛。

**首個 PR 範圍**:
1. migration:`digital_asset_library` 加 `creativeProjectId`(nullable, indexed)
2. `assets.myAssets`/`teamAssets` procedure 加可選 `projectId` 篩選參數(向後相容,不傳時行為不變)
3. `generate.submitMultimodalAsync` 系列在 `resultJson`/`doPostGenComplete` 落三表時,若前端當前有 `current-project-id`(已存在的 localStorage 值,02 §10 已載),順手帶入 `creativeProjectId`——**這一步是「快速運用素材管理」的第一個可感知效果:今天生成的東西,若當時開著某個專案,直接就掛好了,不用事后手动归类**
4. `CreativeProjectPage`/`ProjectDetailPage`(`client/src/pages/CreativeProjectPage.tsx` 一類)加一個「素材」分頁,呼叫帶 `projectId` 的 `assets.myAssets`

驗收:打開一個專案,能看到「這個專案生成過的素材」,不用去 /assets 全站池找。

### 階段 1(2-3 個 PR,1-2 週):審(狀態+評論)
1. PR:`digital_asset_library` 加 `reviewStatus/reviewedBy/reviewedAt/reviewNote`(§4.3)+ procedure + 專案素材分頁加狀態 badge/篩選
2. PR:`asset_comments` 新表 + procedure + 素材卡片加評論區(可複用既有 Dialog/AlertDialog pattern,C-uiux 已點名全站有一致的 Dialog 元件庫可用)
3. PR:@提及通知掛 SSE(複用 generationBus,不新建通道)

驗收:一張素材能被標「待審/已核准/已駁回」,能留言,提及的人能收到通知。

### 階段 2(1-2 個 PR,1 週):創作目標 tracker
1. PR:`creative_project_goals` 表(或先用 metadata 原型,見 §4.5)+ procedure + 專案頁「目標」分頁(清單+狀態+拖拉排序)
2. 素材掛勾目標項:素材卡片加「歸屬到哪個目標」的下拉(選項來自該專案的目標清單)

驗收:專案頁能看到「要做的幾件事,做到哪了」,且能把已生成的素材對應回目標項。

### 階段 3(1-2 個 PR,1 週):集合/交付
1. PR:`asset_collections`/`asset_collection_items` + procedure + 專案頁「集合」分頁 + 既有 JSZip 匯出改吃集合輸入
2. PR(可選):`studio_recipes` 加 teamId/visibility,ModelsPage/Studio 配方庫加「發布為團隊模板」按鈕

驗收:能把一批已核准素材命名成一個交付包,一鍵匯出。

### 階段 4(後續,依 D §3.2-3 順序):RBAC enforcement
- 開 `ENABLE_DATA_RBAC`(先 shadow mode 記 log 不擋,I §2.1 已建議的既定路徑)——此時 `resource_shares` 才真正對素材/專案生效,「這組素材只給 A 小組」才成立
- teams 治理前端收尾(transferOwnership/updateMemberRole,量級 S,可插隊提前做)

**分階段設計理由**:每個階段都是獨立可交付、獨立可回滾的 PR 組,且階段 0 是後面一切的先決條件(沒有 projectId 掛勾,審改/目標都無處安放)——這符合「小步快跑、每步都有可驗收行為」而非一次性大改。

---

## 6. 如何服務「不跑偏」

「不跑偏」不是一句宣傳語,而是要求本方案的資料結構本身承擔「防跑偏」的功能。具體機制:

1. **目標清單即對照表**:`creative_project_goals` 一旦存在,專案頁的預設視圖就是「目標清單 + 每項底下掛的素材」,而不是「所有素材的時間軸」——創作者每次要生成新東西时,天然被引导先看「這對應哪個目標項」,而非漫无目的地生成。這是把 00-summary 診斷的「入口分散、7 條生成路徑各自為政」問題,在資料消費端收斂成單一視角。
2. **未分類區顯眼化**:沒有掛 `targetItemId` 的素材,在專案頁歸入「未分類/探索性產出」區塊而不是隱藏——不是禁止自由探索(創作需要試錯空間),而是讓「這批東西還沒對應到任何目標」變成一個可見的、需要創作者主動確認的狀態,而不是悄悄混進交付集合。集合(§4.6)只能從「已核准」的素材建立,天然排除未經確認的漂移產出進入最終交付包。
3. **狀態機是跑偏的煞車點**:`reviewStatus` 的存在意味著「生成」和「交付」之間有一個必經的人工確認關卡——今天(D 診斷)生成完直接進背景抽屜、下載即交付,沒有任何人審視「這符合我們要做的東西嗎」;有了狀態機,drift 會在 in_review 這一步被人發現,而不是在最終成片才發現走偏了。
4. **評論即決策記錄**:誰在什麼時候基於什麼理由核准/駁回了什麼——這條記錄本身是「校準創作方向」的過程證據,團隊回頭看評論串就能重建「我們為什麼往這個方向走」,而不是每次都靠記憶或口頭傳達,降低下一輪生成又漂回舊方向的風險。
5. **與現有世界觀/一致性機制形成雙保險**:00-summary/D §4.10 已指出本站「世界觀+分鏡+一致性錨點」三層資料模型是業界少見的深度整合;本方案的目標項可選填 `sceneRef` 掛回 `world_storyboards` 的場景,等於「目標管理」與「一致性錨點」共用同一張藍圖——素材同時被要求「符合這一幕的設定(consistency_vault 錨點)」與「屬於這個目標項(creative_project_goals)」,兩道校準同時起作用,比單靠一致性錨點更能防止「風格對但內容跑偏」或「內容對但沒人排進交付清單」兩種各自的漂移模式。

**一句話**:目標管理不是額外報表,而是把「brief→生成→審→改→交付」这条線的每一步,都綁在同一張「這個專案要做什麼」的清單上——跑偏在資料模型層面會變得「有痕跡可查」,而不是无声无息地发生。

---

## 7. 本文件未涵蓋部分(交還給後續波次)

- 多階段審批工作流引擎(需要「N 人會簽」時的 `approval_steps` 設計)——本階段只做單人核准
- frame-accurate 標注(座標/時間碼級評論)——沿用 D 定調,列為長期(3 個月+)方向
- 團隊 credit 池化與消費上限治理——屬成本治理範疇,見 A-cost-integrations 既有路線,非本方案處理
- Commander 意圖收件匣→目標項自動建立的 AI 輔助(brief 階段的智能分類)——本方案只給目標項一個「人工建立+可追蹤」的骨架,AI 輔助建目標留給光球代理整合的後續波次
- Jira/外部協作工具雙向同步——僅建議目標項預留一個 `externalRef` 類欄位(本文件未列入 §4,因需求未明確前不預先設計,避免过度设计)
- 分鏡管線執行化(I §2.4-1,「可規劃不可執行」的斷鏈)——與本方案獨立,但完成後可讓 `sceneRef` 掛勾更有意義(場景真的能被生成執行,而不只是規劃)
