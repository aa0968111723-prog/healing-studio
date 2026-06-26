import {
  isAdmin,
  isLeaderOrAdmin,
  NOT_ADMIN_ERR_MSG,
  NOT_LEADER_ERR_MSG,
  UNAUTHED_ERR_MSG,
} from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import {
  buildBrainContext,
  type BrainContext,
} from "../middleware/brainContext";
import { checkTrpcRateLimit } from "./trpcRateLimit";
import { logger } from "./logger";
import { captureError } from "./errorTracking";
import { getDb } from "../db";
import { backgroundJobs } from "../../drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

const isProd = process.env.NODE_ENV === "production";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // AIDV-329: mask INTERNAL_SERVER_ERROR details in production to prevent info disclosure.
  // Raw DB messages (ECONNREFUSED host:port, stack traces, schema names) must never reach clients.
  errorFormatter({ shape, error }) {
    if (isProd && shape.data.code === "INTERNAL_SERVER_ERROR") {
      logger.error("trpc_internal_error", {
        path: shape.data.path,
        message: error.message,
        cause: error.cause instanceof Error ? error.cause.message : String(error.cause ?? ""),
      });
      captureError(error.cause ?? error, { path: shape.data.path });
      return {
        ...shape,
        message: "Internal server error",
        data: {
          ...shape.data,
          stack: undefined,
        },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }

    if (!isAdmin(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

/**
 * leaderOrAdminProcedure — leader（組長）或 admin 都可呼叫。
 * 用於成本檢視 / 積分分配（自動給點調整）等需要中階管理者也能動的端點。
 * 想限制只能 admin 動的（如指派角色），仍走 adminProcedure。
 */
export const leaderOrAdminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }

    if (!isLeaderOrAdmin(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_LEADER_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);

// ─── Brain-aware Procedure ─────────────────────────────────────────────────
// Extends protectedProcedure with ctx.brain (user's AI brain configuration).
// Includes Health Ping, Graceful Degradation, and audit logging.

const requireBrain = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  const brain = await buildBrainContext(ctx.user.id);

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      brain,
    },
  });
});

/**
 * brainProcedure — 需要登入 + 注入 ctx.brain 的 procedure。
 * 適用於所有需要讀取使用者 AI 大腦組態的操作（生成、導演 AI、積木編譯等）。
 *
 * 使用方式：
 * ```ts
 * myRouter: brainProcedure.query(async ({ ctx }) => {
 *   const director = ctx.brain.getBrain('director');
 *   const imageEngine = ctx.brain.getEngine('imageEngine');
 *   // ...
 * })
 * ```
 */
export const brainProcedure = t.procedure.use(requireBrain);

// ─── Rate-limited Brain Procedures (AIDV-211) ─────────────────────────────
// AI chat / director LLM calls: 20 req / 60s per user.
const requireAiChatLimit = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  checkTrpcRateLimit(ctx.user.id, { limit: 20, windowMs: 60_000, label: "aichat" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Image / video generation calls: 5 req / 60s per user (shared bucket across studios).
const requireGenerationLimit = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  checkTrpcRateLimit(ctx.user.id, { limit: 5, windowMs: 60_000, label: "gen" }, ctx.res);
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** brainProcedure + 20 req/min per-user limit — for director.chat / LLM planning. */
export const aiChatProcedure = brainProcedure.use(requireAiChatLimit);
/** brainProcedure + 5 req/min per-user limit — for imageStudio/videoStudio generation. */
export const generationProcedure = brainProcedure.use(requireGenerationLimit);

// AIDV-242: Video Studio generation limits — per-hour + per-day on top of shared 5/min.
// GPU cost per call ($0.05–$0.5) is far higher than text/image, so tighter hourly/daily caps.
// AIDV-294: Concurrent active job cap — prevents a single user from queuing unbounded GPU tasks.
// AIDV-327: Global concurrent cap across all users — prevents cluster-wide GPU exhaustion.
const MAX_CONCURRENT_VIDEO_JOBS = 5;
const MAX_GLOBAL_CONCURRENT_VIDEO_JOBS = 20;
const requireVideoStudioLimit = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  checkTrpcRateLimit(ctx.user.id, { limit: 50, windowMs: 60 * 60_000, label: "videoStudio:hr" }, ctx.res);
  checkTrpcRateLimit(ctx.user.id, { limit: 200, windowMs: 24 * 60 * 60_000, label: "videoStudio:day" }, ctx.res);

  const db = await getDb();
  if (db) {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.userId, ctx.user.id),
          eq(backgroundJobs.jobType, "video"),
          inArray(backgroundJobs.status, ["queued", "processing"])
        )
      );
    if ((row?.count ?? 0) >= MAX_CONCURRENT_VIDEO_JOBS) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `最多同時進行 ${MAX_CONCURRENT_VIDEO_JOBS} 個影片生成任務，請等待現有任務完成後再試`,
      });
    }

    // AIDV-327: Global cap — guards against cluster-wide GPU exhaustion when many users hit generate simultaneously.
    const [globalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.jobType, "video"),
          inArray(backgroundJobs.status, ["queued", "processing"])
        )
      );
    if ((globalRow?.count ?? 0) >= MAX_GLOBAL_CONCURRENT_VIDEO_JOBS) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `系統影片生成任務已達上限（${MAX_GLOBAL_CONCURRENT_VIDEO_JOBS} 個），請稍後再試`,
      });
    }
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * generationProcedure (5/min) + 50/hr + 200/day video-specific limits.
 * Use for all GPU-cost videoStudio mutations; keeps imageStudio unaffected.
 */
export const videoGenerationProcedure = generationProcedure.use(requireVideoStudioLimit);
