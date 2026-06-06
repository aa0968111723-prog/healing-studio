# 交接給 Codex — `/video` 旗艦深垂直 + 影片後端可靠性工程師

> **Bruce 用法**：把本檔整段貼給 Codex（或讓 Codex 在 repo 內讀本檔）。**自足**簡報——讀完即可在自己的分支與資料夾開工，不踩別人。
> **專案**：`healing-studio`（AI-Director 4-shell 重構）｜**事實基準**：`main` HEAD `2888a36`（React19 / Vite7 / Wouter3.7.1(patched) / tRPC v11 / Drizzle）。**PR #852 已開、未合併（head `500a4e4d`）；`ENABLE_4SHELL` 預設 OFF**。
> **協作模型**：四代理並行——**守門 Claude**（架構守門／整合／QC／唯一推 GitHub）、**Claude Design**（前端 UI/UX 落地）、**你 Codex**（/video 深垂直＋影片後端）、**Antigravity**（/social＋/learn＋Gemini）。各守資料夾、只透過 5 接縫契約交換。
> **本次更新重點**：① 影片**初剪/時間軸**；② **生成包裝**（HF/Fal）；③ **影片 job 佇列/續傳/可靠性**（P4 後端，對應可靠性三件套）；④ **複驗你負責類別的開源候選精確數據**（§11）。

---

## 1. 你是誰

你是 **`/video` 旗艦深垂直 + 影片後端可靠性工程師**。你負責整個影片製作系統的前端 cockpit、確認門狀態機、**簡易初剪/時間軸**、真實 HF/Fal 生成包裝、以及**影片 job 佇列/續傳/可靠性**——專案**最深、最值錢、確認門分支最窮舉**的垂直。**你只在自己的分支與資料夾工作。**

**你的所長對位**：長、複雜、規格密集、需長時間自走的程式——狀態機、後端子系統、大型 router、嚴謹測試、佇列/重試/冪等。正中 `/video` 與影片後端可靠性。

**與 Claude Design 的分工**：Claude Design 出 `/video` 的**視覺殼與初剪 UI**（依設計規格）；你出**深功能與後端**——確認門窮舉分支、`director.*`、生成包裝、job 佇列/續傳/可靠性。初剪/時間軸的**資料形狀由你定義、與 Claude Design 對齊**（你綁狀態機/後端，它綁 UI）。

---

## 2. 你要做什麼（checklist · 每項標 輸入／輸出／依賴／DoD）

### ☐ C-P2（零金鑰，**先做**）— 分支 `codex/4shell-p2-cockpit-gate`

**1. 三欄 cockpit**
- **輸入**：`aidirector.jsx`；porting 源 `AI-Director-模擬/client/src/shells/video/`（mock 三欄骨架 + `adapters/types.ts` + `spine/`）；`shell-video/video規格.md`。
- **輸出**：`client/src/shells/video/` 下 tsx（左專案上下文／中主控台+分鏡清單／右資產+提示詞積木）。**移除 `callClaude`／`window.storage` 直連**，一律走守門 Claude 凍結的 `IDataStore` 與 `GenerationProvider`。
- **依賴**：守門 Claude P1 契約凍結 + 通用 cockpit 骨架 `components/cockpit/`；與 Claude Design 對齊殼的視覺。
- **DoD**：三欄可走；不直連後端；鏡號 `S0X` 唯一主鍵。

**2. 確認門完整狀態機** `client/src/components/gate/`
- **輸入**：`開發計畫 §3.1`（確認門全窮舉）、`§3.3`（seed/stale）；`react/GateCard.tsx`（`computeGate`/`countGate`）。
- **輸出**：角色／場景／keyframe／shot(`S0X`)／session **五實體狀態軌** + 決策矩陣（`BLOCK/PARTIAL/HOLD/OVERRIDE/UNLOCK`）+ 解鎖級聯（stale）+ 誤判覆寫 + 部分可生。
- **依賴**：cockpit（上）。
- **DoD**：五實體軌全到位；改角色→受影響鏡標 `stale` 可選擇性重生；`ready/partial/blocked` 與 `computeGate` 一致；三鐵律永遠顯示。

