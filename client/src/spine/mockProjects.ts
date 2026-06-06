// ============================================================================
// spine/mockProjects.ts — 離線 mock 種子（VIDEO_SPINE_MOCK=ON 時的脊椎資料）
// ----------------------------------------------------------------------------
// 來源：AI-Director-模擬 spine/mockData.ts（MOCK_PROJECTS）。一比一型別對齊 P0 的
// @/spine/types。**僅供離線開發 / demo / e2e**：零後端、零金鑰，讓座艙在沒有 tRPC 的
// 環境也能完整探索（含確認門全狀態、引導式拆解、生成回退）。
//
// 真實模式（VIDEO_SPINE_MOCK=OFF，預設）不會 import 執行這份種子的網路面——projectGateway
// 走 tRPC。這份只有在 mock gateway 才被讀。
// ============================================================================
import type { CreativeProject } from "@/spine/types";

const t = (h: number, m: number) =>
  new Date(2026, 5, 5, h, m).toLocaleTimeString("zh-TW", { hour12: false });

// ── 旗艦專案：惹瓊巴傳（影片）— 刻意涵蓋確認門全部狀態 ──────────────────────────
const rechungpa: CreativeProject = {
  id: "p_rechungpa", name: "惹瓊巴傳", emoji: "🏔", type: "影片",
  logline: "密勒日巴與弟子惹瓊巴的雪山求道，以禪意宇宙風格呈現的短片。",
  styleBible: "深藍宇宙 × 金色禪意 × 青玻璃光；廣角雪景、柔光、35mm 質感。",
  stageIndex: 2,
  characters: [
    { id: "c_mila", name: "密勒日巴", emoji: "🧙", sourceGrade: "precise", locked: true,
      locks: { face: true, hair: true, costume: true, accessory: true }, loraStatus: "已完成", refImages: 5 },
    { id: "c_rech", name: "惹瓊巴", emoji: "🧘", sourceGrade: "estimate", locked: false,
      locks: { face: false, hair: false, costume: false, accessory: false }, loraStatus: "未訓練", refImages: 0 },
    { id: "c_god", name: "山神", emoji: "⛰", sourceGrade: "unconfirmed", locked: false,
      locks: { face: false, hair: false, costume: false, accessory: false }, loraStatus: "未訓練", refImages: 0 },
  ],
  scenes: [
    { id: "s_road", name: "雪山道", kind: "exterior", locked: true },
    { id: "s_cave", name: "閉關洞", kind: "interior", locked: true },
    { id: "s_village", name: "村莊", kind: "named-place", locked: false }, // 場景缺實景 demo
  ],
  shots: [
    { id: "sh1", no: "S01", act: 1, title: "雪山道遠景", route: "text", characterIds: [], sceneId: "s_road",
      seed: 1042, approval: "approved", stale: false, gen: { status: "done", provider: "hf", model: "Z-Image-Turbo", costUsd: 0.012, variant: 0 } },
    { id: "sh2", no: "S02", act: 1, title: "密勒日巴洞口", route: "ref", characterIds: ["c_mila"], sceneId: "s_cave",
      seed: 2087, approval: "approved", stale: false, gen: { status: "done", provider: "hf", model: "Qwen-Image-Edit", costUsd: 0.012, variant: 0 } },
    { id: "sh3", no: "S03", act: 1, title: "惹瓊巴登場", route: "ref", characterIds: ["c_rech"], sceneId: "s_road",
      seed: 3120, approval: "pending", stale: false, gen: { status: "idle", variant: 0 } }, // partial/blocked: 角色僅估算
    { id: "sh4", no: "S04", act: 2, title: "師徒相見", route: "ref", characterIds: ["c_mila", "c_rech"], sceneId: "s_cave",
      seed: 4205, approval: "pending", stale: false, gen: { status: "idle", variant: 0 } }, // partial: 一就緒一待補
    { id: "sh5", no: "S05", act: 2, title: "山神示現", route: "ref", characterIds: ["c_god"], sceneId: "s_road",
      seed: 5310, approval: "pending", stale: false, gen: { status: "idle", variant: 0 } }, // blocked: 角色未確認
    { id: "sh6", no: "S06", act: 2, title: "村莊全景", route: "text", characterIds: [], sceneId: "s_village",
      seed: 6033, approval: "pending", stale: false, gen: { status: "idle", variant: 0 } }, // blocked: 場景缺實景
  ],
  notes: [
    { id: "n1", ts: t(9, 12), text: "S04 師徒相見要強調「眼神交會」，柔光近景。", shotNo: "S04" },
    { id: "n2", ts: t(9, 40), text: "整體配色跟主視覺一致：深藍 + 金。" },
  ],
  assets: [
    { id: "a1", kind: "keyframe", shotNo: "S01", provider: "hf", modelId: "Z-Image-Turbo", sourceStudio: "image-studio", costUsd: 0.012, seed: 1042, ts: t(9, 5) },
    { id: "a2", kind: "keyframe", shotNo: "S02", provider: "hf", modelId: "Qwen-Image-Edit", sourceStudio: "image-studio", costUsd: 0.012, seed: 2087, ts: t(9, 8) },
  ],
  promptBlocks: [
    { id: "pb1", label: "雪山·晨光·廣角", text: "snowy mountain pass, dawn light, wide angle, 35mm", kind: "combo", uses: 12 },
    { id: "pb2", label: "金色禪意·柔光", text: "golden zen aura, soft rim light, cinematic", kind: "combo", uses: 8 },
    { id: "pb3", label: "惹瓊巴定裝", text: "rust-red monk robe, mudra gesture, calm face", kind: "custom", uses: 3 },
  ],
  packet: {
    summaryMarkdown:
      "惹瓊巴傳・世界觀：雪山求道；主角密勒日巴(定版)、惹瓊巴(估算)、山神(未確認)。風格＝深藍宇宙×金禪意。分鏡 6 鏡，S01/S02 已生。",
    sourceRefs: [
      { ref: "worldbuilding_frameworks#p_rechungpa", kind: "世界觀", fresh: true },
      { ref: "world_storyboards#S01-S06", kind: "分鏡", fresh: true },
      { ref: "consistency_vault#c_mila", kind: "角色鎖定", fresh: true },
      { ref: "teaching_materials#milarepa.pdf", kind: "雲端教材", fresh: false },
      { ref: "drive://refs/snow-pass", kind: "Drive 參考", fresh: true },
    ],
    tokenEstimate: 2410, ttlSec: 1800, permissions: "擁有者可讀寫・團隊唯讀",
  },
  updatedAt: Date.now() - 1000 * 60 * 8,
};

