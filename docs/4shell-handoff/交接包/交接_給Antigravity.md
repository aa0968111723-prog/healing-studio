# 交接給 Antigravity — `/social` + `/learn` + 研究/Gemini + 帳務觀測工程師

> **Bruce 用法**：把本檔整段貼給 Antigravity（或讓它在 repo 內讀本檔）。**自足**簡報——讀完即可在自己的分支與資料夾開工，不踩別人。
> **專案**：`healing-studio`（AI-Director 4-shell 重構）｜**事實基準**：`main` HEAD `2888a36`（React19 / Vite7 / Wouter3.7.1(patched) / tRPC v11 / Drizzle）。**PR #852 已開、未合併（head `500a4e4d`）；`ENABLE_4SHELL` 預設 OFF**。
> **協作模型**：四代理並行——**守門 Claude**（架構守門／整合／QC／唯一推 GitHub）、**Claude Design**（前端 UI/UX 落地）、**Codex**（/video 深垂直＋影片後端）、**你 Antigravity**（/social＋/learn＋Gemini＋研究＋帳務觀測）。各守資料夾、只透過 5 接縫契約交換。
> **本次更新重點**：① **canvas 圖層拼接**(konva/tldraw 決策)；② **PostingProvider**(postiz 當服務)；③ **範本牆**；④ **模型瀏覽**(models.dev/huggingface.js)；⑤ **Canva/Adobe 整合**；⑥ **Gemini/Perplexity 研究**；⑦ **帳務與觀測**(langfuse/openllmetry/casl/openfga)；⑧ **複驗你類別的開源候選精確數據**（§11）。

---

## 1. 你是誰

你是 **`/social` + `/learn` + 研究/Gemini + 帳務觀測工程師**。你做兩個**視覺密集、需瀏覽器驗證**的 shell、研究面板、Gemini 生成/感知、帳務/觀測視圖。**善用你的編輯器＋終端＋瀏覽器三個指令面做 E2E 自驗**（寫程式→起 dev server→開瀏覽器→跑 E2E→截圖→自我修正）。**你只在自己的分支與資料夾工作。**

**你的所長對位**：Gemini 3 原生模型、Artifacts 攤開可審、瀏覽器面自走 E2E——正中前端視覺密集的 `/social`＋`/learn`，與天然配對 Gemini 的生成/感知/研究 grounding。

**與 Claude Design 的分工**：Claude Design 出 `/social`、`/learn` 的**視覺殼與共用元件**（cockpit 實例化、OrbAssistant/FlowWall/VaultBrowser/WorkflowEditor/canvas 殼）；你接**邏輯與 provider**——`GeminiGenerationAdapter`/`SonarCommanderAdapter`、PostingProvider、canvas 拼接深功能（konva/fabric 實作）、模型資料源、帳務視圖資料。**邊界先在 `COORDINATION.md` 對齊**。

---

## 2. 你要做什麼（checklist · 每項標 輸入／輸出／依賴／DoD）

### ☐ A-P5（`/social`，重用 P2 接縫、**零新表**）— 分支 `antigravity/4shell-p5-social`

**1. SocialShell（實例化通用 cockpit，不 import Codex `/video`）**
- **輸入**：porting 源 `AI-Director-模擬/client/src/shells/social/`；`shell-social/00–09`（**09＝可設定工作流_九步範本編輯器：九步為預設範本、可增刪重排，安全閘門與步驟解耦——門不隨刪步消失**）；`AI-Director_社群圖文系統設計.md`。
- **輸出**：`client/src/shells/social/*`——「brief→風格→出圖→發佈」輕量單張線（九步 S1–S9，由 Claude Design 出殼、你填邏輯）。
- **依賴**：守門 Claude P1 契約凍結 + 通用 cockpit 骨架；Claude Design 的 `/social` 殼與 WorkflowEditor。
- **DoD**：**與 `/video` 不互嵌、共用脊椎與 active project、零新表**（重用 `consistency_vault`/`block_combos`/`featured_showcase`）；mock==real 語意一致。

