# AIDV 主規劃 — AI Director / Healing Studio 影片製作系統（單一真實進度來源）

> **定位**：Atlassian（Jira+Confluence）尚未連接前，本檔＝單一真實進度來源（SSOT）。
> Atlassian 連上後，依本檔第 6 節「上線手冊」原樣搬運；搬運完成後本檔降級為鏡像，
> Atlassian 為準。**任何 API 金鑰都不得寫進本檔／Jira issue／Confluence 頁面**（金鑰一律貼 Railway 環境變數）。
>
> 維護規則：不刪既有內容（過時內容移到「Archive」段落）；不確定的項目標 label `待議`。
> 最後校準：**2026-06-13**（git/GitHub 實況核對，非轉述）。

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

**現況（2026-06-13 git 實證更新）**：
- 4-shell 已合併 main（PR #852–#861）；四殼＋六旗標上線（`ENABLE_4SHELL` 預設 OFF）。
- 合流完成：#866（=#862 導演台＋#863 SSOT 回流 main）、#867（W1-3 promptVault）、#868（W1-7 工程衛生）皆已合併 main。
- 06-13 已合併：#869（0071–0074 journal 補登記）、#870（W1-2 門面＋H5 鎖門）、#871（W1-8 四態文案）、#872（P0 解卡生產 migration）、#873（W1-4 Flow TV）。
- ✅ **P0 已解**：#872 解卡生產 migration（0066–0069 冪等化＋逐句 breakpoint＋information_schema 守門＋5 條鐵則守門測試）已合併 main（AIDV-76→Done）；#869 補登記隨之在下次部署生效。**待 Bruce 真站瀏覽器驗證** creative_projects/orchestration_runs/prompt_assets 三表補建、影片專案功能恢復。
- prompt_assets junction **PR #864 已合併 main**（migration 0075；生產實際生效隨 #872 部署）。
- 🔄 **開發中**：W1-5 單模型遊樂場「統一目錄頁」（AIDV-38，branch `claude/beautiful-mendel-hso334`）——registry 為準的領域目錄＋catalog 情報層 enrich＋選型試生成；零後端變更、全程在 ENABLE_4SHELL 之下。

**UI 原則**：三欄導演台（Story Spine／創作畫布／Context Sidecar）、S0X 導航主軸、readiness chips、確認門＋成本常駐、drawer 不離場、光球 Ambient 四態無人格、漸進揭露。

