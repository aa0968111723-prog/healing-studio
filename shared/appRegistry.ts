import type { AgentAction, AgentActionType } from "./agent-actions";

export type AppPageGroupId =
  | "orb"
  | "create"
  | "train"
  | "project"
  | "assets"
  | "learn"
  | "settings"
  | "admin";

/**
 * 側邊欄分組鍵 — 與 AppPageGroupId 解耦。Sidebar 的視覺分組是 UX 決策
 * （哪些頁面被收進同一個 flyout 卡片裡），跟 registry 用於光球路由的 `group`
 * 不一定一致。例如 `notes` 在 registry 屬 `project`，但在側邊欄被歸到「知識
 * 中心」。要新增分組就在 SIDEBAR_GROUPS 加一條，然後把對應頁面標上同樣的
 * sidebarGroup 鍵即可，DashboardLayout 不必再改。
 */
export type SidebarGroupId = "creation-hub" | "six-systems" | "model-playground" | "management";

export interface SidebarGroupDefinition {
  id: SidebarGroupId;
  label: string;
  /** Lucide icon component name — resolved at UI layer via sidebarIcons.ts. */
  icon: string;
  /** Top-level sort key against standalone leaves; lower comes first. */
  order: number;
  /** Short tagline shown beneath the group label inside the tooltip. */
  description?: string;
  /**
   * Optional fallback path used when the flyout overflows the visible cap
   * (see AppleDock's MAX_FLYOUT_ITEMS) — clicking "查看全部" navigates here so
   * the user can still reach every child even if the dock doesn't list it.
   */
  seeAllPath?: string;
}