**3. MockGenerationAdapter** `server/services/generation/MockGenerationAdapter.ts`
- **輸入**：`GenerationProvider` 介面（守門 Claude 擁有）。
- **輸出**：回掛 `shotId=S0X` 的假 job、數秒轉 `completed` 指向佔位圖/影；支援 `?fail=timeout|429|partial|quota` 失敗注入。
- **依賴**：介面凍結。
- **DoD**：失敗注入各有正確 UI；**不遺失鏡、不重複計費**。

**4. MockCommander + video session 狀態機(in-mem) + 成本階梯雛形**
- **輸入**：`開發計畫 §3.1`；`/plan` 既有行為。
- **輸出**：先出計畫表、按「開始」才動；每次生成前顯示 `estimatedCostUsd` + 確認。
- **依賴**：上。
- **DoD**：對齊 `/plan`；媒體生成永遠先估再確認（L14）。

### ☐ C-P4（需金鑰，**等守門 Claude P3 Supabase parity 合入後**）— 分支 `codex/4shell-p4-director-video`

**5. 兩表落庫 + 影片狀態機**
- **輸入**：`AI-Director-Supabase遷移/schema.pg.additive.ts`（M3 區塊，**兩表已定義好**）；`AI-Director-P4-video後端補丁/`（18/18 測試綠）。
- **輸出**：`video_generation_sessions`／`video_segment_jobs`（**建在 Postgres、加法**）+ `server/subsystems/video/*` 狀態機（`createSession/enqueue/poll/finalizeToProject`）。
- **依賴**：⏳ **P3 parity 先合**（兩表才有 PG 落點）。
- **DoD**：`director` 的 `ScriptSegment[]` → `video_segment_jobs` → `background_jobs` → 生成 adapter → `output_asset` → `digital_asset_library` → `project_asset_links` 全鏈通；旗標 `videoSessions` OFF 時 == P2 mock。

**6. 生成包裝（HfGenerationAdapter／FalGenerationAdapter）+ 回退鏈 + 血統**（見 §2-bis B 詳述）。

**7. `director.breakdown` procedure**
- **輸入**：`adapter對應表 §4`（`director.breakdown` 待建）；`GitNexus §D`。
- **輸出**：長腳本→幕/分鏡/角色/場景，寫 `world_storyboards`；LoRA→HF Jobs。
- **依賴**：上。
- **DoD**：復用既有 `director.executeGenerationTask/pollGenerationTask/generateSegmentCostar/batchGenerateCostar`——**別重造**。

> **⚠ GitNexus 校正（動手前讀）**：真實 repo **沒有** `imageStudio.generate`／`videoStudio.generateSegment`——生成統一入口是 inline **`generate.*`**（`estimateCost→prepareJob/submitStudioJob→jobStatus/checkStudioJob→recordGenResult`），底層 `videoStudio.<model>`（~29 個逐模型 i2v/t2v，如 `klingImageToVideo/veo3TextToVideo/wanImageToVideo`）。**M3 缺的是包住它們的 session/segment 狀態機，不是生成能力**。回退鏈與 `asset_generation_events` 應錨在已存在的 `generate.recordGenResult`。詳見 `AI-Director_GitNexus深度整合分析.md §D`。

---

## 2-bis. 三個本次強化重點（細節）

### A. 影片初剪 / 時間軸（ui · /video Step 4）
- **缺口**：`/video` Step 4「打包素材 + 簡易初剪」——分鏡 `S0X` → 粗排軌道、裁切 in/out、影格↔配音/配樂配對；**rough-cut UI 待建**。
- **輸入**：`video規格.md §2 Step 4`；`assets.*`/`digital_asset_library`；音樂/配音 `proStudio.textToMusic/elevenLabsTTS/qwenTTS`。
- **輸出**：瀏覽器端初剪視圖（與 Claude Design 對齊 UI）。**開源主候選 `ffmpeg.wasm`**（瀏覽器端轉碼/裁切/拼接，不上傳即預覽合成）。
- **依賴**：Claude Design 的初剪 UI 殼；守門 Claude `IAssetStorage`。
- **DoD**：能把 `S0X` 分鏡渲染為軌道、做 in/out 與配對；長內容/渲染中/錯誤態齊全；**授權邊界寫清楚**（`ffmpeg.wasm` 包裝層 MIT，FFmpeg 本體 LGPL/GPL 依 build，用 `--enable-gpl` build 需審）。

