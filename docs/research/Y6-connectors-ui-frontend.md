# Y6 — 連接器 UI 前端深挖(北極星②)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:client/src/components/connectors/(整個目錄)、以及設定頁中連接器相關區塊

> 稽核方法:先讀完 `client/src/components/connectors/` 全部 4 個檔案(`ConnectorsPanel.tsx`
> `connectorsTypes.ts` `connectorsFlags.ts` `index.ts`)與其測試,再逐一追蹤「設定頁連接器
> 相關區塊」的真正落點(`client/src/shells/settings/SettingsHome.tsx` → `panels/ConnectionsPanel.tsx`),
> 以及 north-star②(連自己的工具)在 `/create` 流程與 `/assets` 資產庫的另外兩個實作面
> (`components/create/TeamDataSourcesPanel.tsx`、`components/DriveLibrarySection.tsx`)。
> 每個 client 呼叫的 tRPC procedure 皆回 `server/subsystems/contextPackets/contextPacketRouter.ts`、
> `server/subsystems/contextPackets/connectionService.ts`、`server/subsystems/contextPackets/adapters/external.ts`、
> `server/subsystems/contextPackets/contextPacketService.ts`、`server/routers/drive.ts`、`server/db.ts`、
> `drizzle/schema.ts` 逐一核對是否存在、欄位是否相符,不只看 client 端的宣稱。
> 本報告延續並實測驗證 `docs/research/M3-connectors-workflows.md`(方案設計,已先點出「三層分裂」)
> 的診斷,聚焦本次任務指定的兩個目錄;深層安全細節(OAuth 明文儲存、SSRF 等)已由
> `docs/research/X10-connectors-deepdive.md` 涵蓋,本報告不重複,僅在必要處交叉引用。
> **本報告不輸出任何真實密鑰/token 值。**

---

## 一、發現清單(依嚴重度排序)

### 1.〔CRITICAL · dead-ui〕`client/src/components/connectors/` 整目錄是 100% 孤兒元件,從未被任何路由/頁面掛載

- **檔案:行號**:`client/src/components/connectors/ConnectorsPanel.tsx:1-317`、
  `connectorsTypes.ts:1-157`、`connectorsFlags.ts:1-47`、`index.ts:1-9`。
- **證據**:全站(`client/src/` 與 `docs/`)grep `ConnectorsPanel` 只命中 4 個結果——
  `ConnectorsPanel.tsx` 自身、`index.ts`(barrel export)、`ConnectorsPanel.test.tsx`(自己的測試)、
  以及 `docs/research/M3-connectors-workflows.md`(先前的方案設計文件討論它)。沒有任何
  `App.tsx`、`SettingsHome.tsx`、或其他頁面 import 這個元件。
  同樣地,`connectorsFlags.ts:40` 定義的
  `export const CONNECTORS_PANEL_ENABLED: boolean = readFlag("VITE_CONNECTORS_PANEL", false);`
  全站 grep `CONNECTORS_PANEL_ENABLED` 只命中定義處本身與 M3 文件——**沒有任何程式碼讀取
  這個旗標**,包括 `ConnectorsPanel.tsx` 自己都沒 import 它(它只 import 了同檔的
  `CONNECTORS_BYOMCP_ENABLED`,見 `ConnectorsPanel.tsx:43`)。
  檔頭註解(`ConnectorsPanel.tsx:1-11`)自稱是「AI Director · 連接器／個人資料庫 5 類治理面板
  (/settings/connections＋ACL＋BYOMCP)」且「rev. U-12 · 2026-06-17」,`connectorsFlags.ts:8-11`
  更明講「由 settings 殼明確開啟(VITE_CONNECTORS_PANEL=1)後才掛載 /settings/connections
  入口」——但實際上 `/settings` 的「連接器」分頁(`SettingsHome.tsx:74`)掛載的是完全不同的
  `client/src/shells/settings/panels/ConnectionsPanel.tsx`,兩者只是名字相似(Connectors vs
  Connections),沒有任何 import 關係。`.env`/部署文件全站 grep `VITE_CONNECTORS_PANEL` 也
  查無任何實際設定紀錄(只出現在 M3 討論文字裡)。
