/**
 * server/services/orbResourceBridge.ts
 *
 * 資源中心橋接服務 — 讓光球代理在任何頁面都能查詢資源中心的數據。
 *
 * 解決的核心問題：
 *   光球的 pageAgent 只在使用者位於對應頁面時才能存取該頁面的 state，
 *   但使用者可能在 /agent 或 /studio 頁面時詢問「我有哪些圖片素材？」。
 *   本服務繞過 pageAgent，直接查詢 DB，讓光球在任何頁面都能回答。
 *
 * 支援的查詢：
 *   1. searchAssets — 搜尋數位資產庫（/assets）
 *   2. searchPrompts — 搜尋提示詞庫（/prompt-library）
 *   3. listModels — 列出已訓練模型（/models）
 *   4. searchVault — 搜尋一致性保險庫（/vault）
 *   5. getResourceSummary — 取得資源中心總覽摘要
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AssetSearchResult {
  id: number;
  title: string;
  assetType: string;
  description?: string;
  url?: string;
  promptUsed?: string;
  createdAt?: string;
}

export interface PromptSearchResult {
  id: number;
  title: string;
  category: string;
  content: string;
  mode?: string;
  tags?: string[];
  usageCount?: number;
  isFavorite?: boolean;
}

export interface ModelListResult {
  id: number;
  name: string;
  modelType: string;
  status: string;
  triggerWord?: string;
  baseModel?: string;
  createdAt?: string;
}

export interface VaultSearchResult {
  id: number;
  name: string;
  vaultType: string;
  description?: string;
  referenceUrl?: string;
  createdAt?: string;
}

export interface ResourceSummary {
  totalAssets: number;
  assetsByType: Record<string, number>;
  totalPrompts: number;
  promptsByCategory: Record<string, number>;
  totalModels: number;
  modelsByStatus: Record<string, number>;
  totalVaultItems: number;
}

export interface ResourceQueryOptions {
  userId: number;
  query?: string;
  assetType?: string;
  category?: string;
  limit?: number;
  includeTeam?: boolean;
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * 搜尋數位資產庫。
 * 使用 db.ts 中的 getDigitalAssetsByUser / getTeamSharedAssets。
 */
export async function searchAssets(
  opts: ResourceQueryOptions
): Promise<AssetSearchResult[]> {
  const limit = Math.min(opts.limit ?? 10, 20);
  try {
    const db = await import("../db");
    let results = await db.getDigitalAssetsByUser(opts.userId);

    // 合併團隊資產
    if (opts.includeTeam) {
      try {
        const teamAssets = await db.getTeamSharedAssets();
        results = [...results, ...teamAssets];
      } catch {
        // 團隊資產查詢失敗不影響個人資產
      }
    }

    // 類型篩選
    if (opts.assetType && opts.assetType !== "all") {
      results = results.filter(
        (a: Record<string, unknown>) => a.assetType === opts.assetType
      );
    }

    // 關鍵字搜尋
    if (opts.query) {
      const q = opts.query.toLowerCase();
      results = results.filter(
        (a: Record<string, unknown>) =>
          String(a.title ?? "")
            .toLowerCase()
            .includes(q) ||
          String(a.description ?? "")
            .toLowerCase()
            .includes(q) ||
          String(a.promptUsed ?? "")
            .toLowerCase()
            .includes(q)
      );
    }

    return results.slice(0, limit).map((a: Record<string, unknown>) => ({
      id: Number(a.id),
      title: String(a.title ?? ""),
      assetType: String(a.assetType ?? ""),
      description: a.description ? String(a.description) : undefined,
      url: a.url ? String(a.url) : undefined,
      promptUsed: a.promptUsed ? String(a.promptUsed) : undefined,
      createdAt: a.createdAt ? String(a.createdAt) : undefined,
    }));
  } catch (err) {
    console.error("[orbResourceBridge] searchAssets failed:", err);
    return [];
  }
}

/**
 * 搜尋提示詞庫。
 * 使用 Drizzle ORM 直接查詢 promptLibrary 表。
 */
