/**
 * server/services/spiritTools/learningSpecialistTools.ts
 *
 * Tools for learning-specialist (學學) spirit.
 *
 * 學學 是真正的學習 AI agent — 不只是靜態 FAQ 機器人：
 *   - 真實搜尋 LearnHub 的 docs / videos / quizzes（不是寫死的）
 *   - 依使用者目前所在頁面 / 等級推薦下一步該學什麼
 *   - 從目標反推學習路徑（goal → ordered steps），引用真實文件 id
 *   - 解釋概念（platform / domain knowledge），給結構化 lesson sketch
 *   - 讀取 orbFeatureDiscovery 的真實使用數據，估算技能等級
 *   - 給連續學習者「下一步」建議
 *
 * 設計原則：
 *   - 工具回傳純 data，不含任何 LLM 自然語言渲染（留給 LLM 用 persona 包裝）
 *   - 凡是引用 LearnHub 內容都附 `deepLink: /learn-hub?docId=<id>` 讓 UI 可直接跳
 *   - 找不到時回 `success: false` + 明確 message，給 LLM 重新提問的機會
 *   - 動態依賴用 require() 延遲載入避免 learnHub.ts ↔ siteKnowledge.ts 循環
 */

import { logger } from "../../_core/logger";
import { orbFeatureDiscovery } from "../orbFeatureDiscovery";

// ─── 型別 ───────────────────────────────────────────────────────────────────

type Difficulty = "beginner" | "intermediate" | "advanced";

interface LearnDocLike {
  id: string;
  category: string;
  title: string;
  summary: string;
  difficulty: string;
  readingMinutes: number;
  featured: boolean;
  tags?: string[];
}

interface LearnVideoLike {
  id: string;
  category: string;
  title: string;
  summary: string;
  difficulty: string;
  durationMinutes: number;
  featured: boolean;
  tags?: string[];
  videoUrl?: string;
}

interface LearnQuizLike {
  id: string;
  category: string;
  title: string;
  summary: string;
  difficulty: string;
  estimatedMinutes: number;
  featured: boolean;
  tags?: string[];
}

interface LearnHubModule {
  docs: LearnDocLike[];
  videos: LearnVideoLike[];
  quizzes: LearnQuizLike[];
}

/**
 * 延遲載入 LearnHub 種子資料 — 用 require 避免循環依賴。
 *
 * 為什麼不直接 import：learnHub.ts 反過來也會被 siteKnowledge.ts 拉去組光球
 * prompt，而 siteKnowledge 又被 _core 拉走。延遲 require 把這層解開。
 */
let cachedLearnHub: LearnHubModule | null = null;
let learnHubLoadAttempted = false;
let pendingLearnHubLoad: Promise<LearnHubModule> | null = null;

/**
 * 同步取 LearnHub seed data — 第一次呼叫會 fire-and-forget 啟動 ESM 動態 import，
 * 之後快取結果。第一次呼叫會回空陣列（沒命中），但通常 spirit tools 不會在伺服器
 * 啟動瞬間就被打，第二次以後一定拿得到。
 *
 * 為什麼不用 top-level static import：learnHub.ts 是 12000+ 行 + 重量級 router
 * 註冊，靜態 import 會把它拖進 spirit tool 的 module graph，每個 worker 起來
 * 都要載一次。
 *
 * 為什麼不全程 async：searchLearningContent / recommendForContext 本來是純函式，
 * 改 async 會傳染給所有上游（執行器 / role chain），代價遠高於「第一次空回」。
 */
