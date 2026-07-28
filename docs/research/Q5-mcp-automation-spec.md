# Q5 — 產品自建 MCP client 子系統 + 創作者自動化工作流引擎(規格設計 wave Q)

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 性質:**規格級設計**——承接 M3-connectors-workflows §2.3/§4.4/§4.5 與 N2-architecture-decisions 決策卡 3(MCP vs 手刻)的方向性建議,把「要建什麼」寫到可以直接排 PR 的顆粒度。不重複 M3/N2 的診斷證據,只在需要新增實據處回引號來源。
- 實讀清單:`server/subsystems/contextPackets/{contracts.ts,connectionService.ts,adapters/external.ts}`、`drizzle/schema.ts`(`dataSourceConnections`/`userGoogleOauthTokens`)、`server/routers/{workflow.ts,webhook.ts}`、`server/services/webhookDispatcher.ts`、`server/config/orbToolRegistry.ts`、`server/services/agentToolExecutor.ts`(`OrbApiTool`/`requireConfirmation` 檢查邏輯)、`server/_core/{secretCrypto.ts,ssrfGuard.ts}`。另上網查證 MCP client SDK 現況與 Adobe/Canva/Notion 官方 MCP server 現況(見 §3)。
- 前置閱讀:M3-connectors-workflows(§2.3 自動化缺口、§4.4-4.5 MCP/orb 接法)、N2-architecture-decisions 決策卡 3(選項 3:混合路線,MCP 有則走 MCP、無則手刻 REST)、E-ai-agents §7(產品程式碼內無任何 MCP client 的既有結論)。

---

## 0. 範圍界定(避免與既有研究重複)

本文件**不重做**以下已有結論,直接引用:
- `DataSourceKind`/`ConnectionKind` 已在 `contracts.ts:43-60` 留位 `mcp`/`external_api`,但 `connectionService.ts:179-208` 的 `runHealthCheck` 只認得 `google_drive`/`notion` 兩個 `if` 分支,第三個分支不存在(N2 卡3、M3 §2.3 已證實)。
- 產品程式碼內零 `@modelcontextprotocol` 依賴(`package.json` grep 0 命中,E §7 已證實);`.mcp.json` 唯一的 `gitnexus` 是開發期工具,與產品 runtime 無關。
- `user_workflows`(`workflow.ts`)是導演台步驟排序,不是 trigger→action 編排器——這是文案漂移,不是本文件要修的規格缺口(M3 §4.2 已定義修法)。
- `webhookRouter`/`webhookDispatcher.ts` 是全站 SSRF 防護最佳範例(建立時+每次送達時重驗 `assertSafeExternalUrlAsync`、`redirect:"error"`),本文件把它當作「自動化引擎第一版」與「MCP BYOMCP SSRF 防護」的**參照範本**,不重寫這套邏輯。

本文件新增的是:①MCP client 子系統的具體資料模型與呼叫流程;②Adobe/Canva/Notion 三家的最新官方 MCP 現況查證(N2 卡3 只給方向,未查證各家實際可用性);③`automation_rules` 表的完整欄位設計與執行點;④安全邊界收斂成可執行的檢查清單。

---

## 1. 本質對齊(承接 M3 §1)

「連自己的工具」與「建自己的自動化工作流」兩件事共用同一個信任邊界問題:**創作者的憑證/連線只能被創作者自己的執行路徑使用**。MCP client 子系統解決「連」的問題(認證+發現+呼叫),自動化引擎解決「串」的問題(事件→動作)。兩者的交會點是 §4.4(orb tool registry 的 per-user 候選)與 §4(automation_rules 的 `action_kind="call_mcp_tool"`)——但這個交會點刻意排在**最後一階段**,因為它同時疊加兩個新技術棧(MCP 協定 + 使用者自訂觸發規則)的風險,不應該第一次落地就疊加。

---

## 2. MCP client 子系統規格

### 2.1 要建什麼(四個子問題)

**(a) 連線(connection)**
新增 `server/services/mcpClient.ts`,以 `data_source_connections`(`kind="mcp"`)一筆記錄對應一個 MCP server 連線。`configJson` 新增欄位形狀(不改表結構,`configJson` 本來就是自由 json):

