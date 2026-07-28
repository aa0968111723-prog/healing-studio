# Q4 — 光球工具完整列表 × 63 筆 registry 缺口盤點(規格設計 wave Q)

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 波次:**規格設計 wave Q**
- 性質:這不是新診斷——是把 G3(光球工具全清單抽樣)、K4(死碼/契約掃描)、N1 決策卡 1(修 G3 178-tool gate)三份文件已定的結論,**逐行機器可驗證化**:把「178 個不可達」「63 個未註冊」這兩個數字從人工盤點升級成用 `grep`/`python` 對 `server/services/agentToolExecutor.ts`(8,087 行)與 `shared/global-agent-tools.ts`(1,850 行)做的**精確集合運算**,產出可直接拿去寫 PR 驗收標準的規格。
- 方法:①對 `agentToolExecutor.ts` 全文抽取所有 `case "<name>"` 字面值(194 個唯一值,含一個因正規表示式限制需手動補回的 `studio.generate3D`);②對 `global-agent-tools.ts` 用「`name: "..."` 緊接下一行 `riskLevel:`」的樣式抽取 148 個唯一 top-level 註冊項(排除巢狀 `allowedArgsSchema` 裡剛好也叫 `name` 的欄位造成的假陽性);③對兩個集合做 `comm -12/-13/-23` 交集/差集運算;④逐一讀 gate 本體、`dispatchStudioTool` 二次檢查、九個「未註冊」精靈家族的 `spiritTools/*.ts` 實作,核對是否有危險動作、是否呼叫 `dispatchFalQueueTask`/`dispatchGenerationJob`(真花錢的生成動作)。
- 產生的中繼資料檔(집合運算依據,存於 scratchpad,不進 repo):`case_values_full.sorted.txt`(194)、`registry_clean.txt`(148)、`case_not_registered_v2.txt`(63)、`registered_no_case.txt`、`full_table.md`(225 列全表)。

---

## 0. 結論先講

1. **63 筆缺口數字覆核通過,且拿到了逐一工具名的清單**(N1/G3 只給家族層級加總,本文件是第一份給出**逐一工具名**的版本)——`orchestrator`(11)+`videoSpecialist`(9)+`voiceSpecialist`(12)+`learningSpecialist`(9)+`legalAdvisor`(3)+`securityGuard`(4)+`communityManager`(7)+`onboardingCoach`(3)+`companion`(4)+`teachingArchive`(1)= **63**,見 §2 逐一列名。
2. **gate 修法的兩處確切位置與 N1 逐字核對一致**:`agentToolExecutor.ts:708`(if 判斷式)+ `:726-728`(三元路由選擇式)。這兩處在本次獨立覆核中**行號完全吻合**,可信度高。
3. **新發現(G3/K4/N1 都沒查到的東西)**:gate 修好之後,`videoSpecialist.generate/imageToVideo/enhance/lipSync`(4 個)與 `voiceSpecialist.generateSpeech/cloneVoice/designVoice/changeVoice/generateSfx`(5 個)——共 **9 個「未註冊」清單裡的工具**——底層直接呼叫 `dispatchFalQueueTask`(真的會呼叫 fal.ai、真的花錢),但 N1 建議的「跟同家族既有筆一致的預設」(即比照 `securityGuard.*` 全部給 low risk)套用在這 9 個上會是**錯的**——它們必須比照 `studio.generateVideo`/`studio.generateVoice`/`studio.cloneVoice`/`studio.designVoice`/`studio.changeVoice`/`studio.generateSfx` 給 **medium + requiresHuman:true**,否則 gate 修好後這 9 個工具會變成「不用確認、不耗額度」就能觸發真實生成——比修 gate 前(`tool-not-found`,完全打不到)更危險。詳見 §4。
4. **更嚴重的是:這個風險不只影響新的 63 筆,連本來就已註冊、gate 修好後首次變得可達的 115 個工具裡也有 2 個既有 bug**——`imageSpecialist.generate/edit/upscale` 三個工具在 registry 裡已經是 `riskLevel:"medium"` 但 `requiresHuman:false`(`shared/global-agent-tools.ts:904-932`),而它們的實作(`spiritTools/imageSpecialistTools.ts`)直接呼叫 `dispatchGenerationJob`——這三個 bug 從系統上線至今**因為 gate 擋著從未真正執行過**,gate 一修好就會首次生效。這不是本卡「63 筆缺口」範圍內的東西,但屬於同一個 PR 的驗收範圍,必須一併處理。詳見 §4。
5. **一個數字勘誤(修正 G3)**:G3 §1.2 寫「db.*(13 個)」,實際核對 `orbDatabaseTools.ts` 的 query 定義共 **14 個**(`list_my_assets/search_my_assets/get_recent_assets/list_my_notes/search_my_notes/get_calendar_events/get_generation_history/get_recent_generations/list_my_jobs/get_active_jobs/list_my_models/get_my_brain_config/list_my_scheduled_jobs/search_prompts`),G3 自己逐一列出的清單其實就是 14 項、只是加總時少算 1;連帶 G3 §1.4 的「215 個內建工具面」統計也應更正為 **225**(194 executor case + 5 director if-chain + 14 db + 3 具名直判 + 9 registry-only 真孤兒)。不影響任何結論,純數字對帳。
6. **registry 精確筆數**:N1 用 `grep -c "executionTarget:"` 數出 150、G3 用另一種抓法數出 148,本次用「`name:` 緊接 `riskLevel:` 樣式」精確抓出 **148 個唯一頂層項**(150/151 的差額是巢狀 `allowedArgsSchema` 裡也叫 `name`/`riskLevel` 的欄位造成的計數雜訊,不是真的多了 2-3 筆工具)。

