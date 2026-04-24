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
import { usePersonality } from "./PersonalityContext";
import { usePageAgent, parseLLMActions, adaptAgentPlanToActions, type AgentAction } from "./PageAgentContext";
import { useLocation } from "wouter";
import { executeGlobalActions, shouldAskBeforeAct } from "../../../shared/global-agent-orchestrator";
import { maybeCreateWorkflowFromUserText } from "../../../shared/global-agent-workflows";

export {
  getPageLabelByPath,
  formatRelativeTime,
  formatMessageMetadata,
  getPageEmoji,
} from "@/lib/orbChatHelpers";

export type ChatRole = "user" | "orb";
export type ChatAttachmentKind = "image" | "video" | "audio" | "pdf";
export type ChatAttachmentMimeType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml"
  | "image/avif"
  | "audio/mpeg"
  | "audio/wav"
  | "audio/ogg"
  | "audio/webm"
  | "audio/mp4"
  | "audio/aac"
  | "audio/flac"
  | "video/mp4"
  | "video/webm"
  | "video/ogg"
  | "video/quicktime";

export interface ChatAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: ChatAttachmentMimeType;
  kind: ChatAttachmentKind;
}

export interface ChatMessage {
  role: ChatRole;
  text: string;
  at: number;
  attachments?: ChatAttachment[];
  intent?: string;
  pagePath?: string;
  actions?: AgentAction[];
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

const STORAGE_KEY_MESSAGES = "orb-chat-messages";
const STORAGE_KEY_TIMESTAMP = "orb-chat-timestamp";
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
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to clear messages from storage:", err);
  }
}

function toLLMMessageContent(message: ChatMessage): string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "file_url"; file_url: { url: string; mime_type: ChatAttachmentMimeType } }
> {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return message.text;
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
    | { type: "file_url"; file_url: { url: string; mime_type: ChatAttachmentMimeType } }
  > = [{ type: "text", text: message.text.trim() || "請參考我上傳的附件內容。" }];
  for (const attachment of attachments) {
    if (attachment.kind === "image") parts.push({ type: "image_url", image_url: { url: attachment.url, detail: "auto" } });
    else parts.push({ type: "file_url", file_url: { url: attachment.url, mime_type: attachment.mimeType } });
  }
  return parts;
}

function findWorkflowAction(actions: AgentAction[]): WorkflowAction | null {
  return actions.find((action): action is WorkflowAction => action.type === "runWorkflow") ?? null;
}

function workflowStepsToState(workflow: WorkflowAction, mode: "pending" | "running", now: number): WorkflowExecutionStepState[] {
  return workflow.steps.map((step, index) => ({
    index,
    label: step.label || `${index + 1}. ${step.actionType}`,
    path: step.path,
    actionType: step.actionType,
    status: mode === "running" && index === 0 ? "running" : "pending",
    startedAt: mode === "running" && index === 0 ? now : undefined,
  }));
}

