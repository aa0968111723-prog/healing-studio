# S1 — 新手→高手創作者成長路徑(產品策略 wave S)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 波次:**產品策略 wave S**
- 性質:產品策略設計(非診斷、非開發估工)——回答「15-20 人團隊怎麼從零真的用起來」,設計貫穿新手→熟手→高手的成長階梯,並回收 D-adoption(採用障礙)、M0(北極星藍圖)、P2(流程 UX)、01-features §2、L2(learn shell 欄位字典)四份既有研究的結論
- 實讀範圍:`client/src/components/home/`(IntentOnboardingNudge、landingFlags、OnboardingFlow 由 Home 掛載)、`client/src/components/OnboardingFlow.tsx`、`client/src/contexts/SiteOnboardingContext.tsx`、`client/src/shells/learn/panels/BeginnerPathPanel.tsx`、`client/src/shells/learn/beginnerPathPersonas.ts`、`client/src/shells/video/console/ProjectFlowGuide.tsx`、`shared/site-prompt-catalog.ts`
- 禁止:本文件不 spawn 子代理,只寫研究/策略文件,不寫程式碼

---

## 0. 一句話結論

**新手引導的零件比想像中多、也比想像中散——四五套「教新手」的系統各自為政,而唯一真正貼著北極星(單一專案一條龍)設計的那一套(`ProjectFlowGuide`)是全站藏得最深、關得最緊的一個。** 本策略不是再造一套新引導,而是:①讓 `ProjectFlowGuide` 從 /video 座艙側欄的隱藏元件升格成整條成長路徑的骨架;②把現有的四套引導按「新手/熟手/高手」重新分工,而非讓它們互相競爭使用者的第一印象;③把 `BeginnerPathPanel` 已經做好的 persona 分支(電商/教育者/接案者/品牌方)接上真實專案動作,而非停留在純導覽。

---

## 1. 現況盤點:已有的新手資源,好/散/孤兒

### 1.1 全站目前並存的五套「教新手」系統

