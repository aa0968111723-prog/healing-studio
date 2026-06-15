# AIDV 開發工作流（工作表 SOP）

> **定位**：本檔＝「每一張卡怎麼從想法走到合併」的**單一作業流程**。是 `AIDV-master-plan.md` 第 5 節「維運 SOP」與 `/aidv-plan` 外掛的**作業面展開**。
> **鐵則**：**一律照工作表流程跑**——任何開發（含 hotfix）都要有一張「工作表」，逐欄走過九階、過三道門，不跳關。
> SSOT：Jira 專案 `AIDV`（活看板）＋本檔鏡像。最後校準：2026-06-15。

---

## 0. 角色與責任邊界

| 角色 | 負責 | 不碰 |
|---|---|---|
| **Agent（我）** | 0–7 階全自動：建工作表→範圍設計→開發→三門→PR→對帳 | 不按合併鍵、不貼金鑰、不替 Bruce 拍 `待議` |
| **Bruce** | 三件事：① `待議`/碰後端/碰金鑰的**設計門拍板** ② 金鑰貼 Railway ③ **按合併**＋真站開旗標走查 | 工程細節不需碰 |

---

## 1. 九階流水線（每張卡都走這條）

| 階 | 名稱 | 做什麼 | 產出 | 通過條件（閘門） |
|---|---|---|---|---|
| 0 | **進站** | 讀 SSOT：Jira `AIDV` ＋ AIDISC 收件匣（`labels=aidisc-inbox`）＋ master-plan。`/aidv-plan next` 取下一棒 | 選定一張卡 | 卡存在、依賴已解 |
| 1 | **範圍設計** | 對碼勘察，把下方「工作表」§3 逐欄填實（檔案/介面/旗標/驗收/風險/Phase） | 工作表（貼進 Jira 卡描述） | **🚪設計門** ↓ |
| 2 | **開發** | 在分支 `claude/loving-lamport-iexyoe`、依 repo 慣例（旗標 default OFF、零後端優先、reuse 既有 procedure） | 程式碼＋測試 | 自評符合工作表設計 |
| 3 | **驗證** | 跑驗證基準 | 全綠記錄 | **🚪驗證門** ↓ |
| 4 | **提交推送** | commit（中文 conventional + Jira key）＋ `git push -u`（失敗指數退避重試） | 推上分支 | push 成功 |
| 5 | **開 PR** | 無 PR 則開 **draft**；body 附驗收清單。完工＝轉 ready-for-review | PR | body 驗收欄齊 |
| 6 | **審查** | 接 Codex／CodeRabbit 事件，逐條 triage、修真問題、跑回歸 | 修正 commit | **🚪審查門** ↓ |
| 7 | **對帳** | Jira 轉狀態＋留言記 PR 連結；master-plan §2 鏡像更新 | Jira＋doc 同步 | 三處一致 |
| 8 | **合併收尾** | Bruce 按合併→Jira 轉「完成」；每完成一 Wave 加變更紀錄；旗標真站走查 | 合併＋歸檔 | PR merged |

---

## 2. 三道門（不過不前進）

### 🚪 設計門（階 1→2）
- **零後端＋旗標 default OFF＋可回滾** → **自動通過**（Wave I 慣例，如 I-1~I-9）。
- **碰後端 / 碰金鑰 / 標 `待議` / 改既有 prod 行為** → **需 Bruce 在 Jira 卡拍板後才進階 2**（鐵律 6：要改未來先確認）。
- 金鑰一律「貼 Railway」，**絕不寫進卡片/程式碼/doc**（鐵律 3）。

### 🚪 驗證門（階 3→4）— 全綠才放行
```
npx tsc --noEmit                 # 型別
npm run check:routes             # 路由/registry 對齊
npm run check:navigation         # 禁 window.location 內部導航
npx vitest run <新測> <鄰測>     # 新元件 + 受影響鄰居
```
> 基準避雷：jsdom29+vitest2 的 localStorage/環境問題使 main baseline 有 13 failed/6 檔＝既有，**勿當新回歸**（AIDV-29）。

### 🚪 審查門（階 6→7）— 逐條 triage
| 來源/嚴重度 | 處置 |
|---|---|
| Codex P1/P2、CodeRabbit 真問題 | **修**＋加回歸測試；重跑驗證門 |
| nitpick（可選） | 划算就補（多為補測/命名）；否則一句理由略過 |
| 工具自帶門檻（如 docstring 80%）非本 repo 標準 | **略過**並註明理由（`package.json` 無此檢查） |
| 重構級/有歧義 | **AskUserQuestion 問 Bruce**，不擅自大改 |
| 草稿期略過/重複事件 | 靜默跳過 |

---

## 2.5 UI/UX 一致性（ui-ux-pro-max 設計智庫）

