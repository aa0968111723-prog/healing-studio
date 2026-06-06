# 00 · `/settings` Shell — 總覽、設計契約、RBAC、路由地圖

> 交付對象：已載入 healing-studio 程式碼的「Claude Design」實作代理。
> 範圍：**只有 `/settings`（設定／治理／管理後台）shell**。不碰其他 shell、不碰 `00_設計系統`/`design-system`。
> 事實基準：`director.today_登入後內部盤點.md`（100% 功能盤點）＋ `_research/03_code_reality_notes.md`（GitNexus 校正，HEAD `2888a36`）＋ `AI-Director_四大系統架構.md` §系統④＋ `AI-Director-settings補丁/`（開發者已落地的富 shell 接線，**本規格即為其視覺/狀態契約**）＋ `00_設計系統/theme.css`（設計系統單一真實來源）。
> 設計鐵律：**重用優先、最小新增、加法不破壞（strangler-fig）**；脊椎元件單一實例；**直接引用 `theme.css`，不自造色票/元件**；RBAC 前端只隱藏、後端 procedure 強制。

---

## 0. 怎麼讀這份交付包（給實作代理）

`/settings` ＝**統管全站四 shell** 的設定、帳號、權限、觀測、治理中樞。它收編盤點裡「設定打散 5+ 面」（`/settings` 8 籤、`/settings/agent` 12 籤、`/settings/ai-brain` 死別名、`/account-settings` 孤島、`/dashboard` 積分）的痛點，整併為**一個富首頁、五個分頁**（管理後台分頁再含 5 個 RBAC 子分頁）。按編號讀即可照做：

| 檔 | 內容 | 里程碑 |
|---|---|---|
| `00_總覽_設計契約_RBAC_路由地圖.md` | ←本檔。定位、token/元件契約、**RBAC 三層**、路由與 `?sub=`、旗標矩陣（含 ENABLE_4SHELL）、全域狀態、保留原系統聲明 | M1 |
| `01_一般設定_生成引擎Provider.md` | 一般（外觀/主題/通知/帳號）＋生成 Provider 切換（hf｜gemini｜fal｜mock，Gemini=B 案）＋故障注入 | M2 |
| `02_代理偏好_觀測.md` | 代理偏好（三人格/六代理層/最近活動）＋觀測（LangSmith/系統概覽/背景任務） | M2 |
| `03_管理後台RBAC_API金鑰UX.md` | 管理後台容器＋5 子分頁（使用者・積分/內容/功能開關/資料修復/稽核）＋API 金鑰管理 UX（只設計畫面、無真實金鑰） | M3 |
| `04_microcopy字串表_route_procedure對照.md` | 全 shell zh-TW 字串＋每畫面→真實 procedure（含校正）＋RBAC 對照＋設計系統 class 對照 | M4 |

**每份畫面規格固定六段**（全套一致）：

> ①畫面結構與佈局　②全狀態（空／載入／錯誤／長內容／權限）　③進入＆離開條件　④分支與決策　⑤microcopy（zh-TW）　⑥對回真實 route/procedure

---

## 1. `/settings` 一句話定位

`/settings` 把全站**外觀／生成引擎／代理偏好／觀測／治理（管理後台）**收進一個獨立 shell。它**不造新後端**——全部打 GitNexus 校正後的既有 procedure（`settings.get/update`、`admin.*`、`agentPreferences.*`、`langsmith.*`）；生成 provider 切換走 P0 `SpineProvider`（記憶體狀態＋選配寫 `settings.extraSettings`）。

> 與其他 shell 的分界：`/settings` **治理**「誰能讀哪些資料、哪些工具可用、用哪個生成引擎、全站旗標」——這些寫進脊椎後**影響全脊椎**（架構 §1.5）。它不做創作/生成（`/video`、`/social`）、不做學習/帳務檢視（`/learn`）。管理後台是**閘控視角**，不在後台另做一份生成歷史/背景任務（那些在 `/assets`、`/learn`、`/my-brain` 已有，後台只攤開治理用）。

---

## 2. 設計契約 · Token 契約（引用 `theme.css`，不自造）

**單一真實來源＝`AI-Director-UIUX設計/00_設計系統/theme.css`**（rev.L1，亮色「暖光 Claude」）。`theme.css` **已內含 `/settings` 專屬區塊（§9 SETTINGS）**：`.toggle`/`.toggle.on`、`.setrow`(`.sl b`/`.sl p`)、`.provgrid`/`.provopt`(`.on`/`.pvh`/`.pvn`/`.pvd`)。直接用。

