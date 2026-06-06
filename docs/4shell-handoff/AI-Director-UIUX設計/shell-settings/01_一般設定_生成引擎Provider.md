# 01 · `/settings` 一般設定 ／ 生成引擎 Provider（B 案）— 逐頁規格

> 兩分頁：`general`（一般設定）｜`provider`（生成引擎）
> 元件：`GeneralSettingsPanel.tsx`／`ProviderPanel.tsx`（settings 補丁已落地）
> 設計系統：引用 `theme.css` §9（`.setrow`/`.toggle`/`.provgrid`/`.provopt`）＋共用 §4。

---

# 第一部分 · 一般設定（GeneralSettingsPanel）

> 分頁 key：`general`（**`/settings` 預設分頁**）｜canonical：`/settings`、`/settings?sub=general`
> 對映盤點 §3-13：個人設定（外觀／通知／帳號資訊），含**主題**。收編 `/account-settings` 孤島（盤點建議刪，併入此分頁）。

## A. 一般設定

### ①畫面結構與佈局
四張 `.card.pad` 堆疊（`space-y-4`）＋底部儲存列。每張卡內用 `.setrow`（左標題`.sl b`+說明`.sl p`／右控制項）：

**(1) 外觀卡**（`Palette` 外觀）：
- `.setrow`「主題」說明「深藍宇宙（暗）／溫潤大地（淺，次要色調）」→ `<select>`（`.input`）：跟隨系統／淺色（溫潤大地）／深色（深藍宇宙）。
- `.setrow`「字級」說明「介面字體縮放」→ `<select>`：小／中／大。
- `.setrow`「降低動態效果」說明「reduced motion（無障礙）」→ `.toggle`（`<Switch>`）。

**(2) 導覽 / 個人化卡**（`LayoutDashboard` 導覽與顯示｜**實站左下頭像選單實擷**）：
> 這組是 director.today 左下頭像選單的真實個人化控制，backing＝脊椎 `PersonalSettingsContext`（最被依賴的 spine provider；DashboardLayout/AppleDock 讀它套用 chrome）。**不重造主題/版面狀態，寫回 `PersonalSettingsContext` 既有欄位**。

- `.setrow`「導覽列樣式」說明「外框 chrome 形態」→ **三選一**（`.seg` 分段或 `.provgrid` 小卡）：
  - **浮動 Dock**（Apple 風格懸浮膠囊，`AppleDock`，預設）｜**緊縮側欄**（collapsed rail，僅圖示）｜**完整側欄**（full sidebar，圖示＋文字）。
- `.setrow`「顯示密度」說明「列高與間距」→ **三選一**（`.seg`）：緊湊／舒適（預設）／寬鬆。對應 `--ds`/間距階；密度切換改 `.setrow`/`.listrow` 的 padding 級距。
- `.setrow`「導覽列位置」說明「Dock / 側欄錨點」→ **四選一**（`.seg` 或方位選擇器）：靠左（預設）／置頂／靠右／置底。窄螢幕（≤780px）一律收為底部 `.mnav`，此設定僅桌面生效。
- `.setrow`「沉浸模式」說明「隱藏 chrome，最大化內容區」→ `.toggle`。
- `.setrow`「最小化導覽列」說明「自動收合 Dock/側欄，hover 才展開」→ `.toggle`。
- 行動列：`.btn.ghost.sm`「重新開始導覽」（`RotateCcw`，重置 `SiteOnboardingContext` 引導；對齊頭像選單「重新開始導覽」）。
- **頭像選單對照**（DashboardLayout/SpineChrome 左下頭像下拉，非本卡渲染，但本卡是其「個人設定」落點）：首頁→`/`｜個人設定→`/settings`（本頁）｜未整理區域→`/unorganized`（重整暫存抽屜，落地後清空）｜管理後台→`/settings/admin`（RBAC，僅 leader/admin 見）。

**(3) 通知卡**（`Bell` 通知）：
- `.setrow`「Email 通知」說明「重要事件以 email 通知」→ `.toggle`。
- `.setrow`「生成完成通知」說明「生成任務完成時通知」→ `.toggle`。
- `.setrow`「每週摘要」說明「每週用量 / 進度摘要」→ `.toggle`。

**(4) 帳號卡**（`Users` 帳號）：
- 4 格唯讀欄位（`grid-cols-2`，`Field`）：名稱／電子郵件／角色（`.pill`）／剩餘配額（「{n} 次」）。值來自 `auth.me`（`useAuth`）。
- 小字「帳號設定（/account-settings）建議併入此分頁（盤點：與此重複）。→ 目標 Supabase Auth。」

