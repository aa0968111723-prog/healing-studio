# N2 — 架構分岔決策卡（決策提議 wave N）

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 性質:**決策提議 wave N**——把 M 藍圖(M0-M4)裡「留給團隊裁定」的五個架構分岔,收斂成可以直接拍板的決策卡。本文件**不重做診斷**,只在既有研究結論之上補「現況實據」與「選項成本/風險」,供 Bruce 逐卡拍板。
- 讀者:Bruce(拍板者)。每張卡格式固定:決策點→現況實據→選項→我的建議→影響面→需拍板的點→可逆性。
- 前置閱讀:M0-solution-blueprint、M1-project-spine-assembly、M3-connectors-workflows、G2-worldbuilding-detail、J-code-structure。

---

## 決策卡 1:單一專案 SSOT 選誰——creative_projects / video_projects / world_storyboards

### 決策點
北極星要求「創作者建**單一專案**」,全流程只認一個專案 id。現況三張表並存、關聯鬆散,必須裁定誰是對外唯一的專案 id(SSOT),其餘降級為子表/衍生資料。

### 現況實據(實讀確認)
- **creative_projects**(`drizzle/schema.ts:3678-3728`):`id`/`userId`/`title`/`status`(concept/production/review/complete)/`worldFrameworkId`/`worldStoryboardId`/`directorSessionId`/`metadata`(json,自由擴充)/`version`(樂觀鎖,AIDV-316)。**單方向**外鍵——本表指向 `worldbuilding_frameworks.id` 與 `world_storyboards.id`,但**沒有反向欄位**;schema 註解明言「刻意不用 FK,方便重新綁定」。前端消費:`creativeProject.*` procedure 全站 82 處呼叫(grep 實測),是 `client/src/spine/projectGateway.ts:255-266` 的 `createProject` 真實落點,也是 `WorldContext.activeProjectId`(J §3、G1 §2.1)事實上的全站當前專案來源。但欄位不足:`projectGateway.ts:260-263` 建案時因 schema **無 `type` 欄**,只能把 `type` 塞進 `metadata.spineType` 這種自由 json,不是型別化欄位——SSOT 候選本身還沒補完前端要的欄位。
- **video_projects**(`schema.ts:4604-4635`):`id`/`userId`/`creativeProjectId`(**已有此外鍵欄,可空**)/`title`(預設值「未命名影片」)/`aspectRatio`/`outputSpec`/AIDV-684 三個輸出快取欄(`outputStoragePath`/`outputSignedUrl`/`outputExpiresAt`)。後端 `videoProject.create`(`server/routers/videoProject.ts:65-85`)zod input **已接受** `creativeProjectId: z.number().int().positive().optional()`(:70),寫入時 `creativeProjectId: input.creativeProjectId ?? null`(:85)——**後端早就準備好了**。但前端 `client/src/components/VideoProjectCreateDialog.tsx:79-84` 的 `createMut.mutate({...})` **完全不傳 `creativeProjectId`**,於是每次建案都生一筆 `creativeProjectId=null` 的孤兒列。消費面同樣分裂:`client/src/shells/video/console/ContextSidecar.tsx:297` 的 `VideoProjectLifecycleCard` 用 `projects.find(p => p.id === selectedId) ?? projects[0] ?? null`——**沒有 selectedId 時直接抓陣列第一筆**,不是「目前作用中專案」,是實測到的錯配讀法。全站 `videoProject.*` 呼叫僅 9 處(遠少於 creativeProject 的 82 處),消費面很薄。
- **world_storyboards**(`schema.ts:3548-3591`):`id`/`userId`/`worldId`(**notNull**,指向 `worldbuilding_frameworks.id`)/`scenesJson`(分鏡幕陣列,notNull)/`pipelinePlanJson`/`jobsJson`/`productionStatus`/`finalVideoUrl`。**同樣沒有反向指回 creative_projects 的欄位**——只能靠 `creative_projects.worldStoryboardId` 這條單向指標認親,若該指標沒被設定(例如透過 AnimationStudio 直接建分鏡,不經過 `spine.createProject`),這筆 storyboard 就是徹底的孤兒,無法從任何 creative_project 反查回來。消費面最重:`worldStoryboard.*` 全站 40 處呼叫,是 G2 全篇盤點的分鏡/逐幕資料真正落地層(scenesJson 內的 StoryboardScene/Frame/AudioClip,§1.1-1.3)。
- 三表 `server/db.ts` 內函式引用次數(grep 實測,含輔助函式):creative_projects 相關 25 處、video_projects 相關 21 處、world_storyboards 相關 15 處——**分佈相當,沒有一張表是明顯冷門**,收斂不是「刪掉少數派」而是「補齊多數派缺的欄位/寫入紀律」。

