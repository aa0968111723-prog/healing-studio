# G4 — 依賴漏洞 × 雜項檔案 × 剩餘頁面內部（補洞 wave G)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 波次:**補洞 wave G**
- 方法:實跑 `npm audit --json` + `npm audit fix --dry-run`、逐檔實讀 root 雜項檔、逐區實讀 CalendarPage / LoraTrainer / AdminPage / Home、抽讀 learnHub.seed.ts 10 篇
- 承接:00-overview、01-features(§4.4、§8 缺讀聲明)、B-infra(§4 測試盤點、§7 缺讀)

---

## 1. npm audit 依賴漏洞盤點

**總計 36 個(2 critical、9 high、23 moderate、2 low)**;`npm audit fix`(非 force)可修其中大半,不動 package.json 語意版本。

### 1.1 critical(2)

| 套件(裝置版本) | 漏洞 | 影響路徑 | 可否 `npm audit fix` 不破壞 | 建議 |
|---|---|---|---|---|
| **protobufjs 7.5.4** | GHSA-xq3m-2v4x-88gg **任意程式碼執行**(<7.5.5)+ 10 個 high/moderate(code injection via bytes 預設值、prototype injection、多個無界遞迴 DoS,累計要求 ≤7.6.2 全修) | **間接**:`@google-cloud/speech@7.3.0 → google-gax@5.0.6 → @grpc/proto-loader / proto3-json-serializer → protobufjs` | ✅ dry-run 顯示升到 **7.6.4**,semver 相容 | **立即跑 `npm audit fix`**。prod 有載入 @google-cloud/speech(STT),屬 runtime 面 |
| **vitest 2.1.9** | GHSA-5xrq-8626-4rwp:**Vitest UI server 監聽時可讀取並執行任意檔案**(<3.2.6) | **直接 devDependency**(`^2.1.9`) | ❌ 需 **vitest 4.1.9(semver major)**,`npm audit fix --force` 才動 | 風險實務上低:repo scripts 只用 `vitest run`,從未起 `--ui` server;但建議排一張卡做 vitest 2→4 大版升級(連帶修掉 vite-node 內捆的 vite 5.4.21) |

### 1.2 high(9)

| 套件(裝置版本) | 漏洞重點 | 影響路徑 | 可否 fix 不破壞 | 建議 |
|---|---|---|---|---|
| **axios 1.15.0** | 21 個 advisory 打包:多組 **prototype-pollution gadget**(credential 竊取/回應劫持/MITM via `config.proxy`)、NO_PROXY 繞過 **SSRF**(127.0.0.0/8、IPv4-mapped IPv6)、Proxy-Authorization 洩漏、cookie ReDoS、資源無上限 DoS——全部 <1.15.1~<1.16.0 | **直接依賴**(`^1.12.0`),elevenlabs 也共用同一份 | ✅ dry-run 升 **1.18.1**,在 `^1.12.0` 範圍內 | **立即修**。axios 是 server 對外呼叫主力之一,SSRF/proxy 類與本專案的 ssrfGuard 防線直接相關 |
| **drizzle-orm 0.44.7** | GHSA-gpj5-g38j-94v9:**SQL injection via 未正確跳脫的 SQL identifier**(<0.45.2) | **直接依賴**(`^0.44.5`),prod ORM | ❌ npm 標記 fix=0.45.2 為 **semver major**(0.x 語意) | **高優先手動升級**:改 `"drizzle-orm": "^0.45.2"` 後全量跑 610 個測試 + Docker migration 演練(MIGRATION_FAIL_CLOSED 防線在,壞了會擋啟動,風險可控)。ORM 注入類在 102 張表的 prod 是最該修的一顆 |
| **langsmith 0.3.87** | GHSA-3644-q5cj-c5c7(high):public prompt pull **反序列化不受信 manifest**(<0.6.0)+ 3 moderate(SSRF via tracing header、proto pollution、streaming 繞過 redaction) | **直接依賴**(`^0.3.0`);@langchain/core@0.3.80 也依賴它 | ❌ npm 建議 @langchain/core 1.2.1(major) | 專案只用 langsmith 做 tracing、不 pull public prompt → 實際暴露低;可先手動把 langsmith 升 `^0.6`,@langchain/core 大版另排卡 |
| **ws 8.20.0** | GHSA-96hv-2xvq-fx4p:tiny-fragment **記憶體耗盡 DoS**(<8.21.0)+ 未初始化記憶體揭露(moderate) | **直接依賴**(`^8.18.0`),server/ws WebSocket 用;@google/genai 共用 | ✅ dry-run 升 **8.21.0** | **立即修**。prod WebSocket 面直接暴露 |
| **@grpc/grpc-js 1.14.3** | 2 個 malformed request/compressed message **server crash**(1.14.0–1.14.3) | 間接:`@google-cloud/speech → google-gax` | ✅ 升 1.14.4 | `npm audit fix` 帶過 |
| **fast-xml-builder 1.1.4** | 屬性值引號繞過(≤1.1.6) | 間接:`@google-cloud/storage → fast-xml-parser@5.5.8` | ✅ 升 1.2.1(fast-xml-parser 同步升 5.9.3) | `npm audit fix` 帶過 |
| **form-data 4.0.5 / 2.5.5** | CRLF injection via 未跳脫 multipart 欄位名(GHSA-hmw2-7cc7-3qxx) | 間接兩處:axios/elevenlabs → form-data@4;`@google-cloud/storage → retry-request → @types/request → form-data@2` | ✅ 升 4.0.6 / 2.5.6 | `npm audit fix` 帶過 |
| **undici 7.25.0** | SOCKS5 TLS 驗證繞過、Set-Cookie header injection、WebSocket fragment DoS 等 7 個(<7.28.0) | 間接:`jsdom@29(devDep)` | ✅ 升 7.28.0 | dev 測試環境限定,順手修 |
| **vite 7.3.2** | `server.fs.deny` 繞過(Windows alternate paths,high)+ launch-editor NTLMv2 洩漏(Windows) | **直接 devDependency**;另 vitest 內捆 vite@5.4.21 同病 | ✅ 頂層 vite 升 **7.3.6**;vitest 內捆的 5.4.21 只有 vitest 4 major 能修 | 皆 Windows dev-server 限定、Linux prod 無感;隨 audit fix 修頂層,內捆版併入 vitest 升級卡 |