---

## 1. 執行器可達性完整對照表(225 列,機器產生、逐一核對)

欄位定義:
- **有 case?**:`agentToolExecutor.ts` 裡是否有對應這個工具名的執行分支(`switch/case` 字面值,或 director 的 if-chain,或 db/研究工具的直接 `===`/`startsWith` 判斷)。
- **有註冊?**:`shared/global-agent-tools.ts` 的 `GLOBAL_AGENT_TOOL_REGISTRY`(148 筆)是否有這個工具名的定義。
- **gate 路由得到?**:以**目前**(修 gate 前)的 `executeOrbToolCalls`(:533)路由邏輯判斷,這個工具名會不會被送進真正執行它的分支。
- **現況**:四類——**可達**(目前就能跑)、**規劃過執行必敗**(有 case 有註冊,但 gate 只認 `studio.`/`director.` 前綴,永遠進不去,是 G3 §0 講的「115 個」主體)、**雙重孤兒**(有 case 沒註冊,63 筆,詳見 §2)、**真孤兒**(registry 有、executor 完全沒有任何執行路徑,9 筆,詳見 §1.4)。

統計拆解(逐項相加,無重複計算):
- executor 的 194 個 `case` 值 = studio 16(可達)+ 精靈 178(115 規劃過執行必敗 + 63 雙重孤兒)
- director 5(if-chain,非 `case`,可達)
- db 14(獨立 dispatch 分支,非 `case`,可達;見 §0.5 勘誤——G3 誤植為 13)
- 具名直判 3(`research.deepSearch`/`research.compareModels`/`inspiration.fetch`,可達)
- registry-only 真孤兒 9(media 5 + github/deploy/code 4,不可達)

合計 194+5+14+3+9=**225**。其中**可達 = 16(studio)+5(director)+14(db)+3(具名) = 38**、規劃過執行必敗 115、雙重孤兒 63、真孤兒 9(38+115+63+9=225 ✓)。

G3/N1 原文沿用的「37」是因為 db 當時誤植為 13(少算 1),用本文件核實後的 14 重算,可達總數應為 **38** 而非 37——這是本文件相對 G3/N1 的第二個數字修正,PR 驗收時請用 **38**。

