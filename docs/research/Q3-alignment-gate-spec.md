# Q3 — 對齊門(project-alignment-gate)規格級設計

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 波次:**規格設計 wave Q**——本文件不重複診斷/UX 藍圖,只把 M2 §6、M0 §6、P2 §4 已定義的「創作者向對齊門」寫成**可動工的規格**:資料介面、程式碼插入點(path:line)、純函式簽章、前端接線、邊界情境判定、測試設計、首個 PR 範圍。
- 前置閱讀(引用結論,不重複):`docs/research/M2-project-agent-guidance.md` §6、`docs/research/M0-solution-blueprint.md` §6、`docs/research/P2-creator-flow-ux.md` §4、`.claude/skills/aidv-longloop/references/anti-drift.md`(開發用對齊門,結構參照對象,鎖的對象不同)
- 實讀程式碼(本文件新增的落地依據):`server/services/agentPlanner.ts`(:1-46 imports、:600-961 三道既有閘與插入點、:963 `plannerResultShouldFallback`)、`shared/agent-plan-schema.ts`(:376-556 AgentPlanV3)、`shared/agent-plan-adapter.ts`(:214-270 `GatedAgentPlanResult`/`OrbTaskDraft`)、`server/subsystems/contextPackets/contracts.ts`(`ContextSourceRef`/`SourceLineage`)、`server/subsystems/projectContext/contracts.ts`(`ProjectContextSummary`)、`client/src/contexts/WorldContextContext.tsx`、`client/src/contexts/PageAgentContext.tsx`、`client/src/contexts/GlobalOrbChatContext.tsx`(:4960-4996 `currentCreativeProjectId` 已在傳送路徑上)、`server/routers/ai.ts`(:1185-1239 `worldContextBlock`、:2028-2045 planner 呼叫點)、`client/src/shells/video/DirectorConsoleProvider.tsx`(:51-66 `OrbBubble`/`OrbLevel`)、`client/src/shells/video/console/AmbientOrb.tsx`、`client/src/shells/video/console/ProjectFlowGuide.tsx`

---

## 0. 一句話定位

對齊門不是新蓋一條管線,是在 `agentPlanner.ts` 既有「parseAndGatePlan → mode-contract replan → navigate replan → checkModalityCoherence → moderateOrbContent」鏈的**最尾端**,插入第四道機械判定閘;五問全部用「資料庫真實狀態 + sourceRefs/lineage」回答,不新增任何一次 LLM 呼叫,fail 時降級為 `AmbientOrb` 既有泡泡殼的一句澄清 + 兩按鈕。

---

## 1. 五問設計:機械判定規則(非 LLM 自律)

每一問的輸入資料一律來自「已經在管線裡流動」的物件——`gated.plan`(`AgentPlanV3` 或已轉換的 `OrbTaskDraft`)+ 呼叫端傳入的 `ProjectAlignmentContext`(見 §3)。沒有一問是靠請 LLM「再想一次」達成的。

### Q1. 還在同一個專案?

- **判什麼**:`ProjectAlignmentContext.activeProjectId`(來自 `WorldContext.currentProjectId`,今天已經在 `pageSnapshot.state.currentCreativeProjectId` 這條線上,見 §2.2)與 plan 文字/step 參數中「暗示的專案」是否衝突。
- **機械判準**:
  1. `activeProjectId` 為 `null`(尚無 active project)→ **直接 pass**,五問不生效(對齊 M2 §6.2「沒有 active project 時放行」)。
  2. 掃描 `gated.plan.steps[].toolArgs`(v3)或 `OrbTaskDraftStep.toolCalls[].args` 裡任何欄位名匹配 `/projectId|creativeProjectId/i`:若值存在且 `!= activeProjectId` → **fail**(判定「暗示切專案」)。
  3. 掃描使用者最後一輪原文(`extractLatestUserTextFromMessages`,agentPlanner.ts 既有函式)是否提到**另一個專案的標題**(比對 `ProjectAlignmentContext.otherProjectTitles: string[]`,由呼叫端一次查好、避免對齊門自己查 DB)。命中 → **fail**。
  4. 兩者皆未命中 → pass。
