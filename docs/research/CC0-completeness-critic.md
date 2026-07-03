# CC0 — 完整性批判(研究缺口/矛盾/未驗證盤點)
- 產生日期:2026-07-03
- 依據 commit:812fdb
- 性質:對 A-Y 全 corpus 做完整性/一致性批判,非重做稽核

> 方法聲明:本檔逐一讀畢 `00-discussion-taskcards.md`、`00-devzone.md`、`X0-carpet-scan-synthesis.md`、
> `Y0-frontend-carpet-scan-synthesis.md`、`PROGRESS.md`,以及本波新補完的 `CC1`〜`CC5` 五份確認發現,並用
> `grep`/`ls` 對 `server/routers/*.ts`、`server/services/*.ts`、`client/src/pages/*.tsx` 三個目錄做逐檔清單
> 比對,找出「corpus 索引裡完全沒被提及,或只被文件當附帶引用、從未被當主稽核對象讀過」的檔案。任何我沒有親自
> 讀取原始碼驗證的判斷,一律只引用既有文件的陳述,不臆測檔案內部行為;找不到佐證的一律寫「需再查」。

---

## 1. 覆蓋缺口(哪些子系統/檔案/北極星支柱從未被任何一波深挖)

### 1.1 方法:全檔案清單 vs 已出現於 corpus 的檔名

用 `grep -rl <filename> docs/research/` 逐一核對 `server/routers/*.ts`(76 個路由檔)、`server/services/*.ts`
(約 120 個服務檔)、`client/src/pages/*.tsx`(52 頁)清單後,確認以下檔案**完全零命中或僅出現於「資料字典/
產品策略」性質的文件**(即從未被當成主稽核對象逐行讀過、也沒有任何安全/計費/正確性角度的檢視):

**A. 完全零命中(corpus 從未提及檔名,含 CC0 本身以外任何檔案)**:
- `server/routers/auth.ts` — 登入/session 核發邏輯,全站唯一的認證入口,**目前沒有任何一份文件讀過這個檔案**。
  對照本波 CC5 才確認 `langsmith.ts` 8/9 procedure 授權分級錯誤、taskcards 已列出 S-04〜S-18 一串授權/RCE 級
  發現,`auth.ts` 本身反而是空白——這是目前 corpus 最大的單一盲區。
- `server/routers/export.ts` — 對照 K3(`docs/research/K3-data-integrity.md`)已定性「GDPR 刪除/匯出鏈整條必炸」
  (USER_OWNED_TABLES 缺漏導致刪除交易回滾),但 K3 的證據鏈是否直接涵蓋 `export.ts` 本身的匯出邏輯(而非只是
  刪除鏈)**未在任何文件中確認**——`export.ts` 檔案本身從未被讀過。
- `server/routers/dashboard.ts` — 僅在 S5(北極星 telemetry,產品策略文件)提及兩個 query 名稱作為「資料已備妥」
  的佐證,**從未有安全/正確性角度的逐行稽核**。
- `server/routers/orbGuide.ts`、`server/routers/schedule.ts` — 全站零命中,連字典類文件都未提及。
- `server/routers/orbSchedulerRouter.ts`、`server/routers/orchestrationRunsRouter.ts`、
  `server/routers/agentModelPicksRouter.ts` — 僅出現於 `H4-data-dictionary-api.md` 的表格式資料字典(欄位/
  索引/讀寫方清單),**不含任何邏輯正確性或授權檢查**。
- `server/routers/news.ts` — 僅 `01-features.md` 提過一行「本頁唯一落 DB 的資料」,無安全/計費檢視。

**B. 只被「產品策略/規劃」文件觸及,從未經過對抗式程式碼稽核**:
- `server/routers/plans.ts`、`server/routers/credits.ts` — 僅 `S2-credits-team-pool.md`(產品策略,自陳「不寫
  程式碼,只設計」)與 `H1-model-costs.md`(資料來源列表)引用,取得的是「這裡有 pricingCatalog/myBalance
  procedure」這種結構性描述,**沒有任何文件驗證這兩個計費核心路由本身的授權/輸入驗證/是否有速率限制**。考慮到
  taskcards 計費群組(B-01〜B-20)已列出 20 條計費失效,而 `credits.ts`/`plans.ts` 是「使用者看到自己餘額/方案」
  的唯一入口,這是計費主題下一個明顯的稽核空白。