### B. 生成包裝（Seam #2 · P4 · `generate.*`/`GenerationProvider`）
- **缺口**：HF/Fal provider、回退鏈與血統（`asset_generation_events`）。鎖定 L6（LLM 仍走 OpenRouter）、L7（生成 B 案）。
- **輸入**：`huggingface.js`（`@huggingface/inference` 生成 + `@huggingface/hub` 模型）；既有 `@fal-ai/client`；`GitNexus §D`。
- **輸出**：`HfGenerationAdapter.ts`／`FalGenerationAdapter.ts` + per-引擎選擇器（讀 `GENERATION_PROVIDER`）。
- **回退鏈（§3.2）**：text2image/i2i `hf→gemini→fal→FAILED可重試`；i2v `hf→fal(kling 白名單外接)→FAILED`；t2a `hf→fal→FAILED`；tts `hf→elevenlabs(中文保底)→FAILED`；trainLora `hf-jobs(a10g)→fal→FAILED`（不回退 mock）。
- **依賴**：兩表落庫（上）；**選擇器 `server/services/generation/index.ts` 由守門 Claude 把你的 adapter 掛入**（你不改選擇器、不碰 `GeminiGenerationAdapter`）。
- **DoD**：拔 HF key 正確回退 fal；每跳 **append-only** 寫 `asset_generation_events`（provider/model/cost/latency，失敗也寫）；血統完整；冪等鍵 = `shotId+promptHash+seed`；**vercel/ai 若用，僅限 `generateImage` 媒體抽象，嚴禁碰 LLM 閘道（L6）**——邊界標清楚。

### C. 影片 job 佇列 / 續傳 / 可靠性（spine · P0→P4 · 對應「線上 50% 失敗」）
> 這是本次最重的後端強化。**真實觸發**：`/admin` 背景任務 139 / 失敗 70（≈50% FAILED）、brain-pipeline 24 問題節點、`/ai-models-hub` 自動查核 0/115、`/admin/api-usage` 本月 $0.00。兩個**需相反處理**的根因：(a) **30 分逾時 = 架構問題**（把長生成當同步；盲目重試只是「等 30 分再失敗一次」）→ 非同步化 + 硬上限；(b) **fal 回傳格式異常 = 契約/解析 bug**（盲試永遠失敗）→ 隔離 + 嚴格 zod 解析、存原始回應、**不盲試**。

- **輸入**：`AI-Director_盲點補強.md §1.1–§1.6, §2.1, §2.4`；既有 `xstate 5.30`（job 狀態機）、`node-cron`（Reaper）；`orb_system_alerts`/`alert_configs`。
- **輸出**：
  - **可靠性三件套**：**死信佇列 DLQ ＋ 指數退避重試(+jitter) ＋ 卡住任務收割者 Reaper**；job 狀態機 `queued→running→(completed|retrying|failed|dead_letter)`。
  - **兩類失敗分流**：`failureClass` enum = `timeout | provider_format_error | quota | rate_limited | provider_rejected(nsfw/empty) | downstream_5xx | unknown`。
  - **觀測欄位（additive）**：`video_segment_jobs`/`background_jobs` 加 `jobType`(t2i/i2v/t2a/tts/lora)、`provider`、`attemptCount`、`maxAttempts`、`failureClass`、`enqueuedAt`/`startedAt`/`finishedAt`、`heartbeatAt`、`idempotencyKey`、`deadLetteredAt`。
  - **佇列**：Postgres-native 首選（免 Redis，貼合 Supabase）；韌性以 `cockatiel` 包 `generate.*`/fal 呼叫與 HF Jobs 輪詢。
  - **續傳**：大檔影片上傳/輸出以 `tus`（client + tusd on Railway）掛 `IAssetStorage` 後對接 R2/S3。
  - **退點對帳不變式（★）**：每個 `FAILED`/`dead_letter` 必有對應退點事件（`ai_usage_events` 補償列，`refundForJobId`）；**扣點總額 − 退點總額 = 成功生成實際成本**；部分成功逐鏡退；冪等退款。
  - **修 api-usage $0**：每跳寫 `asset_generation_events(provider,model,cost,latency)` → 滾入 `cost_aggregations`/`orb_cost_attribution`，「深度成本/帳單」tab 讀真實值。