- **影響**:這是北極星②(連結自己的工具)投入的一整層 UI 骨架(5 類分組卡片、狀態
  dot、健康 Pill、ACL 角色可見性 Toggle、四態出口、完整 a11y 標記、7 條行為測試)完全
  沒有任何終端使用者路徑可達——不是「旗標關閉隱藏」,而是連掛載點都不存在。測試套件
  (`ConnectorsPanel.test.tsx`)全綠會讓團隊誤以為這塊功能「已完成、只是還沒開」,但實際
  上它連「開」的開關都接不到任何真實入口,是完全獨立於產品之外的一份重複投資。
- **建議**:比照 M3 §4.1 建議 (a)——直接刪除 `components/connectors/` 整目錄與
  `VITE_CONNECTORS_PANEL`/`VITE_CONNECTORS_BYOMCP` 兩個旗標定義,因為其分類體系
  (`model/storage/source/byomcp/vault`)與真後端 `kind`(`cloud/notes/mcp/external_api`)
  不一致(見發現 6),勉強復用視覺只會製造新的認知負擔;若要保留視覺質感,需整段改造
  成 `ConnectionsPanel.tsx` 的真實資料渲染層,而非維持兩套並存。

---

### 2.〔CRITICAL · northstar-flow / contract-mismatch〕「連結 Google Drive」在 client 端有兩套完全獨立、互不同步的資料模型與 UI,使用者在一處連接後,另一處看不到

- **檔案:行號**:
  - `client/src/components/create/TeamDataSourcesPanel.tsx:126-129,257-294`(呼叫
    `trpc.dataConnections.list/create`,kind="cloud", provider="google_drive",
    `config.folderIds`)
  - `client/src/shells/settings/panels/ConnectionsPanel.tsx:28,42,53-54`(同樣讀
    `trpc.dataConnections.list({})`,以 `kind` 過濾出「Google 雲端」分類)
  - `client/src/components/DriveLibrarySection.tsx:59-64,284-345`(呼叫
    `trpc.drive.status/listLibraries/addLibrary`,完全不同的「素材庫」概念)
  - 後端兩張互不相關的表:`drizzle/schema.ts:3889-3901`(`dataSourceConnections`,
    `kind: cloud/notes/mcp/external_api`)vs `drizzle/schema.ts:578-597`
    (`driveAssetLibraries`,`kind: shoot/personal/other`,只認 `driveFolderId`);
    對應 CRUD 分別是 `server/subsystems/contextPackets/connectionService.ts:90-153`
    (`createConnection/listConnections`)vs `server/db.ts:1804-1831`
    (`getDriveLibrariesByUser/createDriveLibrary/deleteDriveLibrary`)。
- **證據**:
```ts
// client/src/components/create/TeamDataSourcesPanel.tsx:270-286 —
// /create 流程「新增 Google Drive 資料夾」,寫進 dataSourceConnections
onClick={() =>
  create.mutate(
    {
      kind: "cloud",
      provider: "google_drive",
      projectId,
      config: { folderIds: driveFolders.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) },
    },
    ...
```
```ts
// client/src/components/DriveLibrarySection.tsx:79-84,289-297 —
// /assets 資產庫「釘選為素材庫」,寫進 driveAssetLibraries(完全不同的表)
const removeLibrary = trpc.drive.removeLibrary.useMutation(...);
...
const add = trpc.drive.addLibrary.useMutation({
  onSuccess: data => { toast.success(`已加入素材庫「${data.driveFolderName || label}」`); ... }
});
```
```ts
// server/routers/drive.ts:36-38,80-87 — listLibraries/addLibrary 讀寫的是 db.getDriveLibrariesByUser /
// db.createDriveLibrary(driveAssetLibraries 表),與 dataConnections 完全無交集
listLibraries: protectedProcedure.query(async ({ ctx }) => db.getDriveLibrariesByUser(ctx.user.id)),
...
const id = await db.createDriveLibrary({ userId: ctx.user.id, label: input.label, kind: input.kind, driveFolderId: folderId, driveFolderName: folderName });
```
  兩套機制共用同一份 Google OAuth 授權狀態(都靠 `getValidDriveAccessToken(userId)` 讀
  `userGoogleOauthTokens`,見 `connectionService.ts:183-185` 與 `drive.ts:56,106`),但「哪些
  資料夾被連了」這件事完全各自記帳、互不查詢對方的表。