**2. 圖像台 + 時事選題**
- **輸入**：`generate.*`（共用 `imageStudio`，比例 1:1/9:16/16:9）；品牌/風格庫 `consistency_vault`(鎖品牌)/`block_combos`(風格模板)；發佈/精選 `featured_showcase`；時事**經脊椎**讀 `news`/`sense`（**不開 `/learn` 頁、不嵌 `/learn` UI**）。
- **輸出**：圖像台串接 + trends 面板（`social.researchTrends`→`commander.createIntent`+`orbProxy.unifiedSearch`+`news.list`）。
- **依賴**：`GenerationProvider`；脊椎 `news.list`。
- **DoD**：比例切換正確；時事走脊椎不互嵌；積分先扣後生成、失敗全額退還。

**3. canvas 圖層拼接（S6 · 本次重點 A）** — 見 §2-bis A。
**4. PostingProvider 社群發佈（S9 · 本次重點 B）** — 見 §2-bis B。
**5. 範本牆 / Flow 牆（本次重點 C）** — 見 §2-bis C。

### ☐ A-P6（`/learn` 與研究/感知/帳務）— 分支 `antigravity/4shell-p6-learn-research`

**6. LearnShell**
- **輸入**：porting 源 sim `learn/`；`shell-learn/00–04`。
- **輸出**：`client/src/shells/learn/*`——研究面板(接 `SonarCommanderAdapter`，帶引用、grounded)＋models hub＋news＋credits 視圖＋**BYOMCP 金鑰「入口 UI」**（治理在 `/settings`，守門 Claude 做）。
- **依賴**：Claude Design 的 `/learn` 殼；`SonarCommanderAdapter`（你做，下）。
- **DoD**：每屏六態；研究無 key 正確降級（Brave-only →「未經即時查證」橫幅）；procedure 全對真實名（`aiModels.list`/`agentModelPicks.recordPick`/`orbProxy.unifiedSearch`/`news.list`，**不得用不存在名**）。

**7. GeminiGenerationAdapter + Gemini 感知**
- **輸入**：`@google/genai`（已在棧內）；`GenerationProvider` 介面。
- **輸出**：`server/services/generation/GeminiGenerationAdapter.ts`（生成 provider 之一，掛進選擇器）＋**Gemini 感知**（describe/label/compare：讀參考圖、驗影格一致性、素材打標、確認門一致性比對、可選作 pgvector 嵌入來源）。
- **依賴**：**選擇器 `server/services/generation/index.ts` 由守門 Claude 掛入**（你不改選擇器、不碰 `Hf/Fal`）。
- **DoD**：可在選擇器被選中且可回退 fal；感知輸出可餵確認門/嵌入。

**8. SonarCommanderAdapter（研究 · 本次重點 F）** — 見 §2-bis F。
**9. 模型瀏覽（本次重點 D）/ Canva·Adobe（重點 E）/ 帳務觀測（重點 G）** — 見 §2-bis D/E/G。

**10. 跨軌 E2E**
- **輸出**：用瀏覽器面跑 `/video`／`/social`／`/learn` 的 playwright 主流程，**截圖回 `COORDINATION.md`**（補強守門 Claude QC）。

> **⚠ GitNexus 校正（動手前讀）**：`sense` 只有 `inferIntent`、**無 `research`**；研究/情報定錨 **`orbProxy.unifiedSearch`**（✅ 存在）＋情報清單走 `news.list`。生成統一入口是 inline **`generate.*`**（非 `imageStudio.generate`），底層 `imageStudio.<model>`（28 個逐模型）。社群版型 `showcase.templates` **確認不存在＝待建**。`agentModelPicks` 是 `recordPick`（非 `assign`）。詳見 `AI-Director_GitNexus深度整合分析.md §D`。

---

## 2-bis. 本次強化重點（細節）

### A. canvas 圖層拼接（ui · /social S6 圖層拼接合成）
- **缺口**：`/social` 海報圖層/品牌拼接——擴散背景 + **確定式文字/元素層**疊成最終單張。**文字層不進擴散**（中文/精準排版生不出）。
- **輸入**：`shell-social/04_步驟S6_圖層拼接合成UI.md`（`composeLayout` 契約 `LayoutReq{templateId,brandKitId,slots{headline,subhead,body,cta,badge},elements[],backgroundAssetId,ratioPreset}→GenJob`）；`consistency_vault`(品牌鎖)/`block_combos`(風格模板)。
- **輸出**：S6「文字排版合成」canvas（左圖層列／中畫布 safe margins+align grid／右屬性 font 限品牌·color 限品牌色票·對比 AA 徽章）。**開源主候選 `konva/react-konva`（React 原生）**，深功能備選 `fabric.js`。新方法 `social.composeLayout`（deterministic render，cost≈0 仍記帳）。
- **依賴**：Claude Design 的 canvas 殼；⏳ `social.composeLayout` 後端待建→先 mock。
- **DoD**：三正交層（block_combos=生成風格 / showcase=排版骨架 templateId / brand_kit=品牌套用）；文字層確定式不進擴散；對比 AA 徽章；**`tldraw` 因自訂授權 🔶→列 Bruce 決策項、非預設**；寫清楚接 `consistency_vault`/`block_combos`。

