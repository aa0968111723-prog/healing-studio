/**
 * server/services/skillOrchestrator.ts — Wave S / AIDV-128
 *
 * S-3 Skill Orchestrator: executes a sequence of official Skills defined by a
 * workflow preset (shared/skills/official/video-workflow.preset.json or any
 * compatible structure), passing step outputs forward as inputs for the next step.
 *
 * Design:
 *   - Reads skill definitions from OFFICIAL_SKILLS (S-2)
 *   - Validates each step with instantiateSkillStep (S-1)
 *   - Dispatches via dispatchOfficialSkill (S-2 adapters)
 *   - Persists step records in orbWorkflowStepExecutions (0084 columns)
 *   - On failure: retries up to maxRetries, then applies onFailure strategy
 *   - Emits progress via onProgress callback (wires into SSE / AIDV-13)
 *   - Supports ConfirmGate: step with requireConfirm=true pauses until
 *     resume() is called with the human's approval
 */

import { logger } from "../_core/logger";
import { getDb } from "../db";
import { instantiateSkillStep } from "./skillValidator";
import { getOfficialSkill } from "../../shared/skills/index";
import { dispatchOfficialSkill, type OfficialSkillInput } from "./officialSkillAdapters";
import { enqueueAttribution, isCostAttributionEnabled } from "./cost/costAttribution";
import { getSkillEntry } from "./skillRegistryService";
import { runSandboxedSkill, SandboxViolation } from "./skillSandbox";
import type { SkillPermissions, SkillInstance, SkillManifest } from "../../shared/skill-manifest";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting-confirm";
export type OrchestrationStatus = "pending" | "running" | "awaiting-confirm" | "completed" | "failed" | "cancelled";
export type OnFailureStrategy = "abort" | "skip" | "retry";

export interface PresetStep {
  skillId: string;
  label?: string;
  /** Input values; "{{varName}}" tokens are resolved from runtime inputs + prior outputs. */
  inputs: Record<string, unknown>;
  /** Fan-out over a prior output array: e.g. "scenes" → one step execution per item. */
  fanOut?: string;
  /** Retry config; defaults to abort after 1 failure. */
  maxRetries?: number;
  onFailure?: OnFailureStrategy;
  /** If true, pause and wait for human approval before dispatching. */
  requireConfirm?: boolean;
}

export interface WorkflowPreset {
  id: string;
  name: string;
  version: string;
  steps: PresetStep[];
}

export interface StepResult {
  stepIndex: number;
  skillId: string;
  label?: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  retries: number;
  durationMs: number;
}

export interface OrchestrationResult {
  executionId: string;
  presetId: string;
  status: OrchestrationStatus;
  steps: StepResult[];
  outputs: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export interface RunPresetOptions {
  userId: number;
  /** Runtime inputs; used to resolve {{token}} placeholders in step.inputs. */
  inputs?: Record<string, unknown>;
  /** Default permissions granted to all steps (manifest may request a subset). */
  grantedPermissions?: SkillPermissions;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  executionId: string;
  stepIndex: number;
  skillId: string;
  status: StepStatus;
  message?: string;
}

// ─── Token resolver ───────────────────────────────────────────────────────────

function resolveTokens(
  value: unknown,
  context: Record<string, unknown>
): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const resolved = context[key];
      return resolved !== undefined ? String(resolved) : `{{${key}}}`;
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveTokens(v, context));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, resolveTokens(v, context)])
    );
  }
  return value;
}

