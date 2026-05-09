import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Image as ImageIcon,
  Video,
  Music,
  Mic,
  Clapperboard,
  Shield,
  Loader2,
  Wand2,
  Eye,
  Zap,
  Target,
  Palette,
  CircleCheck,
  Clock,
  Layers,
  Terminal,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import AgentBlueprint from "./AgentBlueprint";

// ─── Modality definitions ───────────────────────────────────────────────────

type ModeId = "image" | "video" | "music" | "voice" | "director" | "lora";

interface Mode {
  id: ModeId;
  label: string;
  icon: typeof ImageIcon;
  tint: string;
  glow: string;
  prompt: string;
  meta: string;
  /** Tool name shown in the agent's dispatch trace. */
  tool: string;
  /** Whether this modality has live generation wired up on the homepage. */
  liveGenerate: boolean;
}

const MODES: readonly Mode[] = [
  {
    id: "image",
    label: "圖片",
    icon: ImageIcon,
    tint: "rgba(168,85,247,0.85)",
    glow: "rgba(168,85,247,0.55)",
    prompt: "夕陽下的少女側臉，電影感、淺景深、35mm 底片質感",
    meta: "輸出 1 張 · 約 8 秒",
    tool: "image_generator.nano_banana_2",
    liveGenerate: true,
  },
  {
    id: "video",
    label: "影片",
    icon: Video,
    tint: "rgba(59,130,246,0.85)",
    glow: "rgba(59,130,246,0.5)",
    prompt: "城市夜景慢速推軌，霓虹倒影、雨後濕地、9:16 直式",
    meta: "輸出 5 秒短片 · 約 60-120 秒",
    tool: "videoStudio.klingTextToVideo",
    liveGenerate: true,
  },
  {
    id: "music",
    label: "音樂",
    icon: Music,
    tint: "rgba(236,72,153,0.85)",
    glow: "rgba(236,72,153,0.55)",
    prompt: "冷冽雨夜，慢板鋼琴主旋律 + 弦樂氛圍墊底，BPM 72",
    meta: "輸出原創曲 · 約 30-60 秒",
    tool: "proStudio.textToMusic",
    liveGenerate: true,
  },
  {
    id: "voice",
    label: "配音",
    icon: Mic,
    tint: "rgba(249,115,22,0.85)",
    glow: "rgba(249,115,22,0.5)",
    prompt: "在每一次的呼吸之間，世界都重新誕生一次。",
    meta: "輸出 1 段配音 · 約 10-20 秒",
    tool: "proStudio.qwenTTS",
    liveGenerate: true,
  },
  {
    id: "director",
    label: "導演",
    icon: Clapperboard,
    tint: "rgba(34,197,94,0.85)",
    glow: "rgba(34,197,94,0.5)",
    prompt: "30 秒品牌形象短片，分 5 鏡，溫暖治癒風格，含字幕",
    meta: "拆 5 鏡 + 配樂 + 字幕 · 約 90 秒",
    tool: "director_orchestrator.plan",
    liveGenerate: false,
  },
  {
    id: "lora",
    label: "角色 LoRA",
    icon: Shield,
    tint: "rgba(14,165,233,0.85)",
    glow: "rgba(14,165,233,0.55)",
    prompt: "上傳 12 張參考圖，建立專屬角色模型，跨作品風格一致",
    meta: "訓練專屬模型 · 約 8 分鐘",
    tool: "lora_trainer.create",
    liveGenerate: false,
  },
] as const;

// ─── Scenario presets — fold the former "你可以這樣用" use cases into the
//    orb stage so the agent can dispatch them inline (no studio detour). ──

/** The 15 in-house spirits — nicknames mirror shared/orb-agent-roles.ts so
 *  the homepage demo addresses the same routed roles the chat router uses. */
type SpiritNickname =
  | "圖圖"
  | "影影"
  | "音音"
  | "聲聲"
  | "練練"
  | "學學"
  | "導導"
  | "編編"
  | "品品"
  | "查查"
  | "路路"
  | "暖暖"
  | "財財"
  | "巧巧"
  | "守守";

interface SpiritMeta {
  name: SpiritNickname;
  /** One-line role brief shown in the collaboration chip. */
  role: string;
  tint: string;
}

const SPIRITS: Readonly<Record<SpiritNickname, SpiritMeta>> = {
  圖圖:   { name: "圖圖", role: "圖像精靈 · 主視覺",       tint: "rgba(168,85,247,0.85)" },
  影影:   { name: "影影", role: "影像精靈 · 分鏡與運鏡",   tint: "rgba(59,130,246,0.85)" },
  音音:   { name: "音音", role: "音樂精靈 · 配樂情緒",     tint: "rgba(236,72,153,0.85)" },
  聲聲:   { name: "聲聲", role: "語音精靈 · 旁白配音",     tint: "rgba(249,115,22,0.85)" },
  練練:   { name: "練練", role: "訓練精靈 · LoRA 訓練",    tint: "rgba(14,165,233,0.85)" },
  學學:   { name: "學學", role: "學習精靈 · 教學引導",     tint: "rgba(20,184,166,0.85)" },
  導導:   { name: "導導", role: "導演精靈 · 拆鏡編排",     tint: "rgba(34,197,94,0.85)" },
  編編:   { name: "編編", role: "編排精靈 · 跨素材組裝",   tint: "rgba(139,92,246,0.85)" },
  品品:   { name: "品品", role: "評審精靈 · 候選評分",     tint: "rgba(217,70,239,0.85)" },
  查查:   { name: "查查", role: "研究精靈 · 風格調研",     tint: "rgba(99,102,241,0.85)" },
  路路:   { name: "路路", role: "領航精靈 · 跨平台路由",   tint: "rgba(6,182,212,0.85)" },
  暖暖:   { name: "暖暖", role: "陪伴精靈 · 情緒承接",     tint: "rgba(244,114,182,0.85)" },
  財財:   { name: "財財", role: "精算精靈 · 預算守門",     tint: "rgba(234,179,8,0.85)" },
  巧巧:   { name: "巧巧", role: "提示詞教練 · 詞彙打磨",   tint: "rgba(132,204,22,0.85)" },
  守守:   { name: "守守", role: "糾察精靈 · 一致性巡檢",   tint: "rgba(244,63,94,0.85)" },
} as const;

interface Scenario {
  id: string;
  modeId: ModeId;
  demoForm: "quick" | "multimodal" | "multi-step" | "style";
  label: string;
  eta: string;
  summary: string;
  prompt: string;
  /** Spirit cast — first entry is the lead, rest are collaborators in order. */
  spirits: SpiritNickname[];
  /** Per-handoff one-liner: what the spirit does and to whom they pass. */
  handoffs: { from: SpiritNickname; do: string; next?: SpiritNickname }[];
  runbook: {
    perceive: string;
    plan: string;
    tools: string;
    output: string;
  };
}