| # | 系統 | 掛載處 | 觸發時機 | 核心設計 | 現況判定 |
|---|---|---|---|---|---|
| ① | `SiteOnboardingContext`(全站 Tour 引擎) | `client/src/contexts/SiteOnboardingContext.tsx` | 每頁首次進入(`usePageTour`)自動觸發;welcome tour 首次登入觸發;可從設定頁 `resetAllTours` 重播 | 21 個 `PageId` 各自一組 `TourStep[]`(spotlight+說明+tip),`activeSurface` 鎖(`home-flow`/`site-tour`)防止疊加;全部存 localStorage | **好**:唯一有「跨頁協調鎖」的系統,`acquireSurface`/`releaseSurface` 設計得體,避免多個引導疊加。**散**:21 頁各寫各的文案,內容是「這個頁面有什麼」而非「你現在該做什麼」,與使用者實際專案進度無關 |
| ② | `OnboardingFlow`(Home 首次登入 90 秒流程) | `client/src/components/OnboardingFlow.tsx`,由 `Home.tsx` 掛載,以 `acquireSurface("home-flow")` 搶 ① 的鎖 | 首次登入(`ai-director-onboarded` 未設) | 打字機問候→輸入(AI 建議 chips,`evaluate.suggestChips`)→假思考鏈+真生成(`prepareJob`→`multimodal`)→結果(慶祝或誠實重試,`isUsableResultUrl` 防呆 AIDV-637)→依 persona 重排的「下一步」分支 chips(配音/圖生影/導演 AI/再生一張,AIDV-810+AIDV-965) | **好**:唯一「真做出一件作品」的引導,且有誠實失敗處理(不偽造成功)與漸進式提詞診斷(`diagnosePrompt`,AIDV-812)。**孤兒/斷點**:成功後只慶祝「你的第一件作品完成了」,不建立任何 `creative_project`,分支 chips 導去別的殼之後,使用者就與這次「引導」徹底失聯——**只做完北極星七步中的第一步半(生一張圖),完全沒有腳本→分鏡→輸出的完整一條龍**,與 M0 定義的本質脫節 |
| ③ | `BeginnerPathPanel`(LearnHub `/learn` 新手路徑分頁) | `client/src/shells/learn/panels/BeginnerPathPanel.tsx` + `beginnerPathPersonas.ts` | 使用者自行點進 `/learn` 的「🚀 新手路徑」分頁 | 5 步線性打勾清單(讀提示→第一張圖→微調→動起來→配音),AIDV-965 加 persona 選擇器(電商/教育者/接案者/品牌方/通用),選了之後整組 STEPS 換成情境化 4 步版本,完成畫面文案客製 | **好**:persona 分支是目前全站**唯一**針對不同創作者角色設計出「情境專屬 4 步路徑」的機制,內容具體(例如電商版:描述商品→生主圖→去背換底→批次匯出),是本文件成長階梯設計的現成素材。**散/半成品**:純前端 localStorage 打勾,`href` 只是深連結導頁,不建立/不追蹤任何真實 `creative_project`;`FEATURE_BEGINNER_PATH_PERSONAS` 旗標預設 OFF(需確認,見 §6);與②③④彼此不知道對方存在 |
| ④ | `ProjectFlowGuide`(/video 座艙左欄五步嚮導) | `client/src/shells/video/console/ProjectFlowGuide.tsx`,掛在 `StorySpineColumn`,`ENABLE_PROJECT_HUB` 守門(預設 OFF) | 使用者已建立 `creative_project` 並進入 /video 座艙 | 世界觀→劇本→分鏡→生成→成片,**每步的完成狀態由真實專案資料即時推導**(`worldLinked`/`hasScript`/`hasShots`/`someGenerated`/`allGenerated`),當前步有主要動作鈕直接執行(開引導式創作/自動拆分鏡/排程生成) | **本質最貼、藏最深**:這是全站唯一「讀專案真實狀態算出下一步」的引導,是 M0/P2 定義「一條龍」的直接視覺化,但①旗標預設關;②只掛在 /video 座艙側欄一小塊,不是任何人第一眼會看到的位置;③與①②③三套引導完全沒有互相連結——新手在 Home/LearnHub 學完「怎麼生圖」,永遠不會被帶到這裡認識「專案」這個核心單位 |
| ⑤ | `IntentOnboardingNudge`(Home 意圖路由卡) | `client/src/components/home/IntentOnboardingNudge.tsx` | Home 頁,依 Sense 引擎 `intentResult`(confidence≥0.4)顯示 | 依意圖類型(選擇困難/目標導向/美學偏好/找靈感/被動瀏覽)給一張「去哪裡」建議卡,可關閉(`sense_onboarding_dismissed`) | **孤兒**:純前端唯讀消費既有推論,設計良好(不打擾、可關閉),但依註解「Home 以 `HOME_FEATURE_FLAGS.showIntentOnboarding` 守門,預設 OFF」——等於做好了沒開,對「該去哪」的迷惘(D-adoption 障礙②)幫不上忙 |

### 1.2 輔助/周邊資源

| 資源 | 路徑 | 定位 | 判定 |
|---|---|---|---|
| `TutorialOverviewPage`(/tutorial-overview) | 100% 靜態零後端(01-features §2.9) | 五軌分站導覽卡(welcome/learn/director/image-studio/video-studio)+ 五張功能教學入口+光球 8 目的地 allowlist | **孤兒且扁平**:是全站唯一嘗試「一頁列出所有教學入口」的頁面,但只是把①的 21 個 Tour 挑 5 個攤平列出,**沒有階梯感**(不分新手/熟手/高手),也沒有任何頁面預設把新使用者導來這裡 |
| `AgentCodexPage`(/learn/codex) | 零後端,~480 條目(精靈/技能/頁面/工作流/工具/觸發器) | 搜尋+分類+光球預填 | **好但錯位**:是熟手/高手階段的優質「查字典」工具(想知道某功能怎麼用,搜就對了),但目前沒有從①②③④任何引導出口連過來,新手不會知道它存在 |
| `shared/site-prompt-catalog.ts` | 純函式聚合器,彙整 25 精靈 system prompt、18 主動觸發模板、120+ 提示詞參考庫等 8 類來源 | 供 `promptLibrary` 個人收藏 | **熟手階段素材**:目前只服務「收藏喜歡的 prompt」這個單一動作(`PromptReferenceTab`),尚未被當作「團隊共用 prompt 庫」或「新手看懂好 prompt 長怎樣」的教材使用 |
| `beginnerPathPersonas.ts` 的 `reorderNextStepChips` | 同時被 ③ 與 ② 引用(`OnboardingFlow.tsx:17`) | 唯一**真的跨系統共用**的一塊邏輯 | **好的先例**:證明「persona 這一份狀態可以跨引導系統共用」在架構上可行,值得擴大成整條成長路徑的共同狀態源 |