- **不靠 LLM 的原因**:「暗示切專案」100% 來自結構化 `toolArgs.projectId` 或字串比對既有專案標題清單,不需要語意理解。

### Q2. 還在同一或下一階段?

- **判什麼**:step 對應的 `journeyStage` 是否為 `currentStep` 或其下一步。
- **機械判準**:
  1. `ProjectAlignmentContext.journey`(由 `deriveProjectJourney(project)` 純函式算出,M2 §4.3 規劃中的共用模組,今天邏輯已存在於 `ProjectFlowGuide.tsx:52-111` 的 `useMemo`,只是尚未抽出)提供 `{ stageOrder: StepId[]; currentIndex: number }`。
  2. 每個 step 用 `resolveStepJourneyStage(step)` 對照 §3.3 的 `TOOL_JOURNEY_STAGE_HINTS` 表,得出該步的 `StepId | null`。
  3. `null`(工具未標記/階段中性,例如 `db.*`、`navigate`)→ **視為中性,不擋**(對齊 M2 §4.4「沒有標記的工具視為階段中性」)。
  4. 有標記時:`stageOrder.indexOf(stepStage) <= currentIndex + 1` → pass;`> currentIndex + 1`(跳兩步以上)→ **fail**。
  5. `stepOrder.indexOf(stepStage) < currentIndex`(退回已完成步驟,例如已生成完又要重寫劇本)→ **pass**(允許「回頭改」,對齊 P2 §3④「終點之後不再攔回頭改」的精神,提前套用到任何步驟——創作本質是可反覆的,不是單向的)。
- **量化「下一步」的邊界**(P2 §5 已標「值得與 Bruce 對一次」的開放問題,本規格給預設值):**容許跳過 1 個可選步驟(世界觀),不容許跳過必經步驟(劇本/分鏡/生成/成片)**。用 `FlowStep.optional?: boolean` 欄位標記(目前 `ProjectFlowGuide` 沒有此欄位,需在抽出 `projectJourney.ts` 時新增,僅世界觀步 `optional: true`)。

### Q3. 只用這個專案已知的實體?

- **判什麼**:step 參數中的角色名/場景名/世界觀名,是否能在專案自身資料中找到對應。
- **機械判準(兩層資料源,依可用性擇一,不等 Phase 1 全部接完才能用)**:
  1. **優先層(Phase 1 之後)**:`ProjectAlignmentContext.knownEntities: KnownEntity[]`,由呼叫端從當次 `ContextPacketView.sourceRefs`(`kind: "character" | "scene" | "worldbuilding"`)攤平而來,每筆帶 `lineage`(`sourceLineage.sourceType`/`sourceId`)——**這是 M2 §6.3 講的「有 sourceRefs 可查的機械檢查」的字面實作**。
  2. **降級層(今天就能用,不必等 contextPacket 接線)**:`server/routers/ai.ts:1201-1221` 已經有把 `worldbuildingFrameworks.charactersJson`/`scenesJson` 攤平成 `charSummary`/`sceneSummary` 字串的邏輯——同一份 `wb.charactersJson`/`scenesJson` 陣列可以直接餵給對齊門當 `knownEntities`(不必解析成摘要文字,原始 name 陣列即可),**這條路徑今天就可以動**,不依賴 Phase 1 的 contextPacket 全線接線。
  3. 抽取 step 參數裡疑似實體名的欄位(`characterName`/`sceneName`/`entityName`/`subject` 等既有 toolArgs 慣例欄位名,見 §3.3 白名單);逐一對 `knownEntities[].name` 做**精確字串比對(忽略前後空白,大小寫不敏感)**——**不做模糊/語意比對**,避免誤放行杜撰實體。
  4. 找不到對應 → **fail**,`clarification` 帶「是新角色,還是你想說『XX』?」(XX = `knownEntities` 中編輯距離最近的一筆,editDistance ≤ 2 才提供第二個按鈕選項,否則只給「是新角色,建立它」一個選項 + 開放式重述)。
  5. 抽不到任何疑似實體欄位(例如純技術性 step,如 `db.list`)→ **pass**(此問只對「有實體參數」的 step 生效)。

