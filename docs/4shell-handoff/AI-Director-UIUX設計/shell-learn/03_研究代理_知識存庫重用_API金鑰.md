# 03 · `/learn` 研究代理 ／ 知識存庫重用 ／ API 金鑰 — 逐頁規格

> 三主題：`research`（研究代理）＋「存成可重用知識」＋ `keys`（API 金鑰/BYOMCP）
> 元件：`ResearchPanel.tsx`／`adapters/research.ts`／`ApiKeysPanel.tsx`（P6 補丁已落地）
> 設計系統：引用 `theme.css` §8（`.source`/`.subtabs`）＋共用 §5（`.state`/`.toast`）。
> 跨工作流共用元件：`<GenerateStoreReusePanel>`、`<FlowShowcaseWall>`、`<ProjectNotesDrawer>`（**引用 design-system，不重定義**）。

---

# 第一部分 · 研究代理（ResearchPanel）

> 分頁 key：`research`（**`/learn` 預設分頁**）｜canonical：`/learn/research`、`/learn?sub=research`
> 對映盤點/架構 §系統③.6：研究代理（OpenRouter **Sonar + Brave**，Perplexity 過渡/備援）：grounded、帶引用——把「學習」變「即時研究」。後端已有（`orbUnifiedSearch`/`perplexityDeepSearch`/`orbWebResearch`）。
> 接縫：`adapters/research.ts`，**mock-default**（零金鑰即可 demo）；`VITE_RESEARCH_PROVIDER=trpc` 才接 `orbProxy.unifiedSearch`。

## A. 研究代理面板

### ①畫面結構與佈局
單張 `.card.pad.space-y-4`：
- **標題列**：左「研究代理 · Sonar + Brave」＋副標「grounded · 帶引用（Perplexity 過渡/備援）」；右**模式徽章**：`mock` 時 `.pill.mute`「mock（預設）」、`trpc` 時 `.pill.info`/`Badge default`「real · orbProxy.unifiedSearch」。
- **查詢列**（`flex gap-2`）：`.input`（placeholder「問一個需要上網查證的問題…」，Enter 送出，預設值「影片跨鏡角色一致性怎麼做？」）＋ `.btn.primary`「研究」（載入轉 `Loader2` spin）。
- **降級橫幅**（條件顯示，見狀態）。
- **內容區**：依 `state` 切換 idle/loading/error/done（見下）。

### ②全狀態（研究專屬五態）
研究面板有自己的執行狀態機 `RunState = idle | loading | done | error`：

1. **idle（初始）**：`.state`（虛線框）＋ `Globe` 圖示＋「輸入問題開始研究」＋說明「回傳會附上引用來源並扣積分（成本階梯：Sonar 屬中段）。可在 /settings 注入『研究上游故障』看錯誤/重試。」
2. **loading**：`.state` ＋ `Loader2` spin（或 `.spin`）＋「Sonar 研究中…」＋「web grounding → 彙整 → 附引用…」（可用 `.dots` 流水點）。
3. **error**：`.state.error` 框（`--bad` 邊/底）＋ `AlertTriangle`＋「研究失敗」＋「研究上游暫時無回應（HTTP {code}）。可重試或稍後再試。」＋ `.btn`（outline）「`RefreshCw` 重試」。
4. **done**：見「彙整答案 + 引用來源」（C 區）。
5. **degraded（疊加，非互斥）**：done/任一態上方掛 `--warn` 橫幅（`AlertTriangle`）：「降級模式（{未經即時查證 | Brave-only}）：{reason}。以下答案可能未經即時查證來源。」

- **長內容**：答案 `whitespace-pre-wrap`；引用來源列表自然增長（通常 3–8 筆）。
- **權限**：mock 無門檻；trpc 模式 `orbProxy.unifiedSearch` 為 protected（扣積分）——未登入時後端回 401，落 error 態（文案可附「需登入」）。

### ③進入＆離開條件
- 進入：`/learn` 裸路由（**research 為預設分頁**）、`.subtabs`「研究代理」、`/learn/research`、`?sub=research`、`Ctrl+K` 深連結。
- 離開：切分頁（保留已查結果於記憶體，回來仍在）。