- **影響**:創作者若先在 `/assets` 資產庫授權 Google 並釘選「外拍」資料夾為素材庫,
  之後到 `/create` 流程的「團隊資料/資料來源」想把同一個資料夾接進生成用的 context
  packet,畫面上「尚未連接外部來源」(`TeamDataSourcesPanel.tsx:220-222`)——完全看不到
  剛才連過的資料夾,必須重新貼一次資料夾 ID 才能建立第二筆(在另一張表的)記錄。反過來,
  在 `/create` 流程新增的 Drive 連接,也不會出現在 `/assets` 的「我的素材庫」清單裡。
  這正是北極星②「連結自己的工具」最基本的信任假設被打破的地方:使用者的直覺是
  「Drive 只連一次,到處都看得到」,但實際上有兩套彼此陌生的簿記系統,造成「明明連過
  卻要重連」的困惑與重複輸入資料夾 ID 的摩擦。
- **建議**:短期在兩個 UI 之間互相顯示對方的清單(至少唯讀提示「你在 XX 頁已釘選 N 個
  資料夾」);中期把 `driveAssetLibraries` 收斂進 `dataSourceConnections`(例如把
  folder 清單存進同一筆 `kind=cloud` connection 的 `configJson.folderIds`,`driveAssetLibraries`
  的 `label/kind(shoot/personal/other)` 欄位可以疊加在 `dataSourceConnections.configJson`
  裡,不必維持兩張表)。

---

### 3.〔HIGH · northstar-flow〕「新增連接」的唯一入口被鎖在 `/create` 流程、需先有作用中專案才能到達;`/settings` 的連接器頁完全唯讀且無實際導引

- **檔案:行號**:
  - `client/src/shells/settings/panels/ConnectionsPanel.tsx:44-51`(只掛
    `dataConnections.test`/`dataConnections.setStatus` 兩個 mutation,**沒有** `create`)
  - `client/src/shells/settings/panels/ConnectionsPanel.tsx:151-156`(明講「新增連接於建立
    流程進行(不在此收金鑰)」,但沒有任何連結/按鈕導去該流程)
  - `client/src/shells/settings/panels/ConnectionsPanel.tsx:130`(空狀態 hint
    「從建立流程連上後在此治理」,同樣是純文字、非可點擊 CTA)
  - `client/src/components/create/ActiveProjectContextPanel.tsx:46,322`(`TeamDataSourcesPanel`
    只在此處被掛載,**必須帶入** `summary.projectId`,亦即必須已有一個作用中的創作專案)
- **證據**:
```tsx
// client/src/shells/settings/panels/ConnectionsPanel.tsx:151-156
{buildable && (
  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
    <Lock className="h-3 w-3" />新增連接於建立流程進行（不在此收金鑰）
  </div>
)}
```
```tsx
// client/src/components/create/ActiveProjectContextPanel.tsx:322
<TeamDataSourcesPanel projectId={summary.projectId} />
```
  `TeamDataSourcesPanel` 的 props 是必填的 `projectId: number`(`TeamDataSourcesPanel.tsx:37`),
  且只有 `ActiveProjectContextPanel.tsx:322` 這一處掛載它——換言之,一個剛註冊、還沒建立
  任何創作專案的使用者,**沒有任何頁面**能讓他建立 Notion/Drive 連接;他得先跑完「開一個
  專案」的流程,才能碰到唯一的「新增連接」表單。而 `/settings` 頁面雖然名為「連接器 /
  個人資料庫」治理入口,卻只能管理已存在的連接(測試/啟停),看到空清單時只給一句
  純文字提示,沒有 `<Link>`/按鈕帶他去 `/create`。
