// ─────────────────────────────────────────────────────────────────────────────
// aidv-qa-explore：QA 探查一輪 Workflow 範本（防漂移版，AIDV-178）
//
// 用法：把 args 填好（round、boardSnapshot、lastRun），整段貼進 Workflow 的 `script` 跑。
// 背景完成後，**主迴圈親自**依回傳的 confirmedSpecs 建 Jira 卡（去重＋冪等）。
//
// 防漂移設計（AIDV-178）：
//   1. 掃描完成 → 主迴圈分配 finding ID（R{round}-F{seq}）→ 鎖定 lockSet
//   2. 每個 persona prompt 顯式注入 lockSet 與 finding 清單
//   3. Persona 回傳後校驗：verdicts.every(v => lockSet.has(v.findingId))
//   4. 校驗失敗 → log [DRIFT] → 重跑（最多 2 次）
//   5. 2 次後仍失敗 → 該 persona = null（不阻塞整輪）
//
// 鐵則：①只回傳卡規格，主迴圈再建 Jira ②每筆 finding 對 HEAD 驗證仍成立才留
//        ③看板去重 ④碰後端/金鑰標 待議+decision
// ─────────────────────────────────────────────────────────────────────────────
export const meta = {
  name: 'aidv-qa-explore',
  description: 'QA 探查：多模態掃描 → finding ID 鎖定 → 防漂移 persona 評估 → 卡規格',
  phases: [
    { title: 'Scan', detail: '4 面向平行掃描 → 候選 finding（不含 ID）' },
    { title: 'Evaluate', detail: 'Finding ID 鎖定 → 防漂移 persona 評估（4 人格 × 最多 2 次重試）' },
  ],
}

// ▼▼▼ 每輪填這三塊（主迴圈先備好再貼） ▼▼▼
const ROUND      = args?.round      ?? 'R?'           // 例如 'R9'（延續上次輪次）
const BOARD_SNAP = args?.boardSnap  ?? '（貼看板精簡快照：key [status] summary，供去重）'
const LAST_RUN   = args?.lastRun    ?? '（貼上一輪 qa-explore-*.md 的 finding 標題，避免重產）'
// ▲▲▲ ▲▲▲

const REPO = '/home/user/healing-studio'

// ── Schema：掃描代理輸出 ────────────────────────────────────────────────────
const SCAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['modality', 'findings'],
  properties: {
    modality: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'area', 'evidence', 'severity', 'proposedFix', 'category'],
        properties: {
          title:       { type: 'string' },
          area:        { type: 'string' },
          fileLine:    { type: 'string' },
          evidence:    { type: 'string' },
          severity:    { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          proposedFix: { type: 'string' },
          category:    { type: 'string', enum: ['bug', 'ux', 'perf', 'security', 'a11y', 'tooling'] },
        },
      },
    },
  },
}

// ── Schema：persona 代理輸出 ────────────────────────────────────────────────
const PERSONA_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['persona', 'verdicts'],
  properties: {
    persona: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['findingId', 'verdict', 'reason'],
        properties: {
          findingId: { type: 'string' },
          verdict:   { type: 'string', enum: ['blocker', 'raise', 'ok'] },
          reason:    { type: 'string' },
        },
      },
    },
  },
}

// ── Schema：最終卡規格 ───────────────────────────────────────────────────────
const CARD_SPEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['confirmedFindings'],
  properties: {
    confirmedFindings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'area', 'fileLine', 'evidence', 'severity',
                   'category', 'proposedFix', 'verdictSummary', 'priority', 'labels'],
        properties: {
          id:             { type: 'string' },
          title:          { type: 'string' },
          area:           { type: 'string' },
          fileLine:       { type: 'string' },
          evidence:       { type: 'string' },
          severity:       { type: 'string' },
          category:       { type: 'string' },
          proposedFix:    { type: 'string' },
          verdictSummary: { type: 'array', items: { type: 'object' } },
          priority:       { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low'] },
          labels:         { type: 'array', items: { type: 'string' } },
          needsBruce:     { type: 'boolean' },
          bruceReason:    { type: 'string' },
        },
      },
    },
  },
}

// ── Phase 1：多模態掃描 ──────────────────────────────────────────────────────
phase('Scan')

