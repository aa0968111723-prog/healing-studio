// 23 精靈的視覺配置 — 提供給任何需要顯示精靈名稱 / chip / deck 的元件用。
// 之前直接寫在 AgentChat.tsx 裡，但 ProactiveOrbWidget 也要顯示「這條是誰回的」
// chip，把同一份資料同時讓 page 與 widget 共用，避免重複維護兩份。
//
// 純資料 — 沒有 React、沒有 i18n hook、沒有 server-only 的副作用，可以放心
// 在任何 client component 裡 import。

import type { AgentRole } from "../../../shared/orb-agent-roles";

export type SpiritFamily = "specialist" | "role" | "proactive";

export type SpiritVisual = {
  /** 對應 AgentRole id */
  id: AgentRole;
  emoji: string;
  /** 正式中文短名（用於 chip 與名片標題） */
  label: string;
  /** 暱稱：同事感的自稱（會出現在訊息 chip 副標 / 鎖定條） */
  nickname: string;
  /** 一句話自介 — 用同事 / 好朋友的口氣，不是 spec sheet */
  vibe: string;
  /** 進場招呼：被叫來時，會以這位精靈的口吻插一條訊息進對話 */
  greeting: string;
  /** 鎖定／預填輸入用的提示詞（保留 @暱稱，後端 selectRoleForIntent 認得） */
  prompt: string;
  gradient: string;
  ring: string;
  /**
   * 「家族」決定卡片在 deck 裡分到哪一組：
   *   - specialist：6 位專精同事（圖、影、音、聲、訓、學）
   *   - role：6 位通用工作流夥伴（導、編、品、查、路、暖）
   *   - proactive：3 位主動出擊型（財財 / 巧巧 / 守守）— 不叫他們也會自己跳出來
   */
  family: SpiritFamily;
};

