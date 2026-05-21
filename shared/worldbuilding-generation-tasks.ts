import type { WorldbuildingFrameworkData } from "./worldbuilding-types";
import type { WorldStoryboard } from "./worldbuilding-animation";
import type { WorldbuildingProductionPackage } from "./worldbuilding-production-package";
import { pickDefaultModelForTask, type ModelTaskKind } from "./model-capability-registry";

export type WorldbuildingGenerationTaskType = "character_image" | "scene_image" | "shot_image" | "shot_video" | "voice" | "music" | "sound" | "publishing";
export type WorldbuildingGenerationTaskExecutionMode = "internal_model" | "page_agent" | "manual" | "dry_run";
export type WorldbuildingGenerationTask = { id: string; type: WorldbuildingGenerationTaskType; title: string; description?: string; prompt?: string; negativePrompt?: string; sourceWorldId?: string | number; sourceEntityId?: string; sourceStoryboardId?: string | number; sourceShotId?: string; targetModelId?: string; recommendedModels: string[]; executionMode: WorldbuildingGenerationTaskExecutionMode; status: "draft" | "ready" | "blocked"; blockers: string[]; estimatedCostLevel?: "low" | "medium" | "high"; requiresConfirmation: boolean; payload: Record<string, unknown>; };

const mapKind = (type: WorldbuildingGenerationTaskType): ModelTaskKind => type === "publishing" ? "publishing_copy" : type;
const uid = (prefix: string, id: string) => `${prefix}-${id || Math.random().toString(36).slice(2, 8)}`;
const readyState = (prompt: string | undefined, blockers: string[]) => ({ status: blockers.length || !prompt?.trim() ? "blocked" as const : "ready" as const });

export function buildWorldbuildingGenerationTasks(args: { world: WorldbuildingFrameworkData; productionPackage: WorldbuildingProductionPackage; storyboards?: WorldStoryboard[]; mode?: WorldbuildingGenerationTaskExecutionMode; }): WorldbuildingGenerationTask[] {
  const { world, productionPackage, storyboards = [], mode = "dry_run" } = args;
  const tasks: WorldbuildingGenerationTask[] = [];
  for (const c of world.characters ?? []) {
    const blockers = []; if (!c.appearance?.trim()) blockers.push("缺角色外觀描述");
    const model = pickDefaultModelForTask("character_image"); if (!model) blockers.push("尚未設定可用模型");
    const prompt = c.appearance?.trim() || undefined;
    tasks.push({ id: uid("char", c.id), type: "character_image", title: `角色圖：${c.name || "未命名"}`, prompt, sourceWorldId: world.id, sourceEntityId: c.id, targetModelId: model?.id, recommendedModels: model ? [model.id] : [], executionMode: mode, blockers, ...readyState(prompt, blockers), estimatedCostLevel: model?.costLevel, requiresConfirmation: true, payload: { characterId: c.id, worldId: world.id, name: c.name } });
  }
  for (const s of world.scenes ?? []) {
    const prompt = s.environment || s.tagline || "";
    const blockers = []; if (!s.mood?.trim()) blockers.push("缺場景氛圍");
    const model = pickDefaultModelForTask("scene_image"); if (!model) blockers.push("尚未設定可用模型");
    tasks.push({ id: uid("scene", s.id), type: "scene_image", title: `場景圖：${s.name || "未命名"}`, prompt, sourceWorldId: world.id, sourceEntityId: s.id, targetModelId: model?.id, recommendedModels: model ? [model.id] : [], executionMode: mode, blockers, ...readyState(prompt, blockers), estimatedCostLevel: model?.costLevel, requiresConfirmation: true, payload: { sceneId: s.id, worldId: world.id } });
  }
  for (const sb of storyboards) for (const sc of sb.scenes ?? []) for (const fr of sc.frames ?? []) {
    const blockers = []; if (!sc.actionDescription?.trim() && !fr.shotDescription?.trim()) blockers.push("缺場景氛圍");
    const imgModel = pickDefaultModelForTask("shot_image"); if (!imgModel) blockers.push("尚未設定可用模型");
    const prompt = fr.prompt || fr.shotDescription || sc.actionDescription;
    tasks.push({ id: uid("shot-image", fr.id), type: "shot_image", title: `逐鏡圖像：${sc.title || fr.id}`, prompt, sourceWorldId: world.id, sourceStoryboardId: sb.id, sourceShotId: fr.id, targetModelId: imgModel?.id, recommendedModels: imgModel ? [imgModel.id] : [], executionMode: mode, blockers, ...readyState(prompt, blockers), estimatedCostLevel: imgModel?.costLevel, requiresConfirmation: true, payload: { storyboardId: sb.id, sceneId: sc.id, frameId: fr.id } });
    const vidBlockers = [...blockers]; const vidModel = pickDefaultModelForTask("shot_video"); if (!vidModel) vidBlockers.push("尚未設定可用模型");
    tasks.push({ id: uid("shot-video", fr.id), type: "shot_video", title: `逐鏡影片：${sc.title || fr.id}`, prompt, sourceWorldId: world.id, sourceStoryboardId: sb.id, sourceShotId: fr.id, targetModelId: vidModel?.id, recommendedModels: vidModel ? [vidModel.id] : [], executionMode: mode, blockers: vidBlockers, ...readyState(prompt, vidBlockers), estimatedCostLevel: vidModel?.costLevel, requiresConfirmation: true, payload: { storyboardId: sb.id, sceneId: sc.id, frameId: fr.id } });
  }
  for (const v of productionPackage.json.voiceDirections ?? []) tasks.push({ id: uid("voice", v), type: "voice", title: "配音任務", prompt: v, sourceWorldId: world.id, recommendedModels: pickDefaultModelForTask("voice")?.id ? [pickDefaultModelForTask("voice")!.id] : [], targetModelId: pickDefaultModelForTask("voice")?.id, executionMode: mode, status: v ? "ready" : "blocked", blockers: v ? [] : ["缺對白"], estimatedCostLevel: pickDefaultModelForTask("voice")?.costLevel, requiresConfirmation: true, payload: { worldId: world.id } });
  for (const m of productionPackage.json.musicPromptSeeds ?? []) tasks.push({ id: uid("music", m), type: "music", title: "配樂任務", prompt: m, sourceWorldId: world.id, recommendedModels: pickDefaultModelForTask("music")?.id ? [pickDefaultModelForTask("music")!.id] : [], targetModelId: pickDefaultModelForTask("music")?.id, executionMode: mode, status: m ? "ready" : "blocked", blockers: m ? [] : ["缺配樂描述"], estimatedCostLevel: pickDefaultModelForTask("music")?.costLevel, requiresConfirmation: true, payload: { worldId: world.id } });
  const pub = `YouTube: ${productionPackage.title}`;
  tasks.push({ id: "publishing-1", type: "publishing", title: "發布文案", prompt: pub, sourceWorldId: world.id, recommendedModels: pickDefaultModelForTask("publishing_copy")?.id ? [pickDefaultModelForTask("publishing_copy")!.id] : [], targetModelId: pickDefaultModelForTask("publishing_copy")?.id, executionMode: mode, status: "ready", blockers: [], estimatedCostLevel: pickDefaultModelForTask("publishing_copy")?.costLevel, requiresConfirmation: true, payload: { worldId: world.id } });
  return tasks;
}