| 工具 | 有 case? | 有註冊(GLOBAL_AGENT_TOOL_REGISTRY)? | gate 路由得到? | 現況 |
|---|---|---|---|---|
| accountant.budget | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.budgetForecast | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.compare | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.estimate | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.forecast | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.savings | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.trend | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.usage | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| accountant.workflowEstimate | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.buildMultiViewBatch | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.buildPrompt | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.labelChecklist | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.nextClarification | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.parseIntent | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.recommendModels | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.summarize | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| anatomySpecialist.verifyResult | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| clarificationEngine.getPattern | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| clarificationEngine.getStats | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| clarificationEngine.identifyIntent | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| clarificationEngine.recordAnswer | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| communityManager.buildPostPlan | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| communityManager.critiqueHook | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| communityManager.formatCaption | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| communityManager.listPlatforms | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| communityManager.nextClarification | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| communityManager.planWeeklySchedule | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| communityManager.recommendHashtags | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| companion.calmBreak | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| companion.clarifyIntent | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| companion.detectMood | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| companion.recommendNextSpirit | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| critic.compare | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| critic.planHandoff | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| critic.review | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| critic.score | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| critic.suggestRewrite | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| featureDiscovery.getInsights | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| featureDiscovery.getRecommendations | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| featureDiscovery.getStats | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| featureDiscovery.recordDiscovery | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| featureDiscovery.recordUsage | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| imageSpecialist.edit | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️見§4:registry此筆requiresHuman:false) |
| imageSpecialist.enhancePrompt | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| imageSpecialist.generate | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️見§4:registry此筆requiresHuman:false) |
| imageSpecialist.getModels | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| imageSpecialist.getTips | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| imageSpecialist.recommendModel | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| imageSpecialist.upscale | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️見§4:registry此筆requiresHuman:false) |
| inspirationSpecialist.analyzeReference | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| inspirationSpecialist.buildMoodBoard | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| inspirationSpecialist.getStyleAtlas | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| inspirationSpecialist.getStyleMixing | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| inspirationSpecialist.getSuggestions | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| inspirationSpecialist.rankStylesByIntent | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| inspirationSpecialist.refinePromptVariants | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| inspirationSpecialist.searchTrends | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| learningSpecialist.explainConcept | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.generateLearningPath | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.getNextLearningStep | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.getQuickTips | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.getTutorial | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.getUserLearningProgress | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.listTutorials | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.recommendForContext | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| learningSpecialist.searchLearningContent | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| legalAdvisor.checkCompliance | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| legalAdvisor.checkLicense | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| legalAdvisor.getGuidelines | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| memoryManager.consolidate | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| memoryManager.getStats | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| memoryManager.searchMemories | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| memoryManager.storeMemory | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| musicSpecialist.buildPrompt | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| musicSpecialist.estimateCost | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| musicSpecialist.generate | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️見§4:requiresHuman:true但不在GENERATION_SLOT_TOOLS) |
| musicSpecialist.generateSoundEffect | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️見§4:requiresHuman:true但不在GENERATION_SLOT_TOOLS) |
| musicSpecialist.getOptions | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| musicSpecialist.getRecentAssets | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| musicSpecialist.getTips | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| musicSpecialist.listEngines | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| musicSpecialist.recommendEngine | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.categorizeAsset | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.createNote | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.deleteNote | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.getAssetStatistics | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.listNotes | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.listUpcoming | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.scheduleEvent | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.scheduleTask | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.searchAssets | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.searchNotes | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.summarizeRecent | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.tagAssets | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.updateNote | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| notesCurator.updateNoteStatus | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| onboardingCoach.getQuickStart | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| onboardingCoach.startOnboarding | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| onboardingCoach.trackProgress | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.analyzeBottlenecks | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.decomposeGoal | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.delegateTask | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.escalateIssue | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.getSpiritStatus | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.getStatistics | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.getTeamStatus | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.queryProgress | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.recommendSpirit | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.retryWithFallback | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| orchestrator.setDeadline | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| planExecutor.controlPlan | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️tRPC spirit.control 有活路) |
| planExecutor.createPlan | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️tRPC spirit.plan 有活路) |
| planExecutor.executeStep | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| planExecutor.getStatus | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️tRPC spirit.status 有活路) |
| planExecutor.getTemplates | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| planExecutor.listRuns | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️tRPC spirit.listRuns 有活路) |
| planExecutor.planFromGoal | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| planExecutor.replanOnFailure | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️tRPC spirit.replan 有活路) |
| planExecutor.runPlan | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗(⚠️tRPC spirit.run 有活路) |
| qualityCoach.compare | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| qualityCoach.diagnose | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| qualityCoach.getTemplates | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| qualityCoach.rewrite | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| securityGuard.checkHealth | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| securityGuard.getRecommendations | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| securityGuard.reportIssue | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| securityGuard.scanSecurity | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| settingsDetail.applyPreset | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.bulkUpdate | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.detectInconsistencies | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.explainSetting | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.getAllSettings | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.getPreferences | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.listPresets | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.previewDiff | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.recommendOptimizations | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.resetPreference | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.searchSettings | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.updatePreference | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| settingsDetail.validatePreference | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| studio.animateSpeaker | Y | Y | Y(studio.前綴) | 可達 |
| studio.changeVoice | Y | Y | Y(studio.前綴) | 可達 |
| studio.cloneVoice | Y | Y | Y(studio.前綴) | 可達 |
| studio.designVoice | Y | Y | Y(studio.前綴) | 可達 |
| studio.enhanceVideo | Y | Y | Y(studio.前綴) | 可達 |
| studio.generate3D | Y | Y | Y(studio.前綴) | 可達 |
| studio.generateAudio | Y | Y | Y(studio.前綴) | 可達 |
| studio.generateImage | Y | Y | Y(studio.前綴) | 可達 |
| studio.generateSfx | Y | Y | Y(studio.前綴) | 可達 |
| studio.generateVideo | Y | Y | Y(studio.前綴) | 可達 |
| studio.generateVoice | Y | Y | Y(studio.前綴) | 可達 |
| studio.isolateAudio | Y | Y | Y(studio.前綴) | 可達 |
| studio.mergeAudios | Y | Y | Y(studio.前綴) | 可達 |
| studio.separateStems | Y | Y | Y(studio.前綴) | 可達 |
| studio.trainLora | Y | Y | Y(studio.前綴) | 可達 |
| studio.transcribe | Y | Y | Y(studio.前綴) | 可達 |
| systemMonitor.getCollaborationStats | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| systemMonitor.getCostAnalysis | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| systemMonitor.getHealth | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| systemMonitor.getPerformanceTrends | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| teachingArchive.search | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| trainingSpecialist.analyzeDataset | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| trainingSpecialist.estimateTraining | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| trainingSpecialist.getModelStatus | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| trainingSpecialist.getTips | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| trainingSpecialist.listMyModels | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| trainingSpecialist.recommendParams | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| videoSpecialist.enhance | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫dispatchFalQueueTask,真生成) |
| videoSpecialist.estimateCost | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| videoSpecialist.generate | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫dispatchFalQueueTask,真生成) |
| videoSpecialist.getModels | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| videoSpecialist.getTips | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| videoSpecialist.imageToVideo | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫dispatchFalQueueTask,真生成) |
| videoSpecialist.lipSync | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫dispatchFalQueueTask,真生成) |
| videoSpecialist.planWorkflow | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| videoSpecialist.recommendModel | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| voiceSpecialist.changeVoice | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫真生成後端,對照studio.changeVoice) |
| voiceSpecialist.cloneVoice | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫真生成後端,對照studio.cloneVoice) |
| voiceSpecialist.designVoice | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫真生成後端,對照studio.designVoice) |
| voiceSpecialist.generateSfx | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫真生成後端,對照studio.generateSfx) |
| voiceSpecialist.generateSpeech | Y | N | N(gate只認studio./director.) | 雙重孤兒(⚠️見§4:呼叫真生成後端,對照studio.generateVoice) |
| voiceSpecialist.getEmotionTags | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| voiceSpecialist.getTips | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| voiceSpecialist.getVoices | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| voiceSpecialist.pickVoice | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| voiceSpecialist.planVoiceover | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| voiceSpecialist.recommendModel | Y | N | N(gate只認studio./director.) | 雙重孤兒 |
| voiceSpecialist.transcribe | Y | N | N(gate只認studio./director.) | 雙重孤兒(低風險,對照studio.transcribe免確認) |
| workflowEngine.controlWorkflow | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| workflowEngine.createTemplate | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| workflowEngine.executeWorkflow | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| workflowEngine.getHistory | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| workflowEngine.getStatus | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| workflowEngine.getTemplates | Y | Y | N(gate只認studio./director.) | 規劃過執行必敗 |
| director.suggestPlan | N(if-chain非switch) | Y | Y(director.前綴) | 可達 |
| director.composeWorkflow | N(if-chain非switch) | Y | Y(director.前綴) | 可達 |
| director.estimateBudget | N(if-chain非switch) | Y | Y(director.前綴) | 可達 |
| director.suggestHandoff | N(if-chain非switch) | Y | Y(director.前綴) | 可達 |
| director.refineWorkflow | N(if-chain非switch) | Y | Y(director.前綴) | 可達 |
| db.list_my_assets | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.search_my_assets | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.get_recent_assets | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.list_my_notes | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.search_my_notes | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.get_calendar_events | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.get_generation_history | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.get_recent_generations | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.list_my_jobs | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.get_active_jobs | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.list_my_models | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.get_my_brain_config | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.list_my_scheduled_jobs | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| db.search_prompts | N(dispatchDatabaseTool獨立分支) | N/A(不在GLOBAL_AGENT_TOOL_REGISTRY) | Y(db.前綴獨立分支) | 可達 |
| research.deepSearch | N(main loop===直判) | Y | Y(第1-3分支直判) | 可達 |
| research.compareModels | N(main loop===直判) | Y | Y(第1-3分支直判) | 可達 |
| inspiration.fetch | N(main loop===直判) | Y | Y(第1-3分支直判) | 可達 |
| media.transcribe | N | Y | N(非studio/director前綴,落入第6分支外部registry預設空) | 真孤兒(零執行路徑) |
| media.caption | N | Y | N(非studio/director前綴,落入第6分支外部registry預設空) | 真孤兒(零執行路徑) |
| media.storyboard | N | Y | N(非studio/director前綴,落入第6分支外部registry預設空) | 真孤兒(零執行路徑) |
| media.summarizePdf | N | Y | N(非studio/director前綴,落入第6分支外部registry預設空) | 真孤兒(零執行路徑) |
| media.extractPrompt | N | Y | N(非studio/director前綴,落入第6分支外部registry預設空) | 真孤兒(零執行路徑) |
| github.review | N | Y | N(非studio/director前綴,落入第6分支外部registry預設空;實務上ai.ts:2500會在call前攔截改走claudeCode交接,不會真的走到這裡) | 真孤兒(零執行路徑,但有ai.ts旁路) |
| github.pr.create | N | Y | N(同上) | 真孤兒(零執行路徑,但有ai.ts旁路) |
| deploy.preview | N | Y | N(同上) | 真孤兒(零執行路徑,但有ai.ts旁路) |
| code.modifyWithClaudeCode | N | Y | N(同上) | 真孤兒(零執行路徑,但有ai.ts旁路) |

