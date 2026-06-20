---
name: aidv-longloop
description: AIDV 15 步長循環開發工作流（外圈總調度 · 全開發類型 · 反跑偏 · 含測試矯正與真實腳本實測）— 把任一張 AIDV 卡（不只 Wave U 視覺，也含後端接線、基建/耐久/migration、安全維運、資料/RAG、AI 代理）從「對齊真實現況 → 依卡型出規格/UI/視覺 → Jira 排細項＋寫交接提示詞 → 寫碼掛旗標開 PR → 檢核＋技術可行性 → 完成度測試（單元/契約/eval/migration/安全＋persona）→ 矯正修復 → 合 PR＋Railway 部署 → 真實腳本實測（真站放真實腳本素材＋多情境模擬使用者）→ 反覆修正 → Jira 標完成」一條龍跑完；全程用「對齊門＋工作表範圍鎖」防止跑偏。重用既有 /aidv-plan、/aidv-board、/aidv-workflow，補上設計·視覺·部署·測試矯正·真實腳本實測。當 Bruce 說「長循環 / 15 步 / 從卡到上線 / 跑完整個開發流程 / 做下一張卡 / 要含測試與實測 / 不要跑偏 / 反覆修到好」時務必使用本技能。用法：/aidv-longloop [start | align | spec | schedule | develop | review | ship | fieldtest | status 卡號]

---

# AIDV 15 步長循環開發工作流（外圈總調度 · 執行者：智能助手 🤖）

> **白話**：拿任一張 AIDV 卡（**任何開發類型**），從「對齊現況」一路跑到「真站用真實腳本實測通過、Jira 標完成」，跑完自動接下一張——而且**全程不准跑偏**：每階都過對齊門，範圍鎖死在工作表，發現新事就開新卡、不擴張當前。
>
> **三大設計支柱**（本次強化）：
> 1. **全類型**：不只 UIUX。用「卡型路由」依卡是視覺/後端/基建/安全/資料/代理，跑對應的規格·產出·測試（§卡型路由）。
> 2. **反跑偏**：對齊門每階複查＋範圍鎖＋WIP=1；偵測漂移就 STOP-realign（§反跑偏護欄）。
> 3. **測試矯正＋真實腳本實測**：依卡型的測試矩陣＋矯正協定（找根因不貼補丁）＋真站放真實腳本素材模擬使用者，反覆修到通（§測試與矯正）。
>
> **外圈 vs 內圈分工**（別重造輪子）：排序就緒/優先序/行事曆→`/aidv-board`；進度 SSOT/下一棒/週報/Wave 收尾→`/aidv-plan`；單卡九階·三門·工作表·PR→`/aidv-workflow`。**本技能新增**：依卡型的規格/視覺（步驟 3–4）、測試矩陣（8）、部署＋真實腳本實測（11–12）、把 15 步串起來＋反跑偏＋反覆修正。

## 固定事實（過期以 git／看板為準）
- 站台 cloudId：`a70fd562-5997-4fe4-8de7-18ac3e894a29`（https://aa0968111723.atlassian.net）；專案 `AIDV`。
- 看板四欄＝`Backlog`→(21)`Selected for Development`(就緒)→(31)`進行中`→(41)`完成`。
- **設計 SSOT（視覺卡不可覆蓋）**：design-kit 亮色暖光 tokens（`uiux/AIDV_design-tokens_TokensStudio.json`）。
- 分支 `claude/<本批分支>`；commit＝中文 conventional＋Jira key。
- 驗證基準：`npx tsc --noEmit`＋`npm run check:routes`／`check:navigation`＋`npx vitest run`＋（代理卡）`npm run eval`。main baseline 13 failed/6 檔＝既有（jsdom29+vitest2），**勿當新回歸**（AIDV-29）。
- migration 三鐵則（守門測試 `server/migration-prod-pending-block.test.ts`）：①禁 `CREATE INDEX IF NOT EXISTS`；②一 breakpoint 一句；③ALTER/CREATE INDEX 走 `information_schema` 守門。
- 線上開啟政策（2026-06-16）：新任務「預設 ON＋秒回滾退路（env `VITE_*=0`／runtime `?flag=0`）」。