### B. PostingProvider 社群發佈（第 6 接縫 · P5 · 社群唯一全新接縫）
- **缺口**：`/social/publish`→多平台排程發佈。**現況 0 實作**。
- **輸入**：`shell-social/06 S9`；`社群圖文系統設計.md §6`；環境**已備 Postiz 連接器/skill**。
- **輸出**：`PostingProvider`（介面 `postNow`/`schedulePost`/`getPostStatus`，`POSTING_PROVIDER=mock|postiz`）。mock=`MockPostingAdapter`(假 permalink + `external_refs` provider:'mock')；real=`PostizPostingAdapter`(28+ 通道)。排程→`orb_scheduled_jobs`+`project_notes_calendar`+`background_jobs`；showcase→`showcase.*`。
- **依賴**：⏳ `PostingProvider` + `social.postNow/schedulePost/listCalendar` 後端待建；守門 Claude 把 adapter 掛入接縫。
- **DoD**：**Postiz 以「服務/連接器」用法**（AGPL-3.0 🔶 → **不可 vendor 原始碼**進專有平台、只用 API/hosted、Bruce 確認商業合規）；3 道發佈前確認（品牌 locked / 來源確認 / 成本）；拒件→`failed`+原因（**絕不靜默當成功**）；限流→退避+jitter；排程衝突→冪等鍵(`postId+channel+scheduledAt`)；通道未授權→停在「已產出、可下載多尺寸包」、旅程仍算完成；**再找 1 個備援**（自架/其他 OSS 排程器）比較平台覆蓋與授權。

### C. 範本牆 / Flow 電視牆（ui · spine · `featured_showcase`/`showcase.templates`待建）
- **缺口**：範本牆（`showcase.templates` **確認待建**）、Flow 電視展示牆、gallery。提示詞庫 CRUD 已存在（`promptLibrary.*`/`customBlocks.*`/`blockCombos.*` 5 表，**OSS 不需取代**，只補「展示/瀏覽 UI」）。
- **輸入**：`shell-social/03`（Flow 牆）；Claude Design 的 `FlowWall`/`VaultBrowser`。
- **輸出**：Flow 展示牆/精選牆/官方範本牆——**開源主候選 `react-photo-album`**（masonry/justified/SSR）+ `yet-another-react-lightbox`（細節檢視）。延伸=推 seed+prompt 回 S4；套=套風格+排版；放映模式。
- **依賴**：Claude Design 的 FlowWall 殼；⏳ `showcase.templates` 後端待建→先 mock；資料 `assets.list`+`notesCurator.searchAssets`+`promptLibrary`+`showcase.*`。
- **DoD**：繼承全部 token、**不另立新色**；找是否有現成「範本/模板牆」OSS（MIT 優先）；閉環 posted→showcase→可被他人在 Flow 牆延伸。

### D. 模型瀏覽（ui/data · /learn · 115 模型 `aiModels`）
- **缺口**：模型目錄資料源 + 大列表瀏覽 UI（115 模型、5 腦指派）。
- **輸入**：`shell-learn/01`；`aiModels.list({modality,provider,tier})`；`agentModelPicks.recordPick`（**非 assign**）。
- **輸出**：模型情報瀏覽器（4 統計卡 115/~35/~26/100% + 5 腦指派 + modality/provider/tier 過濾 + 虛擬化大列表 + 詳情）。**開源組合 `models.dev`(資料源) + `TanStack Table/Virtual`(大列表，同 @tanstack 家族零摩擦) + `huggingface.js`(`listModels/modelInfo` 補 HF 清單)**。
- **依賴**：Claude Design 的 `/learn` 殼。
- **DoD**：對位 `aiModels.*`、5 腦指派；`models.dev` **資料授權待複驗**；procedure 全對真實名。