export async function searchPrompts(
  opts: ResourceQueryOptions
): Promise<PromptSearchResult[]> {
  const limit = Math.min(opts.limit ?? 10, 20);
  try {
    const { getDb } = await import("../db");
    const { promptLibrary } = await import("../../drizzle/schema");
    const { eq, and, desc, like } = await import("drizzle-orm");

    const drizzleDb = await getDb();
    if (!drizzleDb) return [];

    const conditions = [eq(promptLibrary.userId, opts.userId)];

    if (opts.category && opts.category !== "all") {
      conditions.push(
        eq(
          promptLibrary.category,
          opts.category as
            | "general"
            | "image"
            | "video"
            | "audio"
            | "voice"
            | "story"
            | "system"
        )
      );
    }

    if (opts.query) {
      conditions.push(like(promptLibrary.title, `%${opts.query}%`));
    }

    const rows = await drizzleDb
      .select()
      .from(promptLibrary)
      .where(and(...conditions))
      .orderBy(desc(promptLibrary.updatedAt))
      .limit(limit);

    return rows.map((p) => ({
      id: Number(p.id),
      title: String(p.title ?? ""),
      category: String(p.category ?? ""),
      content: String(p.content ?? "").slice(0, 200), // 截斷避免 prompt 爆量
      mode: p.generationMode ? String(p.generationMode) : undefined,
      tags: p.tags ? (JSON.parse(String(p.tags)) as string[]) : undefined,
      usageCount:
        typeof p.useCount === "number" ? p.useCount : undefined,
      isFavorite:
        typeof p.isFavorite === "boolean" ? p.isFavorite : undefined,
    }));
  } catch (err) {
    console.error("[orbResourceBridge] searchPrompts failed:", err);
    return [];
  }
}

/**
 * 列出已訓練模型。
 * 使用 db.ts 中的 getFineTunedModelsByUser。
 */
export async function listModels(
  opts: ResourceQueryOptions
): Promise<ModelListResult[]> {
  const limit = Math.min(opts.limit ?? 10, 20);
  try {
    const db = await import("../db");
    let results = await db.getFineTunedModelsByUser(opts.userId);

    // 關鍵字搜尋
    if (opts.query) {
      const q = opts.query.toLowerCase();
      results = results.filter(
        (m: Record<string, unknown>) =>
          String(m.name ?? "")
            .toLowerCase()
            .includes(q) ||
          String(m.triggerWord ?? "")
            .toLowerCase()
            .includes(q)
      );
    }

    return results.slice(0, limit).map((m: Record<string, unknown>) => ({
      id: Number(m.id),
      name: String(m.name ?? ""),
      modelType: String(m.modelType ?? ""),
      status: String(m.status ?? ""),
      triggerWord: m.triggerWord ? String(m.triggerWord) : undefined,
      baseModel: m.baseModel ? String(m.baseModel) : undefined,
      createdAt: m.createdAt ? String(m.createdAt) : undefined,
    }));
  } catch (err) {
    console.error("[orbResourceBridge] listModels failed:", err);
    return [];
  }
}

/**
 * 搜尋一致性保險庫。
 * 使用 db.ts 中的 getVaultItemsByUser。
 */
export async function searchVault(
  opts: ResourceQueryOptions
): Promise<VaultSearchResult[]> {
  const limit = Math.min(opts.limit ?? 10, 20);
  try {
    const db = await import("../db");
    let results = await db.getVaultItemsByUser(opts.userId);

    // 關鍵字搜尋
    if (opts.query) {
      const q = opts.query.toLowerCase();
      results = results.filter(
        (v: Record<string, unknown>) =>
          String(v.name ?? "")
            .toLowerCase()
            .includes(q) ||
          String(v.description ?? "")
            .toLowerCase()
            .includes(q)
      );
    }

    return results.slice(0, limit).map((v: Record<string, unknown>) => ({
      id: Number(v.id),
      name: String(v.name ?? ""),
      vaultType: String(v.vaultType ?? ""),
      description: v.description ? String(v.description) : undefined,
      referenceUrl: v.referenceUrl ? String(v.referenceUrl) : undefined,
      createdAt: v.createdAt ? String(v.createdAt) : undefined,
    }));
  } catch (err) {
    console.error("[orbResourceBridge] searchVault failed:", err);
    return [];
  }
}