**重要 repo 機制（開發必讀）**：
- migration 由 boot 時 `server/db.ts applyMigrations → drizzle migrate()` 依 `drizzle/meta/_journal.json` 套用；**未登記 journal 的 .sql 永遠不會跑**（boot 警告 orphan）。0071–0074 已補登記（#869，2026-06-13）；尚餘已知孤兒 0033_add_plan_status_to_sessions、0039–0044（orb 系列）、0067_repair_worldbuilding_v4_columns（`待議`，白名單在 server/orphan-migrations-journal.test.ts）。
- **migration 三鐵則（06-13 P0 教訓，守門測試 server/migration-prod-pending-block.test.ts）**：①禁 MySQL 不支援的 `CREATE INDEX IF NOT EXISTS`；②每個 `--> statement-breakpoint` chunk 只能一句（mysql2 不開 multipleStatements）；③ALTER/CREATE INDEX 必須 information_schema 守門（裸寫重跑必爆＝卡死整個 runner）。drizzle 套用規則＝journal `when` 必須大於 DB 最後一筆 created_at，補登記要用更大的 when 追加。
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
| **合流 `feat/4-shell-restructure` → main**（聚合 #862+#863） | ✅ Done（06-12，AIDV-7） | [#866](https://github.com/aa0968111723-prog/healing-studio/pull/866) | main 含導演台+SSOT；旗標 OFF 線上零變化 | — |
| W1-3 promptVault adapter 接縫（AIDV-36） | ✅ Done（06-12 合併 main） | [#867](https://github.com/aa0968111723-prog/healing-studio/pull/867) | promptLibrary.*＋junction 雙向查詢 | #864 |
| W1-7 工程衛生（AIDV-40） | ✅ Done（06-13 合併 main） | [#868](https://github.com/aa0968111723-prog/healing-studio/pull/868) | scan 一鍵化；eval tsx；notes.create 蟲修 | — |
| 0071–0074 journal 補登記（AIDV-17） | 🔄 In Progress（#869 已合併；#872 已合 → 下次部署生效） | [#869](https://github.com/aa0968111723-prog/healing-studio/pull/869) | 真站驗證四張表建立後關卡 | ~~#872~~ 已解 |
| W1-2 統一供應商門面＋H5 鎖門（AIDV-11+60） | ✅ Done（06-13 合併 main） | [#870](https://github.com/aa0968111723-prog/healing-studio/pull/870) | CF_AI_GATEWAY_* 未設＝零變化；/api/ai 401＋fail-closed＋限流掛載 | CF 帳號（啟用閘道用） |
| W1-8 引導表單細修＋四態文案（AIDV-41） | ✅ Done（06-13 合併 main） | [#871](https://github.com/aa0968111723-prog/healing-studio/pull/871) | error 標真實 procedure；GuidedJourney 取消出口 | — |
| 🔴 **P0 解卡生產 migration（AIDV-76）** | ✅ Done（06-12 合併 main） | [#872](https://github.com/aa0968111723-prog/healing-studio/pull/872) | 合併部署後 creative_projects 等表自動補建；**待真站瀏覽器驗證痊癒** | — |
| W1-4 Flow TV 放映皮（AIDV-37） | ✅ Done（06-12 合併 main） | [#873](https://github.com/aa0968111723-prog/healing-studio/pull/873) | 全屏放映/重用/fork；頻道＝真實後端篩選 | — |
| W1-5 單模型遊樂場統一目錄頁（AIDV-38） | 🔄 In Progress（06-13 開發中，branch `claude/beautiful-mendel-hso334`） | — | registry 為準的領域目錄＋catalog 情報層 enrich＋選型試生成；ModelCard；四態；零後端 | — |
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

### 2.5b 平行軌（Jira 為準，此處僅鏡像索引）

- **Wave H 營運與安全硬化**（Epic AIDV-55＋AIDV-56~73，06-13 全啟動）：H5 鎖門已隨 #870 完成；H6 的活案例＝AIDV-76 P0。Railway MCP 接入＝AIDV-77（官方遠端版已寫入本機設定，待 Bruce OAuth）。
- **Wave U UIUX 視覺實裝**（Epic AIDV-74＋盤點卡 AIDV-75，06-13 依 Bruce 指示新增）：⑦ UIUX 設計 46 頁逐頁落地；「可以放比較後面但不可以沒有開發」；亮色系定盤為視覺基準。

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

## 6.5 2026-06-12 第二輪轉移＋協作工作流（已執行）

- **本機文件全量上傳**：D:\AI-Director系統 整合開發計畫六件套（06-11）→ ②-1～②-6；repo docs/4shell-handoff 全套＋D: UIUX 文件 → 新 **⑦ UIUX 設計**（46 頁：底層邏輯/設計系統/殼層/4 殼規格集/大調整計畫/原型改進 M1–M4/_CONTRACT）；④ 補 6 頁實證（網站細節深掘/GitNexus/移植對照/實站截圖/比對報告/現況同步）；⑤ 補交接包 7 頁＋開源選型 3 頁＋「⑤-1 下一步詳細規格」。
- **6/10 鮮度規則**：②-A（05-23 SubQ 規劃）與 ②-B（05-27 資料模型）已移 Archive＋過時橫幅；06-10/11/12 文件為現行。
- **討論空間 `AIDISC`「AIDV 討論區」**：收件匣／參考研究／🤝 需要你動手（金鑰與拍板待辦）／已結案歸檔。注意：曾嘗試 key `AIDQ` 失敗留下幽靈 key（已棄用，勿再用 AIDQ）。
- **Bruce 六點指示（live doc 66245）已落地**：定錨規則＋白話導讀寫入 AIDIR 首頁；AIDV-35「瀏覽器模擬創作者實測」已建（含 Google Drive 雲端專案資料夾參照）；live doc 已留言回覆。
- 鐵律新增（同 skill）：定錨不動／要改只改未來並先確認／白話文義務／每次開工先讀 AIDISC 收件匣。

## 6.6 ⑧ 補遺規劃（2026-06-12 晚，待 Bruce 審）

4 個偵察代理對碼實證 30 個發現（每項含檔案行號證據），已上 Confluence「⑧ 補遺規劃」（id=328171）＋討論區審閱頁：
- **🔴 高嚴重 10**：H1 無 CI/CD（零 GitHub Actions、push 直達 prod）／H2 無 DB 備份計畫／H3 /api/metrics 與 SSE 無 auth＋無 Sentry／H4 JWT 一年效期＋secret 缺失不 fail-fast／H5 aiProxy 未登入可用＋限流 fail-open＋limiters 沒掛載／H6 無回滾 SOP＋migration 失敗照常服務／H7 手機版導演台缺失（VideoCockpit 幾乎零 RWD，Bruce 主場景）／H8 npm run eval 壞掉（ts-node ESM）＋userRating 與模型推薦斷線／H9 無刪帳號/資料匯出/log 保留政策／H10 costUsd 寫死 0（aiProxy.ts L232/L416）＝$0.00 真兇。
- **🟡 中 12**：上傳 MIME 自報＋SVG XSS／審核 fail-open＋fal safety_checker:false／媒體單份無版本／儲存只進不出（R2 孤兒）／secretCrypto 綁 JWT_SECRET／教材庫 RAG 注入側門／無 staging／巨檔（routers.ts 9249 行等）／12MB markdown chunk＋367KB manus-runtime inline／TS 443 處 as any＋test 檔不過 tsc／告警 webhook 未設靜默吞／Stripe 假驗簽。
- **🟢 低 8**：i18n／a11y／成長機制／方案空架子／金流／per-project 成本／E2E 22 條／無 eslint。
- **提案**：新增平行軌「Wave H 營運與安全硬化」＋未來軌「Wave 5 商業化」；H7→Wave 1、H10→AIDV-14；不動既有定錨。風險登記簿含「token 已在對話暴露→撤銷換新」。Jira 卡待 Bruce 審後才灌。

## 6.7 ⑨ 影片製作系統建構總規劃（2026-06-12 晚，已發佈）

依 06-11 六件套（②-1~②-6）校準 06-12 實況後的執行藍圖，Confluence id=393698：
- **實況校準**：G1 SSOT ✅（#863 提前完成）、G9 junction ✅（#864 提前一個 Wave）、D1 LoRA 已拍板 fal（取代 04 文件建議 A）、D2/D4 已拍板、新增合流＋⑧H7 手機導演台。
- **Jira 細項卡已灌**：AIDV-36~54 共 19 張（W1-3~W1-9、W2-E~W2-I、W3-B/D/E/F/G、W4-E/F），全掛對應 Wave Epic；既有 14 張卡（AIDV-7/11/12/13/14/15/16/18/19/20/21/22/27/35）已留言補「⑨ 藍圖對應」（範圍/驗收/依賴/避雷）。看板現 54 卡。
- **北極星 DoD**：一句話 logline→成片匯出六步全流程；最終驗收＝惹瓊巴傳 30 秒成片。
- **D 速答卡**（D3/D5~D15 共 12 項小拍板）已放 AIDISC「需要你動手」，一行回覆即可。
- Wave 門檻照 03 路線圖：W1→W2＝Bruce 正式站試用一週無 P0/P1；W2→W3＝金流三測綠＋對帳 7 天零告警；W3→W4＝成片驗收＋帳單誤差 <5%。月費階梯 $0→$5-10→$5-10→$5-20。

## 7. Archive（過時內容移此，不刪）

- ②-A 核心創作鏈路與 SubQ 整合規劃（2026-05-23）— 已移 Confluence Archive（6/10 規則）
- ②-B 資料模型深入設計（2026-05-27）— 已移 Confluence Archive（6/10 規則；表設計仍可參考）
