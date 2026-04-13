/**
 * langsmith.ts — LangSmith 深度整合 API 路由
 *
 * 提供 LangSmith 追蹤資料的查詢代理，讓前端儀表板可以：
 *   1. 全鏈路追蹤（列出 runs、查看 run 詳情）
 *   2. 生產環境監控（健康狀況、流量分析、錯誤率）
 *   3. 用戶回饋收集（建立 / 列出 feedback）
 *   4. 數據集管理（列出 datasets、建立 example）
 *   5. Prompt 管理（列出 prompts）
 *   6. 跨模型對比（側邊欄對比、盲測評分、成本速度分析）
 *   7. 微調數據導出（優質案例提取、JSONL 格式化導出）
 *
 * 所有呼叫透過 LangSmith SDK 存取，不直接暴露 API Key 給前端。
 */

import { z } from "zod";
import { router } from "../_core/trpc";
import { adminProcedure, protectedProcedure } from "../_core/trpc";
import { serverEnv } from "../_core/env.validated";
import type { Client as LangSmithClientType } from "langsmith";

// ─── LangSmith Client Singleton ────────────────────────────────────────────

let _client: LangSmithClientType | null = null;

async function getClient(): Promise<LangSmithClientType | null> {
  if (!serverEnv.LANGSMITH_API_KEY) return null;
  if (_client) return _client;
  try {
    const { Client } = await import("langsmith");
    _client = new Client({
      apiKey: serverEnv.LANGSMITH_API_KEY,
      apiUrl: serverEnv.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com",
    });
    return _client;
  } catch {
    return null;
  }
}

function getProjectName(): string {
  return serverEnv.LANGSMITH_PROJECT || "healing-studio";
}

// ─── Helper: safe serialization of LangSmith run objects ────────────────────

function serializeRun(run: Record<string, unknown>) {
  return {
    id: String(run.id ?? ""),
    name: String(run.name ?? ""),
    run_type: String(run.run_type ?? ""),
    status: String(run.status ?? ""),
    error: run.error ? String(run.error) : null,
    start_time: run.start_time ? String(run.start_time) : null,
    end_time: run.end_time ? String(run.end_time) : null,
    latency: typeof run.total_tokens === "number" ? run.total_tokens : null,
    total_tokens: typeof run.total_tokens === "number" ? run.total_tokens : null,
    prompt_tokens: typeof run.prompt_tokens === "number" ? run.prompt_tokens : null,
    completion_tokens: typeof run.completion_tokens === "number" ? run.completion_tokens : null,
    inputs: run.inputs ? summarizeObj(run.inputs as Record<string, unknown>) : null,
    outputs: run.outputs ? summarizeObj(run.outputs as Record<string, unknown>) : null,
    feedback_stats: run.feedback_stats ?? null,
    tags: Array.isArray(run.tags) ? run.tags.map(String) : [],
    extra: run.extra ? extractMetadata(run.extra as Record<string, unknown>) : null,
    parent_run_id: run.parent_run_id ? String(run.parent_run_id) : null,
  };
}

function summarizeObj(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = value.length > 500 ? value.slice(0, 500) + "…" : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = `[Array(${value.length})]`;
    } else if (typeof value === "object") {
      result[key] = "[Object]";
    }
  }
  return result;
}

function extractMetadata(extra: Record<string, unknown>): Record<string, unknown> {
  const meta = extra.metadata as Record<string, unknown> | undefined;
  if (!meta) return {};
  return {
    engine: meta.engine ?? null,
    model: meta.model ?? null,
    duration_ms: meta.duration_ms ?? null,
    cost_usd: meta.cost_usd ?? null,
    prompt_tokens: meta.prompt_tokens ?? null,
    completion_tokens: meta.completion_tokens ?? null,
    total_tokens: meta.total_tokens ?? null,
  };
}

// ─── Router ────────────────────────────────────────────────────────────────

