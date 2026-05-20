/**
 * Real Earth Data Seeder
 *
 * 用於初始化真實地球資訊系統的資料
 */

import * as db from "../db";
import { SEED_DATA } from "../data/realEarthSeedData";
import type { RealEarthEntryInput } from "../../shared/real-earth-types";

/**
 * 檢查系統是否已有種子資料
 */
export async function hasExistingSeedData(): Promise<boolean> {
  try {
    const stats = await db.getRealEarthStats();
    return stats.total > 0;
  } catch (error) {
    console.error("Error checking seed data:", error);
    return false;
  }
}

/**
 * 種子資料初始化
 * @param userId - 建立者 ID（可選，預設為系統資料 null）
 */
export async function seedRealEarthData(userId?: number): Promise<{
  success: boolean;
  created: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let created = 0;

  console.log(`[RealEarthSeeder] Starting seed with ${SEED_DATA.length} entries...`);

  for (const entry of SEED_DATA) {
    try {
      const id = await db.createRealEarthEntry({
        title: entry.title,
        category: entry.category,
        summary: entry.summary,
        content: entry.content,
        locationJson: entry.location ?? null,
        historicalPeriod: entry.historicalPeriod ?? null,
        yearRangeJson: entry.yearRange ?? null,
        imageUrls: entry.imageUrls ?? null,
        externalLinksJson: entry.externalLinks ?? null,
        citationsJson: entry.citations ?? null,
        tags: entry.tags ?? null,
        relatedEntryIds: entry.relatedEntryIds ?? null,
        qualityJson: entry.quality ?? null,
        isTaiwanFocused: entry.isTaiwanFocused ?? false,
        language: entry.language ?? "zh-TW",
        metadata: entry.metadata ?? null,
        createdBy: userId ?? null,
      });
      created++;
      console.log(`[RealEarthSeeder] Created entry: ${entry.title} (ID: ${id})`);
    } catch (error) {
      const errorMsg = `Failed to create ${entry.title}: ${(error as Error).message}`;
      errors.push(errorMsg);
      console.error(`[RealEarthSeeder] ${errorMsg}`);
    }
  }

  const success = created > 0 && errors.length === 0;
  console.log(`[RealEarthSeeder] Complete. Created: ${created}, Errors: ${errors.length}`);

  return { success, created, errors };
}

/**
 * 自動種子資料（僅在資料庫為空時執行）
 */
export async function autoSeedIfEmpty(): Promise<void> {
  try {
    const hasData = await hasExistingSeedData();
    if (!hasData) {
      console.log("[RealEarthSeeder] Database is empty, auto-seeding...");
      const result = await seedRealEarthData();
      if (result.success) {
        console.log(`[RealEarthSeeder] Auto-seed successful: ${result.created} entries created`);
      } else {
        console.error(`[RealEarthSeeder] Auto-seed completed with errors:`, result.errors);
      }
    } else {
      console.log("[RealEarthSeeder] Seed data already exists, skipping auto-seed");
    }
  } catch (error) {
    console.error("[RealEarthSeeder] Auto-seed failed:", error);
  }
}
