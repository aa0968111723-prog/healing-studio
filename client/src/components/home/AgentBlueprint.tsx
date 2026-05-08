import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  Brain,
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  GitBranch,
  GitMerge,
  Layers,
  Mic,
  Music,
  Network,
  Palette,
  Route,
  Sparkles,
  Target,
  Workflow,
} from "lucide-react";

// ─── Phase model ────────────────────────────────────────────────────────────
//
// The blueprint runs a 10-phase synthetic "thinking heartbeat" — every panel
// (flow / mind map / timeline) reads from the same `activePhase` so the user
// can see the agent's reasoning travel across all panels simultaneously.

type ModeId = "image" | "video" | "music" | "voice" | "director" | "lora";

const PHASES = [
  { key: "input", label: "提示詞 prompt" },
  { key: "intent", label: "意圖感知" },
  { key: "context", label: "上下文檢索" },
  { key: "constraint", label: "約束組裝" },
  { key: "router", label: "變體規劃" },
  { key: "dispatch", label: "並行派工" },
  { key: "stream", label: "串流回收" },
  { key: "align", label: "跨變體對齊" },
  { key: "score", label: "候選評分" },
  { key: "deliver", label: "交付封裝" },
] as const;

const PHASE_COUNT = PHASES.length;
const PHASE_INTERVAL_MS = 1400;

