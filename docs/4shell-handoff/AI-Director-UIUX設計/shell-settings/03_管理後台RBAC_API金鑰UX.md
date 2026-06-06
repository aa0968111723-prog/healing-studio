# 03 · `/settings` 管理後台（RBAC）／ API 金鑰管理 UX — 逐頁規格

> 分頁 key：`admin`（僅 `role ≥ leader` 出現）｜canonical：`/settings/admin`、`/settings?sub=admin`、舊 `/admin` redirect
> 元件：`AdminPanel.tsx` + 5 子分頁（`UsersCreditsTab`/`ContentTab`/`FeatureFlagsTab`/`DataRepairTab`/`AuditTab`）。
> 設計系統：引用 `theme.css` §9（`.setrow`/`.toggle`）＋共用 §4–5。
> ⚠ **本規格只設計畫面；任何金鑰一律只顯示「是否已設定（isSet）」，絕不放真實金鑰、不提供前端輸入 secret 的欄位。**

---

## A. 管理後台容器（AdminPanel）

### ①畫面結構與佈局
- **整體門檻**：`roleAtLeast(role,'leader')`。不足→`.card` 置中閘門：`ShieldAlert` + 「需要管理員 / 組長權限」+「你目前角色為 **{role}**。管理後台僅對 leader / admin 開放。」（user 根本看不到此頂層分頁，此閘門是 deep-link 兜底。）
- **頭列**：`ShieldCheck`（`--ok`）+「管理後台」+ 角色 `.pill`{role} + 小字「管理使用者配額、角色權限、內容、功能開關、修復與稽核」。
- **子分頁列**（內層 `<Tabs>`，套 `.subtabs`）：依 `canSeeAdminTab(role, key)` 過濾顯示——

| 子分頁 key | 標籤 | 最低角色 |
|---|---|---|
| `users` | 使用者・積分 | leader |
| `content` | 內容 | admin |
| `flags` | 功能開關 | admin |
| `data-repair` | 資料修復 | admin |
| `audit` | 稽核 | admin |

- 預設選中＝可見清單第一個（leader 看到只有「使用者・積分」）。

### ②全狀態 / ④分支
- leader：只見「使用者・積分」一籤。admin：五籤全見。
- 子分頁切換為內層 state（非 `?sub=`，避免與頂層衝突；如需深連結可加 `?atab=`）。

### ⑤microcopy
「管理後台」｜閘門「需要管理員 / 組長權限」/「你目前角色為 {role}。管理後台僅對 leader / admin 開放。」｜頭列說明「管理使用者配額、角色權限、內容、功能開關、修復與稽核」。

---

## B. 使用者・積分（UsersCreditsTab）— leader 可看，改角色 admin 限定

> 對映盤點 §3-17 後台「使用者管理 / 成本金流」。**這頁真的能改**（配額、角色、自動給點）。

### ①畫面結構與佈局
單張 `.card.pad`：
- 標題列「`Users` 使用者 / 積分管理」＋右計數「{n} 位」（載入「…」）。
- 使用者列（`max-h-[28rem] overflow-auto divide-y`），每列（`flex flex-wrap items-center gap-2`）：
  - 左（flex-1）：名稱（`<b>`）+ 灰字「· {role}」；下方 email（truncate）。
  - 配額數字（`--gold` mono，w-16 右對齊 `tabular-nums`）。
  - `.btn.sm`(outline)「+500」、`.btn.sm`(outline)「-100」（調配額）。
  - 角色 `<select>`（user/leader/admin）——**`disabled={!isAdmin}`**＋tooltip（admin：「更改角色」／非 admin：「僅管理員可改角色」）。

### ②全狀態
- **載入**：5 條 `.skel`（h-12 rounded-lg）；計數「…」。
- **空**：「無使用者資料。」
- **錯誤/無權**（`usersQ.isError`）：行內 `ShieldAlert`+`--bad`「需要管理員權限。」
- **寫入中**：`quota.isPending || roleMut.isPending` → 下方 `Loader2`「寫入中…」；按鈕/下拉 disabled。
- **長內容**：`max-h-[28rem]` 內捲；`allUsers` 全量（未來可加搜尋/分頁）。
- **權限**：列表/配額 leader+；**改角色僅 admin**（leader 下拉 disabled）。底部對 leader 顯「你是 {role}：可看清單與調配額；更改角色（updateRole）為 admin 專屬。」

