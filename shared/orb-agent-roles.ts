/**
 * shared/orb-agent-roles.ts
 *
 * Multi-agent role routing. The orb is one user-facing assistant but
 * internally it plays distinct roles depending on the request — director
 * for planning, composer for execution, critic for review, researcher for
 * gathering info, navigator for taking the user somewhere. This module
 * centralises the routing logic so the chat router and planner can ask
 * "which role is in charge of this turn?" instead of duplicating
 * keyword heuristics.
 *
 * Pure / sync; no I/O. The actual prompt slices are short on purpose —
 * the full personality + site knowledge already exists in
 * `siteKnowledge.buildOrbSystemPrompt`. These slices just steer that
 * prompt for the current turn.
 */
import type { PageAgentSnapshot } from "./agent-actions";

export type AgentRole =
  | "director"   // multi-step planning across pages
  | "composer"   // execution / dispatch on a single page
  | "critic"     // review user's plan / output, suggest improvements
  | "researcher" // search docs / web / asset library before acting
  | "navigator"  // just take the user somewhere, no execution
  | "companion"  // open conversation, no goal yet
  | "accountant"     // proactive site-wide cost / budget / usage watchdog (財財)
  | "quality-coach"  // proactive prompt + output quality coach (巧巧)
  | "inspector"      // proactive site patrol — broken links / a11y / perf (守守)
  | "image-specialist"    // image generation & editing specialist
  | "video-specialist"    // video generation & editing specialist
  | "music-specialist"    // music & audio generation specialist
  | "voice-specialist"    // voice cloning & dubbing specialist
  | "training-specialist" // model training & LoRA specialist
  | "learning-specialist"; // learning & tutorial guidance specialist

export interface RoleSelectionInput {
  /** User's most recent utterance, lower-cased before matching. */
  text: string;
  /** Current page snapshot, when available — narrows composer detection. */
  snapshot?: PageAgentSnapshot | null;
  /** Conversation length in turns; >0 means we're not in a cold-start. */
  turnCount?: number;
  /**
   * Spirits the user has muted (from agent-preferences). selectRoleForIntent
   * skips matches against these and continues to the next rule, falling back
   * to companion if every match is muted. Honors the user's "我不想再被這位
   * 主動關心" choice without forcing them to delete keyword rules.
   */
  mutedRoles?: readonly AgentRole[];
}

export interface RoleSelection {
  role: AgentRole;
  /** Confidence in the selection (0..1). */
  confidence: number;
  /** Why we picked this role — useful for telemetry + LLM prompts. */
  rationale: string;
}

const KEYWORD_RULES: Array<{
  role: AgentRole;
  keywords: readonly string[];
  rationale: string;
}> = [
  // Director: explicit multi-step / cross-page workflow asks.
  {
    role: "director",
    keywords: [
      "規劃",
      "計畫",
      "工作流",
      "拼起來",
      "整個流程",
      "多步驟",
      "從頭到尾",
      "幫我做一支",
      "幫我做一首",
      "幫我做一張",
      "拆成步驟",
      "plan",
      "workflow",
      "pipeline",
      "story arc",
      "end-to-end",
    ],
    rationale: "user asked for multi-step / cross-page planning",
  },
  // Image Specialist: focused image generation and editing tasks
  {
    role: "image-specialist",
    keywords: [
      "圖片",
      "圖像",
      "照片",
      "畫",
      "繪製",
      "修圖",
      "圖片編輯",
      "去背",
      "放大圖片",
      "圖片風格",
      "image",
      "picture",
      "photo",
      "draw",
      "edit image",
      "upscale",
      "remove background",
      "img2img",
      "inpainting",
    ],
    rationale: "user wants image generation or editing assistance",
  },
  // Video Specialist: video generation and editing tasks
  {
    role: "video-specialist",
    keywords: [
      "影片",
      "視頻",
      "影像",
      "動畫",
      "剪輯",
      "影片編輯",
      "影片增強",
      "影片風格",
      "video",
      "animation",
      "clip",
      "video editing",
      "enhance video",
      "i2v",
      "v2v",
      "video style",
    ],
    rationale: "user wants video generation or editing assistance",
  },
  // Music Specialist: music and audio generation tasks
  {
    role: "music-specialist",
    keywords: [
      "音樂",
      "歌曲",
      "配樂",
      "背景音樂",
      "作曲",
      "音效",
      // 注意：「聲音」由 voice-specialist 擁有，這裡不重複，避免「voice
      // cloning 我的聲音」誤路由到 music-specialist。音樂相關訊號改用更
      // 具體的「音樂」「歌曲」「配樂」捕捉，覆蓋率夠。
      "混音",
      "music",
      "song",
      "soundtrack",
      "background music",
      "compose",
      "sound effect",
      "audio mix",
      "stems",
    ],
    rationale: "user wants music or audio generation assistance",
  },
  // Voice Specialist: voice cloning and dubbing tasks
  {
    role: "voice-specialist",
    keywords: [
      "配音",
      "聲音",
      "語音",
      "旁白",
      "聲音克隆",
      "變聲",
      "口播",
      "語音生成",
      "voice",
      "voiceover",
      "narration",
      "voice cloning",
      "voice change",
      "tts",
      "text to speech",
      "dubbing",
    ],
    rationale: "user wants voice generation or cloning assistance",
  },
  // Training Specialist: model training and LoRA tasks
  {
    role: "training-specialist",
    keywords: [
      "訓練",
      "訓練模型",
      "fine-tune",
      "lora",
      "模型訓練",
      "客製化模型",
      "訓練角色",
      "train",
      "training",
      "fine-tuning",
      "custom model",
      "model training",
      "character training",
    ],
    rationale: "user wants model training or LoRA creation assistance",
  },
  // Learning Specialist: learning and tutorial guidance
  {
    role: "learning-specialist",
    keywords: [
      "教學",
      "學習",
      "教程",
      "怎麼用",
      "如何使用",
      "教我",
      "指導",
      "新手",
      "入門",
      "tutorial",
      "learn",
      "how to",
      "teach me",
      "guide",
      "beginner",
      "getting started",
    ],
    rationale: "user wants learning or tutorial guidance",
  },
  // Researcher: gather / look-up before acting.
  {
    role: "researcher",
    keywords: [
      "查",
      "搜尋",
      "找一下",
      "資料",
      "參考",
      "比較",
      "差別",
      "推薦哪個",
      "推薦哪幾個",
      "差在哪",
      "search",
      "look up",
      "compare",
      "what's the difference",
      "research",
    ],
    rationale: "user wants to look up / compare before deciding",
  },
  // Critic: review / improve / fix-up.
  {
    role: "critic",
    keywords: [
      "幫我改",
      "幫我修",
      "怎麼改",
      "改進",
      "優化",
      "再好一點",
      "review",
      "critique",
      "improve",
      "polish",
      "refine",
      "fix this",
    ],
    rationale: "user wants the orb to review / refine existing work",
  },
  // Navigator: take me somewhere.
  {
    role: "navigator",
    keywords: [
      "帶我去",
      "去到",
      "跳到",
      "幫我打開",
      "幫我找到",
      "in哪裡",
      "在哪裡",
      "從哪裡",
      "open",
      "go to",
      "take me to",
      "navigate to",
    ],
    rationale: "user wants to be taken to a specific page",
  },
  // Accountant (財財): cost / budget / usage / pricing intents.
  // 財財 是「主動全站成本控制」精算師，被叫到時要把花費 / 額度 / 訂閱 / 模型成本講清楚。
  {
    role: "accountant",
    keywords: [
      "預算",
      "成本",
      "費用",
      "花費",
      "花了多少",
      "貴不貴",
      "會花",
      "額度",
      "用量",
      "用了多少",
      "訂閱",
      "扣多少",
      "扣多少點",
      "點數",
      "餘額",
      "便宜一點",
      "省一點",
      "省錢",
      "比較便宜",
      "cost",
      "budget",
      "pricing",
      "spend",
      "spent",
      "usage",
      "quota",
      "credits",
      "cheaper",
      "save money",
    ],
    rationale: "user asked about cost / budget / usage — call 財財",
  },
  // Quality Coach (巧巧): prompt engineering / output quality / iteration coach.
  // 巧巧 是「主動」型 — 看到爛 prompt 或低品質結果會主動跳出來說「這樣寫更好喔」。
  {
    role: "quality-coach",
    keywords: [
      "提示詞",
      "prompt",
      "提示語",
      "怎麼下提示",
      "怎麼寫 prompt",
      "怎麼寫提示",
      "品質不好",
      "畫面糊",
      "模糊",
      "細節差",
      "看起來怪",
      "這張不行",
      "再好一點",
      "提示詞範例",
      "提示詞模板",
      "improve prompt",
      "better prompt",
      "prompt engineering",
      "low quality",
      "blurry",
      "looks weird",
    ],
    rationale: "user asked about prompt / quality coaching — call 巧巧",
  },
  // Inspector (守守): site patrol — broken links, accessibility, slow pages, missing assets.
  // 守守 是「主動」型 — 巡邏全站，發現問題就主動報告。
  {
    role: "inspector",
    keywords: [
      "壞掉",
      "壞了",
      "怪怪的",
      "卡住",
      "錯誤",
      "404",
      "500",
      "找不到",
      "失敗",
      "異常",
      "回報問題",
      "回報 bug",
      "回報bug",
      "壞掉的連結",
      "無障礙",
      "accessibility",
      "broken",
      "error",
      "bug",
      "report issue",
      "site issue",
      "site health",
    ],
    rationale: "user reported a site issue / broken behaviour — call 守守",
  },
];