### 1.3 一句話總評

五套引導各自都做得不差(尤其 `OnboardingFlow` 的誠實失敗處理與 `ProjectFlowGuide` 的真實狀態推導都是好設計),**但彼此零互聯**:Home 教你生一張圖→LearnHub 教你走 5 步清單(可能跟 Home 教的重複)→/video 座艙裡藏著真正對齊北極星的嚮導卻沒人帶你去→/tutorial-overview 想統整卻只是攤平列表→AgentCodex 這本好字典沒人指給你看。新手體感是「教學蠻多的,但不知道哪個才是『正確』的路」,恰好呼應 D-adoption §2.1② 診斷的「同名概念多入口,沒有站內引導答案」——**這個問題不只發生在生成功能上,連『怎麼學』這件事本身都同名多入口**。

---

## 2. 成長階梯設計:新手 → 熟手 → 高手

設計原則:**三階段對映 `ProjectFlowGuide` 已經存在的五步骨架(世界觀→劇本→分鏡→生成→成片),差異只在「這一輪走多深、多寬」**——新手走最短路徑驗證一次成功,熟手加深(世界觀/一致性/多鏡),高手加寬(自建模板/連工具/教別人)。不是三套獨立教材,是同一條主線的三種放大倍率。

### 階段一:新手——跑完一次「精簡版一條龍」

**目標**:讓創作者在第一次坐下來的時間內,體驗完整的「腳本→一幕→輸出」,而不是體驗某一個模態的單點功能。

| 項目 | 內容 |
|---|---|
| 解鎖什麼 | 建立第一個 `creative_project`;認識「專案」是核心單位(而非四個工作室各自為政);拿到第一份可下載的產出 |
| 學會什麼 | 一句話可以變成一段腳本(不需要懂 prompt 工程術語);一幕=字卡/畫面/聲音三者之一先求有;生成完的東西會自動進資產庫,不會不見;點數怎麼算(這次花了多少) |
| 承接既有零件 | `OnboardingFlow` 的「打字機問候→輸入→生成→結果」節奏保留,但**結果頁不再是終點**——改為「已存進你的資產庫,要不要繼續幫這張圖加一句字卡、配一段音,做成一個小專案?」,一鍵建立 `creative_project` 並帶進 `ProjectFlowGuide` 的**精簡形態**(世界觀步跳過、劇本=剛剛那句話、分鏡=剛剛那張圖當唯一一鏡、生成=已完成、成片=下載這一鏡即可,不必等 compose 服務) |
| 驗收標準 | 不是「看完幾張引導卡」,是「完成一次腳本→一幕→輸出」的實際產出;`BeginnerPathPanel` 5 步清單的第 1-2 步(看懂提示、生第一張圖)在此階段內完成 |

### 階段二:熟手——用世界觀/一致性做一組連貫作品

**目標**:從「一次性的單幕」進化到「一組跨鏡一致的作品」,學會系統裡最具差異化的能力——世界觀+一致性錨點。

