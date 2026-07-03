# M3 — 創作者連結自己的工具／資料庫／自動化工作流(方案設計 wave M)

- 產生日期:2026-07-03
- 依據 commit:`7d1752bd4956519181c86eef51f700b46deef9dc`
- 性質:**方案設計,非診斷**——引用既有稽核結論(00-summary/02-fullstack/E/B/D/G1/I/K4)作為現況依據,並實讀下列程式碼後產出前瞻設計。不重複列證據行號之外的診斷細節,細節一律回引號來源。
- 本質定義(必對齊):讓創作者**連結與創建自己的資料庫系統**、**連結自己的工具(Adobe/Canva/Notion)**、或**創建自己的自動化工作流**。三條路徑分開設計,因為現況成熟度差異極大(見 §2)。
- 實讀清單:`server/subsystems/{commander,contextPackets,projectContext}/*`、`server/routers/{drive,externalServices,webhook,workflow}.ts`、`server/config/orbToolRegistry.ts`、`server/_core/secretCrypto.ts`、`client/src/components/connectors/*`、`client/src/shells/settings/panels/ConnectionsPanel.tsx`、`client/src/components/create/TeamDataSourcesPanel.tsx`、`drizzle/schema.ts`(`dataSourceConnections`/`projectDataAccessRules`/`webhookSubscriptions`)、`.mcp.json`。

---

## 1. 本質對齊

平台的差異化不在「又一個生成引擎聚合器」,而在**創作系統**:世界觀→分鏡→生成→審→交付單一資料模型(00-summary §3 波 3;D §1.1)。「連接器/資料庫/自動化」這條 M 系列存在的理由,不是把 healing-studio 變成 iPaaS(Zapier/Make 那種通用整合平台),而是把**創作者既有的個人資產與工具鏈**(Notion 筆記、Drive 素材、Adobe/Canva 設計檔、自訂通知/交付管線)接進**同一個創作上下文**,讓光球/導演台/教材庫能看見、能用、能觸發——本質是「餵資料進 context packet」與「把生成事件送出去」,不是「當一個泛用工作流引擎」。

三條路徑對本質的貢獻不同,設計時不可混為一談:

| 路徑 | 對齊本質的方式 | 現況成熟度 |
|---|---|---|
| **連自己的資料庫** | 創作者的知識/素材餵進 RAG 檢索,成為生成時「這個角色/這個品牌怎麼講話」的依據 | 中(TeachingArchive 已是雛形,見 §2.1) |
| **連外部 SaaS 工具** | 創作者不必人工搬資料——Drive/Notion/Adobe/Canva 的東西直接被光球看見/引用 | 低-中(Drive/Notion 有真後端,Adobe/Canva 是 0,見 §2.2) |
| **建自己的自動化工作流** | 生成完成/審核通過等事件能推播到創作者自己的下游(Slack/n8n/Canva webhook 等),或by 訂閱驅動後續動作 | 低(僅有出站 webhook 骨架,無「trigger→action」編排器,見 §2.3) |

---

## 2. 目標狀態與現況缺口

### 2.1 連自己的資料庫(現況:雛形已在,缺編輯與結構化)

**現況**(實讀確認):`teaching_materials`(`drizzle/schema.ts`)+ `server/routers/teachingArchive.ts` + `server/services/teachingArchiveIngest.ts`/`teachingArchiveSearch.ts`:上傳文字/PDF/圖/影/語音→ PDF 抽文/ElevenLabs Scribe 轉錄→切片→`gemini-embedding-001`→Pinecone(`namespace=teaching-{userId}`)→四視野(我的/團隊/公開/未定)檢索,含存取稽核(`teaching_material_access_log`)。這**就是**創作者「連結/創建自己的資料庫」的真實雛形,等價於業界「brand knowledge / Source of Truth」層(D §1.1)。

**缺口**(L2 §6 逐行核實):
- `teachingArchive.update` 後端 `createInputSchema.partial()` 完整,前端零呼叫——上傳後分類/講者打錯字只能刪除重傳(`docs/research/L2-fields-learn.md:364-366`)。
- `thumbnailUrl`/`durationSeconds`/`pageCount`/`isFeatured`/`sortOrder` 後端接受、UploadDialog 無對應輸入欄位。
- 本質侷限:TeachingArchive 是**文件型 RAG**(切片+向量),不是「結構化記錄庫」(像 Notion database/Airtable 那種有欄位 schema 的表格)。`ConnectionsPanel.tsx` UI 上已經預留「內部資料庫·每人 10G 個人庫」分類(`client/src/shells/settings/panels/ConnectionsPanel.tsx:31`),但**該分類的 `kind: null`——後端表完全不存在**,只是待接 pill。這是「創作者自建結構化資料庫」與「創作者的文件知識庫」兩個不同需求,現況只有後者。

