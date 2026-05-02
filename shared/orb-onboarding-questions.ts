/**
 * shared/orb-onboarding-questions.ts
 *
 * The cold-start questions shown by `OrbOnboardingDialog`. Three short
 * questions, each producing structured answers the chat router can fold
 * into the orb's system prompt as a seed preference profile — so even a
 * brand-new user has SOMETHING for the planner to work with on turn one.
 *
 * Pure data + tiny serializer — no UI, no I/O. The dialog component
 * imports both; the chat router can also read the answers off
 * `OrbOnboardingAnswers` to enrich `OrbPromptExtras.rememberedPreferences`.
 */

export type OrbOnboardingQuestionId =
  | "primary-goal"
  | "preferred-pacing"
  | "confirmation-style";

export interface OrbOnboardingOption {
  id: string;
  label: string;
  /** Free-text follow-up that the dialog can render under the option. */
  description?: string;
}

export interface OrbOnboardingQuestion {
  id: OrbOnboardingQuestionId;
  prompt: string;
  helper?: string;
  options: OrbOnboardingOption[];
}

export const ORB_ONBOARDING_QUESTIONS: OrbOnboardingQuestion[] = [
  {
    id: "primary-goal",
    prompt: "你今天最想做哪一件事？",
    helper: "可以隨時改，這只是給光球一個起點。",
    options: [
      { id: "image", label: "做一張圖片", description: "海報 / 插畫 / 封面" },
      { id: "video", label: "做一段影片", description: "短片、廣告、Reels" },
      { id: "audio", label: "做配樂或音效", description: "BGM / SFX / 環境音" },
      { id: "voice", label: "做配音或旁白", description: "TTS / 角色聲線" },
      { id: "explore", label: "先逛逛看看", description: "我還在想要做什麼" },
    ],
  },
  {
    id: "preferred-pacing",
    prompt: "做這件事時，你比較喜歡哪種節奏？",
    helper: "光球會用這個調整何時停下來確認。",
    options: [
      { id: "patient", label: "慢慢來", description: "重要的步驟我會想停下來看一下" },
      { id: "balanced", label: "平衡", description: "破壞性動作（送出/重置）才確認就好" },
      { id: "impatient", label: "快一點", description: "信任光球，直接做，少打斷" },
    ],
  },
  {
    id: "confirmation-style",
    prompt: "對於可能花點數的動作（生圖/生影片），希望光球怎麼處理？",
    options: [
      { id: "always-confirm", label: "永遠先問我", description: "每次都先估算 + 確認" },
      { id: "cap-only", label: "設個上限", description: "超過上限再問就好" },
      { id: "trust", label: "全都信任", description: "估好我就動手，不打斷" },
    ],
  },
];

/** The shape persisted to the orb's preference store after onboarding. */
export type OrbOnboardingAnswers = {
  [K in OrbOnboardingQuestionId]?: string;
};

/**
 * Map onboarding answers into the partial `AgentPreferences` patch the
 * settings router accepts. This is the one place where business rules
 * (answer → setting) live; the dialog just collects, the router just
 * persists.
 */
export interface OnboardingDerivedPreferences {
  pacingOverride: "auto" | "patient" | "balanced" | "impatient";
  confirmationPolicy: "always_approve" | "confirm_high_risk" | "confirm_all" | "manual";
  costBudget:
    | { perWorkflowCap: number | null; remainingCredits: null; confirmAtTierOrAbove: null; alwaysAllow: false }
    | null;
  /** Free-form note we tuck into orbWelcomeMessage on first finish. */
  welcomeMessageHint?: string;
  /** One of "image" / "video" / "audio" / "voice" / "explore" — used for first-tour landing. */
  primaryGoal: string;
}

export function deriveOnboardingPreferences(
  answers: OrbOnboardingAnswers
): OnboardingDerivedPreferences {
  const goal = answers["primary-goal"] ?? "explore";
  const pacingAnswer = answers["preferred-pacing"];
  const pacingOverride: OnboardingDerivedPreferences["pacingOverride"] =
    pacingAnswer === "patient" || pacingAnswer === "balanced" || pacingAnswer === "impatient"
      ? pacingAnswer
      : "auto";

  const confirmationAnswer = answers["confirmation-style"];
  const confirmationPolicy: OnboardingDerivedPreferences["confirmationPolicy"] =
    confirmationAnswer === "always-confirm"
      ? "confirm_all"
      : confirmationAnswer === "trust"
      ? "always_approve"
      : "confirm_high_risk";

  // Cost budget: only seed when the user said "set a cap". Default cap of
  // 100 credits is a soft starting point; users adjust in settings.
  const costBudget: OnboardingDerivedPreferences["costBudget"] =
    confirmationAnswer === "cap-only"
      ? {
          perWorkflowCap: 100,
          remainingCredits: null,
          confirmAtTierOrAbove: null,
          alwaysAllow: false,
        }
      : null;

  const goalToLine: Record<string, string> = {
    image: "你說想先做一張圖片，那我們從圖片創作室開始吧。",
    video: "你說想先做一段影片，那我們從影片工作室開始吧。",
    audio: "你說想先做配樂或音效，那我們從音樂配音創作室開始吧。",
    voice: "你說想先做配音，那我們從音樂配音創作室開始吧。",
    explore: "今天想先逛逛，我帶你看看有哪些創作工具。",
  };

  return {
    pacingOverride,
    confirmationPolicy,
    costBudget,
    welcomeMessageHint: goalToLine[goal] ?? goalToLine.explore,
    primaryGoal: goal,
  };
}

/**
 * Render a one-line summary of the answers — used in the
 * `PreferenceNudgeCard` so users can see "光球記得你說 X" at a glance.
 */
export function summarizeOnboardingAnswers(answers: OrbOnboardingAnswers): string {
  const parts: string[] = [];
  const goal = answers["primary-goal"];
  if (goal) {
    const goalLabels: Record<string, string> = {
      image: "圖片",
      video: "影片",
      audio: "配樂",
      voice: "配音",
      explore: "先逛逛",
    };
    parts.push(`目標：${goalLabels[goal] ?? goal}`);
  }
  const pacing = answers["preferred-pacing"];
  if (pacing) {
    const pacingLabels: Record<string, string> = {
      patient: "慢節奏",
      balanced: "平衡",
      impatient: "快節奏",
    };
    parts.push(`節奏：${pacingLabels[pacing] ?? pacing}`);
  }
  const confirm = answers["confirmation-style"];
  if (confirm) {
    const confirmLabels: Record<string, string> = {
      "always-confirm": "凡事先問",
      "cap-only": "設上限",
      trust: "全部信任",
    };
    parts.push(`確認：${confirmLabels[confirm] ?? confirm}`);
  }
  return parts.join("｜");
}