| 項目 | 內容 |
|---|---|
| 解鎖什麼 | 世界觀 CRUD(角色/場景)、Vault 一致性錨點注入生成、多鏡分鏡板(2 鏡以上)、教材庫(TeachingArchive)上傳第一份團隊素材、共享空間(SharedSpace)可見團隊資產 |
| 學會什麼 | 「一致性」從哪裡來(世界觀+Vault+未來的 LoRA 三層,D-adoption §4.10 已標為潛在領先但未整合的差異化資產);上傳教材給 AI 讀懂團隊語彙(RAG);怎麼把自己生成的東西設成「團隊共享」 |
| 承接既有零件 | `BeginnerPathPanel` 的 **persona 分支正是此階段的現成教材**——電商賣家 4 步(描述商品→生主圖→去背換底→批次匯出)、教育者 4 步(講稿→字卡→旁白→輸出教材)、接案者 4 步(定角色→LoRA 定版→多稿比稿→交付)、品牌方 4 步(品牌 preset→主視覺→衍生成套→審核定稿)——這些已經是「熟手向」的情境化路徑,只是目前停在導覽,未接真實專案動作;`ProjectFlowGuide` 的「世界觀」步在此階段從「可跳過」變成「建議完成」,`AmbientOrb` 的 hint 泡泡負責在合適時機提示「要不要連結世界觀,分鏡會更一致?」(P2 §1 畫面 1 已設計此文案) |
| 驗收標準 | 完成一組 persona 對應的 4 步情境路徑(而非通用 5 步);至少一次把資產設為團隊共享;至少上傳一份教材到資料庫 |

### 階段三:高手——自建工作流/模板/連自己的工具

**目標**:從「跟著走一條路」進化到「自己鋪路、鋪給別人走」,呼應 Bruce 定義本質的③④⑦(自動化工作流、連自己的工具/資料庫、素材+目標管理)。

| 項目 | 內容 |
|---|---|
| 解鎖什麼 | 把常用的分鏡/生成組合存成「團隊模板」(對應 M0 §5 Phase 3 的 studio_recipes 升團隊模板);連接 Drive/Notion 素材進教材庫/生成參考(M3 已有真後端);webhook 自動化面板(骨架已在,M3 §2.3);AgentCodexPage 作為自助查字典而非依賴問人;有能力審閱/核准他人作品(對應 M4 審批狀態機上線後) |
| 學會什麼 | 怎麼把自己驗證過的工作流變成「填空即跑」的按鈕給團隊其他人用(ComfyDeploy 式「工作流版本化」心智模型,D-adoption §4.6 已對照);怎麼把外部工具(Drive/Notion)接進來當素材來源;怎麼看團隊儀表板知道誰卡在哪 |
| 承接既有零件 | `AgentCodexPage`(~480 條目)在此階段轉正成主要工具,不再是無人知曉的孤兒頁;`shared/site-prompt-catalog.ts` 的 8 類來源可作為「團隊 prompt 庫」策展基礎;teams/SharedSpace 治理(需先補 §5 的缺口) |
| 驗收標準 | 至少發佈一個團隊可直接套用的模板;至少完成一次「教新人怎麼用」(可用 §5 的「帶人」模式驗收) |

### 三階段與既有五步骨架的對映

```
北極星五步:  世界觀 ──── 劇本 ──── 分鏡 ──── 生成 ──── 成片
新手(階段一):  跳過      1句話      1鏡        1次       下載單檔
熟手(階段二):  連結      對話式細化  多鏡+一致性  多次+核准  簡易拼接
高手(階段三):  建模板     自動化生成  批次/連工具  團隊代跑   打包+分享模板
```

這張對映本身就是 `ProjectFlowGuide` 已經存在的資料結構(`worldLinked`/`hasScript`/`hasShots`/`someGenerated`/`allGenerated`)在三種深度下的呈現——**不需要新建三套判斷邏輯,只需要讓同一組狀態推導函式支援「精簡模式」與「完整模式」兩種呈現粒度**。

---

## 3. 貼本質:成長路徑如何緊扣「單一專案一條龍」

M0 藍圖的核心結論是「零件都在,只是被鎖住/散在各殼」,這句話對「新手引導」同樣成立,而且更嚴重——**現有引導甚至沒有一套是完整走過一條龍的**:

- `OnboardingFlow` 只做到「生一張圖」就慶祝,是北極星七步的第 0.5 步,且慶祝完就把使用者丟給通用分支 chips,沒有下一步的「同一個專案」概念。
- `BeginnerPathPanel` 的 5 步/persona 4 步,每一步都是**換一個殼**(去 /create、去 /video、去 /pro-studio、去 /assets),步驟之間沒有共同的 `creativeProjectId` 貫穿——使用者做完第 4 步時,系統並不知道這 4 步是「同一件作品」。
- 只有 `ProjectFlowGuide` 是唯一一個**用 `creativeProjectId` 貫穿全程**的引導,但它被鎖住又藏在側欄。

**因此本策略的核心主張只有一句話:把「第一次上手」的終點,從『生出一個東西』改成『建立一個專案並看著它走完一條精簡的龍』。** 具體做法:

1. `OnboardingFlow` 生成成功後,不是提供「配樂/圖生影/導演 AI/再生一張」四個各自獨立的分支,而是先問「要把這個變成一個小專案嗎?」——按下去即建立 `creative_project`(標題可用剛剛的 prompt 自動命名),並直接把使用者帶進 `ProjectFlowGuide` 的精簡形態(§2 階段一),原本的四個分支 chips 變成該精簡流程裡「下一幕要不要加音樂/加動態」的選項,而不是離開專案脈絡的獨立跳轉。
2. `BeginnerPathPanel` 的 persona 步驟,每一步的 `href` 深連結**改為攜帶 `projectId`**(若已建立第一個專案),讓「描述商品→生主圖→去背換底→批次匯出」這 4 步實際發生在同一個 `creative_projects` 記錄下,而非各自獨立的頁面訪問。這是接線題(M0 已定義 `creativeProjectId` 為 SSOT 鑰匙),不是新邏輯。
3. 對齊 M0 §6 的「不跑偏三層模型」,新手引導本身就是最需要防跑偏的場景——初次使用者最容易在中途被岔開(點了別的工作室、忘記自己在做什麼)。`ProjectFlowGuide` 已有的「當前步驟才有主鈕」設計、`AmbientOrb` 的「只建議下一步或下一步驟」節奏(P2 §4.1),直接就是新手引導的防跑偏機制,不必另外設計。

**一句話總結**:新手引導不該是「教你認識六個工作室」,而該是「陪你把第一個 `creative_project` 走完精簡版一條龍」——這正是把 M0/P2 的產品本質,提前套用到「認識產品」這第一次接觸本身。

---

## 4. 降低採用障礙:對照 D-adoption 逐條給 onboarding 解法

