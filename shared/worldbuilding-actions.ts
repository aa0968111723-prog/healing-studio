import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

export type WorldbuildingReadinessFlags = {
  readyForImageGeneration: boolean;
  readyForVideoGeneration: boolean;
  readyForAudioGeneration: boolean;
  readyForFullProduction: boolean;
};

export type WorldbuildingActionPlan = {
  primaryAction: WorldbuildingAction;
  actions: WorldbuildingAction[];
  blockers: WorldbuildingBlocker[];
  readyForGeneration: boolean;
  readinessFlags: WorldbuildingReadinessFlags;
  generationState: "drafting" | "storyboard_ready" | "asset_ready" | "generation_ready";
};

export type WorldbuildingAction = {
  id: string; label: string; description: string; priority: "high" | "medium" | "low";
  category: "story" | "characters" | "scenes" | "visualStyle" | "audio" | "storyboard" | "export";
  cta: string; targetTab?: string; targetSection?: string; targetEntityId?: string; targetField?: string;
};
export type WorldbuildingBlocker = { id: string; label: string; reason: string; category: WorldbuildingAction["category"]; severity: "warning" | "blocking" };
const hasText = (v?: string | null) => !!v?.trim();

export function getWorldbuildingActionPlan(world: WorldbuildingFrameworkData | null | undefined, options?: { storyboardsCount?: number; visualAssetsCount?: number }): WorldbuildingActionPlan {
  const characters = world?.characters ?? []; const scenes = world?.scenes ?? []; const styleProfiles = world?.styleProfiles ?? [];
  const hasStoryboard = (options?.storyboardsCount ?? 0) > 0; const hasVisualAssets = (options?.visualAssetsCount ?? 0) > 0;
  const hasVoice = characters.some(c => hasText(c.voiceProfile?.voiceId) || hasText(c.voiceProfile?.emotion) || hasText(c.voiceProfile?.languageCode));
  const hasMusic = (world?.musicThemes?.length ?? 0) > 0;
  const hasDialogue = hasStoryboard; // 以有分鏡視為進入台詞/敘事階段
  const missingCharacter = characters.find(c => !hasText(c.appearance) || !c.threeViewSheet?.frontImageUrl);
  const missingScene = scenes.find(s => !hasText(s.environment) || !hasText(s.mood) || !hasText(s.lighting));

  const blockers: WorldbuildingBlocker[] = []; const actions: WorldbuildingAction[] = [];
  const push = (a: WorldbuildingAction, b?: WorldbuildingBlocker) => { actions.push(a); if (b) blockers.push(b); };

  if (characters.length === 0) push({ id:"create-main-character",label:"建立主角",description:"先建立最核心角色。",priority:"high",category:"characters",cta:"補角色",targetTab:"characters" },{ id:"missing-characters",label:"缺少角色",reason:"尚未建立角色。",category:"characters",severity:"blocking"});
  else if (missingCharacter) push({ id:"character-visual-consistency",label:"補角色視覺一致性",description:"補齊角色素材。",priority:"high",category:"characters",cta:"補角色素材",targetTab:"characters",targetEntityId:missingCharacter.id,targetField:"threeView" },{ id:"missing-character-visuals",label:"角色素材不足",reason:"角色外觀不足。",category:"characters",severity:"blocking"});
  else if (scenes.length === 0) push({ id:"create-main-scene",label:"建立主要場景",description:"建立場景。",priority:"high",category:"scenes",cta:"補場景",targetTab:"scenes" },{ id:"missing-scenes",label:"缺少場景",reason:"尚未建立場景卡。",category:"scenes",severity:"blocking"});
  else if (missingScene) push({ id:"refine-scene-atmosphere",label:"補場景氛圍",description:"補齊 environment/mood/lighting。",priority:"high",category:"scenes",cta:"補場景氛圍",targetTab:"scenes",targetEntityId:missingScene.id,targetField:"environment" },{ id:"missing-scene-atmosphere",label:"場景氛圍不足",reason:"場景氛圍不足。",category:"scenes",severity:"warning"});

  const readyForImageGeneration = characters.length > 0 && scenes.length > 0 && styleProfiles.length > 0 && (!missingCharacter || hasVisualAssets);
  const readyForVideoGeneration = readyForImageGeneration && hasStoryboard && scenes.some(s => hasText(s.environment) || hasText(s.tagline));
  const readyForAudioGeneration = (hasVoice || hasMusic) && (!hasDialogue || hasVoice);
  if (hasStoryboard && (!hasVisualAssets || !readyForAudioGeneration)) blockers.push({ id:"missing-assets",label:"素材不足",reason:"已有分鏡但視覺或聲音素材不足。",category:"audio",severity:"warning" });

  const hasBlockingBlocker = blockers.some(b => b.severity === "blocking");
  const readyForFullProduction = readyForVideoGeneration && readyForAudioGeneration && !hasBlockingBlocker;
  const generationState: WorldbuildingActionPlan["generationState"] = (characters.length === 0 || scenes.length === 0 || styleProfiles.length === 0) ? "drafting" : (!hasStoryboard ? "storyboard_ready" : (readyForImageGeneration && readyForAudioGeneration && hasVisualAssets ? "generation_ready" : "asset_ready"));
  const readyForGeneration = generationState === "generation_ready";

  if (actions.length === 0) actions.push({ id:"export-production-package",label:"產生完整製作包",description:"輸出生成資料。",priority:"high",category:"export",cta:"產生完整製作包",targetTab:"production" });

  return { primaryAction: actions[0], actions, blockers, readyForGeneration, readinessFlags: { readyForImageGeneration, readyForVideoGeneration, readyForAudioGeneration, readyForFullProduction }, generationState };
}