### Q4. 仍指向北極星終點?

- **判什麼**:step 的 `toolName` 是否落在「當前/下一階段」允許的工具集合內。
- **機械判準**:
  1. 用 §3.3 的 `TOOL_JOURNEY_STAGE_HINTS` 查 `toolName` 對應的 `journeyStage`。
  2. 若該工具的 `journeyStage` 與 Q2 判定的「當前/下一階段」不符,且該工具**不在** `STAGE_NEUTRAL_TOOLS`(階段中性白名單,例如 `db.list`/`studio.estimateCost`/`critic.review` 這類「核對/查詢」工具,任何階段都該放行)→ **fail**,判定為「順便」(對齊 M2 §6.1-4 例子:分鏡階段卻叫 `studio.trainLora`)。
  3. 此問與 Q2 的差異:Q2 管「進度是否合理跳步」,Q4 管「這個工具本身屬於哪個階段、departure 是否離題」——兩者共用同一張 `TOOL_JOURNEY_STAGE_HINTS` 表,但 Q2 看 step 清單的**整體推進方向**,Q4 看**單一 step 的工具是否文不對題**。
  4. 未標記的工具(表中沒有)→ **pass**(中性)。

### Q5. 沒有繞過核准門?

- **判什麼**:`requiresApproval`/`riskLevel:high` 的 step 是否仍會真的走既有核准流程。
- **機械判準**:
  1. 讀 step 的 `safety.riskLevel`(plan 層級,`AgentPlanV3Safety`)與該 step 的 `approvalGate`(`AgentPlanV3Step.approvalGate`,schema 已由 `superRefine` 強制:`type==="submit"/"reset"` 或 label 含 publish/覆寫/扣點 一律 `approvalGate=true`,見 `agent-plan-schema.ts:547-553`)。
  2. 對齊門**本身不重算風險**,只驗證「這個 gate 存在」:若 `gated.status === "tasked"` 且 task 產出的 `OrbTaskDraft.needsApproval === false` 但對應 step 的 `toolArgs`/`toolName` 命中 `HIGH_RISK_TOOL_NAMES`(對照既有 `orbCostGuard`/`agentScopeGuard` 的高風險工具清單,不重新定義)→ **fail**(判定為試圖繞過)。
  3. 這是**唯一一問** fail 時**不降級成 clarification、而是維持既有 `blocked`**——因為核准門本來就有 `agent-plan-safety`/`orbCostGuard` 在管,對齊門在此只是「複查一次沒被繞過」,不新增例外,也不用「兩按鈕」软化(對齊 M2 §6.1-5「對齊門本身不新增例外」)。

---

## 2. 落地位置

### 2.1 精確插入點

`server/services/agentPlanner.ts`,`runSchemaFirstAgentPlanner` 函式內:

```
:946  // ─── Phase 2 content moderation gate ─────────────────────────────────
:947  // Block on violence / hate / explicit; warn (prepend) on self-harm.
:948  const moderated = applyModerationGate(gated);
:949  gated = moderated.next;
:950
:951  // ← 在此插入第四道閘(新增,對齊 M2 §6.2)
:952
:953  const preferredEngine = usedMultimodalPlanner ? "gemini" : gated.preferredEngine;
:954  return {
```

插入內容(:950 之後、:953 之前):

```ts
// ─── Phase 3 project alignment gate(新增,shared/project-alignment-gate.ts)──
// 只在呼叫端提供 projectContext 時生效;沒有 active project 時該函式內部
// 直接回傳 pass,不需要在此額外判斷(對齊 M2 §6.2)。
if (gated.status === "tasked" || gated.status === "converted") {
  const alignment = evaluateProjectAlignmentGate({
    plan: gated.plan,
    task: gated.task,
    projectContext: input.projectContext ?? null,
  });
  if (!alignment.pass) {
    gated = {
      ...gated,
      status: alignment.forceBlocked ? "blocked" : "clarification",
      ok: alignment.forceBlocked ? false : true,
      actions: [],
      task: undefined,
      clarificationQuestion: alignment.clarification?.question,
      clarificationOptions: alignment.clarification?.options,
      warnings: [
        ...gated.warnings,
        `Project alignment gate: ${alignment.violatedRule}`,
      ],
    };
  }
}
```