export const SIDEBAR_GROUPS: readonly SidebarGroupDefinition[] = [
  {
    id: "creation-hub",
    label: "創作中樞",
    icon: "Home",
    order: 10,
    description: "開始創作、選擇專案、查看目前創作進度。",
    seeAllPath: "/create",
  },
  {
    id: "six-systems",
    label: "六大系統",
    icon: "Palette",
    order: 20,
    description: "用目標導向完成完整創作流程。",
    seeAllPath: "/agent",
  },
  {
    id: "model-playground",
    label: "模型樂園",
    icon: "Sparkles",
    order: 30,
    description: "給專業使用者直接選模型、填 prompt、生成、測試或訓練模型。",
    seeAllPath: "/playground",
  },
  {
    id: "management",
    label: "管理",
    icon: "Settings",
    order: 40,
    description: "管理平台設定、權限、API 與團隊。",
    seeAllPath: "/settings",
  },
] as const;

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
  routeAliases?: string[];
  group: AppPageGroupId;
  description: string;
  aliases: string[];
  showInSidebar: boolean;
  /**
   * Sort key for the dock/sidebar. Pages without a defined `sidebarOrder` are
   * excluded from the visual sidebar even if `showInSidebar` is true — that
   * keeps CommandPalette's grouping (which keys off showInSidebar) intact
   * while letting the dock opt pages in explicitly. Lower comes first.
   */
  sidebarOrder?: number;
  /**
   * Optional sidebar grouping bucket. Omit to render as a standalone leaf at
   * the top level of the dock. See SIDEBAR_GROUPS for available group IDs.
   */
  sidebarGroup?: SidebarGroupId;
  /** Lucide icon name shown in the dock (resolved at UI layer). */
  sidebarIcon?: string;
  showInAgentHome: boolean;
  agentEntryPriority: number;
  supportsPageAgent: boolean;
  quickActions: AppPageQuickAction[];
  orbHints: string[];
  /**
   * Action types whose `case` block actually exists in this page's
   * `useRegisterPageAgent` handler. The orb's static-fallback router uses
   * this to avoid sending an action to a page that can't really handle it
   * (the most common past failure: setModality routed to /image-studio,
   * which has no setModality case → silent dispatch failure / "no route
   * found"). Empty = page is informational-only and only handles the
   * universal navigate/focusElement actions provided by PageAgentContext.
   */
  supportedActions: AgentActionType[];
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
    supportedActions: ["navigate"],
  },
  {
    id: "light-orb-studio",
    label: "光球工作室",
    path: "/light-orb-studio",
    group: "orb",
    description: "光球互動工作室",
    aliases: ["light orb", "light-orb-studio", "光球工作室"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 99,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-light-orb-studio", label: "開啟光球工作室", description: "進入光球工作室", path: "/light-orb-studio" },
    ],
    orbHints: ["打開光球工作室"],
    supportedActions: ["navigate"],
  },
  {
    id: "agent-chat",
    label: "全站光球代理",
    path: "/agent",
    group: "orb",
    description: "全站代理領導者：先釐清目標，再定位到正確系統並規劃流程",
    aliases: ["光球", "全站光球代理", "agent", "聊天", "助手"],
    showInSidebar: true,
    sidebarOrder: 10,
    sidebarGroup: "six-systems",
    sidebarIcon: "Bot",
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
    supportedActions: ["navigate", "search"],
  },
  {
    id: "create",
    label: "創作中樞",
    path: "/create",
    group: "create",
    description: "創作中樞入口：以目標導向啟動完整創作流程（六大系統）",
    aliases: ["創作中心", "creation hub", "creation-hub", "create"],
    showInSidebar: true,
    sidebarOrder: 10,
    sidebarGroup: "creation-hub",
    sidebarIcon: "Home",
    showInAgentHome: true,
    agentEntryPriority: 2,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "open-creation-hub",
        label: "進入創作中樞",
        description: "打開整合的創作工作台",
        path: "/create",
      },
      {
        id: "switch-to-studio",
        label: "切到創作工作室",
        description: "在 Hub 內切到創作工作室分頁",
        action: { type: "setTab", tabId: "studio" },
      },
      {
        id: "switch-to-director",
        label: "切到導演 AI",
        description: "在 Hub 內切到導演 AI 分頁",
        action: { type: "setTab", tabId: "director" },
      },
    ],
    orbHints: ["帶我去創作中心", "我想開始創作", "在 Hub 切到資產庫"],
    supportedActions: ["navigate"],
  },
  {
    id: "playground",
    label: "單模型工具",
    path: "/playground",
    group: "create",
    description:
      "集中使用與管理單一模型工具。適合專業使用者直接選模型、填 prompt、生成或測試。",
    aliases: ["模型樂園", "playground", "進階工具", "professional", "單模型工具"],
    showInSidebar: true,
    sidebarOrder: 80,
    sidebarGroup: "model-playground",
    sidebarIcon: "LayoutGrid",
    showInAgentHome: true,
    agentEntryPriority: 3,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "open-playground",
        label: "進入模型樂園",
        description: "瀏覽全部進階模型工具",
        path: "/playground",
      },
      {
        id: "switch-to-image",
        label: "切到圖片創作室",
        description: "在 Hub 內切到圖片工具分頁",
        action: { type: "setTab", tabId: "image-studio" },
      },
      {
        id: "switch-to-video",
        label: "切到影片創作室",
        description: "在 Hub 內切到影片工具分頁",
        action: { type: "setTab", tabId: "video-studio" },
      },
    ],
    orbHints: ["帶我去模型樂園", "我想看進階工具", "在樂園切到 LoRA 訓練"],
    supportedActions: ["navigate"],
  },
  {
    id: "studio",
    label: "創作工作室",
    path: "/studio",
    group: "create",
    description: "六大系統入口：以目標導向協作完成完整創作流程",
    aliases: ["工作室", "創作", "studio"],
    showInSidebar: true,
    sidebarOrder: 10,
    sidebarGroup: "model-playground",
    sidebarIcon: "Wand2",
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
    supportedActions: [
      "setModality",
      "setMode",
      "setModel",
      "applyPreset",
      "fillPrompt",
      "setParam",
      "submit",
      "reset",
      "openDialog",
      "focusElement",
    ],
  },
  {
    id: "image-studio",
    label: "圖片創作室",
    path: "/image-studio",
    group: "create",
    description: "圖片生成與編輯",
    aliases: ["image", "圖片", "圖像"],
    showInSidebar: true,
    sidebarOrder: 20,
    sidebarGroup: "model-playground",
    sidebarIcon: "Image",
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
    supportedActions: [
      "setTab",
      "setModel",
      "fillPrompt",
      "applyPreset",
      "submit",
      "reset",
      "openDialog",
      "setParam",
      "focusElement",
    ],
  },
  {
    id: "video-studio",
    label: "影片創作室",
    path: "/video-studio",
    group: "create",
    description: "影片生成與轉換",
    aliases: ["video", "影片", "動畫"],
    showInSidebar: true,
    sidebarOrder: 30,
    sidebarGroup: "model-playground",
    sidebarIcon: "Film",
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
    supportedActions: [
      "setTab",
      "setModel",
      "fillPrompt",
      "submit",
      "reset",
      "setParam",
      "focusElement",
    ],
  },
  {
    id: "pro-studio",
    label: "音樂配音創作室",
    path: "/pro-studio",
    group: "create",
    description: "音樂、語音、音效專業工作台",
    aliases: ["music", "voice", "audio", "音樂", "配音"],
    showInSidebar: true,
    sidebarOrder: 40,
    sidebarGroup: "model-playground",
    sidebarIcon: "Music",
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
    supportedActions: [
      "setTab",
      "setModel",
      "fillPrompt",
      "applyPreset",
      "submit",
      "reset",
      "setParam",
      "focusElement",
    ],
  },
  {
    id: "director",
    label: "設計企劃",
    path: "/director",
    group: "create",
    description: "腳本、分鏡與導演企劃工作台",
    aliases: ["script", "director", "腳本", "導演 AI", "設計企劃"],
    showInSidebar: true,
    sidebarOrder: 20,
    sidebarGroup: "six-systems",
    sidebarIcon: "Clapperboard",
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
      {
        id: "open-animation-studio",
        label: "切到世界觀系統",
        description: "把腳本接到世界觀 + 分鏡時間軸，準備產出動畫",
        path: "/animation",
        prompt: "幫我把目前的腳本接到世界觀系統，建立角色、場景與分鏡。",
      },
    ],
    orbHints: ["幫我先整理腳本", "把腳本拉到世界觀系統"],
    supportedActions: [
      "setTab",
      "fillPrompt",
      "applyPreset",
      "submit",
      "reset",
      "setParam",
      "focusElement",
    ],
  },
  {
    id: "animation-studio",
    label: "影片世界觀",
    path: "/animation",
    group: "create",
    description: "世界觀 → 分鏡 → 圖楨 → 配樂配音 → 轉影成片的完整動畫管線",
    aliases: [
      "animation",
      "動畫",
      "分鏡",
      "storyboard",
      "worldbuilding",
      "世界觀",
      "世界觀系統",
      "影片世界觀",
    ],
    showInSidebar: true,
    sidebarOrder: 30,
    sidebarGroup: "six-systems",
    sidebarIcon: "Film",
    showInAgentHome: true,
    agentEntryPriority: 5,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "new-world",
        label: "新增世界觀",
        description: "建立角色（三視圖/表情/穿衣/口氣/語音）與場景",
        path: "/animation",
        prompt:
          "幫我建立一個新的世界觀，問我類型、時代、主角的個性與外貌，然後逐步建立角色三視圖、表情包、穿衣集、口氣與配音設定。",
      },
      {
        id: "seed-storyboard",
        label: "自動生成分鏡骨架",
        description: "依世界觀與目標時長派生「幾分幾秒」時間軸",
        path: "/animation",
        prompt:
          "幫我把目前選定的世界觀，生成 60 秒 / 6 場的動畫分鏡骨架，每場安排主角出場，配樂用世界觀預設主題。",
      },
      {
        id: "plan-animation-pipeline",
        label: "規劃動畫渲染管線",
        description: "把分鏡轉成 t2i → refine → i2v → music → voice → 合成步驟",
        path: "/animation",
        prompt:
          "幫我把當前分鏡的所有圖楨與音軌排成動畫管線，估算成本與時長，並提示哪些步驟需要先做風格鎖。",
      },
      {
        id: "review-shot-list",
        label: "輸出鏡頭表 CSV",
        description: "把分鏡匯出成導演 / 動畫師可外部協作的鏡頭表",
      },
    ],
    orbHints: [
      "開新世界觀",
      "幫我做角色三視圖",
      "規劃 60 秒動畫分鏡",
      "把分鏡渲染成影片",
    ],
    supportedActions: [
      "setTab",
      "fillPrompt",
      "applyPreset",
      "submit",
      "reset",
      "setParam",
      "focusElement",
    ],
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
    supportedActions: [
      "setTab",
      "fillPrompt",
      "applyPreset",
      "submit",
      "reset",
      "setParam",
      "focusElement",
    ],
  },
  {
    id: "dashboard",
    label: "儀表板",
    path: "/dashboard",
    group: "project",
    description: "使用統計與進度洞察",
    aliases: ["dashboard", "統計", "報表"],
    showInSidebar: true,
    sidebarOrder: 30,
    sidebarGroup: "creation-hub",
    sidebarIcon: "BarChart3",
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
    supportedActions: ["navigate"],
  },
  {
    id: "history",
    label: "生成歷史",
    path: "/assets?section=history",
    routeAliases: ["/history"],
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
    supportedActions: ["setTab", "search", "reset"],
  },
  {
    id: "notes",
    label: "專案筆記",
    path: "/notes",
    group: "project",
    description: "筆記與專案整理",
    aliases: ["notes", "筆記"],
    showInSidebar: true,
    sidebarOrder: 40,
    sidebarGroup: "creation-hub",
    sidebarIcon: "StickyNote",
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
    supportedActions: ["setTab", "search", "reset"],
  },
  {
    id: "langsmith",
    label: "AI 監控中心",
    path: "/dashboard?section=langsmith",
    routeAliases: ["/langsmith"],
    group: "settings",
    description: "LangSmith 追蹤分析與模型監控儀表板（dashboard 分頁）",
    aliases: ["langsmith", "監控", "追蹤", "模型監控", "ai 監控中心"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 30,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "open-langsmith",
        label: "打開監控",
        description: "查看最近 LLM 追蹤、錯誤率與延遲趨勢",
        path: "/dashboard?section=langsmith",
      },
      {
        id: "langsmith-traces",
        label: "切到追蹤",
        description: "瀏覽單筆 LLM 呼叫的完整 trace",
        action: { type: "setTab", tabId: "traces" },
      },
      {
        id: "langsmith-comparison",
        label: "切到模型對比",
        description: "比較不同模型在同一輸入下的表現",
        action: { type: "setTab", tabId: "comparison" },
      },
    ],
    orbHints: ["帶我看 LangSmith 監控", "我想查最近模型呼叫的錯誤和延遲"],
    supportedActions: ["setTab"],
  },
  {
    id: "agent-preferences",
    label: "光球代理設定",
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
    showInSidebar: true,
    sidebarOrder: 20,
    sidebarGroup: "management",
    sidebarIcon: "Bot",
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
    supportedActions: [],
  },
  {
    id: "settings",
    label: "全站設定",
    path: "/settings",
    group: "settings",
    description: "帳戶與全站偏好設定",
    aliases: ["settings", "設定", "個人設定", "全站設定"],
    showInSidebar: true,
    sidebarOrder: 10,
    // fix: 從 six-systems 移到 management — 設定頁屬管理類，不屬六大創作系統
    sidebarGroup: "management",
    sidebarIcon: "Settings",
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
    supportedActions: ["navigate", "setTab", "setParam", "reset"],
  },
  {
    id: "credits",
    label: "積分說明",
    path: "/dashboard?section=credits",
    routeAliases: ["/credits"],
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
    supportedActions: ["navigate"],
  },
  {
    id: "assets",
    label: "數位資產庫",
    path: "/assets",
    group: "assets",
    description: "管理圖片、影片與音頻資產；含生成歷史、提示詞庫、一致性保險庫、共享空間、背景任務中心",
    aliases: ["assets", "素材", "資產", "提示詞", "保險庫", "共享", "背景任務", "資料庫", "我的檔案", "媒體庫"],
    showInSidebar: true,
    sidebarOrder: 20,
    sidebarGroup: "creation-hub",
    sidebarIcon: "Library",
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
    supportedActions: ["setTab", "search", "setParam", "reset", "openDialog"],
  },
  {
    id: "prompt-library",
    label: "提示詞庫",
    path: "/assets?section=prompts",
    routeAliases: ["/prompt-library"],
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
    supportedActions: ["setTab", "search", "setParam", "reset"],
  },
  {
    id: "prompt-collection",
    label: "個人提示詞收集",
    path: "/assets?section=collection",
    routeAliases: ["/prompt-collection"],
    group: "assets",
    description:
      "收集全站包含精靈代理、主動觸發、模型樣板與 ImageStudio 模板的提示詞，可分享給團隊",
    aliases: [
      "提示詞收集",
      "收集",
      "collection",
      "個人收集",
      "團隊提示詞",
      "agent prompt",
      "精靈提示詞",
    ],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 23,
    supportsPageAgent: false,
    quickActions: [
      {
        id: "open-prompt-collection",
        label: "打開提示詞收集",
        description: "管理我的提示詞收集 / 團隊共享 / 全站可收集 prompt",
        path: "/assets?section=collection",
      },
      {
        id: "collect-from-site",
        label: "收集全站提示詞",
        description: "把 25 位精靈、主動觸發、模型樣板、ImageStudio 內建模板加入個人收集",
        path: "/assets?section=collection",
      },
    ],
    orbHints: [
      "把精靈的系統提示存起來",
      "我想收藏這條提示詞並分享給團隊",
    ],
    supportedActions: [],
  },
  {
    id: "models",
    label: "模型訓練中心",
    path: "/models",
    group: "assets",
    description: "模型管理與版本檢視",
    aliases: ["models", "模型", "角色"],
    showInSidebar: true,
    sidebarOrder: 50,
    sidebarGroup: "model-playground",
    sidebarIcon: "Cpu",
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
    supportedActions: ["navigate", "setTab", "openDialog", "setParam", "reset"],
  },
  {
    id: "vault",
    label: "一致性保險庫",
    path: "/assets?section=vault",
    routeAliases: ["/vault"],
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
    supportedActions: ["navigate"],
  },
  {
    id: "calendar",
    label: "創作排程",
    path: "/notes",
    group: "project",
    description: "專案時間排程",
    aliases: ["calendar", "排程", "行程"],
    showInSidebar: true,
    sidebarOrder: 50,
    sidebarGroup: "creation-hub",
    sidebarIcon: "CalendarDays",
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
    supportedActions: ["navigate", "setParam", "reset"],
  },
  {
    id: "shared",
    label: "共享空間",
    path: "/shared",
    group: "assets",
    description: "團隊共享與展示",
    aliases: ["shared", "共享", "團隊"],
    showInSidebar: false,
    showInAgentHome: true,
    agentEntryPriority: 26,
    supportsPageAgent: true,
    quickActions: [
      { id: "open-shared", label: "打開共享", description: "查看團隊共享作品", path: "/shared" },
      {
        id: "shared-model-deep-dive",
        label: "模型細膩導覽",
        description: "拆解團隊共享素材/模型如何復用與評分",
        path: "/shared",
        prompt:
          "請深度拆解共享空間的素材與模型復用流程，包含命名規範、評分維度、回饋迭代與團隊協作建議。",
      },
    ],
    orbHints: ["看看團隊共享作品"],
    supportedActions: ["navigate", "setTab", "search", "setParam", "reset"],
  },
  {
    id: "learn",
    label: "學習中心",
    path: "/learn",
    group: "learn",
    description: "教學文件、新手指南與進階路徑",
    aliases: ["learn", "教學", "文件", "學習文件中心", "學習中心"],
    showInSidebar: true,
    sidebarOrder: 60,
    sidebarGroup: "six-systems",
    sidebarIcon: "BookOpen",
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
    supportedActions: ["setTab", "search", "setParam", "reset"],
  },
  {
    id: "ai-models-hub",
    label: "AI 模型情報",
    path: "/ai-models-hub",
    group: "learn",
    description:
      "情報站深入專區：策展的當代主流 AI 模型目錄，含廠商、模態、層級篩選與動態新聞流",
    aliases: [
      "ai-models-hub",
      "ai 模型",
      "ai模型",
      "模型情報",
      "模型動態",
      "情報專區",
      "model hub",
      "models hub",
    ],
    showInSidebar: true,
    sidebarOrder: 60,
    sidebarGroup: "model-playground",
    sidebarIcon: "Sparkles",
    showInAgentHome: true,
    agentEntryPriority: 42,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "open-ai-models-hub",
        label: "瀏覽 AI 模型情報",
        description: "查看當代主流 AI 模型策展目錄與最新動態",
        path: "/ai-models-hub",
      },
      {
        id: "ai-models-hub-deep-dive",
        label: "幫我挑模型",
        description: "依用途與預算推薦最適合的模型組合",
        path: "/ai-models-hub",
        prompt:
          "請根據我的用途與預算，從 AI 模型情報專區中挑出 3 個最適合我的模型，並比較它們的強弱項與成本。",
      },
    ],
    orbHints: ["現在有哪些 AI 模型", "推薦模型", "Claude / GPT / Gemini 差別"],
    supportedActions: ["setTab", "search", "setParam", "reset"],
  },
  {
    id: "feedback",
    label: "回饋",
    path: "/feedback",
    group: "learn",
    description: "提交與追蹤回饋",
    aliases: ["feedback", "意見", "回饋", "回饋中心"],
    showInSidebar: true,
    sidebarOrder: 40,
    sidebarGroup: "management",
    sidebarIcon: "MessageSquare",
    showInAgentHome: false,
    agentEntryPriority: 41,
    supportsPageAgent: true,
    quickActions: [{ id: "send-feedback", label: "提交回饋", description: "回報問題或提出建議" }],
    orbHints: ["我要回報一個問題"],
    supportedActions: ["fillPrompt", "setParam", "submit"],
  },
  {
    id: "model-wishlist",
    label: "模型許願池",
    path: "/model-wishlist",
    group: "learn",
    description: "許願平台支援的新 AI 模型,社群投票決定下一批要接哪些",
    aliases: [
      "model-wishlist",
      "wishlist",
      "許願",
      "許願池",
      "模型許願",
      "想要的模型",
      "model wish",
    ],
    showInSidebar: true,
    sidebarOrder: 70,
    sidebarGroup: "model-playground",
    sidebarIcon: "Gift",
    showInAgentHome: false,
    agentEntryPriority: 43,
    supportsPageAgent: false,
    quickActions: [
      {
        id: "open-model-wishlist",
        label: "看看大家想要哪些模型",
        description: "瀏覽模型許願池並投票表態",
        path: "/model-wishlist",
      },
      {
        id: "submit-model-wish",
        label: "我要許願",
        description: "提交一個新的模型許願",
        path: "/model-wishlist",
      },
    ],
    orbHints: [
      "我希望平台支援某個模型",
      "幫我許願一個新模型",
      "看看有哪些模型大家在許願",
    ],
    supportedActions: [],
  },
  {
    id: "agent-codex",
    label: "AI 代理代碼大全",
    path: "/codex",
    group: "learn",
    description: "光球 AI 代理全功能總覽：25 精靈 / 36 頁面 / 全指令 / 接棒網絡 / 主動觸發，可搜尋",
    aliases: ["codex", "大全", "代碼大全", "compendium", "manual", "全功能"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 42,
    supportsPageAgent: false,
    quickActions: [
      {
        id: "open-codex",
        label: "打開大全",
        description: "瀏覽全部 AI 代理能力",
        path: "/codex",
      },
      {
        id: "search-codex",
        label: "搜尋功能",
        description: "用關鍵字找站內任何 AI 能力",
        prompt: "/codex ",
      },
    ],
    orbHints: [
      "光球有什麼功能？",
      "列出所有精靈",
      "這個站到底能做什麼",
    ],
    supportedActions: [],
  },
  {
    id: "teaching-archive",
    label: "創作資料庫",
    path: "/teaching-archive",
    group: "learn",
    description: "上傳並管理 PDF、文件、圖片、影片、語音、簡報等素材，依分類與主題保存，為日後 RAG 檢索建立內容池",
    aliases: [
      "teaching-archive",
      "database",
      "資料庫",
      "素材庫",
      "內容池",
      "上傳",
      "檔案",
      "創作資料庫",
    ],
    showInSidebar: true,
    sidebarOrder: 40,
    sidebarGroup: "six-systems",
    sidebarIcon: "Database",
    showInAgentHome: true,
    agentEntryPriority: 18,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "open-teaching-archive",
        label: "前往資料庫",
        description: "瀏覽與上傳 PDF、文件、圖片、影片、語音、簡報",
        path: "/teaching-archive",
      },
    ],
    orbHints: [
      "上傳資料",
      "新增素材",
      "建立資料庫",
      "幫我從資料庫找 XX",
      "資料庫裡有沒有提到 XX 的內容",
    ],
    supportedActions: ["search", "setTab", "openDialog", "reset"],
  },
  {
    id: "teams",
    label: "團隊管理",
    path: "/teams",
    group: "learn",
    description: "建立 / 加入團隊，與成員共享資料庫的 team_shared 素材",
    aliases: ["teams", "團隊", "成員", "membership", "團隊管理"],
    showInSidebar: true,
    sidebarOrder: 30,
    sidebarGroup: "management",
    sidebarIcon: "Users",
    showInAgentHome: true,
    agentEntryPriority: 19,
    supportsPageAgent: false,
    quickActions: [
      {
        id: "open-teams",
        label: "管理團隊",
        description: "建立團隊、邀請成員、設定角色",
        path: "/teams",
      },
    ],
    orbHints: ["建立團隊", "邀請成員", "管理我的團隊"],
    supportedActions: [],
  },
  {
    id: "admin",
    label: "管理後台",
    path: "/admin",
    group: "settings",
    description: "平台管理後台",
    aliases: ["admin", "管理後台"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 50,
    supportsPageAgent: true,
    quickActions: [{ id: "open-admin", label: "開啟管理", description: "進入管理後台", path: "/admin" }],
    orbHints: ["打開管理後台"],
    supportedActions: ["navigate", "setTab"],
  },
  {
    id: "admin-api-usage",
    label: "API 用量分析",
    path: "/admin/api-usage",
    group: "settings",
    description: "管理員 API 用量分析",
    aliases: ["admin api", "api 用量"],
    showInSidebar: false,
    showInAgentHome: false,
    agentEntryPriority: 49,
    supportsPageAgent: true,
    quickActions: [{ id: "open-admin-api-usage", label: "打開 API 用量", description: "查看 API 用量分析", path: "/admin/api-usage" }],
    orbHints: ["查看 API 用量"],
    supportedActions: ["navigate", "setTab"],
  },
  { id: "admin-brain-pipeline", label: "大腦推理鏈", path: "/admin/brain-pipeline", group: "settings", description: "管理員推理鏈視覺化", aliases: ["brain pipeline"], showInSidebar: false, showInAgentHome: false, agentEntryPriority: 48, supportsPageAgent: true, quickActions: [{ id: "open-admin-brain-pipeline", label: "打開推理鏈", description: "查看大腦推理鏈", path: "/admin/brain-pipeline" }], orbHints: ["看推理鏈"], supportedActions: ["navigate"] },
  { id: "creative-projects", label: "創作專案", path: "/creative-projects", group: "project", description: "創作專案管理", aliases: ["projects"], showInSidebar: false, showInAgentHome: true, agentEntryPriority: 35, supportsPageAgent: false, quickActions: [{ id: "open-creative-projects", label: "打開創作專案", description: "查看創作專案列表", path: "/creative-projects" }], orbHints: ["打開創作專案"], supportedActions: [] },
  { id: "focus-flow", label: "專注流", path: "/focus-flow", group: "project", description: "專注節奏與番茄鐘", aliases: ["focus"], showInSidebar: false, showInAgentHome: true, agentEntryPriority: 33, supportsPageAgent: true, quickActions: [{ id: "open-focus-flow", label: "打開專注流", description: "進入專注流", path: "/focus-flow" }], orbHints: ["我要專注"], supportedActions: ["navigate", "setTab", "setParam"] },
  { id: "my-brain", label: "我的大腦", path: "/my-brain", group: "settings", description: "個人腦組態狀態", aliases: ["brain"], showInSidebar: false, showInAgentHome: false, agentEntryPriority: 32, supportsPageAgent: true, quickActions: [{ id: "open-my-brain", label: "打開我的大腦", description: "查看個人腦組態", path: "/my-brain" }], orbHints: ["我的大腦"], supportedActions: ["navigate"] },
  { id: "process-viewer", label: "流程檢視器", path: "/process", group: "learn", description: "流程說明檢視", aliases: ["process"], showInSidebar: false, showInAgentHome: false, agentEntryPriority: 31, supportsPageAgent: true, quickActions: [{ id: "open-process", label: "打開流程", description: "查看流程檢視器", path: "/process" }], orbHints: ["查看流程"], supportedActions: ["navigate", "setParam", "submit", "reset"] },
  { id: "projects", label: "專案列表", path: "/projects", group: "project", description: "專案列表頁", aliases: ["project list"], showInSidebar: false, showInAgentHome: false, agentEntryPriority: 30, supportsPageAgent: false, quickActions: [{ id: "open-projects", label: "打開專案", description: "查看專案列表", path: "/projects" }], orbHints: ["查看專案"], supportedActions: [] },
  { id: "project-detail", label: "專案詳情", path: "/projects/:id", group: "project", description: "專案詳情頁", aliases: ["project detail"], showInSidebar: false, showInAgentHome: false, agentEntryPriority: 29, supportsPageAgent: false, quickActions: [{ id: "open-project-detail", label: "打開專案詳情", description: "前往某個專案詳情", path: "/projects/:id" }], orbHints: ["專案詳情"], supportedActions: [] },
  { id: "account-settings", label: "帳號設定", path: "/account-settings", group: "settings", description: "帳號與安全設定", aliases: ["account settings"], showInSidebar: false, showInAgentHome: false, agentEntryPriority: 27, supportsPageAgent: true, quickActions: [{ id: "open-account-settings", label: "打開帳號設定", description: "管理帳號與安全", path: "/account-settings" }], orbHints: ["帳號設定"], supportedActions: ["navigate", "setTab"] },
  { id: "brain-settings", label: "AI 大腦設定", path: "/settings/ai-brain", group: "settings", description: "個人 AI 大腦偏好設定", aliases: ["ai brain settings"], showInSidebar: false, showInAgentHome: false, agentEntryPriority: 26, supportsPageAgent: true, quickActions: [{ id: "open-brain-settings", label: "打開 AI 大腦設定", description: "調整 AI 大腦偏好", path: "/settings/ai-brain" }], orbHints: ["AI 大腦設定"], supportedActions: ["navigate", "setTab", "setParam", "reset"] },
  { id: "tutorial-overview", label: "教學總覽", path: "/tutorial-overview", group: "learn", description: "站內教學總覽", aliases: ["tutorial"], showInSidebar: false, showInAgentHome: true, agentEntryPriority: 28, supportsPageAgent: true, quickActions: [{ id: "open-tutorial-overview", label: "打開教學總覽", description: "查看教學導覽", path: "/tutorial-overview" }], orbHints: ["新手教學"], supportedActions: ["navigate"] },
  {
    id: "background-tasks",
    label: "背景任務中心",
    path: "/assets?section=tasks",
    routeAliases: ["/background-tasks"],
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
    supportedActions: ["setTab", "search", "reset"],
  },
];