const SCAN_MODALITIES = [
  {
    key: 'bugs',
    prompt: `掃描 ${REPO} 的 server/ 和 client/src/ 找**邏輯錯誤/Bug**（不修碼）。
重點：N+1 query、競態條件、型別 bug、silent failure（吞錯、catch {} 空塊）、TODO/FIXME 標記的已知問題。
參考：上輪已找過的（避免重產）：${LAST_RUN}
回傳 modality="bugs"，每筆包含 {title, area, fileLine, evidence, severity, proposedFix, category="bug"}。
嚴重度判斷：production 資料可能損壞/遺失=blocker；功能不可用=high；體驗降低=medium；最佳化建議=low。`,
  },
  {
    key: 'ux',
    prompt: `掃描 ${REPO}/client/src/ 找 **UX/可用性問題**（不修碼）。
重點：四態缺失（loading/empty/error/success 任一缺）、a11y 問題（aria-label 缺失、button 無 type）、表單驗證缺失、錯誤訊息品質差（"Error" 而非白話說明）。
參考：上輪已找過的：${LAST_RUN}
回傳 modality="ux"，每筆 {title, area, fileLine, evidence, severity, proposedFix, category="ux" or "a11y"}。`,
  },
  {
    key: 'routes',
    prompt: `掃描 ${REPO} 找**前後端接線問題**（不修碼）。
重點：tRPC procedure 存在但前端無入口（dead route）、假持久化（寫記憶體不寫 DB，如 array.push 而非 db.insert）、\`as any\` 或 \`as unknown as X\` 跳型別邊界、前端呼叫已廢棄的 API。
確認現況：每個候選對 HEAD 確認檔案路徑存在、問題仍成立。
回傳 modality="routes"，每筆 {title, area, fileLine, evidence, severity, proposedFix, category="bug" or "tooling"}。`,
  },
  {
    key: 'perf',
    prompt: `掃描 ${REPO}/client/src/ 找**效能/可靠性問題**（不修碼）。
重點：\`refetchIntervalInBackground: true\`（不必要的背景輪詢，用電且費資源）、無限重試無退出條件、缺乏 debounce/throttle 的高頻事件處理、大型 useEffect 沒有 cleanup、Promise 未處理 rejection。
回傳 modality="perf"，每筆 {title, area, fileLine, evidence, severity, proposedFix, category="perf"}。`,
  },
]

const scanResults = await parallel(
  SCAN_MODALITIES.map(m => () =>
    agent(m.prompt, { label: `scan:${m.key}`, phase: 'Scan', schema: SCAN_SCHEMA })
  )
)

// ── Finding ID 鎖定（AIDV-178）──────────────────────────────────────────────
const allRawFindings = scanResults.filter(Boolean).flatMap(r => r.findings)
const lockedFindings = allRawFindings.map((f, i) => ({
  ...f,
  id: `${ROUND}-F${String(i + 1).padStart(3, '0')}`,
}))
const lockSet = new Set(lockedFindings.map(f => f.id))
const lockSetStr = JSON.stringify([...lockSet])
const findingsJson = JSON.stringify(lockedFindings, null, 2)

log(`[Lock] ${ROUND}: ${lockedFindings.length} findings locked. IDs: ${lockSetStr}`)

// ── Phase 2：防漂移 Persona 評估 ─────────────────────────────────────────────
phase('Evaluate')

const PERSONAS = [
  {
    name: '新手',
    context: '你是第一次使用 AI 影片創作平台的創作者。你不懂技術，只想順利做出影片。視角：「這讓我感到困惑或卡住嗎？我知道下一步該做什麼嗎？」',
  },
  {
    name: '接案者',
    context: '你是接影片製作案子的專業自由工作者，要交付給付費客戶。視角：「這讓我在客戶面前難堪嗎？這影響到我的交件品質或時程嗎？」',
  },
  {
    name: '內容編輯',
    context: '你是平台的內容編輯，負責建立學習模組和行銷素材。視角：「這讓我辛苦建立的內容消失或出錯嗎？這影響到我的工作成果嗎？」',
  },
  {
    name: '品牌方',
    context: '你是透過平台製作品牌影片的企業客戶。視角：「這影響到我的品牌形象或商業利益嗎？這是我能接受的產品品質嗎？」',
  },
]

