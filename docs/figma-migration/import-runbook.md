# Healing Studio → Figma 匯入總運行手冊（Import Runbook）

> ⚠️ **修正紀錄（2026-07-03，尚待訂正後採用）**——本文由多代理草擬，完整性批判代理事後抓到數個載重錯誤，採用前務必依此更正：
> 1. **html.to.design「Import from URL」是雲端伺服器端 render，連不到 `localhost`**。§2 Path B（desktop plugin 抓 localhost preview）不成立。抓 localhost / 登入牆內 / 關掉 onboarding 的頁面，需用其**搭配的瀏覽器擴充**（本機 DOM 擷取），或把站暴露成公開 URL（Path A / tunnel）。
> 2. **onboarding 蓋版抑制在 URL 匯入下無效**——localStorage 種 key 只對本機 DOM 擷取有用；伺服器端 render 讀不到你的 localStorage。只有 orb modal 靠 `VITE_ENABLE_ORB_ONBOARDING=0` 編譯掉。
> 3. **`route-manifest.csv` 目前沒有 skip/redirect 欄**——§3「照 manifest 逐頁匯入」會把 13 條轉址路由（/vault、/calendar、/history…）也匯進去，與 §4.2 的 SKIP 矛盾。需先補欄或以 §4.2 為準。
> 4. **`SHOT_ONLY` 對 plugin 無效**——它只影響 Playwright 截圖腳本；動態 `:id` 路由要在擷取端手動導航取解析後 URL。
> 5. **§3 的擷取選項 UI（4s 等待等）未經證實**；§4 表頭數字不自洽（32/12/3/1/2=50 vs 41 列 / 54 路由）。
> 6. **Path A 公開暴露風險被低估**——旗標開啟期間，Render 站對**每個訪客**自動登入為合成 `capture@example.com` 並可瀏覽全 dashboard、觸發真後端查詢；等同短暫開放存取。
> ✅ 經證實正確：`.aidv-kit` token 衝突（AIDV-971，import-blocking）、`dist/public` 確為 capture build、`VITE_FIGMA_CAPTURE`/`VITE_ENABLE_ORB_ONBOARDING` 行為。

> 本文原意是把 **healing-studio** 1:1 帶進 Figma 的自足指南：用 desktop 版 **html.to.design** 外掛逐頁抓取，再與既有的 **43 個 Figma Variables**（設計系統檔）對帳。
> 相關前置文件：`docs/figma-migration/README.md`、`docs/figma-migration/capture-and-deploy.md`、`docs/figma-migration/decisions-and-audit.md`、`docs/figma-migration/route-manifest.csv`。
> 目標設計系統檔：**Healing Studio · Design System**（`fileKey NhDt6VmAqNhuI4coDxZ41X`；24 color + 12 spacing + 7 radius = 43）。
> 公開部署：`https://healing-studio.onrender.com`。

---

## 1. TL;DR：兩條路，先選一條

把整站 1:1 進 Figma 有**兩條互補的路**。它們解決不同問題，可以並用。

| | 路徑 A — html.to.design（live URL） | 路徑 B — 82 張本地截圖（已交付） |
|---|---|---|
| **產物** | **可編輯的 Figma 圖層**（文字、方框、auto-layout 節點） | **像素級 PNG 參照**（每頁 viewport + full-page，2x） |
| **能否綁 Variable** | 能——匯入後可手動綁 43 個 Variables | 不能——PNG 是扁平像素 |
| **成本／限制** | 免費版**限流**（歷史上約每月數十次 URL 匯入），需付費或分批 | **零額度、零升級、無限制** |
| **保真度** | 版面/樣式近似；字型與換行會漂移；WebGL/canvas 會被壓平 | 100% 像素還原（含 orb 動畫的定格） |
| **前置** | 需要一個**無登入可 render** 的 URL（見 §2） | 已用 `scripts/figma-screenshots.mjs` 產出 `/tmp/figma-shots/*.png` |
| **何時用** | 要做**可編輯的設計稿 / 綁 token / 重排版** | 要**逐頁 1:1 視覺比對**、或當 orb 等 canvas 頁的底圖 |

**建議工作流：** 先把 **82 張截圖**當作全站 1:1 視覺真值（拖進 Figma 一個 `Reference` 頁即可，完全免費）；再對「真正要在 Figma 裡編輯 / 綁 token 的重點頁面」用 **html.to.design** 逐頁匯入，並把對應截圖墊在底層當比對基準。canvas/orb 頁（見 §4）則**只能**靠截圖，DOM 匯入的 canvas 會是空白或單張定格。

> 82 = 41 個靜態路由 × 2（viewport + full-page）。截圖已由 capture build（`VITE_FIGMA_CAPTURE=1 VITE_ENABLE_ORB_ONBOARDING=0`）＋ Playwright 產出，詳見 `capture-and-deploy.md`。

---

## 2. 前置：讓 URL 無登入也能 render

