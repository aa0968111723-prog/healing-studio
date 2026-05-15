/**
 * shared/slash-commands.ts — 全站統一的 / 指令登記簿
 *
 * 把現有分散的 AI 代理入口（4 種模式、25 位精靈、頁面導航、記憶／匯出／分享
 * 等動作）收攏成 Claude Code 風格的 slash command，讓使用者在 chat 輸入框
 * 打 `/` 就能快速喚起任何代理行為。
 *
 * 設計原則：
 *   - 純資料 + 純函式（沒有 React、沒有 server-only 副作用）→ 可被
 *     前端 UI、後端 router、vitest 純邏輯測試共用
 *   - 指令 → 行為的對映（kind + payload）由客戶端的 slashCommandRunner
 *     在執行期決定，這裡只負責「指令存在」與「如何 parse 輸入字串」
 *   - 與既有 OrbChatRequestedMode / AgentRole / appRegistry 沿用同一套
 *     id 命名，避免再造一份對映表
 */

/**
 * 4 種既有的代理模式 — 與 client/contexts/GlobalOrbChatContext 的
 * `OrbChatRequestedMode` 同一個聯合，這裡複製一份避免 shared → client
 * 反向依賴。改名前先確認兩邊一致。
 */
export type SlashCommandMode = "navigate" | "plan" | "multi-step" | "ask-feature";

// ─── 型別定義 ─────────────────────────────────────────────────────────────

/**
 * 指令分類 — 用來在自動完成選單裡分組顯示。對應 UI 上的視覺分隔線。
 */
export type SlashCommandGroup =
  | "mode" // 代理模式：/auto, /plan, /nav, /ask
  | "spirit" // 精靈：/image, /video, /spirit ...
  | "navigate" // 頁面跳轉：/go ...
  | "memory" // 記憶相關：/memory, /forget
  | "action" // 一次性動作：/export, /share, /clear, /clarify
  | "session" // 對話控制：/new, /reset, /history
  | "help"; // 自助：/help, /?

/**
 * 指令執行時要做什麼。runner 在客戶端做 switch 分派。把「意圖」與「實際 API
 * 呼叫」解耦，方便未來搬到後端或加入 telemetry。
 */
export type SlashCommandKind =
  /** 改變 chat 模式並送出當前剩餘的 prompt（如 /plan 規劃影片）。 */
  | { kind: "send-with-mode"; mode: SlashCommandMode }
  /** 把訊息送給特定精靈（透過 @nickname 前綴交給 selectRoleForIntent）。 */
  | { kind: "send-as-spirit"; spiritId: string; nickname: string }
  /** 直接導航到一個頁面路徑。 */
  | { kind: "navigate"; path: string }
  /** 把 phrase 送進 global orb chat，讓既有 sendMessage 走預設流程。 */
  | { kind: "orb-phrase"; phrase: string }
  /** 觸發客戶端動作（不送訊息）— 例如清除記憶、開新對話、開列印視窗。 */
  | { kind: "client-action"; action: SlashClientAction }
  /** 純資訊指令（不送訊息）— 例如 /help 開幫助面板。 */
  | { kind: "info"; topic: "help" | "shortcuts" | "spirits" };

/**
 * 客戶端動作 — runner 翻譯成既有的 context 方法。
 *
 * 注意：所有需要與後端對話的能力都用 `orb-phrase` / `send-with-mode`，
 * 走既有的 sendMessage pipeline。這裡列出的是「純前端」可立即執行的動作。
 */
export type SlashClientAction =
  | "clear-history" // 清除本場對話 UI 訊息
  | "new-conversation" // 新建分頁
  | "reset-conversation" // 重置目前對話（保留分頁）
  | "clear-memory" // 後端：清掉所有偏好記憶（會跳確認）
  | "show-memory" // 開記憶儀表板
  | "export-pdf" // 列印對話成 PDF
  | "share-workflow" // 把上一個 workflow 打包成 link
  | "open-palette" // 開啟 ⌘K 全站搜尋（fallback 用）
  | "open-settings"; // 跳到設定頁