### ④分支與決策
- **模式分流**：`createResearchAdapter()` 讀 `VITE_RESEARCH_PROVIDER`：`mock`（罐頭答案+3 來源）｜`trpc`（`orbProxy.unifiedSearch.mutate({query})`）。介面相同，**切換 UI 一行不改**。
- **故障注入**：adapter 讀 `SpineProvider.faults.research`（`/settings` 故障面板可開）→ mock 模式丟 503、trpc 模式由後端決定。用 `faultsRef` 讀最新值，不重建 adapter。
- **降級偵測**（trpc）：後端回 `degraded` 或 `sources.length===0` → 發 `degraded` 事件，`mode` ＝ `no-grounding`（0 來源）或 `brave-only`，掛橫幅。
- **進度事件**（`ResearchEvent`）：`start → grounding(sonar|brave|mock) → degraded? → done(sources) | error(http,msg)`，驅動 UI 分段狀態。
- 空查詢（trim 後空）不送出。

### ⑤microcopy（zh-TW）
標題「研究代理 · Sonar + Brave」｜副標「grounded · 帶引用（Perplexity 過渡/備援）」｜模式「mock（預設）」/「real · orbProxy.unifiedSearch」｜輸入「問一個需要上網查證的問題…」｜按鈕「研究」｜idle「輸入問題開始研究」＋「回傳會附上引用來源並扣積分（成本階梯：Sonar 屬中段）。可在 /settings 注入『研究上游故障』看錯誤/重試。」｜loading「Sonar 研究中…」/「web grounding → 彙整 → 附引用…」｜error「研究失敗」/「研究上游暫時無回應（HTTP {code}）。可重試或稍後再試。」/「重試」｜降級「降級模式（未經即時查證｜Brave-only）：{reason}。以下答案可能未經即時查證來源。」

### ⑥對回真實 route/procedure
- `orbProxy.unifiedSearch.mutate({ query }) → { answer, sources[]|citations[], tokens, costUsd, model, degraded?, degradedReason? }`（**protected**，Sonar+Brave 統一入口）。
  > ⚠ 校正：研究/grounding 統一入口＝`orbProxy.unifiedSearch`；**`sense.research` 不存在**（`sense` 僅 `inferIntent`）；情報清單另走 `news.list`（`03_code_reality_notes` §6.2）。
- 型別：`ResearchResult { query, answer, sources: {title,url,snip}[], tokens, costUsd, model }`（`spine/types.ts`）。

---

## B. 彙整答案 + 引用來源（done 態內容）

### ①畫面結構與佈局
done 態渲染兩塊：
- **彙整答案卡**（`.card` `--surface-2` 底）：eyebrow「彙整答案」＋答案內文（`whitespace-pre-wrap`，`--ink`）＋下方 `.pill`/`Badge` 群：模型名（secondary）／`{tokens} tokens`（outline）／**`-{Math.round(costUsd*1000)} 積分`**（`--gold`/amber 邊，標扣點）。
- **引用來源**：eyebrow「引用來源（{n}）」＋列表。每筆＝可點外連 `.source`：左圓號 `.source .sh .num`（`--clay` 實底序號 1/2/3…）＋標題 `.sh`＋外連 `ExternalLink`；下方 `.su`（`--info`，URL truncate）＋ `.sx`（`--muted`，`snip` line-clamp-2）。

### ②全狀態
- 來源 0 筆＝降級 no-grounding（橫幅已掛），答案仍顯示但標「未經即時查證」。
- 來源 url 缺失：仍顯示標題與 snip，不可點。

### ⑤microcopy
「彙整答案」｜「{model}」「{n} tokens」「-{n} 積分」｜「引用來源（{n}）」。

---

## C. 存成可重用知識（**brief 指定的核心增強**）

> 盤點/brief：研究面板的價值是「查詢 → 引用來源 → **存成可重用知識**；和提示詞庫/筆記的關係」。P6 `ResearchPanel` 目前到 done 態為止（唯讀）。本節規格化 done 態下的**「存庫」行動列**，接 `<GenerateStoreReusePanel>` 共用元件與既有 `notes.*`/`promptLibrary.*` procedure。**純加法，引用共用元件不重定義。**

### ①畫面結構與佈局
done 態的「彙整答案卡」底部追加一條**行動列**（`flex flex-wrap gap-2`，分隔線上）：

| 行動 | 元件 | 去向 |
|---|---|---|
| `.btn.sm`「存為筆記」 | `BookmarkPlus` | 開 `<ProjectNotesDrawer>`，預填標題=query、內文=答案、來源附在筆記尾 |
| `.btn.sm`「存成提示詞」 | `Sparkles` | 把答案/關鍵句存為 `promptLibrary` 條目（可重用咒語/方法） |
| `.btn.sm.gold`「加入知識庫」 | `Library` | 經 `<GenerateStoreReusePanel>` 入庫（可重用知識，餵 RAG/Context Packet） |
| `.btn.ghost.sm`「在 Flow 牆展示」 | `Tv` | 把這則研究丟到 `<FlowShowcaseWall>`（直顯 query＋來源，一鍵延伸再研究） |