**(5) 儲存列**：`.btn.primary`「儲存偏好」（pending 轉 `Loader2`）＋ `.btn`（outline）「還原未儲存變更」＋（讀取失敗時）小字「（未登入 → 設定唯讀）」。
> 注意：導覽/個人化卡的多數控制（樣式/密度/位置/沉浸/最小化）走 **`PersonalSettingsContext` 即時生效**（chrome 立刻變），不必等「儲存偏好」；「儲存偏好」批次提交的是 `settings.*` 那批（主題/字級/通知/locale）。兩種模式並存：個人化＝即時、偏好＝草稿批次。

### ②全狀態
- **載入**：`getQ.isLoading`——草稿未填，控制項用 `settings.get` 預設值；可在控制項位放輕骨架。
- **空/未登入**：`settings.get` 失敗（`retry:false`）→ 控制項顯示預設值但**唯讀**；儲存列小字「（未登入 → 設定唯讀）」；按「儲存」→toast「儲存失敗（需登入）」。
- **錯誤**：同上，不彈窗，行內標示。
- **長內容**：不適用（固定卡）。
- **權限**：`settings.get/update` 為 **protected**；未登入唯讀。`auth.me` 未登入時欄位顯 `—`。**導覽/個人化卡走 `PersonalSettingsContext`（本機/脊椎狀態），未登入也能切**（chrome 即時變），只是不持久化到帳號。
- **草稿髒態**：草稿與已存值不同時，「儲存」可按；「還原未儲存變更」把草稿重置回 `getQ.data`（**不影響**個人化卡的即時設定）。
- **個人化即時態**：切導覽列樣式/密度/位置/沉浸/最小化 → DashboardLayout chrome **立即**重排（無 loading）；窄螢幕時「導覽列位置」rows 標灰並註「窄螢幕固定底部 Dock」。

### ③進入＆離開條件
- 進入：`/settings` 裸路由（**general 為預設**）、`.subtabs`「一般」、`?sub=general`、舊 `/account-settings` redirect。
- 離開：切分頁——**有未儲存草稿時建議攔截**（toast/確認「有未儲存變更，確定離開？」）；或自動保留草稿於記憶體。

### ④分支與決策
- **本地草稿模式**：`settings.get` 載入後填入 `draft`，編輯只改 `draft`，**按「儲存偏好」才送 `settings.update`**。這與其他分頁的即時 mutation 不同（設定多項、批次提交較合理）。
- 主題寫 `settings.uiTheme`——**既有 `ThemeProvider` 讀此來源套用**，不重造主題狀態。亮色＝「溫潤大地」對應本設計系統暖光 Claude；深色＝「深藍宇宙」為後續里程碑（`theme.css` `[data-theme="night"]` 預留）。
- 儲存成功→`utils.settings.get.invalidate()` 重抓＋toast「已儲存設定」。
- 帳號區唯讀：**不在此提供改密碼/改 email/登出**（走既有帳號流程/Supabase Auth 目標）；只顯示。
- **個人化分流**：導覽列樣式/密度/位置/沉浸/最小化 → `PersonalSettingsContext` 對應 setter **即時生效**（DashboardLayout/AppleDock 立即套用）；可選同步寫 `settings.extraSettings`（重整後沿用），未登入則僅本機（沿用脊椎慣例）。「重新開始導覽」→ 重置 `SiteOnboardingContext`，下次進站重跑引導。

### ⑤microcopy（zh-TW）
外觀「主題」/「深藍宇宙（暗）／溫潤大地（淺，次要色調）」；「字級」/「介面字體縮放」；「降低動態效果」/「reduced motion（無障礙）」｜導覽/個人化「導覽列樣式」/「外框 chrome 形態」+「浮動 Dock」「緊縮側欄」「完整側欄」；「顯示密度」/「列高與間距」+「緊湊」「舒適」「寬鬆」；「導覽列位置」/「Dock / 側欄錨點」+「靠左」「置頂」「靠右」「置底」；「沉浸模式」/「隱藏 chrome，最大化內容區」；「最小化導覽列」/「自動收合 Dock/側欄，hover 才展開」；「重新開始導覽」｜頭像選單「首頁」「個人設定」「未整理區域」「管理後台」｜通知「Email 通知」/「重要事件以 email 通知」；「生成完成通知」/「生成任務完成時通知」；「每週摘要」/「每週用量 / 進度摘要」｜帳號 4 欄「名稱」「電子郵件」「角色」「剩餘配額」+「{n} 次」；註「帳號設定（/account-settings）建議併入此分頁（盤點：與此重複）。→ 目標 Supabase Auth。」｜按鈕「儲存偏好」/「還原未儲存變更」｜成功「已儲存設定」｜失敗「儲存失敗（需登入）」｜唯讀「（未登入 → 設定唯讀）」｜窄螢幕「窄螢幕固定底部 Dock」。