### 選項
1. **裁定 creative_projects 為唯一 SSOT,video_projects 降為輸出算繪中繼資料子表,world_storyboards 維持現狀(靠外鍵掛回)**(M1 軌 A 建議)。
   - 成本:中——只需(a)修 `VideoProjectCreateDialog.tsx` 傳入 `creativeProjectId`(後端已接受,零 schema 改動);(b)新增 `videoProject.getByCreativeProjectId` 查詢(唯讀,已確認**目前不存在**,grep 0 命中);(c)修 `VideoProjectLifecycleCard` 的 `projects[0]` fallback。
   - 風險:低——不改任何表結構,只改前端建案流程與一個 fallback 讀法;既有孤兒 `video_projects`(`creativeProjectId=null`)不受影響,可留待背景遷移或永久忽略。
2. **反過來以 video_projects 為 SSOT**(理由:它已有 `outputSpec`/輸出快取欄,「離最終產出最近」)。
   - 成本:高——要幫 video_projects 補 `worldFrameworkId`/`worldStoryboardId`/`directorSessionId` 等 M1 已在 creative_projects 建好的關聯欄,等於重新發明一次 creative_projects 已有的形狀;且 `creativeProject.*` 82 處呼叫全部要改接點。
   - 風險:高——82 處消費者遷移面大,且與既有 `WorldContext.activeProjectId`(全站唯一來源)的既定架構方向相反。
3. **維持三表並存,靠應用層文件/慣例避免分裂**(不裁定)。
   - 成本:低(短期)。
   - 風險:高——正是現況(G1 已證實的雙寫分裂),`projects[0]` 這類 fallback 會持續在新功能裡被複製,是北極星「不跑偏」本質要求的反例。

### 我的建議
選項 1。理由:creative_projects 已是 82 處呼叫的事實 SSOT、`activeProjectId` 全站狀態、且後端已預留 `creativeProjectId` 外鍵欄位——這不是「選一個新方向」,是「補齊已經在走的路」。world_storyboards 維持現有單向外鍵連結即可,不必大改(它的 40 處消費者不受影響,只是新建流程要求先有 creativeProjectId 才能建 storyboard,而非允許裸建)。

### 影響面
- 前端:`VideoProjectCreateDialog.tsx`(建案流程)、`ContextSidecar.tsx`(Lifecycle Card 讀法)。
- 後端:新增 1 個唯讀 procedure(`getByCreativeProjectId`),零 schema migration。
- 既有資料:孤兒 `video_projects`(`creativeProjectId=null`)與孤兒 `world_storyboards`(未被任何 creative_project 指到)需要決定「背景回填 vs 放著不管」——這是資料清理決策,非 schema 決策。

### 需要 Bruce 拍板的點
1. 是否同意 creative_projects 為對外唯一「專案 id」(SSOT 裁定本身)。
2. 既有孤兒 video_projects/world_storyboards 是否要背景回填 creativeProjectId(需要人工/啟發式配對邏輯,例如按 userId+createdAt 相近性猜測),還是直接放棄、只對新建案強制。
3. creative_projects 是否要補一個型別化 `type` 欄位(取代目前塞進 `metadata.spineType` 的權宜寫法)。

### 可逆性
**高可逆**。SSOT 裁定是「以後怎麼建案」的流程規則,不涉及刪表或不可逆 migration;若日後想換 SSOT,現有雙向弱關聯(單向外鍵)結構本來就允許重新綁定(schema 註解自陳「刻意不用 FK,方便重新綁定」)。

---

## 決策卡 2:compose 服務技術路線——自建 ffmpeg vs 委外 API vs 前端 WebCodecs

### 決策點
M1 軌 E 認定 compose(把已核准的 frames+audioClips 串成一支影片)是**唯一真正的淨新建大件**。需要裁定技術路線,三個選項成本/品質/維護模型差異很大。

