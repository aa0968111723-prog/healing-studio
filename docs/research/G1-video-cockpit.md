# G1 — VideoCockpit 導演座艙完整盤點(補洞 wave G)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(實掃時 HEAD=`fb4358d`,但 `aef4214..HEAD` 對 `client/src/shells/video/`、`client/src/spine/`、`AgentStatusBar.tsx` 零 commit,程式碼位元相同)
- 定位:補 01-features §1.1 的缺讀——**`/video`、`/video/director`、`/video/cockpit` 的預設實際入口**(`ENABLE_4SHELL` ON + `ENABLE_VIDEO_COCKPIT` ON,videoFlags.ts:45,雙旗標皆預設 ON)。DirectorAI.tsx 舊頁在預設旗標下不可達(VideoCockpitFrame.tsx:25,40-44)。
- 方法:逐行實讀 `client/src/shells/video/` 全目錄(frame/console/canvas/drawers/panels)+ `client/src/spine/`(ProjectSpineProvider/projectGateway/gate)+ `adapters/generation.trpc.ts`、`commander.trpc.ts` + `AgentStatusBar/AgentQuotaBar` + 對應 server router 抽查(videoProject.ts、workflow.ts、agentStatusRoute.ts)
- 詞彙依 `00-overview.md`;旗標現況依 `02-fullstack.md` §9;缺讀聲明見 §7

---

## 0. 一頁總覽:座艙的五層結構

```
VideoShell(shells/VideoShell.tsx:11,旗標分流)
└─ VideoCockpitFrame(旗艦外框)= DashboardLayout(video scope)
   ├─ 常駐橫幅:SSEFallbackBanner / ActiveVideoTasksBanner / AgentQuotaBar / AgentStatusBar
   └─ ProjectSpineProvider(資料脊椎:聚合 5 procedure + 樂觀寫回)
      ├─ COCKPIT_PATHS(/video、/video/director、/video/cockpit)→ VideoCockpit
      │    └─ 非空專案 → DirectorConsole(三欄導演台)
      │         ├─ CreationFlowBar(頂部流程列+確認門/成本儀表)
      │         ├─ CockpitColumns(RWD 三欄;<lg 底部頁籤)
      │         │    ├─ 左 StorySpineColumn(場景→鏡頭樹+角色 readiness)
      │         │    ├─ 中 CreationCanvas(8 個畫布模式路由)
      │         │    └─ 右 ContextSidecar(7 張卡)
      │         ├─ AmbientOrb(座艙專屬光球,四態)
      │         ├─ ConsoleDrawers(10 個右側抽屜)
      │         └─ GuidedJourney(引導式創作 Dialog)
      └─ 其餘 /video/* 子路由 → re-home 既有頁(ShellPage,不重寫)
```

介面狀態(焦點鏡/畫布模式/抽屜/工作流步驟/光球四態)由 `DirectorConsoleProvider` 持有,與資料層 `ProjectSpineProvider` 分離(DirectorConsoleProvider.tsx:1-16)。

---

## 1. 功能清單(逐面板/抽屜/區塊)

### 1.1 Frame 層(所有 /video 子路由共用)

| 區塊 | 用途 | 進入點 | 現況 | 證據 |
|---|---|---|---|---|
| AgentStatusBar | 多代理監控折疊面板;SSE `/api/agents/heartbeat` 30s 快照(agent_dynamic_registry + priorityQueue 深度) | 右下浮動 pill(fixed bottom-4 right-4 z-40) | 完整(後端 auth+SSE 完整);但**斷線不重連**、樣式硬編碼 zinc 深色不隨主題 | AgentStatusBar.tsx:58-76,81-84;agentStatusRoute.ts:147 |
| AgentQuotaBar | 本小時代理呼叫額度 used/max 進度條;used=0 不渲染 | 頁面頂部 | 完整(videoProject.agentQuota → getAgentQuota,每 60s 輪詢) | AgentQuotaBar.tsx:13-18;videoProject.ts:528 |
| ActiveVideoTasksBanner | 頁面重載後找回進行中影片任務(AIDV-649) | 頂部橫幅 | 完整(讀 BackgroundTasksContext,開 DrawerTask) | ActiveVideoTasksBanner.tsx:16-22 |
| SSEFallbackBanner | SSE 降級提示 | 頂部 | 完整(02-fullstack §8) | VideoCockpitFrame.tsx:33 |
| 其餘 studio 子路由 re-home | create/studio/playground/animation/image/video/pro/light-orb | SHELL_SUBROUTES.video | 完整(沿用 P0,不在本卡範圍) | VideoCockpitFrame.tsx:29,46-50 |

### 1.2 VideoCockpit 狀態場景(五分支)

loading / error(重試鈕)/ empty-未選專案(引導式創作 CTA)/ empty-空白專案(引導式+建空白專案)/ success(DirectorConsole)——各態齊備(VideoCockpit.tsx:63-174),是 C-uiux §2.1-8 認證的「四態範本」。另有:

| 功能 | 現況 | 證據 |
|---|---|---|
| 成片下載橫幅(AIDV-684) | **實質不可達**:`getExportUrl` 只在 `videoProjectId != null` 時查(僅同 session 內剛用 VideoProjectCreateDialog 建案後才有值);且快取 URL 只由 `videoProject.requestExport` 寫入,而 **requestExport 全前端 0 呼叫點**(只出現在註解) | VideoCockpit.tsx:27-34,121-138;videoProject.ts:440-458,469;grep requestExport 僅 VideoCockpit.tsx:30 註解 |
| 建空白專案的雙寫 | VideoProjectCreateDialog 建 `video_projects`(含比例/解析度/輸入素材),onCreated 又呼 `spine.createProject("未命名創作","影片")` 建**另一筆** `creative_projects`——一次動作兩個平行專案體系各一筆,且 creative 側標題寫死「未命名創作」不吃對話框輸入 | VideoCockpit.tsx:165-172;VideoProjectCreateDialog.tsx:66 |
| useRegisterPageAgent | 對全域光球註冊 navigate 能力+座艙狀態快照 | VideoCockpit.tsx:36-61(完整) |

### 1.3 CreationFlowBar(頂部流程列+常駐儀表)

| 區塊 | 用途 | 現況 | 證據 |
|---|---|---|---|
| 流程列 | 反映可設定工作流啟用步驟;點階段切中欄畫布。預設 ENABLE_AIDV_CHROME=ON → design-kit FlowBar 版 | 完整;`pending` 步驟誠實 toast「待後端」 | CreationFlowBar.tsx:125-179,135,152 |
| 跳階補齊精靈(U-5/AIDV-95) | 跳下游缺料時彈 StageGapWizard(列缺項+回頭引導/仍要前往);stageGate.ts 純函式四條驗證 | **停用**(ENABLE_VIDEO_GATE_KIT 預設 OFF);程式+29 條測試齊備 | CreationFlowBar.tsx:96-102;stageGate.ts:73-178;videoFlags.ts:79 |
| 確認門讀數 | ready/partial/blocked 三態 chip(countGate) | 完整(純前端計算) | CreationFlowBar.tsx:203-206 |
| **成本階梯** | HF $0.012 / Gemini $0.02 / fal $0.04 / Mock $0 切換 | **假資料**:單價寫死自原型(「B 案;對齊原型 PROVIDERS」),非真實計價;且所選 provider **並未送進 submitStudioJob**(見 §2 接線) | CreationFlowBar.tsx:34-40,211-227 |
| AI 腦 chip | 文字 LLM 健康(apiUsage.textLlmStatus) | 完整 | CreationFlowBar.tsx:42-59 |
| 生成引擎 chip(AIDV-857) | 生成供應商聚合健康(brain.providerSystemStatus) | 完整 | CreationFlowBar.tsx:62-85 |
| 生成就緒鏡(N) | spine.scheduleGeneration 批次生成 | 完整(判準與按鈕計數同源,防「顯示 N 點了說沒有」) | CreationFlowBar.tsx:106-109,193-195 |
| 匯出素材包(AIDV-226/232/246) | 全鏡完成後逐鏡下載+封面幀★+全部下載 | 完整(走 `/api/media/download` proxy);但檔名一律 `.mp4` 而座艙生成的其實是**圖片 keyframe**(見 §2);字幕/CC 區誠實標「待語音軌」 | CreationFlowBar.tsx:241-334,283,297-307 |

### 1.4 左欄 StorySpineColumn

專案切換器(spine.projects)/專案標題+logline/確認門總覽/場景→鏡頭樹(computeGate chip,點=deepLinkToShot)/角色任務樹(來源分級 chip)——全部完整,純消費 spine(StorySpineColumn.tsx:34-191)。`ENABLE_PROJECT_HUB`(預設 OFF)才渲染 ProjectFlowGuide 五步嚮導(世界觀→劇本→分鏡→生成→成片,含 WorldLinkPicker 世界連結,ProjectFlowGuide.tsx:41-204;WorldLinkPicker.tsx:13-63)——程式完整、**停用**。

### 1.5 中欄 CreationCanvas 八畫布(模式路由,CreationCanvas.tsx:20-68)

