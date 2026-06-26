import { TRPCError } from "@trpc/server";
import { serverEnv } from "./env.validated";

export function ensureFalApiKeyConfigured(): void {
  if (serverEnv.FAL_API_KEY?.trim()) return;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "創作工作室四模態共用 Fal.ai；目前尚未設定 FAL_API_KEY。請到 /admin/api-usage 檢查 providerReadiness，設定後重啟服務。",
  });
}

export function ensureGeminiApiKeyConfigured(): void {
  if (serverEnv.GEMINI_API_KEY?.trim()) return;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "目前選用 Gemini 系列生成引擎，但尚未設定 GEMINI_API_KEY。請到 /admin/api-usage 檢查 providerReadiness，設定後重啟服務。",
  });
}

export function isGeminiEngine(modelId: string | undefined): boolean {
  return typeof modelId === "string" && modelId.startsWith("gemini/");
}