### ④分支與決策
- **調配額**：`adjust(u, ±delta)` → `next = max(0, current + delta)` → `admin.updateQuota({ userId, amount: next })`（絕對值，非增量）。成功 toast「已調整配額」+ `invalidate(allUsers)`。
- **改角色**：`admin.updateRole({ userId, role })`（僅 admin 可觸發）。成功「已更新角色」。
- 配額讀取容錯：`remainingGenerations ?? quota ?? credits ?? 0`。
- **自動給點**（leader+，建議補一塊）：`admin.updateAutoCreditPolicy({...})`/`admin.runAutoCreditNow()`——「自動給點政策」開關 + 「立即執行一次」按鈕（`leaderOrAdminProcedure`）。

### ⑤microcopy（zh-TW）
「使用者 / 積分管理」/「{n} 位」｜「+500」「-100」｜下拉 tooltip「更改角色」/「僅管理員可改角色」｜「無使用者資料。」｜「需要管理員權限。」｜「寫入中…」｜成功「已調整配額」/「已更新角色」｜失敗「配額調整失敗：{msg}」/「角色更新失敗：{msg}」｜leader 註「你是 {role}：可看清單與調配額；更改角色（updateRole）為 admin 專屬。」

### ⑥對回真實 route/procedure
- `admin.allUsers() → 使用者列`（**adminProcedure**）。
- `admin.updateQuota({ userId, amount }) → ok`（**adminProcedure**；**設定絕對配額**）。
  > ⚠ 校正：**非** `admin.adjustCredits`（不存在）；真名 `updateQuota`。
- `admin.updateRole({ userId, role }) → ok`（**adminProcedure**；`role: user|leader|admin`）。
  > ⚠ 校正：**非** `admin.toggleUser`；真名 `updateRole`。
- `admin.updateAutoCreditPolicy({...})`／`admin.runAutoCreditNow()`（**leaderOrAdminProcedure**，自動給點）。

---

## C. 功能開關（FeatureFlagsTab）— admin

> 對映模擬 admin「功能開關」。**兩層旗標，誠實標來源**（呼應 `00` §5.1 ENABLE_4SHELL 說明）。

### ①畫面結構與佈局
兩張 `.card.pad`：

**(1) 建置時旗標（唯讀）**：
- 標題「`Lock` 建置時旗標（唯讀）」＋右小字「來源：Vite env · 改需重 build」。
- 格列（`grid-cols-1 sm:grid-cols-3`）：每格＝mono key + `.pill`（ON secondary／OFF outline）。內容＝`@/config/featureFlags` 的 `FEATURE_FLAGS`：**`ENABLE_4SHELL`／`SHELL_SOCIAL`／`SHELL_LEARN`**（及其他建置時旗標）。**唯讀**——要改需改 `.env` 重 build。

**(2) 執行時功能開關（可即時切）**：
- 標題「`Flag` 執行時功能開關」＋右小字「settings.update · extraSettings.featureFlags」。
- 五條 `.setrow` + `.toggle`：

| key | 標題 | 說明 |
|---|---|---|
| `research` | 研究代理（Sonar+Brave） | /learn 研究面板開關 |
| `byomcp` | BYOMCP 自帶工具 | 開啟 /learn 的 API 金鑰／外部 MCP 入口（待建） |
| `ambient` | Ambient 氛圍 | 站台體驗開關 |
| `focusFlow` | FocusFlow 專注流 | 站台體驗開關 |
| `onboarding` | 意圖式進站（首頁） | 關閉則首頁直接進 /video |

- 底部小字：「註：站台級（全使用者）治理待 P3 把旗標來源移到 `system_settings`；目前 extraSettings 為使用者級草案。」

### ②全狀態
- **載入**：`getQ.isLoading`——執行時開關用 `extraSettings.featureFlags` 回填，未到前皆 off。
- **空**：無 extraSettings→全 off。
- **錯誤/無權**：`settings.update` 失敗→toast「更新失敗（需管理員）」，開關回彈。
- **寫入中**：`update.isPending` → 開關 disabled + 「寫入中…」。
- **權限**：本分頁僅 admin（`ADMIN_TAB_MIN_ROLE.flags=admin`）。