### E. 設計工具整合 Canva / Adobe（外部連接器 · /social S7）
- **缺口**：對外設計/出圖整合（往返）。**多為專有 SaaS SDK，非 GitHub 核心 OSS**——以官方 SDK/連接器接入、**非 vendor npm**。
- **輸入**：`shell-social/05 S7`（🔌 integration points 真實連接器工具名/簽章）；環境**已備 Canva 連接器 + Adobe 連接器（MCP）**。
- **輸出**：Canva 往返（`import-design-from-url`(需 public HTTPS via `getSignedUrl`)→`get-export-formats`→`export-design`、`create-design-from-brand-template`、`list-brand-kits`、`resize-design`）；Adobe（**`adobe_mandatory_init` 必先**+`image_remove_background`/`image_generative_expand`/`image_vectorize`/`document_render_layout`(InDesign→PDF 300dpi)/`create_firefly_board`/`font_recommend`）。拉回=append 新資產(`sourceStudio:'canva'|'adobe'`)+source HOLD。façade `social.sendToCanva/pullFromCanva/adobeEdit`。
- **依賴**：⏳ façade 後端待建；連接器已備。
- **DoD**：source-of-record 留本站；用官方 API/連接器不 vendor；**計費/條款標為 Bruce 決策**。

### F. Gemini / Perplexity 研究（#3 · P6 · 研究 grounding 補強）
- **缺口**：研究面板（Sonar+Brave 帶引用）+ commander 降級。
- **輸入**：`shell-learn/03`；`開發計畫 §3.4`（代理降級 Sonar→Brave-only→無 grounding）；`orbProxy.unifiedSearch`（**`sense` 只有 `inferIntent`**）。
- **輸出**：`SonarCommanderAdapter`（Sonar＋Brave，帶引用、grounded）。研究 done-state action：存為筆記(`notes.create`)/存成提示詞(`promptLibrary.create`)/加入知識庫(`contextPacket.compileProject`)/Flow 牆展示。
- **依賴**：守門 Claude 把 adapter 掛入 commander 選擇器。
- **DoD**：帶引用；無 key 降級正確；相容 L9（**Perplexity 為備援、Sonar 主線**；研究主線不可換）；以現況棧 + 官方 SDK 為主。

### G. 帳務 / 觀測視圖（spine/settings · /learn credits/api-usage，與守門 Claude 共審）
- **缺口**：`/admin/api-usage` 費用顯示 **$0**（成本沒記）、trace、成本帳本。現況已用 LangSmith。
- **輸入**：`shell-learn/02`（積分/用量視圖）；`盲點補強 §2.4`（api-usage $0）。
- **輸出**：/learn 帳務視圖（餘額<120 紅 + 退點對帳 + usage records 唯讀）。**觀測補強候選 `openllmetry`(OpenTelemetry 標準/輕，與 LangSmith 並存) vs `langfuse`(自架需 ClickHouse)**。
- **依賴**：成本資料來自 Codex/Claude 寫的 `asset_generation_events`→`cost_aggregations`（你做視圖、不做核心帳本）。
- **DoD**：對位修「api-usage $0」；`openllmetry` Apache-2.0 ✅ 與 LangSmith 並存（不大爆炸換棧）；`langfuse` 自架授權邊界需審（見 §11）；RBAC 授權（`casl`/`openfga`）屬守門 Claude 主審，你遇到相關候選提報即可。

---

## 3. 讀哪些檔（依序，全在 Downloads / repo）

1. **`COORDINATION.md`**（repo 根）+ **`00_總交接_START_HERE.md`**（本包，§E 15 紅線 / §F 安全 / §C 依賴）。
2. `AI-Director_開發計畫.md`：P5、P6、§3.4（代理降級）、§5.2（Gemini）、§10.3（提示詞庫/風格庫）。
3. `AI-Director_社群圖文系統設計.md`（社群線專章，含 PostingProvider/Postiz、brand-lock、多尺寸）。
4. `AI-Director_四大系統架構.md`：系統②（§2）、系統③（§2）、§5.2 代理層（Gemini 方案 B）、§7.1 棧。
5. `AI-Director-整合包/adapter對應表.md`：§3（ResearchAdapter）、§2（生成 Gemini provider）、§5（DataAdapter `listNews/listTemplates`）、§7 待建（social templates、SubQ）。
6. `AI-Director_GitNexus深度整合分析.md`：**§D（adapter→真實 procedure 校正）必讀**、§H（procedure 清單）。
7. `開源選型/{開源選型協議,GitHub初篩清單,代理分工_開源選型}.md`：**你類別的種子候選 + 複驗待辦（§11）**。
8. **已準備好的包（你 build 在其上）**：`AI-Director-P0補丁/`（P0+P1，含 `SocialShell.tsx`/`LearnShell.tsx` 薄包裝）、`AI-Director-模擬/`（porting 源）、`AI-Director-P5-social補丁/`（零新表）、`AI-Director-P6-learn補丁/`、`AI-Director-settings補丁/`。

