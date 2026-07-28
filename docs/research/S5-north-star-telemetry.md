# S5 — 北極星指標與成效 Telemetry(產品策略 wave S)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 前置閱讀:`D-adoption.md`(採用障礙/審改斷點)、`M0-solution-blueprint.md`(一條龍七支柱+四階段路線)、`00-summary.md`(全站總診斷+風險登記表)、`B-infra.md` §5(可觀測性)、`A-cost-integrations.md` §1.5/§5(PostHog/LangSmith 成本面)
- 方法:本輪為單一代理實讀(禁止 spawn 子代理)——實讀 `vite.config.ts`、`client/index.html`、`server/routes/aiProxy.ts`、`server/posthog-tracking.test.ts`、`server/routers/dashboard.ts`、`server/routers/admin.ts`、`server/db.ts`(getSystemStats/getUserActivitySummary/getApiProviderBreakdown/getUserCostSummary)、`drizzle/schema.ts`(generationHistory/backgroundJobs/apiUsageLogs/creativeProjects/orchestrationRuns/studioVersions/worldStoryboards/timelineFrames/sceneCompositions/videoProjects/users/loginHistory)、`docs/research/Q3-alignment-gate-spec.md`(對齊門現況——**規格已寫、未插電**)
- 讀者設定:同 D-adoption——15-20 人內部創作團隊決策者(Bruce)

---

## 0. 一句話結論

**現有 telemetry 是「供給側生產計數器」,不是「創作成功計數器」**:PostHog 前端只有一支未呼叫 `identify()`/`capture()` 的預設頁面瀏覽埋點、後端 PostHog 只在一個側路徑(BYOK proxy `/api/ai/:provider/*`)雙寫、admin/dashboard 現有的 8 張圖表全部是「呼叫次數×成本×供應商」的用量會計,**沒有一個數字回答「創作者是否做出一支完整成品」**。北極星指標與一條龍漏斗需要的原始資料(`creative_projects.status`、`world_storyboards.productionStatus`、`studio_versions`、`orchestration_runs`)在 DB 裡已經存在但從未被聚合成漏斗;真正缺的埋點集中在「審(review)」與「拼接輸出打包」兩段——這與 D/00 文件診斷的產品缺口完全對應,telemetry 缺口是產品缺口的鏡像。

---

## 1. 北極星指標設計

### 1.1 對齊本質

Bruce 定義的本質(M0 §1 七支柱)第④條:「單一專案:腳本→分鏡→逐幕(字卡+圖影+聲音)→拼接→輸出→打包」。北極星必須是**這條鏈走完的比例**,而不是生產量(生成次數/點數消耗)——生產量現有指標已經很完整(getSystemStats/getApiProviderBreakdown),但正是 00-summary 一句話總診斷所指「供給側已達業界水準」的那個側面,不需要再疊加指標。

### 1.2 北極星指標

> **週度專案完成率(Weekly Project Completion Rate)**
> = 本週內狀態變為 `complete` 的 `creative_projects` 數 ÷ 本週「活躍」(有任一新 `generation_history`/`orchestration_run`/`studio_versions` 寫入)的 `creative_projects` 數

輔以一個「人」向的伴隨指標(給 Bruce 看團隊採用而非只看專案數):

> **月度完賽創作者比例** = 本月至少完成一個 `creative_projects.status = complete` 專案的 userId 數 ÷ 本月活躍 userId 數(15-20 人團隊分母固定,波動一看就懂)

**為什麼是這兩個而不是「生成次數」或「留存率」**:
1. 生成次數已被 00-summary 判定為「供給側,已達業界水準」,拿它當北極星會讓團隊持續投資已經夠好的一段,錯過真正缺口(審改協作)。
2. D-adoption §2.2 明確診斷「管線在『審』處徹底斷開」——完成率這個指標的分母/分子必須穿過審改斷點才會變化,能倒逼團隊修正確缺口,而不是修「更好修的」。
3. `creative_projects.status` 欄位(schema.ts:3695-3702)本身就是 `concept → production → review → complete` 四態,**是本質④「達最終成品」的資料層原生定義**,不需要新建表,只需要「有紀律地推進它」+「聚合成報表」。