function usePhaseTick(modeKey: string, paused = false): number {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(0);
  // Restart the heartbeat from phase 0 whenever the active modality changes
  // — so the user sees the cycle "begin again" with the new tool.
  useEffect(() => {
    setPhase(0);
  }, [modeKey]);
  useEffect(() => {
    if (reduce || paused) return;
    const id = window.setInterval(() => {
      setPhase(p => (p + 1) % PHASE_COUNT);
    }, PHASE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reduce, paused, modeKey]);
  return phase;
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface BlueprintMode {
  id: ModeId;
  tint: string;
  glow: string;
  prompt: string;
  tool: string;
  liveGenerate: boolean;
}

interface BranchChain {
  label: string;
  icon: typeof Brain;
  /** Ordered chain — agent escalates from rough → refined. */
  chain: readonly string[];
}

interface VariantSpec {
  id: string;
  label: string;
  detail: string;
}

interface TimelineStep {
  title: string;
  detail: string;
  ms: string;
  /** Inclusive phase range driven by the heartbeat. */
  range: readonly [number, number];
  subs: readonly string[];
}

interface BlueprintCopy {
  toolLabel: string;
  output: string;
  contextHint: string;
  constraintHint: string;
  alignHint: string;
  branches: readonly [BranchChain, BranchChain, BranchChain, BranchChain];
  branchLinks: readonly { from: number; to: number; label: string }[];
  variants: readonly [VariantSpec, VariantSpec, VariantSpec, VariantSpec];
  steps: readonly TimelineStep[];
}

const BLUEPRINT_COPY: Record<ModeId, BlueprintCopy> = {
  image: {
    toolLabel: "image_generator",
    output: "4 張變體 + seed",
    contextHint: "翻找：歷史 prompt、品牌色票、參考圖庫",
    constraintHint: "綁定：35mm + film-grain + rule-of-thirds",
    alignHint: "比對：色票一致、構圖差異、可重跑 seed",
    branches: [
      { label: "主體", icon: Target, chain: ["少女側臉", "→ 加情緒留白", "→ 強化逆光"] },
      { label: "風格", icon: Palette, chain: ["電影感", "→ film-grain", "→ 暖色補光"] },
      { label: "鏡頭", icon: Eye, chain: ["35mm", "→ 85mm CU", "→ rule-of-thirds"] },
      { label: "氛圍", icon: Sparkles, chain: ["黃昏暖光", "→ 霓虹冷光", "→ 底片顆粒"] },
    ],
    branchLinks: [
      { from: 0, to: 2, label: "主體 ↔ 鏡頭" },
      { from: 1, to: 3, label: "風格 ↔ 氛圍" },
    ],
    variants: [
      { id: "V1", label: "CU", detail: "85mm · 戲劇" },
      { id: "V2", label: "MS", detail: "50mm · 情緒" },
      { id: "V3", label: "WS", detail: "35mm · 氛圍" },
      { id: "V4", label: "OTS", detail: "24mm · 敘事" },
    ],
    steps: [
      { title: "感知", detail: "意圖 / 模態 / 主體", ms: "0-300ms", range: [0, 1], subs: ["接收 prompt", "判讀模態", "情緒標註"] },
      { title: "規劃", detail: "上下文 + 約束 + 變體", ms: "0.3-0.9s", range: [2, 4], subs: ["回憶歷史", "套用 35mm 風格", "排出 4 變體"] },
      { title: "派工", detail: "image_generator × 4", ms: "1-2s", range: [5, 5], subs: ["V1 dispatch", "V2 dispatch", "V3 dispatch", "V4 dispatch"] },
      { title: "串流", detail: "queue → 部分結果", ms: "5-7s", range: [6, 6], subs: ["partial 1", "partial 2", "partial 3", "partial 4"] },
      { title: "驗證", detail: "對齊 + 評分", ms: "7-8s", range: [7, 8], subs: ["風格一致", "色票對齊", "候選評分"] },
      { title: "交付", detail: "成品 + seed + recipe", ms: "≈8s", range: [9, 9], subs: ["最佳候選", "重跑配方", "metadata"] },
    ],
  },
  video: {
    toolLabel: "videoStudio",
    output: "5 秒短片 + 字幕",
    contextHint: "翻找：節奏範例、霓虹城市素材、字幕模板",
    constraintHint: "綁定：9:16 + 25fps + 5 秒",
    alignHint: "比對：節奏點、字幕對齊、出入畫銜接",
    branches: [
      { label: "鏡頭", icon: Eye, chain: ["定鏡", "→ 慢推軌", "→ 9:16 直式"] },
      { label: "場景", icon: Target, chain: ["夜景街道", "→ 雨後濕地", "→ 霓虹倒影"] },
      { label: "節奏", icon: Clock, chain: ["呼吸感", "→ 25fps", "→ 緩入緩出"] },
      { label: "氛圍", icon: Palette, chain: ["賽博龐克", "→ 孤獨感", "→ 電影調光"] },
    ],
    branchLinks: [
      { from: 0, to: 2, label: "鏡頭 ↔ 節奏" },
      { from: 1, to: 3, label: "場景 ↔ 氛圍" },
    ],
    variants: [
      { id: "V1", label: "Fade", detail: "fade-in 開場" },
      { id: "V2", label: "Push", detail: "push-in 推進" },
      { id: "V3", label: "Tilt", detail: "tilt-up 升起" },
      { id: "V4", label: "Hold", detail: "hold 收束" },
    ],
    steps: [
      { title: "感知", detail: "判定影片 / 比例", ms: "0-400ms", range: [0, 1], subs: ["接收 prompt", "判讀 9:16", "節奏標註"] },
      { title: "規劃", detail: "鏡頭 + 時長 + 場景", ms: "0.4-1.2s", range: [2, 4], subs: ["回憶夜景案例", "套用 25fps 約束", "排出 4 鏡頭"] },
      { title: "派工", detail: "klingTextToVideo × 4 草圖", ms: "1.2-2s", range: [5, 5], subs: ["V1 dispatch", "V2 dispatch", "V3 dispatch", "V4 dispatch"] },
      { title: "串流", detail: "fal queue → 進度", ms: "60-120s", range: [6, 6], subs: ["queue 30%", "queue 60%", "queue 90%", "完成"] },
      { title: "驗證", detail: "節奏 + 字幕對齊", ms: "≈+5s", range: [7, 8], subs: ["節奏比對", "字幕對齊", "候選評分"] },
      { title: "交付", detail: "MP4 + 重跑 seed", ms: "≈2 分鐘", range: [9, 9], subs: ["最佳鏡頭", "重跑配方", "metadata"] },
    ],
  },
  music: {
    toolLabel: "proStudio.music",
    output: "30-60 秒原創曲",
    contextHint: "翻找：BPM 案例、編制範本、情緒曲線",
    constraintHint: "綁定：BPM 72 + 4/4 + 慢板",
    alignHint: "比對：段落銜接、音量平衡、配器一致",
    branches: [
      { label: "情緒", icon: Brain, chain: ["冷冽", "→ 雨夜", "→ 孤獨"] },
      { label: "編制", icon: Layers, chain: ["鋼琴主旋律", "→ 弦樂墊底", "→ 微氛圍鼓"] },
      { label: "節奏", icon: Clock, chain: ["BPM 72", "→ 4/4", "→ 慢板"] },
      { label: "結構", icon: Workflow, chain: ["intro 8s", "→ verse 12s", "→ outro 6s"] },
    ],
    branchLinks: [
      { from: 0, to: 1, label: "情緒 ↔ 編制" },
      { from: 2, to: 3, label: "節奏 ↔ 結構" },
    ],
    variants: [
      { id: "V1", label: "Intro", detail: "8s 鋪陳" },
      { id: "V2", label: "Verse", detail: "12s 主段" },
      { id: "V3", label: "Bridge", detail: "6s 過門" },
      { id: "V4", label: "Outro", detail: "4s 收束" },
    ],
    steps: [
      { title: "感知", detail: "情緒 / BPM / 編制", ms: "0-400ms", range: [0, 1], subs: ["接收 prompt", "判讀 BPM 72", "情緒曲線"] },
      { title: "規劃", detail: "段落結構 + 配器", ms: "0.4-1s", range: [2, 4], subs: ["回憶情緒範例", "套用 4/4 約束", "排出 4 段落"] },
      { title: "派工", detail: "textToMusic × 4 段", ms: "1-2s", range: [5, 5], subs: ["V1 intro", "V2 verse", "V3 bridge", "V4 outro"] },
      { title: "串流", detail: "渲染 → 預覽段", ms: "30-60s", range: [6, 6], subs: ["段 1 渲染", "段 2 渲染", "段 3 渲染", "段 4 渲染"] },
      { title: "驗證", detail: "音量 + 配器一致", ms: "≈+3s", range: [7, 8], subs: ["音量平衡", "配器銜接", "候選評分"] },
      { title: "交付", detail: "WAV + MIDI hint", ms: "≈1 分鐘", range: [9, 9], subs: ["最佳段落", "重跑配方", "metadata"] },
    ],
  },
  voice: {
    toolLabel: "proStudio.qwenTTS",
    output: "10-20 秒配音",
    contextHint: "翻找：語者範例、情緒表、停頓地圖",
    constraintHint: "綁定：女聲 · 0.92x 語速 · 微殘響",
    alignHint: "比對：呼吸停頓、段落間距、口水音",
    branches: [
      { label: "語者", icon: Mic, chain: ["女聲 · 溫柔", "→ 中性低音", "→ 敘事旁白"] },
      { label: "情緒", icon: Brain, chain: ["平靜", "→ 微笑", "→ 沉思"] },
      { label: "節奏", icon: Clock, chain: ["呼吸停頓", "→ 0.92x 語速", "→ 段落間距"] },
      { label: "音場", icon: Sparkles, chain: ["乾淨人聲", "→ 微殘響", "→ 去口水音"] },
    ],
    branchLinks: [
      { from: 0, to: 1, label: "語者 ↔ 情緒" },
      { from: 2, to: 3, label: "節奏 ↔ 音場" },
    ],
    variants: [
      { id: "V1", label: "Plain", detail: "平靜" },
      { id: "V2", label: "Smile", detail: "微笑" },
      { id: "V3", label: "Mute", detail: "沉思" },
      { id: "V4", label: "End", detail: "收束" },
    ],
    steps: [
      { title: "感知", detail: "判定語者 / 情緒", ms: "0-300ms", range: [0, 1], subs: ["接收 prompt", "判讀語者", "情緒標註"] },
      { title: "規劃", detail: "段落 + 停頓地圖", ms: "0.3-0.7s", range: [2, 4], subs: ["回憶語者範例", "套用語速約束", "排出 4 情緒"] },
      { title: "派工", detail: "qwenTTS × 4 段", ms: "0.7-1.5s", range: [5, 5], subs: ["V1 dispatch", "V2 dispatch", "V3 dispatch", "V4 dispatch"] },
      { title: "串流", detail: "合成 → 後處理", ms: "10-20s", range: [6, 6], subs: ["合成 1", "合成 2", "合成 3", "合成 4"] },
      { title: "驗證", detail: "對齊 + 後處理", ms: "≈+3s", range: [7, 8], subs: ["呼吸對齊", "去口水音", "候選評分"] },
      { title: "交付", detail: "MP3 + SRT 對齊", ms: "≈25s", range: [9, 9], subs: ["最佳段落", "字幕對齊", "metadata"] },
    ],
  },
  director: {
    toolLabel: "director.plan",
    output: "5 鏡 + 配樂 + 字幕",
    contextHint: "翻找：品牌調性、CTA 範例、字幕模板",
    constraintHint: "綁定：30 秒 + 5 鏡 + 繁中字幕",
    alignHint: "比對：色票、字幕風格、音量平衡",
    branches: [
      { label: "敘事", icon: Brain, chain: ["品牌調性", "→ 情緒弧線", "→ Call-to-Action"] },
      { label: "分鏡", icon: Layers, chain: ["S1 開場", "→ S2-3 鋪陳", "→ S4-5 收束"] },
      { label: "視覺", icon: Palette, chain: ["主視覺", "→ 色票", "→ 字幕風格"] },
      { label: "聲音", icon: Music, chain: ["配樂", "→ 旁白", "→ 音效層"] },
    ],
    branchLinks: [
      { from: 0, to: 1, label: "敘事 ↔ 分鏡" },
      { from: 2, to: 3, label: "視覺 ↔ 聲音" },
    ],
    variants: [
      { id: "V1", label: "S1", detail: "開場 6s" },
      { id: "V2", label: "S2", detail: "鋪陳 8s" },
      { id: "V3", label: "S3", detail: "推進 8s" },
      { id: "V4", label: "S4", detail: "收束 8s" },
    ],
    steps: [
      { title: "感知", detail: "拆解品牌 / 受眾", ms: "0-500ms", range: [0, 1], subs: ["接收 brief", "判讀平台", "情緒弧線"] },
      { title: "規劃", detail: "5 鏡 DAG + 相依", ms: "0.5-1.2s", range: [2, 4], subs: ["回憶品牌調", "套用 30 秒約束", "排出 5 鏡"] },
      { title: "派工", detail: "→ 圖片 / 影片 / 音樂", ms: "—", range: [5, 5], subs: ["主視覺 dispatch", "短片 dispatch", "配樂 dispatch", "字幕 dispatch"] },
      { title: "編排", detail: "監看 queue + 重試", ms: "5-10 分鐘", range: [6, 6], subs: ["素材 1", "素材 2", "素材 3", "素材 4"] },
      { title: "驗證", detail: "色票 + 音量平衡", ms: "≈+30s", range: [7, 8], subs: ["色票對齊", "字幕風格", "候選評分"] },
      { title: "交付", detail: "成品包 + 重跑配方", ms: "≈12 分鐘", range: [9, 9], subs: ["最佳剪輯", "重跑配方", "metadata"] },
    ],
  },
  lora: {
    toolLabel: "lora_trainer.create",
    output: "專屬角色模型",
    contextHint: "翻找：歷史角色、訓練超參、觸發詞庫",
    constraintHint: "綁定：rank 32 · lr 1e-4 · 1200 steps",
    alignHint: "比對：臉部 / 服裝 / 跨景一致",
    branches: [
      { label: "資料", icon: Layers, chain: ["12 張參考圖", "→ 去背 + 對齊", "→ 風格標註"] },
      { label: "訓練", icon: Workflow, chain: ["rank 32", "→ lr 1e-4", "→ 1200 steps"] },
      { label: "驗證", icon: Eye, chain: ["臉部一致", "→ 服裝一致", "→ 跨景測試"] },
      { label: "輸出", icon: Target, chain: [".safetensors", "→ trigger word", "→ 推薦 prompt"] },
    ],
    branchLinks: [
      { from: 0, to: 1, label: "資料 ↔ 訓練" },
      { from: 2, to: 3, label: "驗證 ↔ 輸出" },
    ],
    variants: [
      { id: "V1", label: "Face", detail: "臉部驗證" },
      { id: "V2", label: "Dress", detail: "服裝驗證" },
      { id: "V3", label: "Light", detail: "光線驗證" },
      { id: "V4", label: "Scene", detail: "跨景驗證" },
    ],
    steps: [
      { title: "感知", detail: "讀取參考圖集", ms: "0-300ms", range: [0, 1], subs: ["接收 12 張", "判讀風格", "去背 + 對齊"] },
      { title: "規劃", detail: "建議 rank / steps", ms: "0.3-0.8s", range: [2, 4], subs: ["回憶歷史角色", "套用 rank 32", "排出驗證集"] },
      { title: "派工", detail: "lora_trainer.create", ms: "0.8-1.5s", range: [5, 5], subs: ["分批訓練 1", "分批 2", "分批 3", "分批 4"] },
      { title: "訓練", detail: "monitor loss + sample", ms: "≈8 分鐘", range: [6, 6], subs: ["loss 0.42", "loss 0.18", "loss 0.09", "收斂"] },
      { title: "驗證", detail: "跨景一致性", ms: "≈+30s", range: [7, 8], subs: ["臉部一致", "服裝一致", "候選評分"] },
      { title: "交付", detail: "權重 + 用法說明", ms: "≈8.5 分鐘", range: [9, 9], subs: ["最佳權重", "推薦 prompt", "metadata"] },
    ],
  },
};

// ─── Connector primitives — animated SVG paths between flow tiers ───────────

interface ConnectorProps {
  tint: string;
  /** True when this connector is "carrying data" (animated dashes flow). */
  active: boolean;
  /** Optional decorative caption rendered to the right of the line. */
  caption?: string;
}

function FlowSingleArrow({ tint, active, caption }: ConnectorProps) {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex items-center justify-center h-3.5">
      <svg viewBox="0 0 100 16" className="w-full h-3.5" preserveAspectRatio="none" aria-hidden>
        <motion.line
          x1="50"
          y1="0"
          x2="50"
          y2="13"
          stroke={tint}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="4 3"
          opacity={active ? 0.95 : 0.32}
          animate={active && !reduce ? { strokeDashoffset: [7, 0] } : undefined}
          transition={{ duration: 0.55, repeat: Infinity, ease: "linear" }}
        />
        <path
          d="M46 9 L50 14 L54 9"
          fill="none"
          stroke={tint}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={active ? 0.95 : 0.32}
        />
      </svg>
      {caption && (
        <span
          className="absolute right-1 -top-0.5 text-[8px] font-mono tracking-wider"
          style={{ color: tint, opacity: active ? 0.85 : 0.4 }}
        >
          {caption}
        </span>
      )}
    </div>
  );
}

function FlowSplit2({ tint, active }: ConnectorProps) {
  const reduce = useReducedMotion();
  // Source at center (50,0) → branches to 25% and 75% at bottom
  return (
    <svg viewBox="0 0 100 18" className="w-full h-4" preserveAspectRatio="none" aria-hidden>
      {[25, 75].map((tx, i) => (
        <motion.path
          key={i}
          d={`M50 0 C 50 9 ${tx} 6 ${tx} 16`}
          fill="none"
          stroke={tint}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="4 3"
          opacity={active ? 0.95 : 0.32}
          animate={active && !reduce ? { strokeDashoffset: [7, 0] } : undefined}
          transition={{ duration: 0.6, delay: i * 0.1, repeat: Infinity, ease: "linear" }}
        />
      ))}
      {[25, 75].map(tx => (
        <path
          key={`a-${tx}`}
          d={`M${tx - 3} 12 L${tx} 16 L${tx + 3} 12`}
          fill="none"
          stroke={tint}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={active ? 0.95 : 0.32}
        />
      ))}
    </svg>
  );
}

function FlowMerge2({ tint, active }: ConnectorProps) {
  const reduce = useReducedMotion();
  // Two sources at 25% and 75% top → merge at center bottom
  return (
    <svg viewBox="0 0 100 18" className="w-full h-4" preserveAspectRatio="none" aria-hidden>
      {[25, 75].map((sx, i) => (
        <motion.path
          key={i}
          d={`M${sx} 0 C ${sx} 9 50 6 50 16`}
          fill="none"
          stroke={tint}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="4 3"
          opacity={active ? 0.95 : 0.32}
          animate={active && !reduce ? { strokeDashoffset: [7, 0] } : undefined}
          transition={{ duration: 0.6, delay: i * 0.1, repeat: Infinity, ease: "linear" }}
        />
      ))}
      <path
        d="M46 12 L50 16 L54 12"
        fill="none"
        stroke={tint}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={active ? 0.95 : 0.32}
      />
    </svg>
  );
}

function FlowFanout4({ tint, active }: ConnectorProps) {
  const reduce = useReducedMotion();
  const targets = [12.5, 37.5, 62.5, 87.5];
  return (
    <svg viewBox="0 0 100 20" className="w-full h-5" preserveAspectRatio="none" aria-hidden>
      {targets.map((tx, i) => (
        <motion.path
          key={i}
          d={`M50 0 C 50 11 ${tx} 8 ${tx} 18`}
          fill="none"
          stroke={tint}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeDasharray="4 3"
          opacity={active ? 0.95 : 0.3}
          animate={active && !reduce ? { strokeDashoffset: [7, 0] } : undefined}
          transition={{ duration: 0.55, delay: i * 0.12, repeat: Infinity, ease: "linear" }}
        />
      ))}
      {targets.map(tx => (
        <path
          key={`a-${tx}`}
          d={`M${tx - 2.4} 14 L${tx} 18 L${tx + 2.4} 14`}
          fill="none"
          stroke={tint}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={active ? 0.95 : 0.3}
        />
      ))}
    </svg>
  );
}

function FlowFanin4({ tint, active }: ConnectorProps) {
  const reduce = useReducedMotion();
  const sources = [12.5, 37.5, 62.5, 87.5];
  return (
    <svg viewBox="0 0 100 20" className="w-full h-5" preserveAspectRatio="none" aria-hidden>
      {sources.map((sx, i) => (
        <motion.path
          key={i}
          d={`M${sx} 0 C ${sx} 11 50 8 50 18`}
          fill="none"
          stroke={tint}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeDasharray="4 3"
          opacity={active ? 0.95 : 0.3}
          animate={active && !reduce ? { strokeDashoffset: [7, 0] } : undefined}
          transition={{ duration: 0.55, delay: i * 0.12, repeat: Infinity, ease: "linear" }}
        />
      ))}
      <path
        d="M46 14 L50 18 L54 14"
        fill="none"
        stroke={tint}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={active ? 0.95 : 0.3}
      />
    </svg>
  );
}

// ─── Flow node — phase-aware tile that lights up at its phase ───────────────

type NodeStatus = "pending" | "active" | "done";

function statusFor(phase: number, target: number): NodeStatus {
  if (phase === target) return "active";
  if (phase > target) return "done";
  return "pending";
}

function FlowNode({
  label,
  sub,
  phase,
  activePhase,
  tint,
  glow,
  isDark,
  cardBorder,
  accent = false,
  compact = false,
  icon: Icon,
}: {
  label: string;
  sub?: string;
  phase: number;
  activePhase: number;
  tint: string;
  glow: string;
  isDark: boolean;
  cardBorder: string;
  accent?: boolean;
  compact?: boolean;
  icon?: typeof Brain;
}) {
  const reduce = useReducedMotion();
  const status = statusFor(activePhase, phase);
  const isActive = status === "active";
  const isDone = status === "done";

  const baseBg = accent
    ? `linear-gradient(135deg, ${tint}, ${glow})`
    : isDark
      ? "rgba(255,255,255,0.06)"
      : "rgba(255,255,255,0.55)";

  const activeBg = isDark
    ? `linear-gradient(135deg, ${tint}55, ${glow}33)`
    : `linear-gradient(135deg, ${tint}33, ${glow}22)`;

  const padY = compact ? "py-1" : "py-1.5";

  return (
    <motion.div
      layout
      className={`relative rounded-md px-2 ${padY} text-center`}
      style={{
        background: accent ? baseBg : isActive ? activeBg : baseBg,
        border: `1px solid ${isActive ? tint : accent ? tint : cardBorder}`,
        color: accent
          ? "#fff"
          : isDark
            ? "rgba(255,255,255,0.92)"
            : "rgba(20,20,30,0.85)",
        boxShadow: isActive ? `0 0 12px ${glow}, inset 0 0 8px ${glow}` : "none",
        opacity: isDone ? 0.78 : 1,
        transition: "background 0.4s ease, box-shadow 0.4s ease",
      }}
      animate={
        isActive && !reduce
          ? { scale: [1, 1.025, 1] }
          : { scale: 1 }
      }
      transition={{ duration: 1.1, repeat: isActive ? Infinity : 0 }}
    >
      <div className="flex items-center justify-center gap-1 text-[10px] font-semibold leading-tight">
        {Icon && <Icon className="w-2.5 h-2.5 shrink-0" />}
        <span className="truncate">{label}</span>
        {isDone && !accent && (
          <CheckCircle2
            className="w-2.5 h-2.5 shrink-0"
            style={{ color: tint, opacity: 0.7 }}
          />
        )}
        {isActive && !accent && (
          <motion.span
            className="w-1 h-1 rounded-full shrink-0"
            style={{ background: tint, boxShadow: `0 0 6px ${tint}` }}
            animate={reduce ? undefined : { opacity: [1, 0.3, 1] }}
            transition={{ duration: 0.9, repeat: Infinity }}
          />
        )}
      </div>
      {sub && (
        <div
          className="text-[8.5px] font-mono mt-0.5 leading-tight opacity-90 truncate"
          style={{ color: accent ? "rgba(255,255,255,0.92)" : tint }}
        >
          {sub}
        </div>
      )}
      {/* shimmer sweep on active node */}
      {isActive && !reduce && !accent && (
        <motion.div
          className="absolute inset-0 rounded-md pointer-events-none"
          style={{
            background:
              "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)",
          }}
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </motion.div>
  );
}

// ─── Flowchart panel ────────────────────────────────────────────────────────

function FlowchartPanel({
  mode,
  tint,
  glow,
  isDark,
  cardBorder,
  copy,
  activePhase,
}: {
  mode: BlueprintMode;
  tint: string;
  glow: string;
  isDark: boolean;
  cardBorder: string;
  copy: BlueprintCopy;
  activePhase: number;
}) {
  // Connector active states keyed to where the "wave" is
  const lit = (range: readonly number[]) => range.includes(activePhase);

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center justify-between gap-1 text-[8.5px] tracking-[0.18em] uppercase font-mono"
        style={{ color: tint }}
      >
        <span className="inline-flex items-center gap-1">
          <Network className="w-2.5 h-2.5" />
          流程圖 · DAG
        </span>
        <span className="font-mono text-[8px] opacity-70">
          {String(activePhase + 1).padStart(2, "0")}/{PHASE_COUNT}
        </span>
      </div>

      <div className="flex flex-col gap-0">
        {/* Tier 0 — input */}
        <FlowNode
          label="提示詞 prompt"
          sub="user input"
          phase={0}
          activePhase={activePhase}
          tint={tint}
          glow={glow}
          isDark={isDark}
          cardBorder={cardBorder}
        />
        <FlowSingleArrow tint={tint} active={lit([0, 1])} />

        {/* Tier 1 — intent */}
        <FlowNode
          label="意圖感知"
          sub="intent + modality"
          phase={1}
          activePhase={activePhase}
          tint={tint}
          glow={glow}
          isDark={isDark}
          cardBorder={cardBorder}
        />
        <FlowSplit2 tint={tint} active={lit([1, 2, 3])} />

        {/* Tier 2 — context | constraint (parallel) */}
        <div className="grid grid-cols-2 gap-1">
          <FlowNode
            label="上下文檢索"
            sub={copy.contextHint.replace(/^翻找：/, "")}
            phase={2}
            activePhase={activePhase}
            tint={tint}
            glow={glow}
            isDark={isDark}
            cardBorder={cardBorder}
            compact
          />
          <FlowNode
            label="約束組裝"
            sub={copy.constraintHint.replace(/^綁定：/, "")}
            phase={3}
            activePhase={activePhase}
            tint={tint}
            glow={glow}
            isDark={isDark}
            cardBorder={cardBorder}
            compact
          />
        </div>
        <FlowMerge2 tint={tint} active={lit([2, 3, 4])} />

        {/* Tier 3 — router */}
        <FlowNode
          label="變體規劃 router"
          sub={copy.toolLabel}
          phase={4}
          activePhase={activePhase}
          tint={tint}
          glow={glow}
          isDark={isDark}
          cardBorder={cardBorder}
        />
        <FlowFanout4 tint={tint} active={lit([4, 5])} />

        {/* Tier 4 — V1..V4 parallel dispatch */}
        <div className="grid grid-cols-4 gap-0.5">
          {copy.variants.map(v => (
            <FlowNode
              key={v.id}
              label={`${v.id} · ${v.label}`}
              phase={5}
              activePhase={activePhase}
              tint={tint}
              glow={glow}
              isDark={isDark}
              cardBorder={cardBorder}
              compact
            />
          ))}
        </div>
        <FlowFanin4 tint={tint} active={lit([5, 6])} />

        {/* Tier 5 — stream */}
        <FlowNode
          label="串流回收"
          sub="queue + partial"
          phase={6}
          activePhase={activePhase}
          tint={tint}
          glow={glow}
          isDark={isDark}
          cardBorder={cardBorder}
        />
        <FlowSplit2 tint={tint} active={lit([6, 7, 8])} />

        {/* Tier 6 — align | score (parallel) */}
        <div className="grid grid-cols-2 gap-1">
          <FlowNode
            label="跨變體對齊"
            sub={copy.alignHint.replace(/^比對：/, "")}
            phase={7}
            activePhase={activePhase}
            tint={tint}
            glow={glow}
            isDark={isDark}
            cardBorder={cardBorder}
            compact
            icon={GitMerge}
          />
          <FlowNode
            label="候選評分"
            sub="best-pick"
            phase={8}
            activePhase={activePhase}
            tint={tint}
            glow={glow}
            isDark={isDark}
            cardBorder={cardBorder}
            compact
            icon={Sparkles}
          />
        </div>
        <FlowMerge2 tint={tint} active={lit([7, 8, 9])} />

        {/* Tier 7 — deliver (accent terminal) */}
        <FlowNode
          label={copy.output}
          sub={mode.tool}
          phase={9}
          activePhase={activePhase}
          tint={tint}
          glow={glow}
          isDark={isDark}
          cardBorder={cardBorder}
          accent
        />
      </div>
    </div>
  );
}

// ─── Mind map panel — branches with chains + cross-branch links ─────────────

function ChainPills({
  chain,
  active,
  chainIndex,
  tint,
  isDark,
  cardBorder,
}: {
  chain: readonly string[];
  active: boolean;
  chainIndex: number;
  tint: string;
  isDark: boolean;
  cardBorder: string;
}) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {chain.map((node, i) => {
        const reached = active && i <= chainIndex;
        const current = active && i === chainIndex;
        return (
          <motion.span
            key={node}
            className="text-[8.5px] px-1 py-[1px] rounded"
            initial={false}
            animate={{
              opacity: reached ? 1 : 0.55,
              scale: current ? 1.04 : 1,
            }}
            transition={{ duration: 0.3 }}
            style={{
              background: current
                ? tint
                : isDark
                  ? "rgba(255,255,255,0.05)"
                  : "rgba(255,255,255,0.55)",
              color: current
                ? "#fff"
                : isDark
                  ? "rgba(255,255,255,0.85)"
                  : "rgba(20,20,30,0.82)",
              border: `1px solid ${current ? tint : cardBorder}`,
              boxShadow: current ? `0 0 8px ${tint}` : "none",
            }}
          >
            {node}
          </motion.span>
        );
      })}
    </div>
  );
}

