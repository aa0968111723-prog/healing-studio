/**
 * GlobalOrbChatContext.tsx — 全站光球聊天狀態管理
 *
 * Keeps the existing Orb chat UX, routes structured actions through the global
 * orchestrator, adds deterministic Director workflow fallback, exposes a global
 * workflow execution status panel, and gates workflows behind an explicit user
 * confirmation card.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { useGlobalOrbExecutor } from "@/agent/useGlobalOrbExecutor";
import { usePersonality } from "./PersonalityContext";
import { usePageAgent, parseLLMActions, adaptAgentPlanToActions, type AgentAction } from "./PageAgentContext";
import { useLocation } from "wouter";
import { executeGlobalActions, shouldAskBeforeAct } from "../../../shared/global-agent-orchestrator";
import { globalAgentRegistry } from "../../../shared/global-agent-registry";
import { detectChatIntent } from "../../../shared/global-agent-workflows";
import {
  chatMessageToLLMContent,
  type OrbChatAttachment,
  type OrbChatAttachmentMimeType,
} from "../../../shared/orb-chat-multimodal";
import {
  buildProcessUrl,
  workflowActionToProcessSpec,
} from "../../../shared/orb-process-link";
import { appendProcessLinkToReply } from "../../../shared/orb-reply-process-extractor";
import type { RunWorkflowAction } from "../../../shared/agent-actions";
import type { GlobalOrbExecutorTask } from "@/agent/GlobalOrbExecutor";

export {
  getPageLabelByPath,
  formatRelativeTime,
  formatMessageMetadata,
  getPageEmoji,
} from "@/lib/orbChatHelpers";

export type ChatRole = "user" | "orb";
export type ChatAttachmentKind = "image" | "video" | "audio" | "pdf";
export type ChatAttachmentMimeType = OrbChatAttachmentMimeType;

export interface ChatAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: ChatAttachmentMimeType;
  kind: ChatAttachmentKind;
}

export interface ChatWebSource {
  title: string;
  url: string;
  source?: string;
}

export interface ChatMessage {
  role: ChatRole;
  text: string;
  at: number;
  attachments?: ChatAttachment[];
  intent?: string;
  pagePath?: string;
  actions?: AgentAction[];
  /** Web sources cited by the orb (Brave / GitHub) for research-style answers. */
  webSources?: ChatWebSource[];
}

export interface ChatSuggestion {
  text: string;
  action?: AgentAction;
}

export type WorkflowExecutionStatus = "idle" | "running" | "completed" | "failed";
export type WorkflowExecutionStepStatus = "pending" | "running" | "completed" | "failed";
export type PendingWorkflowSource = "llm" | "fallback";

type WorkflowAction = Extract<AgentAction, { type: "runWorkflow" }>;

export interface WorkflowExecutionStepState {
  index: number;
  label: string;
  path?: string;
  actionType: AgentAction["type"] | string;
  status: WorkflowExecutionStepStatus;
  reason?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkflowExecutionState {
  id: string;
  name: string;
  status: WorkflowExecutionStatus;
  currentIndex: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  steps: WorkflowExecutionStepState[];
}

export interface PendingWorkflowPlan {
  id: string;
  name: string;
  source: PendingWorkflowSource;
  intent?: string;
  userText: string;
  actions: AgentAction[];
  total: number;
  createdAt: number;
  steps: WorkflowExecutionStepState[];
}

export interface PendingExecutorTask {
  task: GlobalOrbExecutorTask;
  requiresHumanReason?: string;
  affectedPages: string[];
}

export interface PendingClarificationPrompt {
  /** Unique id for React keying / accessibility. */
  id: string;
  question: string;
  options?: string[];
  originalUserText: string;
  createdAt: number;
}

export interface PendingCodeTaskPreview {
  codeTaskId: string;
  taskId: string;
  title: string;
  objective: string;
  provider: "claudeCode" | "codex" | "manual";
  filesAllowed: string[];
  filesForbidden: string[];
  riskLevel: "low" | "medium" | "high";
  testCommands: string[];
  rollbackPlan: string;
  status: string;
  prUrl?: string;
  branchName?: string;
  testStatusSummary?: string;
}

const STORAGE_KEY_MESSAGES = "orb-chat-messages";
const STORAGE_KEY_TIMESTAMP = "orb-chat-timestamp";
const STORAGE_KEY_CLARIFICATION = "orb-chat-pending-clarification";
const MAX_STORED_MESSAGES = 100;
const STORAGE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function inferUserMultimodalIntent(text: string): string {
  const q = text.toLowerCase();
  const hit = (keys: string[]) => keys.some(k => q.includes(k));
  if (hit(["文生圖", "生圖", "圖片", "圖像", "海報", "插畫", "photo", "image"])) return "偏向圖片創作需求（建議 image-studio / studio.image）";
  if (hit(["文生影", "圖生影", "影片", "短片", "運鏡", "video", "reel"])) return "偏向影片創作需求（建議 video-studio / studio.video）";
  if (hit(["配樂", "音樂", "bgm", "聲音", "sfx", "music", "audio"])) return "偏向音樂/音效需求（建議 pro-studio.audio）";
  if (hit(["配音", "旁白", "語音", "tts", "voice", "朗讀"])) return "偏向語音需求（建議 pro-studio.voice）";
  if (hit(["腳本", "分鏡", "企劃", "導演", "storyboard", "script"])) return "偏向前期腳本規劃（建議 director）";
  if (hit(["全站模型", "全部模型", "模型總覽", "多模態"])) return "偏向全站模型導覽（建議先去 studio，再分流 image/video/audio/voice）";
  return "意圖未明，先用 1-2 句追問成品與用途後再分流";
}

function summarizeProviderPing(pingData: unknown): string {
  if (!pingData || typeof pingData !== "object") return "後端服務狀態未知";
  const entries = Object.entries(pingData as Record<string, { ok?: boolean; latencyMs?: number | null; error?: string }>);
  if (!entries.length) return "後端服務清單為空";
  const online = entries.filter(([, v]) => v?.ok).map(([k]) => k);
  const offline = entries.filter(([, v]) => v && v.ok === false).map(([k]) => k);
  const summary = `後端連線 ${online.length}/${entries.length} 在線`;
  return offline.length ? `${summary}；離線: ${offline.join(", ")}` : summary;
}

function loadMessagesFromStorage(): ChatMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_MESSAGES);
    const timestamp = localStorage.getItem(STORAGE_KEY_TIMESTAMP);
    if (!stored || !timestamp) return [];
    const savedAt = parseInt(timestamp, 10);
    if (isNaN(savedAt) || Date.now() - savedAt > STORAGE_EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY_MESSAGES);
      localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
      return [];
    }
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.slice(-MAX_STORED_MESSAGES) : [];
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to load messages from storage:", err);
    return [];
  }
}

function saveMessagesToStorage(messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
    localStorage.setItem(STORAGE_KEY_TIMESTAMP, Date.now().toString());
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to save messages to storage:", err);
  }
}

function clearMessagesFromStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY_MESSAGES);
    localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
    localStorage.removeItem(STORAGE_KEY_CLARIFICATION);
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to clear messages from storage:", err);
  }
}

/**
 * Pending clarification persistence — uses the same 7-day expiry window as the
 * chat history so a partially-asked question survives page reloads, but doesn't
 * outlive a stale conversation.
 */