html.to.design 外掛**只能抓一個登出瀏覽器看得到的畫面**。Healing Studio 幾乎每一個 dashboard 外殼路由都在登入牆內——`DashboardLayout.tsx:485` 直接以 `user` 為條件 gate 整個 render，所以**任何 DashboardRoute / ProtectedDashboardRoute 頁面在原始公開部署上都不會 render，會被彈回登入 orb**。匯入前，你必須先讓 `useAuth` 回傳合成的 capture 使用者、並關掉 orb onboarding 蓋版。二選一：

### 路徑 A — 在 Render 服務上翻旗標（匯入 live URL）
1. 進 Render `healing-studio` 服務 → **Environment**，新增：
   - `VITE_FIGMA_CAPTURE=1`
   - `VITE_ENABLE_ORB_ONBOARDING=0`
2. 觸發一次**手動 redeploy**。Vite 在 **build time** 烘進這些旗標，**單純 restart 不會生效，必須重新 build/deploy**。
3. 部署完成後到 `https://healing-studio.onrender.com/dashboard` 確認：應直接 render 外殼，而不是彈回登入 orb。
4. 安全性：`VITE_FIGMA_CAPTURE=1` 只是把 `useAuth`（見 `client/src/_core/hooks/useAuth.ts`，約第 44–66 行）換成一個假的 `capture@example.com` 使用者，**不帶任何真實 session**。
5. ⚠️ **匯入完成後務必移除這兩個旗標並 redeploy**，避免 production 長期停在 capture 模式。

### 路徑 B — 本地起 capture bundle（完全不碰 prod）
capture build 產物已存在於 `dist/public`（`index.html` + assets）。當靜態 SPA 起服務，把 html.to.design 指向 `http://localhost:<port>`：

```bash
# 從 repo 根目錄
npx vite preview --outDir dist/public --port 4173 --host
# 或任何有 SPA fallback 的靜態伺服器
npx serve -s dist/public -l 4173
```

到 `http://localhost:4173/studio` 確認外殼有 render。若 `dist/public` 過舊或缺頁，先重 build：

```bash
VITE_FIGMA_CAPTURE=1 VITE_ENABLE_ORB_ONBOARDING=0 npx vite build
```

> **重點：`localhost` 只有 html.to.design 的 desktop-app 外掛（同機）看得到。** 瀏覽器版外掛看不到 localhost——那就走路徑 A，或用 `cloudflared` / `ngrok` 開通道對外暴露本地伺服器。

### onboarding 蓋版
`scripts/figma-screenshots.mjs` 會透過 `localStorage`（tour keys、`orb-onboarding-skipped`、`home-onboarding-*`）壓掉導覽 modal，但 **html.to.design 不會跑那段 init**。若首載跳出 orb/tour modal 蓋住畫面：先在同 origin 的正常瀏覽器分頁把它關掉（外掛共用該 origin 的 storage），再重新匯入。

---

## 3. 逐步：用 html.to.design 匯入每個路由

1. **在 Figma desktop 安裝外掛。** Figma 桌機版 → **Menu → Plugins → Manage plugins**，搜尋 **"html.to.design"** 安裝。用桌機版（而非瀏覽器版），才能連到 `localhost`（路徑 B），大批匯入也不會被瀏覽器分頁節流。
2. **打開目標 Figma 檔並啟動外掛。** 開好要落地的檔案 → **Plugins → html.to.design** → 選 **Import from URL**（或 **Import web page**）分頁。
3. **設定一次擷取選項：**
   - viewport **寬度 1440px**（對齊 `scripts/figma-screenshots.mjs` 的參照視窗寬）
   - 開 **full-page / capture entire page**（含摺線下內容）
   - **wait / delay ≈ 4 秒**（讓 lazy chunk 與進場動畫沉澱，對齊 capture 腳本的 4000ms settle）
   - 若有 **single frame vs. split into layers** 開關，保持 **layered import**，文字與方框才會進成可編輯節點。
4. **照 manifest 分批匯入。** 依 `docs/figma-migration/route-manifest.csv`（已含 `figma_frame_name` 欄）逐列處理：把 `https://healing-studio.onrender.com<path>`（路徑 A）或 `http://localhost:4173<path>`（路徑 B）貼進 URL 欄，匯入後把 frame 改名成 manifest 的 `figma_frame_name`（例：`/studio` → `Studio`）。**每次匯 5–10 頁一組**，單頁失敗不會卡住整批；把 frame 排在專屬頁/區塊，命名如 `Captured — <date>`。
5. **處理動態 `:id` 路由。** manifest 有 3 條動態路由無法直接匯：`/projects/:id`（ProjectDetail）、`/animation/:storyboardId`（AnimationStudio-Storyboard）、`/worldbuilding/:storyboardId`（Worldbuilding-Storyboard，實為轉址）。用 capture build 在 app 內點到一個有效詳情頁、複製解析後的實際 URL 匯入（可搭配 `SHOT_ONLY`）。frame 名沿用 manifest（去掉 `:id`）。若 capture build 無種子資料，會 render 空/skeleton 狀態——**照樣擷取並標註**，不要讓路由缺席。
6. **處理 heavy-canvas 頁。** 只有 **Home 的 `VisualSoul3D` orb** 是真正的 three.js/WebGL surface（也是**唯一**不需 capture build 就能 render 的路由）。任何 three.js/shader surface 都無法survive DOM 擷取——外掛會正確匯入周邊 DOM（chrome、面板、文字），但 canvas 會是空白或單張扁平定格。做法：DOM 照常匯入當版面，再把真實截圖（capture 腳本的 `*-full.png` / `*-viewport.png`，或手動抓）當 image fill 墊在 frame 底層，讓 reviewer 看到預期視覺。**orb 本身當佔位圖，不是可編輯圖層。**（注意：`/light-orb-studio` 的 orb 預覽是 CSS/SVG framer-motion，不是 three.js，會以靜態 DOM 匯入，只是動畫會定格——它是 auth-gated，不算 heavy-canvas。）

