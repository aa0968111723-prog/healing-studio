# COORDINATION — AI-Director 4-Shell 重構（三方訊息板）

> **這是什麼**：`healing-studio` repo 根目錄的**單一交接點 / live 訊息板**。三個 AI 代理 — **Claude（導演／架構守門／整合／QC）**、**Codex（/video 旗艦深垂直）**、**Antigravity（/social + /learn + Gemini）** — 都在這裡同步狀態。
> **放哪**：P0 套用後 commit 到 repo 根目錄（與 `.mcp.json`、`AGENTS.md` 同層）。這是 repo 內的 live 檔，不是 Obsidian vault 主體（vault 只存里程碑快照）。
> **事實基準**：`main` HEAD `a68f2567`（2026-06-06，PR #852 已合併）。React19 / Vite7 / Wouter3.7.1(patched) / tRPC v11 / Drizzle。82 `mysqlTable` · 54 路由 · 68 router namespace。
> **黃金鐵律（不得牴觸）**：延伸開發計畫與整合指南、不牴觸；既有功能一個都不丟；先 parity 再換功能、只加不刪（strangler-fig）；三方各守自己的資料夾，只透過 5 接縫契約交換。

---

## 📜 使用規則（每個 agent 必讀）

1. **開工先讀全文**，收工先寫自己的狀態區。
2. **只編輯「自己的狀態區」與「給某人的訊息（@agent）」**；不要動別人的區塊。
3. **唯二的共享寫入點**是本檔（各寫各的區塊）與 `.env.example`（Claude 維護）。其餘檔案皆**單一 owner**（見 §6 資料夾所有權）。
4. **想改任何接縫契約 / `appRegistry` 映射 / 脊椎 provider 樹 / 鏡號 `S0X` 主鍵語意 → 一律走 §3 CCR，由 Claude 拍板**。沒過 Claude，不准改介面簽章。
5. **動手前先查 GitNexus**（§4）：「這函式在哪、誰呼叫、改它炸到哪」三方共用同一答案。
6. **卡住先在 §2 看板寫「blocked 於誰」**，不要亂改別人的檔。
7. **只有 Claude** 能 rebase umbrella、合子分支、對 `main` 開 PR、推 GitHub（最後一步 Bruce 拍板）。Codex / Antigravity 只在自己子分支 commit。

---

## 0. 接縫契約版本（Claude 維護｜唯一真相）

```
契約版本：v1.0   凍結日：2026-06-06   變更摘要：初凍結（PR #852 已將 P0/P1/P2/P5/P6/settings 前端四殼合入 main；5 介面 + SpineProvider 已在位）
```

**5 接縫 env 旗標當前預設（全部 = 零行為改變 / 零金鑰）：**

| 旗標 | 預設 | 意義 |
|---|---|---|
| `DATA_STORE` | `trpc` | P0 保留既有後端→預設 trpc＝打同一批 procedure＝零行為改變；無金鑰跑模擬設 `mock` |
| `GENERATION_PROVIDER` | `mock` | 生成 provider；`mock\|hf\|gemini\|fal` |
| `COMMANDER_ADAPTER` | `fallback` | 代理／編排；`fallback\|sonar\|subq` |
| `CONTEXT_PACKET_MODE` | `mock` | ContextPacket 編譯；`mock\|rag-pinecone\|rag-pgvector` |
| `STORAGE_PROVIDER` | `mock` | 資產儲存（選配）；`mock\|r2\|gcs\|supabase` |

**功能旗標（各 agent 的新功能掛自己的、預設 OFF；行為 == main）：**
`ENABLE_4SHELL`（總開關，OFF）· `videoSessions`（P4 兩表，OFF）· `shellSocial`（P5，OFF）· `shellLearn`（OFF）· `research`（Sonar 面板，OFF）· `geminiProvider`（OFF）· `byomcp`（OFF）。
> Vite 前端旗標讀 `import.meta.env.VITE_*`（如 `VITE_ENABLE_4SHELL=1`）。詳見 `AI-Director-P0補丁/APPLY_GUIDE.md §4`。

---

## 1. 分支策略（umbrella + 三方各前綴子分支）