### 1.3 moderate / low 統計

- **moderate 23**:大宗是 axios/protobufjs/langsmith/undici 上表 via 鏈中的次要 advisory,另有 uuid(google-gax 鏈,fix 會升 9.0.1)、esbuild(vite 鏈)、teeny-request/retry-request/gaxios(@google-cloud/storage 鏈,audit fix 會把 storage 升 7.21.0 帶過)等。
- **low 2**:axios null-byte injection、undici keep-alive queue poisoning(皆隨上表修復帶過)。

### 1.4 執行注意

1. `npm ls` 目前回報 **ELSPROBLEMS**:`@builder.io/vite-plugin-jsx-loc@0.1.1` peer 要求 vite ^4/^5,裝的是 vite 7.3.2(invalid)。Dockerfile 已用 `npm ci --legacy-peer-deps` 繞過;本機跑 `npm audit fix` 也可能需要 `--legacy-peer-deps`。
2. `npm audit fix`(不加 force)dry-run 實測會 add 191 / change ~40 / remove 若干,**全部在既有 semver 範圍內**,涵蓋 protobufjs、axios、ws、grpc-js、form-data、fast-xml-builder、undici、vite 頂層 → 修完剩 **drizzle-orm(high)、vitest(critical, dev)、langsmith(high)** 三顆需人工大版決策。
3. B-infra §4.2 已指出 **CI 無依賴稽核**——建議把 `npm audit --audit-level=high` 加進 pr-gate(或獨立 cron workflow),否則本表下個月就過期。

---

## 2. load-tests/ 目錄

只有一檔:**`load-tests/video-pipeline.js`(358 行,AIDV-711)** —— **k6** 負載測試 harness,對 `/api/trpc/videoProject.create` 打壓力。