### 2.2 輸入從哪來(不必等 schema 大改就能動工)

- `AgentPlannerInput`(agentPlanner.ts:56-)**新增一個 optional 欄位** `projectContext?: ProjectAlignmentContext | null`。
- 呼叫端(`server/routers/ai.ts:2028-2045` 組 `runSchemaFirstAgentPlanner`/`...WithCritique` 參數處)組出這個物件:
  - `activeProjectId`:今天已經在 `input.pageSnapshot.state.currentCreativeProjectId` 這條線上(`GlobalOrbChatContext.tsx:4979-4988` 前端已送、`ai.ts:1190-1193` 後端已解到 `snapshotState`,只是目前只拿去查 `worldFrameworkId`、沒有把 `currentCreativeProjectId` 本身往下傳)——**Phase 0 落地只要多讀一行 `snapshotState?.currentCreativeProjectId`**,不需要新增 tRPC input schema 欄位(M2 §4.2 建議的「加 optional projectId 欄位」仍建議做,但不是本規格的阻塞前提)。
  - `journey`:呼叫既有(重構後的)`deriveProjectJourney` 邏輯——**Phase 0 若 `projectJourney.ts` 尚未抽出**,可先用 `ai.ts:1195-1235` 已載入的 `wb`(worldbuilding framework)+ 一次輕量 `creative_projects` 查詢(`stageIndex`/`shots`/`assets` 計數)就地算出 `{ stageOrder, currentIndex }`,不阻塞對齊門先上線。
  - `knownEntities`:`wb.charactersJson`/`wb.scenesJson`(已載入,見 §1 Q3 降級層)攤平成 `{ name, kind }[]`。
  - `otherProjectTitles`:輕量查詢使用者其餘 `creative_projects.title`(僅需 id+title,一次查詢,可與現有 project 查詢合併,避免 N+1)。
- **fail 時的降級行為**:`evaluateProjectAlignmentGate` 拿不到足夠資料(例如 `projectContext` 傳了但 `journey` 缺失)時**不擋**——回傳 `{ pass: true }`,並在 `warnings` 附註「alignment gate skipped: missing journey data」,寧可漏放也不要因為資料不全就誤擋創作者(對齊既有 `guardOrbMemorySummary`/`ragInjectionGuard` 一貫的「安檢失敗不阻斷主流程」設計慣例)。

---

## 3. `shared/project-alignment-gate.ts` 純函式介面

```ts
// shared/project-alignment-gate.ts
import type { AgentPlanV3, AgentPlanV3Step } from "./agent-plan-schema";
import type { OrbTaskDraft } from "./agent-plan-adapter";

export type ProjectJourneyStepId =
  | "world" | "script" | "storyboard" | "generate" | "film";

export interface KnownEntity {
  name: string;
  kind: "character" | "scene" | "worldbuilding";
  lineage?: { sourceType: string; sourceId: string };
}

export interface ProjectJourneySnapshot {
  /** 依北極星順序排列的 stage id;世界觀為 optional 可跳過。 */
  stageOrder: ProjectJourneyStepId[];
  /** 目前第一個未完成步驟在 stageOrder 中的 index。 */
  currentIndex: number;
  /** 允許跳過的 stage(目前僅 "world")。 */
  optionalStages: ProjectJourneyStepId[];
}

export interface ProjectAlignmentContext {
  activeProjectId: number;
  activeProjectTitle: string;
  otherProjectTitles: string[];
  journey: ProjectJourneySnapshot | null;
  knownEntities: KnownEntity[];
}

export type AlignmentViolatedRule =
  | "different_project"
  | "stage_skip"
  | "unknown_entity"
  | "off_journey_tool"
  | "approval_bypass";

export interface AlignmentClarification {
  question: string;
  /** 恰好 2 個選項,對齊 AmbientOrb 泡泡兩按鈕殼。 */
  options: [string, string];
}

export interface ProjectAlignmentGateResult {
  pass: boolean;
  violatedRule?: AlignmentViolatedRule;
  clarification?: AlignmentClarification;
  /** 僅 Q5(approval_bypass)為 true —— 降級為 blocked 而非 clarification。 */
  forceBlocked?: boolean;
  /** 資料不足以判斷時仍為 pass:true,但附這個旗標讓呼叫端記警訊。 */
  skippedReason?: string;
}

export interface EvaluateProjectAlignmentGateInput {
  plan?: AgentPlanV3;
  task?: OrbTaskDraft;
  projectContext: ProjectAlignmentContext | null;
}

/**
 * 純函式:五問全 yes → pass:true。任一 no → 回傳最先 fail 的一條規則
 * (只講一條,不五條一次列出,對齊 P2 §4.2「不要五條全倒出來嚇人」)。
 * 不呼叫 LLM、不打 DB、不丟例外 —— 呼叫端已把所有需要的資料準備好。
 */
export function evaluateProjectAlignmentGate(
  input: EvaluateProjectAlignmentGateInput
): ProjectAlignmentGateResult {
  // 無 active project → 天生放行(M2 §6.2)。
  if (!input.projectContext) return { pass: true };
  // ...Q1→Q2→Q3→Q4→Q5 依序判定,第一個 fail 即回傳,其餘不繼續算。
  throw new Error("stub — 實作見首個 PR");
}
```

