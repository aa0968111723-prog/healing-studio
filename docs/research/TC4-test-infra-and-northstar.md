# TC4 — 測試基建 + 北極星流程測試

- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:vitest/jest 設定、CI 測試 gate、e2e/整合測試、北極星一條龍流程有無端到端測試

方法:實讀 `vitest.config.ts`、`playwright.config.ts`、`.github/workflows/pr-gate.yml`、`tests/e2e/*.spec.ts`(8 檔全讀 describe 結構)、北極星相關實測檔(`server/__tests__/worldbuilding-animation.test.ts`、`server/routers/__tests__/worldStoryboardQueue.test.ts`、`server/services/__tests__/orbAssetPipeline.test.ts`、`server/services/__tests__/videoOutputSpec.test.ts`、`server/services/__tests__/videoCatalogConsistency.test.ts`、`server/routers/__tests__/videoStudioOutputSpec.router.test.ts`、`server/audio-compiler.test.ts`)、`server/agent-tool-executor.test.ts` 全文、`server/services/__tests__/agentToolExecutor.test.ts`、`server/studio-tool-bridge.test.ts`、`server/orb-train-lora-tool.test.ts`、`server/__tests__/director/orb-tool.test.ts`、`server/services/agentToolExecutor.ts`(dispatchStudioTool/dispatchTrainingTool/dispatchDirectorTool 的 requiresHuman 閘門)、`docs/research/M1-project-spine-assembly.md`(北極星缺口地圖)、`docs/research/P5-testing-ci-health.md`(既有 CI/假測試方案,本文不重複其內容,只補「北極星端到端」與「盤點表」)。

---

## 0. 一句話結論

測試框架與 CI gate 本身是健康的(vitest 全量把關、~950 個測試檔涵蓋 client/server/shared/tests-unit,四關 PR gate 目前確實會擋 PR),但**e2e/整合測試只做到「單一創作室分頁的 UI 渲染 + AgentAction 契約」層級,完全沒有一支測試走過北極星定義的「腳本→分鏡→逐幕→拼接→輸出→打包」一條龍**——這不只是「測試沒寫」,而是**該一條龍本身在 prod 尚未做到端到端可執行**(M1 已確認:分鏡管線可規劃不可執行、拼接是前端 JSZip 非真實媒體合成),所以「沒有端到端測試」與「沒有端到端功能可測」是同一個缺口的兩面。此外原先「agent-tool-executor.test.ts 未蓋 requireConfirmation」的說法,經逐行核對後需要修正——**該檔本身確實蓋了 requireConfirmation(外部自訂 API 工具路徑),但精靈工具(studio.\*/training.\*/director.\*)走的是另一組 `def.requiresHuman` 閘門,分散在不同檔案測,呈現不均勻覆蓋**(見 §3)。

---

## 1. 測試框架與設定盤點

| 項目 | 現況 | 證據 |
|---|---|---|
| 單元/整合測試框架 | Vitest,單一 `vitest.config.ts`,無 jest(repo 內僅 `node_modules/*/jest.config.*` 屬第三方套件自帶,非本專案設定) | `/home/user/healing-studio/vitest.config.ts:1-46` |
| 測試環境 | 預設 `environment: "node"`;個別檔案用 `// @vitest-environment jsdom` 覆寫(給需要 DOM 的 React 測試,如 `tests/unit/client/`) | `vitest.config.ts:19-23` 註解 |
| 掃描範圍(include globs) | `client/src/**/*.test.{ts,tsx}`、`server/**/*.test.ts`、`shared/**/*.test.{ts,tsx}`、`tests/unit/**/*.test.{ts,tsx}`(含 .spec 變體) | `vitest.config.ts:28-43` |
| 實際測試檔案量 | Glob 統計 `*.test.ts` 命中 950 個路徑(含 node_modules 第三方,扣除後專案內約 850+);`*.test.tsx` 111 個(部分列表);`__tests__/` 目錄下再 478 個(含重疊) | Glob 統計,見稽核過程 |
| e2e 框架 | Playwright,`playwright.config.ts`,`testDir: "./tests/e2e"`,8 個 spec 檔 | `/home/user/healing-studio/playwright.config.ts:1-36` |
| e2e 執行前提 | 需先 `npm run dev` 起本機伺服器(`BASE_URL` 預設 `http://localhost:5173`);多數瀏覽器軸測試在 dev server 未啟動或頁面被 LoginScreen 擋下時**主動 `test.skip`**,不算失敗 | `playwright.config.ts:11-17` 註解;`tests/e2e/video-studio-generation-flow.spec.ts:277-306` |
| eval 框架 | `server/eval/`(`runEval.ts` + `agentEvalRunner.ts` + `cases/` 6 個 `.eval.ts`:basicImageGen、delegationFromDirector、blockedUnknownTool、multimodalImageToVideo、loraTrainingRequest、multiStepWorkflow) | `ls server/eval/cases/` 確認 6 檔仍在,與 P5 記錄一致 |
| load test | `load-tests/video-pipeline.js`(k6),**無 npm script 入口、無 nightly workflow、`load-tests/results/` 不存在** | `find` 確認 `.github/workflows/` 下僅 `pr-gate.yml` 一檔,無 nightly |

