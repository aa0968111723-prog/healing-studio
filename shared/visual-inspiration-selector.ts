import type { VisualInspirationItem, VisualInspirationLibrary } from "./worldbuilding-inspiration";

export function selectInspirationsForGenerationTask(args: { taskType: "character_image" | "scene_image" | "shot_image" | "shot_video"; library: VisualInspirationLibrary; characterIds?: string[]; sceneIds?: string[]; styleProfileIds?: string[]; tags?: string[]; limit?: number; }): VisualInspirationItem[] {
  const { library, characterIds = [], sceneIds = [], styleProfileIds = [], tags = [], limit = 4, taskType } = args;
  const kindPref = taskType === "character_image" ? "character" : taskType === "scene_image" ? "scene" : "shot";
  return [...library.items].sort((a, b) => {
    const entity = (i: VisualInspirationItem) => (i.linkedCharacterIds?.some(id => characterIds.includes(id)) ? 1 : 0) + (i.linkedSceneIds?.some(id => sceneIds.includes(id)) ? 1 : 0) + (i.linkedStyleProfileIds?.some(id => styleProfileIds.includes(id)) ? 1 : 0);
    const score = (i: VisualInspirationItem) => entity(i) * 100 + (i.kind === kindPref ? 30 : 0) + (library.pinnedItemIds?.includes(i.id) ? 20 : 0) + ((i.qualityScore ?? 0) + (i.consistencyScore ?? 0)) + i.tags.filter(t => tags.includes(t)).length * 5 + new Date(i.updatedAt || i.createdAt).getTime() / 1e12;
    return score(b) - score(a);
  }).slice(0, limit);
}

export function evaluateVisualConsistencyHints(args: { taskPrompt: string; selectedInspirations: VisualInspirationItem[]; }) {
  const { taskPrompt, selectedInspirations } = args;
  const warnings: string[] = [];
  if (taskPrompt.includes("角色") && !selectedInspirations.some(i => i.kind === "character")) warnings.push("角色任務缺少角色參考圖");
  if (taskPrompt.includes("場景") && !selectedInspirations.some(i => i.kind === "scene" || i.kind === "shot")) warnings.push("場景任務缺少場景參考圖");
  const styles = new Set(selectedInspirations.map(i => i.artStyle).filter(Boolean));
  if (styles.size > 1) warnings.push("風格可能分裂：參考圖含多種 artStyle");
  if (styles.size > 0 && ![...styles].some(s => taskPrompt.includes(String(s)))) warnings.push("prompt 與參考風格描述重疊不足");
  const promptAdditions = selectedInspirations.flatMap(i => [i.mood && `情緒：${i.mood}`, i.lighting && `光線：${i.lighting}`, i.artStyle && `風格：${i.artStyle}`, i.composition && `構圖：${i.composition}`].filter(Boolean) as string[]);
  const negativePromptAdditions = selectedInspirations.flatMap(i => i.negativePromptHints ?? []);
  const score = Math.max(0, 100 - warnings.length * 20);
  return { score, warnings, promptAdditions, negativePromptAdditions };
}