- **順序刻意固定 Q1→Q5**:每問成本遞增(Q1 只比對 id/字串,Q5 需要對照風險表),先便宜的先擋,省下後面的計算。
- **`plan`/`task` 二選一**:`gated.status==="converted"` 時只有 `plan`(直接執行,`AgentAction[]`);`status==="tasked"` 時有 `task`(`OrbTaskDraft`,結構含 `toolCalls`)。函式內部用型別窄化各自抽取 step 清單,呼叫端(agentPlanner.ts)兩種狀態都可能命中,故兩個欄位都設 optional。

---

## 4. 前端 UX 接線

### 4.1 接哪個既有元件

`AmbientOrb.tsx`(`client/src/shells/video/console/AmbientOrb.tsx`)的泡泡殼——`orb.bubble`(`OrbBubble` 型別,`DirectorConsoleProvider.tsx:53-60`)。

**現況殼型只支援「CTA + 固定文案『稍後』」兩鈕**(:71-87 `orb.bubble.cta` 一個按鈕 + 永遠寫死的「稍後」按鈕呼叫 `dismissBubble`)。對齊門澄清卡需要「兩個都可自訂文案」的按鈕(例如「是新角色,建立它」/「我是說小明」),**現有 `OrbBubble` 型別不夠用,需要一個小擴充**:

```ts
// DirectorConsoleProvider.tsx:53-60,新增 optional 欄位(向下相容,舊呼叫端不變)
export interface OrbBubble {
  emoji: string;
  title: string;
  text: string;
  cta?: string;
  onCta?: () => void;
  /** 新增:第二顆按鈕自訂文案(對齊門澄清卡用);未提供時 AmbientOrb.tsx
   *  仍 fallback 顯示原本的「稍後」+ dismissBubble,行為零變化。 */
  secondaryCta?: string;
  onSecondaryCta?: () => void;
}
```

`AmbientOrb.tsx:83-85` 的「稍後」按鈕改為:`{orb.bubble.secondaryCta ?? "稍後"}`,`onClick` 改呼叫 `orb.bubble.onSecondaryCta ?? console_.dismissBubble`。**這是本規格唯一需要動既有元件的地方,且是向下相容的加法,不改變任何現有呼叫端行為**。

### 4.2 資料流(對齊門 → 泡泡)

1. `ai.chat` 回應中 `decision.mode === "clarification"` 且 `warnings` 含 `"Project alignment gate:"` 前綴(或新增一個明確欄位 `alignmentViolation?: AlignmentViolatedRule` 讓前端不必解析 warnings 字串,**建議**在 `ai.chat` 回應 payload 加這個顯式欄位,而非依賴 warnings 文字比對)。
2. `GlobalOrbChatContext.tsx` 收到回應後,若 `alignmentViolation` 存在:不走一般對話氣泡渲染,轉呼叫 `console_`(`DirectorConsoleProvider`)設置 `orb.bubble`:
   - `title`:「等一下,先確認一下」(固定文案,對齊 P2 §4.2 樣式)
   - `text`:`clarificationQuestion`
   - `cta`:`clarificationOptions[0]`,`onCta`:把「照建議做」的原始 plan 重新送一次 approve(或直接執行第一個選項對應的既有 action)
   - `secondaryCta`:`clarificationOptions[1]`,`onSecondaryCta`:視 `violatedRule` 決定(例如 `unknown_entity` 時是「當作新角色建立」,`stage_skip` 時是「先完成上一步」)