### ④分支與決策
- 建置時旗標**唯讀**：解釋 ENABLE_4SHELL 等需重 build；這正是「為什麼有執行時層」——日後把 `readFlag` 來源從 `import.meta.env` 換成 `system_settings`，**呼叫端不動**（`00` §5.1）。
- 執行時切換：`toggle(key)` → 寫 `settings.update({ extraSettings:{ featureFlags: {...next} } })`（樂觀更新本地 state，失敗回彈）。成功 toast「已更新功能開關」。
- 與其他 shell 聯動：`research` 影響 `/learn` 研究面板；`byomcp` 影響 `/learn` API 金鑰入口；`ambient`/`focusFlow`/`onboarding` 為站台體驗（脊椎讀）。

### ⑤microcopy（zh-TW）
「建置時旗標（唯讀）」/「來源：Vite env · 改需重 build」/格「ON」「OFF」｜「執行時功能開關」/「settings.update · extraSettings.featureFlags」｜五開關標題/說明（見表）｜「寫入中…」/「已更新功能開關」/「更新失敗（需管理員）」｜註「站台級（全使用者）治理待 P3 把旗標來源移到 system_settings；目前 extraSettings 為使用者級草案。」

### ⑥對回真實 route/procedure
- 建置時：`@/config/featureFlags` 的 `FEATURE_FLAGS`（`ENABLE_4SHELL`/`SHELL_SOCIAL`/`SHELL_LEARN`，**唯讀**）。
- 執行時：`settings.get()`（讀 `extraSettings.featureFlags`）+ `settings.update({ extraSettings:{ featureFlags } })`（**protected/admin**）。
  > ⚠ 校正：旗標寫入＝`settings.update`，**非** `settings.setFlag`/`admin.setFlag`（皆不存在）。對映 adapter 對應表「adminSetFlag → settings.update」。

---

## D. 內容治理（ContentTab）— admin

> 對映盤點 §3-17 後台「AI 全站研究 / 內容」＋ §3-12 模型自動研究。**唯讀統計 + 前往管理入口**（策展動作走既有頁，不在此重造寫入＝嚴格加法）。

### ①畫面結構與佈局
3 張 `ContentCard`（`grid-cols-1 md:grid-cols-3`）：

| 卡 | 圖示 | 統計列 | footer | 前往 |
|---|---|---|---|---|
| 模型情報 | `Cpu` | 模型總數 / 已驗證 / 待刷新(stale) | 「上次研究 {time}」或「自動研究每天 03:30」 | `/learn/ai-models` |
| 學習文件 | `FileText` | 文件總數 / 分類數 | 「編輯 / 匯入 / 新增於學習中心」 | `/learn/docs` |
| 情報新聞 | `Newspaper` | 最近則數 | 「news_articles · sense」 | `/learn/news` |

每卡：標題＋統計列（每列 label + `.pill` 值）＋footer 小字＋`.btn.sm`(outline)「`ExternalLink` 前往管理」。

### ②全狀態
- **載入**：統計值 `—`。
- **空/錯誤**：`retry:false`，無值落 `—`。
- **權限**：統計 query 為 public（`aiModels.list`/`news.list`/`learnHub.categories`），但分頁本身 admin-only（RBAC）。
- **長內容**：不適用（3 卡）。

### ④分支與決策
- 純治理總覽：**不在此編輯/刪除/匯入**（避免與既有 `/learn`、`/ai-models-hub` 寫入路徑重複）；「前往管理」導去既有頁。
- `docCount = Σ categories 值`；`newsCount = news.items.length`；模型 `meta.total/verifiedCount/staleCount/lastResearchAt`。

### ⑤microcopy（zh-TW）
卡標「模型情報」「學習文件」「情報新聞」｜列「模型總數」「已驗證」「待刷新(stale)」「文件總數」「分類數」「最近則數」｜footer「上次研究 {time}」/「自動研究每天 03:30」/「編輯 / 匯入 / 新增於學習中心」/「news_articles · sense」｜「前往管理」。

### ⑥對回真實 route/procedure
- `aiModels.list({modality:'all',provider:'all',tier:'all'}) → { meta }`（**public**）；`news.list({limit:50})`（**public**）；`learnHub.categories()`（**public**）。
- 策展寫入維持既有頁（`/learn` 學習中心、模型情報的匯入/新增）。

---

## E. 資料修復（DataRepairTab）— admin · **誠實標待建**

> 對映模擬 admin「資料修復」。**誠實標現況**：admin 14 procedure **無 `dataRepair`**（`03_code_reality_notes` §6.2 確認缺口）→修復動作目前無單一後端入口；**不假裝有不存在的 procedure**。

### ①畫面結構與佈局
兩張 `.card.pad`：

