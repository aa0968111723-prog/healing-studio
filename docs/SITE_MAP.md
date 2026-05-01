# Healing Studio 全站關係圖

> 風格：以「網站登入 → 創意工作室 → 模式 → 助手代理 → 功能模組 → 大腦/引擎 → 外部供應商」貫穿的階層+遙測圖。
>
> 本文件包含：
> 1. `mindmap` 全站心智圖（XMind 風格）
> 2. `flowchart` 詳細路由圖 + 黃色便利貼註解
> 3. **大腦推理鏈 4 層遙測架構**（含偵測 / 健康 / 自我修復）
> 4. **光球代理 ↔ 大腦槽 ↔ 引擎 ↔ 供應商**對應
> 5. **各創作室 → 大腦/引擎 觸發路徑**
> 6. **偵測與健康狀態系統**（patrol / autoRepair / langsmith）
> 7. **資料流序列圖**（使用者請求一路到供應商再回傳）
>
> 路由清單來源：`client/src/App.tsx`（30+ 條 `<Route>`）
> 大腦節點來源：`shared/brain-pipeline.ts`、`server/routers/brainPipeline.ts`
>
> **真實同步機制**：
> - `/admin/brain-pipeline` 頁面每 30 秒自動 refetch，狀態（綠/黃/紅/灰）即時跟隨真實 API 健康。
> - 點擊節點打開的 NodeDetailSheet 中所有 repo 檔案路徑會渲染 GitHub 圖示按鈕，**直接跳到原始碼**（由 `VITE_GITHUB_REPO` + `VITE_GITHUB_REF` 控制，預設 `aa0968111723-prog/healing-studio` `main`）。Provider 節點也會額外連到對應的 service 檔（fal → `falDispatcher.ts`、elevenlabs → `elevenLabsExtended.ts` 等）。
> - 單元測試 `brainPipeline.test.ts` 內含 **5 道 drift guard**，CI 會在以下任一情況自動失敗：
>   1. **Router 註冊漂移**：`server/routers.ts` 新增 router 但忘了加入 `ROUTER_TO_PROVIDERS`
>   2. **Page 註冊漂移**：`client/src/App.tsx` 新增 `<Route>` 但忘了加入 `APP_PAGE_REGISTRY`
>   3. **Page→Router 對應**：`PAGE_TO_ROUTERS` 指向不存在的 page id 或 router id
>   4. **Router→AI Slot 對應**：`ROUTER_TO_AI_SLOTS` 指向不存在的 brain/engine 槽
>   5. **檔案存在性**：graph 中任何 `relatedFiles` / `frontendPath` 指到的檔案被改名/刪除

---

## 1. 全站心智圖（mindmap）

```mermaid
mindmap
  root((療癒工作室))
    網站登入
      Google 登入
      網站資料登入
      忘記密碼
      重設密碼
    創意工作室 /studio
      養成模式
        新手引導
        教學總覽 /tutorial-overview
        學習中心 /learn
      標準模式
        圖片創作室 /image-studio
        影片專業工作室 /video-studio
        音樂配音創作室 /pro-studio
        導演 AI /director
        提示詞庫 /prompt-library
      尊享模式
        AI 模型訓練中心 /models
        LoRA 訓練 /lora-trainer
        一致性保險庫 /vault
        我的大腦 /my-brain
    全站光球代理
      光球助手 /agent
      頁面助手 PageAgent
      Proactive Orb Widget
      Orb Voice Button
      Orb Guide Panel
      Agent 偏好 /settings/agent
    AI 大腦（5 推理槽）
      導演腦 director
      新聞過濾腦 analyst
      編譯器腦 storyteller
      技術員腦 technician
      策展人腦 curator
    生成引擎（4 引擎槽）
      圖像引擎 imageEngine
      影片引擎 videoEngine
      音樂引擎 audioEngine
      語音引擎 voiceEngine
    外部供應商
      Gemini
      Vertex AI
      FAL
      ElevenLabs
      Suno
      Replicate
    輔助工具
      創作行事曆 /calendar
      專注流 /focus-flow
      共享空間 /shared
      專案筆記 /notes
      素材庫 /assets
      背景任務 /background-tasks
      創作歷程 /history
      流程檢視 /process
    管理後台
      管理首頁 /admin
      API 用量 /admin/api-usage
      大腦推理鏈 /admin/brain-pipeline
      AI 大腦設定 /settings/ai-brain
      LangSmith /langsmith
    偵測與自我修復
      Patrol 巡檢
      Provider Health
      Error Traces
      API Alerts
      Auto Repair
      Self Reflection
      Accuracy Test
    帳號 / 系統
      帳號設定 /account-settings
      點數 /credits
      設定 /settings
      意見回饋 /feedback
      儀表板 /dashboard
```