| 面向 | 內容 |
|---|---|
| 工具 | k6(`import http from "k6/http"`),非 npm 依賴,需另裝 k6 binary;repo scripts/package.json **無對應 npm script** |
| 場景 | S1 baseline(1 VU × 5 連續 create)、S2 concurrent(ramping 0→10 VU × 30s,每 creator 3 task)、S3 registry stress(5 VU 打 edge-case payload:1:1 比例、255 字 title、4K/h265 outputSpec、express/critical priorityClass)、S4 sse_fanout(**明標 BLOCKED on AIDV-341/370** Supabase Realtime 未復原,目前只 probe `auth.me` 當 transport 心跳) |
| 門檻 | `pipeline_stalls count<1`(0 容忍)、error rate <10%、create p95 <5s、http_req_failed <5%;**429 被視為「限流正常運作」不算失敗** |
| 認證 | `TEST_TOKEN` 同時塞 Bearer header + `session=` cookie;未帶 token 時把 UNAUTHORIZED 也視為「transport 活著」 |
| 結果去向 | 檔尾註解要求存進 `pipeline_latency_baselines`(Supabase 表)——但 **`load-tests/results/` 目錄不存在、repo 內無任何結果 JSON**,亦即驗收要求的基準數據未見落地 |
| 與 B §4.1 對接 | B 文件測試盤點漏了這一項 → 測試資產全景應補列:**負載測試 1 支(k6,手動、不在 CI、S4 被 blocked、結果未歸檔)** |

可跑性:語法完整、參數化乾淨,裝 k6 後即可對 localhost 或 Railway 跑;主要缺口是無 npm script 入口、無結果歸檔、S4 阻塞。

---

## 3. root 雜項檔盤點