### 現況實據
- **勘誤先行**(M1 §E3 已指出,本次覆核屬實):`server/services/videoCompiler.ts`/`audioCompiler.ts` 不是媒體合成引擎,是「情感→運鏡/Tag Stacking」的**提示詞編譯器**,服務於 fal/Suno 生成前的 prompt 組裝——grep 全文件 0 個 `concat`/`compose` 媒體合成邏輯,證實勘誤成立。
- **repo 內完全沒有 ffmpeg 二進位或 CLI 呼叫**:`grep -rn "ffmpeg" server/ Dockerfile*` 只命中 `fal-ai/ffmpeg-api/merge-audios`(fal 上的**代管** ffmpeg 端點,非自架二進位)——`Dockerfile` runner 階段只裝了 `mariadb-client`/`mariadb-connector-c`(給 mysqldump 用),**沒有 ffmpeg apt/apk 套件**,現況 Railway 容器裡沒有可執行的 ffmpeg。
- **fal 側已驗證存在的 ffmpeg-api 家族(可委外)**:`server/routers/proStudio.ts:1332-1354` 的 `mergeAudios` procedure 真實呼叫 `fal-ai/ffmpeg-api/merge-audios`(`falQueueSubmit`,支援 `concatenate`/`mix` 策略),且已接扣點(`chargeForFalTask`)與失敗退款邏輯——這證明**fal 平台上確實有 ffmpeg-as-a-service 端點家族**,現況只接了「多音軌合併」這一個 case,**尚未接**「多影片檔案 concat」或「圖+音軌合成一支影片」這類 compose 服務真正需要的 case(需另外盤點 fal 該家族是否有 video concat/overlay 端點,本文件未查證到,見文末待查證)。
- **R2/S3 上傳鏈已就緒**:`videoProject.requestExport`(`server/routers/videoProject.ts:469-520`)內的 `isR2Configured()`/`presignGetDownload`/`db.updateVideoProjectOutputUrl` 這套「產出檔案→presign→寫快取欄」骨架已經是成熟路徑,不論 compose 選哪條技術路線,產出的檔案都走同一套上傳/下載鏈,不需要重新整合物件儲存。
- **Railway 容器資源**:`railway.toml`/`Dockerfile` 內**沒有列出 CPU/記憶體規格**(這是 Railway 帳號方案層級的設定,不在 repo 內可查證);唯一相關線索是 Dockerfile 對前端建置設了 `NODE_OPTIONS=--max-old-space-size=4096`(建置期堆記憶體,非執行期影片轉檔資源)。**Railway 目前的實際方案/CPU 核數/是否適合跑 ffmpeg 轉檔屬於未查證項**,需要 Bruce 或維運方直接查 Railway dashboard 帳單頁確認。
- **前端 WebCodecs 現況**:`package.json` 內**沒有** `@ffmpeg/ffmpeg`(ffmpeg.wasm)、沒有任何 WebCodecs polyfill 或封裝套件——前端目前 100% 靠 JSZip 做「打包」而非「拼接」(M1 §E3 已證實 RoughCutCanvas 的打包鈕是 `setQueued(true)` 佔位;CreationFlowBar 是真的逐鏡下載,非合成)。走 WebCodecs 路線是從零開始,repo 內無任何既有基礎可重用。

### 選項
1. **伺服器端 ffmpeg(Railway 容器內裝 ffmpeg 二進位)**
   - 成本:中——`Dockerfile` runner 階段加 `apk add ffmpeg`(Alpine 套件,體積增量小,類似現有 mariadb-client 的做法),`videoComposer.ts` 用 `child_process.spawn` 組 concat/amix/drawtext filter graph。
   - 風險:中-高——CPU/記憶體吃緊(轉檔是 CPU-bound,與現有 Node 事件迴圈搶資源,需要獨立佇列限流,避免拖垮同容器內的 API 服務);Railway 方案的 CPU 核數與並發轉檔上限是**未查證的外部帳務事實**,若方案偏小,長影片/多用戶並發轉檔可能造成健檢逾時(現有 `healthcheckTimeout=600`s 已因「開機模型研究風暴」被迫拉長,顯示這個容器對資源已經敏感)。
   - 品質:可控——ffmpeg 濾鏡鏈成熟,字卡疊圖/音軌混音都是標準能力,不受限於第三方 API 的功能集。
2. **委外合成 API(fal ffmpeg-api 家族,或 Shotstack/Creatomate 類)**
   - 成本:低-中——若 fal ffmpeg-api 家族有 video concat/overlay 端點,直接比照現有 `mergeAudios` procedure 的呼叫模式(`falQueueSubmit`+扣點+輪詢)擴充,架構上與現有「呼叫外部生成模型」完全同構,**不需要新建 child_process 執行環境**,對容器資源零額外負擔。若 fal 該家族不支援任意時長/任意場數的 video concat,則需另接 Shotstack/Creatomate 這類專職影片合成 SaaS(現況 repo 內**完全沒有**這兩家的整合痕跡,是全新供應商)。
   - 風險:中——**功能覆蓋是否足夠**是未查證的關鍵前提(需要一次 API 能力 spike,確認任意 frames 數量+多音軌疊加+字卡疊圖是否都能一次 API 呼叫達成,或需要多次呼叫組合);多一個外部供應商即多一個 API key/計費/SLA 依賴,若選 Shotstack/Creatomate,需要走 `server/routers/externalServices.ts` 那套供應商記帳骨架(現有,可重用)。
   - 品質:依供應商能力上限,可能無法做到 ffmpeg 濾鏡等級的客製字卡疊圖效果,但「簡易拼接」(M1 明文降低的要求)通常足夠。