export const langsmithRouter = router({
  /**
   * 連線狀態檢查 — 確認 LangSmith API Key 是否已設定且可用
   */
  status: protectedProcedure.query(async () => {
    const client = await getClient();
    if (!client) {
      return { connected: false, project: null, message: "LANGSMITH_API_KEY 未設定" };
    }
    try {
      // Quick health check: try to list runs (limit 1)
      const runs: unknown[] = [];
      for await (const run of client.listRuns({
        projectName: getProjectName(),
        limit: 1,
      })) {
        runs.push(run);
        break;
      }
      return { connected: true, project: getProjectName(), message: "已連線" };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { connected: false, project: getProjectName(), message: `連線失敗: ${msg}` };
    }
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 全鏈路追蹤 — Run 列表與詳情
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 列出最近的 runs（支援過濾）
   */
  listRuns: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      runType: z.enum(["llm", "chain", "tool", "retriever"]).optional(),
      errorOnly: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const client = await getClient();
      if (!client) return { runs: [], total: 0 };

      const runs: ReturnType<typeof serializeRun>[] = [];
      try {
        const filter = input.errorOnly ? 'eq(status, "error")' : undefined;
        for await (const run of client.listRuns({
          projectName: getProjectName(),
          limit: input.limit,
          runType: input.runType,
          filter,
        })) {
          runs.push(serializeRun(run as unknown as Record<string, unknown>));
        }
      } catch {
        // LangSmith unavailable — return empty
      }
      return { runs, total: runs.length };
    }),

  /**
   * 取得單一 run 的完整詳情
   */
  getRun: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ input }) => {
      const client = await getClient();
      if (!client) return null;
      try {
        const run = await client.readRun(input.runId);
        return serializeRun(run as unknown as Record<string, unknown>);
      } catch {
        return null;
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 生產環境監控 — 健康狀況、流量、錯誤率
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 健康狀況摘要 — 最近 N 筆 runs 的成功/失敗率、平均延遲、Token 成本
   */
  healthStats: protectedProcedure
    .input(z.object({ sampleSize: z.number().min(10).max(200).default(50) }))
    .query(async ({ input }) => {
      const client = await getClient();
      if (!client) {
        return {
          connected: false,
          total: 0,
          success: 0,
          errors: 0,
          successRate: 0,
          avgLatencyMs: 0,
          totalTokens: 0,
          totalCostUsd: 0,
          errorBreakdown: {} as Record<string, number>,
          recentErrors: [] as Array<{ id: string; name: string; error: string; time: string | null }>,
        };
      }

      let total = 0;
      let success = 0;
      let errors = 0;
      let totalLatency = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;
      const errorBreakdown: Record<string, number> = {};
      const recentErrors: Array<{ id: string; name: string; error: string; time: string | null }> = [];

      try {
        for await (const run of client.listRuns({
          projectName: getProjectName(),
          limit: input.sampleSize,
        })) {
          const r = run as unknown as Record<string, unknown>;
          total++;
          const status = String(r.status ?? "");
          if (status === "error") {
            errors++;
            const errMsg = String(r.error ?? "unknown");
            // Categorize error
            let errType = "其他";
            if (errMsg.includes("timeout") || errMsg.includes("Timeout")) errType = "API 逾時";
            else if (errMsg.includes("JSON")) errType = "JSON 解析失敗";
            else if (errMsg.includes("prompt") || errMsg.includes("Prompt")) errType = "Prompt 錯誤";
            else if (errMsg.includes("rate") || errMsg.includes("429")) errType = "速率限制";
            else if (errMsg.includes("500") || errMsg.includes("502") || errMsg.includes("503")) errType = "伺服器錯誤";
            errorBreakdown[errType] = (errorBreakdown[errType] ?? 0) + 1;

            if (recentErrors.length < 5) {
              recentErrors.push({
                id: String(r.id ?? ""),
                name: String(r.name ?? ""),
                error: errMsg.slice(0, 200),
                time: r.start_time ? String(r.start_time) : null,
              });
            }
          } else {
            success++;
          }

          // Extract latency
          const extra = r.extra as Record<string, unknown> | undefined;
          const meta = extra?.metadata as Record<string, unknown> | undefined;
          if (meta?.duration_ms && typeof meta.duration_ms === "number") {
            totalLatency += meta.duration_ms;
          }
          if (meta?.total_tokens && typeof meta.total_tokens === "number") {
            totalTokens += meta.total_tokens;
          }
          if (meta?.cost_usd && typeof meta.cost_usd === "number") {
            totalCostUsd += meta.cost_usd;
          }
        }
      } catch {
        // LangSmith unavailable
      }

      return {
        connected: true,
        total,
        success,
        errors,
        successRate: total > 0 ? Math.round((success / total) * 10000) / 100 : 0,
        avgLatencyMs: total > 0 ? Math.round(totalLatency / total) : 0,
        totalTokens,
        totalCostUsd: Math.round(totalCostUsd * 100000) / 100000,
        errorBreakdown,
        recentErrors,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 用戶回饋收集 — LangSmith Feedback API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 對某個 run 建立回饋（點讚/點踩）
   */
  createFeedback: protectedProcedure
    .input(z.object({
      runId: z.string().min(1),
      score: z.number().min(0).max(1),
      comment: z.string().optional(),
      feedbackKey: z.string().default("user-rating"),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClient();
      if (!client) return { success: false, message: "LangSmith 未連線" };

      try {
        await client.createFeedback(input.runId, input.feedbackKey, {
          score: input.score,
          comment: input.comment ?? `User ${ctx.user.id} feedback`,
        });
        return { success: true, message: "回饋已送出" };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, message: `回饋失敗: ${msg}` };
      }
    }),

  /**
   * 列出某 run 的所有回饋
   */
  listFeedback: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ input }) => {
      const client = await getClient();
      if (!client) return [];

      const feedbacks: Array<{
        id: string;
        score: number | null;
        comment: string | null;
        key: string;
        created_at: string | null;
      }> = [];
      try {
        for await (const fb of client.listFeedback({ runIds: [input.runId] })) {
          const f = fb as unknown as Record<string, unknown>;
          feedbacks.push({
            id: String(f.id ?? ""),
            score: typeof f.score === "number" ? f.score : null,
            comment: f.comment ? String(f.comment) : null,
            key: String(f.key ?? ""),
            created_at: f.created_at ? String(f.created_at) : null,
          });
        }
      } catch {
        // LangSmith unavailable
      }
      return feedbacks;
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 數據集管理 — Dataset Curation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 列出所有 datasets
   */
  listDatasets: protectedProcedure.query(async () => {
    const client = await getClient();
    if (!client) return [];

    const datasets: Array<{
      id: string;
      name: string;
      description: string | null;
      created_at: string | null;
      example_count: number;
    }> = [];

    try {
      for await (const ds of client.listDatasets()) {
        const d = ds as unknown as Record<string, unknown>;
        datasets.push({
          id: String(d.id ?? ""),
          name: String(d.name ?? ""),
          description: d.description ? String(d.description) : null,
          created_at: d.created_at ? String(d.created_at) : null,
          example_count: typeof d.example_count === "number" ? d.example_count : 0,
        });
      }
    } catch {
      // LangSmith unavailable
    }
    return datasets;
  }),

  /**
   * 將某個 run 的輸入/輸出存入 dataset（案例提取）
   */
  addRunToDataset: adminProcedure
    .input(z.object({
      runId: z.string().min(1),
      datasetName: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const client = await getClient();
      if (!client) return { success: false, message: "LangSmith 未連線" };

      try {
        // 1. Read the run
        const run = await client.readRun(input.runId) as unknown as Record<string, unknown>;
        const inputs = run.inputs as Record<string, unknown> | undefined;
        const outputs = run.outputs as Record<string, unknown> | undefined;

        if (!inputs) return { success: false, message: "Run 無輸入資料" };

        // 2. Ensure dataset exists
        let dataset: { id: string } | undefined;
        try {
          const d = await client.readDataset({ datasetName: input.datasetName }) as unknown as Record<string, unknown>;
          dataset = { id: String(d.id) };
        } catch {
          // Dataset doesn't exist — create it
          const d = await client.createDataset(input.datasetName, {
            description: `Auto-created from run ${input.runId}`,
          }) as unknown as Record<string, unknown>;
          dataset = { id: String(d.id) };
        }

        // 3. Add example
        await client.createExample(inputs, outputs ?? {}, {
          datasetId: dataset.id,
        });

        return { success: true, message: `已加入 Dataset: ${input.datasetName}` };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, message: `失敗: ${msg}` };
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. 跨模型對比 (Model Comparison)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 跨模型對比分析 — 按模型名稱分組統計 runs 的品質、速度、成本
   * 用於「成本與速度折衷分析」視覺化圖表
   */
  modelComparison: protectedProcedure
    .input(z.object({ sampleSize: z.number().min(10).max(500).default(100) }))
    .query(async ({ input }) => {
      const client = await getClient();
      if (!client) return { models: [], totalRuns: 0 };

      // Group runs by model name
      const modelMap = new Map<string, {
        runs: number;
        errors: number;
        totalLatencyMs: number;
        totalTokens: number;
        totalCostUsd: number;
        positiveScores: number;
        totalScored: number;
      }>();

      let totalRuns = 0;
      try {
        for await (const run of client.listRuns({
          projectName: getProjectName(),
          limit: input.sampleSize,
          runType: "llm",
        })) {
          const r = run as unknown as Record<string, unknown>;
          totalRuns++;

          const extra = r.extra as Record<string, unknown> | undefined;
          const meta = extra?.metadata as Record<string, unknown> | undefined;
          const model = String(meta?.model ?? r.name ?? "unknown");

          if (!modelMap.has(model)) {
            modelMap.set(model, {
              runs: 0, errors: 0, totalLatencyMs: 0,
              totalTokens: 0, totalCostUsd: 0,
              positiveScores: 0, totalScored: 0,
            });
          }
          const entry = modelMap.get(model)!;
          entry.runs++;

          if (String(r.status ?? "") === "error") entry.errors++;
          if (meta?.duration_ms && typeof meta.duration_ms === "number") entry.totalLatencyMs += meta.duration_ms;
          if (meta?.total_tokens && typeof meta.total_tokens === "number") entry.totalTokens += meta.total_tokens;
          if (meta?.cost_usd && typeof meta.cost_usd === "number") entry.totalCostUsd += meta.cost_usd;

          // Check feedback stats
          const fbStats = r.feedback_stats as Record<string, unknown> | undefined;
          if (fbStats) {
            const rating = fbStats["user-rating"] as Record<string, unknown> | undefined;
            if (rating && typeof rating.avg === "number") {
              entry.totalScored++;
              if (rating.avg >= 0.5) entry.positiveScores++;
            }
          }
        }
      } catch {
        // LangSmith unavailable
      }

      const models = Array.from(modelMap.entries()).map(([name, data]) => ({
        model: name,
        runs: data.runs,
        errors: data.errors,
        successRate: data.runs > 0 ? Math.round(((data.runs - data.errors) / data.runs) * 10000) / 100 : 0,
        avgLatencyMs: data.runs > 0 ? Math.round(data.totalLatencyMs / data.runs) : 0,
        totalTokens: data.totalTokens,
        avgTokensPerRun: data.runs > 0 ? Math.round(data.totalTokens / data.runs) : 0,
        totalCostUsd: Math.round(data.totalCostUsd * 100000) / 100000,
        avgCostPerRun: data.runs > 0 ? Math.round((data.totalCostUsd / data.runs) * 1000000) / 1000000 : 0,
        qualityScore: data.totalScored > 0 ? Math.round((data.positiveScores / data.totalScored) * 100) : null,
        scoredRuns: data.totalScored,
      })).sort((a, b) => b.runs - a.runs);

      return { models, totalRuns };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. 模型微調數據導出 (Fine-tuning Export)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 匯出有正面回饋的高品質對話（JSONL 格式），用於模型微調
   * 篩選標準：score >= threshold 的 runs
   */
  exportFineTuningData: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).default(100),
      minScore: z.number().min(0).max(1).default(0.5),
      format: z.enum(["openai", "jsonl"]).default("openai"),
    }))
    .query(async ({ input }) => {
      const client = await getClient();
      if (!client) return { records: [], total: 0, format: input.format };

      type ExportRecord = {
        runId: string;
        model: string;
        score: number | null;
        messages: Array<{ role: string; content: string }>;
        assistantResponse: string;
      };
      const records: ExportRecord[] = [];

      try {
        // Collect runs that have positive feedback
        const runsWithMeta: Array<{
          id: string;
          inputs: Record<string, unknown>;
          outputs: Record<string, unknown>;
          model: string;
          score: number | null;
        }> = [];

        for await (const run of client.listRuns({
          projectName: getProjectName(),
          limit: input.limit * 3, // over-fetch to filter by feedback
          runType: "llm",
          filter: 'eq(status, "success")',
        })) {
          const r = run as unknown as Record<string, unknown>;
          const extra = r.extra as Record<string, unknown> | undefined;
          const meta = extra?.metadata as Record<string, unknown> | undefined;
          const fbStats = r.feedback_stats as Record<string, unknown> | undefined;

          let score: number | null = null;
          if (fbStats) {
            const rating = fbStats["user-rating"] as Record<string, unknown> | undefined;
            if (rating && typeof rating.avg === "number") {
              score = rating.avg;
            }
          }

          // Include if has positive score or if no feedback filter is needed
          if (score !== null && score >= input.minScore) {
            runsWithMeta.push({
              id: String(r.id ?? ""),
              inputs: (r.inputs ?? {}) as Record<string, unknown>,
              outputs: (r.outputs ?? {}) as Record<string, unknown>,
              model: String(meta?.model ?? r.name ?? "unknown"),
              score,
            });
          }

          if (runsWithMeta.length >= input.limit) break;
        }

        // Format into export records
        for (const entry of runsWithMeta) {
          const inputMessages = entry.inputs.messages as Array<{ role: string; content: string }> | undefined;
          const outputContent = String(entry.outputs.content ?? "");

          if (!inputMessages || !outputContent) continue;

          const messages = inputMessages.map(m => ({
            role: String(m.role ?? "user"),
            content: String(m.content ?? ""),
          }));

          records.push({
            runId: entry.id,
            model: entry.model,
            score: entry.score,
            messages,
            assistantResponse: outputContent,
          });
        }
      } catch {
        // LangSmith unavailable
      }

      // Format output
      if (input.format === "openai") {
        // OpenAI fine-tuning format: {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}
        const formatted = records.map(r => ({
          messages: [
            ...r.messages,
            { role: "assistant", content: r.assistantResponse },
          ],
        }));
        return { records: formatted, total: formatted.length, format: "openai" as const };
      }

      // JSONL format — each line is a separate JSON object
      const formatted = records.map(r => ({
        prompt: r.messages.map(m => `${m.role}: ${m.content}`).join("\n"),
        completion: r.assistantResponse,
        metadata: { runId: r.runId, model: r.model, score: r.score },
      }));
      return { records: formatted, total: formatted.length, format: "jsonl" as const };
    }),
});
