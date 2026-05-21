import { calculateWorldbuildingProgress } from "./worldbuilding-progress";
import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

type CharacterPackageCard = { name: string; role: string; appearance: string; personality: string; outfit: string; expressions: string[]; voice: string; promptSeed: string; };
type ScenePackageCard = { name: string; description: string; mood: string; lighting: string; timeWeather: string; promptSeed: string; };

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

export function buildWorldbuildingProductionPackage(world: Partial<WorldbuildingFrameworkData> | null | undefined): WorldbuildingProductionPackage {
  const w = world ?? {};
  const p = calculateWorldbuildingProgress(w as WorldbuildingFrameworkData);
  const title = t(w.name, "未命名世界觀") + "｜AI 影片製作包";
  const missingItems: string[] = [];
  if (!(w.characters?.length)) missingItems.push("缺少角色卡");
  if (!(w.scenes?.length)) missingItems.push("缺少場景卡");
  if (!(w.styleProfiles?.length)) missingItems.push("缺少視覺風格設定");
  if (!(w.musicThemes?.length)) missingItems.push("缺少配樂方向");
  if (!(w.characters ?? []).some(c => c.voiceProfile)) missingItems.push("缺少配音方向");

  const characters: CharacterPackageCard[] = (w.characters ?? []).map(c => ({
    name: t(c.name), role: t(c.role), appearance: t(c.appearance), personality: t(c.personality), outfit: t(c.outfit), expressions: (c.expressions ?? []).map(e => typeof e === "string" ? e : (e as any).name || "表情"), voice: t(c.voiceProfile?.emotion || c.voiceProfile?.languageCode),
    promptSeed: `繁體中文，角色 ${t(c.name)}，${t(c.appearance)}，${t(c.outfit)}，${t(c.personality)}，高一致性角色設計。`,
  }));
  const scenes: ScenePackageCard[] = (w.scenes ?? []).map(s => ({
    name: t(s.name), description: t(s.environment || s.tagline), mood: t(s.mood), lighting: t(s.lighting), timeWeather: `${Array.isArray(s.timeOfDay) ? s.timeOfDay.join("、") : "未指定時段"} / ${t(s.notes, "未指定天氣")}`,
    promptSeed: `繁體中文，場景 ${t(s.name)}，${t(s.environment || s.tagline)}，氛圍 ${t(s.mood)}，光線 ${t(s.lighting)}。`,
  }));

  const visualStyleGuide = (w.styleProfiles ?? []).flatMap(s => [t(s.artStyle, "美術風格待補"), `色調：${(s.palette ?? []).join("、") || "待補"}`, `鏡頭語言：${t(s.lensSpec?.aspectRatio || s.lighting)}`, s.negativePrompt ? `負面詞：${s.negativePrompt}` : ""]).filter(Boolean);
  const audioGuide = [
    ...(w.musicThemes ?? []).map(m => `配樂：${t(m.mood)} / 樂器：${(m.instruments ?? []).join("、") || "待補"}`),
    `配音：${(w.characters ?? []).map(c => c.voiceProfile?.emotion).filter(Boolean).join("、") || "待補"}`,
    `音效方向：${(w.soundLibrary?.map(i => i.label).slice(0,3).join("、")) || "待補"}`,
  ];

  const imagePromptSeeds = [...characters.map(c => c.promptSeed), ...scenes.map(s => s.promptSeed)];
  const videoPromptSeeds = scenes.map(s => `繁體中文影片提示詞：${s.description}，角色與風格需與世界觀一致。`);
  const voiceDirections = characters.map(c => `${c.name}：${c.voice}`);
  const musicPromptSeeds = (w.musicThemes ?? []).map(m => `繁體中文音樂提示詞：${t(m.mood)}，樂器 ${m.instruments?.join("、") || "待補"}。`);

  const worldSummary = `${t(w.name, "未命名世界觀")}｜${t(w.genre, "未指定類型")}｜${t(w.era, "未指定時代")}｜核心情緒：${t(w.description)}`;
  const warnings = missingItems.length ? ["目前製作包可產生，但尚缺的設定可能會影響圖、影、音一致性。"] : [];

  const markdown = `# ${title}\n\n## 世界觀總設定\n- 名稱：${t(w.name, "未命名")}\n- 類型：${t(w.genre)}\n- 時代背景：${t(w.era)}\n- 描述：${t(w.description)}\n- 核心情緒：${t(w.description)}\n\n## 角色卡\n${characters.map(c => `### ${c.name}\n- 角色定位：${c.role}\n- 外觀：${c.appearance}\n- 性格：${c.personality}\n- 服裝：${c.outfit}\n- 表情：${c.expressions.join("、") || "（待補）"}\n- 聲音設定：${c.voice}\n- 角色圖 prompt seed：${c.promptSeed}`).join("\n\n") || "（尚無角色）"}\n\n## 場景卡\n${scenes.map(s => `### ${s.name}\n- 場景描述：${s.description}\n- 氛圍：${s.mood}\n- 光線：${s.lighting}\n- 時間/天氣：${s.timeWeather}\n- 場景圖 prompt seed：${s.promptSeed}`).join("\n\n") || "（尚無場景）"}\n\n## 視覺風格指南\n${visualStyleGuide.map(v => `- ${v}`).join("\n") || "- （待補）"}\n\n## 聲音指南\n${audioGuide.map(v => `- ${v}`).join("\n")}\n\n## 生成提示詞\n- character image prompt：${characters[0]?.promptSeed || "（待補）"}\n- scene image prompt：${scenes[0]?.promptSeed || "（待補）"}\n- video prompt：${videoPromptSeeds[0] || "（待補）"}\n- music prompt：${musicPromptSeeds[0] || "（待補）"}\n- voice prompt：${voiceDirections[0] || "（待補）"}\n\n## 缺漏提醒\n${missingItems.map(m => `- ${m}`).join("\n") || "- 無"}\n${warnings.length ? `\n> ${warnings[0]}` : ""}`;

  return { title, generatedAt: new Date().toISOString(), readinessPercent: p.overall, warnings, markdown, json: { worldSummary, characters, scenes, visualStyleGuide, audioGuide, imagePromptSeeds, videoPromptSeeds, voiceDirections, musicPromptSeeds, missingItems } };
}