const COMPOSER_ON_STUDIO_HINTS = [
  "生成",
  "送出",
  "做這張",
  "做這個",
  "再來一張",
  "下一張",
  "再生成",
  "submit",
  "generate",
  "render",
];

function lowerOnce(s: string): string {
  return (s ?? "").toLowerCase();
}

function matchesAny(haystack: string, keywords: readonly string[]): boolean {
  for (const k of keywords) {
    if (haystack.includes(k.toLowerCase())) return true;
  }
  return false;
}

/**
 * Pick the most-likely role for the current turn. Order of precedence:
 *   1. director  — explicit multi-step / cross-page intent
 *   2. researcher — explicit lookup / compare intent
 *   3. critic    — explicit review / refine intent
 *   4. navigator — explicit "take me to X" intent
 *   5. composer  — short message + on a studio page that supports execution
 *   6. companion — fallback, open conversation
 *
 * Confidence reflects how strong the keyword evidence is; the chat router
 * can fold this into its decision to actually invoke the role's prompt
 * slice (e.g., only switch when confidence > 0.5).
 */
// 教學意圖必須優先於 domain — 「教我怎麼做影片」是「想學」而不是
// 「想做」，所以遇到這些 strong 教學詞時 learning-specialist 應該蓋掉
// image / video / music / voice 的 domain 路由。只列高訊號詞避免誤判
// 一般「我要學一下這個」之類的閒聊。
const LEARNING_OVERRIDE_HINTS: readonly string[] = [
  "教我",
  "教學",
  "教程",
  "如何使用",
  "怎麼用",
  "怎麼開始",
  "新手",
  "入門",
  "tutorial",
  "how to",
  "teach me",
  "getting started",
];

// 品質抱怨意圖必須優先於 domain — 「畫面糊，怎麼改 prompt 比較好」是
// 「對結果不滿意」而不是「想做新一張圖」。沒有這層 override，
// image-specialist 的 「畫」 就會 substring-match 到 「畫面」 而搶走
// quality-coach 該接的回合。只列強訊號詞避免誤判 「我畫不好」 這種
// 想學圖法的用戶（那是 learning）。
const QUALITY_OVERRIDE_HINTS: readonly string[] = [
  "畫面糊",
  "畫面模糊",
  "細節差",
  "細節糊",
  "看起來怪",
  "看起來奇怪",
  "這張不行",
  "這張糊",
  "品質不好",
  "品質差",
  "品質很差",
  "blurry",
  "low quality",
  "looks weird",
];

/**
 * Friendly nicknames that map to a specific AgentRole. Lets users address
 * a specific 「精靈」 directly with `@阿圖 ...` / `@老導 ...` syntax;
 * the server then routes to that role with high confidence regardless of
 * domain keywords. Kept in sync with `SPIRITS` in client/src/pages/AgentChat.tsx.
 *
 * The `@` prefix is preferred but optional — bare nicknames at the start
 * of an utterance also match, since users mid-conversation often drop the @.
 */
// 15 位精靈的暱稱清單（6 通用 + 6 專精 + 3 主動）。用「疊字 + emoji 風」
// 的可愛正面名字；前一輪用過的偏老或偏嚴肅的名字（老導 / 嚴選 /
// 研哥 / 學長…）已全部換成疊字。`nicknames` 第一個是首選暱稱
// (getPrimaryNicknameForRole 會回這個)，剩下是別名 / 舊名以維持向後相容。
const SPIRIT_NICKNAMES: ReadonlyArray<{ role: AgentRole; nicknames: readonly string[] }> = [
  { role: "image-specialist",    nicknames: ["圖圖", "阿圖", "圖像精靈"] },
  { role: "video-specialist",    nicknames: ["影影", "阿影", "小影", "影像精靈"] },
  { role: "music-specialist",    nicknames: ["音音", "哼哼", "小音", "音樂精靈"] },
  { role: "voice-specialist",    nicknames: ["聲聲", "麥麥", "小聲", "語音精靈"] },
  { role: "training-specialist", nicknames: ["練練", "阿訓", "訓練精靈"] },
  { role: "learning-specialist", nicknames: ["學學", "學長", "學習精靈"] },
  { role: "director",            nicknames: ["導導", "老導", "導演"] },
  { role: "composer",            nicknames: ["編編", "編排"] },
  { role: "critic",              nicknames: ["品品", "嚴選", "評審"] },
  { role: "researcher",          nicknames: ["查查", "研哥", "研究員"] },
  { role: "navigator",           nicknames: ["路路", "領航", "導航員"] },
  { role: "companion",           nicknames: ["暖暖", "陪伴員"] },
  { role: "accountant",          nicknames: ["財財", "精算師"] },
  { role: "quality-coach",       nicknames: ["巧巧", "品質教練", "提示詞教練"] },
  { role: "inspector",           nicknames: ["守守", "糾察隊", "巡邏員"] },
];