### 2.2 連外部 SaaS 工具(現況:Drive/Notion 有真後端,Adobe/Canva 是 0)

**已驗證的真後端**(不是死碼,是可用但發現性差):
- `server/subsystems/contextPackets/connectionService.ts` + `contracts.ts`:`data_source_connections` 表,`createConnection/listConnections/testConnection/setConnectionStatus/deleteConnection`,憑證走 `secretCrypto.ts`(AES-256-GCM,scrypt 導出金鑰,支援 keyId 版本輪替,`v2:<keyId>:<iv>:<tag>:<cipher>`,**絕不回前端**)。
- `server/subsystems/contextPackets/adapters/external.ts`:`createDriveAdapter`(既有 Google OAuth token,唯讀 folder→抓文字內容,最多 5 筆/3 筆抓完整內文)、`createNotionAdapter`(`Bearer` token→`/v1/search`+`/v1/blocks/{id}/children`)。兩者皆標記回傳內容 **untrusted**(`sanitizeUntrusted`,見 `contracts.ts:8-9` 的安全不變量說明)。
- 前端**真實**入口在 `/create` 流程內:`client/src/components/create/TeamDataSourcesPanel.tsx` 的 `DataConnectionsSection`——貼 Notion token、貼 Drive 資料夾——呼叫 `dataConnections.create/list/test/setStatus`,是唯一能「新增」連接的地方。
- `/settings` 的 `client/src/shells/settings/panels/ConnectionsPanel.tsx` 是**唯讀治理**版(列出/健檢/啟停),明講「新增連接於建立流程進行(不在此收金鑰)」——這是刻意設計(治理與建立分離),但造成「使用者要連 Notion 得先開一個專案」的發現性缺口。

**Adobe/Canva 現況:0**。全 repo(`server/`、`client/src/`)無 `adobe`/`canva` 字樣的產品程式碼;`.mcp.json` 只有 `gitnexus`(開發期程式碼知識圖譜,服務對象是 Claude Code 會話,非產品 runtime——`docs/research/02-fullstack.md:224-229` 已證實「產品程式碼內沒有任何 MCP client」)。**本次任務環境本身已連上 Adobe/Figma/Notion/Google Drive MCP,但那是給我(agent)在這個對話裡用的工具,不是 healing-studio 產品對其終端使用者暴露的能力**——這個區分必須說清楚,否則容易誤讀成「Adobe 已經接了」。

**連接器 UI 三層分裂**(呼應任務描述「connector 元件」需收斂):
1. `client/src/components/create/TeamDataSourcesPanel.tsx`——真實、有寫入、藏在 /create。
2. `client/src/shells/settings/panels/ConnectionsPanel.tsx`——真實、唯讀治理,`/settings` 第 6 籤。
3. `client/src/components/connectors/ConnectorsPanel.tsx` + `connectorsTypes.ts`——**純視覺 mock**(Wave U/AIDV-115 U-12),`props`/`MOCK_CONNECTORS` 驅動,旗標 `VITE_CONNECTORS_PANEL`(預設 OFF)。用完全不同的分類體系(`model/storage/source/byomcp/vault` vs 真後端的 `cloud/notes/mcp/external_api`),與 `dataConnections` 零連接——是「先做視覺骨架、之後接線」的半成品,目前是重複投資而非收斂路徑上的一步。

### 2.3 建自己的自動化工作流(現況:僅出站 webhook 骨架,無編排器)

**兩個常被混為一談但完全不同的路由**(任務描述把它們並列為「死碼」,這裡拆開講清楚):