3. **前端 WebCodecs(瀏覽器端合成)**
   - 成本:高——repo 內零基礎,需要從頭建立 WebCodecs/ffmpeg.wasm 編解碼管線,且要處理瀏覽器相容性(WebCodecs 尚非所有瀏覽器等量支援)、大檔案記憶體壓力、行動裝置效能問題。
   - 風險:高——與現有「送出→背景任務→輪詢→presign 下載」的一致架構模式(`background_jobs`/`submitStudioJob`)完全不同調,使用者需要保持分頁開啟等轉檔完成,不適合「大量幕+高解析度」的預期用量;且不能重用現有 `background_jobs` 追蹤 UI(AgentProgressPanel 等)。
   - 品質:對「簡易拼接」這種輕量需求可能足夠,但維護一套獨立於後端任務系統的前端合成邏輯,長期技術債風險高。

### 我的建議
**先做選項 2 的技術 spike(1週內,盤點 fal ffmpeg-api 家族實際端點清單與能力邊界),若涵蓋「多 frame 依時間軸排列 + 音軌疊加 + 基本字卡疊圖」則採選項 2;若 fal 覆蓋不足,退回選項 1(伺服器端 ffmpeg),因為它與現有基礎設施(background_jobs、R2 上傳鏈)整合成本最低、功能上限最高。** 選項 3(WebCodecs)不建議在近期路線內,與現有架構模式落差最大、投入最重,若真的要走行動端輕量合成,應該是遠期才考慮的第四選項,而非本波三選一裡的候選。

### 影響面
- 若選 1:`Dockerfile` 加套件、新增 `server/services/videoComposer.ts`、`background_jobs.jobType="compose"`、需要轉檔佇列限流機制(避免多用戶並發轉檔拖垮容器)。
- 若選 2:新增 `videoComposer.ts` 呼叫外部 API(架構同 `proStudio.mergeAudios`),需要新增供應商 API key 管理(若非 fal),記帳走 `externalServicesRouter`。
- 兩者都要擴充 `videoProject.requestExport` 前段接 compose 輸出、`CompletionCanvas` 回填真實 `outputUrl`(M1 §E4 已定義)。

### 需要 Bruce 拍板的點
1. 是否核准先花 1 週做 fal ffmpeg-api 能力 spike,而非直接拍板選 1 或 2。
2. Railway 目前方案的 CPU/記憶體規格與帳單彈性(這是本卡最大的未查證缺口,需要 Bruce 提供或授權查詢 Railway dashboard)。
3. 若走委外 API,能否核准新增一個外部供應商 API key(涉及月費/合約,超出工程範圍)。

### 可逆性
**中**。三條路線都收斂到同一個輸出介面(`requestExport`/`background_jobs.jobType="compose"`),前端 `CompletionCanvas` 不需要知道背後是哪條技術路線——這代表**日後要換路線(例如先上委外 API,量大後換自架 ffmpeg 省成本),對前端與其餘系統是透明的**,只需要重寫 `videoComposer.ts` 內部實作,不影響其呼叫方。唯一不可逆的成本是「已投入的實作工時」,資料層與介面設計本身可逆。

---

## 決策卡 3:連結外部工具走 MCP 子系統 vs 繼續手刻 REST

### 決策點
M3 建議 Adobe/Canva 走「產品自建 MCP client」,而非像 Notion 那樣手刻 REST adapter。需要裁定:是否要建一個通用 MCP client 子系統,還是繼續照 Notion 模式手刻每一家。

### 現況實據
- **`data_source_connections` 的 kind 枚舉已經留位但未實作**:`server/subsystems/contextPackets/contracts.ts:32-46` 的 `DATA_SOURCE_KINDS` 定義為 `["team_data", "cloud", "notes", "mcp", "external_api", ...PROJECT_CONTEXT_SOURCE_KINDS]`,`CONNECTION_KINDS`(可外部連接的子集)包含 `"mcp"`/`"external_api"`(:48-52)——**型別層級已經留了 MCP 的位置**,但這只是 zod enum 字面量,沒有任何執行邏輯掛在後面。
- **健檢函式只認得兩個 provider,不認得 mcp/external_api**:`server/subsystems/contextPackets/connectionService.ts:179-208` 的 `runHealthCheck(userId, conn)` 內部是 `if (conn.provider === "google_drive") {...} if (conn.provider === "notion") {...} return false;`——**沒有第三個分支**。若現在就建一筆 `kind="mcp"` 的連接,健檢會直接回傳 `false`(判定不健康),因為程式碼根本不知道怎麼驗證它。這證實 M3 的判斷:「mcp/external_api 是 schema 留位,不是可用能力」。
- **Notion adapter 是手刻 REST 的具體樣貌**:`server/subsystems/contextPackets/adapters/external.ts:127,161,188,206` ——`NOTION_API = "https://api.notion.com/v1"` 常數、`createNotionAdapter` 內直接 `fetch(`${NOTION_API}/search`, {...})` 手動組 header(`Authorization: Bearer`+`Notion-Version`)、手動解析回傳 JSON 結構。這是「沒有官方 MCP server 時代的權宜寫法」(M3 用語),每加一家供應商都要重寫一次認證/分頁/欄位映射邏輯。
- **產品程式碼內完全沒有 MCP client library**:`grep -n "modelcontextprotocol" package.json` 0 命中——`package.json` 沒有 `@modelcontextprotocol/sdk` 這類官方 client SDK 依賴。全 repo 唯一的 `.mcp.json` 只掛了 `gitnexus`(給 Claude Code 這個開發期會話用的程式碼知識圖譜工具,`command: npx gitnexus mcp`),**與 healing-studio 產品運行時完全無關**——這個區分很重要,不能誤讀成「Adobe/Canva MCP 已經接了」(本次任務環境掛載的 Adobe/Notion/Google Drive MCP,同樣是給我這個 agent 用的開發期工具,不是產品對其終端使用者暴露的能力)。
- **加密與健檢的基礎設施已就緒,可直接複用**:`server/_core/secretCrypto.ts`(AES-256-GCM+scrypt+keyId 版本化,已用於 Notion token 加密)、`connectionService.ts` 的 CRUD/擁有權檢查(team/project 歸屬)——這些不需要為了 MCP 重寫,新 provider(不論走 MCP 或手刻 REST)都能直接掛上同一套加密與 CRUD。