### 1.3 現況警示(北極星今天量不出來的原因)

- `creative_projects` 目前與 `video_projects`/`world_storyboards` **三套並存**(D-adoption §2.1 第 1 點、00-summary 勘誤表),使用者建案不一定真的寫入 `creative_projects`,`status` 欄位很可能大量停在預設值 `concept`(從未被程式路徑主動推進到 `complete`)——**需要先確認「有沒有任何後端路徑會把 status set 為 complete」**,若答案是「幾乎沒有」(高度懷疑,因為 M0 §3 Phase 3 才規劃 compose/輸出/打包,代表「完成」這個終點事件目前很可能沒有寫入點),北極星第一步不是「建報表」而是**「先確保完成事件真的有一次寫入動作」**(M1 軌 E:compose→輸出→打包完成時 `UPDATE creative_projects SET status='complete'`)。這是本文件對 M0 藍圖的一個新增小前提:**北極星要能被量測,先決條件是 Phase 3(拼接輸出打包)的完成動作必須順手把 `creative_projects.status` 寫成 `complete`**,否則指標永遠是 0/0。

---

## 2. 一條龍漏斗設計

依本質④六個階段,逐步標「在哪埋點」「現有數據能撈多少」「要補什麼」。**鑰匙全線用 `creativeProjectId`**(M0 §2 已定義為 SSOT 鑰匙),漏斗查詢的關聯鍵也應統一走它。

| # | 階段 | 對應現有資料 | 現有數據能撈到什麼 | 要補的事件/欄位 |
|---|---|---|---|---|
| 1 | **建立專案** | `creative_projects` INSERT(schema.ts:3678) | 專案建立數、`worldFrameworkId`/`worldStoryboardId`/`scriptId` 是否已連結(判斷「空殼專案」比例) | 無需新表;建議在建案 API 補一次 `posthog.capture("project_created", {projectId, hasWorldview, hasScript})` 前端事件,方便做留存漏斗(PostHog 天生的 funnel 工具比手寫 SQL 好用) |
| 2 | **腳本** | `creative_projects.scriptId`、`orchestrationRuns.mode='director'`(schema.ts 3690/orchestration_runs mode enum) | 有 scriptId 的專案數;`orchestration_runs` 有 director 對話次數(但 projectId 目前可為 null,見 schema.ts 注解「未選專案時仍可建立 run」——**這一步的專案歸屬率本身就是待查數字**) | 導演 CO-STAR 完成腳本產出時機無明確「腳本完成」事件——建議在 `director.ts` 腳本定稿的 mutation 補寫 `creative_projects.scriptId` 回填(若尚未做)+ 一個 `script_finalized` 事件(userId, projectId, durationMs from run start) |
| 3 | **分鏡** | `world_storyboards`(scenesJson 陣列、`productionStatus`)、`creative_projects.worldStoryboardId` | 已建 storyboard 的專案數;`world_storyboards.productionStatus`(預設 `"planning"`,schema.ts:3568-3570)可看多少專案推進到其他狀態值——**但需先查 productionStatus 實際出現哪些值**,若全站只用預設值,代表這個欄位也是「有定義未使用」 | 补 `storyboard_generated` 事件(sceneCount, worldId);若 productionStatus 從未被程式更新,需在管線執行化(M1 軌B)時補寫入時機 |
| 4 | **逐幕(字卡+圖/影+聲音)** | `timeline_frames`(schema.ts:3596,每幕一列,frameType 含 keyframe/concept_art/final_render)、`generation_history`(逐筆生成,含 modality/costCredits/durationMs)、`scene_compositions` | **這是漏斗中資料密度最高的一段**:可用 `generation_history` join `world_storyboards`(經 `sourceScriptId`/worldId 或未來的 projectId 外鍵)算出「每個 storyboard 平均產出幾幕、每幕平均重生成幾次」;`timeline_frames.frameType='final_render'` 的計數可近似「幕的定稿率」 | `generation_history`/`timeline_frames` **目前沒有 `creativeProjectId` 欄位**(僅 `digital_asset_library` 規劃要補,見 M0 §5 Phase 1)——這是漏斗第 4 步能不能跟第 1-3 步串起來的關鍵缺口,補一欄比補新表便宜很多 |
| 5 | **簡易拼接** | 無現成表(M1 軌E「compose 是唯一大件新建」,M0 §5 Phase 3 才排入) | 0——這一段在程式碼裡幾乎不存在 | 全新:compose job 需要至少一個 `compose_started`/`compose_completed` 事件(projectId, sceneCount, totalDurationSec, failureReason);新建 compose 執行紀錄表若做的話,順手記漏斗第 5 格 |
| 6 | **輸出** | `video_projects`(schema.ts:4604,`outputStoragePath`/`outputSignedUrl`/`outputExpiresAt`,含 `creativeProjectId` 外鍵!) | **這是漏斗裡少數已經有 `creativeProjectId` 外鍵的表**——`video_projects.outputStoragePath IS NOT NULL` 可直接近似「已輸出」的專案數,今天就能查 | 補 `video_export_completed` 事件(projectId, durationSec, aspectRatio);`requestExport` 呼叫時機(M0 §5 Phase 3「借 videoProject.requestExport 輸出殼」)加一行埋點即可 |
| 7 | **打包(交付)** | 前端 JSZip 匯出(00-summary §2.2「下載=交付終點」),無後端紀錄表 | 0——**打包是純前端行為,後端完全看不到**,這是漏斗最後一哩路的最大盲點 | 補一支輕量後端端點(即使只做「記錄一次打包完成」不做真正打包):`package_exported` 事件(projectId, assetCount, exportedAt);沒有這個,永遠無法回答「有幾個專案真正拿到手」 |