/**
 * Scan text for an explicit spirit address — `@暱稱 …` anywhere, or a
 * bare nickname at the start. Lower-case match isn't useful for CJK names,
 * so we search the raw text. Exported so client-side composers can decide
 * whether to auto-prepend a pinned spirit's @ tag (i.e. "is the user already
 * addressing a spirit?"); when null is returned, no spirit was named.
 */
export function detectSpiritMention(text: string): AgentRole | null {
  for (const entry of SPIRIT_NICKNAMES) {
    for (const name of entry.nicknames) {
      if (text.includes(`@${name}`) || text.startsWith(name)) {
        return entry.role;
      }
    }
  }
  return null;
}

/** Convenience: true iff the text already addresses any known spirit. */
export function hasSpiritMention(text: string): boolean {
  return detectSpiritMention(text) !== null;
}

/**
 * Primary nickname (the first entry in SPIRIT_NICKNAMES) for a role — used
 * by client composers that want to auto-prepend `@nickname ` when a pinned
 * spirit is active. Falls back to "暖暖" if an unknown role is passed in.
 */
export function getPrimaryNicknameForRole(role: AgentRole): string {
  const entry = SPIRIT_NICKNAMES.find(e => e.role === role);
  return entry?.nicknames[0] ?? "暖暖";
}

/**
 * 「家族」分類 — 跟 client 端 spiritsVisual.SpiritFamily 對齊。放到 shared
 * 是為了讓 server 在多代理討論時也能照家族過濾（例如「只讓 6 位專精精靈
 * 互相討論」），不必把客戶端的視覺檔案抓進 server bundle。
 *   - specialist：6 位專精同事（圖、影、音、聲、訓、學）
 *   - role      ：6 位通用工作流夥伴（導、編、品、查、路、暖）
 *   - proactive ：3 位主動出擊（財財 / 巧巧 / 守守）
 */
export type SpiritFamily = "specialist" | "role" | "proactive";

export const SPIRIT_FAMILY: Record<AgentRole, SpiritFamily> = {
  director: "role",
  composer: "role",
  critic: "role",
  researcher: "role",
  navigator: "role",
  companion: "role",
  accountant: "proactive",
  "quality-coach": "proactive",
  inspector: "proactive",
  "image-specialist": "specialist",
  "video-specialist": "specialist",
  "music-specialist": "specialist",
  "voice-specialist": "specialist",
  "training-specialist": "specialist",
  "learning-specialist": "specialist",
};

export function getFamilyForRole(role: AgentRole): SpiritFamily {
  return SPIRIT_FAMILY[role] ?? "role";
}

/**
 * Returns every AgentRole assigned to a given family. Server-side helpers
 * in the discussion runner use this to expand a "family scope" pick into
 * its concrete role allowlist without having to know the client visual
 * config. Order matches SPIRIT_FAMILY declaration above (stable for tests).
 */
export function getRolesByFamily(family: SpiritFamily): AgentRole[] {
  return (Object.entries(SPIRIT_FAMILY) as Array<[AgentRole, SpiritFamily]>)
    .filter(([, f]) => f === family)
    .map(([role]) => role);
}

export function selectRoleForIntent(input: RoleSelectionInput): RoleSelection {
  const rawText = (input.text ?? "").trim();
  const text = lowerOnce(input.text);
  if (!rawText) {
    return {
      role: "companion",
      confidence: 0.2,
      rationale: "empty utterance — fall back to companion",
    };
  }

  // Override 0：使用者直接 @ 點名某位精靈，無條件交給他。
  // `@阿圖 …` / `@老導 …` / 開頭就喊「阿圖 …」都算。
  const mentioned = detectSpiritMention(rawText);
  if (mentioned) {
    return {
      role: mentioned,
      confidence: 0.95,
      rationale: `user explicitly addressed @${mentioned}`,
    };
  }

  // 找出 director rule 用來偵測「使用者要的是規劃，而不是學習」的反訊號。
  // 「幫我做一支教學影片，從規劃到輸出」雖然有「教學」也應落在 director，
  // 因為使用者是在請求 multi-step plan 而非請我教他。
  const directorRule = KEYWORD_RULES.find(r => r.role === "director");
  const isDirectorIntent = directorRule
    ? matchesAny(text, directorRule.keywords)
    : false;

  // 使用者偏好：mutedRoles 會跳過該角色規則。從 agent-preferences 讀進來，
  // 預設空陣列。@nickname 強指定不受 mute 影響（使用者明示叫某位優先）。
  const muted = new Set<AgentRole>(input.mutedRoles ?? []);
  const isMuted = (role: AgentRole) => muted.has(role);

  // Override 1：強教學訊號優先。沒有這個 guard，「教我怎麼做影片」會
  // 被 video-specialist 的「影片」搶走而失去教學語氣。但若 director 規則
  // 也命中，視為「規劃裡含教學產物」，仍交給 director。
  if (!isDirectorIntent && !isMuted("learning-specialist") && matchesAny(text, LEARNING_OVERRIDE_HINTS)) {
    return {
      role: "learning-specialist",
      confidence: 0.85,
      rationale: "user explicitly asked to be taught (LEARNING_OVERRIDE_HINTS)",
    };
  }

  // Override 2：強品質抱怨訊號優先。「畫面糊」「品質很差」「looks weird」
  // 都是對既有結果不滿意，應該交給巧巧 (quality-coach) 給改寫建議；
  // 沒這個 guard 會被 image-specialist 的單字「畫」substring 搶走。
  if (!isDirectorIntent && !isMuted("quality-coach") && matchesAny(text, QUALITY_OVERRIDE_HINTS)) {
    return {
      role: "quality-coach",
      confidence: 0.85,
      rationale: "user complained about output quality (QUALITY_OVERRIDE_HINTS)",
    };
  }

  for (const rule of KEYWORD_RULES) {
    if (isMuted(rule.role)) continue;
    if (matchesAny(text, rule.keywords)) {
      return { role: rule.role, confidence: 0.85, rationale: rule.rationale };
    }
  }

  // Composer: short imperative + we're already on a studio page.
  const onStudioPage =
    !!input.snapshot && /studio|director|focus-flow/.test(input.snapshot.pagePath);
  if (onStudioPage && text.length < 40 && matchesAny(text, COMPOSER_ON_STUDIO_HINTS)) {
    return {
      role: "composer",
      confidence: 0.7,
      rationale: "short imperative on a studio page → execute, don't re-plan",
    };
  }

  // Long message + studio page → composer with lower confidence; the
  // user is likely describing what to fill in.
  if (onStudioPage && text.length >= 40 && text.length <= 240) {
    return {
      role: "composer",
      confidence: 0.55,
      rationale: "concrete, on-page request → execute on the current studio",
    };
  }

  return {
    role: "companion",
    confidence: 0.3,
    rationale: "no explicit signal; default to open conversation",
  };
}

/**
 * Returns the system-prompt slice for a role. Caller appends this AFTER
 * the personality block so the role guidance overrides nothing but
 * narrows behaviour for THIS turn.
 *
 * Each slice is an **operational brief**, not just a vibe sketch:
 *   - one-line identity + opening question pattern
 *   - real model / tool names from the registries (no made-up IDs)
 *   - explicit handoff payload schema for the next spirit in chain
 *   - 1-2 known failure modes + concrete workaround
 * Keep each role under ~10 lines so the LLM still has budget for the
 * user's actual message — density over prose.
 */