- **影響**:直接命中北極星②「連結自己的工具」的第一步——這條路徑的發現性極差:
  使用者要嘛湊巧先開一個專案才會撞見這個表單,要嘛在 `/settings` 卡住只看到文字提示卻
  不知道「建立流程」具體是哪個網址/按鈕。這也解釋了為什麼會出現發現 1 那個孤兒 mock
  面板——當初的設計意圖顯然是想在 `/settings/connections` 提供一個獨立、不依賴專案的
  治理入口(`ConnectorsPanel.tsx` 檔頭註解明講「/settings/connections」),但視覺骨架做完後
  從未真正接上「新增連接」表單,真正能新增的入口反而留在專案內部,兩頭都不完整。
- **建議**:M3 §4.1-2 已給出具體路徑——把 `TeamDataSourcesPanel.tsx` 的
  `DataConnectionsSection` 抽成共用元件,`projectId` 傳 `null`(`CreateConnectionInput.projectId`
  本來就是 optional,見 `contracts.ts:135`),掛進 `/settings` 的 `ConnectionsPanel.tsx`,
  讓使用者不必先開專案就能連 Notion/Drive;同時把現有的純文字 hint 換成真正可點擊的
  `<Link href="/create">`。

---

### 4.〔HIGH · uiux-defect〕「其他 MCP 工具」分類文案宣稱只差「權限/稽核表待建」,實際上整條建立與收集管線都不存在,文案低估真實缺口

- **檔案:行號**:
  - `client/src/shells/settings/panels/ConnectionsPanel.tsx:30`(
    `{ id: "mcp", ..., desc: "自帶 MCP 連接", pending: "權限/稽核表待建（M5）" }`)
  - `client/src/components/create/TeamDataSourcesPanel.tsx:155-294`(`DataConnectionsSection`
    的建立表單只有「新增 Notion」與「新增 Google Drive 資料夾」兩組輸入,**沒有任何**
    可以建立 `kind="mcp"` 連接的欄位)
  - `server/subsystems/contextPackets/connectionService.ts:179-208`(`runHealthCheck` 只認
    `google_drive`/`notion` 兩個 provider,其餘一律 `return false`)
  - `server/subsystems/contextPackets/contextPacketService.ts:64-108`(`getEnabledAdaptersForProject`
    只 push `createDriveAdapter`/`createNotionAdapter`,`mcp` 完全沒有對應分支;第 68 行
    註解自己承認「mcp 留待後續里程碑」)
  - `server/subsystems/contextPackets/adapters/external.ts:1-249`(全檔只有 Drive/Notion
    兩個 adapter,無 `createMcpAdapter`)
- **證據**:
```ts
// server/subsystems/contextPackets/contextPacketService.ts:64-68
/**
 * 某 project 啟用中的資料來源 adapters：team_data 永遠在，AIDV-303 專案上下文
 * 來源（worldbuilding / character / scene / continuity；唯讀既有表）永遠在，
 * 外加該使用者已連接且 status=active 的外部來源（cloud Drive / notes Notion）。
 * mcp 留待後續里程碑。
 */
```
```ts
// server/subsystems/contextPackets/contextPacketService.ts:102-106 — 逐一比對 kind/provider,
// mcp 完全沒有對應分支，等同永遠被略過
if (conn.kind === "cloud" && conn.provider === "google_drive") {
  adapters.push(createDriveAdapter(conn, level));
} else if (conn.kind === "notes" && conn.provider === "notion") {
  adapters.push(createNotionAdapter(conn, level));
}
```
  即使有辦法透過其他管道(例如未來的 admin 工具)手動塞一筆 `kind="mcp"` 的
  `dataSourceConnections` 資料列,`testConnection` 也會因為 `runHealthCheck` 認不得該
  provider 而永遠回傳 `false`→狀態變成 `"error"`(`connectionService.ts:170-176`),且該
  connection 永遠不會被 `contextPacketService` 收進任何 context packet。
