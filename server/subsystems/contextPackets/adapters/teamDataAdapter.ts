/**
 * teamDataAdapter — 內部團隊資料來源（teaching_materials）
 * ────────────────────────────────────────────────────────────────────────────
 * 重用既有檢索與權限基礎設施，產出 source-agnostic 的 ContextSourceRef[]：
 *   1. searchTeachingArchive：語意 / LIKE 混合檢索（已內建 team 可見性過濾）
 *   2. loadMaterialForRead：逐筆再驗讀權限（defense-in-depth），並取得 teamId/textContent
 *   3. project_data_access_rules：依 accessLevel 決定排除 / 摘要 / 片段 / 完整引用，
 *      並依 allowedModes 對當前 mode 過濾
 *   4. logAccess：每筆納入的素材寫一筆稽核（action=search_hit, via=context_packet）
 *
 * 預設語意（無明確規則時）：default-allow `summary_only`。已通過可見性與讀權限的
 * 素材若無規則，給摘要級存取；可用明確 `none` 規則覆寫排除。
 */

import * as db from "../../../db";
import {
  loadMaterialForRead,
  logAccess,
} from "../../../services/teachingArchiveAccess";
import { searchTeachingArchive } from "../../../services/teachingArchiveSearch";
import type { ProjectDataAccessRule, TeachingMaterial } from "../../../../drizzle/schema";
import type {
  AccessLevel,
  ContextAdapterInput,
  ContextSourceRef,
  DataSourceAdapter,
} from "../contracts";

const DEFAULT_ACCESS_LEVEL: AccessLevel = "summary_only";
const SUMMARY_SNIPPET_MAX = 120;
const FULL_SNIPPET_MAX = 600;

/** 從適用規則中挑出最具體的一條：materialId 專屬 > 全隊；project 專屬 > team-wide。 */
function resolveRule(
  rules: ProjectDataAccessRule[],
  materialId: number,
  projectId: number
): ProjectDataAccessRule | null {
  let best: ProjectDataAccessRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    // 連接層級規則（針對外部來源）不套用於內部 material。
    if (r.connectionId != null) continue;
    const materialOk = r.materialId === materialId || r.materialId === null;
    const projectOk = r.projectId === projectId || r.projectId === null;
    if (!materialOk || !projectOk) continue;
    const materialScore = r.materialId === materialId ? 2 : 1;
    const projectScore = r.projectId === projectId ? 2 : 1;
    const score = materialScore * 10 + projectScore;
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 依 accessLevel 形塑要放進 context 的片段。 */
function shapeSnippet(
  accessLevel: AccessLevel,
  hitSnippet: string,
  material: TeachingMaterial
): string {
  if (accessLevel === "summary_only") return truncate(hitSnippet, SUMMARY_SNIPPET_MAX);
  if (accessLevel === "chunk_access") return truncate(hitSnippet, FULL_SNIPPET_MAX);
  // full_reference：可放更完整內容（優先用 textContent）。
  const body = material.textContent?.trim() || hitSnippet;
  return truncate(body, FULL_SNIPPET_MAX);
}

export const teamDataAdapter: DataSourceAdapter = {
  kind: "team_data",

  async collect(input: ContextAdapterInput): Promise<ContextSourceRef[]> {
    const { userId, projectId, query, limit, mode } = input;

    const hits = await searchTeachingArchive({ userId, query, limit });
    if (hits.length === 0) return [];

    // 逐筆再驗讀權限並取完整 row（含 teamId / textContent）。失敗者丟棄，不中斷整批。
    const materials: Array<{
      material: TeachingMaterial;
      snippet: string;
      score: number;
      matchedBy: "vector" | "fts";
    }> = [];
    for (const hit of hits) {
      try {
        const { material } = await loadMaterialForRead(hit.id, { userId });
        materials.push({
          material,
          snippet: hit.snippet,
          score: hit.score,
          matchedBy: hit.matchedBy,
        });
      } catch {
        // 無權讀（理論上 search 已過濾，但 defense-in-depth）— 略過該筆。
      }
    }
    if (materials.length === 0) return [];

    // 取所有相關 teamId 的存取規則（個人素材 teamId 為 null，無規則）。
    const teamIds = Array.from(
      new Set(
        materials
          .map(m => m.material.teamId)
          .filter((t): t is number => t !== null)
      )
    );
    const rulesByTeam = new Map<number, ProjectDataAccessRule[]>();
    for (const teamId of teamIds) {
      rulesByTeam.set(
        teamId,
        await db.listProjectDataAccessRules(teamId, projectId)
      );
    }

    const refs: ContextSourceRef[] = [];
    for (const { material, snippet, score, matchedBy } of materials) {
      const rules = material.teamId ? rulesByTeam.get(material.teamId) ?? [] : [];
      const rule = resolveRule(rules, material.id, projectId);
      const accessLevel: AccessLevel = rule?.accessLevel ?? DEFAULT_ACCESS_LEVEL;

      if (accessLevel === "none") continue;
      // mode 過濾：規則有 allowedModes 且不含當前 mode → 排除。
      if (rule?.allowedModesJson && !rule.allowedModesJson.includes(mode)) {
        continue;
      }

      refs.push({
        kind: "team_data",
        refId: String(material.id),
        title: material.title,
        accessLevel,
        snippet: shapeSnippet(accessLevel, snippet, material),
        connectionId: null,
        score,
        matchedBy,
      });

      // 稽核：每筆納入創作上下文的內部素材都留痕。
      logAccess(material.id, userId, "search_hit", {
        via: "context_packet",
        projectId,
        mode,
        accessLevel,
      });
    }

    return refs;
  },
};
