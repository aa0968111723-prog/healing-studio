/**
 * server/services/orbLLMReplan.ts
 *
 * LLM-powered replanning engine for the Orb Agent. Implements the ReAct
 * (Reasoning + Acting) loop's critical "Observation → Replanning" step.
 *
 * When a tool call fails verification or encounters an error, this module
 * invokes the LLM with:
 *   1. The original plan context
 *   2. The observed failure (error code, issues, tool args that failed)
 *   3. Available tool registry + model registry
 *   4. Historical memory of similar failures
 *
 * The LLM returns a revised plan segment that either:
 *   - Fixes the failed step with corrected parameters
 *   - Routes to an alternative tool/model
 *   - Inserts prerequisite steps (e.g., upscale before video)
 *   - Declares the goal unachievable and gracefully degrades
 *
 * This closes Gap #P1 from the AI Agent audit: without this, the orb simply
 * marks tasks as failed and stops, behaving like a traditional RPA script
 * rather than an autonomous agent.
 */

import { invokeLLM, extractMessageText, type Message } from "../_core/llm";
import type { AgentWorkflowStep } from "../../shared/agent-actions";
import type { OrbTask } from "../../shared/orb-agent-contract";
import { summarizeGlobalToolRegistry } from "../../shared/global-agent-tools";
import { searchOrbMemoriesWithRag } from "./orbMemory";
import {
  isRagInjectionGuardEnabled,
  guardRetrievedContext,
} from "./security/ragInjectionGuard";

export interface OrbLLMReplanInput {
  /** The original task context */
  task: OrbTask;
  /** The step that failed */
  failedStep: AgentWorkflowStep;
  /** Observation from the failure (error code, issues, tool args) */
  observation: {
    toolName: string;
    errorCode: string;
    issues: string[];
    toolArgs: unknown;
  };
  /** User critique or additional context */
  critique?: string;
  /** Maximum retry attempts (defaults to 2) */
  maxRetries?: number;
  /** User ID for memory retrieval */
  userId?: number;
  /** Remaining steps in the original plan */
  remainingSteps?: AgentWorkflowStep[];
}

export interface OrbLLMReplanResult {
  /** Whether replanning succeeded */
  success: boolean;
  /** Revised plan segment (replaces failed step + optionally inserts new steps) */
  revisedSteps: AgentWorkflowStep[];
  /** LLM's reasoning for the replan */
  reasoning?: string;
  /** Error if replanning failed */
  error?: string;
  /** Suggested fallback action if no viable replan exists */
  fallbackAction?: "skip" | "abort" | "manual-intervention";
}

