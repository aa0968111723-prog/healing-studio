/**
 * SiteOnboardingContext.tsx
 *
 * 全站新手引導系統 — 統一管理所有頁面的導覽狀態
 *
 * 設計原則：
 *  1. 每個頁面有自己的 Tour（步驟清單 + 儲存鍵）
 *  2. 首次進入任何頁面自動觸發對應 Tour
 *  3. 全站整體 Welcome Tour 在使用者第一次登入時播放（跨頁面）
 *  4. 光球 (ProactiveOrb) 可以主動觸發 Tour、跳至某步驟
 *  5. 任何頁面可呼叫 startTour(pageId) 手動重啟
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TourStep {
  /** DOM element id to spotlight. If null → centre-screen modal style */
  targetId: string | null;
  title: string;
  description: string;
  /** Small warm micro-copy shown below description */
  tip?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  /** Icon emoji or string shown on the card */
  icon?: string;
}

export type PageId =
  | "welcome"          // 全站 Welcome（首次登入）
  | "studio"
  | "pro-studio"
  | "image-studio"
  | "video-studio"
  | "director"
  | "models"
  | "lora-trainer"
  | "history"
  | "assets"
  | "vault"
  | "notes"
  | "calendar"
  | "shared"
  | "dashboard"
  | "feedback"
  | "settings"
  | "learn";

interface TourDefinition {
  pageId: PageId;
  storageKey: string;
  steps: TourStep[];
}

// ─── All Tour Definitions ────────────────────────────────────────────────────