export interface SidebarGroupBucket {
  groupId: AppPageGroupId;
  pages: AppPageRegistryItem[];
}

export interface SidebarTreeLeaf {
  kind: "page";
  id: string;
  pageId: string;
  label: string;
  path: string;
  icon?: string;
  order: number;
}

export interface SidebarTreeBranch {
  kind: "group";
  id: SidebarGroupId;
  label: string;
  icon: string;
  order: number;
  description?: string;
  seeAllPath?: string;
  children: SidebarTreeLeaf[];
}

export type SidebarTreeNode = SidebarTreeLeaf | SidebarTreeBranch;

const normalizePath = (path: string): string => {
  if (!path) return "/";
  const [rawPathname, rawQuery = ""] = path.trim().split("?");
  let pathname = rawPathname || "/";
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const query = rawQuery.trim();
  return query ? `${pathname}?${query}` : pathname;
};

const getNormalizedPathname = (path: string): string => normalizePath(path).split("?")[0] ?? "/";

export const getAllPages = (): AppPageRegistryItem[] => [...APP_PAGE_REGISTRY];

export const getPageById = (id: string): AppPageRegistryItem | undefined =>
  APP_PAGE_REGISTRY.find(page => page.id === id);

export const getPageByPath = (path: string): AppPageRegistryItem | undefined => {
  const target = normalizePath(path);
  const exact = APP_PAGE_REGISTRY.find(page => normalizePath(page.path) === target);
  if (exact) return exact;

  const aliasExact = APP_PAGE_REGISTRY.find(page =>
    (page.routeAliases ?? []).some(alias => normalizePath(alias) === target),
  );
  if (aliasExact) return aliasExact;

  const targetPathname = getNormalizedPathname(target);
  const canonicalPathMatch = APP_PAGE_REGISTRY.find(
    page => getNormalizedPathname(page.path) === targetPathname && !normalizePath(page.path).includes("?"),
  );
  if (canonicalPathMatch) return canonicalPathMatch;

  return APP_PAGE_REGISTRY.find(page => {
    if (getNormalizedPathname(page.path) === targetPathname) return true;
    return (page.routeAliases ?? []).some(alias => getNormalizedPathname(alias) === targetPathname);
  });
};