---

## 4. 分支 / flag

- **分支**：`antigravity/4shell-p5-social`（P5）、`antigravity/4shell-p6-learn-research`（P6）。從 umbrella `feat/4-shell-restructure` 開，做完開 PR 回 umbrella。
- **flag**：`shellSocial`、`research`、`geminiProvider`、`byomcp`（**皆預設 OFF**，OFF == main）。
- **不 rebase umbrella、不碰別人分支、不開旗標、不擅改非自己領域 server**；push／合併由守門 Claude 做（Bruce 拍板）。

---

## 5. 你依賴的接縫契約（守門 Claude 凍結，你只 import、不准改簽章）

| # | 接縫 | 介面 | env 旗標 | 你的角色 |
|---|---|---|---|---|
| 1 | DataStore | `IDataStore` | `DATA_STORE=mock\|trpc` | **消費**（/social、/learn 讀寫走它） |
| 2 | **Generation** | `GenerationProvider` | `GENERATION_PROVIDER=mock\|hf\|gemini\|fal` | **你實作 real（GeminiGenerationAdapter）** |
| 3 | **Agents/Commander** | `CommanderAdapter` | `COMMANDER_ADAPTER=fallback\|sonar\|subq` | **你實作 real（SonarCommanderAdapter）** |
| 4 | ContextPacket | `IContextPacketCompiler` | `CONTEXT_PACKET_MODE=mock\|rag-pinecone\|rag-pgvector` | 消費（Gemini 可選作嵌入來源） |
| 5 | Storage（選配） | `IAssetStorage` | `STORAGE_PROVIDER=mock\|r2\|gcs\|supabase` | 消費 |
| **6** | **PostingProvider**（社群唯一全新接縫） | `PostingProvider`（待建） | `POSTING_PROVIDER=mock\|postiz` | **你實作 mock + real（PostizPostingAdapter，當服務）** |

- 介面在 `client/src/adapters/types.ts`（守門 Claude 擁有）。**通用 cockpit 骨架**在 `client/src/components/cockpit/`（守門 Claude 擁有，你 `/social` 實例化它——**不是 import `/video`**）。
- **改任何介面簽章 → 不准自己動**：到 `COORDINATION.md §3` 開 **CCR**；守門 Claude 拍板、bump、廣播；你再 rebase。**mock 與 real 同簽章同語意**。
- **BYOMCP 後端**（`mcpGateway`＋3 表＋治理）**是守門 Claude 的**；你只做 `/learn` 的「入口 UI」與連到 `/settings` 的連結。

---

## 6. GitNexus 設定（動 `imageStudio`/`news`/`sense` 前先查）

repo 根 `.mcp.json` 已掛 gitnexus。Antigravity 在 **Settings → MCP / Tools**（或 `mcp_config.json`）加：
```json
{ "mcpServers": { "gitnexus": { "command": "npx", "args": ["-y", "gitnexus@latest", "mcp"] } } }
```
索引由守門 Claude 在 repo 根跑一次 `gitnexus analyze .`（你不必跑）。高價值查詢：
```bash
gitnexus impact "unifiedSearch"        # 改研究入口，誰會壞
gitnexus context "compileProject"      # ContextPacket 編譯鏈（Gemini 嵌入會碰）
gitnexus query "social image studio"
```

---

## 7. 輸出 / 驗收（Definition of Done）

**輸出**：`/social` 與 `/learn` 兩 shell＋`GeminiGenerationAdapter`＋`SonarCommanderAdapter`＋`PostingProvider`(mock+postiz)＋canvas 拼接＋模型瀏覽＋帳務視圖＋介面契約測試＋**你瀏覽器面跑出的 E2E 截圖證據**。PR 用 `PR說明範本.md` 填；**確認「零新表」**（/social）。