| 檔/目錄 | 是什麼 | 還有用嗎 | 清理建議 |
|---|---|---|---|
| **`.brain-state.json`(186KB)** | AI Brain 監控系統的 runtime 持久化快照:apiAlerts 87 筆、errorTraces 87 筆、reflectionProposals 5、accuracyTests 5、generationLogs 0、savedAt=2026-06-19。由 `server/services/brainStatePersistence.ts:36` 寫到 `<cwd>/.brain-state.json`(可用 `BRAIN_STATE_FILE` 覆寫),`brainAutoRepair.ts` 也讀 | **機制有用,但把 runtime 狀態檔 commit 進 git 是錯的**(最後一次 commit 2026-06-20,夾在 AIDV-153 的 PR 裡);prod 每次寫入都會讓容器內 worktree 髒掉,開發機上會不斷產生未預期 diff。`.gitignore` 沒擋它 | 加進 `.gitignore` + `git rm --cached`;prod 建議設 `BRAIN_STATE_FILE` 指到 repo 外(如 /data) |
| **`todo.md`(61KB / 1203 行)** | Manus 時代的專案 TODO:PART 1–5(禪意 UI、角色塑造、雙引擎 RAG、RBAC、基礎設施)+ Phase 1–4 各 refactoring 清單,幾乎全部 `[x]` 勾完;最後 commit 2026-04-16 | ❌ 已被 **Jira AIDV(單一真實佇列,AGENTS.md 明定)+ docs/plan/** 取代,兩個半月沒人動 | 移到 `docs/archive/` 或直接刪(git 歷史保留即可) |
| **`audit_orb.py`(3.7KB)** | 靜態稽核:比對 `shared/appRegistry.ts` 的 supportedActions vs 各頁 `handle()` 實際 case 分支,含 INTENTIONAL_HIDDEN_ACTIONS 白名單 | ✅ 純 stdlib(re/glob)可跑;docs/README、ARCHITECTURE、deep_fix_plan 都引用;最後維護 2026-05-07(「審計腳本去誤報」) | 留;建議搬進 `scripts/` 與其他 audit-* 同居,root 減噪 |
| **`deep_audit.py`(6.3KB)** | 進階版:capabilities 宣告 vs handle() 對齊、state 曝露充分性、NAV_ALLOWLIST 覆蓋度(含 DYNAMIC_STATE_PAGES / NAV_NARROW_EXEMPT 豁免表) | ✅ 同上 | 同上,搬 `scripts/` |
| **`requirements.txt`** | 只 pin `cryptography>=42.0.2`(CVE-2024-0727);Dockerfile builder stage 第 8-9 行實際執行 `pip3 install 'cryptography>=42.0.2'`(但寫死在 Dockerfile,**沒有讀這個檔**) | 半有用:內容與 Dockerfile 重複,檔案本身無消費者 | 二選一:Dockerfile 改 `pip3 install -r requirements.txt`,或刪檔留 Dockerfile 註解 |
| **`.manus/db/`(19 檔,112KB)** | Manus 開發工具的 DB query 快照(如 `CREATE TABLE consistency_vault` 等 DDL 與錯誤紀錄),時間戳 2026-03~04 | ❌ 純歷史殘渣,無任何程式讀取 | 整個 `.manus/` 刪除 |
| **`dev-environment/`** | in-repo 一鍵本機開發包:docker-compose、Makefile、setup.sh/ps1、migrate-debug.mjs、.env.dev.example;README 校準日 2026-06-18 | ✅ 有用,但 README 數字已漂移(寫 82 表/77 migrations/Pinecone;現況 102 表、journal idx 91+、AIDV-19 後 pgvector) | 留;排一次 README 重校準 |
| **`config/pricing-table.json`** | AI 供應商定價表(fal 7 模型、gemini 5、elevenlabs 3、suno 1),`_lastUpdated: 2026-04-20` | ⚠️ **孤兒設定檔:全 repo 無任何程式碼讀它**(實際成本計算在 `server/services/cost/` 與 falModels/llmRouter 內);唯一引用是 `docs/admin-api-usage.md:144` 把「在 pricing-table.json 加定價」列為新增供應商步驟 4——**該文件指示已失真** | 刪檔 + 修 docs/admin-api-usage.md 步驟 4 指向真實定價位置;或反過來把成本表外部化到此檔(需開卡) |
| **`types/`** | `sse-events.ts`(7.2KB,AIDV-708 Phase 1:統一三條 SSE bus——generationBus/orbChatProgress/agentEventBus——的事件型別,`server/services/sseRouter.ts`、`server/unifiedSseRoute.ts`、`client/src/contexts/segmentProgress.ts` 皆 import,2026-06-30 才更新)+ `tough-cookie-compat.d.ts`(型別 shim) | ✅ **活代碼**,非雜項 | 留(可考慮併入 `shared/`,非必要) |
| **`patches/wouter@3.7.1.patch`** | patch-package(postinstall 自動套)對 wouter ESM `Switch` 加 18 行:每次 render 時把所有子 Route 的 path 收集到 **`window.__WOUTER_ROUTES__`** 全域陣列 | ⚠️ 半孤兒:全 repo 只有 `client/src/app/ShellRoutes.tsx:16` 的**註解**提到它,**沒有任何程式碼讀 `window.__WOUTER_ROUTES__`**(scripts/browser-audit/run-audit.mjs 也不讀)——推測給瀏覽器端手動稽核/外部 QA bot 用。副作用:每次 Switch render 多跑一次 flattenChildren 迴圈(微小) | 確認 QA 探查 bot 是否依賴後再決定;若無,刪 patch 可少一個升級 wouter 的絆腳石 |
| **`test-lora-api.mjs`** | 一次性冒煙腳本:驗 REPLICATE_API_TOKEN 有效性 + 試提交 ostris/flux-dev-lora-trainer;最後 commit 2026-04-16 | ⚠️ 可跑但無人引用、不在 package.json scripts | 搬 `scripts/` 或刪 |
| **`COORDINATION.md`(18.5KB)** | 4-shell 重構期的三方(Claude/Codex/Antigravity)live 訊息板,契約凍結 2026-06-06,最後 commit 2026-06-07 | ❌ **已被 AGENTS.md 明文取代**(AGENTS.md 開頭:「取代 COORDINATION.md 的 4-shell 階段板運作模式」);且 `docs/4shell-handoff/交接包/COORDINATION.md` 已有歸檔副本 | 刪 root 副本(歷史在 handoff 交接包與 git) |

---

## 4. 剩餘頁面內部補完

### 4.1 CalendarPage.tsx(1582 行;被 NotesPage:1605 以 `<CalendarPage embedded />` 內嵌,/calendar 路由已 redirect)

| 子功能 | 用途 | 現況 | 證據 |
|---|---|---|---|
| 月曆 + 事件點標記 | react-day-picker 月檢視,有事件的日期顯示圓點 | 完整 | :559-575、eventDates :655 |
| EventCard(行內卡) | 依 noteType(calendar_event/script/note)分色;顯示時間、時長、提醒分鐘、狀態 | 完整 | :148-324 |
| 狀態循環 todo→in_progress→done | 點卡片循環切換,done 淡化 60% | 完整 | nextStatus :112-119、cycleStatus :617-623 |
| NewEventForm(新增排程) | 欄位:標題/描述/時間(預設 09:00)/全天 checkbox/時長/提醒分鐘/**地點 picker**/「同步開啟 Google 日曆」checkbox → `notes.create` | 完整;addToGoogle 走 `openGoogleCalendar()` 開新視窗預填(非 API 同步) | :326-380 |
| HTML5 拖拉排程 | 待排程筆記(無 scheduledDate 且非 done)拖到日曆格 → `notes.update` 寫 scheduledDate | 完整,含 dragCounter 防閃爍 | :566-567、handleCellDrop |
| **Tap-to-schedule 手機備援** | 觸控裝置 HTML5 拖拉失效 → 點筆記進 "armed" 狀態、再點日期直接排到該日 09:00 | 完整(程式註解自述設計動機) | :570-574、armedNoteId |
| 週摘要面板 | overdue(紅)/今日/未來 7 天/done 計數,各自排序 | 完整 | weekSummary :663-701 |
| 匯出 .ics(單次下載) | `notes.exportIcs`(includeDone:false)→ 前端組檔下載;0 筆時 toast 提示 | 完整 | :702-727 |
| 單日匯出 Google 日曆 | 把選定日全部事件逐一開 Google Calendar 預填視窗 | 完整 | render :1291 附近 |
| **PhoneSubscribePanel(ICS feed 訂閱)** | `schedule.icsFeed` 取 token URL → 顯示 https/webcal 雙格式、一鍵加入手機日曆、`rotateIcsFeed` 重設連結(舊連結失效,有 confirm) | 完整;對接 01 §4.4 說的「feed token 可輪替」 | :1487-1582 |
| 刪除確認 AlertDialog | pendingDeleteId → `notes.delete` | 完整 | :1453-1477 |
| PageAgent(光球) | pageId "calendar";capabilities:setParam(selectToday/monthOffset)、navigate(7 目的地白名單)、reset;state 曝露 month/selectedDate/事件數;**embedded 時 `enabled: !embedded` 正確停用**,usePageTour 亦以 `embedded ? null : "calendar"` 防重複 | 完整 | :556、:735-790 |

