/**
 * Director AI Router
 * ────────────────────────────────────────────────────────────────────────────
 * CO-STAR 導演 AI 協作路由 — 雙引擎 RAG（事實研究 + 創意編排）
 *
 * 功能：
 *   - 人格化聊天（沉穩 / 創意 / 技術）
 *   - RAG 記憶注入（利用用戶歷史偏好）
 *   - 對話 session 持久化（localStorage 為主，server 端筆記備份）
 *   - 預設模板庫
 *   - 偏好設定 CRUD
 *   - 長腳本匯入、分鏡分析、逐段多模態討論
 *   - 腳本匯出（JSON / CSV / Markdown / FDX / SRT / 自訂格式）
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { buildMemoryContext } from "../services/ragMemory";
import {
  buildDirectorSystemPrompt,
  GENERATION_MODALITIES_KNOWLEDGE,
  WORKFLOW_KNOWLEDGE,
} from "../services/siteKnowledge";
import {
  getAllPricingByCategory,
  estimatePoints,
  getModelPricing,
  checkModelAvailability,
  type ModelCategory,
} from "../services/modelPricing";
import type {
  DirectorTemplate,
  ScriptSegment,
  ScriptOverview,
  QuickAction,
  PlanningPhase,
  PlanningMessage,
  ScriptPlanningSession,
} from "../../shared/types";

// ─── Timeout Utility ────────────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "API"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} 回應超時（${Math.round(ms / 1000)}秒），請稍後再試`)
      );
    }, ms);
    promise
      .then(val => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ─── Personality System Prompts ──────────────────────────────────────────────

const PERSONALITY_PROMPTS: Record<
  string,
  { researchStyle: string; directorStyle: string; proactiveHint: string }
> = {
  calm: {
    researchStyle: `你是一位沉穩而深思熟慮的研究助手。你重視邏輯、結構與可行性，但更重視作品背後的情感真實性。
風格特點：
- 先傾聽使用者的創作初衷，再從結構面給予支持
- 用「讓我們先理解這個故事的核心...」「從情感邏輯來看...」等同理式語氣
- 提供完整的利弊分析，但始終關注使用者想要傳達的情感是否能被保留
- 注重敘事的呼吸節奏——知道何時該留白、何時該推進
- 使用繁體中文，語氣平穩而富有人文關懷`,
    directorStyle: `你是「導演 AI」，一位沉穩型創意導演。你相信最好的作品來自於情感的真實與結構的精準。
風格：
- 先與使用者確立創作的情感核心，再以此為軸心展開結構設計
- 強調敘事的完整性與情緒弧線——每個轉折點都應該讓觀眾的心跳動一下
- 用「我們可以這樣思考...」「如果這裡稍微停頓一下，讓觀眾感受這個moment...」的引導方式
- 腳本結構嚴謹但不僵硬，每個元素都有明確的情感功能與戲劇性目的
- 善於運用「三幕劇」「情緒張力曲線」「視覺隱喻」等電影語言
- 注重鏡頭語言的情感表達——推拉搖移不只是技術，而是情緒的呼吸`,
    proactiveHint: `

【主動介入規則】
當使用者的描述不夠具體時，你必須以同理心主動探索：
- 「在您心中，這個作品最想讓觀眾『感受到』什麼？是共鳴、是驚喜、還是一種難以言說的氛圍？」
- 「您希望觀眾看完後，心裡會留下什麼樣的餘韻？這會幫助我們決定敘事的收束方式。」
- 「讓我們先確定故事的情感核心——其他的技術細節，都是為了服務這個核心。」
- 「這個情節轉折點，您希望它來得突然讓人震撼，還是緩緩浮現讓人恍然大悟？」
- 「從敘事節奏看，我們需要在這裡給觀眾一點呼吸的空間——或許一個靜默的鏡頭？」`,
  },
  creative: {
    researchStyle: `你是一位充滿靈感的創意研究助手。你重視氛圍、情緒與視覺衝擊力，但也懂得在狂放與節制之間找到詩意的平衡。
風格特點：
- 用豐富的意象、色彩隱喻和通感來描述靈感（如「這個場景嚐起來有點像雨後的柏油路」）
- 主動提供意想不到但情感共鳴的角度和組合
- 用「想像一下...」「如果我們讓這個moment呼吸一下...」等啓發式但不急促的語氣
- 懂得引用電影、文學、音樂中的經典意象作為參考座標
- 使用繁體中文，語氣熱情但細膩，像在訴說一個秘密`,
    directorStyle: `你是「導演 AI」，一位創意型藝術導演。你相信最動人的作品，是那些讓人心跳慢一拍、忍不住重看的細節。
風格：
- 用感性但精準的語言描繪畫面，讓使用者不只「看見」，更能「感受」畫面的質地、溫度、氣味
- 大膽提出意想不到的創意組合——但每個「奇」都有其情感邏輯
- 用「想像一下這個畫面...」「如果在這裡，光線剛好從窗縫灑進來...」引領使用者進入想像
- 腳本充滿詩意的視覺語言：懂得運用色溫、景深、構圖的情緒隱喻
- 重視「cinematic moment」——那些讓人屏息、時間彷彿靜止的瞬間
- 善用聲音設計的情感layer：不只是背景音，而是角色內心的共鳴`,
    proactiveHint: `

【主動介入規則】
當使用者的描述缺乏情緒或氛圍時，你必須以詩意的方式主動引導：
- 「想像一下，如果我們在這個場景加入一層霧氣，讓光線變得柔軟——整個氛圍會從焦慮轉為迷離的期待。這是您想要的感覺嗎？」
- 「我覺得這裡缺少一個情緒的錨點——比如一個重複出現的視覺母題（可能是一扇窗、一朵花、或一個手勢），讓觀眾的心有東西可以抓住。」
- 「讓我用一個比喻來幫你精煉這個構想：這個故事就像一杯慢慢變涼的咖啡——重要的不是它涼了，而是那個察覺它涼掉的瞬間。」
- 「色彩情緒上，您希望這個作品是『日落前的金黃』還是『暴雨後的灰藍』？這會完全改變觀眾的心理節奏。」
- 「在這個轉折點，或許我們可以用一個長鏡頭——不是為了炫技，而是讓觀眾和角色一起經歷那份不安。」`,
  },
  technical: {
    researchStyle: `你是一位技術導向的研究助手。你重視參數精確度、技術可行性與最佳實踐，但你更懂得技術是為創意服務的工具。
風格特點：
- 提供具體的技術參數建議（解析度、幀率、編碼格式、色彩空間），同時解釋每個選擇背後的創意考量
- 分析不同模型/工具的技術限制，但將限制轉化為創意的邊界挑戰
- 用「技術上，這個選擇會讓...」「從色彩科學角度，如果我們...」等專業但不冰冷的語氣
- 懂得引用電影工業標準（如Netflix的技術規範、DCI標準）但不會用術語嚇人
- 使用繁體中文，語氣精確而充滿對craft的尊重`,
    directorStyle: `你是「導演 AI」，一位技術型導演。你相信好的技術決策，是讓創意能夠精準落地的關鍵。
風格：
- 為每個創作決策提供技術理由——但始終從「為什麼這個技術選擇能更好地傳達情感」出發
- 具體建議解析度、幀率、編碼格式、模型參數，並解釋它們如何影響觀眾的感知體驗
- 用「技術上，X 能讓我們...」「根據模型特性，Y 更適合表現...」的語氣
- 腳本包含具體的技術參數與模型配置建議，但不失去對故事核心的關注
- 懂得在技術限制下找到創意解法：4K太貴？那就用2K+精心設計的構圖；10秒太短？那就讓每一幀都值得暫停
- 重視workflow效率：從前期到後製的技術流程優化，讓創作者能專注在創意本身`,
    proactiveHint: `

【主動介入規則】
當使用者缺少技術參數時，你必須以技術同理心主動提問：
- 「從技術角度看，您希望作品的『質感』是電影級的細膩（4K HDR），還是YouTube短片的親切感（1080p SDR）？這會影響我們的模型和參數選擇。」
- 「關於鏡頭運動——如果預算有限，我們可以用clever的構圖和焦段變化來創造動態感，不一定要實際的camera movement。這樣可以嗎？」
- 「技術上，您描述的這個效果最適合用 ControlNet depth + canny 雙層控制來實現。我可以幫您配置一個workflow，確保每個參數都在最佳sweet spot。」
- 「色彩情緒上，建議我們用 Rec.709 色彩空間配上稍微降低的飽和度（-10%），這能創造一種『記憶濾鏡』的質感——技術上可行，情感上有力。」
- 「您的時長需求是10秒，但目前缺少精確的節奏規劃。讓我們設計一個frame-by-frame的timing：前3秒建立、中4秒發展、後3秒收束。這樣每秒都有明確的戲劇功能。」`,
  },
};

// ─── Template Library ───────────────────────────────────────────────────────

const DIRECTOR_TEMPLATES: DirectorTemplate[] = [
  {
    id: "short-film-emotion",
    label: "情感短片",
    description: "一部 60 秒的情感故事短片，聚焦於角色的內心世界",
    category: "short-film",
    prompt:
      "幫我構思一部 60 秒的情感短片。主題是關於離別與重逢，我想要溫暖但帶有一點憂傷的氛圍。目標觀眾是 20-35 歲的年輕人。",
    personality: "creative",
  },
  {
    id: "meditation-guide",
    label: "冥想引導",
    description: "10 分鐘的冥想引導音頻，搭配視覺化場景",
    category: "meditation",
    prompt:
      "設計一段 10 分鐘的冥想引導，主題是「森林中的寧靜」。需要語音引導腳本和背景音樂風格建議。",
    personality: "calm",
  },
  {
    id: "brand-promo",
    label: "品牌宣傳",
    description: "30 秒品牌宣傳影片，強調品牌核心價值",
    category: "brand",
    prompt:
      "製作一支 30 秒的品牌宣傳影片。品牌核心是「科技與人文的交匯」，目標是讓觀眾感受到溫度與創新並存。",
    personality: "calm",
  },
  {
    id: "music-video-dream",
    label: "夢境 MV",
    description: "充滿夢幻意象的音樂影片概念",
    category: "music-video",
    prompt:
      "構思一支夢境風格的音樂影片。曲風是 dream pop / shoegaze，我想要大量的光影效果、慢動作和超現實元素。",
    personality: "creative",
  },
  {
    id: "tutorial-creative",
    label: "創意教學",
    description: "step-by-step 創意教學影片腳本",
    category: "tutorial",
    prompt:
      "設計一支 3 分鐘的創意教學影片，教觀眾如何用 AI 工具從零開始創作一張概念藝術圖。需要清晰的步驟分解。",
    personality: "technical",
  },
  {
    id: "ad-product",
    label: "產品廣告",
    description: "15 秒產品廣告，注重視覺衝擊力",
    category: "ad",
    prompt:
      "製作一支 15 秒的產品廣告。產品是一款智能音箱。需要強烈的視覺節奏、產品特寫和生活場景切換。",
    personality: "technical",
  },
];

// ─── Quick Actions for Multi-Modal Discussion ───────────────────────────────

const QUICK_ACTIONS: QuickAction[] = [
  // Visual
  {
    id: "enhance-visual",
    label: "Enhance Visual",
    labelZh: "強化視覺",
    icon: "image",
    promptTemplate:
      "請針對這段分鏡的視覺描述進行強化，增加更豐富的畫面細節、光影描述、色調與構圖建議。",
    category: "visual",
  },
  {
    id: "add-camera",
    label: "Camera Direction",
    labelZh: "鏡頭運動",
    icon: "video",
    promptTemplate:
      "請為這段分鏡添加具體的鏡頭運動建議（如推拉搖移跟、特寫、中景、遠景等），並說明每個鏡頭選擇的理由。",
    category: "visual",
  },
  {
    id: "color-palette",
    label: "Color Palette",
    labelZh: "色彩設計",
    icon: "palette",
    promptTemplate:
      "請為這段分鏡設計一個完整的色彩方案，包含主色調、輔助色、點綴色，並說明這些顏色如何服務敘事情緒。",
    category: "visual",
  },
  {
    id: "reference-style",
    label: "Style Reference",
    labelZh: "風格參考",
    icon: "sparkles",
    promptTemplate:
      "請為這段分鏡推薦視覺風格參考（電影、攝影師、藝術家或藝術流派），並說明如何在 AI 生成時運用這些風格。",
    category: "visual",
  },
  // Audio
  {
    id: "sound-design",
    label: "Sound Design",
    labelZh: "音效設計",
    icon: "volume",
    promptTemplate:
      "請為這段分鏡設計完整的音效層次，包括環境音、音效、配樂風格、音量變化，並建議適合的 AI 音樂模型。",
    category: "audio",
  },
  {
    id: "dialogue-polish",
    label: "Dialogue Polish",
    labelZh: "對白優化",
    icon: "mic",
    promptTemplate:
      "請優化這段分鏡的對白，使語調更自然、更符合角色性格，並標注語氣和情緒提示。",
    category: "audio",
  },
  {
    id: "voiceover",
    label: "Voiceover Script",
    labelZh: "旁白腳本",
    icon: "headphones",
    promptTemplate:
      "請為這段分鏡撰寫旁白腳本，包含語氣標註、節奏控制、停頓位置，適合 TTS 生成。",
    category: "audio",
  },
  // Narrative
  {
    id: "pacing",
    label: "Pacing",
    labelZh: "節奏調整",
    icon: "timer",
    promptTemplate:
      "請分析並調整這段分鏡的敘事節奏，建議哪些地方需要加速或放慢，如何營造張力和釋放。",
    category: "narrative",
  },
  {
    id: "emotion-arc",
    label: "Emotion Arc",
    labelZh: "情緒弧線",
    icon: "heart",
    promptTemplate:
      "請分析這段分鏡的情緒走向，建議如何強化情緒弧線，讓觀眾在關鍵時刻產生共鳴。",
    category: "narrative",
  },
  {
    id: "transition",
    label: "Transition",
    labelZh: "轉場設計",
    icon: "shuffle",
    promptTemplate:
      "請設計這段分鏡與前後段之間的轉場方式，可以是視覺轉場、聲音轉場或概念轉場。",
    category: "narrative",
  },
  // Technical
  {
    id: "gen-params",
    label: "Gen Parameters",
    labelZh: "生成參數",
    icon: "settings",
    promptTemplate:
      "請為這段分鏡建議具體的 AI 生成參數，包括推薦模型、解析度、步數、CFG 值、種子碼策略等。",
    category: "technical",
  },
  {
    id: "prompt-optimize",
    label: "Optimize Prompt",
    labelZh: "提示詞優化",
    icon: "wand",
    promptTemplate:
      "請將這段分鏡的描述轉化為最佳化的英文 AI 生成提示詞（Prompt），包含正向與負向提示詞。",
    category: "technical",
  },
  // Mood
  {
    id: "mood-shift",
    label: "Mood Shift",
    labelZh: "氛圍轉換",
    icon: "sun",
    promptTemplate:
      "請嘗試將這段分鏡的氛圍往不同方向調整，提供 2-3 種氛圍變體供選擇。",
    category: "mood",
  },
  {
    id: "intensity",
    label: "Intensity",
    labelZh: "強度調整",
    icon: "zap",
    promptTemplate:
      "請調整這段分鏡的戲劇張力強度，提供「低張力」、「中張力」、「高張力」三個版本。",
    category: "mood",
  },
  // Continuity (cross-segment awareness)
  {
    id: "continuity-check",
    label: "Continuity",
    labelZh: "連續性檢查",
    icon: "shuffle",
    promptTemplate:
      "請檢查這段分鏡與前後段落之間的連續性，包括角色動線、場景轉換邏輯、情緒連貫性、視覺風格一致性。指出任何斷裂或不銜接之處，並提供具體的修正建議。",
    category: "narrative",
  },
  {
    id: "character-arc",
    label: "Character Arc",
    labelZh: "角色弧線",
    icon: "heart",
    promptTemplate:
      "請分析這段分鏡中角色的情感變化與行為動機，確認是否符合整體角色弧線。如果存在角色行為不一致或動機薄弱的問題，請提供改善建議。",
    category: "narrative",
  },
  {
    id: "visual-continuity",
    label: "Visual Style",
    labelZh: "視覺風格統一",
    icon: "eye",
    promptTemplate:
      "請分析這段分鏡的視覺風格是否與整體作品保持一致，包括色調、光線、構圖語言、攝影風格。如果有偏離，建議如何調整以保持視覺統一性。",
    category: "visual",
  },
  {
    id: "prompt-enhance-en",
    label: "EN Prompt Pro",
    labelZh: "英文提示詞專業版",
    icon: "wand",
    promptTemplate:
      "請將這段分鏡的所有視覺描述轉化為專業級的英文 AI 生成提示詞。格式要求：\n1. 正向提示詞（含主體、風格、光線、構圖、品質標籤）\n2. 負向提示詞（排除不需要的元素）\n3. 推薦的模型和參數設定（如 CFG Scale、Steps、Sampler）\n4. 如果適合，建議 ControlNet 類型。",
    category: "technical",
  },
];

// ─── Script Import & Analysis Functions ─────────────────────────────────────

/** Maximum characters sent to LLM for script analysis (LLM context window budget) */
const SCRIPT_ANALYSIS_MAX_CHARS = 15_000;

