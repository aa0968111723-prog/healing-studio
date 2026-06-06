# 04 · `/settings` microcopy 字串表 · route/procedure 對照 · RBAC · 設計系統 class 對照

> M4 一致性層：彙整全 shell zh-TW 字串、每畫面→真實 procedure（含校正）、RBAC 對照、shadcn↔theme.css class 對照。實作收尾與 QA 以本檔交叉核對。
> 事實基準：`_research/03_code_reality_notes.md`（HEAD `2888a36`）＋ settings 補丁原始碼。

---

## 1. 每畫面 → 真實 procedure → 權限 對照

| 分頁/區塊 | route / `?sub=` | 真實 procedure | 權限 | 校正註記 |
|---|---|---|---|---|
| 富首頁聚合 | `/settings`（預設 general） | —（`<Tabs>`+`?sub=`） | — | 五分頁 key：general/provider/agent/obs/admin（admin 僅 leader+） |
| 一般·讀寫設定 | `?sub=general` | `settings.get()` / `settings.update(partial)` | protected | ⚠ 無 `setFlag` |
| 一般·導覽/個人化 | 同上 | `PersonalSettingsContext`（navStyle/density/navPosition/immersive/minimizedNav）＋`SiteOnboardingContext`（重新開始導覽）；選配 `settings.update({extraSettings})` | protected（持久化選配）/ 本機即時 | 實站頭像選單；不新增 procedure |
| 一般·帳號 | 同上 | `auth.me()`（`useAuth`） | protected | 唯讀 |
| 生成 Provider | `?sub=provider` | SpineProvider `setProvider/faults/toggleFault` + `settings.update({extraSettings:{generationProvider}})` | protected（持久化選配） | `ProviderId=hf|gemini|fal|mock`；Gemini=B 案 |
| 生成入口（受影響） | — | `generate.estimateCost→submitStudioJob→jobStatus→recordGenResult` | protected | ⚠ 非 `imageStudio.generate` |
| 代理偏好 | `?sub=agent` | `agentPreferences.getPreferences/updatePreferences/getRecentActivity` | protected | 三人格即時 mutation |
| 觀測·LangSmith | `?sub=obs` | `langsmith.status()` / `langsmith.stats({...})` | protected | 任何登入者 |
| 觀測·系統概覽 | 同上 | `admin.systemStats()` | **admin** | `enabled:isAdmin` |
| 觀測·背景任務 | 同上 | `admin.allBackgroundJobs({limit})` | **admin** | `enabled:isAdmin` |
| 後台·使用者列 | `?sub=admin` users | `admin.allUsers()` | **admin** | leader 可見列表 |
| 後台·調配額 | 同上 | `admin.updateQuota({userId,amount})` | **admin/leaderOrAdmin** | ⚠ 非 `adjustCredits`；絕對值 |
| 後台·改角色 | 同上 | `admin.updateRole({userId,role})` | **admin** | ⚠ 非 `toggleUser`；leader disabled |
| 後台·自動給點 | 同上 | `admin.updateAutoCreditPolicy`/`runAutoCreditNow` | **leaderOrAdmin** | — |
| 後台·功能開關（建置時） | flags | `@/config/featureFlags` `FEATURE_FLAGS` | 唯讀 | ENABLE_4SHELL/SHELL_SOCIAL/SHELL_LEARN |
| 後台·功能開關（執行時） | flags | `settings.update({extraSettings:{featureFlags}})` | **admin** | ⚠ 非 `settings.setFlag` |
| 後台·內容 | content | `aiModels.list` / `news.list` / `learnHub.categories` | public（分頁 admin） | 唯讀統計+前往 |
| 後台·資料修復 | data-repair | `admin.allBackgroundJobs`（診斷） | **admin** | ⚠ `admin.dataRepair` **不存在**＝待建 |
| 後台·稽核日誌 | audit | `admin.usageLogs({limit})` | **admin** | — |
| 後台·平台金鑰 | audit / keys | `admin.apiKeysStatus()` | **admin** | **只報 isSet，無 secret** |
| 深頁 re-home | `/settings/admin/api-usage` | `AdminApiUsagePage` | （頁內守門） | 不重寫 |
| 深頁 re-home | `/settings/admin/brain-pipeline` | `AiBrainPipelinePage` | （頁內守門） | 全站大腦圖，不重寫 |

---

## 2. RBAC 對照（前端隱藏 ↔ 後端守門）

| 元素 | 前端門檻（rbac.ts） | 後端守門 |
|---|---|---|
| 管理後台頂層分頁 | `roleAtLeast(role,'leader')` | — |
| 使用者・積分子分頁 | `ADMIN_TAB_MIN_ROLE.users=leader` | `adminProcedure`/`leaderOrAdminProcedure` |
| 改角色 `<select>` | `disabled={!isAdmin}` | `adminProcedure`（updateRole） |
| 內容/功能開關/資料修復/稽核 | `=admin` | `adminProcedure` |
| 觀測·系統概覽/背景任務 | `enabled:isAdmin` | `adminProcedure` |
| 平台金鑰狀態 | `enabled:isAdmin` | `adminProcedure` |