### 選項
1. **建通用 MCP client 子系統**(M3 建議,`server/services/mcpClient.ts`,用官方 `@modelcontextprotocol/sdk`)
   - 成本:中——一次性投入建 `createMcpAdapter(connection)`(呼叫 `tools/list`/`tools/call`),之後每家支援 MCP 的供應商(Adobe/Canva 若有官方 MCP server)都是「宣告一筆 connection + 讀 tools/list」而非重寫 fetch 邏輯,邊際成本遞減。
   - 風險:中——MCP SDK 是相對新的協定/函式庫,長期維護面(SDK 版本升級、多 server 連線池管理、健檢邏輯)是新技術債類別,但**只需要學一次**,不像手刻 REST 是「每加一家學一次該家的 API 文件」。
   - 前提:Adobe/Canva 是否真的有官方 MCP server 可供**產品終端使用者**串接(不是本次 agent 會話用的開發期 MCP),且 healing-studio 需要自己申請 Adobe/Canva 的 OAuth App(業務/法務流程,M3 已點名,非工程排期)。
2. **繼續手刻 REST(Notion adapter 模式,逐家客製 fetch)**
   - 成本:低(單一供應商)但**不遞減**——每加一家外部工具都要重新讀該家 API 文件、手寫認證/分頁/欄位映射,Adobe/Canva 的官方 API 面通常比 Notion 更廣、認證機制更重(OAuth+多 scope),手刻成本會比 Notion 更高。
   - 風險:低(短期,沿用熟悉模式)但**長期**——若之後還要接第三、第四家工具(例如 Figma、Slack),每次都是全新工程投入,無法共用 MCP 生態圈已經存在的官方 server。
3. **兩者並存,依供應商是否有官方 MCP server 決定走哪條**(混合路線,非 M3 明講但邏輯上存在)
   - 成本:中——需要維護兩套 adapter 模式(`DataSourceAdapter` 介面已經 source-agnostic,兩種實作都能插入同一 pipeline,不衝突)。
   - 風險:低-中——`contracts.ts` 的介面設計本來就允許這樣做(`DataSourceAdapter.collect()` 只要求輸出同形狀的 ref),混合路線在架構上是自然的,不是妥協。

### 我的建議
選項 3(實質上是選項 1 的漸進版):**先用選項 2 的心態評估 Adobe/Canva 是否真有官方 MCP server**——若有,走選項 1 建 MCP client(邊際成本遞減,且與本次任務環境驗證過「MCP client 概念在這個生態圈可行」一致);若某家沒有官方 MCP server 或 MCP 覆蓋不完整,那一家就退回手刻 REST,比照 Notion adapter 模式。**不需要為了統一而勉強,`DataSourceAdapter` 介面已經允許兩者並存**,這是 M3 architecture 設計時就留好的彈性,不是新增技術債。

### 影響面
- 新增 `server/services/mcpClient.ts` + `@modelcontextprotocol/sdk` 依賴。
- `data_source_connections` 新增真實 `provider`(如 `adobe_express`/`canva`),`connectionService.runHealthCheck` 補 MCP 分支。
- 安全:BYOMCP(使用者自訂 MCP server URL)若開放,**必須**過 `ssrfGuard`(M3 §6 已明講,只允許 https/非私網位址/`redirect:"error"`),否則會複製 K1 稽核已指出的「orb tool registry 缺網域白名單」反面案例。