- `server/routers/webhook.ts`(AIDV-269,`webhookRouter`):**創作者自己的** webhook 訂閱 CRUD——最多 5 個/人,URL 建立與更新時 `assertSafeExternalUrlAsync`(SSRF 檢查),HMAC secret、送達歷史、測試按鈕。事件目前只有 `video.completed`/`video.failed` 兩種(`VALID_WEBHOOK_EVENTS`)。K1 稽核明確指出其送達路徑 `server/services/webhookDispatcher.ts` 是全站**做得最完整**的 SSRF 防護範例(建立時+**每次送達時**都重驗+`redirect:"error"`,見 `docs/research/K1-security-bugs.md:130`)。**這是「創作者建自己的自動化工作流」最務實的起點**——生成完成→打自己的 n8n/Make/Slack Incoming Webhook。目前後端完整、前端零呼叫(K4 R11),純粹缺一個 `/settings` 面板。
- `server/routers/externalServices.ts`(`externalServicesRouter`):**這不是創作者的連接器**,是平台自己對第三方 SaaS 帳單的內部記帳(admin-only,記錄 fal.ai/ElevenLabs/Railway 等的月費/API key 健康狀態),與「創作者連結自己的工具」語意無關,只是恰好也在 K4 的死碼清單裡。**設計上應排除在本波範圍外**,避免誤把它當成連接器框架的一部分去擴建。
- `server/routers/workflow.ts`(`user_workflows` 表):現況是**導演台工作流步驟的個人化排序**(`workflowStepSchema`:`id/name/required/enabled/canvasMode/pending`,`getUserWorkflow`/`upsertUserWorkflow`)——回答「我的座艙工作流哪幾步驟要顯示/順序」,**不是**「trigger→action」式的通用自動化編排器。G1 已核實:`WorkflowBuilder` 抽屜與 `DirectorConsoleProvider` 檔頭仍寫「工作流後端待補/本地示意」,但實際已持久化到 `user_workflows`(`docs/research/G1-video-cockpit.md:189`)——這是**文案漂移**,修正成本是改幾行註解/UI 文案,而非接新後端。但要注意:**修正文案之後,user_workflows 仍然只是步驟排序,不會變出「建自己的自動化」能力**——不要讓「補 UI」這件小事,掩蓋「真正的自動化編排器不存在」這個大缺口。
- `orb_scheduled_jobs`(`server/services/orbScheduler.ts`)+ `getOrbToolRegistry()`(`server/config/orbToolRegistry.ts`):光球已有「排程執行工具」的骨架,但工具清單來自 **`ORB_TOOL_REGISTRY_JSON` 單一環境變數**——全站共用、admin 手動維護 JSON、無 per-user/per-team 註冊 UI、無擁有權範圍。這是「光球能力」的骨架,不是「創作者自建工作流」的骨架:創作者無法自己新增一個工具讓光球呼叫。

**MCP 現況**:`DATA_SOURCE_KINDS`/`CONNECTION_KINDS`(`server/subsystems/contextPackets/contracts.ts:43-60`)已經把 `"mcp"`/`"external_api"` 定義為合法 kind,`DataSourceAdapter` 介面刻意 source-agnostic(注解明講「外部連接器日後只要產出相同形狀的 ref 即可進同一條 pipeline,不需改 schema」)——**但沒有任何 `createMcpAdapter` 實作**,`connectionService.runHealthCheck` 也只認得 `google_drive`/`notion` 兩個 provider。換言之:M4 的架構已經預留了 MCP 的位置,只是四年計畫裡还没排到「真的寫一個 MCP client」這一步。

---

## 3. 重用什麼(既有資產盤點,附 path)