- **依賴**：兩表落庫；⏳ P3 先合；觀測欄位為 additive（加法）。
- **DoD**：逾時→非同步化 + 硬上限（不再盲試 30 分）；格式異常→嚴格解析 + 存原始 + 不盲試；四指標可量（佇列深度/最舊任務年齡/吞吐/失敗率，per type×provider）；DLQ/退避/Reaper 可演示；冪等鍵不重複計費；退點對帳不變式成立。

---

## 3. 讀哪些檔（依序，全在 Downloads / repo）

1. **`COORDINATION.md`**（repo 根）+ **`00_總交接_START_HERE.md`**（本包，§E 15 紅線 / §F 安全 / §C 依賴）。
2. `AI-Director_開發計畫.md`：§2.2/§2.3（Generation/Commander 接縫）、§3.1（確認門全窮舉）、§3.2（生成失敗回退矩陣）、§3.3（seed/stale）、P2、P4、§8.2（引導式拆片）。
3. `AI-Director_盲點補強.md`：**§1（可靠性三件套、失敗分流、觀測欄位）+ §2.1（退點對帳不變式）+ §2.4（api-usage $0）必讀**。
4. `AI-Director_四大系統架構.md`：系統①（§2）、§5.2 代理層、§6 系統① 資料表、§7.2 M2/M3。
5. `AI-Director-整合包/adapter對應表.md`：§2（GenerationAdapter）、§4（AgentAdapter，含 `director.breakdown` 待建）、§7 待建清單。
6. `AI-Director_GitNexus深度整合分析.md`：**§D（adapter→真實 procedure 校正）必讀**、§E（call-chain）、§H（procedure 清單）。
7. `開源選型/{開源選型協議,GitHub初篩清單,代理分工_開源選型}.md`：**你類別的種子候選 + 複驗待辦（§11）**。
8. **已準備好的包（你 build 在其上）**：`AI-Director-P0補丁/`（P0+P1）、`AI-Director-模擬/`（cockpit porting 源）、`AI-Director-Supabase遷移/`（P3，你的兩表 + `asset_generation_events` 在 `schema.pg.additive.ts`）、`AI-Director-P4-video後端補丁/`（18/18 綠）。

---

## 4. 分支 / flag

- **分支**：`codex/4shell-p2-cockpit-gate`（P2）、`codex/4shell-p4-director-video`（P4）。從 umbrella `feat/4-shell-restructure` 開，做完開 PR 回 umbrella。
- **flag**：`videoSessions`（P4 兩表，預設 OFF）。所有新功能掛自己的 flag、預設 OFF（OFF == main）。
- **不 rebase umbrella、不碰別人分支、不開旗標、不擅改非自己領域 server**；push／合併由守門 Claude 做（Bruce 拍板）。

---

## 5. 你依賴的接縫契約（守門 Claude 凍結，你只 import、不准改簽章）

| # | 接縫 | 介面 | env 旗標 | 你的角色 |
|---|---|---|---|---|
| 1 | DataStore | `IDataStore` | `DATA_STORE=mock\|trpc` | **消費**（cockpit 讀寫走它，不直連後端） |
| 2 | **Generation** | `GenerationProvider` | `GENERATION_PROVIDER=mock\|hf\|gemini\|fal` | **你實作 mock + real（Hf/Fal）** |
| 3 | Commander | `CommanderAdapter` | `COMMANDER_ADAPTER=fallback\|sonar\|subq` | **你實作 MockCommander** |
| 4 | ContextPacket | `IContextPacketCompiler` | `CONTEXT_PACKET_MODE=mock\|rag-pinecone\|rag-pgvector` | 消費 |
| 5 | Storage（選配） | `IAssetStorage` | `STORAGE_PROVIDER=mock\|r2\|gcs\|supabase` | **消費（大檔續傳 tus 接這條）** |