### 2.1 漏斗轉化率的計算方式(建議 SQL 形態,待補 `creativeProjectId` 欄位後可用)

```
Step1 建立專案數
  → Step2 有 scriptId 的專案數 / Step1
  → Step3 有 worldStoryboardId 的專案數 / Step2
  → Step4 有 ≥1 筆 generation_history(該 projectId)的專案數 / Step3
  → Step5 有 compose_started 事件的專案數 / Step4   ← 待建
  → Step6 video_projects.outputStoragePath 非空的專案數 / Step5
  → Step7 有 package_exported 事件的專案數 / Step6   ← 待建
```

**現況能立刻算的部分**:Step1→4(用 `creative_projects` join `generation_history` 的近似口徑,即使還沒有直接外鍵,也能用 `worldStoryboardId`/`worldFrameworkId` 間接關聯抓出粗略轉化率)。**Step5-7 是全新盲區**,對齊 M0 §5 Phase 3 的既定路線(compose 服務+輸出殼+打包),**telemetry 應該與 Phase 3 的程式碼一起補,而不是事後補**——這是本文件對 M0 路線圖的具體落地建議:Phase 3 每個新端點都應該在同一個 PR 裡順手寫一行 `logFunnelEvent()`。

---

## 3. 採用健康指標——每個怎麼量