function loadClarificationFromStorage(): {
  prompt: PendingClarificationPrompt | null;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CLARIFICATION);
    if (!raw) return { prompt: null };
    const parsed = JSON.parse(raw) as PendingClarificationPrompt & { savedAt?: number };
    if (typeof parsed?.createdAt !== "number") return { prompt: null };
    const age = Date.now() - parsed.createdAt;
    if (age > STORAGE_EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY_CLARIFICATION);
      return { prompt: null };
    }
    return {
      prompt: {
        id: String(parsed.id ?? `clarify_${parsed.createdAt}`),
        question: String(parsed.question ?? ""),
        options: Array.isArray(parsed.options) ? parsed.options : undefined,
        originalUserText: String(parsed.originalUserText ?? ""),
        createdAt: parsed.createdAt,
      },
    };
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to load clarification from storage:", err);
    return { prompt: null };
  }
}

function saveClarificationToStorage(prompt: PendingClarificationPrompt | null) {
  try {
    if (prompt) {
      localStorage.setItem(STORAGE_KEY_CLARIFICATION, JSON.stringify(prompt));
    } else {
      localStorage.removeItem(STORAGE_KEY_CLARIFICATION);
    }
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to save clarification to storage:", err);
  }
}

function toLLMMessageContent(message: ChatMessage): string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "file_url"; file_url: { url: string; mime_type: ChatAttachmentMimeType } }
> {
  return chatMessageToLLMContent({
    text: message.text,
    attachments: (message.attachments ?? []) as OrbChatAttachment[],
  });
}

/**
 * Issue #160 — pure helpers used by both the live Context and the unit tests
 * in `client/workflow-confirmation.test.ts`. Exported (instead of file-local)
 * so vitest can pin the cross-page state machine without rendering React.
 */
export function findWorkflowAction(actions: AgentAction[]): WorkflowAction | null {
  return actions.find((action): action is WorkflowAction => action.type === "runWorkflow") ?? null;
}

export function workflowStepsToState(workflow: WorkflowAction, mode: "pending" | "running", now: number): WorkflowExecutionStepState[] {
  return workflow.steps.map((step, index) => ({
    index,
    label: step.label || `${index + 1}. ${step.actionType}`,
    path: step.path,
    actionType: step.actionType,
    status: mode === "running" && index === 0 ? "running" : "pending",
    startedAt: mode === "running" && index === 0 ? now : undefined,
  }));
}

export function buildWorkflowExecutionState(actions: AgentAction[], now: number = Date.now()): WorkflowExecutionState | null {
  const workflow = findWorkflowAction(actions);
  if (!workflow) return null;
  const total = workflow.steps.length;
  return {
    id: `wf-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: workflow.name,
    status: "running",
    currentIndex: 0,
    total,
    startedAt: now,
    steps: workflowStepsToState(workflow, "running", now),
  };
}

export function buildPendingWorkflowPlan({
  actions,
  userText,
  intent,
  source,
  now = Date.now(),
}: {
  actions: AgentAction[];
  userText: string;
  intent?: string;
  source: PendingWorkflowSource;
  now?: number;
}): PendingWorkflowPlan | null {
  const workflow = findWorkflowAction(actions);
  if (!workflow) return null;
  return {
    id: `pending-wf-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: workflow.name,
    source,
    intent,
    userText,
    actions,
    total: workflow.steps.length,
    createdAt: now,
    steps: workflowStepsToState(workflow, "pending", now),
  };
}

// ── State machine reducers (Issue #160) ────────────────────────────────────
// These mirror the inline `setWorkflowExecution(prev => ...)` callbacks in
// `executeActions` below, but are extracted as pure functions so the
// cross-page step transitions can be unit-tested without React/SSE.

export interface WorkflowStepAdvance {
  index: number;
  label: string;
  path?: string;
  actionType: string;
}

/**
 * Move a workflow execution forward to the given step index. Steps before the
 * new index are completed, the matching step becomes running, and later steps
 * stay pending. This is the same logic the orchestrator's `onWorkflowStep`
 * callback applies inline — extracting it lets us assert the cross-page
 * progress-bar behaviour without rendering React.
 */
export function advanceWorkflowStep(
  prev: WorkflowExecutionState,
  step: WorkflowStepAdvance,
  now: number = Date.now()
): WorkflowExecutionState {
  return {
    ...prev,
    status: "running",
    currentIndex: step.index,
    steps: prev.steps.map(existing => {
      if (existing.index < step.index) {
        return {
          ...existing,
          status: "completed" as const,
          completedAt: existing.completedAt ?? now,
        };
      }
      if (existing.index === step.index) {
        return {
          ...existing,
          status: "running" as const,
          label: step.label,
          path: step.path,
          actionType: step.actionType,
          startedAt: existing.startedAt ?? now,
        };
      }
      return existing.status === "pending" ? existing : { ...existing, status: "pending" as const };
    }),
  };
}

/**
 * Mark the current step as failed and freeze the workflow. Used both by the
 * orchestrator failure handler and the catch-block error path.
 */
export function failWorkflowAtCurrentStep(
  prev: WorkflowExecutionState,
  reason: string,
  now: number = Date.now()
): WorkflowExecutionState {
  return {
    ...prev,
    status: "failed",
    error: reason,
    completedAt: now,
    steps: prev.steps.map(step =>
      step.index === prev.currentIndex
        ? { ...step, status: "failed" as const, reason, completedAt: now }
        : step
    ),
  };
}

/** Mark the workflow as fully completed. */
export function completeWorkflow(
  prev: WorkflowExecutionState,
  now: number = Date.now()
): WorkflowExecutionState {
  return {
    ...prev,
    status: "completed",
    currentIndex: Math.max(prev.total - 1, 0),
    completedAt: now,
    steps: prev.steps.map(step => ({
      ...step,
      status: "completed" as const,
      completedAt: step.completedAt ?? now,
    })),
  };
}

function statusDotClass(status: WorkflowExecutionStepStatus): string {
  switch (status) {
    case "completed":
      return "text-emerald-300";
    case "running":
      return "text-cyan-300";
    case "failed":
      return "text-rose-300";
    default:
      return "text-white/30";
  }
}

function statusDot(status: WorkflowExecutionStepStatus): string {
  switch (status) {
    case "completed":
      return "●";
    case "running":
      return "◐";
    case "failed":
      return "×";
    default:
      return "○";
  }
}