| 資產 | 現況 | 本波怎麼重用 |
|---|---|---|
| `server/subsystems/contextPackets/contracts.ts` | source-agnostic 合約,`DataSourceKind`/`ConnectionKind`/`AccessLevel`/`DataSourceAdapter` 已定義,`mcp`/`external_api` 已留位 | **不改 schema**,新 adapter 直接實作 `DataSourceAdapter.collect()` 插入 pipeline |
| `server/subsystems/contextPackets/connectionService.ts` | `data_source_connections` CRUD + 健檢 + 憑證加密,已支援 team/project 歸屬檢查 | 擴充 `runHealthCheck` 的 provider 分支;`CreateConnectionInput` 不必改形狀 |
| `server/subsystems/contextPackets/adapters/external.ts` | Drive/Notion 兩個真實 adapter,含 sanitize/截斷/untrusted 標記 | 當 MCP adapter 的**設計範本**(同樣的 accessLevel→contentMax 分級、同樣的 sanitizeUntrusted) |
| `server/_core/secretCrypto.ts` | AES-256-GCM + 金鑰版本化,已用於 Notion token | Adobe/Canva OAuth refresh token、任何 MCP server 的 API key 直接複用,不必重寫加密層 |
| `server/routers/drive.ts` + `services/googleDrive.ts` | 完整 OAuth 生命週期(status/disconnect/listLibraries/addLibrary/listFolder) | Adobe/Canva 若走 OAuth,比照此檔的 token 刷新/狀態查詢模式 |
| `server/routers/webhook.ts` + `services/webhookDispatcher.ts` | 創作者 webhook 訂閱 CRUD + 業界最佳實踐 SSRF 防護 + HMAC + 送達歷史 | **自動化工作流第一版的整條後端**,只缺前端面板 + 擴充事件種類 |
| `server/routers/workflow.ts`(`user_workflows`) | 座艙步驟個人化排序 | 保留現有語意(步驟排序),不擴大成通用編排器;文案修正見 §5 首個 PR |
| `TeachingArchive`(`teaching_materials` + Pinecone) | 創作者自己的文件型知識庫,四視野+稽核 | 「連自己的資料庫」路徑的主資產,補 `update` 前端即可去掉最大缺口 |
| `client/src/components/create/TeamDataSourcesPanel.tsx` | 真實可用的連接建立 UI | 作為「連接器建立」的**唯一入口**保留,settings 面板改為 deep-link 過來而非重造一份 |
| `client/src/shells/settings/panels/ConnectionsPanel.tsx` | 真實治理 UI(健檢/啟停),5 類分組已規劃好版位 | 收斂後的落點——`components/connectors/ConnectorsPanel.tsx` 的視覺樣式可以「移植」進這支真實元件,而非維持兩套並存 |
| `server/config/orbToolRegistry.ts` + `services/agentToolExecutor.ts` | 平台級 API 工具骨架(`riskLevel`/`allowedRoles`/`requireConfirmation`/`retryPolicy` 已建模) | schema 設計可以直接借用來做「per-user MCP 工具白名單」的欄位形狀 |
| `ORCHESTRATION_MODES`/`commander.createIntent`(`server/subsystems/commander/`) | 意圖記錄骨架(pending run,無執行) | 未來「自動化觸發」可掛在 orchestration_runs 之下,不必另開一張表記錄「誰觸發了什麼」 |

---

## 4. 要補什麼(最小新增)

### 4.1 連接器框架收斂(不寫新後端,先做「一個真相來源」)

1. **廢止或吃掉 mock 面板**:`client/src/components/connectors/ConnectorsPanel.tsx` 二選一——(a) 直接刪除+旗標拔除(它從未在 prod 開啟過,`VITE_CONNECTORS_PANEL` 預設 OFF,零回歸風險);或 (b) 把它的視覺元件(`ConnectorCard`/`StatusDot`/`CategoryGroup`)改造成 `ConnectionsPanel.tsx` 的真實資料渲染層,分類體系統一成 `dataConnections` 的真實 `kind`(`cloud/notes/mcp/external_api`)。**建議 (a)**,理由:分類體系(`model/storage/source/byomcp/vault`)與真實 `kind` 語意不一致,勉強對應會產生新的認知負擔,不如直接刪除、把視覺質感搬到真實面板。
2. **`/settings/connections` 增加「新增連接」淺層表單**,呼叫既有 `dataConnections.create`,不必等使用者先開專案——`TeamDataSourcesPanel.tsx` 的 `DataConnectionsSection` 邏輯可以整段抽成共用元件,`projectId` 傳 `null`(`contracts.ts` 的 `CreateConnectionInput.projectId` 本來就是 optional)。

### 4.2 把 user_workflows UI 接真(文案修正,非新後端)

3. 修 `ConsoleDrawers.tsx`/`DirectorConsoleProvider.tsx`/`WorkflowBuilder` 抽屜檔頭文案:「後端待補/本地示意」→ 如實描述「已持久化到你的帳號(`workflow.getDefault`/`workflow.save`),重新整理不會遺失」。同時在 UI 上明確標示「這是座艙步驟順序,不是通用自動化」,避免與 §4.3 的新自動化面板混淆。

### 4.3 自動化工作流:先把 webhook 面板做出來,再談編排器