結論:CalendarPage 整體**完整**,無死碼;與 01 §4.4 判定一致並補齊細節。

### 4.2 LoraTrainer.tsx(3199 行;被 ModelsPage:12,931 以 lazy `<LoraTrainer embedded />` 內嵌)

4 分頁(train / overview / history / detail,:1140-1160):

| 子功能 | 用途 | 現況 | 證據 |
|---|---|---|---|
| 訓練類型選擇 | 10 類型(角色/人像/風格/場景/影片 LoRA/語音複製/概念/商品/時尚/姿態),每卡顯示預設引擎;**voice_clone 被 filter 排除在精靈之外**(語音克隆走 ProStudio) | 完整 | TRAINING_TYPE_ICONS :137-149、:1198 filter |
| 四步精靈 FORGE_STEPS | 資料集 → 自動標註 → 超參數 → 開始訓練 | 完整 | :112-125、:1360-2100 |
| 圖片資料集上傳 | 直傳 S3(`uploadFileToS3`)、五角度標記(正/側/背/表情/其他) | 完整 | :644-700、ANGLES :127 |
| **AI 自動補齊角度** | 只上傳 1 張 → `models.autofillAngles`(fal nano-banana/edit)補其他角度;限角色/人像類 | 完整 | :462-540、:1403 |
| 影片上傳(video_lora) | 獨立 video 上傳流 | 完整 | :702+、:1707 |
| 自動標註 | `models.captionImages`(fal 標註) | 完整 | :440-461、step captioning :1776 |
| 雙引擎超參數 | **replicate:epochs/learningRate/batchSize;fal:trainingSteps**——mutation 依引擎擇一傳 | 完整 | :811-816 |
| **同意書閘門** | modelConsents.list;來源選項 synthetic/self/real_person/copyrighted;真人/版權**未附有效同意書直接 toast 擋下**;可 revoke | 完整,對接 01 §4.2 Consent 敘述 | :791-800、:2110-2115、revokeMutation :350 |
| 提交訓練 | `models.create`(帶 consentIds、engine 分支參數) | 完整 | :424-439、:801-840 |
| 訓練進度 | `generate.jobStatus` 輪詢 + **SSE 訂閱 model-training 事件(webhookReplicate 完成即推,輪詢留作 fallback)** | 完整 | :364-421 |
| overview 分頁 | stats 5 卡(total/ready/training/failed/totalUsage)+ 四步流程圖 + 支援類型 3 欄卡(標示預設引擎) | 完整 | :2344-2465 |
| history 分頁 | 訓練紀錄卡:狀態 badge、**同步**(syncReplicateStatus)、**重訓**(retrain)、刪除、team 可見性切換 | 完整 | :2531-2805、mutations :544-590 |
| detail 分頁 | 觸發詞/modelType/usageCount/可見性、超參數 4 欄、資料集縮圖(前 10 張 +N)、predictionId、提交/完成時間+耗時、**trainedLoraUrl 下載連結**、replicateInfo(status/metrics/error)、訓練中即時區 | 完整 | :2825-3060 |
| URL query 預填 | 供動畫工作室等頁跳轉帶參數 | 完整 | :279-326 |
| PageAgent | pageId "lora-trainer"、pagePath "/models";state 曝露 tab/type/engine/datasetCount/step | ⚠️ **無 `enabled: !embedded` 閘**(對比 CalendarPage 有)——LoraTrainer 永遠以 embedded 掛在 ModelsPage 內,等於 `/models` 同時註冊 models-page 與 lora-trainer 兩個 page agent;`usePageTour("lora-trainer")` 也未依 embedded 停用,與 CalendarPage 的處理不一致 | :938-951 vs CalendarPage:556 |