```ts
interface McpConnectionConfig {
  serverUrl: string;           // Streamable HTTP endpoint(如 https://mcp.canva.com/mcp)
  transport: "streamable_http"; // 第一版只支援 remote HTTP,不支援 stdio(stdio 是本機
                                 // 子行程模型,產品後端不该替使用者起本機行程)
  scopes?: string[];            // OAuth scope,若該 server 要求
}
```

連線建立走既有 `connectionService.createConnection` 流程,不需要新 procedure 形狀——`provider` 填 `"canva"`/`"adobe_firefly"`/`"notion_mcp"` 等具體值,`kind` 固定 `"mcp"`。

**(b) 工具發現(tool discovery)**
連線建立/健檢時呼叫 MCP `tools/list`,取得該 server 暴露的工具清單(name/description/inputSchema)。**新增一張輕量快取表** `mcp_tool_cache`(理由:每次都要即時 `tools/list` 會拖慢 orb 工具候選組裝,且多數 MCP server 的工具清單變動頻率低):

```ts
mcpToolCache: {
  id, connectionId (FK data_source_connections.id),
  toolName, description, inputSchemaJson,
  discoveredAt, // 用於判斷是否需要重新 tools/list(如 24h TTL)
}
```

**(c) 呼叫(tool invocation)**
`createMcpAdapter(connection)` 實作 `DataSourceAdapter.collect()`(進 context packet pipeline,比照 `adapters/external.ts` 現有的 Drive/Notion 範本),以及獨立的 `callMcpTool(connectionId, toolName, args, opts)`(進 orb tool 執行路徑,§2.3)。**第一版呼叫一律 read-only**:只允許 `tools/list` 回傳的工具中,語意判斷為唯讀的子集(名稱含 `list`/`get`/`search`/`read` 等啟發式,或由平台維護一份 provider 白名單——啟發式不可靠,建議**明確白名單優先**,啟發式只是輔助提示,不能單獨作為安全門檻)。寫入類工具(如「幫我編輯這個設計檔」)一律 `requireConfirmation=true`,呼應 §5。

**(d) 憑證**
複用 `secretCrypto.ts`(AES-256-GCM + keyId 版本化),OAuth access/refresh token 一律加密存 `encryptedCredentialRef`,**不要**照抄 `userGoogleOauthTokens` 表(`drizzle/schema.ts:548-568`)那樣把 `accessToken`/`refreshToken` 以明文 `text()` 欄位存放——這是既有程式碼裡的一個不一致(Drive OAuth token 明文存,Notion token 走 `secretCrypto` 加密),本文件的立場是**新 provider 一律走加密路徑**,不延續明文模式。Token 續期比照 `getValidDriveAccessToken` 的「過期自動用 refresh_token 換新」模式,寫一個 `getValidMcpAccessToken(connectionId)`,失敗時把 `status` 標 `"error"` 而非要求使用者重新整個授權流程。

### 2.2 per-user 擁有權

沿用 `connectionService.loadOwnedConnection` 既有模式(`connectionService.ts:68-78`):任何 MCP 工具呼叫前,先驗 `connection.ownerUserId === ctx.user.id`。**不建立**任何「團隊共用 MCP 連線給所有成員的光球用」的預設路徑——`data_source_connections` 雖然有 `teamId` 欄位可空,但 M3/N2 都沒有討論 team-shared MCP 連線的存取模型(誰能看到誰的 Adobe 帳號?),本文件建議**第一版只做 per-user**,team-shared 留待之後有需求再設計授權模型,避免在 MCP 這個新技術棧上又疊加一層未設計的多人存取語意。

### 2.3 與 orb tool registry 的接法

現況 `getOrbToolRegistry()`(`orbToolRegistry.ts:34-51`)是全站共用、讀 `ORB_TOOL_REGISTRY_JSON` 單一環境變數的靜態清單。接法:

1. 執行期組裝 orb 工具候選時,**額外**查詢「這個使用者」名下 `kind="mcp"` 或 `"external_api"` 且 `status="active"` 的 `data_source_connections`,把每筆連線的 `mcp_tool_cache` 條目轉成臨時 `OrbApiTool`(形狀比照 `agentToolExecutor.ts:264-277` 的 `OrbApiTool` 介面:`name`/`description`/`method`/`endpoint`/`riskLevel`/`allowedRoles`/`requireConfirmation`)——**但 MCP 工具沒有 `method`/`endpoint` 這種 REST 形狀**,需要给 `OrbApiTool` 增加一個 discriminated union 分支(`transport: "rest" | "mcp"`),`mcp` 分支帶 `connectionId`+`toolName`,執行時走 `callMcpTool` 而非既有的 `fetch(endpoint)` 邏輯。
2. 這批「per-user 動態工具」與 `ORB_TOOL_REGISTRY_JSON` 的「全站靜態工具」**分開合併**,不要混寫進同一個 env 變數或同一張快取——動態工具的生命週期跟著 connection 的啟停走,靜態工具跟著部署走,合併時機不同。
3. 執行前(呼應 §5):`connection.ownerUserId === opts.userId` 檢查 + `requireConfirmation` 檢查(`agentToolExecutor.ts:807` 已有 `if (tool.requireConfirmation && !opts.approved)` 的既有邏輯,直接沿用,不必重寫)。

