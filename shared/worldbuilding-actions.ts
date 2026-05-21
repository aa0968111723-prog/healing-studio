import { calculateWorldbuildingProgress } from "./worldbuilding-progress";
import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

export type WorldbuildingActionPlan = {
  primaryAction: WorldbuildingAction;
  actions: WorldbuildingAction[];
  blockers: WorldbuildingBlocker[];
  readyForGeneration: boolean;
  generationState: "drafting" | "storyboard_ready" | "asset_ready" | "generation_ready";
};

export type WorldbuildingAction = {
  id: string;
  label: string;
  description: string;
  priority: "high" | "medium" | "low";
  category: "story" | "characters" | "scenes" | "visualStyle" | "audio" | "storyboard" | "export";
  cta: string;
  targetTab?: string;
  targetSection?: string;
};

export type WorldbuildingBlocker = {
  id: string;
  label: string;
  reason: string;
  category: WorldbuildingAction["category"];
  severity: "warning" | "blocking";
};

const hasText = (v?: string | null) => !!v?.trim();

export function getWorldbuildingActionPlan(
  world: WorldbuildingFrameworkData | null | undefined,
  options?: { storyboardsCount?: number; visualAssetsCount?: number }
): WorldbuildingActionPlan {
  const progress = calculateWorldbuildingProgress(world ?? null);
  const characters = world?.characters ?? [];
  const scenes = world?.scenes ?? [];
  const styleProfiles = world?.styleProfiles ?? [];
  const hasVoice = characters.some(c => hasText(c.voiceProfile?.voiceId) || hasText(c.voiceProfile?.emotion) || hasText(c.voiceProfile?.languageCode));
  const hasMusic = (world?.musicThemes?.length ?? 0) > 0;
  const hasStoryboard = (options?.storyboardsCount ?? 0) > 0;
  const hasVisualAssets = (options?.visualAssetsCount ?? 0) > 0;

  const characterVisualMissing = characters.some(c =>
    !hasText(c.appearance) || (!c.threeViewSheet?.frontImageUrl && !c.threeViewSheet?.sideImageUrl) || (c.outfits?.length ?? 0) === 0 || (c.expressions?.length ?? 0) === 0
  );
  const sceneAtmosphereMissing = scenes.some(s => !hasText(s.environment) || !hasText(s.mood) || !hasText(s.lighting));

  const blockers: WorldbuildingBlocker[] = [];
  const actions: WorldbuildingAction[] = [];
  const push = (a: WorldbuildingAction, b?: WorldbuildingBlocker) => { actions.push(a); if (b) blockers.push(b); };

  if (characters.length === 0) {
    push({ id:"create-main-character", label:"建立主角", description:"先建立最核心角色，讓後續畫面與配音有主體。", priority:"high", category:"characters", cta:"補角色視覺", targetTab:"worldbuilding", targetSection:"characters" },
      { id:"missing-characters", label:"缺少角色", reason:"尚未建立角色，無法穩定生成人物。", category:"characters", severity:"blocking" });
  } else if (characterVisualMissing) {
    push({ id:"character-visual-consistency", label:"補角色視覺一致性", description:"補齊外觀、三視圖、穿衣與表情，避免每幕長相漂移。", priority:"high", category:"characters", cta:"補角色素材", targetTab:"worldbuilding", targetSection:"characters" },
      { id:"missing-character-visuals", label:"角色素材不足", reason:"角色外觀不足會讓影片每一幕長相不一致。", category:"characters", severity:"blocking" });
  } else if (scenes.length === 0) {
    push({ id:"create-main-scene", label:"建立主要場景", description:"先設定主要拍攝場景，幫 AI 鎖定畫面語境。", priority:"high", category:"scenes", cta:"補場景氛圍", targetTab:"worldbuilding", targetSection:"scenes" },
      { id:"missing-scenes", label:"缺少場景", reason:"尚未建立場景卡，無法穩定生成背景。", category:"scenes", severity:"blocking" });
  } else if (sceneAtmosphereMissing) {
    push({ id:"refine-scene-atmosphere", label:"補場景氛圍", description:"補齊 environment、mood、lighting，降低畫面風格跳動。", priority:"high", category:"scenes", cta:"補場景氛圍", targetTab:"worldbuilding", targetSection:"scenes" },
      { id:"missing-scene-atmosphere", label:"場景氛圍不足", reason:"場景氛圍不足會讓畫面風格跳動。", category:"scenes", severity:"warning" });
  } else if (styleProfiles.length === 0) {
    push({ id:"create-style-profile", label:"建立視覺風格", description:"加入色調與鏡頭語言，保持全片視覺一致。", priority:"high", category:"visualStyle", cta:"補風格設定", targetTab:"worldbuilding", targetSection:"style" },
      { id:"missing-style", label:"缺少視覺風格", reason:"沒有 style profile，難以維持畫面一致性。", category:"visualStyle", severity:"blocking" });
  } else if (!hasMusic || !hasVoice) {
    push({ id:"set-audio-direction", label:"補聲音方向", description:"補齊配樂與配音方向，避免情緒與口白失焦。", priority:"medium", category:"audio", cta:"補聲音設定", targetTab:"worldbuilding", targetSection:"audio" },
      { id:"missing-audio", label:"聲音方向不足", reason:"缺少 musicThemes 或 voiceProfile，會影響聲音一致性。", category:"audio", severity:"warning" });
  } else if (!hasStoryboard) {
    push({ id:"derive-storyboard", label:"從腳本派生分鏡", description:"把腳本切成可生成的分鏡與時間軸。", priority:"medium", category:"storyboard", cta:"進入分鏡規劃", targetTab:"storyboard" });
  } else {
    push({ id:"export-production-package", label:"產生完整製作包", description:"輸出可直接進入生圖、生影、生聲流程的製作包。", priority:"high", category:"export", cta:"產生完整製作包", targetTab:"export" });
  }

  if (actions[0]?.id !== "export-production-package") {
    actions.push({ id:"export-production-package", label:"產生完整製作包", description:"先預覽目前可輸出內容，邊做邊補。", priority:"low", category:"export", cta:"產生完整製作包", targetTab:"export" });
  }

  if (hasStoryboard && !hasVisualAssets) {
    blockers.push({ id:"missing-visual-assets", label:"缺少視覺素材", reason:"尚未蒐集可用視覺素材，角色與場景生成可能不一致。", category:"visualStyle", severity:"warning" });
  }

  const hasBlockingBlocker = blockers.some(b => b.severity === "blocking");
  const readyForGeneration = characters.length > 0 && scenes.length > 0 && styleProfiles.length > 0 && hasStoryboard && !hasBlockingBlocker;

  const generationState: WorldbuildingActionPlan["generationState"] = (() => {
    if (characters.length === 0 || scenes.length === 0 || styleProfiles.length === 0) return "drafting";
    if (!hasStoryboard) return "storyboard_ready";
    if (!hasVisualAssets) return "asset_ready";
    if (!hasVoice || !hasMusic) return "asset_ready";
    return "generation_ready";
  })();

  return { primaryAction: actions[0], actions, blockers, readyForGeneration, generationState };
}