```
main (權威基準 2888a36)
 └─ feat/4-shell-restructure                 ← umbrella（長命；Claude 擁有；唯一對 main 開 PR 者）
     ├─ claude/4shell-p0-routing             P0 路由骨架＋redirect map＋group→shell（已打包＝P0 包）
     ├─ claude/4shell-p1-spine               P1 SpineProvider＋IDataStore＋MockDataStore＋【契約凍結】
     ├─ claude/4shell-p3-supabase            P3 Supabase parity（MySQL→PG＋pgvector）；與 P2/P5 並行
     ├─ claude/4shell-settings-qa            /settings 治理＋E-QA harness（橫貫，不擋任何階段）
     ├─ claude/4shell-p6-mcp-harden          SubQ adapter＋mcpGateway＋BYOMCP 3 表＋硬化
     ├─ codex/4shell-video                   ← Codex 軌（P2→P4；見下方拆分）
     │    ├─ codex/4shell-p2-cockpit-gate    P2 /video cockpit＋確認門＋Mock 生成（零金鑰）
     │    └─ codex/4shell-p4-director-video  P4 video 兩表＋真實 HF/Fal＋director.breakdown（需 P3）
     └─ antigravity/4shell-social-learn      ← Antigravity 軌（P5＋P6；見下方拆分）
          ├─ antigravity/4shell-p5-social        P5 /social shell（重用 cockpit、零新表）
          └─ antigravity/4shell-p6-learn-research P6 /learn 研究 Sonar＋Gemini 生成/感知＋BYOMCP 入口
```

**規則**：(1) 每個子分支＝一個可獨立 review／rollback 的 PR，**合回 umbrella、不直接打 main**；(2) **每個 PR 用 feature flag 包覆、預設 OFF**，OFF 時行為 == main；(3) 權威基準永遠是 main HEAD，用 **rebase** 不長期分叉；(4) **只有 Claude** 合子分支進 umbrella、對 main 開 PR（Bruce 拍板才 push）；(5) Codex／Antigravity **不 rebase umbrella、不碰對方分支**。

**命名**：分支 `<agent>/4shell-<phase>-<topic>`；commit `feat(<scope>): <中文摘要>`（scope ∈ `spine/adapters/video/social/learn/settings/db/qa`），對齊 real repo 中文 `feat:` 慣例。

---

## 2. 看板（誰在做什麼／blocked 於誰）— 各 agent 寫自己那列

| Agent | 當前分支 | 在做 | 狀態 | blocked 於 | 預計交付 |
|---|---|---|---|---|---|
| **Claude** | `claude/coord-freeze-v1` | 將 COORDINATION live 訊息板入庫；補齊契約凍結狀態 | ⏸ 待 PR/merge | — | 本分支已提交；GitNexus analyze 已嘗試，失敗於 `.gitnexus\lbug` IO；待修後重跑 |
| **Codex** | `codex/4shell-p4-director-video` | /video 真實生成後端：兩表、HF/Fal、DLQ/Reaper/退點 | ⏸ 等 P3 | Claude P3 Supabase parity + 金鑰 | P4 backend 可 ship dark |
| **Antigravity** | `antigravity/4shell-p6-learn-research` | Gemini/Sonar/PostingProvider/canvas 深功能與開源複驗 | ⏸ 等接縫掛入/授權 | Claude 選擇器接線 + 相關金鑰 | real adapters + E2E 截圖證據 |

**狀態圖例**：🟢 完成 ｜ 🟡 進行中 ｜ ⏸ 等待（blocked）｜ 🔴 出問題。

---

## 3. 契約變更請求（CCR）— 想改介面的提這裡，Claude 拍板

> **規則**：任何想改介面簽章、`appRegistry` group→shell 映射、脊椎 provider 樹、鏡號 `S0X` 語意、或既有 `drizzle/schema.ts` 表 → 在此開一筆 CCR。Claude 用 GitNexus 查反向引用評估影響面 → 准則改 `adapters/types.ts`＋bump 契約版本＋廣播 → 三方各自 rebase 取新契約。**介面增量採「只加方法、不改既有簽章」；mock 與 real 同簽章、同語意。**

| 編號 | 提案人 | 想改什麼 | 影響面（GitNexus） | Claude 裁決 |
|---|---|---|---|---|
| CCR-000 | — | （範例）`GenerationProvider` 加 `cancel(jobId)` 方法 | `impact GenerationProvider` → 3 軌 adapter | 待 / 准 / 駁 |

