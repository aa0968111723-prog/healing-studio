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
import type { AgentAction } from "../../../shared/agent-actions";
import {
  buildOrbGuideActions,
  buildOrbGuideManualSteps,
  type OrbGuideIntentId,
  type OrbGuideManualStep,
} from "../../../shared/orb-guide-plans";
import { getPageByPath } from "@/config/appRegistry";

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

export interface OrbArrivalChoice {
  /** 用來追蹤使用者選了哪一張，避免重複 dispatch 同一張 */
  id: string;
  /** 卡片上顯示的主文字 */
  label: string;
  /** 副文字（選填） */
  hint?: string;
  /** 表情 emoji（選填） */
  emoji?: string;
  /** 按下後光球要替使用者執行的 actions（會自動 dispatch） */
  actions: AgentAction[];
  /** 按下後是否關掉 arrival 卡片，預設 false（讓使用者可以連按） */
  dismissOnSelect?: boolean;
}

export interface GuidePlan {
  intent: GuideIntent;
  answers: GuideAnswer[];
  targetPath: string;
  targetLabel: string;
  orbMessage: string;   // 光球說的話
  autoFillPrompt?: string; // 到達後自動填入的提示詞（legacy；鏡射 actions 裡的 fillPrompt）
  /** Phase 3e：到站要執行的結構化動作清單（非破壞性：setTab / fillPrompt…） */
  actions: AgentAction[];
  /** 到站後使用者要親自完成的步驟（程式無法代勞，例如上傳檔案、按生成） */
  manualSteps: OrbGuideManualStep[];
  /**
   * 到站後給使用者「再選一個」的快速卡片。每張卡片帶一組 actions，按下去
   * 光球就會替使用者執行（例如切分頁、套關鍵字、開對話框）。跟 manualSteps
   * 不同：manualSteps 是純 checklist，arrivalChoices 是「光球替你做」按鈕。
   */
  arrivalChoices?: OrbArrivalChoice[];
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

/**
 * 依目標頁面提供「光球替你按一下」的快速選項。
 * 沒有覆蓋到的頁面就回空陣列，arrival 卡片會自動省略這個區塊。
 *
 * 重點：每張卡片都帶 AgentAction[]，使用者按下去 = 光球用 PageAgent bus
 * 替他執行（切分頁／套關鍵字／開對話框…）— 不會只是「告訴他怎麼做」。
 */
function buildDefaultArrivalChoices(targetPath: string): OrbArrivalChoice[] {
  // 把 querystring 拆出來方便比對
  const [pathOnly, queryStr = ""] = targetPath.split("?");
  const query = new URLSearchParams(queryStr);
  const section = query.get("section");

  // /assets?section=prompts — 提示詞庫
  if (pathOnly === "/assets" && section === "prompts") {
    return [
      {
        id: "prompts-image",
        label: "我要找圖像 prompt",
        emoji: "🖼",
        actions: [{ type: "search", query: "image" }],
      },
      {
        id: "prompts-music",
        label: "我要找音樂 prompt",
        emoji: "🎵",
        actions: [{ type: "search", query: "music" }],
      },
      {
        id: "prompts-video",
        label: "我要找影片 prompt",
        emoji: "🎬",
        actions: [{ type: "search", query: "video" }],
      },
      {
        id: "prompts-healing",
        label: "找療癒風格的 prompt",
        emoji: "🌿",
        actions: [{ type: "search", query: "healing" }],
      },
    ];
  }

  // /assets — 數位資產庫主頁
  if (pathOnly === "/assets" && !section) {
    return [
      {
        id: "assets-history",
        label: "看我最近的生成歷史",
        emoji: "🕒",
        actions: [{ type: "setTab", tabId: "history" }],
      },
      {
        id: "assets-prompts",
        label: "去提示詞庫挑模板",
        emoji: "📚",
        actions: [{ type: "setTab", tabId: "prompts" }],
      },
      {
        id: "assets-shared",
        label: "看共享空間",
        emoji: "🤝",
        actions: [{ type: "setTab", tabId: "shared" }],
      },
    ];
  }

  // 圖像工作室
  if (pathOnly === "/image-studio") {
    return [
      {
        id: "image-photoreal",
        label: "我要寫實風格",
        emoji: "📷",
        actions: [
          {
            type: "fillPrompt",
            text: "photorealistic, high quality, detailed, natural lighting",
          },
        ],
      },
      {
        id: "image-illustration",
        label: "我要插畫風格",
        emoji: "🎨",
        actions: [
          {
            type: "fillPrompt",
            text: "illustration, soft colors, hand-drawn, expressive",
          },
        ],
      },
      {
        id: "image-watercolor",
        label: "我要療癒水彩",
        emoji: "🌸",
        actions: [
          {
            type: "fillPrompt",
            text: "watercolor, healing, soft pastel, gentle brush strokes",
          },
        ],
      },
    ];
  }

  // 影片工作室
  if (pathOnly === "/video-studio") {
    return [
      {
        id: "video-nature",
        label: "自然風景動態",
        emoji: "🌄",
        actions: [
          {
            type: "fillPrompt",
            text: "cinematic nature landscape, smooth camera motion, golden hour",
          },
        ],
      },
      {
        id: "video-portrait",
        label: "人物特寫動態",
        emoji: "👤",
        actions: [
          {
            type: "fillPrompt",
            text: "portrait close-up, subtle motion, soft lighting",
          },
        ],
      },
      {
        id: "video-abstract",
        label: "抽象動態",
        emoji: "🌀",
        actions: [
          {
            type: "fillPrompt",
            text: "abstract motion, flowing colors, dreamy atmosphere",
          },
        ],
      },
    ];
  }

  // 專業創作室（音樂/配音）
  if (pathOnly === "/pro-studio") {
    return [
      {
        id: "pro-music",
        label: "做一段背景音樂",
        emoji: "🎵",
        actions: [{ type: "setTab", tabId: "music" }],
      },
      {
        id: "pro-tts",
        label: "做配音 / TTS",
        emoji: "🎤",
        actions: [{ type: "setTab", tabId: "voice" }],
      },
    ];
  }

  return [];
}

function resolveIntentTarget(cfg: IntentConfig): {
  targetPath: string;
  targetLabel: string;
} {
  const registryPage = getPageByPath(cfg.targetPath);
  // 下一步：改由 registry 驅動 intent 設定，逐步移除 INTENT_CONFIGS 內的 targetLabel/path 重複定義。
  if (registryPage) {
    return {
      targetPath: registryPage.path,
      targetLabel: registryPage.label,
    };
  }
  return {
    targetPath: cfg.targetPath,
    targetLabel: cfg.targetLabel,
  };
}

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
  // 到站後使用者已勾掉的手動步驟 id
  completedManualStepIds: string[];