- `server/routers/workflow.ts`(`user_workflows` 表)— 僅 M3(規劃文件)與 G1(座艙盤點)提及,定性為「座艙步驟
  個人化排序,非通用自動化編排器」,**未經任何授權/輸入驗證檢查**。

**C. 只被「順帶提及」而非主稽核對象(在別的檔案的稽核過程中被引用一兩行,但本身邏輯從未逐行讀過)**:
- `server/routers/spiritRouter.ts` — 這是 CC3 本波發現的 C1(`getFalModelById` 跨類別碰撞導致 12+ 個精靈的
  預設 LLM 呼叫 100% 失敗)實際觸發入口,V3 也指出它與 `videoStudio.ts` 共用「三套 SSRF guard 中最弱的一套」
  (`V3-security-middleware-deepdive.md:150-182`);但 `spiritRouter.ts` 檔案本身(226 行,`spirit.invoke/plan/
  run/status/control/replan/listRuns/runStep` 全 8 個 procedure)**從未作為單一目標做完整逐行稽核**——它是三份
  不同文件(CC3/V3/E/G3)各自只看一小段的檔案,沒有人讀過它的全貌。鑑於它是「15 位精靈可直接呼叫 fal 模型」的
  唯一入口,建議列為下一波候選。
- `server/services/orbBudgetGuard.ts`、`server/services/orbCostGuard.ts`、`server/services/orbQuota.ts` —
  這三個檔名在計費相關文件中頻繁被提及(`orbQuota.ts` 16 處、`orbCostGuard` 11 處、`orbBudgetGuard` 4 處),
  但均是「某段程式碼呼叫了 XXX 的某個函式」式的旁證引用,**沒有一份文件把這三個檔案本身當作主稽核目標逐行讀過**
  ——即「光球端的預算/成本/配額閘門本身是否正確」這個問題,目前只有零散側面證據,沒有直接答案。這與 taskcards
  B-03/CC5 發現 2(sense.ts LLM 呼叫無節流)的主題高度相關,值得優先補讀。
- `server/services/connectionService.ts`、`server/services/secretCrypto.ts` — 是 S-17(Google Drive OAuth
  token 明文,`X10-connectors-deepdive.md`)與 Z1(MCP 策略,提及「與現有 secretCrypto.ts 衝突最小」)反覆引用的
  加密基礎設施,**兩檔案本身從未被獨立稽核**——corpus 目前只知道「Notion 走了 encryptSecret,Drive 沒走」這個
  對照結果,不知道 `secretCrypto.ts` 加密實作本身的金鑰管理/演算法選擇是否有問題。鑑於 SYS-01(自建 MCP)已把
  這兩個檔案列為「硬前置」,建議列為北極星前置的優先候選。
- `server/services/teachingArchiveRag.ts`、`server/services/teachingArchiveSearch.ts` — 與 NSX-1(教材文字類型
  永不向量化)高度相關的 RAG 核心檔案,目前只在 R2(rag-memory-deepdive)等文件中被側面提及,**未見任何文件把
  這兩個檔案本身的檢索邏輯正確性/注入面當主要目標**。既然北極星① 明訂「連自己的資料庫」,而 RAG 檢索品質是這根
  支柱的核心,這是一個與產品承諾直接相關卻尚未深挖的檔案。

**D. `worldStoryboard.ts` 路由檔的特殊情況**:此檔在 CC1(AnimationStudio 前端)、X1(spine 深挖引用
`video-state-machines.ts` 但非此檔本身)、Y2(DirectorAI 前端)共 15 處文件中被引用,是北極星「分鏡」支柱的
資料層核心(`seedSkeleton`/`planPipeline`/`queueForVideo`/`createFromSegments`/`updateJob` 等 mutation),但
**沒有任何一份文件把 `server/routers/worldStoryboard.ts` 本身列為主稽核目標從頭到尾讀過**——目前所有結論都是
「從呼叫端往回看某個特定 mutation」,例如 CC1 只確認了 `update`/`seedSkeleton`/`planPipeline` 幾個 mutation
的行為,該檔案是否還有其他 mutation(例如刪除/匯出)存在未被檢視的授權缺口,**需再查**。