function buildReplanPrompt(input: OrbLLMReplanInput): string {
  const toolSummary = summarizeGlobalToolRegistry(40);
  const failedStepSummary = JSON.stringify({
    stepId: input.failedStep.id,
    label: input.failedStep.label,
    actionType: input.failedStep.actionType,
    path: input.failedStep.path,
    payload: input.failedStep.payload,
    toolName: input.failedStep.toolName,
    toolArgs: input.failedStep.toolArgs,
  }, null, 2);

  const observationSummary = JSON.stringify({
    toolName: input.observation.toolName,
    errorCode: input.observation.errorCode,
    issues: input.observation.issues,
    attemptedArgs: input.observation.toolArgs,
  }, null, 2);

  return `# Orb Agent ReAct Loop: Replanning after Tool Failure

You are the replanning module of the Orb AI Agent. A multi-step workflow has encountered a failure that automatic retries could not resolve. Your job is to **analyze the failure and produce a revised plan** that accomplishes the user's original goal via an alternative approach.

## Context

**Original Task:** ${input.task.intent || "Multi-step workflow"}

**Failed Step:**
\`\`\`json
${failedStepSummary}
\`\`\`

**Observation (Failure Details):**
\`\`\`json
${observationSummary}
\`\`\`

${input.critique ? `**User Critique:** ${input.critique}\n` : ""}

**Available Tools:**
${toolSummary}

## Replanning Strategy

Analyze the failure and choose ONE of the following strategies:

### 1. **Fix Parameters** (most common)
- The tool is correct, but parameters are invalid/missing
- Examples:
  - Missing required field (e.g., image_url for video generation)
  - Wrong format (e.g., "512x512" instead of 1024x1024)
  - Invalid model ID
- **Action:** Return the same step with corrected toolArgs

### 2. **Route to Alternative Tool/Model**
- The original tool cannot handle this requirement
- Examples:
  - Model doesn't support the requested resolution
  - Tool lacks a required capability (e.g., transparency, style transfer)
- **Action:** Replace with a different tool from the registry that can handle it

### 3. **Insert Prerequisite Steps**
- The tool needs input that doesn't exist yet
- Examples:
  - Video generation needs an image URL, but no image was generated
  - Upscale requires higher resolution input
- **Action:** Insert new step(s) before the failed step to generate missing inputs

### 4. **Graceful Degradation**
- The original goal is unachievable with available tools
- Examples:
  - User requested 4K video but max resolution is 1080p
  - Requested model is not in registry
- **Action:** Propose a close alternative and mark fallbackAction: "manual-intervention"

### 5. **Abort**
- The failure indicates a fundamental blocker
- Examples:
  - User's account lacks permissions
  - Tool is permanently unavailable
- **Action:** Return fallbackAction: "abort" with reasoning

## Output Format

Respond with a JSON object:

\`\`\`json
{
  "success": true|false,
  "reasoning": "Brief explanation of what went wrong and your fix strategy (2-3 sentences)",
  "revisedSteps": [
    {
      "id": "step_fixed_1",
      "label": "Human-readable label",
      "actionType": "submit",
      "path": "/video-studio",
      "toolName": "studio.generateVideo",
      "toolArgs": {
        "prompt": "...",
        "image_url": "\${step_image_gen.image_url}",
        "duration": 5
      }
    }
  ],
  "fallbackAction": "skip"|"abort"|"manual-intervention"|null
}
\`\`\`

## Critical Rules

1. **Preserve Original Intent:** The revised plan must still accomplish the user's goal
2. **Use Registry Tools Only:** Never invent tool names not in the tool summary
3. **Maintain Step References:** If other steps depend on this step's output, preserve the step ID or update downstream references
4. **Be Specific:** Don't return placeholder values like "TBD" or "待填入" in toolArgs
5. **Limit Scope:** Return ONLY the steps needed to replace the failed one (+ prerequisites if needed). Don't replan the entire workflow.

${input.maxRetries !== undefined ? `**Retry Budget:** This is attempt ${input.maxRetries} — if you cannot find a viable fix, set success: false and explain why.\n` : ""}

Now analyze the failure and produce your replan:`;
}