**關係模型（三者正交，給實作對齊心智模型）**：
- **筆記（`notes`）**＝個人/專案的自由記錄（靈感、研究摘錄）；全站筆記抽屜同源。
- **提示詞庫（`promptLibrary`/`customBlocks`/`blockCombos`）**＝可重用的**生成風格/咒語模板**（餵生成派工）。
- **知識庫（經 `<GenerateStoreReusePanel>`）**＝可被代理檢索的**可重用知識**（餵 RAG / `contextPacket.compileProject`）。
- **Flow 電視牆（`<FlowShowcaseWall>`）**＝把產物/研究**直顯 seed＋prompt、一鍵延伸**的展示牆（靈感重用入口）。

### ②全狀態
- **未登入**：四鈕 disabled＋tooltip「需登入才能存庫」（`notes`/`promptLibrary` 為 protected）。
- **存入中**：對應鈕轉 `.dots`「儲存中…」。
- **成功**：toast `.toast.ok`「已存為筆記／提示詞／知識」＋（筆記）抽屜滑出顯示新條目。
- **失敗**：toast `.toast.bad`「儲存失敗（{原因}）」。
- **重複**：若同 query 已存→toast `.toast.warn`「已存在相同知識，已更新時間」（或詢問覆蓋）。

### ④分支與決策
- 「存為筆記」走 `notes.create({ title, body, sources })`；成功後可在 `<ProjectNotesDrawer>` 編輯/排程（`notes.exportIcs` 可轉行事曆）。
- 「存成提示詞」走 `promptLibrary.create`（或 `customBlocks.create`）——把答案中可複用的方法/咒語結構化。
- 「加入知識庫」委派 `<GenerateStoreReusePanel>`（脊椎共用），底層回寫專案知識（與 `/social` 包 `03` 同一元件契約）。
- 綁定 active-project：存庫預設掛當前 `activeProjectId`（脊椎 `ProjectsContext`）；無專案時提示先選/建專案。

### ⑤microcopy（zh-TW）
「存為筆記」「存成提示詞」「加入知識庫」「在 Flow 牆展示」｜進度「儲存中…」｜成功「已存為筆記」/「已存成提示詞」/「已加入知識庫」｜失敗「儲存失敗（{原因}）」｜未登入 tooltip「需登入才能存庫」｜無專案「請先選擇或建立專案再存庫」。

### ⑥對回真實 route/procedure
- `notes.create({ ... }) → note`（**protected**；另有 `update`/`delete`/`list`/`summary`/`exportIcs`）。
- `promptLibrary.create(...)`／`customBlocks.create(...)`／`blockCombos.create(...)`（**protected**，提示詞庫家族；`03_code_reality_notes` §6.1 確認存在）。
- 知識庫/RAG：經 `<GenerateStoreReusePanel>` → 後端 `contextPacket.compileProject`/專案知識回寫（**protected**）。
- Flow 牆：`<FlowShowcaseWall>`（design-system 共用元件，引用不重定義）。
  > ⚠ 不要接 `showcase.templates`（**不存在**＝社群版型牆待建）；Flow 牆是**展示/延伸**用途，資料源為產物/研究記錄，非 showcase 範本。

---

# 第二部分 · API 金鑰 / 自帶工具 BYOMCP（ApiKeysPanel）

> 分頁 key：`keys`｜canonical：`/learn?sub=keys`
> 對映盤點/架構 §系統③.4：API 金鑰／自帶工具 BYOMCP（使用者自帶 key 與外部 MCP 入口）。**BYOMCP 三表未建＝待建（M5）**，治理在 `/settings`。
> ⚠ **本規格只設計畫面，絕不放任何真實金鑰**；平台金鑰一律只顯示「是否已設定（isSet）」，**不暴露 secret**。

## D. API 金鑰 / BYOMCP

### ①畫面結構與佈局
依角色兩段：

