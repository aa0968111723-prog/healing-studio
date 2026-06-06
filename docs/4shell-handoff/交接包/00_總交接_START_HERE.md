# 00 · 總交接 START HERE — AI-Director / healing-studio 多代理交接包（主索引）

> **這是什麼**：把目前所有「在飛」的工作，彙整成一份**最新、一致、可直接照做**的多代理交接包。三個 AI 代理 — **Claude Design（前端 UI/UX 實作）**、**Codex（/video 旗艦深垂直 + 影片後端可靠性）**、**Antigravity（/social + /learn + Gemini/研究 + 帳務觀測）** — 各自讀完自己那份就能開工，不會踩到別人。
> **怎麼用**：先讀本檔（§A–§G）→ 把 `啟動提示詞_給三代理.md` 對應段（或整份 `交接_給ClaudeDesign.md`／`交接_給Codex.md`／`交接_給Antigravity.md`）各貼給對應代理 → 代理開工先讀 repo 根 `COORDINATION.md` + 查 GitNexus。
> **放哪**：本包 = `C:\Users\User\Downloads\AI-Director-交接包\`。**本次交付只寫這個資料夾**，不動程式碼、不動 server。
> **事實基準**：`main` HEAD `2888a36`（2026-06-04）；**PR #852 head `500a4e4d`**。React 19 / Vite 7 / Wouter 3.7.1(patched) / tRPC v11 / Drizzle（MySQL→規劃 Supabase PG）。**82 表 · 54 路由 · ~68 router 命名空間 · ~565 procedure · 50 頁**。撰寫日 **2026-06-06**（更新 2026-06-07）。

---

## A. 目前狀態（一眼看完「飛到哪」）

| 面向 | 狀態 | 說明 |
|---|---|---|
| **重構分支 / PR** | 🟡 **PR #852 已開、未合併（head `500a4e4d`）** | umbrella `feat/4-shell-restructure`，基準 main `2888a36`；本機 clone `C:\Users\User\healing-studio-dev`。總開關 `ENABLE_4SHELL` **預設 OFF**（OFF == 線上 main 行為）。 |
| **四 shell ＋ 設計系統規格** | ✅ **完成（紙上規格）** | `AI-Director-UIUX設計/` 已備：設計系統(theme.css/tokens) + 殼層 + `/video`(6 步) + `/social`(9 步＝**可設定工作流**，09 範本編輯器、**閘門與步驟解耦**) + `/learn` + `/settings` 全規格 + 實站截圖觀察 + 點按原型。**待 Claude Design 落地成真實 React 元件**。 |
| **P0–P2 前端骨架** | ✅ **已打包，待套用/已隨 PR 落地** | `AI-Director-P0補丁/`（4-shell 路由 + SpineProvider + 5 接縫 adapter，全旗標 OFF）＋`AI-Director-P1P2補丁/`（cockpit + 確認門，gate 19/19）。 |
| **P3 Supabase parity（後端）** | ⏳ **已打包，待金鑰 + 待 Bruce 決策** | `AI-Director-Supabase遷移/`（82→86 表已驗證可產）。**兩個待 Bruce 決策**：① 向量維度 3072（建議 `halfvec(3072)`+HNSW）② 認證維持自建 JWT。 |
| **P4 影片後端（兩表 + 真實生成 + 可靠性）** | ⏳ **已打包，需 P3 先合 + 金鑰** | `AI-Director-P4-video後端補丁/`（18/18 測試綠，唯一碰 server/drizzle）。`video_generation_sessions`/`video_segment_jobs` 兩表 = M3 最大缺口。 |
| **P5 /social · P6 /learn 殼層** | ✅ **已打包（前端/mock）** | `AI-Director-P5-social補丁/`（零新表）＋`AI-Director-P6-learn補丁/`＋`AI-Director-settings補丁/`。 |
| **開源選型初篩** | ✅ **第一輪（Claude 種子）完成** | `開源選型/`（協議 + GitHub初篩清單 + 代理分工）。**待 Codex/Antigravity 複驗各自類別精確數據 + 補主/備候選 → Claude 收斂 → Bruce 拍板**。 |
| **GitNexus 程式碼知識圖譜** | ⏸ **待跑索引** | `.mcp.json` 已在 repo 根；缺 `gitnexus analyze .` 一次 + 複製設定到 Codex/Antigravity。 |

**結論（飛行狀態一句話）**：規格與骨架就位、PR #852 在等整合；**前端等 Claude Design 把規格落地、後端等 Bruce 對 P3/P4 兩決策拍板**；三代理可立即在各自分支並行開工（旗標全 OFF，零風險）。

---

## B. 三代理一覽（誰做什麼 · 邊界 · 分支 · 旗標）

| 代理 | 角色 | 主責 | 自己的分支 | 自己的旗標（預設 OFF） | 不准碰 |
|---|---|---|---|---|---|
| **Claude Design** | 前端 UI/UX 實作工程師 | 依 `AI-Director-UIUX設計/` 把**整套 UI/UX 落地成真實 React**：設計系統(token/theme)、脊椎 chrome、四 shell、共用元件（PromptVault / Flow 電視牆 / 可設定工作流 / OrbAssistant 光球助手）、`/video` 六步 + `/social` 九步**可設定**工作流 | `claude/4shell-ui-design`（從 umbrella 開；與既有 `claude/*` 後端軌不同檔） | `VITE_ENABLE_4SHELL`、`VITE_SHELL_LEARN_RICH` 等前端旗標 | server/*、drizzle/*、接縫**簽章**、後端 procedure 實作、別人 shell 的資料夾 |
| **Codex** | `/video` 旗艦深垂直 + 影片後端可靠性 | 三欄 cockpit、確認門狀態機、**影片初剪/時間軸**、生成包裝（HF/Fal）、**影片 job 佇列/續傳/可靠性**（P4 後端） | `codex/4shell-p2-cockpit-gate` → `codex/4shell-p4-director-video` | `videoSessions` | server/db.ts、generation 選擇器 `index.ts`、`GeminiGenerationAdapter`、`/social`、`/learn`、`/settings` |
| **Antigravity** | `/social` + `/learn` + Gemini/研究 + 帳務觀測 | canvas 圖層拼接、**PostingProvider** 社群發佈、範本牆、模型瀏覽、Canva/Adobe 整合、Gemini 生成/感知、Sonar 研究、帳務/觀測視圖 | `antigravity/4shell-p5-social` + `antigravity/4shell-p6-learn-research` | `shellSocial`、`research`、`geminiProvider`、`byomcp` | server/subsystems/video/*、generation 選擇器 `index.ts`、`Hf/Fal` adapter、`/settings` 治理後端、commander 契約檔 |
| **Claude（導演/守門）** | 架構守門 · 整合 · QC · 唯一推 GitHub 者 | 5 接縫契約凍結、脊椎、P3 後端、generation 選擇器掛入、RBAC/觀測核心、合子分支、對 main 開 PR | `claude/4shell-*`（p1-spine / p3-supabase / settings-qa / p6-mcp-harden） | — | — |

> **Claude Design vs 守門 Claude**：本包新增的 **Claude Design** 是「前端 UI/UX 落地」軌（消費接縫、實例化骨架、把設計規格變成真實元件）；**守門 Claude** 仍是架構/整合/QC/唯一推 GitHub 者。兩者皆為 Claude，但守不同資料夾、不同分支，互不撞車。

---

## C. 依賴順序（誰等誰 · 三相位）

```
[相位 A｜守門 Claude 單人，解鎖另三方]
  ① 套 P0 包（含 P1 脊椎 + 5 adapter）  ② 凍結接縫契約 v1 + 放 COORDINATION.md
  ③ 推 umbrella + 開 PR #852（已開，head 500a4e4d）  ④ gitnexus analyze . + 複製 MCP 設定
        │（契約凍結＝解鎖）
        ▼
[相位 B｜四軌並行，各守資料夾，旗標全 OFF]
  ⑤ Claude Design  依設計交接包落地 token/chrome/四 shell/共用元件/工作流（消費接縫、不改簽章）
     Codex         /video P2 cockpit + 確認門 + Mock 生成（零金鑰）
     Antigravity   /social P5（零新表）+ /learn P6 研究 + Gemini/Sonar adapter
     守門 Claude    P3 Supabase parity + /settings 治理 + E-QA harness
        │
        ▼
[相位 C｜守門 Claude 會合]
  ⑥ P3 合入 → 解鎖 Codex P4 真實生成（兩表已在 P3 additive schema）
  ⑦ 整合閘：rebase → 依相依序合子分支 → 回歸三件套 → 對 main 開 PR → Bruce 拍板 push
```

**關鍵相依**：
- **Claude Design 等**：守門 Claude 的 **P1 接縫契約凍結 + 通用 cockpit 骨架（`components/cockpit/`）+ 設計 token 落點（`client/src/index.css`）**。token/chrome 可先做（不等 cockpit）。
- **Codex P2 等**：契約凍結。**Codex P4 等**：守門 Claude 的 **P3 parity 先合**（兩表才有 PG 落點）。
- **Antigravity P5 等**：契約凍結（**不需等 Codex P2**）。P6 研究面可早做。
- **可設定工作流 / PostingProvider / showcase.templates 等後端**：需新 procedure/表（見各代理 DoD 的 pending 標記）→ 由守門 Claude 在後端補、Bruce 拍板。

---

## D. 找輸入的路徑地圖（每份規格在哪）

> 代理「要做某件事，去哪找權威輸入」。所有路徑相對 `C:\Users\User\Downloads\`。**標 ⏳pending 者＝被引用但尚未產出**。
> ⚠ **路徑根基準**：若 Bruce 已重整資料夾（例如部分檔案移入 `_AIDirector_stage_初剪\` 或其他磁碟），**以實際位置為準、把根路徑整批替換**；檔名與相對結構不變。

**最高權威（不得牴觸，由高到低）**
- `AI-Director_開發計畫.md` — P0–P6、§2 五接縫、§3 狀態機全窮舉、§5 風險/金鑰、§8 引導式拆片、§10 提示詞/風格庫。
- `AI-Director_四大系統架構.md` — 4-shell／一脊椎／六代理／生成 B 案、§4 路由表、§7 M0–M6。
- `healing-studio_真實repo盤點.md` + `director.today_登入後內部盤點.md` — 事實基準、真實產品表面、「線上 50% 失敗」觸發訊號。
- `AI-Director_盲點補強.md` — 可靠性三件套、成本帳本、RLS/安全縱深。
- `開源選型/開源選型協議.md §1` — **15 條鎖定紅線 L1–L15**（見本檔 §E）。

**交接包（本資料夾 `AI-Director-交接包/`）**
- `COORDINATION.md` — repo 內 live 訊息板（§0 旗標 · §1 分支 · §3 CCR · §6 資料夾所有權 · §7 DoD · §10 開源回報）。
- `啟動順序.md` — Bruce 授權後照抄的施工序。
- `交接_給ClaudeDesign.md` · `交接_給Codex.md` · `交接_給Antigravity.md` — 三份自足簡報。
- `啟動提示詞_給三代理.md` — 三段可直接複製貼上的啟動提示詞。
- `開源選型/{開源選型協議,GitHub初篩清單,代理分工_開源選型}.md` — 開源評估規則 + 種子候選 + 待辦。

**設計交接包（`AI-Director-UIUX設計/`）**
- `00_設計系統/{設計系統.md, theme.css, tokens.css, tokens.oklch.css, react/*.tsx}` — SSOT 設計系統 + 5 個可重用 React 元件（`tokens.ts`/`primitives.tsx`/`PromptVault.tsx`/`ShotCard.tsx`/`GateCard.tsx`）。
- `01_殼層/殼層規格.md` — 脊椎 chrome（Rail/TopBar/ProjectSwitcher/ProviderChip/CommandPalette/Toasts/MobileNav/StateInspector）+ 4-shell 路由地圖。
- `shell-video/video規格.md` — `/video` 六步工作流 + 確認門 + ShotCard + route↔procedure 表。
- `shell-social/00–09` — `/social` 九步（S1–S9）+ **09_可設定工作流_九步範本編輯器**（九步＝預設範本可增刪重排；**閘門與步驟解耦**）+ microcopy + route 表。
- `shell-learn/00–04` — `/learn` 模型瀏覽器(115)/學習中心/積分/新聞/研究 + microcopy。
- `shell-settings/00–04` — `/settings` 一般/Provider/代理偏好/觀測/RBAC 後台 + microcopy。
- `實站截圖觀察.md`（OrbAssistant 真身、25 精靈、director 一頁完成）、`_reference原型/index.html`（點按原型）、`_research/{02_social_design_digest,03_code_reality_notes}.md`。
- ⏳**pending（被引用、尚未產出）**：`_GitNexus程式碼真實對照表.md`、`比對與優化報告.md`、`網站細節深掘.md`（25 精靈完整名單）。**Claude Design 不需等這三份即可開工**；它們落地後補進對照與精靈清單。

**已打包的補丁（程式碼落點，代理 build 在其上）**
- `AI-Director-P0補丁/`（APPLY_GUIDE.md）· `AI-Director-P1P2補丁/` · `AI-Director-模擬/`（sim 原型 = porting 源）· `AI-Director-Supabase遷移/`（P3, MIGRATION_GUIDE.md）· `AI-Director-P4-video後端補丁/` · `AI-Director-P5-social補丁/` · `AI-Director-P6-learn補丁/` · `AI-Director-settings補丁/` · `AI-Director-整合包/`（整合指南·adapter對應表·PR範本·風險清單）。
- `AI-Director_GitNexus深度整合分析.md` — **§D（adapter→真實 procedure 校正）三方必讀**。

---

## E. 15 條鎖定紅線（L1–L15 · 每個決策、每個候選都要逐條相容）

> 出處：`開源選型/開源選型協議.md §1`。**這些是不可推翻的既定決策**；任何工作（含開源候選）只能落在這些決策「之內」當零件，**不能要求改變它們**。牴觸任一條 = `⚠️ 偏離計畫，預設不採用`。

| # | 維度 | 鎖定決策（不可改） |
|---|---|---|
| **L1** | 前端框架 | React 19 + Vite 7 + Wouter（路由）。不可換 Next.js / React-Router / TanStack Router / Vue/Svelte |
| **L2** | API 層 | tRPC v11（+ superjson）。不可換 GraphQL / ts-rest / REST-codegen |
| **L3** | ORM | Drizzle ORM。不可換 Prisma / Kysely / TypeORM（生態輔助 OK） |
| **L4** | DB 方向 | Supabase Postgres + pgvector（halfvec(3072)+HNSW）。向量留在同一 PG；不可換外部向量庫取代 |
| **L5** | 部署 | Railway（Dockerfile, /api/health）。必須能在 Railway/Docker 跑或被呼叫 |
| **L6** | LLM 閘道 | OpenRouter（auto: openrouter>anthropic>gemini>…；Claude 4.5/4.6/4.7）。不可換 LiteLLM/直連取代閘道 |
| **L7** | 生成（B 案） | HF + Gemini ＋ 既有 fal/replicate/ElevenLabs/Suno；per-引擎 `GENERATION_PROVIDER`。候選只能當 provider 之一 |
| **L8** | 長上下文 | SubQ（adapter 化，未到位用 Fallback/Sonar）。替代框架最多當 `CommanderAdapter` 內部 executor |
| **L9** | 研究代理 | Perplexity / OpenRouter Sonar + Brave。候選只能補強，不可換研究主線 |
| **L10** | 代理層 | 6-agent 層（Claude 決策·Sonar+Brave 研究·SubQ 長上下文·Gemini 眼耳+生成·HF 生成·程式自動化）。角色固定 |
| **L11** | 架構 | 4 獨立 shell + 單一脊椎；shell 不互嵌、只走脊椎 |
| **L12** | 上線方式 | flag-gated 漸進（`ENABLE_4SHELL` 等，預設 OFF，OFF==main）；strangler-fig 只加不刪 |
| **L13** | 認證 | 維持自建 JWT（jose + Google OAuth + TOTP）。Auth 框架一律偏離；只可補「授權(RBAC)」層 |
| **L14** | 主鍵/品管 | 鏡號 `S0X` 為影片管線唯一主鍵；確認門為唯一品管脊椎；成本階梯（媒體生成永遠先估再確認） |
| **L15** | 接縫 | 五接縫 adapter（DataStore/Generation/Commander/ContextPacket/Storage），mock 與 real 同簽章同語意 |

**衍生設計鐵律（規格層反覆出現，等同紅線）**：先 parity 再換功能、只加不刪（strangler-fig）；既有功能一個都不丟；四殼互不嵌入只走脊椎；確認門是唯一品管脊椎；鏡號 S0X 唯一主鍵；媒體生成永遠先估成本；Claude 只決策不生圖；接縫契約凍結（守門 Claude 守門，改簽章走 CCR）；元件只綁語意 token 不寫死 hex；四態鐵律（empty/loading/error/success）；對比 ≥4.5:1、`:focus-visible` clay 光環、尊重 `prefers-reduced-motion`；**安全閘門與步驟解耦**（可設定工作流可增刪重排步驟，但成本/品牌/來源確認門不隨刪步消失）。

---

## F. 安全護欄（硬規則 · 全程不變 · 三方一致）

1. **不改方向**：所有工作相容 §E 全部 L1–L15。任何會替換技術棧/DB/部署/LLM/Auth/架構方向者 → `⚠️ 偏離計畫`，獨立分區、預設不採用、不列推薦。
2. **不自動安裝**：開源評估全是**紙上評估**。禁止 `npm install`／改 `package.json`／改 lockfile／加 submodule。採用與否 **Bruce 決定**，安裝由 Bruce 或（Bruce 授權後）Claude 執行。
3. **授權 + 供應鏈雙審**（否決項）：每個候選過授權審（MIT/Apache/BSD/ISC/PostgreSQL ✅；MPL/LGPL ◑ 隔離；**AGPL/GPL 🔶 只能當外部服務/連接器、不 vendor**；自訂/商用 🔶 讀條款標成本；無授權 ❌）＋供應鏈審（健康度/體積/依賴面/postinstall/native binary/鎖版本）。**不確定數字標 ≈/待複驗，絕不杜撰**。
4. **只 branch + PR，不擅動**：每個代理**只在自己子分支 commit**；**不合併、不開旗標、不擅改 server**。push／合子分支／對 main 開 PR **只有守門 Claude 做，且最後一步 Bruce 拍板**。出事關 flag 即回退。

---

## G. 標記法（三方共用）＋ pending 清單

**徽章**：✅推薦／完成 ｜ ◑條件式(有但書) ｜ ⚠️偏離計畫 ｜ 🔶授權需審 ｜ 🧪健康度旗標 ｜ ⏳pending(尚未落地) ｜ 🔌接縫(#1 DataStore/#2 Generation/#3 Commander/#4 ContextPacket/#5 Storage/+PostingProvider/spine/ui)

**目前 ⏳pending 的輸入（在飛、尚未落地）— 代理遇到時依此處理**
- ⏳ `_GitNexus程式碼真實對照表.md`、`比對與優化報告.md`、`網站細節深掘.md`（設計交接包引用、未產出）→ Claude Design 用 `_research/03_code_reality_notes.md` + `AI-Director_GitNexus深度整合分析.md §D` 替代，落地後補。
- ⏳ **後端 procedure/表待建**：`director.breakdown`（M3）、`video_generation_sessions`/`video_segment_jobs`（P4 兩表，已在 P3 additive schema 定義、待落庫）、`asset_generation_events`（M2）、`PostingProvider`（社群唯一全新接縫，現況 0 實作）、`showcase.templates`（範本牆，確認不存在）、`social.*WorkflowTemplate` + `workflow_templates` 表（**可設定工作流持久化**；前端先用內建預設範本常數頂住）、BYOMCP 3 表（`user_mcp_connections`/`mcp_tool_permissions`/`mcp_tool_call_logs`，M5）。→ 前端先用 mock/介面契約頂住；後端由守門 Claude 補、Bruce 拍板。
- ⏳ **兩個待 Bruce 決策（卡 P3/P4）**：① RAG 向量維度 3072（建議採 `halfvec(3072)`+HNSW）② 認證維持自建 JWT vs 遷 Supabase Auth（建議維持自建、Auth 另軌）。附帶待決：嵌入模型(HF/Gemini)、HF i2v 畫質(接受 vs 招牌鏡外接 Runway/Kling)、TTS(HF vs ElevenLabs 中文)、物件儲存(Supabase Storage vs R2/GCS)、SubQ early-access 時點。
- ⏳ **GitNexus 索引**：待跑 `gitnexus analyze .` + 複製設定到 Codex/Antigravity。
- ⏳ **開源複驗**：種子清單部分 stars/活躍標「待複驗」（pg-boss、konva、models.dev、tus、remotion 授權等）→ Codex/Antigravity 各自複驗其類別、補精確值（本包各代理 §11 已附 2026-06-06 `api.github.com` 實查值的部分）。

---

*本主索引對齊：`COORDINATION.md`（§0/§1/§3/§6/§7/§10）、`啟動順序.md`、`開源選型協議.md`（§1 紅線/§9 護欄）、`AI-Director_開發計畫.md`（P0–P6）、`AI-Director_四大系統架構.md`（4-shell/六代理/M0–M6）、`AI-Director_盲點補強.md`（可靠性/成本/安全）、`AI-Director-UIUX設計/`（設計 SSOT）。下一步：把 `啟動提示詞_給三代理.md` 對應段各貼給對應代理；開工先讀 `COORDINATION.md` + 查 GitNexus。*