---

## 2. 詳細路由圖（含黃色便利貼註解）

```mermaid
flowchart TD
  classDef note fill:#FFF4B8,stroke:#E0C200,color:#5C4A00
  classDef page fill:#E8F0FF,stroke:#3B82F6,color:#1E3A8A
  classDef mode fill:#FCE7F3,stroke:#DB2777,color:#831843
  classDef agent fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef admin fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D

  %% --- 登入 ---
  Login["網站登入"]:::page
  Login --> GLogin["Google 登入<br/>OAuth"]:::page
  Login --> SLogin["網站資料登入<br/>本地帳密"]:::page
  Login -. 忘記密碼 .-> Forgot["/forgot-password"]:::page
  Forgot --> Reset["/reset-password"]:::page

  %% --- 創意工作室 ---
  GLogin --> Studio["/studio<br/>創意工作室"]:::page
  SLogin --> Studio

  Studio --> ModeA["養成模式"]:::mode
  Studio --> ModeB["標準模式"]:::mode
  Studio --> ModeC["尊享模式"]:::mode

  %% --- 養成模式 ---
  ModeA --> Tutorial["/tutorial-overview<br/>教學總覽"]:::page
  ModeA --> Learn["/learn<br/>學習中心"]:::page
  NoteA["黃色註記：養成模式<br/>給新手引導使用<br/>含教學動畫"]:::note
  ModeA -.-> NoteA

  %% --- 標準模式 ---
  ModeB --> ImgStudio["/image-studio<br/>圖片創作室"]:::page
  ModeB --> VidStudio["/video-studio<br/>影片專業工作室"]:::page
  ModeB --> ProStudio["/pro-studio<br/>音樂配音創作室"]:::page
  ModeB --> Director["/director<br/>導演 AI"]:::page
  ModeB --> Prompts["/prompt-library<br/>提示詞庫"]:::page

  %% --- 尊享模式 ---
  ModeC --> Models["/models<br/>AI 模型訓練中心"]:::page
  ModeC --> Lora["/lora-trainer<br/>LoRA 訓練"]:::page
  ModeC --> Vault["/vault<br/>一致性保險庫"]:::page
  ModeC --> MyBrain["/my-brain<br/>我的大腦"]:::page
  NoteC["黃色註記：尊享模式<br/>含付費功能<br/>需訂閱"]:::note
  ModeC -.-> NoteC

  %% --- 全站光球代理 ---
  Studio -. 浮動使用 .-> Orb["全站光球代理<br/>Global Orb"]:::agent
  Orb --> AgentChat["/agent<br/>光球助手"]:::agent
  Orb --> PageAgent["PageAgent<br/>各頁助理"]:::agent
  Orb --> AgentPref["/settings/agent<br/>Agent 偏好"]:::agent
  NoteOrb["黃色註記：光球橫跨全站<br/>監聽當前頁面 context<br/>可呼叫工具與工作流"]:::note
  Orb -.-> NoteOrb

  %% --- 輔助工具 ---
  Studio --> Calendar["/calendar<br/>創作行事曆"]:::page
  Studio --> Focus["/focus-flow<br/>專注流"]:::page
  Studio --> Shared["/shared<br/>共享空間"]:::page
  Studio --> Notes["/notes<br/>專案筆記"]:::page
  Studio --> Assets["/assets<br/>素材庫"]:::page
  Studio --> BgTasks["/background-tasks<br/>背景任務"]:::page
  Studio --> History["/history<br/>創作歷程"]:::page
  Studio --> Process["/process<br/>流程檢視"]:::page

  %% --- 管理後台 ---
  Admin["/admin<br/>管理後台"]:::admin
  Admin --> AdminApi["/admin/api-usage<br/>API 用量"]:::admin
  Admin --> AdminPipe["/admin/brain-pipeline<br/>大腦推理鏈"]:::admin
  Admin --> BrainSet["/settings/ai-brain<br/>AI 大腦設定"]:::admin
  Admin --> LangSmith["/langsmith<br/>LangSmith Tracing"]:::admin
  NoteAdmin["黃色註記：僅 admin 權限可進入<br/>監控 LLM 推理 / 用量 / 成本"]:::note
  Admin -.-> NoteAdmin

  %% --- 帳號系統 ---
  Studio --> Dashboard["/dashboard<br/>儀表板"]:::page
  Studio --> Account["/account-settings<br/>帳號設定"]:::page
  Studio --> Credits["/credits<br/>點數"]:::page
  Studio --> Settings["/settings<br/>系統設定"]:::page
  Studio --> Feedback["/feedback<br/>意見回饋"]:::page
```