結論:功能面**完整且深**(雙引擎、同意書、SSE、自動補齊都是真接線);唯一瑕疵是 embedded 模式下 PageAgent/PageTour 未關,屬一致性小債。

### 4.3 AdminPage 各 TabsContent 欄位級細節(2381 行;11 分頁)

RBAC:`isLeaderOrAdmin` 才能進(:419);**leader 只見 users/costs 兩分頁**(:188-193 強制導回),與 server 端 leaderOrAdminProcedure 對應(:431 註解)。

| Tab | 實際顯示欄位 / 操作 |
|---|---|
| **overview** | 6 張 StatCard:總使用者、總生成次數、總 API 呼叫、總成本 USD、背景任務(sub:進行中/失敗)、數位資產;+ 近 30 天使用趨勢長條(hover tooltip:date/呼叫數/使用者數/成本) (:597-690) |
| **users** | 頂部 4 卡:使用者總數/已啟用自動給點/已到期/每期排程總額;搜尋(名稱/Email/ID)+ 自動給點篩選;每列:名稱+角色 badge(admin/leader/user)、email、配額、註冊日、自動給點 badge(每 N 天 +M 點);操作:**角色下拉(admin 限定,leader disabled)**、配額數字輸入+套用、自動給點三欄(開關/每期點數/週期天數)+「儲存自動給點」(0 點啟用會擋)、「立即執行自動給點」全域按鈕;尾行顯示下次/上次發放時間與倒數 (:693-972) |
| **activity** | 每使用者:名稱+角色、最後登入、email、5 個彩色 pill(API 呼叫/生成次數/資產數/花費 USD/剩餘配額) (:975-1041) |
| **api** | 三段:①API 金鑰狀態卡(label、module—name、已設定/未設定 badge);②供應商使用統計(provider+requestType badge、呼叫數/tokens/成功率、成本、✓/✗ 計數);③最近 API 呼叫紀錄(成功 icon、provider/requestType/model、使用者、時間、tokens、耗時、錯誤訊息、estimatedCostUsd 4 位小數;SSE 自動刷新+手動刷新;「深度成本分析」連到 /admin/api-usage) (:1044-1252) |
| **costs** | 團隊總額卡三尺度(**積分 pts / USD / TWD 含匯率**)+ 請求數/tokens;每成員:名稱、佔比 %、請求/tokens、積分佔比視覺條、pts+USD+TWD (:1255-1354) |
| **generations** | 每筆:modality icon+badge、使用者、時間、prompt(2 行截斷)、點數、耗時、★已收藏 (:1357-1426) |
| **jobs** | 每筆:jobType badge、狀態色 pill(queued/processing/completed/failed/cancelled)、使用者、進度 % + progressMessage、時間、errorMessage (:1429-1499) |
| **feedback** | 每筆:標題、描述、category/priority/featureArea pill、**landmark(📍 selector)**、截圖縮圖(/api/upload/view/);操作:狀態下拉(open/in_progress/resolved/closed) (:1502-1586) |
| **brain** | lazy `<AiBrainSettings />`(獨立元件,5 大引擎維度設定) (:1589-1599) |
| **ai-research** | `AiSiteResearchPanel`(頁內定義 :1642+):brain.proposals/researchResults/monitorSummary 查詢;「全站研究」(爬網+精準度測試+程式碼掃描+錯誤分析並行)與「只跑程式碼掃描」按鈕(回報掃描檔數/findings/新提案);提案核准 → **自動建 GitHub Issue**(githubConfigStatus 檢查、測試連線、失敗可重試、未設 GITHUB_TOKEN 顯示設定指引);研究結果可一鍵 `addResearchToLearnHub` |
| **skills** | `SkillRegistryTab`(:2211+):skillRegistry.listSkills;**貼上 skill.json manifest 安裝技能**、信任等級調整(updateSkillTrust)、狀態啟停(setSkillStatus) |

