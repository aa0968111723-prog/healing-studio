/**
 * videoOutputSpec.ts — 影片輸出規格（resolution / fps / codec）→ fal payload 映射 + 付費守門
 *
 * AIDV-255「/video 影片解析度／畫質選擇」核心純函式層。
 *
 * 設計鐵則（對齊研究結論，全部為純函式、無副作用）：
 *  - codec / bitrate：所有 fal.ai 文生影 endpoint 一律不暴露 → 永不注入（no-op）。
 *  - resolution：僅 Wan 系（fal-ai/wan-t2v、wan v2.2）與 Veo3（fal-ai/veo3*）真正可控；
 *    其餘（Kling、MiniMax）由 endpoint tier 隱含決定 → no-op，不注入會被忽略/報錯的 key。
 *  - fps：僅 Wan 系以 `frames_per_second`（整數）可控；Veo3 / Kling / MiniMax 鎖死 → no-op。
 *  - mapper 對「不支援該參數的模型」一律回空物件，永不 throw。
 *  - 4K 守門是唯一允許 throw（TRPCError FORBIDDEN）的地方。
 *
 * 與既有端點專屬輸入的關係（HARD SAFETY #2）：
 *  本模組只負責「依 outputSpec 產出要淺合併的補充欄位」。呼叫端必須以
 *  「mapper 結果在前、端點專屬欄位在後」的順序合併，使 wan/minimax 自帶的
 *  resolution enum 永遠勝出，不被本模組蓋掉。
 */

import { TRPCError } from "@trpc/server";
import type { VideoOutputSpec } from "../../drizzle/schema";

/** 模型對 outputSpec 各維度的可控能力。codec 永遠不可控（fal 不暴露）。 */
interface OutputSpecCapability {
  /** fal payload 解析度 key（snake_case）；null = 該模型不可控解析度。 */
  resolutionKey: "resolution" | null;
  /** 該模型可接受的解析度值集合（值為 fal 端字串，如 "720p"）。 */
  resolutionValues: ReadonlySet<string>;
  /** fal payload fps key（整數）；null = 該模型不可控 fps。 */
  fpsKey: "frames_per_second" | null;
  /** fps clamp 範圍 [min, max]（整數）。 */
  fpsRange: readonly [number, number] | null;
}

const NO_CAPABILITY: OutputSpecCapability = {
  resolutionKey: null,
  resolutionValues: new Set(),
  fpsKey: null,
  fpsRange: null,
};

/**
 * 把 outputSpec 的解析度（720p/1080p/4K）映射到 fal 端可接受的解析度字串。
 * 4K 不在任何文生影模型的接受集合內 → 一律降級為該模型支援的最高解析度。
 */
const RESOLUTION_RANK: Record<string, number> = {
  "480p": 1,
  "580p": 2,
  "720p": 3,
  "1080p": 4,
  "4K": 5,
};

/**
 * 依 modelId 解析該模型的 outputSpec 能力。
 * 用 includes 比對 family，涵蓋 v2.1 / v2.2 / pro / standard 等變體。
 */
function resolveCapability(modelId: string): OutputSpecCapability {
  const id = modelId.toLowerCase();

  // ── Wan 系（fal-ai/wan-t2v、wan v2.2-a14b 等）：resolution + fps 皆可控 ──
  if (id.includes("wan")) {
    // v2.1 (wan-t2v) fps 5–24；v2.2 fps 4–60。取保守交集上限以避免越界，
    // 但 v2.2 需要到 60 → 以 id 區分。
    const isV22 = id.includes("v2.2") || id.includes("2.2");
    return {
      resolutionKey: "resolution",
      resolutionValues: new Set(["480p", "580p", "720p"]),
      fpsKey: "frames_per_second",
      fpsRange: isV22 ? [4, 60] : [5, 24],
    };
  }

  // ── Veo3 系（fal-ai/veo3、veo3/pro）：resolution 可控（"720p"/"1080p"），fps 鎖死 ──
  if (id.includes("veo3") || id.includes("veo-3")) {
    return {
      resolutionKey: "resolution",
      resolutionValues: new Set(["720p", "1080p"]),
      fpsKey: null,
      fpsRange: null,
    };
  }

  // ── Kling / MiniMax / 其餘：解析度由 endpoint tier 隱含，fps 鎖死 → no-op ──
  return NO_CAPABILITY;
}

