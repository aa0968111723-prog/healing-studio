---
name: aidv-optimize
description: AIDV 任務卡迭代優化系統（收集 → 驗證 → 去重 → 寫卡 → 路由 → 循環）— 由「智能助手 🤖」執行。專責「把別人收集到的東西變成乾淨的優化任務卡」：別的引擎（/aidv-autodev、/aidv-longloop）負責實作/實測/找漏洞；本技能負責「餵料」——多代理掃描既有稽核/優化報告、Jira 收件匣、PR 審查殘留、以及對「活的程式碼」做 UI/UX＋全端優化研究，逐項**對 HEAD 驗證是否仍成立**、對看板**去重**，再產出**格式完整、路由到擁有卡（一軌一主）的 Backlog 優化卡**，可 90 分一輪長循環。只新增 Backlog 卡（非破壞），絕不自動合碼、不改既有卡狀態、不碰 prod、不寫金鑰。當 Bruce 說「收集優化問題／把找到的變成卡／迭代優化看板／UIUX 全端研究產卡／定時循環產卡／多代理研究產優化卡」時使用。用法：/aidv-optimize [cycle | harvest | loop <分鐘> | status]
---

# AIDV 任務卡迭代優化系統（執行者：智能助手 🤖）

> **白話**：我是「**產優化卡的助手**」。別的助手（/aidv-autodev、/aidv-longloop）負責「動手做、真站實測、抓漏洞」；**我不做卡、我生卡**——把他們收集到的稽核報告、實測發現、PR 審查殘留，再加上我自己對活程式碼做的 UI/UX＋全端優化研究，**逐項對現在的程式碼確認還算不算數**、跟看板比對**有沒有重複**，最後寫成一張張「設計門/驗收/路由都填好」的 Backlog 優化卡，丟進 AIDV 看板等實作引擎來撿。每 90 分自動跑一輪。
>
> 是 [[aidv-board]]（看板治理）與 [[aidv-autodev]]（單卡實作）之間缺的那一塊：**訊號 → 卡**。重用它們的取卡/分級/留言慣例，補上「收集＋驗證＋去重＋寫卡＋循環」。

## 固定事實 / 工具鏈（過期以實況為準）

- **Jira（已連，read+write）**：`mcp__146f6b5a-*`；cloudId `a70fd562-5997-4fe4-8de7-18ac3e894a29`、專案 `AIDV`（kanban）。看板四欄＝`Backlog` →（21）`Selected for Development` →（31）`進行中` →（41）`完成`；回 Backlog＝11。**本技能只建 Backlog 卡，不轉欄、不改既有卡。**
- **開發 repo**：`C:\Users\User\healing-studio-dev`（main 為基底）。對碼驗證一律針對 **HEAD 的活程式碼**，不是針對舊文件路徑。
- **訊號來源（收件匣，harvest 掃這些）**：
  1. **repo 稽核/優化文件**：`docs/audits/*.md`（注意日期，2026-03 前多為 4-shell 重構前路徑＝**可能過時**）、`docs/4shell-handoff/AI-Director-UIUX設計/比對與優化報告.md`（§4 後端/決策、§5 低風險未做供排程）、`docs/audits/全站生成管線盤點-*.md`、`browser-audit-findings.md`。
  2. **Jira 收件匣**：label `aidisc-inbox`／`aidisc`／`qa-explore`／`gap-card`、QA 探查卡（如 AIDV-157）、AIDISC 討論區 Epic **AIDV-89**、工作流 hub **AIDV-102**。
  3. **PR 審查殘留**：未轉成卡的 Codex/CodeRabbit 真問題、`git log` 近期 merge 標記的待辦。
  4. **活程式碼掃描**（我自己研究的部分）：UI/UX 一致性（四態/a11y/reduced-motion/design-kit token 漂移）＋全端優化（tRPC 接線靜默失敗如 `projectGateway` 的 `as any` 坑、placeholder/dead 按鈕、吞錯、`any` 邊界、TODO/FIXME）。