---

## 4. 路由逐頁策略表

全 54 條路由已對 `client/src/App.tsx` 分類。匯入切分：**32 static、12 auth-gated、3 dynamic、1 heavy-canvas、2 auth-pre-login**（其餘為動態/轉址變體）。

**兩個貫穿全表的關鍵事實：**
- **(A) 每個 dashboard 頁都需要 capture build。** `DashboardLayout.tsx:485` 以 `user` gate render，所以**所有** DashboardRoute（下表 static）**與** ProtectedDashboardRoute（下表 auth-gated）頁面都需 `VITE_FIGMA_CAPTURE=1`（`useAuth.ts:49–66` 的合成使用者）。static / auth-gated 之分僅反映程式自身的 wrapper（DashboardRoute = 開發指定較低敏感度內容；ProtectedDashboardRoute = studio），**兩者都需 capture build**。
- **(B) 13 條是純轉址、無自有 UI → 應 SKIP，直接匯目標頁**（避免重複匯入）。

### 4.1 需擷取的路由

| 路徑 | frame 名 | 類別 | 匯入備註 |
|---|---|---|---|
| `/` | Home | heavy-canvas | 唯一免 capture build 就 render 的公開路由（登入 orb 首頁）。核心是 three.js `VisualSoul3D` orb，**不會 rasterize**——匯周邊 DOM，orb 用截圖手動重建。 |
| `/create` | Create | auth-gated | ProtectedDashboardRoute（CreationHub）；capture build 讓 DashboardLayout 的 user-gate 通過後，當標準 DOM 匯入。 |
| `/playground` | Playground | auth-gated | ProtectedDashboardRoute；需 capture build；純 DOM。 |
| `/studio` | Studio | auth-gated | ProtectedDashboardRoute；需 capture build；小的 VisualSoul avatar 不會 rasterize，其餘正常匯入。 |
| `/director` | DirectorAI | auth-gated | ProtectedDashboardRoute；需 capture build；大型 chat/console DOM 正常匯入（VisualSoul avatar 除外）。 |
| `/creative-projects` | CreativeProjects | auth-gated | ProtectedDashboardRoute；需 capture build。 |
| `/projects` | Projects | auth-gated | ProtectedDashboardRoute；需 capture build；無後端時清單多半為空。 |
| `/projects/:id` | ProjectDetail | **dynamic** | ProtectedDashboardRoute；用 `SHOT_ONLY` + 真實 project id 樣本 + capture build；無後端時詳情可能為空。 |
| `/animation` | AnimationStudio | auth-gated | ProtectedDashboardRoute；需 capture build；預設（非 immersive）視圖是 DOM——EarthGlobe 背景只在 immersiveMode 掛載（非 three.js）。 |
| `/animation/:storyboardId` | AnimationStudio-Storyboard | **dynamic** | ProtectedDashboardRoute；需 storyboard id 樣本 + capture build。 |
| `/assets` | AssetsLibrary | static | DashboardRoute；仍需 capture build（DashboardLayout gate user）；vault/history/tasks/prompts/collection 都併到這裡以 `?section=` 呈現。 |
| `/models` | Models | static | DashboardRoute（ModelsPage）；需 capture build；標準 DOM（也是 `/lora-trainer` 轉址目標）。 |
| `/shared` | SharedSpace | static | DashboardRoute；需 capture build；保留為直接入口（team-share / send-to-studio），非轉址。 |
| `/notes` | Notes | static | DashboardRoute；需 capture build；也是 `/calendar` 轉址目標。 |
| `/dashboard` | Dashboard | static | DashboardRoute；需 capture build；也以 `?section=` 承載 langsmith/credits。 |
| `/feedback` | Feedback | static | DashboardRoute；需 capture build；標準 DOM。 |
| `/settings` | Settings | static | DashboardRoute；需 capture build。 |
| `/settings/agent` | Settings-Agent | static | DashboardRoute（AgentPreferencesPage）；需 capture build。 |
| `/admin` | Admin | static | DashboardRoute；需 capture build；tabs 依 `user.role` gate，合成 capture 使用者**無 role**，故 admin tabs/資料 render 與真實 admin 不同，allUsers 查詢無後端時為空。 |
| `/admin/api-usage` | Admin-ApiUsage | static | DashboardRoute；需 capture build；無後端時圖表/表格空。 |
| `/admin/brain-pipeline` | Admin-BrainPipeline | static | DashboardRoute；需 capture build；PipelineCanvas 是 DOM/SVG（正常匯入）；pipeline 資料無後端時空。 |
| `/my-brain` | MyBrain | auth-gated | ProtectedDashboardRoute；需 capture build。 |
| `/pro-studio` | ProStudio | auth-gated | ProtectedDashboardRoute；需 capture build。 |
| `/image-studio` | ImageStudio | auth-gated | ProtectedDashboardRoute；需 capture build。 |
| `/light-orb-studio` | LightOrbStudio | auth-gated | ProtectedDashboardRoute（orb 客製器）；需 capture build；orb 預覽是 CSS/SVG framer-motion（非 three.js），以靜態 DOM 匯入但動畫會定格。 |
| `/video-studio` | VideoStudio | auth-gated | ProtectedDashboardRoute；需 capture build。 |
| `/learn` | Learn | static | DashboardRoute（LearnHub）；需 capture build。 |
| `/tutorial-overview` | TutorialOverview | static | DashboardRoute；需 capture build。 |
| `/ai-models-hub` | AiModelsHub | static | DashboardRoute；需 capture build。 |
| `/model-wishlist` | ModelWishlist | static | DashboardRoute；需 capture build。 |
| `/focus-flow` | FocusFlow | static | DashboardRoute；需 capture build；ambient 背景是 CSS/framer-motion（非 webgl），匯入定格成一張。 |
| `/agent` | Agent | static | DashboardRoute（AgentChat）；需 capture build；小 VisualSoul orb avatar 不 rasterize，頁面 DOM 正常。 |
| `/codex` | Codex | static | DashboardRoute（AgentCodexPage）；需 capture build。 |
| `/teaching-archive` | TeachingArchive | auth-gated | ProtectedDashboardRoute；需 capture build。 |
| `/teams` | Teams | auth-gated | ProtectedDashboardRoute；需 capture build。 |
| `/unorganized` | Unorganized | static | DashboardRoute（UnorganizedArea）；需 capture build。 |
| `/forgot-password` | ForgotPassword | auth-pre-login | 獨立頁（無 DashboardLayout、無 auth guard）；公開部署上免 capture build 直接 render，直接匯入，不需合成使用者。 |
| `/reset-password` | ResetPassword | auth-pre-login | 獨立頁；讀 `?token=` 並對後端驗證，需**有效樣本 token + live 後端**才顯示重設表單，否則 render invalid-token 狀態；在公開部署上直接匯入。 |
| `/account-settings` | AccountSettings | auth-gated | 獨立（無 dashboard 外殼）但呼叫 `useAuth({redirectOnUnauthenticated:true})`，未登入者被彈回登入——需 capture build 的合成使用者才 render。 |
| `/process` | Process | static | 獨立 `ProcessViewerPage`；無 auth guard，公開部署免 capture 直接 render；讀 URL query param，傳個樣本才有內容。 |
| `/404` | NotFound | static | 直接 render（無 layout、無 auth）；公開且簡單，任何 build/部署都可匯。 |

