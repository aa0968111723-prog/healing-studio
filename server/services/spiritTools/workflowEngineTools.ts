/**
 * server/services/spiritTools/workflowEngineTools.ts
 *
 * Tools for workflow template management and execution.
 */

import { logger } from "../../_core/logger";
import { orbWorkflowEngine, type WorkflowDifficulty, type WorkflowStep } from "../orbWorkflowEngine";

/**
 * Create a new workflow template
 */
export async function createWorkflowTemplate(input: {
  creatorUserId: number;
  name: string;
  description?: string;
  category: string;
  isPublic?: boolean;
  steps: WorkflowStep[];
  difficulty?: WorkflowDifficulty;
  tags?: string[];
}): Promise<{
  success: boolean;
  templateId?: number;
  message: string;
}> {
  try {
    const template = await orbWorkflowEngine.createTemplate(input);

    return {
      success: true,
      templateId: template.id,
      message: "工作流程模板已建立",
    };
  } catch (error) {
    logger.error("create_workflow_template_failed", {
      name: input.name,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `建立失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get workflow templates
 */
export async function getWorkflowTemplates(input?: {
  category?: string;
  difficulty?: WorkflowDifficulty;
  isPublic?: boolean;
  search?: string;
  limit?: number;
}): Promise<{
  success: boolean;
  templates: Array<{
    id: number;
    name: string;
    description?: string;
    category: string;
    stepCount: number;
    usageCount: number;
    avgRating?: number;
  }>;
  message: string;
}> {
  try {
    const templates = await orbWorkflowEngine.getTemplates(input);

    return {
      success: true,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        stepCount: t.steps.length,
        usageCount: t.usageCount,
        avgRating: t.avgRating,
      })),
      message: `找到 ${templates.length} 個工作流程模板`,
    };
  } catch (error) {
    logger.error("get_workflow_templates_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      templates: [],
      message: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Execute a workflow
 */
export async function executeWorkflow(input: {
  templateId: number;
  userId: number;
  conversationId?: string;
  inputs?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  executionId?: string;
  message: string;
}> {
  try {
    const execution = await orbWorkflowEngine.executeWorkflow(input);

    return {
      success: true,
      executionId: execution.id,
      message: "工作流程已開始執行",
    };
  } catch (error) {
    logger.error("execute_workflow_failed", {
      templateId: input.templateId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `執行失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get workflow execution status
 */
export async function getWorkflowStatus(executionId: string): Promise<{
  success: boolean;
  status?: {
    executionStatus: string;
    currentStepIndex: number;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
  };
  message: string;
}> {
  try {
    const { execution, steps } = await orbWorkflowEngine.getExecutionStatus(
      executionId
    );

    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const failedSteps = steps.filter((s) => s.status === "failed").length;

    return {
      success: true,
      status: {
        executionStatus: execution.status,
        currentStepIndex: execution.currentStepIndex,
        totalSteps: execution.totalSteps,
        completedSteps,
        failedSteps,
      },
      message: "執行狀態已載入",
    };
  } catch (error) {
    logger.error("get_workflow_status_failed", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Control workflow execution (pause/resume/cancel)
 */
export async function controlWorkflow(input: {
  executionId: string;
  action: "pause" | "resume" | "cancel";
}): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const { executionId, action } = input;

    switch (action) {
      case "pause":
        await orbWorkflowEngine.pauseExecution(executionId);
        break;
      case "resume":
        await orbWorkflowEngine.resumeExecution(executionId);
        break;
      case "cancel":
        await orbWorkflowEngine.cancelExecution(executionId);
        break;
    }

    return {
      success: true,
      message: `工作流程已${action === "pause" ? "暫停" : action === "resume" ? "繼續" : "取消"}`,
    };
  } catch (error) {
    logger.error("control_workflow_failed", {
      executionId: input.executionId,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `操作失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get user's workflow history
 */
export async function getWorkflowHistory(input: {
  userId: number;
  limit?: number;
}): Promise<{
  success: boolean;
  history: Array<{
    executionId: string;
    templateId: number;
    status: string;
    startedAt?: Date;
    completedAt?: Date;
  }>;
  message: string;
}> {
  try {
    const history = await orbWorkflowEngine.getUserWorkflowHistory(
      input.userId,
      input.limit ?? 20
    );

    return {
      success: true,
      history: history.map((h) => ({
        executionId: h.id,
        templateId: h.templateId,
        status: h.status,
        startedAt: h.startedAt,
        completedAt: h.completedAt,
      })),
      message: `找到 ${history.length} 個執行記錄`,
    };
  } catch (error) {
    logger.error("get_workflow_history_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      history: [],
      message: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