**(1) 資料修復動作**：
- 標題「`Wrench` 資料修復動作」。
- 3 張 `RepairAction`（`grid-cols-1 sm:grid-cols-3`），**全部 disabled（標「待建」）**：

| 動作 | 圖示 | 註記 | 狀態 |
|---|---|---|---|
| 重建 Context Packet | `Layers` | contextPacket.compileProject（需在專案頁指定 projectId） | 待建（導去專案頁） |
| 修復孤兒資產 | `Database` | 依賴 project_asset_links（M2 待建） | 待建 |
| 清理卡住任務 | `RefreshCw` | 目前無 dataRepair procedure；下方列出卡住任務供人工處理 | 待建 |

- 底部誠實註：「admin 後台 14 procedure 無 `dataRepair`（adapter 對應表 §6 確認缺口）。本分頁先做『診斷攤開』，修復動作待 M2/M3 補後端入口；屆時接上即用，UI 不改。」

**(2) 卡住 / 失敗任務（診斷）**：
- 標題「`AlertTriangle` 卡住 / 失敗任務」＋ `.pill`「{n} 筆」。
- 任務列（`max-h-72 overflow-auto divide-y`）：標籤＋狀態 `.pill`（failed→destructive/`--bad`、其他→outline）＋日期。篩選 `status ∈ {failed, running, queued}`。

### ②全狀態
- **載入**：3 條 `.skel`。
- **空**：「沒有卡住 / 失敗的任務。」
- **錯誤/無權**：`retry:false`；admin-only。
- **長內容**：`allBackgroundJobs({limit:100})`，前端篩 stuck，`max-h-72` 內捲。
- **權限**：admin（`ADMIN_TAB_MIN_ROLE['data-repair']=admin`）。

### ④分支與決策
- 三個修復按鈕 **disabled label「待建」**——重建 Context Packet 須在專案頁指定 projectId（導去）；修孤兒資產依賴 `project_asset_links`（M2 待建）；清理卡住任務無 `dataRepair`（先診斷攤開）。
- **不誤導**：不提供假按鈕觸發不存在的 procedure；待 M2/M3 後端補上，**UI 不改即可接上**。

### ⑤microcopy（zh-TW）
「資料修復動作」｜動作「重建 Context Packet」/「contextPacket.compileProject（需在專案頁指定 projectId）」；「修復孤兒資產」/「依賴 project_asset_links（M2 待建）」；「清理卡住任務」/「目前無 dataRepair procedure；下方列出卡住任務供人工處理」｜按鈕「待建」｜註「admin 後台 14 procedure 無 dataRepair（adapter 對應表 §6 確認缺口）。本分頁先做『診斷攤開』，修復動作待 M2/M3 補後端入口；屆時接上即用，UI 不改。」｜「卡住 / 失敗任務」/「{n} 筆」/「沒有卡住 / 失敗的任務。」

### ⑥對回真實 route/procedure
- `admin.allBackgroundJobs({ limit }) → 背景任務列`（**adminProcedure**；前端篩 failed/running/queued）。
- 修復動作（待建）：`contextPacket.compileProject`（需 projectId，導去專案頁）；`project_asset_links`（M2 待建）；`admin.dataRepair`（**不存在**，待補）。

---

## F. 稽核（AuditTab）— admin · **金鑰只報 isSet**

> 對映盤點 §3-17 後台「活動紀錄 / API·資料庫」＋模擬 admin「稽核日誌」。

### ①畫面結構與佈局
兩張 `.card.pad`：

**(1) 平台金鑰狀態**：
- 標題「`KeyRound` 平台金鑰狀態」＋小字「admin.apiKeysStatus · 不暴露 secret」。
- 金鑰格（`grid-cols-2 md:grid-cols-3`）：每格＝狀態圖示（已設定 `ShieldCheck` `--ok`／未設定 `ShieldOff` `--muted`）＋名稱/模組（truncate）＋`.pill`「已設定」/「未設定」。

**(2) 稽核 / 活動日誌**：
- 標題「`ScrollText` 稽核 / 活動日誌」＋ `.pill`「{n} 筆」。
- 日誌列（`max-h-80 overflow-auto divide-y`）：日期（w-20，`--muted-2`）＋操作者（w-16 truncate）＋動作（flex-1，`<b>` + 灰字 detail）。

