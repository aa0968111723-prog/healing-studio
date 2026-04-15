import { Router, Request, Response } from "express";
import { Client } from "langsmith";

const langsmithRouter = Router();

langsmithRouter.get(
  "/api/langsmith/stats",
  async (_req: Request, res: Response) => {
    const apiKey = process.env.LANGSMITH_API_KEY;
    const projectName = process.env.LANGSMITH_PROJECT ?? "default";

    if (!apiKey) {
      res.status(503).json({
        error:
          "LANGSMITH_API_KEY is not configured. Set it in your environment variables. Get yours at https://smith.langchain.com.",
      });
      return;
    }

    try {
      const client = new Client({ apiKey });

      const runs: {
        id: string;
        name: string;
        status: string;
        latency: number | null;
        totalTokens: number;
        error: string | null;
        startTime: string;
      }[] = [];

      const iter = client.listRuns({
        projectName,
        executionOrder: 1,
        limit: 50,
      });

      for await (const run of iter) {
        const startMs =
          typeof run.start_time === "number"
            ? run.start_time
            : run.start_time
              ? new Date(run.start_time).getTime()
              : null;

        const endMs =
          run.end_time != null
            ? typeof run.end_time === "number"
              ? run.end_time
              : new Date(run.end_time).getTime()
            : null;

        const latency =
          startMs != null && endMs != null ? endMs - startMs : null;

        runs.push({
          id: run.id ?? "",
          name: run.name ?? "",
          status: run.status ?? "unknown",
          latency,
          totalTokens: run.total_tokens ?? 0,
          error: run.error ?? null,
          startTime: startMs != null ? new Date(startMs).toISOString() : "",
        });
      }

      // Build summary
      const totalRuns = runs.length;
      const errorCount = runs.filter(
        r => r.error != null || r.status === "error"
      ).length;
      const errorRate = totalRuns > 0 ? (errorCount / totalRuns) * 100 : 0;
      const validLatencies = runs
        .map(r => r.latency)
        .filter((l): l is number => l != null);
      const avgLatency =
        validLatencies.length > 0
          ? validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length
          : 0;
      const totalTokens = runs.reduce((s, r) => s + r.totalTokens, 0);

      res.json({
        runs,
        summary: {
          totalRuns,
          errorCount,
          errorRate: Math.round(errorRate * 10) / 10,
          avgLatency: Math.round(avgLatency),
          totalTokens,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[langsmith] Error fetching stats:", message);
      res
        .status(500)
        .json({ error: `Failed to fetch LangSmith stats: ${message}` });
    }
  }
);

export { langsmithRouter };