4. **第一版(最小可用)**:`/settings` 新增「自動化 / Webhook」面板,直接呼叫既有 `webhookRouter`(list/create/update/delete/test/deliveryHistory)。UI 只需:URL 輸入框(前端也做基本格式檢查,後端 SSRF 是真正防線)、事件多選(目前 2 種)、secret 顯示一次、送達歷史表格、測試按鈕。**零後端改動**,對齊「後端有、前端接一下就有」(呼應 `I-debt-dormant.md §2.2`)。
5. **第二版**:擴充 `VALID_WEBHOOK_EVENTS`——把 `assets.upload`/`teachingArchive.reingest 完成`/`vault.exportToAssets`/`generation_history 審核通過`(若 §00-summary 波 2「審」補上狀態機後)都納入可訂閱事件,讓創作者的自動化不只綁「影片完成」。
6. **第三版(才是真正的「建自己的工作流」)**:在 `commander`/`orchestration_runs` 之下加一張輕量 `automation_rules` 表(`trigger_kind`, `trigger_config_json`, `action_kind`, `action_config_json`, `ownerUserId`)——`trigger_kind` 先只支援「既有事件」(同 webhook 事件表),`action_kind` 先只支援「呼叫既有 webhook 訂閱」與「寫一則 notes」。刻意不做通用「if-this-then-that 任意組合」,避免重造 Zapier——保持在「創作系統」語意內(觸發=創作事件,動作=通知/落記錄)。

### 4.4 外部工具經 orb tool registry 安全接入

7. 現況 `ORB_TOOL_REGISTRY_JSON` 是平台級靜態清單,無法讓創作者自己掛工具。最小新增:**把 `data_source_connections`(`kind="external_api"`/`"mcp"`)的每一筆連接,轉成該使用者專屬的 `OrbApiTool` 候選**——只讀 `configJson` 裡宣告的 `endpoint`/`method`,執行前一律過 `ssrfGuard`(呼應 K1 對「orb tool registry 的 SSRF/工具執行邊界未逐一核對」的未查完清單,見 `docs/research/K1-security-bugs.md:139`),且工具的 `allowedRoles`/`requireConfirmation` 沿用 `orbToolRegistry.ts` 既有 schema 形狀。**不擴大 orb 的權限面**,只是把「誰能用哪個工具」從全站共用改成「這個連接屬於誰,誰才能觸發」。

### 4.5 Adobe/Canva:走 MCP,但是「產品自己的」MCP client,不是這次 agent 會話借用的

8. Adobe(Firefly/Express)與 Canva 都已有官方 MCP server(本次任務環境即掛載了 `Adobe_for_creativity`/`Canva` MCP 供 agent 使用,但那是**開發期工具**,不等於產品能力)。若要讓 healing-studio 的**終端創作者**接上自己的 Adobe/Canva 帳號,正確路徑是:
   - 產品後端新增一個**通用 MCP client 子系統**(`server/services/mcpClient.ts`,用 `@modelcontextprotocol/sdk` 官方 client library),而非為每家廠商手刻 REST(參考 `adapters/external.ts` 目前對 Notion 是手刻 REST——這是 Notion 沒有好用 MCP server 時代的權宜寫法,Adobe/Canva 若原生支援 MCP,不必重蹈覆轍)。
   - `data_source_connections` 新增 `kind="mcp"` 的真實 provider(`adobe_express`/`canva`),`configJson` 存 MCP server URL + 需要的 scope;OAuth token 走既有 `secretCrypto`。
   - 新增 `createMcpAdapter(connection)`:呼叫 MCP `tools/list` 取得該 server 暴露的能力,`tools/call` 時一律 read-only 白名單(比照 Drive/Notion adapter 的「唯讀參照層級」原則,不做「叫 MCP server 幫我改設計檔」這種寫入動作,直到信任建立)。
   - **前提工作**(不在本波範圍,但要點名):healing-studio 需要自己去 Adobe/Canva 註冊 OAuth App(產品層級的開發者帳號),不是重用這次 coding session 的個人授權——這是業務+法務層的申請流程,非純工程排期。
9. **不建議**現階段自己刻 Adobe/Canva 的 REST API 整合(如當年刻 Notion adapter 那樣手寫 `fetch`)——Adobe/Canva 的官方 API 面較廣、認證機制較重,MCP 官方 server 已經把這些封裝好,重工是浪費。

---

## 5. 分階段路線 + 首個 PR

**第 0 階段(本波,1-2 週,零新資料表)**
- 刪除/凍結 mock `ConnectorsPanel`(`components/connectors/`)或明確標記「僅供設計參考,不接資料」。
- `/settings/connections` 加「新增連接」淺層表單(復用 `TeamDataSourcesPanel` 邏輯)。
- 修正 WorkflowBuilder/ConsoleDrawers 的「後端待補」文案。
- `/settings` 新增 Webhook 自動化面板,接現有 `webhookRouter`(零後端改動)。

