/**
 * server/services/collaborativeTaskPlanner.ts
 *
 * Intelligently decomposes complex tasks into agent-specific subtasks
 * and creates collaborative execution plans.
 */

import type { AgentRole } from "../../shared/orb-agent-roles";
import type {
  AgentSharedContext,
  AgentCollaborationRequest,
} from "../../shared/agent-communication-protocol";
import { AgentCollaborationOrchestrator } from "./agentCollaborationOrchestrator";
import { generateCollaborationId } from "../../shared/agent-communication-protocol";
import { logger } from "../_core/logger";

/** Task decomposition result */
interface TaskDecomposition {
  originalTask: string;
  subtasks: SubTask[];
  executionPlan: ExecutionPlan;
  estimatedDurationMs?: number;
}

/** Individual subtask */
interface SubTask {
  stepId: string;
  description: string;
  assignedAgent: AgentRole;
  requiredTools: string[];
  dependsOn?: string[]; // IDs of prerequisite steps
  estimatedDurationMs?: number;
  priority: "low" | "normal" | "high";
}

/** Execution plan for subtasks */
interface ExecutionPlan {
  planId: string;
  strategy: "sequential" | "parallel" | "mixed";
  stages: ExecutionStage[];
}

/** Execution stage (parallel or sequential) */
interface ExecutionStage {
  stageId: string;
  stageType: "parallel" | "sequential";
  tasks: SubTask[];
}

class CollaborativeTaskPlannerClass {
  /**
   * Analyze task and decompose into agent-specific subtasks
   */
  decomposeTask(
    task: string,
    context: AgentSharedContext
  ): TaskDecomposition {
    // Detect task type and modalities involved
    const taskAnalysis = this.analyzeTaskType(task);

    // Generate subtasks based on task type
    const subtasks = this.generateSubtasks(task, taskAnalysis, context);

    // Create execution plan
    const executionPlan = this.createExecutionPlan(subtasks);

    // Estimate duration
    const estimatedDurationMs = subtasks.reduce(
      (sum, task) => sum + (task.estimatedDurationMs || 30000),
      0
    );

    logger.info("task_decomposed", {
      originalTask: task,
      subtaskCount: subtasks.length,
      strategy: executionPlan.strategy,
      estimatedDurationMs,


    });

    return {
      originalTask: task,
      subtasks,
      executionPlan,
      estimatedDurationMs,
    };
  }

  /**
   * Analyze task to determine type and required agents
   */
  private analyzeTaskType(task: string): {
    requiresImage: boolean;
    requiresVideo: boolean;
    requiresAudio: boolean;
    requiresVoice: boolean;
    requires3D: boolean;
    requiresTraining: boolean;
    requiresLearning: boolean;
    requiresPlanning: boolean;
    requiresResearch: boolean;
    complexity: "simple" | "moderate" | "complex";
  } {
    const lowerTask = task.toLowerCase();

    return {
      requiresImage:
        /圖片|圖像|照片|畫|繪製|image|picture|photo/.test(lowerTask),
      requiresVideo:
        /影片|視頻|video|動畫|animation/.test(lowerTask),
      requiresAudio:
        /音樂|音訊|配樂|audio|music|sound/.test(lowerTask),
      requiresVoice:
        /語音|配音|旁白|voice|narration|dubbing/.test(lowerTask),
      requires3D: /3d|三維|立體/.test(lowerTask),
      requiresTraining:
        /訓練|train|lora|微調|fine-tune/.test(lowerTask),
      requiresLearning:
        /教學|學習|教程|怎麼|如何|tutorial|learn|how to/.test(lowerTask),
      requiresPlanning:
        /計畫|規劃|計劃|workflow|plan|步驟/.test(lowerTask),
      requiresResearch:
        /搜尋|查詢|比較|search|research|compare/.test(lowerTask),
      complexity: this.assessComplexity(lowerTask),
    };
  }