### 4.2 應 SKIP 的純轉址路由（13 條，匯目標頁即可）

| 轉址路由 | → 目標（匯這個） |
|---|---|
| `/worldbuilding` | → `/animation` |
| `/worldbuilding/:storyboardId` | → `/animation/:storyboardId`（用樣本 id） |
| `/vault` | → `/assets?section=vault` |
| `/history` | → `/assets?section=history` |
| `/background-tasks` | → `/assets?section=tasks` |
| `/prompt-library` | → `/assets?section=prompts` |
| `/prompt-collection` | → `/assets?section=collection` |
| `/calendar` | → `/notes` |
| `/settings/ai-brain` | → `/admin` |
| `/learn/tutorial-overview` | → `/tutorial-overview` |
| `/lora-trainer` | → `/models` |
| `/langsmith` | → `/dashboard?section=langsmith` |
| `/credits` | → `/dashboard?section=credits` |

> `route-manifest.csv` 為求完整仍列出這些轉址列（`figma_frame_name` 如 `Vault`、`Calendar`），但匯入時**跳過它們、只匯目標頁**，避免重複 frame。

---

## 5. 對帳：把匯入圖層綁到 43 個 Figma Variables

匯入落地的是**生值**——hex 填色、px padding、px radius，與 **Healing Studio · Design System**（`fileKey NhDt6VmAqNhuI4coDxZ41X`：24 color + 12 spacing + 7 radius）**毫無連結**。必須手動綁。