### 1.2 client 端未觸及的頁面

Y1〜Y10 覆蓋了 10 個前端主題(flowguide/DirectorAI/VideoCockpit/AnimationStudio(CC1 重跑)/orb-client-security/
connectors/learnhub-teaching/projects-assets/image-audio-studio/shell-routing-onboarding),對照 52 個
`client/src/pages/*.tsx`,以下頁面**從未被任何一波前端深挖觸及**(僅列產品/安全意義較高者,非窮舉):

| 頁面 | 為何值得關注 |
|---|---|
| `AdminPage.tsx` | 全站唯一的管理後台入口,U5 只深挖了其中的 skill tab,其餘分頁(costs/api/activity 等)**前端邏輯本身**未經稽核——僅知道對應後端 procedure 授權分級(如本波 CC5 的 langsmith 發現) |
| `CreditsInfoPage.tsx`、`VaultPage.tsx`、`TeamsPage.tsx` | 對應 §1.1 提到的 `credits.ts`/`plans.ts`/`vault.ts` 後端缺口,前端同樣未經檢視,計費/團隊池主題前後端都是空白 |
| `ModelsPage.tsx`、`LoraTrainer.tsx`(前端頁) | 後端 `models.ts` 已被 X17 定性為 critical IDOR + 零計費(teamModels 洩漏、create/retrain 零限流零計費),但**前端頁面本身**是否有對應的誤導性 UI(例如假裝已計費、假裝已限流)未經 Y 波驗證——與 Y0 對其他頁面「前端坐實後端可達性」的做法不一致,是同類覆蓋不完整 |
| `PromptLibraryPage.tsx`、`PromptCollectionPage.tsx` | 對應本波 CC5 剛稽核的後端 `promptLibrary.ts`/`promptCollection.ts`,前端呼叫是否正確傳遞 owner 範圍、UI 是否誤導用戶「已綁定專案」,未經檢視 |
| `MyBrainPage.tsx`、`AiBrainSettings.tsx`、`AiBrainPipelinePage.tsx` | 對應 A-cost-integrations 提及的「大腦 4 slot 預設 Opus 檔=最大 LLM 成本槓桿」,前端設定頁本身是否讓使用者充分感知成本影響,未經檢視 |
| `Playground.tsx`、`FocusFlowPage.tsx`、`TutorialOverviewPage.tsx`、`UnorganizedArea.tsx`、`LightOrbCreationStudio.tsx` | 全站零深挖紀錄,連是否為死頁/孤兒頁都未確認 |

### 1.3 北極星支柱層級的缺口總結

對照 `M0-solution-blueprint.md` 定義的七支柱(依 Y0/devzone 引用重建,非直接讀 M0 全文,**M0 原文本身在本次
未重讀,若需要逐條核對七支柱原文措辭需再查**):

- **腳本→分鏡→逐幕→拼接→輸出→打包**:前端(Y0)+ 本波 CC1(AnimationStudio)已覆蓋得相當完整,是目前 corpus
  覆蓋最紮實的支柱。
- **AI 讀單一專案全程引導**:資料層(NS-09)、旗標層、執行層三處斷點已由 Y0/CC1 確認,但 `spiritRouter.ts`
  (真正執行「AI 呼叫模型」那一步的入口)本身未被完整讀過(見 1.1-C),形成「知道斷在哪、但不知道真正執行時
  還有沒有其他坑」的半完整狀態。
- **快速素材管理 / 目標管理**:Y8 已確認皆為「從未建模」,覆蓋完整。
- **自己的資料庫(教材/LearnHub)**:LearnHub 前端可達性(Y7)+ 後端 CRUD(X6)已覆蓋,但 RAG 檢索本身
  (`teachingArchiveRag.ts`/`teachingArchiveSearch.ts`)未被當主目標讀過(見 1.1-C)——只知道「text 教材不會
  向量化」(NSX-1),不知道「已向量化的內容,檢索邏輯本身是否正確」。