---

## 4. GitNexus — 三方共用的 code 知識圖譜（必設）

> **為什麼**：repo 大（82 表／54 路由／34 router／~565 procedure）。三個 agent 各自「重讀整個 repo」會偏差又燒 token。GitNexus 用 Tree-sitter 把 repo 解析成程式碼知識圖譜（節點＝function/class/interface/module；邊＝calls/imports/exports），以 MCP server 暴露，**三方查同一張圖**。唯讀、不改 code。

**repo 根 `.mcp.json` 早已掛好 gitnexus**（HEAD `2888a36` 即存在）。Claude Code 開箱即連；**真正缺的只有兩件**：(a) 跑一次索引；(b) 把同一組設定複製到 Codex / Antigravity。

**(a) 建索引（一次性，在 repo 根）：**
```bash
npm install -g gitnexus            # 或每次 npx -y gitnexus@latest <cmd>
cd /path/to/healing-studio
gitnexus analyze .                 # 全 repo；本機無沙盒時限，會開啟語意嵌入/FTS
#   gitnexus status   看索引狀態   ｜   gitnexus analyze . --force  強制全量重建
```
> ⚠ **MCP server 只查、不建索引**——務必先 `gitnexus analyze .` 一次，否則工具回「Repository not indexed」。umbrella 每次合入子分支後由 **Claude** 重索引；任一 agent 大改完自己領域後在 §5 標「需 reindex」。

**(b) 三方 MCP 設定（同一組 server）：**

`gitnexus` MCP server（JSON，Claude Code / Cursor / Antigravity 通用）：
```json
{ "mcpServers": { "gitnexus": { "command": "npx", "args": ["-y", "gitnexus@latest", "mcp"] } } }
```
- **Claude Code**：repo 根 `.mcp.json`（已存在，內容即上方）。首次會問是否信任此 MCP server → 允許。
- **Codex（OpenAI Codex CLI）**：`~/.codex/config.toml`（TOML 格式）：
  ```toml
  [mcp_servers.gitnexus]
  command = "npx"
  args = ["-y", "gitnexus@latest", "mcp"]
  ```
- **Antigravity（Google 代理式 IDE）**：Settings → MCP / Tools（或 `mcp_config.json`）貼上方 JSON 的 `mcpServers`。

**三方高價值查詢（動手前先問圖）：**
```bash
gitnexus impact "createIntent"        # 改 commander 入口，誰會壞（merge / 改契約前必查）
gitnexus context "compileProject"     # 某符號 360°：callers / callees / processes
gitnexus query "video generation pipeline"   # 以概念找執行流
gitnexus detect-changes               # 把 git diff 對映到受影響符號與流
```
> Claude 在批准 CCR 前，用 `gitnexus impact <介面>` 查反向引用，確認影響到哪幾軌再廣播。

---

## 5. 已合入 umbrella 的子分支（Claude 維護）＋ reindex 狀態

- [x] `claude/4shell-p0-routing`（PR #852 已合入 main）
- [x] `claude/4shell-p1-spine`（契約 v1.0 已於 2026-06-06 凍結）
- [x] `codex/4shell-p2-cockpit-gate`（前端座艙與確認門已合入 PR #852）
- [ ] `claude/4shell-p3-supabase`（待 Bruce 決策 + Supabase 金鑰）
- [x] `antigravity/4shell-p5-social`（前端/mock 已合入 PR #852）
- [x] `antigravity/4shell-p6-learn-research`（前端/mock 已合入 PR #852；real adapters 待後續子分支）
- [ ] `codex/4shell-p4-director-video`（需 P3 先合；P4 補丁已備妥）
- [ ] `claude/coord-freeze-v1`（本檔已在分支提交，待 PR/merge；`gitnexus analyze . --index-only` 於 2026-06-06 失敗：`.gitnexus\lbug` IO，待修後重跑）

---

## 6. 資料夾所有權地圖（避免撞車的硬保證——每夾單一 owner）