function MindMapPanel({
  tint,
  glow,
  isDark,
  cardBorder,
  copy,
  activePhase,
}: {
  tint: string;
  glow: string;
  isDark: boolean;
  cardBorder: string;
  copy: BlueprintCopy;
  activePhase: number;
}) {
  const reduce = useReducedMotion();

  // Active branch rotates with the heartbeat — branches map roughly to
  // phase 1..4 (parallel reasoning) and then keep rotating during execution
  // so the user keeps seeing the chain progression.
  const activeBranch = activePhase % 4;
  const chainIndex = Math.min(2, Math.floor(activePhase / 3) % 3);

  // Cross-branch links — light up when both endpoints belong to the
  // currently-fired phase neighbourhood.
  const linkActive = (link: { from: number; to: number }) =>
    activePhase >= 4 ||
    activePhase === link.from + 1 ||
    activePhase === link.to + 1;

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center justify-between gap-1 text-[8.5px] tracking-[0.18em] uppercase font-mono"
        style={{ color: tint }}
      >
        <span className="inline-flex items-center gap-1">
          <GitBranch className="w-2.5 h-2.5" />
          心智圖 · chains
        </span>
        <span className="font-mono text-[8px] opacity-70">
          chain {chainIndex + 1}/3
        </span>
      </div>
      <div
        className="relative rounded-md px-2 py-2"
        style={{
          background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.45)",
          border: `1px dashed ${cardBorder}`,
        }}
      >
        {/* central node */}
        <div className="flex justify-center mb-1.5">
          <motion.div
            className="inline-flex items-center gap-1 rounded-full px-2 py-1"
            style={{
              background: tint,
              color: "#fff",
              boxShadow: `0 0 16px ${glow}`,
            }}
            animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
            transition={{ duration: 2.4, repeat: Infinity }}
          >
            <Brain className="w-2.5 h-2.5" />
            <span className="text-[9px] font-semibold tracking-wider">prompt</span>
          </motion.div>
        </div>

        {/* 2x2 branches with center "+" cross-link */}
        <div className="relative">
          {/* center cross — connects all 4 branches */}
          <svg
            className="pointer-events-none absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* horizontal arm */}
            <motion.line
              x1="20"
              y1="50"
              x2="80"
              y2="50"
              stroke={tint}
              strokeWidth="0.6"
              strokeDasharray="2 2"
              opacity={
                copy.branchLinks.some(
                  l =>
                    linkActive(l) &&
                    [l.from, l.to].some(idx => idx === 0 || idx === 1)
                )
                  ? 0.85
                  : 0.25
              }
              animate={
                reduce ? undefined : { strokeDashoffset: [4, 0] }
              }
              transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            />
            {/* vertical arm */}
            <motion.line
              x1="50"
              y1="20"
              x2="50"
              y2="80"
              stroke={tint}
              strokeWidth="0.6"
              strokeDasharray="2 2"
              opacity={
                copy.branchLinks.some(
                  l =>
                    linkActive(l) &&
                    [l.from, l.to].some(idx => idx === 2 || idx === 3)
                )
                  ? 0.85
                  : 0.25
              }
              animate={
                reduce ? undefined : { strokeDashoffset: [4, 0] }
              }
              transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            />
            {/* center pulse */}
            <motion.circle
              cx="50"
              cy="50"
              r="1.6"
              fill={tint}
              animate={reduce ? undefined : { r: [1.4, 2.2, 1.4] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
          </svg>

          <div className="grid grid-cols-2 gap-1 relative z-10">
            {copy.branches.map((b, i) => {
              const Icon = b.icon;
              const isActive = i === activeBranch;
              return (
                <motion.div
                  key={b.label}
                  className="rounded px-1.5 py-1"
                  style={{
                    background: isActive
                      ? isDark
                        ? `linear-gradient(135deg, ${tint}33, ${glow}22)`
                        : `linear-gradient(135deg, ${tint}22, ${glow}11)`
                      : isDark
                        ? "rgba(255,255,255,0.06)"
                        : "rgba(255,255,255,0.6)",
                    border: `1px solid ${isActive ? tint : cardBorder}`,
                    boxShadow: isActive ? `0 0 10px ${glow}` : "none",
                    transition: "background 0.4s ease, box-shadow 0.4s ease",
                  }}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.06, duration: 0.4 }}
                >
                  <div
                    className="flex items-center gap-1 text-[9px] font-semibold mb-0.5"
                    style={{ color: tint }}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {b.label}
                    {isActive && (
                      <motion.span
                        className="ml-auto text-[7.5px] font-mono px-1 rounded"
                        style={{
                          background: tint,
                          color: "#fff",
                        }}
                        animate={reduce ? undefined : { opacity: [1, 0.6, 1] }}
                        transition={{ duration: 1, repeat: Infinity }}
                      >
                        active
                      </motion.span>
                    )}
                  </div>
                  <ChainPills
                    chain={b.chain}
                    active={isActive}
                    chainIndex={chainIndex}
                    tint={tint}
                    isDark={isDark}
                    cardBorder={cardBorder}
                  />
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* cross-branch link chips */}
        {copy.branchLinks.length > 0 && (
          <div className="mt-1.5 flex flex-wrap justify-center gap-1">
            {copy.branchLinks.map(link => {
              const lit = linkActive(link);
              return (
                <motion.span
                  key={link.label}
                  className="text-[8.5px] px-1.5 py-[1px] rounded-full font-mono"
                  initial={false}
                  animate={{ opacity: lit ? 1 : 0.55 }}
                  style={{
                    background: lit
                      ? `linear-gradient(135deg, ${tint}, ${glow})`
                      : isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(255,255,255,0.5)",
                    color: lit ? "#fff" : tint,
                    border: `1px solid ${lit ? tint : cardBorder}`,
                  }}
                >
                  {link.label}
                </motion.span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Process timeline panel — phase-driven progress + sub-actions ───────────

function ProcessTimelinePanel({
  tint,
  glow,
  isDark,
  cardBorder,
  copy,
  liveGenerate,
  activePhase,
}: {
  tint: string;
  glow: string;
  isDark: boolean;
  cardBorder: string;
  copy: BlueprintCopy;
  liveGenerate: boolean;
  activePhase: number;
}) {
  const reduce = useReducedMotion();

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center justify-between gap-1 text-[8.5px] tracking-[0.18em] uppercase font-mono"
        style={{ color: tint }}
      >
        <span className="inline-flex items-center gap-1">
          <Workflow className="w-2.5 h-2.5" />
          過程圖 · timeline
        </span>
        <span
          className="text-[8px] font-mono px-1 py-[1px] rounded"
          style={{
            background: liveGenerate ? tint : "transparent",
            color: liveGenerate ? "#fff" : tint,
            border: `1px solid ${tint}`,
          }}
        >
          {liveGenerate ? "LIVE" : "AGENT"}
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {copy.steps.map((s, i) => {
          const [lo, hi] = s.range;
          const span = hi - lo + 1;
          const within = activePhase >= lo && activePhase <= hi;
          const past = activePhase > hi;
          const progress = within
            ? (activePhase - lo + 1) / span
            : past
              ? 1
              : 0;
          const subIndex =
            within && s.subs.length > 0
              ? Math.min(
                  s.subs.length - 1,
                  Math.floor(((activePhase - lo) / Math.max(1, span)) * s.subs.length)
                )
              : -1;

          return (
            <motion.li
              key={s.title}
              className="rounded px-1.5 py-1 relative overflow-hidden"
              style={{
                background: within
                  ? isDark
                    ? `linear-gradient(135deg, ${tint}22, ${glow}11)`
                    : `linear-gradient(135deg, ${tint}1a, ${glow}11)`
                  : isDark
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(255,255,255,0.5)",
                border: `1px solid ${within ? tint : cardBorder}`,
                boxShadow: within ? `0 0 10px ${glow}` : "none",
                opacity: past ? 0.85 : 1,
                transition: "background 0.4s ease, box-shadow 0.4s ease",
              }}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: past ? 0.85 : 1, x: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.4 }}
            >
              <div className="flex items-start gap-1.5">
                <span
                  className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-semibold shrink-0"
                  style={{
                    background: past || within ? tint : isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
                    color: past || within ? "#fff" : tint,
                    boxShadow: within ? `0 0 8px ${tint}` : "none",
                  }}
                >
                  {past ? (
                    <CheckCircle2 className="w-2.5 h-2.5" />
                  ) : (
                    i + 1
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div
                    className="flex items-center gap-1 text-[9.5px] font-semibold leading-tight"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,0.95)"
                        : "rgba(20,20,30,0.9)",
                    }}
                  >
                    {s.title}
                    {within && (
                      <motion.span
                        className="text-[7.5px] font-mono px-1 rounded"
                        style={{ background: tint, color: "#fff" }}
                        animate={reduce ? undefined : { opacity: [1, 0.5, 1] }}
                        transition={{ duration: 0.9, repeat: Infinity }}
                      >
                        running
                      </motion.span>
                    )}
                    <span
                      className="ml-auto text-[8px] font-mono px-1 py-[1px] rounded"
                      style={{
                        background: isDark
                          ? "rgba(255,255,255,0.06)"
                          : "rgba(255,255,255,0.55)",
                        border: `1px solid ${cardBorder}`,
                        color: tint,
                      }}
                    >
                      {s.ms}
                    </span>
                  </div>
                  <div
                    className="text-[8.5px] mt-0.5 leading-tight font-mono opacity-90 truncate"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,0.78)"
                        : "rgba(20,20,30,0.72)",
                    }}
                  >
                    {s.detail}
                  </div>
                  {/* per-step progress bar */}
                  <div
                    className="mt-1 h-[3px] rounded-full overflow-hidden"
                    style={{
                      background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                    }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${tint}, ${glow})`,
                        boxShadow: within ? `0 0 6px ${glow}` : "none",
                      }}
                      initial={false}
                      animate={{ width: `${Math.round(progress * 100)}%` }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                    />
                  </div>
                  {/* sub-action ticker (only inside the active step) */}
                  {within && subIndex >= 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {s.subs.map((sub, j) => {
                        const reached = j <= subIndex;
                        const current = j === subIndex;
                        return (
                          <span
                            key={sub}
                            className="text-[7.5px] px-1 py-[1px] rounded font-mono"
                            style={{
                              background: current
                                ? tint
                                : reached
                                  ? isDark
                                    ? "rgba(255,255,255,0.08)"
                                    : "rgba(255,255,255,0.55)"
                                  : "transparent",
                              color: current
                                ? "#fff"
                                : reached
                                  ? tint
                                  : isDark
                                    ? "rgba(255,255,255,0.45)"
                                    : "rgba(20,20,30,0.45)",
                              border: `1px solid ${reached ? tint : cardBorder}`,
                              opacity: reached ? 1 : 0.55,
                            }}
                          >
                            {reached ? "›" : "·"} {sub}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Phase ribbon — synced indicator across the top of the blueprint ────────

function PhaseRibbon({
  activePhase,
  tint,
  glow,
  isDark,
  cardBorder,
}: {
  activePhase: number;
  tint: string;
  glow: string;
  isDark: boolean;
  cardBorder: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-1 mt-2">
      {PHASES.map((p, i) => {
        const status = statusFor(activePhase, i);
        return (
          <div
            key={p.key}
            className="flex-1 min-w-0 flex flex-col items-center gap-0.5"
          >
            <motion.span
              className="block w-full h-[3px] rounded-full"
              initial={false}
              animate={{
                opacity: status === "pending" ? 0.3 : 1,
                scale: status === "active" ? 1 : 1,
              }}
              style={{
                background:
                  status === "active"
                    ? `linear-gradient(90deg, ${tint}, ${glow})`
                    : status === "done"
                      ? tint
                      : isDark
                        ? "rgba(255,255,255,0.12)"
                        : "rgba(0,0,0,0.08)",
                boxShadow: status === "active" ? `0 0 8px ${glow}` : "none",
              }}
            />
            <span
              className="text-[7px] tracking-wider font-mono truncate w-full text-center"
              style={{
                color:
                  status === "active"
                    ? tint
                    : isDark
                      ? "rgba(255,255,255,0.55)"
                      : "rgba(20,20,30,0.5)",
                fontWeight: status === "active" ? 600 : 400,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            {status === "active" && !reduce && (
              <motion.span
                className="text-[7.5px] absolute -mt-3 px-1 rounded font-mono"
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  color: tint,
                  background: isDark ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.7)",
                  border: `1px solid ${cardBorder}`,
                }}
              >
                {p.label}
              </motion.span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main blueprint component ───────────────────────────────────────────────

interface AgentBlueprintProps {
  mode: BlueprintMode;
  isDark: boolean;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textMuted: string;
  /** When true, the heartbeat pauses — used while a real LIVE call is firing. */
  paused?: boolean;
}

export default function AgentBlueprint({
  mode,
  isDark,
  cardBg,
  cardBorder,
  textPrimary,
  textMuted,
  paused = false,
}: AgentBlueprintProps) {
  const copy = BLUEPRINT_COPY[mode.id];
  const activePhase = usePhaseTick(mode.id, paused);
  const phaseLabel = PHASES[activePhase]?.label ?? "";

  const summary = useMemo(() => {
    if (activePhase <= 1) return "感知模態與情緒，喚回相關上下文。";
    if (activePhase <= 4) return "套上風格約束，分裂為 4 條並行變體。";
    if (activePhase === 5) return "並行派工 V1–V4，呼叫對應工具。";
    if (activePhase === 6) return "輪詢隊列、收集部分結果、容錯重試。";
    if (activePhase <= 8) return "跨變體對齊與評分，挑出最佳候選。";
    return "封裝交付：成品 + seed + 重跑配方。";
  }, [activePhase]);

  return (
    <motion.section
      key={`blueprint-${mode.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative mt-3 sm:mt-4 rounded-2xl backdrop-blur-md p-3 sm:p-4"
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
      }}
      aria-label="光球代理推論藍圖"
    >
      <div className="flex flex-wrap items-center gap-2 mb-2 sm:mb-3">
        <div
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
          style={{
            background: mode.tint,
            color: "#fff",
            boxShadow: `0 0 14px ${mode.glow}`,
          }}
        >
          <Route className="w-3 h-3" />
          <span className="text-[10px] tracking-wider font-semibold">
            全站光球代理 · 推論藍圖
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[9px] font-mono tracking-wider"
          style={{
            background: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.55)",
            border: `1px solid ${cardBorder}`,
            color: mode.tint,
          }}
        >
          <Layers className="w-2.5 h-2.5" />
          跨模態通用
        </span>
        <span className={`text-[10px] sm:text-[11px] ${textMuted}`}>
          流程圖 · 心智圖 · 過程圖（10-phase 心跳同步）
        </span>
        <div
          className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
          style={{
            background: paused
              ? "transparent"
              : isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(255,255,255,0.55)",
            border: `1px solid ${cardBorder}`,
          }}
        >
          {paused ? (
            <Cpu className="w-2.5 h-2.5" style={{ color: mode.tint }} />
          ) : (
            <Activity
              className="w-2.5 h-2.5"
              style={{ color: mode.tint }}
            />
          )}
          <span
            className="text-[9px] font-mono tracking-wider"
            style={{ color: mode.tint }}
          >
            {paused ? "LIVE call" : `phase ${activePhase + 1}/${PHASE_COUNT} · ${phaseLabel}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <FlowchartPanel
          mode={mode}
          tint={mode.tint}
          glow={mode.glow}
          isDark={isDark}
          cardBorder={cardBorder}
          copy={copy}
          activePhase={activePhase}
        />
        <MindMapPanel
          tint={mode.tint}
          glow={mode.glow}
          isDark={isDark}
          cardBorder={cardBorder}
          copy={copy}
          activePhase={activePhase}
        />
        <ProcessTimelinePanel
          tint={mode.tint}
          glow={mode.glow}
          isDark={isDark}
          cardBorder={cardBorder}
          copy={copy}
          liveGenerate={mode.liveGenerate}
          activePhase={activePhase}
        />
      </div>

      <PhaseRibbon
        activePhase={activePhase}
        tint={mode.tint}
        glow={mode.glow}
        isDark={isDark}
        cardBorder={cardBorder}
      />

      <p className={`mt-2 sm:mt-3 text-[10px] sm:text-[11px] leading-snug ${textMuted}`}>
        <span className={textPrimary}>當前推論：</span>
        {summary}
        <span className="ml-1 opacity-70">
          （此圖即全站光球代理的底層邏輯：感知 → 意圖 → 上下文 → 約束 → 路由 → 並行派工 → 串流 → 對齊 → 評分 → 交付。三個面板共享同一 phase 心跳，每 {Math.round(PHASE_INTERVAL_MS / 100) / 10}s 推進一格，10 phase 一輪。）
        </span>
      </p>
    </motion.section>
  );
}