- **自己的工具/自動化(連接器)**:Y6(前端)+ X10(drive.ts 後端)已覆蓋,但底層加密/連線基礎設施
  (`connectionService.ts`/`secretCrypto.ts`)未被當主目標讀過(見 1.1-C),是 SYS-01 明訂的硬前置卻尚缺的一塊。
- **計費作為橫向支柱**(非 M0 七支柱之一,但是貫穿全站的隱含承諾):`credits.ts`/`plans.ts`/`auth.ts` 三個
  「使用者如何得知/管理自己的餘額與身份」核心檔案完全空白,是計費主題目前最大的單點缺口。

---

## 2. 未驗證主張(仍屬 wave 內部初篩、未經對抗式驗證,建議優先補驗,依風險排序)

以下項目在來源文件中**明確自陳**「wave 內部初篩,未經 Y0/X0 二次對抗驗證」或「未在本檔驗證」,但其嚴重度標記
若為 critical/high,一旦坐實影響面不小,值得優先排入下一輪驗證:

1. **`DirectorAI.tsx:2385,3406-3412,2760-2809` — DirectorAI 核心操作無 projectId 範疇化**
   (northstar-flow, critical, `Y0` §2.1)。這是斷點 1(Y0 §5)的核心證據,但標記為「wave 初篩」而非
   Y0 二次覆核。鑑於整個 NS-09(地基遷移卡)都建立在這個判斷上,建議優先對抗式覆核。
2. **`VideoCockpit.tsx:165-172` — 「建立空白專案」單一動作遺棄當前專案**(northstar-flow, critical, wave 初篩)。
   若坐實,是使用者資料遺失級的 UX 缺陷,優先度應提升到與 Y0 §5 三大斷點同級,但目前只是初篩未覆核。
3. **`videoFlags.ts:67` — `ENABLE_PROJECT_HUB` 生產 OFF、dev 預設 ON**(northstar-flow, critical, wave 初篩)。
   這條若不準確會直接影響「五步引導到底能不能被使用者看到」的判斷,建議與 NS-01/NS-08 一起覆核旗標實際值
   (`.env`/Railway 環境變數需再查——這部分**只能** repo 內讀到程式碼預設值,實際部署值仍在待補清單內)。
4. **`PageAgentContext.pendingConfirmation` 單一物件非佇列,可能覆蓋確認卡**(client-security, wave 初篩,
   `Y0` §2.4)。與已確認的 `requireConfirmation:false` 硬編碼(S-29/S-30)同屬「確認閘失效」主題,若坐實會再添
   一條繞過確認的路徑,建議優先覆核(同一 cluster 內已有 critical 先例,關聯性高)。
5. **`PageAgentContext navigate` 未走白名單**(client-security, wave 初篩)。與 CC2 發現 5(v3 navigate 目的地
   缺 `isSafeInternalPath` 檢查)高度相關——如果 client 端本身也沒有白名單,則 shared 層的缺口會是唯一防線,
   兩者疊加的實際暴露面比單獨看任一份文件都大,建議合併覆核。
6. **`context 欄位把選取文字未結構化拼入 LLM prompt`**(client-security/injection, wave 初篩)。與已確認的
   I-04(agentPlanner 讀未清洗文字的 urgent-skip 指令,W8)、CC4 附錄提及的 execute_task 未列入
   `ORB_DESTRUCTIVE_ACTIONS` 屬同一主題群(「使用者可控文字被當系統權威事實」),值得與 I-01/I-04 合併驗證。
7. **`executeApprovedTask`/`approvedByB` 自我宣告旗標無簽章**(client-security, wave 初篩,但 Y0 §3 已標注
   "dead 但架構同源" ——即目前判斷為零呼叫端,但寫法與活躍的 runWorkflow/composer 兩處硬編碼問題同源)。優先度
   可以降低(現狀不可達),但一旦任何新功能引用這個物件形狀,需同批補簽章檢查,建議記錄為「修 gate 即引爆」類
   地雷,比照 X0 §3/§4 對 orbWorkflowEngine `approved:true` 的處理方式。
