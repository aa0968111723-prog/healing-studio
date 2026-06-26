---
name: aidv-qa-explore
description: AIDV QA 探查多代理評估系統（防漂移版）— 由「qa-explore 機器人 🔎」執行。靜態掃描 healing-studio codebase 尋找 QA 問題，用多個創作者人格代理評估每個 finding，輸出 Jira Backlog 卡規格。核心特性：finding ID 鎖定＋persona 防漂移一致性檢查（AIDV-178）。用法：/aidv-qa-explore [run|status]
---

# AIDV QA 探查多代理評估系統（執行者：qa-explore 機器人 🔎）

> **白話**：掃程式碼找問題 → 給每個問題編號（ID 鎖定）→ 用四種創作者視角評估每個問題的嚴重度 → 開 Jira 卡追蹤。
>
> **防漂移核心（AIDV-178）**：人格代理只能評估「本輪清單內」的問題。若代理回傳的 findingId 不在本輪清單 → 偵測為漂移 → 重跑（最多 2 次）。不靠記憶、不靠上一輪殘留——每輪 finding ID 集合明確注入每個 persona prompt。

## 固定事實

- **Jira**：cloudId `a70fd562-5997-4fe4-8de7-18ac3e894a29`，專案 `AIDV`。
  - 欄：Backlog →(11/21) Selected for Development →(31) 進行中 →(41) 完成。
  - **本技能只建 Backlog 卡，不轉欄、不改既有卡。**
- **Repo**：`/home/user/healing-studio`（或 `C:\Users\User\healing-studio-dev`，以執行環境為準）。
- **簽名**：所有 Jira 留言/卡/文件署名「— qa-explore 機器人 🔎」。
- **卡標籤**：`qa-explore` + 領域標（`frontend`/`backend`/`security`/`uiux`/`perf`/`a11y`）+ 嚴重度（`sev-high`/`sev-medium`/`sev-low`）+ 若需 Bruce `待議`。

## 鐵律

1. **只建 Backlog 卡規格**：不動既有卡、不合碼、不改 prod 行為。
2. **先驗後寫**：每個 finding 必須對 HEAD 活程式碼確認「①檔案/符號存在 ②問題仍成立 ③看板無重複卡」。
3. **Finding ID 鎖定（AIDV-178）**：掃描完成後，本輪所有 finding 各分配唯一 ID（`R{輪次}-F{序}`），鎖定成集合。Persona 只能裁決集合內的 ID，違者重跑。
4. **冪等**：寫卡前 `searchJiraIssuesUsingJql` 查重（標題關鍵詞），有則留言到既有卡、無才建新卡。
5. **不碰金鑰/後端/prod**：此類發現加 `待議+decision` 標記，描述清楚「為何需要 Bruce 拍板」。
6. **白話義務**：卡描述/留言遇術語附白話（Bruce 是工程小白）。
7. **署名**：所有輸出署名「— qa-explore 機器人 🔎」。

## Finding Schema（掃描輸出）

每個 finding 結構：
```
{
  id: "R{輪次}-F{序號}",   // 掃描後由主迴圈分配，scanner 不填此欄
  title: string,           // 一句話問題標題
  area: string,            // 系統區域（如 "client/src/pages/ImageStudio.tsx"）
  fileLine: string,        // 最具體的定位（如 "ImageStudio.tsx:L1234"）
  evidence: string,        // 直接引用的程式碼或日誌（控制在 3 行內）
  severity: "blocker"|"high"|"medium"|"low",
  proposedFix: string,     // 修法摘要（一句話）
  category: "bug"|"ux"|"perf"|"security"|"a11y"|"tooling"
}
```

## Persona 定義（四種創作者視角）

| Persona | 代入角色 | 評估視角 |
|---------|---------|---------|
| **新手** | 第一次使用平台的創作者 | 「這會讓我感到困惑/卡住嗎？」|
| **接案者** | 接影片案子的專業自由工作者 | 「這會讓我在客戶面前丟臉嗎？」|
| **內容編輯** | 負責平台學習/行銷內容的編輯 | 「這讓我的工作白費了嗎？」|
| **品牌方** | 企業客戶/品牌主 | 「這影響到我的品牌形象嗎？」|

### Persona 裁決值

- `blocker`：上線前必修（使用流程斷掉、資料消失、安全漏洞）
- `raise`：應該修（體驗明顯變差、功能不可預期）
- `ok`：這個視角不受影響

## 防漂移機制（AIDV-178 核心）

### 為什麼需要這個

多代理 persona 評估中，agent 可能引用「上一輪的 finding 標籤」或「其他 agent 討論過的問題」，而非本輪輸入，導致：
- 回傳的 `findingId` 不在本輪清單
- 裁決表和本輪 finding 對不上
- 無法可靠地追蹤哪個 finding 被升格為 Jira 卡

### 鎖定流程

```
1. 掃描完成後 → 主迴圈分配 ID：R{round}-F001, R{round}-F002, ...
2. 建立 lockSet = Set([所有本輪 finding ID])
3. lockSetStr = 人類可讀格式 ["R1-F001", "R1-F002", ...]
4. 每個 persona prompt 開頭注入：
   「⚠️ 本輪鎖定 finding ID 集合：{lockSetStr}
     規則：①你的每個 verdict 的 findingId 必須在上列集合中
           ②不得引用集合外的 ID（包含歷史輪次的 finding）
           ③每個 finding 都要給出裁決」
5. Persona 回傳後 → 校驗：response.verdicts.every(v => lockSet.has(v.findingId))
6. 校驗失敗 → log("[DRIFT] {persona} 引用了集合外的 findingId") → 重跑（最多 2 次）
7. 2 次重跑仍失敗 → 該 persona 標 null，其餘正常繼續（不阻塞整輪）
```

