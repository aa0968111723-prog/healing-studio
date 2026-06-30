/**
 * agentWorkflowRouter.ts — AIDV-339 驗證門失敗路由 tRPC endpoints
 *
 * reportValidation: agent reports tsc/vitest failure output → gets routing action
 * getValidationState: read current retry count for an issueKey
 * clearValidation: reset on successful validation pass
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  classifyValidationFailure,
  routeValidationFailure,
  getValidationState,
  clearValidationState,
} from "../_core/validationGateRouter";

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
      })
    )
    .mutation(({ ctx, input }) => {
      const failureType = classifyValidationFailure(input.tscOutput, input.vitestOutput);
      const state = routeValidationFailure(
        input.issueKey,
        ctx.user.id,
        failureType,
        input.maxRetries ?? 3
      );
      return state;
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