| 畫布 | 用途/接線 | 現況 | 證據 |
|---|---|---|---|
| chat 導演對話 | spine.directorReply → commander adapter → `director.chat`(messages 陣列+personality+projectId) | 完整;但 (1) 訊息只存元件 state,**切換畫布即全丟**(條件渲染 unmount,CreationCanvas.tsx:60-67);(2) 開場訊息 agent 名寫死「OpenRouter→Claude」,實際 chat 引擎是 perplexity/sonar-pro(01-features §0.1) | DirectorChatCanvas.tsx:22-27,44;commander.trpc.ts:36-41 |
| script 腳本意圖 | director.videoScriptTypes/generateVideoScript/importScript/saveSession/listSessions;I-3 一鍵 `worldStoryboard.seedSkeleton` 產分鏡骨架(需已連結世界觀);AIDV-240 字數/token 計數 | 完整(結果同樣 ephemeral) | ScriptCanvas.tsx:36-41,91-111,115-118 |
| shot 分鏡修復 | deep-link 落點:大圖預覽(img/video)+確認門待補原因+生成/核准/同 seed 重生/重試(spine.generateShot/approveShot/uploadReference) | 完整(UI);但寫回持久化見 §2 缺口;場景類待補顯示「場景頁鎖定實景」——**該場景頁(ScenePanel)已是死碼**,live UI 無任何鎖定場景入口 | ShotDetailCanvas.tsx:23-215,176;§1.8 |
| asset 自由素材 | generation 接縫(estimateCost→submitStudioJob→輪詢 jobStatus→recordGenResult);存庫 promptLibrary.create;AIDV-160 成本守門 toast 全套 | 站內生成完整;「上傳自有」「外部 AI 帶入」兩 tab = **誠實佔位**(標「待後端」);模型下拉為寫死 4 個短 id(`nano-banana-2` 等,非完整 fal id) | AssetGenCanvas.tsx:35,52-94,217-244 |
| rough-cut 初剪 | 鏡號排序時間軸+未核准 banner+zip_export 估算(固定 50pt) | **半成品(誠實)**:打包鈕只 setQueued(true) 顯示「待後端 · background_jobs.zip_export worker 實作待補」;trim/拖排序標 S4-2 | RoughCutCanvas.tsx:8-9,144-159 |
| voice 配音/環境音 | proStudio.qwenTTS / elevenLabsTTS / soundEffects;generate.estimateCost 先估;AIDV-254 語音風格選擇器(proStudio.voiceStyles);AIDV-860 fal 健康度阻斷 | 完整(先估→先扣→佇列→資產庫) | VoiceAmbientCanvas.tsx:67-147,98-109 |
| music 配樂 | proStudio.textToMusic(ace-step/sonauto/stable-audio/musicgen)+估點+fal 健康度 | 完整;檔頭明注「並無 Suno 接點」 | MusicCanvas.tsx:2-8,63-78 |
| complete 成片交付(AIDV-282) | outputUrl 有值→線上播放器+`videoProject.requestDownloadByUrl` 下載(presigned);無值→「組合中」佔位+已核准縮圖走廊 | 播放器/下載完整;但 outputUrl 依賴 zip_export worker 回填(待後端)→ 實務上**恆為組合中佔位**(誠實標「待後端 · zip_export」) | CompletionCanvas.tsx:20-135,132;projectGateway.ts:471 |

**注意**:voice/music 兩畫布可從模式切換條直接點到(CreationCanvas.tsx:26-27),但預設**不在**頂部工作流步驟列(ENABLE_VOICE_MUSIC_WORKFLOW 預設 OFF 才插入兩步,workflowSteps.ts:70-77)——同一功能兩個入口一開一關。

### 1.6 右欄 ContextSidecar(7 張卡,ContextSidecar.tsx)

| 卡 | 用途/接線 | 現況 | 證據 |
|---|---|---|---|
| Context Packet | token 估計/TTL/來源新鮮度+重建(spine.rebuildPacket → contextPacket.compileProject mode="director",失敗回退本地決定性重編) | 完整(有真後端+本地 fallback) | :44-87;projectGateway.ts:178-194 |
| ConfirmGate 確認門卡 | 三態大計數+具名待補(去重彙整)+「上傳參考照」解鎖+過期重生提示+鐵則文案;AIDV_CHROME ON=design-kit GateCard | UI 完整;**「上傳參考照」是假上傳**(見 §2/§4) | ConfirmGate.tsx:28-122 |
| CostMeter 成本·積分 | credits.myBalance 餘額+退款政策文案 | 完整 | :189-217 |
| AgentProgressPanel(AIDV-358) | generate.myJobs 每 5s 輪詢;活躍+近 5 分完成任務、進度條 | 完整(檔頭明注 SSE 升級待 AIDV-344) | AgentProgressPanel.tsx:37-53 |
| VideoProjectLifecycleCard(AIDV-253/307) | `videoProject.list` infinite 游標分頁+複製專案(duplicate)+版本歷程(listSnapshots/restoreSnapshot,回溯前自動 pre-restore 快照) | 完整;但操作對象是 **video_projects 體系**,與座艙脊椎的 creative_projects **互不連動**(卡內自選第一筆,非當前專案) | :283-431 |
| 版本·過期 | stale 鏡彙整+deep-link 重生 | 完整(純前端) | :102-134 |
| AssetLineageCard(W3-F/AIDV-51) | assets.recentLineage 最近 5 筆 prompt 連結資產(衍生/變體/改寫/延長) | 完整唯讀;誠實標「完整血統樹待 M2」 | :228-280;assets.ts:82 |
| 評論·筆記 | spine.addNote → notes.create(title=截 80 字,tags=["導演台"]) | 完整;但讀取端 `notes.list` 是 **user 級無 projectId 過濾**——顯示的是全帳號筆記,非本專案(gateway 註明「projectId 關聯待 M2 era 補欄」) | :140-183;projectGateway.ts:225-241,161 |

### 1.7 ConsoleDrawers 十個抽屜(Sheet 疊層,ConsoleDrawers.tsx:48-61)

進入點:`workflow` 由 CreationFlowBar「工作流」鈕;其餘 8 個只能從 **AmbientOrb 協作面板**開(AmbientOrb.tsx:102-111);`agent_ops` **全 repo 0 個 openDrawer("agent_ops") 呼叫點=不可達死抽屜**。