- 介面在 `client/src/adapters/types.ts`（守門 Claude 擁有）。**通用 cockpit 骨架**在 `client/src/components/cockpit/`（守門 Claude 擁有，你實例化）。
- **改任何介面簽章 → 不准自己動**：到 `COORDINATION.md §3` 開 **CCR**；守門 Claude 用 GitNexus 查影響面後拍板、bump 契約版本、廣播；你再 rebase。介面增量「只加方法、不改既有簽章」；**mock 與 real 同簽章同語意**（確認門核准/成本/積分語意 mock==real）。

---

## 6. GitNexus 設定（動 `director.*` 前先查反向依賴）

repo 根 `.mcp.json` 已掛 gitnexus。你（Codex CLI）在 **`~/.codex/config.toml`** 加：
```toml
[mcp_servers.gitnexus]
command = "npx"
args = ["-y", "gitnexus@latest", "mcp"]
```
索引由守門 Claude 在 repo 根跑一次 `gitnexus analyze .`（你不必跑）。高價值查詢：
```bash
gitnexus impact "executeGenerationTask"   # 改 director 生成編排，誰會壞
gitnexus context "generateSegmentCostar"  # 既有 segment 編排 360°（你要復用）
gitnexus query "video generation pipeline"
```

---

## 7. 輸出 / 驗收（Definition of Done）

**輸出**：P2／P4 程式 + 影片初剪視圖 + 生成包裝 + job 佇列/續傳/可靠性 + 介面契約測試（mock 與 real 同簽章）+ e2e（主流程 + ≥6 例外分支）。PR 用 `PR說明範本.md` 填。

**DoD（每個 PR）**：
1. 回歸三件套全綠：`check:routes`／`check:smoke`／`check:navigation`（54 路由全可達、舊連結不斷）。
2. `npm run build`＋`typecheck` 通過；`vitest` 既有不退步；新接縫附介面契約測試。
3. 你的 flag（`videoSessions`）預設 OFF；OFF == main。
4. P2 不改 `drizzle/schema.ts` 既有表；P4 新表/新欄一律加法。

**驗收劇本**：
- **零金鑰端到端（P2）**：建專案→director 出分鏡(mock)→過確認門→mock 生成→佔位資產回寫掛回 timeline；失敗注入（timeout/429/partial/退件）各有正確 UI、**不遺失鏡不重複計費**；改角色→受影響鏡 `stale` 可選擇性重生。
- **真實生成（P4）**：拔 HF key 正確回退 fal；`asset_generation_events` 血統完整；成本入帳正確。
- **可靠性**：DLQ/退避/Reaper 可演示；逾時 vs 格式異常正確分流；退點對帳不變式成立；api-usage 不再 $0；大檔上傳中斷可續傳。

---

## 8. 與其他 agent 的接縫（會合在哪、不准碰哪）

- **← 守門 Claude**：你依賴 `IDataStore`／`GenerationProvider`／`CommanderAdapter` 介面 + 通用 cockpit 骨架 + P3 的 PG 新表。介面不准自己改——提 CCR。
- **↔ Claude Design**：`/video` 視覺殼與初剪 UI 由 Claude Design 出（依設計規格）；你出深功能與後端。**初剪/時間軸資料形狀由你定義、與 Claude Design 對齊**。把可被 `/social` 重用的 cockpit 片**沉澱、回報守門 Claude**（由它提取進通用骨架）。
- **↔ Antigravity**：你只交付 **Mock/Hf/Fal adapter 檔**（同 `GenerationProvider` 介面）；選擇器 `server/services/generation/index.ts` **由守門 Claude 掛入**——你不改選擇器、不碰 `GeminiGenerationAdapter`。
- **✗ 不要碰**：`server/db.ts`、`drizzle` 方言遷移、generation 選擇器 `index.ts`、`GeminiGenerationAdapter`、`SonarCommanderAdapter`、`/social`、`/learn`、`/settings`、commander 契約檔。

---

## 9. 你的工作如何合併進主線

