/**
 * shared/orb-plan-critic.ts
 *
 * Semantic critique pass for `RunWorkflowAction` plans. Layered ABOVE
 * `agent-plan-safety` (which checks risk / capability / known-action) and
 * BELOW the orchestrator itself — the chat router calls `critiquePlan()`
 * after the LLM proposes a workflow, so we can ask the LLM to refine
 * before any UI dispatch lands. This catches the failure modes
 * plan-safety can't: unresolved `${stepN.key}` placeholders, tool-arg
 * shape drift, missing prerequisites (changeVoice without prior
 * cloneVoice), submit-without-prompt, dependsOn cycles.
 *
 * Pure: no I/O, no LLM call. The LLM-side prompt builder lives at the
 * bottom for the "draft → critique → refine" two-pass flow.
 */
import type {
  AgentWorkflowStep,
  RunWorkflowAction,
} from "./agent-actions";
import { getGlobalAgentTool } from "./global-agent-tools";
import { checkModalityCoherence } from "./orb-modality-coherence";

export type PlanCritiqueIssueCode =
  | "unknown-tool"
  | "unresolved-placeholder"
  | "forward-reference"
  | "missing-prerequisite"
  | "redundant-step"
  | "navigate-and-abandon"
  | "submit-without-prompt"
  | "tool-arg-shape"
  | "dependency-cycle"
  | "duplicate-step-id"
  | "modality-mismatch";

export interface PlanCritiqueIssue {
  code: PlanCritiqueIssueCode;
  severity: "warning" | "blocker";
  stepIndex?: number;
  stepId?: string;
  message: string;
  /** Plain-text fix suggestion the planner can paste into the LLM refine prompt. */
  suggestion?: string;
}

export interface PlanCritiqueResult {
  /** 0..100, higher = healthier plan. */
  score: number;
  issues: PlanCritiqueIssue[];
  blockers: PlanCritiqueIssue[];
  warnings: PlanCritiqueIssue[];
  /**
   * True when the score is below `refineBelow` OR there are blockers.
   * The chat router uses this to decide whether to run the LLM refine pass.
   */
  shouldRefine: boolean;
  summary: string;
}

export interface CritiquePlanOptions {
  /** Score threshold for `shouldRefine`; defaults to 75. */
  refineBelow?: number;
  /**
   * When true, redundant consecutive steps are flagged as warnings instead of
   * blockers. Defaults to true (warning) since some templates legitimately
   * repeat fillPrompt to extend prompt text.
   */
  treatRedundantAsWarning?: boolean;
  /**
   * Original user text (most recent user message). When supplied, the critic
   * runs `checkModalityCoherence` against the plan's navigate / setModality
   * steps and flags an explicit `modality-mismatch` blocker if the user asked
   * for video but the plan targets /image-studio (or similar). Omitted →
   * coherence check is skipped (back-compat with existing callers).
   */
  userText?: string;
}

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

function parsePlaceholderRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  let parts = trimmed.split(".").map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === "steps" && parts.length >= 2) parts = parts.slice(1);
  return parts[0] ?? null;
}

function collectPlaceholderRefs(value: unknown, refs: Set<string>) {
  if (typeof value === "string") {
    PLACEHOLDER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
      const stepId = parsePlaceholderRef(match[1]);
      if (stepId) refs.add(stepId);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPlaceholderRefs(item, refs);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectPlaceholderRefs(v, refs);
    }
  }
}

function stepIdOf(step: AgentWorkflowStep, index: number): string {
  return step.id && step.id.length > 0 ? step.id : `step_${index}`;
}

const NAVIGATION_ONLY_ACTION_TYPES = new Set<string>(["navigate", "focusElement"]);

/**
 * Tools whose arguments depend on a prior step's outputs. A plan that
 * uses these tools without a placeholder reference, AND without an
 * upstream tool that could produce that field, is suspicious.
 */