### 需要 Bruce 拍板的點
1. Adobe/Canva 官方 MCP server 的可用性與條款需要業務/法務確認(是否允許 healing-studio 以「產品」身份串接,而非個人開發帳號)——這不是工程能單方面決定的。
2. 是否核准新增 `@modelcontextprotocol/sdk` 這個新技術棧依賴(長期維護承諾)。
3. 是否允許使用者自訂任意 MCP server URL(BYOMCP)——若允許,SSRF 防護是強制前提,不可跳過。

### 可逆性
**高**。`DataSourceAdapter` 介面已經是 source-agnostic 設計,新增或替換某一家供應商的 adapter(不論是 MCP 版還是手刻 REST 版)不影響其餘供應商,也不影響 pipeline 下游消費者(context packet 組裝邏輯)。這是純粹的「新增一種 adapter 實作」,不涉及 schema 破壞性變更。

---

## 決策卡 4:三套專案體系收斂順序——先統一資料模型 or 先做新功能

### 決策點
M0/M1 都指出需要「先修 G3 178-tool gate」再做功能開發,但專案主幹統一(卡 1)本身要不要排在所有新功能之前,還是可以漸進式邊做邊收斂,是本波需要拍板的執行順序問題。

### 現況實據
- M0 §4「依賴順序與前置阻塞」已經給出**技術面**的強制順序:G3 gate 是分鏡管線執行化(M1 軌 B)與 AI 引導(M2)的共同硬前置,理由是「規劃會過、執行必敗」的假成功風險——這條已經是既有研究的結論,非本卡新增判斷。
- 但 M0/M1 **沒有明講**「專案主幹統一(卡 1)」相對於「新功能開發(軌 B-F)」的先後順序。實讀 M1 §5.1(近期路線)可見:**首個 PR 刻意把軌 A(專案主幹統一)排除在範圍外**——「不在首個 PR 範圍:...專案主幹統一的 UI 改動(軌 A,先在 SSOT 裁定與資料層對齊即可,前端建案流程改動排中期)」。這代表 M1 自己的路線設計**已經是「先小範圍宣告 SSOT 裁定(不需要大改),再漸進遷移前端消費者」**,不是「大改再開發新功能」。
- 佐證:卡 1 已確認 SSOT 裁定本身**零 schema migration**(video_projects 已有 `creativeProjectId` 外鍵欄,只是前端不填),意味著「統一資料模型」在本案裡的實際工程量遠小於字面印象——它不是一次痛苦的大遷移,而是「補一行呼叫參數+一個查詢+一個 fallback 修正」。這個實據直接影響順序判斷:如果統一資料模型的成本真的很低,先做完再開發新功能的等待時間也很短,不構成「先做哪個」的兩難。
- 但分鏡三軌編輯器(軌 D)、compose(軌 E)這些**新功能本身依賴軌 A 完成到什麼程度**是需要澄清的:軌 D/E 的所有新 procedure 都要求 `creativeProjectId` 作為必要輸入(M1 §6「防跑偏」機制第 1 條),若軌 A 的 SSOT 裁定沒有先落地,軌 D/E 一旦上線就會繼承現有的「猜最新一筆」反例(`VideoProjectLifecycleCard` 的 `projects[0]`),把技術債焊進新功能裡。

### 選項
1. **漸進遷移**:先做 G3 gate 修復(既有硬前置)+ 軌 A 的**最小裁定**(SSOT 宣告+前端建案流程改一次寫入+新增 1 個查詢,約數天工作量,卡 1 已證實成本低),兩者並行後才開始軌 B-F 新功能,新功能一律從第一天就用 `creativeProjectId` 作為必要輸入。
   - 成本:低——軌 A 最小裁定本身工作量小(卡 1 已量化:改 1 個 dialog 呼叫+新增 1 個唯讀 query+改 1 個 fallback)。
   - 風險:低——避免新功能繼承舊的「猜最新一筆」反例,一次性把地基打對。
2. **大改先行**:先把三表徹底統一(包含歷史孤兒資料回填、UI 全面走查、遷移所有既有消費者)才開始任何新功能開發。
   - 成本:高——孤兒資料回填(卡 1 已指出 world_storyboards 沒有反向外鍵,回填需要啟發式配對,可能配錯)、82+21+40 處呼叫點的全面走查,是數週到一個月級的工作量,且大部分工作對「創作者能不能多走一步」(M0 §5 的驗收標準)沒有直接貢獻。
   - 風險:中——大改期間北極星功能(分鏡執行化、compose)完全停擺,與 M0 一路強調的「每階段可展示端到端 demo」的漸進交付哲學相反。