| 資料夾 / 檔 | Owner | 備註 |
|---|---|---|
| `client/src/adapters/*`（含 `types.ts`、composition root `index.ts`） | **Claude** | 5 接縫契約；別人只 import |
| `client/src/spine/*`、`client/src/providers/SpineProvider.tsx` | **Claude** | 包覆既有 context |
| `client/src/components/chrome/*`、`client/src/components/cockpit/*`（**通用骨架**） | **Claude** | video/social 都實例化它 |
| `client/src/App.tsx`、`shared/appRegistry.ts`、`client/src/config/shells.ts` | **Claude** | 路由前綴／redirect／group→shell（改動需 CCR） |
| `server/db.ts`、`drizzle/*`、`server/services/ragMemory.ts` | **Claude** | P3 遷移 |
| `client/src/shells/settings/*`、feature-flag、`server/routers/mcpGateway.ts` | **Claude** | ④ 治理＋BYOMCP 後端 |
| `client/src/shells/video/*`、`client/src/components/{director,gate}/*` | **Codex** | /video 前端 |
| `server/subsystems/video/*`、`server/services/generation/{Mock,Hf,Fal}*.ts` | **Codex** | 影片狀態機＋HF/Fal 生成 |
| `client/src/shells/social/*`、`client/src/components/social/*` | **Antigravity** | /social 前端 |
| `client/src/shells/learn/*`、`client/src/components/learn/*` | **Antigravity** | /learn 前端＋BYOMCP 入口 UI |
| `server/services/generation/GeminiGenerationAdapter.ts`、`server/subsystems/commander/SonarCommanderAdapter.ts` | **Antigravity** | Gemini 生成/感知＋研究 |
| `server/services/generation/GenerationProvider.ts`（介面）＋`index.ts`（選擇器）、`server/subsystems/commander/{contracts,index.ts}` | **Claude（獨佔）** | **唯一會合檔**：adapter 各自掛入，由 Claude 在選擇器加一行接線 |
| `COORDINATION.md`、`.env.example`、CI 設定 | **Claude**（三方讀、寫各自區塊） | 訊息板＋旗標＋回歸門檻 |

> **共用 seam 資料夾規則**：`server/services/generation/` 與 `server/subsystems/commander/` 內**多 owner 各擁不同檔**（Codex：Mock/Hf/Fal、MockCommander；Antigravity：Gemini、Sonar；Claude：SubQ）——檔案層級單一 owner，仍零重疊。**唯一會合檔（介面＋選擇器 `index.ts`）由 Claude 獨佔**，每個 adapter 落地後由 Claude 在選擇器掛一行接入。
> **唯讀共用檔**：`drizzle/schema.ts` 既有 82 表（P0–P2 不准改；新增表 P3+ 一律加法，由 owner 在自己分支加）。

---

## 7. Review 矩陣（誰審誰）＋ Definition of Done

| PR 來自 | 第一 reviewer（架構/契約） | 第二 reviewer（接縫對位） |
|---|---|---|
| Codex（/video） | **Claude**（守契約、DB、整合風險） | Antigravity（可重用度：social 能否複用其 cockpit 沉澱） |
| Antigravity（/social、/learn） | **Claude**（零新表、脊椎、ACL） | Codex（cockpit 重用正確、生成選擇器接縫） |
| Claude（脊椎/P3/settings） | Codex（DataStore/commander 消費端） | Antigravity（Gemini/ContextPacket 消費端） |

> **Claude 一定在每個 PR 的 reviewer 列**（架構守門）。

**DoD（硬門檻，每個子分支對 umbrella 開 PR 都要過）：**
1. **回歸三件套全綠**：`npm run check:routes`／`check:smoke`／`check:navigation`（54 路由全可達、舊連結不斷）。
2. `npm run build` 通過；`npm run typecheck` 通過；`vitest` 既有測試不退步；新接縫附**介面契約測試**（mock 與 real 同簽章）。
3. 該 PR 的 feature flag 預設 OFF；OFF 時行為 == main。
4. P0–P2 不改 `drizzle/schema.ts` 既有表；新增表 P3+ 一律加法。

---

## 8. 風險 / 撞車預警（三道防線 + 觀察項）