const SCENARIOS: readonly Scenario[] = [
  // ── quick (4) ───────────────────────────────────────────────────────────
  {
    id: "product-key-visual",
    modeId: "image",
    demoForm: "quick",
    label: "商品主視覺",
    eta: "8-12 分鐘",
    summary: "圖圖 × 巧巧 × 品品 產出多版可比較稿",
    prompt:
      "極簡質感商品攝影，純色背景、柔光、淺景深、4K，產出 4 版差異稿。",
    spirits: ["圖圖", "巧巧", "品品"],
    handoffs: [
      { from: "巧巧", do: "把『質感、純色、4K』翻成可重複出圖的提示詞模板", next: "圖圖" },
      { from: "圖圖", do: "並行 4 種光線/構圖差異稿，保留 seed", next: "品品" },
      { from: "品品", do: "對 4 張打分並排出推薦首選 + 下一輪微調建議" },
    ],
    runbook: {
      perceive: "解析產品類型與風格關鍵詞，判定以圖片模式為主。",
      plan: "建立 4 組風格差異（構圖、光線、鏡頭語言）快速並行。",
      tools: "呼叫圖片生成工具，失敗自動重試並保留最佳候選。",
      output: "輸出可比較版本與推薦首選，附下一輪優化提示詞。",
    },
  },
  {
    id: "social-short",
    modeId: "video",
    demoForm: "quick",
    label: "社群短影音",
    eta: "10-15 分鐘",
    summary: "影影 × 音音 × 聲聲 9:16 一刀剪",
    prompt:
      "15 秒 9:16 社群短影音，霓虹城市夜景慢推軌，自動節奏點切換、配字幕。",
    spirits: ["影影", "音音", "聲聲"],
    handoffs: [
      { from: "影影", do: "拆 4 個 3.75 秒節奏點，慢推軌 + 霓虹色票", next: "音音" },
      { from: "音音", do: "對齊節奏點生成 BPM 80 配樂", next: "聲聲" },
      { from: "聲聲", do: "上字幕 + 收音標記，輸出可直接發佈版本" },
    ],
    runbook: {
      perceive: "判斷社群平台與直式比例，映射到短影音模板。",
      plan: "先做節奏與分鏡，再進入單支 15 秒影片生成與字幕對齊。",
      tools: "呼叫影片生成並輪詢 fal queue，完成後補字幕節點。",
      output: "交付可直接發佈短片與字幕稿，含下一版節奏調整建議。",
    },
  },
  {
    id: "campaign-poster",
    modeId: "image",
    demoForm: "quick",
    label: "活動主視覺海報",
    eta: "6-10 分鐘",
    summary: "圖圖 × 編編 × 巧巧 一句話海報稿",
    prompt:
      "週末快閃市集活動主視覺，溫暖手繪感、暖橘 + 米白配色，A2 直式、預留標題與資訊區。",
    spirits: ["巧巧", "圖圖", "編編"],
    handoffs: [
      { from: "巧巧", do: "把活動關鍵詞延伸成 3 組情緒提示詞", next: "圖圖" },
      { from: "圖圖", do: "依 3 組提示詞並行出圖、保留版位留白", next: "編編" },
      { from: "編編", do: "套上標題格線 + 資訊區，輸出可印刷版" },
    ],
    runbook: {
      perceive: "辨識是行銷主視覺需求，鎖定海報直式比例。",
      plan: "先建立提示詞、出圖、再做版型套用。",
      tools: "image_generator → composer.layout，皆保留 seed 可重跑。",
      output: "輸出 3 版海報稿與排版來源檔。",
    },
  },
  {
    id: "ad-copy-thumb",
    modeId: "image",
    demoForm: "quick",
    label: "廣告文案縮圖",
    eta: "5-8 分鐘",
    summary: "查查 × 圖圖 × 守守 投放素材組",
    prompt:
      "Meta 廣告 1:1 縮圖三版：強反差、人臉特寫、產品近拍，符合品牌色票 #FFB454。",
    spirits: ["查查", "圖圖", "守守"],
    handoffs: [
      { from: "查查", do: "比對近 7 天表現好的廣告構圖樣式", next: "圖圖" },
      { from: "圖圖", do: "依 3 種構圖各出 1 張、固定品牌色票", next: "守守" },
      { from: "守守", do: "檢查是否壓 logo 安全區、有無禁用字眼" },
    ],
    runbook: {
      perceive: "識別投放平台規範與 1:1 尺寸要求。",
      plan: "先抓參考、再出圖、最後巡檢。",
      tools: "research_web → image_generator → policy_check。",
      output: "3 張可直接送審的縮圖 + 違規檢核報告。",
    },
  },
  // ── multimodal (4) ──────────────────────────────────────────────────────
  {
    id: "brand-short-film",
    modeId: "director",
    demoForm: "multimodal",
    label: "品牌形象短片",
    eta: "20-30 分鐘",
    summary: "導導 × 圖圖 × 影影 × 音音 × 聲聲 全鏈路",
    prompt:
      "幫我做一支 20 秒品牌形象短片，溫暖療癒、自動分鏡、配樂、繁中字幕。",
    spirits: ["導導", "圖圖", "影影", "音音", "聲聲"],
    handoffs: [
      { from: "導導", do: "拆 5 鏡 + 主題曲線、定義每鏡時長", next: "圖圖" },
      { from: "圖圖", do: "出每鏡 key-frame 主視覺鎖風格", next: "影影" },
      { from: "影影", do: "依 key-frame 生成 5 段運鏡、串接", next: "音音" },
      { from: "音音", do: "依分鏡情緒生成 20 秒原創配樂", next: "聲聲" },
      { from: "聲聲", do: "上繁中字幕 + 收尾標語旁白" },
    ],
    runbook: {
      perceive: "辨識品牌調性、受眾與投放平台，先判斷是導演多模態流程。",
      plan: "拆成分鏡、主視覺、配樂、字幕四段任務，依相依順序排程。",
      tools: "先呼叫導演規劃，再串圖片/影片/音樂/配音工具並追蹤 queue。",
      output: "回傳可重跑版本、素材清單、每段耗時與下一步微調建議。",
    },
  },
  {
    id: "podcast-music",
    modeId: "music",
    demoForm: "multimodal",
    label: "Podcast 配樂與旁白",
    eta: "10-15 分鐘",
    summary: "音音 × 聲聲 × 編編 開場包",
    prompt:
      "Podcast 開場 30 秒原創配樂，BPM 76、慢板鋼琴 + 弦樂氛圍，搭配溫暖女聲旁白。",
    spirits: ["音音", "聲聲", "編編"],
    handoffs: [
      { from: "音音", do: "生成 30 秒情緒曲線、保留鋼琴主旋律分軌", next: "聲聲" },
      { from: "聲聲", do: "依 BPM 76 對齊旁白語速與停頓", next: "編編" },
      { from: "編編", do: "做音量平衡與分軌輸出，附 cue sheet" },
    ],
    runbook: {
      perceive: "辨識音樂 + 配音雙模態，先做風格一致性約束。",
      plan: "先生成配樂情緒曲線，再套旁白語速與停頓。",
      tools: "依序呼叫 text-to-music 與 qwenTTS，最後做音量平衡。",
      output: "輸出混音結果與分軌素材，方便後續剪輯。",
    },
  },
  {
    id: "tutorial-video-series",
    modeId: "director",
    demoForm: "multimodal",
    label: "教學影片系列",
    eta: "25-35 分鐘",
    summary: "學學 × 影影 × 聲聲 × 巧巧 教程包",
    prompt:
      "做一個 3 集教學影片系列，每集 60 秒，講解 AI 創作流程，溫和清晰女聲、配字幕。",
    spirits: ["學學", "巧巧", "影影", "聲聲"],
    handoffs: [
      { from: "學學", do: "拆 3 集學習目標 + 每集核心概念", next: "巧巧" },
      { from: "巧巧", do: "把學習目標翻成具體分鏡提示詞", next: "影影" },
      { from: "影影", do: "出 3 集分鏡與動畫示意", next: "聲聲" },
      { from: "聲聲", do: "錄旁白 + 上字幕，輸出三集教學包" },
    ],
    runbook: {
      perceive: "識別是教學內容，需以教育節奏與記憶點優先。",
      plan: "先學習目標、再分鏡、再旁白、最後字幕。",
      tools: "learn.outline → image/video → tts → caption。",
      output: "3 集教學影片 + 教學筆記 + 互動測驗草稿。",
    },
  },
  {
    id: "soul-companion-audio",
    modeId: "voice",
    demoForm: "multimodal",
    label: "情緒陪伴語音",
    eta: "8-12 分鐘",
    summary: "暖暖 × 聲聲 × 音音 安撫包",
    prompt:
      "5 分鐘睡前安撫語音，舒緩女聲、雨聲背景、間隔 8 秒呼吸引導，繁中。",
    spirits: ["暖暖", "聲聲", "音音"],
    handoffs: [
      { from: "暖暖", do: "依使用者狀態擬安撫文案 + 呼吸節奏", next: "聲聲" },
      { from: "聲聲", do: "用舒緩女聲配音、留呼吸引導空檔", next: "音音" },
      { from: "音音", do: "鋪雨聲與低頻氛圍墊，輸出 mp3 + lrc" },
    ],
    runbook: {
      perceive: "辨識情緒陪伴語境，優先採用緩慢節奏與留白。",
      plan: "先文案、再配音、再氛圍墊。",
      tools: "companion.script → tts → ambient_music。",
      output: "5 分鐘安撫音檔 + 文字稿 + 呼吸標記。",
    },
  },
  // ── multi-step (4) ──────────────────────────────────────────────────────
  {
    id: "campaign-pack",
    modeId: "director",
    demoForm: "multi-step",
    label: "完整行銷素材包",
    eta: "30-45 分鐘",
    summary: "導導 × 編編 × 財財 × 守守 全套交付",
    prompt:
      "產出完整行銷素材包：主視覺、15 秒短片、30 秒配樂、繁中旁白，跨格式同步。",
    spirits: ["導導", "編編", "圖圖", "影影", "音音", "聲聲", "財財", "守守"],
    handoffs: [
      { from: "財財", do: "估算總成本與時程上限、設定預算守門", next: "導導" },
      { from: "導導", do: "建立 DAG：主視覺 → 短片 → 配樂 → 旁白", next: "編編" },
      { from: "編編", do: "依序派工 4 模態並追蹤 queue", next: "守守" },
      { from: "守守", do: "跨素材一致性巡檢、產出交付清單" },
    ],
    runbook: {
      perceive: "判斷是跨工具多步驟專案，需先建立里程碑與依賴。",
      plan: "先主視覺、再短片、再配樂與旁白，最後做跨素材一致性檢查。",
      tools: "混合呼叫導演、圖片、影片、音樂與配音工具並集中追蹤狀態。",
      output: "回傳完整素材包、交付清單、風險與重跑入口。",
    },
  },
  {
    id: "multi-platform-resize",
    modeId: "director",
    demoForm: "multi-step",
    label: "多平台素材轉換",
    eta: "12-20 分鐘",
    summary: "路路 × 影影 × 圖圖 × 守守 一鍵跨平台",
    prompt:
      "把這支 16:9 短片同步生 9:16、1:1、4:5 三個版本，自動處理裁切與字幕。",
    spirits: ["路路", "影影", "圖圖", "守守"],
    handoffs: [
      { from: "路路", do: "比對 IG / TikTok / FB 規範與安全區", next: "影影" },
      { from: "影影", do: "對 3 種比例重新運鏡 / 自動 reframe", next: "圖圖" },
      { from: "圖圖", do: "依比例重做封面縮圖", next: "守守" },
      { from: "守守", do: "檢查字幕未被裁切、logo 在安全區內" },
    ],
    runbook: {
      perceive: "識別跨平台投放需求與比例規範。",
      plan: "建立平台 → 比例 → 裁切策略矩陣。",
      tools: "platform.policy → video.reframe → image.thumbnail。",
      output: "3 比例版本 + 封面 + 平台合規報告。",
    },
  },
  {
    id: "social-serial-story",
    modeId: "director",
    demoForm: "multi-step",
    label: "社群連載故事",
    eta: "20-30 分鐘",
    summary: "導導 × 圖圖 × 聲聲 × 暖暖 7 集連載",
    prompt:
      "做一個 7 集社群連載故事，每集 1 張圖 + 30 秒語音，主角一致、情緒漸進。",
    spirits: ["導導", "暖暖", "圖圖", "聲聲"],
    handoffs: [
      { from: "導導", do: "拆 7 集情節大綱與情緒曲線", next: "暖暖" },
      { from: "暖暖", do: "為每集寫第一人稱旁白稿", next: "圖圖" },
      { from: "圖圖", do: "鎖角色一致 + 7 集主視覺", next: "聲聲" },
      { from: "聲聲", do: "錄 7 段旁白、輸出可排程發文素材" },
    ],
    runbook: {
      perceive: "識別連載敘事需求，鎖角色一致與情緒節奏。",
      plan: "先大綱、再文案、再視覺、最後配音。",
      tools: "director.plan → companion.script → image.lora → tts。",
      output: "7 集圖文 + 配音 + 發文時間建議。",
    },
  },
  {
    id: "seasonal-campaign",
    modeId: "director",
    demoForm: "multi-step",
    label: "季節活動企劃",
    eta: "25-40 分鐘",
    summary: "查查 × 編編 × 財財 × 路路 從調研到投放",
    prompt:
      "做一個母親節活動的視覺企劃：調研競品 → 主視覺三版 → 投放素材 → 預算配置。",
    spirits: ["查查", "編編", "財財", "路路", "圖圖"],
    handoffs: [
      { from: "查查", do: "蒐集近 3 年母親節主視覺趨勢與競品", next: "編編" },
      { from: "編編", do: "綜合趨勢設定 3 個方向與品牌差異化", next: "圖圖" },
      { from: "圖圖", do: "出 3 版主視覺 + 投放素材", next: "財財" },
      { from: "財財", do: "依平台 CPM 估算最佳預算配置", next: "路路" },
      { from: "路路", do: "排出 IG / FB / LINE 上架時程" },
    ],
    runbook: {
      perceive: "識別是季節節點企劃，需先做趨勢調研。",
      plan: "調研 → 創意 → 出圖 → 預算 → 排程。",
      tools: "research.web → composer.brief → image → finance.calc → schedule。",
      output: "完整企劃簡報 + 視覺包 + 投放排程。",
    },
  },
  // ── style (3) ───────────────────────────────────────────────────────────
  {
    id: "character-series",
    modeId: "lora",
    demoForm: "style",
    label: "角色一致系列圖",
    eta: "25-40 分鐘",
    summary: "練練 × 圖圖 × 守守 跨作品鎖造型",
    prompt:
      "上傳 12 張參考圖，訓練專屬角色 LoRA，後續以同一造型產出 6 張系列圖。",
    spirits: ["練練", "圖圖", "守守"],
    handoffs: [
      { from: "練練", do: "驗收 12 張參考圖、訓練專屬 LoRA", next: "圖圖" },
      { from: "圖圖", do: "套上 LoRA 跨景產出 6 張系列圖", next: "守守" },
      { from: "守守", do: "比對臉部 / 服裝 / 光線一致性，標出走鐘格" },
    ],
    runbook: {
      perceive: "檢查參考圖品質與角色一致性，評估可訓練性。",
      plan: "先訓練 LoRA，再建立系列圖任務與風格約束。",
      tools: "呼叫 LoRA 訓練流程，完成後回切圖片生成批次出圖。",
      output: "交付模型代碼、最佳觸發詞與系列圖結果。",
    },
  },
  {
    id: "lora-train-deep",
    modeId: "lora",
    demoForm: "style",
    label: "角色 LoRA 進階訓練",
    eta: "40-60 分鐘",
    summary: "練練 × 學學 × 守守 × 財財 把控訓練品質",
    prompt:
      "把這位虛擬主持人的形象訓練成可商用 LoRA，要求穩定 5 種光線與 3 種服裝。",
    spirits: ["練練", "學學", "守守", "財財"],
    handoffs: [
      { from: "財財", do: "估算 8 分鐘 vs 25 分鐘訓練之成本差", next: "學學" },
      { from: "學學", do: "建議 rank / steps / 觸發詞最佳實踐", next: "練練" },
      { from: "練練", do: "依配方訓練、自動取樣驗證收斂", next: "守守" },
      { from: "守守", do: "跨光線 / 服裝測試，輸出一致性分數" },
    ],
    runbook: {
      perceive: "識別是商用 LoRA 訓練，要求高一致性與可重現。",
      plan: "預算 → 配方 → 訓練 → 跨景驗證。",
      tools: "finance.calc → learn.advise → lora.train → consistency.check。",
      output: "LoRA 權重 + 觸發詞表 + 一致性報告。",
    },
  },
  {
    id: "season-style-mood",
    modeId: "image",
    demoForm: "style",
    label: "跨季節主視覺",
    eta: "15-25 分鐘",
    summary: "編編 × 圖圖 × 巧巧 一套四季",
    prompt:
      "為咖啡品牌做四季主視覺，同一構圖、不同季節色票與光線，跨季風格一致。",
    spirits: ["編編", "圖圖", "巧巧"],
    handoffs: [
      { from: "編編", do: "鎖定共用構圖與品牌符號", next: "巧巧" },
      { from: "巧巧", do: "為春夏秋冬寫 4 組差異提示詞", next: "圖圖" },
      { from: "圖圖", do: "並行出 4 季主視覺、保留 seed 可重跑" },
    ],
    runbook: {
      perceive: "識別是系列風格需求，需鎖共用元素。",
      plan: "先框架、再差異提示詞、最後並行出圖。",
      tools: "composer.frame → prompt.craft → image.batch。",
      output: "四季主視覺 + 共用構圖手冊。",
    },
  },
] as const;

interface DemoForm {
  id: "quick" | "multimodal" | "multi-step" | "style";
  label: string;
  description: string;
  layers: { name: string; detail: string }[];
}

const DEMO_FORMS: readonly DemoForm[] = [
  {
    id: "quick",
    label: "快啟演示",
    description: "一句話 → 直送單一工具 → 8 秒內出第一版可用素材。",
    layers: [
      { name: "感應層", detail: "解析輸入語意，鎖定唯一模態（圖／影／音）。" },
      { name: "派工層", detail: "直送對應工具，省去跨工具編排成本。" },
      { name: "回收層", detail: "輪詢 fal queue → 取回成品與可重跑 seed。" },
    ],
  },
  {
    id: "multimodal",
    label: "多模態演示",
    description: "同時處理圖／影／音／配音 — 跨模態風格與情緒一致。",
    layers: [
      { name: "感應層", detail: "辨識多模態需求，先建立風格與情緒錨點。" },
      { name: "規劃層", detail: "依模態相依排程：先主視覺 → 短片 → 音樂 → 旁白。" },
      { name: "派工層", detail: "並行呼叫圖片、影片、音樂、配音工具。" },
      { name: "對齊層", detail: "字幕節拍、色票、人聲音量自動對齊主視覺。" },
      { name: "交付層", detail: "回傳整包素材 + 跨模態一致性報告。" },
    ],
  },
  {
    id: "multi-step",
    label: "多步驟演示",
    description: "拆解里程碑 → 多階段 DAG → 失敗自動重試與恢復。",
    layers: [
      { name: "感應層", detail: "識別跨工具專案，估算總時長與成本守門。" },
      { name: "規劃層", detail: "建立有向相依（DAG）與里程碑檢核點。" },
      { name: "派工層", detail: "依序呼叫導演、圖片、影片、音樂、配音。" },
      { name: "監看層", detail: "監看每段 queue，失敗自動重試並保留最佳候選。" },
      { name: "交付層", detail: "回傳成品包 + 重跑配方 + 風險與下一步建議。" },
    ],
  },
  {
    id: "style",
    label: "風格一致演示",
    description: "用 LoRA 鎖角色與風格 — 跨作品同一造型不走鐘。",
    layers: [
      { name: "感應層", detail: "讀取參考圖集，量化角色／風格一致性指標。" },
      { name: "規劃層", detail: "決定 rank / steps / 觸發詞與訓練預算。" },
      { name: "訓練層", detail: "監看 loss 曲線並自動取樣驗證收斂。" },
      { name: "驗證層", detail: "跨景測試臉部、服裝與光線一致性。" },
      { name: "交付層", detail: "輸出 LoRA 權重 + 觸發詞 + 推薦 prompt。" },
    ],
  },
] as const;

