import { z } from "zod";
import { router, adminProcedure, leaderOrAdminProcedure } from "../_core/trpc";
import * as db from "../db";
import {
  parseUsdToTwdRate,
  safeSharePct,
  usdToTwd,
} from "@shared/currency";

// ─── Admin Dashboard ──────────────────────────────────────────────────────────

export const adminRouter = router({
  allUsers: adminProcedure.query(async () => {
    return db.getAllUsers();
  }),

  updateQuota: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        amount: z.number().min(0),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateUserQuota(input.userId, input.amount);
      return { success: true };
    }),

  // 自動給點調整 — 組長（leader）或管理員可動。「成本金流」分頁的積分分配
  // 操作都走這條，admin.updateRole 仍然鎖死 admin（指派他人角色是 admin 專屬）。
  updateAutoCreditPolicy: leaderOrAdminProcedure
    .input(
      z.object({
        userId: z.number(),
        enabled: z.boolean(),
        amount: z.number().int().min(0).max(100000),
        intervalDays: z.number().int().min(1).max(365),
        nextAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateUserAutoCreditPolicy({
        userId: input.userId,
        enabled: input.enabled,
        amount: input.amount,
        intervalDays: input.intervalDays,
        nextAt: input.nextAt,
      });
      return { success: true };
    }),

  runAutoCreditNow: leaderOrAdminProcedure.mutation(async () => {
    const result = await db.runDueAutoCreditGrant(500);
    return { success: true, ...result };
  }),

  usageLogs: adminProcedure
    .input(z.object({ limit: z.number().default(100) }))
    .query(async ({ input }) => {
      return db.getAllUsageLogs(input.limit);
    }),

  teamCostSummary: leaderOrAdminProcedure.query(async () => {
    const rows = await db.getTeamCostSummary();
    const rate = parseUsdToTwdRate(process.env.USD_TO_TWD_RATE);

    const enriched = rows.map(r => {
      const usd = parseFloat(String(r.totalCost ?? "0")) || 0;
      const credits = Number(r.totalCredits ?? 0) || 0;
      return {
        userId: r.userId,
        totalCost: r.totalCost,
        totalRequests: Number(r.totalRequests ?? 0) || 0,
        totalTokens: Number(r.totalTokens ?? 0) || 0,
        totalCredits: credits,
        usdCost: usd,
        twdCost: usdToTwd(usd, rate),
      };
    });

    const totals = enriched.reduce(
      (acc, r) => {
        acc.usd += r.usdCost;
        acc.twd += r.twdCost;
        acc.credits += r.totalCredits;
        acc.requests += r.totalRequests;
        acc.tokens += r.totalTokens;
        return acc;
      },
      { usd: 0, twd: 0, credits: 0, requests: 0, tokens: 0 }
    );

    const withShare = enriched.map(r => ({
      ...r,
      usdSharePct: safeSharePct(r.usdCost, totals.usd),
      creditsSharePct: safeSharePct(r.totalCredits, totals.credits),
    }));

    return {
      rows: withShare,
      totals,
      usdToTwdRate: rate,
    };
  }),

  systemStats: adminProcedure.query(async () => {
    return db.getSystemStats();
  }),

  updateRole: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        role: z.enum(["user", "leader", "admin"]),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateUserRole(input.userId, input.role);
      return { success: true };
    }),

  allGenerationHistory: adminProcedure
    .input(z.object({ limit: z.number().default(200) }))
    .query(async ({ input }) => {
      return db.getAllGenerationHistory(input.limit);
    }),

  userActivity: adminProcedure.query(async () => {
    return db.getUserActivitySummary();
  }),

  apiProviderBreakdown: adminProcedure.query(async () => {
    return db.getApiProviderBreakdown();
  }),

  systemDailyTrend: adminProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input }) => {
      return db.getSystemDailyTrend(input.days);
    }),

  allBackgroundJobs: adminProcedure
    .input(z.object({ limit: z.number().default(100) }))
    .query(async ({ input }) => {
      return db.getAllBackgroundJobs(input.limit);
    }),

  // SECURITY: Only report whether keys are set via boolean flag.
  // NEVER return env[k.name] values directly — only Boolean(truthy check).
  apiKeysStatus: adminProcedure.query(async () => {
    const env = process.env;
    const keys = [
      { name: "GEMINI_API_KEY", label: "Gemini LLM", module: "LLM 主引擎" },
      { name: "FAL_API_KEY", label: "Fal.ai", module: "圖片/影片生成" },
      {
        name: "REPLICATE_API_TOKEN",
        label: "Replicate",
        module: "LoRA 模型訓練",
      },
      { name: "ELEVENLABS_API_KEY", label: "ElevenLabs", module: "語音合成" },
      { name: "SUNO_API_KEY", label: "Suno", module: "音樂生成" },
      { name: "PINECONE_API_KEY", label: "Pinecone", module: "RAG 記憶系統" },
      { name: "NEWS_API_KEY", label: "NewsAPI", module: "新聞資料" },
      { name: "NEWSDATA_API_KEY", label: "NewsData.io", module: "新聞資料" },
      { name: "LANGSMITH_API_KEY", label: "LangSmith", module: "AI 監控" },
      { name: "GCS_BUCKET_NAME", label: "GCS Storage", module: "媒體儲存" },
      { name: "S3_ENDPOINT", label: "S3/R2 Storage", module: "S3 儲存" },
      { name: "GOOGLE_CLIENT_ID", label: "Google OAuth", module: "登入認證" },
      { name: "DATABASE_URL", label: "MySQL Database", module: "資料庫" },
    ];
    return keys.map(k => ({
      name: k.name,
      label: k.label,
      module: k.module,
      isSet: Boolean(env[k.name] && env[k.name]!.trim().length > 0),
    }));
  }),
});
