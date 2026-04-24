/**
 * GlobalOrbChatContext.tsx — 全站光球聊天狀態管理
 * ────────────────────────────────────────────────────────────────────────────
 * 目的：
 *   - 提供全站統一的光球聊天狀態與歷史記錄
 *   - 支援跨頁面導航的聊天連續性
 *   - 整合 localStorage 實現持久化
 *   - 與 PageAgentContext 深度整合以執行結構化動作
 *
 * 設計原則：
 *   - 聊天歷史自動持久化到 localStorage
 *   - 支援頁面上下文感知（透過 PageAgentContext）
 *   - 提供清除歷史、重置對話等管理功能
 *   - 與現有人格系統（PersonalityContext）整合
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

// 導出輔助函數供外部使用
export {
  getPageLabelByPath,
  formatRelativeTime,
  formatMessageMetadata,
  getPageEmoji,
} from "@/lib/orbChatHelpers";

// ─── Types ─────────────────────────────────────────────────────────────────

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
  /** 使用者上傳的多模態附件 */
  attachments?: ChatAttachment[];
  /** 光球此輪附上的意圖摘要（若有） */
  intent?: string;
  /** 此訊息關聯的頁面路徑（用於顯示上下文） */
  pagePath?: string;
  /** 此訊息包含的結構化動作 */
  actions?: AgentAction[];
}

export interface ChatSuggestion {
  text: string;
  action?: AgentAction;
}

// ─── LocalStorage Keys ─────────────────────────────────────────────────────

const STORAGE_KEY_MESSAGES = "orb-chat-messages";
const STORAGE_KEY_TIMESTAMP = "orb-chat-timestamp";
const STORAGE_VERSION = "v1";
const MAX_STORED_MESSAGES = 100; // 最多保存 100 條訊息
const STORAGE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 天過期

function inferUserMultimodalIntent(text: string): string {
  const q = text.toLowerCase();
  const hit = (keys: string[]) => keys.some(k => q.includes(k));

  if (hit(["文生圖", "生圖", "圖片", "圖像", "海報", "插畫", "photo", "image"])) {
    return "偏向圖片創作需求（建議 image-studio / studio.image）";
  }
  if (hit(["文生影", "圖生影", "影片", "短片", "運鏡", "video", "reel"])) {
    return "偏向影片創作需求（建議 video-studio / studio.video）";
  }
  if (hit(["配樂", "音樂", "bgm", "聲音", "sfx", "music", "audio"])) {
    return "偏向音樂/音效需求（建議 pro-studio.audio）";
  }
  if (hit(["配音", "旁白", "語音", "tts", "voice", "朗讀"])) {
    return "偏向語音需求（建議 pro-studio.voice）";
  }
  if (hit(["腳本", "分鏡", "企劃", "導演", "storyboard", "script"])) {
    return "偏向前期腳本規劃（建議 director）";
  }
  if (hit(["全站模型", "全部模型", "模型總覽", "多模態"])) {
    return "偏向全站模型導覽（建議先去 studio，再分流 image/video/audio/voice）";
  }
  return "意圖未明，先用 1-2 句追問成品與用途後再分流";
}

function summarizeProviderPing(
  pingData: unknown
): string {
  if (!pingData || typeof pingData !== "object") {
    return "後端服務狀態未知";
  }
  const entries = Object.entries(
    pingData as Record<
      string,
      { ok?: boolean; latencyMs?: number | null; error?: string }
    >
  );
  if (entries.length === 0) return "後端服務清單為空";

  const online = entries.filter(([, v]) => v?.ok).map(([k]) => k);
  const offline = entries.filter(([, v]) => v && v.ok === false).map(([k]) => k);
  const summary = `後端連線 ${online.length}/${entries.length} 在線`;
  if (offline.length === 0) return summary;
  return `${summary}；離線: ${offline.join(", ")}`;
}

// ─── Storage Helpers ────────────────────────────────────────────────────────