---

## 3. 大腦推理鏈架構（4 層遙測）

> 對應檔案：`shared/brain-pipeline.ts`、`server/routers/brainPipeline.ts`、`client/src/pages/AiBrainPipelinePage.tsx`
>
> 這是「大腦可視化」的真實節點分層 — 同一張圖既是站內結構，也是即時健康監測（綠/黃/紅/灰四色狀態）。

```mermaid
flowchart LR
  classDef frontend fill:#E8F0FF,stroke:#3B82F6,color:#1E3A8A
  classDef backend  fill:#F3E8FF,stroke:#9333EA,color:#581C87
  classDef brain    fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef engine   fill:#FFF7ED,stroke:#EA580C,color:#7C2D12
  classDef provider fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D
  classDef detect   fill:#FFF4B8,stroke:#E0C200,color:#5C4A00

  subgraph L1[層 1 · Frontend 頁面]
    direction TB
    P_Studio["/studio"]:::frontend
    P_Image["/image-studio"]:::frontend
    P_Video["/video-studio"]:::frontend
    P_Pro["/pro-studio"]:::frontend
    P_Director["/director"]:::frontend
    P_MyBrain["/my-brain"]:::frontend
    P_Orb["Global Orb<br/>(全站浮動)"]:::frontend
  end

  subgraph L2[層 2 · Backend tRPC Routers（15 個）]
    direction TB
    subgraph L2a[AI Routers]
      R_Brain["brain"]:::backend
      R_Director["director"]:::backend
      R_Image["imageStudio"]:::backend
      R_Video["videoStudio"]:::backend
      R_Pro["proStudio"]:::backend
      R_Lora["loraTrainer"]:::backend
      R_Learn["learnHub"]:::backend
      R_OrbSched["orbScheduler"]:::backend
    end
    subgraph L2b[Service Routers]
      R_ApiUsage["apiUsage"]:::backend
      R_AgentPref["agentPreferences"]:::backend
      R_Prompt["promptLibrary"]:::backend
      R_News["news"]:::backend
      R_Showcase["showcase"]:::backend
      R_LangSmith["langsmith"]:::backend
      R_Admin["adminEval"]:::backend
    end
  end

  subgraph L3[層 3 · AI 大腦（5 推理槽）]
    direction TB
    B_Director["導演腦<br/>director"]:::brain
    B_Analyst["新聞過濾腦<br/>analyst"]:::brain
    B_Story["編譯器腦<br/>storyteller"]:::brain
    B_Tech["技術員腦<br/>technician"]:::brain
    B_Curator["策展人腦<br/>curator"]:::brain
  end

  subgraph L3b[層 3b · 生成引擎（4 引擎槽）]
    direction TB
    E_Image["圖像引擎<br/>imageEngine"]:::engine
    E_Video["影片引擎<br/>videoEngine"]:::engine
    E_Audio["音樂引擎<br/>audioEngine"]:::engine
    E_Voice["語音引擎<br/>voiceEngine"]:::engine
  end

  subgraph L4[層 4 · External Providers]
    direction TB
    PV_Gemini["Gemini"]:::provider
    PV_Vertex["Vertex AI"]:::provider
    PV_FAL["FAL"]:::provider
    PV_Eleven["ElevenLabs"]:::provider
    PV_Suno["Suno"]:::provider
    PV_Replicate["Replicate"]:::provider
  end

  subgraph DET[偵測與自我修復]
    D_Patrol["Patrol 巡檢"]:::detect
    D_Health["Provider Health"]:::detect
    D_Trace["Error Traces"]:::detect
    D_Alert["API Alerts"]:::detect
    D_Repair["Auto Repair"]:::detect
  end

  %% Layer flow（page → router 由前端 PAGE_TO_ROUTERS 提供，圖中略）
  L1 --> L2

  %% Router → Brain / Engine 中介層（語意委派）
  R_Brain -. 管 .-> B_Director
  R_Brain -. 管 .-> B_Analyst
  R_Brain -. 管 .-> B_Story
  R_Brain -. 管 .-> B_Tech
  R_Brain -. 管 .-> B_Curator
  R_Director --> B_Director
  R_Director --> B_Story
  R_Image --> E_Image
  R_Video --> E_Video
  R_Pro --> E_Audio
  R_Pro --> E_Voice
  R_Lora --> E_Image
  R_Learn --> B_Analyst
  R_OrbSched --> B_Director
  R_OrbSched --> B_Tech

  %% Brain / Engine → Provider
  B_Director --> PV_Gemini
  B_Analyst --> PV_Gemini
  B_Story --> PV_Vertex
  B_Tech --> PV_Vertex
  B_Curator --> PV_Gemini

  E_Image --> PV_FAL
  E_Image --> PV_Replicate
  E_Video --> PV_FAL
  E_Audio --> PV_FAL
  E_Audio --> PV_Suno
  E_Voice --> PV_Eleven

  %% Service routers 不打外部 provider，但會被 page 層直接呼叫（CRUD/查詢）
  R_LangSmith -. 讀 trace .-> PV_Gemini

  %% Detection wires
  R_Brain -. 巡檢 .-> D_Patrol
  D_Patrol -. ping .-> D_Health
  D_Health -. 失敗計數 .-> D_Trace
  D_Trace -. 觸發 .-> D_Alert
  D_Alert -. 修補建議 .-> D_Repair
  D_Repair -. 改寫 .-> R_Brain

  Note1["四種狀態<br/>healthy / needs_optimization<br/>broken / abnormal"]:::detect
  D_Patrol -.-> Note1
```