| D-adoption 障礙(§2.1) | onboarding 解法 |
|---|---|
| ① 入口分散/雙導航,新成員心智地圖成本高 | 成長路徑地圖唯一化:把 `TutorialOverviewPage`(/tutorial-overview)從「攤平列 5 軌+5 卡」改寫成「新手/熟手/高手」三階梯結構(§2 的三段式),作為全站**唯一**的「我現在在哪一階」入口;①②③④⑤五套引導在完成/離開時都導回這一頁,而非各自為政地把使用者留在自己的殼裡 |
| ② 同名概念多入口(7 條生成路徑),沒有站內引導答案 | 新手階段(§2 階段一)**只教一條路**:Home 首次生成→建專案→`ProjectFlowGuide` 精簡版,明講「先只用這條路,等你熟了我們再介紹其他 6 種生成入口的差異」;把「路徑比較」明確排到熟手/高手階段才教,而非第一天就攤開 7 條路 |
| ③ 結果去哪找動線斷裂 | 階段一驗收標準明訂「找到資產庫」為必經步驟(§2);`OnboardingFlow` 結果頁補一句「已存進資產庫」+ 直接連結,把「去哪裡找」變成主動教而非等使用者自己迷路——**前提**是 D-adoption §3.1① 已列的 AssetsLibrary section 死碼要先修,否則教了也點不到對地方 |
| ④ 點數制心理摩擦(無「怎麼算」說明頁) | 階段一新增「這次生成花了多少點」的即時教學(生成成功時附一句話,而非事後才在設定頁翻積分頁);`credits` SiteOnboarding tour(既有)改為在階段一結束時主動觸發,而非等使用者自己點進 /learn 積分分頁才看到 |
| ⑤ 失敗率感知(輪詢卡頓、長任務體感偏卡) | 沿用 `OnboardingFlow` 已有的誠實失敗處理(`isUsableResultUrl` AIDV-637)與提詞診斷(`diagnosePrompt` AIDV-812)——這是全站目前唯一做對「不偽裝成功」的引導,把這個誠實原則**明文列為所有階段引導的共同準則**,擴大到 `ProjectFlowGuide` 精簡版與 persona 步驟;第一次生成前明講「通常要幾秒到幾分鐘」設定期望值,不讓等待本身成為信任損耗 |
| ⑥ 預設模型檔次與成本焦慮綁定(`user_ai_brain` 預設 Opus) | 高手階段(§2 階段三)+ §5 團隊擴散明訂:第一個學會系統的人(帶隊者)在教別人之前,**先去 admin 設定團隊預設腦檔次**,避免 15-20 人每人預設都跑最貴檔累加成帳單焦慮;此步驟寫進「帶隊者上線檢查清單」(§5) |
| ⑦ 展示性功能損耗信任(mock 光球/發佈) | 任何階段的引導路徑,都**不主動連結**已知的 mock 頁面(LightOrbCreationStudio、SocialPublish)——在 D-adoption §3.1② 的「標示示範模式」修完之前,新手引導的「下一步」建議清單裡明確排除這些入口,避免新人第一週就踩到假功能而對其他真功能失去信任 |

---

## 5. 團隊擴散:一個人學會怎麼帶動 15-20 人

單一使用者走完三階段,不會自動變成團隊擴散——需要明確設計「教別人」這件事本身的路徑。

### 5.1 帶隊者(champion)上線檢查清單

供第一個/前幾個學會系統的人(可能是 Bruce 本人或指定的 1-2 位團隊 champion)使用,是一份**動作清單**而非新功能:

1. 自己走完階段一→二→三,期間用 `BeginnerPathPanel` 的 persona 選擇器辨識「我們團隊主要是哪種創作者」(電商/教育者/接案者/品牌方,或混合)——這决定了團隊要教哪一組情境化 4 步路徑。
2. 在 admin 設定團隊預設 `user_ai_brain` 檔次(對應 §4⑥),避免全員預設走最貴模型。
3. 建立 2-3 個「種子專案」(`creative_projects`)作為活教材,設為團隊可見(SharedSpace),讓新成員用「複製/參考既有專案」而非空白開始——**此為缺口**:目前沒有「複製專案作為模板」的動作,需在 §6 補(見「要補」表)。
4. 把團隊的品牌/風格規範上傳到教材庫(TeachingArchive),讓 RAG 從第一天就懂團隊語彙,而非每個新人各自摸索。
5. 把常見問題的答案整理進團隊內部文件,或直接指向 `AgentCodexPage` 對應條目,取代「每個人都來問 champion 一次」。

### 5.2 團隊層級的擴散機制(重用既有基建)

| 機制 | 重用什麼 | 現況缺口 |
|---|---|---|
| 資產/模型共享 | SharedSpace、team visibility、共享得 2 點激勵(`assets.ts:261`,D-adoption §2.3 已載) | 分享粒度只有 my/team 二元(`ENABLE_DATA_RBAC` OFF),無法做「這組模板只給某小組先試用」 |
| 團隊治理 | `teams`/`team_memberships` CRUD(TeamsPage,完整) | `transferOwnership`/`updateMemberRole` 前端未接(01-features §2.7、L2 §7);加成員僅 userId 輸入,無 email 邀請——15-20 人靠 userId 手動輸入是真實摩擦點,建議列為团队擴散的前置修復 |
| 工作流模板化 | studio_recipes(既有資料結構,M0 §5 Phase 3 規劃「升級為團隊模板」) | 目前僅個人配方快照,無「發佈成團隊模板/填空即跑」介面 |
| 團隊知識庫 | TeachingArchive 四視野(全部/我的/團隊/公開) | 完整可用,唯一待補是 `teachingArchive.update` 前端零呼叫(L2 §6),團隊素材打錯字只能刪除重傳 |
| 團隊參考字典 | AgentCodexPage(零後端,~480 條目) | 完整可用,只差「從引導路徑連過來」這條線(§1.2 已載) |

