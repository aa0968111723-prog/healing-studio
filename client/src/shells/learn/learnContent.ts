// ============================================================================
// shells/learn/learnContent.ts — /learn 的靜態知識內容（fallback + 五腦/六代理定義）
// ----------------------------------------------------------------------------
// 這些是「平台方法論」與「代理層定義」，同時餵 RAG 也給人看（盤點 §3-11）。
// 用途：
//   1) LearnDocsPanel 在 learnHub.list 尚無資料（cron 未跑 / DB 不可用）時的精選 fallback。
//   2) AIModelHubPanel 的五腦角色定義（決策/研究/長上下文/感知/生成腦）。
//   3) ResearchPanel / Hub 的六代理層展示。
// 不含任何執行期副作用，純資料常數。
// ============================================================================

/** 五腦角色（對映 user_ai_brain / agent_model_picks；模型 hub 指派用）。 */
export const BRAIN_ROLES = ["決策腦", "研究腦", "長上下文腦", "感知腦", "生成腦"] as const;
export type BrainRole = (typeof BRAIN_ROLES)[number];

/** 哪種 modality 適合指派到哪個腦（前端篩選 eligible 模型用）。 */
export const BRAIN_ELIGIBLE_MODALITY: Record<BrainRole, string[]> = {
  決策腦: ["llm", "text"],
  研究腦: ["search", "llm", "text"],
  長上下文腦: ["llm", "text", "embed"],
  感知腦: ["image", "video", "embed"],
  生成腦: ["image", "video", "audio"],
};

/** 六代理層（盤點 §3-11 / 模擬 SIX_AGENTS）。 */
export interface AgentLayer { id: string; emoji: string; label: string; role: string; tech: string; status: "可用" | "待接" }
export const SIX_AGENTS: AgentLayer[] = [
  { id: "director", emoji: "🎬", label: "導演 AI", role: "創作對話 · CO-STAR 雙引擎 × 三人格", tech: "director.chat", status: "可用" },
  { id: "commander", emoji: "🧭", label: "總指揮 Commander", role: "意圖編排 · 先計畫按開始才動", tech: "commander.createIntent", status: "可用" },
  { id: "context", emoji: "📦", label: "Context Packet", role: "壓縮上下文 · 代理真正讀的精華", tech: "contextPacket.compileProject", status: "可用" },
  { id: "research", emoji: "🌐", label: "研究代理", role: "grounding · Sonar + Brave 帶引用", tech: "orbProxy.unifiedSearch", status: "待接" },
  { id: "perception", emoji: "👁", label: "感知代理", role: "意圖理解 · 模糊先反問", tech: "sense.inferIntent", status: "可用" },
  { id: "accountant", emoji: "🧮", label: "財財（成本）", role: "先估成本再確認 · 扣點記帳", tech: "accountant.estimate / apiUsage", status: "可用" },
];