**第 1 階段(1 個月內)**
- `teachingArchive.update` 前端表單(DetailDialog 補編輯,補 `thumbnailUrl` 等欄位輸入)——把「創作者自己的資料庫」補到能修正錯誤分類。
- 擴充 `VALID_WEBHOOK_EVENTS`(納入資產/教材/vault 事件)。
- `data_source_connections` 的 `external_api`/`mcp` kind 接進 `getOrbToolRegistry` 的 per-user 候選(§4.4)。

**第 2 階段(1-3 個月)**
- `automation_rules` 表(§4.3 第三版)。
- MCP client 子系統雛形(§4.5),先接一個低風險 provider(建議先做 Canva 的 read-only「我的設計清單」,比 Adobe 的認證面窄)。
- 「每人 10G 個人資料庫」若要做,先定義清楚它跟 TeachingArchive 的差異(結構化 record vs 文件 RAG),避免重工。

**首個 PR(建議範圍,最省工、最快看到效果)**:
> 只做「Webhook 自動化面板」+「WorkflowBuilder 文案修正」兩件事,兩者都是**零後端改動**、風險最低、直接呼應 D-adoption §2.4「創作事件無任何對外通知」的痛點。不動連接器收斂(那個涉及刪除既有元件,需要先跟設計/AIDV-115 負責人確認 mock 面板是否還有計畫用途)。

---

## 6. 安全邊界

1. **連接器憑證加密**:已有 `secretCrypto.ts`(AES-256-GCM + scrypt + keyId 版本化),`data_source_connections.encryptedCredentialRef` 對外一律經 `toConnectionView`(不含 credential 欄位)。新增 provider(Adobe/Canva OAuth token)直接複用,不必重新設計加密層;唯一要注意的是 **refresh token 的續期邏輯**(Drive 已有 `getValidDriveAccessToken` 自動刷新模式,Adobe/Canva MCP client 要比照,而不是每次過期就要求使用者重新授權)。
2. **SSRF**:Drive/Notion adapter 目前呼叫的都是**固定官方 API 網域**(`api.notion.com`,Google API),不是使用者可控 URL,SSRF 風險低;但 `webhookRouter` 的創作者自訂 URL(§4.3)**必須**維持現有 `assertSafeExternalUrlAsync`(建立/更新時)+ `webhookDispatcher.ts` 的**每次送達重驗**(K1 已確認這是全站最佳範例,不要在擴充事件種類時弱化這條路徑)。MCP client(§4.5)若允許使用者自訂 MCP server URL(BYOMCP),**一律**要過 `ssrfGuard`,且僅允許 https、非私網位址、`redirect:"error"`——不可比照 generate.ts 的 K1-1/K1-2(全域缺網域白名單)那種反面案例。
3. **orb tool allowlist**(呼應 K1 §「orb tool registry 的 SSRF/工具執行邊界」未查完項目):
   - 目前 `ORB_TOOL_REGISTRY_JSON` 是**全站共用、admin 維護**的靜態清單,任何使用者的光球都能呼叫清單裡所有工具——擴充成 per-user 動態工具(§4.4)後,**必須**加上擁有權檢查:工具執行前先驗 `connection.ownerUserId === ctx.user.id`(比照 `connectionService.loadOwnedConnection` 既有模式),不可讓 A 使用者的光球意外呼叫到 B 使用者連接的外部工具。
   - `requireConfirmation`(schema 已建模)對「寫入類」工具(未來若開放 MCP 寫入動作)**強制** true,不可讓 planner 自動連續呼叫寫入型外部工具而無人審——這與 00-summary R10(178 個精靈工具 case 不可達)、E 波「多代理協作只有 lead 真執行」的既有保守設計精神一致:能力要慢慢開,不要一次全開。
   - 新工具的 `endpoint` 網域建議額外疊一層**團隊/平台級白名單**(`ORB_TOOL_ALLOWED_ORIGINS`,00-summary §4.1 待補清單已列出這個 env 但值未知)——per-user 自訂工具不代表可以打任意網域,平台仍應能整體關閉某些高風險目的地。

---

## 附:本文件未涵蓋

- Adobe/Canva 產品層 OAuth App 申請的實際商務/法務流程(超出工程範圍)。
- 「每人 10G 個人資料庫」的具體資料模型設計(本文只點出它與 TeachingArchive 語意不同,未設計 schema)。
- MCP client 子系統的完整技術選型(SDK 版本、connection pooling、多 server 並發健檢)——只給了方向性建議。
- automation_rules 编排器的 UI 設計稿(design-kit 元件選用),本文只定義後端最小資料模型方向。
