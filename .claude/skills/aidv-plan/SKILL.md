---
name: aidv-plan
description: AIDV 專案規劃中樞 — 以 docs/plan/AIDV-master-plan.md（Atlassian 連上後以 Jira AIDV+Confluence）為單一真實進度來源。開發前查規劃、PR 後更新進度、週報、Wave 收尾、Atlassian 同步。用法：/aidv-plan [status|next|sync|pr-update <PR#>|weekly|wave-done <N>]
---

# AIDV 規劃中樞（單一真實進度來源）

**SSOT 優先序**：Atlassian（Jira 專案 `AIDV` + Confluence 空間「AI Director 影片系統」）→ 未連接時退回 `docs/plan/AIDV-master-plan.md`。兩者並存時 Atlassian 為準、master-plan 為鏡像（同步時雙寫）。

## 鐵律（每個子命令都適用）

1. **不刪既有內容** — 過時內容移 Archive（Jira 用 label `archived`、Confluence 移 Archive 子頁、master-plan 移第 7 節）。
2. **不確定 → label `待議`**，並列入週報「待決策」。
3. **金鑰絕不寫入** issue／頁面／master-plan／commit。金鑰一律指示「貼 Railway 環境變數」。
4. 狀態詞彙固定：`Done ✅`／`In Progress 🔄`／`To Do 📋`／`Blocked ⛔`；label：`decision`／`decision-resolved`／`needs-key`／`caution`／`待議`。
5. 任何進度斷言先以 `git fetch --all --prune` ＋ GitHub PR 狀態核實，不轉述舊文件。

## 子命令

### `/aidv-plan status`（預設，無參數時執行）
1. 讀 `docs/plan/AIDV-master-plan.md` 第 2 節。
2. `git fetch` 核實各 story 的 PR 合併狀態（用 `git merge-base --is-ancestor` 與 GitHub API）。
3. 回報：各 Wave 進度、與 master-plan 不一致之處（若有 → 順手修正 master-plan）。

### `/aidv-plan next`
從 master-plan 第 2 節找「下一個該做的 story」：優先序＝當前 In Progress Wave 內的 To Do（依依賴拓撲排序）＞ Blocked 但可解鎖（提示 Bruce 拍板/給金鑰）。輸出：story、驗收、依賴、建議分支名（`feat/<slug>`）。**開發一律從這裡出發**。

### `/aidv-plan pr-update <PR#>`
PR 合併或狀態變更後執行：
1. 用 GitHub API 查 PR 狀態（merged_at／base）。
2. 更新 master-plan 第 2 節對應 story（狀態＋PR 連結＋日期）。
3. 若 Atlassian 已連：用 Jira MCP 工具把對應 issue 轉狀態＋留言記 PR 連結。
4. 同步更新 `~/.claude/.../memory/` 對應記憶檔（若有）。

### `/aidv-plan weekly`
產出給 Bruce 的週摘要（直接輸出，不寫檔）：**完成**（本週 Done）／**進行中**／**待決策**（Blocked+`decision`，逐項一句話說清楚要拍什麼板）／**卡住**（`needs-key`，列缺哪把鑰匙、貼 Railway 哪個變數名）。若 Atlassian 已連，同步發 Confluence 變更紀錄頁留言。

### `/aidv-plan wave-done <N>`
Wave 收尾：master-plan 對應 Epic 改 Done；Confluence「變更紀錄」加一節（日期＋該 Wave 全部 story＋PR 清單）；被取代的 legacy 內容移 Archive（不刪）；提示下一 Wave 的第一個 story。

### `/aidv-plan sync`（Atlassian 連上後的灌入/對帳）
**前置**：確認有 `mcp__atlassian__*`（或 Jira/Confluence/Rovo 名稱的）工具；沒有 → 停止並提示 Bruce：claude.ai／Desktop → Settings → Connectors → 搜「Atlassian」→ Connect（OAuth），或 CLI `claude mcp add --transport sse atlassian https://mcp.atlassian.com/v1/sse`。
**冪等灌入**（只建缺的、不動已有的、絕不刪）：
1. Jira：確認專案 `AIDV`（kanban）存在；依 master-plan 第 2 節逐 Epic/Story「先查同名 → 無則建、有則只補缺欄」；label/狀態照鐵律 4。
2. Confluence：確認空間「AI Director 影片系統」；依第 3 節頁面樹建頁骨架；①⑤⑥內容直接從 master-plan 與 docs/4shell-handoff/ 帶入；③④標「待補正文（向 Bruce 索取 D:/Notion 原文）」。
3. Notion 轉移：依 master-plan 第 4 節對照表逐項搬；搬完在 Notion 原頁頂端加「已遷 Confluence（連結）」，**不刪 Notion 原文**。
4. 對帳輸出：建了什麼／跳過什麼（已存在）／`待議` 清單。
（無 CSV 匯入需求時，`docs/plan/jira-import.csv` 是 MCP 不可用時的備援路徑。）

## 背景事實（節省重查；過期就以 git 為準更新）

- repo：aa0968111723-prog/healing-studio；main 在 2026-06-12 含 #852–#861、#864；#862+#863 在 `feat/4-shell-restructure` 待回流。
- migration 由 boot 時依 `drizzle/meta/_journal.json` 套用；未登記＝不會跑；0071–0074 是孤兒（`待議`）。
- 旗標：前端 `client/src/config/*Flags.ts`（ENABLE_4SHELL 階層）；後端 `env.validated.ts`＋lazy process.env。
- 驗證基準：`npx tsc --noEmit`＋`npm run check:routes`/`check:navigation`/`check`＋`npx vitest run`（main baseline 13 failed/6 檔為既有環境問題，勿當新回歸）。
- Notion 來源：規劃區頁 369b7d0ed73a81cc8dc6de9a2f6ed3d3、進度 DB 496e44e583914755a8a0f5197fb47412（collection://810695fc-6d96-4de8-864f-a997750e3cc1）。