**節點 status 色票**（同 `PipelineNodeCard.tsx`）：

| 狀態 | 顏色 | 含義 |
|---|---|---|
| `healthy` | 綠 | 正常運作 |
| `needs_optimization` | 黃 | 可運作但建議優化（成本高、慢、品質） |
| `broken` | 紅 | 失敗 / API down |
| `abnormal` | 灰 | 未知 / 待巡檢 |

---

## 3.5 完整連線清單（與後端程式碼 1:1 對齊）

> 以下三張表是後端 `server/routers/brainPipeline.ts` 中 `PAGE_TO_ROUTERS`、`ROUTER_TO_AI_SLOTS`、`ROUTER_TO_PROVIDERS` 的真實對照。新增頁面或 router 時請同步更新本表與該檔案。

### A. Page → Router 邊（22 條，覆蓋 32 頁中 22 頁）

| Page | 觸發 Router |
|---|---|
| `/`（home） | `news`、`showcase` |
| `/agent`（agent-chat） | `orbScheduler`、`brain` |
| `/studio` | `imageStudio`、`videoStudio`、`proStudio` |
| `/image-studio` | `imageStudio` |
| `/video-studio` | `videoStudio` |
| `/pro-studio` | `proStudio` |
| `/director` | `director` |
| `/lora-trainer` | `loraTrainer` |
| `/models` | `loraTrainer`、`brain` |
| `/my-brain` | `brain` |
| `/settings/ai-brain`（brain-settings） | `brain` |
| `/learn` | `learnHub` |
| `/tutorial-overview` | `learnHub` |
| `/notes` | —（純前端，目前 codebase 無 notes 後端 router；drift guard 已驗證） |
| `/assets?section=prompts`（prompt-library） | `promptLibrary` |
| `/dashboard?section=langsmith`（langsmith） | `langsmith` |
| `/settings/agent`（agent-preferences） | `agentPreferences` |
| `/settings` | `agentPreferences` |
| `/dashboard` | `apiUsage` |
| `/dashboard?section=credits` | `apiUsage` |
| `/admin` | `apiUsage`、`adminEval` |
| `/admin/api-usage` | `apiUsage` |
| `/process`（process-viewer） | `orbScheduler` |

> 未列出的 10 頁（assets、vault、calendar、shared、feedback、background-tasks、focus-flow、history、admin-brain-pipeline、home 部分）為純 UI / CRUD / meta 頁，不直接觸發 AI router。

### B. Router → Brain / Engine 邊（17 條中介委派）

| Router | 委派的 Brain / Engine 槽 |
|---|---|
| `brain` | `director`、`analyst`、`storyteller`、`technician`、`curator`（管理全部 5 個推理槽） |
| `director` | `brain:director`、`brain:storyteller` |
| `imageStudio` | `engine:imageEngine` |
| `videoStudio` | `engine:videoEngine` |
| `proStudio` | `engine:audioEngine`、`engine:voiceEngine` |
| `loraTrainer` | `engine:imageEngine` |
| `learnHub` | `brain:analyst` |
| `orbScheduler` | `brain:director`、`brain:technician` |

### C. Router → Provider 邊（AI Routers 才有）