- **UI/UX 智庫**：`.claude/skills/ui-ux-pro-max/`（離線 CSV）；`python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<關鍵詞>" --design-system -f markdown`。**SSOT＝design-kit 亮色暖光（黏土/珊瑚橘）**，token 衝突一律以 design-kit 為準（見 dev-workflow §2.5）。
- **看板鏡像/分級**：`docs/plan/AIDV-dev-workflow.md`（§3 工作表模板、§4.1 分級表）、`AIDV-master-plan.md`。每輪審計鏡像存 `docs/audits/opt-cycle-<YYYY-MM-DD>.md`（仿 AIDV-118 風格）。
- **本技能簽名**：所有 Jira 留言/卡描述/文件變更署名 **「— 智能助手 🤖」**。
- **本系統卡的標籤**：每張產出卡帶 `opt-card`（本系統來源）＋**領域標**（`uiux`／`backend`／`security`／`a11y`／`perf`／`tooling`…）＋若需 Bruce 拍板再加 `待議`＋`decision`。

## 鐵律（無人看顧下自動產卡的紀律）

1. **只新增 Backlog 卡＝非破壞**。永不自動合碼、不轉欄、不改既有卡的狀態/描述/優先序/歷史、不碰 prod、不寫金鑰。產卡是「提議」，動手仍由實作引擎＋Bruce 把關。
2. **先驗證、再寫卡（最重要）**：每個候選發現都要對 **HEAD 活程式碼**確認「①檔案/符號還在嗎 ②缺口現在還成立嗎（沒被修掉/搬走）③看板上是否已有同義卡或已完成」。**過時/已修/重複的一律丟棄，不產卡**。舊稽核文件（尤其 4-shell 重構前）只當線索，不當事實。
3. **一軌一主（路由）**：發現要**路由到擁有那個介面/子系統的卡**（如 chrome→AIDV-94、home→AIDV-119、design-kit→AIDV-92），用留言或子任務掛上；只有「無主、夠獨立、值得單獨追蹤」才開新卡。避免到處撒重複修補卡。
4. **碰後端/金鑰/破壞性/不確定 → 不自走**：這類發現產卡時加 `待議`＋`decision`，描述寫清「為何要 Bruce 拍板」，**不**標成可立即開工；其餘零後端＋可回滾的才標「設計門自動通過」。
5. **冪等**：寫卡前先 `searchJiraIssuesUsingJql` 查同義卡（標題關鍵詞／檔名），有就改/留言、沒有才建；同一輪內也去重。
6. **白話義務**：Bruce 是工程小白，卡描述/留言遇術語附白話。
7. **誠實標範圍**：自動可掃的寫清「靜態掃描層」，要人眼/真機的標「Phase 2 人工走查」留 Bruce（仿 AIDV-118 §7）。
8. **撞用量上限**（子代理「You've hit your session limit · resets <時間>」或帳號 out of credits）→ 不瞎撞，`ScheduleWakeup` 順延到重置後再跑；先把已驗證的卡寫完再停。

## 每輪流程（一條 harvest → verify → route → write pipeline）

> 範本見 `references/opt-cycle-workflow.template.js`（複製整段貼進 **Workflow** 工具跑）。主迴圈在 Workflow 回來後，**親自**建 Jira 卡（不讓子代理寫，以便對看板去重＋收口）。

1. **進站對齊**：讀看板現況（`project = AIDV ORDER BY updated DESC`，存精簡快照供去重）＋上一輪 `docs/audits/opt-cycle-*.md`（避免重產）。
2. **Harvest（平行 3–4，各掃一個模態）**：
   - A 稽核/優化文件（標每筆**新鮮度**：檔案日期、是否 4-shell 前路徑）。
   - B Jira 收件匣訊號（`aidisc-inbox`/`qa-explore`/`gap-card`、QA 卡、PR 殘留）。
   - C 活程式碼 **UI/UX** 掃描（四態/a11y/reduced-motion/token 漂移；用 ui-ux-pro-max 交付前檢查表）。
   - D 活程式碼 **全端** 掃描（tRPC 接線靜默失敗、dead/placeholder 按鈕、吞錯、`any` 邊界、TODO/FIXME、N+1/重複請求）。
   - 每筆候選結構化：`{title, area, file:line, evidence, severity, proposedFix, sourceFreshness}`。
