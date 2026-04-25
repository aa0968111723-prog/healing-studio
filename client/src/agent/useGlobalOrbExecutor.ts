import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePageAgent } from "@/contexts/PageAgentContext";
import { createGlobalOrbExecutor, type GlobalOrbExecutorState, type GlobalOrbExecutorTask } from "./GlobalOrbExecutor";

function isFlagEnabled(value: string | boolean | undefined, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

export function useGlobalOrbExecutor() {
  const pageAgent = usePageAgent();
  const [locationPath, setLocation] = useLocation();
  const [state, setState] = useState<GlobalOrbExecutorState>({
    taskId: null,
    traceId: null,
    status: "idle",
    currentStepId: null,
    failReason: null,
    retryBudget: 2,
    retryCount: 0,
    steps: [],
  });

  const telemetry = useRef<Array<{ event: string; metadata?: Record<string, unknown> }>>([]);
  const approveTaskMutation = trpc.ai.orbTask.approve.useMutation();
  const cancelTaskMutation = trpc.ai.orbTask.cancel.useMutation();
  const retryTaskMutation = trpc.ai.orbTask.retry.useMutation();
  const completeStepMutation = trpc.ai.orbTask.completeStep.useMutation();
  const failStepMutation = trpc.ai.orbTask.failStep.useMutation();
  const updateStepStatusMutation = trpc.ai.orbTask.updateStepStatus.useMutation();

  const enabled =
    isFlagEnabled(import.meta.env.VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS, true) &&
    isFlagEnabled(import.meta.env.VITE_ENABLE_GLOBAL_ORB_EXECUTOR, true);

  const executor = useMemo(
    () =>
      createGlobalOrbExecutor({
        enabled,
        timeoutMs: 8_000,
        dispatchAction: action => pageAgent.dispatch(action, { source: "ai-chat", requireConfirmation: false, enqueueIfNoHandler: false }),
        navigate: async path => {
          if (path && path !== locationPath) setLocation(path);
        },
        getCurrentPagePath: () => pageAgent.snapshot?.pagePath ?? locationPath,
        waitForPageReady: async (path, timeoutMs) => {
          const started = Date.now();
          while (Date.now() - started < timeoutMs) {
            if (pageAgent.snapshot?.pagePath === path) return true;
            await new Promise(resolve => window.setTimeout(resolve, 120));
          }
          return false;
        },
        onStateChange: next => setState(next),
        onTelemetry: payload => {
          telemetry.current.push({ event: payload.event, metadata: payload.metadata });
          if (telemetry.current.length > 200) telemetry.current.shift();
        },
        api: {
          approve: async taskId => approveTaskMutation.mutateAsync({ taskId }),
          cancel: async (taskId, reason) => cancelTaskMutation.mutateAsync({ taskId, reason }),
          retry: async taskId => retryTaskMutation.mutateAsync({ taskId }),
          completeStep: async input => completeStepMutation.mutateAsync(input),
          failStep: async input => failStepMutation.mutateAsync(input),
          updateStepStatus: async input => updateStepStatusMutation.mutateAsync(input),
        },
      }),
    [enabled, pageAgent, locationPath, setLocation, approveTaskMutation, cancelTaskMutation, retryTaskMutation, completeStepMutation, failStepMutation, updateStepStatusMutation]
  );

  const startTask = useCallback(async (task: GlobalOrbExecutorTask) => executor.start(task), [executor]);
  const cancelTask = useCallback(async (reason?: string) => executor.cancel(reason), [executor]);
  const retryTask = useCallback(async (task: GlobalOrbExecutorTask) => executor.retry(task), [executor]);
  const approveStep = useCallback(async (stepId: string) => executor.approveStep(stepId), [executor]);
  const pauseTask = useCallback(() => executor.pause(), [executor]);
  const requestRecovery = useCallback((task: GlobalOrbExecutorTask) => executor.requestRecovery(task), [executor]);

  return {
    enabled,
    state,
    startTask,
    cancelTask,
    retryTask,
    approveStep,
    pauseTask,
    requestRecovery,
    telemetry: telemetry.current,
  };
}