const TOOL_PREREQUISITES: Array<{
  tool: string;
  requiresArgFrom: string;
  produces: string;
  hint: string;
}> = [
  {
    tool: "studio.changeVoice",
    requiresArgFrom: "voice_id",
    produces: "studio.cloneVoice",
    hint: "studio.changeVoice needs voice_id from a prior cloneVoice; use ${cloneStep.voice_id}.",
  },
  {
    tool: "studio.enhanceVideo",
    requiresArgFrom: "video_url",
    produces: "studio.generateVideo",
    hint: "studio.enhanceVideo needs video_url from a prior generateVideo; use ${videoStep.video_url}.",
  },
  {
    tool: "studio.animateSpeaker",
    requiresArgFrom: "audio_url",
    produces: "studio.generateVoice",
    hint: "studio.animateSpeaker needs audio_url; chain it after generateVoice or upload an existing voice clip.",
  },
  {
    tool: "studio.mergeAudios",
    requiresArgFrom: "audio_urls",
    produces: "studio.generateVoice",
    hint: "studio.mergeAudios needs audio_urls; pass an array of upstream voice/SFX outputs.",
  },
];

function checkToolPrereq(
  step: AgentWorkflowStep,
  index: number,
  upstreamToolNames: Set<string>,
  rawArgs: Record<string, unknown> | undefined
): PlanCritiqueIssue | null {
  if (!step.toolName) return null;
  const rule = TOOL_PREREQUISITES.find(r => r.tool === step.toolName);
  if (!rule) return null;
  const argValue = rawArgs?.[rule.requiresArgFrom];
  const hasArg =
    typeof argValue === "string"
      ? argValue.trim().length > 0
      : Array.isArray(argValue)
      ? argValue.length > 0
      : argValue !== undefined && argValue !== null;
  if (!hasArg && !upstreamToolNames.has(rule.produces)) {
    return {
      code: "missing-prerequisite",
      severity: "blocker",
      stepIndex: index,
      stepId: stepIdOf(step, index),
      message: `${step.toolName} requires ${rule.requiresArgFrom} but no upstream ${rule.produces} step produces it`,
      suggestion: rule.hint,
    };
  }
  return null;
}

/**
 * Lightweight tool-arg shape check. We don't do full Zod validation here —
 * the server-side dispatcher does that on the real call. The critic just
 * catches the obvious "the LLM omitted a required scalar" cases so it can
 * refine before the dispatch layer rejects.
 */
function checkToolArgShape(
  step: AgentWorkflowStep,
  index: number
): PlanCritiqueIssue[] {
  if (!step.toolName) return [];
  const tool = getGlobalAgentTool(step.toolName);
  if (!tool) return [];
  const issues: PlanCritiqueIssue[] = [];
  const args = step.toolArgs ?? {};
  for (const [argName, schemaSpec] of Object.entries(tool.allowedArgsSchema)) {
    const isOptional = typeof schemaSpec === "string" && schemaSpec.endsWith("?");
    if (isOptional) continue;
    const present = Object.prototype.hasOwnProperty.call(args, argName);
    if (!present) {
      issues.push({
        code: "tool-arg-shape",
        severity: "blocker",
        stepIndex: index,
        stepId: stepIdOf(step, index),
        message: `${step.toolName} requires arg "${argName}" (declared ${String(schemaSpec)})`,
        suggestion: `add toolArgs.${argName}; tip: prior steps' outputs are visible via \${stepN.key}`,
      });
    }
  }
  return issues;
}

/**
 * Detect cycles in `dependsOn`. orb-dag-scheduler already does this at
 * runtime, but surfacing it here lets the critic refine the plan BEFORE
 * the orchestrator falls back to sequential.
 */
function findDependencyCycle(steps: AgentWorkflowStep[]): string | null {
  const id = (s: AgentWorkflowStep, i: number) => stepIdOf(s, i);
  const idToDeps = new Map<string, string[]>();
  steps.forEach((s, i) => idToDeps.set(id(s, i), s.dependsOn ?? []));

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  idToDeps.forEach((_deps, k) => color.set(k, WHITE));

  let cyclePath: string | null = null;
  const stack: string[] = [];
  function dfs(node: string): boolean {
    color.set(node, GRAY);
    stack.push(node);
    const deps = idToDeps.get(node) ?? [];
    for (let di = 0; di < deps.length; di += 1) {
      const dep = deps[di];
      if (!idToDeps.has(dep)) continue; // unknown dep → not our cycle problem
      if (color.get(dep) === GRAY) {
        const idx = stack.indexOf(dep);
        cyclePath = stack.slice(idx).concat(dep).join(" → ");
        return true;
      }
      if (color.get(dep) === WHITE && dfs(dep)) return true;
    }
    stack.pop();
    color.set(node, BLACK);
    return false;
  }
  const keys = Array.from(idToDeps.keys());
  for (let i = 0; i < keys.length; i += 1) {
    if (color.get(keys[i]) === WHITE) {
      if (dfs(keys[i])) break;
    }
  }
  return cyclePath;
}

