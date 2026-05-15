/**
 * OrbTaskProgressTracker.tsx - Real-time visualization of multi-step task execution
 *
 * Shows the progress of complex tasks orchestrated by the Orb Agent, including:
 * - Current step and overall progress
 * - Spirit handoffs and collaborations
 * - Execution timeline
 * - Pause/resume/cancel controls
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  X,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  Clock,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface TaskStep {
  stepId: string;
  stepName: string;
  spiritId: string;
  spiritName: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  error?: string;
  toolsUsed?: string[];
}

export interface TaskExecution {
  executionId: string;
  taskName: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  totalSteps: number;
  completedSteps: number;
  currentStep?: string;
  steps: TaskStep[];
  spiritsInvolved: string[];
  startedAt: number;
  estimatedCompletionTime?: number;
  completedAt?: number;
  error?: string;
}

interface OrbTaskProgressTrackerProps {
  execution: TaskExecution;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  compact?: boolean;
}

export default function OrbTaskProgressTracker({
  execution,
  onPause,
  onResume,
  onCancel,
  compact = false,
}: OrbTaskProgressTrackerProps) {
  const [isExpanded, setIsExpanded] = useState(!compact);

  const progressPercentage = (execution.completedSteps / execution.totalSteps) * 100;
  const isRunning = execution.status === "running";
  const isPaused = execution.status === "paused";
  const isCompleted = execution.status === "completed";
  const isFailed = execution.status === "failed";
  const isCancelled = execution.status === "cancelled";

  const getStepIcon = (step: TaskStep) => {
    switch (step.status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "running":
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case "failed":
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case "skipped":
        return <Circle className="w-4 h-4 text-muted-foreground/70" />;
      default:
        return <Circle className="w-4 h-4 text-muted-foreground/70" />;
    }
  };

  const getStatusBadge = () => {
    if (isCompleted) {
      return (
        <Badge variant="default" className="bg-emerald-500">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          已完成
        </Badge>
      );
    }
    if (isFailed) {
      return (
        <Badge variant="destructive">
          <AlertTriangle className="w-3 h-3 mr-1" />
          失敗
        </Badge>
      );
    }
    if (isCancelled) {
      return <Badge variant="secondary">已取消</Badge>;
    }
    if (isPaused) {
      return (
        <Badge variant="secondary">
          <Pause className="w-3 h-3 mr-1" />
          已暫停
        </Badge>
      );
    }
    if (isRunning) {
      return (
        <Badge variant="default" className="bg-blue-500">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          執行中
        </Badge>
      );
    }
    return <Badge variant="outline">等待中</Badge>;
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  };

  const elapsedTime = execution.completedAt
    ? execution.completedAt - execution.startedAt
    : Date.now() - execution.startedAt;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              {execution.taskName}
            </CardTitle>
            <div className="flex items-center gap-2 mt-2">
              {getStatusBadge()}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDuration(elapsedTime)}
              </span>
              {execution.spiritsInvolved.length > 1 && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {execution.spiritsInvolved.length} 個精靈協作
                </span>
              )}
            </div>
          </div>

          {/* Control buttons */}
          {(isRunning || isPaused) && (
            <div className="flex gap-1">
              {isRunning && onPause && (
                <Button size="sm" variant="outline" onClick={onPause}>
                  <Pause className="w-3 h-3" />
                </Button>
              )}
              {isPaused && onResume && (
                <Button size="sm" variant="outline" onClick={onResume}>
                  <Play className="w-3 h-3" />
                </Button>
              )}
              {onCancel && (
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              步驟 {execution.completedSteps} / {execution.totalSteps}
            </span>
            <span>{Math.round(progressPercentage)}%</span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>

        {/* Error message */}
        {isFailed && execution.error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{execution.error}</p>
          </div>
        )}

        {/* Step list */}
        {!compact && (
          <div className="space-y-2">
            {execution.steps.map((step) => (
              <div
                key={step.stepId}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg transition-colors",
                  step.status === "running" && "bg-blue-50",
                  step.status === "completed" && "bg-emerald-50/50",
                  step.status === "failed" && "bg-red-50"
                )}
              >
                {getStepIcon(step)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        step.status === "pending" && "text-muted-foreground",
                        step.status === "skipped" && "text-muted-foreground/70 line-through"
                      )}
                    >
                      {step.stepName}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {step.spiritName}
                    </Badge>
                  </div>

                  {/* Step details */}
                  {step.status !== "pending" && (
                    <div className="mt-1 text-xs text-muted-foreground space-y-1">
                      {step.duration && (
                        <p>耗時: {formatDuration(step.duration)}</p>
                      )}
                      {step.toolsUsed && step.toolsUsed.length > 0 && (
                        <p>使用工具: {step.toolsUsed.join(", ")}</p>
                      )}
                      {step.error && (
                        <p className="text-red-600 mt-1">{step.error}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Estimated completion time */}
        {isRunning && execution.estimatedCompletionTime && (
          <div className="text-xs text-muted-foreground text-center">
            預計還需要 {formatDuration(execution.estimatedCompletionTime - Date.now())}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
