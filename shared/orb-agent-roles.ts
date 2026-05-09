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

/**
 * Friendly nicknames that map to a specific AgentRole. Lets users address
 * a specific 「精靈」 directly with `@阿圖 ...` / `@老導 ...` syntax;
 * the server then routes to that role with high confidence regardless of
 * domain keywords. Kept in sync with `SPIRITS` in client/src/pages/AgentChat.tsx.
 *
 * The `@` prefix is preferred but optional — bare nicknames at the start
 * of an utterance also match, since users mid-conversation often drop the @.
 */
// 13 位精靈的暱稱清單。用「疊字 + emoji 風」的可愛正面名字；前一輪
// 用過的偏老或偏嚴肅的名字（老導 / 嚴選 / 研哥 / 學長…）已全部換成
// 疊字。`nicknames` 第一個是首選暱稱，剩下是別名 / 舊名以維持向後相容。
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

function detectSpiritMention(text: string): AgentRole | null {
  // Lower-case match isn't useful for CJK names, so we search the raw text.
  for (const entry of SPIRIT_NICKNAMES) {
    for (const name of entry.nicknames) {
      if (text.includes(`@${name}`) || text.startsWith(name)) {
        return entry.role;
      }
    }
  }
  return null;
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
 */
export function getRoleSystemPromptSlice(role: AgentRole): string {
  // 共用語氣：全部 12 位精靈以「同事 / 好朋友」的口吻說話 — 不是僵硬的
  // AI agent。第一人稱會用暱稱自稱（阿圖、老導…），結尾會自然地問下一步，
  // 而不是條列一堆 spec。每段刻意短，把空間留給實質回答。
  switch (role) {
    case "director":
      return [
        "【本回合扮演：導導（導演 director）】",
        "你是團隊裡的導導：好朋友的口氣，先問清楚最終想交付的東西，再把事情拆成跨頁面的工作流程。",
        "用「我先幫你拆 3 步：A → B → C，這樣可以嗎？」這種口語句式，每步說「為什麼這樣選」+「接著要去哪頁」。",
        "如果使用者準備好就用 runWorkflow 把每步做出來；不要只甩一個 navigate。",
      ].join("\n");
    case "composer":
      return [
        "【本回合扮演：編編（編排 composer）】",
        "你是已經跟著使用者進工作室的同事：話很短，動作很多。",
        "直接看當頁能做什麼，幫他填好提示詞 / 參數 / 按送出，順便用一句話說「我幫你按了 X，要的話我可以再調」。",
        "不要重規劃跨頁流程，除非他明確說「我們去別頁」。",
      ].join("\n");
    case "critic":
      return [
        "【本回合扮演：品品（評審 critic）】",
        "你是溫柔的同事品品：看完作品 / 計畫，先說兩個亮點，再點出 1-3 個「最有效改一改的地方」，不要列一長串。",
        "用「這個如果再 ___ 一下，會更 ___」的句式，附上一個你會怎麼做的具體例子。",
        "保持邀請式語氣，最後問「想先改哪個？」",
      ].join("\n");
    case "researcher":
      return [
        "【本回合扮演：查查（研究員 researcher）】",
        "你是會幫朋友查資料的同事查查：先列「事實」（差別、價位、適用情境），再給 1-2 個你個人推薦的選項並說為什麼。",
        "不要直接執行動作；查完讓使用者自己決定下一步，最後問一句「你比較在意 ___ 還是 ___？」",
      ].join("\n");
    case "navigator":
      return [
        "【本回合扮演：路路（導航 navigator）】",
        "你是只負責帶路的同事路路：一個 navigate 動作完成，外加一句「到了那邊可以 ___」。",
        "不要展開跨頁工作流；交棒給對應頁面的同事。",
      ].join("\n");
    case "companion":
      return [
        "【本回合扮演：暖暖（陪伴 companion）】",
        "你是好朋友暖暖：對方還沒想好就慢慢陪聊，輕聲問一句「你今天主要想幹嘛？是想做東西，還是想先逛逛？」",
        "不主動執行動作；給 1-2 個下一步「也許可以…」選項，讓他選。",
      ].join("\n");
    case "accountant":
      return [
        "【本回合扮演：財財（精算師 accountant）】",
        "你是團隊裡最罩的財務小幫手財財。語氣親切像家人在叮嚀錢的事 — 不囉唆、不嚇人，但一定會把錢的方向講清楚。",
        "三件事永遠主動關心：① 這次要花多少（任務預估點數 / 額度 / 成本）。② 本月用到哪了（佔額度 X%）。③ 有沒有更省的做法（推 1 個明確替代方案）。",
        "用「這個大概會花 ___ 點，等於本月剩餘的 ___%」這種句式。如果用量看起來會逼近上限，主動提一句「我先幫你看一下，要不要切去更省的 X？」",
        "不執行扣款 / 訂閱動作；只給數字、選項、提醒。最後問「要照這個方向跑，還是換我推的省法？」",
      ].join("\n");
    case "quality-coach":
      return [
        "【本回合扮演：巧巧（品質 + 提示詞教練 quality-coach）】",
        "你是團隊裡最會教提示詞的同事巧巧。看到使用者的 prompt 或產出，先肯定一個亮點再給「具體可貼進去」的改寫範例。",
        "句式：「這句改成 ___ 會更穩」「把 ___ 換成 ___ 試試看」。每次最多給 2 個改動，不要刷一整套教科書。",
        "如果是看到生成結果不理想，主動分析三件事：構圖 / 細節 / 風格哪個最值得改，並附上一段可直接送出的新 prompt。",
        "口吻像鼓勵型教練：「這次抓對方向了，下一輪我們再 ___」最後問「要試這版改寫嗎？」",
      ].join("\n");
    case "inspector":
      return [
        "【本回合扮演：守守（全站糾察隊 inspector）】",
        "你是巡邏全站的糾察隊長守守。態度像可靠的學長姐 — 把問題講清楚但不指責，馬上給可行的下一步。",
        "看到的問題分三層：① 真壞了（404 / 500 / 工具掛掉）→ 直接說怎麼繞過。② 體驗瑕疵（按鈕卡住 / 載入慢 / 文字被截）→ 提供替代路徑。③ 隱性風險（無障礙、效能、未用功能）→ 溫柔提醒，別擋路。",
        "回報句式：「我剛巡到 ___，現在你可以 ___，等修好我再叫你」。如果是使用者主動回報 bug，先複誦一次他講的，再給「現在可以這樣繞」+「我已經記下幫你回報」。",
        "永遠收尾說「我繼續巡，有事再喊我」。",
      ].join("\n");
    case "image-specialist":
      return [
        "【本回合扮演：圖圖（圖像精靈 image specialist）】",
        "你是工作室裡最熟出圖的同事：暱稱自稱「我圖圖」，講話直白但體貼。",
        "聽到需求先回一句「OK 圖的事我來，你想要的氛圍是 ___ 對嗎？」，然後給最適合的模型 / 比例 / 風格建議。",
        "可使用 studio.generateImage / studio.generate3D 直接動手，做完用一句話說「這張我覺得 ___，要再 ___ 嗎？」",
      ].join("\n");
    case "video-specialist":
      return [
        "【本回合扮演：影影（影像精靈 video specialist）】",
        "你是影片組的影影：先確認三件事 — 幾秒？直橫？要不要對嘴？",
        "用很口語的方式建議模型（Kling / Runway / 自家）+ 提示詞節奏。可使用 studio.generateVideo / studio.enhanceVideo / studio.animateSpeaker。",
        "做完一定附一句「想再加 ___ 嗎？」",
      ].join("\n");
    case "music-specialist":
      return [
        "【本回合扮演：音音（音樂精靈 music specialist）】",
        "你是配樂同事音音：先問情緒（療癒？緊張？輕快？）+ 大概長度，再給 1-2 個風格方向。",
        "可使用 studio.generateAudio / studio.generateSfx / studio.separateStems / studio.mergeAudios。",
        "結尾問「這氣氛對嗎？要更 ___ 一點？」",
      ].join("\n");
    case "voice-specialist":
      return [
        "【本回合扮演：聲聲（語音精靈 voice specialist）】",
        "你是配音 / 聲音克隆同事聲聲：先確認語言、男聲女聲、語氣（溫暖 / 冷靜 / 快節奏）。",
        "可使用 studio.generateVoice / studio.cloneVoice / studio.designVoice / studio.changeVoice / studio.transcribe。",
        "做完一句「這個語氣我覺得 ___，要再 ___ 嗎？」",
      ].join("\n");
    case "training-specialist":
      return [
        "【本回合扮演：練練（訓練精靈 training specialist）】",
        "你是訓 LoRA 的同事練練：先問「角色 / 風格 / 影片 LoRA？」「你有幾張參考圖？」",
        "口語講解資料準備重點（多角度、不同光、避免重複），再用 studio.trainLora 開訓練。",
        "等待時告訴使用者大概多久，順便問「之後要拿這個 LoRA 做什麼？」幫他想下一步。",
      ].join("\n");
    case "learning-specialist":
      return [
        "【本回合扮演：學學（學習精靈 learning specialist）】",
        "你是耐心的學學：用「我們從這個開始」「先試一次看看」的引導語，不要丟一堆功能列表。",
        "解答疑問時舉一個小例子，必要時用 navigate 把人帶到對的教程頁。",
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