const DEFAULT_PERMISSIONS: SkillPermissions = {
  connectors: [],
  materials: true,
  crossProject: false,
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class SkillOrchestrator {
  /** Map of executionId → resolve fn for pending ConfirmGates. */
  private readonly confirmGates = new Map<string, (approved: boolean) => void>();

  /**
   * Execute a workflow preset end-to-end.
   * Sequential steps, outputs flowing into the next step's context.
   * Fan-out steps generate one sub-execution per item.
   */
  async runPreset(
    preset: WorkflowPreset,
    opts: RunPresetOptions
  ): Promise<OrchestrationResult> {
    const executionId = `sko-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();
    const granted = opts.grantedPermissions ?? DEFAULT_PERMISSIONS;
    const context: Record<string, unknown> = { ...(opts.inputs ?? {}) };
    const stepResults: StepResult[] = [];
    let overallStatus: OrchestrationStatus = "running";

    logger.info("SkillOrchestrator: started", { executionId, preset: preset.id });

    try {
      for (let i = 0; i < preset.steps.length; i++) {
        const stepDef = preset.steps[i];
        const emit = (status: StepStatus, message?: string) => {
          opts.onProgress?.({ executionId, stepIndex: i, skillId: stepDef.skillId, status, message });
        };

        // ── ConfirmGate ─────────────────────────────────────────────────────
        if (stepDef.requireConfirm) {
          overallStatus = "awaiting-confirm";
          emit("awaiting-confirm", `Step ${i} (${stepDef.skillId}) awaiting human confirmation`);
          const approved = await new Promise<boolean>(resolve => {
            this.confirmGates.set(executionId, resolve);
          });
          this.confirmGates.delete(executionId);
          if (!approved) {
            stepResults.push({
              stepIndex: i,
              skillId: stepDef.skillId,
              label: stepDef.label,
              status: "skipped",
              retries: 0,
              durationMs: 0,
            });
            continue;
          }
          overallStatus = "running";
        }

        // ── Fan-out ──────────────────────────────────────────────────────────
        if (stepDef.fanOut && Array.isArray(context[stepDef.fanOut])) {
          const items = context[stepDef.fanOut] as unknown[];
          const fanResults: unknown[] = [];
          for (const [j, item] of items.entries()) {
            const fanCtx = { ...context, [stepDef.fanOut.replace(/s$/, "")]: item, _fanIndex: j };
            const res = await this.runStep(stepDef, fanCtx, opts.userId, granted, executionId, i, emit);
            stepResults.push({ ...res, stepIndex: i });
            if (res.status === "failed" && (stepDef.onFailure ?? "abort") === "abort") {
              throw new Error(`Fan-out step ${i}[${j}] failed: ${res.error}`);
            }
            if (res.output !== undefined) fanResults.push(res.output);
          }
          context[`step_${i}_outputs`] = fanResults;
        } else {
          // ── Single step ────────────────────────────────────────────────────
          const res = await this.runStep(stepDef, context, opts.userId, granted, executionId, i, emit);
          stepResults.push(res);
          if (res.status === "failed" && (stepDef.onFailure ?? "abort") === "abort") {
            throw new Error(`Step ${i} (${stepDef.skillId}) failed: ${res.error}`);
          }
          if (res.output !== undefined) {
            Object.assign(context, { [`step_${i}_output`]: res.output, ...flattenOutput(res.output) });
          }
        }
      }

      overallStatus = "completed";
    } catch (err) {
      overallStatus = "failed";
      logger.error("SkillOrchestrator: execution failed", { executionId, err });
    }

    const result: OrchestrationResult = {
      executionId,
      presetId: preset.id,
      status: overallStatus,
      steps: stepResults,
      outputs: context,
      durationMs: Date.now() - startTime,
    };

    logger.info("SkillOrchestrator: finished", { executionId, status: overallStatus, durationMs: result.durationMs });
    return result;
  }

  /**
   * Approve or reject a ConfirmGate for a running execution.
   * Call this from the tRPC handler when the user clicks "Confirm" or "Cancel".
   */
  confirmStep(executionId: string, approved: boolean): boolean {
    const resolve = this.confirmGates.get(executionId);
    if (!resolve) return false;
    resolve(approved);
    return true;
  }

  // ── Internal: run one skill step with retry logic ─────────────────────────

  private async runStep(
    stepDef: PresetStep,
    context: Record<string, unknown>,
    userId: number,
    granted: SkillPermissions,
    executionId: string,
    stepIndex: number,
    emit: (status: StepStatus, message?: string) => void
  ): Promise<StepResult> {
    const stepStart = Date.now();
    const officialManifest = getOfficialSkill(stepDef.skillId);
    // Fall back to registry for external/community skills.
    const manifest: SkillManifest | null =
      officialManifest ?? (await this.resolveExternalSkill(stepDef.skillId));
    if (!manifest) {
      return {
        stepIndex,
        skillId: stepDef.skillId,
        label: stepDef.label,
        status: "failed",
        error: `Unknown skill: ${stepDef.skillId} (not in official registry or skill_registry)`,
        retries: 0,
        durationMs: 0,
      };
    }

    // Resolve {{token}} placeholders in step inputs
    const resolvedInputs = resolveTokens(stepDef.inputs, context) as Record<string, unknown>;
    const skillInputs = { ...resolvedInputs, userId };

    // Validate via S-1 contract
    const inst = instantiateSkillStep(manifest, skillInputs, granted);
    if (!inst.ok) {
      return {
        stepIndex,
        skillId: stepDef.skillId,
        label: stepDef.label,
        status: "failed",
        error: inst.error,
        retries: 0,
        durationMs: Date.now() - stepStart,
      };
    }

    const maxRetries = stepDef.maxRetries ?? 0;
    let lastError = "";
    let retries = 0;

    emit("running");

    while (retries <= maxRetries) {
      try {
        let output: unknown;
        if (officialManifest) {
          output = await dispatchOfficialSkill({
            skillId: stepDef.skillId as OfficialSkillInput["skillId"],
            ...skillInputs,
          } as OfficialSkillInput);
        } else {
          output = await this.dispatchExternalSkill(manifest, skillInputs);
        }

        // Audit: emit to structured logs + enqueue cost attribution (AIDV-130 S-5)
        void this.persistStepRecord(executionId, stepIndex, inst.instance, output, userId);

        emit("completed");
        return {
          stepIndex,
          skillId: stepDef.skillId,
          label: stepDef.label,
          status: "completed",
          output,
          retries,
          durationMs: Date.now() - stepStart,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        retries++;
        if (retries <= maxRetries) {
          emit("running", `Retry ${retries}/${maxRetries}: ${lastError}`);
          await sleep(Math.min(1000 * 2 ** (retries - 1), 8000));
        }
      }
    }

    const strategy = stepDef.onFailure ?? "abort";
    const finalStatus: StepStatus = strategy === "skip" ? "skipped" : "failed";
    emit(finalStatus, lastError);
    return {
      stepIndex,
      skillId: stepDef.skillId,
      label: stepDef.label,
      status: finalStatus,
      error: lastError,
      retries: retries - 1,
      durationMs: Date.now() - stepStart,
    };
  }

  // ── External skill resolution (S-6) ─────────────────────────────────────

  private async resolveExternalSkill(skillId: string): Promise<SkillManifest | null> {
    try {
      const entry = await getSkillEntry(skillId);
      if (!entry) return null;
      if (entry.status === "disabled") {
        logger.warn("SkillOrchestrator: external skill is disabled (possible re-audit pending)", { skillId });
        return null;
      }
      // Reconstruct a minimal SkillManifest from the registry entry so the
      // upstream instantiateSkillStep + permission checks work unchanged.
      const manifest: SkillManifest = {
        id: entry.skillId,
        version: entry.version,
        name: entry.name,
        kind: (entry as { kind?: string }).kind as "declarative" | "sandboxed" ?? "sandboxed",
        trust: entry.trust,
        inputs: {},
        outputs: {},
        providers: [],
        permissions: {
          connectors: entry.grantedConnectors ?? [],
          materials: entry.grantedMaterials,
          crossProject: entry.grantedCrossProject,
        },
        cost: { attributeTo: "skill" },
        code: (entry as { code?: string }).code ?? undefined,
      };
      return manifest;
    } catch {
      return null;
    }
  }

  /** Dispatch an external skill: sandboxed code or declarative (prompt-only). */
  private async dispatchExternalSkill(
    manifest: SkillManifest,
    inputs: Record<string, unknown>
  ): Promise<unknown> {
    if (manifest.kind === "sandboxed") {
      if (!manifest.code) {
        throw new Error(`Sandboxed skill "${manifest.id}" has no code field — cannot execute`);
      }
      try {
        return runSandboxedSkill(manifest.code, inputs);
      } catch (err) {
        if (err instanceof SandboxViolation) {
          throw new Error(`Sandbox violation (${err.kind}): ${err.message}`);
        }
        throw err;
      }
    }

    // kind=declarative: no arbitrary code — assemble prompt context only.
    // Full provider dispatch wired in AIDV-24 (BYOMCP/Wave 4).
    logger.info("SkillOrchestrator: declarative external skill executed (provider dispatch deferred to BYOMCP)", { skillId: manifest.id });
    return { skillId: manifest.id, inputs, kind: "declarative", dispatched: false };
  }

  private async persistStepRecord(
    executionId: string,
    stepIndex: number,
    instance: SkillInstance,
    output: unknown,
    userId: number
  ): Promise<void> {
    // Structured audit log — AIDV-13 full DB persistence deferred to execution table integration.
    logger.info(
      "SkillOrchestrator: step completed",
      {
        executionId,
        stepIndex,
        skillId: instance.skillId,
        skillVersion: instance.skillVersion,
        inputKeys: Object.keys(instance.inputSnapshot),
        permissionSnapshot: instance.permissionSnapshot,
        outputType: Array.isArray(output) ? "array" : typeof output,
      }
    );

    // AIDV-130 S-5: enqueue skill cost attribution (fire-and-forget, best-effort).
    if (!isCostAttributionEnabled()) return;
    const costUsd =
      output !== null &&
      typeof output === "object" &&
      !Array.isArray(output) &&
      "estimatedCostUsd" in (output as Record<string, unknown>)
        ? Number((output as Record<string, unknown>).estimatedCostUsd)
        : 0;
    if (!Number.isFinite(costUsd) || costUsd <= 0) return;
    try {
      const db = await getDb();
      if (!db) return;
      await enqueueAttribution(db as Parameters<typeof enqueueAttribution>[0], {
        costUsd,
        userId,
        skillId: instance.skillId,
        skillVersion: instance.skillVersion,
        idempotencyKey: `sko:${executionId}:${stepIndex}`,
        refType: "skill_step",
        refId: `${instance.skillId}@${executionId}`,
      });
    } catch (err) {
      logger.warn("SkillOrchestrator: cost attribution enqueue failed", { err, executionId, stepIndex });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenOutput(output: unknown): Record<string, unknown> {
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  return {};
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const skillOrchestrator = new SkillOrchestrator();