### 1.1 備註:真孤兒 9 筆裡的兩種子類

- `media.*` 5 個:`agentPlanner.ts:529-530` 的 prompt 仍教 LLM 串 `media.transcribe → media.caption`,但這兩者(以及 storyboard/summarizePdf/extractPrompt)**完全沒有任何後備路徑**——不是 ai.ts 攔截、不是 claudeCode 交接,單純打進 `executeOrbToolCalls` 第 6 分支(`ORB_TOOL_REGISTRY_JSON`,預設空陣列)→ `tool-not-found`。
- `github.review`/`github.pr.create`/`deploy.preview`/`code.modifyWithClaudeCode` 4 個:雖然在 `executeOrbToolCalls` 內部同樣沒有任何 case,但 `ai.ts:2500` 在**呼叫 `executeOrbToolCalls` 之前**就已經偵測這幾個工具名並轉走 `createOrbCodeTask`(claudeCode 任務交接),所以對使用者而言這條路徑實際上是活的——只是不經過本文件盤點的 executor 路由,盤點時不能誤判「這 4 個也是死的」。

---

## 2. 63 筆 registry 缺口清單(逐一工具名,依家族分組)

> 這是「有 case、沒註冊」的完整清單——`comm -23 <(sort case 值) <(sort registry 值)` 直接算出,63 筆,與 N1 決策卡 1 的家族加總(11+9+12+9+3+4+7+3+4+1=63)**精確吻合**。

