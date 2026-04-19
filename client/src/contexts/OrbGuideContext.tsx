/**
 * OrbGuideContext.tsx — 光球引導系統全站狀態管理
 *
 * 核心概念：
 *   使用者不需要「學習工具」，只需要告訴光球「我想做什麼」
 *   光球會根據意圖，用對話引導使用者走到正確的工具，並自動設定好參數
 *
 * 流程：
 *   1. 使用者點光球 → 看到「今天想做什麼？」
 *   2. 選擇意圖（圖像/影片/音樂/配音/腳本/不知道）
 *   3. 光球問 1-2 個情境問題（收集偏好）
 *   4. 光球說「帶你去 ✨」並導向正確頁面
 *   5. 到達目標頁面後，光球繼續陪伴解說
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GuideIntent =
  | "image"     // 生成圖像
  | "video"     // 生成影片
  | "music"     // 生成音樂
  | "voice"     // 配音 / 語音克隆
  | "script"    // 生成腳本 / Director AI
  | "lora"      // LoRA 訓練
  | "explore"   // 隨便看看 / 不知道
  | null;

export type GuideStep =
  | "idle"          // 光球靜止，未引導
  | "ask_intent"    // 問「想做什麼？」
  | "ask_detail"    // 問細節問題（風格/情緒/長度等）
  | "confirming"    // 確認並引導前往
  | "navigating"    // 動畫飛行中
  | "arrived"       // 已到達目標頁面，說明工具
  | "guiding";      // 指向頁面元素

export interface GuideAnswer {
  question: string;
  answer: string;
}

export interface GuidePlan {
  intent: GuideIntent;
  answers: GuideAnswer[];
  targetPath: string;
  targetLabel: string;
  orbMessage: string;   // 光球說的話
  autoTabId?: string;   // 到達後自動切換到哪個 Tab
  autoFillPrompt?: string; // 到達後自動填入的提示詞
}

// ─── 意圖對應的目標頁面與問題 ────────────────────────────────────────────────

export interface IntentConfig {
  label: string;
  emoji: string;
  targetPath: string;
  targetLabel: string;
  description: string;
  questions: Array<{
    id: string;
    text: string;
    options: Array<{ label: string; value: string; emoji: string }>;
  }>;
  buildOrbMessage: (answers: Record<string, string>) => string;
  buildPromptHint: (answers: Record<string, string>) => string;
}

export const INTENT_CONFIGS: Record<Exclude<GuideIntent, null>, IntentConfig> = {
  image: {
    label: "生成圖像",
    emoji: "🖼",
    targetPath: "/image-studio",
    targetLabel: "圖像工作室",
    description: "用文字創作任何你想要的畫面",
    questions: [
      {
        id: "style",
        text: "你想要什麼風格的圖？",
        options: [
          { label: "寫實攝影", value: "photorealistic", emoji: "📷" },
          { label: "插畫漫畫", value: "illustration", emoji: "🎨" },
          { label: "療癒水彩", value: "watercolor", emoji: "🌸" },
          { label: "未來科幻", value: "sci-fi", emoji: "🚀" },
        ],
      },
      {
        id: "mood",
        text: "整體氛圍呢？",
        options: [
          { label: "平靜療癒", value: "calm healing", emoji: "🌿" },
          { label: "活力鮮豔", value: "vibrant energetic", emoji: "✨" },
          { label: "神秘夢幻", value: "mysterious dreamy", emoji: "🌙" },
          { label: "溫暖懷舊", value: "warm nostalgic", emoji: "🍂" },
        ],
      },
    ],
    buildOrbMessage: (a) =>
      `好！我幫你選好了${a.style === "photorealistic" ? "寫實攝影" : a.style === "illustration" ? "插畫" : a.style === "watercolor" ? "療癒水彩" : "科幻"}風格，帶你去圖像工作室 ✨`,
    buildPromptHint: (a) =>
      `${a.mood ?? "calm"} ${a.style ?? "photorealistic"} style, high quality, detailed`,
  },

  video: {
    label: "生成影片",
    emoji: "🎬",
    targetPath: "/video-studio",
    targetLabel: "影片工作室",
    description: "幾秒鐘生成流暢動態影片",
    questions: [
      {
        id: "length",
        text: "影片大概多長？",
        options: [
          { label: "5 秒短片", value: "5s", emoji: "⚡" },
          { label: "10 秒動態", value: "10s", emoji: "🎞" },
          { label: "越長越好", value: "long", emoji: "🎥" },
          { label: "隨便都好", value: "any", emoji: "🎲" },
        ],
      },
      {
        id: "type",
        text: "什麼類型的影片？",
        options: [
          { label: "自然風景", value: "nature landscape", emoji: "🌄" },
          { label: "人物特寫", value: "portrait person", emoji: "👤" },
          { label: "抽象動態", value: "abstract motion", emoji: "🌀" },
          { label: "城市街景", value: "city street", emoji: "🏙" },
        ],
      },
    ],
    buildOrbMessage: (a) =>
      `影片生成需要等一點點時間，我會在旁邊陪你。帶你去影片工作室 🎬`,
    buildPromptHint: (a) =>
      `cinematic ${a.type ?? "nature landscape"} video, smooth motion, high quality`,
  },

  music: {
    label: "生成音樂",
    emoji: "🎵",
    targetPath: "/pro-studio",
    targetLabel: "專業創作室",
    description: "創作你專屬的背景音樂",
    questions: [
      {
        id: "genre",
        text: "想要什麼類型的音樂？",
        options: [
          { label: "療癒輕音樂", value: "healing ambient lo-fi", emoji: "🌿" },
          { label: "電子舞曲", value: "electronic dance EDM", emoji: "🎧" },
          { label: "古典鋼琴", value: "classical piano orchestral", emoji: "🎹" },
          { label: "自然聲景", value: "nature sounds meditation", emoji: "🍃" },
        ],
      },
      {
        id: "mood",
        text: "音樂的情緒呢？",
        options: [
          { label: "放鬆平靜", value: "relaxing calm peaceful", emoji: "😌" },
          { label: "充滿活力", value: "energetic uplifting powerful", emoji: "💪" },
          { label: "感傷懷念", value: "melancholic nostalgic emotional", emoji: "🥺" },
          { label: "神秘深邃", value: "mysterious deep atmospheric", emoji: "🌌" },
        ],
      },
    ],
    buildOrbMessage: (a) =>
      `一首${a.genre?.includes("healing") ? "療癒系" : a.genre?.includes("electronic") ? "電子" : a.genre?.includes("classical") ? "古典" : "自然"}音樂即將誕生，帶你去專業創作室 🎵`,
    buildPromptHint: (a) =>
      `${a.genre ?? "healing ambient"}, ${a.mood ?? "relaxing calm"}, no vocals, high quality`,
  },

  voice: {
    label: "配音 / 語音",
    emoji: "🎤",
    targetPath: "/pro-studio",
    targetLabel: "專業創作室（語音）",
    description: "把文字變成自然的語音，或克隆聲音",
    questions: [
      {
        id: "type",
        text: "你需要哪種語音功能？",
        options: [
          { label: "文字轉語音", value: "tts", emoji: "📝" },
          { label: "聲音克隆", value: "clone", emoji: "🎭" },
          { label: "多語言配音", value: "multilingual", emoji: "🌍" },
          { label: "情感語音", value: "emotional", emoji: "💬" },
        ],
      },
    ],
    buildOrbMessage: (_a) =>
      `語音功能我最在行了！帶你去專業創作室的語音區 🎤`,
    buildPromptHint: (_a) => "",
  },

  script: {
    label: "寫腳本 / 故事",
    emoji: "📝",
    targetPath: "/director",
    targetLabel: "導演 AI",
    description: "讓 AI 幫你規劃創作腳本與分鏡",
    questions: [
      {
        id: "format",
        text: "要做什麼類型的內容？",
        options: [
          { label: "短影片腳本", value: "short video script", emoji: "📱" },
          { label: "廣告創意", value: "advertisement creative", emoji: "📺" },
          { label: "故事大綱", value: "story outline narrative", emoji: "📖" },
          { label: "冥想引導", value: "meditation guidance healing", emoji: "🧘" },
        ],
      },
      {
        id: "length",
        text: "大概多長的內容？",
        options: [
          { label: "30 秒以內", value: "30 seconds short", emoji: "⚡" },
          { label: "1–3 分鐘", value: "1 to 3 minutes medium", emoji: "🕐" },
          { label: "5 分鐘以上", value: "5 minutes long", emoji: "📽" },
          { label: "還沒決定", value: "flexible", emoji: "🤔" },
        ],
      },
    ],
    buildOrbMessage: (a) =>
      `讓導演 AI 幫你把想法變成完整腳本。帶你去導演工作室 🎬`,
    buildPromptHint: (a) =>
      `Create a ${a.format ?? "short video script"} that is ${a.length ?? "flexible"} in length`,
  },

  lora: {
    label: "訓練專屬模型",
    emoji: "🧬",
    targetPath: "/lora-trainer",
    targetLabel: "LoRA 訓練器",
    description: "上傳圖片，訓練你自己的 AI 風格",
    questions: [
      {
        id: "type",
        text: "你想訓練什麼類型的模型？",
        options: [
          { label: "我的臉 / 人物", value: "face portrait", emoji: "👤" },
          { label: "特定插畫風格", value: "art style illustration", emoji: "🎨" },
          { label: "品牌 / 產品", value: "product brand", emoji: "📦" },
          { label: "其他概念", value: "concept object", emoji: "✨" },
        ],
      },
    ],
    buildOrbMessage: (_a) =>
      `LoRA 訓練需要一點時間，但成果會完全屬於你。帶你去訓練器 🧬`,
    buildPromptHint: (_a) => "",
  },

  explore: {
    label: "隨便看看",
    emoji: "✨",
    targetPath: "/studio",
    targetLabel: "創意工作室",
    description: "不知道從哪開始？讓光球帶你探索",
    questions: [
      {
        id: "feeling",
        text: "現在的心情是？",
        options: [
          { label: "想放鬆一下", value: "relax", emoji: "🌿" },
          { label: "充滿創作欲", value: "creative", emoji: "🔥" },
          { label: "只是想看看", value: "curious", emoji: "👀" },
          { label: "需要靈感", value: "inspired", emoji: "💡" },
        ],
      },
    ],
    buildOrbMessage: (a) => {
      const msgs: Record<string, string> = {
        relax: "輕鬆的創作最美好，帶你去療癒一下 🌿",
        creative: "創作欲很強！帶你去創意工作室釋放能量 🔥",
        curious: "隨便逛逛也很好，我帶你看看有什麼好玩的 👀",
        inspired: "讓我幫你找到今天的靈感方向 💡",
      };
      return msgs[a.feeling ?? "curious"] ?? "好，跟我來 ✨";
    },
    buildPromptHint: (_a) => "",
  },
};

// ─── Context Type ─────────────────────────────────────────────────────────────

interface OrbGuideContextType {
  // 目前引導步驟
  step: GuideStep;
  // 選擇的意圖
  intent: GuideIntent;
  // 已收集的答案
  answers: Record<string, string>;
  // 最終計畫
  plan: GuidePlan | null;
  // 是否正在顯示引導面板
  isPanelOpen: boolean;

  // Actions
  openPanel: () => void;
  closePanel: () => void;
  selectIntent: (intent: GuideIntent) => void;
  submitAnswer: (questionId: string, value: string) => void;
  confirmAndNavigate: () => void;
  reset: () => void;
  // 到達目標頁面後，光球說的第一句話
  arrivedMessage: string | null;
  clearArrivedMessage: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const OrbGuideContext = createContext<OrbGuideContextType>({
  step: "idle",
  intent: null,
  answers: {},
  plan: null,
  isPanelOpen: false,
  openPanel: () => {},
  closePanel: () => {},
  selectIntent: () => {},
  submitAnswer: () => {},
  confirmAndNavigate: () => {},
  reset: () => {},
  arrivedMessage: null,
  clearArrivedMessage: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function OrbGuideProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<GuideStep>("idle");
  const [intent, setIntent] = useState<GuideIntent>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<GuidePlan | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [arrivedMessage, setArrivedMessage] = useState<string | null>(null);
  // track answered question index
  const questionIndexRef = useRef(0);

  const openPanel = useCallback(() => {
    setIsPanelOpen(true);
    setStep("ask_intent");
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
    setStep("idle");
  }, []);

  const selectIntent = useCallback((chosen: GuideIntent) => {
    setIntent(chosen);
    setAnswers({});
    questionIndexRef.current = 0;
    setStep("ask_detail");
  }, []);

  const submitAnswer = useCallback(
    (questionId: string, value: string) => {
      if (!intent) return;
      const cfg = INTENT_CONFIGS[intent];
      const newAnswers = { ...answers, [questionId]: value };
      setAnswers(newAnswers);

      const nextIndex = questionIndexRef.current + 1;
      questionIndexRef.current = nextIndex;

      // 所有問題都回答完了 → 進確認步驟
      if (nextIndex >= cfg.questions.length) {
        const orbMessage = cfg.buildOrbMessage(newAnswers);
        const autoFillPrompt = cfg.buildPromptHint(newAnswers);
        const newPlan: GuidePlan = {
          intent,
          answers: Object.entries(newAnswers).map(([q, a]) => ({
            question: q,
            answer: a,
          })),
          targetPath: cfg.targetPath,
          targetLabel: cfg.targetLabel,
          orbMessage,
          autoFillPrompt: autoFillPrompt || undefined,
        };
        setPlan(newPlan);
        setStep("confirming");
      }
      // 否則繼續下一個問題（step 保持 ask_detail，由 Panel 靠 questionIndex 決定顯示哪題）
    },
    [intent, answers]
  );

  const confirmAndNavigate = useCallback(() => {
    if (!plan) return;
    setStep("navigating");
    setIsPanelOpen(false);

    // 設定到達訊息，讓目標頁面的光球顯示
    setArrivedMessage(plan.orbMessage);

    // 觸發導航
    window.dispatchEvent(
      new CustomEvent("orb-guide-navigate", {
        detail: {
          path: plan.targetPath,
          autoFillPrompt: plan.autoFillPrompt,
          autoTabId: plan.autoTabId,
        },
      })
    );

    // 短暫延遲後重置步驟（讓動畫完成）
    setTimeout(() => {
      setStep("arrived");
    }, 1000);
  }, [plan]);

  const reset = useCallback(() => {
    setStep("idle");
    setIntent(null);
    setAnswers({});
    setPlan(null);
    setIsPanelOpen(false);
    questionIndexRef.current = 0;
  }, []);

  const clearArrivedMessage = useCallback(() => {
    setArrivedMessage(null);
    setStep("idle");
  }, []);

  const value = useMemo(
    () => ({
      step,
      intent,
      answers,
      plan,
      isPanelOpen,
      openPanel,
      closePanel,
      selectIntent,
      submitAnswer,
      confirmAndNavigate,
      reset,
      arrivedMessage,
      clearArrivedMessage,
    }),
    [
      step,
      intent,
      answers,
      plan,
      isPanelOpen,
      openPanel,
      closePanel,
      selectIntent,
      submitAnswer,
      confirmAndNavigate,
      reset,
      arrivedMessage,
      clearArrivedMessage,
    ]
  );

  return (
    <OrbGuideContext.Provider value={value}>
      {children}
    </OrbGuideContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrbGuide() {
  return useContext(OrbGuideContext);
}