### 5.1 綁定流程
1. **啟用 library。** 目標檔 → **Assets → Libraries**（或 **Variables**）→ 啟用 Healing Studio · Design System，43 個 variable 才會出現在 picker。
2. **綁顏色。** 選一個匯入 frame，開右側 **Selection colors** 面板看見選取上每個不同的 fill/stroke。逐一點開 → 在色值欄從 hex 切到 **variable picker** → 選對應 `color/*`（`color/background`、`color/primary`、`color/card`、`color/muted`、`color/accent`、`color/destructive`、`color/border`、`color/ring`、`color/chart-1..5` 等）。**按值配對**——匯入的 hex 告訴你它原本是哪個 token。
3. **綁 spacing 與 radius。** auto-layout frame：把 **padding** 與 **item spacing** 綁到 `spacing/space-1..12`（4/8/12/16/24/32/48/64/96/128/160/192px）；corner radius 綁到 `radius/sm..full`。每個數值欄旁的 variable 圖示逐欄設定。

### 5.2 ⚠️ 值配對時當心 `.aidv-kit` scope 衝突（最易錯的一步）
因為 `.aidv-kit` 把 `--muted`、`--surface-2`、`--surface-3` 重定義成與 global `:root` **不同**的值（見 `client/src/components/design-kit/README.md` 與 `design-kit.css`），**同一概念 token 在頁面上會以兩種 hex 出現**，取決於該圖層是否落在 design-kit 區域內。**不要假設一個 hex 只對應一個 variable 名**——先判斷該擷取圖層是否來自 `.aidv-kit` surface，再決定該綁 `color/muted`（surface）還是 `color/muted-foreground`（gray text）。詳見 §6-A。

### 5.3 spacing / radius 的刻度陷阱（匯入時直接會踩到）
- **Tailwind 索引 ≠ Figma 刻度（過 space-4 後發散）。** Tailwind `gap-6/px-6/py-6 = 24px` 對到 **`spacing/space-5`**（`space-6` 是 32px，別綁錯）。shadcn Card 全用 24px → `space-5`。
- **off-scale 值沒有 token：** 2px（`py-0.5`）、3px（`p-[3px]`）、6px（`gap-1.5`/`py-1.5`/`p-1.5`/`px-1.5`）都**不在** 4/8/12 刻度上，無 token 可綁——留生值並記錄。
- **radius 對照：** `rounded-sm..3xl` = 12/14/16/20/24/32px + full。**Checkbox 的 `rounded-[4px]`** 與**所有 design-kit primitive**（`rounded-[9/10/12/16px]`）繞過 radius 刻度（`radius/sm`=12px 太圓），需要新的 `radius/xs` token 或設計決策。

### 5.4 元件 → Variable 對照（20 個 shadcn ui + 8 個 design-kit）

**顏色可乾淨綁定：** 24 個 `color/*` 是 shadcn `:root` token 的 1:1 clone，所以 shadcn 填色綁得乾淨，variant 軸只是切換用哪組 `color/*` pair。

**shadcn ui 元件（檔案皆在 `client/src/components/ui/`）：**

| 元件 | 主要 variables | 衝突風險 | 重點 gap |
|---|---|---|---|
| **Button** `button.tsx` | primary(+fg)/secondary(+fg)/destructive/accent/foreground/border/input；space-2/3/4/5；radius/md | 否 | focus ring 用 `--ring-healing`（violet）非 `color/ring`；destructive 標籤硬寫 `text-white`；`sm gap-1.5`=6px off-scale |
| **Badge** `badge.tsx` | primary/secondary/destructive/accent(+fg)/foreground/ring/border；space-1/2；radius/full | 否 | 用 `color/ring` focus（與 Button 不同）；destructive 文字硬寫 white；`py-0.5`=2px off-scale |
| **Card** `card.tsx` | card(+fg)/border；space-2/5；radius/2xl | **是** | tone=glass 套 `.surface-2`、tone=raised 套 `.surface-3`→ `.aidv-kit` 內是不透明暖白，非 global 半透明玻璃 |
| **Input** `input.tsx` | input/muted-foreground/primary(+fg)；space-1/3；radius/md | 否 | focus 用 `--ring-healing`（violet），非 `color/ring` |
| **Textarea** `textarea.tsx` | input/muted-foreground/ring/destructive；space-2/3；radius/md | 否 | focus 用 `color/ring`（與 Input 不同） |
| **Dialog** `dialog.tsx` | background/border/accent/muted/muted-foreground；space-2/4/5；radius/2xl/full | **是** | overlay `bg-black/50` 硬寫（無 token）；close-btn `hover:bg-muted` 讀 `--muted`→ `.aidv-kit` 內衝突 |
| **Select** `select.tsx` | input/muted-foreground/ring/popover(+fg)/accent(+fg)/border；space-1/2/3/6；radius/md/xl/sm | 否 | item/label `py-1.5`=6px off-scale；無 `bg-muted` → `.aidv-kit` 安全 |
| **Tabs** `tabs.tsx` | muted/muted-foreground/background/foreground/input/ring；space-1/2；radius/xl/lg | **是** | TabsList `bg-muted` 在 `.aidv-kit` 內解析成 design-kit 灰字；`p-[3px]`/`gap-1.5` off-scale |
| **Tooltip** `tooltip.tsx` | foreground/background；space-3；radius/lg | 否 | 反色 surface；`py-1.5`=6px off-scale |
| **Switch** `switch.tsx` | primary/input/ring/background/foreground/primary-fg；radius/full | 否 | 尺寸固定，無 spacing token |
| **Checkbox** `checkbox.tsx` | input/primary(+fg)/ring/destructive | 否 | radius `rounded-[4px]` **硬寫**，無 `radius/*` 合適 → 需 `radius/xs` |
| **RadioGroup** `radio-group.tsx` | input/primary/ring/destructive；space-3；radius/full | 否 | — |
| **Toggle** `toggle.tsx` | muted/muted-foreground/accent(+fg)/input/ring/destructive；space-2；radius/md | **是** | `hover:bg-muted` 在 `.aidv-kit` 內讀 `--muted`；px 6/10 off-scale |
| **Slider** `slider.tsx` | muted/primary/ring/card/border；radius/full | **是** | track `bg-muted` 在 `.aidv-kit` 內解析成灰字 token |
| **Progress** `progress.tsx` | primary；radius/full | 否 | 安全 |
| **Popover** `popover.tsx` | popover(+fg)/border；space-4；radius/xl | 否 | — |
| **DropdownMenu** `dropdown-menu.tsx` | popover(+fg)/accent(+fg)/destructive/muted-foreground/border；space-1/2；radius/xl/sm | 否 | `--muted-foreground` 只當文字（.aidv-kit 未重定義）→ 安全；`py-1.5` off-scale |
| **Alert** `alert.tsx` | card(+fg)/destructive；space-3/4；radius/xl | 否 | — |
| **Separator** `separator.tsx` | border | 否 | 1px，無 spacing/radius token |
| **Label** `label.tsx` | space-2 | 否 | 無自有色 token |