### 5.3 擴散節奏建議

不是一次把 15-20 人全部丟進系統,建議按階段擴散:champion 完成三階段→挑 2-3 位「早期採用者」各自完成階段一二(用各自的 persona)→早期採用者的種子專案成為其他人複製的起點→其餘團隊成員以「複製種子專案」而非「從零開始」進入階段一,大幅縮短第一次成功的時間。

---

## 6. 重用什麼(附路徑)+ 要補什麼 + 分階段

### 6.1 直接重用(路徑對照)

| 能力 | 路徑 | 重用方式 |
|---|---|---|
| 全站 Tour 引擎+跨系統鎖 | `client/src/contexts/SiteOnboardingContext.tsx` | 原樣沿用,`activeSurface` 鎖機制擴大套用到三階梯之間的切換 |
| 首次登入 90 秒流程+誠實失敗處理 | `client/src/components/OnboardingFlow.tsx` | 結果頁改為導向建立 `creative_project`(§3-1),`isUsableResultUrl`/`diagnosePrompt` 誠實原則擴大為全階段準則 |
| persona 分支路徑(電商/教育者/接案者/品牌方) | `client/src/shells/learn/panels/BeginnerPathPanel.tsx`、`client/src/shells/learn/beginnerPathPersonas.ts` | 作為熟手階段(§2 階段二)現成課程內容,`href` 深連結改帶 `projectId` |
| 真實狀態推導的五步嚮導 | `client/src/shells/video/console/ProjectFlowGuide.tsx` | 抽出精簡/完整兩種呈現粒度(§2 對映表),作為三階梯共同骨架 |
| 光球四態提示殼(建議卡/確認卡共用) | `client/src/shells/video/console/AmbientOrb.tsx`(P2 §2 已載路徑) | 階段轉換提示(「要不要連結世界觀?」「要不要發佈成模板?」)直接借殼,不新增第三種對話模式 |
| 查字典型參考工具 | `client/src/pages/AgentCodexPage.tsx`(路徑依 01-features/L2 §5 推定) | 高手階段自助工具+團隊知識傳承,從引導路徑加一條連結即可 |
| 跨系統共用 persona 邏輯先例 | `beginnerPathPersonas.ts` 的 `reorderNextStepChips`(已被 `OnboardingFlow.tsx:17` 引用) | 證明「一份 persona 狀態可跨系統共用」可行,擴大成三階梯共同狀態源 |
| Prompt 策展素材 | `shared/site-prompt-catalog.ts` | 熟手階段「看懂好 prompt 長怎樣」教材,及未來「團隊 prompt 庫」基礎 |
| 團隊共享+知識庫基建 | TeamsPage/SharedSpace/TeachingArchive(01-features §2.6/2.7) | §5 團隊擴散機制直接沿用,唯治理 UI 需補(見下) |

### 6.2 要補(缺口)