3. **先做新功能,資料模型收斂無限期擱置**(不做卡 1)。
   - 成本:低(短期)。
   - 風險:高——新功能會繼續複製「猜最新一筆」「雙寫分裂」的模式,擴大而非縮小技術債面,直接違背北極星「不跑偏」的核心要求(M0 §6 資料層機械強制)。

### 我的建議
選項 1。理由是卡 1 的實據已經證明「統一資料模型」在這個案例裡不是傳統意義的大遷移(不涉及破壞性 schema 變更、不需要停機),M1 自己的路線設計也已經把它安排成「先裁定+小改,其餘留給漸進」——**選項 1 本質上就是把 M1 §5 既定路線的優先序,提前挪到 G3 gate 修復的同一批**,理由是軌 D/E 的新 procedure 一旦定型會固化 `creativeProjectId` 必填的假設,越晚做基礎裁定,越多新程式碼需要事後補這個假設。

### 影響面
- 排程面:把「軌 A 最小裁定」從 M1 §5.2(中期)提前併入 Phase 0/G3 gate 修復同一批(小改動,不影響其他階段時程)。
- 不影響:大規模歷史資料回填(可以留在中長期,不阻塞任何新功能)。

### 需要 Bruce 拍板的點
1. 是否同意把「軌 A 最小裁定」提前到 Phase 0(與 G3 gate 修復同批),而非等到 M1 §5.2 中期。
2. 歷史孤兒資料(video_projects/world_storyboards 缺 creativeProjectId 關聯的既有列)是否值得投入資源回填,還是接受「舊資料維持分裂,只對新建案強制」。

### 可逆性
**高**。「先做小裁定再開發新功能」與「先開發新功能再補裁定」兩條路徑在技術上都可逆——差別只在於技術債累積的時間窗口長短,不涉及不可逆的資料損毀或架構鎖死。

---

## 決策卡 5:公開 vs 私有 repo

### 決策點
背景描述 healing-studio 是「內部非公開平台」,但實測 repo 在 GitHub 上是 **public**。這牽動 CodeRabbit 免費方案、安全曝光面、GitHub Actions 額度,需要拍板是否轉私有。

### 現況實據
- **repo 目前確實是 public**:透過 GitHub API 查證 `aa0968111723-prog/healing-studio`——`"private": false`,`stargazers_count: 2`,`open_issues_count: 105`,描述文字明白寫著這是一個功能完整的多模態 AI 創作平台(含 Veo 3.1、Suno V5、ElevenLabs 整合等產品細節),**任何人都能看到完整原始碼、完整 commit 歷史(3,912 筆 commit)、102 張表的 schema 設計、以及所有安全機制的實作細節(例如 `secretCrypto.ts` 的加密方式、`ssrfGuard` 的檢查邏輯)**。這與「內部非公開平台」的定位有落差,是一個需要拍板的認知落差,不是技術問題。
- **沒有委任何機密進版控**:檢查 `.gitignore`(`.env`/`.env.local`/`.env.*.local` 均已排除)、`git ls-files` 搜尋 `.env`/`secret` 字樣**只命中程式碼檔案**(`secretCrypto.ts` 等實作檔,非真正密鑰檔),`.env.production` 內容經 B-infra 稽核確認「只有 7 個 `VITE_*` 公開建置旗標,無任何密鑰」——**目前沒有發現已外洩的機密本身**,曝光面是「架構與安全機制設計圖」而非「金鑰」。但這仍然構成資訊安全風險:攻擊者能讀到 `ssrfGuard`/`secretCrypto`/RBAC 邏輯的完整實作,更容易針對性尋找繞過方式(相較黑箱測試)。
- **CodeRabbit 現況**:`docs/plan/AIDV-dev-workflow.md:30,64` 與多個 `.claude/skills/aidv-*` 文件都把「CodeRabbit 審查」寫進九階流水線的第 6 站(審查門),但實際查證(`gh` 搜尋 `commenter:coderabbitai`)**在本 repo 找不到任何 coderabbitai 的 PR 留言紀錄**——這代表 CodeRabbit **可能從未真正啟用**,或啟用了但目前沒有近期 PR 觸發留言。若確實依賴 CodeRabbit 免費方案(CodeRabbit 對公開 repo 通常提供免費/寬鬆額度,對私有 repo 需付費方案),轉私有後需要重新確認訂閱方案與付費意願——**這是本卡查證不到的關鍵缺口**,需要 Bruce 或維運方直接查 CodeRabbit dashboard 的訂閱狀態。
- **GitHub Actions 現況**:`.github/workflows/pr-gate.yml` 檔頭註解明寫「全部用 GitHub 免費的 hosted runner,零金鑰、零後端」,單一 workflow(`pr-gate.yml`),每次 PR 觸發 tsc+check:routes+check:navigation+vitest,`timeout-minutes: 20`。GitHub 官方政策:**public repo 的 GitHub-hosted runner 分鐘數永遠免費不限量**;private repo 則依方案(Free 帳號 2,000 分鐘/月,超過需額外付費)——若轉私有且團隊帳號是 Free 方案,每次 PR 跑 20 分鐘上限的 CI,月用量需要重新估算是否超額(**此為 GitHub 平台既定政策,非需要查證的 repo 內部事實,但實際帳號方案等級屬未查證項**)。

