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
    supportsPageAgent: false,
    quickActions: [{ id: "explore-home", label: "先逛逛", description: "查看平台亮點與入口" }],
    orbHints: ["我想先看看這個網站在做什麼"],
  },
  {
    id: "agent-chat",
    label: "光球聊天",
    path: "/agent",
    group: "orb",
    description: "全站任務代理聊天入口",
    aliases: ["光球", "agent", "聊天", "助手"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 1,
    supportsPageAgent: true,
    quickActions: [
      {
        id: "start-guided-flow",
        label: "幫我開始",
        description: "用一句話開始任務導引",
        prompt: "我不知道從哪開始，請一步步帶我。",
      },
    ],
    orbHints: ["我不知道從哪裡開始", "請你帶我做第一步"],
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
    ],
    orbHints: ["我想做一支短影片"],
  },
  {
    id: "pro-studio",
    label: "專業創作室",
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
    ],
    orbHints: ["幫我先整理腳本"],
  },
  {
    id: "lora-trainer",
    label: "模型訓練中心",
    path: "/lora-trainer",
    group: "train",
    description: "LoRA 訓練流程",
    aliases: ["lora", "訓練", "trainer"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 12,
    supportsPageAgent: true,
    quickActions: [{ id: "start-training", label: "開始訓練", description: "上傳資料啟動 LoRA 訓練" }],
    orbHints: ["我要訓練自己的模型"],
  },
  {
    id: "dashboard",
    label: "儀表板",
    path: "/dashboard",
    group: "project",
    description: "使用統計與進度洞察",
    aliases: ["dashboard", "統計", "報表"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 30,
    supportsPageAgent: true,
    quickActions: [{ id: "view-stats", label: "查看數據", description: "檢視生成與使用概況" }],
    orbHints: ["幫我看看最近使用狀況"],
  },
  {
    id: "history",
    label: "生成歷史",
    path: "/history",
    group: "project",
    description: "所有生成紀錄時間線",
    aliases: ["history", "紀錄", "歷史"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 20,
    supportsPageAgent: true,
    quickActions: [{ id: "open-history", label: "查看歷史", description: "回顧過去作品與任務" }],
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
    showInAgentHome: false,
    agentEntryPriority: 21,
    supportsPageAgent: true,
    quickActions: [{ id: "save-note", label: "記錄想法", description: "把靈感存成筆記" }],
    orbHints: ["幫我把這段記到筆記"],
  },
  {
    id: "settings",
    label: "個人設定",
    path: "/settings",
    group: "settings",
    description: "帳戶與個人偏好設定",
    aliases: ["settings", "設定"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 90,
    supportsPageAgent: true,
    quickActions: [{ id: "open-settings", label: "調整設定", description: "修改個人偏好與帳戶資訊" }],
    orbHints: ["我想調整我的設定"],
  },
  {
    id: "credits",
    label: "積分說明",
    path: "/credits",
    group: "project",
    description: "積分與方案說明",
    aliases: ["credits", "點數", "積分"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 31,
    supportsPageAgent: true,
    quickActions: [{ id: "view-credits", label: "查看積分", description: "確認積分規則與餘額" }],
    orbHints: ["我的點數怎麼算"],
  },
  {
    id: "assets",
    label: "數位資產庫",
    path: "/assets",
    group: "assets",
    description: "管理圖片、影片與音頻資產",
    aliases: ["assets", "素材", "資產"],
    showInSidebar: true,
    showInAgentHome: true,
    agentEntryPriority: 10,
    supportsPageAgent: true,
    quickActions: [{ id: "browse-assets", label: "瀏覽素材", description: "管理與搜尋既有資產" }],
    orbHints: ["打開我的素材庫"],
  },
  {
    id: "prompt-library",
    label: "提示詞庫",
    path: "/prompt-library",
    group: "assets",
    description: "提示詞模板與收藏",
    aliases: ["prompt", "提示詞", "library"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 22,
    supportsPageAgent: true,
    quickActions: [{ id: "open-prompts", label: "找提示詞", description: "挑選可重用的提示詞模板" }],
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
    showInAgentHome: false,
    agentEntryPriority: 23,
    supportsPageAgent: true,
    quickActions: [{ id: "open-models", label: "查看模型", description: "管理訓練後的模型資產" }],
    orbHints: ["我的模型在哪裡"],
  },
  {
    id: "vault",
    label: "一致性保險庫",
    path: "/vault",
    group: "assets",
    description: "角色與場景一致性素材管理",
    aliases: ["vault", "一致性", "保險庫"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 24,
    supportsPageAgent: true,
    quickActions: [{ id: "open-vault", label: "管理一致性", description: "維護角色與風格一致設定" }],
    orbHints: ["保持角色一致"],
  },
  {
    id: "calendar",
    label: "創作排程",
    path: "/calendar",
    group: "project",
    description: "專案時間排程",
    aliases: ["calendar", "排程", "行程"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 25,
    supportsPageAgent: true,
    quickActions: [{ id: "open-calendar", label: "查看排程", description: "檢視與安排創作時程" }],
    orbHints: ["幫我排一下這週創作"],
  },
  {
    id: "shared",
    label: "共享空間",
    path: "/shared",
    group: "project",
    description: "團隊共享與展示",
    aliases: ["shared", "共享", "團隊"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 26,
    supportsPageAgent: true,
    quickActions: [{ id: "open-shared", label: "打開共享", description: "查看團隊共享作品" }],
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
    quickActions: [{ id: "open-learn", label: "學習教學", description: "瀏覽新手與進階教學" }],
    orbHints: ["有新手教學嗎"],
  },
  {
    id: "feedback",
    label: "回饋中心",
    path: "/feedback",
    group: "learn",
    description: "提交與追蹤回饋",
    aliases: ["feedback", "意見", "回饋"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 41,
    supportsPageAgent: true,
    quickActions: [{ id: "send-feedback", label: "提交回饋", description: "回報問題或提出建議" }],
    orbHints: ["我要回報一個問題"],
  },
  {
    id: "background-tasks",
    label: "背景任務中心",
    path: "/background-tasks",
    group: "project",
    description: "查看與管理背景任務",
    aliases: ["tasks", "背景任務", "queue"],
    showInSidebar: true,
    showInAgentHome: false,
    agentEntryPriority: 27,
    supportsPageAgent: true,
    quickActions: [{ id: "open-background-tasks", label: "查看任務", description: "追蹤背景任務進度" }],
    orbHints: ["我有哪些背景任務"],
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