/**
 * 指令範本 — 自動完成選單與解析器都用這份資料。
 */
export interface SlashCommand {
  /** 主要指令字（含開頭 /）— 顯示與比對時用。例如 "/plan"。 */
  name: string;
  /** 別名（不含 /）— 例如 ["計畫", "planning"]。比對時都會試。 */
  aliases: string[];
  /** 分類，決定 UI 分組順序。 */
  group: SlashCommandGroup;
  /** 簡短描述（一句話）— 顯示在選單第二行。 */
  description: string;
  /** 例子（給輸入提示用）— 不含 / 前綴。 */
  example?: string;
  /** 圖示鍵（前端對映成 lucide-react icon），純字串以維持 shared 純度。 */
  iconKey: string;
  /** 是否需要參數（影響 placeholder 提示）。 */
  takesArgument: boolean;
  /** 參數提示文字（顯示在 chip 旁）。 */
  argumentHint?: string;
  /** 執行行為。 */
  action: SlashCommandKind;
  /**
   * 是否預設隱藏（要打字才會出現，例如管理員工具）。
   * 預設 false。
   */
  hidden?: boolean;
}

// ─── 25 位精靈的對映 ───────────────────────────────────────────────────────
//
// 同名表內嵌在這裡避免 shared → client 反向依賴；精靈本身已存在 client 端
// spiritsVisual.ts，但這份是供「指令補全」用，只需 id + nickname + 短描述。
// 兩份未來可以再合併到 shared/orb-agent-roles.ts。

interface SpiritShorthand {
  spiritId: string;
  nickname: string;
  command: string; // 主指令字（不含 /）
  description: string;
}

export const SPIRIT_COMMANDS: readonly SpiritShorthand[] = [
  { spiritId: "image-specialist", nickname: "圖圖", command: "image", description: "圖像精靈・生圖／改圖／角色一致性" },
  { spiritId: "video-specialist", nickname: "影影", command: "video", description: "影像精靈・圖轉影／生影片／對嘴" },
  { spiritId: "music-specialist", nickname: "音音", command: "music", description: "音樂精靈・BGM／音效／混音" },
  { spiritId: "voice-specialist", nickname: "聲聲", command: "voice", description: "語音精靈・配音／聲音克隆／TTS" },
  { spiritId: "training-specialist", nickname: "練練", command: "train", description: "訓練精靈・LoRA／角色／風格訓練" },
  { spiritId: "learning-specialist", nickname: "學學", command: "learn", description: "學習精靈・教學中心／模型解說" },
  { spiritId: "director", nickname: "導導", command: "director", description: "導演精靈・統籌跨工具流程" },
  { spiritId: "composer", nickname: "編編", command: "composer", description: "編輯精靈・拼接／後製／剪接" },
  { spiritId: "critic", nickname: "品品", command: "critic", description: "品評精靈・成品檢查／給回饋" },
  { spiritId: "researcher", nickname: "查查", command: "research", description: "查詢精靈・上網查資料／找參考" },
  { spiritId: "navigator", nickname: "路路", command: "nav-spirit", description: "導覽精靈・帶你去對的頁" },
  { spiritId: "companion", nickname: "暖暖", command: "companion", description: "陪伴精靈・心情陪聊／緩衝" },
  { spiritId: "accountant", nickname: "財財", command: "budget", description: "財財・預算／點數估算" },
  { spiritId: "quality-coach", nickname: "巧巧", command: "quality", description: "巧巧・素材品質教練" },
  { spiritId: "inspector", nickname: "守守", command: "inspect", description: "守守・內容審查／合規" },
  { spiritId: "legal-advisor", nickname: "律律", command: "legal", description: "律律・版權／使用條款" },
  { spiritId: "security-guard", nickname: "安安", command: "security", description: "安安・安全／隱私守門" },
  { spiritId: "onboarding-coach", nickname: "帶帶", command: "onboarding", description: "帶帶・新手導覽" },
  { spiritId: "community-manager", nickname: "群群", command: "community", description: "群群・社群／分享" },
  { spiritId: "chief-orchestrator", nickname: "總總", command: "orchestrator", description: "總總・大型多代理流程總指揮" },
  { spiritId: "notes-curator", nickname: "記記", command: "notes", description: "記記・筆記整理／知識庫" },
  { spiritId: "settings-detail", nickname: "細細", command: "settings-detail", description: "細細・帳號／設定細節" },
  { spiritId: "plan-executor", nickname: "執執", command: "execute", description: "執執・把計畫變執行" },
  { spiritId: "inspiration-specialist", nickname: "靈靈", command: "inspire", description: "靈靈・靈感／提示詞建構" },
  { spiritId: "anatomy-specialist", nickname: "解解", command: "anatomy", description: "解解・骨骼／姿態／構圖" },
] as const;