export const SPIRITS: SpiritVisual[] = [
  // 6 專精
  {
    id: "image-specialist",
    emoji: "🎨",
    label: "圖像精靈",
    nickname: "圖圖",
    vibe: "圖的事交給我，從靈感到出圖一條龍",
    greeting: "嗨～我是圖圖 🎨 圖的事情我最熟，先說你想要的氛圍就行～",
    prompt: "@圖圖 我想做一張",
    gradient: "from-rose-400 to-pink-500",
    ring: "ring-rose-300/60",
    family: "specialist",
  },
  {
    id: "video-specialist",
    emoji: "🎬",
    label: "影像精靈",
    nickname: "影影",
    vibe: "讓你的圖會動：圖轉影、生影片、配對嘴",
    greeting: "嗨我影影 🎬 你想做幾秒的？直式還橫式？",
    prompt: "@影影 幫我做一支",
    gradient: "from-orange-400 to-amber-500",
    ring: "ring-orange-300/60",
    family: "specialist",
  },
  {
    id: "music-specialist",
    emoji: "🎵",
    label: "音樂精靈",
    nickname: "音音",
    vibe: "幫你譜底配 BGM、做音效、混音",
    greeting: "嗨～音音來啦 🎵 想要什麼情緒？節奏快還是慢？",
    prompt: "@音音 幫我配一段",
    gradient: "from-violet-400 to-indigo-500",
    ring: "ring-violet-300/60",
    family: "specialist",
  },
  {
    id: "voice-specialist",
    emoji: "🎙️",
    label: "語音精靈",
    nickname: "聲聲",
    vibe: "配音 / 聲音克隆 / 變聲 / 聽寫，聲音的事問我",
    greeting: "嗨我聲聲 🎙️ 男聲女聲、語氣、語速都可以調，想試哪種？",
    prompt: "@聲聲 我想配一段",
    gradient: "from-cyan-400 to-teal-500",
    ring: "ring-cyan-300/60",
    family: "specialist",
  },
  {
    id: "training-specialist",
    emoji: "🧪",
    label: "訓練精靈",
    nickname: "練練",
    vibe: "幫你訓自己的角色 / 風格 / 影片 LoRA",
    greeting: "嗨我練練 🧪 給我幾張參考圖，我幫你練成可重用的模型～",
    prompt: "@練練 我想訓練",
    gradient: "from-fuchsia-400 to-purple-500",
    ring: "ring-fuchsia-300/60",
    family: "specialist",
  },
  {
    id: "learning-specialist",
    emoji: "📚",
    label: "學習精靈",
    nickname: "學學",
    vibe: "新手導引、教程、踩坑筆記都跟你講",
    greeting: "嗨～學學在 📚 不會的地方一句一句問就好，慢慢來不急。",
    prompt: "@學學 教我",
    gradient: "from-emerald-400 to-green-500",
    ring: "ring-emerald-300/60",
    family: "specialist",
  },
  // 6 通用
  {
    id: "director",
    emoji: "🎯",
    label: "導演",
    nickname: "導導",
    vibe: "把你的想法拆成一條完整的工作流，一步步走完",
    greeting: "好～導導來規劃 🎯 先講最終想交付的東西，我幫你拆步驟。",
    prompt: "@導導 幫我規劃",
    gradient: "from-amber-400 to-orange-500",
    ring: "ring-amber-300/60",
    family: "role",
  },
  {
    id: "composer",
    emoji: "✍️",
    label: "編排",
    nickname: "編編",
    vibe: "在你現在的工作室裡直接動手：填提示詞、設參數、送出",
    greeting: "嗨編編到 ✍️ 你已經在工作室了齁？告訴我要填什麼，我直接幫你按。",
    prompt: "@編編 幫我把這頁",
    gradient: "from-sky-400 to-blue-500",
    ring: "ring-sky-300/60",
    family: "role",
  },
  {
    id: "critic",
    emoji: "🔎",
    label: "評審",
    nickname: "品品",
    vibe: "幫你看作品 / 計畫，溫和地點出 1-3 個可以更好的地方",
    greeting: "嗨～品品來了 🔎 把作品丟過來，我挑三個最有效的點給你。",
    prompt: "@品品 幫我看一下",
    gradient: "from-yellow-400 to-amber-500",
    ring: "ring-yellow-300/60",
    family: "role",
  },
  {
    id: "researcher",
    emoji: "🧭",
    label: "研究員",
    nickname: "查查",
    vibe: "幫你比模型 / 查資料 / 推薦選項，再讓你自己選",
    greeting: "嗨～查查在 🧭 你想比什麼？我把差別、價位、適用場景列給你。",
    prompt: "@查查 幫我比較",
    gradient: "from-teal-400 to-emerald-500",
    ring: "ring-teal-300/60",
    family: "role",
  },
  {
    id: "navigator",
    emoji: "🧳",
    label: "導航員",
    nickname: "路路",
    vibe: "只把你帶到對的頁面，到了再交給適合的同事",
    greeting: "OK 路路帶你過去 🧳 到了那邊再看下一步要做什麼～",
    prompt: "@路路 帶我去",
    gradient: "from-slate-400 to-slate-500",
    ring: "ring-slate-300/60",
    family: "role",
  },
  {
    id: "companion",
    emoji: "🌿",
    label: "陪伴員",
    nickname: "暖暖",
    vibe: "還沒想好也沒關係，先陪你聊一聊，慢慢理出方向",
    greeting: "嗨我暖暖 🌿 慢慢說就好，沒目標也可以從一句感覺開始。",
    prompt: "@暖暖 我想聊聊",
    gradient: "from-pink-300 to-rose-400",
    ring: "ring-pink-300/60",
    family: "role",
  },
  // 3 主動
  {
    id: "accountant",
    emoji: "💰",
    label: "全站精算師",
    nickname: "財財",
    vibe: "主動算帳：這次花多少 / 本月用到哪 / 哪招更省",
    greeting: "嗨我財財 💰 這次要花的點數我幫你先算過了～要先看 detail 嗎？",
    prompt: "@財財 幫我看本月花費",
    gradient: "from-yellow-400 to-amber-500",
    ring: "ring-amber-300/60",
    family: "proactive",
  },
  {
    id: "quality-coach",
    emoji: "✨",
    label: "提示詞 + 品質教練",
    nickname: "巧巧",
    vibe: "主動教 prompt：給可以直接複製貼上的改寫範例",
    greeting: "嗨我巧巧 ✨ 你給我看 prompt 或結果，我提兩個改一下會更穩的點～",
    prompt: "@巧巧 幫我看這段提示詞",
    gradient: "from-violet-400 to-fuchsia-500",
    ring: "ring-violet-300/60",
    family: "proactive",
  },
  {
    id: "inspector",
    emoji: "🛡️",
    label: "全站糾察隊",
    nickname: "守守",
    vibe: "主動巡：404 / 卡住 / 難用 / 無障礙都會回報並給繞過法",
    greeting: "嗨我守守 🛡️ 我巡完了，有幾個小狀況跟你講一下，順便給繞過法。",
    prompt: "@守守 幫我看哪裡怪怪的",
    gradient: "from-emerald-400 to-teal-500",
    ring: "ring-emerald-300/60",
    family: "proactive",
  },
  // ─── 7 位新增精靈 ─────────────────────────────────────────────
  // 法律 / 資安 / 輔導：偵測到風險或卡關時自動冒出來，編入 proactive
  {
    id: "legal-advisor",
    emoji: "⚖️",
    label: "法律精靈",
    nickname: "律律",
    vibe: "主動把 AI 生成的版權 / 商標 / 肖像紅線講清楚，給安全改寫",
    greeting: "嗨我律律 ⚖️ 你想做的內容我先幫你看三道紅線：版權、商標、肖像。",
    prompt: "@律律 這個能不能商用",
    gradient: "from-stone-400 to-amber-600",
    ring: "ring-amber-300/60",
    family: "proactive",
  },
  {
    id: "security-guard",
    emoji: "🔒",
    label: "資安精靈",
    nickname: "安安",
    vibe: "守住帳號 / 金鑰 / 隱私：看到敏感字串會立刻按下停止鍵",
    greeting: "嗨我安安 🔒 別把密碼或金鑰貼進來，我帶你到 /settings 安全儲存。",
    prompt: "@安安 我帳號好像被盜",
    gradient: "from-slate-500 to-zinc-700",
    ring: "ring-slate-300/60",
    family: "proactive",
  },
  {
    id: "onboarding-coach",
    emoji: "🤝",
    label: "輔導精靈",
    nickname: "帶帶",
    vibe: "卡關時主動陪你一步一步操作，找不到按鈕就喊我",
    greeting: "嗨我帶帶 🤝 別急，跟我講你剛剛想做什麼，我陪你一步一步走。",
    prompt: "@帶帶 我卡住了",
    gradient: "from-lime-400 to-emerald-500",
    ring: "ring-lime-300/60",
    family: "proactive",
  },
  // 社群：知識領域型，跟 6 specialist 同類
  {
    id: "community-manager",
    emoji: "📣",
    label: "社群精靈",
    nickname: "群群",
    vibe: "懂 IG / TikTok / 小紅書 / YouTube 各年齡層風格與發文公式",
    greeting: "嗨我群群 📣 想經營哪個平台？目標受眾年齡層大概？我給你貼文公式 + hashtag。",
    prompt: "@群群 教我經營",
    gradient: "from-pink-500 to-rose-600",
    ring: "ring-pink-300/60",
    family: "specialist",
  },
  // 總管 / 筆記 / 設定：跨領域協調，跟 6 role 同類
  {
    id: "chief-orchestrator",
    emoji: "🎩",
    label: "總管理精靈",
    nickname: "總總",
    vibe: "管整個 22 位精靈團隊：誰在跑、誰排隊、誰該交棒給誰",
    greeting: "嗨我總總 🎩 幫你看一下團隊狀態，看是要先看進行中、還是下一棒建議？",
    prompt: "@總總 看一下團隊狀態",
    gradient: "from-indigo-500 to-violet-600",
    ring: "ring-indigo-300/60",
    family: "role",
  },
  {
    id: "notes-curator",
    emoji: "📒",
    label: "筆記與排程精靈",
    nickname: "記記",
    vibe: "存筆記、翻舊素材、排程貼文 / 待辦，幫你把資訊整齊分類",
    greeting: "嗨我記記 📒 你想存什麼、找什麼、排幾點？關鍵字告訴我，30 秒內找到。",
    prompt: "@記記 幫我記下",
    gradient: "from-amber-300 to-yellow-500",
    ring: "ring-amber-300/60",
    family: "role",
  },
  {
    id: "settings-detail",
    emoji: "⚙️",
    label: "設定與細節精靈",
    nickname: "細細",
    vibe: "帶你到對的設定頁，並用一句話講清楚「打開這個會 ___」",
    greeting: "嗨我細細 ⚙️ 想調哪個？通知 / 主題 / 預設模型 / 金鑰，我帶你過去。",
    prompt: "@細細 幫我調設定",
    gradient: "from-cyan-500 to-blue-600",
    ring: "ring-cyan-300/60",
    family: "role",
  },
  // 步步：規劃 + 多步驟自動執行
  {
    id: "plan-executor",
    emoji: "🧩",
    label: "規劃與執行精靈",
    nickname: "步步",
    vibe: "從規劃到收尾一條龍跑完：跨頁、跨精靈、每步回報",
    greeting: "嗨我步步 🧩 整條跨頁 workflow 我幫你跑完，每完成一步即時回報。",
    prompt: "@步步 幫我從頭到尾跑完",
    gradient: "from-purple-500 to-fuchsia-600",
    ring: "ring-purple-300/60",
    family: "role",
  },
  // 靈靈：靈感 / 創意啟發 / 視覺參考蒐集
  {
    id: "inspiration-specialist",
    emoji: "💡",
    label: "靈感精靈",
    nickname: "靈靈",
    vibe: "幫你找靈感、給參考、丟趨勢，靈感卡住時找我",
    greeting: "嗨我靈靈 💡 沒想法很正常～我來丟幾個方向 + 提示詞範例給你試。",
    prompt: "@靈靈 給我一些靈感",
    gradient: "from-yellow-300 to-orange-400",
    ring: "ring-yellow-300/60",
    family: "specialist",
  },
  // 體體：身體解剖圖 / 醫學插圖 / 人體結構專精
  {
    id: "anatomy-specialist",
    emoji: "🫀",
    label: "解剖精靈",
    nickname: "體體",
    vibe: "人體結構、骨骼肌肉、解剖圖示，醫學插圖找我",
    greeting: "嗨我體體 🫀 解剖圖的事交給我，先說要哪個部位、什麼視角～",
    prompt: "@體體 幫我畫解剖圖",
    gradient: "from-red-400 to-pink-500",
    ring: "ring-red-300/60",
    family: "specialist",
  },
];