### 4.4 Home.tsx 1113-1928 展示區塊

核心事實:**首頁已「Phase 2c 瘦身」成創作中樞入口,絕大多數展示區塊被 `HOME_FEATURE_FLAGS`(:99-129,寫死常數非 env)關成休眠碼**——註解明言「暫時隱藏(不刪除)」。

| 區塊(行號) | 旗標 | 現況 |
|---|---|---|
| 全頁場景漸層背景+vignette+pointer aura+AmbientVideo/Particles(:1146-1178) | 無(恆開) | ✅ 活。場景自適應(時辰調色) |
| 頂部玻璃 nav(場景切換/登入)(:1179-1244) | `showLegacyTopNav: false` | 💤 休眠(Dock 取代) |
| **Hero 區(:1246-1595)** | 恆開 | ✅ 活:JewelOrbStage 中央光球(呼吸動畫)、詩意標題 h1、**唯一 CTA「進入創作作業系統」→ /create**(`showHeroCtaButtons: true`)、CTA 下「光球已就緒」狀態 pill;hero 視差 `enableHeroScrollAnimations: false` 關閉 |
| **ContinueWhereYouLeftOff(:1599)** | 無旗標 | ✅ 活(AIDV-967):回訪「接著上次」卡,真新手不渲染、查詢失敗靜默降級、localStorage 可關 |
| OrbCreationStage 互動創作劇場(:1610-1630) | `showOrbCreationStage: false` | 💤 休眠(註解:已吸收 SITE_VALUE_HIGHLIGHTS/USE_CASES/OrbNarrativeBridge) |
| IntentOnboardingNudge(:1638,AIDV-87 I-9) | `showIntentOnboarding: false` | 💤 預設 OFF=零行為改變 |
| Intent Whisper 低語卡(:1643-1711) | `showIntentWhisper: false` | 💤 休眠(意圖標籤+信心度+心理洞察+美學 tags,信心 >0.4 才顯示) |
| IntelBentoGrid 情報站(:1713-1733) | `showIntelBento: false` | 💤 休眠 |
| ShowcaseMasonry 作品瀑布流(:1735-1765) | `showShowcaseMasonry: false` | 💤 休眠(含意圖美學 override 邏輯) |
| 底部 CTA section(:1767-1878) | `SHOW_BOTTOM_CTA = false`(:93) | 💤 休眠 |
| VisualSoulInvitation(:1880-1888) | `showVisualSoulInvitation: false` | 💤 休眠 |
| Footer(:1890-1925) | `showLegacyFooter: false` | 💤 休眠 |

含義:首頁 1928 行中**約 800+ 行是旗標關閉的休眠展示碼**(連同 :131-606 的場景樣式表/教學常數,其中 ALL_SUBPAGE_TUTORIALS 等只被休眠區用到)。這不是死碼(可一鍵回開),但是顯著的 bundle/維護負擔——sense engine + intent inference(:744-752)即使 whisper 關閉仍在跑。

---

## 5. LearnHub 種子教材抽查(server/routers/learnHub.seed.ts,12195 行)

供給機制:`learnHub.ts:50` `let docs: LearnDoc[] = [...SEED_DOCS]` —— **記憶體陣列,重啟即還原種子**;使用者新增文件不落 DB(與 01 §2 知識系統敘述相符)。共 112 個 `title:`(含少數嵌套 prompt 標題),抽 10 篇:

| # | 篇名(類別) | 教什麼 | 對得上平台嗎 | 過時判定 |
|---|---|---|---|---|
| 1 | 完整入門指南 2026-05 版(getting-started) | 「17 個功能模組」導覽,自述「fal.ai 後端 + Gemini 智能大腦」 | 部分 | ⚠️ **過時**:現況 40+ 頁/4-shell、LLM 主閘道是 OpenRouter 非 Gemini;「17 模組」與 01 路由清單對不上 |
| 2 | 環境變數設定完整指南(getting-started) | DATABASE_URL/JWT/OAuth/各 AI key 表格 | 大致 | ⚠️ 半過時:核心 5 變數對,但現況 zod schema 134 key,涵蓋度 <三成 |
| 3 | 影片工作室全模型目錄「21 個模型」(model-guide) | 每模型列 tRPC procedure、fal 模型 ID、時長/比例/超時 | ✅ 對得細(procedure 名與 fal ID 都給) | ⚠️ 數量恐漂移(01 §1.7 記 ImageStudio 23 模型;影片模型清單需與 falModels.ts 對帳) |
| 4 | tRPC API 完整端點目錄「100+ 端點」(api-docs) | 各 namespace 端點表 | 部分 | ❌ **明確過時**:開頭寫「使用 tRPC v10」,實際 **v11**;現況 60+ namespace/約 565 procedure,「100+」低估 5 倍 |
| 5 | 資料庫 Schema 完整說明「15 張資料表」(api-docs) | users 等表逐欄位說明(role enum 只列 user/admin) | 部分 | ❌ **嚴重過時**:實際 `mysqlTable` **102 張**;role 現有 leader;且種子庫內**另一篇寫「23 張表」(:6368、:7971)——種子自相矛盾** |
| 6 | LoRA 模型訓練:角色鍛造所(technique) | Replicate token 設定、圖片要求、訓練流程 | 部分 | ⚠️ 半過時:只講 Replicate 單引擎;現況 replicate/fal **雙引擎** + 同意書閘門隻字未提 |
| 7 | Google Veo 3 發布(ai-news) | Veo 3 原生音頻、與 Veo 2 對比、站內入口(veo3TextToVideo) | ✅ | ✅ 尚可(新聞類本就有時效性;站內接線指引正確) |
| 8 | 部署指南 Railway + Google Cloud(api-docs) | 從零部署步驟 | 部分 | ⚠️ 需對帳:B §4.3-4.4 的 Dockerfile builder/healthcheck 600s/MIGRATION_FAIL_CLOSED 等現況細節未必反映 |
| 9 | 積分加扣分機制完整說明(credits) | 不收真錢聲明、50 點註冊禮、首次分享 +2/+3、扣除上限 500 | ✅ **與現行 credits 體系一致** | ✅ 良好 |
| 10 | 🪐 全站光球代理人使用完全指南 | PageAgent snapshot/ACTION bus/runWorkflow/三個介面共用 GlobalOrbChatContext、問句模板 | ✅ **與現行光球架構高度一致**(且自述已注入光球 system prompt) | ✅ 良好(較新一批種子) |

品質總評:**兩個世代混居**。後段(光球指南、積分、工具登錄表、角色化學習路線等)是新寫的、與現況對齊且被注入光球提示詞;前段 2026-05 批(入門/API/Schema/LoRA)有**硬性錯誤**(tRPC v10、15 vs 23 vs 實際 102 張表、單引擎 LoRA)。因為這些文件**同時是使用者教材與光球 RAG 素材**,錯誤會被光球轉述——建議開一張「種子教材對帳」卡,優先修 #1/#4/#5/#6 四篇。

---

## 6. 缺讀聲明

- `npm audit fix` 只做 dry-run,未實際改動 lockfile;`--force` 路徑(vitest 4/drizzle 0.45)未實測建置。
- LoraTrainer :1360-2100 精靈 JSX 以區塊標題+關鍵行掃讀,未逐行(表單每個欄位的 validation 細節未列)。
- AdminPage `AiBrainSettings`(lazy 外部元件)與 AiSiteResearchPanel :1900-2200 的提案列表 JSX 細節未逐行。
- Home :131-606 的教學常數陣列內容(ORB_BOOTCAMP_PLANS 等)只讀名稱未讀逐條文案。
- learnHub.seed.ts 12195 行僅抽 10 篇 + 全部標題;其餘 100 篇未逐篇判定過時性。
- todo.md 1203 行以標題結構+首尾抽讀,未逐條核對 [x] 真實性。
- `.brain-state.json` 只讀頂層結構統計,87 筆 apiAlerts 內容未逐筆。