/**
 * Run the full critique. Returns a PlanCritiqueResult with score 0..100 —
 * blockers are -25 each, warnings are -8 each, then clamped.
 */
export function critiquePlan(
  plan: RunWorkflowAction,
  options: CritiquePlanOptions = {}
): PlanCritiqueResult {
  const refineBelow = options.refineBelow ?? 75;
  const issues: PlanCritiqueIssue[] = [];
  const steps = plan.steps;

  // 0) Duplicate stable step ids would silently mis-resolve placeholders.
  const seenIds = new Map<string, number>();
  steps.forEach((s, i) => {
    if (!s.id) return;
    if (seenIds.has(s.id)) {
      issues.push({
        code: "duplicate-step-id",
        severity: "blocker",
        stepIndex: i,
        stepId: s.id,
        message: `step id "${s.id}" appears at indexes ${seenIds.get(s.id)} and ${i}`,
        suggestion: "rename one of them; placeholder resolution targets the FIRST match.",
      });
    } else {
      seenIds.set(s.id, i);
    }
  });

  // 1) navigate-only plan is the classic "navigate + abandon" anti-pattern.
  const allNav = steps.length > 0 && steps.every(s =>
    !s.toolName && NAVIGATION_ONLY_ACTION_TYPES.has(s.actionType)
  );
  if (allNav) {
    issues.push({
      code: "navigate-and-abandon",
      severity: "blocker",
      message: "every step is navigate / focusElement — the user is dropped on a page with no actual work scheduled",
      suggestion: "add at least one fillPrompt + submit, or a studio.* tool call.",
    });
  }

  // 2) Per-step checks: tools, placeholders, prerequisites, arg shape.
  const upstreamToolNames = new Set<string>();
  steps.forEach((s, i) => {
    const sid = stepIdOf(s, i);

    // Unknown tool
    if (s.toolName && !getGlobalAgentTool(s.toolName)) {
      issues.push({
        code: "unknown-tool",
        severity: "blocker",
        stepIndex: i,
        stepId: sid,
        message: `unknown tool "${s.toolName}" — not in GLOBAL_AGENT_TOOL_REGISTRY`,
        suggestion: "either remove the toolName or pick a registered tool from the registry.",
      });
    }

    // Forward / unresolved placeholders
    const refs = new Set<string>();
    collectPlaceholderRefs(s.toolArgs, refs);
    collectPlaceholderRefs(s.payload, refs);
    const refList = Array.from(refs);
    for (let r = 0; r < refList.length; r += 1) {
      const ref = refList[r];
      const upstreamIndex = steps.findIndex((u, j) => j < i && stepIdOf(u, j) === ref);
      if (upstreamIndex < 0) {
        // Either forward reference or unknown step.
        const futureIndex = steps.findIndex((u, j) => j >= i && stepIdOf(u, j) === ref);
        if (futureIndex > i) {
          issues.push({
            code: "forward-reference",
            severity: "blocker",
            stepIndex: i,
            stepId: sid,
            message: `step ${sid} references "${ref}" which appears at index ${futureIndex}, AFTER this step`,
            suggestion: "reorder or merge the placeholder into the upstream step's id.",
          });
        } else {
          issues.push({
            code: "unresolved-placeholder",
            severity: "blocker",
            stepIndex: i,
            stepId: sid,
            message: `step ${sid} references unknown step "${ref}"`,
            suggestion: "add the upstream step or fix the placeholder name.",
          });
        }
      }
    }

    // Tool prerequisites + arg shape
    const prereq = checkToolPrereq(s, i, upstreamToolNames, s.toolArgs);
    if (prereq) issues.push(prereq);
    issues.push(...checkToolArgShape(s, i));

    // submit-without-prompt: a submit step on a page where neither this step
    // nor any prior step on the same page filled a prompt is almost always
    // a wasted submit (form is blank).
    if (s.actionType === "submit" && !s.toolName) {
      const samePagePrior = steps.slice(0, i).filter(p => p.path === s.path);
      const hasPrompt = samePagePrior.some(p => p.actionType === "fillPrompt");
      const fillsPromptHere = false; // submit IS the action this step performs
      if (!hasPrompt && !fillsPromptHere) {
        issues.push({
          code: "submit-without-prompt",
          severity: "warning",
          stepIndex: i,
          stepId: sid,
          message: `submit on ${s.path ?? "<no path>"} without a prior fillPrompt on the same page`,
          suggestion: "add a fillPrompt step before submit, or remove the submit if the form is intentionally blank.",
        });
      }
    }

    if (s.toolName) upstreamToolNames.add(s.toolName);
  });

  // 3) Redundant consecutive steps with identical action + payload + tool.
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    const sameAction = a.actionType === b.actionType && a.payload === b.payload && a.path === b.path;
    const sameTool = !!a.toolName && a.toolName === b.toolName &&
      JSON.stringify(a.toolArgs ?? {}) === JSON.stringify(b.toolArgs ?? {});
    if (sameAction && sameTool) {
      issues.push({
        code: "redundant-step",
        severity: options.treatRedundantAsWarning === false ? "blocker" : "warning",
        stepIndex: i,
        stepId: stepIdOf(b, i),
        message: `step ${i} is identical to step ${i - 1}`,
        suggestion: "remove the duplicate or differentiate the args.",
      });
    }
  }

  // 4) Dependency cycle
  const cycle = findDependencyCycle(steps);
  if (cycle) {
    issues.push({
      code: "dependency-cycle",
      severity: "blocker",
      message: `dependsOn forms a cycle: ${cycle}`,
      suggestion: "break the cycle by removing the back-edge dependsOn entry.",
    });
  }

  // 5) Modality coherence — only when caller supplied userText. Catches the
  //    classic "user said video, planner dispatched on /image-studio" defect
  //    BEFORE the plan ships to the orchestrator. We surface as a warning
  //    (not blocker) because the heuristic is keyword-based and we'd rather
  //    let an ambiguous case through than block a valid plan; the refine
  //    pass will see the warning and rebuild against the correct page.
  if (options.userText && options.userText.trim().length > 0) {
    const coherence = checkModalityCoherence({
      userText: options.userText,
      steps: steps.map(s => ({
        action: { type: s.actionType, path: s.path },
        pagePath: s.path,
      })),
    });
    if (coherence.mismatch) {
      issues.push({
        code: "modality-mismatch",
        severity: "warning",
        message: coherence.message,
        suggestion: `Re-plan the step navigation to the ${coherence.declared}-studio page (or set decision.mode='clarification' to confirm).`,
      });
    }
  }

  const blockers = issues.filter(i => i.severity === "blocker");
  const warnings = issues.filter(i => i.severity === "warning");
  const score = Math.max(0, Math.min(100, 100 - blockers.length * 25 - warnings.length * 8));
  const shouldRefine = blockers.length > 0 || score < refineBelow;

  const summary = issues.length === 0
    ? "計畫看起來健康，沒有偵測到問題。"
    : `偵測到 ${blockers.length} 個阻擋與 ${warnings.length} 個警告（分數 ${score}/100）。`;

  return { score, issues, blockers, warnings, shouldRefine, summary };
}