**orchestrator(總總,11 個)**:analyzeBottlenecks、decomposeGoal、delegateTask、escalateIssue、getSpiritStatus、getStatistics、getTeamStatus、queryProgress、recommendSpirit、retryWithFallback、setDeadline

**videoSpecialist(影影,9 個)**:enhance、estimateCost、generate、getModels、getTips、imageToVideo、lipSync、planWorkflow、recommendModel

**voiceSpecialist(聲聲,12 個)**:changeVoice、cloneVoice、designVoice、generateSfx、generateSpeech、getEmotionTags、getTips、getVoices、pickVoice、planVoiceover、recommendModel、transcribe

**learningSpecialist(學學,9 個)**:explainConcept、generateLearningPath、getNextLearningStep、getQuickTips、getTutorial、getUserLearningProgress、listTutorials、recommendForContext、searchLearningContent

**communityManager(群群,7 個)**:buildPostPlan、critiqueHook、formatCaption、listPlatforms、nextClarification、planWeeklySchedule、recommendHashtags

**securityGuard(安安,4 個)**:checkHealth、getRecommendations、reportIssue、scanSecurity

**companion(暖暖,4 個)**:calmBreak、clarifyIntent、detectMood、recommendNextSpirit

**onboardingCoach(帶帶,3 個)**:getQuickStart、startOnboarding、trackProgress

**legalAdvisor(律律,3 個)**:checkCompliance、checkLicense、getGuidelines

**teachingArchive(1 個)**:search

11+9+12+9+7+4+4+3+3+1 = **63** ✓

---

## 3. gate 修復精確規格

### 3.1 現況(修前)

```ts
// server/services/agentToolExecutor.ts:706-728
// ── studio.* 生成工具：橋接到 dispatchFalQueueTask / SunoClient ──
// ── director.* 規劃工具：橋接到 director.askForStudioPlan ──
if (call.name.startsWith("studio.") || call.name.startsWith("director.")) {
  if ((opts.blockedTools ?? []).includes(call.name)) {
    // ...tool-blocked-by-user...
  }
  const bridgeResult = call.name.startsWith("studio.")
    ? await dispatchStudioTool(call, opts)
    : await dispatchDirectorTool(call, opts);
  // ...
}
```
- **判斷式**在 `:708`。
- **三元路由選擇式**在 `:726-728`。

行號經本次獨立覆核(不是轉述 N1,是重新 `Read` 該區塊逐行核對)**完全一致**,可信。

### 3.2 修法(兩處都要動,缺一個都是假修復)

**第一處,判斷式(:708)**——加入 `isKnownGlobalAgentTool` 放行:
```ts
if (
  call.name.startsWith("studio.") ||
  call.name.startsWith("director.") ||
  isKnownGlobalAgentTool(call.name)
) {
```
`isKnownGlobalAgentTool` 定義在 `shared/global-agent-tools.ts:1836`,已存在、可直接 import 複用(檔案頂部需補一行 import)。

**第二處,三元路由選擇式(:726-728)**——**這是本文件與 N1 都要強調的關鍵**:目前的三元式用「是不是 `studio.` 開頭」分流到兩個函式,但 178 個精靈 case 全部寫在 `dispatchStudioTool` 裡(這個函式名字雖然叫「studio」,但其實是所有精靈工具的巨型 switch 所在地)。若只放寬判斷式、不改這行,`critic.review` 會被送去 `dispatchDirectorTool`——那裡只認得 5 個 director 工具,結果一樣失敗(只是錯誤訊息從 `tool-not-found` 變成 `unknown-studio-tool` 或類似,**外觀像修好了、其實還是全部失敗**)。正確修法:
```ts
const bridgeResult = call.name.startsWith("director.")
  ? await dispatchDirectorTool(call, opts)
  : await dispatchStudioTool(call, opts); // 含 studio.* 與 178 個精靈前綴
```
即:**判斷「是不是 director」而非「是不是 studio」**,其餘(含 `studio.*` 本身)一律進 `dispatchStudioTool`。

### 3.3 會不會誤放危險工具?(逐一核對)

- `github.*`/`deploy.*`/`code.*`(4 個 `high`/`requiresHuman:true`)**在整份 `agentToolExecutor.ts` 裡沒有任何 case**(§1.1 已確認,grep 0 筆命中)。就算 gate 誤放行,`dispatchStudioTool` 的 switch 走到 `default` fallback(`unknown-studio-tool` 一類錯誤),**不會執行任何危險操作**——這條路徑本來就是靠 `ai.ts:2500` 在更早的階段攔截走 claudeCode 交接,不受這次 gate 修法影響。
- `media.*`(5 個,medium/低風險唯讀類)同樣在 `agentToolExecutor.ts` 裡沒有任何 case,誤放行也只會落到 `unknown-studio-tool`。
- 63 個「未註冊」精靈工具裡,**41 個是純函式/唯讀查詢**(orchestrator 的調度資料、companion/onboardingCoach/legalAdvisor/securityGuard/communityManager/learningSpecialist/teachingArchive——本次逐檔 `grep "db\.\|fetch(\|INSERT\|UPDATE\|DELETE"` 對 `companionTools.ts`/`onboardingCoachTools.ts`/`legalAdvisorTools.ts`/`communityManagerTools.ts` **全部 0 命中**,確認無外部呼叫、無資料庫寫入),`securityGuardTools.ts` 四個 case 逐一讀過(N1 已核對,本次未重讀)也是唯讀健檢/寫一筆 issue 報告,無破壞性動作。
- **但另外 9 個(videoSpecialist 4 個 + voiceSpecialist 5 個)不是純函式——這是本文件的新發現,見 §4,這 9 個工具需要特別的 riskLevel/requiresHuman 設定,不能沿用「同家族一致」的預設。**