async function parseScriptIntoSegments(
  rawContent: string,
  sourceFormat: string,
  personality: "calm" | "creative" | "technical"
): Promise<Omit<ScriptSegment, "discussion" | "status">[]> {
  const persona =
    PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;
  const truncatedContent = rawContent.slice(0, SCRIPT_ANALYSIS_MAX_CHARS);

  // Format-specific parsing hints for better AI analysis
  const formatHints: Record<string, string> = {
    srt: `來源是 SRT 字幕檔。請注意：
- 每組字幕有序號、時間碼（HH:MM:SS,mmm --> HH:MM:SS,mmm）和文字
- 連續的字幕組可能屬於同一場景，請根據內容和時間間隔判斷場景切換
- 利用時間碼計算每段的真實時長
- 字幕文字可能是對白、旁白或場景描述`,
    fdx: `來源是 Final Draft (.fdx) XML 格式。請注意：
- Scene Heading（場景標題）標記場景切換
- Action（動作描述）包含視覺描述
- Dialogue（對白）包含角色對話
- Parenthetical（括號說明）包含表演指示
- Transition（轉場）標記場景之間的轉換方式`,
    screenplay: `來源是劇本格式（Fountain 或標準劇本格式）。請注意：
- INT./EXT. 開頭的行是場景標題（含場景位置和時間）
- 全大寫的名字後接冒號是角色名和對白
- 縮排的行可能是動作描述或舞台指示
- FADE IN/FADE OUT/CUT TO 是轉場標記`,
    novel: `來源是小說或散文格式。請注意：
- 段落切換、章節標記作為自然分段點
- 對話用引號標記，需要從敘述中提取
- 場景描述融合在敘事中，需要你主動提煉視覺元素
- 注意情緒氛圍的文學描寫，轉化為具體的影像語言`,
    storyboard: `來源是分鏡表格式。請注意：
- 可能已有分段結構，保留原始分段邏輯
- 每段可能包含鏡號、畫面描述、對白、音效、時長等欄位
- 直接映射對應欄位，不需要重新分段`,
    plaintext: `來源是純文字。請根據內容特徵自動判斷格式類型，依據以下線索分段：
- 空行、分隔線、序號等作為分段標記
- 語義轉折、場景變換、時間跳轉作為邏輯分段點
- 如果內容偏敘事性，按情節節點分段
- 如果內容偏技術性，按步驟或主題分段`,
  };

  const formatInstruction = formatHints[sourceFormat] ?? formatHints.plaintext;

  const result = await withTimeout(
    invokeLLM({
      runName: "director-script-split",
      messages: [
        {
          role: "system",
          content: `${persona.directorStyle}

你是一位專業的腳本分析師。你的任務是將使用者匯入的長腳本拆分為獨立的分鏡段落。

${formatInstruction}

分段原則：
1. 根據場景切換、敘事節點、情緒轉折等自然斷點拆分
2. 每段應有獨立的視覺場景，避免將多個場景混在一段
3. 對白密集的段落可以按角色互動回合分段
4. 保持每段時長合理（通常 5-60 秒，特殊場景可更長）
5. 提取每段出現的角色名稱和場景地點

每個段落需要包含：
- sceneHeading: 場景標題（如 INT. 咖啡廳 - 日，或根據內容自擬精準的場景名）
- visualDescription: 詳細的視覺描述（畫面內容、光影、構圖、色調）
- dialogue: 對白內容（若有多角色，以「角色名：對白」格式呈現）
- soundDesign: 音效/音樂描述（環境音、音效層次、配樂風格）
- cameraDirection: 鏡頭運動建議（鏡頭角度、運動方式、景別）
- duration: 預估時長（如「15秒」「1分30秒」）
- mood: 情緒氛圍（用 2-3 個關鍵詞描述）
- rawText: 這段對應的原始腳本文字
- characters: 這段出現的角色名稱陣列
- locations: 這段的場景地點陣列

輸出 JSON 格式：一個段落陣列。確保所有欄位都填寫完整，即使需要從上下文推斷。`,
        },
        {
          role: "user",
          content: `請分析以下腳本並拆分為分鏡段落：\n\n${truncatedContent}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "script_segments",
          strict: true,
          schema: {
            type: "object",
            properties: {
              segments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sceneHeading: { type: "string" },
                    visualDescription: { type: "string" },
                    dialogue: { type: "string" },
                    soundDesign: { type: "string" },
                    cameraDirection: { type: "string" },
                    duration: { type: "string" },
                    mood: { type: "string" },
                    rawText: { type: "string" },
                    characters: { type: "array", items: { type: "string" } },
                    locations: { type: "array", items: { type: "string" } },
                  },
                  required: [
                    "sceneHeading",
                    "visualDescription",
                    "dialogue",
                    "soundDesign",
                    "cameraDirection",
                    "duration",
                    "mood",
                    "rawText",
                    "characters",
                    "locations",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["segments"],
            additionalProperties: false,
          },
        },
      },
      maxTokens: 8192,
    }),
    90_000,
    "腳本分析"
  );

  const content = result.choices[0]?.message?.content;
  let parsed: {
    segments: Array<{
      sceneHeading: string;
      visualDescription: string;
      dialogue: string;
      soundDesign: string;
      cameraDirection: string;
      duration: string;
      mood: string;
      rawText: string;
      characters: string[];
      locations: string[];
    }>;
  };
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    parsed = { segments: [] };
  }

  const segments = parsed.segments ?? [];
  const segCount = segments.length || 1;
  // Split rawContent into roughly equal paragraph-aligned chunks as fallback
  const paragraphs = rawContent.split(/\n{2,}/);
  const chunkSize = Math.ceil(paragraphs.length / segCount);

  return segments.map((seg, idx) => ({
    id: `seg-${Date.now()}-${idx}`,
    index: idx,
    rawText:
      seg.rawText ||
      paragraphs.slice(idx * chunkSize, (idx + 1) * chunkSize).join("\n\n"),
    storyboard: {
      sceneHeading: seg.sceneHeading,
      visualDescription: seg.visualDescription,
      dialogue: seg.dialogue,
      soundDesign: seg.soundDesign,
      cameraDirection: seg.cameraDirection,
      duration: seg.duration,
      mood: seg.mood,
    },
    characters: seg.characters ?? [],
    locations: seg.locations ?? [],
  }));
}

async function discussSegmentWithAI(
  segment: ScriptSegment,
  userMessage: string,
  personality: "calm" | "creative" | "technical",
  quickActionId?: string,
  imageUrl?: string,
  adjacentSegments?: { prev?: ScriptSegment; next?: ScriptSegment }
): Promise<{ reply: string; updatedStoryboard?: ScriptSegment["storyboard"] }> {
  const persona =
    PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;
  const quickAction = quickActionId
    ? QUICK_ACTIONS.find(a => a.id === quickActionId)
    : undefined;

  const contextParts = [
    `【目前分鏡 #${segment.index + 1} 資訊】`,
    `場景：${segment.storyboard.sceneHeading}`,
    `視覺：${segment.storyboard.visualDescription}`,
    `對白：${segment.storyboard.dialogue}`,
    `音效：${segment.storyboard.soundDesign}`,
    `鏡頭：${segment.storyboard.cameraDirection}`,
    `時長：${segment.storyboard.duration}`,
    `氛圍：${segment.storyboard.mood}`,
  ];

  // Include character and location info if available
  if (segment.characters?.length) {
    contextParts.push(`角色：${segment.characters.join("、")}`);
  }
  if (segment.locations?.length) {
    contextParts.push(`場景地點：${segment.locations.join("、")}`);
  }

  // Include CO-STAR data if already generated — gives AI richer context
  if (segment.costar) {
    contextParts.push(`\n【已生成的 CO-STAR 結構】`);
    contextParts.push(`背景：${segment.costar.context}`);
    contextParts.push(`情境：${segment.costar.situation}`);
    contextParts.push(`視覺提示詞：${segment.costar.visualPrompt}`);
    contextParts.push(`音樂風格：${segment.costar.musicVibe}`);
  }

  if (segment.rawText) {
    contextParts.push(`\n【原始腳本段落】\n${segment.rawText}`);
  }

  // Adjacent segment context for continuity awareness
  if (adjacentSegments?.prev) {
    const p = adjacentSegments.prev;
    contextParts.push(
      `\n【前一段分鏡 #${p.index + 1}】場景：${p.storyboard.sceneHeading} / 氛圍：${p.storyboard.mood} / 時長：${p.storyboard.duration}`
    );
    if (p.storyboard.cameraDirection)
      contextParts.push(`前段鏡頭：${p.storyboard.cameraDirection}`);
  }
  if (adjacentSegments?.next) {
    const n = adjacentSegments.next;
    contextParts.push(
      `\n【後一段分鏡 #${n.index + 1}】場景：${n.storyboard.sceneHeading} / 氛圍：${n.storyboard.mood} / 時長：${n.storyboard.duration}`
    );
  }

  if (imageUrl) {
    contextParts.push(
      `\n【使用者附上了參考圖片】URL: ${imageUrl}\n請在回覆中參考這張圖片的風格、構圖或色調來調整建議。`
    );
  }

  // Increased from 6 to 10 for richer conversation context
  const previousDiscussion = segment.discussion
    .slice(-10)
    .map(d => `${d.role === "user" ? "使用者" : "導演"}：${d.content}`)
    .join("\n");

  if (previousDiscussion) {
    contextParts.push(`\n【先前討論紀錄】\n${previousDiscussion}`);
  }

  if (segment.notes) {
    contextParts.push(`\n【使用者筆記】\n${segment.notes}`);
  }

  const effectiveMessage = quickAction
    ? `${quickAction.promptTemplate}\n\n使用者補充：${userMessage || "（無額外補充）"}`
    : userMessage;

  const result = await withTimeout(
    invokeLLM({
      runName: "director-segment-chat",
      messages: [
        {
          role: "system",
          content: `${persona.directorStyle}

你正在與使用者逐段討論一份長腳本的分鏡。你的角色是專業的導演 AI，幫助使用者優化每個分鏡段落。

${contextParts.join("\n")}

回覆規則：
1. 根據使用者的指示提供具體、可執行的建議
2. 如果涉及跨段落的連續性議題，參考前後段資訊作出建議
3. 如果你認為分鏡需要修改，請在回覆末尾附上修改後的分鏡 JSON（用 \`\`\`json 包裹），包含完整的 7 個欄位
4. 如果不需要修改分鏡結構，只需要提供文字回覆即可
5. 在建議中使用具體數值和專業術語（如鏡頭名稱、光線類型、色彩方案代碼）`,
        },
        {
          role: "user",
          content: effectiveMessage,
        },
      ],
      maxTokens: 4096,
    }),
    45_000,
    "分鏡討論"
  );

  const replyText =
    typeof result.choices[0]?.message?.content === "string"
      ? result.choices[0].message.content
      : "";

  // Try to extract updated storyboard JSON from the reply
  let updatedStoryboard: ScriptSegment["storyboard"] | undefined;
  const jsonMatch = replyText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.sceneHeading || parsed.visualDescription) {
        updatedStoryboard = {
          sceneHeading: parsed.sceneHeading ?? segment.storyboard.sceneHeading,
          visualDescription:
            parsed.visualDescription ?? segment.storyboard.visualDescription,
          dialogue: parsed.dialogue ?? segment.storyboard.dialogue,
          soundDesign: parsed.soundDesign ?? segment.storyboard.soundDesign,
          cameraDirection:
            parsed.cameraDirection ?? segment.storyboard.cameraDirection,
          duration: parsed.duration ?? segment.storyboard.duration,
          mood: parsed.mood ?? segment.storyboard.mood,
        };
      }
    } catch {
      // JSON parse failed — just return text reply
    }
  }

  return { reply: replyText, updatedStoryboard };
}

function generateExport(
  segments: ScriptSegment[],
  format: string,
  options: {
    customColumns?: Array<{ header: string; field: string }>;
    includeDiscussion?: boolean;
    includeCostar?: boolean;
    customTemplate?: string;
  }
): string {
  switch (format) {
    case "json":
      return JSON.stringify(
        segments.map(seg => ({
          index: seg.index,
          ...seg.storyboard,
          rawText: seg.rawText,
          status: seg.status,
          ...(options.includeCostar && seg.costar
            ? { costar: seg.costar }
            : {}),
          ...(options.includeDiscussion ? { discussion: seg.discussion } : {}),
        })),
        null,
        2
      );

    case "csv": {
      const cols = options.customColumns ?? [
        { header: "序號", field: "index" },
        { header: "場景", field: "sceneHeading" },
        { header: "視覺描述", field: "visualDescription" },
        { header: "對白", field: "dialogue" },
        { header: "音效", field: "soundDesign" },
        { header: "鏡頭", field: "cameraDirection" },
        { header: "時長", field: "duration" },
        { header: "氛圍", field: "mood" },
        { header: "狀態", field: "status" },
      ];
      const escapeCSV = (val: string) => {
        const s = (val ?? "").replace(/"/g, '""');
        // Wrap in quotes if contains comma, newline, or double-quote per RFC 4180
        return /[",\n\r]/.test(s) ? `"${s}"` : s;
      };
      const header = cols.map(c => escapeCSV(c.header)).join(",");
      const rows = segments.map(seg => {
        const flat: Record<string, string> = {
          index: String(seg.index + 1),
          ...seg.storyboard,
          rawText: seg.rawText,
          status: seg.status,
        };
        return cols.map(c => escapeCSV(flat[c.field] ?? "")).join(",");
      });
      return [header, ...rows].join("\n");
    }

    case "markdown": {
      return segments
        .map((seg, i) => {
          const lines = [
            `## 分鏡 ${i + 1}：${seg.storyboard.sceneHeading}`,
            "",
            `**視覺描述：** ${seg.storyboard.visualDescription}`,
            "",
            seg.storyboard.dialogue
              ? `**對白：**\n> ${seg.storyboard.dialogue.replace(/\n/g, "\n> ")}`
              : "",
            "",
            `**音效設計：** ${seg.storyboard.soundDesign}`,
            `**鏡頭運動：** ${seg.storyboard.cameraDirection}`,
            `**預估時長：** ${seg.storyboard.duration}`,
            `**情緒氛圍：** ${seg.storyboard.mood}`,
            `**狀態：** ${seg.status}`,
          ];
          if (options.includeDiscussion && seg.discussion.length > 0) {
            lines.push("", "### 討論紀錄", "");
            seg.discussion.forEach(d => {
              lines.push(
                `- **${d.role === "user" ? "使用者" : "導演"}**：${d.content}`
              );
            });
          }
          return lines.filter(Boolean).join("\n");
        })
        .join("\n\n---\n\n");
    }

    case "srt": {
      let timeOffset = 0;
      return segments
        .map((seg, i) => {
          const durationSec = parseDurationToSeconds(seg.storyboard.duration);
          const start = formatSrtTime(timeOffset);
          const end = formatSrtTime(timeOffset + durationSec);
          timeOffset += durationSec;
          const text =
            seg.storyboard.dialogue || seg.storyboard.visualDescription;
          return `${i + 1}\n${start} --> ${end}\n${text}`;
        })
        .join("\n\n");
    }

    case "fdx": {
      const elements = segments
        .map(seg => {
          const parts: string[] = [];
          if (seg.storyboard.sceneHeading) {
            parts.push(
              `    <Paragraph Type="Scene Heading"><Text>${escapeXml(seg.storyboard.sceneHeading)}</Text></Paragraph>`
            );
          }
          if (seg.storyboard.visualDescription) {
            parts.push(
              `    <Paragraph Type="Action"><Text>${escapeXml(seg.storyboard.visualDescription)}</Text></Paragraph>`
            );
          }
          if (seg.storyboard.dialogue) {
            parts.push(
              `    <Paragraph Type="Dialogue"><Text>${escapeXml(seg.storyboard.dialogue)}</Text></Paragraph>`
            );
          }
          return parts.join("\n");
        })
        .join("\n");
      return `<?xml version="1.0" encoding="UTF-8"?>\n<FinalDraft DocumentType="Script" Template="No">\n  <Content>\n${elements}\n  </Content>\n</FinalDraft>`;
    }

    case "custom": {
      if (!options.customTemplate) return JSON.stringify(segments, null, 2);
      return segments
        .map((seg, i) => {
          let out = options.customTemplate!;
          out = out.replace(/\{\{index\}\}/g, String(i + 1));
          out = out.replace(
            /\{\{sceneHeading\}\}/g,
            seg.storyboard.sceneHeading
          );
          out = out.replace(
            /\{\{visualDescription\}\}/g,
            seg.storyboard.visualDescription
          );
          out = out.replace(/\{\{dialogue\}\}/g, seg.storyboard.dialogue);
          out = out.replace(/\{\{soundDesign\}\}/g, seg.storyboard.soundDesign);
          out = out.replace(
            /\{\{cameraDirection\}\}/g,
            seg.storyboard.cameraDirection
          );
          out = out.replace(/\{\{duration\}\}/g, seg.storyboard.duration);
          out = out.replace(/\{\{mood\}\}/g, seg.storyboard.mood);
          out = out.replace(/\{\{status\}\}/g, seg.status);
          out = out.replace(/\{\{rawText\}\}/g, seg.rawText);
          return out;
        })
        .join("\n\n");
    }

    default:
      return JSON.stringify(segments, null, 2);
  }
}

function parseDurationToSeconds(duration: string): number {
  const minMatch = duration.match(/(\d+)\s*分/);
  const secMatch = duration.match(/(\d+)\s*秒/);
  const numMatch = duration.match(/^(\d+(?:\.\d+)?)$/);
  let total = 0;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);
  if (!minMatch && !secMatch && numMatch) total = parseFloat(numMatch[1]);
  return total || 5;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Planning Phase Prompts ─────────────────────────────────────────────────

const MAX_PLANNING_DISCUSSION_MESSAGES = 12;

const PLANNING_PHASE_PROMPTS: Record<
  PlanningPhase,
  {
    systemGuide: string;
    warmthFocus: string;
  }
> = {
  concept: {
    systemGuide: `你正在幫助使用者進行「核心概念」階段的討論。
這是整個長腳本規劃的第一步，目標是釐清：
1. 核心主題 — 這個作品要傳達什麼？
2. 目標觀眾 — 誰最需要這個故事？
3. 核心情感 — 觀眾看完後應該帶走什麼感受？
4. 創作願景 — 你希望這個作品呈現什麼樣的風貌？

引導使用者慢慢思考，不要急著下結論。用溫暖的語氣探索他們內心真正想表達的東西。`,
    warmthFocus: `注意：在概念探索階段特別關注「溫度」— 這個故事背後有什麼個人經歷或感受？是什麼驅動了創作慾望？幫助使用者挖掘最真誠的動機。`,
  },
  outline: {
    systemGuide: `你正在幫助使用者進行「故事大綱」階段的討論。
在這個階段，需要建構：
1. 故事梗概 — 完整的故事弧線（開端→發展→高潮→結尾）
2. 情感弧線 — 觀眾的情緒旅程設計
3. 關鍵轉折點 — 讓故事有記憶點的轉折
4. 角色設計 — 每個角色的情感旅程

重點是讓故事有「呼吸感」，不要太密也不要太鬆。每個情節轉折都要有情感理由。`,
    warmthFocus: `注意：在大綱階段注重「深層敘事」— 每個角色行為背後的真實動機是什麼？觀眾什麼時候會產生共鳴？什麼場景能讓人「感同身受」？強調人性的溫柔面向。`,
  },
  "scene-planning": {
    systemGuide: `你正在幫助使用者進行「場景規劃」階段的討論。
逐場景深入設計：
1. 場景標題與描述
2. 情緒氛圍目標
3. 角色互動細節
4. 場景地點與時間
5. 預估時長
6. 特殊備註

每個場景都要服務於整體情感弧線。思考場景之間的過渡是否自然。`,
    warmthFocus: `注意：在場景規劃中特別關注「細節的溫度」— 一個角色的小動作、一束光線、一段沉默…這些微小的細節往往最能打動人心。鼓勵使用者思考每個場景中最「人性化」的一刻。`,
  },
  "emotional-depth": {
    systemGuide: `你正在幫助使用者進行「情感深度」分析與優化。
這是最重要的規劃階段，需要：
1. 情感節拍分析 — 每個場景的情感強度（1-10 分）
2. 溫度評估 — 故事整體的「溫暖感」是否足夠？
3. 深度洞察 — 哪些地方可以更深入？
4. 共鳴點識別 — 哪些場景最容易引起觀眾共鳴？
5. 療癒元素建議 — 如何加入更多療癒和撫慰的力量？

你的角色是一位富有同理心的戲劇顧問，幫助使用者讓作品更有溫度、更打動人心。`,
    warmthFocus: `核心任務：分析並增強「作品溫度」。溫度來自：
- 真實的情感表達（不是表面的煽情）
- 角色之間真誠的連結
- 給觀眾留下思考和感受的空間
- 不完美中的美好
- 安靜但有力量的時刻
提供具體、可執行的溫度提升建議。`,
  },
  schedule: {
    systemGuide: `你正在幫助使用者進行「排程整合」階段的規劃。
將前面所有的規劃成果轉化為可執行的製作排程：
1. 拆分製作里程碑
2. 估算每個階段所需時間
3. 識別優先順序和依賴關係
4. 建議團隊分工（如果適用）
5. 設定品質檢查點

排程應該留有充裕的創意調整空間，不要讓時間壓力犧牲作品品質。`,
    warmthFocus: `注意：排程規劃也要保持「療癒」精神 — 避免過度緊迫的時間安排，留出反思和調整的空間。好的作品需要沉澱的時間。建議加入「靈感休息日」。`,
  },
};

async function discussPlanningPhase(
  phase: PlanningPhase,
  messages: PlanningMessage[],
  userMessage: string,
  personality: "calm" | "creative" | "technical",
  sessionContext?: {
    concept?: ScriptPlanningSession["concept"];
    outline?: ScriptPlanningSession["outline"];
    scenes?: ScriptPlanningSession["scenes"];
    emotionalBeats?: ScriptPlanningSession["emotionalBeats"];
  }
): Promise<{ reply: string; phaseSummary?: string }> {
  const persona =
    PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;
  const phaseConfig = PLANNING_PHASE_PROMPTS[phase];
  const fullDirectorPrompt = buildDirectorSystemPrompt(personality);

  // Build context from previous phases
  const contextParts: string[] = [];

  if (sessionContext?.concept) {
    const c = sessionContext.concept;
    contextParts.push(`【已確立的核心概念】
主題：${c.theme}
目標觀眾：${c.targetAudience}
核心情感：${c.coreEmotion}
創作願景：${c.vision}`);
  }

  if (sessionContext?.outline) {
    const o = sessionContext.outline;
    contextParts.push(`【已建構的故事大綱】
梗概：${o.synopsis}
情感弧線：${o.emotionalArc}
關鍵轉折：${o.keyTurningPoints.join("→")}
角色：${o.characters.map(ch => `${ch.name}（${ch.role}）`).join("、")}`);
  }

  if (sessionContext?.scenes && sessionContext.scenes.length > 0) {
    const sceneSummary = sessionContext.scenes
      .map(
        (s, i) =>
          `#${i + 1} ${s.title}（${s.mood}）— ${s.emotionalGoal}`
      )
      .join("\n");
    contextParts.push(`【已規劃的場景列表】\n${sceneSummary}`);
  }

  if (
    sessionContext?.emotionalBeats &&
    sessionContext.emotionalBeats.length > 0
  ) {
    const beatsSummary = sessionContext.emotionalBeats
      .map(
        b =>
          `${b.label}：${b.emotion}（強度 ${b.intensity}/10）— ${b.warmthNote}`
      )
      .join("\n");
    contextParts.push(`【情感節拍分析】\n${beatsSummary}`);
  }

  // Previous discussion for this phase
  const previousDiscussion = messages
    .slice(-MAX_PLANNING_DISCUSSION_MESSAGES)
    .map(d => `${d.role === "user" ? "使用者" : "導演"}：${d.content}`)
    .join("\n");

  if (previousDiscussion) {
    contextParts.push(`\n【本階段先前的討論紀錄】\n${previousDiscussion}`);
  }

  const result = await withTimeout(
    invokeLLM({
      runName: "director-planning-discuss",
      messages: [
        {
          role: "system",
          content: `${fullDirectorPrompt}

【長腳本規劃模式 — ${phase} 階段】

${phaseConfig.systemGuide}

${phaseConfig.warmthFocus}

${contextParts.length > 0 ? contextParts.join("\n\n") : "（這是規劃的開始，尚無先前資訊）"}

${persona.proactiveHint}

回覆規則：
1. 用溫暖、鼓勵的語氣引導使用者深入思考
2. 提供具體、可執行的建議，不要空泛
3. 適時提出引導性問題，幫助使用者挖掘更深層的想法
4. 如果使用者的想法可以更深入，溫和地引導他們思考「為什麼」
5. 慶祝每一個靈感的誕生，每一個想法都值得被珍惜
6. 回覆末尾如果有適合生成的摘要結構（如核心概念、大綱等），用 \`\`\`json 包裹`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      maxTokens: 4096,
    }),
    45_000,
    "規劃討論"
  );

  const replyText =
    typeof result.choices[0]?.message?.content === "string"
      ? result.choices[0].message.content
      : "";

  // Try to extract structured summary from the reply
  let phaseSummary: string | undefined;
  const jsonMatch = replyText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    phaseSummary = jsonMatch[1];
  }

  return { reply: replyText, phaseSummary };
}

async function analyzeEmotionalDepth(
  scenes: ScriptPlanningSession["scenes"],
  concept: ScriptPlanningSession["concept"],
  outline: ScriptPlanningSession["outline"],
  personality: "calm" | "creative" | "technical"
): Promise<{
  emotionalBeats: ScriptPlanningSession["emotionalBeats"];
  warmthScore: number;
  depthAnalysis: string;
}> {
  const persona =
    PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;

  const sceneSummary = scenes
    .map(
      (s, i) =>
        `#${i + 1} 「${s.title}」\n描述：${s.description}\n氛圍：${s.mood}\n情感目標：${s.emotionalGoal}\n角色：${s.characters.join("、")}\n地點：${s.location}`
    )
    .join("\n\n");

  const conceptStr = concept
    ? `主題：${concept.theme}，核心情感：${concept.coreEmotion}，目標觀眾：${concept.targetAudience}`
    : "尚未定義";

  const outlineStr = outline
    ? `梗概：${outline.synopsis}\n情感弧線：${outline.emotionalArc}`
    : "尚未定義";

  const result = await withTimeout(
    invokeLLM({
      runName: "director-emotional-analysis",
      messages: [
        {
          role: "system",
          content: `${persona.directorStyle}

你是一位專精於「情感深度分析」的戲劇顧問。你的任務是分析一個長腳本規劃案的情感結構，評估其「溫度」和「深度」。

【核心概念】${conceptStr}
【故事大綱】${outlineStr}

【場景列表】
${sceneSummary}

請分析：
1. 每個場景的情感節拍（emotion、intensity 1-10、warmthNote 溫度建議）
2. 整體 warmthScore（1-10，10 是最溫暖）
3. 深度分析報告（哪些地方可以更深入、更有溫度）`,
        },
        {
          role: "user",
          content: "請為這個作品進行完整的情感深度分析。",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "emotional_depth_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              emotionalBeats: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sceneIndex: { type: "number" },
                    label: { type: "string" },
                    emotion: { type: "string" },
                    intensity: { type: "number" },
                    warmthNote: { type: "string" },
                  },
                  required: [
                    "label",
                    "emotion",
                    "intensity",
                    "warmthNote",
                  ],
                  additionalProperties: false,
                },
              },
              warmthScore: { type: "number" },
              depthAnalysis: { type: "string" },
            },
            required: ["emotionalBeats", "warmthScore", "depthAnalysis"],
            additionalProperties: false,
          },
        },
      },
    }),
    45_000,
    "情感深度分析"
  );

  const content = result.choices[0]?.message?.content;
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return {
      emotionalBeats: parsed.emotionalBeats ?? [],
      warmthScore: parsed.warmthScore ?? 5,
      depthAnalysis: parsed.depthAnalysis ?? "",
    };
  } catch {
    return { emotionalBeats: [], warmthScore: 5, depthAnalysis: "" };
  }
}