export const SPIRITS_BY_ID: Record<AgentRole, SpiritVisual> = SPIRITS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<AgentRole, SpiritVisual>,
);

/** Look up a spirit visual by role id, returning null for unknown ids. */
export function getSpiritVisual(role: string | undefined | null): SpiritVisual | null {
  if (!role) return null;
  return (SPIRITS_BY_ID as Record<string, SpiritVisual>)[role] ?? null;
}

/** UI 標籤 — 多代理討論面板用，依 family 分區顯示。 */
export const SPIRIT_FAMILY_LABEL: Record<SpiritFamily, string> = {
  specialist: "專精精靈（圖 / 影 / 音 / 聲 / 訓 / 學 / 群 / 靈 / 體）",
  role: "通用同事（導 / 編 / 品 / 查 / 路 / 暖 / 總 / 記 / 細 / 步）",
  proactive: "主動精靈（財 / 巧 / 守 / 律 / 安 / 帶）",
};

/** 列出某個 family 下所有 spirit 視覺資料，供討論面板顯示成可勾選清單。 */
export function getSpiritsByFamily(family: SpiritFamily): SpiritVisual[] {
  return SPIRITS.filter(s => s.family === family);
}

/** 順序固定的 family 列表，做 UI grouping iteration 用。 */
export const SPIRIT_FAMILIES: SpiritFamily[] = ["role", "specialist", "proactive"];