結論:gate 修法本身(判斷式+三元式)**不會**讓 `github`/`deploy`/`code` 這類真正危险的工具變得可執行(它們根本沒有 case);但 gate 修法會讓 178 個精靈工具第一次真正可執行,其中 9 個(videoSpecialist 4 + voiceSpecialist 5)若沒有正確設定 `requiresHuman`/`GENERATION_SLOT_TOOLS`,會產生「無確認、無額度限制就能觸發真實付費生成」的新風險——這不是「誤放行原本就危險的工具」,而是「新開放的 63 筆裡,有 9 筆本身就該歸類為跟 studio.* 同等級的中風險生成工具,規格上要一併設對」。

---

## 4. 危險工具清單(gate 修好後必須仍走確認閘)

### 4.1 既有 25 個 `requiresHuman:true`(修 gate 不影響這些的閘門邏輯,僅供對照)

`riskLevel:"high"` 4 個 + `studio.trainLora`(高):`github.review`、`github.pr.create`、`deploy.preview`、`code.modifyWithClaudeCode`、`studio.trainLora`——**這 5 個本身就沒有可達的 case(前 4 個)或已經可達且本來就正確要求確認(trainLora)**,gate 修法不影響其安全性。

其餘 20 個 `riskLevel:"medium"` + `requiresHuman:true`:`studio.generateImage`、`studio.generateVideo`、`studio.enhanceVideo`、`studio.generateAudio`、`studio.generateSfx`、`studio.cloneVoice`、`studio.designVoice`、`studio.separateStems`、`studio.isolateAudio`、`studio.mergeAudios`、`studio.changeVoice`、`studio.animateSpeaker`、`studio.generateVoice`、`studio.generate3D`、`musicSpecialist.generate`、`musicSpecialist.generateSoundEffect`、`planExecutor.planFromGoal`、`planExecutor.createPlan`、`planExecutor.runPlan`、`planExecutor.replanOnFailure`——這些 gate 修好後**仍會**先過 `dispatchStudioTool:1001` 的 `if (def.requiresHuman && !opts.approved)` 閘門,沒有被繞過的風險。

### 4.2 新發現:63 筆裡真正需要當「危險工具」對待的 9 個(videoSpecialist 4 + voiceSpecialist 5)

逐一讀 `videoSpecialistTools.ts`/`voiceSpecialistTools.ts` 確認(`grep "dispatchFalQueueTask"`):

| 工具 | 對照的 studio.* 等價物(risk 應比照) | 底層呼叫 | 目前風險(若照「同家族一致」註冊成 low) |
|---|---|---|---|
| videoSpecialist.generate | studio.generateVideo(medium/requiresHuman:true) | `dispatchFalQueueTask`(videoSpecialistTools.ts:317-318) | 無確認+無額度即可觸發真實影片生成 |
| videoSpecialist.imageToVideo | studio.generateVideo(image-to-video 分流) | `dispatchFalQueueTask`(:511-512) | 同上 |
| videoSpecialist.enhance | studio.enhanceVideo(medium/requiresHuman:true) | `dispatchFalQueueTask`(:636-637) | 同上 |
| videoSpecialist.lipSync | studio.animateSpeaker(medium/requiresHuman:true) | `dispatchFalQueueTask`(:178) | 同上 |
| voiceSpecialist.generateSpeech | studio.generateVoice(medium/requiresHuman:true) | 走 `spiritTools/voiceSpecialistTools.ts` → 真實 TTS 後端(ElevenLabs 等) | 無確認+無額度即可觸發真實語音生成 |
| voiceSpecialist.cloneVoice | studio.cloneVoice(medium/requiresHuman:true) | 同上 | 同上 |
| voiceSpecialist.designVoice | studio.designVoice(medium/requiresHuman:true) | 同上 | 同上 |
| voiceSpecialist.changeVoice | studio.changeVoice(medium/requiresHuman:true) | 同上 | 同上 |
| voiceSpecialist.generateSfx | studio.generateSfx(medium/requiresHuman:true) | 同上 | 同上 |

**建議**:這 9 個在補進 `GLOBAL_AGENT_TOOL_REGISTRY` 時,`riskLevel:"medium"`、`requiresHuman:true`,並且要**同步把這 9 個工具名加進 `agentToolExecutor.ts:15-31` 的 `GENERATION_SLOT_TOOLS` 這個 `Set`**——否則就算 `requiresHuman:true` 擋住了未經同意的呼叫,通過確認後仍然**不會被算進每日生成額度**(`GENERATION_SLOT_TOOLS` 是硬編碼字串 Set,只比對字面值,不會因為 riskLevel 相同就自動涵蓋新工具名)。