function ClarificationPromptCard({
  prompt,
  isBusy,
  onAnswer,
  onCancel,
}: {
  prompt: PendingClarificationPrompt | null;
  isBusy: boolean;
  onAnswer: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft("");
  }, [prompt?.id]);

  if (!prompt) return null;
  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAnswer(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-label="光球需要先確認需求"
      data-testid="orb-clarification-card"
      className="fixed bottom-24 right-5 z-[88] w-[380px] max-w-[calc(100vw-2rem)] rounded-3xl border border-amber-200/30 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl"
    >
      <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">
        先確認一下
      </div>
      <div data-testid="orb-clarification-question" className="mt-1 text-base font-semibold">{prompt.question}</div>
      <div className="mt-2 text-xs text-white/60">
        我需要先和你確認，避免做錯方向。選一個最接近的答案，或自己補充。
      </div>

      {prompt.options && prompt.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {prompt.options.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => submit(option)}
              disabled={isBusy}
              className="rounded-2xl bg-amber-200/15 px-3 py-1.5 text-xs text-amber-100 transition hover:bg-amber-200/25 disabled:opacity-50"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          rows={2}
          placeholder="也可以自己用一句話說明..."
          className="w-full rounded-2xl border border-white/10 bg-white/5 p-2 text-sm text-white placeholder:text-white/40 focus:border-amber-200/40 focus:outline-none"
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
          disabled={isBusy}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/15 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => submit(draft)}
            disabled={isBusy || draft.trim().length === 0}
            className="rounded-2xl bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
          >
            傳給光球
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkflowConfirmationCard({
  pendingWorkflow,
  isBusy,
  onStart,
  onRevise,
  onCancel,
}: {
  pendingWorkflow: PendingWorkflowPlan | null;
  isBusy: boolean;
  onStart: () => void;
  onRevise: () => void;
  onCancel: () => void;
}) {
  if (!pendingWorkflow) return null;
  const previewSteps = pendingWorkflow.steps.slice(0, 5);
  const remaining = Math.max(pendingWorkflow.steps.length - previewSteps.length, 0);

  return (
    <div className="fixed bottom-24 right-5 z-[85] w-[380px] max-w-[calc(100vw-2rem)] rounded-3xl border border-cyan-200/20 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">需要你的確認</div>
      <div className="mt-1 text-base font-semibold">{pendingWorkflow.name}</div>
      <div className="mt-2 text-sm leading-6 text-white/70">
        我已整理好 {pendingWorkflow.total} 步流程。按下「開始執行」後，我才會開始跨頁操作。
      </div>

      <div className="mt-3 rounded-2xl bg-white/10 p-3">
        <div className="text-xs text-white/50">需求</div>
        <div className="mt-1 line-clamp-2 text-sm text-white/80">{pendingWorkflow.userText}</div>
      </div>

      <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
        {previewSteps.map(step => (
          <div key={`${pendingWorkflow.id}-${step.index}`} className="flex gap-2 text-xs">
            <span className="text-cyan-200/70">{step.index + 1}</span>
            <span className="text-white/75">{step.label}</span>
          </div>
        ))}
        {remaining > 0 && <div className="text-xs text-white/45">還有 {remaining} 步…</div>}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/15 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onRevise}
          disabled={isBusy}
          className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/15 disabled:opacity-50"
        >
          修改計畫
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={isBusy}
          className="rounded-2xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
        >
          開始執行
        </button>
      </div>
    </div>
  );
}