> 目的：讓「任何會改變介面**長相／手感／移動／互動**」的卡，都用**同一套設計智庫**做決策與自檢，避免各殼各頁風格漂移。智庫已內嵌於 `.claude/skills/ui-ux-pro-max/`（第三方 MIT，離線 CSV 檢索）。
>
> **SSOT 邊界（重要）**：本專案**鎖定的設計系統＝design-kit 亮色暖光（黏土／珊瑚橘，AIDV-74／U-1）**為 token／配色／品牌的**唯一真相**。ui-ux-pro-max 提供的是**通用 UX 守則、互動／動效、可及性、圖表選型與交付前檢查表**，用來「補強與驗收」，**不覆蓋**專案既定 token／品牌色。兩者衝突時 **一律以 design-kit 為準**。

**何時必用**（同 skill「When to Apply」）：新頁面／元件、改互動或動效、選色／字體／間距／版面、做 RWD／深色模式、加圖表、或審查 UI 一致性與可及性。純後端／API／DevOps 不需。

**接點 ①——設計門（階 1→2）**：UI 卡在範圍設計時先查一次，把回傳的 pattern／互動／動效／反模式對照 design-kit token 落進工作表：
```
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<產品型 產業 關鍵詞>" --design-system -f markdown
```

**接點 ②——驗證門（階 3→4）**：UI 卡在 tsc／routes／navigation／vitest 全綠後，加一輪「交付前檢查表」自檢（取自 SKILL.md，App／Web 擇用）：
- **可及性**：對比 ≥4.5:1、icon-only 有 `aria-label`、焦點環可見、色彩非唯一資訊。
- **觸控／互動**：命中區 ≥44pt、按下回饋 ≤150ms、動效 150–300ms、尊重 `prefers-reduced-motion`。
- **設計一致**：用語意 token（design-kit）非硬編色、SVG 圖示非 emoji、深／淺色對比各自驗。
- **三態**：載入／空／錯誤皆有出口（對應全站共用 `_shared/PanelState`）。

**Jira 連動**：UI 卡的工作表必填「UI/UX 一致性」欄（設計門查詢摘要＋交付前檢查 N 項過）；看板↔九階對照見 Epic **AIDV-102**；本接入工作項目＝**AIDV-103**（label `workflow`＋`ui-ux`）。

---

## 3. 工作表模板（每張卡填這張，貼進 Jira 卡描述）

```
### 🗂 工作表 — <卡號> <標題>
- 進站來源：<Jira next / AIDISC / Bruce 指示>
- 北極星對位：<這張卡推進 logline→成片 的哪一步>
- 範圍：<做什麼，一句話>
- 重用既有：<reuse 哪些 LIVE procedure/元件，避免重造>
- 檔案：<要改/新增的檔>
- 旗標：<flag 名 · 預設 OFF>
- 設計門：<自動通過 ✓ / 待 Bruce 拍板（原因）>
- 驗收：<可觀察的通過條件>
- 風險/避雷：<…>
- Phase：<本卡做到哪 / 下一 Phase 待什麼（後端/金鑰/拍板）>
- UI/UX 一致性：<僅 UI 卡：ui-ux-pro-max 設計門查詢摘要 / 交付前檢查 N 項過；token 衝突以 design-kit 為準>
- 驗證：tsc / routes / navigation / 測試 <案數>
- PR / commit：<連結>
```

---

## 4. 狀態與標籤詞彙（同 master-plan 鐵律 4）
- 狀態（看板四欄 ↔ 九階對照，見 Jira Epic **AIDV-102**）：`Backlog`（階0–1）→ `Selected for Development`（就緒：設計門過、下一棒）→ `進行中`（階2–3、6）→ `完成`（階8）。Blocked 以 label 表示，板上無欄。
- 標籤：`decision`(待拍板)／`decision-resolved`／`needs-key`(缺金鑰)／`caution`(避雷)／`待議`／`integration`／`wave-i`／`workflow`／`workflow-pilot`／`ui-ux`／`aidisc-*`。

### 4.1 優先順序分級（2026-06-15 建立；讓看板「優先順序細分」圖有意義）
| 優先序 | 給誰 | 範例 |
|---|---|---|
| **Highest** | 生產 P0／安全外洩 | AIDV-90 |
| **High** | 進行中 Wave＋可立即解鎖的下一棒 | AIDV-8/9/12/17/56/75/85/88/92/94 |
| **Medium** | 一般 Backlog（預設） | 多數 Wave 2／Wave H |
| **Low** | 被金鑰/決策卡住、需等拍板 | AIDV-13/16/19（needs-key） |
| **Lowest** | 遠期 Wave 3/4、strangler 收尾刪除 | AIDV-18/20/21/22/23/24/25/48–54 |
> 規則：**完成的卡維持 Medium 不動**（不回頭改歷史）；新卡照此表設優先序。
> 依賴連結（Jira「Blocks」）：AIDV-13→18、13→19、44→50。

## 5. 定錨（不動）
四殼一脊椎＋Wave 0–4＋平行軌（H/U/I）方向定錨；北極星 DoD＝一句話 logline→成片匯出六步，最終驗收＝惹瓊巴 30 秒成片。**要改方向先在討論區與 Bruce 確認**。