export const getSidebarPages = (): AppPageRegistryItem[] =>
  APP_PAGE_REGISTRY.filter(page => page.showInSidebar)
    .slice()
    .sort((a, b) => (a.sidebarOrder ?? Number.MAX_SAFE_INTEGER) - (b.sidebarOrder ?? Number.MAX_SAFE_INTEGER));

export const getDockPages = (): AppPageRegistryItem[] =>
  getSidebarPages().filter(page => typeof page.sidebarOrder === "number" && !!page.sidebarGroup);

export const getSidebarGroups = (): SidebarGroupBucket[] => {
  const buckets = new Map<AppPageGroupId, AppPageRegistryItem[]>();
  for (const page of getSidebarPages()) {
    const arr = buckets.get(page.group) ?? [];
    arr.push(page);
    buckets.set(page.group, arr);
  }
  return [...buckets.entries()].map(([groupId, pages]) => ({ groupId, pages }));
};

export const getSidebarTree = (): SidebarTreeNode[] => {
  const dockPages = getDockPages();
  return SIDEBAR_GROUPS.map(group => ({
    kind: "group" as const,
    id: group.id,
    label: group.label,
    icon: group.icon,
    order: group.order,
    description: group.description,
    seeAllPath: group.seeAllPath,
    children: dockPages
      .filter(page => page.sidebarGroup === group.id)
      .map(page => ({
        kind: "page" as const,
        id: page.id,
        pageId: page.id,
        label: page.label,
        path: page.path,
        icon: page.sidebarIcon,
        order: page.sidebarOrder ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.order - b.order),
  })).sort((a, b) => a.order - b.order);
};

export const getAgentHomeEntries = (): AppPageRegistryItem[] =>
  APP_PAGE_REGISTRY.filter(page => page.showInAgentHome)
    .slice()
    .sort((a, b) => a.agentEntryPriority - b.agentEntryPriority);

export const getPrimaryQuickAction = (pageId: string): AppPageQuickAction | undefined =>
  getPageById(pageId)?.quickActions[0];

export interface SerializableAppRegistryItem {
  id: string;
  label: string;
  path: string;
  routeAliases?: string[];
  group: AppPageGroupId;
  description: string;
  aliases: string[];
  sidebarGroup?: SidebarGroupId;
  sidebarOrder?: number;
  sidebarIcon?: string;
  supportsPageAgent: boolean;
  supportedActions: AgentActionType[];
  quickActions: AppPageQuickAction[];
  orbHints: string[];
}

export const serializeRegistryForSiteKnowledge = (): SerializableAppRegistryItem[] =>
  APP_PAGE_REGISTRY.map(page => ({
    id: page.id,
    label: page.label,
    path: page.path,
    routeAliases: page.routeAliases,
    group: page.group,
    description: page.description,
    aliases: page.aliases,
    sidebarGroup: page.sidebarGroup,
    sidebarOrder: page.sidebarOrder,
    sidebarIcon: page.sidebarIcon,
    supportsPageAgent: page.supportsPageAgent,
    supportedActions: page.supportedActions,
    quickActions: page.quickActions,
    orbHints: page.orbHints,
  }));
