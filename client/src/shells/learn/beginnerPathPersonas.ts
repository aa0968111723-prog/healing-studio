// ============================================================================
// shells/learn/beginnerPathPersonas.ts — 新手路徑分角色 fork（AIDV-965）
// ----------------------------------------------------------------------------
// 純函式模組（無 React）：persona 定義、persona→STEPS 映射、onboarding「下一步」
// chips 重排、完成畫面文案客製、localStorage 讀寫（key: learn:beginner-path:persona）。
//
// 【HARD 零回歸約束】未選 persona（loadPersona() === null）或旗標
// FEATURE_BEGINNER_PATH_PERSONAS OFF 時：
//   · getStepsForPersona(null) 回傳 DEFAULT_STEPS（與 AIDV-811 現行 5 步 100% 相同）
//   · reorderNextStepChips(chips, null) 保持原順序
//   · getCompletionCopy(null) / getPathSubtitle(null) 回傳現行文案
// 文案為骨架版；內容卡 AIDV-966 會補精修文案。
// ============================================================================

export type PersonaKey = "ecommerce" | "educator" | "freelancer" | "brand" | "general";

export const PERSONA_LS_KEY = "learn:beginner-path:persona";

/** 沿用 AIDV-811 BeginnerPathPanel 的既有 Step 結構。 */
export interface Step {
  id: string;
  title: string;
  learn: string;
  cta: string;
  href: string;
  docId: string;
  categoryKey: string;
}

// ─── 現行預設 5 步（AIDV-811 原樣搬移，內容一字不改＝零回歸基準）────────────
export const DEFAULT_STEPS: Step[] = [
  {
    id: "read-prompt",
    title: "看懂提示怎麼寫",
    learn: "學會 CO-STAR 結構化提示，讓 AI 真正懂你的意圖。",
    cta: "看提示參考 →",
    href: "/learn?sub=hub",
    docId: "costar-rag",
    categoryKey: "getting-started",
  },
  {
    id: "first-image",
    title: "生出你的第一張圖",
    learn: "從一句話描述開始，生出第一張屬於自己的 AI 圖像。",
    cta: "去創作 →",
    href: "/create",
    docId: "six-agents",
    categoryKey: "getting-started",
  },
  {
    id: "refine",
    title: "微調，讓它更接近你想的",
    learn: "用靈感積木微調提示，反覆試到滿意。",
    cta: "繼續創作 →",
    href: "/create",
    docId: "confirm-gate",
    categoryKey: "workflow",
  },
  {
    id: "animate",
    title: "讓圖動起來",
    learn: "把靜態圖像轉成短影片，進入導演模式。",
    cta: "進影片殼 →",
    href: "/video",
    docId: "shot-pipeline",
    categoryKey: "generation",
  },
  {
    id: "voice",
    title: "配上聲音，作品完整了",
    learn: "為影片配上旁白或音樂，作品就完整了。",
    cta: "去配音 →",
    href: "/pro-studio",
    docId: "cost-ladder",
    categoryKey: "generation",
  },
];

/** 現行標題副文案／完成文案（AIDV-811 原字串＝零回歸基準）。 */
export const DEFAULT_SUBTITLE = "跟著 5 步，從第一張圖到第一支會說話的短片";
export const DEFAULT_COMPLETION = {
  title: "🎉 恭喜完成新手路徑！",
  body: "你已經完成了從第一張圖到配音作品的完整旅程。繼續探索其他分頁深入學習吧！",
} as const;

// ─── Persona 定義（4 專屬 + 通用）─────────────────────────────────────────
export interface PersonaConfig {
  key: PersonaKey;
  emoji: string;
  label: string;
  /** 路徑標題下的一行副文案。 */
  subtitle: string;
  /** 全部步驟完成時的客製文案。 */
  completion: { title: string; body: string };
  steps: Step[];
}

const ECOMMERCE_STEPS: Step[] = [
  {
    id: "ec-describe",
    title: "描述你的商品",
    learn: "用「主體＋材質＋場景」三要素描述商品，是一張好主圖的起點。",
    cta: "去描述商品 →",
    href: "/create",
    docId: "costar-rag",
    categoryKey: "getting-started",
  },
  {
    id: "ec-generate",
    title: "生出商品主圖",
    learn: "把商品描述變成第一張白底主圖，先求有再求好。",
    cta: "生第一張主圖 →",
    href: "/create",
    docId: "scenario-ecommerce-image",
    categoryKey: "getting-started",
  },
  {
    id: "ec-cutout",
    title: "去背／換底",
    learn: "一鍵去背，再換成情境背景，同一張商品照長出多種用途。",
    cta: "去背換底 →",
    href: "/image-studio",
    docId: "scenario-ecommerce-image",
    categoryKey: "generation",
  },
  {
    id: "ec-batch",
    title: "批量套用平台規格",
    learn: "把整套主圖依上架平台規格批次匯出，一次交齊。",
    cta: "去批次匯出 →",
    href: "/assets",
    docId: "cost-ladder",
    categoryKey: "workflow",
  },
];