---

## 2. CI 測試 gate 現況(對照 P5)

`.github/workflows/pr-gate.yml`(唯一 workflow,AIDV-56)四關全部**會擋 PR 合併**:

1. `npx tsc --noEmit`
2. `npm run check:routes`
3. `npm run check:navigation`
4. `npx vitest run`(**全量**,~950 檔一次跑完,非部分白名單)

確認 **未在 CI 跑的項目**(逐項 grep `pr-gate.yml` 全文確認未出現):
- `npm run test:e2e`(Playwright 8 spec)——**完全不進 CI**,只能本機手動起 dev server 後跑,或未來需另建 workflow。
- `npm run eval`——不進 CI。
- `npm run check:smoke`——不進 CI。
- `npm audit`——不進 CI。
- 無 nightly/cron workflow(`.github/workflows/` 目錄下只有 `pr-gate.yml` 一個檔案)。

此現況與 `P5-testing-ci-health.md` §3(CI 強化方案)的描述一致——本文件不重複其分層設計方案(Tier 0/1/2),只確認**截至本次稽核,該方案尚未落地**(§2 提到的 `--mock` flag、`agentToolExecutor.reachability.test.ts`、`.github/workflows/nightly.yml` 均**未在 repo 中找到**,`find -iname "*reachability*"` 與 `find -iname "*nightly*"` 均無結果)。

---

## 3. 已知並發/回歸測試核實(修正版)

| 標的 | 說法 | 核實結果 |
|---|---|---|
| deduct/refund/atomicClaimJobRefund 並發回歸測試(W5) | 已知有測試 | 確認存在:`grep atomicClaimJobRefund` 命中 `server/services/__tests__/postGenActions.test.ts`、`server/services/postGenActions.refund.test.ts`、`server/services/refundStatus.test.ts` 等多檔,與實作檔(`postGenActions.ts`/`refundStatus.ts`/`db.ts`/`generate.ts`/`proStudio.ts`/`director.ts`)並存,判定 **tested**(本次未逐行覆核並發情境細節,深度覆核見 W5 原文件) |
| videoCatalogConsistency.test.ts(影片類) | 已知有測試 | 確認存在,138 行,兩個 describe:`video catalog SSOT consistency`、`videoStudio router fal-ai literals SSOT lint`——這是**結構性 SSOT 比對測試**(防止 catalog 常數與 router 內字面量漂移),不是生成流程功能測試,判定 **tested(但侷限於 SSOT 一致性,非功能正確性)** |
| agent-tool-executor.test.ts 的 fallback 覆蓋 | 已知有測試 | 確認:`falls back to secondary tool when primary fails`(:144)存在,判定 **tested** |
| agent-tool-executor.test.ts 未蓋 requireConfirmation | 已知未蓋 | **需修正**——該檔本身在 :32 有 `requires confirmation for destructive tools` 測試,斷言 `approved:false` → `error:"confirmation-required"`。但逐行追進 `server/services/agentToolExecutor.ts` 後發現:**這是兩套獨立的閘門**——(a) 外部自訂 API 工具走 `tool.requireConfirmation`(:807,`ORB_TOOL_REGISTRY_JSON` 註冊的工具,此檔測的是這條);(b) 178 個內建精靈/工作室工具(`studio.*`/`training.*`/`director.*`)各自的 dispatcher(`dispatchStudioTool`:1001、`dispatchTrainingTool`:7554、`dispatchDirectorTool`:7785)走 `def.requiresHuman` 閘門,是**另一組獨立程式碼路徑**。(b) 的覆蓋分散在別的檔案:`studio-tool-bridge.test.ts:92`(`returns confirmation-required when approved=false on studio.generateImage`,tested)、`orb-train-lora-tool.test.ts:152`(`requires approval for the high-risk training tool`,tested)。**director.\* 目前註冊的工具似乎都是 `requiresHuman:false`**(`server/__tests__/director/orb-tool.test.ts:14` 只證實 `does NOT require human approval`),**未找到任何測試對 `dispatchDirectorTool` 的 `requiresHuman:true` 分支(:7785-7791)送出正例斷言**——若未來新增高風險 director 工具,這條閘門目前無測試覆蓋,**需再查**是否曾有 director 工具設為 requiresHuman:true 卻無人測試 |

