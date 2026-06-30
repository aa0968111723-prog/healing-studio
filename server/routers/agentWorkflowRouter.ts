/**
 * agentWorkflowRouter.ts — AIDV-339 驗證門失敗路由 tRPC endpoints
 *
 * reportValidation: agent reports tsc/vitest failure output → gets routing action
 * getValidationState: read current retry count for an issueKey
 * clearValidation: reset on successful validation pass
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  classifyValidationFailure,
  routeValidationFailure,
  getValidationState,
  clearValidationState,
} from "../_core/validationGateRouter";
import { insertDlqEntry } from "../services/agentDlq";

const IssueKeySchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Z]+-\d+$/, "Must be a Jira issue key e.g. AIDV-339");

export const agentWorkflowRouter = router({
  /**
   * Called by an agent after a validation run fails.
   * Returns the routing action: retry | decision | escalate.
   */
  reportValidation: protectedProcedure
    .input(
      z.object({
        issueKey: IssueKeySchema,
        tscOutput: z.string().max(65_536),
        vitestOutput: z.string().max(65_536),
        maxRetries: z.number().int().min(1).max(10).optional(),
        agentId: z.string().min(1).max(64).optional(),
        correlationId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // AIDV-926: generate correlation ID at dispatch entry for cross-gate tracing
      const correlationId = input.correlationId ?? randomUUID();
      const failureType = classifyValidationFailure(input.tscOutput, input.vitestOutput);
      const state = routeValidationFailure(
        input.issueKey,
        ctx.user.id,
        failureType,
        input.maxRetries ?? 3
      );
      // AIDV-877: persist routing decision to DLQ (best-effort — never block the agent)
      const failureReason = [input.tscOutput, input.vitestOutput]
        .map(s => s.trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, 2_000) || undefined;
      await insertDlqEntry(state, failureReason, input.agentId, {
        tscOutput: input.tscOutput.slice(0, 500),
        vitestOutput: input.vitestOutput.slice(0, 500),
      }, correlationId).catch(() => { /* DLQ write is best-effort */ });
      return { ...state, correlationId };
    }),

  /** Read current retry state without mutating it. */
  getValidationState: protectedProcedure
    .input(z.object({ issueKey: IssueKeySchema }))
    .query(({ ctx, input }) => {
      return getValidationState(input.issueKey, ctx.user.id);
    }),

  /** Reset the retry counter once validation passes. */
  clearValidation: protectedProcedure
    .input(z.object({ issueKey: IssueKeySchema }))
    .mutation(({ ctx, input }) => {
      clearValidationState(input.issueKey, ctx.user.id);
      return { ok: true };
    }),
});