/**
 * 取得資源中心總覽摘要。
 * 光球可用此函數快速了解使用者擁有的資源概況。
 */
export async function getResourceSummary(
  userId: number
): Promise<ResourceSummary> {
  try {
    const db = await import("../db");

    // 提示詞需要用 Drizzle 查詢
    let promptCount = 0;
    const promptsByCategory: Record<string, number> = {};
    try {
      const { getDb } = db;
      const { promptLibrary } = await import("../../drizzle/schema");
      const { eq, sql } = await import("drizzle-orm");
      const drizzleDb = await getDb();
      if (drizzleDb) {
        const countResult = await drizzleDb
          .select({ count: sql<number>`COUNT(*)` })
          .from(promptLibrary)
          .where(eq(promptLibrary.userId, userId));
        promptCount = Number(countResult[0]?.count ?? 0);

        const catResult = await drizzleDb
          .select({
            category: promptLibrary.category,
            count: sql<number>`COUNT(*)`,
          })
          .from(promptLibrary)
          .where(eq(promptLibrary.userId, userId))
          .groupBy(promptLibrary.category);
        for (const r of catResult) {
          promptsByCategory[String(r.category)] = Number(r.count);
        }
      }
    } catch {
      // 提示詞查詢失敗不影響其他
    }

    const [assets, models, vaultItems] = await Promise.all([
      db.getDigitalAssetsByUser(userId).catch(() => []),
      db.getFineTunedModelsByUser(userId).catch(() => []),
      db.getVaultItemsByUser(userId).catch(() => []),
    ]);

    const assetsByType: Record<string, number> = {};
    for (const a of assets) {
      const t = String((a as Record<string, unknown>).assetType ?? "other");
      assetsByType[t] = (assetsByType[t] ?? 0) + 1;
    }

    const modelsByStatus: Record<string, number> = {};
    for (const m of models) {
      const s = String((m as Record<string, unknown>).status ?? "unknown");
      modelsByStatus[s] = (modelsByStatus[s] ?? 0) + 1;
    }

    return {
      totalAssets: assets.length,
      assetsByType,
      totalPrompts: promptCount,
      promptsByCategory,
      totalModels: models.length,
      modelsByStatus,
      totalVaultItems: vaultItems.length,
    };
  } catch (err) {
    console.error("[orbResourceBridge] getResourceSummary failed:", err);
    return {
      totalAssets: 0,
      assetsByType: {},
      totalPrompts: 0,
      promptsByCategory: {},
      totalModels: 0,
      modelsByStatus: {},
      totalVaultItems: 0,
    };
  }
}

/**
 * 格式化資源摘要為光球可讀的文字區塊。
 * 用於注入到系統提示詞中，讓光球了解使用者的資源概況。
 */
export function formatResourceSummaryForOrb(
  summary: ResourceSummary
): string {
  const lines: string[] = [];
  lines.push("【使用者資源中心概況】");

  if (summary.totalAssets > 0) {
    const typeBreakdown = Object.entries(summary.assetsByType)
      .map(([t, c]) => `${t}:${c}`)
      .join("、");
    lines.push(
      `數位資產庫：共 ${summary.totalAssets} 項（${typeBreakdown}）`
    );
  } else {
    lines.push("數位資產庫：尚無資產");
  }

  if (summary.totalPrompts > 0) {
    const catBreakdown = Object.entries(summary.promptsByCategory)
      .map(([c, n]) => `${c}:${n}`)
      .join("、");
    lines.push(
      `提示詞庫：共 ${summary.totalPrompts} 則（${catBreakdown}）`
    );
  } else {
    lines.push("提示詞庫：尚無提示詞");
  }

  if (summary.totalModels > 0) {
    const statusBreakdown = Object.entries(summary.modelsByStatus)
      .map(([s, n]) => `${s}:${n}`)
      .join("、");
    lines.push(
      `已訓練模型：共 ${summary.totalModels} 個（${statusBreakdown}）`
    );
  } else {
    lines.push("已訓練模型：尚無自訂模型");
  }

  if (summary.totalVaultItems > 0) {
    lines.push(`一致性保險庫：共 ${summary.totalVaultItems} 項`);
  } else {
    lines.push("一致性保險庫：尚無項目");
  }

  return lines.join("\n");
}