3. **Verify + Dedupe（barrier，2 視角）**：對每個候選 → ①對 HEAD 確認檔案/符號在、缺口仍真（grep/read）②比對看板快照與既有 opt-card（標題/檔名）→ 丟過時/已修/重複 → 產**已驗證 card 規格**：`{verdict: card|route|drop, dropReason?, routeTo?, title, issuetype, priority, labels[], worksheet, designGate}`。
4. **路由/合成**：`route` 者準備留言到擁有卡；`card` 者填 dev-workflow §3 工作表（範圍/重用/檔案/旗標/設計門/驗收/風險/Phase/UI-UX 一致性/驗證），照 §4.1 分級表給優先序＋標籤。
5. **寫卡（主迴圈親自做，冪等）**：
   - `route`：`addCommentToJiraIssue` 到擁有卡（🔎 優化發現＋證據＋建議，署名）。
   - `card`：`searchJiraIssuesUsingJql` 查重 → 無則 `createJiraIssue`（Task/Story，Backlog，`additional_fields` 設 priority＋labels）→ 有依賴用 `createIssueLink`(Blocks)。
   - 在 AIDISC hub（AIDV-102 或 AIDV-89）留一則「本輪產出清單」彙總，署名。
6. **鏡像審計**：寫 `docs/audits/opt-cycle-<YYYY-MM-DD>.md`（結論一句＋發現表＋路由表＋drop 表＋Phase 2 人工項），仿 AIDV-118。
7. **Log + 順延**：`log()` 摘要本輪（產 N 卡／路由 M／丟 K）；`ScheduleWakeup` 約 90 分後再跑下一輪（撞上限順延到重置）。

## 安全/品質要點（為什麼這樣設計）

- **驗證門擋住「過時卡污染」**：舊稽核（如 `audit-findings.md` 2026-03-17）路徑多已不存在或已修（AIDV-15/64 已完成），不驗就產卡＝製造假工作。對 HEAD 驗證是本系統的命門。
- **只 Backlog＋路由＝零風險**：不動既有卡、不合碼，最壞情況是「多了一張可丟的提議卡」，永不弄壞看板或 prod。
- **一軌一主防散射**：同一缺口若四個殼都有，路由到該軌主卡一次，不開四張重複卡（仿 AIDV-118 §6 路由表）。

## 子命令

- `/aidv-optimize`（預設）＝ `cycle`：跑一輪完整 pipeline（harvest→verify→route→write→鏡像→log）。
- `/aidv-optimize harvest`：只跑 harvest＋verify，**回報候選＋已驗證規格但不寫卡**（dry-run，給 Bruce 看）。
- `/aidv-optimize loop <分鐘>`：以該間隔長循環（預設 90）；主喚醒＝Workflow 完成通知，間隔為心跳；撞上限自動順延。
- `/aidv-optimize status`：讀最近 `docs/audits/opt-cycle-*.md` ＋ `searchJiraIssuesUsingJql labels = opt-card` → 白話摘要近期產出與待 Bruce（`待議`）清單。

## 重用（別重造輪子）

取卡/分級/看板治理→[[aidv-board]]；單卡最高精度實作/合併→[[aidv-autodev]]；15 步總調度→[[aidv-longloop]]；工作表模板/三門/分級表→`docs/plan/AIDV-dev-workflow.md`；UI/UX 守則→`ui-ux-pro-max`。本技能只補「訊號 → 已驗證優化卡」這一段。

— 智能助手 🤖