export function getRoleSystemPromptSlice(role: AgentRole): string {
  // 共用語氣：全部 15 位精靈以「同事 / 好朋友」的口吻說話 — 不是僵硬的
  // AI agent。第一人稱會用暱稱自稱（圖圖、導導…），結尾會自然地問下一步，
  // 而不是條列一堆 spec。每段刻意短，把空間留給實質回答。
  switch (role) {
    case "director":
      return [
        "【本回合扮演：導導（導演 director）】",
        "你是團隊裡的導導：好朋友的口氣，先問清楚最終想交付的東西，再把事情拆成跨頁面的工作流程。",
        "標準步驟：① 用一句話複述目標（含交付物 + 平台 + 截止）。② 列 3-5 步「步驟｜目的｜會去的頁｜接手精靈」。③ 標出哪幾步要花錢，請使用者確認預算。",
        "可呼叫：director.suggestPlan（出計畫）→ runWorkflow（依序跑）。每步明示交給誰：圖圖（/image-studio）→ 影影（/video-studio）→ 聲聲/音音（/pro-studio）→ 品品收尾。",
        "交棒攜帶：① 任務目標一句話 ② 上一步的產出 URL/ID ③ 下一步要的具體輸出規格（aspect、長度、格式）。",
        "地雷：別只丟一個 navigate 就消失；別跳過財財估算就跑 >2 個付費步驟。",
      ].join("\n");
    case "composer":
      return [
        "【本回合扮演：編編（編排 composer）】",
        "你是已經跟著使用者進工作室的同事：話很短，動作很多。",
        "看當頁 capabilities 直接 dispatch：fillPrompt → setModel → setParam（aspect/length/seed）→ submit。每按一個用一句話說「我幫你按了 X」。",
        "送出前一定確認三件事：模型名稱（用真實 ID，例如 fal-ai/flux-pro/v1.1）、長寬比、預估點數；少一項就先反問。",
        "做完交棒：① 留下生成的 URL/asset id ② 一句話評價（光線/構圖/節奏）③ 主動問「要請品品看一輪、還是直接再來一張？」",
        "地雷：別重規劃跨頁流程，除非他明確說「我們去別頁」；別猜參數，沒把握就用該頁 default 並寫明。",
      ].join("\n");
    case "critic":
      return [
        "【本回合扮演：品品（評審 critic）】",
        "你是溫柔的同事品品：看完作品 / 計畫，先說兩個亮點，再點出最多 3 個「最有效改一改的地方」，每個都附「會怎麼改」。",
        "用具體可貼的句式：「把 ___ 換成 ___」、「aspect 從 1:1 改 9:16」、「prompt 加上 ___, ___」— 不要抽象「再優化一下」。",
        "依模態給不同框架：① 圖：構圖 / 主體清晰度 / 光影。② 影：節奏 / 鏡頭穩定 / 對嘴。③ 音：情緒匹配 / 動態範圍 / loop 銜接。④ 文：開場鉤子 / 段落節奏 / CTA。",
        "交棒：使用者挑了改進點 → 交給編編套用；如果是 prompt 寫法問題 → 交給巧巧改寫。",
        "保持邀請式語氣，最後問「想先改哪個？」",
      ].join("\n");
    case "researcher":
      return [
        "【本回合扮演：查查（研究員 researcher）】",
        "你是會幫朋友查資料的同事查查：先列 3 個事實欄位（差別 / 價位 / 適用情境），再給 1-2 個你個人推薦並說為什麼。",
        "可呼叫：research.deepSearch（外網查證）、inspiration.fetch（站內素材）。回答時帶上 1-3 條來源（網址或站內位置）。",
        "比較模型時用站內 registry：圖（FLUX Pro 1.1 寫實 / SeeDream v4 東方插畫 / Imagen 4 品牌乾淨 / FLUX Schnell 草稿快）；影（Kling 2.1 Pro 電影感 / PixVerse v4.5 特效 / Wan 2.1 開源 CP 高 / Runway Gen4 Turbo 商業 5-10s）；音（Suno V4 歌曲 / Stable Audio 環境 / ElevenLabs Music 配樂）；聲（ElevenLabs eleven-v3 中文 / Multilingual 多語）。",
        "不要直接執行動作；查完讓使用者自己決定下一步，最後問一句「你比較在意 ___ 還是 ___？」",
        "如果比較裡付費差距明顯 → 順手 ping 財財估算後交回。",
      ].join("\n");
    case "navigator":
      return [
        "【本回合扮演：路路（導航 navigator）】",
        "你是只負責帶路的同事路路：一個 navigate 動作完成，外加一句「到了那邊可以 ___」說明接手能做什麼。",
        "常見對應：「想出圖」→ /image-studio（圖圖在那）；「做影片」→ /video-studio（影影）；「配音/音樂」→ /pro-studio（聲聲/音音）；「練 LoRA」→ /models（練練）；「看花費」→ /dashboard（財財）；「教程」→ /learn（學學）。",
        "送出 navigate 後，主動把使用者交給該頁的精靈 — 用「到了 X，{暱稱} 接手帶你完成」收尾。",
        "地雷：別展開跨頁工作流（那是導導的事）；別猜目的地，模糊時反問「想做哪一類？圖、影、音、文、訓練？」",
      ].join("\n");
    case "companion":
      return [
        "【本回合扮演：暖暖（陪伴 companion）】",
        "你是好朋友暖暖：對方還沒想好就慢慢陪聊，輕聲問「你今天主要想幹嘛？是想做東西，還是想先逛逛？」",
        "給 2-3 個「也許可以…」具體選項（例如：A. 看 30 秒 IG 預告範例 / B. 試一張角色立繪 / C. 跟學學看新手導覽），每個寫清楚會把人帶到哪。",
        "識別情緒詞（累 / 卡住 / 沒靈感 / 開心）→ 對應回應，不要照本宣科。",
        "不主動執行動作；使用者透露具體目標 → 交棒給導導排計畫；只想直接到某頁 → 交給路路。",
      ].join("\n");
    case "accountant":
      return [
        "【本回合扮演：財財（精算師 accountant）】",
        "你是團隊裡最罩的財務小幫手財財。語氣親切像家人在叮嚀錢的事 — 不囉唆、不嚇人，但一定會把錢的方向講清楚。",
        "三件事永遠主動關心：① 這次要花多少。② 本月用到哪了（佔額度 X%）。③ 有沒有更省的做法。",
        "粗估範圍（給使用者參考數量級，實際以 modelPricing 為準）：1 張圖 FLUX Pro 約 3-5 點 / Schnell 約 0.5 點；5s 影片 Kling Pro 約 80-120 點 / PixVerse 約 30-50 點 / Wan 約 15 點；30s TTS ElevenLabs 約 1-2 點；30s Suno 歌曲 約 4 點；LoRA 訓練 約 200-400 點。回答時加一句「實際以扣款為準」。",
        "省法菜單：FLUX Pro → Schnell（草稿用）；Kling Pro → Wan 2.1（預覽用）；ElevenLabs → 開源 TTS；批次出多張先用低品質試 → 鎖定後升級。",
        "不執行扣款 / 訂閱動作；只給數字、選項、提醒。最後問「要照這個方向跑，還是換我推的省法？」",
      ].join("\n");
    case "quality-coach":
      return [
        "【本回合扮演：巧巧（品質 + 提示詞教練 quality-coach）】",
        "你是團隊裡最會教提示詞的同事巧巧。看到使用者的 prompt 或產出，先肯定一個亮點再給「具體可貼進去」的改寫範例。",
        "改寫公式：主體 + 動作/姿態 + 場景 + 光線 + 風格 + 鏡頭/構圖 + 質感詞。每次只動 1-2 個維度。",
        "示範對照（給使用者照樣造句）：① 「一隻貓」→ 「一隻橘貓側臥窗台，午後逆光，35mm 淺景深，水彩插畫風」② 「做支廣告」→ 「30 秒產品 teaser，主鏡頭 1.5 秒切點，9:16，霓虹光感，結尾留 CTA 1 秒」。",
        "結果不理想時主動診斷三件事：構圖 / 細節 / 風格哪個最值得改，並附上一段可直接送出的新 prompt。",
        "口吻像鼓勵型教練：「這次抓對方向了，下一輪我們再 ___」最後問「要試這版改寫嗎？」改寫好的 prompt 接給編編套用。",
      ].join("\n");
    case "inspector":
      return [
        "【本回合扮演：守守（全站糾察隊 inspector）】",
        "你是巡邏全站的糾察隊長守守。態度像可靠的學長姐 — 把問題講清楚但不指責，馬上給可行的下一步。",
        "看到的問題分三層：① 真壞了（404 / 500 / 工具掛掉）→ 直接說怎麼繞過。② 體驗瑕疵（按鈕卡住 / 載入慢 / 文字被截）→ 提供替代路徑。③ 隱性風險（無障礙、效能、未用功能）→ 溫柔提醒，別擋路。",
        "常見繞過法庫：① 圖生成 stuck > 90s → 切 fal-ai/flux/schnell 重試。② 影片 4xx → 縮短到 5s、改 fal-ai/wan-i2v 再試。③ 登入卡住 → incognito + 清 site data。④ 上傳失敗 → 確認 < 25MB、PNG/JPG/MP4。",
        "回報句式：「我剛巡到 ___，現在你可以 ___，等修好我再叫你」。如果是使用者主動回報 bug，先複誦一次他講的，再給「現在可以這樣繞」+「我已經記下幫你回報」。",
        "永遠收尾說「我繼續巡，有事再喊我」。",
      ].join("\n");
    case "image-specialist":
      return [
        "【本回合扮演：圖圖（圖像精靈 image specialist）】",
        "你是工作室裡最熟出圖的同事：暱稱自稱「我圖圖」，講話直白但體貼。",
        "聽到需求先回一句「OK 圖的事我來，氛圍是 ___ 對嗎？」，再依語意挑模型：寫實/商業/光影 → fal-ai/flux-pro/v1.1；草稿/快迭代 → fal-ai/flux/schnell；插畫/海報/東方 → fal-ai/bytedance/seedream/v4/text-to-image；品牌/乾淨光 → fal-ai/imagen4/preview；要套 LoRA → fal-ai/stable-diffusion-v35-large。",
        "可使用 studio.generateImage / studio.generate3D 直接動手；參數先確認 aspect（1:1 / 9:16 / 16:9 / 3:4）、batch、seed（要重現就鎖 seed）。",
        "做完交棒：留下圖片 URL + 用的 prompt + 模型 ID + aspect，問「要請品品看一輪、影影做動畫版、還是練練拿去訓 LoRA？」",
        "地雷：FLUX Pro 不要用「快草稿」；要重複出同一角色一定要鎖 seed 或先去練 LoRA。",
      ].join("\n");
    case "video-specialist":
      return [
        "【本回合扮演：影影（影像精靈 video specialist）】",
        "你是影片組的影影：先確認三件事 — 幾秒？直橫？要不要對嘴？",
        "依語意挑模型：電影感/運鏡 → fal-ai/kling-video/v2.1/pro/image-to-video；首尾幀 → fal-ai/kling-video/v2.1/standard/image-to-video；商業 5/10s teaser → fal-ai/runway-gen4-turbo/image-to-video；特效/動漫 → fal-ai/pixverse/v4.5/image-to-video；高 CP 草稿 → fal-ai/wan-i2v；首幀固定電影感 → fal-ai/minimax/hailuo-02/pro/image-to-video；可重現流程 → fal-ai/ltx-video/image-to-video。",
        "可使用 studio.generateVideo / studio.enhanceVideo / studio.animateSpeaker。預設 aspect 9:16（社群）或 16:9（橫式），長度 5s 起跳。",
        "做完交棒：① 帶上影片 URL + 模型 ID + 秒數 + aspect。② 問「要不要請聲聲配旁白、音音配 BGM？」③ 全部到位後請品品收一輪。",
        "地雷：超過 10s 用 Kling Pro 會貴很多 — 先跟財財確認；對嘴必須先有人聲 → 沒有的話先 ping 聲聲。",
      ].join("\n");
    case "music-specialist":
      return [
        "【本回合扮演：音音（音樂精靈 music specialist）】",
        "你是配樂同事音音：先問情緒（療癒？緊張？輕快？）+ 大概長度，再給 1-2 個風格方向。",
        "依需求挑模型：完整歌曲（含人聲/段落）→ suno-v4；BGM 配樂無人聲 → elevenlabs/music 或 fal/stable-audio；環境音/氛圍底 → fal/stable-audio；音效 → elevenlabs/sound-effects；可控/開源 → fal/musicgen / fal/ace-step / gemini/lyria-2。",
        "可使用 studio.generateAudio / studio.generateSfx / studio.separateStems / studio.isolateAudio / studio.mergeAudios。",
        "30 秒以內 BGM 預設 Stable Audio（便宜穩）；要 vocal 就上 Suno V4。要做 loop 提醒：在 prompt 加「seamless loop, no fade out」。",
        "做完交棒：附音檔 URL + 模型 ID + 秒數 + BPM/key（如有）；給影影合成或給品品確認情緒對位。",
      ].join("\n");
    case "voice-specialist":
      return [
        "【本回合扮演：聲聲（語音精靈 voice specialist）】",
        "你是配音 / 聲音克隆同事聲聲：先確認語言、男聲女聲、語氣（溫暖 / 冷靜 / 快節奏）、語速。",
        "依需求挑模型：中文短句/情感 → elevenlabs/eleven-v3；多語切換 → elevenlabs/multilingual-v2；克隆使用者的聲 → studio.cloneVoice + elevenlabs；TTS 草稿 → fal/kokoro 或 gemini/tts。",
        "可使用 studio.generateVoice / studio.cloneVoice / studio.designVoice / studio.changeVoice / studio.transcribe。",
        "克隆前提醒：需 30s+ 純人聲樣本、安靜背景、單一說話者；不到就先用 designVoice 設計一個。",
        "做完交棒：附音檔 URL + 模型 ID + 語言 + 語氣標籤；接給影影對嘴或音音壓 BGM 底。",
      ].join("\n");
    case "training-specialist":
      return [
        "【本回合扮演：練練（訓練精靈 training specialist）】",
        "你是訓 LoRA 的同事練練：先問「角色 / 風格 / 影片 LoRA？」「你有幾張參考圖？」",
        "資料準備重點：角色 LoRA 至少 15-20 張（多角度、多表情、不同光、避免同一姿勢重複）；風格 LoRA 30+ 張同調性作品；影片 LoRA 10-20 段同一動作 / 鏡位的短片。",
        "預設訓練參數（可依素材調）：rank=16、學習率 1e-4、step≈1500、batch=1；風格 LoRA rank 拉到 32、step 推到 2000-2500。",
        "用 studio.trainLora 開訓練；告知大約耗時（角色約 15-25 分、風格 25-40 分），並提醒「我會在訓好時叫你」。",
        "做完交棒：附 LoRA 模型 ID + 觸發詞（trigger word）；交給圖圖出第一張示範，再請品品評估資料集是否要補。",
      ].join("\n");
    case "learning-specialist":
      return [
        "【本回合扮演：學學（學習精靈 learning specialist）】",
        "你是耐心的學學：用「我們從這個開始」「先試一次看看」的引導語，不要丟一堆功能列表。",
        "依新手 / 老手切換深度：問一句「你之前用過類似工具嗎？」決定要從基礎還是進階起。",
        "教學起點地圖：圖 → /image-studio + 圖圖；影 → /video-studio + 影影；音/聲 → /pro-studio + 音音/聲聲；訓練 → /models + 練練；全站總覽 → /tutorial-overview。",
        "解答疑問時舉一個小例子（30 秒可完成的小任務），必要時用 navigate 把人帶到對的教程頁，再交給對應精靈接手。",
        "結尾問「這樣有比較清楚嗎？還是哪邊還卡？」",
      ].join("\n");
  }
}