**DoD（每個 PR）**：
1. 回歸三件套全綠：`check:routes`／`check:smoke`／`check:navigation`（54 路由全可達、舊連結不斷）。
2. `npm run build`＋`typecheck` 通過；`vitest` 既有不退步；新接縫附介面契約測試（mock 與 real 同簽章）。
3. 你的 flag（`shellSocial`/`research`/`geminiProvider`/`byomcp`）預設 OFF；OFF == main。
4. `/social` **零新表**（重用 `consistency_vault`/`block_combos`/`featured_showcase`）。

**驗收劇本**：
- **/social 端到端**：brief→出圖→圖層拼接→發佈 showcase 通、**與 /video 不互嵌**、共用脊椎與 active project、零新表。
- **/learn 研究**：帶引用；無 key 時正確降級（Brave-only →「未經即時查證」橫幅）。
- **Gemini adapter**：可在選擇器被選中且可回退 fal。
- **PostingProvider**：mock 假 permalink；Postiz 當服務（不 vendor）；拒件不靜默。
- **E2E 截圖**：佐證三 shell（/video、/social、/learn）主流程，貼回 `COORDINATION.md`。

---

## 8. 與其他 agent 的接縫（會合在哪、不准碰哪）

- **← 守門 Claude**：你依賴 `IDataStore`／通用 cockpit 骨架／`CommanderAdapter`／`GenerationProvider`／`appRegistry` group→shell／第 6 接縫掛入。介面不准自己改——提 CCR。BYOMCP 後端是守門 Claude 的，你只做入口 UI。
- **↔ Claude Design**：`/social`、`/learn` 視覺殼與共用元件（cockpit/OrbAssistant/FlowWall/VaultBrowser/WorkflowEditor/canvas 殼）由 Claude Design 出；**你填邏輯與 provider**。canvas S6 的 UI 殼由 Claude Design 出、你接 konva/fabric 實作——**邊界先在 `COORDINATION.md` 對齊**。
- **↔ Codex**：你只交付 **`GeminiGenerationAdapter.ts`**（同 `GenerationProvider` 介面）；選擇器 `index.ts` **由守門 Claude 掛入**——你不改選擇器、不碰 `Hf/Fal` 檔。**`/social` 重用「通用 cockpit 骨架」而非 Codex `/video` 元件**。
- **✗ 不要碰**：`server/subsystems/video/*`、generation 選擇器 `index.ts`、`Hf/Fal` adapter、`MockGenerationAdapter`、`server/db.ts`、`/settings` 治理後端、commander 契約檔。

---

## 9. 你的工作如何合併進主線

1. 你在 `antigravity/4shell-p5-social`（與 `…p6-learn-research`）commit，做完開 PR 回 umbrella。
2. **守門 Claude 是你 PR 的第一 reviewer**（守零新表/脊椎/ACL），Codex 第二（看 cockpit 重用正確、生成選擇器接縫）。
3. DoD 全綠後，守門 Claude rebase umbrella、合你的子分支、把 `GeminiGenerationAdapter`/`PostingProvider` 在選擇器掛一行、跑回歸三件套、重建 GitNexus 索引。
4. 整包對 `main` 的 PR（#852，head `500a4e4d`）由守門 Claude 維護，**push 由 Bruce 最後拍板**。
5. **排序**：P5 只需 P1 契約凍結（**不需等 Codex P2**）即可開工；P6 研究面可早做。

---

## 10. 協作規則（一句話清單）

開工讀 `COORDINATION.md` + `00_總交接_START_HERE.md` + 查 GitNexus（動 `imageStudio`/`news`/`sense` 前先查）；**嚴守「shell 不互嵌、只走脊椎」**；你的成果掛 flag 預設 OFF；不 rebase umbrella、不碰別人分支、不開旗標、不擅改非自己領域 server；push／合併由守門 Claude 做、Bruce 拍板。**先 parity 再換功能、只加不刪。**

---

## 11. 開源選型 — 你負責複驗的類別（紙上評估 · 不安裝 · Bruce 拍板）