function WorkflowExecutionFloatingPanel({
  workflowExecution,
  onDismiss,
}: {
  workflowExecution: WorkflowExecutionState | null;
  onDismiss: () => void;
}) {
  if (!workflowExecution) return null;

  const current = workflowExecution.steps[workflowExecution.currentIndex];
  const completedCount = workflowExecution.steps.filter(step => step.status === "completed").length;
  const percent = workflowExecution.total > 0
    ? Math.round((completedCount / workflowExecution.total) * 100)
    : 0;
  const statusLabel = workflowExecution.status === "running"
    ? "執行中"
    : workflowExecution.status === "completed"
    ? "已完成"
    : workflowExecution.status === "failed"
    ? "失敗"
    : "待命";

  return (
    <div className="fixed bottom-24 right-5 z-[80] w-[360px] max-w-[calc(100vw-2rem)] rounded-3xl border border-white/15 bg-slate-950/90 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">AI Director Workflow</div>
          <div className="mt-1 text-sm font-semibold">{workflowExecution.name}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20"
        >
          關閉
        </button>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300 transition-all duration-500"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-white/60">
        <span>{statusLabel}</span>
        <span>{completedCount}/{workflowExecution.total}</span>
      </div>

      {current && (
        <div className="mt-3 rounded-2xl bg-white/10 p-3">
          <div className="text-xs text-white/50">目前步驟</div>
          <div className="mt-1 text-sm">{current.label}</div>
          {current.path && <div className="mt-1 text-xs text-cyan-100/60">目標頁：{current.path}</div>}
          {workflowExecution.error && <div className="mt-2 text-xs text-rose-200">{workflowExecution.error}</div>}
        </div>
      )}

      <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
        {workflowExecution.steps.map(step => (
          <div key={`${step.index}-${step.label}`} className="flex gap-2 text-xs">
            <span className={statusDotClass(step.status)}>{statusDot(step.status)}</span>
            <span className="text-white/70">{step.index + 1}. {step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExecutorConfirmationCard({
  pendingTask,
  isBusy,
  onApprove,
  onCancel,
  onEditPlan,
}: {
  pendingTask: PendingExecutorTask | null;
  isBusy: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onEditPlan: () => void;
}) {
  if (!pendingTask) return null;
  const { task } = pendingTask;
  return (
    <div className="fixed bottom-24 left-5 z-[86] w-[400px] max-w-[calc(100vw-2rem)] rounded-3xl border border-amber-200/30 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">Executor Approval</div>
      <div className="mt-1 text-base font-semibold">{task.summaryForUser}</div>
      <div className="mt-2 text-xs text-white/70">taskId: {task.taskId} · traceId: {task.traceId ?? "n/a"}</div>
      <div className="mt-1 text-xs text-white/70">risk: {task.riskLevel ?? "unknown"}</div>
      {pendingTask.requiresHumanReason && <div className="mt-1 text-xs text-amber-200">{pendingTask.requiresHumanReason}</div>}
      {task.riskLevel === "high" && (
        <div className="mt-2 rounded-xl border border-rose-300/30 bg-rose-500/15 p-2 text-xs text-rose-100">
          高風險任務：不會自動執行，請確認後才開始。
        </div>
      )}
      <div className="mt-3 space-y-1 text-xs text-white/80">
        {task.steps.slice(0, 6).map((step, idx) => (
          <div key={step.id}>{idx + 1}. {step.label} {step.pagePath ? `(${step.pagePath})` : ""}</div>
        ))}
      </div>
      <div className="mt-2 text-xs text-cyan-100/70">Affected page: {pendingTask.affectedPages.join(", ") || "current page"}</div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" onClick={onApprove} disabled={isBusy} className="rounded-2xl bg-emerald-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Approve / 執行</button>
        <button type="button" onClick={onCancel} disabled={isBusy} className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/80 disabled:opacity-50">Cancel / 取消</button>
        <button type="button" onClick={onEditPlan} disabled={isBusy} className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/80 disabled:opacity-50">Edit Plan / 修改</button>
      </div>
    </div>
  );
}

function ExecutorProgressPanel({
  task,
  state,
  onRetry,
  onCancel,
  onReplan,
  onApproveStep,
}: {
  task: GlobalOrbExecutorTask | null;
  state: ReturnType<typeof useGlobalOrbExecutor>["state"];
  onRetry: () => void;
  onCancel: () => void;
  onReplan: () => void;
  onApproveStep: (stepId: string) => void;
}) {
  if (!task || state.taskId !== task.taskId) return null;
  return (
    <div className="fixed bottom-24 left-5 z-[84] w-[420px] max-w-[calc(100vw-2rem)] rounded-3xl border border-white/20 bg-slate-950/90 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex justify-between text-xs text-white/70">
        <span>{state.status}</span>
        <span>{state.currentStepId ?? "no-step"}</span>
      </div>
      <div className="mt-1 text-xs text-white/60">taskId: {task.taskId} · traceId: {task.traceId ?? "n/a"}</div>
      {state.failReason && <div className="mt-2 text-xs text-rose-200">Fail: {state.failReason}</div>}
      <div className="mt-3 max-h-52 space-y-1 overflow-auto text-xs">
        {state.steps.map(step => (
          <div key={step.id} className="rounded-lg bg-white/5 px-2 py-1">
            <div>{step.label} · {step.status}</div>
            {step.expectedOutput && <div className="text-white/50">expected: {step.expectedOutput}</div>}
            {step.status === "awaiting_approval" && (
              <button className="mt-1 rounded bg-cyan-300 px-2 py-1 text-[11px] font-semibold text-slate-950" onClick={() => onApproveStep(step.id)}>Approve step</button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={onRetry} className="rounded-2xl bg-white/10 px-3 py-2 text-xs">Retry</button>
        <button onClick={onCancel} className="rounded-2xl bg-white/10 px-3 py-2 text-xs">Cancel</button>
        <button onClick={onReplan} className="rounded-2xl bg-white/10 px-3 py-2 text-xs">Replan</button>
      </div>
    </div>
  );
}

function CodeTaskCard({
  codeTask,
  isBusy,
  onApprove,
  onCancel,
}: {
  codeTask: PendingCodeTaskPreview | null;
  isBusy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  if (!codeTask) return null;
  return (
    <div className="fixed bottom-24 left-5 z-[87] w-[440px] max-w-[calc(100vw-2rem)] rounded-3xl border border-violet-300/30 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="text-xs uppercase tracking-[0.2em] text-violet-200/80">Code Collaboration Task</div>
      <div className="mt-1 text-base font-semibold">{codeTask.title}</div>
      <div className="mt-1 text-xs text-white/70">Provider: {codeTask.provider} · Risk: {codeTask.riskLevel}</div>
      <div className="mt-1 text-xs text-white/70">taskId: {codeTask.taskId} · codeTaskId: {codeTask.codeTaskId}</div>
      <div className="mt-2 text-sm text-white/80">{codeTask.objective}</div>
      <div className="mt-2 text-xs text-cyan-100/70">Allowed: {codeTask.filesAllowed.join(", ") || "(none)"}</div>
      <div className="mt-1 text-xs text-rose-100/80">Forbidden: {codeTask.filesForbidden.join(", ") || "(none)"}</div>
      <div className="mt-1 text-xs text-white/70">Tests: {codeTask.testCommands.join(" | ") || "(none)"}</div>
      <div className="mt-1 text-xs text-white/70">Rollback: {codeTask.rollbackPlan}</div>
      {codeTask.prUrl && <a href={codeTask.prUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-cyan-200 underline">PR: {codeTask.prUrl}</a>}
      {codeTask.testStatusSummary && <div className="mt-1 text-xs text-white/70">Tests summary: {codeTask.testStatusSummary}</div>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={onApprove} disabled={isBusy} className="rounded-2xl bg-violet-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Approve / 交給 {codeTask.provider === "codex" ? "Codex" : "Claude Code"}</button>
        <button onClick={onCancel} disabled={isBusy} className="rounded-2xl bg-white/10 px-3 py-2 text-xs disabled:opacity-50">Cancel</button>
      </div>
    </div>
  );
}

interface GlobalOrbChatContextValue {
  messages: ChatMessage[];
  input: string;
  isSending: boolean;
  suggestions: ChatSuggestion[];
  isOpen: boolean;
  workflowExecution: WorkflowExecutionState | null;
  pendingWorkflow: PendingWorkflowPlan | null;
  /** Open clarification prompt waiting for the user to disambiguate intent. */
  pendingClarification: PendingClarificationPrompt | null;
  /** When false, the orb delivers text replies only — no actions, no workflows. */
  orbAgentEnabled: boolean;
  setInput: (text: string) => void;
  sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  clearHistory: () => void;
  resetConversation: () => void;
  clearWorkflowExecution: () => void;
  startPendingWorkflow: () => Promise<void>;
  revisePendingWorkflow: () => void;
  cancelPendingWorkflow: () => void;
  /** Submit the user's answer to the active clarification prompt. */
  answerClarification: (answer: string) => Promise<void>;
  /** Dismiss the clarification prompt without re-asking. */
  cancelClarification: () => void;
}

/** Reads the VITE_ENABLE_ORB_AGENT env flag (default: enabled). */
function readOrbAgentEnabled(): boolean {
  try {
    const v = String((import.meta as { env?: Record<string, string> }).env?.VITE_ENABLE_ORB_AGENT ?? "");
    if (["0", "false", "off", "no"].includes(v.toLowerCase())) return false;
  } catch {}
  return true;
}

const ORB_AGENT_ENV_ENABLED = readOrbAgentEnabled();

/**
 * Resolve the effective kill-switch state. Per-user pref (true/false) wins over
 * env flag; null = follow env. We cap the truthy result at env=true so admins
 * can globally disable the agent without users overriding.
 */
function resolveOrbAgentEnabled(userOverride: boolean | null | undefined): boolean {
  if (!ORB_AGENT_ENV_ENABLED) return false;
  if (userOverride === false) return false;
  return true;
}

const GlobalOrbChatContext = createContext<GlobalOrbChatContextValue>({
  messages: [],
  input: "",
  isSending: false,
  suggestions: [],
  isOpen: false,
  workflowExecution: null,
  pendingWorkflow: null,
  pendingClarification: null,
  orbAgentEnabled: ORB_AGENT_ENV_ENABLED,
  setInput: () => {},
  sendMessage: async () => {},
  open: () => {},
  close: () => {},
  toggle: () => {},
  clearHistory: () => {},
  resetConversation: () => {},
  clearWorkflowExecution: () => {},
  startPendingWorkflow: async () => {},
  revisePendingWorkflow: () => {},
  cancelPendingWorkflow: () => {},
  answerClarification: async () => {},
  cancelClarification: () => {},
});

export function GlobalOrbChatProvider({ children }: { children: ReactNode }) {
  const { personality } = usePersonality();
  const pageAgent = usePageAgent();
  const [locationPath, setLocation] = useLocation();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessagesFromStorage());
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [workflowExecution, setWorkflowExecution] = useState<WorkflowExecutionState | null>(null);
  const [pendingWorkflow, setPendingWorkflow] = useState<PendingWorkflowPlan | null>(null);
  const [pendingExecutorTask, setPendingExecutorTask] = useState<PendingExecutorTask | null>(null);
  const [activeExecutorTask, setActiveExecutorTask] = useState<GlobalOrbExecutorTask | null>(null);
  const [pendingCodeTask, setPendingCodeTask] = useState<PendingCodeTaskPreview | null>(null);
  const [pendingClarification, setPendingClarification] = useState<PendingClarificationPrompt | null>(
    () => loadClarificationFromStorage().prompt
  );
  const orbExecutor = useGlobalOrbExecutor();

  const aiChat = trpc.ai.chat.useMutation();
    const codeTaskApprove = trpc.ai.codeTask.approve.useMutation();
    const codeTaskCancel = trpc.ai.codeTask.cancel.useMutation();

    // Only ping providers when authenticated to avoid 401 modals for guests.
    const meQuery = trpc.auth.me.useQuery(undefined, {
          retry: false,
          refetchOnWindowFocus: false,
    });
    const isAuthenticated = Boolean(meQuery.data);
    const providerPingQuery = trpc.brain.pingProviders.useQuery(undefined, {
          retry: false,
          staleTime: 60_000,
          refetchInterval: 60_000,
          refetchOnWindowFocus: false,
          enabled: isAuthenticated, // Only run when logged in
    });
    const agentPreferencesQuery = trpc.agentPreferences.getPreferences.useQuery(undefined, {
          retry: false,
          staleTime: 5 * 60_000,
          refetchOnWindowFocus: false,
          enabled: isAuthenticated,
    });

  useEffect(() => {
    if (messages.length > 0) saveMessagesToStorage(messages);
  }, [messages]);

  // Persist the open clarification so it survives a reload — otherwise the
  // user loses context if they refresh while waiting to disambiguate.
  useEffect(() => {
    saveClarificationToStorage(pendingClarification);
  }, [pendingClarification]);

  const orbShortcutEnabled =
    (agentPreferencesQuery.data as { orbShortcutEnabled?: boolean } | undefined)?.orbShortcutEnabled !== false;

  useEffect(() => {
    if (!orbShortcutEnabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(prev => !prev);
      }
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, orbShortcutEnabled]);

  const customWelcomeMessage = (agentPreferencesQuery.data as { orbWelcomeMessage?: string | null } | undefined)?.orbWelcomeMessage ?? null;
  const welcomeMessage = useMemo(() => {
    const trimmed = typeof customWelcomeMessage === "string" ? customWelcomeMessage.trim() : "";
    if (trimmed.length > 0) return trimmed;
    const greetings: Record<string, string> = {
      calm: "嗨 🌿 我是光球。有什麼想聊的或想做的嗎？慢慢說就好。",
      creative: "嗨！我是光球 ✨ 今天想創作什麼呢？隨便聊聊也可以～",
      technical: "嗨，我是光球 🔧 需要什麼幫助嗎？技術問題或創作都行。",
    };
    return greetings[personality] ?? greetings.creative;
  }, [personality, customWelcomeMessage]);

  useEffect(() => {
    if (messages.length === 0) setMessages([{ role: "orb", text: welcomeMessage, at: Date.now(), pagePath: locationPath }]);
    // initialize once only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearWorkflowExecution = useCallback(() => {
    setWorkflowExecution(null);
  }, []);

  const executeActions = useCallback(async (actionsToExecute: AgentAction[], options: {
    intent?: string;
    requireConfirmation?: boolean;
  } = {}) => {
    const nextWorkflowExecution = buildWorkflowExecutionState(actionsToExecute);
    if (nextWorkflowExecution) setWorkflowExecution(nextWorkflowExecution);

    try {
      const results = await executeGlobalActions(actionsToExecute, {
        currentPage: pageAgent.snapshot,
        navigate: async path => {
          if (path !== locationPath) setLocation(path);
        },
        dispatch: pageAgent.dispatch,
        requireConfirmation: options.requireConfirmation === true,
        requireConfirmationForWorkflowSteps: false,
        intentSummary: options.intent,
        source: "ai-chat",
        waitAfterNavigateMs: 450,
        // Precision over speed: after navigate + the 450ms settle, poll the
        // global registry up to 4s waiting for the destination page to call
        // useRegisterPageAgent. This eliminates the silent-enqueue race where
        // a slow-hydrating page receives the dispatch before its handler is
        // ready (the action gets queued and executes later, breaking ordered
        // workflows). Polls every 80ms; that's tight enough to feel
        // immediate while keeping reflow cost trivial.
        pageReadyTimeoutMs: 4000,
        awaitPageReady: async (path, { timeoutMs }) => {
          if (globalAgentRegistry.findByPath(path)) return true;
          const intervalMs = 80;
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            if (globalAgentRegistry.findByPath(path)) return true;
          }
          return false;
        },
        onWorkflowStep: step => {
          const now = Date.now();
          setWorkflowExecution(prev =>
            prev
              ? advanceWorkflowStep(
                  prev,
                  {
                    index: step.index,
                    label: step.label,
                    path: step.path,
                    actionType: step.action.type,
                  },
                  now
                )
              : prev
          );
          pageAgent.reportFeedback({
            status: "completed",
            actionType: step.action.type,
            note: `workflow-step:${step.index + 1}/${step.total}:${step.label}`,
          });
        },
      });

      const failed = results.find(result => !result.ok);
      if (failed) {
        const failedReason = failed.reason ?? "unknown failure";
        const now = Date.now();
        setWorkflowExecution(prev =>
          prev ? failWorkflowAtCurrentStep(prev, failedReason, now) : prev
        );
        setMessages(prev => [...prev, {
          role: "orb",
          text: failedReason === "workflow disabled"
            ? "⚠️ 目前跨頁工作流程功能暫時關閉。我可以先提供手動步驟指引，或改成單一步驟幫你執行。"
            : `⚠️ 我找到要做的事，但執行時遇到問題：${failedReason}`,
          at: Date.now(),
          pagePath: locationPath,
        }]);
        pageAgent.reportFeedback({
          status: "failed",
          actionType: actionsToExecute[results.indexOf(failed)]?.type ?? "runWorkflow",
          note: failedReason,
        });
      } else if (nextWorkflowExecution) {
        const now = Date.now();
        setWorkflowExecution(prev => (prev ? completeWorkflow(prev, now) : prev));
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[GlobalOrbChat] Action execution error:", reason);
      setWorkflowExecution(prev =>
        prev ? failWorkflowAtCurrentStep(prev, reason, Date.now()) : prev
      );
      setMessages(prev => [...prev, {
        role: "orb",
        text: `⚠️ 執行流程時遇到問題：${reason}`,
        at: Date.now(),
        pagePath: locationPath,
      }]);
    }
  }, [pageAgent, locationPath, setLocation]);

  const sendMessage = useCallback(async (text: string, attachments: ChatAttachment[] = []) => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isSending) return;

    const userMessage: ChatMessage = {
      role: "user",
      text: trimmed,
      at: Date.now(),
      pagePath: locationPath,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setInput("");
    setSuggestions([]);
    setIsSending(true);

    try {
      const inferredIntent = inferUserMultimodalIntent(trimmed);
      const backendSummary = summarizeProviderPing(providerPingQuery.data);
      const prefRow = agentPreferencesQuery.data ?? null;
      const preferencesForChat = prefRow
        ? {
            confirmationPolicy: (prefRow as { confirmationPolicy?: string }).confirmationPolicy as
              | "always_approve"
              | "confirm_high_risk"
              | "confirm_all"
              | "manual"
              | undefined,
            maxAutoStepsPerTask: (prefRow as { maxAutoStepsPerTask?: number }).maxAutoStepsPerTask,
            autoApproveTools: (prefRow as { autoApproveTools?: string[] }).autoApproveTools,
            blockedTools: (prefRow as { blockedTools?: string[] }).blockedTools,
            allowedRiskLevels: (prefRow as { allowedRiskLevels?: string[] }).allowedRiskLevels,
            // Per-user kill-switch override + per-page / per-action gates
            // — server uses these to block actions before they ship back.
            orbAgentEnabled:
              (prefRow as { orbAgentEnabled?: boolean | null }).orbAgentEnabled ?? null,
            workflowsEnabled:
              (prefRow as { workflowsEnabled?: boolean | null }).workflowsEnabled ?? null,
            disabledPageAgents:
              (prefRow as { disabledPageAgents?: string[] }).disabledPageAgents,
            disabledActionsByPage:
              (prefRow as { disabledActionsByPage?: Record<string, string[]> })
                .disabledActionsByPage,
          }
        : undefined;
      const data = await aiChat.mutateAsync({
        messages: nextHistory
          .filter(m => m.role !== "orb" || m.at !== messages[0]?.at)
          .map(m => ({
            role: m.role === "user" ? ("user" as const) : ("assistant" as const),
            content: toLLMMessageContent(m),
          })),
        personality,
        context: `全站光球聊天 · 當前頁面: ${locationPath} · 意圖判斷: ${inferredIntent} · ${backendSummary}`,
        pageSnapshot: pageAgent.snapshot ?? undefined,
        recentFeedback: pageAgent.recentFeedback,
        preferences: preferencesForChat,
      });

      // Server signalled it needs to ask the user before acting. Skip every
      // downstream action / workflow / executor branch and surface the
      // ClarificationPromptCard so the user can disambiguate before the orb
      // dispatches anything.
      const needsClarification = (data as { needsClarification?: boolean }).needsClarification === true;
      if (needsClarification) {
        const clarificationQuestion =
          typeof (data as { clarificationQuestion?: string }).clarificationQuestion === "string"
            ? (data as { clarificationQuestion: string }).clarificationQuestion
            : typeof (data as { reply?: string }).reply === "string"
              ? (data as { reply: string }).reply
              : "請幫我多說一點，我想先確認你的需求。";
        const clarificationOptionsRaw = (data as { clarificationOptions?: string[] }).clarificationOptions;
        const clarificationOptions = Array.isArray(clarificationOptionsRaw)
          ? clarificationOptionsRaw
              .filter((s): s is string => typeof s === "string")
              .map(s => s.trim())
              .filter(s => s.length > 0)
              .slice(0, 4)
          : undefined;
        setMessages(prev => [...prev, {
          role: "orb",
          text: clarificationQuestion,
          at: Date.now(),
          pagePath: locationPath,
        }]);
        setPendingClarification({
          id: `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          question: clarificationQuestion,
          options: clarificationOptions,
          originalUserText: trimmed,
          createdAt: Date.now(),
        });
        // Suggestions still shown so users can pick from quick replies if any.
        const rawSuggestions = (data as { suggestions?: string[] }).suggestions ?? [];
        setSuggestions(rawSuggestions.slice(0, 4).map(s => ({ text: s })));
        return;
      }

      const intent = typeof (data as { intent?: string | null }).intent === "string"
        ? ((data as { intent?: string | null }).intent as string)
        : undefined;
      const rawPlannerOutput = (data as { plannerOutput?: unknown; agentPlan?: unknown; plan?: unknown }).plannerOutput
        ?? (data as { plannerOutput?: unknown; agentPlan?: unknown; plan?: unknown }).agentPlan
        ?? (data as { plannerOutput?: unknown; agentPlan?: unknown; plan?: unknown }).plan;
      const taskDraft = (data as { taskDraft?: { summaryForUser?: string; steps?: Array<{ id: string; label: string; pagePath?: string; uiActions?: Array<{ type: string; payload?: unknown }>; requiresApproval?: boolean; toolCalls?: Array<{ name: string; args?: Record<string, unknown>; requiresApproval?: boolean }> }> } | null }).taskDraft;
      const taskMeta = (data as { task?: { taskId?: string; traceId?: string; riskLevel?: string; preferredEngine?: string; isolation?: "ui" | "tool" | "code"; status?: string } | null; telemetry?: { taskId?: string | null; traceId?: string | null; riskLevel?: string | null } | null }).task;
      const telemetryMeta = (data as { telemetry?: { taskId?: string | null; traceId?: string | null; riskLevel?: string | null } | null }).telemetry;
      const codeTaskPreview = (data as {
        codeTask?: {
          codeTaskId: string;
          taskId: string;
          title: string;
          objective: string;
          provider: "claudeCode" | "codex" | "manual";
          filesAllowed?: string[];
          filesForbidden?: string[];
          riskLevel: "low" | "medium" | "high";
          testCommands?: string[];
          rollbackPlan: string;
          status: string;
          prUrl?: string;
          branchName?: string;
          testStatusSummary?: string;
        } | null;
      }).codeTask;
      const dataObj = (data ?? {}) as Record<string, unknown>;
      const dataReply = typeof dataObj.reply === "string" ? dataObj.reply : "";
      const dataActions = dataObj.actions;
      const llmActions = rawPlannerOutput
        ? adaptAgentPlanToActions(rawPlannerOutput)
        : dataActions
        ? parseLLMActions(dataActions)
        : [];

      // The chat router echoes back the durable preference profile (name +
      // styles + platforms + length tier) so the keyword fallback can fill in
      // missing details rather than asking again. Shape is forward-compat:
      // every field is optional and we never throw on missing keys.
      const rememberedPreferences = (() => {
        const raw = (dataObj.rememberedPreferences ?? null) as
          | {
              styles?: string[];
              outputs?: string[];
              platforms?: string[];
              models?: string[];
              videoLengthHint?: "short" | "medium" | "long";
            }
          | null;
        if (!raw) return undefined;
        return raw;
      })();
      const intentDetection = llmActions.length === 0
        ? detectChatIntent(trimmed, rememberedPreferences)
        : { kind: "none" } as const;
      if (intentDetection.kind === "needs-clarification") {
        const question = intentDetection.message;
        const replyForUser = dataReply ? `${dataReply}\n\n🎬 ${question}` : `🎬 ${question}`;
        setMessages(prev => [...prev, {
          role: "orb",
          text: replyForUser,
          at: Date.now(),
          pagePath: locationPath,
        }]);
        setPendingClarification({
          id: `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          question,
          options: intentDetection.options,
          originalUserText: trimmed,
          createdAt: Date.now(),
        });
        const rawSuggestionsClarify = (data as { suggestions?: string[] }).suggestions ?? [];
        setSuggestions(rawSuggestionsClarify.slice(0, 4).map(s => ({ text: s })));
        return;
      }
      const fallbackWorkflow = intentDetection.kind === "ready" ? intentDetection.workflow : null;
      const actionsToExecute: AgentAction[] = fallbackWorkflow ? [fallbackWorkflow] : llmActions;
      const effectiveIntent = intent ?? (fallbackWorkflow ? fallbackWorkflow.name : undefined);
      const executorTask: GlobalOrbExecutorTask | null =
        taskDraft && Array.isArray(taskDraft.steps) && taskDraft.steps.length > 0
          ? {
              taskId: telemetryMeta?.taskId ?? taskMeta?.taskId ?? `draft_${Date.now()}`,
              traceId: telemetryMeta?.traceId ?? taskMeta?.traceId ?? null,
              summaryForUser: taskDraft.summaryForUser ?? dataReply ?? "Orb task",
              status: taskMeta?.status ?? "awaiting_approval",
              preferredEngine: taskMeta?.preferredEngine ?? null,
              isolation: taskMeta?.isolation ?? "ui",
              riskLevel: telemetryMeta?.riskLevel ?? taskMeta?.riskLevel ?? "medium",
              steps: taskDraft.steps.map(step => ({
                id: step.id,
                label: step.label,
                pagePath: step.pagePath,
                uiActions: step.uiActions ?? [],
                requiresApproval: step.requiresApproval,
                toolCalls: step.toolCalls,
              })),
            }
          : null;
      const pendingPlan = buildPendingWorkflowPlan({
        actions: actionsToExecute,
        userText: trimmed,
        intent: effectiveIntent,
        source: fallbackWorkflow ? "fallback" : "llm",
      });
      // If the orb produced a runnable workflow, also build a shareable
      // /process URL so the user (or anyone they share it with) can open the
      // step-by-step viewer in a normal browser tab.
      const workflowForLink: RunWorkflowAction | null =
        fallbackWorkflow ??
        (actionsToExecute.find(a => a.type === "runWorkflow") as RunWorkflowAction | undefined) ??
        null;
      let processUrl: string | null = null;
      if (workflowForLink) {
        try {
          processUrl = buildProcessUrl(
            workflowActionToProcessSpec(workflowForLink, {
              summary: trimmed.slice(0, 200),
              source: fallbackWorkflow ? "光球 / 全站代理" : "光球計畫",
            })
          );
        } catch (err) {
          console.warn("[GlobalOrbChat] failed to build process URL:", err);
        }
      }
      const linkLine = processUrl
        ? `\n\n🔗 查看／分享流程：${processUrl}`
        : "";
      const baseReplyText = fallbackWorkflow
        ? `${dataReply}\n\n🎬 我已把你的需求轉成「${fallbackWorkflow.name}」。我會先讓你確認計畫，按下開始後才會跨頁執行。${linkLine}`
        : pendingPlan
        ? `${dataReply}\n\n🧭 我已整理好執行計畫，請先確認。按下「開始執行」後，我才會開始操作。${linkLine}`
        : dataReply;
      // Auto-extract a /process link when the reply contains numbered steps
      // but no link yet (e.g. how-to / 教學 replies the LLM didn't bother to
      // wrap). The extractor short-circuits when a link already exists, so
      // it's safe to call unconditionally.
      const { reply: replyText } = appendProcessLinkToReply(baseReplyText, {
        fallbackTitle: trimmed.slice(0, 60) || "流程說明",
        source: "光球 / 自動整理",
      });

      const rawWebSources = (data as { webSources?: Array<{ title?: string; url?: string; source?: string }> })
        .webSources ?? [];
      const webSources: ChatWebSource[] = rawWebSources
        .filter((s): s is { title: string; url: string; source?: string } =>
          typeof s.title === "string" && typeof s.url === "string"
        )
        .slice(0, 6)
        .map(s => ({ title: s.title, url: s.url, source: s.source }));

      setMessages(prev => [...prev, {
        role: "orb",
        text: replyText,
        at: Date.now(),
        intent: effectiveIntent,
        pagePath: locationPath,
        actions: actionsToExecute,
        ...(webSources.length > 0 ? { webSources } : {}),
      }]);

      const rawSuggestions = (data as { suggestions?: string[] }).suggestions ?? [];
      const allowSuggestions =
        (prefRow as { orbProactiveSuggestions?: boolean })?.orbProactiveSuggestions !== false;
      setSuggestions(allowSuggestions ? rawSuggestions.slice(0, 4).map(s => ({ text: s })) : []);

      const userOverride = (prefRow as { orbAgentEnabled?: boolean | null })?.orbAgentEnabled;
      const orbAgentRuntimeEnabled = resolveOrbAgentEnabled(
        typeof userOverride === "boolean" ? userOverride : null
      );
      if (!orbAgentRuntimeEnabled) {
        // Kill switch (env or per-user override): orb is chat-only.
        return;
      }

      // Manual / pure-chat policy: 純聊天模式承諾「只回覆文字、不執行任何動作」。
      // 即使動作通過確認卡也不應該被 dispatch — 早早 return 避免下面的 pendingPlan
      // / executorTask / codeTask / actionsToExecute 任一分支觸發。
      if (preferencesForChat?.confirmationPolicy === "manual") {
        return;
      }

      // Per-page disable: if the user disabled this page in settings,
      // surface the reply but skip every action / workflow / executor branch.
      const disabledPageAgents = (prefRow as { disabledPageAgents?: string[] })?.disabledPageAgents ?? [];
      if (
        pageAgent.snapshot?.pageId &&
        Array.isArray(disabledPageAgents) &&
        disabledPageAgents.includes(pageAgent.snapshot.pageId)
      ) {
        return;
      }

      if (pendingPlan) {
        setPendingWorkflow(pendingPlan);
        setWorkflowExecution(null);
        return;
      }

      if (executorTask) {
        const pages = Array.from(new Set(executorTask.steps.map(step => step.pagePath).filter((v): v is string => Boolean(v))));
        setPendingExecutorTask({
          task: executorTask,
          requiresHumanReason: (data as { reply?: string; warnings?: string[] }).reply,
          affectedPages: pages,
        });
        return;
      }

      if (codeTaskPreview) {
        setPendingCodeTask({
          codeTaskId: codeTaskPreview.codeTaskId,
          taskId: codeTaskPreview.taskId,
          title: codeTaskPreview.title,
          objective: codeTaskPreview.objective,
          provider: codeTaskPreview.provider,
          filesAllowed: codeTaskPreview.filesAllowed ?? [],
          filesForbidden: codeTaskPreview.filesForbidden ?? [],
          riskLevel: codeTaskPreview.riskLevel,
          testCommands: codeTaskPreview.testCommands ?? [],
          rollbackPlan: codeTaskPreview.rollbackPlan,
          status: codeTaskPreview.status,
          prUrl: codeTaskPreview.prUrl,
          branchName: codeTaskPreview.branchName,
          testStatusSummary: codeTaskPreview.testStatusSummary,
        });
        return;
      }

      if (actionsToExecute.length > 0) {
        const askBeforeAct =
          (data as { askBeforeAct?: boolean }).askBeforeAct === true ||
          shouldAskBeforeAct(actionsToExecute, preferencesForChat);
        await executeActions(actionsToExecute, {
          intent: effectiveIntent,
          requireConfirmation: askBeforeAct,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[GlobalOrbChat] Send error:", reason);
      setWorkflowExecution(prev => prev ? {
        ...prev,
        status: "failed",
        error: reason,
        completedAt: Date.now(),
      } : prev);
      setMessages(prev => [...prev, {
        role: "orb",
        text: "🌸 抱歉，我剛才恍神了一下。再跟我說一次好嗎？",
        at: Date.now(),
        pagePath: locationPath,
      }]);
    } finally {
      setIsSending(false);
    }
  }, [messages, isSending, personality, pageAgent, locationPath, aiChat, providerPingQuery.data, executeActions]);

  const approveExecutorTask = useCallback(async () => {
    if (!pendingExecutorTask || isSending) return;
    const task = pendingExecutorTask.task;
    setPendingExecutorTask(null);
    setActiveExecutorTask(task);
    await orbExecutor.startTask(task);
  }, [pendingExecutorTask, isSending, orbExecutor]);

  const cancelExecutorTask = useCallback(async () => {
    if (!pendingExecutorTask || isSending) return;
    const task = pendingExecutorTask.task;
    setPendingExecutorTask(null);
    await orbExecutor.cancelTask("cancelled before execution");
    setMessages(prev => [...prev, { role: "orb", text: `已取消任務 ${task.taskId}，不會執行任何操作。`, at: Date.now(), pagePath: locationPath }]);
  }, [pendingExecutorTask, isSending, orbExecutor, locationPath]);

  const editExecutorPlan = useCallback(() => {
    if (!pendingExecutorTask || isSending) return;
    const task = pendingExecutorTask.task;
    setPendingExecutorTask(null);
    setIsOpen(true);
    setInput(`請修改這個執行計畫：${task.summaryForUser}\\n任務ID：${task.taskId}\\n我想調整：`);
  }, [pendingExecutorTask, isSending]);

  const retryExecutorTask = useCallback(async () => {
    if (!activeExecutorTask) return;
    await orbExecutor.retryTask(activeExecutorTask);
  }, [activeExecutorTask, orbExecutor]);

  const replanFromFailure = useCallback(() => {
    if (!activeExecutorTask) return;
    const recovery = orbExecutor.requestRecovery(activeExecutorTask);
    setIsOpen(true);
    setInput(`請建立 recovery plan。failedStep=${recovery.failedStepId ?? "unknown"}; failedReason=${recovery.failedReason}`);
  }, [activeExecutorTask, orbExecutor]);

  const approveCodeTask = useCallback(async () => {
    if (!pendingCodeTask) return;
    await codeTaskApprove.mutateAsync({ codeTaskId: pendingCodeTask.codeTaskId });
    setMessages(prev => [...prev, { role: "orb", text: `已確認程式任務，交由 ${pendingCodeTask.provider} 執行。`, at: Date.now(), pagePath: locationPath }]);
    setPendingCodeTask(null);
  }, [pendingCodeTask, codeTaskApprove, locationPath]);

  const cancelCodeTaskPreview = useCallback(async () => {
    if (!pendingCodeTask) return;
    await codeTaskCancel.mutateAsync({ codeTaskId: pendingCodeTask.codeTaskId, reason: "cancelled by user" });
    setMessages(prev => [...prev, { role: "orb", text: "已取消程式任務，不會執行任何 code write 動作。", at: Date.now(), pagePath: locationPath }]);
    setPendingCodeTask(null);
  }, [pendingCodeTask, codeTaskCancel, locationPath]);

  const startPendingWorkflow = useCallback(async () => {
    if (!pendingWorkflow || isSending) return;
    const plan = pendingWorkflow;
    setPendingWorkflow(null);
    setIsSending(true);
    setMessages(prev => [...prev, {
      role: "orb",
      text: `✅ 已確認，開始執行「${plan.name}」。我會依序完成 ${plan.total} 步。`,
      at: Date.now(),
      intent: plan.intent,
      pagePath: locationPath,
      actions: plan.actions,
    }]);
    try {
      await executeActions(plan.actions, {
        intent: plan.intent,
        requireConfirmation: false,
      });
    } finally {
      setIsSending(false);
    }
  }, [pendingWorkflow, isSending, locationPath, executeActions]);

  const revisePendingWorkflow = useCallback(() => {
    if (!pendingWorkflow || isSending) return;
    const plan = pendingWorkflow;
    setPendingWorkflow(null);
    setIsOpen(true);
    setInput(`請幫我修改這個流程：${plan.name}\n原始需求：${plan.userText}\n我想調整：`);
    setMessages(prev => [...prev, {
      role: "orb",
      text: "可以，我先暫停這個流程。請告訴我你想修改哪裡，例如秒數、風格、模型、是否需要配音或要跳過哪些步驟。",
      at: Date.now(),
      intent: plan.intent,
      pagePath: locationPath,
    }]);
  }, [pendingWorkflow, isSending, locationPath]);

  const cancelPendingWorkflow = useCallback(() => {
    if (!pendingWorkflow || isSending) return;
    const plan = pendingWorkflow;
    setPendingWorkflow(null);
    setMessages(prev => [...prev, {
      role: "orb",
      text: `已取消「${plan.name}」，我不會執行任何跨頁操作。`,
      at: Date.now(),
      intent: plan.intent,
      pagePath: locationPath,
    }]);
  }, [pendingWorkflow, isSending, locationPath]);

  const cancelClarification = useCallback(() => {
    setPendingClarification(null);
    setMessages(prev => [...prev, {
      role: "orb",
      text: "好，我先放著這個問題不繼續。如果想接續，再告訴我新的方向就好 🌿",
      at: Date.now(),
      pagePath: locationPath,
    }]);
  }, [locationPath]);

  const answerClarification = useCallback(async (answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    const active = pendingClarification;
    if (!active) return;
    setPendingClarification(null);
    const composedUserText =
      active.originalUserText.length > 0
        ? `${active.originalUserText}\n\n[使用者澄清]: ${trimmed}`
        : trimmed;
    await sendMessage(composedUserText);
  }, [pendingClarification, sendMessage]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);
  const clearHistory = useCallback(() => {
    setMessages([]);
    setSuggestions([]);
    setPendingWorkflow(null);
    setPendingClarification(null);
    clearMessagesFromStorage();
  }, []);
  const resetConversation = useCallback(() => {
    const welcome: ChatMessage = { role: "orb", text: welcomeMessage, at: Date.now(), pagePath: locationPath };
    setMessages([welcome]);
    setSuggestions([]);
    setPendingWorkflow(null);
    setPendingClarification(null);
    saveMessagesToStorage([welcome]);
  }, [welcomeMessage, locationPath]);

  const userOrbAgentOverride = (agentPreferencesQuery.data as { orbAgentEnabled?: boolean | null } | undefined)?.orbAgentEnabled ?? null;
  const orbAgentEnabledResolved = resolveOrbAgentEnabled(userOrbAgentOverride);

  const value = useMemo(() => ({
    messages,
    input,
    isSending,
    suggestions,
    isOpen,
    workflowExecution,
    pendingWorkflow,
    pendingClarification,
    orbAgentEnabled: orbAgentEnabledResolved,
    setInput,
    sendMessage,
    open,
    close,
    toggle,
    clearHistory,
    resetConversation,
    clearWorkflowExecution,
    startPendingWorkflow,
    revisePendingWorkflow,
    cancelPendingWorkflow,
    answerClarification,
    cancelClarification,
  }), [messages, input, isSending, suggestions, isOpen, workflowExecution, pendingWorkflow, pendingClarification, orbAgentEnabledResolved, sendMessage, open, close, toggle, clearHistory, resetConversation, clearWorkflowExecution, startPendingWorkflow, revisePendingWorkflow, cancelPendingWorkflow, answerClarification, cancelClarification]);

  return (
    <GlobalOrbChatContext.Provider value={value}>
      {children}
      <WorkflowConfirmationCard
        pendingWorkflow={pendingWorkflow}
        isBusy={isSending}
        onStart={startPendingWorkflow}
        onRevise={revisePendingWorkflow}
        onCancel={cancelPendingWorkflow}
      />
      <WorkflowExecutionFloatingPanel
        workflowExecution={pendingWorkflow ? null : workflowExecution}
        onDismiss={clearWorkflowExecution}
      />
      <ExecutorConfirmationCard
        pendingTask={pendingExecutorTask}
        isBusy={isSending}
        onApprove={approveExecutorTask}
        onCancel={cancelExecutorTask}
        onEditPlan={editExecutorPlan}
      />
      <ExecutorProgressPanel
        task={activeExecutorTask}
        state={orbExecutor.state}
        onRetry={retryExecutorTask}
        onCancel={() => void orbExecutor.cancelTask("cancelled during execution")}
        onReplan={replanFromFailure}
        onApproveStep={stepId => void orbExecutor.approveStep(stepId)}
      />
      <CodeTaskCard
        codeTask={pendingCodeTask}
        isBusy={isSending}
        onApprove={approveCodeTask}
        onCancel={cancelCodeTaskPreview}
      />
      <ClarificationPromptCard
        prompt={pendingClarification}
        isBusy={isSending}
        onAnswer={text => void answerClarification(text)}
        onCancel={cancelClarification}
      />
    </GlobalOrbChatContext.Provider>
  );
}

export function useGlobalOrbChat() {
  return useContext(GlobalOrbChatContext);
}