// ─── Inline value strip — folded in from the former site value highlights. ──

const VALUE_HIGHLIGHTS = [
  { id: "speed", icon: Zap, label: "一句話到成品" },
  { id: "consistency", icon: Target, label: "風格一致" },
  { id: "scene", icon: Palette, label: "場景四時段" },
  { id: "iterate", icon: CircleCheck, label: "版本可重跑" },
] as const;

// ─── Phase label (shared chrome) ────────────────────────────────────────────

function PhaseLabel({ tint, label }: { tint: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-3 sm:mb-4">
      <span
        className="block h-px w-8 rounded-full"
        style={{ background: `linear-gradient(90deg, transparent, ${tint})` }}
      />
      <span
        className="text-[10px] tracking-[0.4em] uppercase font-medium"
        style={{ color: tint }}
      >
        {label}
      </span>
      <span
        className="block h-px w-8 rounded-full"
        style={{ background: `linear-gradient(90deg, ${tint}, transparent)` }}
      />
    </div>
  );
}

// ─── Pointer-reactive orb (mouse + touch) ───────────────────────────────────

interface InteractiveOrbProps {
  tint: string;
  glow: string;
  /** When > 0, the orb pulses at this intensity (e.g. while user types). */
  excitement: number;
  /** When true, the orb shows a generation/loading shimmer. */
  busy: boolean;
}

function InteractiveOrb({ tint, glow, excitement, busy }: InteractiveOrbProps) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Pointer position relative to centre, normalised to [-1, 1].
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sxNorm = useSpring(px, { stiffness: 110, damping: 16, mass: 0.5 });
  const syNorm = useSpring(py, { stiffness: 110, damping: 16, mass: 0.5 });

  const orbX = useTransform(sxNorm, [-1, 1], [-12, 12]);
  const orbY = useTransform(syNorm, [-1, 1], [-12, 12]);
  const rotX = useTransform(syNorm, [-1, 1], [10, -10]);
  const rotY = useTransform(sxNorm, [-1, 1], [-12, 12]);

  useEffect(() => {
    if (reduce) return;
    const el = wrapRef.current;
    if (!el) return;

    const setFromClient = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ratioX = (clientX - cx) / Math.max(rect.width / 2, 1);
      const ratioY = (clientY - cy) / Math.max(rect.height / 2, 1);
      px.set(Math.max(-1.5, Math.min(1.5, ratioX)));
      py.set(Math.max(-1.5, Math.min(1.5, ratioY)));
    };

    const onPointerMove = (e: PointerEvent) => {
      setFromClient(e.clientX, e.clientY);
    };
    const onPointerLeave = () => {
      px.set(0);
      py.set(0);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      setFromClient(t.clientX, t.clientY);
    };
    const onTouchEnd = () => {
      px.set(0);
      py.set(0);
    };

    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [reduce, px, py]);

  const breathScale = 1 + Math.min(excitement, 1) * 0.08;

  return (
    <div
      ref={wrapRef}
      className="relative w-32 h-32 sm:w-40 sm:h-40 lg:w-44 lg:h-44 select-none overflow-hidden rounded-full"
      style={{ perspective: 800, touchAction: "none" }}
      aria-hidden
    >
      {/* outer glow */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
        }}
        animate={
          reduce
            ? undefined
            : {
                scale: [breathScale, breathScale * 1.08, breathScale],
                opacity: [0.4, 0.6, 0.4],
              }
        }
        transition={{ duration: busy ? 2.5 : 6, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* expanding rings — clipped by overflow-hidden on parent */}
      {!reduce && (
        <>
          {[0, 1].map(i => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ border: `1px solid ${tint}` }}
              animate={{ scale: [1, 1.5], opacity: [0.4, 0] }}
              transition={{
                duration: busy ? 2 : 5,
                delay: i * 2.5,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}
        </>
      )}
      {/* tilting core */}
      <motion.div
        className="absolute inset-3 sm:inset-4"
        style={{
          x: reduce ? 0 : orbX,
          y: reduce ? 0 : orbY,
          rotateX: reduce ? 0 : rotX,
          rotateY: reduce ? 0 : rotY,
          transformStyle: "preserve-3d",
        }}
      >
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95) 0%, ${tint} 40%, ${glow} 75%, transparent 100%)`,
            boxShadow: `0 0 50px ${glow}, inset 0 0 24px rgba(255,255,255,0.6)`,
          }}
          animate={
            reduce
              ? undefined
              : { rotate: 360, scale: [1, 1.025, 1] }
          }
          transition={{
            rotate: { duration: busy ? 10 : 28, repeat: Infinity, ease: "linear" },
            scale: { duration: 5, repeat: Infinity, ease: "easeInOut" },
          }}
        />
        {busy && (
          <motion.div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)",
              mixBlendMode: "screen",
            }}
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </motion.div>
    </div>
  );
}

// ─── Output previews (placeholder + real image) ─────────────────────────────

function PlaceholderImage({ tint }: { tint: string }) {
  // Each card represents a different cinematographic interpretation that the
  // agent would dispatch in parallel — shot type, lens, palette, subject pos,
  // composition guides, light direction, and a scan-line "render" pass so it
  // reads as an actual generated image instead of a blurred silhouette.
  const variants = [
    {
      shot: "CU",
      lens: "85mm f/1.4",
      iso: "ISO 200",
      mood: "戲劇",
      subject: { x: 36, y: 50 },
      faceScale: 1.0,
      horizon: 0.62,
      sun: { x: 78, y: 28, intensity: 0.9 },
      palette: ["#1f1535", "#7e3ad6", "#fde7c1"],
      seed: "8a3f12",
    },
    {
      shot: "MS",
      lens: "50mm f/1.8",
      iso: "ISO 400",
      mood: "情緒",
      subject: { x: 62, y: 60 },
      faceScale: 0.7,
      horizon: 0.55,
      sun: { x: 22, y: 24, intensity: 0.8 },
      palette: ["#231a3a", "#a85cd8", "#fdb1a7"],
      seed: "4c2d91",
    },
    {
      shot: "WS",
      lens: "35mm f/2.0",
      iso: "ISO 800",
      mood: "氛圍",
      subject: { x: 50, y: 72 },
      faceScale: 0.45,
      horizon: 0.48,
      sun: { x: 50, y: 18, intensity: 0.7 },
      palette: ["#3a2255", "#c478e8", "#fdf0d7"],
      seed: "f7e205",
    },
    {
      shot: "OTS",
      lens: "24mm f/2.8",
      iso: "ISO 320",
      mood: "敘事",
      subject: { x: 38, y: 64 },
      faceScale: 0.85,
      horizon: 0.58,
      sun: { x: 82, y: 30, intensity: 0.85 },
      palette: ["#101a3a", "#5a8de8", "#cfe1ff"],
      seed: "12bd47",
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-1.5 w-full h-full p-1">
      {variants.map((v, i) => (
        <motion.div
          key={i}
          className="rounded-lg relative overflow-hidden"
          style={{
            background: `linear-gradient(180deg, ${v.palette[0]} 0%, ${v.palette[1]} ${Math.round(v.horizon * 100)}%, ${v.palette[2]} 100%)`,
            border: `1px solid ${tint}`,
          }}
          initial={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ delay: 0.15 + i * 0.12, duration: 0.5 }}
        >
          {/* SVG scene — sky / sun / ground / silhouette so the card reads as
              an actual photo composition, not a blurred ellipse. */}
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <radialGradient id={`sun-${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(255,245,220,1)" />
                <stop offset="40%" stopColor={`rgba(255,220,170,${v.sun.intensity * 0.65})`} />
                <stop offset="100%" stopColor="rgba(255,220,170,0)" />
              </radialGradient>
              <linearGradient id={`ground-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`${v.palette[2]}`} stopOpacity="0.55" />
                <stop offset="100%" stopColor={`${v.palette[0]}`} stopOpacity="0.35" />
              </linearGradient>
              <linearGradient id={`subjBody-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(40,28,55,0.85)" />
                <stop offset="100%" stopColor="rgba(20,15,30,0.95)" />
              </linearGradient>
            </defs>

            {/* Horizon glow band — bridge between sky & ground */}
            <rect
              x="0"
              y={v.horizon * 100 - 6}
              width="100"
              height="12"
              fill={v.palette[2]}
              opacity="0.18"
            />

            {/* Sun / light source */}
            <circle
              cx={v.sun.x}
              cy={v.sun.y}
              r="9"
              fill={`url(#sun-${i})`}
            />
            <circle
              cx={v.sun.x}
              cy={v.sun.y}
              r="2.8"
              fill="rgba(255,250,235,0.95)"
            />

            {/* Ground / foreground */}
            <rect
              x="0"
              y={v.horizon * 100}
              width="100"
              height={100 - v.horizon * 100}
              fill={`url(#ground-${i})`}
            />

            {/* Subject silhouette — head + shoulders + body, scaled by shot.
                For wide shots, smaller; for close-ups, larger and higher. */}
            {(() => {
              const cx = v.subject.x;
              const cy = v.subject.y;
              const s = v.faceScale;
              const headR = 5 * s;
              const headCy = cy - 7 * s;
              const shoulderTop = cy - 1 * s;
              const shoulderHalf = 7 * s;
              const bodyBottom = Math.min(99, cy + 22 * s);
              return (
                <>
                  {/* body / shoulders */}
                  <path
                    d={`M ${cx - shoulderHalf} ${shoulderTop}
                        Q ${cx - shoulderHalf * 1.1} ${shoulderTop + 4 * s} ${cx - shoulderHalf * 1.3} ${bodyBottom}
                        L ${cx + shoulderHalf * 1.3} ${bodyBottom}
                        Q ${cx + shoulderHalf * 1.1} ${shoulderTop + 4 * s} ${cx + shoulderHalf} ${shoulderTop}
                        Q ${cx} ${shoulderTop - 2 * s} ${cx - shoulderHalf} ${shoulderTop} Z`}
                    fill={`url(#subjBody-${i})`}
                  />
                  {/* hair back */}
                  <path
                    d={`M ${cx - headR * 1.1} ${headCy + headR * 0.4}
                        Q ${cx - headR * 1.3} ${headCy - headR * 0.8} ${cx} ${headCy - headR * 1.1}
                        Q ${cx + headR * 1.3} ${headCy - headR * 0.8} ${cx + headR * 1.1} ${headCy + headR * 0.4} Z`}
                    fill="rgba(30,20,40,0.95)"
                  />
                  {/* head */}
                  <ellipse
                    cx={cx}
                    cy={headCy}
                    rx={headR}
                    ry={headR * 1.15}
                    fill="rgba(245,220,195,0.92)"
                    stroke="rgba(60,40,30,0.35)"
                    strokeWidth="0.3"
                  />
                  {/* rim light from sun direction */}
                  <ellipse
                    cx={cx + (v.sun.x > 50 ? headR * 0.5 : -headR * 0.5)}
                    cy={headCy - headR * 0.3}
                    rx={headR * 0.4}
                    ry={headR * 0.7}
                    fill={`rgba(255,235,200,${v.sun.intensity * 0.5})`}
                  />
                </>
              );
            })()}
          </svg>

          {/* Rule-of-thirds composition guide */}
          <div
            className="absolute inset-0 pointer-events-none opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.6) calc(33.33% - 0.5px), rgba(255,255,255,0.6) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.6) calc(66.66% - 0.5px), rgba(255,255,255,0.6) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)), linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.6) calc(33.33% - 0.5px), rgba(255,255,255,0.6) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.6) calc(66.66% - 0.5px), rgba(255,255,255,0.6) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px))",
            }}
          />

          {/* Subject focus crosshair — pin to the head of the silhouette so
              users see where the agent locked focus. Subject anchor is at the
              torso (subject.y) so the head sits ~7%·faceScale above it. */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${v.subject.x}%`,
              top: `${Math.max(8, v.subject.y - 7 * v.faceScale)}%`,
              width: 14,
              height: 14,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className="absolute inset-0 rounded-sm"
              style={{ border: `1px solid ${tint}`, opacity: 0.85 }}
            />
            <div
              className="absolute left-1/2 top-0 bottom-0 w-px"
              style={{ background: tint, opacity: 0.7 }}
            />
            <div
              className="absolute top-1/2 left-0 right-0 h-px"
              style={{ background: tint, opacity: 0.7 }}
            />
          </div>

          {/* Shot label */}
          <div
            className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-mono font-semibold tracking-wider"
            style={{
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              border: `1px solid ${tint}`,
              backdropFilter: "blur(4px)",
            }}
          >
            {v.shot}
          </div>
          {/* Variant + seed badge */}
          <div className="absolute top-1 right-1 flex items-center gap-1">
            <span
              className="px-1 py-[1px] rounded text-[7px] font-mono"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
              }}
            >
              #{v.seed}
            </span>
            <span
              className="px-1.5 py-0.5 rounded-full text-[8px] font-semibold"
              style={{ background: tint, color: "#fff" }}
            >
              V{i + 1}
            </span>
          </div>

          {/* Bottom EXIF strip: lens, ISO, mood, palette histogram */}
          <div className="absolute left-1 right-1 bottom-1 flex items-center gap-1 text-[7.5px]">
            <span
              className="px-1 py-0.5 rounded font-mono"
              style={{
                background: "rgba(0,0,0,0.65)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
                backdropFilter: "blur(4px)",
              }}
            >
              {v.lens}
            </span>
            <span
              className="px-1 py-0.5 rounded font-mono hidden sm:inline"
              style={{
                background: "rgba(0,0,0,0.65)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
                backdropFilter: "blur(4px)",
              }}
            >
              {v.iso}
            </span>
            <span
              className="px-1 py-0.5 rounded"
              style={{
                background: "rgba(0,0,0,0.65)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
                backdropFilter: "blur(4px)",
              }}
            >
              {v.mood}
            </span>
            <span className="ml-auto flex items-end gap-px h-3">
              {/* Tiny color histogram derived from palette */}
              {[
                { c: v.palette[0], h: 60 },
                { c: v.palette[0], h: 80 },
                { c: v.palette[1], h: 100 },
                { c: v.palette[1], h: 70 },
                { c: v.palette[2], h: 50 },
                { c: v.palette[2], h: 35 },
              ].map((b, j) => (
                <span
                  key={j}
                  className="w-[3px] rounded-t-sm"
                  style={{
                    background: b.c,
                    height: `${b.h}%`,
                    boxShadow: "0 0 0 0.5px rgba(255,255,255,0.45)",
                  }}
                />
              ))}
            </span>
          </div>

          {/* Active "rendering" scan line — staggered per card so the four
              previews look like they're being painted by the agent. */}
          <motion.div
            className="absolute inset-x-0 h-[2px] pointer-events-none"
            style={{
              background: `linear-gradient(90deg, transparent, ${tint}, transparent)`,
              boxShadow: `0 0 8px ${tint}`,
            }}
            animate={{ top: ["-2px", "100%"] }}
            transition={{
              duration: 2.6,
              delay: 0.3 + i * 0.4,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* Soft shimmer for "wet paint" gloss */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)",
            }}
            animate={{ x: ["-100%", "100%"] }}
            transition={{
              duration: 2.8,
              delay: 0.4 + i * 0.2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}

function PlaceholderVideo({ tint }: { tint: string }) {
  // Storyboard frames — each frame has a timecode, motion hint, and tone tint
  // so the preview reads as a real shot list rather than empty boxes.
  const frames = [
    { tc: "00:00", motion: "fade-in", palette: ["#0d1230", "#3b82f6"] },
    { tc: "00:01", motion: "push-in", palette: ["#142048", "#60a5fa"] },
    { tc: "00:02", motion: "tilt-up", palette: ["#1c2c5e", "#93c5fd"] },
    { tc: "00:03", motion: "track-L", palette: ["#0f1d4a", "#3b82f6"] },
    { tc: "00:04", motion: "hold", palette: ["#0a1532", "#1d4ed8"] },
  ] as const;
  return (
    <div className="flex flex-col gap-1.5 w-full h-full p-2 justify-center">
      <div className="flex gap-1.5">
        {frames.map((f, i) => (
          <motion.div
            key={i}
            className="flex-1 aspect-[3/4] rounded-md relative overflow-hidden"
            style={{
              background: `linear-gradient(160deg, ${f.palette[0]}, ${f.palette[1]})`,
              border: `1px solid ${tint}`,
            }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            {/* subject silhouette */}
            <div
              className="absolute rounded-full"
              style={{
                left: `${30 + i * 10}%`,
                top: "55%",
                width: "38%",
                height: "30%",
                background: `radial-gradient(circle, rgba(255,255,255,0.85), ${f.palette[1]}66 60%, transparent)`,
                transform: "translate(-50%, -50%)",
                filter: "blur(2px)",
              }}
            />
            {/* timecode */}
            <span
              className="absolute top-0.5 left-0.5 text-[7.5px] font-mono px-1 py-[1px] rounded"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                border: `1px solid ${tint}`,
              }}
            >
              {f.tc}
            </span>
            {/* frame number */}
            <span
              className="absolute top-0.5 right-0.5 text-[7.5px] font-semibold px-1 py-[1px] rounded-full"
              style={{ background: tint, color: "#fff" }}
            >
              F{i + 1}
            </span>
            {/* motion label */}
            <span
              className="absolute left-0.5 right-0.5 bottom-0.5 text-[7.5px] font-mono text-center px-0.5 py-[1px] rounded"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
              }}
            >
              {f.motion}
            </span>
          </motion.div>
        ))}
      </div>
      {/* Timeline ruler */}
      <div className="flex items-center gap-1 mt-1 text-[8px] font-mono">
        <span style={{ color: tint }}>00:00</span>
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden relative"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${tint}, rgba(255,255,255,0.85))`,
              boxShadow: `0 0 8px ${tint}`,
            }}
            animate={{ width: ["0%", "100%"] }}
            transition={{ duration: 3.0, repeat: Infinity, ease: "linear" }}
          />
          {/* frame markers */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <span
              key={i}
              className="absolute top-0 bottom-0 w-px"
              style={{ left: `${p * 100}%`, background: "rgba(255,255,255,0.4)" }}
            />
          ))}
        </div>
        <span style={{ color: tint }}>00:05</span>
      </div>
    </div>
  );
}