**design-kit primitives / composites（`client/src/components/design-kit/`）——全部在 `.aidv-kit` scope 內，皆有衝突風險：**

| 元件 | 可乾淨映射 | 無 Figma variable 的部分（platform-extension） |
|---|---|---|
| **DK Button** `primitives.tsx` | primary(+fg)/secondary/border/destructive | `--gold/--gold-bright`（gold variant）；radii `rounded-[12/10/9px]` 與 padding/height 皆 ad-hoc |
| **DK Pill** `primitives.tsx` | bad→destructive；mute→**color/muted-foreground**（非 color/muted）、secondary、border | `--ok/--gold-deep/--info`（ok/warn/info） |
| **DK Tag/Kbd/Eyebrow** `primitives.tsx` | muted-foreground/border/secondary；Eyebrow→primary | radius `rounded-[8/6px]` 硬寫；type `text-[10px]`（sub-12px，見 §6-B） |
| **DK Toggle** `primitives.tsx` | primary/secondary | thumb 硬寫 white；`--clay-ring` focus |
| **DK Meter** `primitives.tsx` | secondary/primary | `--gold`（fill 漸層一端） |
| **DK Card** `primitives.tsx` | border | `--surface`（不透明暖白 #fdfbf7）**無精確 Figma variable**（color/background=#F4EEE4、color/card 是半透明）→ 需決策 |
| **DK Input** `primitives.tsx` | border/primary/muted-foreground | `--wash`、`--muted-2`（第三種 muted，與 global 及 .aidv-kit 的 --muted 都不同） |
| **DK 複合卡** `GateCard.tsx` 等 | primary/secondary/border/muted-foreground/destructive | `--persona-*`、gold/ok/warn/info；`AidvShellChrome` 在 165–219 行把整棵子樹包進 `<AidvKit>`，繼承所有 DK alias 綁定與衝突 |

> **通則：** design-kit 元件的 `--muted` 是「灰色**文字**」語意，要綁 **`color/muted-foreground`**，**不是** `color/muted`（surface）。綁錯會把每一段次級文字漆成表面色。

---

## 6. 匯入前必修的設計問題（含修法）

> 只採信 `verified=true` 的稽核結論；下面對每項標明驗證狀態與修正後的正確數字。

### 6-A ｜`.aidv-kit` token 名稱衝突（severity: high · **verified TRUE**）— 匯入阻斷

三個 token 在兩個 scope 下有**語意相反**的值，同名不同解：

| token | global `:root`（`client/src/index.css`） | `.aidv-kit`（`design-kit.css`） |
|---|---|---|
| `--muted` | `#F1EADF` 近白**淺色表面**（line 105；另 oklch 0.94 line 277、dark oklch 0.26 line 319） | `#897f70` 次級**灰色文字**（line 28，含註解「--muted＝次級灰文字（覆蓋 app 表面義）」） |
| `--surface-2` | `oklch(0.99 0.003 75 / 0.7)` **半透明玻璃**（line 184） | `#f7f1e8` **不透明**暖米 |
| `--surface-3` | `oklch(0.99 0.003 75 / 0.85)` **半透明玻璃**（line 185） | `#fbf7f0` **不透明**暖白 |