/** 精選方法論文件（learnHub 無資料時的 fallback；6 篇對映盤點精選）。 */
export interface MethodologyDoc { id: string; title: string; category: string; difficulty: "入門" | "進階" | "高級"; minutes: number; summary: string }
export const METHODOLOGY_DOCS: MethodologyDoc[] = [
  { id: "costar-rag", title: "CO-STAR × RAG 雙引擎入門", category: "生成技術", difficulty: "入門", minutes: 12, summary: "用 CO-STAR 結構化提示 + RAG 檢索增強，讓導演 AI 回覆既有結構又有依據。" },
  { id: "confirm-gate", title: "確認門與來源分級實務", category: "創作流程", difficulty: "進階", minutes: 10, summary: "破壞性 / 高成本動作先確認；來源分 precise / estimate / unconfirmed 三級。" },
  { id: "shot-pipeline", title: "鏡號 S0X 管線", category: "創作流程", difficulty: "進階", minutes: 8, summary: "以鏡號 S01.. 為唯一主鍵串世界觀→腳本→分鏡→生成→成片。" },
  { id: "cost-ladder", title: "成本階梯與 Context Packet", category: "生成技術", difficulty: "高級", minutes: 14, summary: "Deterministic→Cache→RAG→便宜 LLM→Sonar→高級 LLM→媒體生成；長文只進 RAG。" },
  { id: "six-agents", title: "六代理層分工", category: "入門指南", difficulty: "入門", minutes: 9, summary: "導演 / 總指揮 / Context Packet / 研究 / 感知 / 財財，各司其職。" },
  { id: "lora-lock", title: "LoRA 角色定版與四鎖", category: "模型說明", difficulty: "高級", minutes: 11, summary: "角色 LoRA 訓練 + 鎖臉/髮/裝/配件，跨鏡保持一致。" },
  { id: "scenario-ecommerce-image", title: "電商賣家 × 圖：3 步把商品照變主圖", category: "入門指南", difficulty: "入門", minutes: 8, summary: "上手路徑：傳商品照→去背→換情境背景→多張主圖。常見卡關：不知去背/重繪背景；多張圖商品不一致；不知怎麼描述「白底主圖」。推薦功能：ImageStudio 去背＋圖生圖、一致性保險庫（Vault）、資產庫批次匯出。" },
  { id: "scenario-creator-video", title: "自媒體 × 影：從一張圖到 15 秒短影音", category: "入門指南", difficulty: "入門", minutes: 10, summary: "上手路徑：縮圖或一句腳本→圖生影→短影音→配字幕／音樂。常見卡關：影片在背景跑但不知道；模型選擇困難；不知先 480p 試。推薦功能：VideoStudio（Kling v2.1、先 480p）、背景任務中心、導演 AI。" },
  { id: "scenario-educator-voice", title: "教育者 × 音：3 分鐘做出課程旁白", category: "入門指南", difficulty: "入門", minutes: 6, summary: "上手路徑：課程講稿→TTS 旁白（中文）→選配聲音克隆固定音色→配輕音樂。常見卡關：不知平台能做語音；怕聲音克隆很複雜；不知 Qwen TTS 中文最佳。推薦功能：ProStudio 語音合成（Qwen TTS）、音樂生成（純音樂模式）。" },
  { id: "scenario-freelancer-delivery", title: "接案者 × 圖影：5 步交付客戶不跑稿", category: "入門指南", difficulty: "入門", minutes: 10, summary: "上手路徑：定角色→存保險庫→LoRA 定版→多稿比稿→交付規格。常見卡關：客戶改稿後風格跑掉；多稿之間角色不一致；交付尺寸一張張手裁。推薦功能：一致性保險庫（Vault）、LoRA 四鎖、多尺寸匯出（社群圖像台）。" },
  { id: "scenario-editor-batch", title: "內容編輯 × 圖文：一稿多平台、版本不再亂", category: "入門指南", difficulty: "入門", minutes: 9, summary: "上手路徑：定調性→一稿多平台→系列插圖統風→版本比對→收藏入庫。常見卡關：逐張重寫提示太慢；版本一多就亂、找不到定稿。推薦功能：提示詞庫、靈感積木、批次分鏡。" },
  { id: "scenario-brand-consistency", title: "品牌方 × 圖影：張張都合品牌規範", category: "入門指南", difficulty: "入門", minutes: 10, summary: "上手路徑：建品牌 preset→主視覺→衍生成套→審核留痕。常見卡關：生成結果不合品牌規範；衍生素材品牌感深淺不一；素材沒審就發出去。推薦功能：vibe cards、一致性保險庫（場景錨點）、確認門。" },
];

/** learn 文件分類（對映盤點 §3-11：80 篇 6 分類）。難度三級供篩選。 */
export const LEARN_CATEGORIES = [
  { key: "all", label: "全部", count: 80 },
  { key: "getting-started", label: "入門指南", count: 21 },
  { key: "model-guide", label: "模型說明", count: 9 },
  { key: "generation", label: "生成技術", count: 13 },
  { key: "workflow", label: "創作流程", count: 12 },
  { key: "api-docs", label: "API 文件", count: 20 },
  { key: "ai-news", label: "AI 新聞", count: 5 },
] as const;