1. 你在 `codex/4shell-p2-cockpit-gate`（之後 `codex/4shell-p4-director-video`）commit，做完開 PR 回 umbrella。
2. **守門 Claude 是你 PR 的第一 reviewer**（守契約/DB/整合風險），Antigravity 第二（看 cockpit 可重用度）。
3. DoD 全綠後，守門 Claude rebase umbrella、合你的子分支、把你的 generation adapter 在選擇器掛一行、跑回歸三件套、重建 GitNexus 索引。
4. 整包對 `main` 的 PR（#852，head `500a4e4d`）由守門 Claude 維護，**push 由 Bruce 最後拍板**。
5. **P4 排序**：等守門 Claude 的 P3 Supabase parity 先合進 umbrella（你的兩表才有 PG 落點），你再接真實生成。

---

## 10. 協作規則（一句話清單）

開工讀 `COORDINATION.md` + `00_總交接_START_HERE.md` + 查 GitNexus（動 `director.*` 前先查反向依賴）；你的成果掛 flag 預設 OFF；不 rebase umbrella、不碰別人分支、不開旗標、不擅改非自己領域 server；push／合併由守門 Claude 做、Bruce 拍板。**先 parity 再換功能、只加不刪。**

---

## 11. 開源選型 — 你負責複驗的類別（紙上評估 · 不安裝 · Bruce 拍板）

> **鐵律**（`開源選型協議.md`）：① 不改方向（相容 L1–L15）；② **不安裝任何東西**（零 `npm install`／零 `package.json`／零 lockfile 變更）；③ **授權 + 供應鏈雙審**；④ 偏離計畫標 `⚠️`、不列推薦、進獨立分區；⑤ **最終 Bruce 拍板，整合由守門 Claude**。回報走 `COORDINATION.md §10 @Codex 子區塊`（用協議 §4 的 12 欄範本），定稿寫進 `GitHub初篩清單.md`。

**你主責的類別**：A 影片時間軸/初剪 · B 生成閘道(HF/Fal 包裝) · C 工作佇列/可靠性(video jobs 視角，與守門 Claude 共審) · D 大檔儲存/續傳 · E agent 編排框架(僅 `CommanderAdapter` 內部 executor 參考，預設 ⚠️)。

**你的待辦**：
- ☐ **複驗種子「待複驗」欄位**：補齊下表 stars/活躍/授權的精確值（用 `api.github.com/repos/<o>/<r>`），查不到標 `≈/待複驗`、**不杜撰**。
- ☐ A 類至少再找 2 個 MIT/Apache 的瀏覽器時間軸/初剪候選（重點：授權乾淨、活躍、能渲染 `S0X` 為軌道），與 twick/ffmpeg.wasm 比較。
- ☐ B 類確認 `HfGenerationAdapter`/`FalGenerationAdapter` 用 `huggingface.js` + 既有 `@fal-ai/client` 即可，**不引會碰 LLM 閘道的庫**；血統錨 `generate.recordGenResult`。
- ☐ C 類以 video session/segment 角度評 `graphile/worker` vs `pg-boss`（Postgres-native 優先免 Redis）+ `cockatiel` 包生成呼叫；寫清楚接 `video_segment_jobs`/`background_jobs` 的工作量。
- ☐ D 類評 `tus` 對 i2v 大輸出/上傳的價值。
- ☐ E 類若研究 mastra/langgraphjs，**一律先放 ⚠️ 分區**，只描述「能否純活在 adapter 內部、可 flag OFF」；不得建議取代 commander。
- ☐ 每候選一行「接哪個真實 procedure/表」（`generate.*`/`videoStudio.<model>`/`video_segment_jobs`）。

**你類別的種子候選（2026-06-06 基準；標 ✓LIVE 為本交接包當下 `api.github.com` 實查、其餘待你複驗）**：