### ⑥對回真實 route/procedure
- `settings.get() → { uiTheme, accentColor, fontScale, reducedMotion, emailNotifications, generationCompleteNotify, weeklyDigestEnabled, locale, timezone, extraSettings{...} }`（**protected**）。
- `settings.update(partial) → ok`（**protected**；`db.upsertSystemSettings`）。
  > ⚠ 校正：`settings` 僅 `get`/`update`，**無 `setFlag`**；旗標寫入也走 `update`（`extraSettings`，見 `03`）。
- `auth.me() → { name/displayName, email, role, remainingGenerations }`（帳號資訊，`useAuth` hook）。
- **導覽/個人化**：脊椎 `PersonalSettingsContext`（既有；存 navStyle=`dock|rail|sidebar`、density=`compact|comfortable|spacious`、navPosition=`left|top|right|bottom`、immersive、minimizedNav 等欄位）＋ `SiteOnboardingContext`（重新開始導覽）。**不新增 procedure**；選配持久化沿用 `settings.update({ extraSettings })`。
  > 來源：左下頭像選單實擷（首頁/個人設定/未整理區域/管理後台＋導覽列樣式/顯示密度/導覽列位置/沉浸模式/最小化導覽列/重新開始導覽）。`PersonalSettingsContext ⇄ useMobile` 循環已於 P0 用 `@/hooks/viewMode` 打斷（`03_code_reality_notes` §3.3），讀寫安全。

---

# 第二部分 · 生成引擎 Provider（ProviderPanel · B 案）

> 分頁 key：`provider`｜canonical：`/settings?sub=provider`
> 對映架構 §6 B 案：生成層＝可選 provider `{HF, Gemini}`（＋fal/replicate 回退），per-引擎 `GENERATION_PROVIDER=hf|gemini|fal` 切換。`SpineProvider` 另含 `mock`（離線兜底）。**Claude 只決策、不生圖**。

## B. 生成 Provider 選擇

### ①畫面結構與佈局
兩張 `.card.pad`：

**(1) Provider 選擇卡**：
- 標題列「`Hand` 生成 Provider（B 案）」＋右側 `.tag`（mono）「`GENERATION_PROVIDER = {目前 provider}`」。
- 說明「逐引擎切換：HF 預設、Gemini 並列、fal 回退、mock 離線兜底。Claude 只決策、不生圖。」
- **Provider 卡網格**（`.provgrid`，`grid-cols-2 lg:grid-cols-4`）：四張 `.provopt`（選中套 `.provopt.on`＋`--clay` 邊/ring）：

| provider | `.pvn`（mono 大寫） | `.pvd` 說明 | 成本/張 | 故障碼 |
|---|---|---|---|---|
| `hf` | HF | HF Inference（主引擎，預設） | $0.012 | 逾時 504 |
| `gemini` | GEMINI | Gemini（並列可選；**B 案**） | $0.020 | 速率限制 429 |
| `fal` | FAL | fal.ai（回退） | $0.030 | 額度用盡 402 |
| `mock` | MOCK | 離線兜底（零金鑰） | $0.000 | 注入 500（連兜底都失敗→整體失敗） |

每張 `.provopt`：頂列 mono provider 名 `.pvn` + 選中時 `.pill`「使用中」；下方 `.pvd` 說明；再下 `--gold`/amber mono「${cost}/張」。
- 卡網格下方 `--muted` 小字：「`Zap` 回退鏈：hf → gemini → fal → mock（每跳 append-only 記 provider/cost/latency）。」

**(2) 故障注入卡**（demo 用）：
- 標題「`Bug` 故障注入（示範回退）」＋ `.pill.mute`「demo / 測試用」。
- 說明「打開任一 provider 的故障，再去 /video 或 /social 生成，會看到自動回退鏈與提示。」
- 五條 `.setrow` + `.toggle`：模擬 hf/gemini/fal/mock 失敗（說明＝各自故障碼）＋「模擬研究上游故障」（說明「/learn 研究代理 503（示範錯誤 / 重試）」）。

### ②全狀態
- **載入**：provider 來自 `SpineProvider`（記憶體，即時有值），無載入態。
- **空**：不適用（四 provider 固定）。
- **錯誤**：切 provider 是本機操作不失敗；選配持久化 `settings.update` 失敗（未登入）→**靜默**（不打擾），本機切換仍生效。
- **長內容**：不適用。
- **權限**：本機切換無門檻；持久化寫 `settings.extraSettings.generationProvider` 需登入（失敗靜默）。

