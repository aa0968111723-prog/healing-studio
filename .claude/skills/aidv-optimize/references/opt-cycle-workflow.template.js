// ─────────────────────────────────────────────────────────────────────────────
// aidv-optimize：每輪「訊號 → 已驗證優化卡規格」Workflow 範本
//
// 用法：把 BOARD_SNAPSHOT（看板精簡快照，去重用）與 LAST_CYCLE（上輪產出，避免重產）
// 填好，整段貼進 Workflow 的 `script` 跑。背景完成後，**主迴圈親自**依回傳的
// verified specs 建 Jira 卡（route→留言到擁有卡；card→查重後 createJiraIssue）。
//
// 鐵則：①只產 Backlog 卡規格、不寫碼不合併 ②每筆對 HEAD 驗證仍成立才留 ③對看板去重
// ④碰後端/金鑰/破壞性標 待議+decision、不標可開工 ⑤一軌一主、能路由就不開新卡。
// ─────────────────────────────────────────────────────────────────────────────
export const meta = {
  name: 'aidv-opt-cycle',
  description: '優化卡一輪：多模態 harvest → 對 HEAD 驗證＋對看板去重 → 已驗證卡規格',
  phases: [
    { title: 'Harvest', detail: '4 模態平行掃描訊號源 → 候選發現' },
    { title: 'Verify', detail: '對 HEAD 驗證仍成立＋對看板去重 → 已驗證卡規格' },
  ],
}

const REPO = 'C:\\Users\\User\\healing-studio-dev'

// ▼▼▼ 每輪填這兩塊（主迴圈先查好再貼） ▼▼▼
const BOARD_SNAPSHOT = args?.board ?? '（貼看板精簡快照：key [status] summary «labels»，供去重）'
const LAST_CYCLE = args?.lastCycle ?? '（貼上一輪 opt-cycle-*.md 的發現/路由標題，避免重產）'
// ▲▲▲ ▲▲▲

const CAND_SCHEMA = { type: 'object', additionalProperties: false, required: ['modality','candidates'], properties: {
  modality: { type: 'string' },
  candidates: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['title','area','evidence','severity','proposedFix','sourceFreshness'], properties: {
    title: { type: 'string' }, area: { type: 'string' },
    fileLine: { type: 'string' }, evidence: { type: 'string' },
    severity: { type: 'string', enum: ['high','medium','low','info'] },
    proposedFix: { type: 'string' },
    sourceFreshness: { type: 'string', enum: ['live-verified','doc-recent','doc-stale','unknown'] } } } } } }

const SPEC_SCHEMA = { type: 'object', additionalProperties: false, required: ['specs'], properties: {
  specs: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['verdict','title','area'], properties: {
    verdict: { type: 'string', enum: ['card','route','drop'] },
    dropReason: { type: 'string' },          // verdict=drop：過時/已修/重複（指出證據）
    routeTo: { type: 'string' },             // verdict=route：擁有卡 key（一軌一主）
    title: { type: 'string' }, area: { type: 'string' },
    issuetype: { type: 'string', enum: ['Task','Story','Bug'] },
    priority: { type: 'string', enum: ['Highest','High','Medium','Low','Lowest'] },
    labels: { type: 'array', items: { type: 'string' } },
    fileLine: { type: 'string' }, evidence: { type: 'string' },
    worksheet: { type: 'string' },           // dev-workflow §3 工作表（範圍/重用/檔案/旗標/設計門/驗收/風險/Phase）
    designGate: { type: 'string', enum: ['auto-pass','needs-bruce'] },
    needsBruceReason: { type: 'string' } } } } } }