> **鐵律**（`開源選型協議.md`）：① 不改方向（相容 L1–L15）；② **不安裝任何東西**；③ **授權 + 供應鏈雙審**（**AGPL/GPL 🔶 只能當服務/連接器、不 vendor**；自訂/商用 🔶 讀條款標成本）；④ 偏離計畫標 `⚠️`、進獨立分區；⑤ **最終 Bruce 拍板，整合由守門 Claude**。回報走 `COORDINATION.md §10 @Antigravity 子區塊`（協議 §4 範本），定稿寫進 `GitHub初篩清單.md`。

**你主責的類別**：F canvas 圖層拼接 · G 社群發佈 PostingProvider · H gallery/範本牆/提示詞展示 · I 模型登錄/瀏覽 UI 與資料源 · J 設計工具 Canva/Adobe · K Gemini 生成/感知 + 研究 grounding · L 帳務/觀測視圖(與守門 Claude 共審)。

**你的待辦**：
- ☐ **複驗種子「待複驗」欄位**：補齊下表 stars/活躍/授權精確值（`api.github.com/repos/<o>/<r>`），查不到標 `≈/待複驗`、**不杜撰**。
- ☐ F：確認 `konva/react-konva`(React 原生) 為 /social 圖層首選、`fabric.js` 深功能備選；`tldraw` 自訂授權→Bruce 決策項。寫清楚接 `consistency_vault`/`block_combos`。
- ☐ G：以「服務/連接器」用法評 `postiz-app`(AGPL→不 vendor)；確認環境 Postiz 連接器可接；**再找 1 個備援**比較平台覆蓋與授權。
- ☐ H：`showcase.templates` 待建 → 評 `react-photo-album`(+lightbox) 作 Flow/精選牆；找現成「範本牆」OSS(MIT 優先)。
- ☐ I：確認 `models.dev`(資料源,資料授權待複驗)+`TanStack Table/Virtual`(大列表)+`huggingface.js`(補 HF 清單)；對位 `aiModels.*`、5 腦指派。
- ☐ J：Canva(Connect API/連接器)、Adobe(Firefly/Express Embed/連接器) 以**官方 SDK/連接器**評、非 vendor npm；計費/條款為 Bruce 決策。
- ☐ K：`GeminiGenerationAdapter`/`SonarCommanderAdapter` 以現況棧 + 官方 SDK 為主；研究定錨 `orbProxy.unifiedSearch`+`news.list`；輔助庫須相容 L9。
- ☐ L：以 /learn 帳務視圖角度評 `openllmetry`(標準/輕,✅) vs `langfuse`(自架需 ClickHouse,◑)；對位修「api-usage $0」。RBAC(`casl`/`openfga`)主審在守門 Claude，遇到提報。
- ☐ 可用瀏覽器面開候選 demo 站截圖佐證健康度（加分）。
- ☐ 每候選一行「接哪個真實 procedure/表/元件」（`generate.*`/`consistency_vault`/`featured_showcase`/`aiModels.*`/`orbProxy.unifiedSearch`）。

**你類別的種子候選（2026-06-06 基準；✓LIVE 為本交接包當下 `api.github.com` 實查、其餘待你複驗）**：