消費證據（皆已驗證）：`ShotCard.tsx:77,85,104`、`StateInspector.tsx:72,173`、`WorkflowBuilder.tsx:49,75`、`atoms.tsx:95` 讀 `text-[var(--muted)]` 期待灰字義；而 app 其餘部分在 **164 個 tsx 檔**以 `bg-muted` 讀同一 token 當 surface。`.aidv-kit` scope 由 `<AidvKit>` wrapper / `className="aidv-kit"` 啟用（嚴格 opt-in **56 檔**，全 footprint 102 檔——README 的「~95」只是概略）。

> **引用微瑕（不改結論）：** `design-kit.css` 中 `--surface-2` 實為 **line 21**、`--surface-3` 為 **line 22**（line 20 是 `--surface:#fdfbf7`，不在衝突內）；`--muted` line 28 正確。

**為何阻斷匯入：** 一個 Figma Variable 只是一個 global 名稱綁定（頂多 Light/Dark 兩 mode），**無法編碼「在子樹 X 內是 #897F70 灰字、在其他地方是 #F1EADF 近白表面」**。既有 DS 只有一個 `color/muted`，importer 只能二選一：全塌成一值（漆錯每段 design-kit 次級文字 **或** 每個 global muted 表面），或分叉成兩個不同名 variable、偏離 canonical 43。`--surface-2/3` 同理（不透明 hex vs 半透明玻璃，光 alpha 差異就改變每個層疊面板）。此外，**任何未在 `.aidv-kit` 祖先下 render 的 design-kit 元件**，`var(--muted)` 會解析成近白 global 表面，其次級文字在 importer 拍的畫面裡幾乎看不見。

**修法（擇一，程式層而非 Figma 層）：**
1. **改名分叉（推薦）：** 把 design-kit 的灰字 token 從 `--muted` 改名為 `--dk-text-2`（或直接用既有 `color/muted-foreground` 語意），`--surface-2/3` 在 design-kit 內改名 `--dk-surface-2/3`。之後 global `--muted` 對 `color/muted`、design-kit 灰字對 `color/muted-foreground`，一對一乾淨。
2. **統一語意：** 讓 design-kit 停止重定義這三個 token，改吃 global 值——但需檢查每個消費點視覺不破。
3. **短期繞過（僅供本次匯入）：** 綁定時人工判斷圖層 scope（§5.2），design-kit 灰字一律綁 `color/muted-foreground`。

### 6-B ｜sub-12px 字型氾濫、無型別 token（severity: high · claim verified，**部分聚合數字需更正**）

DS **零 font-size Variable**（43 = 24+12+7），而 sub-12px 字型到處都是且用 ad-hoc 任意 px。`--text-2xs: 0.625rem`(10px, index.css:67)、`--text-3xs: 0.5625rem`(9px, :69) 只 back 了約 108 個具名用法，其餘 ~2,559 個 `text-[Npx]` **無任何 token**。

**已驗證正確：** 檔案數 `text-[10px]`=192、`text-[11px]`=167、`text-[9px]`=61、`text-[8px]`=11、`text-[7px]`=2、`text-2xs`=5、`text-3xs`=2；去重 **201 檔 ≤10px**（含 11px 則 233 檔）。最嚴重：AnimationStudio(246)、OrbGuidePanel(212)、AIModelsHub(110)、DirectorAI(107)、OrbUnifiedAssistant(105)、ImageStudio(83)、ProStudio(76)。

> **更正兩個被低估的總數：** 原稱「2,578 個 sub-12px」→ **實為 2,667**（含 `text-[7px]`=3）；原稱「~1,675 個 ≤10px」→ **實為 1,764**。方向結論（極度氾濫、無 DS token）不變，且比原述更強。

**匯入影響：** 因為 DS 無型別 variable，這 ~2,667 個尺寸全部匯成**脫離的一次性字級**而非共享文字樣式，file 被上百個無法重綁的獨特 text style 淹沒；且 9/10/11px 低於可靠可讀性——headless 擷取瀏覽器與 Figma renderer 的 sub-pixel hinting / min-font floor 不同，微字會在匯入時 reflow/rewrap，破壞最密頁面（AnimationStudio、OrbGuidePanel、model/hub 頁）的精確度。

**修法：** 在**程式/token 層**建立一組 type-scale token（如 `--text-xs`=12px 為地板，並定義 2xs/3xs 為刻度成員），把 `text-[Npx]` 收斂到刻度；**不要在 Figma 逐圖層改**。匯入時只**記錄**這些微字供型別重整，不在 Figma 內修。

### 6-C ｜硬寫 hex 洩漏（severity: medium · claim 方向對，**證據多處高估/錯類，holds=false**）

**方向結論成立：** 大多數 hex 是合法的內容資料 / 漸層 / 登入 carve-out，只有少數是真正的 token 洩漏。但原證據的數字與分類有多處可獨立驗證的錯：

