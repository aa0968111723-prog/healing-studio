/**
 * server/services/orbTaskTracer.ts
 *
 * Observability and audit trail for Orb Agent task execution.
 *
 * Implements Gap #P5 from the AI Agent audit: without observability,
 * users cannot answer "why did my task fail?" or "which step was slowest?".
 * Enterprises also need audit trails for compliance.
 *
 * This module provides:
 *   1. Trace ID generation and propagation
 *   2. Structured logging for all tool calls
 *   3. Execution timeline tracking
 *   4. Cost/token tracking
 *   5. Export to external observability platforms (Langfuse, LangSmith, etc.)
 */

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "task" | "step" | "tool" | "llm";
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: "pending" | "success" | "failed" | "cancelled";

  // Context
  userId?: number;
  taskId?: string;
  stepId?: string;
  toolName?: string;

  // Input/Output (sanitized)
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  errorCode?: string;

  // Metrics
  tokensUsed?: number;
  costUsd?: number;
  retryCount?: number;

  // Metadata
  metadata?: Record<string, unknown>;
}

export interface ExecutionTrace {
  traceId: string;
  userId?: number;
  taskId?: string;
  taskIntent?: string;
  startedAt: number;
  endedAt?: number;
  totalDurationMs?: number;
  status: "pending" | "success" | "failed" | "cancelled";
  spans: TraceSpan[];

  // Aggregated metrics
  totalTokens?: number;
  totalCostUsd?: number;
  stepsCompleted: number;
  stepsFailed: number;
  toolCallsTotal: number;
  toolCallsSucceeded: number;

  // Final outcome
  finalReason?: string;
  userFeedback?: "positive" | "negative" | "neutral";
}

class OrbTaskTracer {
  private traces = new Map<string, ExecutionTrace>();
  private readonly MAX_TRACES = 1000; // In-memory cap

  /**
   * Generate a unique trace ID for a new task execution
   */
  generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Start a new trace for a task
   */
  startTrace(input: {
    traceId: string;
    userId?: number;
    taskId?: string;
    taskIntent?: string;
  }): ExecutionTrace {
    const trace: ExecutionTrace = {
      traceId: input.traceId,
      userId: input.userId,
      taskId: input.taskId,
      taskIntent: input.taskIntent,
      startedAt: Date.now(),
      status: "pending",
      spans: [],
      stepsCompleted: 0,
      stepsFailed: 0,
      toolCallsTotal: 0,
      toolCallsSucceeded: 0,
    };

    this.traces.set(input.traceId, trace);

    // Evict oldest if over limit
    if (this.traces.size > this.MAX_TRACES) {
      const oldest = Array.from(this.traces.keys())[0];
      this.traces.delete(oldest);
    }

    return trace;
  }