/**
 * Each spirit has a preferred LLM provider. Routes the planner to whichever
 * model is best at that spirit's domain — e.g. multimodal-heavy specialists
 * (image / video) prefer Gemini, while chat / planning roles can fall back
 * to default LLM. The chat router passes this as `preferredProviderId` to
 * `selectProvider`; the existing fallback chain still kicks in if the
 * preferred one is unavailable, so this is purely "best-fit hint".
 *
 * Provider IDs match the catalog in server/services/providerRouter.ts.
 */
export const SPIRIT_PREFERRED_PROVIDER: Record<AgentRole, string> = {
  // Multimodal specialists — prefer Gemini for image / video / audio understanding
  "image-specialist": "gemini",
  "video-specialist": "gemini",
  "music-specialist": "gemini",
  "voice-specialist": "gemini",
  "training-specialist": "gemini",
  // Reasoning-heavy roles — director plans across pages, critic gives nuanced reviews
  director: "gemini",
  critic: "gemini",
  researcher: "gemini",
  // Cheap & fast roles — companion / navigator / composer / learning don't need top-tier
  composer: "default_llm",
  navigator: "default_llm",
  companion: "default_llm",
  "learning-specialist": "default_llm",
  // 財財：純文字、需要精確算數但不要太貴 — default_llm 即可
  accountant: "default_llm",
  // 巧巧 / 守守：判斷 prompt 品質與站台問題需要較強推理 — 用 Gemini 比較穩
  "quality-coach": "gemini",
  inspector: "gemini",
};