### 2.4 SDK 選型(查證結果)

`@modelcontextprotocol/typescript-sdk`(GitHub `modelcontextprotocol/typescript-sdk`,npm 套件 `@modelcontextprotocol/sdk`)是官方 TypeScript SDK,同時提供 client 與 server 兩種角色,支援 `stdio` 與 `Streamable HTTP` 兩種 transport。查證時點(2026-07)存在版本分裂訊號:v1 是單一 `@modelcontextprotocol/sdk` 套件(`npm install @modelcontextprotocol/sdk zod`),有跡象顯示官方正把 v2 拆成 `@modelcontextprotocol/client`/`@modelcontextprotocol/server` 兩個獨立套件——**這是本文件唯一標記為「未查證清楚」的技術選型細節**(見文末),建議實作前直接查官方 repo 的 release notes 確認當下穩定版本是 v1 monolithic 還是已遷移 v2 split,避免選到即將棄用的套件形狀。產品後端只需要 **client** 角色(呼叫外部 MCP server),不需要 server 角色(不需要讓 healing-studio 自己變成一個 MCP server 給別人接,那是完全不同的需求,不在本波範圍)。

---

## 3. Adobe/Canva/Notion 接入路徑(逐家查證)

N2 決策卡 3 給的是方向性建議(「選項 3:混合路線,有官方 MCP 走 MCP,沒有就手刻 REST」),本節把方向落到三家具體現況:

| 供應商 | 官方 MCP 現況(2026-07 查證) | 建議走法 | 難度 |
|---|---|---|---|
| **Canva** | 有**官方 hosted 遠端 MCP server**:`https://mcp.canva.com/mcp`,OAuth2 動態客戶端註冊(DCR),涵蓋設計建立/編輯、資產與品牌管理、素材庫搜尋、匯出、留言等能力。這是 Canva 官方為第三方產品串接設計的正式端點,不是社群包裝。 | **走 MCP**。`configJson.serverUrl` 固定填官方端點,不必自架任何東西,connection 建立即是走 OAuth 授權碼流程,token 存 `encryptedCredentialRef`。 | **低**——不需自架 server,官方端點穩定,OAuth 流程標準化。是 M3 §4.5 建議「先接 Canva 的 read-only 我的設計清單」的最佳候選,本次查證進一步確認可行性高。 |
| **Adobe(Firefly/Express)** | 現況分裂,**需要區分兩層**:①`developer.adobe.com/express/add-ons` 的 **Adobe Express Developer MCP Server** 是官方的,但服務對象是「開發 Express add-on 的開發者」,提供的是文件與型別定義查詢,**不是**終端使用者可串接的產品 API 層。②Firefly/Photoshop/Lightroom 側查到多個「Firefly Services MCP」相關結果,但來源混雜(有 mcpmarket.com 這類第三方聚合站列表,也有 Adobe 自己的 Firefly Services API 文件),**本次查證無法 100% 確認是否存在一個 Adobe 官方維護、供第三方產品以 OAuth App 身份串接的 Firefly 生產級 MCP endpoint**(相對於 Canva 的 `mcp.canva.com` 那種明確單一官方端點)。 | **走 MCP 前先做一次確認性 spike**:直接查 Adobe Developer Console 是否有「Firefly Services」OAuth App 申請入口與對應的官方 MCP endpoint 文件(而非只看第三方聚合站列表)。若確認存在,走法同 Canva;若查證後發現目前只是 Firefly REST API + 社群/第三方包裝的 MCP wrapper(非 Adobe 官方 hosted),則**退回 Firefly Services 既有 REST API**手刻 adapter(Adobe 已有成熟的 Firefly REST API 文件,不是從零手刻)。 | **中-高**——即使確認有官方 MCP,Adobe 的認證面(多 scope、企業級 OAuth App 審核)本來就比 Canva 重,加上本次查證的不確定性,建議排在 Canva 之後、且先做業務層的 OAuth App 申請確認(M3 §4.5 已點名這是業務/法務流程,非工程排期)。 |
| **Notion** | 有**官方 hosted MCP server**(`developers.notion.com/docs/mcp`),18 個工具,涵蓋搜尋/讀取/建立/更新頁面。但有兩個關鍵限制:①**只操作 page 層級**(整頁抓取/整頁替換),**不提供 block 層級的 CRUD**(無法讀/改/刪單一 block);②官方文件明講「不是為無人值守的雲端 agentic workflow 設計」,預期有人在場完成 OAuth 授權。**現有 `adapters/external.ts` 的手刻 Notion adapter 反而做到 block 層級**(`fetchNotionPageText` 直接讀 `/v1/blocks/{id}/children`,`createNotionAdapter` 見 `external.ts:127-249`)——這比官方 MCP 的粒度更細。 | **維持現有手刻 REST,不換成官方 MCP**。這是三家裡唯一「已經是對的選擇,換了反而降級」的案例——換成官方 MCP 會讓現有 context packet 的 block 層級摘要能力倒退回 page 層級。若日後要支援 Notion 寫入(建立頁面/更新 database),再評估官方 MCP 是否覆蓋該需求,屆時是**新增**而非**取代**現有 read adapter。 | **低(維持現狀零成本)**——這裡的「難度」是「決定不做」的難度,不是技術難度。 |