---

## 卡型路由（步驟 0：先判型，再決定 3–4 出什麼、8 測什麼）

> 進站先讀卡的 Wave/label/描述，判定**卡型**，套對應 profile。細節見 `references/track-profiles.md`。

| 卡型 | 例 | 步驟 3–4「出什麼」 | 步驟 8「測什麼」 | 重用 |
|---|---|---|---|---|
| **視覺/UIUX**（Wave U） | AIDV-92/95 | Claude Design 出 UI＋Adobe 精修視覺 | persona/E2E＋四態/a11y/RWD | `references/visual-asset-pipeline.md` |
| **後端/接線**（Wave 1） | AIDV-12/14 | procedure 契約＋schema（零新後端優先） | vitest 單元＋`check:routes` 契約 | `/aidv-workflow` |
| **基建/耐久/migration**（Wave 2/3） | AIDV-13/17/19 | 佇列/遷移計畫＋migration 三鐵則 | 耐久性＋`migration-prod-pending-block`＋回滾演練 | `references/test-and-correct.md` |
| **安全/維運**（Wave H） | AIDV-57/64/90 | 威脅模型＋fail-closed 設計 | 安全測試（magic-byte/fail-closed/限流） | `security`（plugin） |
| **資料/RAG** | AIDV-69/82 | 管線/檢索設計 | 檢索 eval（recall）＋注入側門安檢 | — |
| **AI 代理/planner**（Wave 4） | AIDV-23/24/25 | 規劃器/沙箱（WASM 能力式）設計 | `npm run eval` 規劃器回歸＋沙箱逃逸 | `eval` script |

> **只有「視覺卡」才走 Adobe 視覺（步驟 4）**；非視覺卡的步驟 4＝把規格落成可審查的契約/設計（schema/介面/migration 計畫/威脅模型），其餘 15 步骨架不變。

---

## 15 步總表（5 phase · 全類型）

> Owner：🤖 智能助手｜💻 你的 Code｜🎨 Claude Design｜🖌️ Adobe｜🧑 Bruce。**每兩階之間先過 🧭 對齊門**（§反跑偏）。

| # | Phase | 步驟 | Owner | 閘門／回圈 |
|---|---|---|---|---|
| 1 | **A 對齊** | 看 Jira→認領下一張卡（任一 Wave）＋**判卡型** | 🤖 | `/aidv-board audit`＋`/aidv-plan next`；🧭對齊門 |
| 2 | A | 看 live＋GitHub→抓真實現況，**不照舊圖做** | 🤖 | 差異寫進工作表；範圍鎖定 |
| 3 | **B 規格→產出** | 依卡型出規格：UI 草案／procedure 契約／遷移計畫／威脅模型 | 🎨/🤖→💻 | **🚪設計門**（含對齊門） |
| 4 | B | 視覺卡＝Adobe 精修資產；非視覺＝契約/設計定稿 | 🖌️/🤖 | 過卡型驗收前置 |
| 5 | **C 排程→開發** | Jira 開細項卡＋**寫交接提示詞** | 🤖 | `/aidv-workflow sheet`；`references/handoff-prompt-template.md` |
| 6 | C | Code 開發→寫進 healing-studio（掛旗標·分支·PR） | 💻 | `/aidv-workflow dev`+`pr`；零後端優先、reuse |
| 7 | **D 檢核→測試→矯正** | 檢核＋技術可行性→review PR、回寫 Jira | 🤖 | **🚪審查門** |
| 8 | D | 完成度測試（**依卡型測試矩陣**＋persona） | 💻🤖 | **🚪測試門**；`references/test-and-correct.md` |
| 9 | D | 回頭矯正（找根因，不貼補丁） | 💻 | 🔁 8↔9 反覆；**矯正協定** |
| 10 | D | 二次技術檢視 | 🤖 | 退回→6/9；過→E；🧭對齊門 |
| 11 | **E 上線→實測→定案** | 實際上傳→合 PR、Railway 部署 | 🧑→💻 | **🚪上線門**（Bruce 按合併＋貼金鑰；`/api/health` 綠） |
| 12 | E | **真實腳本實測**：真站放真實腳本素材＋多情境模擬使用者＋跨系統 | 🤖💻 | **🚪實測門**；`references/test-and-correct.md` |
| 13 | E | 最終矯正 | 💻 | 🔁 12↔13 反覆到真實腳本跑通 |
| 14 | E | 最終實作（清退路殘留/補測/補文件） | 💻 | — |
| 15 | E | 完工→Jira 標完成＋行事曆 | 🤖🧑 | `/aidv-plan pr-update`+`/aidv-board calendar`；**自動接 1** |