- **影響**:`ConnectionsPanel.tsx:30` 的 `pending: "權限/稽核表待建（M5）"` 這句文案,語意
  上暗示「BYOMCP 連接本身已經能建立/能用,只是治理層(權限、稽核紀錄)還沒做」——但
  實際落差遠大於此:(a) 使用者連建立這種連接的表單欄位都不存在,(b) 就算存在,健康檢查
  也一律判失敗,(c) 就算狀態是 active,收集管線也完全忽略它。這個分類卡片在真實產品裡
  會**永久停留在「尚未連接」空狀態**(`ConnectionsPanel.tsx:130` 的 `PanelEmpty`),因為
  沒有任何路徑能讓它離開這個狀態——是一個「看起來是待補、實際是整條路徑都不存在」的
  死分支(dead-ui),文案應該更精確地反映「M5 才開始做,含建立表單與收集器」而非只講
  「權限/稽核表」。
- **建議**:把 `pending` 文案改成如實描述現況,例如「MCP 連接尚未開放建立(含收集器,
  預計 M5)」,避免讓使用者或未來接手的工程師誤以為只是缺一張稽核表;若要縮小落差,
  最小可行是先做 `createMcpAdapter` 的骨架(哪怕先回空陣列)並在 `DataConnectionsSection`
  補一個「新增 MCP 連接」表單,讓分類卡片至少有機會脫離永久空態。

---

### 5.〔MEDIUM · uiux-defect〕Notion/Drive 連線失敗的錯誤回饋是死路:通用 toast 文字,無任何可操作的修復連結

- **檔案:行號**:
  - `client/src/components/create/TeamDataSourcesPanel.tsx:141-149`
  - `client/src/shells/settings/panels/ConnectionsPanel.tsx:44-47`
- **證據**:
```ts
// client/src/components/create/TeamDataSourcesPanel.tsx:141-149
const test = trpc.dataConnections.test.useMutation({
  onSuccess: c => {
    toast[c?.status === "active" ? "success" : "error"](
      c?.status === "active" ? "連接正常" : "連接無法使用，請檢查授權 / token"
    );
    invalidate();
  },
  onError: e => toast.error(e.message || "驗證失敗"),
});
```
  同一個檔案第 291-293 行雖然提示「Drive 需先在『資產庫』完成 Google 授權」,但這段文字
  只出現在**建立表單旁**的靜態說明,不會在「驗證」失敗當下重新顯示或連結過去——使用者
  按下「驗證」得到的是一句「請檢查授權 / token」的通用 toast,沒有任何按鈕/連結能直接
  帶他去 `/assets` 完成 Drive OAuth,或聚焦到 Notion token 輸入框重新輸入。
- **影響**:對照發現 2、3——使用者原本就要跨兩三個頁面才能拼湊出「怎麼連 Drive」的完整
  流程,一旦驗證失敗,錯誤訊息本身又不提供下一步該去哪,體驗上是三重打擊(先找不到入口
  →連了以後在其他頁面看不到→驗證失敗也不知道去哪修)。
- **建議**:`test` mutation 的 `onSuccess` 分支依 `c.status`/`c.provider` 給不同的可操作
  提示——`provider==="google_drive" && status!=="active"` 時附一個連去 `/assets` 的連結;
  `provider==="notion"` 失敗時提示「請確認 token 是否已於 Notion 內授權此 workspace 存取
  頁面」並保留輸入框供重新輸入(目前 `notionToken` 在建立成功後會被清空,但驗證失敗時
  不會回填方便重試)。