**跨三家的共同結論**:MCP 不是「换了就一定更好」的單向升級——Notion 案例證明官方 hosted MCP 有時功能範圍比手刻 REST 窄(page vs block),選型要逐家看實際工具清單覆蓋面,不能只因為「有官方 MCP 標籤」就切換。

---

## 4. 創作者自動化工作流引擎(最小可用設計)

### 4.1 現況邊界重申(承接 M3 §2.3)

`user_workflows` 是「我的座艙工作流哪幾步驟顯示/順序」,`webhookRouter`/`webhookDispatcher.ts` 是「創作者自己的出站 webhook 訂閱」——兩者都不是 trigger→action 編排器。本節設計的是**新**的最小編排層,分兩步:

### 4.2 第一步:webhook 出站面板(最低風險起點)

零後端改動——`webhookRouter` 的 `list/create/update/delete/deliveryHistory/test` 已完整可用,只缺 `/settings` 的一個面板呼叫它(M3 §4.3 第一版已定義,本文件不重寫,直接列為 Phase 0,見 §6)。

### 4.3 第二步:`automation_rules` 表(trigger→action 編排器雛形)

**是否要用既有 `automation_rules` 概念?** 本 repo 內**沒有**任何既有 `automation_rules` 表或路由(grep 確認 0 命中)——K1/M3 提到的 `automation_rules` 都是**未來要新增**的建議名稱,不是既有資產。业界有類似設計可對照:本次任務環境掛載的 Era Context MCP 有 `transactions__manage_automation_rules` 工具,語意是「使用者定義的規則,交易匹配時自動清理/歸類/打標籤」——這是同一類「宣告式 trigger→action 使用者規則」設計模式的業界佐證,但 healing-studio 不需要照搬其欄位形狀(財務交易規則與創作事件規則的 trigger/action 詞彙不同),只是佐證這類模式在同類產品裡是常見、成熟的設計,不是本文件自創的冒險概念。

**最小 schema 設計**(新增一張表,零遷移既有表):

```ts
automationRules: mysqlTable("automation_rules", {
  id: int().autoincrement().primaryKey(),
  ownerUserId: int().notNull(),          // per-user 擁有權,比照 data_source_connections
  name: varchar(128),                     // 使用者自訂名稱
  triggerKind: mysqlEnum([                // 第一版:只認既有事件詞彙表
    "video.completed", "video.failed",    // 沿用 VALID_WEBHOOK_EVENTS
    // 之後擴充:"assets.upload", "teachingArchive.reingest_completed", ...(M3 §4.3 第二版)
  ]).notNull(),
  triggerConfigJson: json(),              // 第一版可留空(事件本身即是條件),未來若要
                                           // 加篩選條件(如「僅限某個 projectId」)存這裡
  actionKind: mysqlEnum(["call_webhook", "write_note"]).notNull(), // 第一版只給兩種
  actionConfigJson: json().notNull(),      // call_webhook: { subscriptionId }
                                            // write_note: { targetTable, template }
  enabled: boolean().default(true).notNull(),
  lastTriggeredAt: timestamp(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().onUpdateNow().notNull(),
})
```

