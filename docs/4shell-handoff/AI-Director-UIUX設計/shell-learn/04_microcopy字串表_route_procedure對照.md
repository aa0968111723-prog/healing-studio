# 04 · `/learn` microcopy 字串表 · route/procedure 對照 · 設計系統 class 對照

> M4 一致性層：彙整全 shell 的 zh-TW 字串、每畫面→真實 route→真實 tRPC procedure（含 GitNexus 校正）、shadcn↔theme.css class 對照。實作收尾與 QA 以本檔交叉核對。
> 事實基準：`_research/03_code_reality_notes.md`（HEAD `2888a36`）＋ P6-learn 補丁原始碼。

---

## 1. 每畫面 → 真實 route → tRPC procedure 對照

| 分頁/區塊 | canonical route / `?sub=` | 真實 procedure | 權限 | 校正註記 |
|---|---|---|---|---|
| 富首頁聚合 | `/learn`（預設 `research`） | —（前端 `<Tabs>` + `?sub=`） | — | 六分頁 key：`research/models/hub/credits/keys/news` |
| 模型統計卡 | `/learn/ai-models` `?sub=models` | `aiModels.list({modality,provider,tier})→{models,meta}` | public | meta：total/verifiedCount/staleCount/coverage/lastResearchAt |
| 自動研究卡（增強） | 同上 | `aiModels.runDiscovery`/`refreshStale`/`refreshAll`/`refreshOne`/`researchStats`/`setSchedule` | protected | 排程每天 03:30 |
| 五腦指派 | 同上 | `agentModelPicks.recordPick({modality,modelId,source})` | protected | ⚠ **非** `assign`/`assignBrain`；真名 `recordPick` |
| 五腦回填（增強） | 同上 | `agentModelPicks.getPreferredByModalities`/`getPreferredForModality`/`getRecent`/`markAcceptance` | protected | — |
| 模型詳情（增強） | 同上 | `aiModels.getById({id})`、`credits.pricingCatalog()` | public | — |
| 模型可用性 | 同上 | `videoStudio.modelAvailability()`（影片）；`meta.available`（其他） | public/protected | — |
| 學習中心列表 | `/learn/docs` `?sub=hub` | `learnHub.list({search,category,difficulty,limit,offset})→{items,total}` | public | 無資料回退 `METHODOLOGY_DOCS` |
| 學習中心分類 | 同上 | `learnHub.categories()→{[cat]:count}` | public | 80 篇/6 分類 |
| 積分餘額 | `/learn/credits` `?sub=credits` | `credits.myBalance()→{remaining,topModel,totalSpentPoints,usedPct}` | protected | ⚠ `credits` 僅 `myBalance`/`pricingCatalog` |
| 用量統計（使用統計籤） | 同上 | `dashboard.myStats()`、`dashboard.myUsageLogs({limit})` | protected | 個人用量 |
| 定價目錄 | 同上 | `credits.pricingCatalog()` | public | — |
| 取得方式/退還機制 | 同上 | **無前端 procedure**（展示文案；退還由生成失敗鏈自動執行） | — | +50/+2/+3/管理員加分；安全檢查未過＋圖/影/音/語音 API 錯誤→全額退還 |
| 扣點/儲值 | 同上 | **無前端 procedure**（扣點伺服器內部·原子；儲值走 `plans.*`） | — | ⚠ 無 `credits.spend`/`topUp`；用量寫入＝`apiUsage.upsert`(admin) |
| LangSmith 籤（實站第三籤） | →`/settings`觀測 | `langsmith.status()`（**在 /settings**） | protected | 4-shell 把 LangSmith 移到 /settings 觀測 |
| 情報新聞 | `/learn/news` `?sub=news` | `news.list({limit,cursor?,category?})→{items,nextCursor}` | public | ⚠ **非** `sense.feed`；`sense` 僅 `inferIntent` |
| 研究代理 | `/learn/research` `?sub=research` | `orbProxy.unifiedSearch.mutate({query})` | protected | ⚠ **非** `sense.research`（不存在）；mock-default |
| 存為筆記 | research done | `notes.create`（+`update/delete/list/summary/exportIcs`） | protected | — |
| 存成提示詞 | research done | `promptLibrary.create`/`customBlocks.create`/`blockCombos.create` | protected | — |
| 加入知識庫 | research done | `<GenerateStoreReusePanel>`→`contextPacket.compileProject` | protected | 共用元件，引用不重定義 |
| Flow 牆展示 | research done | `<FlowShowcaseWall>`（共用元件） | — | ⚠ **不接** `showcase.templates`（不存在） |
| 平台金鑰狀態 | `?sub=keys` | `admin.apiKeysStatus()→[{name,label,module,isSet}]` | **adminProcedure** | 只回 isSet，無 secret |
| BYOMCP 入口 | 同上 | 三表待建（M5）：`user_mcp_connections`/`mcp_tool_permissions`/`mcp_tool_call_logs` | — | 受 `byomcp` 旗標控 |