  /**
   * Add a span (step, tool call, LLM invocation) to a trace
   */
  addSpan(traceId: string, span: Omit<TraceSpan, "traceId">): void {
    const trace = this.traces.get(traceId);
    if (!trace) {
      console.warn(`[tracer] trace ${traceId} not found`);
      return;
    }

    const fullSpan: TraceSpan = {
      ...span,
      traceId,
      spanId: span.spanId || `span_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      startedAt: span.startedAt || Date.now(),
    };

    trace.spans.push(fullSpan);

    // Update aggregated metrics
    if (span.kind === "step") {
      if (span.status === "success") trace.stepsCompleted++;
      if (span.status === "failed") trace.stepsFailed++;
    }

    if (span.kind === "tool") {
      trace.toolCallsTotal++;
      if (span.status === "success") trace.toolCallsSucceeded++;
    }

    if (span.tokensUsed) {
      trace.totalTokens = (trace.totalTokens || 0) + span.tokensUsed;
    }

    if (span.costUsd) {
      trace.totalCostUsd = (trace.totalCostUsd || 0) + span.costUsd;
    }
  }

  /**
   * End a span (calculate duration, finalize status)
   */
  endSpan(traceId: string, spanId: string, result: {
    status: TraceSpan["status"];
    output?: Record<string, unknown>;
    error?: string;
    errorCode?: string;
  }): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find(s => s.spanId === spanId);
    if (!span) return;

    span.endedAt = Date.now();
    span.durationMs = span.endedAt - span.startedAt;
    span.status = result.status;
    span.output = result.output;
    span.error = result.error;
    span.errorCode = result.errorCode;
  }

  /**
   * Complete a trace
   */
  endTrace(traceId: string, result: {
    status: ExecutionTrace["status"];
    finalReason?: string;
  }): ExecutionTrace | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;

    trace.endedAt = Date.now();
    trace.totalDurationMs = trace.endedAt - trace.startedAt;
    trace.status = result.status;
    trace.finalReason = result.finalReason;

    return trace;
  }

  /**
   * Get a trace by ID
   */
  getTrace(traceId: string): ExecutionTrace | null {
    return this.traces.get(traceId) || null;
  }

  /**
   * Get all traces for a user (for debugging)
   */
  getTracesForUser(userId: number, limit = 10): ExecutionTrace[] {
    return Array.from(this.traces.values())
      .filter(t => t.userId === userId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Export trace in a format compatible with external observability tools
   */
  exportTrace(traceId: string, format: "langfuse" | "langsmith" | "otlp" = "langfuse"): unknown {
    const trace = this.getTrace(traceId);
    if (!trace) return null;

    // Langfuse format (simplified)
    if (format === "langfuse") {
      return {
        id: trace.traceId,
        name: trace.taskIntent || "orb-task",
        userId: trace.userId?.toString(),
        metadata: {
          taskId: trace.taskId,
          stepsCompleted: trace.stepsCompleted,
          stepsFailed: trace.stepsFailed,
        },
        timestamp: new Date(trace.startedAt).toISOString(),
        spans: trace.spans.map(span => ({
          id: span.spanId,
          parentId: span.parentSpanId,
          name: span.name,
          startTime: new Date(span.startedAt).toISOString(),
          endTime: span.endedAt ? new Date(span.endedAt).toISOString() : undefined,
          level: span.status === "failed" ? "ERROR" : "DEFAULT",
          input: span.input,
          output: span.output,
          metadata: {
            kind: span.kind,
            toolName: span.toolName,
            errorCode: span.errorCode,
            tokensUsed: span.tokensUsed,
            costUsd: span.costUsd,
          },
        })),
      };
    }

    // Add other formats as needed
    return trace;
  }

  /**
   * Get execution timeline for visualization
   */
  getTimeline(traceId: string): Array<{
    name: string;
    startMs: number;
    durationMs: number;
    status: string;
    kind: string;
  }> {
    const trace = this.getTrace(traceId);
    if (!trace) return [];

    const baseTime = trace.startedAt;

    return trace.spans
      .filter(s => s.endedAt)
      .map(s => ({
        name: s.name,
        startMs: s.startedAt - baseTime,
        durationMs: s.durationMs || 0,
        status: s.status,
        kind: s.kind,
      }))
      .sort((a, b) => a.startMs - b.startMs);
  }

  /**
   * Analyze failure patterns across traces
   */
  analyzeFailurePatterns(userId?: number): {
    mostCommonErrors: Array<{ errorCode: string; count: number; avgRetries: number }>;
    slowestSteps: Array<{ stepName: string; avgDurationMs: number }>;
    reliabilityByTool: Array<{ toolName: string; successRate: number; totalCalls: number }>;
  } {
    const relevantTraces = userId
      ? Array.from(this.traces.values()).filter(t => t.userId === userId)
      : Array.from(this.traces.values());

    // Error frequency
    const errorCounts = new Map<string, { count: number; retries: number[] }>();
    const stepDurations = new Map<string, number[]>();
    const toolStats = new Map<string, { success: number; total: number }>();

    for (const trace of relevantTraces) {
      for (const span of trace.spans) {
        // Track errors
        if (span.errorCode) {
          const entry = errorCounts.get(span.errorCode) || { count: 0, retries: [] };
          entry.count++;
          if (span.retryCount) entry.retries.push(span.retryCount);
          errorCounts.set(span.errorCode, entry);
        }

        // Track step durations
        if (span.kind === "step" && span.durationMs) {
          const durations = stepDurations.get(span.name) || [];
          durations.push(span.durationMs);
          stepDurations.set(span.name, durations);
        }

        // Track tool reliability
        if (span.kind === "tool" && span.toolName) {
          const stats = toolStats.get(span.toolName) || { success: 0, total: 0 };
          stats.total++;
          if (span.status === "success") stats.success++;
          toolStats.set(span.toolName, stats);
        }
      }
    }

    return {
      mostCommonErrors: Array.from(errorCounts.entries())
        .map(([code, data]) => ({
          errorCode: code,
          count: data.count,
          avgRetries: data.retries.length > 0
            ? data.retries.reduce((a, b) => a + b, 0) / data.retries.length
            : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),

      slowestSteps: Array.from(stepDurations.entries())
        .map(([name, durations]) => ({
          stepName: name,
          avgDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length,
        }))
        .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
        .slice(0, 10),

      reliabilityByTool: Array.from(toolStats.entries())
        .map(([name, stats]) => ({
          toolName: name,
          successRate: stats.success / stats.total,
          totalCalls: stats.total,
        }))
        .sort((a, b) => a.successRate - b.successRate)
        .slice(0, 15),
    };
  }
}

// Singleton instance
export const orbTaskTracer = new OrbTaskTracer();

/**
 * Structured logging helper for tool calls
 */
export function logToolCall(args: {
  traceId: string;
  spanId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
  durationMs: number;
  tokensUsed?: number;
}): void {
  const sanitizedInput = sanitizeForLogging(args.input);
  const sanitizedOutput = sanitizeForLogging(args.output);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: args.error ? "ERROR" : "INFO",
    traceId: args.traceId,
    spanId: args.spanId,
    kind: "tool_call",
    toolName: args.toolName,
    input: sanitizedInput,
    output: args.error ? undefined : sanitizedOutput,
    error: args.error,
    durationMs: args.durationMs,
    tokensUsed: args.tokensUsed,
  }));
}

/**
 * Sanitize sensitive data before logging
 */
function sanitizeForLogging(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Redact sensitive fields
    if (
      lowerKey.includes("password") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("token") ||
      lowerKey.includes("key") && lowerKey.includes("api")
    ) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof val === "string" && val.length > 500) {
      // Truncate long strings
      sanitized[key] = val.slice(0, 500) + "...[truncated]";
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}