| 指標 | 定義 | 量測來源 | 現況 |
|---|---|---|---|
| **週活創作者(WAC)** | 本週內有 `generation_history` 或 `orchestration_runs` 寫入的 distinct `userId` 數 | `generation_history.createdAt`/`orchestration_runs.createdAt` + `users.lastSignedIn` 對照 | **今天就能查**,`getUserActivitySummary()`(db.ts:2933)已經回傳 `lastSignedIn`+`totalGenerations`,admin 頁已有這張表(AdminPage.tsx),只差沒有「本週」篩選與聚合成單一數字 |
| **專案完成率** | 見 §1.2 北極星 | `creative_projects.status` | **量不出來**,見 §1.3——先決條件是「完成」動作真的寫回 status |
| **審改迴圈使用率** | 目前**無此迴圈**——00-summary/D-adoption 一致判定「全站無評論/標注/審批表與 UI」,唯一近似信號是 `generation_history.isBookmarked`/`userRating`(個人層,非團隊審改) | `generation_history.userRating`/`isBookmarked`(個人)、`studio_versions` 表(每次「改」的版本快照,schema.ts:2806——**這其實是目前系統裡最接近「改」的量化信號**:同一 `userId`+`modality` 下 `studio_versions` 列數可近似「單人反覆修改次數」) | **團隊審改迴圈(誰審、誰改、根據誰的意見)完全無法量測**——這不是 telemetry 缺口,是產品缺口(D-adoption §1.2 #1);待 M4 階段 1 的資產狀態機(draft/in_review/approved)+評論表做出來後,才有「審改迴圈使用率 = 有評論/狀態變更的資產數 ÷ 總資產數」可言。個人層「改」的迴圈今天可先用 `studio_versions` 算「平均每個生成任務重製幾次」當代理指標 |
| **AI 引導接受率** | 光球/精靈給出建議後,使用者採納(執行建議動作)vs 忽略/否決的比例 | 理論上 `orchestrationRuns.planJson`/`toolCallsJson` 有計畫與實際呼叫的工具紀錄,可比對「規劃 vs 執行」的落差;但 G3 文件已指出**178 個精靈工具 case 不可達(R10)**,規劃會過執行必敗,現階段這個比率**會被 R10 汙染**——量出來的低接受率有一部分其實是「工具不可達」而非「使用者不想要」 | **今天可以粗量但解讀需小心**:`orchestration_runs.status`(pending/planned/waiting_confirmation/running/completed/failed/cancelled)的分佈(schema.ts orchestration_runs mode/status)——`cancelled` 佔比高可近似「使用者否決 AI 提議」,但需先扣掉 R10 造成的 `failed`,否則會把「系統壞了」誤讀成「使用者不接受」 |
| **跑偏率(對齊門觸發)** | 對齊門(`evaluateProjectAlignmentGate`)判定 fail 並降級為澄清卡的次數 ÷ 總規劃次數 | **目前完全無法量測——對齊門本身尚未插電**(Q3-alignment-gate-spec.md 明確定位為「規格已寫、首個 PR 只做純函式+單元測試,不接前端、不動 agentPlanner.ts 呼叫點」)。這是四項健康指標裡唯一「連量測介面都還不存在」的一項 | **待補**:對齊門插電那一個 PR(M0 §5 Phase 2「新增 shared/project-alignment-gate.ts 對齊門」)必須順手在 `ai.chat` 回應 payload 加 Q3 文件建議的顯式欄位 `alignmentViolation?: AlignmentViolatedRule`(Q3 §4.2 已指名這個欄位),並在每次觸發時寫一筆事件(userId, projectId, violatedRule, degradedToClarification: true)。**建議把「跑偏率」的量測需求現在就寫進對齊門那張 Jira 卡的驗收條件**,不要等對齊門上線後才回頭補埋點——這是本文件對 M0/Q3 路線圖最具體的一個新增交付物 |

---

## 4. 現有可觀測性盤點

### 4.1 PostHog——現況(實讀 `vite.config.ts:179-189`、`client/index.html:59-118`、`server/posthog-tracking.test.ts`、`server/routes/aiProxy.ts:91-111,625`)

- **前端**:`index.html` 內嵌 PostHog snippet,`VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST` 走 Vite `define` 建置期注入(未設 key 時 `posthog.init` 因守衛 `charAt(0) !== "%"` 而**完全不初始化**,見 `posthog-tracking.test.ts` 第 37-41 行的專屬回歸測試)。設定 `person_profiles: "identified_only"`,但**全 client 程式碼(grep 零命中)從未呼叫 `posthog.identify()`/`posthog.capture()`/`posthog.group()`**——目前只吃得到 PostHog 內建的**匿名自動頁面瀏覽/點擊**(autocapture),抓不到任何自訂事件,也抓不到「這是哪個使用者」(identified_only 模式下沒有 identify 呼叫,等同於這個模式形同虛設,退化成匿名事件)。
- **後端**:`postHogCapture()`(aiProxy.ts:91-111)只在**一個側路徑**呼叫——`/api/ai/:provider/*` 這條 BYOK(bring-your-own-key)代理閘道(aiProxy.ts:269,625),事件名固定 `"ai_api_call"`。**這不是主要生成路徑**(ImageStudio/VideoStudio/ProStudio/DirectorAI 批次鏈都是走 tRPC routers 直呼 fal/gemini,不經過這支 proxy),所以後端 PostHog 對日常使用者行為幾乎是**盲區**——它服務的是「使用者自帶 API key」這個相對邊緣的功能。
- **結論**:PostHog 目前對「創作者做了什麼」**幾乎無法回答**——不是「資料不夠精細」,而是「除了頁面瀏覽以外根本沒送自訂事件」。這與 00-summary D6「監控半接線」的判定一致(「PostHog 後端僅 aiProxy 一點」)。

### 4.2 LangSmith——現況(承接 B-infra §5.3)

- `langsmithTracer` lazy-load,無 key 則 no-op;有 key 才會追蹤 LLM 呼叫鏈。`/dashboard?section=langsmith` 前端頁面真的連 API(01-features 已確認接線)。這是**唯一一個「有真資料且已在儀表板上可看」的可觀測性面**,但涵蓋範圍是**LLM 呼叫的技術性追蹤**(延遲、token、chain 結構),不是「創作者完成了什麼」——對北極星/漏斗沒有直接貢獻,但對「AI 引導接受率」指標的除錯(分辨是工具不可達還是 LLM 本身沒給出好建議)有輔助價值。

### 4.3 不用新埋點就能撈的既有數據(現有 DB 表,今天就能寫 SQL/報表)

| 數據 | 來源 | 對應本文件哪個指標 |
|---|---|---|
| 使用者活躍度(建立時間/最後登入/總呼叫數/總花費/總資產數) | `getUserActivitySummary()`(db.ts:2933-2953)——admin 頁已有此表 | WAC 的原始資料;只差「本週」篩選聚合 |
| 系統總量(總使用者/總生成/總 API 呼叫/總成本/任務數/資產數/回饋數) | `getSystemStats()`(db.ts:2866-2932) | Bruce 的「先看這 5 個數字」的第 1-3 項可直接沿用 |
| 供應商/請求類型細分(呼叫數/成本/token/成功率) | `getApiProviderBreakdown()`(db.ts:2956-2971) | 判斷生成失敗率、哪個模態最常失敗 |
| 每日系統用量趨勢 | `getSystemDailyTrend()`(db.ts:2974+) | 週活/月活的時間序列基礎 |
| 個人用量/成本/模態分佈/每日趨勢 | `dashboard.myStats`/`dashboard.insights`(dashboard.ts) | 若要做「創作者自評」頁,資料已備妥 |
| 專案生命週期狀態 | `creative_projects.status`(concept/production/review/complete) | 北極星指標主鍵——**只差「有紀律地被推進+聚合」** |
| 版本/修改迴圈(個人層) | `studio_versions`(每次修改一列) | 審改迴圈的個人層代理指標 |
| 世界觀/分鏡完成度 | `world_storyboards.productionStatus`、`scenesJson[].status`(M0 §3 提到「draft→in_review→approved 命名先例」) | 分鏡漏斗第 3 步;**需先查這個欄位實際填值分佈,可能全站都是預設值** |
| 影片輸出完成度 | `video_projects.outputStoragePath IS NOT NULL`(且已有 `creativeProjectId` 外鍵) | 漏斗第 6 步「輸出」——**今天就能查,是漏斗中資料完整度最高的一步** |
| 意圖/指揮層使用量 | `orchestration_runs`(mode/status/commander) | AI 引導接受率的粗代理指標;Brief 階段的量 |
| 登入行為明細 | `login_history`(device/browser/country/失敗原因) | 若要做安全/異常登入監控,可另案使用,非本文件核心 |

### 4.4 要補的埋點(依產品缺口對應,優先序見 §6)

1. **`creativeProjectId` 外鍵補到 `generation_history`/`timeline_frames`**(M0 §5 Phase 1 已規劃「digital_asset_library 加 creativeProjectId」,建議一併把這兩張表也補上,漏斗第 4 步才串得起來)。
2. **compose/輸出/打包三個新事件**(`compose_started/completed`、`video_export_completed`、`package_exported`)——這三步目前 0 資料,且對應 M0 §5 Phase 3 的既定開發排程,建議與程式碼同一 PR 完成。
3. **對齊門觸發事件**(`alignment_gate_triggered` + `alignmentViolation` 欄位)——對應 M0 §5 Phase 2,Q3 文件已指名欄位名稱,插電時一併寫。
4. **審批狀態變更事件**(`asset_status_changed`:draft→in_review→approved/rejected)——對應 M4 階段 1 資產狀態機,尚未開發,是「審改迴圈使用率」指標唯一的資料來源。
5. **前端自訂事件補齊**(`project_created`/`script_finalized`/`storyboard_generated`):低成本(只是加 `posthog.capture()` 呼叫),可獨立於後端開發先做,讓 PostHog 至少對北極星漏斗前三步有交叉驗證。
6. **PostHog `identify()` 呼叫**:登入成功後呼叫 `posthog.identify(userId)`,否則 `person_profiles: identified_only` 這個設定形同白設——這是成本最低、修復收益最直接的一項(一行程式碼)。

---

## 5. 給 Bruce 的「先看這 5 個數字」

團隊 15-20 人,以下 5 個數字**今天回家就能從既有 admin 頁/DB 直接撈**,不需要等任何新開發:

1. **本週活躍創作者數 / 團隊總人數**——`getUserActivitySummary()` 篩 `lastSignedIn >= 本週一` 的 distinct 數,除以團隊已知人數(15-20 人分母固定,馬上看出「有沒有人根本沒在用」)。
2. **`creative_projects` 各 status 分佈(concept/production/review/complete 各幾個)**——一行 `GROUP BY status` 就能看到「有多少專案卡在 concept 從未推進」,這是北極星指標的體檢,今天就能看出「量不出完成率」是不是因為 status 從未被寫入(若 complete=0 或極低且非因為真的沒做完,代表要先修寫入時機,而非團隊不採用)。
3. **`video_projects.outputStoragePath IS NOT NULL` 的數量 / `video_projects` 總數**——漏斗裡少數今天就能算的「真輸出率」,直接反映「做到影片輸出這一步」的比例。
4. **`api_usage_logs.responseStatus='failed'` 佔比(依 `getApiProviderBreakdown()`)**——失敗率高會直接壓低完成率,先確認「卡在做不完」是不是因為技術失敗而非流程斷點,避免把技術債誤判成產品採用問題。
5. **`studio_versions` 每人平均列數(近 7 天)**——目前唯一能代理「改」這個動作頻率的數字;如果這個數字很低,代表「審改迴圈全斷」不只是流程缺失,連個人層的反覆修改都很少發生,值得回頭訪談(D-adoption §5 已備 10 題訪談單可用)。

> 這 5 個數字裡,#1/#4 用現有 admin 頁面就能看(AdminPage.tsx 已有 userActivity/apiProviderBreakdown 兩張表);#2/#3/#5 需要一行 SQL(無需新表、無需新埋點),建議直接請工程師排一個 30 分鐘的 admin 頁新增卡片,而不是等大型 telemetry 專案。

---

## 6. 重用什麼 + 要補什麼 + 分階段

### 6.1 重用清單(不重造)

- **PostHog 前端 SDK**(已載入、已通過 build-time 注入測試)——缺的只是「呼叫它」,不缺基建。
- **PostHog 後端 dual-write 模式**(`postHogCapture()` 函式已存在於 aiProxy.ts,可直接抽成共用 helper 供其他 router 呼叫,不必重新設計批次/重試邏輯)。
- **`creative_projects.status` 四態**、**`world_storyboards.productionStatus`**、**`scenesJson[].status` 命名先例**——本質④「達最終成品」的資料層定義已經在 schema 裡,漏斗設計直接借用,不新建狀態機。
- **`getUserActivitySummary`/`getSystemStats`/`getApiProviderBreakdown`/`getSystemDailyTrend`**——admin 現有四支查詢函式的聚合邏輯可直接擴充(加篩選條件、加新的 SELECT 欄位),不必另起爐灶。
- **`studio_versions`/`orchestration_runs`**——現成的「改」與「AI 指揮」原始資料,只差聚合成指標,不必新增資料收集點。
- **LangSmith 既有接線**——AI 引導接受率指標除錯時可直接查,不必疊加新的 tracing 系統。

### 6.2 要補(依成本排序)

| 成本 | 項目 |
|---|---|
| 一行程式碼 | 登入成功後呼叫 `posthog.identify(userId)` |
| 小(<1 天) | admin 頁新增 3 張卡片(§5 的 #2/#3/#5);前端補 `project_created`/`script_finalized`/`storyboard_generated` 三個 `posthog.capture()` |
| 中(1 個 PR) | `generation_history`/`timeline_frames` 補 `creativeProjectId` 欄位(migration + 回填) |
| 中(隨 M0 Phase 2 同步) | 對齊門插電時補 `alignmentViolation` 欄位+`alignment_gate_triggered` 事件 |
| 大(隨 M0 Phase 3 同步) | compose/輸出/打包三個新事件,必須與該階段程式碼同批交付,否則會重演「有功能沒數據」 |
| 大(隨 M4 階段 1 同步) | 資產狀態機(draft/in_review/approved)+ 評論表——這是「審改迴圈使用率」指標唯一的資料地基,產品沒做、指標就不存在 |

### 6.3 分階段(對齊 M0 §5 四階段,telemetry 作為每階段的「隨行交付物」而非獨立軌)

- **Phase 0(現在就能做,不等任何開發)**:§5 五個數字上線 + PostHog identify() 一行修復 + 前端三個自訂事件。**這一步的價值是先看清楚「北極星今天是不是卡在資料沒寫入」,而不是急著建視覺化儀表板**。
- **Phase 1(隨 M1/M2/M4 階段 0 同步)**:`creativeProjectId` 補進 generation_history/timeline_frames,漏斗第 1-4 步開始能串接;WAC/失敗率報表正式化。
- **Phase 2(隨對齊門插電同步)**:跑偏率指標第一次有資料可看;審改迴圈指標仍是 0(等 M4 階段 1)。
- **Phase 3(隨 compose/輸出/打包同步)**:漏斗第 5-7 步補齊,北極星「完成率」第一次可以端到端計算;此時才是「畫一個像樣的漏斗儀表板」的正確時機——**在此之前畫出來的漏斗圖後三步永遠是 0,對團隊士氣是負面訊號,不建議提前視覺化**。
- **Phase 4(隨 M4 階段 1 資產狀態機同步)**:審改迴圈使用率指標正式上線,北極星北極星指標與健康指標五項全部到齊。

---

## 7. 缺讀/待補聲明

- 未實際連線 DB 查詢 `creative_projects.status`/`world_storyboards.productionStatus`/`scenesJson[].status` 的**實際值分佈**(全靠 schema 定義+程式碼寫入路徑推論「可能全是預設值」),這是本文件最大的待驗證假設——建議下一步直接對 prod DB 跑一次 `GROUP BY status COUNT(*)`,若 `complete` 真的接近 0,即證實 §1.3 的假設,北極星指標的第一個修復目標就是「先讓完成事件寫入」而非「建報表」。
- 未讀 `agentCollaborationOrchestrator.ts`/`agentPlanner.ts` 中 `orchestration_runs.status` 各狀態轉移的完整程式碼路徑,「跑偏率」§3 表中對 `cancelled` 佔比的解讀為推論,未經程式碼逐行驗證。
- PostHog/LangSmith 實際方案與月量(A-cost-integrations §4.7 已列為「待補」,本文件沿用,未重複調查)。
- 未讀 M4 分冊資產狀態機/評論表的欄位級規格細節(僅引用 M0 §5 的階段摘要),若 M4 已有更細的表設計,§6.2「審改迴圈」欄位命名應以 M4 分冊為準。