**對映九階·三門**：1–2＝階0 進站；3–5＝階1 範圍設計＋設計門；6＝階2；7–8＝階3/6＋驗證/審查門；9–10＝回圈；11＝階8；12–14＝長循環獨有的上線後真實實測；15＝階7 對帳收尾並啟動下一棒。

---

## 反跑偏護欄（不准跑偏 · 每階都過 🧭 對齊門）

> 為什麼：單人開發最大的隱形成本＝context-switching 與「很多東西快做完但都沒完成」（benchmark 報告 WIP 限制）。對齊門就是把這條變成可勾的清單。細節 `references/anti-drift.md`。

**🧭 對齊門（每進下一階前自問，全 yes 才前進）**
1. 還在認領的**那張卡**？（沒偷換、沒同時開多卡 → **WIP=1**）
2. 範圍與**工作表一句話**一致？（沒長成三句、沒夾「順便」）
3. 只動**檔案清單內**的檔？（沒擴散到 out-of-scope）
4. 仍服務**北極星**（logline→成片六步）？
5. 沒順手**接新後端/碰金鑰/改 prod 行為**？（碰到＝停下等 Bruce 拍板）

**漂移訊號（任一出現＝STOP-realign）**：開始改不在清單的檔／冒出「順便也做」／為了過測去改測而非改碼／範圍從一句變多句／同時動多張卡／用 mock 假裝通過真實情境。

**STOP-realign 協定**：偵測到漂移→**停**→寫下偏離點→回工作表重讀範圍→把新發現**開成新卡**（不擴張當前卡）→回到「唯一下一步」。

---

## 測試與矯正＋反覆修正（核心）

> 「寫完」不是「測過」，「PR 綠」不是「真站會動」。兩道測試＋矯正協定＋真實腳本實測，缺一不可。細節 `references/test-and-correct.md`。

**步驟 8 — 完成度測試（依卡型測試矩陣）**：unit(`vitest`)／契約(`check:routes`/`check:navigation`)／代理(`npm run eval`)／migration(`migration-prod-pending-block`)／安全(magic-byte/fail-closed/限流)／視覺(四態/a11y/RWD/persona)——**取卡型對應的那幾項全綠**才過測試門。

**矯正協定（步驟 9/13，反覆修正的紀律）**：
1. **先找根因**（讀 log/transcript/failing test），不貼症狀補丁。
2. **一次一假設**，改完只重跑該測＋鄰測（回歸）。
3. **同一失敗連兩輪沒解 → STOP**，`AskUserQuestion` 問 Bruce（縮範圍/拆卡/換法），不硬撞、不亂改大範圍。
4. 矯正**也要過對齊門**（沒因修 bug 而擴張範圍/接新後端）。

**步驟 12 — 真實腳本實測（淡大腳本／真站模擬使用者）**：
- 在 **Railway 部署後的真站**，用瀏覽器（Claude in Chrome）**模擬真實使用者**。
- 放**真實腳本素材**（真的一段劇本/世界觀/角色，不用 mock），跑**多情境**（新手手機、回訪桌機、社群短影音…）。
- 走完整真實使用者旅程（影片＝logline→成片六步），觀察**生成/儲存/工作流**真的活著（成本有落帳、媒體存得回、流程接得上）。
- 每個卡點→步驟 13 矯正→重測，**反覆到「真實腳本能從頭跑到匯出」**才算過實測門。

---

