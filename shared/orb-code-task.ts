import { z } from "zod";

export const OrbCodeTaskProviderSchema = z.enum(["claudeCode", "codex", "manual"]);
export type OrbCodeTaskProvider = z.infer<typeof OrbCodeTaskProviderSchema>;

export const OrbCodeTaskStatusSchema = z.enum([
  "draft",
  "awaiting_approval",
  "approved",
  "running",
  "pr_created",
  "review_required",
  "merged",
  "failed",
  "cancelled",
  "blocked",
]);
export type OrbCodeTaskStatus = z.infer<typeof OrbCodeTaskStatusSchema>;

export const OrbCodeTaskSchema = z.object({
  codeTaskId: z.string().min(1).max(96),
  taskId: z.string().min(1).max(96),
  planId: z.string().min(1).max(120),
  traceId: z.string().min(1).max(120),
  provider: OrbCodeTaskProviderSchema,
  repository: z.string().min(1).max(200),
  branchName: z.string().min(1).max(120),
  baseBranch: z.string().min(1).max(120),
  status: OrbCodeTaskStatusSchema,
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(2000),
  filesAllowed: z.array(z.string().min(1).max(240)).max(200),
  filesForbidden: z.array(z.string().min(1).max(240)).max(200),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(30),
  testCommands: z.array(z.string().min(1).max(240)).max(30),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresHuman: z.literal(true),
  prUrl: z.string().url().optional(),
  prNumber: z.number().int().positive().optional(),
  commitSha: z.string().min(6).max(64).optional(),
  summary: z.string().min(1).max(1000),
  rollbackPlan: z.string().min(1).max(1000),
  testStatusSummary: z.string().max(500).optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type OrbCodeTask = z.infer<typeof OrbCodeTaskSchema>;

export const GitHubPrUrlSchema = z
  .string()
  .url()
  .refine(url => /^https:\/\/github\.com\/.+\/.+\/pull\/\d+/i.test(url), "PR URL must be a GitHub pull request URL");

function sanitizeSecretText(input: string): string {
  return input
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/sk-[a-z0-9]{8,}/gi, "sk-[REDACTED]")
    .replace(/data:[^;]+;base64,[a-z0-9+/=\s]+/gi, "[BASE64_REDACTED]");
}

function stripForbiddenSecrets(lines: string[]): string[] {
  return lines.map(line => sanitizeSecretText(line)).filter(Boolean);
}

export function buildClaudeCodeTaskPrompt(input: {
  agentPlanSummary: string;
  orbTaskSummary: string;
  codeTask: OrbCodeTask;
  relevantFiles?: string[];
  safetyConstraints?: string[];
}): string {
  const securityRules = [
    "Do not modify production secrets or add VITE_* secrets.",
    "Do not log API keys, private tokens, or credentials.",
    "Do not auto-merge pull requests.",
    ...(input.safetyConstraints ?? []),
  ];
  return [
    "You are Claude Code. Execute this code task safely.",
    `Repository: ${input.codeTask.repository}`,
    `Target branch: ${input.codeTask.branchName} (base: ${input.codeTask.baseBranch})`,
    `Objective: ${sanitizeSecretText(input.codeTask.objective)}`,
    `Plan summary: ${sanitizeSecretText(input.agentPlanSummary)}`,
    `Orb task summary: ${sanitizeSecretText(input.orbTaskSummary)}`,
    `Files allowed: ${stripForbiddenSecrets(input.codeTask.filesAllowed).join(", ") || "(none)"}`,
    `Files forbidden: ${stripForbiddenSecrets(input.codeTask.filesForbidden).join(", ") || "(none)"}`,
    `Acceptance criteria:\n- ${stripForbiddenSecrets(input.codeTask.acceptanceCriteria).join("\n- ")}`,
    `Required tests:\n- ${stripForbiddenSecrets(input.codeTask.testCommands).join("\n- ") || "(none)"}`,
    `Relevant files:\n- ${(input.relevantFiles ?? []).map(sanitizeSecretText).join("\n- ") || "(none)"}`,
    `Security rules:\n- ${securityRules.map(sanitizeSecretText).join("\n- ")}`,
    `Rollback plan: ${sanitizeSecretText(input.codeTask.rollbackPlan)}`,
    "Final report format: summary, files changed, tests run, risks, rollback validation, PR URL, next manual review steps.",
  ].join("\n\n");
}

export function buildCodexTaskPrompt(input: {
  agentPlanSummary: string;
  orbTaskSummary: string;
  codeTask: OrbCodeTask;
  relevantFiles?: string[];
  safetyConstraints?: string[];
}): string {
  return [
    "You are Codex acting as a safe code collaborator.",
    buildClaudeCodeTaskPrompt(input),
    "Additional codex rule: keep commits minimal and explain reasoning for each changed file.",
  ].join("\n\n");
}
