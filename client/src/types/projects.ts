/**
 * Project skeleton types — Phase 1 / Step 3.
 *
 * Pure data shapes for the early creation-hub experience. There is no
 * server-side store yet (Step 3 intentionally keeps everything client-side
 * via ProjectsContext + MOCK_PROJECTS); a later step will graduate this to
 * tRPC / Drizzle. Keep this file dependency-free so it can be imported from
 * server-side mocks or future shared modules without pulling React in.
 */

export type ProjectType =
  | "video"
  | "image"
  | "poster"
  | "voice"
  | "music"
  | "material"
  | "model-training"
  | "other";

export type ProjectStatus = "draft" | "active" | "completed" | "archived";

/** Required project shape for Step 3. Fields beyond these are
 *  intentionally out of scope until later steps. */
export interface Project {
  id: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  /** 0–100 integer; UI clamps. */
  progress: number;
  /** Short label of where the user left off (1 sentence). */
  currentStep: string;
  /** What to do next, written as a verb phrase. */
  nextAction: string;
  /** ISO date strings — keep client-friendly so we can sort without parsing. */
  createdAt: string;
  updatedAt: string;
  /**
   * Phase 2a: creative-project ↔ worldview binding stub.
   *
   * Mock-only labels for now — the real source of truth is the server-side
   * creative_projects.worldFrameworkId / worldStoryboardId. We surface these
   * here so the /projects/:id placeholder can teach the binding concept
   * before the two stores converge.
   */
  binding?: {
    worldFramework?: string;
    storyboard?: string;
    directorSession?: string;
  };
  /**
   * Wave 1 SSOT：樂觀插入、尚未取得伺服器真實 id 的臨時專案（id 為負數字串）。
   * 消費端應停用導頁／選取等互動，等 refetch 帶回真列後自然消失。
   */
  isPending?: boolean;
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  video: "影片",
  image: "圖片",
  poster: "海報 / 文宣",
  voice: "配音",
  music: "音樂",
  material: "素材整理",
  "model-training": "模型訓練",
  other: "其他",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "草稿",
  active: "進行中",
  completed: "已完成",
  archived: "已封存",
};
