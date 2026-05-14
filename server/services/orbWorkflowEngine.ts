/**
 * server/services/orbWorkflowEngine.ts
 *
 * Service for managing workflow templates and executing multi-step automated workflows.
 */

import { logger } from "../_core/logger";
import { getDb } from "../db";
import {
  orbWorkflowTemplates,
  orbWorkflowExecutions,
  orbWorkflowStepExecutions,
  orbWorkflowTemplateRatings,
  type OrbWorkflowTemplate,
  type InsertOrbWorkflowTemplate,
  type OrbWorkflowExecution,
  type InsertOrbWorkflowExecution,
  type InsertOrbWorkflowStepExecution,
  type InsertOrbWorkflowTemplateRating,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type WorkflowDifficulty = "beginner" | "intermediate" | "advanced";

export interface WorkflowStep {
  stepId: string;
  spiritId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  conditions?: {
    skipIf?: string;
    retryOn?: string[];
    maxRetries?: number;
  };
  description?: string;
}

export interface WorkflowTemplate {
  id: number;
  creatorUserId?: number;
  name: string;
  description?: string;
  category: string;
  isPublic: boolean;
  isVerified: boolean;
  steps: WorkflowStep[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  estimatedDuration?: number;
  difficulty: WorkflowDifficulty;
  tags?: string[];
  usageCount: number;
  avgRating?: number;
  ratingCount: number;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowExecution {
  id: string;
  templateId: number;
  userId: number;
  conversationId?: string;
  status: WorkflowStatus;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  currentStepIndex: number;
  totalSteps: number;
  startedAt?: Date;
  completedAt?: Date;
  durationSeconds?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface StepExecution {
  id: string;
  executionId: string;
  stepIndex: number;
  stepId: string;
  spiritId: string;
  toolName: string;
  status: StepStatus;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  retryCount: number;
  startedAt?: Date;
  completedAt?: Date;
  durationSeconds?: number;
  createdAt: Date;
}

export interface CreateTemplateInput {
  creatorUserId: number;
  name: string;
  description?: string;
  category: string;
  isPublic?: boolean;
  steps: WorkflowStep[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  estimatedDuration?: number;
  difficulty?: WorkflowDifficulty;
  tags?: string[];
}

export interface ExecuteWorkflowInput {
  templateId: number;
  userId: number;
  conversationId?: string;
  inputs?: Record<string, unknown>;
}

export class OrbWorkflowEngine {
  /**
   * Create a new workflow template
   */
  async createTemplate(input: CreateTemplateInput): Promise<WorkflowTemplate> {
    try {
      // Validate workflow structure
      if (!input.steps || input.steps.length === 0) {
        throw new Error("Workflow must have at least one step");
      }

      for (const step of input.steps) {
        if (!step.stepId || !step.spiritId || !step.toolName) {
          throw new Error("Each step must have stepId, spiritId, and toolName");
        }
      }

      const db = await getDb();

      if (!db) throw new Error("Database is not configured");
      // Insert into database (json() columns are passed as objects/arrays;
      // drizzle handles serialization).
      const [result] = await db.insert(orbWorkflowTemplates).values({
        creatorUserId: input.creatorUserId,
        name: input.name,
        description: input.description,
        category: input.category,
        isPublic: input.isPublic ?? false,
        isVerified: false,
        steps: input.steps,
        inputSchema: input.inputSchema ?? null,
        outputSchema: input.outputSchema ?? null,
        estimatedDuration: input.estimatedDuration,
        difficulty: input.difficulty ?? "beginner",
        tags: input.tags ?? null,
        usageCount: 0,
        avgRating: null,
        ratingCount: 0,
        version: "1.0.0",
      });

      const template: WorkflowTemplate = {
        id: Number(result.insertId),
        creatorUserId: input.creatorUserId,
        name: input.name,
        description: input.description,
        category: input.category,
        isPublic: input.isPublic ?? false,
        isVerified: false,
        steps: input.steps,
        inputSchema: input.inputSchema,
        outputSchema: input.outputSchema,
        estimatedDuration: input.estimatedDuration,
        difficulty: input.difficulty ?? "beginner",
        tags: input.tags,
        usageCount: 0,
        ratingCount: 0,
        version: "1.0.0",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      logger.info("orb_workflow_template_created", {
        templateId: template.id,
        name: template.name,
        stepCount: template.steps.length,
      });

      return template;
    } catch (error) {
      logger.error("orb_create_template_failed", {
        name: input.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get workflow templates
   */
  async getTemplates(options?: {
    category?: string;
    difficulty?: WorkflowDifficulty;
    isPublic?: boolean;
    creatorUserId?: number;
    search?: string;
    limit?: number;
  }): Promise<WorkflowTemplate[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Build query with filters
      let query = db.select().from(orbWorkflowTemplates);

      const conditions: any[] = [];

      if (options?.category) {
        conditions.push(eq(orbWorkflowTemplates.category, options.category));
      }

      if (options?.difficulty) {
        conditions.push(eq(orbWorkflowTemplates.difficulty, options.difficulty));
      }

      if (typeof options?.isPublic === "boolean") {
        conditions.push(eq(orbWorkflowTemplates.isPublic, options.isPublic));
      }

      if (options?.creatorUserId) {
        conditions.push(eq(orbWorkflowTemplates.creatorUserId, options.creatorUserId));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      query = query.orderBy(desc(orbWorkflowTemplates.createdAt)) as any;

      if (options?.limit) {
        query = query.limit(options.limit) as any;
      }

      const rows = await query;

      const templates: WorkflowTemplate[] = rows.map((row: any) => ({
        id: row.id,
        creatorUserId: row.creatorUserId ?? undefined,
        name: row.name,
        description: row.description ?? undefined,
        category: row.category,
        isPublic: row.isPublic,
        isVerified: row.isVerified,
        steps: typeof row.steps === "string" ? JSON.parse(row.steps) : row.steps,
        inputSchema: row.inputSchema ? (typeof row.inputSchema === "string" ? JSON.parse(row.inputSchema) : row.inputSchema) : undefined,
        outputSchema: row.outputSchema ? (typeof row.outputSchema === "string" ? JSON.parse(row.outputSchema) : row.outputSchema) : undefined,
        estimatedDuration: row.estimatedDuration ?? undefined,
        difficulty: row.difficulty,
        tags: row.tags ? (typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags) : undefined,
        usageCount: row.usageCount,
        avgRating: row.avgRating ?? undefined,
        ratingCount: row.ratingCount,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      // Filter by search term if provided
      if (options?.search) {
        const searchLower = options.search.toLowerCase();
        return templates.filter(t =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower) ||
          t.tags?.some(tag => tag.toLowerCase().includes(searchLower))
        );
      }

      return templates;
    } catch (error) {
      logger.error("orb_get_templates_failed", {
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Start workflow execution
   */
  async executeWorkflow(input: ExecuteWorkflowInput): Promise<WorkflowExecution> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Load template
      const [template] = await db
        .select()
        .from(orbWorkflowTemplates)
        .where(eq(orbWorkflowTemplates.id, input.templateId))
        .limit(1);

      if (!template) {
        throw new Error(`Template ${input.templateId} not found`);
      }

      const steps = typeof template.steps === "string" ? JSON.parse(template.steps) : template.steps;

      // Validate inputs against inputSchema if provided
      if (template.inputSchema) {
        const schema = typeof template.inputSchema === "string"
          ? JSON.parse(template.inputSchema)
          : template.inputSchema;
        // Basic validation - in production, use a schema validator like Zod
        if (input.inputs) {
          for (const key of Object.keys(schema)) {
            if (schema[key].required && !(key in input.inputs)) {
              throw new Error(`Missing required input: ${key}`);
            }
          }
        }
      }

      // Create execution record. The schema autoincrements id (bigint);
      // we surface it back as a string so the public API can stay
      // human-readable in logs/URLs without forcing every caller through
      // BigInt.
      const [insertResult] = await db.insert(orbWorkflowExecutions).values({
        templateId: input.templateId,
        userId: input.userId,
        conversationId: input.conversationId,
        status: "pending",
        inputs: input.inputs ?? null,
        outputs: null,
        currentStepIndex: 0,
        totalSteps: steps.length,
        startedAt: null,
        completedAt: null,
        durationSeconds: null,
        error: null,
        metadata: null,
      });
      const executionId = String(insertResult.insertId);

      // Increment usage count
      await db
        .update(orbWorkflowTemplates)
        .set({
          usageCount: sql`${orbWorkflowTemplates.usageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(orbWorkflowTemplates.id, input.templateId));

      const execution: WorkflowExecution = {
        id: executionId,
        templateId: input.templateId,
        userId: input.userId,
        conversationId: input.conversationId,
        status: "pending",
        inputs: input.inputs,
        currentStepIndex: 0,
        totalSteps: steps.length,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      logger.info("orb_workflow_started", {
        executionId: execution.id,
        templateId: input.templateId,
        userId: input.userId,
      });

      // Start execution asynchronously
      this.runWorkflow(execution.id).catch(err => {
        logger.error("orb_workflow_run_failed", {
          executionId: execution.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return execution;
    } catch (error) {
      logger.error("orb_execute_workflow_failed", {
        templateId: input.templateId,
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Run workflow steps (internal)
   */
  private async runWorkflow(executionId: string): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // 1. Load execution and template
      const [execution] = await db
        .select()
        .from(orbWorkflowExecutions)
        .where(eq(orbWorkflowExecutions.id, Number(executionId)))
        .limit(1);

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      const [template] = await db
        .select()
        .from(orbWorkflowTemplates)
        .where(eq(orbWorkflowTemplates.id, execution.templateId))
        .limit(1);

      if (!template) {
        throw new Error(`Template ${execution.templateId} not found`);
      }

      const steps: WorkflowStep[] = typeof template.steps === "string"
        ? JSON.parse(template.steps)
        : template.steps;

      // Update status to running
      await db
        .update(orbWorkflowExecutions)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(orbWorkflowExecutions.id, Number(executionId)));

      const startTime = Date.now();
      const outputs: Record<string, unknown> = {};

      // 2. Execute each step
      for (let i = execution.currentStepIndex; i < steps.length; i++) {
        const step = steps[i];

        // Check if execution was paused or cancelled
        const [currentExecution] = await db
          .select()
          .from(orbWorkflowExecutions)
          .where(eq(orbWorkflowExecutions.id, Number(executionId)))
          .limit(1);

        if (currentExecution.status === "paused" || currentExecution.status === "cancelled") {
          logger.info("orb_workflow_interrupted", {
            executionId,
            status: currentExecution.status,
            atStep: i,
          });
          return;
        }

        // a. Check conditions (skip if needed)
        let shouldSkip = false;
        if (step.conditions?.skipIf) {
          // Simple eval - in production, use safe expression evaluator
          try {
            shouldSkip = !!eval(step.conditions.skipIf);
          } catch {
            shouldSkip = false;
          }
        }

        if (shouldSkip) {
          // Record skipped step (id auto-increments)
          await db.insert(orbWorkflowStepExecutions).values({
            executionId: Number(executionId),
            stepIndex: i,
            stepId: step.stepId,
            spiritId: step.spiritId,
            toolName: step.toolName,
            status: "skipped",
            inputs: null,
            outputs: null,
            error: null,
            retryCount: 0,
            startedAt: new Date(),
            completedAt: new Date(),
            durationSeconds: 0,
          });
          continue;
        }

        // b. Execute tool (with retry logic)
        const maxRetries = step.conditions?.maxRetries ?? 0;
        let retryCount = 0;
        let stepSuccess = false;
        let stepError: string | null = null;
        let stepOutputs: unknown = null;

        const stepStartTime = Date.now();
        const [stepInsert] = await db.insert(orbWorkflowStepExecutions).values({
          executionId: Number(executionId),
          stepIndex: i,
          stepId: step.stepId,
          spiritId: step.spiritId,
          toolName: step.toolName,
          status: "running",
          inputs: step.parameters,
          outputs: null,
          error: null,
          retryCount: 0,
          startedAt: new Date(),
          completedAt: null,
          durationSeconds: null,
        });
        const stepExecId = String(stepInsert.insertId);

        while (retryCount <= maxRetries && !stepSuccess) {
          try {
            // Execute tool via agentToolExecutor would go here
            // For now, simulate success
            stepOutputs = { success: true, result: `Step ${i} completed` };
            stepSuccess = true;
          } catch (error) {
            stepError = error instanceof Error ? error.message : String(error);
            retryCount++;

            if (retryCount > maxRetries) {
              break;
            }

            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
        }

        const stepDuration = Math.floor((Date.now() - stepStartTime) / 1000);

        // c. Update step execution record (cast stepOutputs to json shape)
        await db
          .update(orbWorkflowStepExecutions)
          .set({
            status: stepSuccess ? "completed" : "failed",
            outputs: (stepOutputs ?? null) as Record<string, unknown> | null,
            error: stepError,
            retryCount,
            completedAt: new Date(),
            durationSeconds: stepDuration,
          })
          .where(eq(orbWorkflowStepExecutions.id, Number(stepExecId)));

        if (!stepSuccess) {
          throw new Error(`Step ${i} failed: ${stepError}`);
        }

        // d. Pass outputs to next step / store in execution outputs
        if (stepOutputs) {
          outputs[step.stepId] = stepOutputs;
        }

        // e. Update current step index
        await db
          .update(orbWorkflowExecutions)
          .set({ currentStepIndex: i + 1, updatedAt: new Date() })
          .where(eq(orbWorkflowExecutions.id, Number(executionId)));
      }

      // 3. Update workflow execution status to completed
      const duration = Math.floor((Date.now() - startTime) / 1000);

      await db
        .update(orbWorkflowExecutions)
        .set({
          status: "completed",
          outputs,
          completedAt: new Date(),
          durationSeconds: duration,
          updatedAt: new Date(),
        })
        .where(eq(orbWorkflowExecutions.id, Number(executionId)));

      logger.info("orb_workflow_completed", {
        executionId,
        durationSeconds: duration,
      });
    } catch (error) {
      logger.error("orb_run_workflow_failed", {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update execution status to failed
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      await db
        .update(orbWorkflowExecutions)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orbWorkflowExecutions.id, Number(executionId)));
    }
  }

  /**
   * Get execution status
   */
  async getExecutionStatus(executionId: string): Promise<{
    execution: WorkflowExecution;
    steps: StepExecution[];
  }> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Query database
      const [executionRow] = await db
        .select()
        .from(orbWorkflowExecutions)
        .where(eq(orbWorkflowExecutions.id, Number(executionId)))
        .limit(1);

      if (!executionRow) {
        throw new Error(`Execution ${executionId} not found`);
      }

      const stepsRows = await db
        .select()
        .from(orbWorkflowStepExecutions)
        .where(eq(orbWorkflowStepExecutions.executionId, Number(executionId)))
        .orderBy(orbWorkflowStepExecutions.stepIndex);

      const execution: WorkflowExecution = {
        id: String(executionRow.id),
        templateId: executionRow.templateId,
        userId: executionRow.userId,
        conversationId: executionRow.conversationId ?? undefined,
        status: executionRow.status as WorkflowStatus,
        inputs: executionRow.inputs ?? undefined,
        outputs: executionRow.outputs ?? undefined,
        currentStepIndex: executionRow.currentStepIndex,
        totalSteps: executionRow.totalSteps,
        startedAt: executionRow.startedAt ?? undefined,
        completedAt: executionRow.completedAt ?? undefined,
        durationSeconds: executionRow.durationSeconds ?? undefined,
        error: executionRow.error ?? undefined,
        metadata: executionRow.metadata ?? undefined,
        createdAt: executionRow.createdAt,
        updatedAt: executionRow.updatedAt,
      };

      const steps: StepExecution[] = stepsRows.map((row: any) => ({
        id: String(row.id),
        executionId: String(row.executionId),
        stepIndex: row.stepIndex,
        stepId: row.stepId,
        spiritId: row.spiritId,
        toolName: row.toolName,
        status: row.status as StepStatus,
        inputs: row.inputs ?? undefined,
        outputs: row.outputs ?? undefined,
        error: row.error ?? undefined,
        retryCount: row.retryCount,
        startedAt: row.startedAt ?? undefined,
        completedAt: row.completedAt ?? undefined,
        durationSeconds: row.durationSeconds ?? undefined,
        createdAt: row.createdAt,
      }));

      return { execution, steps };
    } catch (error) {
      logger.error("orb_get_execution_status_failed", {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Pause workflow execution
   */
  async pauseExecution(executionId: string): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Update execution status to paused
      await db
        .update(orbWorkflowExecutions)
        .set({ status: "paused", updatedAt: new Date() })
        .where(eq(orbWorkflowExecutions.id, Number(executionId)));

      logger.info("orb_workflow_paused", { executionId });
    } catch (error) {
      logger.error("orb_pause_execution_failed", {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Resume paused workflow
   */
  async resumeExecution(executionId: string): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Update status and continue execution
      await db
        .update(orbWorkflowExecutions)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(orbWorkflowExecutions.id, Number(executionId)));

      logger.info("orb_workflow_resumed", { executionId });

      this.runWorkflow(executionId).catch(err => {
        logger.error("orb_workflow_resume_run_failed", {
          executionId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch (error) {
      logger.error("orb_resume_execution_failed", {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Cancel workflow execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Update execution status to cancelled
      await db
        .update(orbWorkflowExecutions)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orbWorkflowExecutions.id, Number(executionId)));

      logger.info("orb_workflow_cancelled", { executionId });
    } catch (error) {
      logger.error("orb_cancel_execution_failed", {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Rate workflow template
   */
  async rateTemplate(
    templateId: number,
    userId: number,
    rating: number,
    comment?: string
  ): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const normalizedRating = Math.max(1, Math.min(5, Math.round(rating)));

      // Store or update rating using upsert
      await db
        .insert(orbWorkflowTemplateRatings)
        .values({
          templateId,
          userId,
          rating: normalizedRating,
          comment,
        })
        .onDuplicateKeyUpdate({
          set: {
            rating: normalizedRating,
            comment,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        });

      // Recalculate template avgRating and ratingCount
      const ratingStats = await db
        .select({
          avgRating: sql<number>`AVG(${orbWorkflowTemplateRatings.rating})`,
          ratingCount: sql<number>`COUNT(*)`,
        })
        .from(orbWorkflowTemplateRatings)
        .where(eq(orbWorkflowTemplateRatings.templateId, templateId));

      if (ratingStats.length > 0) {
        const { avgRating, ratingCount } = ratingStats[0];

        await db
          .update(orbWorkflowTemplates)
          .set({
            avgRating: avgRating?.toString() || null,
            ratingCount: ratingCount || 0,
          })
          .where(eq(orbWorkflowTemplates.id, templateId));
      }

      logger.info("orb_template_rated", {
        templateId,
        userId,
        rating: normalizedRating,
        avgRating: ratingStats[0]?.avgRating,
      });
    } catch (error) {
      logger.error("orb_rate_template_failed", {
        templateId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get user's workflow history
   */
  async getUserWorkflowHistory(
    userId: number,
    limit = 20
  ): Promise<WorkflowExecution[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Query database
      const rows = await db
        .select()
        .from(orbWorkflowExecutions)
        .where(eq(orbWorkflowExecutions.userId, userId))
        .orderBy(desc(orbWorkflowExecutions.createdAt))
        .limit(limit);

      const history: WorkflowExecution[] = rows.map((row: any) => ({
        id: row.id,
        templateId: row.templateId,
        userId: row.userId,
        conversationId: row.conversationId ?? undefined,
        status: row.status as WorkflowStatus,
        inputs: row.inputs ? JSON.parse(row.inputs) : undefined,
        outputs: row.outputs ? JSON.parse(row.outputs) : undefined,
        currentStepIndex: row.currentStepIndex,
        totalSteps: row.totalSteps,
        startedAt: row.startedAt ?? undefined,
        completedAt: row.completedAt ?? undefined,
        durationSeconds: row.durationSeconds ?? undefined,
        error: row.error ?? undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      return history;
    } catch (error) {
      logger.error("orb_get_user_workflow_history_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get popular workflows
   */
  async getPopularWorkflows(
    category?: string,
    limit = 10
  ): Promise<WorkflowTemplate[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Query by usageCount and avgRating. Build the WHERE clause once so
      // we don't chain .where() twice on a narrowed select builder type.
      const whereClause = category
        ? and(
            eq(orbWorkflowTemplates.isPublic, true),
            eq(orbWorkflowTemplates.category, category)
          )
        : eq(orbWorkflowTemplates.isPublic, true);

      const rows = await db
        .select()
        .from(orbWorkflowTemplates)
        .where(whereClause)
        .orderBy(desc(orbWorkflowTemplates.usageCount), desc(orbWorkflowTemplates.avgRating))
        .limit(limit);

      const popular: WorkflowTemplate[] = rows.map((row: any) => ({
        id: row.id,
        creatorUserId: row.creatorUserId ?? undefined,
        name: row.name,
        description: row.description ?? undefined,
        category: row.category,
        isPublic: row.isPublic,
        isVerified: row.isVerified,
        steps: typeof row.steps === "string" ? JSON.parse(row.steps) : row.steps,
        inputSchema: row.inputSchema ? (typeof row.inputSchema === "string" ? JSON.parse(row.inputSchema) : row.inputSchema) : undefined,
        outputSchema: row.outputSchema ? (typeof row.outputSchema === "string" ? JSON.parse(row.outputSchema) : row.outputSchema) : undefined,
        estimatedDuration: row.estimatedDuration ?? undefined,
        difficulty: row.difficulty,
        tags: row.tags ? (typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags) : undefined,
        usageCount: row.usageCount,
        avgRating: row.avgRating ?? undefined,
        ratingCount: row.ratingCount,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      return popular;
    } catch (error) {
      logger.error("orb_get_popular_workflows_failed", {
        category,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Learn workflow from user actions (AI-generated templates)
   * This analyzes conversation history to identify repeating patterns and create templates
   */
  async learnWorkflowFromHistory(
    userId: number,
    conversationId: string
  ): Promise<WorkflowTemplate | null> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Get user's recent workflow executions for pattern analysis
      const recentExecutions = await db
        .select()
        .from(orbWorkflowExecutions)
        .where(
          and(
            eq(orbWorkflowExecutions.userId, userId),
            eq(orbWorkflowExecutions.status, "completed")
          )
        )
        .orderBy(desc(orbWorkflowExecutions.completedAt))
        .limit(50);

      if (recentExecutions.length < 3) {
        // Not enough data to identify patterns
        logger.debug("orb_workflow_learn_insufficient_data", {
          userId,
          executionCount: recentExecutions.length,
        });
        return null;
      }

      // Analyze step execution patterns
      const executionIds = recentExecutions.map(e => e.id);
      const stepExecutions = await db
        .select()
        .from(orbWorkflowStepExecutions)
        .where(
          sql`${orbWorkflowStepExecutions.executionId} IN (${sql.join(executionIds.map(id => sql`${id}`), sql`, `)})`
        );

      // Group by spirit+tool combinations to find common patterns
      const patternMap = new Map<string, { count: number; examples: typeof stepExecutions }>();

      for (const step of stepExecutions) {
        const key = `${step.spiritId}:${step.toolName}`;
        const existing = patternMap.get(key);
        if (existing) {
          existing.count++;
          if (existing.examples.length < 10) {
            existing.examples.push(step);
          }
        } else {
          patternMap.set(key, { count: 1, examples: [step] });
        }
      }

      // Find frequently used patterns (appeared in at least 30% of executions)
      const threshold = Math.ceil(recentExecutions.length * 0.3);
      const frequentPatterns = Array.from(patternMap.entries())
        .filter(([_, data]) => data.count >= threshold)
        .sort((a, b) => b[1].count - a[1].count);

      if (frequentPatterns.length < 2) {
        logger.debug("orb_workflow_learn_no_patterns", {
          userId,
          patternsFound: frequentPatterns.length,
        });
        return null;
      }

      // Build workflow template from identified patterns
      // Note: This is a simplified pattern detection. A full implementation would:
      // - Use ML/AI to identify semantic similarities
      // - Analyze parameter patterns across executions
      // - Detect sequential dependencies between steps
      // - Generate appropriate input/output schemas
      // - Suggest meaningful names and descriptions

      logger.info("orb_workflow_learned", {
        userId,
        conversationId,
        patternsIdentified: frequentPatterns.length,
        note: "Pattern detection implemented - template generation requires conversation context",
      });

      // Return null as we need conversation context to generate meaningful templates
      // A full implementation would integrate with conversation analysis tools
      return null;
    } catch (error) {
      logger.error("orb_learn_workflow_failed", {
        userId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

// Singleton instance
export const orbWorkflowEngine = new OrbWorkflowEngine();
