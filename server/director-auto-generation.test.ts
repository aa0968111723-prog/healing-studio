import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIRECTOR_ROUTER = resolve(
  process.cwd(),
  "server/routers/director.ts"
);
const DIRECTOR_PAGE = resolve(
  process.cwd(),
  "client/src/pages/DirectorAI.tsx"
);

describe("director.pollGenerationTask backend wiring", () => {
  const source = readFileSync(DIRECTOR_ROUTER, "utf8");

  it("registers pollGenerationTask procedure on the directorRouter", () => {
    expect(source).toContain("pollGenerationTask: brainProcedure");
    expect(source).toContain(".query(async ({ ctx, input }) =>");
  });

  it("loads job by jobId and rejects when userId mismatches", () => {
    const procStart = source.indexOf("pollGenerationTask: brainProcedure");
    const procSection = source.substring(
      procStart,
      source.indexOf("askForStudioPlan: brainProcedure", procStart)
    );
    expect(procSection).toContain("dbModule.getBackgroundJob(input.jobId)");
    expect(procSection).toMatch(/userId !== ctx\.user\.id/);
    expect(procSection).toContain('code: "NOT_FOUND"');
  });

  it("returns COMPLETED + resultUrl from cached resultJson without re-polling fal", () => {
    const procStart = source.indexOf("pollGenerationTask: brainProcedure");
    const procSection = source.substring(
      procStart,
      source.indexOf("askForStudioPlan: brainProcedure", procStart)
    );
    expect(procSection).toMatch(/job\.status === "completed"/);
    expect(procSection).toContain('status: "COMPLETED" as const');
    expect(procSection).toContain("resultUrl: cachedResultUrl");
  });

  it("polls fal queue when job is still processing and persists result on COMPLETED", () => {
    const procStart = source.indexOf("pollGenerationTask: brainProcedure");
    const procSection = source.substring(
      procStart,
      source.indexOf("askForStudioPlan: brainProcedure", procStart)
    );
    // 必須走共用的 fal queue 客戶端（含 modelId 後綴 405 fallback —
    // 否則 fal-ai/imagen4/preview / seedream/v4/text-to-image 等變體會
    // 在 status 輪詢時被 fal 回 405 而誤判為失敗）
    expect(procSection).toContain("falQueueFetchWithPrefixFallback");
    expect(procSection).toMatch(/"\/status"/);
    // 必須本地化 URL 並寫回 backgroundJob
    expect(procSection).toContain("localizeResultUrls");
    expect(procSection).toContain("dbModule.updateBackgroundJob");
    expect(procSection).toContain('status: "completed"');
  });

  it("extracts resultUrl from all known fal response shapes (image/video/audio/sfx)", () => {
    const procStart = source.indexOf("pollGenerationTask: brainProcedure");
    const procSection = source.substring(
      procStart,
      source.indexOf("askForStudioPlan: brainProcedure", procStart)
    );
    // 涵蓋 fal.ai 各模態的回傳路徑
    expect(procSection).toContain("r?.images");
    expect(procSection).toContain("r?.image_url");
    expect(procSection).toContain("r?.video_url");
    expect(procSection).toContain("r?.audio_url");
    expect(procSection).toContain("r?.audio_file"); // ElevenLabs SFX
  });

  it("refunds points + marks job failed on FAILED status", () => {
    const procStart = source.indexOf("pollGenerationTask: brainProcedure");
    const procSection = source.substring(
      procStart,
      source.indexOf("askForStudioPlan: brainProcedure", procStart)
    );
    expect(procSection).toMatch(/s === "FAILED"/);
    expect(procSection).toContain("refundUserPoints");
    expect(procSection).toContain('status: "failed"');
    expect(procSection).toContain("isDemoMode");
  });

  it("returns IN_PROGRESS as the default fall-through (no hard failure on transient fal errors)", () => {
    const procStart = source.indexOf("pollGenerationTask: brainProcedure");
    const procSection = source.substring(
      procStart,
      source.indexOf("askForStudioPlan: brainProcedure", procStart)
    );
    expect(procSection).toContain('status: "IN_PROGRESS" as const');
  });
});

describe("DirectorAI auto-generation pipeline (frontend wiring)", () => {
  const source = readFileSync(DIRECTOR_PAGE, "utf8");

  it("persists full task definitions in generationTasks state (modelId, prompt, params, dependsOn)", () => {
    expect(source).toContain("type DirectorGenTask");
    // 任務狀態必須帶完整定義，否則無法在上游完成後觸發 dependent 任務
    expect(source).toMatch(/modelId: string/);
    expect(source).toMatch(/dependsOn\?: \{/);
    expect(source).toMatch(/resultUrl\?: string \| null/);
  });

  it("renders GenerationProgressPanel below BatchGenerationDialog", () => {
    const renderIdx = source.indexOf("<BatchGenerationDialog");
    expect(renderIdx).toBeGreaterThan(-1);
    const after = source.substring(renderIdx);
    expect(after).toContain("<GenerationProgressPanel");
    expect(after).toContain("tasks={generationTasks}");
  });

  it("each task row polls director.pollGenerationTask with refetchInterval", () => {
    expect(source).toContain(
      "trpc.director.pollGenerationTask.useQuery"
    );
    expect(source).toMatch(/refetchInterval: isPolling \? 3000 : false/);
  });

  it("auto-fires i2v video tasks when upstream image task completes", () => {
    // useEffect 必須監聽 generationTasks 並用 resultUrl 當 firstFrameUrl 觸發 video 任務
    expect(source).toContain('t.modality === "image"');
    expect(source).toContain('t.status === "completed"');
    expect(source).toContain("dependsOn.modality === \"image\"");
    expect(source).toContain("firstFrameUrl,");
    expect(source).toContain("executeTaskMut.mutate");
  });

  it("optimistically marks deferred tasks as processing before firing to prevent re-fire loops", () => {
    // 觸發 dependent mutation 前先 setGenerationTasks 把狀態設為 processing，
    // 否則 useEffect 在下一輪 render 會再觸發一次造成重複扣點。
    expect(source).toMatch(
      /isFired \? \{ \.\.\.t, status: "processing" as const \} : t/
    );
  });

  it("autoGenerateMut.onSuccess no longer drops deferred tasks (toast says auto-trigger, not manual)", () => {
    // 先前的訊息是「待手動觸發」；正確流程應為「自動觸發」
    expect(source).not.toContain("手動觸發");
    expect(source).toContain("自動觸發");
  });
});