function PlaceholderMusic({ tint }: { tint: string }) {
  // DAW-style preview: BPM + Key + Genre header, four-track waveform (drums/
  // bass/pad/lead), timeline cursor — reads as an actual produced piece
  // rather than 24 abstract bars.
  const tracks = [
    { name: "DRUM", color: "rgba(236,72,153,0.85)", pattern: [3, 1, 3, 2, 3, 1, 3, 2, 3, 1, 3, 2, 3, 1, 3, 2] },
    { name: "BASS", color: "rgba(168,85,247,0.85)", pattern: [2, 0, 0, 1, 2, 0, 1, 0, 2, 0, 0, 1, 2, 0, 1, 0] },
    { name: " PAD", color: "rgba(99,102,241,0.85)", pattern: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] },
    { name: "LEAD", color: "rgba(244,114,182,0.85)", pattern: [0, 0, 1, 2, 3, 2, 1, 0, 0, 1, 2, 3, 2, 1, 0, 0] },
  ] as const;
  return (
    <div className="flex flex-col w-full h-full px-2 py-1.5 gap-1">
      {/* Header strip — BPM / KEY / GENRE */}
      <div className="flex items-center justify-between text-[8.5px] font-mono">
        <div className="flex gap-1">
          <span
            className="px-1.5 py-[1px] rounded font-semibold"
            style={{ background: tint, color: "#fff" }}
          >
            BPM 76
          </span>
          <span
            className="px-1.5 py-[1px] rounded"
            style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
          >
            KEY · A♭m
          </span>
          <span
            className="px-1.5 py-[1px] rounded hidden sm:inline"
            style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
          >
            cinematic
          </span>
        </div>
        <span style={{ color: tint }}>00:00 / 00:30</span>
      </div>

      {/* Four-track waveform stack */}
      <div className="flex-1 min-h-0 flex flex-col gap-[3px] relative">
        {tracks.map((t, ti) => (
          <div
            key={t.name}
            className="flex items-center gap-1.5 flex-1 min-h-0"
          >
            <span
              className="text-[7.5px] font-mono shrink-0 font-semibold"
              style={{ color: t.color, width: 26 }}
            >
              {t.name}
            </span>
            <div
              className="flex-1 h-full flex items-center gap-[1.5px] rounded overflow-hidden px-1"
              style={{
                background: "rgba(0,0,0,0.18)",
                border: `1px solid ${t.color}`,
              }}
            >
              {t.pattern.map((p, i) => (
                <motion.span
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    background: t.color,
                    boxShadow: `0 0 4px ${t.color}`,
                    minWidth: 2,
                  }}
                  animate={{
                    height: [
                      `${20 + p * 18}%`,
                      `${35 + p * 16}%`,
                      `${20 + p * 18}%`,
                    ],
                  }}
                  transition={{
                    duration: 1.4 + (i % 3) * 0.12,
                    delay: ti * 0.08 + i * 0.04,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Playhead cursor sweeping across all tracks */}
        <motion.div
          className="absolute inset-y-0 w-[2px] pointer-events-none"
          style={{
            background: `linear-gradient(180deg, ${tint}, rgba(255,255,255,0.85))`,
            boxShadow: `0 0 10px ${tint}`,
            left: "32px",
          }}
          animate={{ left: ["32px", "calc(100% - 4px)"] }}
          transition={{ duration: 4.0, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Bottom: timeline ticks */}
      <div className="flex items-center gap-[3px] text-[7px] font-mono opacity-70">
        {[0, 4, 8, 12, 16, 20, 24, 28].map((s) => (
          <span
            key={s}
            className="flex-1 text-center"
            style={{ color: tint }}
          >
            {String(s).padStart(2, "0")}s
          </span>
        ))}
      </div>
    </div>
  );
}

function PlaceholderVoice({ tint }: { tint: string }) {
  // Voice preview: voice profile + waveform amplitude bars (40 samples) +
  // rolling caption preview + LR meters — looks like a real configured TTS
  // call rather than a single sine wave.
  const samples = Array.from({ length: 40 }, (_, i) => i);
  // Realistic-looking amplitude envelope: silence → ramp → speech → trail
  const envelope = (i: number) => {
    if (i < 3 || i > 36) return 0.1;
    if (i < 7) return 0.25 + (i - 3) * 0.08;
    if (i > 32) return 0.55 - (i - 32) * 0.1;
    // pseudo-random speech amplitude derived from position
    const base = 0.45 + Math.sin(i * 0.7) * 0.18 + Math.cos(i * 1.3) * 0.12;
    const noise = ((i * 17) % 23) / 60;
    return Math.max(0.18, Math.min(0.95, base + noise));
  };
  return (
    <div className="flex flex-col w-full h-full px-2 py-1.5 gap-1.5">
      {/* Header: voice profile + language tag */}
      <div className="flex items-center justify-between text-[8.5px] font-mono">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded"
            style={{ background: tint, color: "#fff" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full bg-white"
              style={{ boxShadow: "0 0 4px #fff" }}
            />
            qwen-tts · 溫暖女聲
          </span>
          <span
            className="px-1.5 py-[1px] rounded hidden sm:inline"
            style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
          >
            zh-TW
          </span>
        </div>
        <span style={{ color: tint }}>0:14 / 0:18</span>
      </div>

      {/* Waveform — symmetric amplitude bars centered on midline */}
      <div
        className="flex-1 min-h-0 relative rounded-md overflow-hidden flex items-center"
        style={{
          background: "rgba(0,0,0,0.22)",
          border: `1px solid ${tint}`,
        }}
      >
        <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-center gap-[2px] px-1.5">
          {samples.map((i) => {
            const amp = envelope(i);
            return (
              <motion.span
                key={i}
                className="flex-1 rounded-full"
                style={{
                  background: tint,
                  boxShadow: `0 0 4px ${tint}`,
                  minWidth: 1.5,
                }}
                animate={{
                  height: [
                    `${amp * 60}%`,
                    `${amp * 100}%`,
                    `${amp * 60}%`,
                  ],
                }}
                transition={{
                  duration: 0.9 + (i % 3) * 0.15,
                  delay: i * 0.025,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            );
          })}
        </div>

        {/* Centerline */}
        <div
          className="absolute inset-x-0 top-1/2 h-px pointer-events-none"
          style={{ background: "rgba(255,255,255,0.18)" }}
        />

        {/* Sweeping playhead */}
        <motion.div
          className="absolute inset-y-0 w-[2px] pointer-events-none"
          style={{
            background: `linear-gradient(180deg, transparent, ${tint}, transparent)`,
            boxShadow: `0 0 10px ${tint}`,
          }}
          animate={{ left: ["0%", "100%"] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Rolling caption preview */}
      <div
        className="rounded px-1.5 py-1 text-[10px] sm:text-[11px] leading-tight relative overflow-hidden"
        style={{
          background: "rgba(0,0,0,0.5)",
          border: `1px solid ${tint}`,
          color: "#fff",
        }}
      >
        <motion.span
          className="block whitespace-nowrap font-mono"
          animate={{ x: ["8%", "-92%"] }}
          transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
          style={{ display: "inline-block" }}
        >
          『 在每一次的呼吸之間，世界都重新誕生一次 』
          <span className="opacity-60 ml-3">— 自動上字幕 · WPM 145 · pause 0.4s ·</span>
        </motion.span>
      </div>

      {/* LR meter row */}
      <div className="flex items-center gap-1.5 text-[7.5px] font-mono">
        {(["L", "R"] as const).map((ch, ci) => (
          <div key={ch} className="flex items-center gap-1 flex-1">
            <span style={{ color: tint }}>{ch}</span>
            <div
              className="flex-1 h-1 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${tint}, #fff)`,
                }}
                animate={{ width: ci === 0 ? ["35%", "75%", "55%"] : ["55%", "70%", "40%"] }}
                transition={{
                  duration: 1.6 + ci * 0.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaceholderDirector({ tint }: { tint: string }) {
  // Storyboard with directional flow: 5 scenes + final delivery card.
  // Cards animate in sequence to show the director's scheduling pass; a
  // sweeping highlight ring marks "currently rendering" so viewers see this
  // is a live plan, not 6 static boxes.
  const scenes = [
    { tag: "S1", role: "開場", detail: "品牌主題", dur: "4s", color: "rgba(168,85,247,0.85)" },
    { tag: "S2", role: "鋪陳", detail: "情緒鋪墊", dur: "6s", color: "rgba(99,102,241,0.85)" },
    { tag: "S3", role: "高潮", detail: "產品特寫", dur: "5s", color: "rgba(34,197,94,0.85)" },
    { tag: "S4", role: "轉折", detail: "使用情境", dur: "5s", color: "rgba(59,130,246,0.85)" },
    { tag: "S5", role: "收束", detail: "標語+LOGO", dur: "4s", color: "rgba(244,114,182,0.85)" },
    { tag: "✓",  role: "成品包", detail: "影+樂+字", dur: "24s", color: "rgba(234,179,8,0.85)" },
  ] as const;
  return (
    <div className="flex flex-col w-full h-full p-2 gap-1">
      {/* Header: timeline summary */}
      <div className="flex items-center justify-between text-[8.5px] font-mono">
        <span
          className="px-1.5 py-[1px] rounded font-semibold"
          style={{ background: tint, color: "#fff" }}
        >
          STORYBOARD · 6 nodes
        </span>
        <span style={{ color: tint }}>total 24s · 5 cuts + 1 delivery</span>
      </div>

      {/* Scene grid — 3 cols, with arrow connectors between same-row cards
          and downward arrow at row breaks. */}
      <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 flex-1 min-h-0 relative">
        {scenes.map((s, i) => {
          const inFirstRow = i < 3;
          const isLastInRow = (i + 1) % 3 === 0;
          const isLast = i === scenes.length - 1;
          return (
            <motion.div
              key={i}
              className="rounded-md relative overflow-hidden p-1.5 flex flex-col"
              style={{
                background: `linear-gradient(135deg, ${s.color}, rgba(255,255,255,0.06))`,
                border: `1px solid ${s.color}`,
              }}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span
                  className="text-[8px] font-mono font-semibold px-1 py-[1px] rounded"
                  style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                >
                  {s.tag}
                </span>
                <span
                  className="text-[8px] font-mono px-1 py-[1px] rounded-full"
                  style={{ background: s.color, color: "#fff" }}
                >
                  {s.dur}
                </span>
              </div>
              <span className="text-[10px] font-semibold leading-tight text-white">
                {s.role}
              </span>
              <span className="text-[8.5px] font-mono mt-0.5 leading-tight text-white/90 truncate">
                {s.detail}
              </span>

              {/* Highlight ring sweeps from card 0 → 5 to indicate the
                  director's current rendering target. */}
              <motion.span
                className="absolute inset-0 rounded-md pointer-events-none"
                style={{ border: `2px solid ${tint}`, boxShadow: `0 0 12px ${tint}` }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{
                  duration: 0.8,
                  delay: i * 0.5,
                  repeat: Infinity,
                  repeatDelay: scenes.length * 0.5 - 0.8,
                }}
              />

              {/* Right-arrow to next card in same row */}
              {!isLastInRow && !isLast && (
                <motion.span
                  className="absolute -right-[9px] top-1/2 -translate-y-1/2 text-[12px] z-10"
                  style={{ color: tint, textShadow: `0 0 6px ${tint}` }}
                  animate={{ x: [0, 2, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  aria-hidden="true"
                >
                  ›
                </motion.span>
              )}
              {/* Down-arrow at row break (S3 → S4) */}
              {isLastInRow && !isLast && inFirstRow && (
                <motion.span
                  className="absolute -bottom-[7px] right-2 text-[10px] z-10"
                  style={{ color: tint, textShadow: `0 0 6px ${tint}` }}
                  animate={{ y: [0, 2, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  aria-hidden="true"
                >
                  ⌄
                </motion.span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function PlaceholderLora({ tint }: { tint: string }) {
  // Each card represents an angle of the same character — together they show
  // cross-shot consistency, which is the entire point of LoRA training.
  // SVG figure (head + hair + shoulders) reads as an actual character mock
  // rather than a blurred ellipse. Layout uses flexbox so the figure, name
  // strip and consistency bar never overlap on small heights.
  const looks = [
    {
      name: "正面",
      angle: "front · 0°",
      consistency: 96,
      hairPath: "M 50 22 C 28 22 18 38 18 56 L 22 56 C 22 38 32 30 50 30 C 68 30 78 38 78 56 L 82 56 C 82 38 72 22 50 22 Z",
      facePos: { cx: 50, cy: 50 },
      eyes: [{ x: 42, y: 50 }, { x: 58, y: 50 }] as const,
      shoulderPath: "M 12 92 C 22 76 36 70 50 70 C 64 70 78 76 88 92 L 88 100 L 12 100 Z",
    },
    {
      name: "3/4",
      angle: "3-quarter · 30°",
      consistency: 94,
      hairPath: "M 46 22 C 26 24 18 40 18 58 L 22 58 C 22 40 30 32 46 30 C 64 30 74 40 76 58 L 80 56 C 80 38 68 22 46 22 Z",
      facePos: { cx: 52, cy: 50 },
      eyes: [{ x: 46, y: 50 }, { x: 60, y: 50 }] as const,
      shoulderPath: "M 14 92 C 26 76 40 70 54 70 C 68 70 80 78 88 92 L 88 100 L 14 100 Z",
    },
    {
      name: "側臉",
      angle: "profile · 90°",
      consistency: 92,
      hairPath: "M 38 22 C 22 24 14 40 14 58 L 18 58 C 18 40 24 32 40 30 C 56 30 64 40 66 58 L 70 56 C 70 38 58 22 38 22 Z",
      facePos: { cx: 56, cy: 50 },
      eyes: [{ x: 64, y: 50 }] as const,
      shoulderPath: "M 12 92 C 24 76 36 70 50 70 C 64 70 76 78 84 92 L 84 100 L 12 100 Z",
    },
  ] as const;
  return (
    <div className="flex items-stretch justify-center gap-2 w-full h-full px-2 py-1">
      {looks.map((l, i) => (
        <motion.div
          key={i}
          className="flex-1 min-w-0 rounded-xl relative overflow-hidden flex flex-col"
          style={{
            background: `linear-gradient(160deg, #082c3d 0%, ${tint} 70%, rgba(255,255,255,0.12))`,
            border: `1px solid ${tint}`,
          }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: [0, -3, 0] }}
          transition={{
            opacity: { delay: i * 0.12, duration: 0.4 },
            y: { duration: 2.4, delay: i * 0.3, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          {/* name + version strip — pinned to top */}
          <div className="relative z-10 flex items-center justify-between px-1.5 pt-1.5 pb-0.5">
            <span
              className="text-[8.5px] font-semibold px-1 py-[1px] rounded"
              style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
            >
              {l.name}
            </span>
            <span
              className="text-[7.5px] font-mono px-1 py-[1px] rounded"
              style={{ background: tint, color: "#fff" }}
            >
              v{i + 1}
            </span>
          </div>

          {/* Character figure — flex-1 so it fills available height without
              being cropped by the labels above or the consistency bar below. */}
          <div className="relative flex-1 min-h-0 flex items-end justify-center px-1">
            <svg
              viewBox="0 0 100 100"
              className="w-full h-full"
              preserveAspectRatio="xMidYMax meet"
            >
              <defs>
                <radialGradient id={`face-${i}`} cx="50%" cy="40%" r="55%">
                  <stop offset="0%" stopColor="rgba(255,235,210,0.98)" />
                  <stop offset="55%" stopColor="rgba(220,180,150,0.85)" />
                  <stop offset="100%" stopColor="rgba(120,80,60,0.55)" />
                </radialGradient>
                <linearGradient id={`hair-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(40,28,55,0.95)" />
                  <stop offset="100%" stopColor="rgba(80,55,90,0.85)" />
                </linearGradient>
                <linearGradient id={`shoulder-${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={tint} />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.18)" />
                </linearGradient>
              </defs>
              {/* shoulders / collar */}
              <path d={l.shoulderPath} fill={`url(#shoulder-${i})`} opacity="0.92" />
              {/* face */}
              <ellipse
                cx={l.facePos.cx}
                cy={l.facePos.cy}
                rx="18"
                ry="22"
                fill={`url(#face-${i})`}
                stroke="rgba(80,50,40,0.4)"
                strokeWidth="0.5"
              />
              {/* hair on top */}
              <path d={l.hairPath} fill={`url(#hair-${i})`} />
              {/* eyes — small dots, positioned per angle */}
              {l.eyes.map((eye, j) => (
                <circle
                  key={j}
                  cx={eye.x}
                  cy={eye.y}
                  r="1.2"
                  fill="rgba(40,28,55,0.95)"
                />
              ))}
              {/* mouth */}
              <path
                d={`M ${l.facePos.cx - 3} ${l.facePos.cy + 8} Q ${l.facePos.cx} ${l.facePos.cy + 10} ${l.facePos.cx + 3} ${l.facePos.cy + 8}`}
                stroke="rgba(150,80,80,0.7)"
                strokeWidth="0.8"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            {/* subtle scan-line shimmer to feel "AI-generated" */}
            <motion.div
              className="absolute inset-x-0 h-[2px] pointer-events-none"
              style={{
                background: `linear-gradient(90deg, transparent, ${tint}, transparent)`,
                boxShadow: `0 0 8px ${tint}`,
              }}
              animate={{ top: ["10%", "90%", "10%"] }}
              transition={{
                duration: 3.2,
                delay: i * 0.4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </div>

          {/* consistency bar — pinned to bottom */}
          <div className="relative z-10 px-1.5 pb-1.5">
            <div className="flex justify-between text-[7.5px] font-mono mb-0.5 text-white/95">
              <span className="truncate">{l.angle}</span>
              <span style={{ color: "#fff", fontWeight: 600 }}>
                {l.consistency}%
              </span>
            </div>
            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.18)" }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${tint}, rgba(255,255,255,0.95))`,
                }}
                animate={{ width: [`${l.consistency - 10}%`, `${l.consistency}%`] }}
                transition={{
                  duration: 2.0,
                  delay: i * 0.2,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                }}
              />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function PlaceholderForMode({ mode }: { mode: Mode }) {
  switch (mode.id) {
    case "image":
      return <PlaceholderImage tint={mode.tint} />;
    case "video":
      return <PlaceholderVideo tint={mode.tint} />;
    case "music":
      return <PlaceholderMusic tint={mode.tint} />;
    case "voice":
      return <PlaceholderVoice tint={mode.tint} />;
    case "director":
      return <PlaceholderDirector tint={mode.tint} />;
    case "lora":
      return <PlaceholderLora tint={mode.tint} />;
  }
}

// ─── Agent tool-dispatch trace ──────────────────────────────────────────────

type DispatchStep = "parse" | "plan" | "call" | "stream" | "done";

interface DispatchState {
  tool: string;
  step: DispatchStep;
  /** When true, this dispatch is a real backend call (image only). */
  live: boolean;
}

const DISPATCH_STEP_ORDER: readonly DispatchStep[] = [
  "parse",
  "plan",
  "call",
  "stream",
  "done",
];

function ToolDispatchTrace({
  state,
  tint,
  prompt,
}: {
  state: DispatchState;
  tint: string;
  prompt: string;
}) {
  const reduce = useReducedMotion();
  const stepIndex = DISPATCH_STEP_ORDER.indexOf(state.step);
  const promptPreview =
    prompt.length > 48 ? `${prompt.slice(0, 46)}…` : prompt;

  const lines: { key: DispatchStep; text: string }[] = [
    { key: "parse", text: "光球代理 · 解析意圖 / 模態 / 輸出格式" },
    {
      key: "plan",
      text: "→ 建立執行計畫：工具路由、參數補全、成本守門",
    },
    {
      key: "call",
      text: `→ ${state.tool}({ prompt: "${promptPreview}" })`,
    },
    {
      key: "stream",
      text: state.live
        ? "← 串流真實 API：隊列進度、部分結果、重試訊號…"
        : "← 串流模擬預覽：示範代理逐步產生中繼結果…",
    },
    {
      key: "done",
      text: state.live
        ? "✓ 完成：輸出成品 + metadata + 可重跑 seed"
        : "✓ 代理示範完成：顯示流程軌跡與可呼叫工具",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25 }}
      className="absolute left-2 right-2 bottom-2 rounded-lg backdrop-blur-md px-2.5 py-1.5 font-mono text-[9.5px] sm:text-[10px] leading-relaxed pointer-events-none shadow-[0_0_0_1px_rgba(34,197,94,0.18),0_10px_30px_rgba(16,185,129,0.16)]"
      style={{
        background: "linear-gradient(160deg, rgba(6,14,24,0.86), rgba(5,32,28,0.76))",
        border: `1px solid ${tint}`,
        color: "rgba(229,255,245,0.96)",
      }}
    >
      <div
        className="flex items-center gap-1.5 mb-0.5"
        style={{ color: tint }}
      >
        <Terminal className="w-2.5 h-2.5" />
        <span className="tracking-[0.2em] uppercase text-[8.5px]">
          agent.dispatch
        </span>
        {state.live && (
          <span
            className="ml-auto text-[8px] px-1 py-0.5 rounded"
            style={{ background: tint, color: "#fff" }}
          >
            LIVE
          </span>
        )}
      </div>
      {lines.map((line, idx) => {
        const reached = idx <= stepIndex;
        const active = idx === stepIndex && state.step !== "done";
        return (
          <div
            key={line.key}
            className="flex items-start gap-1.5"
            style={{ opacity: reached ? 1 : 0.35 }}
          >
            <span style={{ width: 8, color: tint }}>
              {idx < stepIndex || state.step === "done" ? "✓" : active ? "›" : "·"}
            </span>
            <span className="flex-1 truncate">
              {line.text}
              {active && !reduce && (
                <motion.span
                  className="ml-0.5 inline-block"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 0.9, repeat: Infinity }}
                >
                  ▌
                </motion.span>
              )}
            </span>
          </div>
        );
      })}
    </motion.div>
  );
}


// ─── Component props ────────────────────────────────────────────────────────

interface OrbCreationStageProps {
  textPrimary: string;
  textMuted: string;
  cardBg: string;
  cardBorder: string;
  featureBg: string;
  btnPrimary: string;
  btnPrimaryText: string;
  isDark: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ─── Main component ────────────────────────────────────────────────────────

/**
 * OrbCreationStage — single unified visual experience for the homepage.
 * Folds in the former "Site Value Highlights" + "Site Use Cases" sections
 * so users can see the global orb agent dispatch every modality (image,
 * video, music, voice, director, LoRA) in place — no studio detour.
 *
 * Real APIs wired (live generation, all gated on auth + FAL_API_KEY):
 *   - `imageStudio.nanoBanana2` → image (synchronous fal call)
 *   - `videoStudio.klingTextToVideo` → 5s video; polled via `checkVideoStatus`
 *   - `proStudio.textToMusic` (sonauto) → music; polled via `checkAudioStatus`
 *   - `proStudio.qwenTTS` → AI voiceover; polled via `checkAudioStatus`
 *   - `sense.inferIntent` (public) → "光球感應" the prompt as user types
 *
 * Director and LoRA need full studio flows (multi-turn planning / 12-image
 * upload), so the orb agent dispatches them as a tool-call trace inline and
 * the user can hop into the dedicated studio for the real flow.
 */
export default function OrbCreationStage({
  textPrimary,
  textMuted,
  cardBg,
  cardBorder,
  featureBg,
  btnPrimary,
  btnPrimaryText,
  isDark,
}: OrbCreationStageProps) {
  const isMobile = useIsMobile();
  const reduce = useReducedMotion();
  const { isAuthenticated } = useAuth();

  const [activeId, setActiveId] = useState<ModeId>("image");
  const activeMode = useMemo(
    () => MODES.find(m => m.id === activeId) ?? MODES[0],
    [activeId]
  );
  const [prompt, setPrompt] = useState<string>(activeMode.prompt);
  type MediaResult = { kind: "image" | "video" | "audio"; url: string; label?: string };
  const [mediaResult, setMediaResult] = useState<MediaResult | null>(null);
  const [pendingVideo, setPendingVideo] = useState<{
    requestId: string;
    modelId: string;
  } | null>(null);
  const [pendingAudio, setPendingAudio] = useState<{
    requestId: string;
    model: string;
    label: "music" | "voice";
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeDemoForm, setActiveDemoForm] = useState<(typeof DEMO_FORMS)[number]["id"]>("quick");
  const [dispatch, setDispatch] = useState<DispatchState | null>(null);
  const [simulating, setSimulating] = useState(false);
  const dispatchTimers = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      dispatchTimers.current.forEach(id => window.clearTimeout(id));
      dispatchTimers.current = [];
    };
  }, []);

  // When the user switches modality, swap the prompt to the suggestion
  // unless the user has typed something custom that doesn't match any sample.
  const userEditedRef = useRef(false);
  useEffect(() => {
    if (userEditedRef.current) return;
    setPrompt(activeMode.prompt);
  }, [activeMode]);

  // ── tRPC ──
  const apiKeyQuery = trpc.imageStudio.checkApiKey.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const senseIntentMut = trpc.sense.inferIntent.useMutation();
  const imageGenMut = trpc.imageStudio.nanoBanana2.useMutation({
    onSuccess: data => {
      const url = (data?.image_url as string | null) ?? data?.images?.[0] ?? null;
      if (url) {
        setMediaResult({ kind: "image", url });
        setErrorMsg(null);
      } else {
        setErrorMsg("光球暫時沒拿到結果，再試一次。");
      }
    },
    onError: err => {
      setMediaResult(null);
      setErrorMsg(err.message || "生成失敗，請再試一次。");
    },
  });
  const videoGenMut = trpc.videoStudio.klingTextToVideo.useMutation({
    onSuccess: data => {
      const requestId = data?.request_id ?? null;
      const modelId = (data?.raw as { raw_model_id?: string } | null)?.raw_model_id ?? null;
      if (!requestId || !modelId) {
        setErrorMsg("光球代理未拿到 fal queue 任務，請再試一次。");
        setDispatch(null);
        return;
      }
      setPendingVideo({ requestId, modelId });
      setDispatch(d => (d ? { ...d, step: "stream" } : d));
    },
    onError: err => {
      setMediaResult(null);
      setPendingVideo(null);
      setDispatch(null);
      setErrorMsg(err.message || "影片生成失敗，請再試一次。");
    },
  });
  const musicGenMut = trpc.proStudio.textToMusic.useMutation({
    onSuccess: data => {
      const requestId = (data as { request_id?: string } | null)?.request_id ?? null;
      const model = (data as { model?: string } | null)?.model ?? null;
      if (!requestId || !model) {
        setErrorMsg("光球代理未拿到 fal queue 任務，請再試一次。");
        setDispatch(null);
        return;
      }
      setPendingAudio({ requestId, model, label: "music" });
      setDispatch(d => (d ? { ...d, step: "stream" } : d));
    },
    onError: err => {
      setMediaResult(null);
      setPendingAudio(null);
      setDispatch(null);
      setErrorMsg(err.message || "音樂生成失敗，請再試一次。");
    },
  });
  const voiceGenMut = trpc.proStudio.qwenTTS.useMutation({
    onSuccess: data => {
      const requestId = (data as { request_id?: string } | null)?.request_id ?? null;
      const model = (data as { model?: string } | null)?.model ?? null;
      if (!requestId || !model) {
        setErrorMsg("光球代理未拿到 fal queue 任務，請再試一次。");
        setDispatch(null);
        return;
      }
      setPendingAudio({ requestId, model, label: "voice" });
      setDispatch(d => (d ? { ...d, step: "stream" } : d));
    },
    onError: err => {
      setMediaResult(null);
      setPendingAudio(null);
      setDispatch(null);
      setErrorMsg(err.message || "配音生成失敗，請再試一次。");
    },
  });

  // ── Polling: video ──
  const videoStatusQuery = trpc.videoStudio.checkVideoStatus.useQuery(
    {
      requestId: pendingVideo?.requestId ?? "",
      modelId: pendingVideo?.modelId ?? "",
    },
    {
      enabled: !!pendingVideo,
      refetchInterval: q => {
        const s = (q.state.data as { status?: string } | undefined)?.status;
        return s === "COMPLETED" || s === "FAILED" ? false : 3000;
      },
      refetchIntervalInBackground: true,
      retry: 5,
    }
  );
  useEffect(() => {
    const data = videoStatusQuery.data as
      | { status?: string; video_url?: string | null }
      | undefined;
    if (!pendingVideo || !data) return;
    if (data.status === "COMPLETED" && data.video_url) {
      setMediaResult({ kind: "video", url: data.video_url });
      setPendingVideo(null);
      setDispatch(d => (d ? { ...d, step: "done" } : d));
    } else if (data.status === "FAILED") {
      setErrorMsg("影片任務失敗，請再試一次。");
      setPendingVideo(null);
      setDispatch(null);
    }
  }, [videoStatusQuery.data, pendingVideo]);
  useEffect(() => {
    if (videoStatusQuery.isError && pendingVideo) {
      setErrorMsg(videoStatusQuery.error?.message || "影片任務失敗，請再試一次。");
      setPendingVideo(null);
      setDispatch(null);
    }
  }, [videoStatusQuery.isError, videoStatusQuery.error, pendingVideo]);

  // ── Polling: audio (music + voice share the same status endpoint) ──
  const audioStatusQuery = trpc.proStudio.checkAudioStatus.useQuery(
    {
      requestId: pendingAudio?.requestId ?? "",
      model: pendingAudio?.model ?? "",
    },
    {
      enabled: !!pendingAudio,
      refetchInterval: q => {
        const s = (q.state.data as { status?: string } | undefined)?.status;
        return s === "COMPLETED" || s === "FAILED" ? false : 3000;
      },
      refetchIntervalInBackground: true,
      retry: 5,
    }
  );
  useEffect(() => {
    const data = audioStatusQuery.data as
      | { status?: string; audio_url?: string | null }
      | undefined;
    if (!pendingAudio || !data) return;
    if (data.status === "COMPLETED" && data.audio_url) {
      setMediaResult({
        kind: "audio",
        url: data.audio_url,
        label: pendingAudio.label,
      });
      setPendingAudio(null);
      setDispatch(d => (d ? { ...d, step: "done" } : d));
    } else if (data.status === "FAILED") {
      setErrorMsg(
        `${pendingAudio.label === "music" ? "音樂" : "配音"}任務失敗，請再試一次。`
      );
      setPendingAudio(null);
      setDispatch(null);
    }
  }, [audioStatusQuery.data, pendingAudio]);
  useEffect(() => {
    if (audioStatusQuery.isError && pendingAudio) {
      setErrorMsg(audioStatusQuery.error?.message || "音訊任務失敗，請再試一次。");
      setPendingAudio(null);
      setDispatch(null);
    }
  }, [audioStatusQuery.isError, audioStatusQuery.error, pendingAudio]);

  // ── Debounced sense inference (real public API) ──
  const debouncedPrompt = useDebouncedValue(prompt.trim(), 700);
  useEffect(() => {
    if (debouncedPrompt.length < 8) return;
    const now = Date.now();
    senseIntentMut.mutate({
      events: [
        {
          type: "hoverIntent",
          timestamp: now,
          targetId: `home-orb-${activeMode.id}`,
          meta: {
            cardTitle: activeMode.label,
            hoverMs: 1500,
            mouseTravel: 40,
            intentScore: 0.85,
            promptPreview: debouncedPrompt.slice(0, 120),
            modality: activeMode.id,
          },
        },
        {
          type: "cardDwell",
          timestamp: now - 1000,
          targetId: `home-orb-${activeMode.id}`,
          meta: {
            cardTitle: activeMode.label,
            cardModality: activeMode.id,
            dwellMs: 4200,
            cardTags: [activeMode.id, "homepage", "orb"],
          },
        },
        {
          type: "sectionVisit",
          timestamp: now - 2000,
          targetId: "orb-creation-stage",
          meta: { totalDwellMs: 6000, visitCount: 1 },
        },
      ],
      summary: {
        totalEvents: 3,
        dwellCount: 1,
        hesitationCount: 0,
        highIntentCards: [
          {
            targetId: `home-orb-${activeMode.id}`,
            title: `${activeMode.label}: ${debouncedPrompt.slice(0, 40)}`,
            score: 0.85,
          },
        ],
        hesitationSections: [],
        modalityPreference: { [activeMode.id]: 1 },
        abortCount: 0,
        rapidScanCount: 0,
        sessionStartedAt: now - 6000,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPrompt, activeMode.id]);

  const senseInsight = senseIntentMut.data;

  // Excitement drives the orb's pulse — inferred from typing freshness +
  // sense confidence so the orb visibly "responds" to the prompt.
  const excitement = useMemo(() => {
    const promptScore = Math.min(prompt.trim().length / 80, 1);
    const senseScore = senseInsight?.confidence ?? 0;
    return Math.min(0.4 + promptScore * 0.4 + senseScore * 0.4, 1.2);
  }, [prompt, senseInsight]);

  const clearDispatchTimers = useCallback(() => {
    dispatchTimers.current.forEach(id => window.clearTimeout(id));
    dispatchTimers.current = [];
  }, []);

  const handleSelectMode = (id: ModeId) => {
    setActiveId(id);
    userEditedRef.current = false;
    setMediaResult(null);
    setPendingVideo(null);
    setPendingAudio(null);
    setErrorMsg(null);
    setDispatch(null);
    setSimulating(false);
    setActiveScenarioId(null);
    clearDispatchTimers();
  };

  const handleSelectScenario = (s: Scenario) => {
    setActiveScenarioId(s.id);
    setActiveId(s.modeId);
    userEditedRef.current = false;
    setPrompt(s.prompt);
    setMediaResult(null);
    setPendingVideo(null);
    setPendingAudio(null);
    setErrorMsg(null);
    setDispatch(null);
    setSimulating(false);
    clearDispatchTimers();
  };

  const filteredScenarios = useMemo(
    () => SCENARIOS.filter((scenario) => scenario.demoForm === activeDemoForm),
    [activeDemoForm]
  );
  const activeScenario = useMemo(
    () => SCENARIOS.find((scenario) => scenario.id === activeScenarioId) ?? null,
    [activeScenarioId]
  );
  const activeDemoFormDef = useMemo(
    () => DEMO_FORMS.find((form) => form.id === activeDemoForm) ?? DEMO_FORMS[0],
    [activeDemoForm]
  );

  const handlePromptChange = (next: string) => {
    setPrompt(next);
    userEditedRef.current = true;
    setActiveScenarioId(null);
  };

  /** Drive the dispatch trace for non-live modalities so users see the
   *  global orb agent calling the right tool inline. */
  const runSimulatedDispatch = useCallback(
    (mode: Mode) => {
      clearDispatchTimers();
      setSimulating(true);
      setDispatch({ tool: mode.tool, step: "parse", live: false });
      const queue = (delay: number, step: DispatchStep, done = false) => {
        const id = window.setTimeout(() => {
          setDispatch(d =>
            d && d.tool === mode.tool ? { ...d, step } : d
          );
          if (done) setSimulating(false);
        }, delay);
        dispatchTimers.current.push(id);
      };
      queue(320, "plan");
      queue(780, "call");
      queue(1360, "stream");
      queue(2360, "done", true);
    },
    [clearDispatchTimers]
  );

  const handleGenerate = useCallback(() => {
    setErrorMsg(null);
    const trimmed = prompt.trim();
    if (!trimmed) {
      setErrorMsg("先寫一句話，光球代理才能感應。");
      return;
    }
    // Director / LoRA need full studio flows (multi-turn planning or 12-image
    // upload), so the orb agent dispatches them as a tool-call trace inline
    // and the user can open the studio for the real flow.
    if (!activeMode.liveGenerate) {
      runSimulatedDispatch(activeMode);
      return;
    }
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    if (apiKeyQuery.data && apiKeyQuery.data.configured === false) {
      setErrorMsg("尚未設定 FAL_API_KEY，光球代理改用模擬流。可至設定接上真實金鑰。");
      runSimulatedDispatch(activeMode);
      return;
    }
    setMediaResult(null);
    setPendingVideo(null);
    setPendingAudio(null);
    setDispatch({ tool: activeMode.tool, step: "parse", live: true });
    switch (activeMode.id) {
      case "image":
        imageGenMut.mutate({
          prompt: trimmed,
          aspect_ratio: "1:1",
          num_images: 1,
        });
        break;
      case "video":
        videoGenMut.mutate({
          prompt: trimmed,
          aspectRatio: "9:16",
          duration: "5",
          cfgScale: 0.5,
        });
        break;
      case "music":
        musicGenMut.mutate({
          prompt: trimmed,
          model: "sonauto",
        });
        break;
      case "voice":
        voiceGenMut.mutate({
          text: trimmed,
          language: "Auto",
        });
        break;
      default:
        runSimulatedDispatch(activeMode);
    }
  }, [
    prompt,
    activeMode,
    isAuthenticated,
    apiKeyQuery.data,
    imageGenMut,
    videoGenMut,
    musicGenMut,
    voiceGenMut,
    runSimulatedDispatch,
  ]);

  // Drive the LIVE dispatch trace through its phases as the real mutation
  // progresses, so the trace mirrors the actual API call rather than just
  // appearing at completion.
  const anyLiveSubmitPending =
    imageGenMut.isPending ||
    videoGenMut.isPending ||
    musicGenMut.isPending ||
    voiceGenMut.isPending;
  useEffect(() => {
    if (!dispatch?.live) return;
    if (dispatch.step === "parse" && anyLiveSubmitPending) {
      setDispatch(d => (d ? { ...d, step: "plan" } : d));
    } else if (anyLiveSubmitPending) {
      setDispatch(d => (d ? { ...d, step: "call" } : d));
    } else if (imageGenMut.isSuccess && activeMode.id === "image") {
      // Image is synchronous — jump straight to done once the URL is back.
      setDispatch(d => (d ? { ...d, step: "done" } : d));
    }
  }, [
    dispatch?.live,
    anyLiveSubmitPending,
    imageGenMut.isSuccess,
    activeMode.id,
  ]);

  const isBusy =
    anyLiveSubmitPending ||
    !!pendingVideo ||
    !!pendingAudio ||
    simulating;
  const apiKeyConfigured = apiKeyQuery.data?.configured ?? null;

  return (
    <section
      aria-label="光球創作劇場"
      className="px-4 sm:px-6 py-14 sm:py-20 lg:py-24 relative z-10"
    >
      <div className="max-w-5xl mx-auto">
        {/* ── Phase header — merged copy ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-7 sm:mb-10"
        >
          <PhaseLabel tint={activeMode.tint} label={`Phase 01 → 02 · 光球創作劇場`} />
          <h2
            className={`text-2xl sm:text-4xl md:text-5xl font-semibold leading-tight tracking-tight transition-colors duration-1000 ${textPrimary}`}
            style={{
              textShadow: isDark
                ? "0 2px 18px rgba(0,0,0,0.55)"
                : "0 1px 12px rgba(255,255,255,0.65)",
            }}
          >
            從一個提示詞開始 ·
            <span
              className="bg-clip-text text-transparent bg-gradient-to-br ml-1 sm:ml-2"
              style={{
                backgroundImage: `linear-gradient(135deg, ${activeMode.tint}, ${activeMode.glow})`,
                transition: "background-image 0.6s ease",
              }}
            >
              即時生成
            </span>
          </h2>
          <div
            className="mt-3 sm:mt-5 mx-auto max-w-2xl rounded-2xl px-4 sm:px-5 py-3 sm:py-3.5 backdrop-blur-md transition-all duration-1000"
            style={{
              background: isDark
                ? "linear-gradient(180deg, rgba(8,12,30,0.55), rgba(8,12,30,0.32))"
                : "linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.42))",
              border: `1px solid ${cardBorder}`,
              boxShadow: isDark
                ? "0 8px 24px rgba(0,0,0,0.25)"
                : "0 8px 24px rgba(120,90,60,0.08)",
            }}
          >
            <p
              className={`text-sm sm:text-base leading-relaxed transition-colors duration-1000 ${textMuted}`}
              style={{
                textShadow: isDark
                  ? "0 1px 8px rgba(0,0,0,0.5)"
                  : "0 1px 4px rgba(255,255,255,0.55)",
              }}
            >
              寫下你想創作的畫面或情緒 — 光球代理會即時感應、判斷模態，
              並為你呼叫對應的生成工具：圖片、影片、音樂、配音、導演與角色 LoRA，全部在這個畫面完成。
            </p>
          </div>
        </motion.div>

        {/* ── Scenario presets — 首頁改為多種形式演示 ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.8, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 sm:mb-7"
        >
          <div className={`flex items-center justify-center gap-2 mb-3 text-[10px] sm:text-[11px] tracking-[0.2em] uppercase ${textMuted}`}>
            <Layers className="w-3 h-3" style={{ color: activeMode.tint }} />
            <span>首頁演示 · 可切換多種形式</span>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
            {DEMO_FORMS.map((form) => {
              const isActive = form.id === activeDemoForm;
              return (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => {
                    setActiveDemoForm(form.id);
                    setActiveScenarioId(null);
                  }}
                  className={`px-2.5 sm:px-3 py-1 rounded-full text-[10px] sm:text-xs font-medium transition-all ${
                    isActive ? "text-white" : textPrimary
                  }`}
                  style={{
                    background: isActive ? activeMode.tint : featureBg,
                    border: `1px solid ${isActive ? activeMode.tint : cardBorder}`,
                    boxShadow: isActive ? `0 4px 14px ${activeMode.glow}` : "none",
                  }}
                  aria-pressed={isActive}
                >
                  {form.label}
                </button>
              );
            })}
          </div>
          {/* ── Layer-by-layer breakdown for the active demo form ── */}
          <motion.div
            key={`demo-layers-${activeDemoFormDef.id}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="mb-3 sm:mb-4 rounded-2xl p-3 sm:p-3.5"
            style={{
              background: featureBg,
              border: `1px solid ${cardBorder}`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold tracking-wider"
                style={{
                  background: activeMode.tint,
                  color: "#fff",
                  boxShadow: `0 0 10px ${activeMode.glow}`,
                }}
              >
                <Layers className="w-2.5 h-2.5" />
                {activeDemoFormDef.label}
              </span>
              <span className={`text-[11px] sm:text-xs leading-snug ${textPrimary}`}>
                {activeDemoFormDef.description}
              </span>
            </div>
            <ol className="space-y-1">
              {activeDemoFormDef.layers.map((layer, i) => (
                <li
                  key={layer.name}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5"
                  style={{
                    background: isDark
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(255,255,255,0.55)",
                    border: `1px solid ${cardBorder}`,
                  }}
                >
                  <span
                    className="flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold shrink-0 mt-[1px]"
                    style={{
                      background: activeMode.tint,
                      color: "#fff",
                      boxShadow: `0 0 8px ${activeMode.glow}`,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[10.5px] sm:text-[11.5px] font-semibold leading-tight ${textPrimary}`}
                    >
                      {layer.name}
                      <span
                        className="ml-1.5 font-mono text-[9px] sm:text-[10px] tracking-wider"
                        style={{ color: activeMode.tint }}
                      >
                        layer {i + 1}/{activeDemoFormDef.layers.length}
                      </span>
                    </div>
                    <div
                      className={`text-[10px] sm:text-[11px] leading-snug mt-0.5 ${textMuted}`}
                    >
                      {layer.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className={`mt-2 text-[10px] sm:text-[11px] ${textMuted}`}>
              <span className={textPrimary}>選一個情境</span> 即可看到對應的代理運行細節（感知 / 規劃 / 派工 / 交付）。
            </p>
          </motion.div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
            {filteredScenarios.map(scenario => {
              const mode = MODES.find(m => m.id === scenario.modeId)!;
              const isActive = scenario.id === activeScenarioId;
              const Icon = mode.icon;
              return (
                <motion.button
                  key={scenario.id}
                  type="button"
                  onClick={() => handleSelectScenario(scenario)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="group text-left rounded-xl px-2.5 sm:px-3 py-2 sm:py-2.5 backdrop-blur-md transition-all duration-300"
                  style={{
                    background: isActive ? mode.tint : cardBg,
                    border: `1px solid ${isActive ? mode.tint : cardBorder}`,
                    boxShadow: isActive ? `0 8px 24px ${mode.glow}` : "none",
                  }}
                  aria-pressed={isActive}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon
                      className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0"
                      style={{ color: isActive ? "#fff" : mode.tint }}
                    />
                    <span
                      className={`text-[11px] sm:text-xs font-medium truncate ${
                        isActive ? "text-white" : textPrimary
                      }`}
                    >
                      {scenario.label}
                    </span>
                    <span
                      className="ml-auto inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] shrink-0"
                      style={{
                        color: isActive ? "rgba(255,255,255,0.85)" : mode.tint,
                      }}
                    >
                      <Clock className="w-2.5 h-2.5" />
                      {scenario.eta}
                    </span>
                  </div>
                  <p
                    className={`text-[10px] sm:text-[11px] leading-snug line-clamp-1 mb-1 ${
                      isActive ? "text-white/85" : textMuted
                    }`}
                  >
                    {scenario.summary}
                  </p>
                  {/* Spirit cast preview — overlapping color dots so users
                      see who collaborates before clicking. */}
                  <div className="flex items-center gap-1">
                    <div className="flex -space-x-1">
                      {scenario.spirits.slice(0, 5).map((nick, idx) => {
                        const meta = SPIRITS[nick];
                        return (
                          <span
                            key={nick}
                            title={`${nick} · ${meta.role}`}
                            className="inline-flex items-center justify-center w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full text-[7.5px] sm:text-[8px] font-semibold"
                            style={{
                              background: meta.tint,
                              color: "#fff",
                              boxShadow: `0 0 0 1.5px ${
                                isActive ? "#fff" : isDark ? "rgba(20,20,30,0.8)" : "rgba(255,255,255,0.9)"
                              }`,
                              zIndex: scenario.spirits.length - idx,
                            }}
                          >
                            {nick[0]}
                          </span>
                        );
                      })}
                    </div>
                    {scenario.spirits.length > 5 && (
                      <span
                        className="text-[8.5px] sm:text-[9px] font-medium"
                        style={{
                          color: isActive ? "rgba(255,255,255,0.85)" : mode.tint,
                        }}
                      >
                        +{scenario.spirits.length - 5}
                      </span>
                    )}
                    <span
                      className="ml-auto text-[8.5px] sm:text-[9px] font-mono"
                      style={{
                        color: isActive ? "rgba(255,255,255,0.7)" : isDark ? "rgba(255,255,255,0.5)" : "rgba(20,20,30,0.55)",
                      }}
                    >
                      {scenario.spirits.length} 精靈
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
          {activeScenario && (
            <div
              className="mt-3 rounded-xl p-3 sm:p-3.5"
              style={{ background: featureBg, border: `1px solid ${cardBorder}` }}
            >
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <p className={`text-[11px] sm:text-xs font-medium ${textPrimary}`}>
                  代理運行細節（{activeScenario.label}）
                </p>
                <span
                  className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: activeMode.tint,
                    color: "#fff",
                    boxShadow: `0 0 10px ${activeMode.glow}`,
                  }}
                >
                  {activeScenario.spirits.length} 位精靈協作
                </span>
              </div>

              {/* Spirit cast — chips show who's collaborating */}
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {activeScenario.spirits.map((nick, idx) => {
                  const meta = SPIRITS[nick];
                  return (
                    <span
                      key={nick}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] sm:text-[11px]"
                      style={{
                        background: idx === 0
                          ? meta.tint
                          : isDark
                            ? "rgba(255,255,255,0.06)"
                            : "rgba(255,255,255,0.6)",
                        color: idx === 0
                          ? "#fff"
                          : isDark
                            ? "rgba(255,255,255,0.85)"
                            : "rgba(20,20,30,0.8)",
                        border: `1px solid ${meta.tint}`,
                      }}
                      title={meta.role}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: idx === 0 ? "#fff" : meta.tint,
                          boxShadow: `0 0 6px ${meta.tint}`,
                        }}
                      />
                      {nick}
                      <span
                        className="opacity-70 hidden sm:inline"
                        style={{ fontSize: "0.85em" }}
                      >
                        · {meta.role.split(" · ")[1] ?? meta.role}
                      </span>
                    </span>
                  );
                })}
              </div>

              {/* Handoff chain — who hands what to whom. A vertical
                  connector line ties the numbered circles together so the
                  flow reads as a real pipeline. */}
              <ol className="relative space-y-1 mb-2.5 pl-1">
                {/* Connector spine */}
                {activeScenario.handoffs.length > 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[15px] top-3 bottom-3 w-px"
                    style={{
                      background: `linear-gradient(180deg, ${activeMode.tint}, transparent)`,
                      opacity: 0.45,
                    }}
                  />
                )}
                {activeScenario.handoffs.map((step, i) => {
                  const meta = SPIRITS[step.from];
                  const nextMeta = step.next ? SPIRITS[step.next] : null;
                  return (
                    <li
                      key={i}
                      className="relative flex items-start gap-2 rounded-lg px-2 py-1.5 text-[10.5px] sm:text-[11.5px]"
                      style={{
                        background: isDark
                          ? "rgba(255,255,255,0.04)"
                          : "rgba(255,255,255,0.55)",
                        border: `1px solid ${cardBorder}`,
                      }}
                    >
                      <span
                        className="relative z-10 shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold mt-[1px]"
                        style={{
                          background: meta.tint,
                          color: "#fff",
                          boxShadow: `0 0 8px ${meta.tint}`,
                        }}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span
                          className="font-semibold"
                          style={{ color: meta.tint }}
                        >
                          {step.from}
                        </span>
                        <span className={`mx-1 ${textMuted}`}>›</span>
                        <span className={textPrimary}>{step.do}</span>
                        {nextMeta && (
                          <>
                            <span className={`mx-1 ${textMuted}`}>，交棒給</span>
                            <span
                              className="font-semibold"
                              style={{ color: nextMeta.tint }}
                            >
                              {step.next}
                            </span>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>

              <ol className={`list-decimal pl-4 space-y-1 text-[11px] sm:text-xs ${textMuted}`}>
                <li><span className={textPrimary}>感知：</span>{activeScenario.runbook.perceive}</li>
                <li><span className={textPrimary}>規劃：</span>{activeScenario.runbook.plan}</li>
                <li><span className={textPrimary}>派工：</span>{activeScenario.runbook.tools}</li>
                <li><span className={textPrimary}>交付：</span>{activeScenario.runbook.output}</li>
              </ol>
            </div>
          )}
        </motion.div>

        {/* ── Interactive panel ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-3xl overflow-hidden backdrop-blur-md p-4 sm:p-6 lg:p-8"
          style={{
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            boxShadow: `0 30px 80px -20px ${activeMode.glow}`,
            transition: "box-shadow 0.8s ease",
          }}
        >
          {/* Ambient halo at top */}
          <motion.div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at 50% 0%, ${activeMode.glow} 0%, transparent 55%)`,
              opacity: 0.35,
            }}
            animate={reduce ? undefined : { opacity: [0.25, 0.45, 0.25] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Three-column stage on desktop, stacked on mobile */}
          <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-4 lg:gap-6 items-stretch">
            {/* Prompt input */}
            <div
              className="rounded-2xl p-3 sm:p-4 lg:p-5 min-h-[160px] sm:min-h-[180px] flex flex-col gap-3"
              style={{ background: featureBg, border: `1px solid ${cardBorder}` }}
            >
              <div className="flex items-center gap-2">
                <Wand2 className="w-3.5 h-3.5" style={{ color: activeMode.tint }} />
                <span
                  className="text-[10px] tracking-[0.2em] uppercase font-medium"
                  style={{ color: activeMode.tint }}
                >
                  輸入提示詞
                </span>
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: activeMode.tint }}
                  animate={reduce ? undefined : { opacity: [1, 0.2, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              </div>
              <textarea
                value={prompt}
                onChange={e => handlePromptChange(e.target.value)}
                placeholder="一句話、一個感覺、一個畫面，光球都接得住…"
                rows={isMobile ? 3 : 4}
                maxLength={400}
                className={`w-full resize-none bg-transparent outline-none text-xs sm:text-sm lg:text-base leading-relaxed font-mono ${textPrimary} placeholder:opacity-50`}
                style={{
                  caretColor: activeMode.tint,
                }}
              />
              <div className={`flex items-center justify-between text-[10px] sm:text-xs ${textMuted}`}>
                <span>{activeMode.meta}</span>
                <span>{prompt.length}/400</span>
              </div>
            </div>

            {/* Center orb */}
            <div className="relative flex flex-col items-center justify-center min-h-[140px] lg:min-h-[220px] gap-2">
              <InteractiveOrb
                tint={activeMode.tint}
                glow={activeMode.glow}
                excitement={excitement}
                busy={isBusy}
              />
              {/* Sense whisper — driven by the real public sense.inferIntent API */}
              <AnimatePresence mode="wait">
                {senseInsight && senseInsight.confidence > 0.3 && !isBusy && (
                  <motion.div
                    key={senseInsight.intentLabel + senseInsight.preferredModality}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.4 }}
                    className={`text-center px-2 max-w-[14rem] ${textMuted}`}
                  >
                    <div
                      className="inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase mb-0.5"
                      style={{ color: activeMode.tint }}
                    >
                      <Eye className="w-3 h-3" />
                      光球感應
                    </div>
                    <p className="text-[11px] sm:text-xs leading-snug line-clamp-2">
                      {senseInsight.intentLabel}
                      {senseInsight.detectedAesthetics?.[0]
                        ? ` · ${senseInsight.detectedAesthetics.slice(0, 2).join("、")}`
                        : ""}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Output preview */}
            <div
              className="rounded-2xl relative overflow-hidden min-h-[210px] sm:min-h-[240px] lg:min-h-[280px]"
              style={{ background: featureBg, border: `1px solid ${cardBorder}` }}
            >
              <div className="absolute top-2 left-3 right-3 z-10 flex items-center gap-2">
                <span
                  className="text-[10px] tracking-[0.2em] uppercase font-medium"
                  style={{ color: activeMode.tint }}
                >
                  代理生成預覽
                </span>
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: activeMode.tint }}
                  animate={reduce ? undefined : { scale: [1, 1.4, 1] }}
                  transition={{ duration: 1.0, repeat: Infinity }}
                />
                {dispatch && (
                  <span
                    className="ml-auto text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                    style={{
                      background: dispatch.live
                        ? activeMode.glow
                        : "rgba(255,255,255,0.06)",
                      border: `1px solid ${activeMode.tint}`,
                      color: dispatch.live
                        ? "#fff"
                        : isDark
                          ? "rgba(255,255,255,0.85)"
                          : "rgba(20,20,30,0.8)",
                    }}
                  >
                    {dispatch.step === "done" ? (
                      <CheckCircle2 className="w-2.5 h-2.5" />
                    ) : (
                      <Terminal className="w-2.5 h-2.5" />
                    )}
                    {dispatch.live ? "LIVE" : "AGENT"}
                  </span>
                )}
              </div>
              <div className="absolute inset-0 pt-7">
                <AnimatePresence mode="wait">
                  {mediaResult ? (
                    <motion.div
                      key={`result-${mediaResult.kind}-${mediaResult.url}`}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4 }}
                      className="w-full h-full p-2 flex items-center justify-center"
                    >
                      {mediaResult.kind === "image" && (
                        <img
                          src={mediaResult.url}
                          alt={prompt}
                          className="w-full h-full object-contain rounded-xl"
                          loading="lazy"
                        />
                      )}
                      {mediaResult.kind === "video" && (
                        <video
                          src={mediaResult.url}
                          className="w-full h-full object-contain rounded-xl bg-black"
                          controls
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      )}
                      {mediaResult.kind === "audio" && (
                        <div className="w-full flex flex-col items-center justify-center gap-3 px-3">
                          <div
                            className="text-[10px] tracking-[0.25em] uppercase"
                            style={{ color: activeMode.tint }}
                          >
                            {mediaResult.label === "music" ? "原創音樂" : "AI 配音"}
                          </div>
                          <audio
                            src={mediaResult.url}
                            controls
                            autoPlay
                            className="w-full max-w-xs"
                          />
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`placeholder-${activeMode.id}`}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4 }}
                      className="w-full h-full"
                    >
                      <PlaceholderForMode mode={activeMode} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <AnimatePresence>
                {dispatch && (
                  <ToolDispatchTrace
                    state={dispatch}
                    tint={activeMode.tint}
                    prompt={prompt}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Agent blueprint: 全站光球代理底層邏輯與運作細節 ── */}
          <AnimatePresence mode="wait">
            <AgentBlueprint
              key={activeMode.id}
              mode={activeMode}
              isDark={isDark}
              cardBg={cardBg}
              cardBorder={cardBorder}
              textPrimary={textPrimary}
              textMuted={textMuted}
              paused={isBusy && !!dispatch?.live}
            />
          </AnimatePresence>

          {/* ── Modality selector — the agent's tool palette ── */}
          <div
            className={`relative mt-5 sm:mt-6 text-center text-[10px] sm:text-[11px] tracking-[0.2em] uppercase mb-2 ${textMuted}`}
          >
            光球代理可呼叫的工具
          </div>
          <div className="relative flex flex-wrap justify-center gap-2 sm:gap-2.5">
            {MODES.map(mode => {
              const Icon = mode.icon;
              const isActive = mode.id === activeMode.id;
              return (
                <motion.button
                  key={mode.id}
                  type="button"
                  onClick={() => handleSelectMode(mode.id)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  className="relative inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-300"
                  style={{
                    background: isActive ? mode.tint : featureBg,
                    color: isActive
                      ? "#fff"
                      : isDark
                        ? "rgba(255,255,255,0.75)"
                        : "rgba(20,20,30,0.7)",
                    border: `1px solid ${isActive ? mode.tint : cardBorder}`,
                    boxShadow: isActive ? `0 6px 20px ${mode.glow}` : "none",
                  }}
                  aria-pressed={isActive}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {mode.label}
                  {mode.liveGenerate && (
                    <span
                      className="ml-0.5 text-[9px] uppercase tracking-wider opacity-80"
                      style={{ color: isActive ? "#fff" : mode.tint }}
                    >
                      live
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* ── Generate CTA ── */}
          <div className="relative mt-5 sm:mt-7 flex flex-col items-center gap-3">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("orb-open-capabilities"))
                }
                className={`text-xs sm:text-sm underline-offset-4 hover:underline transition-colors duration-1000 ${textMuted}`}
              >
                或讓光球幫你決定模態
              </button>
            </div>

            {/* Status hints */}
            <div className={`text-center text-[11px] sm:text-xs ${textMuted}`}>
              {errorMsg ? (
                <div
                  role="alert"
                  className="mx-auto inline-flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: isDark
                      ? "rgba(248,113,113,0.10)"
                      : "rgba(254,226,226,0.85)",
                    border: "1px solid rgba(248,113,113,0.45)",
                  }}
                >
                  <span className="inline-flex items-center gap-1.5 text-red-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-left">
                      {errorMsg.replace(/[，,]?\s*(?:請)?再試一次。?$/u, "")}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] sm:text-[11px] font-semibold transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                      style={{
                        background: activeMode.tint,
                        color: "#fff",
                        boxShadow: `0 4px 14px ${activeMode.glow}`,
                      }}
                    >
                      <RefreshCw className="w-3 h-3" />
                      再試一次
                    </button>
                    <button
                      type="button"
                      onClick={() => setErrorMsg(null)}
                      className={`text-[10px] sm:text-[11px] underline-offset-2 hover:underline ${textMuted}`}
                    >
                      關閉
                    </button>
                  </span>
                </div>
              ) : isBusy && activeMode.liveGenerate && (pendingVideo || pendingAudio) ? (
                <span>光球代理已提交 fal queue，每 3 秒輪詢 {activeMode.tool}…</span>
              ) : isBusy && activeMode.liveGenerate ? (
                <span>光球代理正在呼叫 {activeMode.tool} 真實 API…</span>
              ) : isBusy ? (
                <span>光球代理示範呼叫 {activeMode.tool}（導演 / LoRA 需於工作室啟動完整流程）。</span>
              ) : activeMode.liveGenerate && !isAuthenticated ? (
                <span>登入後光球代理即可呼叫真實 API；導演與 LoRA 仍以代理示範展示完整流程。</span>
              ) : activeMode.liveGenerate && apiKeyConfigured === false ? (
                <span>提示：尚未設定 FAL_API_KEY，光球代理僅以示範流呼叫。</span>
              ) : (
                <span>提示詞越具體，光球代理越能精準呼叫對應模態工具。</span>
              )}
            </div>

            {/* ── Value highlights — folded in micro-strip ── */}
            <div className="mt-3 sm:mt-4 flex flex-wrap justify-center gap-1.5 sm:gap-2">
              {VALUE_HIGHLIGHTS.map(item => {
                const Icon = item.icon;
                return (
                  <span
                    key={item.id}
                    className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] ${textMuted}`}
                    style={{
                      background: featureBg,
                      border: `1px solid ${cardBorder}`,
                    }}
                  >
                    <Icon
                      className="w-2.5 h-2.5 sm:w-3 sm:h-3"
                      style={{ color: activeMode.tint }}
                    />
                    {item.label}
                  </span>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