**深頁 re-home（不重寫，沿用 P0 lazyPages）**：`/learn/model-wishlist`→`ModelWishlistPage`、`/learn/my-brain`→`MyBrainPage`、`/learn/codex`→`AgentCodexPage`、`/learn/teaching-archive`→`TeachingArchive`、`/learn/teams`→`TeamsPage`、`/learn/feedback`→`FeedbackPage`。

---

## 2. 旗標總表

| 旗標 | 檔 | 預設 | 作用 |
|---|---|---|---|
| `VITE_ENABLE_4SHELL` | `config/featureFlags.ts` | OFF | 4-shell 總開關；OFF＝行為等同線上 |
| `VITE_SHELL_LEARN_RICH` | `shells/learn/learnFlags.ts` | ON | `/learn` 富 UI；0 退回 P0 ShellFrame |
| `VITE_RESEARCH_PROVIDER` | `adapters/research.ts` | `mock` | 研究接縫；`trpc` 接 `orbProxy.unifiedSearch` |
| `byomcp`（執行時） | `settings.extraSettings.featureFlags` | off | BYOMCP 入口（`/settings` 功能開關控） |

---

## 3. zh-TW microcopy 字串表（i18n 友善；key → 字串）

### 共用 / 頂部
- `learn.title` =「📚 學習文件系統」
- `learn.subtitle` =「學習中心 · 模型情報（115）· 研究代理（Sonar+Brave）· 積分 / API · 情報新聞」
- 分頁標籤：`研究代理`／`模型情報`／`學習中心`／`積分`／`API 金鑰`／`新聞`

### 模型情報
- `models.stat.total` =「模型總數」｜`models.stat.vendor` =「廠商」｜`models.stat.featured` =「精選」｜`models.stat.coverage` =「已查核覆蓋率」
- `models.brain.title` =「🧠 五腦指派」｜`models.brain.sub` =「user_ai_brain · agent_model_picks」｜`models.brain.eligible` =「{n} 可選」｜`models.brain.placeholder` =「選擇模型…」｜`models.brain.none` =「無可指派模型」｜`models.brain.saving` =「記錄中…」｜`models.brain.ok` =「已記錄五腦指派」｜`models.brain.fail` =「指派失敗（需登入）」
- `models.lib.title` =「模型庫 / 願望清單」｜`models.count` =「{n} / {total} 個」｜`models.loading` =「載入中…」
- 篩選 label：「模態」「廠商」「層級」｜select all =「全部」｜搜尋 =「搜尋模型 / 廠商…」
- `models.featured` =「精選」｜`models.ctx` =「脈絡 {n} tok」｜`models.lastResearch` =「上次研究 {time}」
- `models.err` =「讀取模型清單失敗，已回退 baseline。」｜`models.empty` =「無符合條件的模型。」