| Router | 直接呼叫的 Provider |
|---|---|
| `brain` | gemini、vertex |
| `director` | gemini、vertex |
| `imageStudio` | fal、vertex |
| `videoStudio` | fal、vertex |
| `proStudio` | elevenlabs、fal |
| `loraTrainer` | replicate、fal |
| `learnHub` | gemini |
| `orbScheduler` | gemini、fal |
| `apiUsage` / `agentPreferences` / `promptLibrary` / `news` / `showcase` / `langsmith` / `adminEval` | —（純 DB / 內部資料） |

### D. Brain / Engine → Provider 邊（共 11 條）

| Slot | Provider |
|---|---|
| `brain:director` | gemini |
| `brain:analyst` | gemini |
| `brain:storyteller` | vertex |
| `brain:technician` | vertex |
| `brain:curator` | gemini |
| `engine:imageEngine` | fal、replicate |
| `engine:videoEngine` | fal |
| `engine:audioEngine` | fal、suno |
| `engine:voiceEngine` | elevenlabs |

### E. 節點總計（admin 完整視圖）

| 層 | 類型 | 數量 |
|---|---|---|
| 1 | page-group | 8（依 AppPageGroupId 分群） |
| 1 | page | 32 |
| 2 | router（AI） | 8 |
| 2 | router（service） | 7 |
| 3 | brain-slot | 5 |
| 3 | engine-slot | 4 |
| 3 | orb-agent / orb-assistant / director | 3 |
| 4 | provider | 6 |
| **合計** | — | **74** |

> 邊數合計約 80+：22 page→router + 17 router→slot + 14 router→provider + 11 slot→provider + 多條 orb / director / detection 邊。

---

## 4. 光球代理 ↔ 大腦槽 ↔ 引擎 ↔ 供應商

> 來源：`client/src/contexts/OrbGuideContext.tsx`（intent 對應）、`docs/global-orb-capability-registry.md`、`docs/global-orb-executor.md`

光球的 7 個 intent 直接決定要點亮哪條腦+引擎+供應商鏈：

```mermaid
flowchart LR
  classDef intent fill:#FCE7F3,stroke:#DB2777,color:#831843
  classDef brain  fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef engine fill:#FFF7ED,stroke:#EA580C,color:#7C2D12
  classDef provider fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D
  classDef page fill:#E8F0FF,stroke:#3B82F6,color:#1E3A8A

  Orb((Global Orb)):::intent

  Orb --> I_image["intent: image"]:::intent
  Orb --> I_video["intent: video"]:::intent
  Orb --> I_music["intent: music"]:::intent
  Orb --> I_voice["intent: voice"]:::intent
  Orb --> I_script["intent: script"]:::intent
  Orb --> I_lora["intent: lora"]:::intent
  Orb --> I_explore["intent: explore"]:::intent

  I_image --> P_Image["/image-studio"]:::page --> B_Story["編譯器腦<br/>storyteller"]:::brain --> E_Image["imageEngine"]:::engine --> PV_FAL["FAL / Replicate"]:::provider
  I_video --> P_Video["/video-studio"]:::page --> B_Director["導演腦"]:::brain --> E_Video["videoEngine"]:::engine --> PV_FAL2["FAL"]:::provider
  I_music --> P_Pro1["/pro-studio"]:::page --> B_Curator["策展人腦"]:::brain --> E_Audio["audioEngine"]:::engine --> PV_Suno["Suno / FAL"]:::provider
  I_voice --> P_Pro2["/pro-studio"]:::page --> B_Tech["技術員腦"]:::brain --> E_Voice["voiceEngine"]:::engine --> PV_Eleven["ElevenLabs"]:::provider
  I_script --> P_Director2["/director"]:::page --> B_Director2["導演腦"]:::brain --> PV_Gemini["Gemini"]:::provider
  I_lora --> P_Lora["/lora-trainer"]:::page --> B_Tech2["技術員腦"]:::brain --> PV_Replicate["Replicate"]:::provider
  I_explore --> P_Learn["/learn"]:::page --> B_Analyst["新聞過濾腦<br/>analyst"]:::brain --> PV_Gemini2["Gemini"]:::provider
```

**Orb 元件對照**（`client/src/components/`）：

| 元件 | 角色 |
|---|---|
| `ProactiveOrbWidget.tsx` | 全站浮動光球本體 |
| `OrbGuidePanel.tsx` | intent 選擇 + 引導對話 |
| `orb/OrbVoiceButton.tsx` | 語音輸入鈕 |
| `OrbGuideContext.tsx` | intent → 頁面 + 自動填表 actions |