/**
 * 把 outputSpec 的 resolution（720p/1080p/4K）對應到模型可接受的解析度值。
 * - 若該值在模型接受集合內 → 直接用。
 * - 否則（含 4K，所有文生影模型皆不支援）→ 降級為模型支援的最高解析度，不謊報。
 * 回 null 表示無法映射（不應發生，因可控模型必有非空集合）。
 */
function mapResolutionValue(
  resolution: VideoOutputSpec["resolution"],
  values: ReadonlySet<string>
): string | null {
  if (values.size === 0) return null;
  if (values.has(resolution)) return resolution;
  // 降級：取 rank ≤ 請求值 的最高支援解析度；若都比請求值高（不會發生）取最低。
  const wanted = RESOLUTION_RANK[resolution] ?? Number.MAX_SAFE_INTEGER;
  let best: string | null = null;
  let bestRank = -1;
  for (const v of values) {
    const r = RESOLUTION_RANK[v] ?? 0;
    if (r <= wanted && r > bestRank) {
      best = v;
      bestRank = r;
    }
  }
  if (best) return best;
  // 全部都比請求高 → 取集合中最低 rank 者（防呆）
  let lowest: string | null = null;
  let lowestRank = Number.MAX_SAFE_INTEGER;
  for (const v of values) {
    const r = RESOLUTION_RANK[v] ?? Number.MAX_SAFE_INTEGER;
    if (r < lowestRank) {
      lowest = v;
      lowestRank = r;
    }
  }
  return lowest;
}

function clampFps(fps: number, range: readonly [number, number]): number {
  const [min, max] = range;
  return Math.min(max, Math.max(min, Math.round(fps)));
}

/**
 * 把 outputSpec 映射成「要淺合併進該模型 fal payload」的補充欄位。
 *
 * - 未知模型 / 不可控的維度 → 不放入對應 key（回空物件代表整體 no-op）。
 * - codec：恆不注入（fal 文生影不接受）。
 * - 純函式、無副作用、不 throw。
 *
 * @returns Record（只含確實可控且有對應的 key），永不為 null。
 */
export function mapOutputSpecToFalParams(
  modelId: string,
  spec: VideoOutputSpec
): Record<string, unknown> {
  const cap = resolveCapability(modelId);
  const out: Record<string, unknown> = {};

  if (cap.resolutionKey) {
    const mapped = mapResolutionValue(spec.resolution, cap.resolutionValues);
    if (mapped) out[cap.resolutionKey] = mapped;
  }

  if (cap.fpsKey && cap.fpsRange) {
    out[cap.fpsKey] = clampFps(spec.fps, cap.fpsRange);
  }

  // codec：所有文生影模型皆不暴露 → 永不注入。

  return out;
}

/** 付費方案集合（依 user_subscriptions.planId 之語意）。免費 = "free"。 */
function isPaidPlan(plan: { planId: string; status: string | null } | null | undefined): boolean {
  if (!plan) return false; // fail-closed：查不到方案一律當免費
  if (plan.status !== "active" && plan.status !== "trialing") return false;
  return plan.planId.toLowerCase() !== "free";
}

/**
 * 解析度付費守門：僅當請求 4K 且使用者非付費方案時 throw FORBIDDEN。
 * 其餘（720p/1080p，或 4K + 付費方案）一律放行（return void）。
 *
 * 這是本模組唯一允許 throw 的函式。
 *
 * @param resolution outputSpec.resolution
 * @param plan 使用者訂閱（{ planId, status }）；null/undefined → 視為免費（fail-closed）
 */
export function assertResolutionAllowed(
  resolution: VideoOutputSpec["resolution"],
  plan: { planId: string; status: string | null } | null | undefined
): void {
  if (resolution !== "4K") return;
  if (isPaidPlan(plan)) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "4K 解析度為付費方案專屬功能，請升級至付費方案（premium / ultra）後再使用。" +
      "免費方案可選用 720p 或 1080p。",
  });
}
