import { detectScriptEntities, type ScriptEntityDetectionResult } from "./script-entity-detection";

export type ScriptAssetNeeds = {
  charactersNeeded: string[];
  scenesNeeded: string[];
  audioCues: string[];
  musicMoodCues: string[];
  visualCues: string[];
  cameraCues: string[];
  risks: string[];
};

const AUDIO_WORDS = ["雨", "風", "腳步", "水", "門", "車", "人聲", "音樂", "鋼琴"];
const MOOD_WORDS = ["安靜", "療癒", "緊張", "孤單", "悲傷", "開心"];
const CAMERA_WORDS = ["特寫", "遠景", "全景", "推鏡", "俯拍"];

export function detectScriptAssetNeeds(text: string, entityDetectionResult?: ScriptEntityDetectionResult): ScriptAssetNeeds {
  const entity = entityDetectionResult ?? detectScriptEntities(text, null);
  const audioCues = AUDIO_WORDS.filter(w => text.includes(w));
  const musicMoodCues = MOOD_WORDS.filter(w => text.includes(w));
  const cameraCues = CAMERA_WORDS.filter(w => text.includes(w));
  const visualCues = [
    ...(entity.characters.length ? ["需要角色圖"] : []),
    ...(entity.scenes.length ? ["需要場景圖"] : []),
    ...(cameraCues.length ? ["需要鏡頭設定"] : []),
  ];
  const risks: string[] = [];
  if (entity.dialogues.length > 0) risks.push("需要配音");
  if (audioCues.length > 0) risks.push("需要音效 / 配樂");
  if (musicMoodCues.length > 0) risks.push("需要配樂情緒");

  return {
    charactersNeeded: entity.characters.map(c => c.name),
    scenesNeeded: entity.scenes.map(s => s.name),
    audioCues,
    musicMoodCues,
    visualCues,
    cameraCues,
    risks,
  };
}
