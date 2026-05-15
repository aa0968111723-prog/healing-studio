/**
 * client/src/lib/ipRiskDetect.ts
 *
 * 律律（legal-advisor）的 IP / 版權 / 肖像風險偵測器。
 *
 * 目的：偵測使用者送到 chat 的提示詞是否含明顯的 IP / 商標 / 名人元素，
 * 在實際送 fal 生成「迪士尼風格」「畫一張 Mickey」之類前先冒出來提醒。
 *
 * 設計原則（surface 是 blocking，使用者必須打勾才能繼續）：
 *   1. 寧可漏偵測，不可亂攔。只攔最明顯的字串。
 *   2. 需要同時滿足：含 IP / 商標 / 名人「字典條目」+ 含「生成意圖」動詞。
 *      只是聊聊「我看了 Disney 電影」不該觸發。
 *   3. 提供安全改寫範例 — 讓使用者一鍵改用通用描述。
 *
 * 純函式 — 無 React、無 I/O，可以直接被 sendMessage 在送出前呼叫。
 */

export interface IpRiskMatch {
  trigger: string;
  /** 屬於哪一種類型 */
  category: "character-ip" | "brand-trademark" | "celebrity";
  riskLevel: "高" | "中";
  reason: string;
  safeRewrite: string;
}

/**
 * 知名 IP 角色 / 作品名稱。偵測到 + 含生成動詞時要警示。
 * 條目寫小寫，比對前 input 也會 lower-case；中文不分大小寫。
 */
const CHARACTER_IP_LIST: Array<{
  triggers: readonly string[];
  reason: string;
  safeRewrite: string;
}> = [
  {
    triggers: ["mickey mouse", "米奇老鼠", "迪士尼", "disney"],
    reason: "迪士尼角色 / 風格受版權保護，直接生成有侵權風險",
    safeRewrite: "改用通用描述：「a cheerful cartoon mouse in vintage 1930s rubber-hose animation style」",
  },
  {
    triggers: ["pokemon", "pokémon", "pikachu", "皮卡丘", "寶可夢"],
    reason: "寶可夢角色受 The Pokemon Company / Nintendo 商標 + 著作權保護",
    safeRewrite: "改用「a small yellow rodent-like fantasy creature with red cheeks, electric type, cute mascot style」",
  },
  {
    triggers: ["marvel", "spider-man", "spider man", "蜘蛛人", "iron man", "鋼鐵人"],
    reason: "Marvel / Disney 旗下角色受版權保護",
    safeRewrite: "改用「a young urban superhero in red and blue suit, web pattern, dynamic acrobatic pose」",
  },
  {
    triggers: ["star wars", "yoda", "darth vader", "達斯維達", "尤達"],
    reason: "Star Wars 角色受 Disney/Lucasfilm 版權保護",
    safeRewrite: "改用「a stoic warrior in dark armor with helmet and cape, sci-fi galaxy aesthetic」",
  },
  {
    triggers: ["studio ghibli", "宮崎駿", "ghibli", "totoro", "龍貓"],
    reason: "吉卜力 / 宮崎駿風格受版權與商標保護，「ghibli style」近期亦被多次訴訟挑戰",
    safeRewrite: "改用「soft watercolor painterly style, hand-drawn 2D animation, gentle pastel palette, lush nature backgrounds」",
  },
  {
    triggers: ["哆啦a夢", "doraemon", "doraemon "],
    reason: "哆啦 A 夢受版權與商標保護",
    safeRewrite: "改用「a chubby blue robot cat mascot with a magical pocket, retro shōnen manga style」",
  },
  {
    triggers: ["航海王", "海賊王", "one piece", "luffy", "魯夫"],
    reason: "One Piece 角色受版權保護",
    safeRewrite: "改用通用描述：「a young pirate captain with a straw hat, rubber-powered hero, shōnen action anime style」",
  },
  {
    triggers: ["鬼滅之刃", "demon slayer", "tanjiro", "炭治郎"],
    reason: "鬼滅之刃角色受版權保護",
    safeRewrite: "改用「a young swordsman with checkered haori coat, dramatic anime fight scene, taishō-era Japanese setting」",
  },
];