**執行點**:`webhookDispatcher.dispatchWebhookEvent`(現況只对该 user 已註冊的 webhook 訂閱送達)是天然的事件扇出點——擴充邏輯為:事件發生時,①照舊查 `webhookSubscriptions` 送達;②**新增**查該 `userId` 名下 `automation_rules`(`triggerKind` 符合、`enabled=true`),依 `actionKind` 執行對應動作。`actionKind="call_webhook"` 直接呼叫 `deliverDirectToSubscription`(現有函式,零重寫);`actionKind="write_note"` 寫一則到既有的某個記錄表(如 activity log 或 `teaching_materials` 的一則備註,具體落點留給實作時依當下需求決定,本文件只定義動作類型)。

**刻意不做的事**:不做 `actionKind="call_arbitrary_url"` 這種任意 HTTP 呼叫的通用動作(那就是在重造 Zapier/Make);不做「if-this-then-that 任意條件組合」的規則引擎(`triggerConfigJson` 第一版留空,不做條件运算子)。這與 M3 §4.3 第三版的立場一致:動作只在「創作系統」語意內(通知/落記錄),不擴大成泛用 iPaaS。

**與 MCP 的交會點(最後才做)**:`actionKind` 未來擴充 `"call_mcp_tool"`(`actionConfigJson: { connectionId, toolName, args }`)才是「自動化觸發外部工具」的完整閉環——但這必須排在 §2 的 MCP client 子系統穩定之後,且執行前**強制** `requireConfirmation`(呼應 §5),不可讓一條自動化規則在背景無人值守情況下對外部工具做寫入動作。

---

## 5. 安全邊界(逐項落地檢查清單)

1. **憑證加密**:MCP OAuth token(access/refresh)一律走 `secretCrypto.ts` 加密存 `encryptedCredentialRef`,**不比照** `userGoogleOauthTokens` 明文 `text()` 欄位模式(§2.1(d) 已指出這個既有不一致,新 provider 不要延續它)。Token 續期比照 `getValidDriveAccessToken` 的自動刷新設計。
2. **SSRF——兩個獨立面**:
   - **BYOMCP server URL**(若日後開放使用者自訂任意 MCP server,而非只用官方固定端點):連線建立時 + **每次 `tools/call` 前**都要過 `assertSafeExternalUrlAsync`(比照 `webhookDispatcher.ts:113,159` 的雙重重驗模式,不可只在建立時驗一次),且 `redirect:"error"`、只允許 https、非私網位址。這是為了防止 K1 已指出的「orb tool registry 缺網域白名單」反面案例在 MCP 這個新入口重演。
   - **官方固定端點**(如 `mcp.canva.com`):風險本質上等同現有 Drive/Notion adapter 呼叫固定官方 API 網域,SSRF 風險低,但仍建議 `configJson.serverUrl` 若允許編輯,同樣過 SSRF 檢查(防止未來不小心開放成可編輯欄位卻忘了補檢查)。
3. **Per-user 工具擁有權**:任何 MCP 工具呼叫(不論是走 context packet 的 `collect()` 還是走 orb tool registry 的 `callMcpTool`)前,先驗 `connection.ownerUserId === ctx.user.id`(比照 `loadOwnedConnection`,§2.2)。**不可**讓 A 使用者的光球意外呼叫到 B 使用者連接的 Canva/Adobe 帳號。
4. **寫入類強制 `requireConfirmation`**:`OrbApiTool.requireConfirmation` 欄位與 `agentToolExecutor.ts:807` 的檢查邏輯已存在,新增規則:
   - 任何從 MCP `tools/list` 判定/白名單標記為「寫入」的工具,`requireConfirmation` 一律 `true`,不可由 planner 自動連續呼叫。
   - `automation_rules.actionKind="call_mcp_tool"`(§4.3 交會點)一旦啟用,同樣**強制** `requireConfirmation=true`——即使規則是使用者自己設定的「觸發時自動執行」,寫入類外部呼叫仍需要一個人審核步驟(可以是「規則啟用時的一次性確認」,而非「每次觸發都跳出確認」,兩者選一,但不可完全無審核)。
   - 呼應既有保守設計精神(00-summary R10、E 波「多代理協作只有 lead 真執行」):能力要慢慢開,MCP 寫入動作不應該是第一版就開放的能力。