## 六道門（不過不前進）
1. **🧭 對齊門**（每階之間）：上面五問全 yes。**這是反跑偏的主閘**。
2. **🚪 設計門**（步驟 3 前）：零後端＋可回滾＋預設 ON（含退路）→自動通過；碰後端/金鑰/`待議`/破壞性→Bruce 拍板。視覺卡額外過 design-kit token 一致性。
3. **🚪 驗證門**（6→7）：`tsc`/`check:routes`/`check:navigation`/`vitest` 全綠。
4. **🚪 審查門**（7）：Codex/CodeRabbit 真問題→修＋補回歸；重構級/歧義→`AskUserQuestion` 問 Bruce。
5. **🚪 上線門**（11）：**只有 Bruce 按合併＋貼金鑰**；部署 `/api/health` 綠＋無 pending migration block。
6. **🚪 實測門**（12）：真實腳本素材在真站跑通生成/儲存/工作流；任一紅→步驟 13。

---

## 子命令（每段先讀對應 reference）
- `/aidv-longloop start`：跑整條 1→15；每過一道門回報，碰 🧑 門（拍板/合併/金鑰）暫停等 Bruce。
- `/aidv-longloop align`（1–2）：取下一棒＋**判卡型**＋對 live/GitHub 勘察→現況對齊摘要＋範圍鎖。
- `/aidv-longloop spec`（3–4）：依卡型出規格/產出（視覺→`visual-asset-pipeline.md`；其餘→`track-profiles.md`）。過設計門。
- `/aidv-longloop schedule`（5）：`/aidv-workflow sheet`＋交接提示詞（`handoff-prompt-template.md`）。
- `/aidv-longloop develop`（6）：`/aidv-workflow dev`→`verify`→`pr`。
- `/aidv-longloop review`（7–10）：審查門→依卡型測試矩陣→矯正協定→二次覆核。
- `/aidv-longloop ship`（11、14–15）：提示 Bruce 合併＋貼金鑰→等部署綠→收尾→標完成記行事曆→回報下一張卡。
- `/aidv-longloop fieldtest`（12–13）：真站真實腳本實測（Chrome 模擬使用者）＋反覆矯正到通。
- `/aidv-longloop status 卡號`：回報卡在 15 步哪一步、卡哪道門、下一動作誰做。

## 回圈與終止
- **內回圈**：8↔9（測試→矯正）、12↔13（實測→矯正）打轉到綠；同因連兩輪未解→`AskUserQuestion` 問 Bruce。
- **長回圈**：步驟 15 完成→**自動回 1** 認領下一張卡（依 `/aidv-board` 優先序，WIP=1），Wave 清空→交 `/aidv-plan` 提下一 Wave。
- **終止/暫停**：碰 🧑 門或偵測漂移→停下，不越線、不擴張。

## 鐵則（沿用＋本次）
1. 照工作表跑，逐欄過門不跳關；**WIP=1，一次一卡一下一步**。
2. 金鑰一律貼 Railway，絕不入卡/碼/doc/提示詞；缺金鑰標 `needs-key` 停下。
3. 白話文義務：Bruce 是工程小白，遇術語附白話。
4. 不按合併鍵、不替 Bruce 拍 `待議`；產出 Jira 留言署名「— 智能助手 🤖」。
5. **不跑偏**：發現新事開新卡，不擴張當前卡；漂移即 STOP-realign。
6. **真實才算數**：實測用真實腳本素材＋真站，不用 mock 假裝通過。

## 角色邊界
- **🤖 智能助手**：1–2、5、7、10、12、15 主責；3–4、6、8–9、13–14 調度與把關。
- **💻 你的 Code**：3（出 UI）、6、9、11（執行合併/部署）、13–14。
- **🧑 Bruce**：① `待議`/後端/金鑰拍板 ② 金鑰貼 Railway ③ 按合併 ④ 真站走查。

## 定錨（不動）
四殼一脊椎＋Wave 0–4＋平行軌（H/U/I）方向定錨；北極星 DoD＝logline→成片匯出六步，最終驗收＝惹瓊巴 30 秒成片。**要改方向先與 Bruce 確認。**

— 智能助手 🤖
