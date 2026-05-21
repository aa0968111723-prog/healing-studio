export type GenerationTask = {
  id: string;
  type: "character_image" | "scene_image" | "shot_image" | "shot_video" | "voice" | "music" | "sound" | "publishing";
  title: string;
  prompt?: string;
  sourceId?: string;
  status: "draft";
};

export type GenerationTaskList = {
  imageTasks: GenerationTask[];
  videoTasks: GenerationTask[];
  voiceTasks: GenerationTask[];
  musicTasks: GenerationTask[];
  soundTasks: GenerationTask[];
  publishingTasks: GenerationTask[];
};

const uid = (prefix: string, id: string) => `${prefix}-${id || Math.random().toString(36).slice(2, 8)}`;

export function buildGenerationTaskList(productionPackage: any): GenerationTaskList {
  const pkg = productionPackage?.json ?? productionPackage ?? {};
  const imageTasks: GenerationTask[] = [];
  const videoTasks: GenerationTask[] = [];
  const voiceTasks: GenerationTask[] = [];
  const musicTasks: GenerationTask[] = [];
  const soundTasks: GenerationTask[] = [];

  (pkg.characters ?? []).forEach((c: any) => imageTasks.push({ id: uid("char", c.id), type: "character_image", title: `角色圖：${c.name ?? "未命名角色"}`, prompt: c.appearance, sourceId: c.id, status: "draft" }));
  (pkg.scenes ?? []).forEach((s: any) => imageTasks.push({ id: uid("scene", s.id), type: "scene_image", title: `場景圖：${s.name ?? "未命名場景"}`, prompt: s.environment ?? s.tagline, sourceId: s.id, status: "draft" }));
  (pkg.storyboards ?? []).forEach((shot: any, idx: number) => {
    imageTasks.push({ id: uid("shot-image", shot.id ?? String(idx)), type: "shot_image", title: `逐鏡圖像：#${idx + 1} ${shot.title ?? "鏡頭"}`, prompt: shot.imagePrompt, sourceId: shot.id, status: "draft" });
    videoTasks.push({ id: uid("shot-video", shot.id ?? String(idx)), type: "shot_video", title: `逐鏡影片：#${idx + 1} ${shot.title ?? "鏡頭"}`, prompt: shot.videoPrompt, sourceId: shot.id, status: "draft" });
  });

  (pkg.voiceDirections ?? []).forEach((v: string, i: number) => voiceTasks.push({ id: uid("voice", String(i)), type: "voice", title: `配音任務 #${i + 1}`, prompt: v, status: "draft" }));
  (pkg.musicPromptSeeds ?? []).forEach((m: string, i: number) => musicTasks.push({ id: uid("music", String(i)), type: "music", title: `配樂任務 #${i + 1}`, prompt: m, status: "draft" }));
  (pkg.soundCueList ?? []).forEach((s: string, i: number) => soundTasks.push({ id: uid("sound", String(i)), type: "sound", title: `音效任務 #${i + 1}`, prompt: s, status: "draft" }));

  const publishingTasks: GenerationTask[] = [{ id: "publishing-1", type: "publishing", title: "發布文案任務", prompt: pkg.publishingCopy, status: "draft" }];

  return { imageTasks, videoTasks, voiceTasks, musicTasks, soundTasks, publishingTasks };
}