function loadMessagesFromStorage(): ChatMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_MESSAGES);
    const timestamp = localStorage.getItem(STORAGE_KEY_TIMESTAMP);

    if (!stored || !timestamp) return [];

    const savedAt = parseInt(timestamp, 10);
    if (isNaN(savedAt) || Date.now() - savedAt > STORAGE_EXPIRY_MS) {
      // 過期，清除
      localStorage.removeItem(STORAGE_KEY_MESSAGES);
      localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
      return [];
    }

    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.slice(-MAX_STORED_MESSAGES); // 只保留最近的訊息
    }
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to load messages from storage:", err);
  }
  return [];
}

function saveMessagesToStorage(messages: ChatMessage[]) {
  try {
    const toSave = messages.slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(toSave));
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
  if (attachments.length === 0) return message.text;

  const parts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
    | { type: "file_url"; file_url: { url: string; mime_type: ChatAttachmentMimeType } }
  > = [];

  const trimmedText = message.text.trim();
  parts.push({
    type: "text",
    text: trimmedText || "請參考我上傳的附件內容。",
  });

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: attachment.url, detail: "auto" },
      });
      continue;
    }

    parts.push({
      type: "file_url",
      file_url: {
        url: attachment.url,
        mime_type: attachment.mimeType,
      },
    });
  }

  return parts;
}

// ─── Context Type ──────────────────────────────────────────────────────────

interface GlobalOrbChatContextValue {
  /** 聊天訊息歷史 */
  messages: ChatMessage[];
  /** 當前輸入的文字 */
  input: string;
  /** 是否正在發送/等待回覆 */
  isSending: boolean;
  /** 當前的建議快速回覆 */
  suggestions: ChatSuggestion[];
  /** 聊天面板是否開啟 */
  isOpen: boolean;

  // Actions
  /** 設定輸入文字 */
  setInput: (text: string) => void;
  /** 發送訊息 */
  sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<void>;
  /** 開啟聊天面板 */
  open: () => void;
  /** 關閉聊天面板 */
  close: () => void;
  /** 切換聊天面板開關 */
  toggle: () => void;
  /** 清除聊天歷史 */
  clearHistory: () => void;
  /** 重新開始對話（保留歡迎訊息） */
  resetConversation: () => void;
}

// ─── Context ───────────────────────────────────────────────────────────────

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

// ─── Provider ──────────────────────────────────────────────────────────────