/**
 * Build the LLM refine prompt for the "draft → critique → refine" pass.
 * Caller's responsibility to actually invoke the LLM and parse the
 * response back through `parseLLMActions` / `coerceAgentAction`.
 */
export function buildCritiquePromptForLLM(
  plan: RunWorkflowAction,
  result: PlanCritiqueResult
): string {
  const issuesBlock = result.issues
    .slice(0, 12)
    .map(i => {
      const where = i.stepIndex !== undefined ? ` (step ${i.stepIndex}${i.stepId ? "/" + i.stepId : ""})` : "";
      return `- [${i.severity.toUpperCase()}] ${i.code}${where}: ${i.message}${i.suggestion ? `\n  suggestion: ${i.suggestion}` : ""}`;
    })
    .join("\n");

  return [
    "你剛才提的工作流程有以下品質問題，請依清單修正後重新輸出 RunWorkflowAction JSON。",
    `分數：${result.score}/100`,
    "",
    "問題清單：",
    issuesBlock || "（無）",
    "",
    "原始計畫：",
    JSON.stringify({ name: plan.name, steps: plan.steps }, null, 2),
    "",
    "規則：",
    "1) 只回 JSON 物件，不要加 markdown 或解釋。",
    "2) 保留 type=runWorkflow，保持 step 數量穩定（除非問題明確要求增刪）。",
    "3) 修正後 placeholder 必須引用前面（更小 index）的步驟 id。",
    "4) 工具呼叫必須使用註冊表中存在的 toolName。",
  ].join("\n");
}