export const LEARN_DIFFICULTIES = ["入門", "進階", "高級"] as const;

export interface LearnStep { step: number; title: string; learn: string; cta: string }

export const LEARN_BY_DOING_STEPS: LearnStep[] = [
  {
    step: 1,
    title: "看懂提示詞",
    learn: "你會學到提示詞的四個核心元素：主體、風格、光線、品質——缺少任一個，生成就容易跑偏。",
    cta: "開啟提示詞庫的「電商商品白底圖」，試著找出這四個元素在哪裡。",
  },
  {
    step: 2,
    title: "生第一張圖",
    learn: "你會學到直接複製現成提示詞就能得到高品質結果，不需要從零寫起。",
    cta: "前往圖片創作室，貼上白底主圖提示詞，按下生成，看看第一張成果。",
  },
  {
    step: 3,
    title: "微調出你要的",
    learn: "你會學到改一個詞如何大幅改變結果——這是提示詞工程最核心的思維。",
    cta: "把剛才的提示詞中「white background」改成你想要的場景，重新生成比較看看。",
  },
  {
    step: 4,
    title: "讓圖片動起來",
    learn: "你會學到只需一句動作描述，靜態圖就能變成短影音。",
    cta: "把生好的圖送到影片工作室，選 Kling v2.1，寫一句「鏡頭緩緩推近」，生成 4 秒影片。",
  },
  {
    step: 5,
    title: "配上聲音",
    learn: "你會學到用文字直接生成旁白或背景音樂，讓作品更有溫度。",
    cta: "去 ProStudio，選 Qwen TTS，輸入你剛才的商品介紹一句話，聽聽中文合成效果。",
  },
];

// ============================================================================
// 核心人格 0→1 教材（AIDV-966；補完 AIDV-813 的接案者／內容編輯／品牌方）
// ----------------------------------------------------------------------------
// 每份教材＝5 步做中學（每步一個可點動作 href＋一句「這步學到什麼」learn）
// ＋卡關自救微文案（白話、可直接當 UI 文案）＋推薦功能 deep-link。
// promptRefIds 對映 shared/promptReferenceLibrary.ts 的【前後對照】組。
// 純資料常數，無任何執行期副作用。
// ============================================================================

/** 教材單步：沿用 LearnStep 格式，外加可點動作的 deep-link。 */
export interface PersonaLearnStep extends LearnStep { href: string }

/** 卡關自救微文案：stuck＝使用者卡住時的心聲；rescue＝一句白話解法（可直接當 UI 文案）。 */
export interface PersonaRescueTip { stuck: string; rescue: string; featureLabel: string; featureHref: string }

export interface PersonaLearningDoc {
  /** 對映 METHODOLOGY_DOCS.id（scenario-*）。 */
  docId: string;
  persona: string;
  steps: PersonaLearnStep[];
  rescues: PersonaRescueTip[];
  /** 對映 shared/promptReferenceLibrary.ts PROMPT_REFERENCE_LIBRARY 的 id。 */
  promptRefIds: string[];
}