8. **CC3 C1(`fal-ai/any-llm` 等跨類別碰撞)的正式 UI 路徑是否已被真實流量踩到**——CC3 原文自陳「這條特定 UI
   路徑目前是否已被真實流量踩到,未在本檔案完整驗證」。雖然 bug 本身已用 `tsx` 直接執行驗證屬實,但「使用者
   在正式站是否真的會走到 12+ 精靈的預設模型呼叫」這個實際影響面評估仍待查——建議查 LangSmith/`ai_usage_events`
   實際呼叫記錄(如果 costAnalytics 缺口修復前這些呼叫是否有其他側面日誌)確認影響半徑。
9. **`orbTaskChainRunner` replan recap 的間接注入面**(CC4 發現 6,標記「問題浮現,非確認缺陷」)——CC4 自陳
   需要盤點「目前掛在 orb 工具白名單裡、真的會引入外部/第三方文字內容的工具」才能下結論,這份盤點**尚未執行**。
10. **`orbReplyParser.ts` JSON 模式 `toolCalls[].name` 未過白名單的實際可利用性**(CC4 發現 4)——CC4 自陳
    「未在本檔驗證」下游 `agentToolExecutor.ts` 是否對未知工具名一律拒絕,只做了「看起來像是」的推論。
11. **`isSafeInternalPath` 控制字元繞過的實際可利用性**(CC2 發現 9)——CC2 自陳「本檔範圍內無法確認是否構成
    實際可利用漏洞」,取決於下游是否把 `navigate.path` 當完整 URL 解析(wouter `setLocation` 或其他)。
12. **B-05 Sonauto duration 計費操縱面** — 自 `00-discussion-taskcards.md` 建立以來即標「待執行期驗證」,本波
    未有任何新文件觸及,是 taskcards 原表中僅存的兩個「待執行期驗證」項目之一(另一為 X 波 U-1,已於 X0 裁決
    降級為 low)。
13. **S-17/S-18(Google Drive OAuth 明文、skillRegistry withinTrustCeiling 失效)** — taskcards 標記「Z1 盤點
    提出,待對抗式驗證」。S-17 已由 X10 提供部分佐證(明文欄位、無 encryptSecret 呼叫),可視為「基本坐實」;
    S-18(`withinTrustCeiling` 對 reviewed 層檢查形同虛設)**本波未見任何文件補驗**,仍是純盤點階段的主張,
    建議列為下一波優先對抗式驗證對象。

**排序建議(風險 × 未驗證程度)**:1(NS-09 地基假設)> 2(資料遺失級 UX)> 4+5(確認閘/navigate 白名單疊加
暴露面)> 13(S-18 完全零驗證)> 3 > 6 > 8 > 9/10/11(均為「問題浮現」等級,實際可利用性存疑)> 7(已知不可達)
> 12(長期停滯未驗證,但嚴重度本就是 P2)。

---

## 3. 跨文件矛盾(各波之間有無結論打架)

逐一比對後,**未發現尚未解決的跨文件實質矛盾**——corpus 對已知的矛盾都做了正確的內部裁決與交叉引用,但發現
一個「矛盾已被裁決、但裁決本身留了未完成尾巴」的案例,以及一個「證據鏈缺失,無法獨立覆核裁決是否正確」的案例:

1. **X15 vs X2(orbWorkflowEngine `approved:true` 可達性)—— 已由 X0 §3 正確裁決,但裁決前提是「目前」**:
   X0 已用獨立讀碼確認 `agentToolExecutor.ts:708` 的 `"studio."/"director."` 前綴守門使
   `workflowEngine.executeWorkflow` 目前不可達,裁決 X2-uncertain(low)勝過 X15-confirmed(critical)。這個
   裁決本身的推理紮實(§3 逐行列出 5 條獨立驗證證據),**不是矛盾未解**;但值得注意的是,NS-00(修 G3
   178-tool gate)一旦執行,極可能就是那個「讓它可達」的修改本身——CC0 在此重申(而非新發現)X0/X15/X2 早已
   共同標注的耦合關係:**NS-00 的 PR 若不同批補上 `requiresHuman` 檢查,會直接復活這個目前被裁定「低風險」的
   critical 缺陷**。這不是一個新的矛盾,而是「風險分級隨前置條件變動」的正確範例,列在此處是為了確保討論
   NS-00 排期時不要因為 U-1 目前是「low」就忽略它。