// ─── 主要指令登記簿 ───────────────────────────────────────────────────────

function spiritCommandToSlash(spirit: SpiritShorthand): SlashCommand {
  return {
    name: `/${spirit.command}`,
    aliases: [spirit.nickname, spirit.spiritId, `@${spirit.nickname}`],
    group: "spirit",
    description: spirit.description,
    example: `${spirit.command} 一張賽博龐克貓咪`,
    iconKey: "sparkles",
    takesArgument: true,
    argumentHint: "想做什麼？",
    action: { kind: "send-as-spirit", spiritId: spirit.spiritId, nickname: spirit.nickname },
  };
}

const MODE_COMMANDS: SlashCommand[] = [
  {
    name: "/auto",
    aliases: ["multi-step", "多步驟", "自動"],
    group: "mode",
    description: "多步驟代理・把目標丟給光球自動跑完整條任務",
    example: "auto 做支 30 秒 IG 預告片",
    iconKey: "workflow",
    takesArgument: true,
    argumentHint: "說一句目標…",
    action: { kind: "send-with-mode", mode: "multi-step" },
  },
  {
    name: "/plan",
    aliases: ["plan", "計畫", "規劃"],
    group: "mode",
    description: "先擬計畫・光球出計畫表，你說「開始」它才動",
    example: "plan 這週的影片產出",
    iconKey: "list-checks",
    takesArgument: true,
    argumentHint: "想完成什麼？",
    action: { kind: "send-with-mode", mode: "plan" },
  },
  {
    name: "/nav",
    aliases: ["navigate", "跳頁", "go-page"],
    group: "mode",
    description: "跳頁・說一句目的地，光球帶你去對的工具頁",
    example: "nav 我要做配音",
    iconKey: "corner-up-right",
    takesArgument: true,
    argumentHint: "想去哪個工具頁？",
    action: { kind: "send-with-mode", mode: "navigate" },
  },
  {
    name: "/ask",
    aliases: ["ask", "ask-feature", "問", "功能"],
    group: "mode",
    description: "功能詢問・問光球這個站有什麼功能，不會動手或跳頁",
    example: "ask 這站有什麼角色一致性模型？",
    iconKey: "help-circle",
    takesArgument: true,
    argumentHint: "想問什麼？",
    action: { kind: "send-with-mode", mode: "ask-feature" },
  },
];

const NAVIGATION_COMMANDS: SlashCommand[] = [
  {
    name: "/go",
    aliases: ["page", "open"],
    group: "navigate",
    description: "直接跳到某個頁面（home / studio / image / video / settings…）",
    example: "go image-studio",
    iconKey: "compass",
    takesArgument: true,
    argumentHint: "頁面 id 或關鍵字",
    action: { kind: "navigate", path: "" }, // runner 會把 argument 解析成 path
  },
  {
    name: "/home",
    aliases: ["首頁"],
    group: "navigate",
    description: "回到首頁",
    iconKey: "home",
    takesArgument: false,
    action: { kind: "navigate", path: "/" },
  },
  {
    name: "/agent",
    aliases: ["chat", "光球"],
    group: "navigate",
    description: "打開光球對話頁",
    iconKey: "sparkles",
    takesArgument: false,
    action: { kind: "navigate", path: "/agent" },
  },
  {
    name: "/settings",
    aliases: ["設定"],
    group: "navigate",
    description: "個人設定",
    iconKey: "settings",
    takesArgument: false,
    action: { kind: "navigate", path: "/settings" },
  },
];

