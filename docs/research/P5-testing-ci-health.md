# P5 — 測試/CI 健康化方案

- 產生日期:2026-07-03
- 依據 commit:`91117649376cba67d2112f633f2ccb0199871711`
- 波次:**深度研究 wave P**
- 承接:K4(死碼/契約不符/假測試實錘)、B-infra §4(測試與 CI/CD 盤點)、G3(178 精靈工具不可達、mock 掉 executor 測不到)、G4 §2(load-tests)、00-summary §6 R10/R12/R17
- 方法:實讀 `server/eval/`(runEval.ts、agentEvalRunner.ts、cases/*.eval.ts 6 個)、`.github/workflows/pr-gate.yml`、`server/four-area-audit.test.ts` vs `server/phase3-audit.test.ts`、`server/services/agentPlanner.ts`(runSchemaFirstAgentPlanner 的 `invoke` 注入點)、`server/routes/__tests__/webhookFal.test.ts`(idempotency 段)、`docs/research/K3-data-integrity.md`(GDPR 刪除清單)、grep 確認 image/audio checkStatus 無 IDOR 收斂測試、staleJobChecker 無 refund 呼叫
- 本文件不重複列舉 K4/G3/G4 已有的死碼清單,只針對「怎麼設計測試/CI 讓這些坑不再退步」給方案

---

## 0. 一句話結論

現有測試資產量體不小(~610 vitest + 8 e2e + 6 eval + 1 k6),但**CI 目前對合併零把關**(runner 3 秒死)、**假測試不是量的問題而是判準問題**(K4 抽樣顯示整檔案級假測試只 1-2%,真正的風險是「測試寫得認真但測試對象是 mock 掉的殼」或「測的東西沒人呼叫」)、**eval 只 6 case 且每次真燒 LLM**、**k6 harness 有但完全沒接進任何流程**。五項方案的共同主軸:**先讓 CI 能動,再用「假測試判準」把現有測試分級,再把 K 波抓到的 5 類真實 bug 變成不會退步的回歸測試,最後把 eval 和 load-test 用低成本方式接進日常/nightly 節奏**。

---

## 1. 假測試問題的系統性解法

### 現況

- K4 §4 實測:全站 `expect(true).toBe(true)` 字面量只命中 3 個檔案,其中真正「整檔案級假測試」只有 `server/four-area-audit.test.ts`(225 行、30 it、33 assertion,11 個恆真 + 22 個自我循環驗證,如自己宣告 `schema = {...}` 再 `expect(schema.datasetImages).toHaveLength(1)`——驗證自己寫的字面量,從未 import 真實 router/zod schema)。
- 對照組 `server/phase3-audit.test.ts`(418 行、32 it)是真測試:`import { appRouter } from "./routers"` → `appRouter.createCaller(ctx)` 打真實 procedure、斷言 `.rejects.toThrow()`、驗證 zod enum 真拒絕非法值。**同一個「-audit.test.ts」命名慣例下,測試品質落差極大**——這是本波最重要的發現:不能靠檔名或副檔名判斷測試死活,必須看斷言是否綁定到真實符號。
- G3 揭露另一種更隱蔽的失敗模式:`tests/unit/server/planExecutorTools.test.ts` 等測試把 `executeOrbToolCalls` **整個 mock 掉**,導致 178 個精靈工具 case 永遠 tool-not-found 的斷點完全測不到——這不是「assertion 恆真」的假測試,而是「mock 邊界劃在核心邏輯內側」的假測試,危害更大因為表面上斷言看起來正常、只是永遠斷言在 mock 回傳值上。
- K4 也指出第三種模式:`multiAgentPipeline.integration.test.ts`(457 行、11 it、完整 in-memory DB)測試品質很好,但測試對象 `agentCapability` router 是零前端呼叫的死碼——「覆蓋率高」和「功能活著」是兩件事,CI 綠燈會製造錯覺。

### 目標

建立一套**可執行的三段判準**,讓「這個測試是不是假的」變成可檢查的規則而非人工肉眼判斷,並讓未來新測試很難再犯同樣的錯。

### 做法

**A. 判準(三問,任一為「是」就要標記/重寫)**

1. **斷言是否綁定真實符號?** 測試裡的 `expect()` 左手邊,追溯到底是不是從 `import` 進來的真實模組/router/schema 算出來的值?還是測試檔內自己手寫的字面量/local const?(four-area-audit.test.ts 的 22 個「非 true.toBe(true)」assertion 全部倒在後者)。
   - 可寫一支 lint/腳本規則:掃描 `*.test.ts` 內 `expect(` 呼叫,若其參數表達式的根符號(最左邊識別字)在同檔案內是 `const`/`let` 宣告而非 `import` 而來,且該宣告是物件/陣列字面量(不是從函式呼叫得到的返回值)→ 標記為「可疑自我循環」,人工複查。
2. **核心依賴是否被 mock 掉?** 對 `vi.mock(...)` 的路徑清單,檢查是否 mock 了「被測對象本身」或其直接業務邏輯依賴(而非外部 I/O 邊界如 db/S3/fal/LLM)。判準:mock 路徑若命中 `executeOrbToolCalls`、`runSchemaFirstAgentPlanner`、`appRouter` 相關的核心執行函式本體 → 標記,因為這代表「測試永遠測不到這條真實執行路徑」。
3. **測試對象是否有零呼叫?** 交叉比對 K4 §1 的孤兒 router 清單(`agentCapability`、`agentWorkflow`、`rbac`、`webhook`、`apiKey`、`auditLog`、`externalServices`、`orbCapabilities`、`orbTraces`、`system`、`videoAnalytics`、`musicSpecialist`)——若測試檔案是針對這些死碼寫的「精細測試」,應該標註「此測試保護的是未接線功能,修復優先序見 K4/R11,而非典型回歸測試」,避免誤判為健康覆蓋率。

**B. 判準優先級清單(哪些該先動)**

| 優先級 | 對象 | 動作 | 理由 |
|---|---|---|---|
| P0 | `server/four-area-audit.test.ts` | 整檔案改寫成 `phase3-audit.test.ts` 的模式(`appRouter.createCaller`)或直接刪除(若 phase3-audit.test.ts 已覆蓋同範圍則刪除去重) | 已確認 33% 恆真斷言,零保護力,且會在覆蓋率報表上製造假象 |
| P0 | `tests/unit/server/planExecutorTools.test.ts` 等 mock 掉 `executeOrbToolCalls` 的測試 | 新增一支**不 mock** 的 reachability 測試(見下方 G3 修法建議),對 178 個精靈工具 case 逐一送 `studio.xxx`/`critic.xxx` 呼叫,斷言目前的真實回傳(`tool-not-found`),這樣一旦有人修 gate,測試會變紅提醒更新預期值——這是把「已知斷裂」鎖進契約而非放任 | 目前的重度 mock 版本永遠綠燈,無法在 gate 修好或再壞掉時給出訊號 |
| P1 | `multiAgentPipeline.integration.test.ts`(agentCapability) | 加一行檔頭註解/或獨立 `describe.skip.each` 標記「測試對象為孤兒 router,見 K4 §1」,防止日後有人誤以為這是活躍核心功能的回歸網 | 降低誤判成本,低工作量 |
| P2 | 抽查 20+9=29 檔以外的其餘 ~570 檔測試 | 用上述 A 的自動掃描腳本跑一次全庫,列出「自我循環」候選清單,人工過一輪 | K4 本身承認只抽樣 29 檔,全量掃描成本可控(一支 AST/regex 腳本,非逐檔人工讀) |

**C. 防止未來再寫假測試**

1. **Lint/CI 規則(半自動,低成本)**:寫一支 `scripts/check-fake-tests.mjs`(比照現有 `check:routes`/`check:navigation` 風格),規則:
   - 禁止新增 `expect(true).toBe(true)` / `expect(false).toBe(false)` 這類恆真字面量(全站 grep 一次性列 3 檔白名單放行,新檔案 0 容忍)。
   - 對 `*-audit.test.ts`/`*-wiring.test.ts` 命名慣例的新檔案,要求至少一個 `import { appRouter }` 或等價的真實符號匯入,否則 CI 警告(非阻擋,因為機制無法 100% 準確,先當 nightly 報告用,觀察一段時間再考慮升級為擋 PR)。
   - 加進 pr-gate 前先跑一次全庫收集 baseline(現有 3 檔已知情況),新 PR 只檔「新增的違規」,不追殺歷史債。
2. **Review checklist(人工,加進 PR 模板或 `docs/plan/AIDV-dev-workflow.md` 的驗證門說明)**:新增測試 PR 時檢查三問(見上方 A),尤其提醒「mock 邊界應該畫在外部 I/O(db/S3/fal/LLM),不應該畫在被測函式本身或其直接業務邏輯」。
3. **命名慣例改一下**:建議把「稽核/接線驗證」類測試統一改名為 `*.contract.test.ts` 並要求檔頭固定範本(import 真實 router + createCaller),而 `*-audit.test.ts` 這個名字本身既有 phase3-audit(真)又有 four-area-audit(假)在用,語意已經混淆,新檔案不要再用這個命名。

### 工作量

- P0 兩項:改寫/刪除 four-area-audit.test.ts(0.5 天)+ 新增 178-tool reachability 測試(0.5-1 天,見 §2 的具體設計)。
- P1:加註解,0.5 小時。
- P2:寫掃描腳本(1 天)+ 跑一次分類(0.5 天)+ 人工複查候選清單(視數量,估 1-2 天)。
- C 的 lint 規則:0.5-1 天(腳本+接進 pr-gate)。
- **總計約 4-6 個工作天**。

### 優先級

**高**——這是「測試資產能不能被信任」的地基問題,且 four-area-audit.test.ts 這種假測試會直接汙染任何依賴覆蓋率數字做決策的流程(例如 K4 §4 已指出的「良好覆蓋率 vs 零產品使用」共存案例)。

---

## 2. eval 擴充方案

### 現況

- `server/eval/`:`runEval.ts`(14 行 CLI 入口)+ `agentEvalRunner.ts`(31 行,呼叫 `runSchemaFirstAgentPlanner` 真跑一次 LLM,對回傳的 plan 做 minSteps/maxSteps/requiredActionTypes/forbiddenActionTypes/expectedRouting/shouldBeBlocked 等斷言)+ `cases/`(6 個 `.eval.ts`:basicImageGen、delegationFromDirector、blockedUnknownTool、multimodalImageToVideo、loraTrainingRequest、multiStepWorkflow)。
- **關鍵發現**:`runSchemaFirstAgentPlanner(input)` 內部第一行是 `const llm = input.invoke ?? invokeLLM;`(`server/services/agentPlanner.ts:684`)——**planner 本身早就支援注入替代的 LLM 呼叫函式**,只是 `agentEvalRunner.ts` 目前完全沒有使用這個注入點(呼叫 `runSchemaFirstAgentPlanner({ messages: ... })` 時沒有傳 `invoke`),導致每次 `npm run eval` 都真的打一次外部 LLM API,燒真實 token。
- `AgentEvalCase` 型別(`shared/agent-eval.ts`)目前只有 `id/description/pageId/userMessage/attachments/expectedPlanProperties/tags`,**沒有 mock 回應欄位**。
- eval 不在 CI(B-infra D10 已列),且 6 個 case 只覆蓋「基本生成/委派/封鎖/多模態/LoRA/多步驟」六種粗粒度場景,完全沒有覆蓋:
  - **178 個精靈工具可達性**(G3 核心發現)——目前沒有任何 eval case 斷言「規劃出的 `critic.review` 這類工具,執行時到底 tool-not-found 還是真的執行」。
  - **planner 鐵則**(如 `agentPlanner.ts:706-753` 的 multi-step mode contract:decision.mode='multi-step' 時禁止 `mode:'direct'`、禁止 phantom-plan 回覆)——現有 6 case 沒有一個專門測這條契約邊界(何時觸發 replan、replan 兩次仍違規時是否正確 bail)。
  - **生成扣點正確性**(退款/扣點鏈,見 §4)完全不在 eval 範圍內——eval 只測 planner 輸出的 plan 結構,不測「plan 執行後點數扣得對不對」。

### 目標

把 eval 從「6 個粗粒度、每次燒真 token 的煙霧測試」擴充成「能斷言 planner 鐵則 + 工具可達性 + 扣點正確性的分層迴歸網」,且日常跑的部分不燒真 LLM token。

### 做法

**A. 先把既有的 `invoke` 注入點用起來(最低成本、立即可做)**

1. 擴充 `AgentEvalCase`(`shared/agent-eval.ts`)新增可選欄位 `mockInvoke?: (args) => Promise<...>`,或更輕量:新增 `mockPlan?: Record<string, unknown>`(直接給一份寫死的 plan JSON,eval runner 包成一個回傳固定值的 `invoke` 函式)。
2. `agentEvalRunner.ts` 改成:若 case 有 `mockPlan`/`mockInvoke`,呼叫 `runSchemaFirstAgentPlanner({ ...input, invoke: mockFn })`;否則走現有真跑 LLM 路徑。
3. 這樣可以把 eval 分成兩層:
   - **Layer 1(mock LLM,免費、跑在 pr-gate 必跑層)**:針對 `parseAndGatePlan`/mode-contract replan 迴圈/gate 邏輯本身寫 case,固定輸入「LLM 回傳違規 plan(如 decision.mode='direct' 但要求 multi-step)」→ 斷言 gate 正確拒絕、正確觸發 replan、正確在連續 2 次相同違規後 bail(對應 `agentPlanner.ts:736-745` 的 cycle-break 邏輯)。這類測試本質上更接近單元測試,但目前完全沒有針對「gate 邏輯 + replan 迴圈」這個組合的測試,適合放進 eval 目錄延續既有 `AgentEvalCase` 框架,或搬進 `server/services/agentPlanner.test.ts`(若尚無則新增)。
   - **Layer 2(真 LLM,nightly/手動)**:現有 6 case + 新增涵蓋「規劃出的動作是否可執行」的 case,見下方 B。

**B. 178-tool 可達性 → 變成 eval/整合測試 case 的計畫**

- 不需要每個都對應一個 eval case(那要燒太多 token);正確分工:
  - **eval 層**只需 1-2 個 case,斷言「當使用者要求 critic/accountant/orchestrator 這類精靈工具時,planner 規劃出的 `toolName` 是否在 `isKnownGlobalAgentTool` 白名單內」(這是 planner 輸出正確性,可用真 LLM 跑,量少)。
  - **真正的可達性斷點**應該是一支**不燒 LLM 的整合測試**(不屬於 eval,屬於 vitest):直接呼叫 `executeOrbToolCalls`(不 mock)、對 178 個 `<spirit>.<tool>` case 逐一送呼叫,斷言目前真實行為(`tool-not-found` 或 `confirmation-required`)。這支測試的價值是「鎖住現狀」——一旦有人修 gate(改成 `isKnownGlobalAgentTool(call.name)` 白名單路由,G3 已給出修法),這支測試會變紅,逼著更新預期值,形成一個「修復 178-tool gate」有沒有做對的驗收訊號。這支測試建議獨立命名如 `server/services/__tests__/agentToolExecutor.reachability.test.ts`,且**明確不 mock** `executeOrbToolCalls` 本身(可以 mock 更外層的 db/fal,但不能 mock 被測函式)。

**C. 生成扣點正確性 → eval/整合測試 case**

- 扣點正確性不適合放進「plan 結構斷言」的 eval 框架(那層只管 planner 輸出對不對),應該是**獨立的 vitest 整合測試**,用 `appRouter.createCaller` 模式(比照 phase3-audit.test.ts):
  - Case 1:生成成功 → 扣點一次、金額正確。
  - Case 2:生成失敗(fal 回 hard error)→ 觸發退款鏈,`refundUserPoints` 被呼叫且金額與原扣點一致(claim-then-refund 原子性)。
  - Case 3(對應 R12/K2 已發現的 bug):`staleJobChecker` 把任務標 failed 時,**目前完全不呼叫退款**(grep 確認 `server/jobs/staleJobChecker.ts` 全文 0 個 `refund` 字元)——這條路徑應補一個目前會失敗的測試(紅燈),作為「這個 bug 修好之前不能被誤判為已修」的契約鎖,詳見 §4。

**D. 降低 eval 燒 token 的具體做法**

1. 上述 A 的 `invoke` 注入是核心手段——**日常/pr-gate 必跑的 eval case 一律用 mock LLM**,只有明確標 `tags: ["llm-smoke"]` 的少量 case(建議保留現有 6 個)才走真 LLM,且只在 nightly 跑。
2. 真 LLM 的 6 個 case 若要跑,選用最小 `maxTokens`(現有預設 2500,可視情況調降)+ 固定用便宜模型(非 flagship)做 smoke,只有真正要驗證「模型行為變化」時才用正式模型跑一次。
3. `runEval.ts` 加一個 `--mock` flag,CI 必跑層用 `npm run eval -- --mock`(只跑 Layer 1),`npm run eval:llm`(新增 script)才跑真 LLM 層,供 nightly 使用。

### 工作量

- A(注入點+型別擴充):0.5-1 天。
- B(178-tool reachability 測試):0.5-1 天(178 個 case 可用迴圈生成,不用手寫 178 次)。
- C(扣點 eval/整合測試,3 case):1 天(含補 staleJobChecker 紅燈測試)。
- D(CLI flag + script 分層):0.5 天。
- **總計約 3-4 個工作天**。

### 優先級

**高**——`invoke` 注入點已經存在、零架構改動即可用,是這五項方案裡「投入產出比最高」的一項;178-tool 可達性測試直接對應 R10(00-summary 標為第一波優先修復項)的驗收訊號。

---

## 3. CI 強化

### 現況

- 唯一 workflow `pr-gate.yml`(AIDV-56):`tsc --noEmit` → `check:routes` → `check:navigation` → `vitest run`(全量,~610 檔一次跑完)。ubuntu-latest、Node 20、20 分鐘 timeout、`permissions: contents: read`。
- **CI 剛從「runner 3 秒即死」恢復**(B-infra D5 記錄的 runner 層問題,非程式問題;四關本機可全綠)——這代表在此之前合併完全零自動把關,人工把關是唯一防線。
- 缺席項(B-infra §4.2 明列):e2e、eval、build 驗證、`check:smoke`、secret scanning、依賴稽核皆未進 CI。
- 現有可用但未接線的低成本補強:`npm run eval`(6 case,若走 mock 層則免費)、`npm run check:smoke`(scripts/smoke-routes.mjs,已存在)、`npm audit --audit-level=high`(G4 已列出 2 critical/9 high,建議加進 CI 防止清單過期)。

### 目標

在「CI 剛復活、還很脆弱」的狀態下,優先把**便宜且已存在**的檢查接回必跑層,把**慢/燒錢/需額外基礎設施**的檢查(e2e、真 LLM eval、k6 load test、深度 security scan)放進 nightly,避免 PR gate 從 20 分鐘再度膨脹到讓人想跳過。

### 做法(分層設計)

**Tier 0 — 必跑層(pr-gate.yml,目標維持在 10-15 分鐘內)**

現有四關 + 新增:
1. `npm run eval -- --mock`(§2 D 的 mock 層,免費、快)——驗證 planner 鐵則/gate 邏輯沒有退步。
2. `npm run check:smoke`(scripts/smoke-routes.mjs)——已存在、便宜,B-infra 建議清單裡的「順手」項。
3. `npm audit --audit-level=high`(非 force,只檢查、不自動改動 package.json)——防止 G4 抓到的 2 critical/9 high 清單下個月過期不被發現;**用 `continue-on-error: true` 先當警告層**(避免立刻擋住所有 PR,因為 drizzle-orm/vitest/langsmith 三顆需人工大版決策、短期修不完),觀察 1-2 週後視情況升級為擋 PR。

**Tier 1 — nightly/cron workflow(新增 `.github/workflows/nightly.yml`,不卡 PR 合併速度)**

1. `npm run eval`(不加 --mock,真 LLM 全 6 case)——捕捉「模型行為隨供應商更新而變化」這類 PR 層測不到的漂移。
2. Playwright e2e(tests/e2e/ 8 個 spec)——需要先起 dev server(`npm run dev` 背景 + 等 health check 綠燈),這是目前完全人工的部分,nightly 化可以至少做到「每天知道有沒有壞」。
3. `server/services/__tests__/agentToolExecutor.reachability.test.ts`(§2 B 新增的 178-tool 測試)雖然不燒 LLM、跑起來快,但可以放 nightly 也可以直接進必跑層——因為它本質是純函式呼叫,建議**直接放進必跑層**(不需要等 nightly),與 Tier 0 的 vitest run 一起跑。
4. `npm audit`(完整,含 low/moderate)——每日追蹤依賴健康度全貌,必跑層只看 high 以上。
5. secret scanning——`gh` CLI 有 `mcp__github__run_secret_scanning` 這類工具可用,或用 `trufflehog`/`gitleaks` 開源掃描器跑一次 diff-since-last-run,建議先跑在 nightly,觀察誤報率後再考慮要不要擋 PR。

**Tier 2 — 手動/週期性(不進任何自動 workflow,排程 cron trigger 或人工觸發)**

1. k6 load test(見 §5)——需要目標環境(staging/Railway),不適合每次 PR 跑,建議接一支獨立的 `mcp__Claude_Code_Remote__create_trigger` 週期任務或每週一次的 GitHub Actions `workflow_dispatch`。
2. 深度安全掃描(如 `/security-review` skill 對整個 diff 做語意層審查,而非規則式 secret scan)——PR 描述變更大時才手動觸發,不必每次都跑。

### 工作量

- Tier 0 三項新增:0.5-1 天(eval mock 依賴 §2 A 先做完;check:smoke/audit 是接線,各 0.5 小時)。
- Tier 1 nightly workflow 檔案 + e2e 背景起服務腳本:1-1.5 天(e2e 需要處理 dev server 啟動/健康檢查等待邏輯,是最花時間的部分)。
- Tier 2:視要不要現在接 k6(見 §5)決定,先不計入此項工作量。
- **總計約 2.5-3.5 個工作天**(不含 §5 k6)。

### 優先級

**高**(Tier 0 部分)——CI 剛復活是脆弱窗口,便宜檢查應該趁現在補上;**中**(Tier 1 nightly)——建置一次即可長期受益,但不影響「PR 能不能合併」的立即安全性;**低**(Tier 2)——非阻塞性,可以晚一點做。

---

## 4. 關鍵路徑測試補強(K 波發現的坑 → 對應回歸測試)

K 波(K1-K4)發現的問題,凡屬「已確認的真實 bug」,都應該補一支**目前會失敗(紅燈)**或**目前通過但鎖住正確行為(綠燈防退步)**的測試,確保修完之後不再退步。以下按 K 波原始編號對應:

| 坑 | 現況(K波證據) | 目標測試 | 現況紅/綠 |
|---|---|---|---|
| **扣點退款**(R12,K2) | `staleJobChecker.ts` 把任務標 failed,**全文 0 個 `refund` 呼叫**(grep 確認);proStudio 註解誤以為會退款 | 新增 `server/jobs/staleJobChecker.refund.test.ts`:模擬一個 processing>5min 的 job → 斷言 `refundUserPoints`(或等價退款函式)被呼叫、且金額等於原扣點 | **紅燈**(bug 未修,測試應先失敗,標記為「已知失敗,待 R12 修復」,不可跳過或用 `.skip` 隱藏,建議用 `it.fails()` 或加 `// TODO(R12)` 註解明確標註意圖) |
| **webhook 回呼冪等**(AIDV-158,B-infra 已有部分覆蓋) | `server/routes/__tests__/webhookFal.test.ts` 已有「重送已完成 job:短路,不重跑 post-gen/不覆寫/不退款」測試(:502-524,經讀取確認存在且完整);`webhookSuno.test.ts` 也存在但未逐行核對是否有同等冪等覆蓋 | 補查 `webhookSuno.test.ts` 是否有等價的「重送終態 job」case;若無則比照 fal 版本補一支;另外 Stripe webhook 若已接線也應有同等測試(B-infra D13 指出 Stripe handler 全 TODO,暫不適用) | fal 已綠燈;Suno 待確認(未在本次讀取範圍內逐行核對,列入未查證) |
| **owner 檢查**(R6,K2) | `imageStudio.ts:1419` 的 `checkImageStatus`、以及 proStudio 的 `checkAudioStatus`,**grep 確認全站沒有 `imageIdor`/`audioIdor` 這類 IDOR 收斂測試**(對照 `videoIdorConvergence.test.ts`、`promptLibraryIdor.test.ts`、`history-ownership-idor.test.ts`、`download-ownership-idor.test.ts` 都存在對應測試,唯獨 image/audio 這兩個 checkStatus 端點沒有) | 新增 `server/routers/__tests__/imageAudioStatusIdor.test.ts`,比照 `videoIdorConvergence.test.ts` 的模式:User A 建立 job(拿到 requestId)→ User B 用同一 requestId 呼叫 `checkImageStatus`/`checkAudioStatus` → 斷言應該 403/找不到,而非洩漏 User A 的生成結果 | **紅燈**(bug 未修——目前 videoStudio 有 owner 檢查但 image/audio 沒有,這支新測試會先失敗,證實 R6) |
| **GDPR 刪帳**(R3,K3) | `USER_OWNED_TABLES`(schema.ts:5297)頭注解宣稱「涵蓋每張有 userId 的表」,但**沒有任何自動化機制驗證這個宣稱與 schema.ts 實際欄位同步**(K3 §1.3 明確指出「對比 migration journal 有 orphan-migrations-journal.test.ts 守門,GDPR 刪除清單完全沒有對應測試」);已確認至少 10 張漏表(consistency_vault、orb_conversation_messages、studio_versions、timeline_frames、scene_compositions 等) | 新增 `server/gdpr-delete-coverage.test.ts`,**比照 `orphan-migrations-journal.test.ts` 的模式**:程式化解析 `schema.ts` 找出所有含 `userId`/`user_id` 欄位的表名,與 `USER_OWNED_TABLES` 陣列做差集比對,斷言差集為空;這支測試同時也是「防止未來新表忘記加進刪除清單」的持續性守門(不只是修一次 K3 的 10 張漏表,而是永久鎖住這類欄位) | **紅燈**(先暴露當前 10 張漏表,修完清單後轉綠,且未來加新表若忘記登記會再變紅) |

### 額外設計要點

- 這四類測試的共同模式是**用「程式化比對」取代「人工宣稱」**——GDPR 清單、owner 檢查、退款鏈都曾經是「文件/註解說有做,但沒有自動化驗證」,新測試應盡量做成像 `orphan-migrations-journal.test.ts` 那樣的**結構性斷言**(解析 schema/程式碼結構,而非針對單一情境的範例斷言),這樣才能防住「未來又漏一張新表」而不只是「補上這次發現的 10 張」。
- 已修復的 bug 對應測試應標記清楚是「回歸測試」(綠燈防退步),尚未修復的應明確標記「已知失敗、對應 R 編號」,不要用 `.skip`/`.todo` 隱藏——`.skip` 會讓 CI 看起來全綠但實際上少測了這條路徑,應該讓它保持紅燈直到真正修復,這樣 CI 報告本身就是「還有 N 個已知 bug 待修」的即時儀表板。

### 工作量

- staleJobChecker 退款測試:0.5 天。
- Suno webhook 冪等性核對+補測試(若需要):0.5 天。
- image/audio owner 檢查測試:0.5-1 天(需先確認 checkAudioStatus 所在檔案與 imageStudio 的結構是否一致)。
- GDPR 刪除清單結構性測試:1 天(解析 schema.ts 找 userId 欄位需要一點 AST/regex 工作,比照 migration journal 測試的實作方式)。
- **總計約 2.5-3 個工作天**。

### 優先級

**最高**——這四項全部對應 00-summary §6 標記為 🔴 CONFIRMED 的安全/合規/資產竊取/金流問題(R3/R6/R12 屬於第 0/1 波緊急修復項),測試補強應該與 bug 修復**同一個 PR**一起做(先加紅燈測試證實問題,修復後測試轉綠),而不是分開排期。

---

## 5. load-tests 接上

### 現況

- `load-tests/video-pipeline.js`(358 行,AIDV-711)是唯一一支 k6 harness,對 `/api/trpc/videoProject.create` 打壓力,涵蓋 4 個情境(S1 baseline、S2 concurrent ramping、S3 registry stress 邊界 payload、S4 sse_fanout **明標 BLOCKED** 因 Supabase Realtime AIDV-341/370 未復原)。
- 語法完整、參數化乾淨(門檻:`pipeline_stalls count<1`、error rate<10%、create p95<5s、429 視為限流正常運作)。
- **缺口三個**:①`package.json`/`scripts/` 無對應 npm script 入口;②k6 是外部 binary(非 npm 依賴),repo 沒有安裝/版本文件;③`load-tests/results/` 目錄不存在,檔尾註解要求存進 Supabase `pipeline_latency_baselines` 表但從未落地,**沒有基線可比對**。

### 目標

讓 k6 harness 從「寫好但沒人知道怎麼跑」變成「一個命令能跑、有結果可比對前後次退化」的日常工具,同時不強求解決 S4 的 Realtime 阻塞(那是另一張獨立的卡)。

### 做法

1. **補 npm script 入口**:`package.json` 加 `"loadtest:video": "k6 run load-tests/video-pipeline.js"`(若 k6 未裝則報清楚的錯誤訊息,不要靜默失敗)。同時在 README 或 `docs/guides/` 補一段「本機/CI 安裝 k6」的簡短說明(`brew install k6` / apt 套件 / docker image 三選一)。
2. **建立基線落地機制**:
   - 先做最小可行版本:k6 跑完後用 `--summary-export=load-tests/results/latest.json` 把摘要寫成本機 JSON(k6 原生支援,不需要額外程式碼),`load-tests/results/` 目錄補 `.gitkeep` 或直接 commit 第一份基線 JSON 進 repo 當作「已知基準」。
   - 進階版本(對應檔尾註解的原始設計意圖):寫一支小腳本把 k6 JSON 摘要轉存進 Supabase `pipeline_latency_baselines` 表,之後每次跑都能查歷史趨勢——這塊工作量較大,建議先做本機 JSON 版本,Supabase 落地留待有真正需要跨環境比較時再做。
3. **接進流程(Tier 2,手動/週期性,呼應 §3)**:
   - 不進 pr-gate 必跑層(需要目標伺服器啟動、跑幾十秒到幾分鐘,不適合每個 PR)。
   - 建議用 `mcp__Claude_Code_Remote__create_trigger` 設一個**每週一次**的排程(例如週一早上),對 staging/Railway 環境跑 `npm run loadtest:video`,結果貼回 Jira/Slack 或寫進 `load-tests/results/` 歷史記錄,供人工比對趨勢(p95 是否逐週變差)。
   - S4(sse_fanout)維持標記 BLOCKED,待 AIDV-341/370 的 Supabase Realtime 問題解決後再解鎖,不影響 S1-S3 先行接上。
4. **CI 層可選的輕量版**:若想在 PR 層有一點負載訊號但不想跑完整 k6,可以只跑 S1 baseline(1 VU × 5 次)當作「基本可用性」煙霧測試,設定較短 timeout,失敗才擋 PR;完整的 S2/S3 並發壓力測試留在週期性任務。

### 工作量

- npm script + 安裝文件:0.5 天。
- 本機 JSON 基線落地:0.5 天。
- 週期性 trigger 接線:0.5 天。
- Supabase 落地(進階):1-2 天(視是否要做而定,非必要)。
- **總計約 1.5 個工作天(不含進階 Supabase 落地)**。

### 優先級

**中**——k6 harness 本身寫得完整,接上的邊際成本很低(npm script + trigger 兩步就能從「沒人用」變成「每週有訊號」),但相較於 §1-4 的安全/資料完整性問題,load test 屬於效能面向,不阻塞任何合規/資安修復,可以稍後排期。

---

## 6. 未查證部分

- `webhookSuno.test.ts` 是否有與 `webhookFal.test.ts`(:502-524)等價的「重送終態 job」冪等性斷言——本次只確認兩檔都存在且都涉及 idempotency 關鍵字,未逐行核對 Suno 版本的斷言深度。
- `checkAudioStatus` 具體檔案位置與行號——本次只確認 grep 命中 `imageStudio.ts`/`proStudio.ts`,未逐一讀取 proStudio.ts 內 `checkAudioStatus` 的完整實作以確認 owner 檢查缺失的精確範圍(是否部分情境已有檢查、部分沒有)。
- K4 §4.2 的「假測試估計」本身就基於 29 檔抽樣(20 重度 mock + 9 audit/wiring 命名慣例),本文件 §1 的判準清單建立在這個抽樣結論上,若全量掃描(602 檔逐一)結果與抽樣差異較大,§1 的優先級清單需要重新評估。
- eval 的 `mockInvoke`/`mockPlan` 擴充方案(§2 A)只驗證了 `runSchemaFirstAgentPlanner` 確實有 `input.invoke ?? invokeLLM` 這個注入點(`agentPlanner.ts:684`),但未實際寫程式驗證改動後 `agentEvalRunner.ts` 傳入 mock 函式能正確跑通全流程(包括 mode-contract replan 迴圈是否也會呼叫到同一個注入的 `invoke`,經讀取 :756 確認 replan 確實也用同一個 `llm` 變數,理論上可行,但未實際執行驗證)。
- CI Tier 0 加入 `npm run eval -- --mock` 需要先完成 §2 A 的程式改動(`--mock` flag 目前不存在,`runEval.ts` 目前只支援 `--tags`),本文件是設計提案,尚未實作。
- k6 npm script 的實際可執行性(本環境是否已裝 k6 binary)未實測。