---

## 4. 北極星一條龍(腳本→分鏡→逐幕→拼接→輸出→打包)測試覆蓋盤點

北極星定義(引自 `M0-solution-blueprint.md`/`M1-project-spine-assembly.md`,Bruce 七支柱第④條):**「單一專案:腳本→分鏡→逐幕(字卡+圖影+聲音)→拼接→輸出→打包」**,北極星指標是「這條鏈走完的比例」。

**前提發現(比測試覆蓋更根本)**:`M1-project-spine-assembly.md` §0「六缺口」已確認這條鏈在 prod **本身就沒有端到端可執行**——

- 分鏡管線「可規劃不可執行」(`planPipeline` 工具名對不上真實 procedure,frames 永遠卡在 `queued`)(M1 缺口②)
- 座艙 `kind=video` 丟 `AdapterPendingError`(缺口③)
- 拼接「=前端 JSZip 無真影片 compose」,`videoCompiler`/`audioCompiler` 是**提示詞編譯器不是媒體合成器**(缺口⑤,本次讀 `server/audio-compiler.test.ts` 536 行完整驗證此描述:全部測試都在測 prompt tag 堆疊/衝突解決/合成純文字,不涉及任何音檔/視訊檔案輸出)

因此下表按鏈上各階段列出**現有測試涵蓋的是「哪一層」**(規劃函式 / 資料寫入 / 端到端執行),而非簡單的 tested/untested 二分:

| 鏈上階段 | 對應程式碼 | 現有測試 | 覆蓋層級 | untested 部分的回歸風險 |
|---|---|---|---|---|
| ① 腳本→分鏡骨架生成 | `worldbuildingGeneration.ts`(`generateStoryboard` 只建 DB 骨架,不做 AI);`seedStoryboardSkeleton`/`buildFramePrompt`(animation.ts 純函式) | `server/__tests__/worldbuilding-animation.test.ts`(1503 行,超過 40 個 it,涵盖 seedStoryboardSkeleton 均分場景/fps 繼承/角色台詞注入/敘事節拍映射,buildFramePrompt 角色群組/風格檔/姿勢注入等) | **partial** — 純函式邏輯覆蓋非常紮實(規劃/映射邏輯正確性),但這些函式產出的是「規劃結果」,不驗證規劃結果送進真實執行器後是否真的產生對應的 frame/audioClip 資料列 | 若把「規劃邏輯正確」誤判為「分鏡功能正確」,修 planPipeline 執行面時容易漏掉「規劃→執行銜接處」的回歸(M1 缺口②已指出這正是斷裂點) |
| ② 分鏡佇列化/工作排程 | `worldStoryboard.ts`(`queueForVideo`、`updateJob`) | `server/routers/__tests__/worldStoryboardQueue.test.ts`(293 行):`queueForVideo` 建立 `jobsJson` 狀態為 `queued`、CO-STAR 提示詞帶入、sceneId 對應、`worldId` 不存在→NOT_FOUND;`updateJob` 原子更新(防並發 lost-update,AIDV-636) | **partial** — db 層 mock(`createWorldStoryboardMock`/`getWorldbuildingFrameworkMock` 均為 vi.fn),只驗證「排入佇列」與「狀態欄位原子寫入」,**不驗證佇列後續是否真的被任何 worker/runner 消費執行**(即 job 從 `queued`→`generating`→`done` 的實際推進,M1 §B2 明確指出這條目前卡在 0) | 若有人以為「queueForVideo 測試綠燈」代表「排隊到出片這段都測了」,修改執行 runner(若日後補上)容易漏掉銜接處回歸;此外「queued 之後沒人消費」本身是功能缺口而非單純測試缺口 |
| ③ 逐幕素材生成(圖/影/音/字卡) | `dispatchStudioTool`(`studio.generateImage`/`generateVideo`/`generateAudio`/`generateVoice`) | `server/studio-tool-bridge.test.ts`(確認 requiresHuman 閘門、fal 派工、額度守門、extended args 傳遞、審計事件);`orbAssetPipeline.test.ts`(294-325 行:`buildShortVideoWorkflow` 產出的 step 依賴關係與 `${step.field}` 參照字串正確,**但這是驗證 workflow 定義的靜態形狀,不是實際跑一次生成鏈**) | **partial(單步驟有測,跨步驟串接未見端到端)** — 每個 `studio.*` 呼叫的閘門/派工/額度都有各自單元測試,但沒有一支測試把 `buildShortVideoWorkflow` 的多步驟 workflow 真的丟進 `executeOrbToolCalls` 跑一輪(哪怕 mock 掉 fal API,也要走過 `resolveStepRefsInArgs` 的跨步驟參照解析 + 依序執行) | 若修改 workflow runner 的跨步驟依賴解析邏輯(而非單一步驟本身),現有測試矩陣不會發現退步——這正是 G3/P5 標記的「reachability 測試」建議尚未落地的具體體現 |
| ④ 拼接(compose) | 前端 JSZip(M1 缺口⑤明確標註「無真影片 compose」);`audio-compiler.ts`/`compiler-schema-validation.test.ts` 是提示詞編譯器 | `server/audio-compiler.test.ts`(536 行,10 個 describe:Tag Stacking/Timeline Structure/Style Conflict/Prompt Assembly/compileQuick/Compilation Log 等);`server/compiler-schema-validation.test.ts`(237 行,schema 驗證) | **untested(功能本身不存在,故無「端到端拼接」可測)** — 現有測試只覆蓋「提示詞編譯」這個完全不同的子系統,與「多幕媒體檔案拼接成一支影片」這件事**沒有任何交集** | 一旦真的實作媒體拼接(補齊 M1 缺口⑤),必須從零開始寫測試,不能沿用 audio-compiler 現有測試改名充數——這是本次稽核最大的「零覆蓋」子系統 |
| ⑤ 輸出(output) | `videoProjects` 輸出快取欄位(`outputStoragePath`/`outputSignedUrl`/`outputExpiresAt`,AIDV-684);`mapOutputSpecToFalParams`(單模型輸出參數映射) | `server/services/__tests__/videoOutputSpec.test.ts`(235 行:no-op/codec/Wan 版本差異/Veo3/笛卡兒積 27 組合/靜默調整回報/4K 付費守門);`server/routers/__tests__/videoStudioOutputSpec.router.test.ts`(216 行:HARD SAFETY payload 零變化/resolution 不覆蓋/4K 守門) | **tested(單模型參數映射層),untested(專案級輸出產物)** — 這兩檔測的是「使用者選的輸出規格 → 傳給單一 fal 模型的參數」是否映射正確,是純函式契約測試,**不涉及「一個專案的多幕素材彙整成一份輸出檔案」這件事**(因為④拼接尚未存在,輸出自然也無法端到端) | 若未來把「輸出」重新定義為「專案級最終產物」(而不是單模型呼叫參數),現有測試矩陣完全不會發現這個語意落差 |
| ⑥ 打包(package) | 前端 JSZip(同④,M1 缺口⑤同段落) | 未找到任何 `*.test.ts`/`*.test.tsx` 針對「打包/匯出 zip」邏輯(搜尋 `JSZip`/`打包`/`package.*export` 關鍵字於 `*.test.*` 無命中) | **untested** | 打包邏輯目前疑似是純前端行為,若牽涉到跨幕檔案完整性(漏檔/順序錯),零測試意味著任何重構都無回歸防護 |
| 端到端(①→⑥全鏈路) | 無單一函式/procedure 代表整條鏈 | 無 | **untested — 且對應功能本身未接通(M1 六缺口),並非單純缺測試** | 這是本次稽核的核心結論:北極星「一條龍」目前沒有,也不可能有,端到端測試——因為鏈路在③→④之間斷裂(佇列後無人消費、拼接是假拼接) |

---

## 5. e2e/整合測試盤點(8 個 Playwright spec 逐檔核實)

實讀全部 8 個 `tests/e2e/*.spec.ts` 的 `describe` 結構,確認**沒有一支涵蓋北極星全鏈路**,全部落在「單一創作室分頁」層級:

| Spec | 涵蓋範圍(A 軸純邏輯 / B 軸瀏覽器) | 是否涉及北極星鏈路 |
|---|---|---|
| `image-studio-generation-flow.spec.ts` | 圖圖精靈路由 + t2i AgentAction 契約 + `/image-studio` 6 分頁渲染 | 否,單一 studio 分頁 |
| `video-studio-generation-flow.spec.ts` | 影影精靈路由 + t2v AgentAction 契約 + `/video-studio` 5 分頁渲染 + 分頁切換無 page error | 否,單一 studio 分頁 |
| `pro-studio-voice-generation-flow.spec.ts` | 聲聲精靈路由 + TTS/Clone AgentAction 契約 + `/pro-studio` 語音分頁渲染 | 否 |
| `orb-pro-studio-25-spirits.spec.ts` | 25 精靈路由總表 + ProStudio 7 分頁渲染 | 否,廣度而非鏈路深度 |
| `studio-subflow-action-contracts.spec.ts` | 圖片/影片「子分頁」(edit/upscale/pose/sd/i2v/v2v/enhance/control)AgentAction 契約鎖定 | 否,仍是單分頁層級,只是涵蓋更多分頁 |
| `orb-routes-smoke.spec.ts` | 路由層 smoke(推測為路由可達性,未深入内容) | 否 |
| `trpc-transport-smoke.spec.ts` | tRPC 傳輸層 smoke(AIDV-606) | 否 |
| `agent-preferences-page.spec.ts` | AgentPreferencesPage 分頁 UI 斷言 | 否 |