### ②全狀態
- **載入**：金鑰 6 格 `.skel`；日誌 5 條 `.skel`。
- **空**：「無日誌（或需管理員權限）。」
- **錯誤/無權**：`retry:false`；admin-only。
- **長內容**：`usageLogs({limit:100})`，`max-h-80` 內捲。
- **權限**：admin（`ADMIN_TAB_MIN_ROLE.audit=admin`）。

### ④分支與決策
- 金鑰格容錯：`k.label`/`k.module`/`k.isSet`。**只渲染 isSet 布林**——已設定綠、未設定灰，**無任何 secret 值**。
- 日誌欄位容錯：時間 `createdAt??ts??date`；操作者 `userId??actor??userEmail`；動作 `requestType??action??kind??type`；detail `model??detail??apiProvider`。

### ⑤microcopy（zh-TW）
「平台金鑰狀態」/「admin.apiKeysStatus · 不暴露 secret」/「已設定」「未設定」｜「稽核 / 活動日誌」/「{n} 筆」/「無日誌（或需管理員權限）。」

### ⑥對回真實 route/procedure
- `admin.usageLogs({ limit }) → 全站用量/操作日誌`（**adminProcedure**，當稽核流）。
- `admin.apiKeysStatus() → [{ name, label, module, isSet }]`（**adminProcedure**；**只報 isSet**）。

---

## G. API 金鑰管理 UX（彙總 · **只設計畫面、無真實金鑰**）

> brief 指定：API 金鑰管理的 UX——**只設計畫面，不要在規格裡放任何真實金鑰**。`/settings` 的金鑰相關 UX 分兩處（稽核分頁的平台金鑰狀態、`/learn` keys 分頁的 BYOMCP），本節統一原則。

### 設計原則（鐵則）
1. **永不顯示 secret**：平台金鑰一律只顯示「已設定 / 未設定」（`isSet` 布林）＋名稱/模組；**沒有任何顯示、複製、編輯 secret 的欄位**。
2. **不在前端輸入平台金鑰**：平台金鑰透過部署環境變數/後台安全流程設定，**不提供前端表單寫 secret**（避免經 tRPC 傳輸明文）。
3. **BYOMCP（使用者自帶 key，待建 M5）**：未來使用者級自帶 key 的入口在 `/learn` keys 分頁；介面落地時（M5）採**遮罩輸入**（`••••••••` + 末四碼）、**寫入後不可回讀**（只能重設/刪除）、**逐金鑰 scope/權限**（`mcp_tool_permissions`）。本期僅佔位（受 `byomcp` 旗標控）。
4. **狀態語意**：`.pill.ok`「已設定」（綠 `--ok`）／`.pill.mute`「未設定」（灰）／（未來）`.pill.warn`「即將到期」。
5. **稽核連動**：金鑰的設定/輪替動作（後端）寫入 `admin.usageLogs`，在稽核分頁可見「誰在何時動了哪個金鑰模組」（不含 secret）。

### 畫面（彙總）
- **平台金鑰狀態卡**（稽核分頁 F-(1) ＋ `/learn` keys admin 段）：唯讀 isSet 格。
- **BYOMCP 入口**（`/learn` keys 分頁，待建佔位）：見 `/learn` 包 `03` D。

---

## H. 管理後台共同驗收要點

- [ ] RBAC：user 看不到管理後台；leader 只見「使用者・積分」（可調配額/自動給點、**改角色 disabled**）；admin 見五籤全。
- [ ] 使用者・積分：`updateQuota`（絕對值 +500/-100）、`updateRole`（admin 限定）即時生效 + toast；無權行內提示。
- [ ] 功能開關：建置時旗標（ENABLE_4SHELL/SHELL_*）唯讀；執行時五開關寫 `settings.update extraSettings`；ENABLE_4SHELL 說明到位。
- [ ] 內容：3 卡唯讀統計 + 前往管理（不重造寫入）。
- [ ] 資料修復：**誠實標待建**、按鈕 disabled、診斷攤開卡住任務（不假裝有 `dataRepair`）。
- [ ] 稽核：日誌列 + 平台金鑰**只報 isSet**。
- [ ] **全規格無任何真實金鑰；無前端輸入 secret 欄位。**
- [ ] 全程真實 procedure：**無 `admin.adjustCredits`/`admin.toggleUser`/`admin.setFlag`/`admin.dataRepair`（皆不存在或改名）**；用 `updateQuota`/`updateRole`/`settings.update`/`allBackgroundJobs`。
- [ ] 顏色全引用 `theme.css`；列 `.listrow`、開關 `.toggle`、徽章 `.pill`、`.setrow`；無寫死 hex。