**後端**：`server/routers/orbScheduler.ts` 把 intent 轉成可執行的 task，丟到對應的 brain slot；任務狀態機見 `docs/global-orb-task-state-machine.md`。

---

## 5. 各創作室 → 大腦/引擎 觸發路徑（Sequence）

實際使用者按下「生成」按鈕的完整呼叫鏈：

```mermaid
sequenceDiagram
  autonumber
  participant U as 使用者
  participant FE as Frontend Page
  participant Orb as Global Orb
  participant TR as tRPC Router
  participant Brain as 大腦槽 (5)
  participant Engine as 引擎槽 (4)
  participant PV as External Provider
  participant Det as Patrol/Health

  U->>FE: 進入 /image-studio
  FE->>Orb: 註冊 PageAgent context
  U->>FE: 輸入 prompt + 按下生成
  FE->>TR: imageStudio.generate()
  TR->>Brain: 呼叫 storyteller (擴寫 prompt)
  Brain->>PV: Gemini chat completion
  PV-->>Brain: 結構化 prompt
  Brain-->>TR: 改寫後 prompt
  TR->>Engine: imageEngine.run(prompt)
  Engine->>PV: FAL / Replicate
  PV-->>Engine: 圖片 URL
  Engine-->>TR: 結果
  TR-->>FE: 顯示圖片

  par 平行偵測
    TR->>Det: reportEngineSuccess/Failure
    Det->>Det: 更新 health cache
    Det->>Det: 寫入 error trace（若失敗）
    Det->>Det: 觸發 API alert（若連續失敗）
  end
```

對於 4 個主要創作室，把上面 sequence 的 router/brain/engine/provider 換成下表對應即可：

| 創作室 | tRPC Router | 主要大腦 | 引擎 | 供應商 |
|---|---|---|---|---|
| 圖片創作室 | `imageStudio` | storyteller | `imageEngine` | FAL / Replicate |
| 影片專業工作室 | `videoStudio` | director | `videoEngine` | FAL |
| 音樂創作（pro-studio） | `proStudio` | curator | `audioEngine` | Suno / FAL |
| 配音（pro-studio） | `proStudio` | technician | `voiceEngine` | ElevenLabs |
| 導演 AI | `director` | director | — | Gemini |
| LoRA 訓練 | `loraTrainer` | technician | — | Replicate |

---

## 6. 偵測與健康狀態系統

> 來源：`server/services/brainAutoRepair.ts`、`server/services/providerHealth.ts`、`server/middleware/brainContext.ts`、`server/services/brainStatePersistence.ts`

```mermaid
flowchart TB
  classDef event fill:#FEF3C7,stroke:#D97706,color:#78350F
  classDef store fill:#E0E7FF,stroke:#4F46E5,color:#312E81
  classDef job fill:#DCFCE7,stroke:#16A34A,color:#14532D
  classDef ui fill:#E8F0FF,stroke:#3B82F6,color:#1E3A8A

  subgraph EVENTS[事件來源]
    E1["Engine 呼叫成功/失敗"]:::event
    E2["Provider ping (定時)"]:::event
    E3["Admin 手動觸發 patrol"]:::event
  end

  subgraph JOBS[處理任務]
    J1["providerHealth.ts<br/>checkProvider()"]:::job
    J2["brainContext.ts<br/>updateHealthCache()"]:::job
    J3["brainAutoRepair.ts<br/>generateErrorTrace()"]:::job
    J4["brainAutoRepair.ts<br/>raiseApiAlert()"]:::job
    J5["brainAutoRepair.ts<br/>proposeSelfReflection()"]:::job
    J6["brainAutoRepair.ts<br/>runAccuracyTest()"]:::job
    J7["brainStatePersistence.ts<br/>flushTo .brain-state.json"]:::job
  end

  subgraph STORES[資料存放]
    S1["健康快取 (in-memory)<br/>consecutiveFailures"]:::store
    S2["Error Traces (max 200)"]:::store
    S3["API Alerts (max 200)"]:::store
    S4["Self-Reflection 提案<br/>(待 admin 核可)"]:::store
    S5[".brain-state.json<br/>(persisted)"]:::store
  end

  subgraph UIS[呈現]
    U1["/admin/brain-pipeline<br/>SummaryBar + Canvas"]:::ui
    U2["/admin/api-usage<br/>KPI + 圖表"]:::ui
    U3["/langsmith<br/>Trace viewer"]:::ui
    U4["/settings/ai-brain<br/>提案核可"]:::ui
  end

  E1 --> J2 --> S1
  E1 --> J3 --> S2
  E2 --> J1 --> S1
  E3 --> J1
  S1 -. 連續失敗 ≥ 閾值 .-> J4 --> S3
  S2 -. 累積錯誤 .-> J5 --> S4
  S2 -. 品質低 .-> J6 --> S4
  S2 --> J7 --> S5
  S3 --> J7
  S4 --> J7

  S1 --> U1
  S2 --> U1
  S3 --> U1
  S3 --> U2
  S4 --> U4

  Note["黃色註記：整套偵測 30 秒自動 refetch<br/>另含『重新檢測』按鈕手動觸發 patrol"]:::event
  U1 -.-> Note
```