| 類別 | 候選 | ★ / 最後 push / 授權 | 結論 · 用在哪 |
|---|---|---|---|
| F canvas(主) | **konvajs/konva (+react-konva)** | konva ≈12k★ · MIT；react-konva v19.2.4 @ 2026-05-08（**待複驗**精確星數） | ✅推薦 · React 宣告式 2D canvas → 海報圖層拼接、品牌套版（L1/L11） |
| F canvas(備) | **fabricjs/fabric.js** | ≈30k★ · MIT（待複驗） | ✅推薦 · 成熟物件模型(序列化/濾鏡/文字)，非 React 原生需薄包裝 |
| F canvas | excalidraw/excalidraw | ≈80k+★ · MIT（待複驗） | ◑ · 偏白板，非海報級精準排版 |
| F canvas | **tldraw/tldraw** | **47,546★ · 2026-06-01 · 自訂授權(NOASSERTION) 🔶** ✓LIVE（SDK 預設浮水印、移除需付費；PR 限協作者） | ◑/🔶 **Bruce 決策項、非預設** · 無限畫布 SDK 強但授權成本 |
| G 發佈(主) | **gitroomhq/postiz-app** | **30,767★ · 2026-05-24 · AGPL-3.0 🔶** ✓LIVE | ◑條件式 · `PostingProvider` 後端，**只當外部服務/連接器/MCP、不 vendor**，Bruce 確認商業合規；28+ 平台 |
| H 展示牆(主) | igordanchenko/react-photo-album | ≈2.6k★ · MIT（待複驗） | ✅推薦 · 響應式相簿(masonry/justified/SSR) → Flow/精選牆 |
| H 展示牆(備) | igordanchenko/yet-another-react-lightbox | 待複驗 · MIT | ◑ · 點開大圖/輪播 |
| I 模型資料(主) | sst/models.dev | 待複驗（疑 MIT；**資料另有授權須查**） | ✅推薦 · AI 模型規格/定價/能力 DB(TOML→JSON) → /learn 115 模型 + 成本估算 |
| I 大列表 | **TanStack Table + Virtual** | 待複驗(皆大) · MIT | ✅推薦 · 虛擬化大列表，**已用 @tanstack/react-query 同家族零摩擦** |
| I 模型清單 | **huggingface/huggingface.js** | **2,430★ · 2026-06-06 · MIT** ✓LIVE | ✅ · `@huggingface/hub` `listModels/modelInfo` 即時補 HF 清單 |
| J 設計工具 | canva/canva-apps-sdk-starter-kit | 待複驗 · TS | ◑ · 用 Connect API/連接器、SDK starter 僅參考；非 vendor |
| J 設計工具 | Adobe Firefly/Express Embed/Photoshop API | 專有 SaaS(非 OSS)；環境已備連接器 | ◑ · 用官方 API/連接器；計費由 Bruce 確認 |
| L 觀測(主) | **traceloop/openllmetry** | **7,153★ · 2026-05-29 · Apache-2.0** ✓LIVE | ✅推薦 · OpenTelemetry 標準 LLM/向量 instrumentation，vendor-neutral，與 LangSmith 並存(L6 只觀測) |
| L 觀測(備) | **langfuse/langfuse** | **28,219★ · 2026-05-30 · Other/NOASSERTION 🔶** ✓LIVE（MIT core + EE 商用子目錄；自架需 Postgres+ClickHouse） | ◑條件式 · 要自主掌控觀測資料才採；**授權邊界(EE 部分)需審**；否則先 openllmetry + 現有 LangSmith |
| L RBAC(守門主審) | stalniy/casl | 6,949★ · MIT ✓(種子 2026-06-06) | ✅(守門 Claude 主審) · 同構授權庫，落地 `project_data_access_rules`/teams ACL，**不碰登入**(L13) |
| L RBAC(守門主審) | openfga/openfga | **5,203★ · 2026-05-28 · Apache-2.0** ✓LIVE | ◑(守門 Claude 主審) · Zanzibar ReBAC，**獨立服務**(多一元件)，重型替代 casl |
| ⚠️ 偏離 | Supabase Auth/Lucia/Auth.js/Better-Auth | — | ⚠️偏離(L13) · 登入維持自建 JWT；只可補「授權(RBAC)」不可換「認證」 |

> **授權速記**（雙審用）：MIT/Apache/PostgreSQL = ✅ 可 vendor；**AGPL（postiz）= 🔶 只當服務/連接器、不 vendor**；**自訂（tldraw）/Other(langfuse EE) = 🔶 讀條款標成本、Bruce 決策**；無授權 = ❌。`models.dev` **資料授權**與 repo 授權分開查。

**§11 驗收（你這輪開源輸出）**：種子清單「你領域」待複驗欄全部補成精確值；F–L 類各至少「主+備」候選、皆過 §1/§9、偏離者進 ⚠️ 區；AGPL/自訂授權一律標「服務/連接器」用法或 Bruce 決策；每候選有「接哪個真實 procedure/表/元件」一行。

---

*本簡報對齊 `00_總交接_START_HERE.md`、`AI-Director_多代理分工.md §4.2`、`AI-Director_開發計畫.md`（P5/P6）、`AI-Director_社群圖文系統設計.md`（PostingProvider/Postiz·brand-lock·多尺寸）、`AI-Director_GitNexus深度整合分析.md §D`、`開源選型/`（協議·清單·分工）。Antigravity 軌＝`antigravity/4shell-social-learn`（拆 `p5-social`＋`p6-learn-research`）。*