**已驗證正確：** `LoginCosmicScene`（39 hex 全在漸層字串內，`.login-cosmic` carve-out 真實，index.css:262+，不在範圍）；`CharacterVisualPreview`(28)、`SceneEnvironmentPreview`(19) 是色票資料；`SettingsPage`(23) 是主題預覽 `linear-gradient` 縮圖；「className 內 Tailwind 任意值 hex 只出現在 2 檔（ManusDialog、LightOrbCreationStudio）」**完全正確**；ManusDialog 硬寫中性色 dialog、PortfolioDetailDialog 的資料/chrome 拆分確認。

**更正（原證據錯處）：**
- **top-line 應為 39 檔 / 370 次**（非 38/368），且部分「hex」根本不是顏色——是 React error code / PR 號的註解誤判（`ErrorBoundary.tsx` #185/#300、`AppleDock.tsx` #300、`VaultPage.tsx` PR #680、某 ProactiveOrbWidget 註解 #300、`OrbCreationStage.tsx:346` #FFB454 是文案）。
- **canvas 理由對 3 個檔是錯的**：`AvatarStudio`(16) 是 `background:linear-gradient(...)` 頭像**預設縮圖**渲進 DOM（非 shader）；`AmbientOrb`(9) 是 on-DOM inline SVG（`<stop stopColor>`、`<circle fill>`…，importer **看得到**）；`PipelineCanvas`(4) 是純 status→color map，皆非 canvas。真正餵 canvas 的只有 `VisualSoul3D`。
- **`AgentBlueprint` 被低估**：宣稱 4，實為 **10** 個 `color:"#fff"` inline chrome 洩漏。
- **遺漏的真洩漏檔**：`ProactiveOrbWidget.tsx`（inline status 色 #ef4444/#22c55e/#ec4899）、`ZenCoPilot.tsx`（inline 漸層 #D4C5E2/#C8D5E0/#EAC9C1）。
- **錯類**：`LangSmithPage`(20)、`DashboardPage`(15) 全是 **Recharts 系列/軸色**（繞過 `chart-1..5` token），是洩漏但**非 plain-UI chrome**，原文以縮減計數（8、5）塞進 chrome 桶，~35 個 chart hex 被錯標/低估。

**修正後的洩漏集：** 「52 次 / 9 檔」是**低估**。純 UI / inline chrome 洩漏 ≈ **55 次 / ~10 檔**（OrbCreationStage ~23、AgentBlueprint 10、ManusDialog 5、PortfolioDetailDialog 3、PersonalityContext 3、ProactiveOrbWidget 3、ZenCoPilot 3、LightOrbCreationStudio 1、DashboardLayout 1）；若把繞過 chart token 的 series 色也算（LangSmith 20 + DashboardPage 15 + AdminApiUsagePage 8 + PipelineCanvas 4 status map = 47），token-bypass 總量 ≈ **100+ 次 / ~14 檔**。

**匯入影響與修法：** 這些 chrome/chart 洩漏匯成固定 literal fill，對到脫離的 Figma 顏色而非 24 個 `color/*`（或 `chart-1..5`），不會隨 DS 重上色、也不會塌成共享 Variable——ManusDialog 的四色中性組是最清楚的例子。**修法：** 把 plain-UI/chrome 洩漏改吃 `color/*` token、chart 系列色改吃 `chart-1..5`；其餘 ~316 個合法 literal（canvas/3D、登入 carve-out、色票與主題預覽資料）**排除在洩漏計數外**，強套 token 反而錯。匯入時對真洩漏留生值並登記——它們正是本次遷移要 surface 的 bypass 案例。

---

## 7. html.to.design 的誠實限制

- **免費版限流。** URL 匯入計次（歷史上約每月數十次），低於本站 ~53 路由 + 重匯需求。**先在外掛內確認當前上限**，再決定分批（跨數天）、升級付費、或只優先做重點頁。
- **Rasterize/近似擷取。** WebGL canvas、`<video>`、live shader、重 CSS 效果會被壓平、丟棄或擷成單張定格——orb 頁是最明顯的犧牲者（故有 §3-6 的截圖 fallback）。
- **字型與版面漂移。** web font 無法解析時會替換成 Figma 預設；位置/auto-layout 由 render 的 box model 推斷，像素對齊與換行會與線上略異，匯入後需微調 spacing。
- **零設計系統意識。** 外掛完全不知道你的 43 個 variable，**不會自動綁**任何東西。每個 color/spacing/radius 連結都手動（§5），且在 `.aidv-kit` scope 或硬寫 hex 出現處，值配對並不可靠。
- **只是狀態快照。** 每次匯入是 capture 使用者（空資料）某一瞬間——modal、hover/focus、loading skeleton、資料相依區塊，只反映擷取當下畫面，非完整狀態範圍。

> 把結果當作**忠實的版面與樣式參照**來與設計系統對帳，**不是**像素完美或可互動的 app 複製品。