**核心 API**（皆在 `trpc.brainPipeline`）：

| API | 用途 |
|---|---|
| `getGraph()` | 完整 admin 視圖（pages + routers + brain + engine + provider + alerts） |
| `getMyGraph()` | 個人化視圖（僅該使用者的 5 推理腦 + 4 引擎 + orb/director） |
| `getSummary()` | KPI 卡片用的輕量 summary |
| `runPatrol()` | 立即 ping 所有供應商 + 重整健康快取 |

---

## 7. 後端對應索引（全 15 個 router 完整列表）

### 7.1 AI Routers（會呼叫外部 LLM/生成 API）

| Router | 檔案 | 主要職責 | 觸發 Brain / Engine |
|---|---|---|---|
| `brain` | `server/routers/brain.ts` | 大腦組態 CRUD、健康、錯誤追蹤 | 5 個推理槽全管 |
| `director` | `server/routers/director.ts` | 導演對話、CO-STAR、RAG 記憶 | director、storyteller |
| `imageStudio` | `server/routers/imageStudio.ts` | 圖片生成 dispatch | imageEngine |
| `videoStudio` | `server/routers/videoStudio.ts` | 影片生成 dispatch | videoEngine |
| `proStudio` | `server/routers/proStudio.ts` | 音樂/配音/聲音克隆 | audioEngine、voiceEngine |
| `loraTrainer` | `server/routers/loraTrainer.ts` | LoRA / 自訂風格訓練 | imageEngine |
| `learnHub` | `server/routers/learnHub.ts` | 教學內容、問答 | analyst |
| `orbScheduler` | `server/routers/orbSchedulerRouter.ts` | 光球任務狀態機 | director、technician |

### 7.2 Service Routers（純資料/管理，無外部 AI）

| Router | 檔案 | 主要職責 |
|---|---|---|
| `apiUsage` | `server/routers/apiUsage.ts` | token / 成本 / 呼叫次數彙整 |
| `agentPreferences` | `server/routers/agentPreferencesRouter.ts` | 光球與 PageAgent 偏好 |
| `promptLibrary` | `server/routers/promptLibrary.ts` | 提示詞 CRUD/收藏 |
| `news` | `server/routers/news.ts` | 首頁新聞 |
| `showcase` | `server/routers/showcase.ts` | 首頁作品展示 |
| `langsmith` | `server/routers/langsmith.ts` | LangSmith trace/dataset |
| `adminEval` | `server/routers/adminRouter.ts` | Agent 評估、品質檢測 |

### 7.3 偵測與設定相關文件

| 主題 | 對應檔案 / 文件 |
|---|---|
| 全站光球代理（語意層） | `docs/global-orb-*.md`、`docs/AGENT_CONDITIONS_AUDIT.md` |
| 大腦推理鏈視覺化 | `server/routers/brainPipeline.ts`、`shared/brain-pipeline.ts`、`docs/AI_BRAIN_OVERVIEW.md` |
| AI 大腦設定 | `docs/BRAIN_CONFIGURATION.md` |
| 偵測 / 自我修復 | `server/services/brainAutoRepair.ts`、`server/services/providerHealth.ts`、`server/services/brainStatePersistence.ts` |
| 全站節點對照 | `docs/fullstack-node-level-map-2026-04-29.zh-TW.md` |
| 連線健康檢查 | `docs/connection-audit-2026-04-29.md` |
| 外部供應商 | `docs/external-api-supplier-audit-2026-04-23.md` |
| API 用量管理 | `docs/admin-api-usage.md` |

---

## 8. 預覽與匯出

**VS Code 預覽**：安裝 *Markdown Preview Mermaid Support*，按 `Cmd+Shift+V`（macOS）/ `Ctrl+Shift+V`（Win/Linux）。

**GitHub 預覽**：push 後在 web 介面開啟此 `.md` 即自動渲染。

