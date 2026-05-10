import { getOrchestrator } from "./modelClients";

export async function executeOrbTask(
  userId: number,
  task: {
    type: "generate_image" | "generate_music" | "generate_video";
    prompt: string;
    model?: string;
  }
): Promise<{ url: string; type: string }> {
  void userId;
  const orchestrator = getOrchestrator();

  if (task.type === "generate_image") {
    const result = await orchestrator.fal.generateImage({
      prompt: task.prompt,
      model: (task.model as "flux-pro" | "flux-schnell" | "stable-diffusion-xl" | undefined) ?? "flux-pro",
      numImages: 1,
    });
    const url = result.images?.[0]?.url;
    if (!url) throw new Error("Image generation completed without URL");
    return { url, type: "image" };
  }

  if (task.type === "generate_music") {
    const result = await orchestrator.suno.generateMusic({
      prompt: task.prompt,
      style: task.model,
    });
    for (let attempt = 0; attempt < 8; attempt++) {
      const status = await orchestrator.suno.getTaskStatus(result.taskId);
      const url = status.clips[0]?.audioUrl;
      if (url) return { url, type: "music" };
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error("Music generation timed out before audio URL was ready");
  }

  const result = await orchestrator.fal.generateVideo({
    prompt: task.prompt,
    model: (task.model as "kling-v1" | "runway-gen3" | undefined) ?? "kling-v1",
  });
  if (!result.videoUrl) throw new Error("Video generation completed without URL");
  return { url: result.videoUrl, type: "video" };
}