  // Actions
  openPanel: () => void;
  closePanel: () => void;
  selectIntent: (intent: GuideIntent) => void;
  submitAnswer: (questionId: string, value: string) => void;
  confirmAndNavigate: () => void;
  reset: () => void;
  // 在「到站」狀態下勾掉某個手動步驟
  toggleManualStepDone: (stepId: string) => void;
  // 收掉到站引導卡（保留 plan 以便快速重看）
  dismissArrival: () => void;
  // 到達目標頁面後，光球說的第一句話
  arrivedMessage: string | null;
  clearArrivedMessage: () => void;
  // Phase 3d-hybrid：LLM 改寫了 orbMessage / autoFillPrompt 後，
  // Panel 呼叫這個把 plan 補上軟化後的文字。
  patchPlan: (patch: {
    orbMessage?: string;
    autoFillPrompt?: string;
  }) => void;
  // 給「不是走完整意圖問答、但仍然發生跳頁」的入口（/agent starter 快速動作、
  // 聊天驅動的 navigate）用：直接把 panel 切到「navigating → arrived」並
  // 帶上一份合成的 plan，讓使用者到站後仍然看得到「已自動完成 / 接下來請
  // 你做」這張引導卡，而不是只剩光球底下那顆「完成」泡泡。
  attachArrivalGuide: (input: {
    targetPath: string;
    targetLabel?: string;
    orbMessage?: string;
    actions?: AgentAction[];
    manualSteps?: OrbGuideManualStep[];
    arrivalChoices?: OrbArrivalChoice[];
  }) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const OrbGuideContext = createContext<OrbGuideContextType>({
  step: "idle",
  intent: null,
  answers: {},
  plan: null,
  isPanelOpen: false,
  completedManualStepIds: [],
  openPanel: () => {},
  closePanel: () => {},
  selectIntent: () => {},
  submitAnswer: () => {},
  confirmAndNavigate: () => {},
  reset: () => {},
  toggleManualStepDone: () => {},
  dismissArrival: () => {},
  arrivedMessage: null,
  clearArrivedMessage: () => {},
  patchPlan: () => {},
  attachArrivalGuide: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function OrbGuideProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<GuideStep>("idle");
  const [intent, setIntent] = useState<GuideIntent>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<GuidePlan | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [arrivedMessage, setArrivedMessage] = useState<string | null>(null);
  const [completedManualStepIds, setCompletedManualStepIds] = useState<string[]>([]);
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
        const promptHint = cfg.buildPromptHint(newAnswers);
        const planInput = {
          intent: intent as OrbGuideIntentId,
          answers: newAnswers,
          promptHint,
        };
        const actions = buildOrbGuideActions(planInput);
        const manualSteps = buildOrbGuideManualSteps(planInput);
        const target = resolveIntentTarget(cfg);
        const newPlan: GuidePlan = {
          intent,
          answers: Object.entries(newAnswers).map(([q, a]) => ({
            question: q,
            answer: a,
          })),
          targetPath: target.targetPath,
          targetLabel: target.targetLabel,
          orbMessage,
          autoFillPrompt: promptHint || undefined,
          actions,
          manualSteps,
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
    // 跳頁時保持面板開著：目標頁的自動動作（setTab / fillPrompt …）會在 PageAgent
    // queue drain 時自動執行；面板會切到「到站引導」緊湊版，列出已自動完成的
    // 步驟與接下來使用者要親自做的事，避免使用者跳過去後一片茫然。
    setCompletedManualStepIds([]);

    // 設定到達訊息，讓目標頁面的光球顯示
    setArrivedMessage(plan.orbMessage);

    // 觸發導航：Phase 3e 起把完整 AgentAction[] 交給 widget listener，
    // listener 再用 pageAgent.dispatchMany 丟進 bus。舊欄位 autoFillPrompt
    // 仍保留作為 fallback（萬一 listener 更新版本不一致也能拿到提示詞）。
    window.dispatchEvent(
      new CustomEvent("orb-guide-navigate", {
        detail: {
          path: plan.targetPath,
          actions: plan.actions,
          autoFillPrompt: plan.autoFillPrompt,
        },
      })
    );

    // 短暫延遲後切到「到站」步驟，讓動畫完成
    setTimeout(() => {
      setStep("arrived");
    }, 800);
  }, [plan]);

  const reset = useCallback(() => {
    setStep("idle");
    setIntent(null);
    setAnswers({});
    setPlan(null);
    setIsPanelOpen(false);
    setCompletedManualStepIds([]);
    questionIndexRef.current = 0;
  }, []);

  const clearArrivedMessage = useCallback(() => {
    // 只清掉短暫的到站問候訊息（toast 用），不影響 step；
    // 「到站引導卡」由 step === "arrived" 管，使用者自己關閉。
    setArrivedMessage(null);
  }, []);

  const toggleManualStepDone = useCallback((stepId: string) => {
    setCompletedManualStepIds(prev =>
      prev.includes(stepId)
        ? prev.filter(id => id !== stepId)
        : [...prev, stepId]
    );
  }, []);

  const dismissArrival = useCallback(() => {
    setStep("idle");
    setIsPanelOpen(false);
    setIntent(null);
    setAnswers({});
    setPlan(null);
    setCompletedManualStepIds([]);
    setArrivedMessage(null);
    questionIndexRef.current = 0;
  }, []);

  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const attachArrivalGuide = useCallback(
    (input: {
      targetPath: string;
      targetLabel?: string;
      orbMessage?: string;
      actions?: AgentAction[];
      manualSteps?: OrbGuideManualStep[];
      arrivalChoices?: OrbArrivalChoice[];
    }) => {
      const registryPage = getPageByPath(input.targetPath);
      const label =
        input.targetLabel ?? registryPage?.label ?? input.targetPath;
      const orbMessage =
        input.orbMessage ?? `已帶你到「${label}」，下面有我幫你做好的事。`;
      const actions = input.actions ?? [];
      const manualSteps = input.manualSteps ?? [];
      const arrivalChoices = input.arrivalChoices ?? buildDefaultArrivalChoices(input.targetPath);

      // 合成一份不走 intent 問答的 plan：targetLabel/actions 會餵給
      // OrbGuidePanel 的 arrival 緊湊卡，列出已自動完成 + 接下來要做的事。
      const synthesized: GuidePlan = {
        intent: null,
        answers: [],
        targetPath: input.targetPath,
        targetLabel: label,
        orbMessage,
        actions,
        manualSteps,
        arrivalChoices: arrivalChoices.length > 0 ? arrivalChoices : undefined,
      };

      if (arrivalTimerRef.current) {
        clearTimeout(arrivalTimerRef.current);
        arrivalTimerRef.current = null;
      }

      setIntent(null);
      setAnswers({});
      questionIndexRef.current = 0;
      setCompletedManualStepIds([]);
      setPlan(synthesized);
      setStep("navigating");
      setIsPanelOpen(true);
      // 不設 arrivedMessage — ProactiveOrbWidget 會把它當 feedback 泡泡
      // 顯示在光球旁邊，但 arrival 卡本身已經把訊息寫在 header 了，重複
      // 只會吵到使用者。

      arrivalTimerRef.current = setTimeout(() => {
        arrivalTimerRef.current = null;
        setStep("arrived");
      }, 600);
    },
    []
  );

  const patchPlan = useCallback(
    (patch: { orbMessage?: string; autoFillPrompt?: string }) => {
      setPlan(prev => {
        if (!prev) return prev;
        const nextPrompt =
          patch.autoFillPrompt !== undefined
            ? patch.autoFillPrompt || undefined
            : prev.autoFillPrompt;
        // 若 autoFillPrompt 被 patch 到，同步把 actions 裡的 fillPrompt 也換掉，
        // 這樣 Phase 3d-hybrid LLM 重寫的版本才會真的送到目標頁。
        const nextActions =
          patch.autoFillPrompt !== undefined
            ? prev.actions.map(a =>
                a.type === "fillPrompt"
                  ? { ...a, text: patch.autoFillPrompt as string }
                  : a
              )
            : prev.actions;
        return {
          ...prev,
          orbMessage: patch.orbMessage ?? prev.orbMessage,
          autoFillPrompt: nextPrompt,
          actions: nextActions,
        };
      });
    },
    []
  );

  const value = useMemo(
    () => ({
      step,
      intent,
      answers,
      plan,
      isPanelOpen,
      completedManualStepIds,
      openPanel,
      closePanel,
      selectIntent,
      submitAnswer,
      confirmAndNavigate,
      reset,
      toggleManualStepDone,
      dismissArrival,
      arrivedMessage,
      clearArrivedMessage,
      patchPlan,
      attachArrivalGuide,
    }),
    [
      step,
      intent,
      answers,
      plan,
      isPanelOpen,
      completedManualStepIds,
      openPanel,
      closePanel,
      selectIntent,
      submitAnswer,
      confirmAndNavigate,
      reset,
      toggleManualStepDone,
      dismissArrival,
      arrivedMessage,
      clearArrivedMessage,
      patchPlan,
      attachArrivalGuide,
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
