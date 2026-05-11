/**
 * server/services/spiritTools/workflowAutomationTools.ts
 *
 * Tools for workflow-automation spirit to manage and execute workflows.
 * Handles template creation, execution, and status tracking.
 */

import { logger } from "../../_core/logger";
import {
  orbWorkflowEngine,
  type CreateTemplateInput,
  type ExecuteWorkflowInput,
  type WorkflowDifficulty,
} from "../orbWorkflowEngine";

/**
 * Create a new workflow template
 */
export async function createWorkflowTemplate(
  input: CreateTemplateInput
): Promise<{
  success: boolean;
  templateId?: number;
  message: string;
}> {
  try {
    const template = await orbWorkflowEngine.createTemplate(input);

    return {
      success: true,
      templateId: template.id,
      message: `工作流程「${template.name}」已建立`,
    };
  } catch (error) {
    logger.error("workflow_automation_create_template_failed", {
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
export async function getWorkflowTemplates(input: {
  category?: string;
  difficulty?: WorkflowDifficulty;
  search?: string;
  limit?: number;
}): Promise<{
  success: boolean;
  templates: Array<{
    id: number;
    name: string;
    description?: string;
    category: string;
    difficulty: string;
    stepCount: number;
    usageCount: number;
    avgRating?: number;
  }>;
  message: string;
}> {
  try {
    const templates = await orbWorkflowEngine.getTemplates({
      category: input.category,
      difficulty: input.difficulty,
      search: input.search,
      limit: input.limit ?? 20,
      isPublic: true,
    });

    return {
      success: true,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        difficulty: t.difficulty,
        stepCount: t.steps.length,
        usageCount: t.usageCount,
        avgRating: t.avgRating,
      })),
      message: `找到 ${templates.length} 個工作流程模板`,
    };
  } catch (error) {
    logger.error("workflow_automation_get_templates_failed", {
      category: input.category,
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
export async function executeWorkflow(
  input: ExecuteWorkflowInput
): Promise<{
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
    logger.error("workflow_automation_execute_failed", {
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
export async function getExecutionStatus(executionId: string): Promise<{
  success: boolean;
  status?: {
    executionId: string;
    status: string;
    currentStep: number;
    totalSteps: number;
    progress: number;
    steps: Array<{
      stepIndex: number;
      stepId: string;
      status: string;
      error?: string;
    }>;
  };
  message: string;
}> {
  try {
    const result = await orbWorkflowEngine.getExecutionStatus(executionId);

    return {
      success: true,
      status: {
        executionId: result.execution.id,
        status: result.execution.status,
        currentStep: result.execution.currentStepIndex,
        totalSteps: result.execution.totalSteps,
        progress:
          result.execution.totalSteps > 0
            ? (result.execution.currentStepIndex / result.execution.totalSteps) *
              100
            : 0,
        steps: result.steps.map(s => ({
          stepIndex: s.stepIndex,
          stepId: s.stepId,
          status: s.status,
          error: s.error,
        })),
      },
      message: "執行狀態已更新",
    };
  } catch (error) {
    logger.error("workflow_automation_get_status_failed", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `取得失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Pause workflow execution
 */
export async function pauseWorkflow(executionId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await orbWorkflowEngine.pauseExecution(executionId);

    return {
      success: true,
      message: "工作流程已暫停",
    };
  } catch (error) {
    logger.error("workflow_automation_pause_failed", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `暫停失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Resume workflow execution
 */
export async function resumeWorkflow(executionId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await orbWorkflowEngine.resumeExecution(executionId);

    return {
      success: true,
      message: "工作流程已繼續執行",
    };
  } catch (error) {
    logger.error("workflow_automation_resume_failed", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `繼續失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Cancel workflow execution
 */
export async function cancelWorkflow(executionId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await orbWorkflowEngine.cancelExecution(executionId);

    return {
      success: true,
      message: "工作流程已取消",
    };
  } catch (error) {
    logger.error("workflow_automation_cancel_failed", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `取消失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get popular workflows
 */
export async function getPopularWorkflows(input?: {
  category?: string;
  limit?: number;
}): Promise<{
  success: boolean;
  workflows: Array<{
    id: number;
    name: string;
    description?: string;
    category: string;
    usageCount: number;
    avgRating?: number;
  }>;
  message: string;
}> {
  try {
    const workflows = await orbWorkflowEngine.getPopularWorkflows(
      input?.category,
      input?.limit ?? 10
    );

    return {
      success: true,
      workflows: workflows.map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        category: w.category,
        usageCount: w.usageCount,
        avgRating: w.avgRating,
      })),
      message: `找到 ${workflows.length} 個熱門工作流程`,
    };
  } catch (error) {
    logger.error("workflow_automation_get_popular_failed", {
      category: input?.category,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      workflows: [],
      message: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