### Persona Prompt 模板

```
你是「{persona}」創作者人格代理。你的任務是從「{persona}視角」評估以下 QA findings 的嚴重程度。

⚠️ 本輪鎖定 finding ID 集合：{lockSetStr}

規則（嚴格遵守）：
1. 你的每個 verdict 中的 findingId 必須完全屬於上列集合，一個都不能超出。
2. 不得引用任何集合外的 ID，包含：過去對話記憶、其他 finding 的描述、假設的 ID。
3. 每一個 finding 都必須給出裁決（blocker/raise/ok）。

本輪所有 findings：
{findingsJson}

你的評估視角（{persona}）：{personaContext}

請以 JSON 格式回傳，每個 finding 對應一個 verdict：
{ "verdicts": [{ "findingId": "R{round}-F{seq}", "verdict": "blocker"|"raise"|"ok", "reason": "一句話理由" }] }
```

## 每輪流程（scan → lock → evaluate → write）

> 完整 Workflow 範本見 `references/qa-explore-workflow.template.js`。主迴圈執行 Workflow 後，**親自**根據 confirmed findings 建 Jira 卡（不讓子代理寫，保持去重控制）。

### Step 1：進站對齊

```
readJira: searchJiraIssuesUsingJql(project=AIDV ORDER BY updated DESC) → boardSnapshot
readLastRun: 讀 docs/audits/qa-explore-*.md（上輪產出，避免重產）
```

### Step 2：多模態掃描（Workflow Phase 1 — Scan）

平行 3–4 個掃描代理，各負責一個面向：
- **A 邏輯錯誤 / Bug**：N+1 query、競態條件、型別 bug、silent failure（吞錯）、TODO/FIXME 殘留
- **B UX / 可用性**：四態缺失（loading/empty/error/success）、a11y 問題、表單驗證、錯誤訊息品質
- **C 前後端接線**：tRPC procedure 存在但前端無入口（dead route）、假持久化（寫記憶體不寫 DB）、任何 `as any` 跳型別邊界
- **D 效能 / 可靠性**：`refetchIntervalInBackground: true`（不必要的背景輪詢）、無限重試、缺乏 debounce/throttle

每個代理回傳候選 finding 清單（不含 ID，ID 由主迴圈分配）。

### Step 3：Finding ID 鎖定

```js
const allFindings = scanResults.filter(Boolean).flatMap(r => r.findings)
const roundId = args?.round ?? 'R?'
const lockedFindings = allFindings.map((f, i) => ({
  ...f,
  id: `${roundId}-F${String(i+1).padStart(3,'0')}`
}))
const lockSet = new Set(lockedFindings.map(f => f.id))
```

### Step 4：防漂移 Persona 評估（Workflow Phase 2 — Evaluate）

四個 persona 代理平行執行，每個有最多 2 次重試（drift 時）。
校驗：`response.verdicts.every(v => lockSet.has(v.findingId))`

### Step 5：聚合裁決

```
confirmed = lockedFindings.filter(f => {
  const verdicts = personaResults.filter(Boolean).flatMap(r => r.verdicts)
    .filter(v => v.findingId === f.id)
  return verdicts.some(v => v.verdict === 'blocker') ||
         verdicts.filter(v => v.verdict === 'raise').length >= 2
})
```

升格規則：
- 任一 persona 評為 `blocker` → 升為 Jira High/Highest 卡
- ≥ 2 persona 評為 `raise` → 升為 Jira Medium 卡
- 其他 → 丟棄（在輪次摘要中記錄 dropReason）

### Step 6：寫 Jira 卡（主迴圈親自做，冪等）

```
for each confirmed finding:
  searchJiraIssuesUsingJql(summary 關鍵詞) → 有則 addComment / 無則 createJiraIssue
  priority: blocker→High/Highest, raise(2+)→Medium
  labels: qa-explore + category + severity
  description: 見「Jira 卡模板」
```

### Step 7：鏡像審計

寫 `docs/audits/qa-explore-{YYYY-MM-DD}.md`：
- 本輪 finding 總數、升格數、丟棄數
- Finding 表（id / title / severity / persona verdicts / 結論）
- 丟棄表（id / dropReason）

## Jira 卡模板

```markdown
## 白話現象（QA 探查 {輪次}）

{finding.title} — {finding.area}

{finding.evidence}（引自 {finding.fileLine}）

## 多代理創作者評估（{finding.category} 視角）

| 人格 | 裁決 | 一句話 |
| --- | --- | --- |
| 新手 | {新手verdict} | {新手reason} |
| 接案者 | {接案者verdict} | {接案者reason} |
| 內容編輯 | {內容編輯verdict} | {內容編輯reason} |
| 品牌方 | {品牌方verdict} | {品牌方reason} |

## 根因

{finding.proposedFix 展開為根因描述}

## 期望修法

{修法步驟，簡短 2-3 點}

## 連動

{相關 Jira 卡，若有}

— qa-explore 機器人 {輪次} 🔎
```

## 驗收標準（AIDV-178）

1. 每個 persona prompt 包含 `lockSetStr`（本輪 finding ID 集合）
2. 每個 persona response 經過一致性校驗：`verdicts.every(v => lockSet.has(v.findingId))`
3. 校驗失敗時 log `[DRIFT]` 並重跑（最多 2 次）
4. 最終 Jira 卡只包含本輪 confirmed findings，不混入歷史輪次

## 子命令

- `/aidv-qa-explore run`：完整跑一輪（步驟 1-7）
- `/aidv-qa-explore status`：回報上一輪結果（讀 docs/audits/qa-explore-*.md）

## Workflow 腳本

詳見 `references/qa-explore-workflow.template.js` — 整段貼進 **Workflow 工具** 的 `script` 欄位執行。