3. **視覺區分**:P2 §4.2-5 已定「邊框從中性色變暖黃提醒」——沿用既有 `RING.hint`(`AmbientOrb.tsx:47-52` 已有 `hint: "ring-2 ring-amber-400/60"`)的同一組色階,不新增第三種顏色語彙。

---

## 5. 多專案/邊界情境

| 情境 | 對齊門行為 |
|---|---|
| **切換專案時**(`WorldContext.setCurrentProjectId` 被呼叫,對話仍在同一個 conversationId) | 對齊門 Q1 的比對基準(`activeProjectId`)**跟著 `WorldContext` 走**,不是跟著「對話開始時的專案」走——切換後下一輪 `ai.chat` 自然帶新 `activeProjectId`,Q1 不會誤判「切專案」為違規(因為比對的是「當前 `activeProjectId` vs plan 暗示的專案」,不是「歷史專案 vs 當前」)。若在**同一輪** LLM 回覆中偵測到使用者話語暗示想切到另一個專案(Q1 判準 3),仍要澄清,不可靜默切換(M2 §6.1-1)。 |
| **多專案並行分頁**(使用者開兩個瀏覽器分頁各自 `WorldContext`) | 本規格**不處理**(M2/P2 皆已聲明「僅涵蓋單一 active project」);每個分頁各自的 `ai.chat` 請求各自帶各自的 `activeProjectId`,對齊門天然是 per-request 純函式、不共享狀態,所以**不會互相汙染**,但「使用者體感是不是在切換」這個 UX 問題本規格不裁定。 |
| **跳步時**(例如世界觀未連結就要生成) | Q2 fail → clarification,「先連結世界觀」/「照原計畫生成」兩按鈕(P2 §4.2 已有此範例文案,直接沿用)。 |
| **多代理各自計畫時**(`ORB_MULTI_AGENT_ENABLED` 開啟後,`agentCollaborationOrchestrator` 讓多個精靈各自產 plan) | **本規格範圍只涵蓋單代理(lead-only)路徑**(對齊 M2 未涵蓋部分聲明)。若日後 multi-agent 旗標開啟,建議做法(未落地,先寫方向):對齊門在**每個精靈的 plan 各自產出後、彙整成 `ExecutionPlan` 之前**分別跑一次(因為 `evaluateProjectAlignmentGate` 是純函式,天然可對多個 plan 各自呼叫,不需要改函式本身,只需要呼叫端在 `agentCollaborationOrchestrator.ts` 的彙整點多呼叫 N 次);任一精靈的 plan fail,該精靈的 handoff 降級為「請示 lead」而非直接執行,避免「品品跑去改分鏡、圖圖跑去練 LoRA」各自跑偏。 |
| **對話跨多輪、`activeProjectId` 中途消失**(例如使用者清除 `WorldContext`) | 依 §2.2「資料不足 → pass + skippedReason」原則,不會因為單輪缺資料就對之前已核准的任務動手;但下一輪重新規劃時,若 `projectContext` 變 `null`,對齊門直接 pass(退回「無專案」的預設放行),不會卡住使用者。 |

---

## 6. 測試設計

檔案:`tests/unit/shared/project-alignment-gate.test.ts`(對齊既有 `tests/unit/shared/orb-*.test.ts` 命名慣例)。

每案給 `{ plan 或 task, projectContext }` → 斷言 `pass`/`violatedRule`/`clarification.options.length === 2`。

