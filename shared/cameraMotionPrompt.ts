/**
 * cameraMotionPrompt.ts — Translate Studio camera-motion sliders to model cues.
 *
 * Studio 的影片工作區提供 pan / zoom / tilt 三個 -100~+100 滑桿,但底層 fal.ai
 * 影片模型(kling / wan / veo / minimax …)沒有對應的結構化欄位。fal-ai/cammaster
 * 雖然有 `camera_motion` enum,但該 model 已在 fal 下架(catalog 標 disabled,
 * 自動 substitute 到 kling-pro,而 kling-pro 會靜默忽略 `camera_motion`)。
 *
 * 因此把滑桿值翻成自然語言 cue 嵌進 prompt,是目前唯一能對所有影片模型生效
 * 的做法 — kling / veo / runway 的 prompt interpreter 都聽得懂這類描述。
 *
 * 第二個 export 順便提供 CamMaster 17-enum 的對應值,供之後 CamMaster 復活
 * 或用戶手動選 cammaster 模型時可以直接帶 enum。
 */

export type CameraMotion = {
  pan: number; // -100 (left) ~ +100 (right)
  zoom: number; // -100 (out / pull) ~ +100 (in / push)
  tilt: number; // -100 (down) ~ +100 (up)
};

/** 任何單軸絕對值小於這個門檻,視為「沒按」,不嵌任何文字。 */
const DEAD_ZONE = 10;

/** 強度分級門檻 — 對應 slight / moderate / strong。 */
function intensityLabel(magnitude: number): "slight" | "moderate" | "strong" {
  if (magnitude >= 70) return "strong";
  if (magnitude >= 35) return "moderate";
  return "slight";
}

/** Build the per-axis English cue, or null when below dead zone. */
function panCue(value: number): string | null {
  const m = Math.abs(value);
  if (m < DEAD_ZONE) return null;
  const dir = value > 0 ? "right" : "left";
  return `${intensityLabel(m)} pan to the ${dir}`;
}

function zoomCue(value: number): string | null {
  const m = Math.abs(value);
  if (m < DEAD_ZONE) return null;
  // positive = push in / dolly in toward subject; negative = pull out / dolly out
  return value > 0
    ? `${intensityLabel(m)} push-in toward the subject`
    : `${intensityLabel(m)} pull-out away from the subject`;
}

function tiltCue(value: number): string | null {
  const m = Math.abs(value);
  if (m < DEAD_ZONE) return null;
  const dir = value > 0 ? "upward" : "downward";
  return `${intensityLabel(m)} tilt ${dir}`;
}

/**
 * Convert slider triple to a single natural-language clause, e.g.
 *   "Camera motion: moderate pan to the right, slight push-in toward the subject."
 * Returns null when all three sliders are inside the dead zone.
 */
export function describeCameraMotion(motion: CameraMotion | undefined | null): string | null {
  if (!motion) return null;
  const parts = [panCue(motion.pan), zoomCue(motion.zoom), tiltCue(motion.tilt)].filter(
    (p): p is string => p !== null
  );
  if (parts.length === 0) return null;
  return `Camera motion: ${parts.join(", ")}.`;
}

/**
 * Append the camera-motion clause to a prompt, returning the original prompt
 * unchanged when the motion is empty. Convenient for one-line use sites.
 */
export function applyCameraMotionToPrompt(
  prompt: string,
  motion: CameraMotion | undefined | null
): string {
  const clause = describeCameraMotion(motion);
  if (!clause) return prompt;
  // Trim trailing punctuation/whitespace so the join reads naturally.
  const base = prompt.replace(/[\s.。!?！？]+$/u, "");
  return `${base}. ${clause}`;
}

/** CamMaster's 17-motion enum, exported for callers that explicitly target it. */
export const CAM_MASTER_MOTIONS = [
  "static",
  "move_left",
  "move_right",
  "move_up",
  "move_down",
  "push_in",
  "pull_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "roll_clockwise",
  "roll_counterclockwise",
  "orbit_left",
  "orbit_right",
  "crane_up",
  "crane_down",
] as const;

export type CamMasterMotion = (typeof CAM_MASTER_MOTIONS)[number];

/**
 * Pick the closest CamMaster motion based on which slider has the largest
 * magnitude. Returns null when all sliders are inside the dead zone.
 *
 * Note: CamMaster is currently disabled at fal (auto-substitutes to kling-pro,
 * which ignores `camera_motion`). This helper is kept for the day CamMaster
 * comes back or for callers that explicitly hit the videoStudio.camMaster route.
 */
export function pickCamMasterMotion(motion: CameraMotion | undefined | null): CamMasterMotion | null {
  if (!motion) return null;
  const axes = [
    { key: "pan" as const, value: motion.pan },
    { key: "zoom" as const, value: motion.zoom },
    { key: "tilt" as const, value: motion.tilt },
  ];
  const dominant = axes
    .filter(a => Math.abs(a.value) >= DEAD_ZONE)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
  if (!dominant) return null;
  switch (dominant.key) {
    case "pan":
      return dominant.value > 0 ? "pan_right" : "pan_left";
    case "zoom":
      return dominant.value > 0 ? "push_in" : "pull_out";
    case "tilt":
      return dominant.value > 0 ? "tilt_up" : "tilt_down";
  }
}
