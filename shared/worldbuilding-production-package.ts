import { calculateWorldbuildingProgress } from "./worldbuilding-progress";
import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

type CharacterPackageCard = { name: string; role: string; appearance: string; personality: string; outfit: string; expressions: string[]; voice: string; promptSeed: string; };
type ScenePackageCard = { name: string; description: string; mood: string; lighting: string; timeWeather: string; promptSeed: string; };

type StoryboardRow = { shot: number; start: string; end: string; scene: string; visual: string; camera: string; dialogue: string; sound: string };

export type WorldbuildingProductionPackage = {
  title: string;
  generatedAt: string;
  readinessPercent: number;
  warnings: string[];
  markdown: string;
  json: {
    worldSummary: string;
    characters: CharacterPackageCard[];
    scenes: ScenePackageCard[];
    visualStyleGuide: string[];
    audioGuide: string[];
    imagePromptSeeds: string[];
    videoPromptSeeds: string[];
    voiceDirections: string[];
    musicPromptSeeds: string[];
    missingItems: string[];
  };
};

const t = (v?: string | null, fallback = "（待補）") => v?.trim() || fallback;

export function buildWorldbuildingProductionPackage(world: Partial<WorldbuildingFrameworkData> | null | undefined, storyboards?: any[]): WorldbuildingProductionPackage {
  const w = world ?? {};
  const p = calculateWorldbuildingProgress(w as WorldbuildingFrameworkData);
  const title = t(w.name, "未命名世界觀") + "｜AI 影片製作包";
  const missingItems: string[] = [];
  if (!(w.characters?.length)) missingItems.push("缺少角色卡");
  if (!(w.scenes?.length)) missingItems.push("缺少場景卡");
  if (!(w.styleProfiles?.length)) missingItems.push("缺少視覺風格設定");

  const characters: CharacterPackageCard[] = (w.characters ?? []).map(c => ({ name: t(c.name), role: t(c.role), appearance: t(c.appearance), personality: t(c.personality), outfit: t(c.outfit), expressions: (c.expressions ?? []).map(e => typeof e === "string" ? e : (e as any).name || "表情"), voice: t(c.voiceProfile?.emotion || c.voiceProfile?.languageCode), promptSeed: `繁體中文，角色 ${t(c.name)}，${t(c.appearance)}，${t(c.outfit)}，${t(c.personality)}，高一致性角色設計。`, }));
  const scenes: ScenePackageCard[] = (w.scenes ?? []).map(s => ({ name: t(s.name), description: t(s.environment || s.tagline), mood: t(s.mood), lighting: t(s.lighting), timeWeather: `${Array.isArray(s.timeOfDay) ? s.timeOfDay.join("、") : "未指定時段"} / ${t(s.notes, "未指定天氣")}`, promptSeed: `繁體中文，場景 ${t(s.name)}，${t(s.environment || s.tagline)}，氛圍 ${t(s.mood)}，光線 ${t(s.lighting)}。`, }));

  const sbRows: StoryboardRow[] = (storyboards ?? []).flatMap((sb: any) => (sb?.scenes ?? []).map((s: any, idx: number) => ({
    shot: idx + 1, start: t(s.startTime), end: t(s.endTime), scene: t(s.sceneName || s.location), visual: t(s.visualDescription || s.description), camera: t(s.cameraMovement || s.cameraDirection), dialogue: t(s.dialogue), sound: t(s.soundDesign || s.musicCue || s.notes),
  })));

  const visualStyle = w.styleProfiles?.[0];
  const imagePromptSeeds = sbRows.map(r => `鏡頭 ${r.shot}：使用角色卡、場景卡與視覺風格，${r.visual}，mood ${t((visualStyle as any)?.mood)}, lighting ${t((visualStyle as any)?.lighting)}, camera ${r.camera}。`);
  const videoPromptSeeds = sbRows.map(r => `鏡頭 ${r.shot}：角色動作與表情需連續，${r.visual}；鏡頭運動 ${r.camera}；氣氛 ${r.sound}；保持角色與場景一致。`);
  const voiceDirections = sbRows.map(r => `鏡頭 ${r.shot}：${r.dialogue}`).filter(v => !v.includes("（待補）"));
  const musicPromptSeeds = sbRows.map(r => `鏡頭 ${r.shot} 音效/配樂：${r.sound}`).filter(v => !v.includes("（待補）"));

  const visualStyleGuide = (w.styleProfiles ?? []).flatMap(s => [t(s.artStyle, "美術風格待補"), `色調：${(s.palette ?? []).join("、") || "待補"}`, `鏡頭語言：${t(s.lensSpec?.aspectRatio || s.lighting)}`]);
  const audioGuide = [`配音：${(w.characters ?? []).map(c => c.voiceProfile?.emotion).filter(Boolean).join("、") || "待補"}`];

  const worldSummary = `${t(w.name, "未命名世界觀")}｜${t(w.genre, "未指定類型")}｜${t(w.era, "未指定時代")}`;
  const warnings = missingItems.length ? ["尚缺資訊會影響生成一致性。"] : [];

  const markdown = `# ${title}\n\n## 世界觀總設定\n- 名稱：${t(w.name, "未命名")}\n- 類型：${t(w.genre)}\n\n## 分鏡表\n${sbRows.length ? sbRows.map(r => `- 鏡頭 ${r.shot}｜${r.start} - ${r.end}｜${r.scene}｜${r.visual}｜${r.camera}｜對白：${r.dialogue}｜音效/配樂：${r.sound}`).join("\n") : "- （待補分鏡）"}\n\n## 逐鏡圖像 Prompt\n${imagePromptSeeds.map(p => `- ${p}`).join("\n") || "- （待補）"}\n\n## 逐鏡影片 Prompt\n${videoPromptSeeds.map(p => `- ${p}`).join("\n") || "- （待補）"}\n\n## 配音稿\n${voiceDirections.map(v => `- ${v}`).join("\n") || "- （待補）"}\n\n## 音效清單\n${musicPromptSeeds.map(v => `- ${v}`).join("\n") || "- （待補）"}\n\n## 發布文案\n- YouTube 標題：${t(w.name, "未命名世界觀")}｜療癒短片\n- YouTube 描述：以 ${t(w.description)} 為核心，呈現一致的角色與場景敘事。\n- TikTok / Shorts 文案：#療癒動畫 #世界觀\n- Hashtags：#AI影片 #世界觀系統 #一致性\n\n## 缺漏提醒\n${missingItems.map(m => `- ${m}`).join("\n") || "- 無"}\n${warnings.length ? `\n> ${warnings[0]}` : ""}`;

  return { title, generatedAt: new Date().toISOString(), readinessPercent: p.overall, warnings, markdown, json: { worldSummary, characters, scenes, visualStyleGuide, audioGuide, imagePromptSeeds, videoPromptSeeds, voiceDirections, musicPromptSeeds, missingItems } };
}