| # | 案名 | 輸入摘要 | 預期 |
|---|---|---|---|
| 1 | `no_active_project_passes` | `projectContext: null` | `pass: true`,無 `violatedRule` |
| 2 | `same_project_step_passes` | step 無 `projectId` 暗示、`activeProjectId=1` | `pass: true` |
| 3 | `different_project_id_in_toolArgs_fails` | step `toolArgs.projectId = 2`,`activeProjectId = 1` | `pass: false`,`violatedRule: "different_project"` |
| 4 | `user_text_mentions_other_project_title_fails` | 使用者文字含 `otherProjectTitles[0]`,step 無明確 projectId | `pass: false`,`violatedRule: "different_project"` |
| 5 | `next_stage_step_passes` | `journey.currentIndex=1`(script),step 標記 `storyboard` | `pass: true` |
| 6 | `skip_two_stages_fails` | `journey.currentIndex=1`(script),step 標記 `generate` | `pass: false`,`violatedRule: "stage_skip"` |
| 7 | `skip_optional_world_stage_passes` | `journey.currentIndex=0`(world,optional),step 標記 `script` | `pass: true` |
| 8 | `revisit_earlier_stage_passes` | `journey.currentIndex=3`(generate),step 標記 `script`(回頭改劇本) | `pass: true` |
| 9 | `known_entity_passes` | step 參數 `characterName="小明"`,`knownEntities` 含 `{name:"小明", kind:"character"}` | `pass: true` |
| 10 | `unknown_entity_fails_with_two_options` | step 參數 `characterName="阿光"`,`knownEntities` 不含此名,且與最近項編輯距離 ≤2 | `pass: false`,`violatedRule: "unknown_entity"`,`clarification.options` 長度 2 |
| 11 | `unknown_entity_no_close_match_still_two_options` | 同上但無接近項 | `clarification.options[1]` 為開放式「我是說別的」而非具體名字建議 |
| 12 | `off_journey_tool_fails` | `journey.currentIndex=1`(storyboard),step `toolName="studio.trainLora"`(標記 world/generate 之外階段) | `pass: false`,`violatedRule: "off_journey_tool"` |
| 13 | `stage_neutral_tool_always_passes` | step `toolName="db.list"`(未標記/中性) | `pass: true`,不論 `journey.currentIndex` |
| 14 | `approval_bypass_forces_blocked_not_clarification` | high-risk toolName 但 `task.needsApproval=false` | `pass: false`,`violatedRule: "approval_bypass"`,`forceBlocked: true` |
| 15 | `missing_journey_data_skips_gate` | `projectContext` 存在但 `journey: null` | `pass: true`,`skippedReason` 非空 |
| 16 | `only_first_violation_reported` | 同時觸發 Q2 與 Q3(跳步 + 未知實體) | 只回傳 Q2 的 `violatedRule`(依序判定,不合併多條) |
| 17 | `converted_status_reads_plan_steps` | `gated.status="converted"`,用 `plan.steps` 而非 `task` | 與 tasked 案例行為一致(驗證兩型別窄化都正確) |

**整合測試**(次要,首個 PR 可選做):在 `agentPlanner.ts` 既有測試檔(若存在,或新建 `tests/unit/server/agentPlanner.alignment-gate.test.ts`)中,mock `invokeLLM` 回傳一個「明顯跳兩步」的 v3 plan,斷言 `runSchemaFirstAgentPlanner` 的最終輸出 `status` 被降級為 `"clarification"`。

---

## 7. 首個 PR 範圍

**範圍**:只做「五問的判定邏輯 + 單元測試」,**不接前端、不動 `agentPlanner.ts` 呼叫點、不動 `ai.ts`**——讓對齊門先以「純函式已存在但尚未插電」的狀態進倉,降低單一 PR 的驗證面(呼應 aidv-longloop 的 WIP=1 紀律,對齊門本身的落地也不該一次跑偏成大 PR)。