const EDUCATOR_STEPS: Step[] = [
  {
    id: "edu-script",
    title: "寫一段課程講稿",
    learn: "和導演 AI 對話，把課程重點整理成一段清楚的講稿。",
    cta: "去寫講稿 →",
    href: "/director",
    docId: "costar-rag",
    categoryKey: "getting-started",
  },
  {
    id: "edu-flashcard",
    title: "生出教學字卡圖",
    learn: "把講稿裡的關鍵概念變成一張張教學字卡插圖。",
    cta: "生字卡圖 →",
    href: "/create",
    docId: "six-agents",
    categoryKey: "getting-started",
  },
  {
    id: "edu-voice",
    title: "配上課程旁白",
    learn: "用中文 TTS 把講稿唸出來，3 分鐘做出課程旁白。",
    cta: "去配旁白 →",
    href: "/pro-studio",
    docId: "scenario-educator-voice",
    categoryKey: "generation",
  },
  {
    id: "edu-export",
    title: "輸出成教材",
    learn: "把字卡與旁白整理輸出，變成能直接上課用的教材包。",
    cta: "去輸出教材 →",
    href: "/assets",
    docId: "confirm-gate",
    categoryKey: "workflow",
  },
];

const FREELANCER_STEPS: Step[] = [
  {
    id: "fl-character",
    title: "定義你的角色設定",
    learn: "先把角色的外型、個性、風格寫清楚，後面才鎖得住。",
    cta: "去定角色 →",
    href: "/create",
    docId: "costar-rag",
    categoryKey: "getting-started",
  },
  {
    id: "fl-lora",
    title: "LoRA 角色定版",
    learn: "訓練角色 LoRA 並鎖臉／髮／裝／配件，跨圖保持一致。",
    cta: "去訓練 LoRA →",
    href: "/lora-trainer",
    docId: "lora-lock",
    categoryKey: "model-guide",
  },
  {
    id: "fl-drafts",
    title: "多稿比稿",
    learn: "同一設定生多個版本並排比較，挑出最適合客戶的那一稿。",
    cta: "去出多稿 →",
    href: "/create",
    docId: "confirm-gate",
    categoryKey: "workflow",
  },
  {
    id: "fl-deliver",
    title: "按交付規格輸出",
    learn: "依客戶要求的尺寸與格式輸出定稿，交付不返工。",
    cta: "去交付輸出 →",
    href: "/assets",
    docId: "cost-ladder",
    categoryKey: "workflow",
  },
];

const BRAND_STEPS: Step[] = [
  {
    id: "br-preset",
    title: "建立品牌 preset",
    learn: "把品牌色、風格與角色資產收進一致性保險庫，之後每張圖都對味。",
    cta: "建品牌 preset →",
    href: "/vault",
    docId: "lora-lock",
    categoryKey: "model-guide",
  },
  {
    id: "br-keyvisual",
    title: "生成品牌主視覺",
    learn: "用品牌 preset 生成第一張主視覺，定調整個 campaign。",
    cta: "生主視覺 →",
    href: "/create",
    docId: "costar-rag",
    categoryKey: "generation",
  },
  {
    id: "br-derive",
    title: "衍生成套素材",
    learn: "從主視覺衍生 banner、社群圖等成套素材，風格不跑掉。",
    cta: "去衍生成套 →",
    href: "/image-studio",
    docId: "shot-pipeline",
    categoryKey: "workflow",
  },
  {
    id: "br-review",
    title: "審核與定稿",
    learn: "把整套素材集中審核、確認一致後定稿歸檔。",
    cta: "去審核定稿 →",
    href: "/assets",
    docId: "confirm-gate",
    categoryKey: "workflow",
  },
];