export function getPreferredProviderForRole(role: AgentRole): string {
  return SPIRIT_PREFERRED_PROVIDER[role] ?? "default_llm";
}

// ─── 15 精靈協作協定 (collab protocol) ──────────────────────────────────
// 這是「同事之間誰交棒給誰」的明文規則。三種來源會讀它：
//   1. AgentChat.tsx 顯示「他做完會交給誰」的 hint chip
//   2. agentCollaborationOrchestrator 真的執行 handoff 時的預設順序
//   3. 主動精靈（財財 / 巧巧 / 守守）做完自己的回合後，自動 ping 下一棒
//
// 純 data，不執行 — 真正的 handoff 仍由 orchestrator 決定要不要走。

export interface SpiritHandoff {
  /** 為什麼接這棒（一句話，會出現在 UI hint） */
  reason: string;
  /** 接手的精靈 */
  to: AgentRole;
  /** 觸發條件描述（純文字 / 給 LLM 看的 hint，不是 JS predicate） */
  when: string;
}

export interface SpiritCollabSpec {
  /** 上一棒做完通常會交給誰（最多 3 個推薦對象，依優先順序） */
  handoffs: SpiritHandoff[];
  /** 哪些角色「天然會找他幫忙」— 反向關係，給 UI 顯示同事網絡用 */
  receivedFrom: AgentRole[];
}

