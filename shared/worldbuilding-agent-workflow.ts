import type { RunWorkflowAction } from "./agent-actions";
import type { WorldbuildingGenerationTask } from "./worldbuilding-generation-tasks";

const pathForTask = (type: WorldbuildingGenerationTask["type"]) => {
  if (["character_image", "scene_image", "shot_image"].includes(type)) return "/image-studio";
  if (type === "shot_video") return "/video-studio";
  if (type === "voice") return "/pro-studio";
  if (type === "music" || type === "sound") return "/pro-studio";
  if (type === "publishing") return "/animation";
  return "/animation";
};

export function buildAgentWorkflowFromGenerationTasks(args: { tasks: WorldbuildingGenerationTask[]; worldName?: string; confirmationMode?: "all-at-once" | "step-by-step" | "high-risk-only"; }): RunWorkflowAction {
  const confirmationMode = args.confirmationMode ?? "step-by-step";
  const steps = args.tasks.flatMap((task, idx) => {
    const path = pathForTask(task.type);
    const labelBase = task.status === "blocked" ? `${task.title}（blocked）` : task.title;
    return [
      { id: `wb-${idx}-nav`, path, actionType: "navigate", payload: JSON.stringify({ path }), label: `前往 ${path}` },
      { id: `wb-${idx}-prompt`, path, actionType: "fillPrompt", payload: JSON.stringify({ text: task.prompt ?? "" }), label: `${labelBase}：填入提示詞` },
      ...(task.targetModelId ? [{ id: `wb-${idx}-model`, path, actionType: "setModel", payload: JSON.stringify({ modelId: task.targetModelId }), label: `${labelBase}：設定模型` }] : []),
      { id: `wb-${idx}-submit`, path, actionType: "submit", payload: JSON.stringify({ taskId: task.id, requiresConfirmation: true }), label: `${labelBase}：送出（需確認）` },
    ];
  });
  return { type: "runWorkflow", name: `${args.worldName ?? "世界觀"} 生成工作流`, confirmationMode, steps };
}