---

### 6.〔MEDIUM · contract-mismatch〕孤兒 mock 面板的 ACL 模型與分類體系跟真實後端完全對不上——若日後真的把視覺「移植」進真實面板,會直接踩空

- **檔案:行號**:
  - `client/src/components/connectors/connectorsTypes.ts:22-30`(
    `AclRole = "owner"|"editor"|"viewer"`;`AclEntry { role, visible: boolean }`——
    逐角色的布林可見性開關)
  - `client/src/components/connectors/connectorsTypes.ts:15-20`(
    `ConnectorCategory = "model"|"storage"|"source"|"byomcp"|"vault"`)
  - 對照真實後端:`server/subsystems/contextPackets/contracts.ts:54-60`(
    `CONNECTION_KINDS = ["cloud","notes","mcp","external_api"]`)、
    `contracts.ts:62-69`(`ACCESS_LEVELS = ["none","summary_only","chunk_access","full_reference"]`,
    分級的存取層級,不是逐角色布林開關)、`server/subsystems/contextPackets/contextPacketRouter.ts:86-126`
    (`teamDataRouter.setProjectAccessRules`——規則綁定的是 `teamId + projectId + materialId`,
    不是「connector × role」)
- **證據**:
```ts
// client/src/components/connectors/connectorsTypes.ts:26-30 — mock 面板的 ACL 形狀
export interface AclEntry {
  role: AclRole;
  /** 該角色是否可見此連接器（純視覺 Toggle，唯讀回呼）。 */
  visible: boolean;
}
```
```ts
// server/subsystems/contextPackets/contracts.ts:62-69 — 真實系統的存取層級模型
export const ACCESS_LEVELS = ["none","summary_only","chunk_access","full_reference"] as const;
```
  兩者語意完全不同：mock 面板假設的是「每個連接器對 owner/editor/viewer 三種角色各自
  有一個可見/不可見布林開關」,而真實系統的存取控制是「以 team+project+material(或
  connection)為單位的四階存取層級」,且從未以「角色可見性」的形式呈現——`ConnectionsPanel.tsx`
  的「存取範圍 ACL」卡片(`ConnectionsPanel.tsx:92-101`)本身也標「全站編輯器待接」,
  代表連真實系統都還沒有一個「逐連接器 × 角色」的治理 UI 可以對照。
- **影響**:M3 §4.1 選項 (b)(把 mock 視覺元件移植進真實面板)如果被採納,`AclRow`/
  `ConnectorCard` 目前的 props 形狀(`AclEntry[]`)在真實資料源下找不到任何後端欄位可以
  餵——工程師會被迫要嘛重新設計一套「connector 級 ACL」後端(目前完全不存在),要嘛
  把視覺硬套在語意不同的 `accessLevel` 上,兩者都不是「純視覺搬遷」能解決的,值得在
  規劃收斂時明確排除選項 (b),直接採 (a) 刪除。
- **建議**:同發現 1 建議——刪除孤兒面板;若團隊仍想保留其卡片式視覺語言,應以真實
  `DataConnectionView`(`contracts.ts:182-196`)與 `ProjectAccessRuleView`
  (`contracts.ts:169-179`)的實際欄位形狀重新設計元件 props,而非沿用 `connectorsTypes.ts`
  的 mock 型別。

---

### 7.〔MEDIUM · uiux-defect〕「個人資料庫 / vault」一詞在三處程式碼中各自指涉不同概念,容易造成理解混淆

- **檔案:行號**:
  - `client/src/components/connectors/connectorsTypes.ts:144-156`(mock 面板的
    `vault` 分類,`id: "vault-me"`,`name: "個人資料庫"`,`detail: "角色 · 提示 · 偏好"`)
  - `client/src/shells/settings/panels/ConnectionsPanel.tsx:31`(
    `{ id: "internal", label: "內部資料庫", kind: null, desc: "每人 10G 個人庫", pending: "每人 10G 待建" }`)
  - `server/routers/vault.ts`(獨立、**已上線**的一致性保險庫,`itemType: "character"|"scene"`,
    供 `ConsistencyVault.tsx` 消費——與前兩者語意完全無關,詳見
    `docs/research/X10-connectors-deepdive.md` 對 `vault.ts` 的逐行稽核)