角色 rank：`user(0) < leader(1) < admin(2)`；`useRole()` 未登入→`user`。**前端僅 UX，後端強制；前端放行 ≠ 後端放行。**

---

## 3. 旗標總表

| 旗標 | 檔/來源 | 預設 | 作用 |
|---|---|---|---|
| `VITE_ENABLE_4SHELL` | `config/featureFlags.ts` | OFF | 4-shell 總開關；OFF＝行為等同線上、不掛任何 shell |
| `VITE_SHELL_SETTINGS_RICH` | `shells/settings/settingsFlags.ts` | ON | `/settings` 富 UI；0 退回 P0 ShellFrame |
| `VITE_SHELL_SOCIAL` / `VITE_SHELL_LEARN` | `config/featureFlags.ts` | OFF / ON | 各 shell 顯示開關（唯讀顯示於功能開關） |
| `GENERATION_PROVIDER` | per-引擎 / SpineProvider | hf | hf｜gemini（B 案）｜fal；SpineProvider 另含 mock |
| 執行時旗標 | `settings.extraSettings.featureFlags` | — | research/byomcp/ambient/focusFlow/onboarding |

---

## 4. zh-TW microcopy 字串表（key → 字串）

### 共用 / 頂部
- `settings.title` =「⚙ 設定」｜`settings.subtitle` =「統管全站四 shell：外觀 / 生成引擎 / 代理 / 觀測 / 治理」
- 分頁：`一般`／`生成引擎`／`代理偏好`／`觀測`／`管理後台`

### 一般設定
- 外觀「主題」/「深藍宇宙（暗）／溫潤大地（淺，次要色調）」；「字級」/「介面字體縮放」；「降低動態效果」/「reduced motion（無障礙）」
- 導覽/個人化「導覽列樣式」/「外框 chrome 形態」+「浮動 Dock」「緊縮側欄」「完整側欄」；「顯示密度」/「列高與間距」+「緊湊」「舒適」「寬鬆」；「導覽列位置」/「Dock / 側欄錨點」+「靠左」「置頂」「靠右」「置底」；「沉浸模式」/「隱藏 chrome，最大化內容區」；「最小化導覽列」/「自動收合 Dock/側欄，hover 才展開」；「重新開始導覽」；窄螢幕「窄螢幕固定底部 Dock」
- 頭像選單「首頁」「個人設定」「未整理區域」「管理後台」
- 主題選項「跟隨系統」「淺色（溫潤大地）」「深色（深藍宇宙）」；字級「小」「中」「大」
- 通知「Email 通知」「生成完成通知」「每週摘要」＋說明
- 帳號「名稱」「電子郵件」「角色」「剩餘配額」/「{n} 次」；註「帳號設定（/account-settings）建議併入此分頁（盤點：與此重複）。→ 目標 Supabase Auth。」
- 「儲存偏好」「還原未儲存變更」/「已儲存設定」/「儲存失敗（需登入）」/「（未登入 → 設定唯讀）」

### 生成引擎
- 「生成 Provider（B 案）」/「GENERATION_PROVIDER = {pv}」/「逐引擎切換：HF 預設、Gemini 並列、fal 回退、mock 離線兜底。Claude 只決策、不生圖。」
- provider 說明：HF「HF Inference（主引擎，預設）」、GEMINI「Gemini（並列可選；B 案）」、FAL「fal.ai（回退）」、MOCK「離線兜底（零金鑰）」；「使用中」；「${x}/張」
- 「回退鏈：hf → gemini → fal → mock（每跳 append-only 記 provider/cost/latency）。」
- 「故障注入（示範回退）」/「demo / 測試用」/「打開任一 provider 的故障，再去 /video 或 /social 生成，會看到自動回退鏈與提示。」/「模擬 {pv} 失敗」/「模擬研究上游故障」/「/learn 研究代理 503（示範錯誤 / 重試）」/「已記住生成引擎偏好」

### 代理偏好
- 「代理偏好」/「agent_preferences · agent_model_picks」/「預設導演人格」/「Calm / Creative / Technical（orbStore 思考球）」/「平靜」「創意」「技術」/「更新中…」/「已更新代理偏好」/「更新失敗（需登入）」
- 「六代理層狀態」+ 六層（導演 AI/總指揮/Context Packet/研究代理/感知代理/財財（成本））+「可用」「待接」
- 「最近活動」/「尚無活動（或未登入）。」

### 觀測
- 「LangSmith（AI 監控）」/「已連接」「未設定」/「追蹤 LLM 呼叫鏈、延遲、成本（langsmith.status / stats）。未設金鑰時為 no-op。」
- 「系統概覽」/「總使用者」「總生成」「總成本」「數位資產」
- 「背景任務」/「background_jobs」/「無背景任務。」/「背景任務 / 系統統計需管理員權限。」

