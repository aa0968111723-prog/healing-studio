# AIDV 主規劃 — AI Director / Healing Studio 影片製作系統（單一真實進度來源）

> **定位**：Atlassian（Jira+Confluence）尚未連接前，本檔＝單一真實進度來源（SSOT）。
> Atlassian 連上後，依本檔第 6 節「上線手冊」原樣搬運；搬運完成後本檔降級為鏡像，
> Atlassian 為準。**任何 API 金鑰都不得寫進本檔／Jira issue／Confluence 頁面**（金鑰一律貼 Railway 環境變數）。
>
> 維護規則：不刪既有內容（過時內容移到「Archive」段落）；不確定的項目標 label `待議`。
> 最後校準：**2026-06-12**（git/GitHub 實況核對，非轉述）。

---

## 0. 與簡報差異的事實校準（2026-06-12 git 實證）

| 簡報說法 | 實況 | 影響 |
|---|---|---|
| Wave 0 三欄導演台 PR #862 待 review | **#862 已於 06-11 合併**，但目標是 `feat/4-shell-restructure`，**未回流 main** | Wave 0 story 改 Done；新增「合流 4-shell-restructure→main」story |
| Project SSOT｜To Do | **已完成**：PR #863 於 06-12 合併入 `feat/4-shell-restructure` | Wave 1 story 改 Done（隨合流回 main） |
| prompt_assets junction｜To Do | **已完成**：PR #864 於 06-12 合併入 **main**（migration 0075） | Wave 1 story 改 Done；遺留 3 個 follow-up（見 2.2） |
| 4-shell 已合併 main(07868c8d) | 正確（#852 於 06-06 合併）；main 現為 16d2f35d（#864） | 無 |
| Notion Wave 編號（W1=M2 血統…） | 與本規劃新編號不同 | 轉移表標 `待議`，以本檔編號為準 |

---

## 1. Confluence 首頁：背景與真實基準（①架構與真實基準 頁面內容）

healing-studio（線上 director.today）影片系統整合進現有網站、收斂成「**四殼一脊椎**」。

**真實棧（main）**：React 19 + Vite + Wouter + tRPC v11 + Drizzle/MySQL + Express；LLM=OpenRouter；RAG=Pinecone；生成=fal/replicate/Gemini/ElevenLabs/Suno；部署=Railway。
**規模**：82 表／54 routes／50 頁／34 router（~565 procedure）；影片 18 子系統：8✅可接／10⚠半接／0 全空。
**目標棧**：+Supabase（pg + pgvector halfvec(3072) + HNSW）+ HF 生成 + SubQ。

**現況（2026-06-12）**：
- 4-shell 已合併 main（PR #852–#861）；四殼＋六旗標上線（`ENABLE_4SHELL` 預設 OFF）。
- Wave 0 三欄導演台 **PR #862 已合併** `feat/4-shell-restructure`。
- Wave 1 Project SSOT **PR #863 已合併** `feat/4-shell-restructure`。
- prompt_assets junction **PR #864 已合併 main**（migration 0075）。
- `feat/4-shell-restructure`（含 #862+#863）**尚未回流 main** ← 目前最近的合流動作。

**UI 原則**：三欄導演台（Story Spine／創作畫布／Context Sidecar）、S0X 導航主軸、readiness chips、確認門＋成本常駐、drawer 不離場、光球 Ambient 四態無人格、漸進揭露。

**重要 repo 機制（開發必讀）**：
- migration 由 boot 時 `server/db.ts applyMigrations → drizzle migrate()` 依 `drizzle/meta/_journal.json` 套用；**未登記 journal 的 .sql 永遠不會跑**（boot 警告 orphan）。0071–0074 目前是孤兒（`待議`）。
- 旗標慣例：前端 `client/src/config/*Flags.ts`（Vite env，階層在 ENABLE_4SHELL 之下）；後端 `server/_core/env.validated.ts` + lazy `process.env` 讀取。
- schema.ts 慣例不寫 `references()`；FK 由 raw-SQL migration 補（0055 模式）。

---

## 2. Jira：專案 AIDV（kanban）＋路線圖

**慣例**：Epic=Wave、Story=項目。狀態 Done=✅／In Progress=🔄／To Do=📋；
label：`decision`（待拍板，狀態用 Blocked）／`decision-resolved`（已拍板）／`needs-key`（缺金鑰，Blocked）／`caution`（避雷）／`待議`（不確定）。
每 Story 必填：狀態／PR 連結／Wave／驗收／依賴。