其餘 54 個(63−9)可比照 N1 建議「跟同家族既有低風險筆一致」的預設,本次逐檔 grep 確認無資料庫寫入/外部呼叫,信心足夠不需逐筆人工覆核(companion/onboardingCoach/legalAdvisor/communityManager/learningSpecialist/teachingArchive 共 27 個 + orchestrator 11 個 + securityGuard 4 個 + videoSpecialist/voiceSpecialist 各自剩下的 5+7=12 個metadata類:videoSpecialist 的 estimateCost/getModels/getTips/planWorkflow/recommendModel、voiceSpecialist 的 getEmotionTags/getTips/getVoices/pickVoice/planVoiceover/recommendModel/transcribe——這 12 個是純查詢/推薦函式,voiceSpecialist.transcribe 額外比照 `studio.transcribe` 給 low/免確認)。

### 4.3 新發現:已註冊、gate 修好後才首次生效的既有 registry bug(不在 63 筆範圍,但同一 PR 必須順手修)

| 工具 | registry 現況 | 問題 |
|---|---|---|
| imageSpecialist.generate | `riskLevel:"medium"`, `requiresHuman:false`(global-agent-tools.ts:903-905) | 呼叫 `dispatchGenerationJob`(真實出圖),但 `requiresHuman:false`——gate 修好後**不需要使用者確認**就能觸發生成 |
| imageSpecialist.edit | 同上(:917-919) | 同上 |
| imageSpecialist.upscale | 同上(:930-932) | 同上 |
| musicSpecialist.generate | `requiresHuman:true`(正確) | 但**不在 `GENERATION_SLOT_TOOLS`**,gate 修好後通過確認即可執行,但不耗每日生成額度 |
| musicSpecialist.generateSoundEffect | 同上 | 同上 |

這 5 個從系統上線至今因為 gate 擋著、`dispatchStudioTool:992` 的 `studio-tool-not-registered` 二次檢查也還沒被觸發到——不,等等,這 5 個是**已註冊**的(`def` 存在),之所以現在打不到是因為外層 gate(:708)直接擋在 `dispatchStudioTool` 之外,**從未執行到 `dispatchGenerationJob`**。gate 修好後這 5 個 bug 才會**第一次**真正影響行為,建議在同一個 PR 裡把 `imageSpecialist.generate/edit/upscale` 的 `requiresHuman` 改成 `true`,並把 `imageSpecialist.generate/edit/upscale`、`musicSpecialist.generate/generateSoundEffect` 五個都加進 `GENERATION_SLOT_TOOLS`。

---

## 5. 可達性測試規格(不 mock `executeOrbToolCalls`)

延續 G3/N1 的教訓——`server/services/__tests__/agentToolExecutor.test.ts` 目前只有 42 行、只測 `assertAllowedEndpoint`,完全沒測路由層(本次重讀確認,內容與 N1 描述一致)。新測試檔規格:

```ts
// server/services/__tests__/executeOrbToolCalls.reachability.test.ts
import { describe, it, expect, vi } from "vitest";
import { executeOrbToolCalls } from "../agentToolExecutor";

// 只 mock 最外層的「真的會花錢/連外部 API」的邊界(dispatchFalQueueTask、SunoClient、
// invokeLLM、Perplexity client),不 mock executeOrbToolCalls 本身、不 mock 任何
// dispatch*Tool 中介函式——這是 G3 §0 指出既有測試「mock 掉執行器測不到斷點」的
// 反面教材，本測試刻意反過來做。
vi.mock("../falDispatcher", () => ({
  dispatchFalQueueTask: vi.fn().mockResolvedValue({ request_id: "test-req", modelId: "test-model" }),
}));

const baseOpts = {
  tools: [],
  userId: 1,
  userRole: "user",
  approved: true, // 先測 approved=true 路徑，requiresHuman 的閘門另開一組 approved=false 案例
  onAuditEvent: vi.fn(),
};

describe("executeOrbToolCalls reachability (locks in gate fix, no mocking of the executor itself)", () => {
  // 對 63 個新註冊工具，每個家族取 1-2 個代表 case，斷言不再回
  // tool-not-found / studio-tool-not-registered / director-tool-not-registered
  const representativeCalls = [
    "orchestrator.getTeamStatus",
    "orchestrator.getSpiritStatus",
    "videoSpecialist.getModels",       // 純查詢，安全跑到底
    "voiceSpecialist.getVoices",       // 純查詢，安全跑到底
    "learningSpecialist.getQuickTips",
    "legalAdvisor.getGuidelines",
    "securityGuard.checkHealth",
    "communityManager.listPlatforms",
    "onboardingCoach.getQuickStart",
    "companion.detectMood",
    "teachingArchive.search",
  ];

  it.each(representativeCalls)("%s is routed past the gate (not tool-not-found)", async (name) => {
    const result = await executeOrbToolCalls({
      ...baseOpts,
      calls: [{ name, args: {} }],
    });
    expect(result[0].error).not.toBe("tool-not-found");
    expect(result[0].error).not.toBe("studio-tool-not-registered");
    expect(result[0].error).not.toBe("director-tool-not-registered");
  });

  // 危險路徑：videoSpecialist.generate / voiceSpecialist.generateSpeech 等 9 個
  // 若正確註冊 requiresHuman:true，approved:false 時必須回 confirmation-required，
  // 不能真的打到 dispatchFalQueueTask（mock 的 spy 斷言 not.toHaveBeenCalled）
  it("videoSpecialist.generate requires confirmation when not approved", async () => {
    const { dispatchFalQueueTask } = await import("../falDispatcher");
    const result = await executeOrbToolCalls({
      ...baseOpts,
      approved: false,
      calls: [{ name: "videoSpecialist.generate", args: { prompt: "test" } }],
    });
    expect(result[0].ok).toBe(false);
    expect(result[0].error).toBe("confirmation-required");
    expect(dispatchFalQueueTask).not.toHaveBeenCalled();
  });

  // 額度閘門：確認補進 GENERATION_SLOT_TOOLS 後，approved:true 仍會走額度檢查
  // （可用 checkAndConsumeQuota 的既有測試 double 或直接斷言連續呼叫超過每日上限後
  // 回 generation-quota-exceeded，比照 studio.generateImage 現有測試手法）

  // 反向確認：github.*/deploy.*/code.* 4 個即使 gate 誤放行也不會執行危險動作
  it.each(["github.review", "deploy.preview", "code.modifyWithClaudeCode"])(
    "%s still has no dangerous execution path even if gate matches",
    async (name) => {
      const result = await executeOrbToolCalls({
        ...baseOpts,
        calls: [{ name, args: {} }],
      });
      // 落在 dispatchStudioTool 的 default fallback，不是危險操作，但也不是成功執行
      expect(result[0].ok).toBe(false);
    }
  );
});
```

