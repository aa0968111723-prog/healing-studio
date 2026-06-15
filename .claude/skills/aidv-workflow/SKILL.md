---
name: aidv-workflow
description: AIDV 開發執行工作流（每張卡從想法走到合併）— 由「智能助手」執行。把 docs/plan/AIDV-dev-workflow.md＋Jira Epic AIDV-102 的九階流水線・三道門變成可執行流程：取下一棒→填工作表→開發→過三門→PR→對帳。用法：/aidv-workflow [next|sheet <KEY>|dev|verify|pr|review|reconcile]
---

# AIDV 開發執行工作流（執行者：智能助手 🤖）

> **這個 skill 在做什麼（白話）**：拿到一張 Jira 卡後，帶著它「照工作表、過三道門」一路走到 PR 合併，不跳關。
> **與 `/aidv-board` 的分工**：`/aidv-board`＝看板**治理**（優先序、就緒 lane、行事曆）；本 skill＝單張卡的**開發執行**。先用 board 排好序，再用 workflow 把卡做掉。
> **SSOT**：Jira 專案 `AIDV`（cloudId `a70fd562-5997-4fe4-8de7-18ac3e894a29`）＋鏡像 `docs/plan/AIDV-dev-workflow.md`、hub Epic `AIDV-102`。

## 鐵則（每階都適用）
1. **一律照工作表跑**——任何開發（含 hotfix）都要有一張工作表，逐欄走過九階、過三道門。
2. 金鑰絕不寫進卡/程式碼/doc，一律「貼 Railway」。
3. **白話文義務**：Bruce 是工程小白，留言/PR 遇術語附白話。
4. 分支固定 `claude/<本批分支>`；commit 用中文 conventional ＋ Jira key。
5. 不按合併鍵、不貼金鑰、不替 Bruce 拍 `待議`。
6. 本 skill 產生的 Jira 留言/文件署名 **「— 智能助手 🤖」**。

## 九階流水線（看板四欄對映）
| 階 | 名稱 | 做什麼 | 看板欄 | 閘門 |
|---|---|---|---|---|
| 0 | 進站 | 讀 SSOT＋`/aidv-board` 取下一棒 | Backlog | 卡存在、依賴已解 |
| 1 | 範圍設計 | 填工作表（§下方模板）貼進卡描述/留言 | Backlog→就緒 | **🚪設計門** |
| 2 | 開發 | 旗標 default OFF、零後端優先、reuse 既有 procedure | 進行中 | 自評符合工作表 |
| 3 | 驗證 | 跑驗證基準 | 進行中 | **🚪驗證門** |
| 4 | 提交推送 | commit＋`git push -u`（失敗指數退避 2/4/8/16s） | 進行中 | push 成功 |
| 5 | 開 PR | 無則開 **draft**；body 附驗收清單 | 進行中 | body 驗收齊 |
| 6 | 審查 | 接 Codex／CodeRabbit 逐條 triage、修真問題、跑回歸 | 進行中 | **🚪審查門** |
| 7 | 對帳 | Jira 轉狀態＋留 PR 連結；master-plan §2 鏡像 | 進行中→完成 | 三處一致 |
| 8 | 合併收尾 | Bruce 按合併→轉完成；Wave 收尾加變更紀錄；行事曆記完成日 | 完成 | PR merged |

## 三道門（不過不前進）
- **🚪 設計門（1→2）**：零後端＋旗標 OFF＋可回滾 → **自動通過**；碰後端／碰金鑰／標 `待議`／改既有 prod 行為 → **需 Bruce 在卡上拍板**。
- **🚪 驗證門（3→4）** 全綠才推：
  ```
  npx tsc --noEmit
  npm run check:routes
  npm run check:navigation
  npx vitest run <新測> <鄰測>
  ```
  避雷：jsdom29+vitest2 的 main baseline 13 failed/6 檔＝既有，**勿當新回歸**（AIDV-29）。
- **🚪 審查門（6→7）**：Codex P1/P2、CodeRabbit 真問題→**修＋補回歸測試**重跑驗證門；nitpick 划算就補、否則一句理由略過；工具自帶非本 repo 門檻略過註明；重構級/有歧義→**AskUserQuestion 問 Bruce**；草稿期/重複事件靜默跳過。

## 工作表模板（每張卡填這張，貼進卡描述）
```
### 🗂 工作表 — <卡號> <標題>
- 進站來源：<aidv-board next / AIDISC / Bruce 指示>
- 北極星對位：<推進 logline→成片 的哪一步>
- 範圍：<做什麼，一句話>
- 重用既有：<reuse 哪些 LIVE procedure/元件>
- 檔案：<要改/新增的檔>
- 旗標：<flag 名 · 預設 OFF>
- 設計門：<自動通過 ✓ / 待 Bruce 拍板（原因）>
- 驗收：<可觀察的通過條件>
- 風險/避雷：<…>
- Phase：<本卡做到哪 / 下一 Phase 待什麼>
- 驗證：tsc / routes / navigation / 測試 <案數>
- PR / commit：<連結>
```

## 子命令
- `/aidv-workflow next`：階0–1。取下一棒（依 `/aidv-board` 優先序＋依賴拓撲），對碼勘察，產出工作表草稿給 Bruce 過設計門（碰後端/金鑰/`待議` 要拍板）。
- `/aidv-workflow sheet <KEY>`：把某張卡的工作表填實並貼進該卡（描述附加或留言，**不刪既有內容**），轉「就緒」。
- `/aidv-workflow dev`：階2。在分支照 repo 慣例開發（旗標 OFF、零後端優先、reuse）。
- `/aidv-workflow verify`：階3。跑驗證門四項，貼全綠記錄。
- `/aidv-workflow pr`：階4–5。commit＋push（退避重試）＋開 draft PR（body 附驗收）。
- `/aidv-workflow review`：階6。triage 審查事件、修真問題、重跑驗證門。
- `/aidv-workflow reconcile`：階7–8。Jira 轉狀態＋留 PR 連結；master-plan §2 鏡像；完成後交給 `/aidv-board calendar` 記行事曆。

## 角色邊界
- **智能助手（我）**：階0–7 全自動。
- **Bruce（你）**：① `待議`/後端/金鑰的設計門拍板 ② 金鑰貼 Railway ③ 按合併＋真站開旗標走查。

## 定錨（不動）
四殼一脊椎＋Wave 0–4＋平行軌（H/U/I）方向定錨；北極星 DoD＝一句話 logline→成片匯出六步，最終驗收＝惹瓊巴 30 秒成片。**要改方向先與 Bruce 確認。**

— 智能助手 🤖