// ── Harvest：4 模態各派一個代理（互不知情，覆蓋面互補） ──
phase('Harvest')
const MODALITIES = [
  { key: 'docs', prompt:
`從 ${REPO} 收集**優化候選**（不修碼）。讀：docs/audits/*.md、docs/4shell-handoff/AI-Director-UIUX設計/比對與優化報告.md（§4 後端/決策、§5 低風險未做供排程）、docs/audits/全站生成管線盤點-*.md、browser-audit-findings.md。
逐筆萃取 {title,area,fileLine,evidence,severity,proposedFix,sourceFreshness}。**關鍵**：標 sourceFreshness——2026-03 前或提到 client/src/pages/* (4-shell 重構前路徑) 標 'doc-stale'；近期 feat/4-shell 報告標 'doc-recent'。不要自己改碼。modality='docs'.` },
  { key: 'jira', prompt:
`用 Jira MCP 從專案 AIDV 收集**未轉成卡的優化訊號**：JQL 找 labels in (aidisc-inbox, aidisc, qa-explore, gap-card)、QA 探查卡（summary 含「探查」「QA」）、Epic AIDV-89（AIDISC 討論區）與 AIDV-102（工作流 hub）留言裡點到但沒開卡的待辦。也看近期 PR 審查殘留（git log）。逐筆 {title,area,fileLine,evidence,severity,proposedFix,sourceFreshness='unknown'}。modality='jira'.` },
  { key: 'uiux', prompt:
`對 ${REPO} 的**活程式碼**做 UI/UX 優化掃描（client/src/shells/**、components/**）。用 ui-ux-pro-max 交付前檢查表角度找**尚未開卡**的缺口：四態（空/載入/錯誤）出口缺漏、icon-only 缺 aria-label、framer 動畫未守 useReducedMotion、硬編 hex 應走 design-kit token、命中區 <44pt、對比疑慮。每筆給 file:line 證據與建議。**這是對活碼掃描，sourceFreshness='live-verified'**。modality='uiux'.` },
  { key: 'fullstack', prompt:
`對 ${REPO} 的**活程式碼**做全端優化掃描。找：tRPC 接線靜默失敗（如 spine/projectGateway.ts 的 'as any' 讓 input 形狀錯誤編譯期抓不到）、placeholder/dead 按鈕（toast「即將推出」、空 onClick）、catch 吞錯無使用者出口、邊界 'any'、TODO/FIXME、重複/N+1 請求、缺 loading/disabled 競態。grep 佐證，每筆 file:line。sourceFreshness='live-verified'。modality='fullstack'.` },
]
const harvested = (await parallel(MODALITIES.map(m => () =>
  agent(m.prompt, { label: `harvest:${m.key}`, phase: 'Harvest', schema: CAND_SCHEMA })
))).filter(Boolean)
const allCandidates = harvested.flatMap(h => (h.candidates||[]).map(c => ({ ...c, modality: h.modality })))
const harvestCounts = harvested.map(h => h.modality + ':' + (h.candidates ? h.candidates.length : 0)).join(' ')
log('Harvest：' + allCandidates.length + ' 候選（' + harvestCounts + '）')

// ── Verify + Dedupe：兩視角，對 HEAD 驗證仍成立＋對看板去重 → 已驗證規格 ──
phase('Verify')
const VERIFIERS = [
  { lens: 'still-real', focus:
`對每個候選，從 ${REPO} 對 **HEAD 活程式碼** 確認缺口是否**仍然成立**：檔案/符號還在嗎？grep/read 證實問題沒被修掉/搬走？4-shell 重構前路徑要找到對應新路徑或判定已不存在。**仍真→card/route；已修或找不到→drop（dropReason 附證據）**。` },
  { lens: 'dedupe-route', focus:
`對每個候選，比對「看板快照」與「上一輪產出」判**重複**（同檔/同義標題/已完成卡）→ drop。判**歸屬**：若有擁有該介面/子系統的卡（如 chrome→AIDV-94、home→AIDV-119、design-kit ShotCard→AIDV-92、/social→AIDV-96）→ verdict='route'(routeTo)；無主且值得單追→ verdict='card'。碰後端/金鑰/破壞性→ designGate='needs-bruce'＋labels 含 待議,decision。` },
]
const verified = (await parallel(VERIFIERS.map(v => () =>
  agent(
`你是優化卡驗證代理（${v.lens}）。候選清單：
${JSON.stringify(allCandidates, null, 2)}

看板快照（去重用）：
${BOARD_SNAPSHOT}

上一輪產出（避免重產）：
${LAST_CYCLE}

工作：${v.focus}
對每個候選輸出一筆 spec。card 者填 worksheet（dev-workflow §3：範圍一句/重用既有具體名/檔案/旗標預設ON含退路/設計門/可觀察驗收/風險/Phase/若UI加一致性欄）、給 priority（Highest=P0安全；High=進行中Wave下一棒；Medium=一般Backlog；Low=被金鑰決策卡住）、labels（opt-card＋領域標）。drop 者寫 dropReason。route 者寫 routeTo。`,
    { label: `verify:${v.lens}`, phase: 'Verify', effort: 'high', schema: SPEC_SCHEMA }
  )
))).filter(Boolean)

// 合併兩視角：以 still-real 的 drop 為先（過時最該砍），再用 dedupe-route 的歸屬覆寫存活者
const stillReal = verified[0]?.specs ?? []
const dedupeRoute = verified[1]?.specs ?? []
return { allCandidates, stillReal, dedupeRoute, harvestedCounts: harvested.map(h => ({ modality: h.modality, n: h.candidates?.length||0 })) }