### 2.1 EPIC Wave 0 — 前端骨架／導演台【Done ✅】

| Story | 狀態 | PR／連結 | 驗收 | 依賴 |
|---|---|---|---|---|
| 4-shell 重構（flag-gated，ENABLE_4SHELL 預設 OFF） | ✅ Done | [#852](https://github.com/aa0968111723-prog/healing-studio/pull/852)–[#861](https://github.com/aa0968111723-prog/healing-studio/pull/861) 已合併 main | tsc/scan/測試綠；旗標 OFF 零行為改變 | — |
| Wave 0 三欄導演台正式碼 | ✅ Done（06-11 合併 `feat/4-shell-restructure`） | [#862](https://github.com/aa0968111723-prog/healing-studio/pull/862) | tsc/scan/測試綠、旗標 OFF 逐像素一致 | 4-shell |
| 互動原型 | ✅ Done | bruce882-ai-director-video-proto.static.hf.space | 可操作 | — |
| 技術簡報 | ✅ Done | bruce882-ai-director-video-brief.static.hf.space | 活文件 | — |

### 2.2 EPIC Wave 1 — SSOT＋接線【In Progress 🔄】

| Story | 狀態 | PR／連結 | 驗收 | 依賴 |
|---|---|---|---|---|
| Project SSOT：MOCK→真 creative_projects | ✅ Done（06-12 合併 `feat/4-shell-restructure`） | [#863](https://github.com/aa0968111723-prog/healing-studio/pull/863) | tsc/測試綠；ENABLE_PROJECT_SSOT 旗標；active id 歸 WorldContext | #862 |
| prompt_assets junction 表（已採 junction） | ✅ Done（06-12 合併 main，migration 0075） | [#864](https://github.com/aa0968111723-prog/healing-studio/pull/864) | migration 冪等可回滾；旗標 ENABLE_PROMPT_ASSET_LINKS 預設 OFF | — |
| **合流 `feat/4-shell-restructure` → main**（聚合 #862+#863） | 📋 To Do（**新增**，下一步建議） | — | main 含導演台+SSOT；旗標 OFF 線上零變化；CI 綠 | #862 #863 |
| junction follow-up A：backfill 在真 DB 實跑＋數字核對 | 📋 To Do | admin 呼叫 `promptLibrary.backfillAssetLinks` | totalLinked 數字合理、可重跑冪等 | #864、DATABASE_URL 環境 |
| junction follow-up B：variant/rewrite/extended 寫入點（座艙重骰/改寫/延長） | 📋 To Do | — | 三種 relation 有實際寫入 | #864、導演台流程 |
| junction follow-up C：prompt_library content 去重策略（每次生成新插一列） | ⛔ Blocked `decision` `待議` | — | 拍板 upsert-by-content 或保持現狀 | — |
| 統一供應商門面＋免費 Cloudflare AI Gateway | 📋 To Do | Notion: 統一供應商門面 + Cloudflare AI Gateway | 所有生成呼叫過門面；Gateway 快取/觀測啟用 | — |
| 其餘可接子系統接真實 procedure（18 子系統矩陣的 ✅8） | 🔄 部分 Done（在 #862） | [#862](https://github.com/aa0968111723-prog/healing-studio/pull/862) | 各子系統列實際 procedure 名 | #862 |

### 2.3 EPIC Wave 2 — 耐久任務／成本／血統【To Do 📋】

| Story | 狀態 | 備註 | 驗收 | 依賴 |
|---|---|---|---|---|
| 任務耐久化 BullMQ+Redis+可重連 SSE（殺 5 分鐘 timeout） | ⛔ Blocked `needs-key`（Redis） | Notion: 任務耐久化 | 任務跨重啟存活；SSE 斷線重連續傳 | Redis 金鑰→Railway |
| 真實成本落帳閉環（估→原子扣→落帳/全退，outbox） | 📋 To Do | Notion: 真實成本落帳閉環 | **cost_aggregations 不再 $0.00** | — |
| 上傳改 signed URL/tus（廢 base64） | 📋 To Do | — | 大檔上傳不過 tRPC body | — |
| fal.ai 雙層生影片（草稿 Seedance/Kling/Wan＋精修 Veo 3.1） | ⛔ Blocked `needs-key`（FAL_KEY） | `caution`：影片價以 fal 帳號頁為準 | 草稿→精修兩段流程可跑 | FAL_KEY→Railway |
| migration 治理：孤兒 0071–0074 處置 | ⛔ Blocked `decision` `待議` `caution` | 補登記會在下次部署突然套用 4 張表 | 拍板：補登記或標廢棄 | — |

### 2.4 EPIC Wave 3 — 重後端／基建／協作【To Do 📋】

| Story | 狀態 | 備註 | 驗收 | 依賴 |
|---|---|---|---|---|
| M3 影片段落狀態機（video_generation_sessions/segment_jobs） | 📋 To Do（XL） | Notion: Wave 2：M3＋即時協作 | 段落級重試/續跑 | Wave 2 耐久化 |
| MySQL→Supabase（pg+pgvector halfvec(3072)+HNSW）遷移、退役 Pinecone | ⛔ Blocked `needs-key`（Supabase） | `caution`：transaction pooler:6543、migration ledger 回填、enum/extension 衝突 | 雙寫驗證→切換→Pinecone 退役 | 任務耐久化之後（已拍板） |
| presence＋Redis SET NX 生成鎖 | 📋 To Do | — | 並發生成不互踩 | Redis |
| Yjs/Hocuspocus（腳本）＋tRPC subscription（Shot JSON） | 📋 To Do | — | 雙人即時編輯不丟字 | — |
| XState 收斂（只留段落/鏡號狀態機） | 📋 To Do | — | 其餘狀態機移除 | M3 |

### 2.5 EPIC Wave 4 — 代理建置區／BYOMCP【To Do 📋】

| Story | 狀態 | 備註 |
|---|---|---|
| 「可觀察/可審核/半唯讀」builder 先行 | 📋 To Do | Notion: Wave 3：開放代理建置區＋BYOMCP |
| BYOMCP 權限/稽核 | 📋 To Do | — |
| orchestrator＋專責 worker | 📋 To Do | — |

### 2.6 已拍板決策（label `decision-resolved`）

| 決策 | 結果 | 證據 |
|---|---|---|
| prompt↔asset 結構 | **junction** ✅（已落地 PR #864） | drizzle/0075_prompt_assets.sql |
| LoRA 微調 | **改走 fal.ai**（保留 Replicate 備援）✅ | Notion: 決策：LoRA 微調 |
| 向量後端 | **halfvec(3072)+HNSW**；維持自建 JWT；Supabase 排任務耐久化之後 ✅ | Notion: 決策：後端金鑰與方向 |

### 2.7 需金鑰（label `needs-key`，Blocked；**金鑰貼 Railway，勿寫頁面**）

FAL_KEY／Supabase keys／Redis／ELEVENLABS_API_KEY

### 2.8 避雷（label `caution`）

- Sora 2 已停用勿用
- OpenAI 可重用 prompt 物件 **2026-11-30 下線**，勿硬綁
- 影片價以 fal 帳號頁為準
- 本機測試環境：jsdom@29 + vitest@2 的 localStorage 失效（main baseline 13 failed/6 檔為既有問題，勿誤判為新回歸）

---

## 3. Confluence 空間「AI Director 影片系統」頁面樹

```
AI Director 影片系統（空間首頁＝①）
├─ ① 架構與真實基準            ← 本檔第 1 節（含現況、repo 機制）
├─ ② 整合開發計畫              ← 18 子系統矩陣＋後端缺口方案＋Wave 路線＋決策
├─ ③ 研究報告 v1 / v2          ← Notion「深度研究報告 v2」＋「研究報告採納」兩頁
├─ ④ 對照與實證
│   ├─ 原型→正式碼移植對照表    ← Notion 同名頁
│   ├─ 網站細節深掘            ← docs/4shell-handoff/AI-Director-UIUX設計/網站細節深掘.md
│   ├─ GitNexus 程式碼真實對照表 ← docs/4shell-handoff/AI-Director-UIUX設計/_GitNexus程式碼真實對照表.md
│   └─ 實站截圖／比對報告
├─ ⑤ 開發順序與節奏            ← Wave 順序＋每步開工提示詞索引（Notion「多代理交接」頁）
├─ ⑥ 預算分階段                ← $5-10 → $10-20 → Supabase（研究報告 v2 預算節）
└─ 變更紀錄（每完成一 Wave 加一節；已取代的 legacy 移入 Archive 子頁，不刪）
```
（文件正文 Bruce 端的 Claude 都有，需要時向他索取完整文字；repo 內 docs/4shell-handoff/ 也有大部分原文。）

---

## 4. Notion → Atlassian 轉移對照表

來源：Notion「Ai研究 › Healing Studio 專案規劃區」（369b7d0ed73a81cc8dc6de9a2f6ed3d3）
＋「📊 AI Director 專案進度追蹤」DB（496e44e583914755a8a0f5197fb47412，schema：項目/類別/Wave/狀態/連結/備註/更新日）。

**欄位映射**：項目→Summary｜類別→label（design/proto/code/deploy/doc/research/decision/milestone）｜狀態→Jira 狀態（✅完成→Done、🔄進行中→In Progress、⏳待你決策→Blocked+`decision`、⏸暫停→Blocked、📋規劃→To Do）｜Wave→Epic Link（**注意：Notion 的 Wave 編號舊制，對映見下；衝突標 `待議`**）｜連結/備註→Description。

| Notion 項目（DB 列） | 去向 | 對映 |
|---|---|---|
| 影片系統 Wave 0 正式碼（三欄導演台） | Jira | Wave 0／#862 Done |
| 影片系統互動原型（三欄導演台） | Jira | Wave 0 Done |
| 影片系統技術簡報（落地路線圖，活文件） | Jira＋Confluence ① | Wave 0 Done |
| 設計交接包（設計系統＋四 shell 規格＋移植對照表） | Confluence ④ | 文件 |
| 原型→正式碼移植對照表 | Confluence ④ | 文件 |
| 研究報告採納（三欄導演台／junction／落地優先序） | Confluence ③ | 文件 |
| 研究報告 v2 採納（架構/路線/預算） | Confluence ③＋⑥ | 文件 |
| 決策：prompt↔素材 junction 表 | Jira `decision-resolved` | 已落地 #864 |
| 決策：後端金鑰與方向（Supabase/halfvec/JWT/ELEVENLABS） | Jira `decision-resolved`＋`needs-key` | — |
| 決策：LoRA 微調 Replicate vs fal | Jira `decision-resolved` | fal 為主 |
| Wave 1：M2 血統／版本系統 | Jira `待議` | Notion 舊編號；對映新 Wave 2「成本/血統」 |
| Wave 2：M3＋即時協作 | Jira `待議` | 對映新 Wave 3 |
| Wave 3：開放代理建置區＋BYOMCP | Jira `待議` | 對映新 Wave 4 |
| 統一供應商門面 + Cloudflare AI Gateway | Jira | 新 Wave 1 To Do |
| 真實成本落帳閉環 | Jira | 新 Wave 2 |
| 任務耐久化：BullMQ+Redis+可重連 SSE | Jira `needs-key` | 新 Wave 2 |
| 多代理交接（Codex／Antigravity／Claude Code 啟動提示詞） | Confluence ⑤ | 文件 |
| Ai 代理工作流／各項功能的完整度？／網站的前後端和資料庫？／請把ai回覆寫在此處／開源／Sdk／網站本身的Mcp/SDK？／Notion 開發資料整理＋最新頁面 | Confluence ①附錄或 Archive `待議` | Q&A 雜頁，Bruce 確認去留 |
| 核心創作鏈路與 SubQ 任務總指揮整合規劃（2026-05-23） | Confluence ② | 規劃原文 |
| 資料模型深入設計（M2/M3/M5/BYOMCP） | Confluence ② | 規劃原文 |
| AI-Director 文件庫地圖與 UIUX 底層邏輯（2026-06-10 整併版） | Confluence ④ | 文件 |
| 🎬 AI-Director 最新開發重點（2026-06） | Confluence ①現況節 | 滾動更新 |
| 🗄️ 過時區／Archive | Confluence Archive 子頁 | 只封存不刪除 |

轉移後 Notion 端：在每頁頂端加「已遷 Confluence（連結）」橫幅，**不刪原文**。

> **2026-06-12 轉移執行結果**（Confluence 空間 AIDIR id=262147）：
> - 首頁＝①架構與真實基準；②–⑥＋變更紀錄＋Archive 已建。
> - 已遷全文：③-1 深度研究報告 v2／②-A SubQ 整合規劃 v1（Notion 原頁在過時區）／②-B 資料模型深入設計（標註 pg→MySQL 轉換注意＋0070/0071 已落地）／②-C 進度 DB 快照與拍板細節（25 列精華，含 LoRA=fal-ai/flux-lora-fast-training）／⑤-A 交接開工索引（13 個 Notion 子頁連結）。
> - 三個決策頁＋四個 Wave/正式碼頁＝Notion 空白頁（內容只在 DB 備註）→ 已併入 ②-C 與 Jira AIDV-26/27/28 留言，不另建頁。
> - Notion 規劃區首頁已加「已遷移至 Atlassian」橫幅（原文未刪）。
> - 待搬（標 待議）：⑤-A 索引中的 13 個子頁正文（多數已鏡像 repo docs/4shell-handoff/）、網站知識庫、文件庫地圖整併版、Q&amp;A 雜頁。

---

## 5. 維運 SOP（之後維護）

1. **每 PR 合併/狀態變更** → 更新對應 Jira issue 狀態＋留言記 PR 連結（Atlassian 未連前：更新本檔第 2 節）。
2. **每完成一 Wave** → Confluence「變更紀錄」加一節；被取代的 legacy 頁移 Archive（不刪）。
3. **每週** → 給 Bruce 摘要：完成／進行中／待決策（Blocked+decision）／卡住（needs-key）。
4. 任何新決策：拍板前 label `decision`＋Blocked；拍板後改 `decision-resolved` 並記結論與日期。
5. 金鑰一律 Railway 環境變數；issue/頁面只准寫「需要 XXX 金鑰」。

---

## 6. 上線手冊（Atlassian 連上後照做）

### 6.1 Bruce 先做（一次性）
1. 連接 Atlassian MCP：**設定檔已由代理寫入**（2026-06-12，`~/.claude.json` user 層 `mcpServers.atlassian` → `https://mcp.atlassian.com/v1/sse`，備份在 `~/.claude.json.bak-aidv`）。剩兩步：
   a. **重啟 Claude session／桌面 App**（MCP 在啟動時載入）；
   b. 首次連線會跳 **Atlassian OAuth**（瀏覽器登入 Atlassian 帳號 → Allow；CLI 環境則在互動模式輸入 `/mcp` → 選 atlassian → Authenticate）。完成後 session 會出現 `mcp__atlassian__*`（Jira+Confluence+Rovo）工具。
   （若你偏好 claude.ai Connectors 雲端版：Settings → Connectors → 搜「Atlassian」→ Connect，亦可，兩者擇一。）
2. Jira 建軟體專案：key **AIDV**、模板 **Kanban**（建議 company-managed，CSV 匯入對 Epic Link 支援較好）。
3. Confluence 建空間：「**AI Director 影片系統**」。

### 6.2 灌資料（兩條路，擇一）

> **2026-06-12 進度**：Jira 已由代理經 REST API（API token，存 `~/.atlassian-credentials`，未進 repo）**灌入完成**：
> 專案 `AIDV`（kanban）＋5 大型工作 AIDV-30～34（Wave 0–4）＋29 Story AIDV-1～29（parent 已掛、Done/In Progress 已轉、labels 齊）。
> 看板：https://aa0968111723.atlassian.net/jira/software/c/projects/AIDV/boards
> 注意：站台介面為中文（Epic=大型工作、Story=故事；狀態=待辦/進行中/完成）；板上無 Blocked 欄，Blocked 語意以 label `blocked` 表示（Bruce 可日後在板設定加欄）。
> **Confluence 未開通**（/wiki 全 401）→ Bruce 待辦：admin.atlassian.com → 你的站台 → Products → **Add Confluence（Free）**，開通後代理續跑頁面樹＋Notion 轉移。
- **A（不需 MCP）**：Jira → Settings → System → External System Import → CSV → 上傳 `docs/plan/jira-import.csv`（UTF-8）。匯入精靈中：Issue Type/Summary/Description/Labels 直接對映；Status 對映到 board 欄；Epic 用「Epic Name」（epic 列）與「Epic Link」（story 列）對映。
- **B（MCP 連上後）**：對 Claude 說「執行 /aidv-plan sync」——插件會讀本檔，逐項建 Epic/Story/頁面（冪等：先查同名再建，不重複、不刪除）。

### 6.3 Confluence 頁面
依第 3 節頁面樹建頁；①②⑤⑥內容取自本檔與 docs/4shell-handoff/；③④向 Bruce 索取 D: 文件原文或從 Notion 複製。

---

## 7. Archive（過時內容移此，不刪）

（目前空）
