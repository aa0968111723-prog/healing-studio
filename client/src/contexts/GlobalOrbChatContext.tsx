/**
 * GlobalOrbChatContext.tsx — 全站光球聊天狀態管理
 *
 * Keeps the existing Orb chat UX, routes structured actions through the global
 * orchestrator, and now adds a deterministic Director workflow fallback when
 * the user clearly asks for a short video but the LLM returns no actions.
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
import { usePageAgent, parseLLMActions, type AgentAction } from "./PageAgentContext";
import { useLocation } from "wouter";
import { executeGlobalActions } from "../../../shared/global-agent-orchestrator";
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

interface GlobalOrbChatContextValue {
  messages: ChatMessage[];
  input: string;
  isSending: boolean;
  suggestions: ChatSuggestion[];
  isOpen: boolean;
  setInput: (text: string) => void;
  sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  clearHistory: () => void;
  resetConversation: () => void;
}

const GlobalOrbChatContext = createContext<GlobalOrbChatContextValue>({
  messages: [],
  input: "",
  isSending: false,
  suggestions: [],
  isOpen: false,
  setInput: () => {},
  sendMessage: async () => {},
  open: () => {},
  close: () => {},
  toggle: () => {},
  clearHistory: () => {},
  resetConversation: () => {},
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
      const llmActions = data.actions ? parseLLMActions(data.actions) : [];
      const fallbackWorkflow = llmActions.length === 0 ? maybeCreateWorkflowFromUserText(trimmed) : null;
      const actionsToExecute: AgentAction[] = fallbackWorkflow ? [fallbackWorkflow] : llmActions;
      const replyText = fallbackWorkflow
        ? `${data.reply}\n\n🎬 我已把你的需求轉成「AI Director 短片生成流程」，會先做腳本/分鏡，再帶到圖像、影片與配音。`
        : data.reply;

      setMessages(prev => [...prev, {
        role: "orb",
        text: replyText,
        at: Date.now(),
        intent: intent ?? (fallbackWorkflow ? fallbackWorkflow.name : undefined),
        pagePath: locationPath,
        actions: actionsToExecute,
      }]);

      const rawSuggestions = (data as { suggestions?: string[] }).suggestions ?? [];
      setSuggestions(rawSuggestions.slice(0, 4).map(s => ({ text: s })));

      if (actionsToExecute.length > 0) {
        const askBeforeAct = fallbackWorkflow ? true : (data as { askBeforeAct?: boolean }).askBeforeAct === true;
        const results = await executeGlobalActions(actionsToExecute, {
          currentPage: pageAgent.snapshot,
          navigate: async path => {
            if (path !== locationPath) setLocation(path);
          },
          dispatch: pageAgent.dispatch,
          requireConfirmation: askBeforeAct,
          requireConfirmationForWorkflowSteps: false,
          intentSummary: intent ?? fallbackWorkflow?.name,
          source: "ai-chat",
          waitAfterNavigateMs: 450,
          onWorkflowStep: step => {
            pageAgent.reportFeedback({
              status: "completed",
              actionType: step.action.type,
              note: `workflow-step:${step.index + 1}/${step.total}:${step.label}`,
            });
          },
        });

        const failed = results.find(result => !result.ok);
        if (failed) {
          setMessages(prev => [...prev, {
            role: "orb",
            text: `⚠️ 我找到要做的事，但執行時遇到問題：${failed.reason ?? "unknown failure"}`,
            at: Date.now(),
            pagePath: locationPath,
          }]);
          pageAgent.reportFeedback({
            status: "failed",
            actionType: actionsToExecute[results.indexOf(failed)]?.type ?? "runWorkflow",
            note: failed.reason,
          });
        }
      }
    } catch (err) {
      console.error("[GlobalOrbChat] Send error:", err instanceof Error ? err.message : String(err));
      setMessages(prev => [...prev, {
        role: "orb",
        text: "🌸 抱歉，我剛才恍神了一下。再跟我說一次好嗎？",
        at: Date.now(),
        pagePath: locationPath,
      }]);
    } finally {
      setIsSending(false);
    }
  }, [messages, isSending, personality, pageAgent, locationPath, setLocation, aiChat, providerPingQuery.data]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);
  const clearHistory = useCallback(() => {
    setMessages([]);
    setSuggestions([]);
    clearMessagesFromStorage();
  }, []);
  const resetConversation = useCallback(() => {
    const welcome: ChatMessage = { role: "orb", text: welcomeMessage, at: Date.now(), pagePath: locationPath };
    setMessages([welcome]);
    setSuggestions([]);
    saveMessagesToStorage([welcome]);
  }, [welcomeMessage, locationPath]);

  const value = useMemo(() => ({
    messages,
    input,
    isSending,
    suggestions,
    isOpen,
    setInput,
    sendMessage,
    open,
    close,
    toggle,
    clearHistory,
    resetConversation,
  }), [messages, input, isSending, suggestions, isOpen, sendMessage, open, close, toggle, clearHistory, resetConversation]);

  return <GlobalOrbChatContext.Provider value={value}>{children}</GlobalOrbChatContext.Provider>;
}

export function useGlobalOrbChat() {
  return useContext(GlobalOrbChatContext);
}