### 學習中心
- `hub.title` =「學習中心 LearnHub」｜`hub.sub` =「方法論與教學文件，同時餵 RAG 與供人閱讀」｜`hub.count` =「{n} 篇」
- 搜尋 =「搜尋文件…」｜難度 =「全部難度」/「入門」/「進階」/「高級」
- `hub.fallback` =「（learnHub 暫無資料，顯示內建精選方法論）」｜`hub.doc.meta` =「{難度} · {n}分」

### 積分 / 用量
- `credits.eyebrow` =「方案 · 積分」｜`credits.unit` =「可用積分 · pts」｜`credits.used` =「已用比例」｜`credits.top` =「近 30 天高耗模型：{model}」
- `credits.earn.title` =「如何取得積分」｜`credits.earn` =「註冊 +50／分享資產 +2／分享模型 +3／管理員加分」
- `credits.safety` =「先扣後生成（原子）· 失敗全額退還 · 最小 1 pts / 安全上限 500 pts · 永久有效，不需信用卡。」
- `credits.refund.row` =「安全檢查未通過 → 全額退還」「圖像/影片/音樂/語音生成 API 錯誤 → 全額退還」｜`credits.earn.toast` =「+{n} 積分：{原因}」
- `credits.usage.title` =「用量紀錄」｜MiniStat =「本期請求」「本期成本」「剩餘配額」｜`credits.usage.empty` =「尚無用量紀錄（或未登入）。」
- `credits.crosslink` =「全站供應商用量分析在 /settings → 管理後台 → 成本金流（admin）。」｜`credits.langsmith` =「AI 監控（LangSmith）已移至 /settings → 觀測。」

### 新聞
- `news.title` =「情報新聞」｜`news.sub` =「news_articles · sense（/social 時事選題經脊椎讀此份）」｜`news.count` =「{n} 則」｜`news.empty` =「目前沒有情報（news 來源未設或 DB 不可用）。」

### 研究代理
- `research.title` =「研究代理 · Sonar + Brave」｜`research.sub` =「grounded · 帶引用（Perplexity 過渡/備援）」
- 模式：「mock（預設）」/「real · orbProxy.unifiedSearch」｜輸入 =「問一個需要上網查證的問題…」｜按鈕 =「研究」
- `research.idle.t` =「輸入問題開始研究」｜`research.idle.d` =「回傳會附上引用來源並扣積分（成本階梯：Sonar 屬中段）。可在 /settings 注入『研究上游故障』看錯誤/重試。」
- `research.loading.t` =「Sonar 研究中…」｜`research.loading.d` =「web grounding → 彙整 → 附引用…」
- `research.error.t` =「研究失敗」｜`research.error.d` =「研究上游暫時無回應（HTTP {code}）。可重試或稍後再試。」｜`research.retry` =「重試」
- `research.degraded` =「降級模式（未經即時查證｜Brave-only）：{reason}。以下答案可能未經即時查證來源。」
- `research.answer` =「彙整答案」｜`research.sources` =「引用來源（{n}）」｜`research.cost` =「-{n} 積分」
- 存庫：「存為筆記」「存成提示詞」「加入知識庫」「在 Flow 牆展示」｜「儲存中…」｜「已存為筆記/提示詞/知識」｜「儲存失敗（{原因}）」｜「需登入才能存庫」｜「請先選擇或建立專案再存庫」

### API 金鑰
- `keys.title` =「API 金鑰 / 自帶工具 BYOMCP」｜`keys.badge` =「待建（治理在 /settings）」
- `keys.byomcp.t` =「BYOMCP 入口尚未開放」｜`keys.byomcp.d` =「三張表（user_mcp_connections / mcp_tool_permissions / mcp_tool_call_logs）待建（M5）。可由管理員在 /settings → 管理後台 → 功能開關開啟。功能旗標可關，純加法。」
- `keys.platform.t` =「平台金鑰狀態」｜`keys.platform.sub` =「admin.apiKeysStatus · 只報 isSet，不暴露 secret」｜「已設定」/「未設定」