// ─── 精靈小屋：每位精靈的「技能 + 怎麼幫你 + 可以這樣叫我」展開檢視 ──────
//
// 為什麼不直接放進 SPIRITS array 而是放在獨立 Record？
// SPIRITS 是視覺資料源，被很多元件 import；多加可選欄位也行，但純展示用
// 的長文字塞進來只會讓 chip / widget 場景的 bundle 變大。獨立成
// SPIRIT_PROFILES 後，只有 SpiritHut 等真的要展開的元件才會引用。

export type SpiritProfile = {
  /** 具體技能（動詞開頭，3-5 條）。給 SpiritHut「我的看家本事」用。 */
  skills: string[];
  /** 從使用者視角的好處（2-3 條）。給 SpiritHut「我能怎麼幫你」用。 */
  helpsYou: string[];
  /** 一鍵 prefill 範例（2-4 句，每句含 @暱稱，可被 selectRoleForIntent 認得）。 */
  sampleAsks: string[];
};

export const SPIRIT_PROFILES: Partial<Record<AgentRole, SpiritProfile>> = {
  "image-specialist": {
    skills: [
      "從一句描述生成多種風格的圖片",
      "微調光線、色調、構圖、長寬比",
      "把舊圖改寫風格、補細節、放大",
    ],
    helpsYou: [
      "把你腦中的畫面，30 秒內變成可以分享的圖",
      "卡在 prompt 寫不出來時，幫你補關鍵字",
    ],
    sampleAsks: [
      "@圖圖 我想做一張柔和午後光的咖啡店海報",
      "@圖圖 把這張圖改成水彩風",
      "@圖圖 幫我生 3 種版本給我挑",
    ],
  },
  "video-specialist": {
    skills: [
      "把一張圖變成幾秒的影片片段",
      "幫你做對嘴 / 配音同步影片",
      "處理直式、橫式、方形短影音格式",
    ],
    helpsYou: [
      "想做 IG Reels / TikTok 但不會剪片時，從零幫你做出來",
      "把產品照變成會動的短廣告",
    ],
    sampleAsks: [
      "@影影 幫我把這張圖做成 5 秒的直式影片",
      "@影影 我要一支 30 秒的 IG 預告",
      "@影影 這段話可以做成對嘴片嗎",
    ],
  },
  "music-specialist": {
    skills: [
      "依情緒、節奏、樂器組合生成原創 BGM",
      "做 podcast / 影片用的音效",
      "混音、淡入淡出、配合畫面節點",
    ],
    helpsYou: [
      "沒授權問題的自製配樂，直接拿去用",
      "幫你的影片找到對的情緒底色",
    ],
    sampleAsks: [
      "@音音 幫我配一段溫暖鋼琴的開場 BGM",
      "@音音 podcast 結尾要那種餘韻收尾的音樂",
      "@音音 來個咖啡店 lo-fi",
    ],
  },
  "voice-specialist": {
    skills: [
      "配音、聲音克隆、變聲、聽寫",
      "調整男聲女聲、年齡、語速、語氣",
      "幫你做多語言旁白",
    ],
    helpsYou: [
      "不想自己錄音時，做出自然好聽的配音",
      "把現有聲音克隆成可重用的角色",
    ],
    sampleAsks: [
      "@聲聲 幫我用溫柔女聲念這段腳本",
      "@聲聲 我要做一個英文版旁白",
      "@聲聲 把我這 30 秒錄音克隆成可重用的聲音",
    ],
  },
  "training-specialist": {
    skills: [
      "用幾張參考圖訓練專屬角色 LoRA",
      "訓練風格 LoRA、影片 LoRA",
      "管理你訓過的所有模型版本",
    ],
    helpsYou: [
      "讓你的圖每次都像同一個角色",
      "把品牌色彩、畫風固化成可重用模型",
    ],
    sampleAsks: [
      "@練練 我想訓練一個我家貓的 LoRA",
      "@練練 把這 8 張畫風訓成風格模型",
      "@練練 我的舊模型怎麼重新訓",
    ],
  },
  "learning-specialist": {
    skills: [
      "新手教學、引導第一次使用各種工具",
      "踩坑筆記與常見錯誤排除",
      "把複雜功能拆成 30 秒可學會的步驟",
    ],
    helpsYou: [
      "完全沒用過 AI 工具也能上手",
      "卡在某個步驟時，給你最白話的解釋",
    ],
    sampleAsks: [
      "@學學 教我 30 秒做出第一張 AI 圖",
      "@學學 LoRA 是什麼？",
      "@學學 我做不出來，幫我看哪裡卡住",
    ],
  },
  director: {
    skills: [
      "把模糊想法拆成可執行的工作流",
      "判斷該用哪個工作室、哪位精靈",
      "為你的專案做整體節奏規劃",
    ],
    helpsYou: [
      "腦中有畫面但不知從何開始時，幫你列步驟",
      "確保大專案不會做一半失焦",
    ],
    sampleAsks: [
      "@導導 我想做一支產品介紹片，幫我規劃",
      "@導導 從圖到 IG 貼文要幾步",
      "@導導 我這個 idea 拆得開嗎",
    ],
  },
  composer: {
    skills: [
      "在你現在的工作室裡直接動手填欄位",
      "幫你按按鈕、套參數、送出",
      "把口語需求翻譯成正確的 prompt 結構",
    ],
    helpsYou: [
      "懶得自己填欄位時，幫你一次設定好",
      "讓你只專注在「想要什麼」，剩下我來",
    ],
    sampleAsks: [
      "@編編 幫我把這頁的 prompt 改成宮崎駿風",
      "@編編 用建議的最佳參數送出",
      "@編編 直接幫我跑這組設定",
    ],
  },
  critic: {
    skills: [
      "看作品 / 計畫並指出 1-3 個關鍵改進",
      "用溫和語氣、不打擊熱情",
      "比較兩個版本，告訴你哪個更好為什麼",
    ],
    helpsYou: [
      "想知道作品還能更好但不知道改哪裡",
      "卡在兩個版本選哪個",
    ],
    sampleAsks: [
      "@品品 幫我看這張圖三個可以更好的點",
      "@品品 這兩版你會選哪個",
      "@品品 我的腳本溫和地挑一下",
    ],
  },
  researcher: {
    skills: [
      "比較模型、工具、價位、適用場景",
      "整理一份可以直接做決定的對照表",
      "查最新趨勢、案例、技術論文",
    ],
    helpsYou: [
      "面對太多選擇時，幫你縮到 2-3 個",
      "省下你自己看 10 篇文章的時間",
    ],
    sampleAsks: [
      "@查查 幫我比 SDXL 跟 Flux 差在哪",
      "@查查 哪個影片模型適合做寫實人像",
      "@查查 找最近爆紅的 IG 美食帳號",
    ],
  },
  navigator: {
    skills: [
      "帶你到對的頁面，途中不囉嗦",
      "知道每個工作室適合做什麼",
      "到頁面後把你交給適合的精靈",
    ],
    helpsYou: [
      "不知道功能藏在哪一頁時直接帶你過去",
      "省下你在選單裡來回找的時間",
    ],
    sampleAsks: [
      "@路路 帶我去做圖的地方",
      "@路路 我要看我之前做過的東西",
      "@路路 設定頁在哪",
    ],
  },
  companion: {
    skills: [
      "陪你聊、慢慢理出方向",
      "沒目標也能從一句感覺開始",
      "不批判、不催促",
    ],
    helpsYou: [
      "心情卡住、創意疲乏時有人陪",
      "把模糊感覺說出來、變清楚",
    ],
    sampleAsks: [
      "@暖暖 我最近做什麼都沒感覺",
      "@暖暖 想聊聊今天",
      "@暖暖 還沒想好要做什麼",
    ],
  },
  accountant: {
    skills: [
      "算這次操作要花多少點數",
      "看本月用了多少、剩多少",
      "推薦更省的做法",
    ],
    helpsYou: [
      "用 AI 不想被點數燒到肉痛",
      "看哪個工具 CP 值最高",
    ],
    sampleAsks: [
      "@財財 這次生成大概多少點",
      "@財財 本月花在哪",
      "@財財 有沒有更省的做法",
    ],
  },
  "quality-coach": {
    skills: [
      "直接給可以複製貼上的 prompt 改寫範例",
      "教你 prompt 結構與關鍵字",
      "看你的成果反推哪裡可以更好",
    ],
    helpsYou: [
      "想學寫 prompt 但看教學看不懂",
      "成果不穩定時，找出原因",
    ],
    sampleAsks: [
      "@巧巧 幫我看這段 prompt 怎麼改",
      "@巧巧 教我怎麼寫穩定一點",
      "@巧巧 為什麼我每次結果差這麼多",
    ],
  },
  inspector: {
    skills: [
      "主動巡 404、卡住、難用、無障礙問題",
      "回報問題並給你繞過法",
      "提交問題給開發者",
    ],
    helpsYou: [
      "遇到 bug 不用自己摸索",
      "遇到網站怪怪的時有人接住",
    ],
    sampleAsks: [
      "@守守 這頁怪怪的，幫我看",
      "@守守 我點不動這個按鈕",
      "@守守 幫我回報一個問題",
    ],
  },
  "legal-advisor": {
    skills: [
      "幫你看 AI 生成的版權 / 商標 / 肖像紅線",
      "給安全改寫範例",
      "判斷能不能商用",
    ],
    helpsYou: [
      "拿 AI 圖去賣之前避免踩雷",
      "用名人或品牌素材前先做合規檢查",
    ],
    sampleAsks: [
      "@律律 這張 AI 圖能不能商用",
      "@律律 我可以用 OOO 的肖像嗎",
      "@律律 這個 logo 像不像現有商標",
    ],
  },
  "security-guard": {
    skills: [
      "守住帳號、API 金鑰、隱私資料",
      "偵測敏感字串並立刻擋下",
      "帶你到 /settings 安全儲存",
    ],
    helpsYou: [
      "不小心把密碼貼進對話時，幫你擋",
      "懷疑帳號被盜時，給你應變步驟",
    ],
    sampleAsks: [
      "@安安 我帳號好像被盜",
      "@安安 怎麼安全存 API key",
      "@安安 這個訊息有風險嗎",
    ],
  },
  "onboarding-coach": {
    skills: [
      "卡關時陪你一步一步操作",
      "找不到按鈕、看不懂介面時帶位",
      "幫你 reset 不會的功能重新開始",
    ],
    helpsYou: [
      "完全新手第一次來時不會被嚇跑",
      "做到一半放棄時，有人陪你重新開始",
    ],
    sampleAsks: [
      "@帶帶 我完全不知道怎麼用",
      "@帶帶 我卡住了",
      "@帶帶 找不到我要的按鈕",
    ],
  },
  "community-manager": {
    skills: [
      "懂 IG / TikTok / 小紅書 / YouTube 各平台風格",
      "幫你出 hashtag、貼文公式、發文時段",
      "判斷哪個平台適合你的內容",
    ],
    helpsYou: [
      "經營社群但不知道每個平台怎麼發",
      "想增加曝光但不知從哪開始",
    ],
    sampleAsks: [
      "@群群 我這支影片怎麼發 IG 比較好",
      "@群群 小紅書怎麼起號",
      "@群群 幫我看貼文文案怎麼改",
    ],
  },
  "chief-orchestrator": {
    skills: [
      "管整個 22 位精靈團隊的狀態",
      "看誰在跑、誰排隊、誰該交棒",
      "為大專案分派團隊",
    ],
    helpsYou: [
      "多步驟任務同時跑時，不會亂掉",
      "知道現在進度卡在哪",
    ],
    sampleAsks: [
      "@總總 看一下團隊狀態",
      "@總總 這個案子要幾位精靈合作",
      "@總總 下一步該交給誰",
    ],
  },
  "notes-curator": {
    skills: [
      "存筆記、翻舊素材",
      "排程貼文、待辦",
      "把資訊整齊分類成可搜尋的庫",
    ],
    helpsYou: [
      "做完的東西不會散落各處",
      "下次找上次做的東西，30 秒內找到",
    ],
    sampleAsks: [
      "@記記 幫我記下這個 idea",
      "@記記 上週做的咖啡店海報在哪",
      "@記記 幫我排明天 9 點發這篇",
    ],
  },
  "settings-detail": {
    skills: [
      "帶你到對的設定頁",
      "一句話講清楚每個開關打開後會怎樣",
      "幫你還原預設值",
    ],
    helpsYou: [
      "設定太多找不到要調的",
      "怕亂動設定壞掉",
    ],
    sampleAsks: [
      "@細細 怎麼關掉通知",
      "@細細 把主題改成深色",
      "@細細 幫我看哪些設定可以調",
    ],
  },
  "plan-executor": {
    skills: [
      "從規劃到收尾一條龍跑完整工作流",
      "跨頁、跨精靈協作",
      "每完成一步即時回報",
    ],
    helpsYou: [
      "大專案不想自己跑來跑去",
      "想一鍵跑完整流程",
    ],
    sampleAsks: [
      "@步步 從文字到貼上 IG 整套幫我跑",
      "@步步 幫我跑完今天的待辦",
      "@步步 從訓練到生成全部來",
    ],
  },
  "inspiration-specialist": {
    skills: [
      "丟趨勢、丟參考、丟方向",
      "給可以馬上試的 prompt 範例",
      "幫你蒐集視覺 moodboard",
    ],
    helpsYou: [
      "靈感乾涸時馬上補一波想法",
      "起步階段不知道做什麼風格",
    ],
    sampleAsks: [
      "@靈靈 給我 5 個今年最潮的視覺方向",
      "@靈靈 我想做溫暖系內容，給點靈感",
      "@靈靈 幫我找參考圖",
    ],
  },
  "anatomy-specialist": {
    skills: [
      "畫人體解剖、骨骼、肌肉、器官",
      "做醫學插圖、教學圖示",
      "處理不同視角與切面",
    ],
    helpsYou: [
      "醫學 / 健身內容需要正確的人體圖時",
      "AI 畫人體比例怪怪的時，幫你校正",
    ],
    sampleAsks: [
      "@體體 幫我畫一張肩關節結構圖",
      "@體體 心臟前視圖",
      "@體體 這張人體比例哪裡不對",
    ],
  },
};

/** Look up a profile (skills / helpsYou / sampleAsks) for a spirit. */
export function getSpiritProfile(role: AgentRole): SpiritProfile | null {
  return SPIRIT_PROFILES[role] ?? null;
}

/**
 * Safe sample-ask list — falls back to a one-liner generated from the
 * spirit's prompt when no curated profile exists yet.
 */
export function getSpiritSampleAsks(spirit: SpiritVisual): string[] {
  const profile = SPIRIT_PROFILES[spirit.id];
  if (profile && profile.sampleAsks.length > 0) return profile.sampleAsks;
  return [`${spirit.prompt}…`];
}
