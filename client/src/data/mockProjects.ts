/**
 * Mock projects for the creation-hub skeleton.
 *
 * Step 3 ships without a real DB; these seed entries demonstrate the three
 * required examples (禪修短片企劃 / 社團招生海報 / 配音測試專案) and a couple
 * more for the projects list page. Timestamps are static ISO strings so the
 * list ordering is stable across reloads.
 */
import type { Project } from "@/types/projects";

export const MOCK_PROJECTS: Project[] = [
  {
    id: "proj-zen-short",
    title: "禪修短片企劃",
    type: "video",
    status: "active",
    progress: 42,
    currentStep: "完成第一版分鏡，正在挑配樂。",
    nextAction: "用配音 / 音樂創作室產出 30 秒環境音 demo。",
    createdAt: "2026-04-28T01:30:00.000Z",
    updatedAt: "2026-05-19T09:12:00.000Z",
    binding: {
      worldFramework: "禪修世界觀 v1",
      storyboard: "30 秒禪修分鏡",
      directorSession: "禪修腳本對話",
    },
  },
  {
    id: "proj-club-poster",
    title: "社團招生海報",
    type: "poster",
    status: "draft",
    progress: 18,
    currentStep: "決定主視覺色調 + 草稿排版。",
    nextAction: "到圖片創作室生成兩版主視覺候選。",
    createdAt: "2026-05-12T07:00:00.000Z",
    updatedAt: "2026-05-18T14:45:00.000Z",
  },
  {
    id: "proj-voice-test",
    title: "配音測試專案",
    type: "voice",
    status: "active",
    progress: 65,
    currentStep: "已挑選 2 個配音模型，正比對情緒節奏。",
    nextAction: "用同一段腳本各跑 1 版做 A/B。",
    createdAt: "2026-05-03T03:15:00.000Z",
    updatedAt: "2026-05-20T11:02:00.000Z",
    binding: {
      directorSession: "配音腳本對話",
    },
  },
  {
    id: "proj-brand-bgm",
    title: "品牌片頭配樂",
    type: "music",
    status: "draft",
    progress: 8,
    currentStep: "正在蒐集品牌調性參考。",
    nextAction: "整理 3 段參考素材並寫一份配樂 brief。",
    createdAt: "2026-05-15T02:00:00.000Z",
    updatedAt: "2026-05-16T05:25:00.000Z",
  },
  {
    id: "proj-character-lora",
    title: "角色 LoRA 訓練 v1",
    type: "model-training",
    status: "completed",
    progress: 100,
    currentStep: "訓練完成，已釋出 v1 權重。",
    nextAction: "在歷史頁挑樣，準備批次生成。",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-05-05T13:30:00.000Z",
  },
];