2. **B-06(雙重退款)refuted,但 X-wave「9 條被推翻」的具體內容從未落地成文字**:`X0-carpet-scan-synthesis.md`
   §5 明確自陳「本次任務輸入僅提供 `refutedCount: 9` 這個總數,未附上被推翻條目的具體內容或所屬 wave」。這
   意味著:與 B-06(舊版稽核,已有完整「經過」段落記載推翻理由,可供未來查核)不同,**X 波這 9 條被推翻的
   findings 具體是什麼、屬於哪個 X 檔案、推翻理由是什麼,目前整個 corpus 裡沒有任何一處寫下來**。這不是「兩份
   文件互相矛盾」,而是「一份文件承認自己引用的裁決過程有黑箱」——嚴格來說算不上「矛盾」,但足以列為完整性
   缺口:若未來有人重新深挖同一批檔案,無法排除會不會把這 9 條裡的某一條當作「新發現」重新提出來(因為沒人
   知道它已經被判定不成立)。**建議**:若能找回 X1〜X17 各分冊的原始 verdict 記錄(分冊本身應該有,只是本次
   综合彙整的輸入沒帶到),應把這 9 條的「file:line + 推翻理由」補寫進 X0,比照 B-06 的格式,否則此空白會
   隨時間推移增加日後重工的風險。
3. **S-01(背景 job IDOR 共同根因)的「全壞」推定與「至少一處已修」的並存,已由 X0 正確處理為待辦而非矛盾**:
   taskcards 原文寫「共同根因」,X0 §2.2 補充「models.trainingStatus 已補檢查」,兩者合看的正確結論是「不可
   假設全壞或全對,需對 30+ 呼叫點做一次性逐點稽核」——X0 本身已經這樣寫,不是矛盾,是**尚未完成的稽核**(見
   §1.1 也提及此類「已知有缺口但未逐點稽核」模式)。CC0 在此重申此項稽核**至今仍未執行**(本波 CC1〜CC5 沒有
   任何一份針對 `getBackgroundJob`/`updateBackgroundJob` 的 30+ 呼叫點做逐點稽核),應留在待辦而非視為已結案。

**結論**:corpus 的自我糾錯機制(對抗式驗證 + 明確標注 refuted/confirmed/uncertain)運作良好,目前沒有發現
「兩份現存文件對同一段程式碼給出兩個都自稱 confirmed 但互斥的結論」這種真正的矛盾。主要風險是**裁決過程的
可追溯性有缺口**(上述第 2 點)與**已知需要逐點擴查的清單尚未執行**(上述第 1、3 點,以及 §1 列出的多個
「僅側面引用、未主稽核」檔案)。

---

## 4. 待補外部數據(需 Bruce 提供,研究無法從 repo 得知)

重申 `00-discussion-taskcards.md` §9 原始清單(本波未收到任何新的外部數據,清單保持不變):

1. **Railway 實際用量/帳單** — 部署問題本次不處理,交 Railway 客服;repo 內無法得知真實雲端支出數字。
2. **團隊真實使用回饋 / 每週專案完成率** — 北極星指標(見 S5-north-star-telemetry.md),repo 只能確認「資料
   已備妥」(dashboard.ts 的 query 存在),無法從程式碼得知實際團隊使用行為。
3. **各第三方 API 實際單價與方案** — 用以校準 B-02/X3/CC3(modelPricing.ts 定價卡)系列發現;repo 內建定價表
   (H1-model-costs.md)只是「內建估價」,`H1` 文件本身已聲明「內建估價 ≠ 實際帳單」。
4. **目標使用者規模與付費模式** — 用以定 credits/團隊池策略(S1/S2),`plans.ts`/`credits.ts` 目前的
   `priceMonthly` 欄位「在內部團隊情境下無意義」(S2 原文),需要 Bruce 說明實際商業模式才能判斷 §1.1 提到的
   `credits.ts`/`plans.ts` 稽核缺口該用什麼標準衡量(對外收費 vs 內部工具兩種情境下,「零計費」的嚴重度完全
   不同)。