function buildWorkflowExecutionState(actions: AgentAction[], now: number = Date.now()): WorkflowExecutionState | null {
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

function buildPendingWorkflowPlan({
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

interface GlobalOrbChatContextValue {
  messages: ChatMessage[];
  input: string;
  isSending: boolean;
  suggestions: ChatSuggestion[];
  isOpen: boolean;
  workflowExecution: WorkflowExecutionState | null;
  pendingWorkflow: PendingWorkflowPlan | null;
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
}

const GlobalOrbChatContext = createContext<GlobalOrbChatContextValue>({
  messages: [],
  input: "",
  isSending: false,
  suggestions: [],
  isOpen: false,
  workflowExecution: null,
  pendingWorkflow: null,
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

  const aiChat = trpc.ai.chat.useMutation();
  const providerPingQuery = trpc.brain.pingProviders.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (messages.length > 0) saveMessagesToStorage(messages);
  }, [messages]);

  useEffect(() => {
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
  }, [isOpen]);

  const welcomeMessage = useMemo(() => {
    const greetings: Record<string, string> = {
      calm: "嗨 🌿 我是光球。有什麼想聊的或想做的嗎？慢慢說就好。",
      creative: "嗨！我是光球 ✨ 今天想創作什麼呢？隨便聊聊也可以～",
      technical: "嗨，我是光球 🔧 需要什麼幫助嗎？技術問題或創作都行。",
    };
    return greetings[personality] ?? greetings.creative;
  }, [personality]);

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
        onWorkflowStep: step => {
          const now = Date.now();
          setWorkflowExecution(prev => {
            if (!prev) return prev;
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
                    actionType: step.action.type,
                    startedAt: existing.startedAt ?? now,
                  };
                }
                return existing.status === "pending" ? existing : { ...existing, status: "pending" as const };
              }),
            };
          });
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
        setWorkflowExecution(prev => prev ? {
          ...prev,
          status: "failed",
          error: failedReason,
          completedAt: now,
          steps: prev.steps.map(step => step.index === prev.currentIndex
            ? { ...step, status: "failed" as const, reason: failedReason, completedAt: now }
            : step),
        } : prev);
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
        setWorkflowExecution(prev => prev ? {
          ...prev,
          status: "completed",
          currentIndex: Math.max(prev.total - 1, 0),
          completedAt: now,
          steps: prev.steps.map(step => ({
            ...step,
            status: "completed" as const,
            completedAt: step.completedAt ?? now,
          })),
        } : prev);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[GlobalOrbChat] Action execution error:", reason);
      setWorkflowExecution(prev => prev ? {
        ...prev,
        status: "failed",
        error: reason,
        completedAt: Date.now(),
      } : prev);
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
      });

      const intent = typeof (data as { intent?: string | null }).intent === "string"
        ? ((data as { intent?: string | null }).intent as string)
        : undefined;
      const rawPlannerOutput = (data as { plannerOutput?: unknown; agentPlan?: unknown; plan?: unknown }).plannerOutput
        ?? (data as { plannerOutput?: unknown; agentPlan?: unknown; plan?: unknown }).agentPlan
        ?? (data as { plannerOutput?: unknown; agentPlan?: unknown; plan?: unknown }).plan;
      const llmActions = rawPlannerOutput
        ? adaptAgentPlanToActions(rawPlannerOutput)
        : data.actions
        ? parseLLMActions(data.actions)
        : [];
      const fallbackWorkflow = llmActions.length === 0 ? maybeCreateWorkflowFromUserText(trimmed) : null;
      const actionsToExecute: AgentAction[] = fallbackWorkflow ? [fallbackWorkflow] : llmActions;
      const effectiveIntent = intent ?? (fallbackWorkflow ? fallbackWorkflow.name : undefined);
      const pendingPlan = buildPendingWorkflowPlan({
        actions: actionsToExecute,
        userText: trimmed,
        intent: effectiveIntent,
        source: fallbackWorkflow ? "fallback" : "llm",
      });
      const replyText = fallbackWorkflow
        ? `${data.reply}\n\n🎬 我已把你的需求轉成「AI Director 短片生成流程」。我會先讓你確認計畫，按下開始後才會跨頁執行。`
        : pendingPlan
        ? `${data.reply}\n\n🧭 我已整理好執行計畫，請先確認。按下「開始執行」後，我才會開始操作。`
        : data.reply;

      setMessages(prev => [...prev, {
        role: "orb",
        text: replyText,
        at: Date.now(),
        intent: effectiveIntent,
        pagePath: locationPath,
        actions: actionsToExecute,
      }]);

      const rawSuggestions = (data as { suggestions?: string[] }).suggestions ?? [];
      setSuggestions(rawSuggestions.slice(0, 4).map(s => ({ text: s })));

      if (pendingPlan) {
        setPendingWorkflow(pendingPlan);
        setWorkflowExecution(null);
        return;
      }

      if (actionsToExecute.length > 0) {
        const askBeforeAct =
          (data as { askBeforeAct?: boolean }).askBeforeAct === true ||
          shouldAskBeforeAct(actionsToExecute);
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

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);
  const clearHistory = useCallback(() => {
    setMessages([]);
    setSuggestions([]);
    setPendingWorkflow(null);
    clearMessagesFromStorage();
  }, []);
  const resetConversation = useCallback(() => {
    const welcome: ChatMessage = { role: "orb", text: welcomeMessage, at: Date.now(), pagePath: locationPath };
    setMessages([welcome]);
    setSuggestions([]);
    setPendingWorkflow(null);
    saveMessagesToStorage([welcome]);
  }, [welcomeMessage, locationPath]);

  const value = useMemo(() => ({
    messages,
    input,
    isSending,
    suggestions,
    isOpen,
    workflowExecution,
    pendingWorkflow,
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
  }), [messages, input, isSending, suggestions, isOpen, workflowExecution, pendingWorkflow, sendMessage, open, close, toggle, clearHistory, resetConversation, clearWorkflowExecution, startPendingWorkflow, revisePendingWorkflow, cancelPendingWorkflow]);

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
    </GlobalOrbChatContext.Provider>
  );
}

export function useGlobalOrbChat() {
  return useContext(GlobalOrbChatContext);
}