**(1) BYOMCP 使用者入口（待建佔位，所有人可見）**——`.card.pad`：
- 標題列「`KeyRound` API 金鑰 / 自帶工具 BYOMCP」＋ `.pill.mute`/outline「待建（治理在 /settings）」。
- 置中 `.state`（虛線框）＋ `Plug` 圖示＋「BYOMCP 入口尚未開放」＋說明「三張表（user_mcp_connections / mcp_tool_permissions / mcp_tool_call_logs）待建（M5）。可由管理員在 /settings → 管理後台 → 功能開關開啟。功能旗標可關，純加法。」

**(2) 平台金鑰狀態（僅 admin 可見）**——`.card.pad`：
- 標題「`ShieldCheck` 平台金鑰狀態」＋ mono 副標「admin.apiKeysStatus · 只報 isSet，不暴露 secret」。
- 金鑰格（`grid-cols-2 md:grid-cols-3 gap-2`）：每格＝狀態圖示（已設定 `ShieldCheck` `--ok`／未設定 `ShieldOff` `--muted`）＋名稱/模組（truncate）＋右側 `.pill`「已設定」(ok)/「未設定」(mute)。

### ②全狀態
- **載入**（admin 段）：6 格 `.skel`（h-12 rounded-lg）。
- **空**：admin 段無金鑰資料→格區空（理論上 apiKeysStatus 會列固定模組）。
- **錯誤**：`retry:false`，失敗→不顯示 admin 段（等同無權限）。
- **權限（核心）**：`isAdmin = user.role==="admin"`。**非 admin 不發 `admin.apiKeysStatus` 請求、完全不顯示平台金鑰段**——只看到 BYOMCP 佔位。`useQuery(..., { enabled: isAdmin })`。
- **長內容**：金鑰模組通常固定數量，grid 換行即可。

### ③進入＆離開條件
- 進入：`.subtabs`「API 金鑰」、`?sub=keys`。
- 離開：佔位文案內「/settings → 管理後台 → 功能開關」為導引（連去 `/settings?sub=admin`）。

### ④分支與決策
- BYOMCP 入口受**執行時功能旗標 `byomcp`** 控（`/settings` FeatureFlagsTab 可開）：旗標 off→顯示「尚未開放」佔位；旗標 on（且三表建後）→顯示 BYOMCP 連線管理 UI（本期僅佔位，UI 待 M5）。
- admin 段純唯讀診斷：**不提供新增/編輯/刪除金鑰的 UI**（避免在前端碰 secret）；金鑰實際設定走部署環境變數/後台安全流程。

### ⑤microcopy（zh-TW）
標題「API 金鑰 / 自帶工具 BYOMCP」｜狀態標「待建（治理在 /settings）」｜佔位「BYOMCP 入口尚未開放」＋「三張表（user_mcp_connections / mcp_tool_permissions / mcp_tool_call_logs）待建（M5）。可由管理員在 /settings → 管理後台 → 功能開關開啟。功能旗標可關，純加法。」｜admin 段「平台金鑰狀態」＋「admin.apiKeysStatus · 只報 isSet，不暴露 secret」｜格標「已設定」/「未設定」。

### ⑥對回真實 route/procedure
- `admin.apiKeysStatus() → [{ name, label, module, isSet }]`（**adminProcedure**；**只回 isSet 布林，不含 secret**）。
- BYOMCP 三表（待建 M5）：`user_mcp_connections` / `mcp_tool_permissions` / `mcp_tool_call_logs`——UI 佔位，受 `byomcp` 旗標控。
- RBAC：`user.role` 來自 `useAuth`（`@/_core/hooks/useAuth`）。

---

## E. 三主題共同驗收要點

- [ ] 研究面板五態（idle/loading/error/done/degraded）齊全；mock 預設可跑、故障可重試；模式徽章正確。
- [ ] done 態彙整答案 + 引用 `.source` 列（序號/標題/URL/snip）+ 扣點徽章；外連正確。
- [ ] **存庫行動列**（筆記/提示詞/知識庫/Flow 牆）接 `notes.*`/`promptLibrary.*`/`<GenerateStoreReusePanel>`/`<FlowShowcaseWall>` 共用元件，未登入 disabled；**不重定義共用元件**。
- [ ] API 金鑰：BYOMCP 佔位所有人可見；平台金鑰段**僅 admin**、**只顯示 isSet、無 secret**。
- [ ] **全規格無任何真實金鑰字串**。
- [ ] 顏色全引用 `theme.css`；研究來源 `.source`、狀態 `.state`/`.state.error`、徽章 `.pill`、Toast `.toast`；無寫死 hex。
- [ ] 研究全程 `orbProxy.unifiedSearch` 真實 procedure，**無 `sense.research`/`showcase.templates` 等不存在名**。