export const SPIRIT_COLLAB_PROTOCOL: Record<AgentRole, SpiritCollabSpec> = {
  // 通用工作流角色
  director: {
    handoffs: [
      { to: "composer", reason: "計畫拆好之後，編編在當頁套用每一步", when: "plan accepted" },
      { to: "accountant", reason: "規劃完先讓財財估算總花費再起跑", when: "plan involves >2 paid steps" },
      { to: "critic", reason: "整條 workflow 跑完後請品品看一輪整體性", when: "workflow completed" },
    ],
    receivedFrom: ["companion", "researcher", "navigator", "inspector"],
  },
  composer: {
    handoffs: [
      { to: "critic", reason: "送出後請品品挑 1-3 個改進", when: "execution finished" },
      { to: "quality-coach", reason: "如果結果不理想找巧巧改 prompt", when: "user says 不滿意 / 再試" },
    ],
    receivedFrom: ["director", "image-specialist", "video-specialist", "music-specialist", "voice-specialist", "training-specialist", "quality-coach"],
  },
  critic: {
    handoffs: [
      { to: "composer", reason: "改寫建議交給編編套到當頁", when: "user picks a critique to apply" },
      { to: "quality-coach", reason: "如果是 prompt 層問題交給巧巧", when: "critique is prompt-level" },
    ],
    receivedFrom: ["composer", "director", "image-specialist", "video-specialist", "music-specialist", "voice-specialist"],
  },
  researcher: {
    handoffs: [
      { to: "director", reason: "查完讓導導排成可執行步驟", when: "user picks a researched option" },
      { to: "accountant", reason: "比較完讓財財算成本再決定", when: "comparison includes paid options" },
    ],
    receivedFrom: ["companion", "director", "accountant"],
  },
  navigator: {
    handoffs: [
      { to: "composer", reason: "到了目標頁讓編編上場", when: "target page is a studio" },
      { to: "learning-specialist", reason: "如果是教程頁交給學學帶讀", when: "target page is /learn" },
    ],
    receivedFrom: ["companion", "director", "inspector"],
  },
  companion: {
    handoffs: [
      { to: "director", reason: "聊清楚目標後交給導導排計畫", when: "user reveals goal" },
      { to: "navigator", reason: "如果只想去某頁就交給路路", when: "user wants destination" },
    ],
    receivedFrom: [],
  },
  // 三位主動出擊
  accountant: {
    handoffs: [
      { to: "researcher", reason: "推薦更省的選項時讓查查列出對照", when: "user wants cheaper alternative" },
      { to: "composer", reason: "確認方案後讓編編切換模型", when: "user accepts cheaper switch" },
    ],
    receivedFrom: ["director", "researcher", "image-specialist", "video-specialist"],
  },
  "quality-coach": {
    handoffs: [
      { to: "composer", reason: "改寫的 prompt 交給編編送出", when: "rewrite accepted" },
      { to: "critic", reason: "新一輪結果出來請品品複看", when: "after rerun" },
    ],
    receivedFrom: ["critic", "composer", "image-specialist", "video-specialist"],
  },
  inspector: {
    handoffs: [
      { to: "navigator", reason: "找到對的繞過頁讓路路帶過去", when: "workaround exists" },
      { to: "learning-specialist", reason: "如果是使用者卡關不是 bug 交給學學", when: "user error, not site bug" },
    ],
    receivedFrom: [],
  },
  // 6 專精
  "image-specialist": {
    handoffs: [
      { to: "composer", reason: "出圖完讓編編套用到當頁", when: "image generated" },
      { to: "video-specialist", reason: "圖完成後接影影做動畫版", when: "user wants animation" },
      { to: "critic", reason: "結束讓品品挑改進處", when: "image finalised" },
    ],
    receivedFrom: ["director", "training-specialist", "quality-coach"],
  },
  "video-specialist": {
    handoffs: [
      { to: "voice-specialist", reason: "影片完成後讓聲聲配旁白", when: "video needs voiceover" },
      { to: "music-specialist", reason: "再讓音音配 BGM", when: "video needs music" },
      { to: "critic", reason: "全部就緒後品品看一輪", when: "video finalised" },
    ],
    receivedFrom: ["director", "image-specialist"],
  },
  "music-specialist": {
    handoffs: [
      { to: "video-specialist", reason: "音樂做完丟回影影合成", when: "music for video" },
      { to: "critic", reason: "成品出來讓品品聽一遍", when: "music finalised" },
    ],
    receivedFrom: ["director", "video-specialist"],
  },
  "voice-specialist": {
    handoffs: [
      { to: "video-specialist", reason: "配音做完接回影影對嘴 / 合成", when: "voice for video" },
      { to: "music-specialist", reason: "再讓音音混底", when: "voice needs music bed" },
    ],
    receivedFrom: ["director", "video-specialist"],
  },
  "training-specialist": {
    handoffs: [
      { to: "image-specialist", reason: "LoRA 訓好交給圖圖出第一張示範", when: "lora ready" },
      { to: "critic", reason: "示範圖出來請品品評估資料集", when: "first results in" },
    ],
    receivedFrom: ["director"],
  },
  "learning-specialist": {
    handoffs: [
      { to: "navigator", reason: "教完帶使用者去實作頁", when: "user ready to try" },
      { to: "companion", reason: "如果還沒準備好交給暖暖陪聊", when: "user hesitant" },
    ],
    receivedFrom: ["companion", "navigator", "inspector"],
  },
};

// ─── 主動觸發條件 (proactive triggers) ──────────────────────────────────
// 三位「主動出擊型」精靈的事件 spec — 還沒有 runtime event bus 在跑，這份
// 是給未來 ProactiveEventBus 看的 schema：什麼條件下，誰應該主動冒出來。
// 三項都是「軟提示」— 顯示成 toast / 內聯小卡，不會自動執行任何動作。

export type ProactiveTriggerEvent =
  | "monthly_spend_threshold"   // 本月用量超過某 % 額度
  | "expensive_op_about_to_run" // 即將跑高成本任務
  | "low_quality_generation"    // 偵測到生成結果品質低
  | "prompt_too_short"          // 偵測到使用者 prompt 過於模糊
  | "site_error_detected"       // 全站出現 4xx / 5xx / 工具掛掉
  | "page_perf_bad"             // 某頁載入過慢 / TTI 超標
  | "feature_not_used";         // 使用者長期沒用到某功能（升級時機）

export interface ProactiveTriggerSpec {
  /** 哪位精靈該被叫醒 */
  spirit: AgentRole;
  /** 事件 id（用於 ProactiveEventBus subscribe） */
  event: ProactiveTriggerEvent;
  /** 預設文案（會被該精靈的 system prompt 加工後輸出，不直接顯示） */
  defaultPrompt: string;
  /** 提醒類型 — 影響 UI 視覺（toast / inline card / blocking dialog） */
  surface: "toast" | "inline" | "blocking";
}

export const SPIRIT_PROACTIVE_TRIGGERS: ReadonlyArray<ProactiveTriggerSpec> = [
  {
    spirit: "accountant",
    event: "monthly_spend_threshold",
    defaultPrompt: "本月已用 {usedPct}%，剩 {remainingCredits} 點。最近花最多的是 {topModel}。要不要我列幾個更省的替代方案？",
    surface: "inline",
  },
  {
    spirit: "accountant",
    event: "expensive_op_about_to_run",
    defaultPrompt: "這個動作大概會花 {predicted} 點（本月剩餘的 {pctOfRemaining}%）。要照這個方向跑，還是換我推的省法？",
    surface: "blocking",
  },
  {
    spirit: "quality-coach",
    event: "low_quality_generation",
    defaultPrompt: "我看了你最後 {n} 張，主要問題是 {issue}。試這個改寫：「{rewrittenPrompt}」要直接送嗎？",
    surface: "inline",
  },
  {
    spirit: "quality-coach",
    event: "prompt_too_short",
    defaultPrompt: "這個 prompt 有點短，加上「{suggestedAddition}」結果會穩很多。要套用嗎？",
    surface: "toast",
  },
  {
    spirit: "inspector",
    event: "site_error_detected",
    defaultPrompt: "我巡到 {endpoint} 出了 {errorCode}，現在你可以 {workaround}，我已經記下來幫你回報。",
    surface: "toast",
  },
  {
    spirit: "inspector",
    event: "page_perf_bad",
    defaultPrompt: "這頁載入比平常慢（TTI {tti}ms），要我帶你去輕量版的 {alternativePage} 嗎？",
    surface: "toast",
  },
  {
    spirit: "inspector",
    event: "feature_not_used",
    defaultPrompt: "你的方案有 {featureName} 沒用到，幫你看一下要怎麼接上去？",
    surface: "toast",
  },
];

/**
 * For multi-step intents, return the sequence of roles the orb should
 * play in order. Used by chat routers that surface "我接下來會這樣陪你"
 * preview cards — purely advisory; the actual planner still owns step
 * generation.
 */
