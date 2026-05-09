// 15 精靈的視覺配置 — 提供給任何需要顯示精靈名稱 / chip / deck 的元件用。
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