// ── 第二專案：每日禪語（社群）──────────────────────────────────────────────────
const zenSocial: CreativeProject = {
  id: "p_zen", name: "每日禪語", emoji: "🪷", type: "社群",
  logline: "每天一張開示金句卡，跨 IG / 限動 / FB 多尺寸發佈。",
  styleBible: "品牌鎖定：青玻璃漸層底、金色字標、Noto Serif TC。",
  stageIndex: 1,
  characters: [], scenes: [], shots: [],
  notes: [{ id: "zn1", ts: t(8, 30), text: "本週主題：放下。" }],
  assets: [{ id: "za1", kind: "image", provider: "gemini", modelId: "imagen-3", sourceStudio: "social-studio", costUsd: 0.018, ts: t(8, 33) }],
  promptBlocks: [{ id: "zpb1", label: "品牌·青金漸層", text: "teal-gold gradient, brand-locked, serif headline", kind: "combo", uses: 21 }],
  packet: {
    summaryMarkdown: "每日禪語・社群線：品牌鎖定青金漸層；本週主題「放下」。無分鏡（單張核准制）。",
    sourceRefs: [
      { ref: "block_combos#brand-teal-gold", kind: "品牌風格", fresh: true },
      { ref: "featured_showcase#zen", kind: "發佈紀錄", fresh: true },
      { ref: "news_articles#mindfulness", kind: "時事選題", fresh: true },
    ],
    tokenEstimate: 980, ttlSec: 1800, permissions: "擁有者可讀寫",
  },
  updatedAt: Date.now() - 1000 * 60 * 60,
};

// ── 第三專案：空白（示範空狀態 / 引導式入口）───────────────────────────────────
const blank: CreativeProject = {
  id: "p_blank", name: "未命名創作", emoji: "✨", type: "混合",
  logline: "", styleBible: "", stageIndex: 0,
  characters: [], scenes: [], shots: [], notes: [], assets: [], promptBlocks: [],
  packet: { summaryMarkdown: "（尚未建立上下文）", sourceRefs: [], tokenEstimate: 0, ttlSec: 0, permissions: "擁有者可讀寫" },
  updatedAt: Date.now() - 1000 * 60 * 60 * 24,
};

export const MOCK_PROJECTS: CreativeProject[] = [rechungpa, zenSocial, blank];

/** 預設作用中 mock 專案 id（旗艦）。 */
export const DEFAULT_MOCK_PROJECT_ID = "p_rechungpa";