| 抽屜 | 用途/接線 | 現況 | 證據 |
|---|---|---|---|
| workflow 2-17 | WorkflowBuilder:步驟增刪排/啟停(必經 intent·asset·gate·done 不可刪);**已接後端** `workflow.getDefault/save` → `user_workflows`(AIDV-43,schema.ts:4538) | 完整;但抽屜內仍顯示過時文案「步驟自訂持久化＝後端待補…Wave 0 先以前端狀態示意」——**UI 謊稱未持久化,實際每次 setSteps 都寫 DB**;檔頭註解同樣過時 | ConsoleDrawers.tsx:65-129,121-123;DirectorConsoleProvider.tsx:125-141,14-15;server/routers/workflow.ts:16,22 |
| flowtv 2-12 | Flow 電視牆/提示詞庫:promptLibrary.list/create/delete/incrementUseCount/toggleFavorite+全屏放映器(頻道=真實後端篩選、鍵盤/全屏/自動換頁)+再生成(generation 接縫) | 完整;**放映畫面是 seed 決定性漸層**(prompt_library 無素材欄,`frameStyle(seedOf(id))`),非真素材,檔頭誠實標「等 G9 後接真素材」;搜尋僅比對 title | FlowTv.tsx:7-9,43-46,197,330;:170 |
| playground 2-13 | 模型統一目錄:UNIFIED_MODEL_REGISTRY 權威層+aiModels.list 情報層 enrich(exact-match 不編造)+t2i/i2i/upscale 就地試生成 | 完整;試生成結果同樣以 seed 漸層呈現(:236) | ModelCatalog.tsx:46-268 |
| research I-5(AIDV-83) | **realEarth.search 全站唯一 UI 入口**(13 procedure LIVE 但無其他前端);台灣過濾+可信度徽章+「複製參照接地」 | 完整唯讀;注入生成上下文/directorResearch=誠實標 Phase 2 待後端 | RealEarthResearch.tsx:3-9,39-42,126-129 |
| prompts I-8(AIDV-86) | 跨庫組合:promptLibrary.list+promptCollection.listMine/listTeam 三分頁多選→客戶端合成→複製 | 完整唯讀;主動建議/評分回饋=Phase 2 待後端 | PromptWorkbench.tsx:39-77,190-193 |
| agents I-1(AIDV-79) | 精靈能力+成本目錄:spirit.listModels × director.estimateSegmentCost 唯讀 | 完整唯讀;派工(spirit.invoke)=Phase 2 待後端(誠實 amber 說明) | AgentCatalog.tsx:33-51,103-106 |
| grounding I-4(AIDV-82) | teachingArchive.search(向量為主/LIKE 後援)→複製教材參照 | 完整唯讀;注入 refineScript=Phase 2 | TeachingArchiveGrounding.tsx:39-57,116-119 |
| lora I-7(AIDV-85) | 角色×LoRA 狀態(linkedModelId 對 worldbuilding.linkableModels)+LoRA URL/觸發詞/scale 滑桿複製參數 | 完整(Phase 2 複製參數版);自動套用進生成=待後端 | LoraCharacters.tsx:34-203 |
| **agent_ops** W3-D(AIDV-49) | orchestrationRuns.list 唯讀視覺化(狀態/planJson/成本) | **死碼(不可達)**:元件+後端完整,但無任何 openDrawer("agent_ops") 入口 | AgentOpsPanel.tsx:109-153;grep 證實 0 呼叫點 |
| settings 2-18 | 生成引擎(spine.setProvider)+per-模態預設引擎(2-16)+介面開關+個人化(PersonalSettingsContext 帳號層)+鐵則 | 引擎切換/個人化完整;**per-模態偏好=半成品**(誠實標「偏好備忘 · 未接線」「目前不影響生成」,session 態,G10 待接);**「自動存草稿」開關=死開關**(autoSaveDraft 全 repo 0 消費者) | VideoSettings.tsx:95-159,99,140-143;grep autoSaveDraft 僅宣告+開關 |

### 1.8 其餘座艙元件

