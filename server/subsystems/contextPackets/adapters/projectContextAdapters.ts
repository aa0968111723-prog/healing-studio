/**
 * projectContextAdapters — AIDV-303 專案上下文來源接入 contextPackets
 * ────────────────────────────────────────────────────────────────────────────
 * 把專案脈絡來源接進既有 compile pipeline，全部**唯讀既有表、零 migration**：
 *   - worldbuilding：worldbuilding_frameworks（世界觀基調 genre / era / description）
 *   - character   ：worldbuilding_frameworks.charactersJson（角色卡）
 *   - scene       ：worldbuilding_frameworks.scenesJson（場景卡）
 *   - continuity  ：world_storyboards（分鏡時間軸）＋ consistency_vault（前後鏡
 *                   一致性參考圖：角色 / 場景）
 *
 * 權限守門（與 projectContextService 同語意）：
 *   - framework / storyboard：載入後比對 row.userId === input.userId，非本人
 *     一律靜默跳過（不報錯、不外洩存在性）。
 *   - consistency_vault：查詢本身以 userId 限定（getVaultItemsByUser）。
 *
 * 血統（lineage）：每筆 ref 都帶 { sourceType, sourceId, retrievedAt }，寫進
 * sourceRefsJson 持久化 —— 純加性欄位，不改既有 packet 欄位語意。
 *
 * 脫敏：沿用既有規則 —— 這些 kind !== "team_data"，compile 端的
 * sanitizeUntrustedRefs 會（旗標 ON 時）對 title / snippet 過 neutralize，
 * adapter 端不需（也不應）自己做，維持單一 chokepoint。
 *
 * 截斷：每個來源最多回 input.limit 筆；snippet 一律截到 SNIPPET_MAX。
 */

import * as db from "../../../db";
import type {
  AccessLevel,
  ContextAdapterInput,
  ContextSourceRef,
  DataSourceAdapter,
  SourceLineage,
} from "../contracts";

/** 專案上下文來源皆為使用者自有資料 → 擁有者可完整引用。 */
const DEFAULT_ACCESS_LEVEL: AccessLevel = "full_reference";
const SNIPPET_MAX = 160;