5. **平台級網域白名單疊加**:`ORB_TOOL_ALLOWED_ORIGINS`(env,值未知,00-summary §4.1 已列出待補)應該擴充涵蓋 MCP 官方端點網域(如 `mcp.canva.com`),per-user 自訂連線不代表可以繞過平台整體的目的地白名單。

---

## 6. 分階段路線

**Phase 0(最低風險,1-2 週,零新資料表)**——重申 M3 §5 第 0 階段:
- `/settings` 新增 Webhook 自動化面板,接現有 `webhookRouter`(零後端改動)。
- 這一步**不涉及**本文件 §2-4 的任何新設計,純粹是把既有後端接上前端。

**Phase 1(1 個月內,零 MCP 依賴)**
- 新增 `automation_rules` 表(§4.3),`actionKind` 只給 `call_webhook`/`write_note` 兩種,執行點掛在 `webhookDispatcher` 的事件扇出邏輯旁。
- 擴充 `VALID_WEBHOOK_EVENTS`(納入資產/教材事件,M3 §4.3 第二版)。
- **此階段完全不需要 MCP client 子系統**——這是刻意排序:自動化引擎的「串」可以先於「連自己的工具」的「連」落地,兩者不互相阻塞。

**Phase 2(1-2 個月,MCP client 子系統雛形)**
- 新增 `server/services/mcpClient.ts` + `@modelcontextprotocol/sdk` 依賴(先確認 §2.4 的版本選型)。
- `data_source_connections` 新增真實 `provider="canva"`,`connectionService.runHealthCheck` 補 MCP 分支(呼叫 `tools/list` 作健檢)。
- 新增 `mcp_tool_cache` 表(§2.1(b))。
- `createMcpAdapter` 進 context packet pipeline,**唯讀白名單**,對齊 Drive/Notion adapter 的「參照層級」原則。
- **先接 Canva**(§3 已確認官方端點明確、OAuth 阻力最低),不是 Adobe——這是本文件對 M3 §4.5 建議的具體化(M3 只說「建議先做 Canva」,本文件補上查證依據)。

**Phase 3(2-3 個月,擴大與交會)**
- Adobe 接入(前提:業務/法務確認 OAuth App 申請 + 工程 spike 確認是否真有官方 Firefly MCP endpoint,§3 已標記此為查證缺口)。
- MCP 工具接進 orb tool registry 的 per-user 候選(§2.3)。
- `automation_rules.actionKind` 擴充 `call_mcp_tool`(§4.3 交會點),**寫入類強制 requireConfirmation**(§5)。
- Notion 維持現狀,不動(§3 已定案)。

---

## 附:本文件未涵蓋 / 查不到的項目

1. **Adobe Firefly Services MCP 的官方性質未能 100% 確認**——查證時只看到 Adobe 官方文件(Firefly Services API 文件本身)與多個第三方聚合站(mcpmarket.com 等)並列,無法單一確認「是否存在一個 Adobe 官方維護、給第三方產品 OAuth App 身份串接的 Firefly 生產級 MCP endpoint」(相對 Canva `mcp.canva.com` 的明確單一官方端點)。建議實作前直接查 Adobe Developer Console 確認,而非只信任本次網路搜尋結果。
2. **`@modelcontextprotocol/sdk` 的 v1(monolithic)vs v2(拆成 `@modelcontextprotocol/client`/`server`)何者是實作時的穩定版本**——查證時點看到兩者並存的訊號,建議實作前查官方 GitHub release notes 確認。
3. **team-shared MCP 連線的授權模型**——本文件刻意排除(§2.2),留待有實際需求時再設計「團隊共用一個 Adobe 連線,誰能用」的存取規則。
4. **`automation_rules` 的前端 UI 設計稿**——本文件只定義後端資料模型與執行點,UI 排版留給設計端(design-kit 元件選用)。
5. **MCP 連線池 / 多 server 並發健檢的效能細節**——`mcp_tool_cache` 的 TTL 策略只給方向(建議 24h),未定義精確的快取失效/背景刷新排程機制。
6. **Adobe/Canva OAuth App 的商務申請流程**——超出工程範圍,M3/N2 已點名,本文件不重複。