| 元件 | 現況 | 證據 |
|---|---|---|
| AmbientOrb 座艙光球 | 完整:四態(silent/hint/collab/critical)由 gate/錯誤/就緒資料計算,critical 泡泡 deep-link 修復點;協作面板=10 個快速動作(8 抽屜+就緒鏡+重建 packet) | AmbientOrb.tsx:54-133;DirectorConsoleProvider.tsx:169-223 |
| GuidedJourney 引導式創作 | 完整:長腳本→commander.breakdownScript(實際= director.importScript,AIDV-180)→review→寫入(ingestBreakdown:本地樂觀+worldStoryboard.createFromSegments 回寫);取消保護/失敗不關窗 | GuidedJourney.tsx:34-197;commander.trpc.ts:114-142 |
| CockpitColumns RWD | 完整:lg+ 三欄 grid(`lg:contents` 技巧桌機零變化);<lg 單欄+底部 sticky 頁籤(role=tablist/tab/aria-selected) | CockpitColumns.tsx:22-84 |
| StageGapWizard / stageGate | 完整但停用(GATE_KIT OFF);純函式+29 測試 | §1.3 |
| **panels/ 整目錄(7 檔)** | **死碼**:ShotPanel/ScenePanel/CharacterPanel/AssetsPanel/PromptsPanel/NotesPanel/VaultBrowserPanel 無任何非測試 importer(W3-G 刪 columns/* 舊三欄後遺留);其中 CharacterPanel(四鎖/改設定)與 ScenePanel(鎖定實景)是確認門**唯二的解鎖 UI**,死掉後 live 座艙無場景鎖定與逐鎖切換入口 | grep importer 證實;panels/*.tsx 檔頭 |
| **StageBar.tsx** | **死碼**:五階段條(世界觀→…→成片),0 importer(被 CreationFlowBar 取代) | StageBar.tsx;grep 證實 |
| ENABLE_SUBSYSTEM_REAL_DATA 旗標 | **空轉旗標**:唯二消費者 AssetsPanel/PromptsPanel 皆為死碼 → 開了也無效 | videoFlags.ts:102;§上 |
| spine.persona | 半成品:persona 固定 "creative"(Wave 0 移除人格切換 UI),setPersona 座艙 0 呼叫點,仍隨 directorReply 傳後端 | ProjectSpineProvider.tsx:112;DirectorChatCanvas.tsx:4-5 |
| 測試覆蓋 | 座艙自帶 30+ `.test.tsx/.test.ts`(drawers/canvas/console/panels 幾乎每檔一測),死碼 panels 也有測試(CI 遮蔽死碼事實) | 目錄清單 |

---

## 2. 接線表

### 2.1 UI → state → API → 表 → 儲存

| UI 元件/動作 | 前端 state | tRPC/REST/SSE | 資料表 | 儲存/備註 |
|---|---|---|---|---|
| 座艙載入 | ProjectSpineProvider.project | `creativeProject.get`(骨幹)→並行 `worldbuilding.get{id:worldId}`+`worldStoryboard.listByWorld{worldId}`+`vault.list`+`notes.list`+`contextPacket.getLatest{projectId}` | creative_projects/worldbuilding_frameworks/world_storyboards/consistency_vault/project_notes_calendar | 聚合於 projectGateway.loadProject(:140-176);**vault.list/notes.list 為 user 級無專案過濾**(:161-171);未連結世界觀=無分鏡來源(AIDV-161) |
| 專案切換 | WorldContext activeProjectId(全站唯一來源;mock 模式才自管) | — | localStorage(WorldContext) | ProjectSpineProvider.tsx:103-106,168-171 |
| 生成單鏡(shot 畫布) | shot.gen 樂觀 patch | generation 接縫:`generate.estimateCost`(只送 generationType)→`generate.submitStudioJob{studioType,requestId,modelId,prompt}`→1.5s 輪詢 `generate.jobStatus{jobId}`→`generate.recordGenResult` | background_jobs→digital_asset_library 等三表(02-fullstack §1.1) | generation.trpc.ts:83-174;**seed 與 provider 不在 submitStudioJob payload**(:128-133)——「同 seed 重生」「成本階梯切引擎」對後端無效,seedUsed 回退前端值(:154);route=ref 的 keyframe 映射為 image(:75-77)——座艙**只生成靜態影格,無 i2v**;kind=video 丟 AdapterPendingError(M3,:117-122) |
| 回退鏈/成本守門 | onEvent toast | 前端鏈 hf→gemini→fal→mock;AIDV-160:免費(mock)不跨付費,守門丟 AdapterCostBlockedError | — | generation.trpc.ts:28,48-59,192-199 |
| 批次生成 | scheduleGeneration | 逐鏡序列呼 genOne(250ms 間隔) | 同上 | ProjectSpineProvider.tsx:263-270;**非 director.autoGenerateFromSegments**(舊頁批次鏈未被座艙重用) |
| 上傳參考照(解鎖) | characters 樂觀→precise+四鎖 | `vault.update{id,metadata:{sourceGrade,locked,locks}}`;id 需**數值 vaultItemId**,座艙傳的是字串 characterId→numOrNull→**幾乎必然跳過回寫** | consistency_vault.metadata | ProjectSpineProvider.tsx:273-295;projectGateway.ts:196-210;**無檔案選擇器,零上傳行為**(§4) |
| 核准關鍵影格 | shot.approval 樂觀 | 同 vault.update 路(gateway 註明「無專屬 setApproval」),且送的 metadata 為空 | — | ProjectSpineProvider.tsx:332-344;projectGateway.ts:337 註;重載後 approval 由 listByWorld 列推導,多半回 pending(:407) |
| 角色改設定/場景鎖 | shots.stale/scenes.locked 樂觀 | `worldbuilding.update{id:worldId,patch:{}}`(**空 patch no-op ping**,不夾角色 diff) | worldbuilding_frameworks | projectGateway.ts:212-223(自註「過渡」);live UI 已無此二動作入口(panels 死碼) |
| 引導式寫入 | ingestBreakdown 樂觀 | `worldStoryboard.createFromSegments{worldId,name,segments}`(Shot→storyboard 子物件投影);**未連結世界觀=跳過回寫,只留本地** | world_storyboards | projectGateway.ts:268-312 |
| 分鏡重排(AIDV-239) | shots 樂觀重排 | `creativeProject.update{metadata.shotOrder}` | creative_projects.metadata | projectGateway.ts:328-338 |
| 導演對話 | 元件 msgs state(ephemeral) | `director.chat{messages,personality,projectId}` | 不落 DB(saveToNotes:false) | commander.trpc.ts:36-41 |
| 腳本畫布 | result state | director.generateVideoScript/importScript/saveSession(gzip notes)/listSessions;worldStoryboard.seedSkeleton | project_notes_calendar/world_storyboards | ScriptCanvas.tsx:36-41 |
| 配音/配樂 | submitted state | proStudio.qwenTTS/elevenLabsTTS/soundEffects/textToMusic/voiceStyles+generate.estimateCost | background_jobs→R2→三表 | VoiceAmbientCanvas.tsx:69-87;MusicCanvas.tsx:29 |
| 工作流步驟 | DirectorConsoleProvider.steps | `workflow.getDefault`(水合)/`workflow.save`(每次變更) | user_workflows.stepsJson | DirectorConsoleProvider.tsx:126-141 |
| 抽屜查詢群 | 各抽屜局部 state | promptLibrary.*/promptCollection.listMine/listTeam/aiModels.list/realEarth.search/teachingArchive.search/spirit.listModels/director.estimateSegmentCost/worldbuilding.linkableModels/orchestrationRuns.list | 各對應表 | §1.7 各列 |
| Sidecar 查詢群 | react-query | credits.myBalance/generate.myJobs(5s)/videoProject.list·duplicate·listSnapshots·restoreSnapshot/assets.recentLineage/contextPacket.compileProject | 各對應表 | §1.6 |
| 心跳/額度 | EventSource/react-query | SSE `/api/agents/heartbeat`(30s);videoProject.agentQuota(60s) | agent_dynamic_registry(讀) | agentStatusRoute.ts:147;videoProject.ts:528 |

### 2.2 座艙與舊體系的關係:包裝為主、三處平行

1. **生成/對話/拆解=包裝既有 procedure**(非重新實作後端):generation 接縫走與 Studio 相同的 `generate.*` 統一管線;對話走 DirectorAI 同一支 `director.chat`;拆解過渡走 `director.importScript`;配音/配樂直接用 ProStudio 的 `proStudio.*`;腳本用 `director.generateVideoScript/importScript/saveSession`(與 DirectorAI 完全同源)。抽屜全部是既有 router(promptLibrary/realEarth/teachingArchive/spirit/aiModels/worldbuilding/orchestrationRuns)的**新 UI 皮**。
2. **但「導演台工作流」本身是前端重新實作**:確認門(spine/gate.ts)、stale 級聯、核准、S0X 導航、Context Packet 顯示皆為前端狀態機,持久化走 vault/worldbuilding 的 **metadata/空 patch 過渡寫法**(見上表)——與 DirectorAI 舊頁的 `director.autoGenerateFromSegments` 批次鏈(扣點/webhook/原子退款,01-features §1.2)**互不重用**:座艙批次=前端 for 迴圈逐鏡 submitStudioJob。
3. **三套專案概念同場**:spine=creative_projects(WorldContext id);Sidecar 生命週期卡=video_projects;分鏡實體=world_storyboards(依 worldFrameworkId)。座艙以 worldFrameworkId 做橋,未連結世界觀時分鏡/拆解寫入全部靜默降級為本地。
4. worldStoryboard 讀取用 ownership-scoped `listByWorld`(AIDV-161 防跨專案混入),寫入用與 DirectorAI 相同的 `createFromSegments`。

---

## 3. UIUX 評估(補 C-uiux 缺口)

### 3.1 優點(附證據)

1. **四態鐵律在座艙落實率全站最高**:幾乎所有查詢面板都有 loading/error(重試)/empty(引導文案)/ready 四分支,且共用 `_shared/PanelState`(PanelLoading/PanelError/PanelEmpty)標準件——FlowTv:177-186、ModelCatalog:150-165、RealEarth:76-83、ScriptCanvas:141-143·252-261、ContextSidecar 各卡、AgentOpsPanel:120-143。錯誤文案多附 procedure 名(「promptLibrary.list」),可診斷性佳。
2. **「誠實待後端」文化**:未實作處一律標「待後端」徽章+說明,不假裝完成(AssetGenCanvas:221-243 上傳/外部帶入、RoughCut:152-159 打包、CompletionCanvas:132 zip_export、AgentCatalog:103-106 派工、VideoSettings:99「偏好備忘·未接線」、STEP_LIBRARY pending 步驟 toast)。這是與 LightOrb「假成功無告示」(C-uiux §2.2-9)相反的正面範本。
3. **成本語彙常駐一致**:「先估成本→先扣後生成→失敗全額退還」在 FlowBar/Sidecar/各生成畫布/光球泡泡重複強化(CreationFlowBar:229-231、ContextSidecar:211-214、AmbientOrb:113-115);AIDV-160 成本守門 toast(「未扣點」冷靜態 vs 硬失敗紅色)在 FlowTv/ModelCatalog/AssetGen/spine 四處一致實作。
4. **deep-link 修復動線**:readiness chip→deepLinkToShot→shot 畫布顯示待補原因+就地動作,光球 critical 泡泡 CTA 同路(DirectorConsoleProvider:163-166,184-192)——「點了 chip 就到修復點」成立。
5. **RWD 有專門解**:CockpitColumns 用 `lg:contents` 保桌機零變化、手機單欄+底部 tablist(含 aria-selected);sidecar 關閉時 context 頁籤自動回退畫布(:33-43)。
6. **a11y 基礎面**:抽屜=Radix Sheet(焦點圈);icon 鈕普遍有 aria-label(FlowTv 播放器全套:343-357、LoraCharacters 複製鈕含 44px 目標:95、WorkflowBuilder 上移/下移/移除:101-104);design-kit 結果卡有 role=status/aria-live(ScriptCanvas:200、RoughCut:40、VoiceAmbient:258);AgentQuotaBar 有完整 progressbar aria(:39-45);FlowTv 播放器支援 ←/→/空白/Esc 鍵盤(:291-300)。
7. **防重複與競態處理成熟**:spine.runExclusive ref 級去重防雙擊重複扣點(ProjectSpineProvider:119-130);GuidedJourney runSeq 取消保護+loading 有取消出口(:41-69);回寫失敗「先 await 再報成功」修正過謊報(:286-294,390-396)。
8. **玻璃面統一**:座艙全部用 `glass-card-static`(C-uiux §2.2-2 指出全站 glass-card 幾乎沒人用——座艙正是主要正確使用者)。

### 3.2 缺點(附證據)

1. **右下角浮動元件疊羅漢**:同場至少 4-5 個浮動件——AmbientOrb(fixed bottom-6 right-6 z-50)與 AgentStatusBar(fixed bottom-4 right-4 z-40)**直接重疊**;再加 QuickFeedbackButton(bottom-24 right-4 z-99996)、全域 ProactiveOrbWidget(z-50 可拖)、AidvOrbMount(左下,CHROME ON);手機再疊底部欄位頁籤(sticky bottom z-20)。**兩顆光球並存**(全域光球+座艙 Ambient Copilot)且能力互不相通,認知負荷與誤觸風險高。AmbientOrb.tsx:60;AgentStatusBar.tsx:81;QuickFeedbackButton.tsx:153;DashboardLayout.tsx:943-957。
2. **假成功·信任缺陷(比 C §2.2-9 更深)**:「上傳參考照」**沒有任何檔案選擇/上傳**,點擊即本地把角色改成「✅精準+四鎖全開」並 toast「參考圖已上傳·角色升級」,refImages 憑空 +3;後端回寫又因 id 型別不符幾乎必然跳過——確認門(整個座艙的品管敘事核心)可被一鍵空手騙過,重載後狀態又蒸發。ProjectSpineProvider.tsx:273-295;projectGateway.ts:201-208。
3. **核心工作狀態不持久**:核准/gate 升級/stale 標記/改設定多為樂觀本地+被跳過或 no-op 的回寫(§2.1),導演對話與腳本結果隨畫布切換 unmount 即丟(CreationCanvas.tsx:60-67 條件渲染)——「做了半小時、切個分頁全沒了」是可預期事故;與各處「已核准」「已寫入」成功 toast 敘事矛盾。
4. **儀表數字裝飾性**:成本階梯單價寫死原型值且 provider 不入後端 payload(CreationFlowBar:34-40;generation.trpc.ts:128-133);FlowTv/ModelCatalog/分鏡佔位的「畫面」全是 seed 漸層色塊(誠實但視覺上像縮圖,新手難辨真偽,FlowTv.tsx:197,330);chat 開場 agent 名寫死「OpenRouter→Claude」與實際引擎不符(DirectorChatCanvas:24)。
5. **確認門死路**:「場景缺實景」的唯一解法文案指向「場景頁」,而 ScenePanel/CharacterPanel 已成死碼——live UI 中場景永遠無法鎖定、角色四鎖無法逐項調整,blocked 鏡只剩假上傳一條路(ShotDetailCanvas:176;§1.8)。
6. **抽屜可發現性極差**:8/10 抽屜唯一入口藏在光球協作面板第二層(先點浮球再點選單,AmbientOrb:102-111);I-5 真實地球研究這種「全站唯一入口」功能無任何頂層可見進入點;agent_ops 乾脆無入口。
7. **座艙內文案/註解漂移**:WorkflowBuilder 抽屜與 DirectorConsoleProvider 檔頭仍宣稱工作流「後端待補/本地示意」,實際已接 user_workflows(§1.7);ConsoleDrawers 檔頭寫「四個抽屜」實為十個(:5-9);多個 drawer 描述寫「Phase 1 零後端」易誤讀成「無後端接線」(實為「零新增後端」)。
8. **小字/對比沿襲全站病**:座艙大量 `text-[9px]/[10px]/[11px]` 任意值(FlowTv 徽章 9px、ContextSidecar 10px 群、LoraCharacters 9px 觸發詞)——延續 C §2.2-1;AgentStatusBar 硬編碼 zinc-900 深色殼不吃 token、亮色主題下突兀(AgentStatusBar.tsx:84,95);ActiveVideoTasksBanner 用 `text-amber-200` 亮色文字配淺底(在亮色主題對比不足,ActiveVideoTasksBanner.tsx:27)。
9. **觸控目標不均**:LoraCharacters 已做 min-44px(:95,114,188),但同抽屜「複製參數」鈕 h-5(20px,:142);FlowTv/ModelCatalog 大量 h-6/size-6 密排小鈕;ContextSidecar 版本回溯鈕特意 h-11 min-w-44(:419)——治理只到局部。
10. **鍵盤/焦點缺口**:FlowTv 全屏播放器自架 `role="dialog"` 無 focus trap、無 aria-modal(Esc 有接但 Tab 可穿透到底層,FlowTv.tsx:322-327);StorySpineColumn 鏡列是 button 內再嵌 ReadinessChip button(巢狀互動元素,HTML 不合法且螢幕閱讀器混亂,:124-147);AgentStatusBar 折疊面板無 role/焦點管理(:94)。
11. **手機版首屏負擔**:<lg 只顯示畫布欄,但頂部仍疊 SSE banner+任務橫幅+額度條+FlowBar(流程列+儀表兩行)才到工作面;確認門讀數在手機屬第二欄(脊椎頁籤)不可即時見——鐵則敘事在手機斷裂。CockpitColumns.tsx:33-43;VideoCockpitFrame.tsx:33-36。

---

## 4. 與 01-features §7 對照:座艙新增的死碼/半成品/假資料

§7 既有清單**未收錄**、本次盤點新發現:

**死碼/不可達**
- `shells/video/panels/` 整目錄 7 檔+7 測試(W3-G 遺留;含確認門唯二解鎖 UI)——grep 0 importer
- `shells/video/StageBar.tsx`(+測試)——0 importer
- `agent_ops` 抽屜(AgentOpsPanel+orchestrationRuns.list 皆完整)——0 開啟入口
- `videoProject.requestExport`(AIDV-347 完整後端)——前端 0 呼叫點 → VideoCockpit 成片下載橫幅(AIDV-684)連鎖不可達
- `ENABLE_SUBSYSTEM_REAL_DATA` 旗標——唯二消費者是死碼 panels,空轉
- `spine/mockProjects.ts`+mock gateway——VIDEO_SPINE_MOCK 預設 OFF(離線開發用,合理保留)

**半成品**
- rough-cut 打包(zip_export worker 待補,前端佔位)/ complete 畫布 outputUrl 回填鏈(同因)
- asset 畫布「上傳自有/外部帶入」兩 tab(誠實佔位)
- VideoSettings per-模態引擎偏好(session 態、不影響生成,G10)
- `autoSaveDraft` 開關(0 消費者的死開關)
- spine.persona(固定 creative、無切換 UI)
- 確認門持久化鏈:vault.update id 型別錯配跳寫、worldbuilding.update 空 patch、approval 無落點——整條「定版/核准」重載即蒸發
- 座艙 shot 生成僅產靜態影格(kind=video 為 AdapterPendingError/M3),與「影片座艙」定位落差;匯出卻命名 `.mp4`
- STEP_LIBRARY 的 lora/publish/review 三步(pending 佔位)
- 停用旗標後的完整程式:ENABLE_VIDEO_GATE_KIT(補齊精靈+design-kit 四態)、ENABLE_PROJECT_HUB(五步嚮導+世界連結)、ENABLE_VOICE_MUSIC_WORKFLOW(工作流插步)、ENABLE_WORLD_STYLE_INJECTION(風格前綴)

**假資料/裝飾**
- 成本階梯單價(原型寫死)+provider 切換不入 payload;「同 seed 重生」seed 不入 payload
- FlowTv 放映畫面/ModelCatalog 試生成縮圖/分鏡佔位=seed 決定性漸層(誠實註記但 UI 無標示)
- 「上傳參考照」零上傳假成功(本節最嚴重,見 §3.2-2)
- chat 開場 agent 名「OpenRouter→Claude」與實際引擎不符
- WorkflowBuilder 抽屜「後端待補」過時文案(實已持久化)——反向假資料(謊稱沒存,實際有存)

---

## 5. 結論(給後續卡的一句話)

座艙的**讀路徑**(聚合、目錄、觀測、四態、成本敘事)品質是全站標竿;**寫路徑**(確認門定版/核准/場景鎖/偏好)是樂觀 UI 蓋在型別錯配與 no-op 回寫上的「preparation 階段」半成品,加上 panels 死碼帶走了唯二解鎖 UI,形成「敘事完整、持久化空心」的結構性缺口。優先序建議:①vault/approval 真實回寫+真上傳(信任層)②zip_export worker(北極星成片)③抽屜入口浮出+浮動元件收斂 ④刪 panels/StageBar 死碼與過時文案。

## 6. 缺讀聲明

- `client/src/components/design-kit/` 內部(FlowBar/ShotCard/GateCard/WorkflowBuilder/cockpit.tsx 實作)只讀 import 面,未逐行
- `server/routers/generate.ts` 主體、`workflow.ts` 全檔(僅讀 :16,22)、`agentStatusRoute.ts` 60 行後(快照組裝細節)、`spirit.listModels`/`realEarth.search`/`teachingArchive.search` server 實作——引 02-fullstack 既有結論
- 各 `.test.tsx`(30+ 檔)只確認存在,未逐條讀斷言
- `spine/worldStyle.ts`、`contextPacket.ts`(本地編譯)、`mockProjects.ts` 種子內容未逐行
- DashboardLayout/ProactiveOrbWidget 僅讀浮動定位相關行;VideoProjectCreateDialog 讀前 50 行+mutation 行