**本波新增一項待補**(非外部數據,但同屬「repo 無法回答」類):
5. **`videoFlags.ts` 等 `ENABLE_*` 旗標在 Railway 生產環境的實際值** — corpus 多處(NS-08、Y0 §2.1
   `ENABLE_PROJECT_HUB`)只能讀到程式碼裡的預設值(`readFlag("VITE_ENABLE_PROJECT_HUB", false)`),實際部署
   環境變數是否覆寫了預設值,repo 內無從得知,需 Bruce 或有 Railway 存取權限者提供目前線上實際旗標狀態表,
   否則「這個功能使用者到底看不看得到」這類判斷永遠只能是「程式碼預設值層級」的推論。

---

## 5. 給決策的信心評級(三大重點群)

- **計費雙向壞(該收的沒收、不該多收的多收)**:**信心高,殘餘不確定性中等**。核心機制(`deductUserPoints`/
  `refundUserPoints` 的原子性、`atomicClaimJobRefund` CAS)已被 W5 對抗式驗證坐實可靠,「壞的不是核心是邊緣
  路徑」這個框架本身經得起檢驗;B-01/B-07(失敗不退)、B-10(雙重計費超收)、B-11(LLM 主流量記帳全盲)、
  X17/CC3-C2(訓練/3D 模型零計費或固定回退)等具體案例都有 file:line 級證據且多數附帶實測或逐行驗證。殘餘
  不確定性在於:①`credits.ts`/`plans.ts`/`auth.ts`(§1.1)這三個計費/身份核心檔案完全未經稽核,不能排除
  這裡還有結構性問題;②「30+ 個 `getBackgroundJob` 呼叫點」逐點稽核(§3 第 3 點)尚未執行,無法斷言目前列出
  的計費失效清單已經窮盡所有受影響端點。
- **IDOR 系統性(擁有權檢查缺失是重複模式,非單一疏漏)**:**信心高,殘餘不確定性中等偏低**。這個結論的證據
  密度是三個重點群裡最紮實的——taskcards S-01/S-14/S-15/S-19〜S-28、本波 CC4(orbClarificationEngine)、
  CC5(langsmith.ts)持續在完全不同的檔案裡發現同一種「WHERE 只有 id、沒有 userId」或「client 可控識別欄位
  覆寫伺服器信任值」的形狀,且多次附帶「對照同檔案內某個正確寫法,證明是遺漏而非刻意設計」的內部對照組
  (CC4 用 `orbFeatureDiscovery.recordRecommendationInteraction` 對照、CC5 用 `getCustomBlock`/`checkStudioJob`
  對照),這種「同檔案內部有正確範例可抄」的模式反覆出現,強化了「系統性」而非「巧合」的判斷。殘餘不確定性
  在於:`auth.ts` 完全未讀(若認證層本身有缺口,會是比任何單一 IDOR 更根本的問題)、`spiritRouter.ts` 從未
  被當整體讀過(§1.1-C)。
- **北極星流程斷點(腳本→分鏡→拼接→輸出斷在分鏡之後)**:**信心高(前端部分),中等(後端執行細節部分)**。
  Y0 的三大斷點(資料層無 projectId、compose 服務不存在、settings shell 路由 shadow)證據鏈完整且多數已標
  CONFIRMED;本波 CC1 對 AnimationStudio 的獨立重跑進一步坐實「分鏡本身」這一步在髒資料/脊椎串接/雙產線
  分岔三個面向都有具體證據,且與既有 Y2/DirectorAI 發現形成正確的對照組(如 CC-2 直接列出 DirectorAI 對照
  組證明是本頁疏漏而非架構缺失)。殘餘不確定性主要在 §2 列出的多項「wave 初篩未覆核」項目(尤其 NS-09 賴以
  成立的 DirectorAI projectId 範疇化證據本身還沒被二次覆核)以及 `spiritRouter.ts`/RAG 檢索(教材支柱)兩塊
  執行細節的空白——目前的信心是建立在「入口斷在哪裡」的判斷上,「斷點修復後,下一層還有沒有新坑」這件事
  相對沒把握。

---

（本報告不含任何真實密鑰值;所有連接器/憑證/認證相關描述僅涉及機制與檔名,未輸出任何 sk-/AKIA/-----BEGIN 等
敏感內容。）