| 類別 | 候選 | ★ / 最後 push / 授權 | 結論 · 用在哪 |
|---|---|---|---|
| C 佇列(主A) | **graphile/worker** | **2,288★ · 2026-06-05 · MIT** ✓LIVE（43 open issues, 未 archived） | ✅推薦 · Postgres-native 佇列(SKIP LOCKED)，承 `video_segment_jobs`→生成 adapter 的 enqueue/poll/reaper |
| C 佇列(主B) | **timgit/pg-boss** | ≈3.1k★ · 2026 · MIT（**待複驗**精確值） | ✅推薦(二選一) · 同上，附 dashboard 對「50% 失敗」可觀測加分 |
| C 韌性 | **connor4312/cockatiel** | **1,789★ · 2026-05-26 · MIT** ✓LIVE（2 open issues） | ✅推薦 · 退避/熔斷/逾時/bulkhead/fallback，包 `generate.*`/fal 呼叫，零新基礎設施 |
| C 佇列(備) | taskforcesh/bullmq | ≈9k★ · MIT（pro 商用）（待複驗） | ◑條件式 · **需 Redis**，與「少新基礎設施」相左；高吞吐才選 |
| A 初剪 | **ffmpegwasm/ffmpeg.wasm** | **17,547★ · 2026-02-01 · MIT(包裝層)** ✓LIVE（⚠ 近 4 月未 push、420 open issues；FFmpeg 本體 LGPL/GPL 依 build，`--enable-gpl` 需審） | ✅推薦 · 瀏覽器端轉碼/裁切/拼接，初剪不上傳即預覽 |
| A 初剪 | ncounterspecialist/twick | 待複驗（疑 MIT/Apache）· TS/React | ◑條件式 · React 時間軸視訊編輯 SDK(MP4 匯出)，最貼 /video 初剪，先驗授權/維護 |
| A 初剪 | xzdarcy/react-timeline-editor | 待複驗 🧪 · MIT(待複驗) | ◑ · 純時間軸 widget，查活躍度 |
| A 初剪 | Augani/openreel-video | 待複驗 · TS(WebCodecs/WebGPU) | ◑ · 多軌、無浮水印，驗授權/健康度 |
| A 初剪 | remotion-dev/remotion | **Remotion License 🔶**（≤3 員工免費；營利較大組織 $100/月起 4 席；Editor Starter $600 一次性）（待複驗精確星數） | 🔶 **Bruce 決策項、非預設** · 功能最完整但授權需付費；`designcombo/react-video-editor` 依賴它、繼承同風險 |
| B 生成 | **huggingface/huggingface.js** | **2,430★ · 2026-06-06 · MIT** ✓LIVE | ✅推薦 · `@huggingface/inference` 生成 + `@huggingface/hub` 模型 → `HfGenerationAdapter` |
| B 生成 | vercel/ai (AI SDK) | ≈15k+★ · Apache-2.0（待複驗） | ◑條件式 · **僅限 `generateImage` 媒體抽象；嚴禁取代 OpenRouter(L6)** |
| B 生成 | @fal-ai/client·replicate·elevenlabs·@google/genai | 已在棧內 | ✅沿用 · 直接做各自 adapter |
| D 續傳 | **tus/tus-js-client(+tusd)** | 待複驗 · MIT · JS(client)/Go(tusd) | ✅推薦 · 可續傳上傳，掛 `IAssetStorage` 對接 R2/S3；tusd 可在 Railway |
| E 編排 | mastra / langgraphjs / CrewAI / AutoGen | 待複驗 | ⚠️偏離(L8/L10) · 最多 `CommanderAdapter` 內部 executor 參考、可 flag OFF，否則不採 |

> **授權速記**（雙審用）：MIT/Apache/PostgreSQL = ✅ 可 vendor；Remotion 自訂商用 = 🔶 Bruce 決策；FFmpeg 本體 LGPL/GPL（依 build）≠ `ffmpeg.wasm` 包裝層 MIT。**ffmpeg.wasm 近 4 月未 push（2026-02-01）= 🧪 健康度註記**，複驗時確認是否仍維護。

**§11 驗收（你這輪開源輸出）**：種子清單「你領域」待複驗欄全部補成精確值（或明確標仍查不到）；A–E 類各至少「主+備」候選、皆過 §1/§9 檢核、偏離者進 ⚠️ 區；每候選有「接哪個真實 procedure/表」一行。

---

*本簡報對齊 `00_總交接_START_HERE.md`、`AI-Director_多代理分工.md §4.1`、`AI-Director_開發計畫.md`（P2/P4）、`AI-Director_盲點補強.md`（§1 可靠性/§2 成本）、`AI-Director_GitNexus深度整合分析.md §D`、`開源選型/`（協議·清單·分工）。Codex 軌＝`codex/4shell-video`（拆 `p2-cockpit-gate`→`p4-director-video`）。*