**匯出 SVG / PNG**
```bash
npx -p @mermaid-js/mermaid-cli mmdc \
  -i docs/SITE_MAP.md \
  -o docs/site-map.svg \
  -t neutral -b transparent
```

**互動心智圖（可摺疊）**
```bash
npx markmap-cli docs/SITE_MAP.md
```

---

## 9. 升級為應用內 XYFlow 互動頁

**選項 A — 獨立分頁（推薦給初次嘗試）**

新增 `/site-map` 路由，純展示用，不接 health 資料：

| 新增檔案 | 用途 |
|---|---|
| `client/src/pages/SiteMapPage.tsx` | 頁面殼，fork `AiBrainPipelinePage` |
| `client/src/components/site-map/SiteMapCanvas.tsx` | XYFlow 畫布 |
| `shared/site-map.ts` | **純 TS 節點資料**（同時餵 Mermaid 與 XYFlow） |
| `App.tsx` | 加 `<Route path="/site-map" component={SiteMapPage} />` |

**選項 B — 整合進大腦推理鏈頁面（推薦給生產用）**

直接擴充 `AiBrainPipelinePage.tsx`，把 page/page-group 節點納入既有 graph，與 brain/engine/provider 同畫布顯示。優點：
- 共用同一份 health 偵測（綠/黃/紅/灰即時上色）
- 點擊某 page 節點 → 反推它觸發哪些 brain/engine（連線高亮）
- 加上「站點視圖 / 大腦視圖 / 完整視圖」三個 tab，切換 layer 顯示

**實作建議**：在 `shared/brain-pipeline.ts` 的 `kind` 加 `page`、`page-group`（其實已有），在 `server/routers/brainPipeline.ts:getGraph()` 把 `client/src/App.tsx` 的 routes 也輸出成節點，再用 `useDagreLayout` 一起佈局。這樣**完全不需要新頁面**，現有的 `/admin/brain-pipeline` 就直接變成全站關係圖 + 健康監測二合一。

> 你問題裡的「放入大腦可視化可以當分頁或是直接彙整加入偵測功能」——
> **建議走選項 B**，因為兩者本來就共用同一份節點型別 (`PipelineNode.kind`)，直接整合可省一份維護。

---

## 10. 維護規則

1. **新增頁面**：依序更新
   - `client/src/App.tsx`：加 `<Route>`
   - `shared/appRegistry.ts`：加 `AppPageRegistryItem`（含 `group` 與 `supportsPageAgent`）
   - `server/routers/brainPipeline.ts`：若會觸發 AI router，更新 `PAGE_TO_ROUTERS`
   - 本文件 §2 flowchart 與 §3.5 表 A
2. **新增 router**（drift guard 會自動偵測，CI 會失敗直到完成）：
   - `server/routers.ts` 註冊
   - `server/routers/brainPipeline.ts:ROUTER_TO_PROVIDERS` 加 entry（service router 用 `providers: []`）；若該 router 不該出現在大腦推理鏈圖上（如 system / brainPipeline 自身），請改更新 `brainPipeline.test.ts` 的 `exempt` 清單
   - 若會委派給某 brain/engine 槽，更新 `ROUTER_TO_AI_SLOTS`
   - 本文件 §3.5 表 B/C 與 §7
3. **新增大腦槽 / 引擎槽 / 供應商**：同步 `shared/brain-pipeline.ts`、`server/middleware/brainContext.ts`、本文件 §3、§3.5 表 D、§4、§5。
4. **偵測機制變動**（新增 alert 來源、自我修復策略）→ 更新 §6 流程圖與相關 service。
5. **黃色便利貼** (`classDef note`)：用於補充「業務語意 / 使用情境」，**不寫實作細節**。
6. **三模式（養成 / 標準 / 尊享）**：目前是文件層的概念分群，若日後落地到程式（subscription tier 或 Studio.tsx state），先改本文件再改程式碼，確保文件先行。
7. **GitHub 連結**：節點檔案路徑會自動以 `VITE_GITHUB_REPO` / `VITE_GITHUB_REF` 組成 `https://github.com/<repo>/blob/<ref>/<path>` 並渲染為點擊按鈕。預設值在 `client/src/lib/env.validated.ts`；切換分支或 fork 只需設環境變數。
8. **未來重構建議**：將 `PAGE_TO_ROUTERS`、`ROUTER_TO_AI_SLOTS`、`ROUTER_TO_PROVIDERS` 三張表抽到 `shared/site-map.ts` 純資料檔，**同時餵給 Mermaid 與 XYFlow**，避免文件與程式碼雙軌不同步。