const buildPersonaPrompt = (persona) =>
  `你是「${persona.name}」創作者人格代理。你的任務是從「${persona.name}視角」評估本輪 QA findings 的嚴重程度。

⚠️ 本輪鎖定 finding ID 集合（AIDV-178 防漂移）：${lockSetStr}

嚴格規則：
1. 你回傳的每個 verdict 中的 findingId 必須完全屬於上列集合，一個都不能超出。
2. 不得引用任何集合外的 ID，包含：過去對話記憶、其他 finding 的描述、你自己推測的 ID。
3. 每一個 finding 都必須給出裁決（blocker/raise/ok），不得遺漏。

本輪所有 findings（已鎖定 ID）：
${findingsJson}

你的評估視角（${persona.name}）：${persona.context}

請針對每個 finding 給出裁決：
- blocker：使用流程斷掉、資料消失、安全漏洞 → 上線前必修
- raise：體驗明顯變差、功能不可預期 → 應該修
- ok：從你的視角這個問題影響不大

回傳 JSON：{ "persona": "${persona.name}", "verdicts": [{ "findingId": "...", "verdict": "blocker|raise|ok", "reason": "一句話理由" }] }`

const personaResults = await parallel(
  PERSONAS.map(persona => async () => {
    const MAX_RETRIES = 2
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const result = await agent(
        buildPersonaPrompt(persona),
        { label: `persona:${persona.name}:attempt${attempt + 1}`, phase: 'Evaluate', schema: PERSONA_SCHEMA }
      )
      if (!result) return null

      // 防漂移一致性校驗（AIDV-178）
      const driftIds = result.verdicts.filter(v => !lockSet.has(v.findingId)).map(v => v.findingId)
      if (driftIds.length === 0) {
        return result
      }

      log(`[DRIFT] ${persona.name} attempt ${attempt + 1}: 引用了集合外的 findingId: ${JSON.stringify(driftIds)}，重跑...`)

      if (attempt >= MAX_RETRIES - 1) {
        log(`[DRIFT-FAIL] ${persona.name} 連續 ${MAX_RETRIES} 次漂移，標記 null 繼續`)
        return null
      }
    }
    return null
  })
)

// ── 聚合裁決：決定哪些 finding 升格為 Jira 卡 ────────────────────────────────
const validPersonaResults = personaResults.filter(Boolean)
const verdictMap = {}
for (const pr of validPersonaResults) {
  for (const v of pr.verdicts) {
    if (!verdictMap[v.findingId]) verdictMap[v.findingId] = []
    verdictMap[v.findingId].push({ persona: pr.persona, verdict: v.verdict, reason: v.reason })
  }
}

const confirmedFindings = lockedFindings.filter(f => {
  const verdicts = verdictMap[f.id] || []
  const hasBlocker = verdicts.some(v => v.verdict === 'blocker')
  const raiseCount = verdicts.filter(v => v.verdict === 'raise').length
  return hasBlocker || raiseCount >= 2
}).map(f => {
  const verdicts = verdictMap[f.id] || []
  const hasBlocker = verdicts.some(v => v.verdict === 'blocker')
  const raiseCount = verdicts.filter(v => v.verdict === 'raise').length

  // 優先序
  let priority = 'Medium'
  if (hasBlocker || f.severity === 'blocker') priority = 'Highest'
  else if (f.severity === 'high' || raiseCount >= 3) priority = 'High'

  // 標籤
  const labels = ['qa-explore', f.category]
  if (f.severity === 'blocker' || f.severity === 'high') labels.push('sev-high')
  else if (f.severity === 'medium') labels.push('sev-medium')
  else labels.push('sev-low')

  // 需 Bruce 拍板的情況
  const needsBruce = f.category === 'security' || f.proposedFix.includes('金鑰') || f.proposedFix.includes('Railway')

  return {
    id: f.id,
    title: f.title,
    area: f.area,
    fileLine: f.fileLine || f.area,
    evidence: f.evidence,
    severity: f.severity,
    category: f.category,
    proposedFix: f.proposedFix,
    verdictSummary: verdicts,
    priority,
    labels: needsBruce ? [...labels, '待議', 'decision'] : labels,
    needsBruce: needsBruce || false,
    bruceReason: needsBruce ? '涉及安全設定或金鑰，需 Bruce 確認' : undefined,
  }
})

const droppedCount = lockedFindings.length - confirmedFindings.length
log(`[Result] ${ROUND}: ${lockedFindings.length} findings → ${confirmedFindings.length} confirmed, ${droppedCount} dropped`)

return {
  round: ROUND,
  totalScanned: lockedFindings.length,
  confirmedCount: confirmedFindings.length,
  droppedCount,
  driftPersonas: personaResults.filter(r => r === null).length,
  confirmedFindings,
}
