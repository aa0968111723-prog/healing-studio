import type { WorldbuildingGenerationTask, WorldbuildingGenerationTaskType } from "./worldbuilding-generation-tasks";

export type WorldbuildingGeneratedAssetMapping = { taskId: string; taskType: WorldbuildingGenerationTaskType; targetEntityType: "character" | "scene" | "storyboardScene" | "world" | "assetLibrary"; targetEntityId?: string; assetUrl: string; assetKind: "image" | "video" | "audio" | "text"; suggestedField: "character.referenceLibrary" | "character.threeViewSheet" | "scene.realWorldRefs" | "scene.establishingShotUrl" | "storyboard.frames" | "storyboard.audioClips" | "world.uploadedAssets"; };

export function mapGenerationResultToWorldbuildingPatch(task: WorldbuildingGenerationTask, result: { resultUrls?: string[] }): WorldbuildingGeneratedAssetMapping[] {
  const urls = result.resultUrls ?? [];
  return urls.map(url => ({
    taskId: task.id,
    taskType: task.type,
    targetEntityType: task.type === "character_image" ? "character" : task.type === "scene_image" ? "scene" : task.type === "publishing" ? "world" : "storyboardScene",
    targetEntityId: task.sourceEntityId ?? task.sourceShotId,
    assetUrl: url,
    assetKind: task.type.includes("video") ? "video" : (task.type === "voice" || task.type === "music" || task.type === "sound") ? "audio" : task.type === "publishing" ? "text" : "image",
    suggestedField: task.type === "character_image" ? "character.referenceLibrary" : task.type === "scene_image" ? "scene.establishingShotUrl" : (task.type === "voice" || task.type === "music" || task.type === "sound") ? "storyboard.audioClips" : task.type === "publishing" ? "world.uploadedAssets" : "storyboard.frames",
  }));
}