### 2.1 視覺定調
亮色、安靜、可信任的治理介面：暖米白分層表面、黏土主強調用在「使用中/選中/CTA」、語意色（綠 `--ok`／金 `--warn`／紅 `--bad`）用在治理狀態（角色/配額/任務/金鑰），克制色塊、靠留白與細線分組。設定列以 `.setrow`（標題 `--ink` + 說明 `--muted`）為基本單位。

### 2.2 真實 token 名（以 `theme.css` 為準）
顏色：`--bg`/`--surface`/`--surface-2`／`--ink`/`--ink-soft`/`--muted`/`--muted-2`／`--clay`(`--accent`)/`--clay-deep`／`--gold`(`--accent-2`)／`--ok`/`--warn`/`--bad`/`--info`(+`-tint`)／`--line`/`--line-strong`／`--clay-ring`。字體 `--f-display/-serif/-sans/-mono`。圓角 `--r-lg/-md/-btn/-pill`。陰影 `--shadow-card/-sm/-xs`。動效 `--ease`+`--t-fast/-t`。**人格三色**：`--persona-calm`(#5C86B0)／`--persona-creative`(#C2613F)／`--persona-technical`(#8A5BAE)。

### 2.3 shadcn 變數 ↔ theme.css 對照（橋接，同 `/learn` 包 §2.3）
`--background→--bg`／`--foreground→--ink`／`--card/--popover→--surface`／`--primary→--clay`／`--primary-foreground→--on-clay`／`--secondary/--muted→--surface-2`／`--muted-foreground→--muted`／`--border/--input→--line`／`--ring→--clay-ring`／`--destructive→--bad`／成功綠`→--ok`／琥珀`→--gold`／`--radius→--r-lg`。改 `:root` shadcn 變數值即可，元件呼叫端不動。

---

## 3. RBAC 三層（核心治理契約）

真實角色（`server/routers.ts`）：**`user` | `leader` | `admin`**（rank 0/1/2）。後端守門：

| 後端 procedure 守門 | 放行角色 | 範例 procedure |
|---|---|---|
| `adminProcedure` | admin | `updateRole`/`updateQuota`/`usageLogs`/`systemStats`/`allBackgroundJobs`/`apiKeysStatus`/`allUsers` |
| `leaderOrAdminProcedure` | leader, admin | `updateAutoCreditPolicy`/`teamCostSummary`/`runAutoCreditNow` |
| `protectedProcedure` | 任何登入者 | `settings.get/update`/`agentPreferences.*`/`langsmith.status` |

**前端 RBAC（`shells/settings/rbac.ts`）＝只「提早隱藏/禁用」UI（UX 用途）；真正權限仍由後端 procedure 強制。前端放行 ≠ 後端放行。**

- `useRole()`：讀 `auth.me.role`，未登入/未知→`"user"`（最低權）。
- `roleAtLeast(role, min)`：rank ≥ 比較。
- `ADMIN_TAB_MIN_ROLE`：每個後台子分頁最低可見角色——

| 後台子分頁 | 最低角色 | 後端守門 |
|---|---|---|
| 使用者・積分（`users`） | **leader** | 列表/配額 leaderOrAdmin；**改角色 admin** |
| 內容（`content`） | admin | （唯讀統計 public，治理動作 admin） |
| 功能開關（`flags`） | admin | `settings.update` |
| 資料修復（`data-repair`） | admin | `allBackgroundJobs`（修復入口待建） |
| 稽核（`audit`） | admin | `usageLogs`/`apiKeysStatus` |

**頂層分頁可見性**：`管理後台` 分頁僅 `role ≥ leader` 顯示（user 看不到）。觀測分頁的「系統概覽/背景任務」僅 admin（langsmith 任何登入者可看）。

**三種角色看到的 `/settings`**：

| 角色 | 看得到的頂層分頁 | 管理後台子分頁 |
|---|---|---|
| `user` | 一般／生成引擎／代理偏好／觀測（僅 LangSmith） | 看不到管理後台 |
| `leader` | ＋管理後台 | 使用者・積分（可調配額/自動給點，**不可改角色**） |
| `admin` | 全部 | 使用者・積分（含改角色）／內容／功能開關／資料修復／稽核；觀測含系統概覽/背景任務 |

> 實作鐵則：非 admin 的 admin-only query **設 `enabled: isAdmin` 不發請求**（如 `apiKeysStatus`/`systemStats`/`allBackgroundJobs`）；leader 在「使用者・積分」分頁裡，改角色 `<select>` 設 `disabled={!isAdmin}`＋tooltip「僅管理員可改角色」。

---

## 4. 路由地圖（canonical 路徑 + `?sub=` 分頁同步）

`/settings` 富首頁 `SettingsHome` 聚合五分頁（shadcn `<Tabs>`，`?sub=` 同步）。管理後台分頁依角色動態增刪。

| canonical 路由 | 預設分頁 | 內容 |
|---|---|---|
| `/settings` | `general` | 富首頁（五分頁聚合） |
| `/settings/agent` | `agent` | 代理偏好 |
| `/settings/admin` | `admin` | 管理後台（舊 `/admin` redirect 落點；僅 leader/admin） |
| `/settings/ai-brain` | →redirect | 內部轉址 `/settings/admin`（死別名收斂） |
| `/settings/admin/api-usage` | （re-home） | `AdminApiUsagePage`（既有 rich 頁，不重寫） |
| `/settings/admin/brain-pipeline` | （re-home） | `AiBrainPipelinePage`（全站大腦圖，不重寫） |

**五個分頁 key（URL 契約）**：`general`／`provider`／`agent`／`obs`／`admin`（admin 僅 leader+ 出現）。

```
            ┌─────────── SpineChrome（脊椎頂欄，四 shell 共用）───────────┐
            │  active-project 切換 · 全域搜尋/代理 · credits · 通知        │
            └────────────────────────────────────────────────────────────┘
 /settings ── ⚙ 設定 ─────────────────────────────────────────────────────
 ┌──────────────────────────────────────────────────────────────────────┐
 │ .subtabs：[⚙一般][✋生成引擎][🧠代理偏好][📊觀測][🛡管理後台(leader+)]    │
 ├──────────────────────────────────────────────────────────────────────┤
 │  general: GeneralSettingsPanel   provider: ProviderPanel               │
 │  agent: AgentPrefsPanel          obs: ObservabilityPanel               │
 │  admin: AdminPanel → [使用者・積分][內容][功能開關][資料修復][稽核]      │
 └──────────────────────────────────────────────────────────────────────┘
```

**舊路徑相容導向（P0 `NavigateRedirect`）**：`/admin`→`/settings/admin`；`/settings/ai-brain`→`/settings/admin`；`/account-settings`→`/settings`（帳號併入一般，盤點建議刪孤島）；`/admin/api-usage`→`/settings/admin/api-usage`；`/admin/brain-pipeline`→`/settings/admin/brain-pipeline`。**架構 §系統④的子模組（連接器/ACL、體驗開關、回饋）** 併入：帳號→一般；連接器/ACL→管理後台（或內容相鄰）；體驗開關（FocusFlow/Ambient/Onboarding）→功能開關（執行時旗標）；回饋→深頁 re-home（`/learn/feedback` 或保留 `/feedback`）。

> **個人化＝一般分頁（實站頭像選單）**：director.today 左下頭像選單的個人化控制（**導覽列樣式 Dock/緊縮側欄/完整側欄、顯示密度 緊湊/舒適/寬鬆、導覽列位置 靠左/置頂/靠右/置底、沉浸模式、最小化導覽列、重新開始導覽**）收進**一般分頁的「導覽 / 個人化卡」**（見 `01` A-(2)），backing＝脊椎 `PersonalSettingsContext`/`SiteOnboardingContext`，**即時生效、不走功能旗標**（功能旗標是站台級治理，個人化是使用者級 chrome 偏好，兩者分開）。頭像選單導覽項：首頁→`/`、個人設定→`/settings`、未整理區域→`/unorganized`、管理後台→`/settings/admin`。

---

## 5. 旗標矩陣（建置時 Vite env + 執行時治理旗標）

### 5.1 `ENABLE_4SHELL` 說明（**brief 指定**）
`VITE_ENABLE_4SHELL`（`config/featureFlags.ts`，預設 **OFF**）＝**4-shell 重整的總開關**：
- **OFF（線上預設）**：`App.tsx` 的 `<Router>` 完全照舊，**不掛任何 `/video|/social|/learn|/settings` shell、不啟用任何舊→新相容導向**。行為與線上**逐字元一致**（零行為改變）。
- **ON**：`ShellRoutes()` 注入四個 shell 掛載點 + 舊路徑相容導向。
- 為何用 `import.meta.env` 而非 DB：P0 是「純前端、零後端改動」，旗標須在不碰 server/DB 下可切；**日後（即本 shell 的管理後台治理）可把 readFlag 來源換成 `system_settings`，呼叫端不動**。這正是「功能開關」分頁的設計目標（見 `03`）。

### 5.2 `/settings` 開關矩陣
| `VITE_ENABLE_4SHELL` | `VITE_SHELL_SETTINGS_RICH` | `/settings` 行為 |
|:--:|:--:|---|
| OFF（線上預設） | — | 不掛 shell，舊 `/settings`、`/admin` 原頁照舊（**零行為改變**） |
| ON | `0` | P0 `ShellFrame`：re-home 既有 SettingsPage/AgentPreferencesPage/AdminPage… |
| ON | `1`（預設） | **富 shell**：五分頁＋provider 切換＋RBAC 管理後台 |

### 5.3 生成 Provider 旗標
`GENERATION_PROVIDER = hf | gemini | fal`（架構 §6 B 案，per-引擎切換）；`SpineProvider` 另含 `mock`（離線兜底）。HF 預設、**Gemini 並列（B 案）**、fal 回退、mock 兜底。見 `01` ProviderPanel。

### 5.4 執行時治理旗標（功能開關分頁寫入）
寫 `settings.extraSettings.featureFlags`：`research`／`byomcp`／`ambient`／`focusFlow`／`onboarding`。見 `03` FeatureFlagsTab。

---

## 6. 全域狀態與跨分頁 UX（所有分頁共用）

1. **載入**：`.skel`/`<Skeleton>` 骨架（系統概覽 4 格、使用者列 5 條、金鑰 6 格、背景任務 4 條）；標題計數「…」。
2. **空**：`.state` 置中或行內「無 X（或未登入/需管理員）」，誠實標因。
3. **錯誤**：query `retry:false`；未登入/無權→行內 `--bad`「需登入/需管理員權限」而非轉圈。
4. **長內容**：使用者列 `max-h-[28rem]`、日誌/任務 `max-h-72/80` 內捲；分頁/篩選收斂。
5. **權限（核心）**：見 §3 RBAC。前端隱藏 + `enabled:` 不發請求；後端強制。
6. **儲存模式**：一般設定用**本地草稿 + 明確「儲存」按鈕**（可「還原未儲存變更」）；其他（provider/persona/配額/角色/旗標）為**即時 mutation + toast**。

**通則**：頂部標題「⚙ 設定」+ 副標「統管全站四 shell：外觀 / 生成引擎 / 代理 / 觀測 / 治理」。`.subtabs` 可換行；窄螢幕雙欄收單欄；焦點環 `--clay-ring`；reduced-motion 尊重；數值本地化（`toLocaleString/DateString("zh-TW")`）。

---

## 7. 保留原系統聲明（strangler-fig）

- **純前端、只加不刪**：新增 `shells/settings/*`（14 檔，settings 補丁已列）；既有 router/表/路由/頁面**一個都不動**。
- **零後端改動**：全部打既有 procedure；provider 切換走 SpineProvider（記憶體）+ 選配 `settings.update` extraSettings（未登入失敗不影響本機切換）。
- **可一鍵退回**：`VITE_SHELL_SETTINGS_RICH=0` → P0 ShellFrame；`VITE_ENABLE_4SHELL=0` → 整個 4-shell 關閉回線上。
- **RBAC 前端不取代後端**：所有 admin 動作即使前端被繞過，`adminProcedure`/`leaderOrAdminProcedure` 仍擋下。
- **深頁維持 parity**：`AdminApiUsagePage`/`AiBrainPipelinePage` 用既有頁 re-home，**不重寫**。
- **誠實標待建**：`admin.dataRepair` 不存在→資料修復分頁誠實標「待建」、按鈕禁用（見 `03`），不假裝有不存在的 procedure。

---

## 8. 里程碑交付索引

- **M1**（本檔）：總覽＋設計契約＋RBAC＋路由/旗標（含 ENABLE_4SHELL）/全域狀態。
- **M2**（`01`–`02`）：一般/生成引擎、代理偏好/觀測 逐頁規格。
- **M3**（`03`）：管理後台 RBAC 五子分頁＋API 金鑰管理 UX（無真實金鑰）。
- **M4**（`04`）：microcopy 字串表＋route/procedure 對照＋RBAC 對照＋一致性驗證。

> 每個里程碑以 `present_files` 交付。本包**只動 `shell-settings/`**。
