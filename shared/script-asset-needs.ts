import { detectScriptEntities, type ScriptEntityDetectionResult } from "./script-entity-detection";
import type { WorldbuildingFrameworkData } from "./worldbuilding-types";

export type ScriptAssetNeeds = {
  charactersNeeded: string[]; scenesNeeded: string[]; propsNeeded: string[]; audioCues: string[]; musicMoodCues: string[]; visualCues: string[]; cameraCues: string[]; subtitleOrNarrationCues: string[]; risks: string[];
};

const AUDIO_WORDS = ["雨聲","雷聲","風聲","腳步","踩水","水滴","門聲","開門","關門","車聲","手機震動","鐘聲","蟬鳴","鳥鳴","人聲","呼吸","衣料摩擦"];
const MOOD_WORDS = ["安靜","療癒","緊張","孤單","悲傷","開心","青春","懸疑","壓抑","溫柔","空靈","熱血","恐懼","莊嚴","希望","命運感"];
const CAMERA_WORDS = ["特寫","中景","遠景","全景","俯拍","仰拍","推鏡","拉遠","環繞","手持","定鏡","慢動作","空拍","跟拍"];
const VISUAL_WORDS = ["雨天","陰天","黃昏","夜景","逆光","柔光","霓虹","淺景深","電影感","動畫感","藍灰色調","暖色調"];
const PROP_WORDS = ["傘","手機","書包","花瓶","餐盤","地墊","書","筆","電腦","耳機","杯子","門","窗"];
const SUBTITLE_WORDS = ["OS","VO","旁白","字幕","獨白","內心","畫外音"];

export function detectScriptAssetNeeds(text: string, entityDetectionResult?: ScriptEntityDetectionResult, world?: WorldbuildingFrameworkData | null): ScriptAssetNeeds {
  const entity = entityDetectionResult ?? detectScriptEntities(text, null);
  const pick = (arr: string[]) => arr.filter(w => text.includes(w));
  const audioCues = pick(AUDIO_WORDS); const musicMoodCues = pick(MOOD_WORDS); const cameraCues = pick(CAMERA_WORDS); const visualCues = pick(VISUAL_WORDS);
  const propsNeeded = pick(PROP_WORDS); const subtitleOrNarrationCues = pick(SUBTITLE_WORDS);
  const risks: string[] = [];
  if (entity.dialogues.length > 0 && !(world?.characters ?? []).some(c => c.voiceProfile?.voiceId || c.voiceProfile?.emotion || c.voiceProfile?.languageCode)) risks.push("有 dialogue 但無 voiceProfile → 需要配音設定");
  if (audioCues.length > 0 && (world?.soundLibrary?.length ?? 0) === 0) risks.push("有音效 cue 但世界觀 soundLibrary 為空 → 需要音效庫");
  if (musicMoodCues.length > 0 && (world?.musicThemes?.length ?? 0) === 0) risks.push("有 musicMood cue 但 musicThemes 為空 → 需要配樂主題");
  if ((world?.characters?.length ?? 0) > 0 && world!.characters.some(c => !c.appearance?.trim())) risks.push("有角色但缺外觀 → 角色外觀不足");
  if ((world?.scenes?.length ?? 0) > 0 && world!.scenes.some(s => !s.environment?.trim() || !s.mood?.trim() || !s.lighting?.trim())) risks.push("有場景但缺 environment / mood / lighting → 場景氛圍不足");

  return { charactersNeeded: entity.characters.map(c => c.name), scenesNeeded: entity.scenes.map(s => s.name), propsNeeded, audioCues, musicMoodCues, visualCues, cameraCues, subtitleOrNarrationCues, risks };
}
