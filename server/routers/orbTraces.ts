import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { orbTaskTracer } from "../services/orbTaskTracer";

export const orbTracesRouter = router({
  /** Get trace by ID for debugging */
  getTrace: protectedProcedure
    .input(z.object({ traceId: z.string() }))
    .query(({ ctx, input }) => {
      const trace = orbTaskTracer.getTrace(input.traceId);
      if (trace && trace.userId !== undefined && trace.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return trace;
    }),

  /** Get recent traces for user */
  listUserTraces: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }))
    .query(({ ctx, input }) => {
      return orbTaskTracer.getTracesForUser(ctx.user.id, input.limit);
    }),

  /** Get execution timeline for visualization */
  getTimeline: protectedProcedure
    .input(z.object({ traceId: z.string() }))
    .query(({ ctx, input }) => {
      const trace = orbTaskTracer.getTrace(input.traceId);
      if (trace && trace.userId !== undefined && trace.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return orbTaskTracer.getTimeline(input.traceId);
    }),

  /** Export trace in observability platform format */
  exportTrace: protectedProcedure
    .input(z.object({
      traceId: z.string(),
      format: z.enum(["langfuse", "langsmith", "otlp"]).optional(),
    }))
    .query(({ ctx, input }) => {
      const trace = orbTaskTracer.getTrace(input.traceId);
      if (trace && trace.userId !== undefined && trace.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return orbTaskTracer.exportTrace(input.traceId, input.format);
    }),

  /** Analyze failure patterns for debugging */
  analyzeFailures: protectedProcedure.query(({ ctx }) => {
    return orbTaskTracer.analyzeFailurePatterns(ctx.user.id);
  }),
});