### 管理後台
- 容器「管理後台」/閘門「需要管理員 / 組長權限」/「你目前角色為 {role}。管理後台僅對 leader / admin 開放。」/「管理使用者配額、角色權限、內容、功能開關、修復與稽核」
- 子分頁「使用者・積分」「內容」「功能開關」「資料修復」「稽核」
- 使用者「使用者 / 積分管理」/「{n} 位」/「+500」「-100」/「更改角色」「僅管理員可改角色」/「無使用者資料。」/「需要管理員權限。」/「寫入中…」/「已調整配額」/「已更新角色」/「配額調整失敗：{msg}」/「角色更新失敗：{msg}」/「你是 {role}：可看清單與調配額；更改角色（updateRole）為 admin 專屬。」
- 功能開關「建置時旗標（唯讀）」/「來源：Vite env · 改需重 build」/「ON」「OFF」/「執行時功能開關」/「settings.update · extraSettings.featureFlags」/五開關標題說明/「寫入中…」/「已更新功能開關」/「更新失敗（需管理員）」/「站台級（全使用者）治理待 P3 把旗標來源移到 system_settings；目前 extraSettings 為使用者級草案。」
- 內容「模型情報」「學習文件」「情報新聞」/列標/footer/「前往管理」
- 資料修復「資料修復動作」/三動作標題+註/「待建」/「admin 後台 14 procedure 無 dataRepair（adapter 對應表 §6 確認缺口）。本分頁先做『診斷攤開』，修復動作待 M2/M3 補後端入口；屆時接上即用，UI 不改。」/「卡住 / 失敗任務」/「{n} 筆」/「沒有卡住 / 失敗的任務。」
- 稽核「平台金鑰狀態」/「admin.apiKeysStatus · 不暴露 secret」/「已設定」「未設定」/「稽核 / 活動日誌」/「{n} 筆」/「無日誌（或需管理員權限）。」

---

## 5. shadcn ↔ theme.css class / token 對照

| P6 元件/類 | theme.css 語意 class | token |
|---|---|---|
| `<Tabs>`（頂/子分頁） | `.subtabs` + `button.on` | 選中 `--clay-tint`/`--gold-tint` |
| `<Card>` | `.card`(+`.pad`) | `--surface`/`--line`/`--shadow-card` |
| 設定列 | `.setrow`(`.sl b`/`.sl p`) | 標題 `--ink`、說明 `--muted` |
| `<Switch>` | `.toggle`(+`.on`) | on `--clay-bright`→`--clay` |
| provider 卡網格 | `.provgrid` + `.provopt`(`.on`/`.pvh`/`.pvn`/`.pvd`) | on `--clay` 邊/ring |
| 三段人格切換 | `.persona .p.on.{calm/creative/technical}` | `--persona-calm/-creative/-technical` |
| `<Badge>` | `.pill`(`.ok/.warn/.bad/.info/.mute`) | 對應 tint |
| mono 標（旗標/provider） | `.tag` | `--muted`/`--surface-2` |
| `<Button>` | `.btn`(+`.primary/.gold/.ghost/.danger/.sm`) | `--clay`/`--gold`/`--bad` |
| `<Input>`/`<select>` | `.input` | `--wash`/`--line`；focus `--clay` |
| 列式（使用者/任務/日誌/金鑰） | `.listrow`(`.le`) | `--surface-2`；hover `--surface-3` |
| 系統概覽/MiniStat 格 | `.bigcount` 或 `.card` 小格 | 數字 `--f-display` |
| EmptyState/Loading | `.state`(`.ico`/`.ti`/`.ds`)、`.spin`、`.skel` | error `.state.error` `--bad` |
| 閘門卡（無權） | `.state` + `ShieldAlert` | `--muted`/`--bad` |
| `sonner` toast | `.toast`(`.ok/.warn/.bad/.info`) | 對應 tint |

---

## 6. 一致性檢查清單（QA）

- [ ] 五分頁 key 與 `?sub=` 同步；`admin` 僅 leader+ 出現；`/settings/ai-brain`→`/settings/admin` redirect；舊 `/admin` 不 404。
- [ ] RBAC 三層落地：user/leader/admin 看到的分頁與動作正確；admin-only query `enabled:isAdmin` 不發；改角色 leader disabled。
- [ ] procedure 名與 §1 一致——**無 `admin.adjustCredits`/`admin.toggleUser`/`admin.setFlag`/`admin.dataRepair`/`settings.setFlag`/`imageStudio.generate`（皆不存在或改名）**。
- [ ] ENABLE_4SHELL 在功能開關分頁唯讀顯示且有完整說明；執行時旗標走 `settings.update extraSettings`。
- [ ] 生成引擎四 provider（Gemini 與 HF 並列、B 案）、回退鏈、故障注入到位。
- [ ] 資料修復誠實標待建、不假裝有 `dataRepair`；金鑰**只報 isSet、無 secret、無前端輸入 secret 欄位**。
- [ ] 每畫面六態（空/載入/錯誤/長/權限/儲存）落地，文案逐字對齊 §4。
- [ ] 顏色 100% 引用 `theme.css`；無寫死 hex；無真實金鑰；亮色 Claude 質感（暖米白/黏土/serif 標題/克制邊框）；reduced-motion 尊重。