| 缺口 | 說明 | 對應章節 |
|---|---|---|
| 首次生成不建立真實專案 | `OnboardingFlow`/`BeginnerPathPanel` 兩套現行引導都不建立/不追蹤 `creative_project`,新手做完等於什麼都沒留下(除了一張圖) | §3 |
| `ProjectFlowGuide` 旗標關+藏在側欄 | `ENABLE_PROJECT_HUB` 預設 OFF,且只掛在 /video 座艙左欄,不是任何新手會看到的位置 | §1.1④、§2 |
| 無「複製專案作為模板」動作 | 團隊擴散(§5.1-3)需要「種子專案→新人複製」機制,目前找不到對應功能,需新增或確認是否已存在 | §5.1、§5.2 |
| 無跨系統成長路徑地圖 | `TutorialOverviewPage` 是攤平列表,非三階梯結構;五套引導系統彼此不連結 | §1.3、§4① |
| 無 onboarding 完成率/卡關資料 | 全部進度存 localStorage,無伺服器端漏斗數據,帶隊者看不到「誰卡在哪一步」 | §5 |
| 團隊治理 UI 未接 | `transferOwnership`/`updateMemberRole` 後端有前端無;加成員僅 userId 輸入 | §5.2 |
| persona 分支/意圖路由旗標關 | `FEATURE_BEGINNER_PATH_PERSONAS`、`HOME_FEATURE_FLAGS.showIntentOnboarding` 預設 OFF(以程式碼註解為準,建議實測確認正式環境值) | §1.1③⑤ |
| studio_recipes 無「發佈成團隊模板」介面 | M0 §5 Phase 3 已規劃,尚未落地 | §2 階段三、§5.2 |
| TeachingArchive 無編輯表單 | 團隊素材打錯字只能刪除重傳,影響「上傳團隊規範」這個熟手/champion 動作的體驗 | §5.1-4 |

### 6.3 分階段路線(對齊 M0 Phase 0-3 節奏,不重複造輪)

| 階段 | 內容 | 依賴 |
|---|---|---|
| Phase 0(近期,低風險,多為開旗標+改文案) | 打開 `FEATURE_BEGINNER_PATH_PERSONAS`(功能已完整,只是關著);把 `TutorialOverviewPage` 改寫為三階梯地圖(純文案+重排,零後端);`OnboardingFlow` 結果頁加「已存進資產庫」一句話+連結(不需要新建專案,先止血動線斷裂) | 無外部依賴,可獨立先做 |
| Phase 1(中期,依賴 M0 Phase 1) | 打開 `ENABLE_PROJECT_HUB`,把 `ProjectFlowGuide` 抽成儀表板主視覺(P2 §3①既有設計);`OnboardingFlow` 首次生成成功後導向建立 `creative_project` 並帶入精簡版嚮導 | M0 Phase 1(`projectId` 接上 `ai.chat`)、M0 Phase 0(G3 gate 修復,若引導涉及代理動手) |
| Phase 2(中期,團隊擴散前置) | `BeginnerPathPanel` persona 步驟的 `href` 接上真實 `projectId`;teams 治理 UI 補完(`transferOwnership`/`updateMemberRole`、email 搜尋加成員);admin 團隊預設 AI 腦檔次設定入 champion 檢查清單 | M4 階段 0(`digital_asset_library` 加 `creativeProjectId`) |
| Phase 3(長期,依賴 M0 Phase 3/M3) | studio_recipes 升級「發佈成團隊模板」;新增「複製專案作為種子模板」動作;`AgentCodexPage` 與成長路徑地圖互相連結;connector/webhook 自動化面板作為高手階段教材 | M0 Phase 3(compose 服務、連接器 UI 收斂) |

---

## 未涵蓋部分

- 未實測任一引導系統在瀏覽器中的實際互動細節(純程式碼閱讀,如 §0-6 標記者相同的方法論邊界)。
- 未驗證 `FEATURE_BEGINNER_PATH_PERSONAS`、`HOME_FEATURE_FLAGS.showIntentOnboarding` 在正式環境(`.env.production`)的實際值,僅以程式碼註解推論為 OFF——若實測後兩者已是 ON,§1.1③⑤ 與 §6.2 對應條目需修正。
- 「複製專案作為種子模板」是否已有等價功能(例如專案匯出/匯入 JSON)未深入 grep 確認,列為缺口待查而非確定新建。
- Onboarding 完成率/漏斗的伺服器端埋點設計(事件、資料表)未展開細節,只點出「目前無此資料」的現況。
- 未涉及語音入口(OrbVoiceButton)在成長路徑各階段的引導體驗設計(對齊 P2 §未涵蓋部分同一排除範圍)。
- 團隊 champion 制度屬於營運/流程建議,非產品功能規格,未附功能規格層級的驗收條件。