---

## 4. shadcn ↔ theme.css class / token 對照（套用設計系統用）

| P6 元件/類 | theme.css 語意 class | token（顏色） |
|---|---|---|
| `<Tabs>/<TabsList>/<TabsTrigger>` | `.subtabs` + `button.on` | 選中 `--clay-tint`→`--gold-tint`、邊 `--clay-soft` |
| `<Card>` | `.card`(+`.pad`/`.hover`) | `--surface` / `--line` / `--shadow-card` |
| 模型網格卡 | `.modelcard`(+`.assigned`) | hover `--line-strong`；assigned `--clay-tint` |
| `<Badge variant="secondary">` | `.pill` | `--surface-2`/`--text-soft` |
| `<Badge>` 成功 | `.pill.ok` | `--ok`/`--ok-tint` |
| `<Badge>` 警示 | `.pill.warn` | `--gold-deep`/`--warn-tint` |
| `<Badge>` 錯誤 | `.pill.bad` | `--bad`/`--bad-tint` |
| `<Badge>` 資訊 | `.pill.info` | `--info`/`--info-tint` |
| mono 標（provider/旗標） | `.tag` | `--muted`/`--surface-2` |
| `<Button>` 主 | `.btn.primary` | `--clay-bright`→`--clay`/`--on-clay` |
| `<Button>` 次金 | `.btn.gold` | `--gold-bright`→`--gold` |
| `<Button>` 幽靈/危險 | `.btn.ghost`/`.btn.danger` | — / `--bad` |
| `<Input>`/`<select>` | `.input` | `--wash`/`--line`；focus `--clay`+`--ring-soft` |
| `<Progress>`（用量） | `.usagebar`/`.ub`/`.ub i` 或 `.meter`/`.meter i` | 填充 `--clay`→`--info`/`--gold` |
| 研究引用列 | `.source`(`.sh`/`.num`/`.su`/`.sx`) | 序號 `--clay`；URL `--info` |
| EmptyState/Loading | `.state`(`.ico`/`.ti`/`.ds`)、`.spin`、`.dots` | error 態 `.state.error` `--bad` |
| `<Skeleton>` | `.skel` | `--surface-2`→`--wash` shimmer |
| 列式資料（新聞/用量/腦） | `.listrow`(`.le`) | `--surface-2`；hover `--surface-3` |
| `sonner` toast | `.toast`(`.ok/.warn/.bad/.info`) | 對應 tint |
| 卡頭/eyebrow | `.h-row`(`.ti`/`.cnt`)、`.eyebrow` | `--clay` eyebrow |

---

## 5. 一致性檢查清單（QA）

- [ ] 六分頁 key 與 `?sub=` 同步；canonical 深連結（`/learn/ai-models` 等）落對分頁；舊路徑 redirect 不 404。
- [ ] 所有 procedure 名與 §1 一致——**無 `agentModelPicks.assign`、`credits.spend/topUp`、`sense.research`、`sense.feed`、`showcase.templates` 等不存在名**。
- [ ] public（aiModels/news/learnHub/pricingCatalog）無金鑰可讀；protected（credits/dashboard/research/notes/promptLibrary）未登入優雅降級；admin（apiKeysStatus）對非 admin 不請求不顯示。
- [ ] 每畫面六態（空/載入/錯誤/長/權限/降級）皆落地，文案逐字對齊 §3。
- [ ] 顏色 100% 引用 `theme.css` token；共用元件（Flow 牆/存庫面板/筆記抽屜）引用 design-system **不重定義**；無寫死 hex；無真實金鑰。
- [ ] 亮色 Claude 質感：暖米白表面、黏土強調、serif 標題、克制邊框、柔大圓角；reduced-motion 尊重。
