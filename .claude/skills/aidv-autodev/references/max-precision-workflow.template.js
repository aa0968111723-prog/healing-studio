// ─────────────────────────────────────────────────────────────────────────────
// aidv-autodev：單卡最高精度 Workflow 範本（複製、填好 CARD、用 Workflow 工具跑）
//
// 用法：把 CARD 的 key/branch/title/research/implement 換成目標卡，整段貼進 Workflow
// 的 `script`。背景跑完通知後，主迴圈讀 judge → 自己 git diff 複核 → judge=merge＋
// gates 全綠才 GH_TOKEN gh pr create + gh pr merge --squash。否則保留 PR＋Jira 留言。
//
// 鐵則：①只合 judge=merge＋gates 綠＋無高/中未解 ②偏好旗標 OFF/非破壞性 ③碰設計門
// PR-only ④永不弄壞關鍵路徑 ⑤Node 20（PATH 前置 D:\AI-Director系統2.0\node20\...）。
// ─────────────────────────────────────────────────────────────────────────────
export const meta = {
  name: 'aidv-card-max-precision',
  description: '單卡最高精度（研究→隔離實作→4視角對抗式驗證→修補→裁決）',
  phases: [
    { title: 'Research', detail: '多角度深度研究' },
    { title: 'Implement', detail: '隔離 worktree 高 effort 實作＋窮盡測試＋push' },
    { title: 'Verify', detail: '4 視角對抗式驗證' },
    { title: 'Refine', detail: '修補高/中問題' },
    { title: 'Judge', detail: '最終可否合併' },
  ],
}

const REPO = 'C:\\Users\\User\\healing-studio-dev'
const NODE20 = 'D:\\AI-Director系統2.0\\node20\\node-v20.20.2-win-x64'
const TOOLING = `Node 20: PATH 前置 ${NODE20}；cwd 與 [Environment]::CurrentDirectory 設為你的 worktree root。Gates：'npx vitest run <test file>' 與 'npx tsc --noEmit' 皆須綠。`

// ▼▼▼ 換成目標卡 ▼▼▼
const CARD = {
  key: 'AIDV-XX',
  branch: 'feat/aidv-xx-slug',
  title: '卡標題',
  // 2–3 個平行研究 prompt（外部機制／repo 對碼／邊角失敗模式）
  research: [
    `（研究1：外部機制／API，要具體欄位與 fallback）`,
    `Read ${REPO}: （研究2：對碼定位 file:line、schema 型別、現有可重用碼、grep 指令）`,
    `（研究3：列出 edge cases / 失敗模式，成為測試矩陣）`,
  ],
  // 實作指示（含 HARD SAFETY 約束、純函式 helper、窮盡測試）
  implement: `（GOAL＋HARD SAFETY 約束＋pure exported helper＋窮盡 vitest 測試矩陣＋接線位置）`,
}
// ▲▲▲ 換成目標卡 ▲▲▲

const VERIFY_SCHEMA = { type: 'object', additionalProperties: false, required: ['lens','verdict','issues'], properties: {
  lens: { type: 'string' }, verdict: { type: 'string', enum: ['solid','needs-fix'] },
  issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['issue','severity','fix'], properties: { issue: { type: 'string' }, severity: { type: 'string', enum: ['high','medium','low'] }, fix: { type: 'string' } } } } } }
const JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['verdict','confidence','reasons','blockingIssues'], properties: {
  verdict: { type: 'string', enum: ['merge','hold'] }, confidence: { type: 'string', enum: ['high','medium','low'] }, reasons: { type: 'string' }, blockingIssues: { type: 'array', items: { type: 'string' } } } }

phase('Research')
const research = await parallel(CARD.research.map(p => () => agent(p, { label: `research:${CARD.key}`, phase: 'Research' }))).then(r => r.filter(Boolean))

phase('Implement')
const impl = await agent(
`Implement ${CARD.key}（${CARD.title}）to the HIGHEST precision in a FRESH git worktree (base: main). Create & switch to branch '${CARD.branch}'.

RESEARCH (authoritative):
${JSON.stringify(research, null, 2)}

TASK / SAFETY:
${CARD.implement}

${TOOLING}
SELF-VERIFY until green: vitest + tsc. THEN git add、commit（中文 conventional + ${CARD.key} + 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>'）、'git push -u origin ${CARD.branch}'。不要 merge。
Report：(a) 做法 (b) CONFIRM 安全約束守住 (c) 測試矩陣逐項 (d) 'Tests N passed' (e) 'tsc 0 errors' (f) CONFIRM pushed ${CARD.branch}.`,
  { label: 'implement', phase: 'Implement', effort: 'high', isolation: 'worktree' }
)

phase('Verify')
const lenses = [
  { lens: 'safety', focus: '會不會弄壞 production／既有行為，且 gates（tsc/vitest）抓不到？關鍵路徑零改動？' },
  { lens: 'correctness', focus: '是否真正且正確達成卡目標？測試是否真的測到（非 trivially passing）？' },
  { lens: 'edge-precision', focus: '邊角/精度/溢位/null/錯誤輸入：安全 fallback、永不 throw、符合 schema 精度？' },
  { lens: 'completeness', focus: '缺什麼？未測路徑？acceptance 是否達成？死碼？該保留不動的是否動了？' },
]
const reviews = await parallel(lenses.map(l => () => agent(
`Adversarially review ${CARD.key} on branch ${CARD.branch} through '${l.lens}' lens. From ${REPO}: 'git fetch origin ${CARD.branch} -q' then read 'git diff origin/main...origin/${CARD.branch}' + changed files. FOCUS: ${l.focus}. 每 issue 帶 severity＋具體 fix；有 high/medium 則 verdict 'needs-fix'. lens='${l.lens}'.`,
  { label: `verify:${l.lens}`, phase: 'Verify', schema: VERIFY_SCHEMA }
)).then(r => r.filter(Boolean))

const blocking = reviews.flatMap(r => (r.issues||[]).filter(i => i.severity !== 'low').map(i => ({ lens: r.lens, ...i })))

phase('Refine')
let refine = null
if (blocking.length > 0) {
  refine = await agent(
`Fix these high/medium issues on branch ${CARD.branch}（worktree：'git fetch origin ${CARD.branch} -q' 後 checkout 追蹤 origin/${CARD.branch}）：
${JSON.stringify(blocking, null, 2)}
最小正確修補、守住安全約束。${TOOLING} 兩 gates 重驗綠 → git commit + 'git push origin ${CARD.branch}'. 回報修了什麼＋最終 gate 結果.`,
    { label: 'refine', phase: 'Refine', effort: 'high', isolation: 'worktree' }
  )
}

phase('Judge')
const judge = await agent(
`Final judgement：${CARD.key}（branch ${CARD.branch}）可否自動合進 production main？獨立以 'git fetch origin ${CARD.branch} -q' + 'git diff origin/main...origin/${CARD.branch}' 複核。
IMPLEMENT: ${impl}
REVIEWS: ${JSON.stringify(reviews)}
REFINE: ${refine ? JSON.stringify(refine) : 'none needed'}
'merge' 僅當：gates 綠、關鍵路徑可證未壞、無高/中未解、變更安全。否則 'hold' 列 blockingIssues.`,
  { label: 'judge', phase: 'Judge', effort: 'high', schema: JUDGE_SCHEMA }
)

return { branch: CARD.branch, implement: impl, reviews, refine, judge }