### 選項
1. **轉為私有(private)**
   - 成本:低(操作面,GitHub repo 設定一鍵切換)但**間接成本待確認**——CodeRabbit 訂閱是否需要升級付費方案(未查證)、GitHub Actions 分鐘數是否會超過免費額度(取決於團隊 GitHub 方案等級,未查證)。
   - 風險:低——直接消除「任何人都能讀完整原始碼與安全機制設計」的曝光面,符合背景描述的「內部非公開平台」定位。轉私有**不會**影響現有功能運作(CI/CD、Railway 部署都不依賴 repo 是否公開)。
2. **維持公開**
   - 成本:零(不動作)。
   - 風險:中-高——與宣稱的「內部非公開平台」定位不符,且完整曝露安全機制實作細節(K1 稽核已列出多項 SSRF/IDOR 待修風險,若攻擊者能讀原始碼精確定位這些已知弱點所在行號,風險高於黑箱環境);另外,105 個 open issues 若含有任何內部規劃/敏感細節,也一併公開可見。
3. **轉私有但同時保留一個「公開精簡版」repo(open-core 模式)**
   - 成本:高——需要維護兩個 repo 同步或做程式碼隔離,不建議在目前團隊規模與工程量下投入。

### 我的建議
選項 1。安全與定位一致性的理由足夠直接,唯一需要先確認的是 CodeRabbit 與 GitHub Actions 這兩個「間接成本」的實際數字(訂閱方案等級、月用量),避免轉私有後這兩項自動化突然失效或超額計費造成意外中斷——**建議轉私有前先查一次 CodeRabbit 與 GitHub 帳號的方案等級**,而不是倒因為果地因為怕麻煩而維持公開。

### 影響面
- GitHub repo 設定(Settings → Danger Zone → Change visibility),需要 repo owner(`aa0968111723-prog`帳號)操作,一鍵可逆。
- 若 CodeRabbit 需要升級方案:額外月費(金額未查證,需查 CodeRabbit 定價頁或現有訂閱)。
- 若 GitHub Actions 額度不足:需要升級 GitHub 方案,或縮減 CI 觸發頻率/時長(現有 `pr-gate.yml` 已有 `concurrency: cancel-in-progress` 省額度設計,20 分鐘 timeout 上限,實際跑多久未知)。
- Fork/star 紀錄(目前 2 顆星、0 fork)轉私有後會怎麼處理需依 GitHub 政策確認(通常 fork 會保留為獨立 public repo,star 會消失)。

### 需要 Bruce 拍板的點
1. 是否確認「內部非公開平台」的定位優先於任何維持公開帶來的效益(如 CodeRabbit 免費額度),即使需要付費也要轉私有。
2. 授權查詢 CodeRabbit 訂閱狀態與 GitHub 帳號方案等級,取得轉私有的實際財務影響數字後再做最終決定。
3. 是否需要保留現有 2 顆星/公開 commit 歷史的任何部分(例如作為作品集展示用途)——若有此需求,需要選項 3 或分離出一個公開的精簡展示版。

### 可逆性
**高(技術面)/中(觀感面)**。GitHub 允許 public↔private 隨時切換,不影響程式碼或資料本身。但**曾經公開過的內容無法「取消已被看過」**——若已有第三方 clone/爬取過原始碼(105 個 issue、2 個 star 顯示確實有訪客),轉私有無法追溯撤回這些已下載的副本;若稽核發現任何機密曾經進過 commit 歷史(本次查證未發現,但完整 3,912 筆 commit 歷史未逐筆審查),即使刪除也可能已被存檔(GitHub 快取、第三方鏡像),需要另外走金鑰輪替流程處理,而非只靠切換可見性解決。

---

## 附:五張卡的共同前提

本文件五個決策不互斥,且有明確依賴順序建議:
1. 卡 5(repo 私有化)屬於治理/安全決策,與其餘四張工程決策**互不依賴**,可獨立、立即拍板。
2. 卡 1(SSOT)是卡 4(收斂順序)討論的前提資料,卡 4 的建議直接建立在卡 1「成本其實很低」的實據之上。
3. 卡 2(compose 技術路線)與卡 3(MCP vs 手刻)互不依賴,可平行進行技術 spike。
4. 卡 1、卡 2、卡 3 都不阻塞彼此——可以三條線平行排入近期路線,只有卡 4 的順序建議(軌 A 最小裁定提前到 Phase 0)會影響其餘工程卡的實際起跑順序。

