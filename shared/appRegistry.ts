import type { AgentAction } from "./agent-actions";

export type AppPageGroupId =
  | "orb"
  | "create"
  | "train"
  | "project"
  | "assets"
  | "learn"
  | "settings"
  | "admin";

export interface AppPageQuickAction {
  id: string;
  label: string;
  description: string;
  /** Optional route jump for one-tap entry cards (/agent, orb widget). */
  path?: string;
  /** Optional starter prompt to send into chat directly. */
  prompt?: string;
  /** Optional structured action for PageAgent bus. */
  action?: AgentAction;
}

export interface AppPageRegistryItem {
  id: string;
  label: string;
  path: string;
  group: AppPageGroupId;
  description: string;
  aliases: string[];
  showInSidebar: boolean;
  showInAgentHome: boolean;
  agentEntryPriority: number;
  supportsPageAgent: boolean;
  quickActions: AppPageQuickAction[];
  orbHints: string[];
}

export const APP_PAGE_REGISTRY: AppPageRegistryItem[] = [
  {
    id: "home",
    label: "首頁",
    path: "/",
    group: "orb",
    description: "平台首頁與入口導覽",
    aliases: ["首頁", "home", "landing"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 100,
    supportsPageAgent: true,
    quickActions: [{ id: "explore-home", label: "先逛逛", description: "查看平台亮點與入口" }],
    orbHints: ["我想先看看這個網站在做什麼"],
  },
  {
    id: "agent-chat",
    label: "全站光球代理",
    path: "/agent",
    group: "orb",
    description: "先理解需求，再帶你去正確功能並幫忙操作",
    aliases: ["光球", "全站光球代理", "agent", "聊天", "助手"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 1,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "start-guided-flow",
        label: "幫我開始",
        description: "描述想要的成果，光球會先問清需求後帶路",
        prompt: "我想用光球幫我找到最適合的入口並教我怎麼做。",
      },
      {
        id: "diagnose-needs",
        label: "幫我拆解需求",
        description: "告訴光球成品、用途、素材，讓它安排流程",
        prompt: "我想做一個作品，但不確定要從哪開始。我的用途是____，手上有/沒有素材，請幫我安排步驟和頁面。",
      },
    ],
    orbHints: [
      "我不知道從哪裡開始，請你帶我做第一步",
      "我想做的成品是____，用途是____，幫我選頁面並告訴我怎麼做",
    ],
  },
  {
    id: "studio",
    label: "創作工作室",
    path: "/studio",
    group: "create",
    description: "跨模態創作主入口",
    aliases: ["工作室", "創作", "studio"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 2,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "open-studio",
        label: "開始創作",
        description: "進入統一創作入口",
        path: "/studio",
      },
    ],
    orbHints: ["我想快速做一個作品"],
  },
  {
    id: "image-studio",
    label: "圖片創作室",
    path: "/image-studio",
    group: "create",
    description: "圖片生成與編輯",
    aliases: ["image", "圖片", "圖像"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 3,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "image-generate",
        label: "生成圖片",
        description: "用提示詞建立新圖片",
        action: { type: "setModality", modality: "image" },
        prompt: "幫我做一張療癒風景圖。",
      },
      {
        id: "image-params",
        label: "討論參數",
        description: "和光球聊風格、取景、光感與細節強度",
        path: "/image-studio",
        prompt:
          "我想先討論圖片參數與感覺，幫我一步步調整風格、光線、構圖和細節強度。",
      },
      {
        id: "image-model-deep-dive",
        label: "模型細膩導覽",
        description: "逐一比較圖片模型的長處、功能優勢與適用場景",
        path: "/image-studio",
        prompt:
          "請你細膩地帶我看圖片創作室每個模型的長處、功能優勢、限制與適用情境，最後給我選型建議。",
      },
    ],
    orbHints: ["幫我生成一張圖片"],
  },
  {
    id: "video-studio",
    label: "影片創作室",
    path: "/video-studio",
    group: "create",
    description: "影片生成與轉換",
    aliases: ["video", "影片", "動畫"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 4,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "video-generate",
        label: "生成影片",
        description: "建立短片或動態片段",
        action: { type: "setModality", modality: "video" },
        prompt: "我想做一支 5 秒鐘療癒短片。",
      },
      {
        id: "video-mood",
        label: "調整氛圍",
        description: "討論節奏、鏡位、運鏡與情緒風格",
        path: "/video-studio",
        prompt:
          "我想要先討論影片感覺和參數，幫我調整節奏、鏡頭語言、運鏡和情緒。",
      },
      {
        id: "video-model-deep-dive",
        label: "模型細膩導覽",
        description: "逐一比較影片模型長處、功能優勢與取捨",
        path: "/video-studio",
        prompt:
          "請你細膩比較影片創作室每個模型的長處、功能優勢、限制、成本與適用場景，並給我選型建議。",
      },
    ],
    orbHints: ["我想做一支短影片"],
  },
  {
    id: "pro-studio",
    label: "音樂配音創作室",
    path: "/pro-studio",
    group: "create",
    description: "音樂、語音、音效專業工作台",
    aliases: ["music", "voice", "audio", "音樂", "配音"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 5,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "music-generate",
        label: "生成音樂",
        description: "建立背景音樂或語音",
        action: { type: "setModality", modality: "audio" },
        prompt: "幫我生成一段放鬆冥想音樂。",
      },
      {
        id: "pro-parameter-tuning",
        label: "微調參數",
        description: "用聊天方式調整音色、情緒、速度與混音方向",
        path: "/pro-studio",
        prompt:
          "請你像 AI 代理人一樣，帶我討論音樂/語音參數，依我想要的感覺逐步微調。",
      },
      {
        id: "pro-model-deep-dive",
        label: "模型細膩導覽",
        description: "逐一比較音樂/配音模型長處、功能優勢與取捨",
        path: "/pro-studio",
        prompt:
          "請你細膩比較音樂配音創作室每個模型的長處、功能優勢、限制與適用情境，並給我選型建議。",
      },
    ],
    orbHints: ["我想做配樂或配音"],
  },
  {
    id: "director",
    label: "導演 AI",
    path: "/director",
    group: "create",
    description: "腳本與分鏡企劃",
    aliases: ["script", "director", "腳本"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 6,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "script-plan",
        label: "規劃腳本",
        description: "先產生故事與分鏡",
        prompt: "幫我規劃一段 30 秒故事腳本。",
      },
      {
        id: "director-model-deep-dive",
        label: "模型細膩導覽",
        description: "深度比較導演 AI 管線各模型優勢與成本",
        path: "/director",
        prompt:
          "請細膩比較導演 AI 管線裡圖像、影片、音樂、語音模型的長處、成本與適用場景，並給我分鏡選型策略。",
      },
    ],
    orbHints: ["幫我先整理腳本"],
  },
  {
    id: "lora-trainer",
    label: "模型訓練中心",
    path: "/models",
    group: "train",
    description: "LoRA 訓練流程",
    aliases: ["lora", "訓練", "trainer", "角色鍛造", "鍛造所", "character-forge"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 12,
    supportsPageAgent: true,
    quickActions: [
      { id: "start-training", label: "開始訓練", description: "上傳資料啟動 LoRA 訓練" },
      {
        id: "open-character-forge",
        label: "開啟角色鍛造精靈",
        description: "進入角色鍛造所並開啟新增角色對話框",
        path: "/models",
        prompt:
          "請切到「角色鍛造所」分頁,開啟角色鍛造精靈,引導我從資料集 → 自動標註 → 超參數 → 開始訓練,過程中提示每一步的常見地雷。",
      },
      {
        id: "trainer-model-deep-dive",
        label: "模型細膩導覽",
        description: "依訓練類型比較資料量、引擎與參數起手式",
        path: "/models",
        prompt:
          "請深度比較模型訓練中心各訓練類別(人物/風格/場景/影片/聲音)的資料量門檻、推薦引擎、超參數起手式與常見失敗點。",
      },
    ],
    orbHints: ["我要訓練自己的模型", "開啟角色鍛造精靈"],
  },
  {
    id: "dashboard",
    label: "儀表板",
    path: "/dashboard",
    group: "project",
    description: "使用統計與進度洞察",
    aliases: ["dashboard", "統計", "報表"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 30,
    supportsPageAgent: true,
    quickActions: [
      { id: "view-stats", label: "查看數據", description: "檢視生成與使用概況" },
      {
        id: "dashboard-insight-deep-dive",
        label: "數據洞察導覽",
        description: "拆解請求量、成本、模態分佈與下一步優化",
        path: "/dashboard",
        prompt:
          "請深度解讀儀表板數據：請求量、成本、模態分佈、單次成本效率，並給我下一步優化策略與優先順序。",
      },
    ],
    orbHints: ["幫我看看最近使用狀況"],
  },
  {
    id: "history",
    label: "生成歷史",
    path: "/assets?section=history",
    group: "project",
    description: "所有生成紀錄時間線",
    aliases: ["history", "紀錄", "歷史"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 20,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-history", label: "查看歷史", description: "回顧過去作品與任務" },
      {
        id: "history-model-deep-dive",
        label: "模型細膩導覽",
        description: "用歷史反推各模型成功樣式與參數策略",
        path: "/assets?section=history",
        prompt:
          "請帶我用生成歷史反推每個模型的成功樣式、常見失敗訊號與參數調整方向，並整理成可重複流程。",
      },
    ],
    orbHints: ["找我之前做的內容"],
  },
  {
    id: "notes",
    label: "專案筆記",
    path: "/notes",
    group: "project",
    description: "筆記與專案整理",
    aliases: ["notes", "筆記"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 21,
    supportsPageAgent: true,
    quickActions: [
      { id: "save-note", label: "記錄想法", description: "把靈感存成筆記" },
      {
        id: "notes-planning-deep-dive",
        label: "規劃筆記導覽",
        description: "整理腳本、待辦、標籤與可執行下一步",
        path: "/notes",
        prompt:
          "請深度整理我的專案筆記，按主題分群（腳本/待辦/排程）並輸出可執行的下一步清單與優先級。",
      },
    ],
    orbHints: ["幫我把這段記到筆記"],
  },
  {
    id: "langsmith",
    label: "AI 監控中心",
    path: "/dashboard?section=langsmith",
    group: "settings",
    description: "LangSmith 追蹤分析與模型監控儀表板（dashboard 分頁）",
    aliases: ["langsmith", "監控", "追蹤", "模型監控", "ai 監控中心"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 30,
    // 此條目為快捷入口，實際處理動作由 dashboard 頁的 PageAgent 接手；
    // 設為 false 避免 scan-routes 誤抓「找不到 useRegisterPageAgent」。
    supportsPageAgent: false,
    quickActions: [
      {
        id: "open-langsmith",
        label: "打開監控",
        description: "查看最近 LLM 追蹤、錯誤率與延遲趨勢",
        path: "/dashboard?section=langsmith",
      },
    ],
    orbHints: ["帶我看 LangSmith 監控", "我想查最近模型呼叫的錯誤和延遲"],
  },
  {
    id: "agent-preferences",
    label: "代理人 + 助手 設定",
    path: "/settings/agent",
    group: "settings",
    description: "全站光球代理與光球助手的所有細節：行為模式、語音、工具白黑名單、頁面權限、UI 偏好、自動排程",
    aliases: [
      "agent settings",
      "代理設定",
      "光球設定",
      "光球助手設定",
      "ai 代理設定",
      "agent preferences",
    ],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 25,
    supportsPageAgent: false,
    quickActions: [
      {
        id: "open-agent-settings",
        label: "打開代理設定",
        description: "管理光球代理的全部細節",
        path: "/settings/agent",
      },
    ],
    orbHints: [
      "我想調整光球",
      "改光球的設定",
      "讓光球少問一點",
      "讓光球純聊天",
      "設定自動排程",
    ],
  },
  {
    id: "settings",
    label: "個人設定",
    path: "/settings",
    group: "settings",
    description: "帳戶與個人偏好設定",
    aliases: ["settings", "設定"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 90,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-settings", label: "調整設定", description: "修改個人偏好與帳戶資訊" },
      {
        id: "settings-deep-dive",
        label: "個人設定導覽",
        description: "逐項說明外觀、通知、場景與管理設定取捨",
        path: "/settings",
        prompt:
          "請細膩導覽個人設定：外觀模式、場景、通知、引導與管理功能的用途、風險與推薦配置。",
      },
    ],
    orbHints: ["我想調整我的設定"],
  },
  {
    id: "credits",
    label: "積分說明",
    path: "/dashboard?section=credits",
    group: "project",
    description: "積分與方案說明",
    aliases: ["credits", "點數", "積分"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 31,
    supportsPageAgent: true,
    quickActions: [
      { id: "view-credits", label: "查看積分", description: "確認積分規則與餘額" },
      {
        id: "credits-deep-dive",
        label: "積分規則導覽",
        description: "比較模型費率、積分消耗與節省策略",
        path: "/dashboard?section=credits",
        prompt:
          "請深度解讀積分說明：不同模型費率、常見任務耗點、如何用低成本流程先驗證再定稿。",
      },
    ],
    orbHints: ["我的點數怎麼算"],
  },
  {
    id: "assets",
    label: "數位資產庫",
    path: "/assets",
    group: "assets",
    description: "管理圖片、影片與音頻資產；含生成歷史、提示詞庫、一致性保險庫、共享空間、背景任務中心",
    aliases: ["assets", "素材", "資產", "提示詞", "保險庫", "共享", "背景任務"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 10,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "browse-assets",
        label: "瀏覽素材",
        description: "管理與搜尋既有資產",
        path: "/assets",
      },
      {
        id: "open-prompts",
        label: "提示詞庫",
        description: "挑選可重用的提示詞模板",
        path: "/assets?section=prompts",
      },
      {
        id: "open-vault",
        label: "一致性保險庫",
        description: "維護角色與風格一致設定",
        path: "/assets?section=vault",
      },
      {
        id: "open-shared",
        label: "共享空間",
        description: "查看團隊共享作品",
        path: "/assets?section=shared",
      },
      {
        id: "open-tasks",
        label: "背景任務中心",
        description: "追蹤背景任務進度",
        path: "/assets?section=tasks",
      },
    ],
    orbHints: ["打開我的素材庫", "給我一些提示詞靈感", "我有哪些背景任務"],
  },
  {
    id: "prompt-library",
    label: "提示詞庫",
    path: "/assets?section=prompts",
    group: "assets",
    description: "提示詞模板與收藏",
    aliases: ["prompt", "提示詞", "library"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 22,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-prompts", label: "找提示詞", description: "挑選可重用的提示詞模板", path: "/assets?section=prompts" },
      {
        id: "prompt-model-deep-dive",
        label: "模型細膩導覽",
        description: "按任務拆解 prompt 模板、變體與參數搭配",
        path: "/assets?section=prompts",
        prompt:
          "請深度拆解提示詞庫模板：每種任務適合的 prompt 架構、可替換欄位、負向詞、以及模型/參數搭配建議。",
      },
    ],
    orbHints: ["給我一些提示詞靈感"],
  },
  {
    id: "models",
    label: "角色鍛造所",
    path: "/models",
    group: "assets",
    description: "模型管理與版本檢視",
    aliases: ["models", "模型", "角色"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 23,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "open-models",
        label: "查看模型",
        description: "管理訓練後的模型資產",
        path: "/models",
      },
      {
        id: "model-subitems",
        label: "整合模型子項目",
        description: "比較模型版本、用途與最佳參數配置",
        path: "/models",
        prompt:
          "請像真正的 AI 代理人一樣，帶我整理模型子項目，包含版本差異、適用場景與建議參數。",
      },
      {
        id: "models-model-deep-dive",
        label: "模型細膩導覽",
        description: "逐版比較模型用途、品質穩定度與風險控管",
        path: "/models",
        prompt:
          "請深度比較角色鍛造所中各模型版本的用途、品質穩定度、成本與風險，並給我版本管理策略。",
      },
    ],
    orbHints: ["我的模型在哪裡"],
  },
  {
    id: "vault",
    label: "一致性保險庫",
    path: "/assets?section=vault",
    group: "assets",
    description: "角色與場景一致性素材管理",
    aliases: ["vault", "一致性", "保險庫"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 24,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-vault", label: "管理一致性", description: "維護角色與風格一致設定", path: "/assets?section=vault" },
      {
        id: "vault-model-deep-dive",
        label: "模型細膩導覽",
        description: "建立角色/場景一致性規格與跨模型套用策略",
        path: "/assets?section=vault",
        prompt:
          "請深度整理一致性保險庫：角色錨點、場景錨點、風格規範如何跨不同生成模型維持一致。",
      },
    ],
    orbHints: ["保持角色一致"],
  },
  {
    id: "calendar",
    label: "創作排程",
    path: "/notes",
    group: "project",
    description: "專案時間排程",
    aliases: ["calendar", "排程", "行程"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 25,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-calendar", label: "查看排程", description: "檢視與安排創作時程" },
      {
        id: "calendar-deep-dive",
        label: "創作排程導覽",
        description: "把素材、生成、訓練任務排成可執行節奏",
        path: "/notes",
        prompt:
          "請深度規劃創作排程：如何把素材整理、生成迭代、模型訓練、交付節點安排成一週節奏。",
      },
    ],
    orbHints: ["幫我排一下這週創作"],
  },
  {
    id: "shared",
    label: "共享空間",
    path: "/assets?section=shared",
    group: "assets",
    description: "團隊共享與展示",
    aliases: ["shared", "共享", "團隊"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 26,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-shared", label: "打開共享", description: "查看團隊共享作品", path: "/assets?section=shared" },
      {
        id: "shared-model-deep-dive",
        label: "模型細膩導覽",
        description: "拆解團隊共享素材/模型如何復用與評分",
        path: "/assets?section=shared",
        prompt:
          "請深度拆解共享空間的素材與模型復用流程，包含命名規範、評分維度、回饋迭代與團隊協作建議。",
      },
    ],
    orbHints: ["看看團隊共享作品"],
  },
  {
    id: "learn",
    label: "學習文件中心",
    path: "/learn",
    group: "learn",
    description: "教學文件與指南",
    aliases: ["learn", "教學", "文件"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 40,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-learn", label: "學習教學", description: "瀏覽新手與進階教學" },
      {
        id: "learn-deep-dive",
        label: "學習路徑導覽",
        description: "按程度與目標生成分階段學習計畫",
        path: "/learn",
        prompt:
          "請深度規劃我的學習文件中心路徑，依新手到進階拆成階段，並附每階段建議練習與驗收方式。",
      },
    ],
    orbHints: ["有新手教學嗎"],
  },
  {
    id: "feedback",
    label: "回饋中心",
    path: "/feedback",
    group: "learn",
    description: "提交與追蹤回饋",
    aliases: ["feedback", "意見", "回饋"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 41,
    supportsPageAgent: true,
    quickActions: [{ id: "send-feedback", label: "提交回饋", description: "回報問題或提出建議" }],
    orbHints: ["我要回報一個問題"],
  },
  {
    id: "background-tasks",
    label: "背景任務中心",
    path: "/assets?section=tasks",
    group: "assets",
    description: "查看與管理背景任務",
    aliases: ["tasks", "背景任務", "queue"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 27,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-background-tasks", label: "查看任務", description: "追蹤背景任務進度", path: "/assets?section=tasks" },
      {
        id: "tasks-model-deep-dive",
        label: "模型細膩導覽",
        description: "用任務佇列判讀模型耗時、成功率、失敗原因與重試優先順序的策略",
        path: "/assets?section=tasks",
        prompt:
          "請深度解讀背景任務中心的任務佇列，幫我建立模型耗時、成功率、失敗原因與重試優先順序的策略。",
      },
    ],
    orbHints: ["我有哪些背景任務"],
  },
  {
    id: "tutorial-overview",
    label: "教學總覽",
    // App.tsx 同時掛 /tutorial-overview 與 /learn/tutorial-overview 兩條別名，
    // 這裡選用較短的版本當主路徑。
    path: "/tutorial-overview",
    group: "learn",
    description: "教學入口總覽：快速導覽、分站教學、功能教學連結",
    aliases: ["tutorial", "教學", "overview", "入門", "learn/tutorial-overview"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 35,
    supportsPageAgent: true,
    quickActions: [
      { id: "start-tour", label: "啟動全站新手教學", description: "從首頁開始完整新手導覽" },
      { id: "go-agent-chat", label: "用光球開始互動教學", description: "透過光球助手一步一步學習" },
    ],
    orbHints: ["我想開始教學", "新手怎麼開始", "給我一個導覽"],
  },
  {
    id: "brain-settings",
    label: "AI 大腦組態",
    path: "/admin?section=brain",
    group: "admin",
    description: "5 推理大腦 + 4 生成引擎插槽組態，含降級與健康狀態",
    aliases: ["brain", "AI 大腦", "推理大腦", "生成引擎", "brain settings"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 92,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-brain-settings", label: "開啟大腦組態", description: "前往 AI 大腦設定", path: "/admin?section=brain" },
    ],
    orbHints: ["切換大腦", "改 director model", "查看大腦健康度"],
  },
  {
    id: "my-brain",
    label: "我的大腦",
    path: "/my-brain",
    group: "settings",
    description: "個人 AI 大腦設定：選擇習慣的推理引擎與生成引擎",
    aliases: ["my brain", "我的大腦", "個人大腦", "my-brain"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 70,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-my-brain", label: "開啟我的大腦", description: "管理個人大腦", path: "/my-brain" },
    ],
    orbHints: ["切到我的大腦", "個人 AI 設定"],
  },
  {
    id: "admin-brain-pipeline",
    label: "大腦推理鏈視覺化",
    path: "/admin/brain-pipeline",
    group: "admin",
    description: "管理員專用：AI 大腦推理鏈即時可視化（事件流、決策追蹤）",
    aliases: ["brain pipeline", "推理鏈", "pipeline", "brain-pipeline"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 93,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-brain-pipeline", label: "查看推理鏈", description: "前往大腦推理鏈視覺化", path: "/admin/brain-pipeline" },
    ],
    orbHints: ["看推理鏈", "大腦動作流"],
  },
  {
    id: "focus-flow",
    label: "專注流",
    path: "/focus-flow",
    group: "project",
    description: "專注模式工作流：背景音、計時、任務聚焦",
    aliases: ["focus", "專注", "心流", "flow"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 80,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-focus-flow", label: "進入專注流", description: "啟動專注模式", path: "/focus-flow" },
    ],
    orbHints: ["我想專注一下", "啟動心流模式"],
  },
  {
    id: "admin",
    label: "管理後台",
    path: "/admin",
    group: "admin",
    description: "管理員專用：使用者列表、AI 大腦組態、系統健康度檢查",
    aliases: ["admin", "管理後台", "後台", "管理員"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 90,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-admin", label: "開啟管理後台", description: "前往管理員主控台", path: "/admin" },
      {
        id: "open-admin-brain",
        label: "查看 AI 大腦組態",
        description: "前往大腦組態分頁",
        path: "/admin?section=brain",
      },
    ],
    orbHints: ["我要看管理後台", "如何切換大腦", "管理員工具在哪"],
  },
  {
    id: "admin-api-usage",
    label: "API 用量分析",
    path: "/admin/api-usage",
    group: "admin",
    description: "管理員專用：API 呼叫成本、各供應商用量、配額用度報告",
    aliases: ["admin api", "用量", "api usage", "成本"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 91,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-admin-api-usage", label: "開啟 API 用量", description: "前往 API 用量分析頁", path: "/admin/api-usage" },
    ],
    orbHints: ["我想看 API 用量", "查看成本", "各引擎呼叫次數"],
  },
];

const normalizePath = (path: string) => {
  if (!path) return "/";
  const [pathname] = path.split(/[?#]/);
  if (!pathname) return "/";
  if (pathname !== "/" && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

export const getAllPages = () => [...APP_PAGE_REGISTRY];

export const getPageById = (id: string) =>
  APP_PAGE_REGISTRY.find(page => page.id === id);

export const getPageByPath = (path: string) => {
  const normalizedPath = normalizePath(path);
  return APP_PAGE_REGISTRY.find(page => normalizePath(page.path) === normalizedPath);
};

export const getSidebarPages = () =>
  APP_PAGE_REGISTRY.filter(page => page.showInSidebar);

export const getSidebarGroups = () => {
  const groups = new Map<AppPageGroupId, AppPageRegistryItem[]>();
  for (const page of getSidebarPages()) {
    const items = groups.get(page.group);
    if (items) {
      items.push(page);
    } else {
      groups.set(page.group, [page]);
    }
  }
  return Array.from(groups.entries()).map(([groupId, pages]) => ({
    groupId,
    pages,
  }));
};

export const getAgentHomeEntries = () =>
  APP_PAGE_REGISTRY
    .filter(page => page.showInAgentHome)
    .sort((a, b) => a.agentEntryPriority - b.agentEntryPriority);

export const getPrimaryQuickAction = (pageId: string) =>
  getPageById(pageId)?.quickActions[0];

export interface SerializableAppRegistryItem {
  id: string;
  label: string;
  path: string;
  group: AppPageGroupId;
  description: string;
  aliases: string[];
  supportsPageAgent: boolean;
  quickActions: string[];
  orbHints: string[];
}

export const serializeRegistryForSiteKnowledge = (): SerializableAppRegistryItem[] =>
  APP_PAGE_REGISTRY.map(page => ({
    id: page.id,
    label: page.label,
    path: page.path,
    group: page.group,
    description: page.description,
    aliases: [...page.aliases],
    supportsPageAgent: page.supportsPageAgent,
    quickActions: page.quickActions.map(action => action.label),
    orbHints: [...page.orbHints],
  }));