export function composeRoleChain(input: RoleSelectionInput): AgentRole[] {
  const head = selectRoleForIntent(input);
  switch (head.role) {
    case "director":
      // Director typically delegates to composer once each downstream
      // page is reached; critic optionally reviews before final ship.
      return ["director", "composer", "critic"];
    case "researcher":
      return ["researcher", "director", "composer"];
    case "critic":
      return ["critic", "composer"];
    case "navigator":
      return ["navigator"];
    case "composer":
      return ["composer"];
    case "companion":
      return ["companion"];
    case "image-specialist":
    case "video-specialist":
    case "music-specialist":
    case "voice-specialist":
      // Domain specialists hand off to composer for execution and end
      // with critic so the user gets one round of refinement on the
      // generated asset.
      return [head.role, "composer", "critic"];
    case "training-specialist":
      // Training is execution-heavy on a single page (lora-trainer);
      // skip the upfront director planning and end with critic to
      // suggest dataset refinements.
      return [head.role, "composer", "critic"];
    case "learning-specialist":
      // Learning chain stays advisory — navigator pulls the user to the
      // right tutorial, critic offers a debrief once they've explored.
      return [head.role, "navigator"];
    case "accountant":
      // 財財 通常單槍匹馬把帳算清楚；如果使用者後續要做更省的選擇，
      // 才會交棒給 director 重新規劃。
      return ["accountant"];
    case "quality-coach":
      // 巧巧 給完改寫建議後，自然交給 composer 套用 → critic 複看一輪。
      return ["quality-coach", "composer", "critic"];
    case "inspector":
      // 守守 巡到問題，把使用者帶到對的頁面 / 工具 — 通常以 navigator 收尾。
      return ["inspector", "navigator"];
  }
}

// ─── 路徑 → 該頁主責精靈 ─────────────────────────────────────────────
// 跨頁跳轉的 follow-up 文案要由「目的地頁面當家的精靈」說話 — 這份地圖
// 把 path prefix 對到對應的 AgentRole，避免每個 caller 自己 if/else 判斷。
// 順序很重要：較長的前綴排前面（/agent vs /agent/notes 之類），第一個命中
// 即返回。沒命中就返回 null，讓 caller 走預設的 companion / navigator。
const PATH_SPIRIT_MAP: ReadonlyArray<{
  prefix: string;
  role: AgentRole;
}> = [
  { prefix: "/image-studio", role: "image-specialist" },
  { prefix: "/video-studio", role: "video-specialist" },
  { prefix: "/pro-studio", role: "music-specialist" },
  { prefix: "/director", role: "director" },
  { prefix: "/models", role: "training-specialist" },
  { prefix: "/learn", role: "learning-specialist" },
  { prefix: "/tutorial-overview", role: "learning-specialist" },
  { prefix: "/dashboard", role: "accountant" },
  { prefix: "/credits", role: "accountant" },
  { prefix: "/notes", role: "researcher" },
  { prefix: "/assets", role: "researcher" },
];

/**
 * 給定目標路徑，回傳該頁面當家的精靈角色。沒有匹配時回 null —
 * caller 通常會 fallback 到 companion / navigator 的口吻。
 */
export function pickArrivalSpiritForPath(path: string): AgentRole | null {
  if (!path) return null;
  for (const entry of PATH_SPIRIT_MAP) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      return entry.role;
    }
  }
  return null;
}

/**
 * 跨頁跳轉後的「自動續話」文案 — 由目的地頁的精靈用第一人稱接手，避免使用者
 * 看到光球說「我帶你過去了」之後一片靜默。intent 是使用者剛剛輸入的需求摘要
 * （從 navigate 動作的 intentSummary 帶入），讓銜接話語有上下文。
 *
 * 設計原則：
 *   1. 第一句明確由「<暱稱> 接手」破題 — 等於告訴使用者「換人說話了」
 *   2. 第二句是該精靈專業領域的 1-2 個具體下一步問題 — 避免空洞的「你想做什麼？」
 *   3. 全段控制在 80 字內 — 太長會讓使用者覺得沒有真的在「接手」
 */
export function buildArrivalFollowUpText(
  role: AgentRole,
  intentSummary?: string | null,
): string {
  const intentTail = intentSummary && intentSummary.trim().length > 0
    ? `（剛剛聽你說：${intentSummary.slice(0, 40)}）`
    : "";
  switch (role) {
    case "image-specialist":
      return `圖圖接手 🎨 我們到圖片創作室了～${intentTail}你想要寫實風、夢幻插畫、還是療癒水彩？或者直接給我一句話描述畫面，我幫你套提示詞。`;
    case "video-specialist":
      return `影影接手 🎬 影片組到了～${intentTail}先告訴我兩件事：要幾秒？直式（IG/抖音）還橫式（YouTube）？我馬上幫你挑模型。`;
    case "music-specialist":
      return `音音接手 🎵 音樂室到了～${intentTail}你想要什麼情緒（療癒？輕快？緊張？）大概多長？我先給你 1-2 個風格方向。`;
    case "voice-specialist":
      return `聲聲接手 🎙️ 配音間到了～${intentTail}語言、男聲女聲、語氣（溫暖／冷靜／快節奏）告訴我，30 秒內就能聽到 demo。`;
    case "training-specialist":
      return `練練接手 🧪 訓練室到了～${intentTail}你想訓角色、風格、還是影片 LoRA？把參考素材丟上來，我先估時間。`;
    case "learning-specialist":
      return `學學接手 📚 ${intentTail}從哪裡開始？你之前用過類似工具嗎？我可以從基礎或進階起，挑一句最想搞懂的問我。`;
    case "director":
      return `導導接手 🎯 ${intentTail}先說最終想交付什麼（一支影片？一張海報？一首 30 秒 BGM？），我幫你拆成跨頁工作流。`;
    case "accountant":
      return `財財接手 💰 ${intentTail}本月的點數狀況我先幫你抓出來——想看「整月用掉多少」、「下一筆會花多少」、還是「有沒有省的招」？`;
    case "researcher":
      return `查查接手 🧭 ${intentTail}你想找什麼？站內素材、模型比較、還是教學筆記？告訴我關鍵字，我幫你列差別 + 推薦。`;
    case "navigator":
      return `路路接手 🧳 我們到了～${intentTail}下一步是要動手做、看範例、還是先逛逛功能？`;
    case "companion":
      return `暖暖在這 🌿 ${intentTail}慢慢說就好。想做東西、想先逛逛、還是只是來透氣？哪一個都可以。`;
    case "composer":
      return `編編接手 ✍️ ${intentTail}你已經在工作室了，告訴我要填什麼、要選哪個模型，我直接幫你按下去。`;
    case "critic":
      return `品品接手 🔎 ${intentTail}把作品或計畫貼過來，我給你 2 個亮點 + 最多 3 個改了會更好的點。`;
    case "quality-coach":
      return `巧巧接手 ✨ ${intentTail}把你的 prompt 或結果丟過來，我給可以直接複製貼上的改寫範例。`;
    case "inspector":
      return `守守接手 🛡️ ${intentTail}哪裡卡住？我幫你看是真的壞掉、體驗瑕疵、還是有更順的繞法。`;
  }
}

/** Render a role chain into a 1-2 sentence preview for the orb's reply. */
export function summarizeRoleChainForPrompt(chain: AgentRole[]): string {
  if (chain.length === 0) return "";
  const labels: Record<AgentRole, string> = {
    director: "導導",
    composer: "編編",
    critic: "品品",
    researcher: "查查",
    navigator: "路路",
    companion: "暖暖",
    accountant: "財財",
    "quality-coach": "巧巧",
    inspector: "守守",
    "image-specialist": "圖圖",
    "video-specialist": "影影",
    "music-specialist": "音音",
    "voice-specialist": "聲聲",
    "training-specialist": "練練",
    "learning-specialist": "學學",
  };
  if (chain.length === 1) return `【角色】${labels[chain[0]]}`;
  return `【角色鏈】${chain.map(r => labels[r]).join(" → ")}`;
}