const TOUR_DEFINITIONS: Record<PageId, TourDefinition> = {

  welcome: {
    pageId: "welcome",
    storageKey: "site-tour-welcome-v2",
    steps: [
      {
        targetId: null,
        title: "歡迎來到 Healing Studio ✨",
        description:
          "這是一個整合 AI 的全方位創作平台。你可以生成圖片、影片、音樂和語音，管理創作資產，並讓 AI 導演幫你規劃創作流程。",
        tip: "左邊側欄可以切換各個功能區，讓我帶你認識一下！",
        icon: "🌟",
        position: "center",
      },
      {
        targetId: "sidebar-nav",
        title: "功能導覽列",
        description:
          "這裡是所有功能的入口。從創作工作室到學習文件，每個功能都在這裡。可以用滑鼠拖拉邊緣來調整寬度。",
        tip: "收合側欄可以獲得更大的創作空間。",
        icon: "🗂️",
        position: "right",
      },
      {
        targetId: "sidebar-studio-link",
        title: "創作工作室",
        description:
          "核心功能！用 AI 生成圖片、影片、音樂和語音。有 AI 導演協助規劃、靈感積木輔助提詞，還有光球陪你創作。",
        tip: "從這裡開始你的第一件 AI 創作吧！",
        icon: "🎨",
        position: "right",
      },
      {
        targetId: "sidebar-pro-studio-link",
        title: "音樂配音創作室",
        description:
          "整合頂尖音訊/語音模型：TTS、音樂生成、聲音克隆、音訊處理。還有 AI 形像影片、說話頭像等進階功能。",
        tip: "音樂人、播客創作者和配音師的專屬天地。",
        icon: "🎵",
        position: "right",
      },
      {
        targetId: "sidebar-image-studio-link",
        title: "圖片創作室",
        description:
          "超過 20 種專業圖片生成模型，包含 GPT Image、Flux、SDXL、3D 建模等。還有圖片編輯、姿勢控制和超解析度。",
        tip: "從文生圖到圖生圖，一站式完成！",
        icon: "🖼️",
        position: "right",
      },
      {
        targetId: "sidebar-video-studio-link",
        title: "影片工作室",
        description:
          "21 個頂尖影片模型：文生影、圖生影、影生影、畫質優化、進階鏡頭控制。包含 Kling、Veo3、Sora、Runway 等大廠模型。",
        tip: "想讓靜態圖片動起來？圖生影就是你的答案！",
        icon: "🎬",
        position: "right",
      },
      {
        targetId: "sidebar-director-link",
        title: "導演 AI",
        description:
          "AI 扮演創意導演角色，與你深度對話，規劃完整的創作腳本和分鏡，再自動派發生成任務到各個工作室。",
        tip: "有大型創作項目？讓 AI 導演幫你統籌規劃。",
        icon: "🎭",
        position: "right",
      },
      {
        targetId: "sidebar-learn-link",
        title: "學習文件",
        description:
          "這裡會持續更新 AI 生成技術教學、模型說明、API 文件和最新 AI 新聞。是你學習 AI 創作的知識庫。",
        tip: "新手從這裡開始！",
        icon: "📚",
        position: "right",
      },
      {
        targetId: null,
        title: "開始你的創作旅程！🚀",
        description:
          "你已經認識了 Healing Studio 的主要功能。記得，光球隨時都在畫面右下角陪你，可以問它任何問題、獲取靈感，或重新觀看引導。",
        tip: "創作無對錯，享受過程最重要！",
        icon: "✨",
        position: "center",
      },
    ],
  },

  studio: {
    pageId: "studio",
    storageKey: "site-tour-studio-v2",
    steps: [
      {
        targetId: null,
        title: "創作工作室 🎨",
        description:
          "這是 Healing Studio 的核心創作空間。你可以生成圖片、影片、音樂和語音，四種創作模態在這裡一次完成。",
        tip: "別擔心不知道從哪裡開始，跟著引導一步一步來！",
        icon: "🎨",
        position: "center",
      },
      {
        targetId: "modality-tabs",
        title: "創作模態切換",
        description:
          "圖片、影片、音訊、語音——四種 AI 創作模態，每種都有專屬的靈感積木和參數設定。",
        tip: "試試切換到不同模態，感受各種可能性！",
        icon: "🔀",
        position: "bottom",
      },
      {
        targetId: "prompt-builder-area",
        title: "靈感積木系統",
        description:
          "不知道要寫什麼提詞？點選積木就好！每個積木代表一個創作要素，AI 會自動幫你組合成完整的描述。",
        tip: "多試幾種組合，會有意想不到的效果。",
        icon: "🧩",
        position: "bottom",
      },
      {
        targetId: "generate-button",
        title: "生成按鈕",
        description:
          "選好積木後，按下這個按鈕就開始生成。AI 會根據你的設定自動選擇最適合的模型。",
        tip: "第一次不需要追求完美，先感受 AI 創作的驚喜！",
        icon: "⚡",
        position: "top",
      },
      {
        targetId: "proactive-orb-anchor",
        title: "你的光球夥伴 ✨",
        description:
          "光球是你的 AI 創作夥伴。點擊可以獲得靈感推薦、聊聊創作想法，或重新觀看引導說明。",
        tip: "拖拉光球可以移動位置，找到你最喜歡的位置。",
        icon: "💫",
        position: "left",
        fallbackPosition: "top",
      } as any,
    ],
  },

  "pro-studio": {
    pageId: "pro-studio",
    storageKey: "site-tour-pro-studio-v2",
    steps: [
      {
        targetId: null,
        title: "音樂配音創作室 🎵",
        description:
          "整合 fal.ai 頂尖音訊/語音/影片模型。分類包含：音樂生成、音效設計、TTS 語音合成、聲音克隆、音訊處理和 AI 形像影片。",
        tip: "每個工具卡片下方都有對應的 fal.ai 模型連結，可以查看詳細說明！",
        icon: "🎵",
        position: "center",
      },
      {
        targetId: "pro-tab-music",
        title: "音樂生成",
        description: "使用 Sonauto、ElevenLabs Music 生成完整歌曲或純音樂。支援歌詞輸入、風格標籤和 BPM 設定。",
        tip: "純音樂模式不需要歌詞，開啟「純音樂」開關即可。",
        icon: "🎼",
        position: "bottom",
      },
      {
        targetId: "pro-tab-voice",
        title: "語音合成與克隆",
        description: "多種 TTS 引擎支援中文、英文等多語言。聲音克隆功能可以用幾秒的錄音克隆任意聲音風格。",
        tip: "Qwen TTS 對中文語音效果最佳。",
        icon: "🎙️",
        position: "bottom",
      },
      {
        targetId: "pro-tab-avatar",
        title: "AI 形像影片",
        description: "上傳人像圖片，配合音訊生成說話頭像影片。支援 Wan、EchoMimic、Stable Avatar 等多種模型。",
        tip: "圖片主體越清晰，生成效果越好。",
        icon: "🤖",
        position: "bottom",
      },
    ],
  },

  "image-studio": {
    pageId: "image-studio",
    storageKey: "site-tour-image-studio-v2",
    steps: [
      {
        targetId: null,
        title: "圖片創作室 🖼️",
        description:
          "超過 20 種頂尖圖片生成模型，涵蓋文生圖、圖生圖、圖片編輯、超解析度、3D 建模等完整功能。",
        tip: "左上角標示「NEW」的是最新上線的模型！",
        icon: "🖼️",
        position: "center",
      },
      {
        targetId: "image-api-key-banner",
        title: "API Key 設定",
        description: "部分功能需要設定 FAL_API_KEY。前往 fal.ai 免費申請，然後在設定頁面或 Railway 環境變數中填入。",
        tip: "沒有 Key 也可以先瀏覽功能，設定後就能立即使用！",
        icon: "🔑",
        position: "bottom",
      },
    ],
  },

  "video-studio": {
    pageId: "video-studio",
    storageKey: "site-tour-video-studio-v2",
    steps: [
      {
        targetId: null,
        title: "影片工作室 🎬",
        description:
          "21 個 FAL.AI 頂尖影片模型，分為五大功能：文生影、圖生影、影生影、畫質優化、進階控制。",
        tip: "影片生成通常需要 1-10 分鐘，請耐心等待！",
        icon: "🎬",
        position: "center",
      },
      {
        targetId: null,
        title: "如何選擇模型？",
        description:
          "• 中文語意最強 → Kling v2.1\n• 開源免費最佳 → Wan 2.1\n• 電影品質首選 → Runway Gen4\n• 圖片動起來 → 任意圖生影模型\n• 影片清晰化 → ByteDance Upscaler",
        tip: "建議先用 480p 測試效果，確認滿意再換 720p/1080p 生成。",
        icon: "💡",
        position: "center",
      },
    ],
  },

  director: {
    pageId: "director",
    storageKey: "site-tour-director-v2",
    steps: [
      {
        targetId: null,
        title: "導演 AI 🎭",
        description:
          "AI 扮演創意導演，透過深度對話了解你的創作想法，然後自動規劃完整的創作腳本和生成任務清單。",
        tip: "把你的創作構想用自然語言說給導演聽，越詳細越好！",
        icon: "🎭",
        position: "center",
      },
      {
        targetId: "director-chat-input",
        title: "與導演對話",
        description:
          "直接輸入你的創作想法，例如「我想做一個關於春天的影片，畫面溫暖治癒」。導演會進一步問你細節。",
        tip: "不需要技術術語，用你自己的話說就好。",
        icon: "💬",
        position: "top",
      },
      {
        targetId: "director-reset-btn",
        title: "重置對話",
        description:
          "想要開始一個全新的創作項目？點擊重置按鈕清除當前對話，導演會重新問你想創作什麼。",
        tip: "每次創作項目建議開始一個新對話，思路更清晰。",
        icon: "🔄",
        position: "bottom",
      },
    ],
  },

  models: {
    pageId: "models",
    storageKey: "site-tour-models-v2",
    steps: [
      {
        targetId: null,
        title: "角色鍛造所 ⚙️",
        description:
          "在這裡訓練你的專屬 AI 模型。上傳角色圖片，AI 會學習你角色的外觀特徵，之後生成時就能保持一致性。",
        tip: "建議上傳 5-20 張不同角度、表情的圖片，效果最佳！",
        icon: "⚙️",
        position: "center",
      },
      {
        targetId: "models-dataset-tab",
        title: "資料集準備",
        description: "上傳角色的多角度圖片（正面、側面、背面、表情等），系統會自動幫你標記和描述每張圖片。",
        tip: "圖片品質比數量更重要，清晰的圖片才能訓練出好模型。",
        icon: "📸",
        position: "bottom",
      },
    ],
  },

  history: {
    pageId: "history",
    storageKey: "site-tour-history-v2",
    steps: [
      {
        targetId: null,
        title: "生成歷史 📋",
        description:
          "所有你生成過的作品都在這裡。可以瀏覽、搜尋、評分、加書籤，或者直接重新生成相似內容。",
        tip: "點擊任何一個作品可以展開查看完整的生成參數！",
        icon: "📋",
        position: "center",
      },
      {
        targetId: "history-search",
        title: "搜尋作品",
        description: "輸入提詞關鍵字快速找到你想要的作品。也可以用上方的統計欄篩選不同類型的生成記錄。",
        tip: "按收藏數量排序，快速找到你最喜愛的作品！",
        icon: "🔍",
        position: "bottom",
      },
    ],
  },

  assets: {
    pageId: "assets",
    storageKey: "site-tour-assets-v2",
    steps: [
      {
        targetId: null,
        title: "數位資產庫 📦",
        description:
          "你生成的所有圖片、影片、音訊都會自動存放在這裡。可以管理、分享，或將資產傳送到創作工作室繼續編輯。",
        tip: "設為「團隊共享」的資產，所有成員都可以在共享空間看到！",
        icon: "📦",
        position: "center",
      },
    ],
  },

  vault: {
    pageId: "vault",
    storageKey: "site-tour-vault-v2",
    steps: [
      {
        targetId: null,
        title: "一致性保險庫 🔐",
        description:
          "儲存你的角色和場景參考圖，在生成時引用可以保持視覺一致性。特別適合需要多張圖片保持同一角色外觀的創作。",
        tip: "角色圖建議使用白底清晰正面照效果最好！",
        icon: "🔐",
        position: "center",
      },
    ],
  },

  notes: {
    pageId: "notes",
    storageKey: "site-tour-notes-v2",
    steps: [
      {
        targetId: null,
        title: "專案筆記 📝",
        description:
          "記錄你的創作構想、靈感和備忘。支援多種筆記類型：一般筆記、腳本、靈感、待辦事項。",
        tip: "在創作工作室的光球面板中可以快速儲存靈感到筆記！",
        icon: "📝",
        position: "center",
      },
    ],
  },

  calendar: {
    pageId: "calendar",
    storageKey: "site-tour-calendar-v2",
    steps: [
      {
        targetId: null,
        title: "創作排程 📅",
        description:
          "規劃你的創作時程，設定截止日期和里程碑。可以和筆記結合，讓創作更有計劃性。",
        tip: "定期安排創作時間，持之以恆比偶爾爆發效果更好！",
        icon: "📅",
        position: "center",
      },
    ],
  },

  shared: {
    pageId: "shared",
    storageKey: "site-tour-shared-v2",
    steps: [
      {
        targetId: null,
        title: "共享空間 👥",
        description:
          "瀏覽所有團隊成員分享的資產和模型。找到喜歡的作品可以直接傳送到創作工作室使用。",
        tip: "分享你的優秀作品，讓團隊一起進步！",
        icon: "👥",
        position: "center",
      },
    ],
  },

  dashboard: {
    pageId: "dashboard",
    storageKey: "site-tour-dashboard-v2",
    steps: [
      {
        targetId: null,
        title: "儀表板 📊",
        description:
          "查看你的使用統計：剩餘生成額度、各模態使用次數、費用估算、7天趨勢圖表。",
        tip: "定期查看儀表板，了解自己的創作習慣！",
        icon: "📊",
        position: "center",
      },
    ],
  },

  feedback: {
    pageId: "feedback",
    storageKey: "site-tour-feedback-v2",
    steps: [
      {
        targetId: null,
        title: "回饋中心 💬",
        description:
          "發現 Bug？有功能建議？在這裡提交回饋，開發團隊會認真看每一條！",
        tip: "具體描述問題或建議，越詳細我們越能快速改善！",
        icon: "💬",
        position: "center",
      },
    ],
  },

  settings: {
    pageId: "settings",
    storageKey: "site-tour-settings-v2",
    steps: [
      {
        targetId: null,
        title: "個人設定 ⚙️",
        description:
          "自訂你的 AI 人格（冷靜/創意/技術）、偏好格式，以及重新觀看新手引導。",
        tip: "AI 人格會影響光球的說話風格和建議方向，選擇你最舒適的！",
        icon: "⚙️",
        position: "center",
      },
    ],
  },

  learn: {
    pageId: "learn",
    storageKey: "site-tour-learn-v2",
    steps: [
      {
        targetId: null,
        title: "學習文件 📚",
        description:
          "這裡是 Healing Studio 的知識庫，包含 AI 生成技術教學、模型說明、API 文件和最新 AI 技術新聞。",
        tip: "善用搜尋和分類篩選，快速找到你需要的內容！",
        icon: "📚",
        position: "center",
      },
      {
        targetId: "learn-search",
        title: "搜尋文件",
        description: "輸入關鍵字搜尋相關文件。支援標題、內容和標籤搜尋。",
        tip: "試試搜尋「Kling」或「ControlNet」看看有哪些相關文章！",
        icon: "🔍",
        position: "bottom",
      },
      {
        targetId: "learn-category-filter",
        title: "分類篩選",
        description: "按分類瀏覽：入門指南、模型說明、API 文件、技術教學、AI 新聞等。",
        tip: "新手建議從「入門指南」分類開始！",
        icon: "🏷️",
        position: "bottom",
      },
    ],
  },

  "lora-trainer": {
    pageId: "lora-trainer",
    storageKey: "site-tour-lora-trainer-v1",
    steps: [
      {
        targetId: null,
        title: "LoRA 訓練工坊 🔥",
        description:
          "這裡是 Replicate 專屬的 LoRA 微調訓練環境。你可以查看訓練統計、監控訓練狀態，並管理所有 LoRA 模型。",
        tip: "訓練新模型請前往「角色鍛造所」，這裡專注於訓練監控和管理！",
        icon: "🔥",
        position: "center",
      },
    ],
  },
};