**檔案級範圍**:
- 新增 `shared/project-alignment-gate.ts`:§3 定義的型別 + `evaluateProjectAlignmentGate` 完整實作(Q1-Q5)。
- 新增 `shared/project-journey-stages.ts`(輕量,§1 Q2/Q4 共用):`TOOL_JOURNEY_STAGE_HINTS: Record<string, ProjectJourneyStepId>` + `STAGE_NEUTRAL_TOOLS: Set<string>`——**刻意不改 `shared/global-agent-tools.ts`/`global-agent-capabilities.ts` 既有 148+ 筆 registry entry**,用獨立小表取代 M2 §4.4 原提案的「每個 capability 補 `journeyStage` 欄位」,降低首個 PR 的檔案改動面(這是本規格對 M2 草案的一處收斂,理由:編輯 148 筆 registry 屬於大範圍改動,不適合對齊門自己的第一個 PR;獨立表可後續合併回 registry,不阻塞)。
- 新增 `tests/unit/shared/project-alignment-gate.test.ts`:§6 全部 17 案。

**不在此 PR 範圍**(留給後續 PR,避免第一個 PR 就跑偏):
- 不動 `server/services/agentPlanner.ts`(§2.1 的插入點留到第二個 PR,需要先確認 `ProjectAlignmentContext` 組裝邏輯與 `ai.ts` 既有 `snapshotState` 解析點的介接方式)。
- 不動 `client/src/shells/video/DirectorConsoleProvider.tsx`/`AmbientOrb.tsx`(§4.1 的 `OrbBubble.secondaryCta` 擴充留到第三個 PR,前端接線需要与 `GlobalOrbChatContext.tsx` 的回應解析同批做)。
- 不動 `deriveProjectJourney`/`projectJourney.ts` 的抽出重構(依賴 M2 §4.3,屬另一個獨立 PR,對齊門第一個 PR 用「呼叫端就地組裝」的降級路徑即可,見 §2.2)。

**第二個 PR(接線)預告**:agentPlanner.ts 插入點(§2.1)+ `AgentPlannerInput.projectContext` 欄位 + `ai.ts` 組裝 `ProjectAlignmentContext`(讀 `snapshotState.currentCreativeProjectId`)。

**第三個 PR(前端)預告**:`OrbBubble.secondaryCta` 擴充 + `GlobalOrbChatContext.tsx` 解析 `alignmentViolation` 顯式欄位 + 泡泡渲染。

---

## 未查證部分

1. **`deriveProjectJourney` 尚未實際抽出為共用模組**——本規格 §2.2/§7 假設的「呼叫端就地組裝」降級路徑未實測,實際組裝程式碼未寫。
2. **`ai.chat` 回應 payload 是否該新增 `alignmentViolation` 顯式欄位**(§4.2)——本規格建議如此(避免前端解析 warnings 字串這種脆弱做法),但目前 `finalizeIdempotentResponse` 的完整回應 schema 未逐欄位核對是否已有相容欄位可借用,需要在第二個 PR 實作時確認。
3. **多代理路徑(§5 第四列)的對齊門呼叫方式**——只給了方向性建議(每個精靈 plan 各自呼叫一次純函式),未讀 `agentCollaborationOrchestrator.ts` 中段 handoff 執行細節(E 文件已標「未逐行讀」),實際彙整點的程式碼位置未定位。
4. **編輯距離(editDistance ≤ 2)門檻的實測效果**——Q3 的「接近項才給第二按鈕」規則是本規格新提的量化判準,未經真實中文角色名資料測試,中文姓名的編輯距離語感可能與英文不同(例如「小明」vs「小名」只差一字但語意可能完全不同人),建議實作時準備真實測資驗證這個門檻是否需要改用注音/拼音相似度而非字元編輯距離。
5. **`OrbBubble.secondaryCta` 擴充是否會與其他既有呼叫 `orb.bubble` 的地方(例如就緒鏡提示、過期待重生提示)產生非預期互動**——本規格判斷是純加法、向下相容,但未逐一檢查 `DirectorConsoleProvider.tsx` 中 `orb` useMemo(:170-223)目前產生 bubble 的每個分支是否有任何隱含假設「只有一顆按鈕」。
6. **`HIGH_RISK_TOOL_NAMES`(Q5 判準)的實際清單來源**——本規格假設可對照既有 `orbCostGuard`/`agentScopeGuard` 的高風險工具定義,但未逐一核對這兩份清單目前是否已經是「工具名字串清單」的形式,或需要額外轉換。