  /**
   * Assess task complexity
   */
  private assessComplexity(task: string): "simple" | "moderate" | "complex" {
    const modalityCount = [
      /圖|image|picture/.test(task),
      /影|video/.test(task),
      /音|audio|music/.test(task),
      /語音|voice/.test(task),
    ].filter(Boolean).length;

    if (modalityCount >= 3) return "complex";
    if (modalityCount === 2) return "moderate";
    return "simple";
  }

  /**
   * Generate subtasks based on analysis
   */
  private generateSubtasks(
    task: string,
    analysis: ReturnType<typeof this.analyzeTaskType>,
    context: AgentSharedContext
  ): SubTask[] {
    const subtasks: SubTask[] = [];
    let stepCounter = 1;

    // Start with planning if complex
    if (analysis.complexity !== "simple" || analysis.requiresPlanning) {
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "規劃整體工作流程與步驟",
        assignedAgent: "director",
        requiredTools: ["director.suggestPlan"],
        priority: "high",
        estimatedDurationMs: 10000,
      });
    }

    // Research phase if needed
    if (analysis.requiresResearch) {
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "搜尋相關資訊與參考資料",
        assignedAgent: "researcher",
        requiredTools: ["research.deepSearch", "inspiration.fetch"],
        dependsOn: subtasks.length > 0 ? [subtasks[subtasks.length - 1].stepId] : undefined,
        priority: "normal",
        estimatedDurationMs: 15000,
      });
    }

    // Image generation
    if (analysis.requiresImage) {
      const prevStep = subtasks.length > 0 ? subtasks[subtasks.length - 1].stepId : undefined;
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "生成圖片素材",
        assignedAgent: "image-specialist",
        requiredTools: ["studio.generateImage"],
        dependsOn: prevStep ? [prevStep] : undefined,
        priority: "high",
        estimatedDurationMs: 30000,
      });
    }

    // 3D generation
    if (analysis.requires3D) {
      const prevStep = subtasks.length > 0 ? subtasks[subtasks.length - 1].stepId : undefined;
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "生成 3D 模型",
        assignedAgent: "image-specialist",
        requiredTools: ["studio.generate3D"],
        dependsOn: prevStep ? [prevStep] : undefined,
        priority: "normal",
        estimatedDurationMs: 60000,
      });
    }

    // Video generation (may depend on image)
    if (analysis.requiresVideo) {
      const deps = [];
      if (analysis.requiresImage && subtasks.length > 0) {
        // Find image generation step
        const imageStep = subtasks.find(s => s.assignedAgent === "image-specialist");
        if (imageStep) deps.push(imageStep.stepId);
      }

      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "生成影片內容",
        assignedAgent: "video-specialist",
        requiredTools: ["studio.generateVideo"],
        dependsOn: deps.length > 0 ? deps : undefined,
        priority: "high",
        estimatedDurationMs: 90000,
      });
    }

    // Audio/Music generation (can be parallel with video)
    if (analysis.requiresAudio) {
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "生成背景音樂",
        assignedAgent: "music-specialist",
        requiredTools: ["studio.generateAudio"],
        priority: "normal",
        estimatedDurationMs: 45000,
      });
    }

    // Voice generation
    if (analysis.requiresVoice) {
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "生成語音旁白",
        assignedAgent: "voice-specialist",
        requiredTools: ["studio.generateVoice"],
        priority: "normal",
        estimatedDurationMs: 30000,
      });
    }

    // Merge audio with video if both exist
    if (analysis.requiresVideo && (analysis.requiresAudio || analysis.requiresVoice)) {
      const deps = [];
      const videoStep = subtasks.find(s => s.assignedAgent === "video-specialist");
      const audioStep = subtasks.find(s => s.assignedAgent === "music-specialist");
      const voiceStep = subtasks.find(s => s.assignedAgent === "voice-specialist");

      if (videoStep) deps.push(videoStep.stepId);
      if (audioStep) deps.push(audioStep.stepId);
      if (voiceStep) deps.push(voiceStep.stepId);

      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "合併影片與音訊",
        assignedAgent: "video-specialist",
        requiredTools: ["studio.mergeAudios"],
        dependsOn: deps,
        priority: "high",
        estimatedDurationMs: 20000,
      });
    }

    // Training tasks
    if (analysis.requiresTraining) {
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "準備訓練資料並執行模型訓練",
        assignedAgent: "training-specialist",
        requiredTools: ["studio.trainLora"],
        priority: "high",
        estimatedDurationMs: 300000, // 5 minutes (actual training is async)
      });
    }

    // Learning/Tutorial tasks
    if (analysis.requiresLearning) {
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "提供教學指導與最佳實踐",
        assignedAgent: "learning-specialist",
        requiredTools: ["research.deepSearch"],
        priority: "normal",
        estimatedDurationMs: 15000,
      });
    }

    // Final review by critic if complex
    if (analysis.complexity === "complex" && subtasks.length > 2) {
      subtasks.push({
        stepId: `step_${stepCounter++}`,
        description: "審查成果並提供改進建議",
        assignedAgent: "critic",
        requiredTools: [],
        dependsOn: [subtasks[subtasks.length - 1].stepId],
        priority: "low",
        estimatedDurationMs: 10000,
      });
    }

    return subtasks;
  }

  /**
   * Create execution plan from subtasks
   */
  private createExecutionPlan(subtasks: SubTask[]): ExecutionPlan {
    const stages: ExecutionStage[] = [];
    const processed = new Set<string>();

    // Group tasks into stages based on dependencies
    while (processed.size < subtasks.length) {
      const parallelTasks: SubTask[] = [];

      // Find tasks with no unprocessed dependencies
      for (const task of subtasks) {
        if (processed.has(task.stepId)) continue;

        const canExecute =
          !task.dependsOn ||
          task.dependsOn.every(depId => processed.has(depId));

        if (canExecute) {
          parallelTasks.push(task);
          processed.add(task.stepId);
        }
      }

      if (parallelTasks.length === 0) break; // Prevent infinite loop

      // Create stage
      stages.push({
        stageId: `stage_${stages.length + 1}`,
        stageType: parallelTasks.length > 1 ? "parallel" : "sequential",
        tasks: parallelTasks,
      });
    }

    // Determine overall strategy
    const hasParallel = stages.some(s => s.stageType === "parallel");
    const strategy = hasParallel ? "mixed" : "sequential";

    return {
      planId: `plan_${Date.now()}`,
      strategy,
      stages,
    };
  }

  /**
   * Create collaboration requests from decomposition
   */
  createCollaborationRequests(
    decomposition: TaskDecomposition,
    context: AgentSharedContext,
    requestingAgent: AgentRole
  ): AgentCollaborationRequest[] {
    return decomposition.subtasks.map(subtask => ({
      requestingAgent,
      targetAgents: subtask.assignedAgent,
      task: subtask.description,
      taskType: this.inferTaskType(subtask.description),
      requiredCapabilities: subtask.requiredTools,
      context: {
        ...context,
        currentStep: parseInt(subtask.stepId.split("_")[1]),
        totalSteps: decomposition.subtasks.length,
      },
      deadline: subtask.estimatedDurationMs,
    }));
  }

  /**
   * Infer task type from description
   */
  private inferTaskType(
    description: string
  ): AgentCollaborationRequest["taskType"] {
    const lower = description.toLowerCase();
    if (/生成|generate|create/.test(lower)) return "generate";
    if (/編輯|修改|edit|modify/.test(lower)) return "edit";
    if (/分析|analyze|review/.test(lower)) return "analyze";
    if (/規劃|計畫|plan/.test(lower)) return "plan";
    if (/學習|教學|learn|teach/.test(lower)) return "learn";
    return "generate";
  }
}

// Singleton instance
export const CollaborativeTaskPlanner = new CollaborativeTaskPlannerClass();

// Export for testing
export { CollaborativeTaskPlannerClass };
export type { TaskDecomposition, SubTask, ExecutionPlan, ExecutionStage };