export function GlobalOrbChatProvider({ children }: { children: ReactNode }) {
  const { personality } = usePersonality();
  const pageAgent = usePageAgent();
  const [locationPath] = useLocation();

  // 初始化時從 localStorage 載入訊息
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadMessagesFromStorage()
  );
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

  // 當訊息變化時自動存儲
  useEffect(() => {
    if (messages.length > 0) {
      saveMessagesToStorage(messages);
    }
  }, [messages]);

  // ─── 全域快捷鍵 ────────────────────────────────────────────────────────
  // Cmd+K / Ctrl+K 喚起聊天，ESC 關閉
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+K (Mac) 或 Ctrl+K (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        // 避免與其他快捷鍵衝突（如果輸入框正在使用則跳過）
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(prev => !prev);
      }

      // ESC 關閉聊天面板
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // 歡迎訊息（依據人格）
  const welcomeMessage = useMemo(() => {
    const greetings: Record<string, string> = {
      calm: "嗨 🌿 我是光球。有什麼想聊的或想做的嗎？慢慢說就好。",
      creative: "嗨！我是光球 ✨ 今天想創作什麼呢？隨便聊聊也可以～",
      technical: "嗨，我是光球 🔧 需要什麼幫助嗎？技術問題或創作都行。",
    };
    return greetings[personality] ?? greetings.creative;
  }, [personality]);

  // 初始化歡迎訊息
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: "orb",
          text: welcomeMessage,
          at: Date.now(),
          pagePath: locationPath,
        },
      ]);
    }
  }, []); // 只在初始化時執行一次

  const sendMessage = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
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
            .filter(m => m.role !== "orb" || m.at !== messages[0]?.at) // 跳過初始歡迎訊息
            .map(m => ({
              role: m.role === "user" ? ("user" as const) : ("assistant" as const),
              content: toLLMMessageContent(m),
            })),
          personality,
          context: `全站光球聊天 · 當前頁面: ${locationPath} · 意圖判斷: ${inferredIntent} · ${backendSummary}`,
          pageSnapshot: pageAgent.snapshot ?? undefined,
          recentFeedback: pageAgent.recentFeedback,
        });

        const intent =
          typeof (data as { intent?: string | null }).intent === "string"
            ? ((data as { intent?: string | null }).intent as string)
            : undefined;

        const structuredActions = data.actions
          ? parseLLMActions(data.actions)
          : [];

        const orbMessage: ChatMessage = {
          role: "orb",
          text: data.reply,
          at: Date.now(),
          intent,
          pagePath: locationPath,
          actions: structuredActions,
        };

        setMessages(prev => [...prev, orbMessage]);

        // 處理建議
        const rawSuggestions = (data as { suggestions?: string[] }).suggestions ?? [];
        setSuggestions(
          rawSuggestions.slice(0, 4).map(s => ({ text: s }))
        );

        // 派送結構化動作
        if (structuredActions.length > 0) {
          const askBeforeAct =
            (data as { askBeforeAct?: boolean }).askBeforeAct === true;

          // askBeforeAct=true 時保留既有逐筆確認流程（會進 pendingConfirmation）
          if (askBeforeAct) {
            for (const action of structuredActions) {
              await pageAgent.dispatch(action, {
                source: "ai-chat",
                intentSummary: intent,
                requireConfirmation: true,
              });
            }
          } else {
            // askBeforeAct=false 視為後端已完成 B 線審批，可走 A 線執行器
            const taskId =
              (data as { taskId?: string }).taskId ??
              `orb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const exec = await pageAgent.executeApprovedTask(
              {
                taskId,
                approvedByB: true,
                source: "B",
                pageId: pageAgent.snapshot?.pageId,
                actions: structuredActions,
              },
              {
                source: "ai-chat",
                onFailure: payload => {
                  pageAgent.reportFeedback({
                    status: "failed",
                    actionType: payload.context.actionType as AgentAction["type"],
                    pageId: payload.context.pageId,
                    note: `${payload.errorCode}: ${payload.context.reason ?? "unknown failure"}`,
                  });
                },
              }
            );
            if (!exec.ok) {
              setMessages(prev => [
                ...prev,
                {
                  role: "orb",
                  text: `⚠️ 動作執行失敗（${exec.errorCode ?? "UNKNOWN"}），我已回報給 B 線。`,
                  at: Date.now(),
                  pagePath: locationPath,
                },
              ]);
            }
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[GlobalOrbChat] Send error:", errorMsg);

        setMessages(prev => [
          ...prev,
          {
            role: "orb",
            text: "🌸 抱歉，我剛才恍神了一下。再跟我說一次好嗎？",
            at: Date.now(),
            pagePath: locationPath,
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [messages, isSending, personality, pageAgent, locationPath, aiChat, providerPingQuery.data]
  );

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setSuggestions([]);
    clearMessagesFromStorage();
  }, []);

  const resetConversation = useCallback(() => {
    const welcome: ChatMessage = {
      role: "orb",
      text: welcomeMessage,
      at: Date.now(),
      pagePath: locationPath,
    };
    setMessages([welcome]);
    setSuggestions([]);
    saveMessagesToStorage([welcome]);
  }, [welcomeMessage, locationPath]);

  const value = useMemo(
    () => ({
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
    }),
    [
      messages,
      input,
      isSending,
      suggestions,
      isOpen,
      sendMessage,
      open,
      close,
      toggle,
      clearHistory,
      resetConversation,
    ]
  );

  return (
    <GlobalOrbChatContext.Provider value={value}>
      {children}
    </GlobalOrbChatContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useGlobalOrbChat() {
  return useContext(GlobalOrbChatContext);
}