要點:
- **只 mock 外部/花錢邊界**(`dispatchFalQueueTask`/`SunoClient`/`invokeLLM`/Perplexity client),不 mock `executeOrbToolCalls` 本身、不 mock `dispatchStudioTool`/`dispatch<Family>Tool`——這樣測試才能真的跑過 gate 判斷式與三元路由選擇式。
- DB 相關案例(如果代表工具用到 db 查詢)在無 DB 的測試環境會自然得到「DB unavailable」一類的優雅降級錯誤——只要不是 `tool-not-found`/`*-not-registered`,就證明有到達正確的 dispatch 函式,不需要整條 mock 到底(對齊 G3 探測手法)。
- `approved:false` 案例專門鎖住 9 個新發現的中風險生成工具,確保修 gate 不會意外繞過確認閘。
- 額度閘門測試建議另開一組,直接對 `GENERATION_SLOT_TOOLS` 補登後的行為斷言(呼叫超過每日上限後應該擋下)。

---

## 6. 未查證部分(誠實列出)

- §4.2 的 9 個工具、§4.3 的 5 個既有 bug,只讀了 `videoSpecialistTools.ts`/`voiceSpecialistTools.ts`/`imageSpecialistTools.ts` 的呼叫點(確認有 `dispatchFalQueueTask`/`dispatchGenerationJob`),**未逐一核對每個函式內部是否有 executor 層級以外的其他保護**(例如 tRPC router 共用實作那邊是否有獨立的確認流程);若這些 spiritTools 函式本來就是給某個已審過確認流程的 tRPC router 共用,可能該 router 端已經有另一層防護,本文件只確認了「executor 直呼路徑本身沒有」。
- §1 的「38 vs 37」可達總數修正,只基於 db 從 13→14 的算術重算,未重新確認 G3/N1 原文「37」是否還疊加了其他我沒發現的計數差異——本次交叉核對到位的只有 db 這一項。
- §3.3「41 個純函式無風險」的結論,對 `learningSpecialistTools.ts`/`onboardingCoachTools.ts`/`legalAdvisorTools.ts`/`communityManagerTools.ts`/`companionTools.ts` 只做了 `grep "db\.\|fetch(\|INSERT\|UPDATE\|DELETE"` 關鍵字掃描,未逐行讀完整個檔案本體(例如可能有透過其他 helper 間接寫入、或呼叫未被這組關鍵字捕捉到的網路請求寫法如 `axios`/`got`)。
- §5 的測試規格是**草案**,未實際寫入 repo 執行——`vi.mock("../falDispatcher", ...)` 的 mock 路徑/介面是否精確符合現有型別簽章需要實作時對照 `falDispatcher.ts` 真實 export 逐一核對(本文件只確認了函式名稱與呼叫位置,未讀完整簽章)。
- `allowedArgsSchema` 具體欄位(63 個新工具各自要填什麼)完全未觸碰,只確認了 riskLevel/requiresHuman 這兩個安全相關欄位的建議值。
- `research.deepSearch`/`research.compareModels`/`inspiration.fetch`/director 5 個工具雖標「可達」,本次只核對其在 main loop 的直接判斷邏輯位置存在,未重新驗證其下游服務(Perplexity/invokeLLM)在當前環境是否真的可呼叫成功(端到端成功路徑不在本次盤點範圍)。