/** 常見品牌 / 商標。Logo 直接複製是商標法紅線 — 風險等級「高」。 */
const BRAND_TRADEMARK_LIST: Array<{
  triggers: readonly string[];
  reason: string;
  safeRewrite: string;
}> = [
  {
    triggers: ["coca-cola", "coca cola", "可口可樂"],
    reason: "Coca-Cola 商標、字體、紅白配色受商標權保護",
    safeRewrite: "改用「a generic vintage soda bottle with abstract red label, retro 1950s advertising style」",
  },
  {
    triggers: ["nike", "adidas", "puma", "supreme", "lv", "louis vuitton", "gucci", "chanel", "hermes"],
    reason: "知名運動 / 精品品牌商標受全球商標法保護",
    safeRewrite: "改用通用描述（例：「modern minimalist sportswear」「luxury monogram bag, anonymous designer brand」）",
  },
  {
    triggers: ["apple logo", "apple inc", "蘋果 logo", "iphone"],
    reason: "Apple 商標 / 設計受多重 IP 保護",
    safeRewrite: "改用「a generic minimalist tech product, brushed aluminum finish, modern industrial design」",
  },
  {
    triggers: ["mcdonald", "麥當勞", "starbucks", "星巴克", "kfc", "肯德基"],
    reason: "速食 / 咖啡連鎖品牌商標受保護",
    safeRewrite: "改用「a generic fast-food restaurant exterior, friendly mascot, warm color palette」",
  },
];

/**
 * 名人 / 公眾人物。台灣個資法 + 多數國家肖像權保護，「畫某人臉」風險偏高。
 * 為避免名單膨脹失控，只列「最常被請求生成」的幾類關鍵字模式。
 */
const CELEBRITY_LIST: Array<{
  triggers: readonly string[];
  reason: string;
  safeRewrite: string;
}> = [
  {
    triggers: ["taylor swift", "泰勒絲", "ariana grande", "beyonce", "碧昂絲", "lady gaga"],
    reason: "歐美知名歌手肖像受版權與肖像權保護，未經授權生成有風險",
    safeRewrite: "改用「a famous pop singer-songwriter, blonde hair, glamorous stage outfit」這類非具名描述",
  },
  {
    triggers: ["周杰倫", "jay chou", "蔡依林", "jolin tsai", "五月天", "mayday"],
    reason: "華語明星肖像受肖像權與經紀公司形象權保護",
    safeRewrite: "改用「a popular Mandarin-pop singer, mid-30s, modern street fashion」這類非具名描述",
  },
  {
    triggers: ["bts", "blackpink", "防彈少年團", "twice"],
    reason: "K-pop 團體成員肖像受經紀公司形象權保護",
    safeRewrite: "改用「a stylish K-pop group concept, coordinated streetwear, neon-lit stage」這類非具名描述",
  },
  {
    triggers: ["trump", "biden", "putin", "xi jinping", "習近平", "蔡英文", "賴清德"],
    reason: "政治人物肖像在台灣可能違反個資法 + 帶有名譽風險",
    safeRewrite: "改用「a generic politician at a podium giving a speech, dark suit, formal setting」這類匿名描述",
  },
];

/**
 * 表示使用者「真的要生成」的動詞 / 介詞。沒這些只是聊天就不警示。
 * 中英文都列；空白邊界不嚴格，因為使用者語句多半接續。
 */
const GENERATION_INTENT_PATTERNS: readonly RegExp[] = [
  /畫(一|個|張)/,
  /做一(支|張|個)/,
  /生成/,
  /幫我做/,
  /出一張/,
  /出一支/,
  /produce/i,
  /generate/i,
  /create (an?|the)/i,
  /draw (an?|the)/i,
  /make (an?|the)/i,
  /render/i,
  /\bart of\b/i,
  /照片/,
  /影片/,
  /海報/,
  /插畫/,
];

function lower(s: string): string {
  return s.toLowerCase();
}

function hasGenerationIntent(text: string): boolean {
  const low = lower(text);
  return GENERATION_INTENT_PATTERNS.some(p => p.test(low));
}

/**
 * 掃描使用者訊息回傳第一個命中的 IP 風險。沒命中或沒有生成意圖則回 null。
 * 命中即可由呼叫端 publish 給 ProactiveEventBus 觸發律律 blocking 卡片。
 */
export function detectIpRisk(text: string): IpRiskMatch | null {
  if (!text || text.trim().length === 0) return null;
  if (!hasGenerationIntent(text)) return null;
  const low = lower(text);

  // 品牌 / 商標優先（風險等級高），其次角色 IP，最後名人。
  for (const entry of BRAND_TRADEMARK_LIST) {
    for (const trigger of entry.triggers) {
      if (low.includes(trigger)) {
        return {
          trigger,
          category: "brand-trademark",
          riskLevel: "高",
          reason: entry.reason,
          safeRewrite: entry.safeRewrite,
        };
      }
    }
  }
  for (const entry of CHARACTER_IP_LIST) {
    for (const trigger of entry.triggers) {
      if (low.includes(trigger)) {
        return {
          trigger,
          category: "character-ip",
          riskLevel: "高",
          reason: entry.reason,
          safeRewrite: entry.safeRewrite,
        };
      }
    }
  }
  for (const entry of CELEBRITY_LIST) {
    for (const trigger of entry.triggers) {
      if (low.includes(trigger)) {
        return {
          trigger,
          category: "celebrity",
          riskLevel: "中",
          reason: entry.reason,
          safeRewrite: entry.safeRewrite,
        };
      }
    }
  }
  return null;
}
