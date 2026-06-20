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

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
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