export async function orbLLMReplan(
  input: OrbLLMReplanInput
): Promise<OrbLLMReplanResult> {
  try {
    // Retrieve relevant historical failures from memory to inform the replan
    let memoryContext = "";
    if (input.userId) {
      try {
        const memories = await searchOrbMemoriesWithRag({
          userId: input.userId,
          query: `${input.observation.toolName} ${input.observation.errorCode} ${input.observation.issues.join(" ")}`,
          limit: 3,
          degradeOnError: true,
        });
        if (memories.length > 0) {
          // AIDV-69：m.summary 來自 RAG 檢索的歷史失敗記憶（由先前使用者 prompt
          // 衍生、untrusted、可能被注入污染後回灌）。旗標 ON 時對「記憶段」過 guard
          // 包裹；buildReplanPrompt 內其他欄位（failedStep / observation / tool
          // registry）是內部受信任狀態，不在此包。旗標 OFF＝下方字串與現狀位元相同。
          const joinedMemories = memories.map(m => `- ${m.summary}`).join("\n");
          memoryContext = isRagInjectionGuardEnabled()
            ? "\n\n" +
              guardRetrievedContext(joinedMemories, { label: "歷史失敗記憶" })
            : "\n\n**Historical Context (similar failures):**\n" + joinedMemories;
        }
      } catch (err) {
        console.warn("[orbLLMReplan] memory retrieval failed:", err);
      }
    }

    const prompt = buildReplanPrompt(input) + memoryContext;

    const messages: Message[] = [
      { role: "system", content: prompt },
      { role: "user", content: "Please analyze the failure and provide your replanning strategy in JSON format." }
    ];

    const result = await invokeLLM({
      messages,
      runName: "orb-agent-replan",
      maxTokens: 1500,
      response_format: { type: "json_object" },
    });

    const rawContent = extractMessageText(result.choices[0]?.message?.content);
    const parsed = JSON.parse(rawContent) as OrbLLMReplanResult;

    // Validate the response
    if (!parsed.revisedSteps || !Array.isArray(parsed.revisedSteps)) {
      return {
        success: false,
        revisedSteps: [],
        error: "LLM response missing revisedSteps array",
        fallbackAction: "abort",
      };
    }

    // Ensure all steps have required fields
    const validatedSteps: AgentWorkflowStep[] = parsed.revisedSteps.map((step, idx) => ({
      id: step.id || `replan_step_${idx}`,
      label: step.label || `Replanned step ${idx + 1}`,
      actionType: step.actionType || "submit",
      path: step.path,
      payload: step.payload,
      toolName: step.toolName,
      toolArgs: step.toolArgs,
      dependsOn: step.dependsOn,
      retryPolicy: step.retryPolicy,
    }));

    return {
      success: parsed.success ?? true,
      revisedSteps: validatedSteps,
      reasoning: parsed.reasoning,
      fallbackAction: parsed.fallbackAction,
    };

  } catch (error) {
    console.error("[orbLLMReplan] replanning failed:", error);
    return {
      success: false,
      revisedSteps: [],
      error: error instanceof Error ? error.message : String(error),
      fallbackAction: "abort",
    };
  }
}

/**
 * Simpler deterministic replanning for common error patterns.
 * Used as a fast path before invoking the LLM.
 */
export function deterministicReplan(
  failedStep: AgentWorkflowStep,
  observation: OrbLLMReplanInput["observation"]
): AgentWorkflowStep[] | null {
  const issues = observation.issues.map(i => i.toLowerCase());
  const args = (observation.toolArgs || {}) as Record<string, unknown>;

  // Pattern 1: Missing image_url for video generation
  if (
    observation.toolName.includes("Video") &&
    issues.some(i => i.includes("image") || i.includes("url")) &&
    !args.image_url
  ) {
    // Need to insert an image generation step before video
    return [
      {
        id: `prereq_image_${Date.now()}`,
        label: "Generate image for video (prerequisite)",
        actionType: "submit",
        // payload is required by AgentWorkflowStep but unused when
        // toolName is set (the type comment says "有值時忽略 actionType/
        // payload"); empty string is the documented placeholder.
        payload: "",
        path: "/studio",
        toolName: "studio.generateImage",
        toolArgs: {
          prompt: args.prompt || "high quality cinematic image",
        },
      },
      {
        ...failedStep,
        id: `${failedStep.id}_retry`,
        dependsOn: [`prereq_image_${Date.now()}`],
        toolArgs: {
          ...args,
          image_url: `\${prereq_image_${Date.now()}.image_url}`,
        },
      },
    ];
  }

  // Pattern 2: Resolution/size mismatch
  if (issues.some(i => i.includes("resolution") || i.includes("size"))) {
    return [
      {
        ...failedStep,
        id: `${failedStep.id}_retry`,
        toolArgs: {
          ...args,
          image_size: "1024x1024",
          resolution: "1024x1024",
        },
      },
    ];
  }

  // Pattern 3: Missing duration for video/audio
  if (
    (observation.toolName.includes("Video") || observation.toolName.includes("Audio")) &&
    issues.some(i => i.includes("duration")) &&
    !args.duration
  ) {
    return [
      {
        ...failedStep,
        id: `${failedStep.id}_retry`,
        toolArgs: {
          ...args,
          duration: 5,
        },
      },
    ];
  }

  return null;
}
