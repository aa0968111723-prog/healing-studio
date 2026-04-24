import { z } from "zod";

export const OrbTaskStatusSchema = z.enum([
  "planned",
  "running",
  "waiting_human",
  "done",
  "failed",
  "cancelled",
]);

export type OrbTaskStatus = z.infer<typeof OrbTaskStatusSchema>;

export const OrbToolCallSchema = z.object({
  name: z.string().min(2).max(64),
  args: z.record(z.string(), z.unknown()).optional(),
  requiresApproval: z.boolean().default(false),
});

export const OrbUiActionSchema = z.object({
  type: z.string().min(1).max(64),
  payload: z.unknown().optional(),
});

export const OrbPlanStepSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  pageId: z.string().min(1).max(64).optional(),
  pagePath: z.string().min(1).max(120).optional(),
  uiActions: z.array(OrbUiActionSchema).default([]),
  toolCalls: z.array(OrbToolCallSchema).default([]),
});

export const OrbTaskSchema = z.object({
  taskId: z.string().min(1).max(72),
  userId: z.number().int().positive(),
  intent: z.string().min(1).max(240),
  status: OrbTaskStatusSchema,
  steps: z.array(OrbPlanStepSchema).min(1).max(12),
  currentStepIndex: z.number().int().min(0).default(0),
  needsApproval: z.boolean().default(false),
  approvedStepIds: z.array(z.string().min(1).max(64)).default([]),
  stepApprovals: z.array(
    z.object({
      stepId: z.string().min(1).max(64),
      token: z.string().min(8).max(128),
      approvedAt: z.number().int(),
      expiresAt: z.number().int(),
      usedAt: z.number().int().optional(),
    })
  ).default([]),
  stepReports: z.array(
    z.object({
      stepId: z.string().min(1).max(64),
      ok: z.boolean(),
      detail: z.string().max(500).optional(),
      errorCode: z.string().max(64).optional(),
      source: z.enum(["ui", "tool", "system"]).optional(),
      actor: z.enum(["user", "agent", "system"]).optional(),
      at: z.number().int(),
    })
  ).default([]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type OrbTask = z.infer<typeof OrbTaskSchema>;
export type OrbPlanStep = z.infer<typeof OrbPlanStepSchema>;

export const OrbStartTaskInputSchema = z.object({
  intent: z.string().min(1).max(240),
  steps: z.array(OrbPlanStepSchema).min(1).max(12),
  needsApproval: z.boolean().default(false),
});

export const OrbApproveTaskInputSchema = z.object({
  taskId: z.string().min(1).max(72),
  approved: z.boolean(),
});

export const OrbStepReportInputSchema = z.object({
  taskId: z.string().min(1).max(72),
  stepId: z.string().min(1).max(64),
  ok: z.boolean(),
  detail: z.string().max(500).optional(),
  errorCode: z.string().max(64).optional(),
  source: z.enum(["ui", "tool", "system"]).optional(),
  actor: z.enum(["user", "agent", "system"]).optional(),
  approvalToken: z.string().min(8).max(128).optional(),
  at: z.number().int().optional(),
});

export const OrbApproveStepInputSchema = z.object({
  taskId: z.string().min(1).max(72),
  stepId: z.string().min(1).max(64),
  approved: z.boolean(),
});
