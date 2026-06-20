---
name: aidv-autodev
description: AIDV 單卡最高精度自主開發引擎 — 從即時 Jira 看板（專案 AIDV）取下一張可做的卡，用多代理 Workflow（多角度研究→隔離 worktree 實作→多視角對抗式驗證→條件式修補→裁決）把它做到最完整最精準；驗證門全綠＋裁決 merge 才自動合進 main（Railway 自動部署），每張卡 Jira 留言署名。可 15 分一輪長循環。當 Bruce 說「自動開發／照卡做／一次一張卡做到最完整／不用等拍板直接做／長循環跑／用多代理」時使用。用法：/aidv-autodev [卡號 | next | loop <分鐘>]
---

# AIDV 單卡最高精度自主開發引擎（執行者：智能助手 🤖）

> **白話**：一次只挑一張 AIDV 卡，但用一整隊代理把它做到最精準完整 —— 多角度研究、隔離實作、多視角對抗式挑錯、自動修補、最後裁決，全綠＋裁決通過才自動合併進 production。做完接下一張。這是 [[aidv-longloop]] 的「最高精度執行引擎」，重用 /aidv-plan、/aidv-board 取卡與對帳。

## 固定事實 / 工具鏈（過期以實況為準）

- **本機可攜 Node 20**：`D:\AI-Director系統2.0\node20\node-v20.20.2-win-x64`（全域 Node 26 會讓 drizzle-kit/tsx 撞 libuv 原生崩潰，一律用這支）。所有 npx/npm 前 `$env:PATH = '<該dir>;' + $env:PATH`，並設 `[Environment]::CurrentDirectory`＝repo（否則 `import "dotenv/config"` 載不到 .env）。
- **開發 repo**：`C:\Users\User\healing-studio-dev`（main 為基底）。Win PowerShell 5.1 寫含中文/破折號的 `.ps1` 一律存 UTF-8 BOM 或全 ASCII。
- **自動合併**：`gh`（`C:\Program Files\GitHub CLI\gh.exe`）。`gh auth login --with-token` 用 git 憑證缺 `read:org` scope → 改用 **`GH_TOKEN=<token> gh pr merge`**（token：`printf "protocol=https\nhost=github.com\n\n" | git credential fill` 取 password=）。**合併前驗證門必須全綠且裁決＝merge**（直達 production main＝director.today 自動部署，無 CI 把關，本機 gates 是唯一閘門）。
- **Jira（已連，read+write）**：`mcp__146f6b5a-*` 工具；cloudId `a70fd562-5997-4fe4-8de7-18ac3e894a29`、專案 AIDV。轉完成 transition id `41`（完成）／`31`（進行中）。留言署名「— 智能助手 🤖」。
- **驗證門**：`npx tsc --noEmit`（0 錯）＋`npm run check`（導航/路由/依賴）＋`npx vitest run <改的測>`（main baseline 13 failed/6 檔為既有 jsdom29 問題，非新回歸，判斷時扣掉）。
- **migration 三鐵則**（守門測試 `server/migration-prod-pending-block.test.ts`）：①禁 MySQL 不支援的 `CREATE INDEX IF NOT EXISTS`；②一 `--> statement-breakpoint` 一句；③ALTER/CREATE INDEX 走 `information_schema` 守門。
- **commit/PR 慣例**：中文 conventional ＋ Jira key；commit 結尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`；PR body 結尾 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

## 流程（每張卡一條最高精度 pipeline）

1. **取卡**：`/aidv-plan next`（或讀 Jira 看板：`searchJiraIssuesUsingJql` `project = AIDV AND statusCategory != Done AND issuetype != Epic ORDER BY Rank ASC`）。挑「下一張可做」＝高優先、未被 needs-key/decision/待議 阻塞、純碼可驗證、低 production 風險者。跳過要金鑰/要拍板/破壞性大的（那些改留決策留言）。
2. **對齊**：先派偵察代理確認卡的真實依賴是否存在（曾踩過 AIDV-9：座艙流程根本沒實作＝卡被阻塞）。發現阻塞就 Jira 留言記錄、不硬幹、換下一張。
3. **開分支**：repo 切到乾淨 main、pull，`git checkout -b feat/<slug>`。
4. **跑最高精度 Workflow**（範本見 `references/max-precision-workflow.template.js`）：
   - **Research（平行 2–3）**：外部機制／repo 內部對碼／邊角失敗模式 → 結構化輸出。
   - **Implement（1，`isolation:'worktree'`，`effort:'high'`）**：依研究做**完整版**＋窮盡測試矩陣，自驗 tsc+vitest 全綠，commit＋`git push -u origin feat/<slug>`。
   - **Verify（平行 4 視角）**：請求/行為安全、正確性、邊角精度/溢位、完整度批判（缺什麼、測試是否真的測到、acceptance 是否達成）→ 每項 issue 帶 severity＋fix。
   - **Refine（條件式，1，worktree）**：有 high/medium issue 就 fetch 分支修補、再驗、push。
   - **Judge（1，`effort:'high'`）**：獨立 git diff 複核 → `merge`／`hold`。
5. **審查＋合併**：我讀 judge 結果＋自己 `git diff origin/main...origin/<branch>`。**唯有 judge=merge、gates 全綠、無高/中未解** 才 `GH_TOKEN gh pr create` + `gh pr merge --squash --delete-branch`。否則保留 PR、Jira 留言列待解項給 Bruce。
6. **對帳**：合併後 Jira 卡轉完成（transition 41）＋留言（PR 連結、做法、對抗式發現、驗證門結果、誠實標範圍與未盡之處）。卡未完全達標就留進行中＋說明。
7. **接下一張**：回 1。

## 安全鐵則（無人看顧下自動合進 production 的紀律）

1. **只合 judge=merge ＋ gates 全綠 ＋ 無高/中未解** 的卡。其餘 PR-only 留 review。
2. **偏好零風險變更**：旗標守門預設 OFF（合了線上零行為變化，待 Bruce 開旗標才生效）、或非破壞性（如 JWT 縮效期只對新 token、不登出既有；新增不刪除）。
3. **碰設計門**（接新後端／要金鑰／改成本帳務/破壞性行為）→ 不擅自上 prod；做成 PR-only ＋ Jira 決策留言，或挑安全卡先做。Bruce 已授權「不用等拍板直接做」時，仍走 PR-only＋裁決把關，不盲合大功能。
4. **永不弄壞關鍵路徑**：例 aiProxy 成本落帳只能在回應送出後（setImmediate）做、吞錯、零請求路徑改動。
5. **不改已 ship 的 migration、不亂加 migration**（governance 嚴）。
6. **白話文義務**：Bruce 是工程小白，Jira 留言／回報遇術語附白話。
7. 撞 session 用量上限（子代理失敗訊息「You've hit your session limit · resets <時間>」）→ 不瞎撞，ScheduleWakeup 順延到重置後重跑。

## 子命令

- `/aidv-autodev next`：自動取下一張可做的卡，跑整條最高精度 pipeline 到合併或 hold。
- `/aidv-autodev <卡號>`：對指定卡跑。
- `/aidv-autodev loop <分鐘>`：以該間隔長循環（dynamic /loop + ScheduleWakeup），每輪一張卡；主喚醒＝workflow 完成通知，間隔為心跳；撞上限自動順延。

## 已實證成果（2026-06-19）
本引擎雛形已自動合併 #920（AIDV-9 plumbing）、#921（dev script 跨平台）、#922/#923（AIDV-64 上傳安全，完整版含 magic-byte，對抗式審查抓出 ftyp 誤殺＋XSS 繞過並修補）。

## 重用（別重造輪子）
取卡/對帳→`/aidv-plan`、`/aidv-board`；單卡九階/三門/工作表→`/aidv-workflow`；15 步總調度→`/aidv-longloop`。本技能補上「最高精度多代理 Workflow 執行＋自動合併把關」。

— 智能助手 🤖
