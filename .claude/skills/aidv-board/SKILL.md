---
name: aidv-board
description: AIDV 看板治理工作流（可重複運作）— 由「智能助手」執行。稽核並維持 Jira 專案 AIDV 的優先順序分級、開放工作流程 hub（AIDV-102）、就緒 lane、依賴連結，完成後把時間記入 Jira 行事曆，並鏡像進 repo 文件＋開 PR。用法：/aidv-board [audit|apply|calendar|sync]
---

# AIDV 看板治理工作流（執行者：智能助手 🤖）

> **這個技能在做什麼（白話）**：把「AIDV 看板長得整不整齊」變成一鍵可重跑的例行公事——
> 檢查優先順序有沒有亂成一片、工作流程有沒有定義、下一棒卡有沒有就緒、完成時間有沒有記上行事曆。
> 是 `/aidv-plan` 的「看板外觀與治理」分支；進度規劃仍以 `/aidv-plan` 為主。

**固定事實**
- 站台 cloudId：`a70fd562-5997-4fe4-8de7-18ac3e894a29`（https://aa0968111723.atlassian.net）
- Jira 專案：`AIDV`（kanban）；看板四欄＝`Backlog` →（轉換 id 21）`Selected for Development`(就緒) →（31）`進行中` →（41）`完成`；轉回 Backlog＝11。
- 工作流程 hub：Epic **AIDV-102**（本技能維護的單一作業面）。
- 工具：`mcp__Atlassian_Rovo__*`（read/write:jira-work）。**無 admin scope → 不能代建狀態/欄位**，只能搬既有欄＋改欄位。
- 鏡像文件：`docs/plan/AIDV-dev-workflow.md`（§4.1 分級表）＋`AIDV-master-plan.md`（§2.5c）。

## 鐵律（沿用 aidv-plan，務必遵守）
1. **不刪既有內容**；過時移 Archive（label `archived`／master-plan §7）。
2. 金鑰絕不寫入 issue／頁面／commit；一律「貼 Railway」。
3. **白話文義務**：Bruce 是工程小白，所有留言/文件遇術語附白話。
4. **完成卡不回頭改**（優先序維持 Medium、不改歷史）。
5. 不確定 → label `待議`，不擅自拍板；碰後端/金鑰/`待議` 要 Bruce 設計門拍板。
6. 所有由本技能產生的 Jira 留言、文件變更，**署名「— 智能助手 🤖」**。

## 優先順序分級表（單一準則）
| 優先序 | 給誰 |
|---|---|
| **Highest** | 生產 P0／安全外洩（如外洩金鑰撤銷） |
| **High** | 進行中 Wave 的卡＋可立即解鎖的下一棒 |
| **Medium** | 一般 Backlog（預設；完成卡也維持此值） |
| **Low** | 被金鑰/決策卡住（`needs-key`／`待議`），需等 Bruce |
| **Lowest** | 遠期 Wave 3/4、strangler 收尾刪除類 |
> 改法：`editJiraIssue` fields `{"priority":{"name":"High"}}`。只改該變的，Medium 是預設不必動。

## 子命令

### `/aidv-board audit`（預設）
1. `searchJiraIssuesUsingJql`：`project = AIDV ORDER BY key ASC`，取 `summary,status,priority,labels,parent`（結果大→存檔用 jq 取精簡表）。
2. 比對：優先序是否全 Medium（無意義訊號）？就緒欄是否空置？進行中 Wave 的下一棒是否未就緒？依賴是否缺連結？AIDV-102 是否在且 In Progress？
3. **只回報落差**，不動資料；列出建議的分級／搬卡清單給 Bruce 確認（碰既有 prod 行為先問）。

### `/aidv-board apply`
依 audit 結果（或 Bruce 同意的清單）寫入：
1. 優先順序：逐卡 `editJiraIssue` 套分級表（完成卡跳過）。
2. 工作流程 hub：確認 AIDV-102 存在；不在則 `createJiraIssue`（Epic、label `workflow,aidisc`、附四欄↔九階/三門對照＋自訂狀態後台指引），轉進行中。
3. 就緒 lane：把「下一棒」卡 `transitionJiraIssue` 到 21（Selected for Development），各補一張 🗂 工作表留言（範圍/重用/旗標/設計門/驗收/Phase）。
4. 依賴：`createIssueLink` type `Blocks`（inwardIssue=blocker、outwardIssue=blocked）。
5. **冪等**：先查再改，不重複建、不刪。

### `/aidv-board calendar`
把「完成」記上 Jira 行事曆（行事曆分頁依 `duedate` 排）：
1. **回填所有完成卡**：JQL `statusCategory = Done`，逐卡把 `duedate` 設成它的 `resolutiondate`（完成日）→ 每張完成卡落在它真正完成的那天。冪等：已等於完成日的跳過。
2. **本次收尾**：把當前任務記在 hub（預設 AIDV-102）或該收尾卡：`editJiraIssue` 設 `{"duedate":"今天"}` ＋ `addCommentToJiraIssue` 留「🗓️ 完成紀錄」（任務／完成時間 Asia/Taipei UTC+8／產出清單），署名 — 智能助手 🤖。

### `/aidv-board sync`
鏡像進 repo：更新 `AIDV-dev-workflow.md` §4.1 與 `AIDV-master-plan.md` §2.5c → commit（中文 conventional）→ `git push -u`（失敗指數退避重試 2/4/8/16s）→ 無 PR 則開 **draft** PR。

## 收尾
跑完任一子命令，用白話跟 Bruce 摘要「改了什麼／看板現在長怎樣／下一步建議」，並提醒 Highest 卡優先處理。署名 — 智能助手 🤖。
