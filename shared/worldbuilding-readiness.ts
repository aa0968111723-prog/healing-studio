import { calculateWorldbuildingProgress } from "./worldbuilding-progress";
import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

export type WorldbuildingReadiness = {
  worldCompletionPercent: number;
  visualAssetPercent: number;
  generationReadinessPercent: number;
  visualAssetsCount: number;
  missingVisualAssets: string[];
  missingGenerationItems: string[];
};

const hasText = (v?: string | null) => !!v?.trim();

export function calculateWorldbuildingReadiness(
  world: WorldbuildingFrameworkData | null | undefined,
  options?: { storyboardsCount?: number }
): WorldbuildingReadiness {
  const w = world ?? null;
  const progress = calculateWorldbuildingProgress(w);
  const storyboardsCount = options?.storyboardsCount ?? 0;

  const characters = w?.characters ?? [];
  const scenes = w?.scenes ?? [];
  const styleProfiles = w?.styleProfiles ?? [];

  const hasCharacters = characters.length > 0;
  const hasScenes = scenes.length > 0;
  const hasStyle = styleProfiles.length > 0;
  const hasVoice = characters.some(c => hasText(c.voiceProfile?.voiceId) || hasText(c.voiceProfile?.emotion) || hasText(c.voiceProfile?.languageCode));
  const hasMusic = (w?.musicThemes?.length ?? 0) > 0;
  const hasStoryboard = storyboardsCount > 0;

  const visualChecks = [
    { key: "角色三視圖", ok: characters.some(c => !!c.threeViewSheet?.frontImageUrl || !!c.threeViewSheet?.sideImageUrl || !!c.threeViewSheet?.backImageUrl) },
    { key: "角色參考圖", ok: characters.some(c => (c.realWorldRefs?.some(r => (r.imageUrls?.length ?? 0) > 0) ?? false)) },
    { key: "表情圖", ok: characters.some(c => c.expressions?.some(e => typeof e === "object" && !!e.imageUrl)) },
    { key: "穿衣圖", ok: characters.some(c => c.outfits?.some(o => !!o.imageUrl)) },
    { key: "場景參考圖", ok: scenes.some(s => (s.realWorldRefs?.some(r => (r.imageUrls?.length ?? 0) > 0) ?? false)) },
    { key: "上傳圖片", ok: (w?.uploadedAssets?.some(a => a.assetType === "image" && !!a.url) ?? false) },
  ];

  const visualAssetSignals = visualChecks.filter(v => v.ok).length;
  const visualAssetPercent = visualAssetSignals === 0 ? 0 : Math.round((visualAssetSignals / visualChecks.length) * 100);
  const missingVisualAssets = visualChecks.filter(v => !v.ok).map(v => v.key);

  const visualAssetsCount = [
    ...characters.flatMap(c => [c.threeViewSheet?.frontImageUrl, c.threeViewSheet?.sideImageUrl, c.threeViewSheet?.backImageUrl].filter(Boolean)),
    ...characters.flatMap(c => c.realWorldRefs?.flatMap(r => r.imageUrls ?? []) ?? []),
    ...characters.flatMap(c => c.expressions?.map(e => (typeof e === "object" ? e.imageUrl : undefined)).filter(Boolean) ?? []),
    ...characters.flatMap(c => c.outfits?.map(o => o.imageUrl).filter(Boolean) ?? []),
    ...scenes.flatMap(s => s.realWorldRefs?.flatMap(r => r.imageUrls ?? []) ?? []),
    ...(w?.uploadedAssets?.filter(a => a.assetType === "image" && !!a.url).map(a => a.url) ?? []),
  ].length;

  const missingGenerationItems: string[] = [];
  if (!hasCharacters) missingGenerationItems.push("缺少角色");
  if (!hasScenes) missingGenerationItems.push("缺少場景");
  if (!hasStyle) missingGenerationItems.push("缺少風格");
  if (!hasVoice) missingGenerationItems.push("缺少配音方向");
  if (!hasMusic) missingGenerationItems.push("缺少配樂方向");
  if (!hasStoryboard) missingGenerationItems.push("缺少分鏡");
  if (visualAssetPercent < 50) missingGenerationItems.push("視覺素材不足");

  const generationReadinessPercent = Math.round(
    (hasCharacters ? 20 : 0) +
      (hasScenes ? 20 : 0) +
      (hasStyle ? 15 : 0) +
      ((hasVoice && hasMusic) ? 15 : 0) +
      (hasStoryboard ? 20 : 0) +
      Math.min(10, Math.round(visualAssetPercent / 10))
  );

  return {
    worldCompletionPercent: progress.overall,
    visualAssetPercent,
    generationReadinessPercent,
    visualAssetsCount,
    missingVisualAssets,
    missingGenerationItems,
  };
}