- **三道防線**：① 資料夾互斥（§6，檔案層級零重疊→不可能 merge 衝突）；② 接縫契約凍結（§0，介面不漂移→mock==real 不翻盤）；③ feature flag 包覆（§0，各掛自己 flag、預設 OFF→出事關 flag 即回退、不連坐另兩軌）。
- ⚠ **前置整理（Claude P0/P1）**：先打斷 `PersonalSettingsContext ⇄ useMobile` 循環（純型別搬移到 `hooks/viewMode.ts`），再抽共用 provider 為脊椎單例。已含在 P0 包。
- ⚠ **生成選擇器是會合點**：Codex 的 Hf/Fal 與 Antigravity 的 Gemini 在同一個 `GenerationProvider` 選擇器（`server/services/generation/index.ts`）會合——**不同檔、由 Claude 掛入**，兩方都不改選擇器。
- ⚠ **adapter 命名校正**：對應表多項 procedure 名為「建議命名」，已由 GitNexus 對 main HEAD 校正（如 GenerationAdapter→`generate.*`、commanderPlan→`commander.createIntent`、ingestBreakdown→`worldStoryboard.createFromSegments`、rebuildPacket→`contextPacket.compileProject`）。詳見 `AI-Director_GitNexus深度整合分析.md §D`。

---

## 9. 狀態總表（P0 ready · 誰擁哪個 shell · 什麼 blocked）

| 項目 | 狀態 | 擁有者 | 說明 |
|---|---|---|---|
| **P0 路由 4-shell 骨架＋redirect＋5 adapter＋SpineProvider** | ✅ **已合入 main** | Claude | PR #852 已合入；旗標 OFF＝線上零行為改變 |
| **P1 脊椎＋契約凍結** | ✅ **v1.0 已凍結** | Claude | 5 介面 + SpineProvider 已在位；後續改簽章一律走 CCR |
| **/video shell（P2 cockpit＋確認門＋Mock 生成）** | ✅ **前端/mock 已合入 main** | **Codex** | 下一步轉 P4 backend；P2 行為仍受旗標保護 |
| **/video 真實生成（P4 兩表＋HF/Fal＋breakdown）** | ⛔ blocked 於 P3 + 金鑰 | **Codex** | 需 P3 PG 兩表與 migration；P4 補丁已備妥，可 ship dark |
| **/social shell（P5）** | ✅ **前端/mock 已合入 main** | **Antigravity** | 零新表；後續 real PostingProvider/canvas 深功能另開子分支 |
| **/learn shell＋研究（P6）＋Gemini adapter** | ✅ 前端/mock 已合入；real adapters 待接 | **Antigravity** | Sonar/Gemini/PostingProvider 需接真實 adapter 與金鑰 |
| **/settings 治理＋feature-flag＋E-QA** | ✅ 前端治理殼已合入；E-QA 持續 | Claude | provider/RBAC/觀測 UI 已在位；後端治理另按 CCR/子分支 |
| **P3 Supabase parity（MySQL→PG＋pgvector）** | ✅ **已打包，待金鑰** | Claude | `AI-Director-Supabase遷移/`（86 表已驗證可產）；上線開關＝`DATABASE_URL` |
| **BYOMCP 後端（mcpGateway＋3 表＋SubQ）＋硬化** | ⏸ P6 後段 | Claude | 與 Antigravity 的 /learn 入口 UI 分屬 |
| **GitNexus 索引** | 🔴 analyze 失敗，待修後重跑 | Claude | `.mcp.json` 已在 repo 根；`gitnexus analyze . --index-only` 失敗於 `.gitnexus\lbug` IO；本分支未提交 `.gitnexus/csv` 產物；重跑前需 pin/確認 CLI 並使用乾淨 worktree |

**目前等待**：(1) 將 `claude/coord-freeze-v1` push/PR/merge；(2) pin/確認 GitNexus CLI，於乾淨 worktree 修正 `.gitnexus\lbug` IO 失敗後重建索引；(3) P3 Supabase parity 需 Bruce 拍板 #2 向量 `halfvec(3072)` 與 #10 Auth 分軌，並備妥 Supabase 金鑰；(4) Codex P4 真實生成等 P3 migration 落地後再套用。

---

*本檔為 repo 內 live 訊息板，對齊 `AI-Director_多代理分工.md`（§3.7 模板）、`AI-Director_開發計畫.md`（P0–P6）、`AI-Director-整合包/`（整合指南・adapter對應表・PR範本・風險清單）、`AI-Director_GitNexus深度整合分析.md`（§D 校正・§G 設定）。每個里程碑由 Claude 另存 `settings_多代理協作快照_YYYY-MM-DD.md` 回流 Obsidian vault。*