### ③進入＆離開條件
- 進入：`.subtabs`「生成引擎」、`?sub=provider`。
- 離開：選擇即時生效（影響 `/video`、`/social` 的 `GenerationAdapter`）；故障旗標保留於 `SpineProvider`。

### ④分支與決策
- **選 provider**：`spine.setProvider(pv)` 即時更新（記憶體）＋ `settings.update({ extraSettings:{ generationProvider: pv } })` 選配持久化（重整後沿用；未登入失敗不影響本機）。成功 toast「已記住生成引擎偏好」。
- **Gemini = B 案**：UI 上 Gemini 與 HF **並列平權**（不是隱藏選項），標「並列可選；B 案」。架構定案「HF 為預設、Gemini 並列、fal 回退」。
- **回退鏈**：`hf → gemini → fal → mock`，由 `GenerationAdapter` 內建；每跳 append-only 記 `provider/cost/latency`（錨在 `generate.recordGenResult`，非本面板職責，但說明要呈現）。
- **故障注入**：`spine.toggleFault(pv)`／`spine.toggleFault('research')`——打開後到 `/video`/`/social` 生成可見回退鏈、到 `/learn` 研究可見 503/重試。**這是 demo 工具**，標清楚「測試用」。
- mock 故障特別說明：連兜底都失敗→整體失敗（測試「全鏈斷」情境）。

### ⑤microcopy（zh-TW）
標題「生成 Provider（B 案）」｜tag「GENERATION_PROVIDER = {pv}」｜說明「逐引擎切換：HF 預設、Gemini 並列、fal 回退、mock 離線兜底。Claude 只決策、不生圖。」｜provider 說明（見表）｜「使用中」｜成本「${x}/張」｜回退「回退鏈：hf → gemini → fal → mock（每跳 append-only 記 provider/cost/latency）。」｜故障卡「故障注入（示範回退）」/「demo / 測試用」/「打開任一 provider 的故障，再去 /video 或 /social 生成，會看到自動回退鏈與提示。」｜「模擬 {pv} 失敗」+ 故障碼｜「模擬研究上游故障」/「/learn 研究代理 503（示範錯誤 / 重試）」｜持久化成功「已記住生成引擎偏好」。

### ⑥對回真實 route/procedure
- `SpineProvider`：`provider: ProviderId`、`setProvider(pv)`、`faults: Record<ProviderId|'research', boolean>`、`toggleFault(key)`（P0 既有）。`ProviderId = "hf"|"gemini"|"fal"|"mock"`。
- `settings.update({ extraSettings:{ generationProvider } })`（**protected**，選配持久化；未登入失敗靜默）。
- 真實生成入口（受此偏好影響，非本面板呼叫）：`generate.estimateCost → prepareJob/submitStudioJob → jobStatus → recordGenResult`；回退鏈/事件錨在 `generate.recordGenResult`。
  > ⚠ 校正：統一生成入口＝`generate.*`（**非** `imageStudio.generate`）；底層才是 `imageStudio.<model>`/`videoStudio.<model>`。本面板只切偏好，不直接呼生成。

---

## C. 兩分頁共同驗收要點

- [ ] 一般：外觀/**導覽·個人化**/通知/帳號四卡 + 草稿儲存模式（儲存/還原）；主題寫 `settings.uiTheme` 由 ThemeProvider 套用；未登入唯讀。
- [ ] 導覽/個人化（實站頭像選單）：導覽列樣式（Dock/緊縮側欄/完整側欄）、顯示密度（緊湊/舒適/寬鬆）、導覽列位置（靠左/置頂/靠右/置底）、沉浸模式、最小化導覽列、重新開始導覽——皆走 `PersonalSettingsContext` 即時生效，**不新增 procedure、不重造版面狀態**；窄螢幕「導覽列位置」標灰固定底部 Dock。
- [ ] 生成引擎：四 provider `.provopt` 卡（Gemini 與 HF 並列、標 B 案）、選中態、成本、回退鏈說明；故障注入五 toggle。
- [ ] provider 切換即時（SpineProvider）+ 選配持久化（settings.update extraSettings），未登入靜默。
- [ ] 全程 `settings.get/update`/`auth.me`/SpineProvider 真實接點；**無 `settings.setFlag`、無直接 `imageStudio.generate`**。
- [ ] 顏色全引用 `theme.css`；設定列 `.setrow`、開關 `.toggle`、provider `.provgrid/.provopt`；無寫死 hex。
- [ ] 窄螢幕 provider 網格收 2 欄；`.setrow` 標題/說明層級清楚；reduced-motion 尊重（開關動畫退化）。