// ─── Context Interface ───────────────────────────────────────────────────────

interface SiteOnboardingContextValue {
  /** Start a tour for a given page. Pass force=true to restart even if already seen */
  startTour: (pageId: PageId, force?: boolean) => void;
  /** Stop the current tour */
  stopTour: () => void;
  /** Whether any tour is currently active */
  isActive: boolean;
  /** Current page being toured */
  currentPageId: PageId | null;
  /** Current step index */
  currentStep: number;
  /** Total steps in current tour */
  totalSteps: number;
  /** Current step data */
  currentStepData: TourStep | null;
  /** Navigate to next step */
  nextStep: () => void;
  /** Navigate to previous step */
  prevStep: () => void;
  /** Mark page tour as completed */
  markSeen: (pageId: PageId) => void;
  /** Check if a page tour has been seen */
  hasSeen: (pageId: PageId) => boolean;
  /** Reset all tours (for settings page) */
  resetAllTours: () => void;
}

const SiteOnboardingContext = createContext<SiteOnboardingContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function SiteOnboardingProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentPageId, setCurrentPageId] = useState<PageId | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const completionCallbackRef = useRef<(() => void) | null>(null);

  const getTourDef = useCallback((pageId: PageId) => {
    return TOUR_DEFINITIONS[pageId];
  }, []);

  const hasSeen = useCallback((pageId: PageId): boolean => {
    try {
      return localStorage.getItem(TOUR_DEFINITIONS[pageId].storageKey) === "true";
    } catch {
      return false;
    }
  }, []);

  const markSeen = useCallback((pageId: PageId) => {
    try {
      localStorage.setItem(TOUR_DEFINITIONS[pageId].storageKey, "true");
    } catch { /* ignore */ }
  }, []);

  const resetAllTours = useCallback(() => {
    try {
      Object.values(TOUR_DEFINITIONS).forEach(def => {
        localStorage.removeItem(def.storageKey);
      });
    } catch { /* ignore */ }
  }, []);

  const startTour = useCallback((pageId: PageId, force = false) => {
    const def = getTourDef(pageId);
    if (!def) return;

    if (!force && hasSeen(pageId)) return;

    setCurrentPageId(pageId);
    setCurrentStep(0);
    setIsActive(true);
  }, [getTourDef, hasSeen]);

  const stopTour = useCallback(() => {
    if (currentPageId) {
      markSeen(currentPageId);
    }
    setIsActive(false);
    setCurrentPageId(null);
    setCurrentStep(0);
    completionCallbackRef.current?.();
    completionCallbackRef.current = null;
  }, [currentPageId, markSeen]);

  const nextStep = useCallback(() => {
    if (!currentPageId) return;
    const def = getTourDef(currentPageId);
    if (!def) return;

    if (currentStep >= def.steps.length - 1) {
      stopTour();
    } else {
      setCurrentStep(s => s + 1);
    }
  }, [currentPageId, currentStep, getTourDef, stopTour]);

  const prevStep = useCallback(() => {
    setCurrentStep(s => Math.max(0, s - 1));
  }, []);

  // Derived current step data
  const currentTourDef = currentPageId ? getTourDef(currentPageId) : null;
  const totalSteps = currentTourDef?.steps.length ?? 0;
  const currentStepData = currentTourDef?.steps[currentStep] ?? null;

  // Listen for global restart event (from ProactiveOrbWidget)
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ pageId?: PageId }>;
      const pageId = customEvent.detail?.pageId ?? "studio";
      startTour(pageId, true);
    };
    window.addEventListener("site-tour-start", handler);
    return () => window.removeEventListener("site-tour-start", handler);
  }, [startTour]);

  const value: SiteOnboardingContextValue = {
    startTour,
    stopTour,
    isActive,
    currentPageId,
    currentStep,
    totalSteps,
    currentStepData,
    nextStep,
    prevStep,
    markSeen,
    hasSeen,
    resetAllTours,
  };

  return (
    <SiteOnboardingContext.Provider value={value}>
      {children}
    </SiteOnboardingContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSiteOnboarding() {
  const ctx = useContext(SiteOnboardingContext);
  if (!ctx) throw new Error("useSiteOnboarding must be used within SiteOnboardingProvider");
  return ctx;
}

/**
 * Convenience hook: automatically triggers the tour for the current page
 * when the component mounts (only if not yet seen).
 */
export function usePageTour(pageId: PageId, delayMs = 800) {
  const { startTour, hasSeen } = useSiteOnboarding();

  useEffect(() => {
    if (hasSeen(pageId)) return;
    const timer = setTimeout(() => startTour(pageId), delayMs);
    return () => clearTimeout(timer);
  }, [pageId, delayMs, startTour, hasSeen]);
}