export const PERSONA_LEARNING_DOCS: PersonaLearningDoc[] = [
  // ─ 接案者 × 圖影：交付一致性 ─
  {
    docId: "scenario-freelancer-delivery",
    persona: "接案者",
    steps: [
      {
        step: 1,
        title: "定角色",
        learn: "你會學到先做一張「角色定版圖」，之後所有交付都以它為準，客戶再怎麼改也有基準。",
        cta: "到圖片創作室，用角色定版提示詞（三視圖＋固定色票）生出一張最滿意的角色圖。",
        href: "/image-studio",
      },
      {
        step: 2,
        title: "存入保險庫",
        learn: "你會學到把定版圖存進一致性保險庫，之後每次生圖都能引用同一個角色。",
        cta: "在生成結果下點「存入保險庫」，type 選 character，加上這個案子的標籤。",
        href: "/vault",
      },
      {
        step: 3,
        title: "LoRA 定版",
        learn: "你會學到用 LoRA 訓練＋四鎖（臉／髮／裝／配件），讓角色跨圖跨影都長一樣。",
        cta: "到 LoRA 訓練室，用定版圖訓練你的角色 LoRA，並開啟四鎖。",
        href: "/lora-trainer",
      },
      {
        step: 4,
        title: "多稿比稿",
        learn: "你會學到鎖住角色只換構圖，一次生出 A／B／C 三稿給客戶選，改稿也停在同一個風格裡。",
        cta: "回圖片創作室，引用保險庫角色，只改構圖描述生 3 稿。",
        href: "/image-studio",
      },
      {
        step: 5,
        title: "交付規格",
        learn: "你會學到用多尺寸匯出把定稿一次輸出 1:1、9:16、16:9 三種交付版本，不用一張張手裁。",
        cta: "到社群圖像台，把定稿設為主圖後用多尺寸匯出，一次輸出客戶要的所有尺寸。",
        href: "/social/studio",
      },
    ],
    rescues: [
      {
        stuck: "客戶說「只改一點點」，結果整張的風格都跑掉了。",
        rescue: "別重寫提示詞。回保險庫引用定版角色，只描述要改的那一處，其他都會保持原樣。",
        featureLabel: "一致性保險庫",
        featureHref: "/vault",
      },
      {
        stuck: "三稿給客戶選，結果每張的角色長得不一樣。",
        rescue: "先訓練角色 LoRA 並開四鎖再生比稿；角色鎖住了，構圖才敢放開。",
        featureLabel: "LoRA 四鎖",
        featureHref: "/lora-trainer",
      },
      {
        stuck: "交付前才發現客戶要五種尺寸，一張張重裁到深夜。",
        rescue: "到社群圖像台用多尺寸匯出一次輸出所有交付版本，構圖和留白會自動照顧。",
        featureLabel: "多尺寸匯出（社群圖像台）",
        featureHref: "/social/studio",
      },
    ],
    promptRefIds: ["onboard-fl-charsheet", "onboard-fl-revision-lock", "onboard-fl-3drafts", "onboard-fl-deliver-motion"],
  },

  // ─ 內容編輯 × 圖文：批量與版本 ─
  {
    docId: "scenario-editor-batch",
    persona: "內容編輯",
    steps: [
      {
        step: 1,
        title: "定調性",
        learn: "你會學到先把品牌聲音、目標讀者與禁用詞寫成規則，之後每篇改寫都有同一把尺。",
        cta: "打開提示詞庫，從公共範本挑一份調性提示，改成你們刊物的版本。",
        href: "/prompt-library",
      },
      {
        step: 2,
        title: "一稿多平台",
        learn: "你會學到一段文案一次改寫成 IG、FB、電子報三種版本，不必逐平台重寫。",
        cta: "到創作工作室貼上文案，請 AI 依三個平台的字數與語氣規格各出一版。",
        href: "/studio",
      },
      {
        step: 3,
        title: "系列插圖統風",
        learn: "你會學到風格描述只寫一次、每張只換主體，整個專題的插圖像同一位插畫家畫的。",
        cta: "用批次分鏡把整個系列排出來，套同一段風格描述一次生成。",
        href: "/animation",
      },
      {
        step: 4,
        title: "版本比對",
        learn: "你會學到給 AI 明確的評估準則，版本比對有依據，不是憑感覺挑。",
        cta: "到生成歷史把 A／B 兩版並排，依準則表格比對再定稿。",
        href: "/history",
      },
      {
        step: 5,
        title: "收藏入庫",
        learn: "你會學到把驗證有效的提示收藏入庫並命名，下一期直接複用，不用翻對話紀錄。",
        cta: "把這期的定稿提示存進提示收藏庫，標上專題名稱。",
        href: "/prompt-collection",
      },
    ],
    rescues: [
      {
        stuck: "十張插圖逐張重寫提示詞，一個下午就沒了。",
        rescue: "風格只寫一次：把風格描述存成靈感積木，每張只換主體，十張十分鐘。",
        featureLabel: "靈感積木",
        featureHref: "/studio",
      },
      {
        stuck: "版本 v3、final、final2 混在一起，不知道哪張才是定稿。",
        rescue: "把定稿提示收藏入庫並命名，之後從收藏直接叫出來，不用翻對話紀錄。",
        featureLabel: "提示收藏庫",
        featureHref: "/prompt-collection",
      },
      {
        stuck: "每個平台規格都不一樣，改到最後調性都走味了。",
        rescue: "先用調性範本鎖住聲音，再讓 AI 依平台改格式——格式會變，調性不會。",
        featureLabel: "提示詞庫",
        featureHref: "/prompt-library",
      },
    ],
    promptRefIds: ["onboard-ed-tone-rewrite", "onboard-ed-one-to-three", "onboard-ed-series-style", "onboard-ed-ab-review"],
  },

  // ─ 品牌方 × 圖影：品牌一致 ─
  {
    docId: "scenario-brand-consistency",
    persona: "品牌方",
    steps: [
      {
        step: 1,
        title: "建品牌 preset",
        learn: "你會學到把品牌色、質感、光線寫成一張 vibe card，之後每次生成都從它出發。",
        cta: "到創作工作室用 vibe card 精靈建立你的品牌卡（色票、材質、氛圍）。",
        href: "/studio",
      },
      {
        step: 2,
        title: "主視覺",
        learn: "你會學到主視覺要預留 logo 與標語位置，生成稿才能直接進設計流程。",
        cta: "套用品牌卡，到圖片創作室生成留好 logo 位的活動主視覺。",
        href: "/image-studio",
      },
      {
        step: 3,
        title: "衍生成套",
        learn: "你會學到把主視覺存成保險庫錨點，衍生 9:16、1:1、16:9 一整套時都引用同一個錨點，張張同一個品牌臉。",
        cta: "把主視覺存入保險庫（type 選 scene），之後每張衍生都引用這個錨點再生成。",
        href: "/vault",
      },
      {
        step: 4,
        title: "審核確認門",
        learn: "你會學到對外素材先過確認門：先看計畫、按了開始才生成，不會生出一堆不合規的圖。",
        cta: "在導演模式送出成套需求，在確認門逐鏡檢查後再按開始。",
        href: "/director",
      },
      {
        step: 5,
        title: "留痕歸檔",
        learn: "你會學到把過審版本歸檔到資產庫並打上活動標籤，審核紀錄隨時可回溯。",
        cta: "把定稿存入資產庫，標上活動名稱與版號。",
        href: "/assets",
      },
    ],
    rescues: [
      {
        stuck: "生成的圖很漂亮，但就是不合品牌規範，連色都不對。",
        rescue: "把品牌色票和禁用元素寫進 vibe card，之後每次生成自動帶上，不用每次重講。",
        featureLabel: "vibe cards",
        featureHref: "/studio",
      },
      {
        stuck: "衍生素材一多，每張的品牌感深淺不一。",
        rescue: "主視覺定稿後先存成保險庫錨點再衍生：每張都引用同一個錨點，變的只有尺寸和構圖。",
        featureLabel: "一致性保險庫（場景錨點）",
        featureHref: "/vault",
      },
      {
        stuck: "素材直接生直接發，出事了才發現沒人審過。",
        rescue: "對外素材都走確認門：先看計畫、按了開始才生成，每一步都留紀錄。",
        featureLabel: "確認門",
        featureHref: "/director",
      },
    ],
    promptRefIds: ["onboard-br-vibe-preset", "onboard-br-keyvisual", "onboard-br-derivative-set", "onboard-br-motion-rules"],
  },
];