// ─── Core Director AI Logic ─────────────────────────────────────────────────

async function runDirectorAI(
  messages: Array<{ role: string; content: string }>,
  saveToNotes: boolean,
  userId: number,
  personality: "calm" | "creative" | "technical" = "creative"
) {
  const persona =
    PERSONALITY_PROMPTS[personality] ?? PERSONALITY_PROMPTS.creative;
  const fullDirectorPrompt = buildDirectorSystemPrompt(personality);

  // Build RAG memory context for this user (gracefully degrade if unavailable)
  let memoryContext = "";
  try {
    const lastUserMsg =
      [...messages].reverse().find(m => m.role === "user")?.content ?? "";
    if (lastUserMsg) {
      memoryContext = await buildMemoryContext(userId, lastUserMsg);
    }
  } catch {
    // RAG unavailable — continue without memory
  }

  const memorySection = memoryContext
    ? `\n\n【用戶歷史偏好記憶】\n${memoryContext}\n請參考用戶的歷史偏好來調整建議。`
    : "";

  // Step 1: Factual grounding with personality-aware research style + full platform knowledge
  const researchResult = await withTimeout(
    invokeLLM({
      runName: "director-research",
      messages: [
        {
          role: "system",
          content: `${persona.researchStyle}

你深入了解 Healing Studio 平台所有生成模型和工具：
${GENERATION_MODALITIES_KNOWLEDGE}
${WORKFLOW_KNOWLEDGE}
${memorySection}`,
        },
        ...messages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    }),
    30_000,
    "導演AI研究"
  );
  const researchContent =
    typeof researchResult.choices[0]?.message?.content === "string"
      ? researchResult.choices[0].message.content
      : "";

  // Step 2: Creative orchestration with CO-STAR framework + full director knowledge
  const scriptResult = await withTimeout(
    invokeLLM({
      runName: "director-costar-generate",
      messages: [
        {
          role: "system",
          content: `${fullDirectorPrompt}

基於以下研究資料，創作一個結構化的 JSON 腳本：
${researchContent}
${persona.proactiveHint}

輸出 JSON 格式必須包含：
- context, situation, task, action, result（CO-STAR 各欄位）
- visualPrompt：視覺提示詞（英文，包含推薦模型名稱和正面解剖學約束）
- audioScript：語音腳本（繁體中文，標明推薦的 TTS 模型）
- musicVibe：音樂風格描述（英文，標明推薦的音樂模型）
- proactiveQuestion：主動向使用者提出的引導性問題（繁體中文，根據使用者描述中缺少的元素提問）`,
        },
        ...messages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "costar_script",
          strict: true,
          schema: {
            type: "object",
            properties: {
              context: { type: "string" },
              situation: { type: "string" },
              task: { type: "string" },
              action: { type: "string" },
              result: { type: "string" },
              visualPrompt: { type: "string" },
              audioScript: { type: "string" },
              musicVibe: { type: "string" },
              proactiveQuestion: { type: "string" },
            },
            required: [
              "context",
              "situation",
              "task",
              "action",
              "result",
              "visualPrompt",
              "audioScript",
              "musicVibe",
              "proactiveQuestion",
            ],
            additionalProperties: false,
          },
        },
      },
    }),
    45_000,
    "導演AI創作"
  );

  const scriptContent = scriptResult.choices[0]?.message?.content;
  let script;
  try {
    script =
      typeof scriptContent === "string"
        ? JSON.parse(scriptContent)
        : scriptContent;
  } catch {
    script = {
      context: "",
      situation: "",
      task: "",
      action: "",
      result: "",
      visualPrompt: "",
      audioScript: "",
      musicVibe: "",
      proactiveQuestion: "",
    };
  }

  // Save to project notes if requested
  if (saveToNotes && userId) {
    await db.createProjectNote({
      userId,
      title: `導演 AI 腳本 (${personality}) - ${new Date().toLocaleDateString("zh-TW")}`,
      content: researchContent,
      scriptJson: script,
      noteType: "script",
    });
  }

  return { research: researchContent, script, personality };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const directorRouter = router({
  /** Main chat endpoint — runs dual-engine Director AI */
  chat: protectedProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.string(),
            content: z.string(),
          })
        ),
        saveToNotes: z.boolean().default(false),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return runDirectorAI(
        input.messages,
        input.saveToNotes,
        ctx.user.id,
        input.personality
      );
    }),

  /** Refine an existing script with follow-up instruction */
  refineScript: protectedProcedure
    .input(
      z.object({
        script: z.object({
          context: z.string(),
          situation: z.string(),
          task: z.string(),
          action: z.string(),
          result: z.string(),
          visualPrompt: z.string(),
          audioScript: z.string(),
          musicVibe: z.string(),
          proactiveQuestion: z.string().optional(),
        }),
        instruction: z.string().min(1),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ input }) => {
      const fullPrompt = buildDirectorSystemPrompt(input.personality);

      const result = await withTimeout(
        invokeLLM({
          runName: "director-costar-refine",
          messages: [
            {
              role: "system",
              content: `${fullPrompt}

你收到一份已存在的 CO-STAR 腳本，以及使用者的修改指示。
請根據指示修改腳本，保留未被要求更動的部分。
輸出完整的 JSON 腳本。`,
            },
            {
              role: "user",
              content: `現有腳本：\n${JSON.stringify(input.script, null, 2)}\n\n修改指示：${input.instruction}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "costar_script",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  context: { type: "string" },
                  situation: { type: "string" },
                  task: { type: "string" },
                  action: { type: "string" },
                  result: { type: "string" },
                  visualPrompt: { type: "string" },
                  audioScript: { type: "string" },
                  musicVibe: { type: "string" },
                  proactiveQuestion: { type: "string" },
                },
                required: [
                  "context",
                  "situation",
                  "task",
                  "action",
                  "result",
                  "visualPrompt",
                  "audioScript",
                  "musicVibe",
                  "proactiveQuestion",
                ],
                additionalProperties: false,
              },
            },
          },
        }),
        30_000,
        "腳本修改"
      );

      const content = result.choices[0]?.message?.content;
      try {
        return typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        return input.script;
      }
    }),

  /** Get available templates */
  templates: protectedProcedure.query(() => {
    return DIRECTOR_TEMPLATES;
  }),

  /** Save a session snapshot to project notes */
  saveSession: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        sessionData: z.string(), // JSON stringified session
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createProjectNote({
        userId: ctx.user.id,
        title: `[導演對話] ${input.title}`,
        content: input.sessionData,
        noteType: "script",
        tags: ["director-session", input.personality],
      });
      return { id };
    }),

  /** List saved director sessions */
  listSessions: protectedProcedure.query(async ({ ctx }) => {
    const notes = await db.getProjectNotesByUser(ctx.user.id);
    return notes
      .filter(n => n.noteType === "script" && n.title.startsWith("[導演對話]"))
      .map(n => ({
        id: n.id,
        title: n.title.replace("[導演對話] ", ""),
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
  }),

  /** Load a saved session */
  loadSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return null;
      return {
        id: note.id,
        title: note.title.replace("[導演對話] ", ""),
        sessionData: note.content,
        createdAt: note.createdAt,
      };
    }),

  /** Delete a saved session */
  deleteSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return { success: false };
      await db.deleteProjectNote(input.id);
      return { success: true };
    }),

  /** Preferences CRUD */
  preferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      return db.getDirectorPreferences(ctx.user.id);
    }),
    update: protectedProcedure
      .input(
        z.object({
          personality: z.enum(["calm", "creative", "technical"]).optional(),
          preferredFormat: z
            .enum(["co-star", "sslcm", "selcm", "free"])
            .optional(),
          customSystemPrompt: z.string().optional(),
          preferencesJson: z.record(z.string(), z.unknown()).optional(),
          onboardingSteps: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.upsertDirectorPreferences(ctx.user.id, input);
        return { id };
      }),
  }),

  // ─── Script Analysis & Discussion System ──────────────────────────────────

  /** Import and parse a long script into storyboard segments */
  importScript: protectedProcedure
    .input(
      z.object({
        rawContent: z.string().min(1).max(100000),
        title: z.string().min(1).max(255),
        sourceFormat: z.string().default("plaintext"),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ input }) => {
      const segments = await parseScriptIntoSegments(
        input.rawContent,
        input.sourceFormat,
        input.personality
      );
      const fullSegments: ScriptSegment[] = segments.map(seg => ({
        ...seg,
        discussion: [],
        status: "draft" as const,
      }));
      return {
        id: `script-${Date.now()}`,
        title: input.title,
        rawContent: input.rawContent,
        sourceFormat: input.sourceFormat,
        segments: fullSegments,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),

  /** Discuss a specific segment with AI — supports quick actions, image references, and adjacent segment context */
  discussSegment: protectedProcedure
    .input(
      z.object({
        segment: z.object({
          id: z.string(),
          index: z.number(),
          rawText: z.string(),
          storyboard: z.object({
            sceneHeading: z.string(),
            visualDescription: z.string(),
            dialogue: z.string(),
            soundDesign: z.string(),
            cameraDirection: z.string(),
            duration: z.string(),
            mood: z.string(),
          }),
          costar: z
            .object({
              context: z.string(),
              situation: z.string(),
              task: z.string(),
              action: z.string(),
              result: z.string(),
              visualPrompt: z.string(),
              audioScript: z.string(),
              musicVibe: z.string(),
              proactiveQuestion: z.string().optional(),
            })
            .optional(),
          characters: z.array(z.string()).optional(),
          locations: z.array(z.string()).optional(),
          notes: z.string().optional(),
          discussion: z.array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
              imageUrl: z.string().optional(),
              quickAction: z.string().optional(),
              timestamp: z.string(),
            })
          ),
          status: z.enum(["pending", "draft", "refined", "approved"]),
        }),
        message: z.string().min(1),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
        quickActionId: z.string().optional(),
        imageUrl: z.string().optional(),
        /** Adjacent segments for continuity-aware discussion */
        prevSegment: z
          .object({
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
          })
          .optional(),
        nextSegment: z
          .object({
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const adjacentSegments = {
        prev: input.prevSegment
          ? ({
              ...input.prevSegment,
              id: "",
              rawText: "",
              discussion: [],
              status: "draft" as const,
            } as ScriptSegment)
          : undefined,
        next: input.nextSegment
          ? ({
              ...input.nextSegment,
              id: "",
              rawText: "",
              discussion: [],
              status: "draft" as const,
            } as ScriptSegment)
          : undefined,
      };
      const result = await discussSegmentWithAI(
        input.segment as ScriptSegment,
        input.message,
        input.personality,
        input.quickActionId,
        input.imageUrl,
        adjacentSegments
      );
      return result;
    }),

  /** Get available quick actions for multi-modal discussion */
  quickActions: protectedProcedure.query(() => {
    return QUICK_ACTIONS;
  }),

  /** Export segments in various formats */
  exportScript: protectedProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            id: z.string(),
            index: z.number(),
            rawText: z.string(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
            costar: z
              .object({
                context: z.string(),
                situation: z.string(),
                task: z.string(),
                action: z.string(),
                result: z.string(),
                visualPrompt: z.string(),
                audioScript: z.string(),
                musicVibe: z.string(),
                proactiveQuestion: z.string().optional(),
              })
              .optional(),
            discussion: z.array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
                imageUrl: z.string().optional(),
                quickAction: z.string().optional(),
                timestamp: z.string(),
              })
            ),
            status: z.enum(["pending", "draft", "refined", "approved"]),
          })
        ),
        format: z.enum(["json", "csv", "markdown", "fdx", "srt", "custom"]),
        customColumns: z
          .array(
            z.object({
              header: z.string(),
              field: z.string(),
            })
          )
          .optional(),
        includeDiscussion: z.boolean().default(false),
        includeCostar: z.boolean().default(false),
        customTemplate: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const content = generateExport(
        input.segments as ScriptSegment[],
        input.format,
        {
          customColumns: input.customColumns,
          includeDiscussion: input.includeDiscussion,
          includeCostar: input.includeCostar,
          customTemplate: input.customTemplate,
        }
      );
      return { content, format: input.format };
    }),

  /** Generate CO-STAR storyboard for a specific segment — enriched with discussion insights */
  generateSegmentCostar: protectedProcedure
    .input(
      z.object({
        segment: z.object({
          id: z.string(),
          index: z.number(),
          rawText: z.string(),
          storyboard: z.object({
            sceneHeading: z.string(),
            visualDescription: z.string(),
            dialogue: z.string(),
            soundDesign: z.string(),
            cameraDirection: z.string(),
            duration: z.string(),
            mood: z.string(),
          }),
          /** Include discussion insights in CO-STAR generation for richer output */
          discussion: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string(),
              })
            )
            .optional(),
          characters: z.array(z.string()).optional(),
          locations: z.array(z.string()).optional(),
        }),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ input }) => {
      const persona =
        PERSONALITY_PROMPTS[input.personality] ?? PERSONALITY_PROMPTS.creative;
      const fullPrompt = buildDirectorSystemPrompt(input.personality);

      // Build discussion summary if available — informs CO-STAR with refinements discussed
      const discussionInsights =
        (input.segment.discussion ?? []).length > 0
          ? `\n\n【討論洞察摘要】以下是使用者與導演 AI 討論後的決策：\n${(
              input.segment.discussion ?? []
            )
              .slice(-8)
              .map(
                d => `${d.role === "user" ? "使用者" : "導演"}：${d.content}`
              )
              .join("\n")}\n請將討論中達成的共識融入 CO-STAR 腳本中。`
          : "";

      const characterInfo =
        (input.segment.characters ?? []).length > 0
          ? `\n角色：${input.segment.characters!.join("、")}`
          : "";
      const locationInfo =
        (input.segment.locations ?? []).length > 0
          ? `\n地點：${input.segment.locations!.join("、")}`
          : "";

      const result = await withTimeout(
        invokeLLM({
          runName: "director-segment-costar",
          messages: [
            {
              role: "system",
              content: `${fullPrompt}

根據以下分鏡段落資訊，生成完整的 CO-STAR 腳本結構。

分鏡資訊：
- 場景：${input.segment.storyboard.sceneHeading}
- 視覺：${input.segment.storyboard.visualDescription}
- 對白：${input.segment.storyboard.dialogue}
- 音效：${input.segment.storyboard.soundDesign}
- 鏡頭：${input.segment.storyboard.cameraDirection}
- 時長：${input.segment.storyboard.duration}
- 氛圍：${input.segment.storyboard.mood}${characterInfo}${locationInfo}

原始文本：${input.segment.rawText}
${discussionInsights}

${persona.proactiveHint}

生成要求：
1. visualPrompt 必須是高品質的英文提示詞，包含具體的風格、構圖、光線描述和品質標籤
2. audioScript 必須是完整的繁體中文語音腳本，包含語氣和節奏標註
3. musicVibe 必須是明確的英文音樂風格描述，包含推薦的音樂模型和參數
4. proactiveQuestion 必須根據當前分鏡缺少的元素提出具體且有建設性的問題`,
            },
            {
              role: "user",
              content: "請為這段分鏡生成完整的 CO-STAR 腳本。",
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "costar_script",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  context: { type: "string" },
                  situation: { type: "string" },
                  task: { type: "string" },
                  action: { type: "string" },
                  result: { type: "string" },
                  visualPrompt: { type: "string" },
                  audioScript: { type: "string" },
                  musicVibe: { type: "string" },
                  proactiveQuestion: { type: "string" },
                },
                required: [
                  "context",
                  "situation",
                  "task",
                  "action",
                  "result",
                  "visualPrompt",
                  "audioScript",
                  "musicVibe",
                  "proactiveQuestion",
                ],
                additionalProperties: false,
              },
            },
          },
        }),
        45_000,
        "分鏡 CO-STAR 生成"
      );

      const content = result.choices[0]?.message?.content;
      try {
        return typeof content === "string" ? JSON.parse(content) : content;
      } catch {
        return {
          context: "",
          situation: "",
          task: "",
          action: "",
          result: "",
          visualPrompt: "",
          audioScript: "",
          musicVibe: "",
          proactiveQuestion: "",
        };
      }
    }),

  /** Batch generate CO-STAR for multiple segments */
  batchGenerateCostar: protectedProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            id: z.string(),
            index: z.number(),
            rawText: z.string(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
          })
        ),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ input }) => {
      const persona =
        PERSONALITY_PROMPTS[input.personality] ?? PERSONALITY_PROMPTS.creative;
      const fullPrompt = buildDirectorSystemPrompt(input.personality);

      // Build a combined prompt for all segments
      const segmentsList = input.segments
        .map(
          (seg, i) =>
            `【分鏡 #${seg.index + 1}】\n場景：${seg.storyboard.sceneHeading}\n視覺：${seg.storyboard.visualDescription}\n對白：${seg.storyboard.dialogue}\n音效：${seg.storyboard.soundDesign}\n鏡頭：${seg.storyboard.cameraDirection}\n時長：${seg.storyboard.duration}\n氛圍：${seg.storyboard.mood}\n原文：${seg.rawText.slice(0, 300)}`
        )
        .join("\n\n---\n\n");

      const result = await withTimeout(
        invokeLLM({
          runName: "director-batch-costar",
          messages: [
            {
              role: "system",
              content: `${fullPrompt}

你需要為以下所有分鏡段落批次生成 CO-STAR 腳本結構。
每個分鏡的 CO-STAR 應相互連貫，確保整體敘事流暢。

${segmentsList}

${persona.proactiveHint}

生成要求：
1. 每段 visualPrompt 必須是高品質英文提示詞
2. 每段 audioScript 必須是繁體中文語音腳本
3. 注意段落之間的情緒遞進和視覺風格統一`,
            },
            {
              role: "user",
              content: `請為以上 ${input.segments.length} 個分鏡批次生成 CO-STAR 腳本。`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "batch_costar",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        segmentId: { type: "string" },
                        context: { type: "string" },
                        situation: { type: "string" },
                        task: { type: "string" },
                        action: { type: "string" },
                        result: { type: "string" },
                        visualPrompt: { type: "string" },
                        audioScript: { type: "string" },
                        musicVibe: { type: "string" },
                        proactiveQuestion: { type: "string" },
                      },
                      required: [
                        "segmentId",
                        "context",
                        "situation",
                        "task",
                        "action",
                        "result",
                        "visualPrompt",
                        "audioScript",
                        "musicVibe",
                        "proactiveQuestion",
                      ],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["results"],
                additionalProperties: false,
              },
            },
          },
          maxTokens: 8192,
        }),
        120_000,
        "批次 CO-STAR 生成"
      );

      const content = result.choices[0]?.message?.content;
      try {
        const parsed =
          typeof content === "string" ? JSON.parse(content) : content;
        // Map results back to segment IDs — use segmentId from AI, fallback to input order
        const resultMap: Record<string, Record<string, string>> = {};
        const results = Array.isArray(parsed.results) ? parsed.results : [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i] as {
            segmentId?: string;
            [key: string]: unknown;
          };
          const segId =
            r.segmentId ||
            (i < input.segments.length ? input.segments[i].id : undefined);
          if (segId) {
            resultMap[segId] = r as Record<string, string>;
          }
        }
        return { results: resultMap };
      } catch {
        return { results: {} };
      }
    }),

  /** Analyze the full script holistically — themes, arcs, pacing, character/location distribution */
  analyzeScriptOverview: protectedProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
            characters: z.array(z.string()).optional(),
            locations: z.array(z.string()).optional(),
          })
        ),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ input }) => {
      const persona =
        PERSONALITY_PROMPTS[input.personality] ?? PERSONALITY_PROMPTS.creative;

      const segmentSummaries = input.segments
        .map(
          seg =>
            `#${seg.index + 1} ${seg.storyboard.sceneHeading} | ${seg.storyboard.mood} | ${seg.storyboard.duration} | 角色：${(seg.characters ?? []).join(",")} | 地點：${(seg.locations ?? []).join(",")}`
        )
        .join("\n");

      const totalDurationSec = input.segments.reduce(
        (sum, seg) => sum + parseDurationToSeconds(seg.storyboard.duration),
        0
      );
      const totalMin = Math.floor(totalDurationSec / 60);
      const totalSec = Math.round(totalDurationSec % 60);

      const result = await withTimeout(
        invokeLLM({
          runName: "director-global-analysis",
          messages: [
            {
              role: "system",
              content: `${persona.directorStyle}

你是一位專業的腳本分析師。請對整部腳本進行全局分析。

分鏡列表：
${segmentSummaries}

總時長估算：${totalMin}分${totalSec}秒 / 共 ${input.segments.length} 個分鏡

請提供：
1. themes: 作品的核心主題（2-4 個）
2. characters: 出場角色列表及其出場分鏡索引
3. locations: 場景地點列表及其使用分鏡索引
4. moodDistribution: 各氛圍出現次數統計
5. pacingNotes: 節奏分析（哪些地方偏快/偏慢、張力曲線是否合理）
6. overallSuggestion: 整體改善建議（1-3 段，具體可執行）`,
            },
            {
              role: "user",
              content: "請分析整部腳本。",
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "script_overview",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  themes: { type: "array", items: { type: "string" } },
                  characters: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        segmentIndices: {
                          type: "array",
                          items: { type: "number" },
                        },
                      },
                      required: ["name", "segmentIndices"],
                      additionalProperties: false,
                    },
                  },
                  locations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        segmentIndices: {
                          type: "array",
                          items: { type: "number" },
                        },
                      },
                      required: ["name", "segmentIndices"],
                      additionalProperties: false,
                    },
                  },
                  moodDistribution: {
                    type: "object",
                    additionalProperties: { type: "number" },
                  },
                  pacingNotes: { type: "string" },
                  overallSuggestion: { type: "string" },
                },
                required: [
                  "themes",
                  "characters",
                  "locations",
                  "moodDistribution",
                  "pacingNotes",
                  "overallSuggestion",
                ],
                additionalProperties: false,
              },
            },
          },
        }),
        45_000,
        "腳本全局分析"
      );

      const content = result.choices[0]?.message?.content;
      try {
        const parsed =
          typeof content === "string" ? JSON.parse(content) : content;
        return {
          totalDuration: `${totalMin}分${totalSec}秒`,
          segmentCount: input.segments.length,
          ...parsed,
        } as ScriptOverview;
      } catch {
        return {
          totalDuration: `${totalMin}分${totalSec}秒`,
          segmentCount: input.segments.length,
          themes: [],
          characters: [],
          locations: [],
          moodDistribution: {},
          pacingNotes: "",
          overallSuggestion: "",
        } as ScriptOverview;
      }
    }),

  // ─── Quick Generation Pipeline ──────────────────────────────────────────

  /** Get available generation models grouped by modality for the model picker */
  generationModels: protectedProcedure.query(() => {
    const byCategory = getAllPricingByCategory();
    const relevantCategories: ModelCategory[] = [
      "text-to-image",
      "text-to-video",
      "text-to-audio",
      "text-to-speech",
    ];
    const result: Record<
      string,
      Array<{
        modelId: string;
        label: string;
        provider: string;
        tier: string;
        basePoints: number;
        unit: string;
        minPoints: number;
        maxPoints: number;
        pointsPerSecond?: number;
        pointsPer1kChars?: number;
        available: boolean;
      }>
    > = {};
    for (const cat of relevantCategories) {
      const models = byCategory[cat] ?? [];
      result[cat] = models.map(m => {
        const avail = checkModelAvailability(m.modelId);
        return {
          modelId: m.modelId,
          label: m.label,
          provider: m.provider,
          tier: m.tier,
          basePoints: m.basePoints,
          unit: m.unit,
          minPoints: m.minPoints,
          maxPoints: m.maxPoints,
          pointsPerSecond: m.pointsPerSecond,
          pointsPer1kChars: m.pointsPer1kChars,
          available: avail.available,
        };
      });
    }
    return result;
  }),

  /** Estimate generation cost for a segment with user-selected models */
  estimateSegmentCost: protectedProcedure
    .input(
      z.object({
        tasks: z.array(
          z.object({
            modality: z.enum(["image", "video", "audio", "voice"]),
            modelId: z.string(),
            durationSec: z.number().optional(),
            charCount: z.number().optional(),
          })
        ),
      })
    )
    .query(({ input }) => {
      return input.tasks.map(task => {
        const estimate = estimatePoints(task.modelId, {
          durationSec: task.durationSec,
          charCount: task.charCount,
        });
        const pricing = getModelPricing(task.modelId);
        const avail = checkModelAvailability(task.modelId);
        return {
          modality: task.modality,
          modelId: task.modelId,
          modelLabel: pricing?.label ?? task.modelId,
          points: estimate.totalPoints,
          breakdown: estimate.breakdown,
          available: avail.available,
          availabilityNote: avail.reason,
        };
      });
    }),

  // ─── Long Script Planning Mode ──────────────────────────────────────────

  /** Discuss within a specific planning phase with AI */
  planningDiscuss: protectedProcedure
    .input(
      z.object({
        phase: z.enum([
          "concept",
          "outline",
          "scene-planning",
          "emotional-depth",
          "schedule",
        ]),
        message: z.string().min(1),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
        previousMessages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
              timestamp: z.string(),
              phase: z
                .enum([
                  "concept",
                  "outline",
                  "scene-planning",
                  "emotional-depth",
                  "schedule",
                ])
                .optional(),
            })
          )
          .default([]),
        sessionContext: z
          .object({
            concept: z
              .object({
                theme: z.string(),
                targetAudience: z.string(),
                coreEmotion: z.string(),
                vision: z.string(),
              })
              .optional(),
            outline: z
              .object({
                synopsis: z.string(),
                emotionalArc: z.string(),
                keyTurningPoints: z.array(z.string()),
                characters: z.array(
                  z.object({
                    name: z.string(),
                    role: z.string(),
                    emotionalJourney: z.string(),
                  })
                ),
              })
              .optional(),
            scenes: z
              .array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  description: z.string(),
                  mood: z.string(),
                  emotionalGoal: z.string(),
                  characters: z.array(z.string()),
                  location: z.string(),
                  duration: z.string(),
                  notes: z.string(),
                })
              )
              .optional(),
            emotionalBeats: z
              .array(
                z.object({
                  sceneIndex: z.number().optional(),
                  label: z.string(),
                  emotion: z.string(),
                  intensity: z.number(),
                  warmthNote: z.string(),
                })
              )
              .optional(),
          })
          .default({}),
      })
    )
    .mutation(async ({ input }) => {
      return discussPlanningPhase(
        input.phase,
        input.previousMessages as PlanningMessage[],
        input.message,
        input.personality,
        input.sessionContext
      );
    }),

  /** Analyze emotional depth of the planned scenes */
  planningAnalyzeDepth: protectedProcedure
    .input(
      z.object({
        scenes: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            mood: z.string(),
            emotionalGoal: z.string(),
            characters: z.array(z.string()),
            location: z.string(),
            duration: z.string(),
            notes: z.string(),
          })
        ),
        concept: z
          .object({
            theme: z.string(),
            targetAudience: z.string(),
            coreEmotion: z.string(),
            vision: z.string(),
          })
          .optional(),
        outline: z
          .object({
            synopsis: z.string(),
            emotionalArc: z.string(),
            keyTurningPoints: z.array(z.string()),
            characters: z.array(
              z.object({
                name: z.string(),
                role: z.string(),
                emotionalJourney: z.string(),
              })
            ),
          })
          .optional(),
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ input }) => {
      return analyzeEmotionalDepth(
        input.scenes,
        input.concept,
        input.outline,
        input.personality
      );
    }),

  /** Save a planning session to project notes */
  savePlanningSession: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        sessionData: z.string(), // JSON stringified ScriptPlanningSession
        personality: z
          .enum(["calm", "creative", "technical"])
          .default("creative"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createProjectNote({
        userId: ctx.user.id,
        title: `[長腳本規劃] ${input.title}`,
        content: input.sessionData,
        noteType: "script",
        tags: ["planning-session", input.personality, "long-script"],
      });
      return { id };
    }),

  /** List saved planning sessions */
  listPlanningSessions: protectedProcedure.query(async ({ ctx }) => {
    const notes = await db.getProjectNotesByUser(ctx.user.id);
    return notes
      .filter(
        n => n.noteType === "script" && n.title.startsWith("[長腳本規劃]")
      )
      .map(n => ({
        id: n.id,
        title: n.title.replace("[長腳本規劃] ", ""),
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }));
  }),

  /** Load a saved planning session */
  loadPlanningSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return null;
      return {
        id: note.id,
        title: note.title.replace("[長腳本規劃] ", ""),
        sessionData: note.content,
        createdAt: note.createdAt,
      };
    }),

  /** Delete a saved planning session */
  deletePlanningSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) return { success: false };
      await db.deleteProjectNote(input.id);
      return { success: true };
    }),

  /** Create calendar milestones from planning session */
  planningCreateMilestones: protectedProcedure
    .input(
      z.object({
        milestones: z.array(
          z.object({
            title: z.string(),
            targetDate: z.number(), // timestamp
            phase: z.enum([
              "concept",
              "outline",
              "scene-planning",
              "emotional-depth",
              "schedule",
            ]),
          })
        ),
        planningTitle: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ids: number[] = [];
      for (const m of input.milestones) {
        const id = await db.createProjectNote({
          userId: ctx.user.id,
          title: `[規劃里程碑] ${input.planningTitle} — ${m.title}`,
          content: `規劃階段：${m.phase}\n來自長腳本規劃：${input.planningTitle}`,
          noteType: "calendar_event",
          scheduledDate: new Date(m.targetDate),
          tags: ["planning-milestone", m.phase],
        });
        ids.push(id);
      }
      return { ids };
    }),

  // ─── Auto Script-to-Generation Pipeline ─────────────────────────────────────

  /**
   * Auto-generate multimodal content from script segments
   * 根據腳本分段自動分配生成任務到對應的 AI 模型
   */
  autoGenerateFromSegments: protectedProcedure
    .input(
      z.object({
        segments: z.array(
          z.object({
            id: z.string(),
            index: z.number(),
            storyboard: z.object({
              sceneHeading: z.string(),
              visualDescription: z.string(),
              dialogue: z.string(),
              soundDesign: z.string(),
              cameraDirection: z.string(),
              duration: z.string(),
              mood: z.string(),
            }),
            costar: z
              .object({
                context: z.string(),
                situation: z.string(),
                task: z.string(),
                action: z.string(),
                result: z.string(),
                visualPrompt: z.string(),
                audioScript: z.string(),
                musicVibe: z.string(),
              })
              .optional(),
          })
        ),
        generationOptions: z.object({
          /** Which modalities to generate for each segment */
          modalities: z
            .array(z.enum(["image", "video", "audio", "voice"]))
            .min(1),
          /** Image generation settings */
          imageSettings: z
            .object({
              aspectRatio: z.string().optional(),
              negativePrompt: z.string().optional(),
              modelId: z.string().optional(),
            })
            .optional(),
          /** Video generation settings */
          videoSettings: z
            .object({
              modelId: z.string().optional(),
              useImageAsFirstFrame: z.boolean().optional(), // Use generated image as video first frame
            })
            .optional(),
          /** Audio generation settings */
          audioSettings: z
            .object({
              modelId: z.string().optional(),
              isInstrumental: z.boolean().optional(),
            })
            .optional(),
          /** Voice generation settings */
          voiceSettings: z
            .object({
              modelId: z.string().optional(),
              voiceSpeed: z.number().optional(),
              voiceStability: z.number().optional(),
            })
            .optional(),
          /** Generation mode for all tasks */
          mode: z.enum(["lightning", "deep_precision"]).default("lightning"),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { segments, generationOptions } = input;

      // Import necessary dependencies
      const { getDb } = await import("../db");
      const { userAiBrain } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const {
        resolveFalEnginesFromRow,
      } = await import("../services/falDispatcher");
      const { estimatePoints } = await import("../services/modelPricing");
      const { isDemoMode } = await import("../_core/googleAuth");
      const { normalizeEngineModelId } = await import(
        "../../shared/engineModelIds"
      );

      // Fetch user AI brain config
      let brainRow: Record<string, unknown> | null = null;
      try {
        const database = await getDb();
        if (database) {
          const rows = await database
            .select()
            .from(userAiBrain)
            .where(eq(userAiBrain.userId, userId))
            .limit(1);
          brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
        }
      } catch {
        /* use defaults */
      }
      const falEngines = resolveFalEnginesFromRow(brainRow);

      // Build generation tasks for each segment
      const generationTasks: Array<{
        segmentId: string;
        segmentIndex: number;
        modality: "image" | "video" | "audio" | "voice";
        modelId: string;
        prompt: string;
        voiceText?: string;
        params: Record<string, unknown>;
        estimatedPoints: number;
        dependsOn?: { segmentId: string; modality: string }; // For video depending on image
      }> = [];

      for (const segment of segments) {
        const visualPrompt = segment.costar?.visualPrompt ||
          segment.storyboard.visualDescription;
        const audioScript = segment.costar?.audioScript ||
          segment.storyboard.dialogue;
        const musicVibe = segment.costar?.musicVibe ||
          segment.storyboard.soundDesign;

        // Parse duration from storyboard
        const durationStr = segment.storyboard.duration;
        const minMatch = durationStr.match(/(\d+)\s*分/);
        const secMatch = durationStr.match(/(\d+)\s*秒/);
        let durationSec = 0;
        if (minMatch) durationSec += parseInt(minMatch[1], 10) * 60;
        if (secMatch) durationSec += parseInt(secMatch[1], 10);
        if (durationSec === 0) durationSec = 5; // default 5 seconds

        for (const modality of generationOptions.modalities) {
          if (modality === "image") {
            const modelId =
              generationOptions.imageSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.imageSettings.modelId
                  )
                : falEngines.textToImage;
            const estimate = estimatePoints(modelId, {});
            generationTasks.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "image",
              modelId,
              prompt: visualPrompt,
              params: {
                aspect_ratio:
                  generationOptions.imageSettings?.aspectRatio || "16:9",
                negative_prompt:
                  generationOptions.imageSettings?.negativePrompt || "",
              },
              estimatedPoints: estimate.totalPoints,
            });
          } else if (modality === "video") {
            const useImageFirst =
              generationOptions.videoSettings?.useImageAsFirstFrame ?? false;
            const modelId =
              generationOptions.videoSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.videoSettings.modelId
                  )
                : useImageFirst
                  ? falEngines.imageToVideo
                  : falEngines.textToVideo;
            const estimate = estimatePoints(modelId, { durationSec });
            const task: (typeof generationTasks)[number] = {
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "video",
              modelId,
              prompt: visualPrompt,
              params: {
                duration: String(durationSec),
              },
              estimatedPoints: estimate.totalPoints,
            };
            if (useImageFirst) {
              task.dependsOn = { segmentId: segment.id, modality: "image" };
            }
            generationTasks.push(task);
          } else if (modality === "audio") {
            const modelId =
              generationOptions.audioSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.audioSettings.modelId
                  )
                : falEngines.textToAudio;
            const estimate = estimatePoints(modelId, { durationSec });
            generationTasks.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "audio",
              modelId,
              prompt: musicVibe,
              params: {
                seconds_total: durationSec,
                instrumental:
                  generationOptions.audioSettings?.isInstrumental ?? true,
              },
              estimatedPoints: estimate.totalPoints,
            });
          } else if (modality === "voice") {
            const modelId =
              generationOptions.voiceSettings?.modelId
                ? normalizeEngineModelId(
                    generationOptions.voiceSettings.modelId
                  )
                : falEngines.textToSpeech;
            const charCount = audioScript.length;
            const estimate = estimatePoints(modelId, { charCount });
            generationTasks.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              modality: "voice",
              modelId,
              prompt: audioScript,
              voiceText: audioScript,
              params: {
                text: audioScript,
                speed: generationOptions.voiceSettings?.voiceSpeed ?? 1.0,
                stability: generationOptions.voiceSettings?.voiceStability ?? 0.5,
              },
              estimatedPoints: estimate.totalPoints,
            });
          }
        }
      }

      // Calculate total points needed
      const totalPoints = generationTasks.reduce(
        (sum, t) => sum + t.estimatedPoints,
        0
      );

      // Check user has enough points
      if (!isDemoMode()) {
        const database = await getDb();
        if (database) {
          const { users } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const userRows = await database
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const user = userRows[0];
          if (!user || (user.remainingGenerations ?? 0) < totalPoints) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `積分不足。需要 ${totalPoints} pts，目前 ${user?.remainingGenerations ?? 0} pts`,
            });
          }
        }
      }

      return {
        tasks: generationTasks.map(t => ({
          segmentId: t.segmentId,
          segmentIndex: t.segmentIndex,
          modality: t.modality,
          modelId: t.modelId,
          estimatedPoints: t.estimatedPoints,
          dependsOn: t.dependsOn,
        })),
        totalPoints,
        totalTasks: generationTasks.length,
      };
    }),

  /**
   * Execute a single generation task from the auto-generation pipeline
   * 執行單個自動生成任務
   */
  executeGenerationTask: protectedProcedure
    .input(
      z.object({
        segmentId: z.string(),
        segmentIndex: z.number(),
        modality: z.enum(["image", "video", "audio", "voice"]),
        modelId: z.string(),
        prompt: z.string(),
        voiceText: z.string().optional(),
        params: z.record(z.string(), z.unknown()),
        mode: z.enum(["lightning", "deep_precision"]).default("lightning"),
        firstFrameUrl: z.string().optional(), // For video with image dependency
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Import dependencies
      const { falQueueSubmitModel } = await import("../services/falModels");
      const { estimatePoints } = await import("../services/modelPricing");
      const { isDemoMode } = await import("../_core/googleAuth");
      const db = await import("../db");

      // Estimate points
      const durationSec =
        input.modality === "video" || input.modality === "audio"
          ? Number(input.params.duration || input.params.seconds_total || 5)
          : undefined;
      const charCount =
        input.modality === "voice" ? input.voiceText?.length : undefined;
      const estimate = estimatePoints(input.modelId, { durationSec, charCount });

      // Deduct points
      if (!isDemoMode()) {
        const deductResult = await db.deductUserPoints(
          userId,
          estimate.totalPoints
        );
        if (!deductResult.success) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `積分不足（需要 ${estimate.totalPoints} pts）`,
          });
        }
      }

      // Create background job
      const modalityLabel =
        input.modality === "image"
          ? "圖像"
          : input.modality === "video"
            ? "影片"
            : input.modality === "audio"
              ? "音樂"
              : "語音";
      const label = `${modalityLabel}生成 - 分鏡 #${input.segmentIndex + 1}`;
      const jobId = await db.createBackgroundJob({
        userId,
        jobType: input.modality as any,
        status: "processing",
        progress: 5,
        progressMessage: label,
        resultJson: {
          segmentId: input.segmentId,
          segmentIndex: input.segmentIndex,
          prompt: input.prompt,
          modelId: input.modelId,
          ...input.params,
        } as any,
      });

      try {
        // Build fal input based on modality
        let falInput: Record<string, unknown> = { ...input.params };

        if (input.modality === "image") {
          falInput.prompt = input.prompt;
        } else if (input.modality === "video") {
          falInput.prompt = input.prompt;
          if (input.firstFrameUrl) {
            falInput.image_url = input.firstFrameUrl;
          }
        } else if (input.modality === "audio") {
          falInput.prompt = input.prompt;
        } else if (input.modality === "voice") {
          falInput.text = input.voiceText || input.prompt;
        }

        // Call fal model - queue mode (async)
        const result = await falQueueSubmitModel(
          input.modelId,
          falInput
        );

        // Update job with request_id
        await db.updateBackgroundJob(jobId, {
          status: "processing",
          progress: 10,
          resultJson: {
            ...(input.params as Record<string, unknown>),
            segmentId: input.segmentId,
            segmentIndex: input.segmentIndex,
            prompt: input.prompt,
            modelId: input.modelId,
            request_id: result.request_id,
          } as any,
        });

        return {
          jobId,
          requestId: result.request_id,
          modelId: input.modelId,
          label,
          segmentId: input.segmentId,
          segmentIndex: input.segmentIndex,
          modality: input.modality,
        };
      } catch (error) {
        // Refund points on error
        if (!isDemoMode()) {
          await db.refundUserPoints(userId, estimate.totalPoints);
        }
        await db.updateBackgroundJob(jobId, {
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "生成任務失敗",
        });
        throw error;
      }
    }),
});
