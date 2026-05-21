import { calculateWorldbuildingProgress } from "./worldbuilding-progress";
import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

export type VisualAssetCoverage = {
  characterCoverage: Array<{ id: string; name: string; percent: number; missing: string[] }>;
  sceneCoverage: Array<{ id: string; name: string; percent: number; missing: string[] }>;
};

export type WorldbuildingReadiness = {
  worldCompletionPercent: number;
  visualAssetPercent: number;
  generationReadinessPercent: number;
  visualAssetsCount: number;
  missingVisualAssets: string[];
  missingGenerationItems: string[];
  visualCoverage: VisualAssetCoverage;
};
const hasText = (v?: string | null) => !!v?.trim();
const pct = (ok: number, total: number) => Math.round((ok / Math.max(total, 1)) * 100);

export function calculateWorldbuildingReadiness(world: WorldbuildingFrameworkData | null | undefined, options?: { storyboardsCount?: number }): WorldbuildingReadiness {
  const w = world ?? null; const progress = calculateWorldbuildingProgress(w); const storyboardsCount = options?.storyboardsCount ?? 0;
  const characters = w?.characters ?? []; const scenes = w?.scenes ?? []; const hasVoice = characters.some(c => hasText(c.voiceProfile?.voiceId) || hasText(c.voiceProfile?.emotion));
  const hasMusic = (w?.musicThemes?.length ?? 0) > 0;

  const characterCoverage = characters.map(c => {
    const checks = [
      ["外觀描述", hasText(c.appearance)], ["三視圖", !!c.threeViewSheet?.frontImageUrl || !!c.threeViewSheet?.sideImageUrl || !!c.threeViewSheet?.backImageUrl],
      ["角色參考圖", c.realWorldRefs?.some(r => (r.imageUrls?.length ?? 0) > 0) ?? false], ["表情圖", c.expressions?.some(e => typeof e === "object" && !!e.imageUrl) ?? false],
      ["穿衣圖", c.outfits?.some(o => !!o.imageUrl) ?? false], ["voiceProfile", hasText(c.voiceProfile?.voiceId) || hasText(c.voiceProfile?.emotion) || hasText(c.voiceProfile?.languageCode)],
    ] as const;
    const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
    return { id: c.id, name: c.name || "未命名角色", percent: pct(checks.length - missing.length, checks.length), missing };
  });

  const sceneCoverage = scenes.map(s => {
    const checks = [["environment/tagline", hasText(s.environment) || hasText(s.tagline)], ["mood", hasText(s.mood)], ["lighting", hasText(s.lighting)], ["參考圖", s.realWorldRefs?.some(r => (r.imageUrls?.length ?? 0) > 0) ?? false], ["establishingShotUrl", !!s.establishingShotUrl], ["soundDesign", !!s.soundDesign]] as const;
    const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
    return { id: s.id, name: s.name || "未命名場景", percent: pct(checks.length - missing.length, checks.length), missing };
  });

  const allPercent = [...characterCoverage.map(x => x.percent), ...sceneCoverage.map(x => x.percent)];
  const visualAssetPercent = allPercent.length ? Math.round(allPercent.reduce((a, b) => a + b, 0) / allPercent.length) : 0;
  const missingVisualAssets = [...characterCoverage.flatMap(c => c.missing.map(m => `${c.name} 缺${m}`)), ...sceneCoverage.flatMap(s => s.missing.map(m => `${s.name} 缺${m}`))].slice(0, 12);

  const missingGenerationItems: string[] = [];
  if (characters.length === 0) missingGenerationItems.push("缺少角色"); if (scenes.length === 0) missingGenerationItems.push("缺少場景");
  if ((w?.styleProfiles?.length ?? 0) === 0) missingGenerationItems.push("缺少風格"); if (!hasVoice) missingGenerationItems.push("缺少配音方向"); if (!hasMusic) missingGenerationItems.push("缺少配樂方向"); if (storyboardsCount === 0) missingGenerationItems.push("缺少分鏡");

  return { worldCompletionPercent: progress.overall, visualAssetPercent, generationReadinessPercent: Math.max(0, 100 - missingGenerationItems.length * 12), visualAssetsCount: Math.round((visualAssetPercent / 100) * Math.max(1, allPercent.length)), missingVisualAssets, missingGenerationItems, visualCoverage: { characterCoverage, sceneCoverage } };
}
