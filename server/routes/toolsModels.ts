import { Router, type Request, type Response } from "express";
import { FAL_MODEL_CATALOG, type FalCategory } from "../services/falModels";

export const toolsModelsRouter = Router();

type ParamType = "number" | "string" | "boolean" | "select";

toolsModelsRouter.get("/api/tools/models", (req: Request, res: Response) => {
  const category = String(req.query.category ?? "image");
  const categoryMap: Record<string, FalCategory[]> = {
    image: ["text-to-image", "image-to-image"],
    video: ["text-to-video", "image-to-video", "video-to-video"],
    audio: ["text-to-audio", "text-to-speech", "video-to-audio"],
  };
  const categories = categoryMap[category];
  if (!categories) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }

  const models = categories.flatMap(cat => FAL_MODEL_CATALOG[cat] ?? []).map(model => {
    const params = Object.entries(model.inputSchema)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => {
        let type: ParamType = "string";
        let def: unknown = "";
        if (["seed", "numInferenceSteps", "guidanceScale", "duration", "strength", "loraScale", "numFrames", "fps", "trainingSteps", "learningRate", "speed", "exaggeration", "motionBucketId", "condAugmentation"].includes(key)) {
          type = "number";
          def = 0;
        } else if (["prompt", "negativePrompt", "stylePrompt", "voiceId", "imageSize", "aspectRatio"].includes(key)) {
          type = key === "aspectRatio" || key === "imageSize" ? "select" : "string";
          def = "";
        } else if (["instrumental"].includes(key)) {
          type = "boolean";
          def = false;
        }
        return {
          key,
          label: key,
          type,
          default: def,
          ...(key === "guidanceScale" ? { min: 0, max: 20, step: 0.1 } : {}),
          ...(key === "numInferenceSteps" ? { min: 1, max: 100, step: 1 } : {}),
          ...(key === "aspectRatio"
            ? { options: ["1:1", "3:4", "4:3", "9:16", "16:9"] }
            : {}),
        };
      });

    return {
      id: model.modelId,
      name: model.label,
      category: model.category,
      params,
    };
  });

  res.json(models);
});
