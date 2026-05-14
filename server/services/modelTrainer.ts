/**
 * server/services/modelTrainer.ts
 *
 * Thin façade the training-specialist spirit tool imports via
 * `await import("../modelTrainer")`. Real LoRA training goes through
 * `studio.trainLora` on the tRPC studio router which writes user_models
 * + training_jobs rows and runs `runFalTrainingJob`. The spirit-tool path
 * is a lighter-weight entry that doesn't yet have a DB-backed pipeline,
 * so these calls surface a clear "use the trainer page" hint instead of
 * silently launching a half-wired job.
 */

export interface StartTrainingJobInput {
  userId: number;
  modelName: string;
  trainingType: "lora" | "dreambooth" | "fine-tune";
  datasetImages: string[];
  baseModel: string;
  steps: number;
  learningRate: number;
}

export interface StartTrainingJobResult {
  trainingId: string;
  status: "queued" | "pending";
  hint: string;
}

export async function startTrainingJob(
  input: StartTrainingJobInput
): Promise<StartTrainingJobResult> {
  if (input.datasetImages.length < 3) {
    throw new Error(
      "至少需要 3 張參考圖才能訓練 LoRA — 請上傳更多訓練素材"
    );
  }
  throw new Error(
    "練練的快速訓練入口目前還沒接上 DB 任務系統。請改用模型訓練頁（/models）的 studio.trainLora，會走完整的 user_models + training_jobs 紀錄 + fal 訓練佇列。"
  );
}

export interface GetTrainingJobStatusInput {
  userId: number;
  trainingId: string;
}

export interface GetTrainingJobStatusResult {
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message?: string;
}

export async function getTrainingJobStatus(
  _input: GetTrainingJobStatusInput
): Promise<GetTrainingJobStatusResult> {
  throw new Error(
    "練練還沒接 DB 任務查詢。請改用 /models 頁面查看訓練進度。"
  );
}