export const PERSONAS: PersonaConfig[] = [
  {
    key: "ecommerce",
    emoji: "🛍️",
    label: "電商賣家",
    subtitle: "跟著 4 步，把商品照變成可上架的整套主圖",
    completion: {
      title: "🎉 恭喜！你的商品圖工作流上手了",
      body: "從描述商品到批量套規格，你已經走完電商主圖的完整流程。下一步試試把主圖動起來做成商品短片吧！",
    },
    steps: ECOMMERCE_STEPS,
  },
  {
    key: "educator",
    emoji: "📖",
    label: "教育者",
    subtitle: "跟著 4 步，從講稿到有旁白的課程素材",
    completion: {
      title: "🎉 恭喜！你的第一份教材完成了",
      body: "從講稿到字卡、旁白與輸出，你已經能獨立做出一課的素材。試著把整個單元做成系列吧！",
    },
    steps: EDUCATOR_STEPS,
  },
  {
    key: "freelancer",
    emoji: "🎨",
    label: "接案者",
    subtitle: "跟著 4 步，定版角色、比稿到按規格交付",
    completion: {
      title: "🎉 恭喜！你的接案交付流程通了",
      body: "從角色定版到多稿比稿與交付規格，你已經能穩定產出一致的角色作品。去接第一張單吧！",
    },
    steps: FREELANCER_STEPS,
  },
  {
    key: "brand",
    emoji: "🏷️",
    label: "品牌方",
    subtitle: "跟著 4 步，從品牌 preset 到成套主視覺",
    completion: {
      title: "🎉 恭喜！你的品牌視覺系統起步了",
      body: "從品牌 preset 到主視覺與成套衍生，你已經建立可複用的品牌生產線。把它交給團隊審核定稿吧！",
    },
    steps: BRAND_STEPS,
  },
  {
    key: "general",
    emoji: "✨",
    label: "通用",
    subtitle: DEFAULT_SUBTITLE,
    completion: { ...DEFAULT_COMPLETION },
    steps: DEFAULT_STEPS,
  },
];

function findPersona(key: PersonaKey | null): PersonaConfig | null {
  if (!key) return null;
  return PERSONAS.find((p) => p.key === key) ?? null;
}

/** persona→STEPS 映射。null（未選）→ DEFAULT_STEPS（同一參照＝與現行 100% 一致）。 */
export function getStepsForPersona(persona: PersonaKey | null): Step[] {
  return findPersona(persona)?.steps ?? DEFAULT_STEPS;
}

/** 路徑副標題。null（未選）→ 現行文案。 */
export function getPathSubtitle(persona: PersonaKey | null): string {
  return findPersona(persona)?.subtitle ?? DEFAULT_SUBTITLE;
}

/** 完成畫面文案（依 persona 客製）。null（未選）→ 現行文案。 */
export function getCompletionCopy(persona: PersonaKey | null): { title: string; body: string } {
  return findPersona(persona)?.completion ?? DEFAULT_COMPLETION;
}

// ─── Onboarding「下一步」chips 重排（AIDV-810 分支 × persona）──────────────
// 以 chip 的導向 path 當 key（null＝「再生一張」chip）。未列入的 chip 維持原相對
// 順序、排在優先清單之後（stable sort）。general／null → 原順序（零回歸）。
const CHIP_PRIORITY: Partial<Record<PersonaKey, (string | null)[]>> = {
  // 電商：先多生幾張主圖，再把主圖動起來做商品短片
  ecommerce: [null, "/video-studio"],
  // 教育者：先配旁白（課程聲音最關鍵）
  educator: ["/pro-studio", null],
  // 接案者：先多稿比稿，再交給導演做整支
  freelancer: [null, "/director"],
  // 品牌方：先整支 campaign 短片，再圖生影衍生
  brand: ["/director", "/video-studio"],
  // general：不列＝原順序
};

/**
 * 依 persona 重排「下一步」chips（該 persona 最相關排最前）。
 * 未選 persona／通用／未知 → 回傳原順序複本（零回歸）；不變動輸入陣列。
 */
export function reorderNextStepChips<T extends { path: string | null }>(
  chips: readonly T[],
  persona: PersonaKey | null,
): T[] {
  const prio = persona ? CHIP_PRIORITY[persona] : undefined;
  if (!prio || prio.length === 0) return [...chips];
  const rank = (c: T) => {
    const i = prio.indexOf(c.path);
    return i === -1 ? prio.length : i;
  };
  return chips
    .map((c, i) => [c, i] as const)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([c]) => c);
}

// ─── localStorage 讀寫（try/catch：私密模式／SSR 安全）────────────────────
export function loadPersona(): PersonaKey | null {
  try {
    const raw = localStorage.getItem(PERSONA_LS_KEY);
    return raw && PERSONAS.some((p) => p.key === raw) ? (raw as PersonaKey) : null;
  } catch {
    return null;
  }
}

export function savePersona(persona: PersonaKey | null): void {
  try {
    if (persona) localStorage.setItem(PERSONA_LS_KEY, persona);
    else localStorage.removeItem(PERSONA_LS_KEY);
  } catch {
    /* 私密模式忽略 */
  }
}