const ACTION_COMMANDS: SlashCommand[] = [
  {
    name: "/search",
    aliases: ["find", "搜尋"],
    group: "action",
    description: "跨資產／筆記／生成歷史搜尋（光球幫你找）",
    example: "search 上禮拜那張森林背景",
    iconKey: "search",
    takesArgument: true,
    argumentHint: "找什麼？",
    action: { kind: "orb-phrase", phrase: "找我之前的素材：" },
  },
  {
    name: "/export",
    aliases: ["pdf", "匯出"],
    group: "action",
    description: "匯出今天的對話成 PDF",
    iconKey: "download",
    takesArgument: false,
    action: { kind: "client-action", action: "export-pdf" },
  },
  {
    name: "/share",
    aliases: ["link", "分享"],
    group: "action",
    description: "把上一個工作流打包成連結並複製",
    iconKey: "share-2",
    takesArgument: false,
    action: { kind: "client-action", action: "share-workflow" },
  },
];

const MEMORY_COMMANDS: SlashCommand[] = [
  {
    name: "/memory",
    aliases: ["mem", "記憶"],
    group: "memory",
    description: "看光球記得我什麼（風格／平台／用途偏好）",
    iconKey: "brain",
    takesArgument: false,
    action: { kind: "client-action", action: "show-memory" },
  },
  {
    name: "/forget",
    aliases: ["clear-memory", "重置記憶"],
    group: "memory",
    description: "清除光球記住的所有偏好（會問你確認）",
    iconKey: "trash-2",
    takesArgument: false,
    action: { kind: "client-action", action: "clear-memory" },
  },
];

const SESSION_COMMANDS: SlashCommand[] = [
  {
    name: "/new",
    aliases: ["new-chat", "新對話"],
    group: "session",
    description: "開一個全新的對話分頁",
    iconKey: "plus",
    takesArgument: false,
    action: { kind: "client-action", action: "new-conversation" },
  },
  {
    name: "/clear",
    aliases: ["cls", "清空"],
    group: "session",
    description: "清空目前對話（保留分頁）",
    iconKey: "rotate-ccw",
    takesArgument: false,
    action: { kind: "client-action", action: "reset-conversation" },
  },
];

const HELP_COMMANDS: SlashCommand[] = [
  {
    name: "/help",
    aliases: ["?", "幫助"],
    group: "help",
    description: "看所有可用指令",
    iconKey: "help-circle",
    takesArgument: false,
    action: { kind: "info", topic: "help" },
  },
  {
    name: "/spirits",
    aliases: ["精靈", "list-spirits"],
    group: "help",
    description: "列出全部 25 位精靈與他們專精的事",
    iconKey: "users",
    takesArgument: false,
    action: { kind: "info", topic: "spirits" },
  },
];

/**
 * 全站可用 slash command 完整列表。順序＝選單預設顯示順序。
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  ...MODE_COMMANDS,
  ...HELP_COMMANDS,
  ...SESSION_COMMANDS,
  ...ACTION_COMMANDS,
  ...MEMORY_COMMANDS,
  ...NAVIGATION_COMMANDS,
  ...SPIRIT_COMMANDS.map(spiritCommandToSlash),
] as const;

// ─── 解析器 ───────────────────────────────────────────────────────────────

export interface ParsedSlashInput {
  /** 整段輸入是否以 / 開頭。false ＝ 不是指令，按正常 prompt 處理。 */
  isCommand: boolean;
  /** 原始指令字（不含 /），可能不完整。例如使用者打到一半 "/pla" → "pla"。 */
  rawName: string;
  /** 指令的參數字串（/ 後第一個空格之後的所有字）。 */
  argument: string;
  /** 比對到的命令（exact match）。沒比對到時為 null。 */
  matched: SlashCommand | null;
}

