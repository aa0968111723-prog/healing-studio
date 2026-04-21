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

// ─── Types ─────────────────────────────────────────────────────────────────

export type ChatRole = "user" | "orb";

export interface ChatMessage {
  role: ChatRole;
  text: string;
  at: number;
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
  sendMessage: (text: string) => Promise<void>;
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

  // 當訊息變化時自動存儲
  useEffect(() => {
    if (messages.length > 0) {
      saveMessagesToStorage(messages);
    }
  }, [messages]);

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
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;

      const userMessage: ChatMessage = {
        role: "user",
        text: trimmed,
        at: Date.now(),
        pagePath: locationPath,
      };

      const nextHistory = [...messages, userMessage];
      setMessages(nextHistory);
      setInput("");
      setSuggestions([]);
      setIsSending(true);

      try {
        const data = await aiChat.mutateAsync({
          messages: nextHistory
            .filter(m => m.role !== "orb" || m.at !== messages[0]?.at) // 跳過初始歡迎訊息
            .map(m => ({
              role: m.role === "user" ? ("user" as const) : ("assistant" as const),
              content: m.text,
            })),
          personality,
          context: `全站光球聊天 · 當前頁面: ${locationPath}`,
          pageSnapshot: pageAgent.snapshot ?? undefined,
          recentFeedback: pageAgent.recentFeedback,
        });

        const intent =
          typeof (data as { intent?: string | null }).intent === "string"
            ? ((data as { intent?: string | null }).intent as string)
            : undefined;

        const orbMessage: ChatMessage = {
          role: "orb",
          text: data.reply,
          at: Date.now(),
          intent,
          pagePath: locationPath,
          actions: data.actions,
        };

        setMessages(prev => [...prev, orbMessage]);

        // 處理建議
        const rawSuggestions = (data as { suggestions?: string[] }).suggestions ?? [];
        setSuggestions(
          rawSuggestions.slice(0, 4).map(s => ({ text: s }))
        );

        // 派送結構化動作
        if (data.actions && data.actions.length > 0) {
          const structured = parseLLMActions(data.actions);
          const askBeforeAct = (data as { askBeforeAct?: boolean }).askBeforeAct === true;

          for (const action of structured) {
            await pageAgent.dispatch(action, {
              source: "ai-chat",
              intentSummary: intent,
              requireConfirmation: askBeforeAct ? true : undefined,
            });
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
    [messages, isSending, personality, pageAgent, locationPath, aiChat]
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