- **證據**:
```ts
// client/src/components/connectors/connectorsTypes.ts:144-156
{
  id: "vault-me",
  name: "個人資料庫",
  category: "vault",
  ...
  detail: "角色 · 提示 · 偏好",
  ...
}
```
```tsx
// client/src/shells/settings/panels/ConnectionsPanel.tsx:31
{ id: "internal", label: "內部資料庫", icon: Database, kind: null, auth: "平台內建",
  desc: "每人 10G 個人庫", pending: "每人 10G 待建" },
```
  三處分別代表:(a) mock 面板裡「角色/提示/偏好」性質的個人配置庫(純視覺,無任何
  後端佐證,全站 grep 找不到對應資料表);(b) `ConnectionsPanel.tsx` 裡「每人 10G」的
  結構化個人儲存空間(M3 §2.1 已確認 `kind: null`,後端表完全不存在,只是待接 pill);
  (c) `vault.ts` 的一致性保險庫(角色/場景參考圖,**真實已上線**,與「連接器/資料庫」
  這個 M 系列語意上完全是兩回事)。三者共用「vault」/「個人資料庫」字面,但沒有任何一個
  文件或程式碼註解把三者的邊界講清楚。
- **影響**:對後續接手這塊功能的工程師或設計師而言,單靠字面(「個人資料庫」「vault」)
  容易誤以為三處在講同一件事、或誤以為其中一處已有的後端(如 `vault.ts`)可以直接拿來
  填另一處的空缺(如 ConnectionsPanel 的「內部資料庫」)——但 `vault.ts` 的資料模型
  (`name/itemType/imageUrl/tags`)完全無法承載「10G 個人檔案儲存」或「角色/提示/偏好
  配置庫」的需求。
- **建議**:待規劃「每人 10G 個人資料庫」時,明確在文件/命名上與 `vault.ts`(建議之後
  改稱「一致性保險庫」或維持現有 `ConsistencyVault` 命名,避免再用「vault」單獨指稱)
  及 mock 面板的「vault」類別區分開來;若採納發現 1 的刪除建議,mock 面板這個混淆源會
  直接消失。

---

## 二、已驗證排除的疑慮(Negative Results)

以下項目經逐行核對後,**未發現**任務關注的問題,列出以避免報告只有壞消息:

1. **`dataConnections` 的 list/test/setStatus/create/delete 五個 procedure 皆真實存在**,
   非幻覺端點:`server/subsystems/contextPackets/contextPacketRouter.ts:128-205` 逐一對應
   client 端 `ConnectionsPanel.tsx:42,44,48` 與 `TeamDataSourcesPanel.tsx:126,134,141,150`
   的呼叫簽章(欄位名稱、型別皆相符),不存在 client 端呼叫不存在端點的情形。
2. **`/settings` 連接器頁的 `list({})` 呼叫不會漏掉專案綁定的連接**:
   `server/db.ts:3678-3700` 的 `listDataSourceConnectionsForUser` 在 `projectId == null` 時
   回傳「該 owner 的全部連接」(不分是否綁定某個 project),因此在 `/create` 流程建立的
   專案級連接,一樣會出現在 `/settings` 的治理頁——曾懷疑的「專案級連接在 Settings 消失」
   假設經核對程式碼**不成立**。
3. **Notion/Drive 憑證從未回傳前端**:`connectionService.ts:50-66` 的 `toConnectionView`
   明確排除 `encryptedCredentialRef`,`server/subsystems/contextPackets/contracts.ts:182-196`
   的 `DataConnectionView` 型別本身也沒有 credential 欄位;`testConnection`/`listConnections`
   的回傳物件實測皆符合此形狀。