const NAME_LOOKUP: Map<string, SlashCommand> = (() => {
  const m = new Map<string, SlashCommand>();
  for (const cmd of SLASH_COMMANDS) {
    m.set(cmd.name.toLowerCase(), cmd);
    m.set(cmd.name.slice(1).toLowerCase(), cmd); // 不含 / 的形式
    for (const alias of cmd.aliases) {
      m.set(alias.toLowerCase(), cmd);
    }
  }
  return m;
})();

/**
 * 把輸入字串解析成 slash command。專為「使用者在輸入框打字」這個情境設計：
 *   - 只看開頭 / — 內文裡的 /xxx 不算
 *   - argument 可以含空格、@、CJK 字元，原樣保留
 *   - rawName 用來給 UI 做 fuzzy 比對
 *
 * 範例：
 *   "/plan 拍片計畫" → { isCommand: true, rawName: "plan", argument: "拍片計畫", matched: PLAN }
 *   "/image"        → { isCommand: true, rawName: "image", argument: "", matched: IMAGE }
 *   "你好"          → { isCommand: false, rawName: "", argument: "你好", matched: null }
 */
export function parseSlashInput(raw: string): ParsedSlashInput {
  const text = raw ?? "";
  if (!text.startsWith("/")) {
    return { isCommand: false, rawName: "", argument: text, matched: null };
  }
  const rest = text.slice(1);
  const firstSpace = rest.search(/\s/);
  const rawName = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
  const argument = firstSpace === -1 ? "" : rest.slice(firstSpace + 1);
  const matched = NAME_LOOKUP.get(rawName.toLowerCase()) ?? null;
  return { isCommand: true, rawName, argument: argument.trim(), matched };
}

/**
 * Fuzzy 搜尋 — 給自動完成選單用。
 *
 *   - 完全空白 → 回傳全部（按 group 預設排序）
 *   - 否則先試「開頭比對」(prefix match)，命中的排前面
 *   - 再附上「含關鍵字」(substring match) 結果
 *
 * 比對時不分大小寫；比對範圍：name、aliases、description。
 */
export function suggestSlashCommands(query: string, limit = 12): SlashCommand[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) {
    return SLASH_COMMANDS.filter(c => !c.hidden).slice(0, limit);
  }
  const prefixHits: SlashCommand[] = [];
  const substringHits: SlashCommand[] = [];
  for (const cmd of SLASH_COMMANDS) {
    if (cmd.hidden) continue;
    const haystacks = [
      cmd.name.slice(1).toLowerCase(),
      ...cmd.aliases.map(a => a.toLowerCase()),
    ];
    const description = cmd.description.toLowerCase();
    const isPrefix = haystacks.some(h => h.startsWith(q));
    if (isPrefix) {
      prefixHits.push(cmd);
      continue;
    }
    const isSubstring = haystacks.some(h => h.includes(q)) || description.includes(q);
    if (isSubstring) {
      substringHits.push(cmd);
    }
  }
  return [...prefixHits, ...substringHits].slice(0, limit);
}

/**
 * 取得單一指令（exact match）。給程式邏輯用，不是給 UI 補全的。
 */
export function findSlashCommand(name: string): SlashCommand | null {
  return NAME_LOOKUP.get(name.toLowerCase()) ?? null;
}

/**
 * 把分類 id 翻譯成中文標題（給 UI 分組標籤用）。
 */
export const SLASH_GROUP_LABELS: Record<SlashCommandGroup, string> = {
  mode: "代理模式",
  spirit: "精靈呼叫",
  navigate: "頁面跳轉",
  memory: "記憶",
  action: "快捷動作",
  session: "對話控制",
  help: "幫助",
};