function loadLearnHubSync(): LearnHubModule {
  if (cachedLearnHub) return cachedLearnHub;
  if (!learnHubLoadAttempted) {
    learnHubLoadAttempted = true;
    pendingLearnHubLoad = (async () => {
      try {
        const mod = await import("../../routers/learnHub");
        const m = mod as unknown as {
          getAllLearnDocsForOrbIndex: () => LearnDocLike[];
          __getAllVideos?: () => LearnVideoLike[];
          __getAllQuizzes?: () => LearnQuizLike[];
        };
        const docs = m.getAllLearnDocsForOrbIndex();
        const videos = typeof m.__getAllVideos === "function" ? m.__getAllVideos() : [];
        const quizzes = typeof m.__getAllQuizzes === "function" ? m.__getAllQuizzes() : [];
        cachedLearnHub = { docs, videos, quizzes };
        return cachedLearnHub;
      } catch (err) {
        logger.warn("learning_specialist_learnhub_load_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        cachedLearnHub = { docs: [], videos: [], quizzes: [] };
        return cachedLearnHub;
      }
    })();
    // fire-and-forget — promise 由 ensureLearnHubLoaded 主動 await
  }
  return cachedLearnHub ?? { docs: [], videos: [], quizzes: [] };
}

/**
 * 對外保證 LearnHub 已載入 — async 工具（getNextLearningStep / getUserLearningProgress）
 * 在進入點先 await 這個，確保下游同步函式拿得到資料。
 */
async function ensureLearnHubLoaded(): Promise<LearnHubModule> {
  if (cachedLearnHub) return cachedLearnHub;
  loadLearnHubSync(); // 觸發 pendingLearnHubLoad
  if (pendingLearnHubLoad) return pendingLearnHubLoad;
  return { docs: [], videos: [], quizzes: [] };
}

/**
 * Test-only：清掉 / 注入 learnHub cache。給 unit test 在 vitest ESM 環境
 * 中繞過動態 import 用。
 */
export function __setLearnHubForTest(stub: LearnHubModule | null): void {
  cachedLearnHub = stub;
  learnHubLoadAttempted = stub !== null;
  pendingLearnHubLoad = stub !== null ? Promise.resolve(stub) : null;
}

const loadLearnHub = loadLearnHubSync;

// ─── 教程靜態映射表（補齊 listTutorials 與 getTutorial 之間的對應） ───────────
//
// 之前的 bug：listTutorials() 列出 5 個 tutorial id，但 getTutorial() 只
// 實作了 2 個（image-generation / video-generation）→ 問 prompt-engineering /
// lora-training / workflow-automation 直接 404。下方補齊所有 5 筆。

interface TutorialStep {
  step: number;
  title: string;
  description: string;
  tips?: string[];
}

interface Tutorial {
  id: string;
  title: string;
  category: string;
  difficulty: Difficulty;
  estimatedTime: string;
  steps: TutorialStep[];
  /** 對應 LearnHub doc id（若有），供 UI 一鍵跳 */
  relatedDocIds?: string[];
  /** 對應頁面，供 UI 帶人到實作頁 */
  relatedPath?: string;
}

const TUTORIALS: Record<string, Tutorial> = {
  "image-generation": {
    id: "image-generation",
    title: "圖片生成入門教學",
    category: "創作",
    difficulty: "beginner",
    estimatedTime: "5 分鐘",
    relatedPath: "/image-studio",
    relatedDocIds: ["gs-001", "tech-prompt-mastery"],
    steps: [
      {
        step: 1,
        title: "進入創作工作室",
        description: "從左側選單點擊「創作工作室」",
        tips: ["可使用快捷鍵 Cmd/Ctrl + K"],
      },
      {
        step: 2,
        title: "輸入提示詞",
        description: "在提示詞欄位描述你想生成的圖片",
        tips: ["越具體越好", "可參考範例提示詞"],
      },
      {
        step: 3,
        title: "選擇模型",
        description: "根據需求選擇合適的生成模型",
        tips: ["Flux 系列速度快", "SD3 可調性高"],
      },
      {
        step: 4,
        title: "調整參數",
        description: "設定長寬比、數量等參數",
      },
      {
        step: 5,
        title: "開始生成",
        description: "點擊生成按鈕，等待結果",
      },
    ],
  },
  "video-generation": {
    id: "video-generation",
    title: "影片生成入門教學",
    category: "創作",
    difficulty: "beginner",
    estimatedTime: "10 分鐘",
    relatedPath: "/video-studio",
    relatedDocIds: ["gs-001"],
    steps: [
      {
        step: 1,
        title: "進入影片工作室",
        description: "從選單選擇「影片工作室」",
      },
      {
        step: 2,
        title: "選擇生成方式",
        description: "文生影或圖轉影",
        tips: ["初次使用建議從圖轉影開始"],
      },
      {
        step: 3,
        title: "輸入提示詞或上傳圖片",
        description: "描述影片內容或上傳起始圖片",
      },
      {
        step: 4,
        title: "設定影片參數",
        description: "長度、比例、運鏡方式",
      },
      {
        step: 5,
        title: "生成並下載",
        description: "等待生成完成後下載",
        tips: ["可順手存到記記筆記中", "點數會在啟動時鎖定"],
      },
    ],
  },
  "prompt-engineering": {
    id: "prompt-engineering",
    title: "提示詞工程：寫出讓 AI 聽得懂的句子",
    category: "進階",
    difficulty: "intermediate",
    estimatedTime: "15 分鐘",
    relatedPath: "/studio",
    relatedDocIds: ["tech-prompt-mastery", "tech-001", "tech-002"],
    steps: [
      {
        step: 1,
        title: "拆解你的需求 — 主體 / 風格 / 情緒 / 鏡頭",
        description: "把一句話描述拆成 4 個明確軸：主體（誰）、風格（什麼派系/材質）、情緒（氛圍）、鏡頭（廣角/特寫/俯瞰）。",
        tips: [
          "例：「冬天森林裡的女孩」→ 主體：穿針織衫女孩；風格：水彩；情緒：寧靜；鏡頭：中景半身。",
          "每軸至少給一個強形容詞，AI 才知道往哪走。",
        ],
      },
      {
        step: 2,
        title: "加入質感詞（quality boosters）",
        description: "在主提示後加 photorealistic / cinematic lighting / 8k / sharp focus 之類關鍵字，能顯著提升模型輸出質感。",
        tips: ["不要堆超過 5 個，會打架。", "風格如果是日系手繪，質感詞改用 anime / studio ghibli / soft pastel。"],
      },
      {
        step: 3,
        title: "用 negative prompt 排除地雷",
        description: "negative prompt 寫上 blurry / lowres / extra fingers / text watermark / bad anatomy，能去掉 70% 的常見瑕疵。",
        tips: ["人像 → 一定要加 extra fingers / deformed hands。", "場景 → 加 watermark / text 避免出現假浮水印。"],
      },
      {
        step: 4,
        title: "用權重語法調整重點",
        description: "Flux/SD 支援 (keyword:1.3) 強調、(keyword:0.7) 弱化。重點主體拉到 1.2-1.4，背景拉到 0.7-0.9。",
        tips: ["先用 1.0 試一次，再依結果調權重，比一開始就堆權重穩定。"],
      },
      {
        step: 5,
        title: "迭代 — 不要重寫，要微調",
        description: "結果不對時改 1-2 個關鍵字（風格詞或鏡頭），不要整段重寫。固定 seed 才能看清楚改動效果。",
        tips: ["@巧巧 可以幫你看 prompt 為什麼出來不對。", "看到喜歡的 → 立刻存到提示詞庫。"],
      },
    ],
  },
  "lora-training": {
    id: "lora-training",
    title: "LoRA 模型訓練：訓練你自己的風格 / 角色",
    category: "進階",
    difficulty: "advanced",
    estimatedTime: "30 分鐘準備 + 15-40 分鐘訓練",
    relatedPath: "/models",
    relatedDocIds: ["deep-lora-trainer", "mg-001"],
    steps: [
      {
        step: 1,
        title: "先決定要訓「角色 LoRA」還是「風格 LoRA」",
        description: "角色 LoRA：固定一個人/角色長相，需多角度多表情；風格 LoRA：固定一種畫風，需同調性多作品。兩種素材策略完全不同。",
        tips: ["不確定時先選角色 LoRA，比較好驗收。"],
      },
      {
        step: 2,
        title: "備齊資料集",
        description: "角色：15-20 張多角度多表情，背景簡單，光線不要太混。風格：30+ 張同調性作品，主題可變但風格一致。所有圖建議 1024×1024 以上。",
        tips: [
          "避免同一姿勢重複出現（會 overfit）",
          "可以先用 @圖圖 出 5-10 張當補位",
          "敏感肖像（名人）— @律律 先確認授權",
        ],
      },
      {
        step: 3,
        title: "進入 /models 點「訓練 LoRA」",
        description: "上傳資料集 + 設定 trigger word（你之後出圖時要喊的關鍵字，例：mychar01）。trigger word 一定要冷僻，避免跟既有概念衝突。",
        tips: ["trigger word 不要用真人姓名 / 既有 IP 名。"],
      },
      {
        step: 4,
        title: "選擇訓練參數",
        description: "預設 rank=16 / 學習率 1e-4 / step≈1500 / batch=1 適合角色。風格 LoRA：rank 拉到 32、step 推到 2000-2500。其他先用預設。",
        tips: [
          "rank 越高越能學細節，但檔案也越大",
          "step 太高會 overfit，反而僵硬",
        ],
      },
      {
        step: 5,
        title: "送出 → 訓練 → 驗收",
        description: "送出後可離開頁面，訓完會通知（也可到 /jobs 看）。完成後 @練練 會給你第一張示範圖；@品品 評估資料集是否要補。",
        tips: ["驗收標準：用 trigger word 出圖 5 張，至少 3 張長對才算成功。"],
      },
    ],
  },
  "workflow-automation": {
    id: "workflow-automation",
    title: "工作流程自動化：跨頁多步驟一鍵跑完",
    category: "進階",
    difficulty: "intermediate",
    estimatedTime: "20 分鐘",
    relatedPath: "/agent",
    relatedDocIds: ["wf-001", "wf-002", "wf-003"],
    steps: [
      {
        step: 1,
        title: "找到 @導導 規劃整條鏈",
        description: "在任何頁面對話框輸入 @導導 + 一句完整目標（例：「做一支 15 秒 IG 短影音講貓咪的日常」）。導導會回一個 3-5 步計畫。",
        tips: ["目標越具體越好：用途 / 平台 / 長度 / 風格至少給 2 個。"],
      },
      {
        step: 2,
        title: "看計畫 → 確認 / 修改 / 拒絕",
        description: "導導不會直接執行，會列出每一步「交給誰」「預估花多少時間 / 點數」。你可以勾選要跳過的步驟。",
        tips: ["如果有付費步驟 → @財財 先估總成本再起跑。"],
      },
      {
        step: 3,
        title: "交給 @步步 真的跑",
        description: "按「執行」後步步會接管，依序呼叫每位精靈（圖圖出圖 → 影影做動畫 → 聲聲配音 → 音音壓 BGM）。中間每完成一棒會通知你，可以中途介入。",
        tips: ["不滿意可隨時喊「停」，步步會凍結後續步驟。"],
      },
      {
        step: 4,
        title: "@品品 看整條工作流",
        description: "整條跑完後可以對話框喊 @品品 「整體看一下」，會給你跨步驟一致性 / 連續性的評語（風格漂移、音畫不同步等）。",
        tips: ["不只挑單張的毛病，會看「主體一致性」「色調延續性」。"],
      },
      {
        step: 5,
        title: "存成樣板 → 下次一鍵套",
        description: "整條成功後 @記記 可以把這條鏈儲為「樣板」（template）。下次有類似需求對話框輸入「套上次的影片樣板」就會直接重跑。",
        tips: ["樣板可分享給隊友，IG 系列短影音很好用。"],
      },
    ],
  },
};

// ─── 工具 1：取單一教學 ───────────────────────────────────────────────────────

export function getTutorial(featureName: string): {
  success: boolean;
  tutorial?: Tutorial;
  message: string;
} {
  const tutorial = TUTORIALS[featureName];
  if (!tutorial) {
    const available = Object.keys(TUTORIALS).join(" / ");
    return {
      success: false,
      message: `找不到「${featureName}」的教學。目前支援：${available}`,
    };
  }
  return {
    success: true,
    tutorial,
    message: "教學已載入",
  };
}

// ─── 工具 2：列所有教學（now contract-matches getTutorial） ────────────────

export function listTutorials(): {
  success: boolean;
  tutorials: Array<{
    id: string;
    title: string;
    category: string;
    difficulty: Difficulty;
    duration: string;
    relatedPath?: string;
  }>;
} {
  return {
    success: true,
    tutorials: Object.values(TUTORIALS).map(t => ({
      id: t.id,
      title: t.title,
      category: t.category,
      difficulty: t.difficulty,
      duration: t.estimatedTime,
      relatedPath: t.relatedPath,
    })),
  };
}

// ─── 工具 3：快速提示 ───────────────────────────────────────────────────────

export function getQuickTips(): {
  success: boolean;
  tips: Array<{
    category: string;
    tip: string;
  }>;
} {
  return {
    success: true,
    tips: [
      { category: "圖片生成", tip: "使用具體的描述詞，加入風格和情緒關鍵字" },
      { category: "影片生成", tip: "圖轉影效果通常比純文生影更穩定" },
      { category: "提示詞", tip: "學習使用 negative prompt 排除不想要的元素" },
      { category: "模型選擇", tip: "不同模型擅長不同風格，多嘗試找到最適合的" },
      { category: "成本控制", tip: "先用低解析度測試，滿意後再生成高清版本" },
      { category: "資產管理", tip: "為生成的作品加上標籤，方便日後搜尋" },
      { category: "工作流程", tip: "@導導 規劃 + @步步 執行，跨頁多步驟一條鏈跑完" },
      { category: "LoRA 訓練", tip: "trigger word 用冷僻字（不要 'cat' 或真人姓名）" },
    ],
  };
}

// ─── 工具 4：真實搜尋 LearnHub 內容 ──────────────────────────────────────────
//
// 取代「給我 X 教學 → 找不到 → 死路」的舊行為。學學會真的去翻 LearnHub 索引
// 的 docs / videos / quizzes，回前 N 筆給 LLM 接著敘述。

export function searchLearningContent(input: {
  query: string;
  type?: "doc" | "video" | "quiz" | "all";
  difficulty?: Difficulty;
  limit?: number;
}): {
  success: boolean;
  query: string;
  results: Array<{
    kind: "doc" | "video" | "quiz";
    id: string;
    title: string;
    summary: string;
    category: string;
    difficulty: string;
    minutes: number;
    featured: boolean;
    deepLink: string;
  }>;
  message: string;
} {
  const q = input.query.trim().toLowerCase();
  if (q.length === 0) {
    return {
      success: false,
      query: input.query,
      results: [],
      message: "請給我一個關鍵字（例如 LoRA / 提示詞 / 影片）",
    };
  }

  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30);
  const type = input.type ?? "all";
  const { docs, videos, quizzes } = loadLearnHub();

  const matchTags = (tags?: string[]) =>
    Array.isArray(tags) && tags.some(t => t.toLowerCase().includes(q));

  const matches: Array<{
    kind: "doc" | "video" | "quiz";
    id: string;
    title: string;
    summary: string;
    category: string;
    difficulty: string;
    minutes: number;
    featured: boolean;
    deepLink: string;
    score: number;
  }> = [];

  if (type === "all" || type === "doc") {
    for (const d of docs) {
      if (input.difficulty && d.difficulty !== input.difficulty) continue;
      const titleHit = d.title.toLowerCase().includes(q);
      const summaryHit = d.summary.toLowerCase().includes(q);
      const tagHit = matchTags(d.tags);
      if (!titleHit && !summaryHit && !tagHit) continue;
      matches.push({
        kind: "doc",
        id: d.id,
        title: d.title,
        summary: d.summary,
        category: d.category,
        difficulty: d.difficulty,
        minutes: d.readingMinutes,
        featured: d.featured,
        deepLink: `/learn-hub?docId=${encodeURIComponent(d.id)}`,
        score: (titleHit ? 3 : 0) + (tagHit ? 2 : 0) + (summaryHit ? 1 : 0) + (d.featured ? 1 : 0),
      });
    }
  }
  if (type === "all" || type === "video") {
    for (const v of videos) {
      if (input.difficulty && v.difficulty !== input.difficulty) continue;
      const titleHit = v.title.toLowerCase().includes(q);
      const summaryHit = v.summary.toLowerCase().includes(q);
      const tagHit = matchTags(v.tags);
      if (!titleHit && !summaryHit && !tagHit) continue;
      matches.push({
        kind: "video",
        id: v.id,
        title: v.title,
        summary: v.summary,
        category: v.category,
        difficulty: v.difficulty,
        minutes: v.durationMinutes,
        featured: v.featured,
        deepLink: `/learn-hub?tab=video&videoId=${encodeURIComponent(v.id)}`,
        score: (titleHit ? 3 : 0) + (tagHit ? 2 : 0) + (summaryHit ? 1 : 0) + (v.featured ? 1 : 0),
      });
    }
  }
  if (type === "all" || type === "quiz") {
    for (const z of quizzes) {
      if (input.difficulty && z.difficulty !== input.difficulty) continue;
      const titleHit = z.title.toLowerCase().includes(q);
      const summaryHit = z.summary.toLowerCase().includes(q);
      const tagHit = matchTags(z.tags);
      if (!titleHit && !summaryHit && !tagHit) continue;
      matches.push({
        kind: "quiz",
        id: z.id,
        title: z.title,
        summary: z.summary,
        category: z.category,
        difficulty: z.difficulty,
        minutes: z.estimatedMinutes,
        featured: z.featured,
        deepLink: `/learn-hub?tab=quiz&quizId=${encodeURIComponent(z.id)}`,
        score: (titleHit ? 3 : 0) + (tagHit ? 2 : 0) + (summaryHit ? 1 : 0) + (z.featured ? 1 : 0),
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, limit).map(({ score, ...rest }) => rest);

  return {
    success: top.length > 0,
    query: input.query,
    results: top,
    message:
      top.length > 0
        ? `找到 ${top.length} 筆相關內容`
        : `沒有命中「${input.query}」相關的學習內容，試試換個關鍵字（例：提示詞 / LoRA / 影片）`,
  };
}

// ─── 工具 5：根據使用者目前所在頁面 / 等級推薦內容 ───────────────────────────
//
// 例：使用者在 /image-studio 卡了 → 推「圖片生成入門」「提示詞工程」這類。
// 不依賴 LLM 自己挑（不穩定），而是用 path → category 對應表 + LearnHub
// 真實資料庫。

const PATH_TO_CATEGORY: Record<string, string[]> = {
  "/image-studio": ["getting-started", "model-guide", "technique"],
  "/studio": ["getting-started", "technique", "workflow"],
  "/video-studio": ["getting-started", "model-guide", "technique"],
  "/pro-studio": ["getting-started", "model-guide"],
  "/models": ["model-guide", "technique"],
  "/agent": ["workflow", "getting-started"],
  "/director": ["workflow"],
  "/learn-hub": ["getting-started"],
  "/dashboard": ["workflow"],
  "/credits": ["getting-started"],
  "/api-docs": ["api-docs"],
};

const TOPIC_KEYWORDS: Array<{
  topic: string;
  category: string;
  keywords: string[];
}> = [
  { topic: "image", category: "model-guide", keywords: ["圖", "image", "flux", "sd", "繪", "畫"] },
  { topic: "video", category: "model-guide", keywords: ["影", "video", "kling", "minimax", "veo"] },
  { topic: "voice", category: "model-guide", keywords: ["配音", "聲", "voice", "tts", "elevenlabs"] },
  { topic: "music", category: "model-guide", keywords: ["音樂", "music", "bgm", "stable audio", "suno"] },
  { topic: "lora", category: "technique", keywords: ["lora", "訓練", "training", "微調", "fine-tune"] },
  { topic: "prompt", category: "technique", keywords: ["prompt", "提示詞", "提詞", "negative"] },
  { topic: "workflow", category: "workflow", keywords: ["流程", "workflow", "自動", "agent", "鏈"] },
];

export function recommendForContext(input: {
  currentPath?: string;
  topic?: string;
  difficulty?: Difficulty;
  limit?: number;
}): {
  success: boolean;
  basis: { path?: string; topic?: string; difficulty?: Difficulty; categories: string[] };
  recommendations: Array<{
    id: string;
    title: string;
    summary: string;
    category: string;
    difficulty: string;
    minutes: number;
    featured: boolean;
    deepLink: string;
    matchReason: string;
  }>;
  message: string;
} {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 12);
  const { docs } = loadLearnHub();

  // 收集候選 category（最多 4 個，依優先序）
  const categories: string[] = [];
  const pushCat = (cat: string) => {
    if (!categories.includes(cat)) categories.push(cat);
  };

  if (input.currentPath) {
    // 對 currentPath 找最長 prefix 匹配
    const matchedPrefix = Object.keys(PATH_TO_CATEGORY)
      .filter(p => input.currentPath!.startsWith(p))
      .sort((a, b) => b.length - a.length)[0];
    if (matchedPrefix) {
      for (const c of PATH_TO_CATEGORY[matchedPrefix]) pushCat(c);
    }
  }
  if (input.topic) {
    const tq = input.topic.toLowerCase();
    for (const tk of TOPIC_KEYWORDS) {
      if (tk.keywords.some(k => tq.includes(k))) pushCat(tk.category);
    }
  }
  if (categories.length === 0) {
    pushCat("getting-started");
  }

  const candidates = docs.filter(d => {
    if (input.difficulty && d.difficulty !== input.difficulty) return false;
    return categories.includes(d.category);
  });

  // 排序：featured 優先；同類別取前幾筆，平衡多個 category
  const grouped = new Map<string, LearnDocLike[]>();
  for (const d of candidates) {
    const list = grouped.get(d.category) ?? [];
    list.push(d);
    grouped.set(d.category, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return a.readingMinutes - b.readingMinutes;
    });
  }

  // 用「輪轉」方式從每個 category 取 1 筆，補滿 limit
  const recs: Array<LearnDocLike & { matchReason: string }> = [];
  let i = 0;
  while (recs.length < limit) {
    let added = false;
    for (const cat of categories) {
      const list = grouped.get(cat);
      if (!list || list.length === 0) continue;
      if (i < list.length) {
        const d = list[i];
        const reason = input.currentPath
          ? `跟你現在所在的 ${input.currentPath} 同類別（${cat}）`
          : input.topic
          ? `跟「${input.topic}」這個主題相關`
          : `${cat} 類別的精選文章`;
        recs.push({ ...d, matchReason: reason });
        added = true;
        if (recs.length >= limit) break;
      }
    }
    i += 1;
    if (!added) break;
  }

  return {
    success: recs.length > 0,
    basis: {
      path: input.currentPath,
      topic: input.topic,
      difficulty: input.difficulty,
      categories,
    },
    recommendations: recs.map(d => ({
      id: d.id,
      title: d.title,
      summary: d.summary,
      category: d.category,
      difficulty: d.difficulty,
      minutes: d.readingMinutes,
      featured: d.featured,
      deepLink: `/learn-hub?docId=${encodeURIComponent(d.id)}`,
      matchReason: d.matchReason,
    })),
    message:
      recs.length > 0
        ? `推薦 ${recs.length} 篇給你`
        : "目前沒有合適的內容，可以試試直接搜尋一個關鍵字",
  };
}

// ─── 工具 6：從目標反推學習路徑 ──────────────────────────────────────────────
//
// 「想做出自己的 LoRA」「想學會做 IG 短影音」這類大目標，學學會：
//   1. 把目標 → 對應一條學習目標模板（goal preset）
//   2. 每步指定：學什麼概念 / 看哪篇 doc / 哪個 tutorial / 估計時間
//   3. 末尾接「實作頁」+ 對應精靈

interface LearningPathStep {
  step: number;
  title: string;
  description: string;
  estimatedMinutes: number;
  resources: Array<{ kind: "doc" | "tutorial" | "video"; id: string; deepLink: string }>;
  ownerSpirit?: string;
}

interface LearningPathTemplate {
  matchKeywords: string[];
  goalLabel: string;
  level: Difficulty;
  steps: Omit<LearningPathStep, "step">[];
  finalActionPath?: string;
}

const LEARNING_PATH_TEMPLATES: LearningPathTemplate[] = [
  {
    matchKeywords: ["lora", "訓練", "自己的模型", "客製化角色", "fine-tune"],
    goalLabel: "訓練我自己的 LoRA 模型",
    level: "advanced",
    finalActionPath: "/models",
    steps: [
      {
        title: "先搞懂什麼是 LoRA",
        description: "看 deep-lora-trainer 一遍，掌握 rank / step / trigger word 等基本詞彙。",
        estimatedMinutes: 12,
        resources: [{ kind: "doc", id: "deep-lora-trainer", deepLink: "/learn-hub?docId=deep-lora-trainer" }],
      },
      {
        title: "學會挑模型 — 哪個底模適合你的目標",
        description: "讀 mg-001 / mg-002 比較 Flux / SDXL / SD3 在 LoRA 訓練上的差異。",
        estimatedMinutes: 10,
        resources: [
          { kind: "doc", id: "mg-001", deepLink: "/learn-hub?docId=mg-001" },
          { kind: "doc", id: "mg-002", deepLink: "/learn-hub?docId=mg-002" },
        ],
      },
      {
        title: "看完整 LoRA 訓練教學",
        description: "走 lora-training tutorial 的 5 個步驟，從資料集備齊到驗收。",
        estimatedMinutes: 30,
        resources: [{ kind: "tutorial", id: "lora-training", deepLink: "/learn-hub" }],
      },
      {
        title: "實作 — 進 /models 真的開始訓",
        description: "備好 15-20 張資料集後到 /models 開新訓練；@練練 在那裡陪你跑完。",
        estimatedMinutes: 40,
        resources: [],
        ownerSpirit: "練練",
      },
    ],
  },
  {
    matchKeywords: ["ig", "短影音", "影音", "tiktok", "shorts", "reels"],
    goalLabel: "做一支社群短影音",
    level: "intermediate",
    finalActionPath: "/video-studio",
    steps: [
      {
        title: "先搞懂社群短影音的鉤子公式",
        description: "@群群 會跟你講前 1-3 秒鉤子 / 衝突 / 解法 / CTA 公式 — 先把腳本想清楚。",
        estimatedMinutes: 8,
        resources: [],
        ownerSpirit: "群群",
      },
      {
        title: "讀 prompt-engineering 教學",
        description: "影片 prompt 比靜態圖難 — 要描述運鏡、節奏。先看提示詞工程教程。",
        estimatedMinutes: 15,
        resources: [{ kind: "tutorial", id: "prompt-engineering", deepLink: "/learn-hub" }],
      },
      {
        title: "選對影片模型",
        description: "Kling 2.1 Pro 適合電影感、MiniMax 適合靈動短秒。先看 mg-003 比較。",
        estimatedMinutes: 8,
        resources: [{ kind: "doc", id: "mg-003", deepLink: "/learn-hub?docId=mg-003" }],
      },
      {
        title: "走 video-generation tutorial 出第一支",
        description: "5 步驟跑完一支 demo，看品質夠不夠再決定要不要重做。",
        estimatedMinutes: 12,
        resources: [{ kind: "tutorial", id: "video-generation", deepLink: "/learn-hub" }],
      },
      {
        title: "實作 — 進 /video-studio + @影影",
        description: "影影會接你完整把影片做出來，配音問 @聲聲、BGM 問 @音音。",
        estimatedMinutes: 20,
        resources: [],
        ownerSpirit: "影影",
      },
    ],
  },
  {
    matchKeywords: ["prompt", "提示詞", "提詞", "怎麼寫"],
    goalLabel: "把提示詞寫好",
    level: "intermediate",
    finalActionPath: "/studio",
    steps: [
      {
        title: "從 tech-prompt-mastery 看完整理論",
        description: "全站最深一篇提示詞教學，看完掌握 80% 的寫法。",
        estimatedMinutes: 18,
        resources: [{ kind: "doc", id: "tech-prompt-mastery", deepLink: "/learn-hub?docId=tech-prompt-mastery" }],
      },
      {
        title: "讀 tech-001 / tech-002 進階技巧",
        description: "包含 negative prompt、權重語法、跨模型差異。",
        estimatedMinutes: 12,
        resources: [
          { kind: "doc", id: "tech-001", deepLink: "/learn-hub?docId=tech-001" },
          { kind: "doc", id: "tech-002", deepLink: "/learn-hub?docId=tech-002" },
        ],
      },
      {
        title: "走 prompt-engineering tutorial 實戰 5 步",
        description: "從拆需求到迭代，每步給範例。",
        estimatedMinutes: 15,
        resources: [{ kind: "tutorial", id: "prompt-engineering", deepLink: "/learn-hub" }],
      },
      {
        title: "@巧巧 幫你檢查現成 prompt",
        description: "把你寫的 prompt 丟給巧巧，他會挑可改進的 1-3 個點。",
        estimatedMinutes: 5,
        resources: [],
        ownerSpirit: "巧巧",
      },
    ],
  },
  {
    matchKeywords: ["新手", "入門", "第一次", "怎麼開始", "beginner", "getting started"],
    goalLabel: "Healing Studio 完整入門",
    level: "beginner",
    finalActionPath: "/studio",
    steps: [
      {
        title: "讀完整入門指南",
        description: "gs-001 一次講完全站 17 個模組，5-8 分鐘看完。",
        estimatedMinutes: 8,
        resources: [{ kind: "doc", id: "gs-001", deepLink: "/learn-hub?docId=gs-001" }],
      },
      {
        title: "看快速入門影片",
        description: "5 分鐘導覽影片，比讀文字快。",
        estimatedMinutes: 5,
        resources: [{ kind: "video", id: "video-001", deepLink: "/learn-hub?tab=video&videoId=video-001" }],
      },
      {
        title: "做第一張圖",
        description: "走 image-generation tutorial 的 5 步驟，5 分鐘出第一張。",
        estimatedMinutes: 6,
        resources: [{ kind: "tutorial", id: "image-generation", deepLink: "/learn-hub" }],
      },
      {
        title: "@圖圖 真的幫你出第一張",
        description: "把想法描述給圖圖，他直接出圖你看結果。",
        estimatedMinutes: 5,
        resources: [],
        ownerSpirit: "圖圖",
      },
    ],
  },
];

export function generateLearningPath(input: {
  goal: string;
  currentLevel?: Difficulty;
}): {
  success: boolean;
  matched: boolean;
  goal: string;
  goalLabel: string;
  level: Difficulty;
  totalMinutes: number;
  steps: LearningPathStep[];
  finalActionPath?: string;
  message: string;
} {
  const q = input.goal.trim().toLowerCase();
  if (q.length === 0) {
    return {
      success: false,
      matched: false,
      goal: input.goal,
      goalLabel: "",
      level: input.currentLevel ?? "beginner",
      totalMinutes: 0,
      steps: [],
      message: "請告訴我你的學習目標（例：訓練我自己的 LoRA / 做 IG 短影音）",
    };
  }

  const matched = LEARNING_PATH_TEMPLATES.find(t =>
    t.matchKeywords.some(k => q.includes(k))
  );

  const template = matched ?? LEARNING_PATH_TEMPLATES[LEARNING_PATH_TEMPLATES.length - 1];
  const steps: LearningPathStep[] = template.steps.map((s, i) => ({
    step: i + 1,
    ...s,
  }));
  const total = steps.reduce((sum, s) => sum + s.estimatedMinutes, 0);

  return {
    success: true,
    matched: !!matched,
    goal: input.goal,
    goalLabel: template.goalLabel,
    level: input.currentLevel ?? template.level,
    totalMinutes: total,
    steps,
    finalActionPath: template.finalActionPath,
    message: matched
      ? `為「${template.goalLabel}」規劃了 ${steps.length} 個步驟，總計約 ${total} 分鐘`
      : `沒找到完全對應的學習路徑，先給你一條入門路線（${steps.length} 步，約 ${total} 分鐘）`,
  };
}

// ─── 工具 7：解釋概念 ────────────────────────────────────────────────────────
//
// 給一個關鍵字（"LoRA" / "negative prompt" / "ControlNet"），回傳結構化
// lesson sketch：what / why / 1-sentence example / next steps + 對應 doc。
// LLM 拿到後可以包裝成自然敘述。

interface ConceptEntry {
  what: string;
  why: string;
  example: string;
  /** 進一步閱讀的 doc id（會被轉成 deepLink） */
  relatedDocIds: string[];
  /** 下一步建議（精靈交棒 / 跳頁） */
  nextSteps: string[];
  /** 等級分流（不傳則用 default） */
  levels?: Partial<Record<Difficulty, { what?: string; example?: string }>>;
}

const CONCEPT_DICTIONARY: Record<string, ConceptEntry> = {
  lora: {
    what: "LoRA（Low-Rank Adaptation）是訓練在底模上的「小型增益權重」— 用少量資料就能讓 AI 學會特定角色或風格，不用重訓整個模型。",
    why: "整個 base model 太大（10GB+）重訓不切實際；LoRA 只訓 1-2% 的權重，檔案 50-200MB，能在 15-40 分鐘內訓出一個風格/角色。",
    example: "你想固定某個女孩的長相 → 給 LoRA 15 張這女孩的多角度照 + trigger word 'gracelora' → 訓完後在 prompt 喊 gracelora 就能用她的臉。",
    relatedDocIds: ["deep-lora-trainer", "mg-001"],
    nextSteps: [
      "@練練 帶你完整訓一個 LoRA",
      "走 lora-training tutorial 看 5 步驟細節",
      "到 /models 開始準備資料集",
    ],
    levels: {
      beginner: {
        what: "LoRA 是 AI 模型的「插件」— 給 AI 看幾張你想固定的角色/風格圖，它就能在生成時套上這個風格。",
      },
    },
  },
  "negative prompt": {
    what: "Negative prompt 是「叫 AI 別做什麼」的清單 — 跟主 prompt 同時送，AI 會盡量避開這些詞描述的東西。",
    why: "光寫「漂亮女孩」AI 還是會出畸形手、模糊；加上 negative prompt 'extra fingers, blurry, lowres' 就會去掉 70% 瑕疵。",
    example: "主：『一個女孩在森林裡』+ negative：『extra fingers, deformed hands, blurry, watermark, text』",
    relatedDocIds: ["tech-001", "tech-prompt-mastery"],
    nextSteps: [
      "看 tech-001 完整的負面 prompt cheat sheet",
      "去 /image-studio 試一張對照組（有 / 沒有 negative prompt）",
    ],
  },
  controlnet: {
    what: "ControlNet 是「鎖住構圖」的工具 — 你給 AI 一張參考圖（骨架/邊緣/深度圖），AI 出的新圖會跟參考圖姿勢/構圖一致，但畫風 / 主體可以換。",
    why: "光用 prompt 描述「站著的女孩」AI 每次姿勢都不同；用 ControlNet 給一張姿勢圖，10 次都同一個姿勢，方便系列創作。",
    example: "想做一系列同一個角色不同服裝的圖 → 先抓一張角色的線稿給 ControlNet → 換 prompt 改服裝即可。",
    relatedDocIds: ["tech-002", "mg-001"],
    nextSteps: [
      "到 /image-studio 上傳一張參考圖，選 ControlNet 模式",
      "@圖圖 跟他講「鎖住這個姿勢 + 換成 X 風格」",
    ],
  },
  prompt: {
    what: "Prompt（提示詞）就是你寫給 AI 的指令 — 描述你要什麼主體、風格、情緒、鏡頭。",
    why: "AI 生成的好壞 80% 取決於 prompt — 同一個模型不同 prompt 結果天差地遠。",
    example: "壞：『一張漂亮的圖』；好：『一個穿針織衫的女孩在冬天森林裡，水彩風格，柔和光線，中景半身』",
    relatedDocIds: ["tech-prompt-mastery", "tech-001"],
    nextSteps: [
      "走 prompt-engineering tutorial 學完 5 步驟",
      "@巧巧 幫你改現成的 prompt",
    ],
  },
  "trigger word": {
    what: "Trigger word 是訓 LoRA 時你指定的「啟動關鍵字」— 之後 prompt 只要含這個字，LoRA 就會生效。",
    why: "如果不用 trigger word，LoRA 會在所有 prompt 都默默作用，導致非預期；用 trigger word 就能精準控制何時要套這個 LoRA。",
    example: "訓一個角色 LoRA 用 trigger word 'mychar01' → 想出這角色時 prompt 加 'mychar01, ...'，不想出時就不加。",
    relatedDocIds: ["deep-lora-trainer"],
    nextSteps: ["@練練 教你怎麼選好的 trigger word（避開常見字）"],
  },
  "image-to-video": {
    what: "Image-to-Video（圖轉影）給一張起始圖 + 一段動作描述，AI 生成 5-10 秒影片。比純文生影穩定很多。",
    why: "純文生影常常人物變形 / 場景跳動；用一張固定的起始圖鎖住主體，AI 只需要決定怎麼「動」就好。",
    example: "起始圖：一隻坐在窗台的貓 → 動作描述：「貓緩緩抬頭看向鏡頭」→ 5 秒平穩運鏡影片。",
    relatedDocIds: ["mg-003"],
    nextSteps: [
      "到 /video-studio 選圖轉影模式",
      "@影影 直接幫你做",
    ],
  },
  workflow: {
    what: "Workflow 是把多步驟（出圖 → 改 → 動畫 → 配音 → BGM）串成一條鏈一次跑完的能力。",
    why: "做一支短影音手動切換頁面 + 一個一個喊精靈很累；workflow 讓 @導導 規劃 → @步步 真的跑完整條。",
    example: "「做一支貓咪的 IG 短影音」→ 導導排好 5 步 → 步步依序叫 圖圖 / 影影 / 聲聲 / 音音 跑完 → 你只需驗收。",
    relatedDocIds: ["wf-001", "wf-002"],
    nextSteps: [
      "走 workflow-automation tutorial 看 5 步驟",
      "@導導 直接給你規劃一條",
    ],
  },
};

export function explainConcept(input: {
  concept: string;
  level?: Difficulty;
}): {
  success: boolean;
  concept: string;
  explanation?: {
    what: string;
    why: string;
    example: string;
    level: Difficulty;
    relatedDocs: Array<{ id: string; deepLink: string }>;
    nextSteps: string[];
  };
  message: string;
} {
  const key = input.concept.trim().toLowerCase();
  if (key.length === 0) {
    return {
      success: false,
      concept: input.concept,
      message: "請給我一個要解釋的關鍵字（例：LoRA、negative prompt、ControlNet）",
    };
  }

  // 模糊比對：完全相等 → 包含 → 部分包含
  const entry =
    CONCEPT_DICTIONARY[key] ??
    Object.entries(CONCEPT_DICTIONARY).find(([k]) => key.includes(k) || k.includes(key))?.[1];

  if (!entry) {
    const known = Object.keys(CONCEPT_DICTIONARY).join(" / ");
    return {
      success: false,
      concept: input.concept,
      message: `沒有「${input.concept}」的內建說明。內建概念：${known}。也可以試 searchLearningContent 翻 LearnHub 全文。`,
    };
  }

  const level = input.level ?? "intermediate";
  const overrides = entry.levels?.[level] ?? {};
  return {
    success: true,
    concept: input.concept,
    explanation: {
      what: overrides.what ?? entry.what,
      why: entry.why,
      example: overrides.example ?? entry.example,
      level,
      relatedDocs: entry.relatedDocIds.map(id => ({
        id,
        deepLink: `/learn-hub?docId=${encodeURIComponent(id)}`,
      })),
      nextSteps: entry.nextSteps,
    },
    message: "解釋已備好",
  };
}

// ─── 工具 8：讀使用者真實學習進度（feature usage） ─────────────────────────
//
// 把 orbFeatureDiscovery 收的 feature usage 投影成「你已掌握 / 進階中 / 還沒碰
// 過」三層；給「下一步該學什麼」具體建議。

export async function getUserLearningProgress(input: {
  userId: number;
}): Promise<{
  success: boolean;
  level: Difficulty;
  features: {
    mastered: Array<{ featureId: string; proficiency: number; usageCount: number }>;
    inProgress: Array<{ featureId: string; proficiency: number; usageCount: number }>;
    untouched: number;
  };
  recommendations: Array<{
    featureId: string;
    reason: string;
    relevanceScore: number;
  }>;
  message: string;
}> {
  await ensureLearnHubLoaded();
  try {
    const stats = await orbFeatureDiscovery.getUserStats(input.userId);
    const recs = await orbFeatureDiscovery.generateRecommendations(input.userId, 5);

    // 分層：proficiency >= 0.7 mastered / 0.3-0.7 inProgress / 0 不算
    const mastered: Array<{ featureId: string; proficiency: number; usageCount: number }> = [];
    const inProgress: Array<{ featureId: string; proficiency: number; usageCount: number }> = [];
    for (const s of stats) {
      const p = s.proficiencyScore ?? 0;
      if (p >= 0.7) {
        mastered.push({ featureId: s.featureId, proficiency: p, usageCount: s.usageCount });
      } else if (s.usageCount > 0) {
        inProgress.push({ featureId: s.featureId, proficiency: p, usageCount: s.usageCount });
      }
    }
    // untouched: 推薦清單裡的 feature 不在 stats 內，視為 untouched 的上限
    const usedIds = new Set(stats.map(s => s.featureId));
    const untouched = recs.filter(r => !usedIds.has(r.featureId)).length;

    // 等級啟發式：mastered >= 5 → advanced；mastered + inProgress >= 3 → intermediate；其餘 → beginner
    const level: Difficulty =
      mastered.length >= 5
        ? "advanced"
        : mastered.length + inProgress.length >= 3
        ? "intermediate"
        : "beginner";

    return {
      success: true,
      level,
      features: { mastered, inProgress, untouched },
      recommendations: recs.map(r => ({
        featureId: r.featureId,
        reason: r.reason,
        relevanceScore: r.relevanceScore,
      })),
      message: `${level} — 已掌握 ${mastered.length} 個功能、進行中 ${inProgress.length} 個`,
    };
  } catch (error) {
    logger.error("learning_progress_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    // 失敗也回 success: true（中性回應），避免一個 DB 抖動就讓學學完全無法回答
    return {
      success: true,
      level: "beginner",
      features: { mastered: [], inProgress: [], untouched: 0 },
      recommendations: [],
      message: "讀不到使用記錄，先假設新手。建議你從入門教學開始。",
    };
  }
}

// ─── 工具 9：推薦下一個學習步驟 ──────────────────────────────────────────────
//
// 綜合 currentPath + 使用者進度（如果有 userId）給「現在最該做的一件事」。
// 比 recommendForContext 更收斂 — 不是給 5 篇，而是給「下一個動作」。

export async function getNextLearningStep(input: {
  userId?: number;
  currentPath?: string;
  hint?: string;
}): Promise<{
  success: boolean;
  nextStep: {
    kind: "read-doc" | "watch-video" | "take-tutorial" | "talk-to-spirit" | "go-to-page";
    title: string;
    description: string;
    resourceId?: string;
    deepLink?: string;
    spirit?: string;
    reason: string;
  };
  alternatives: Array<{ title: string; deepLink?: string; spirit?: string }>;
  message: string;
}> {
  await ensureLearnHubLoaded();
  let level: Difficulty = "beginner";
  if (input.userId !== undefined) {
    try {
      const progress = await getUserLearningProgress({ userId: input.userId });
      level = progress.level;
    } catch {
      // 取不到就走 beginner
    }
  }

  // 1. 有 hint → 試學習路徑模板
  if (input.hint && input.hint.trim().length > 0) {
    const path = generateLearningPath({ goal: input.hint, currentLevel: level });
    if (path.matched && path.steps.length > 0) {
      const s = path.steps[0];
      const firstRes = s.resources[0];
      const kind: "read-doc" | "watch-video" | "take-tutorial" | "talk-to-spirit" | "go-to-page" =
        s.ownerSpirit
          ? "talk-to-spirit"
          : firstRes?.kind === "video"
          ? "watch-video"
          : firstRes?.kind === "tutorial"
          ? "take-tutorial"
          : firstRes
          ? "read-doc"
          : "go-to-page";
      return {
        success: true,
        nextStep: {
          kind,
          title: s.title,
          description: s.description,
          resourceId: firstRes?.id,
          deepLink: firstRes?.deepLink ?? path.finalActionPath,
          spirit: s.ownerSpirit,
          reason: `朝「${path.goalLabel}」目標的第 1 步`,
        },
        alternatives: path.steps.slice(1, 4).map(rest => ({
          title: rest.title,
          deepLink: rest.resources[0]?.deepLink,
          spirit: rest.ownerSpirit,
        })),
        message: `從「${path.goalLabel}」開始，先做第 1 步`,
      };
    }
  }

  // 2. 沒 hint → 用 currentPath 推薦
  if (input.currentPath) {
    const recs = recommendForContext({
      currentPath: input.currentPath,
      difficulty: level,
      limit: 4,
    });
    if (recs.recommendations.length > 0) {
      const top = recs.recommendations[0];
      return {
        success: true,
        nextStep: {
          kind: "read-doc",
          title: top.title,
          description: top.summary,
          resourceId: top.id,
          deepLink: top.deepLink,
          reason: top.matchReason,
        },
        alternatives: recs.recommendations.slice(1, 4).map(r => ({
          title: r.title,
          deepLink: r.deepLink,
        })),
        message: "依你現在所在的頁面推薦下一步",
      };
    }
  }

  // 3. 全空 → fallback 到「快速入門」
  return {
    success: true,
    nextStep: {
      kind: "read-doc",
      title: "Healing Studio 完整入門指南",
      description: "5-8 分鐘看完全站 17 個模組概覽",
      resourceId: "gs-001",
      deepLink: "/learn-hub?docId=gs-001",
      reason: "沒有額外資訊時的安全起點",
    },
    alternatives: [
      { title: "做第一張圖", deepLink: "/image-studio", spirit: "圖圖" },
      { title: "走 image-generation tutorial", deepLink: "/learn-hub" },
    ],
    message: "從入門開始吧",
  };
}