**設計取捨風險**:8 個 spec 中,B 軸(真瀏覽器)測試普遍在「dev server 未啟動」或「頁面被 LoginScreen 擋下」時 `test.skip`——這代表**CI 若真的接上 e2e(目前未接),沒有登入 storageState 時 B 軸實質上是空跑**(全部 skip,綠燈但零驗證);只有 A 軸(純邏輯,import 真實 router/action builder)在 CI 環境下才真正跑得動。這與北極星端到端測試需要「真的登入 + 真的走完生成鏈」的需求差距更大。

---

## 6. 已有良好測試(negative results — 明確排除、不需要再稽核)

- `server/services/__tests__/postGenActions.test.ts` + `postGenActions.refund.test.ts` + `refundStatus.test.ts`:atomicClaimJobRefund 並發/冪等鏈,**確認 tested**。
- `server/services/__tests__/videoCatalogConsistency.test.ts`:catalog SSOT 一致性,**確認 tested**(侷限於 SSOT,非功能正確性,已於 §3 註明)。
- `server/agent-tool-executor.test.ts`:fallback 機制(:144)與外部自訂工具 requireConfirmation(:32)均 **tested**;內建精靈工具(studio./training.)的 requiresHuman 閘門分散在 `studio-tool-bridge.test.ts`/`orb-train-lora-tool.test.ts`,同樣 **tested**。
- `server/__tests__/worldbuilding-animation.test.ts`:分鏡骨架生成/逐幀提示詞組裝的規劃邏輯,1503 行、40+ it,**測試量體與深度均屬全站數一數二紮實**,tested(規劃層)。
- `server/services/__tests__/videoOutputSpec.test.ts` + `videoStudioOutputSpec.router.test.ts`:輸出規格→fal 參數映射的笛卡兒積組合(27 組)與 4K 付費守門,**確認 tested**。
- PR gate 四關(tsc/routes/navigation/vitest)**確認會真的擋 PR**(非文件宣稱,已讀 workflow yaml 逐行核實)。

---

## 7. 未查證 / 需再查

- `server/orb-train-lora-tool.test.ts`/`studio-tool-bridge.test.ts` 是否覆蓋**所有** 178 個精靈工具各自的 requiresHuman 分支,或只挑代表性的 1-2 個工具(`studio.generateImage`/`studio.trainLora`)——本次未逐一核對 178 個工具是否每個都有對應正例測試,P5 §2-B 提議的「178-tool reachability 測試」仍未落地(`find` 確認無此檔案)。
- `dispatchDirectorTool`(:7785)的 `requiresHuman:true` 分支是否曾經或現在有任何 director.\* 工具設為 true——本次讀 `global-agent-tools.ts` 之外的定義來源不足以窮舉,只能確認「至少 director.suggestPlan 是 false」,**需再查**完整 director 工具清單的 requiresHuman 設定與對應測試。
- `server/routers/__tests__/worldStoryboardQueue.test.ts` 之外,是否存在任何(哪怕是 mock 掉 fal 的)「跨步驟 workflow 執行」整合測試——本次搜尋 `buildShortVideoWorkflow`/`resolveStepRefsInArgs` 相關測試只找到形狀驗證(`orbAssetPipeline.test.ts`),未發現任何測試把整個 workflow 丟進 `executeOrbToolCalls` 跑過一輪(即使全部 mock fal),此為推測性結論,**建議在動手修復前再跑一次全文搜尋確認**。
- k6 load test(`load-tests/video-pipeline.js`)在本環境是否可實際執行(是否已裝 k6 binary)——未實測,沿用 P5 既有結論。
- `orb-routes-smoke.spec.ts`/`trpc-transport-smoke.spec.ts` 兩檔內容本次只讀了 `describe` 標題與 test 數量,未逐行核對其斷言深度,**需再查**是否有任何隱藏的跨頁流程斷言。