4. **`ConnectionsPanel.tsx` 對「本機檔案」「內部資料庫」標示的「待建」文案是誠實的,
   不是誇大或隱瞞**:全站 grep 確認這兩類真的沒有對應後端資料表(`local`/`internal`
   分類的 `kind: null`,`ConnectionsPanel.tsx:27,31`),與 `M3-connectors-workflows.md §2.1`
   的既有結論一致,不構成「文案謊稱」。
5. **`ProjectAccessRulesPanel.tsx` 呼叫的 `teamData.setProjectAccessRules`/
   `listProjectAccessRules` 確實存在且邏輯相符**(`contextPacketRouter.ts:86-126`),
   `ConnectionsPanel.tsx:97-100` 對「全站級總覽待接」的說明準確——目前確實沒有任何
   UI 以 `projectId: null` 呼叫這兩支 procedure 做「全站」層級的規則總覽,待接標示屬實。
6. **`ENABLE_AIDV_CHROME`/`ENABLE_4SHELL` 視覺旗標分支不影響本報告發現的資料層問題**:
   `ConnectionsPanel.tsx` 的 `ConnectorRow`/`PendingPill`(`:162-198`)在旗標 ON/OFF 兩種
   視覺呈現下,呼叫的 `onTest`/`onToggle` 回呼與底層 `dataConnections` mutation 完全相同
   (`ConnectionsPanel.test.tsx:22-95` 兩分支皆驗證 `onTest`/`onToggle` 有觸發),純粹是
   視覺層 A/B,不構成本報告談的「三層分裂」問題,不重複列為發現。
7. **`CONNECTORS_BYOMCP_ENABLED` 旗標邏輯本身沒有寫錯**:`ConnectorsPanel.tsx:280-283`
   的分類過濾邏輯(`cat !== "byomcp" || CONNECTORS_BYOMCP_ENABLED`)語法正確、預設值安全
   (`connectorsFlags.ts:46` 預設 `false`);問題不在這段邏輯本身,而在發現 1 所述——整個
   元件從未被掛載,這段邏輯永遠不會被任何真實使用者路徑執行到。

---

## 三、小結

`client/src/components/connectors/` 目錄是一個測試齊全、a11y 標記完整,但**從未接上任何
路由**的孤兒視覺骨架,與 `/settings` 真正掛載的 `ConnectionsPanel.tsx` 只是名字相似
(Connectors vs Connections),資料模型(mock 的角色可見性 ACL vs 真實的四階存取層級)與
分類體系(`model/storage/source/byomcp/vault` vs `cloud/notes/mcp/external_api`)都對不上,
若不刪除,日後極可能被誤認成「已完成、待啟用」而被重複投資。

北極星②「連結自己的工具」在真實可達的路徑上,Drive/Notion 的後端(`connectionService.ts`
+ `adapters/external.ts`)是紮實的,但前端把「建立連接」鎖死在需要先開專案的 `/create`
流程裡,`/settings` 只有唯讀治理、沒有真正的新增入口與導引連結;更嚴重的是 Google Drive
本身在 `/assets` 資產庫另有一套完全獨立、不同資料表的「素材庫」連接機制,三個入口
(`/create`、`/settings`、`/assets`)互不知道彼此的存在,是本次任務要求核對的「三層分裂」
在實測後被進一步坐實、甚至在 Drive 這條線上發現了第四個不同步的資料模型。BYOMCP
(其他 MCP 工具)分類的「待補」文案則低估了真實缺口——不只是治理層待建,而是整條
建立表單、健康檢查、收集器 adapter 都不存在,這部分後端註解(`contextPacketService.ts:68`)
其實已誠實承認「留待後續里程碑」,落差主要出在前端 `ConnectionsPanel.tsx:30` 的 pending
文案沒有同步反映這個範圍。