function truncate(text: string, max = SNIPPET_MAX): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function nowIso(): string {
  return new Date().toISOString();
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lineage(sourceType: string, sourceId: string, retrievedAt: string): SourceLineage {
  return { sourceType, sourceId, retrievedAt };
}

/**
 * 載入 project 連結的世界觀框架，並做擁有權守門：
 * 未連結 / 不存在 / 非本人 → null（靜默跳過，與 projectContextService 同語意）。
 */
async function loadOwnedFramework(input: ContextAdapterInput) {
  const frameworkId = input.project?.worldFrameworkId;
  if (!frameworkId) return null;
  const framework = await db.getWorldbuildingFramework(frameworkId);
  if (!framework || framework.userId !== input.userId) return null;
  return framework;
}

/** 世界觀（框架基調）：一個 framework 產一筆 ref。 */
export const worldbuildingAdapter: DataSourceAdapter = {
  kind: "worldbuilding",

  async collect(input: ContextAdapterInput): Promise<ContextSourceRef[]> {
    const framework = await loadOwnedFramework(input);
    if (!framework) return [];
    const retrievedAt = nowIso();
    const tags = [framework.genre, framework.era]
      .map(str)
      .filter((v): v is string => v !== null);
    const desc = str(framework.description);
    const parts = [
      tags.length > 0 ? tags.join(" · ") : null,
      desc,
    ].filter((v): v is string => v !== null);
    return [
      {
        kind: "worldbuilding",
        refId: String(framework.id),
        title: framework.name,
        accessLevel: DEFAULT_ACCESS_LEVEL,
        snippet: truncate(parts.join("：") || "（尚未填寫世界觀描述）"),
        connectionId: null,
        lineage: lineage("worldbuilding_framework", String(framework.id), retrievedAt),
      },
    ];
  },
};

/** 角色卡：framework.charactersJson，最多 limit 筆。 */
export const characterAdapter: DataSourceAdapter = {
  kind: "character",

  async collect(input: ContextAdapterInput): Promise<ContextSourceRef[]> {
    const framework = await loadOwnedFramework(input);
    if (!framework) return [];
    const retrievedAt = nowIso();
    // 條目層守門：legacy / 手動修過的資料可能含 null 或非物件條目 →
    // 靜默跳過壞條目，不讓一筆壞資料炸掉整個 compile。
    const characters = (
      Array.isArray(framework.charactersJson) ? framework.charactersJson : []
    ).filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
    return characters.slice(0, input.limit).map((c, i) => {
      const charId = str(c.id) ?? String(i);
      const name = str(c.name) ?? `角色 ${i + 1}`;
      const parts = [str(c.tagline), str(c.personality), str(c.appearance)].filter(
        (v): v is string => v !== null
      );
      return {
        kind: "character" as const,
        refId: `${framework.id}:${charId}`,
        title: name,
        accessLevel: DEFAULT_ACCESS_LEVEL,
        snippet: truncate(parts.join("；") || "（尚未填寫角色描述）"),
        connectionId: null,
        lineage: lineage("worldbuilding_character", charId, retrievedAt),
      };
    });
  },
};

/** 場景卡：framework.scenesJson，最多 limit 筆。 */
export const sceneAdapter: DataSourceAdapter = {
  kind: "scene",

  async collect(input: ContextAdapterInput): Promise<ContextSourceRef[]> {
    const framework = await loadOwnedFramework(input);
    if (!framework) return [];
    const retrievedAt = nowIso();
    // 條目層守門：同 characterAdapter —— 壞條目（null / 非物件）靜默跳過。
    const scenes = (
      Array.isArray(framework.scenesJson) ? framework.scenesJson : []
    ).filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
    return scenes.slice(0, input.limit).map((s, i) => {
      const sceneId = str(s.id) ?? String(i);
      const name = str(s.name) ?? `場景 ${i + 1}`;
      const parts = [str(s.tagline), str(s.environment), str(s.mood)].filter(
        (v): v is string => v !== null
      );
      return {
        kind: "scene" as const,
        refId: `${framework.id}:${sceneId}`,
        title: name,
        accessLevel: DEFAULT_ACCESS_LEVEL,
        snippet: truncate(parts.join("；") || "（尚未填寫場景描述）"),
        connectionId: null,
        lineage: lineage("worldbuilding_scene", sceneId, retrievedAt),
      };
    });
  },
};

/**
 * 前後鏡連貫性：
 *   1. project 連結的分鏡時間軸（world_storyboards；擁有權守門）
 *   2. 一致性素材庫（consistency_vault；查詢以 userId 限定）
 * 合計最多 limit 筆。
 */
export const continuityAdapter: DataSourceAdapter = {
  kind: "continuity",

  async collect(input: ContextAdapterInput): Promise<ContextSourceRef[]> {
    const retrievedAt = nowIso();
    const refs: ContextSourceRef[] = [];

    const storyboardId = input.project?.worldStoryboardId;
    if (storyboardId) {
      const storyboard = await db.getWorldStoryboard(storyboardId);
      if (storyboard && storyboard.userId === input.userId) {
        const sceneCount = Array.isArray(storyboard.scenesJson)
          ? storyboard.scenesJson.length
          : 0;
        refs.push({
          kind: "continuity",
          refId: `storyboard:${storyboard.id}`,
          title: storyboard.name,
          accessLevel: DEFAULT_ACCESS_LEVEL,
          snippet: truncate(
            `分鏡時間軸：${sceneCount} 場・${storyboard.totalDurationSec} 秒・狀態 ${storyboard.productionStatus}`
          ),
          connectionId: null,
          lineage: lineage("world_storyboard", String(storyboard.id), retrievedAt),
        });
      }
    }

    // 一致性參考圖（角色 / 場景）— userId-scoped，權限內建於查詢本身。
    //
    // 範圍限定（AIDV-303 修補）：consistency_vault 無 worldId / projectId 欄位
    // （完整 scoping 需 migration，本卡禁止），getVaultItemsByUser 回的是
    // user-global 清單。零 migration 內最誠實的 scoping proxy：只有專案有
    // 世界觀連結（framework 或 storyboard）時才把 vault 參考圖納入 continuity，
    // 避免與視覺連貫性無關的專案把跨專案 vault 內容持久化進 packet。
    // 已知限制（follow-up）：多世界使用者在「有連結」的專案仍可能混入其他
    // 世界的參考圖；待 vault 補 worldId 欄位後改為精確過濾。
    if (!input.project?.worldFrameworkId && !input.project?.worldStoryboardId) {
      return refs;
    }
    const vaultItems = await db.getVaultItemsByUser(input.userId);
    const remaining = Math.max(0, input.limit - refs.length);
    for (const item of vaultItems.slice(0, remaining)) {
      const tags = Array.isArray(item.tags)
        ? item.tags.filter((t): t is string => typeof t === "string")
        : [];
      const typeLabel = item.itemType === "character" ? "角色" : "場景";
      refs.push({
        kind: "continuity",
        refId: `vault:${item.id}`,
        title: item.name,
        accessLevel: DEFAULT_ACCESS_LEVEL,
        snippet: truncate(
          [`${typeLabel}一致性參考圖`, tags.join("、")]
            .filter(Boolean)
            .join("：")
        ),
        connectionId: null,
        lineage: lineage("consistency_vault", String(item.id), retrievedAt),
      });
    }

    return refs;
  },
};

/** AIDV-303 專案上下文來源 adapter 清單（compile 端與 team_data 一起跑）。 */
export const projectContextAdapters: DataSourceAdapter[] = [
  worldbuildingAdapter,
  characterAdapter,
  sceneAdapter,
  continuityAdapter,
];
