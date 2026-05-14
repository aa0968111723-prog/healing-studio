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
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";
import { trpc } from "@/lib/trpc";
import { ProactiveEventBus } from "@/lib/proactiveEventBus";
import { toast } from "sonner";
import { useGlobalOrbExecutor } from "@/agent/useGlobalOrbExecutor";
import OrbTaskObservationStrip from "@/components/OrbTaskObservationStrip";
import OrbFeatureSpotlight from "@/components/orb/OrbFeatureSpotlight";
import { useIsMobile } from "@/hooks/useMobile";
import { motion, AnimatePresence } from "framer-motion";
import { safeRenderAssistantMessage } from "@/lib/assistantMessageSafety";
import {
  formatWorkflowActionTypeLabel,
  formatWorkflowFailure,
  formatWorkflowPhaseLabel,
  formatWorkflowTargetLabel,
} from "@/lib/workflowFailureMessages";
import { usePersonality } from "./PersonalityContext";
import { usePageAgent, parseLLMActions, adaptAgentPlanToActions, type AgentAction } from "./PageAgentContext";
import { useLocation } from "wouter";
import { executeGlobalActions, shouldAskBeforeAct } from "../../../shared/global-agent-orchestrator";
import { evaluateStepOutcome } from "../../../shared/orb-perception-loop";
import type { PageAgentSnapshot } from "../../../shared/agent-actions";
import { globalAgentRegistry } from "../../../shared/global-agent-registry";
import {
  buildFeatureSummaryReply,
  buildNavigateWorkflow,
  detectChatIntent,
  detectFeatureInquiry,
  detectNavIntent,
  summarizeVideoSlots,
} from "../../../shared/global-agent-workflows";
import {
  detectOrbPromptScenario,
  type OrbPromptScenarioOutcome,
} from "../../../shared/orb-prompt-scenarios";
import {
  extractScriptStructure,
  structureToDimensionSignals,
  SCRIPT_STRUCTURE_MIN_CHARS,
} from "../../../shared/orb-script-structure";
import {
  chatMessageToLLMContent,
  type OrbChatAttachment,
  type OrbChatAttachmentMimeType,
} from "../../../shared/orb-chat-multimodal";
import type { OrbReasoningChain } from "../../../shared/orb-reasoning";
import {
  buildProcessUrl,
  workflowActionToProcessSpec,
} from "../../../shared/orb-process-link";
import {
  exportChatToPdf,
  shareViaProcessLink,
  type ChatMessageForExport,
} from "@/lib/orbExportShare";
import {
  buildDirectorHandoffPayload,
  writeDirectorHandoff,
} from "@/lib/director-handoff";
import {
  detectOrbSearchIntent,
  formatUnifiedSearchReply,
} from "../../../shared/orb-search-intent";
import { rememberedDimensionCoverage } from "../../../shared/orb-clarification-memory";
import { useOrbState } from "./OrbStateContext";
import { useOrbGuide } from "./OrbGuideContext";
import {
  pickArrivalSpiritForPath,
  buildArrivalFollowUpText,
  detectSpiritMention,
  stripSpiritMention,
  getPrimaryNicknameForRole,
  SPIRIT_COLLAB_PROTOCOL,
  type AgentRole,
} from "../../../shared/orb-agent-roles";
import {
  SPIRIT_CHAT_TOOLS,
  type SpiritChatTool,
} from "../../../shared/spirit-chat-tools";

// Lazy-load the xyflow-based DAG view — keeps the @xyflow/react bundle out of
// the initial chat context payload. The bullet-list fallback inside the same
// panel renders synchronously while this resolves.
const LazyWorkflowDAG = lazy(() => import("@/components/orb/OrbWorkflowDAG"));
import { appendProcessLinkToReply } from "../../../shared/orb-reply-process-extractor";
import {
  buildContextualClarificationOptions,
  buildMultiDimWizardClarification,
  inferModalityFromText,
  isPhantomPlanReply,
  extractPhantomPlanQuestion,
  serializeMultiDimAnswers,
  type ClarificationDimension,
  type MultiDimWizardEntry,
} from "../../../shared/orb-clarification-options";
import type { RunWorkflowAction } from "../../../shared/agent-actions";
import type { GlobalOrbExecutorTask } from "@/agent/GlobalOrbExecutor";

export {
  getPageLabelByPath,
  formatRelativeTime,
  formatMessageMetadata,
  getPageEmoji,
  inferSuggestionEmoji,
} from "@/lib/orbChatHelpers";

export type ChatRole = "user" | "orb";
export type ChatAttachmentKind = "image" | "video" | "audio" | "pdf" | "text";
export type ChatAttachmentMimeType = OrbChatAttachmentMimeType;

export interface ChatAttachment {
  id: string;
  name: string;
  url: string;
  mimeType: ChatAttachmentMimeType;
  kind: ChatAttachmentKind;
  /**
   * Plain-text content extracted from a text-like document on the client.
   * `chatMessageToLLMContent` inlines this into the user's message body so
   * the LLM can read scripts (.txt / .md / .docx) directly.
   */
  extractedText?: string;
}

export interface ChatWebSource {
  title: string;
  url: string;
  source?: string;
}

/**
 * Structured site-wide search results attached to a chat message. When set,
 * a renderer that supports rich cards should display these instead of (or in
 * addition to) the message's prose body.
 */
export interface ChatSearchResultItem {
  kind: "asset" | "note" | "history" | "tutorial";
  id: string;
  title: string;
  snippet: string;
  path: string;
  badge?: string;
  at?: number;
  score?: number;
  thumbnailUrl?: string;
  modality?: "image" | "video" | "audio" | "voice" | "script" | "zip_bundle";
}

/**
 * Mirror of the server-side `OrbChatProgressEvent` (see
 * `server/services/orbChatProgress.ts`). Inlined here to keep the
 * client bundle independent of server code paths.
 */
export interface OrbChatProgressEvent {
  seq: number;
  at: number;
  stage:
    | "received"
    | "sanitizing"
    | "guarding_attachments"
    | "extracting_pdf"
    | "selecting_provider"
    | "researching_web"
    | "planning"
    | "calling_specialist"
    | "materializing_task"
    | "finalizing"
    | "error";
  label: string;
  detail?: Record<string, unknown>;
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
  /**
   * Site-wide search results returned for "找 / 搜尋 / 翻一下" queries.
   * Renderers may show these as kind-tagged cards beneath the message body.
   */
  searchResults?: ChatSearchResultItem[];
  /** Search query the results were drawn from (used for header + analytics). */
  searchQuery?: string;
  /**
   * Which of the 23 spirits handled this turn (server-authoritative answer
   * from `selectRoleForIntent`). Stored as the AgentRole id (e.g.
   * "image-specialist" / "accountant"). `undefined` for legacy / pre-spirits
   * messages — UI falls back to client-side inference in that case.
   */
  agentRole?: string;
  /** 0-1 confidence the server had when picking the spirit. */
  agentRoleConfidence?: number;
  /**
   * Free-form rationale string from `selectRoleForIntent` (e.g. "primary
   * role @image-specialist muted by user — falling back to composer").
   * UI uses this to render small inline chips for backend behaviours that
   * would otherwise be invisible to the user (mute fallback / circuit
   * replan / mode-contract replan). `undefined` for legacy messages.
   */
  agentRoleRationale?: string;
  /**
   * UI-only chips that surface notable backend behaviours for this turn
   * (e.g. urgent escape hatch fired, mode-contract replan triggered).
   * Server-side `notices` field is plumbed here verbatim — kept compact
   * so the chat bubble stays scannable.
   */
  notices?: ChatMessageNotice[];
}

/**
 * Small inline chip data — rendered above the orb's reply bubble to
 * tell the user why the agent's behaviour deviated from defaults
 * (急件模式 / 精靈靜音 fallback / 重新規劃 …). Keep `text` ≤ 24 chars
 * so it fits the 11px chip line.
 */
export interface ChatMessageNotice {
  kind: "urgent_mode" | "muted_fallback" | "mode_replan" | "circuit_replan";
  text: string;
  /** Optional tooltip / explanation shown on hover. */
  tooltip?: string;
  /**
   * 思考步驟面板資料：planner artefacts（intent / steps / warnings / summary）
   * 加上 tRPC 進度 ring buffer 經 buildOrbReasoningChain 合成的單一物件。
   * 為什麼存在 message 上：使用者捲回去看舊回覆時，按下「💭 思考步驟」
   * 仍能展開那一輪當時的思路，不必再呼叫一次 LLM。
   */
  reasoningChain?: OrbReasoningChain;
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

/**
 * Sub-status「step 內部正在做什麼」— 由 orchestrator 的 onStepProgress
 * 事件驅動。和 step.status（pending / running / completed / failed）正交：
 * 這是 running 中的細粒度。null = 沒收到 phase 事件 / 不在 running。
 */
export type WorkflowStepPhase =
  | "navigating"
  | "settling"
  | "awaiting_handler"
  | "dispatching"
  | "observing"
  | "retrying";

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
  /** Sub-phase 目前所在 — 由 onStepProgress 寫入；null 表示沒接到事件。 */
  currentPhase?: WorkflowStepPhase | null;
  /** Sub-phase 的脈絡（例如 navigate 的 path、retry 的「第 N 次嘗試」） */
  currentPhaseDetail?: string | null;
  /** Sub-phase 開始時間 — 給 UI 做「已 3.2s」的 elapsed 顯示。 */
  currentPhaseStartedAt?: number | null;
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
  dimension?: ClarificationDimension;
  originalUserText: string;
  createdAt: number;
  /**
   * When set, the card renders a multi-row picker (one row per dimension)
   * with a "送出" button that batches every pick into a single follow-up
   * message. The single-dim `options` field is ignored when this is present.
   */
  multiDim?: MultiDimWizardEntry[];
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

// Legacy keys (single-session) — kept for the one-shot migration that lifts
// existing chat history into the first multi-session conversation. Once a user
// has been migrated they're cleared.
const LEGACY_STORAGE_KEY_MESSAGES = "orb-chat-messages";
const LEGACY_STORAGE_KEY_TIMESTAMP = "orb-chat-timestamp";

// Multi-session storage. Each conversation gets its own messages key so a tab
// switch is just "save current → load target" without rewriting the whole
// list. The list itself + the active id live in two top-level keys.
const STORAGE_KEY_CONV_LIST = "orb-chat-conversation-list";
const STORAGE_KEY_ACTIVE_CONV = "orb-chat-active-conversation";
const STORAGE_KEY_MESSAGES_PREFIX = "orb-chat-messages:";
const STORAGE_KEY_TIMESTAMP_PREFIX = "orb-chat-timestamp:";
const STORAGE_KEY_CLARIFICATION = "orb-chat-pending-clarification";
const STORAGE_KEY_PERSIST_WATERMARK = "orb-chat-persist-watermark";
const MAX_STORED_MESSAGES = 100;
const MAX_CHAT_REQUEST_MESSAGES = 18;
const MAX_CHAT_REQUEST_CHARS = 12_000;
const STORAGE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const CONVERSATION_TITLE_MAX = 24;
const DEFAULT_CONVERSATION_TITLE = "新對話";

export interface ConversationSummary {
  conversationId: string;
  title: string;
  pinned: boolean;
  archivedAt: number | null;
  lastMessageAt: number | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

function generateLocalConversationId(): string {
  return `conv_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function messagesKeyFor(conversationId: string): string {
  return `${STORAGE_KEY_MESSAGES_PREFIX}${conversationId}`;
}

function timestampKeyFor(conversationId: string): string {
  return `${STORAGE_KEY_TIMESTAMP_PREFIX}${conversationId}`;
}

function deriveTitleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === "user");
  if (!firstUser) return DEFAULT_CONVERSATION_TITLE;
  const cleaned = firstUser.text.trim().replace(/\s+/g, " ");
  if (!cleaned) return DEFAULT_CONVERSATION_TITLE;
  return cleaned.slice(0, CONVERSATION_TITLE_MAX);
}

function loadConversationListFromStorage(): ConversationSummary[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONV_LIST);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ConversationSummary =>
        typeof c?.conversationId === "string" &&
        typeof c?.title === "string"
    );
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to load conversation list:", err);
    return [];
  }
}

function saveConversationListToStorage(list: ConversationSummary[]) {
  try {
    localStorage.setItem(STORAGE_KEY_CONV_LIST, JSON.stringify(list));
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to save conversation list:", err);
  }
}

function loadActiveConversationIdFromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_CONV);
  } catch {
    return null;
  }
}

function saveActiveConversationIdToStorage(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_CONV, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_CONV);
    }
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to save active conversation:", err);
  }
}

function loadPersistWatermarkFromStorage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PERSIST_WATERMARK);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, number>;
    }
  } catch {
    /* fall through */
  }
  return {};
}

function savePersistWatermarkToStorage(map: Map<string, number>) {
  try {
    const obj: Record<string, number> = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(STORAGE_KEY_PERSIST_WATERMARK, JSON.stringify(obj));
  } catch {
    /* best-effort */
  }
}

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

/**
 * 給「反問快選圖卡」用的小圖示推測 — 視內容自動配個 emoji，
 * 讓使用者一眼分辨選項類型（影片 / 風格 / 規劃 / 自由補充…）。
 */
export function inferClarificationOptionEmoji(text: string): string {
  const lower = text.toLowerCase();
  if (/(短片|reel|社群)/.test(text)) return "📱";
  if (/(教學|tutorial|guide)/.test(text)) return "🎓";
  if (/(廣告|商業|品牌|advert|brand)/.test(text)) return "📣";
  if (/(影片|video|reel|vlog)/.test(text)) return "🎬";
  if (/(寫實|realistic|photo)/.test(text)) return "📷";
  if (/(插畫|illustration|手繪|漫畫)/.test(text)) return "🎨";
  if (/(海報|poster|封面)/.test(text)) return "🖼️";
  if (/(音樂|配樂|bgm|music)/.test(lower)) return "🎵";
  if (/(節奏|rhythm|beat|快|活潑)/.test(text)) return "🥁";
  if (/(慢|療癒|溫柔|放鬆|calm)/.test(text)) return "🌿";
  if (/(環境|氛圍|ambient|sfx|音效)/.test(text)) return "🌌";
  if (/(配音|旁白|tts|聲線|語音)/.test(text)) return "🎙️";
  if (/(專業|adult|男聲|主播)/.test(text)) return "🎤";
  if (/(年輕|青春|youth)/.test(text)) return "🧒";
  if (/(範例|sample|試聽|示範|看看)/.test(text)) return "👀";
  if (/(規劃|計畫|執行|流程|workflow)/.test(text)) return "🗺️";
  if (/(直接|自動|幫我做|代理)/.test(text)) return "⚡";
  if (/(快速|fast|快選)/.test(text)) return "⚡";
  if (/(問我|追問|釐清|1 題)/.test(text)) return "❓";
  if (/(看|觀察|先看|了解)/.test(text)) return "👁️";
  if (/(三組|3 組|多選|方向)/.test(text)) return "✨";
  return "💡";
}

/**
 * Render a scenario outcome's reply, expanding the `show-feature-summary`
 * follow-up by appending the live registry-driven feature list. Kept beside
 * the other text helpers so the unit-test-friendly detector module can stay
 * free of project-specific imports.
 */
function buildScenarioReplyText(outcome: OrbPromptScenarioOutcome): string {
  if (outcome.followUp === "show-feature-summary") {
    return `${outcome.reply}\n\n${buildFeatureSummaryReply()}`;
  }
  return outcome.reply;
}

/**
 * 功能詢問模式回完之後丟出來的 CTA 建議按鈕。原本 ask-feature 只是「列清單
 * 就結束」，使用者看完很常停在那兒、不知道下一步要說什麼。這組 chip 把純
 * 問答接到真正動手的工作流：點下去等於送一條新訊息，讓 selectRoleForIntent
 * 把該題丟給對的精靈，或自動切到 plan 模式擬計畫。
 *
 * 設計刻意保守：四顆按鈕 = 圖／影／音／計畫，把四大模態 + 跨頁規劃覆蓋掉，
 * 避免主訊息已經很長還被一堆 chip 淹沒。使用者打 trimmed 原訊息時若已經
 * 暗示了某個模態（例如「你能做角色一致性嗎」明顯是圖），就把對應 chip
 * 放在第一個。
 */
function buildFeatureInquiryCtaSuggestions(userText: string): ChatSuggestion[] {
  const text = (userText ?? "").toLowerCase();
  const chips: ChatSuggestion[] = [
    { text: "幫我做一張圖" },
    { text: "幫我做一支短片" },
    { text: "幫我配音／做音樂" },
    { text: "幫我擬一份計畫" },
  ];
  // 把使用者原訊息已經暗示的模態提到第一個 — 讓 CTA 跟使用者意圖貼齊。
  const hintOrder: Array<{ keywords: string[]; chipText: string }> = [
    { keywords: ["影片", "短片", "video", "reel", "mv"], chipText: "幫我做一支短片" },
    { keywords: ["配音", "聲音", "voice", "音樂", "music", "歌曲"], chipText: "幫我配音／做音樂" },
    { keywords: ["圖", "image", "picture", "插畫", "海報"], chipText: "幫我做一張圖" },
    { keywords: ["計畫", "規劃", "plan", "流程", "拆步驟"], chipText: "幫我擬一份計畫" },
  ];
  for (const { keywords, chipText } of hintOrder) {
    if (keywords.some(k => text.includes(k))) {
      const idx = chips.findIndex(c => c.text === chipText);
      if (idx > 0) {
        const [hit] = chips.splice(idx, 1);
        chips.unshift(hit);
      }
      break;
    }
  }
  return chips;
}

function inferClarificationIntentCards(question: string, userText: string, dimension: ClarificationDimension = "format"): string[] {
  // Delegate to the shared context-aware generator so the options always
  // reference the user's own topic (e.g. "茶道體驗短片（30 秒）" instead of
  // generic "社群短片（15-30 秒）"). The shared util infers the modality
  // from `userText`; we pass `question` along too so modality detection
  // catches cases where the user asked about images but the question is
  // phrased around video.
  const optionPack = buildContextualClarificationOptions({
    userText: `${userText}\n${question}`.trim(),
    dimension,
  });
  return optionPack.options;
}

/**
 * Pull the reasoning-chain payload off an `ai.chat` response. The shape
 * is server-authoritative (see `shared/orb-reasoning.ts`) so we just
 * tolerate-and-narrow rather than re-validating field by field. Returns
 * `undefined` when the field is missing so callers can spread-conditionally
 * without painting empty-state UI on legacy responses.
 */
function extractReasoningChain(data: unknown): OrbReasoningChain | undefined {
  if (!data || typeof data !== "object") return undefined;
  const candidate = (data as { reasoningChain?: unknown }).reasoningChain;
  if (!candidate || typeof candidate !== "object") return undefined;
  const c = candidate as {
    sections?: unknown;
    actions?: unknown;
    modelLabel?: unknown;
    durationMs?: unknown;
    plannerStatus?: unknown;
  };
  const sections = Array.isArray(c.sections)
    ? (c.sections as Array<{ title?: unknown; body?: unknown }>)
        .filter(s => typeof s?.title === "string" && typeof s?.body === "string")
        .map(s => ({ title: s.title as string, body: s.body as string }))
    : [];
  const actions = Array.isArray(c.actions)
    ? (c.actions as Array<{
        stage?: unknown;
        label?: unknown;
        at?: unknown;
        detail?: unknown;
      }>)
        .filter(
          a =>
            typeof a?.stage === "string" &&
            typeof a?.label === "string" &&
            typeof a?.at === "number"
        )
        .map(a => ({
          stage: a.stage as OrbReasoningChain["actions"][number]["stage"],
          label: a.label as string,
          at: a.at as number,
          detail:
            a.detail && typeof a.detail === "object"
              ? (a.detail as Record<string, unknown>)
              : undefined,
        }))
    : [];
  if (sections.length === 0 && actions.length === 0) return undefined;
  return {
    sections,
    actions,
    modelLabel: typeof c.modelLabel === "string" ? c.modelLabel : undefined,
    durationMs:
      typeof c.durationMs === "number" && c.durationMs >= 0
        ? c.durationMs
        : undefined,
    plannerStatus:
      typeof c.plannerStatus === "string" ? c.plannerStatus : undefined,
  };
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

function loadMessagesFromStorage(conversationId: string): ChatMessage[] {
  try {
    const stored = localStorage.getItem(messagesKeyFor(conversationId));
    const timestamp = localStorage.getItem(timestampKeyFor(conversationId));
    if (!stored || !timestamp) return [];
    const savedAt = parseInt(timestamp, 10);
    if (isNaN(savedAt) || Date.now() - savedAt > STORAGE_EXPIRY_MS) {
      localStorage.removeItem(messagesKeyFor(conversationId));
      localStorage.removeItem(timestampKeyFor(conversationId));
      return [];
    }
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.slice(-MAX_STORED_MESSAGES) : [];
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to load messages from storage:", err);
    return [];
  }
}

function saveMessagesToStorage(conversationId: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(
      messagesKeyFor(conversationId),
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES))
    );
    localStorage.setItem(timestampKeyFor(conversationId), Date.now().toString());
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to save messages to storage:", err);
  }
}

function clearMessagesFromStorage(conversationId: string) {
  try {
    localStorage.removeItem(messagesKeyFor(conversationId));
    localStorage.removeItem(timestampKeyFor(conversationId));
    localStorage.removeItem(STORAGE_KEY_CLARIFICATION);
  } catch (err) {
    console.warn("[GlobalOrbChat] Failed to clear messages from storage:", err);
  }
}

/**
 * One-shot migration: lift the legacy single-session `orb-chat-messages` /
 * `orb-chat-timestamp` keys into the first multi-session conversation so
 * users don't lose history when this feature ships. Idempotent — once the
 * legacy keys are absent, this becomes a no-op.
 */
function migrateLegacyConversationIfNeeded(): {
  list: ConversationSummary[];
  activeId: string | null;
} {
  let list = loadConversationListFromStorage();
  let activeId = loadActiveConversationIdFromStorage();

  try {
    const legacyMessages = localStorage.getItem(LEGACY_STORAGE_KEY_MESSAGES);
    const legacyTimestamp = localStorage.getItem(LEGACY_STORAGE_KEY_TIMESTAMP);
    if (legacyMessages) {
      const parsed = JSON.parse(legacyMessages);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const conversationId = generateLocalConversationId();
        const now = Date.now();
        const savedAt = legacyTimestamp ? parseInt(legacyTimestamp, 10) : now;
        localStorage.setItem(messagesKeyFor(conversationId), legacyMessages);
        localStorage.setItem(
          timestampKeyFor(conversationId),
          (Number.isFinite(savedAt) ? savedAt : now).toString()
        );
        const summary: ConversationSummary = {
          conversationId,
          title: deriveTitleFromMessages(parsed as ChatMessage[]),
          pinned: false,
          archivedAt: null,
          lastMessageAt:
            (parsed[parsed.length - 1] as ChatMessage)?.at ?? now,
          messageCount: parsed.length,
          createdAt: Number.isFinite(savedAt) ? savedAt : now,
          updatedAt: now,
        };
        list = [summary, ...list.filter(c => c.conversationId !== conversationId)];
        if (!activeId) activeId = conversationId;
        saveConversationListToStorage(list);
        saveActiveConversationIdToStorage(activeId);
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY_MESSAGES);
      localStorage.removeItem(LEGACY_STORAGE_KEY_TIMESTAMP);
    }
  } catch (err) {
    console.warn("[GlobalOrbChat] Legacy migration failed:", err);
  }

  return { list, activeId };
}

function compactHistoryForRequest(history: ChatMessage[]): ChatMessage[] {
  const cleaned = history.filter(m => m.role !== "orb" || m.at !== history[0]?.at);
  if (cleaned.length <= 1) return cleaned;

  const kept: ChatMessage[] = [cleaned[cleaned.length - 1]];
  let usedChars = kept[0]?.text.length ?? 0;

  for (let i = cleaned.length - 2; i >= 0; i -= 1) {
    const msg = cleaned[i];
    const msgChars = msg.text.length;
    const exceedChars = usedChars + msgChars > MAX_CHAT_REQUEST_CHARS;
    const exceedCount = kept.length >= MAX_CHAT_REQUEST_MESSAGES;
    if (exceedChars || exceedCount) break;
    kept.push(msg);
    usedChars += msgChars;
  }

  return kept.reverse();
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
    // 切到新步驟，舊 phase 標籤直接清掉 — 不然「正在跳到 X」會 bleed 到
    // 下一步看起來還在做上一步的事。phase 由 onStepProgress 重新填。
    currentPhase: null,
    currentPhaseDetail: null,
    currentPhaseStartedAt: null,
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
 * Stamp the sub-phase the orchestrator is in (navigating / settling /
 * awaiting_handler / dispatching / observing / retrying). Pure reducer so the
 * vitest run can assert the cross-step transitions without React.
 *
 * 規則：
 *   - 只有當事件 index 等於 prev.currentIndex 時才寫進 state；老 step 的
 *     殘餘事件（例如 settle wait 完才到的 dispatching）不會污染下一步。
 *   - 同一個 phase 重複觸發只更新 detail，不重置 startedAt — 對 UI 來說
 *     「已 X 秒」應該從 phase 第一次進入算起，不是每個 dispatch tick 重來。
 */
export function setWorkflowStepPhase(
  prev: WorkflowExecutionState,
  event: { index: number; phase: WorkflowStepPhase; detail?: string },
  now: number = Date.now()
): WorkflowExecutionState {
  if (event.index !== prev.currentIndex) return prev;
  const samePhase = prev.currentPhase === event.phase;
  return {
    ...prev,
    currentPhase: event.phase,
    currentPhaseDetail: event.detail ?? null,
    currentPhaseStartedAt: samePhase
      ? prev.currentPhaseStartedAt ?? now
      : now,
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
    // 終態 phase 都清掉，UI 不會再顯示「正在跳頁…」spinner。
    currentPhase: null,
    currentPhaseDetail: null,
    currentPhaseStartedAt: null,
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
    currentPhase: null,
    currentPhaseDetail: null,
    currentPhaseStartedAt: null,
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

const DIMENSION_LABEL: Record<ClarificationDimension, string> = {
  format: "形式",
  duration: "長度",
  style: "風格",
  audience: "受眾",
  subject: "主題",
  platform: "投放",
  usecase: "用途",
  purpose: "目的",
  open: "其他",
};

export function ClarificationPromptCard({
  prompt,
  isBusy,
  onAnswer,
  onMultiAnswer,
  onCancel,
}: {
  prompt: PendingClarificationPrompt | null;
  isBusy: boolean;
  onAnswer: (text: string) => void;
  onMultiAnswer: (
    answers: Array<{ dimension: ClarificationDimension; value: string }>,
    extraNote: string
  ) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setDraft("");
    setPicks({});
    setSubmitting(false);
  }, [prompt?.id]);

  if (!prompt) return null;
  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAnswer(trimmed);
  };

  const isMultiDim = Boolean(prompt.multiDim && prompt.multiDim.length > 0);
  const totalDims = prompt.multiDim?.length ?? 0;
  const filledDims = prompt.multiDim
    ? prompt.multiDim.filter(entry => Boolean(picks[entry.dimension])).length
    : 0;
  const multiAllAnswered = isMultiDim ? filledDims === totalDims : false;

  const submitMulti = () => {
    if (!prompt.multiDim) return;
    const answers = prompt.multiDim
      .map(entry => ({ dimension: entry.dimension, value: picks[entry.dimension] ?? "" }))
      .filter(a => a.value.trim().length > 0);
    if (answers.length === 0 && draft.trim().length === 0) return;
    setSubmitting(true);
    // Brief flash before bubbling up — gives the user a beat to register
    // their full picks before the card unmounts. 300ms matches the spring.
    setTimeout(() => onMultiAnswer(answers, draft.trim()), 300);
  };

  return (
    <motion.div
      role="dialog"
      aria-label="光球需要先確認需求"
      data-testid="orb-clarification-card"
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{
        opacity: submitting ? 0 : 1,
        y: 0,
        scale: submitting ? 1.02 : 1,
        boxShadow: submitting
          ? "0 0 50px rgba(251, 191, 36, 0.6), 0 0 100px rgba(251, 191, 36, 0.25)"
          : "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
      }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={`pointer-events-auto w-full ${
        isMultiDim ? "md:w-[420px]" : "md:w-[380px]"
      } max-w-[calc(100vw-2rem)] rounded-3xl border border-amber-200/30 bg-slate-950/95 p-4 text-white backdrop-blur-xl`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">
          {isMultiDim ? "一次定方向" : "先確認一下"}
        </div>
        {isMultiDim && totalDims > 0 ? (
          <div
            className="flex items-center gap-1"
            data-testid="orb-clarification-progress"
            aria-label={`已選 ${filledDims} / ${totalDims}`}
          >
            {Array.from({ length: totalDims }).map((_, idx) => {
              const filled = idx < filledDims;
              return (
                <motion.span
                  key={idx}
                  initial={false}
                  animate={{
                    scale: filled ? [1, 1.4, 1] : 1,
                    backgroundColor: filled ? "#fcd34d" : "rgba(252, 211, 77, 0.2)",
                  }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="inline-block w-2 h-2 rounded-full"
                />
              );
            })}
          </div>
        ) : null}
      </div>
      <div
        data-testid="orb-clarification-question"
        className="mt-1 text-base font-semibold"
      >
        {prompt.question}
      </div>
      <div className="mt-2 text-xs text-white/60">
        {isMultiDim
          ? "每題挑一張卡片就好，全部選完按「送出」一次回給光球。"
          : "我需要先和你確認，避免做錯方向。可直接點下面意圖卡牌快選，或自己補充一句。"}
      </div>

      {isMultiDim && prompt.multiDim ? (
        <div
          className="mt-3 max-h-[50vh] overflow-y-auto pr-1 space-y-3"
          data-testid="orb-clarification-multidim"
        >
          {prompt.multiDim.map((entry, dimIdx) => {
            const isAnswered = Boolean(picks[entry.dimension]);
            return (
              <motion.div
                key={entry.dimension}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  delay: 0.06 * dimIdx,
                  type: "spring",
                  stiffness: 320,
                  damping: 24,
                }}
                className={`rounded-2xl border p-3 transition-colors ${
                  isAnswered
                    ? "border-amber-300/30 bg-amber-100/[0.04]"
                    : "border-white/5 bg-white/5"
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full bg-amber-200/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
                    {DIMENSION_LABEL[entry.dimension]}
                  </span>
                  <AnimatePresence mode="wait">
                    {isAnswered ? (
                      <motion.span
                        key="picked"
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -4 }}
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-300"
                      >
                        <span>✓</span>
                        <span className="text-emerald-200/80 truncate max-w-[160px]">
                          {picks[entry.dimension]}
                        </span>
                      </motion.span>
                    ) : (
                      <motion.span
                        key="unpicked"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-[11px] text-white/40"
                      >
                        未選
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <p className="mb-2 text-xs text-white/70 leading-snug">
                  {entry.question}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {entry.options.map(option => {
                    const isPicked = picks[entry.dimension] === option;
                    const emoji = inferClarificationOptionEmoji(option);
                    return (
                      <motion.button
                        key={option}
                        type="button"
                        whileHover={{ y: -1, scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        animate={
                          isPicked
                            ? { scale: [1, 1.08, 1], transition: { duration: 0.32 } }
                            : { scale: 1 }
                        }
                        onClick={() =>
                          setPicks(prev => ({
                            ...prev,
                            [entry.dimension]: isPicked ? "" : option,
                          }))
                        }
                        disabled={isBusy || submitting}
                        className={`group flex items-start gap-1.5 rounded-xl border px-2 py-2 text-left transition disabled:opacity-50 ${
                          isPicked
                            ? "border-amber-200/70 bg-amber-200/30 ring-2 ring-amber-200/40"
                            : "border-amber-200/15 bg-amber-200/5 hover:border-amber-200/40 hover:bg-amber-200/15"
                        }`}
                      >
                        <span className="text-sm leading-none mt-0.5 shrink-0">
                          {emoji}
                        </span>
                        <span className="text-[11px] leading-snug text-amber-50">
                          {option}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        prompt.options && prompt.options.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {prompt.options.map(option => {
              const emoji = inferClarificationOptionEmoji(option);
              return (
                <motion.button
                  key={option}
                  type="button"
                  whileHover={{ y: -1, scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => submit(option)}
                  disabled={isBusy}
                  className="group flex items-start gap-2 rounded-2xl border border-amber-200/20 bg-amber-200/10 px-3 py-2.5 text-left transition hover:border-amber-200/50 hover:bg-amber-200/20 disabled:opacity-50"
                >
                  <span className="text-base leading-none mt-0.5 shrink-0">{emoji}</span>
                  <span className="text-xs leading-snug text-amber-50 group-hover:text-amber-100">
                    {option}
                  </span>
                </motion.button>
              );
            })}
          </div>
        ) : null
      )}

      <div className="mt-3 flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          rows={2}
          placeholder={
            isMultiDim
              ? "也可以再補一句話描述（選填）..."
              : "也可以自己用一句話說明..."
          }
          className="w-full rounded-2xl border border-white/10 bg-white/5 p-2 text-sm text-white placeholder:text-white/40 focus:border-amber-200/40 focus:outline-none"
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (isMultiDim) submitMulti();
              else submit(draft);
            }
          }}
          disabled={isBusy}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy || submitting}
            className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/15 disabled:opacity-50"
          >
            取消
          </button>
          <motion.button
            type="button"
            onClick={() => (isMultiDim ? submitMulti() : submit(draft))}
            disabled={
              isBusy ||
              submitting ||
              (isMultiDim
                ? !multiAllAnswered && draft.trim().length === 0
                : draft.trim().length === 0)
            }
            whileTap={{ scale: 0.96 }}
            animate={
              isMultiDim && multiAllAnswered && !submitting
                ? {
                    boxShadow: [
                      "0 0 0px rgba(251, 191, 36, 0)",
                      "0 0 18px rgba(251, 191, 36, 0.55)",
                      "0 0 0px rgba(251, 191, 36, 0)",
                    ],
                    scale: [1, 1.04, 1],
                  }
                : { boxShadow: "0 0 0px rgba(251, 191, 36, 0)", scale: 1 }
            }
            transition={{
              duration: 1.6,
              repeat:
                isMultiDim && multiAllAnswered && !submitting ? Infinity : 0,
              ease: "easeInOut",
            }}
            className="rounded-2xl bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-200 disabled:opacity-50"
            data-testid="orb-clarification-submit"
            data-ready={isMultiDim ? multiAllAnswered : draft.trim().length > 0}
          >
            {isMultiDim
              ? submitting
                ? "傳送中…"
                : multiAllAnswered
                  ? `送出全部 ✨`
                  : `送出全部（${filledDims}/${totalDims}）`
              : "傳給光球"}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

export function WorkflowConfirmationCard({
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
    <div className="pointer-events-auto w-full md:w-[380px] max-w-[calc(100vw-2rem)] rounded-3xl border border-cyan-200/20 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">需要你的確認</div>
      <div className="mt-1 text-base font-semibold">{pendingWorkflow.name}</div>
      <div className="mt-2 text-sm leading-6 text-white/70">
        我已整理好 {pendingWorkflow.total} 步流程。按下「開始執行」後，我才會開始跨頁操作。
      </div>

      <div className="mt-3 rounded-2xl bg-white/10 p-3">
        <div className="text-xs text-white/50">需求</div>
        <div className="mt-1 line-clamp-2 text-sm text-white/80">{pendingWorkflow.userText}</div>
      </div>

      <div className="mt-3 rounded-2xl bg-cyan-400/10 p-3 border border-cyan-200/20">
        <div className="text-xs text-cyan-100/70">已收集欄位摘要</div>
        <div className="mt-1 text-xs text-white/80">
          {(() => {
            const slots = summarizeVideoSlots(pendingWorkflow.userText);
            const marks = [
              `片長：${slots.hasLength ? "✓" : "✗"}`,
              `主題：${slots.hasSubject ? "✓" : "✗"}`,
              `風格：${slots.hasStyle ? "✓" : "✗"}`,
              `用途：${slots.hasUseCase ? "✓" : "✗"}`,
            ];
            return marks.join("｜");
          })()}
        </div>
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

/**
 * 顯示「step 內部現在在做什麼 + 已花了多少秒」。獨立成 component 是因為
 * elapsed timer 需要一秒 tick 一次，把 setInterval 隔離在這裡才不會強制
 * 整個 Floating Panel 每秒重新 render。
 */
function WorkflowPhaseLine({
  phase,
  detail,
  actionType,
  path,
  startedAt,
}: {
  phase: WorkflowStepPhase;
  detail: string | null;
  actionType?: string;
  path?: string;
  startedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    // 1 秒 tick 一次就夠 — 「已 X.X 秒」級別的精度，setInterval(1000)
    // 對 React 重新 render 的成本可以忽略；改成 250ms 反而會閃。
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, phase]);
  const label = formatWorkflowPhaseLabel(phase, { detail, actionType, path });
  if (!label) return null;
  const elapsedSec = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  return (
    <div
      className="mt-2 flex items-center gap-1.5 text-[11px] text-cyan-100/85"
      data-testid="orb-workflow-phase-line"
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
      <span>{label}</span>
      {startedAt && elapsedSec >= 1 && (
        <span className="text-cyan-100/45">（已 {elapsedSec} 秒）</span>
      )}
    </div>
  );
}

export function WorkflowExecutionFloatingPanel({
  workflowExecution,
  onDismiss,
}: {
  workflowExecution: WorkflowExecutionState | null;
  onDismiss: () => void;
}) {
  // Default to flow view for workflows with 4+ steps where the DAG actually
  // helps; short workflows look better as the dense bullet list.
  const initialView: "list" | "flow" =
    workflowExecution && workflowExecution.steps.length >= 4 ? "flow" : "list";
  const [viewMode, setViewMode] = useState<"list" | "flow">(initialView);

  // Reset to the "natural" view when a brand-new workflow starts so the user
  // doesn't carry a stale toggle from the previous run.
  useEffect(() => {
    if (workflowExecution) {
      setViewMode(workflowExecution.steps.length >= 4 ? "flow" : "list");
    }
  }, [workflowExecution?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div
      className={`pointer-events-auto w-full ${
        viewMode === "flow" ? "md:w-[460px]" : "md:w-[360px]"
      } max-w-[calc(100vw-2rem)] rounded-3xl border border-white/15 bg-slate-950/90 p-4 text-white shadow-2xl backdrop-blur-xl`}
      data-testid="orb-workflow-execution-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">AI Director Workflow</div>
          <div className="mt-1 text-sm font-semibold">{workflowExecution.name}</div>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded-full bg-white/10 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2 py-0.5 text-[10px] rounded-full transition ${
                viewMode === "list" ? "bg-white text-slate-900" : "text-white/60 hover:text-white"
              }`}
              data-testid="orb-workflow-view-list"
            >
              列表
            </button>
            <button
              type="button"
              onClick={() => setViewMode("flow")}
              className={`px-2 py-0.5 text-[10px] rounded-full transition ${
                viewMode === "flow" ? "bg-white text-slate-900" : "text-white/60 hover:text-white"
              }`}
              data-testid="orb-workflow-view-flow"
            >
              流程圖
            </button>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/70 hover:bg-white/20"
          >
            關閉
          </button>
        </div>
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

      {/*
        Failed-step context — pulled out so 列表 / 流程圖 兩個檢視都共用一份。
        formatWorkflowFailure 把 orchestrator 丟回的英文 reason（最常見的就是
        「unsupported action」）翻成「卡在這一步 / 這頁不支援這個動作 / …」
        + 一句話建議；目標頁從 /director 換成「導演 AI（/director）」雙層；
        動作類別變成 chip。沒有 error 就回 null，呼叫端直接 ?: 即可。
      */}
      {(() => {
        if (!workflowExecution.error) return null;
        const failed =
          workflowExecution.steps.find(step => step.status === "failed") ?? current;
        const failure = formatWorkflowFailure(workflowExecution.error, {
          actionType: failed?.actionType,
          path: failed?.path,
          label: failed && formatWorkflowTargetLabel(failed.path).hasLabel
            ? formatWorkflowTargetLabel(failed.path).display
            : undefined,
        });
        return (
          <div
            className="mt-2 rounded-lg border border-rose-300/30 bg-rose-500/15 p-2 text-xs text-rose-100"
            data-testid="orb-workflow-failure-banner"
          >
            <div className="font-medium">{failure.headline}</div>
            <div className="mt-1 leading-relaxed">{failure.summary}</div>
            {failure.hint && (
              <div className="mt-1 text-rose-50/80">{failure.hint}</div>
            )}
          </div>
        );
      })()}

      {current && viewMode === "list" && (
        <div className="mt-3 rounded-2xl bg-white/10 p-3">
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <span>目前步驟</span>
            {current.actionType && (
              <span className="rounded-full bg-cyan-300/15 px-1.5 py-0.5 text-[10px] text-cyan-100/90">
                {formatWorkflowActionTypeLabel(current.actionType)}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm">{current.label}</div>
          {current.path && (() => {
            const target = formatWorkflowTargetLabel(current.path);
            return (
              <div className="mt-1 text-xs text-cyan-100/60">
                目標頁：{target.display}
                {target.hasLabel && target.rawPath && (
                  <span className="ml-1 text-cyan-100/40 font-mono">
                    （{target.rawPath}）
                  </span>
                )}
              </div>
            );
          })()}
          {/* Sub-phase chip — 只在 workflow 還在 running 時顯示，避免完成後
              留下「正在跳到 X」這種過時的狀態。phase null（沒收到事件）也
              不渲染整塊，免得空白行佔版面。 */}
          {workflowExecution.status === "running" && workflowExecution.currentPhase && (
            <WorkflowPhaseLine
              phase={workflowExecution.currentPhase}
              detail={workflowExecution.currentPhaseDetail ?? null}
              actionType={current.actionType}
              path={current.path}
              startedAt={workflowExecution.currentPhaseStartedAt ?? null}
            />
          )}
        </div>
      )}

      {viewMode === "flow" ? (
        <div className="mt-3">
          <Suspense
            fallback={
              <div className="h-44 grid place-items-center text-xs text-white/50">
                載入流程圖…
              </div>
            }
          >
            <LazyWorkflowDAG workflowExecution={workflowExecution} compact />
          </Suspense>
        </div>
      ) : (
        <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
          {workflowExecution.steps.map(step => (
            <div key={`${step.index}-${step.label}`} className="flex gap-2 text-xs">
              <span className={statusDotClass(step.status)}>{statusDot(step.status)}</span>
              <span className="flex-1 min-w-0 text-white/70">
                <span>{step.index + 1}. {step.label}</span>
                {step.actionType && (
                  <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">
                    {formatWorkflowActionTypeLabel(step.actionType)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
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
    <div className="pointer-events-auto w-full md:w-[400px] max-w-[calc(100vw-2rem)] rounded-3xl border border-amber-200/30 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
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
    <div className="pointer-events-auto w-full md:w-[420px] max-w-[calc(100vw-2rem)] rounded-3xl border border-white/20 bg-slate-950/90 p-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex justify-between text-xs text-white/70">
        <span>{state.status}</span>
        <span>{state.currentStepId ?? (
          state.status === "completed" ? "已完成" :
          state.status === "failed" ? "失敗等待重試" :
          state.status === "cancelled" ? "已取消" :
          state.status === "blocked" ? "已封鎖" :
          state.steps.find(s => s.status === "pending")?.label ?? "等待開始"
        )}</span>
      </div>
      <div className="mt-1 text-xs text-white/60">taskId: {task.taskId} · traceId: {task.traceId ?? "n/a"}</div>
      {state.failReason && <div className="mt-2 text-xs text-rose-200">Fail: {state.failReason}</div>}
      <div className="mt-3 max-h-52 space-y-1 overflow-auto text-xs">
        {state.steps.map(step => (
          <div key={step.id} className="rounded-lg bg-white/5 px-2 py-1">
            <div>{step.label} · {step.status}</div>
            {step.expectedOutput && <div className="text-white/50">expected: {step.expectedOutput}</div>}
            {step.status === "awaiting_approval" && (
              <div className="mt-1 grid grid-cols-3 gap-1">
                <button className="rounded bg-cyan-300 px-2 py-1 text-[11px] font-semibold text-slate-950" onClick={() => onApproveStep(step.id)}>確認</button>
                <button className="rounded bg-white/10 px-2 py-1 text-[11px]" onClick={onReplan}>修改</button>
                <button className="rounded bg-white/10 px-2 py-1 text-[11px]" onClick={onCancel}>跳過</button>
              </div>
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
    <div className="pointer-events-auto w-full md:w-[440px] max-w-[calc(100vw-2rem)] rounded-3xl border border-violet-300/30 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl">
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

/**
 * 多代理討論的範圍 / 限制設定。預設 = 不勾任何 family / role 即不限制，沿用
 * SPIRIT_COLLAB_PROTOCOL 自然交棒；勾了哪個就只准那些精靈出席。
 */
export type CollaborativeDiscussionFamily = "specialist" | "role" | "proactive";

export interface CollaborativeDiscussionOptions {
  /** 強制指定第一棒；省略就用 selectRoleForIntent 自動挑（後端決定）。 */
  initialAgent?: string;
  /** 最多跑幾位精靈（每位算一棒）；clamp 1-24。預設 3。 */
  maxRounds?: number;
  /** 顯式只允許這幾位精靈參與；空陣列 / 不給 = 不限制。 */
  allowedRoles?: string[];
  /** 只允許某幾個家族的精靈出席；和 allowedRoles 是 AND 關係。 */
  allowedFamilies?: CollaborativeDiscussionFamily[];
  /** 「這次再加 mute」的精靈，疊加在使用者偏好之上。 */
  extraMutedRoles?: string[];
  /** 每位精靈 LLM 呼叫硬上限（毫秒），clamp 5_000–60_000。 */
  timeoutMsPerTurn?: number;
}

export interface CollaborativeDiscussionMeta {
  collaborationId: string;
  initialAgent: string;
  maxRounds: number;
  allowedRoles: string[];
  allowedFamilies: CollaborativeDiscussionFamily[];
  startedAt: number;
}

interface GlobalOrbChatContextValue {
  messages: ChatMessage[];
  input: string;
  isSending: boolean;
  /**
   * Progress milestones emitted by the in-flight chat request (sanitizing
   * → planning → calling specialist → finalizing). Empty between requests.
   * Consumers render this as the orb's "thinking timeline" so the user
   * can see what's happening during the otherwise-opaque planning window.
   */
  progressEvents: OrbChatProgressEvent[];
  suggestions: ChatSuggestion[];
  isOpen: boolean;
  workflowExecution: WorkflowExecutionState | null;
  pendingWorkflow: PendingWorkflowPlan | null;
  /** Open clarification prompt waiting for the user to disambiguate intent. */
  pendingClarification: PendingClarificationPrompt | null;
  /** When false, the orb delivers text replies only — no actions, no workflows. */
  orbAgentEnabled: boolean;
  /** Multi-session: list of the user's conversation tabs, newest first. */
  conversations: ConversationSummary[];
  /** Id of the conversation whose messages are currently shown in `messages`. */
  activeConversationId: string;
  setInput: (text: string) => void;
  sendMessage: (
    text: string,
    attachments?: ChatAttachment[],
    options?: SendMessageOptions
  ) => Promise<void>;
  /**
   * 多代理「自動討論」：丟一個 prompt，runner 在背景接力 2-5 位精靈各回一段，
   * 訊息會以 orb chat bubble 的形式逐步出現在現有 messages 串流。
   * 回傳 collaborationId 給 caller 追蹤；錯誤時 reject。
   *
   * `options` 控制本場討論的範圍 — 可指定參與的角色 / 家族、最多回合數、
   * 第一棒、額外 mute、每回合超時。空 options 等於沿用過往行為（director
   * 起頭、不限制家族、最多 3 回合）。
   */
  startCollaborativeDiscussion: (
    prompt: string,
    options?: CollaborativeDiscussionOptions,
  ) => Promise<string>;
  /** 是否有自動討論正在進行（用來把 composer 與按鈕鎖住、避免重複觸發） */
  isCollaborativeDiscussionActive: boolean;
  /**
   * 取消正在進行的自動討論 — 立即把 client 端 polling 收掉，並通知 server
   * 把 session 標記成 cancelled。已 publish 的精靈訊息留在對話裡。
   * 沒有進行中的討論時是 no-op。
   */
  cancelCollaborativeDiscussion: () => Promise<void>;
  /**
   * 進行中討論的概要：第一棒、預計回合數、目前用的 scope。沒在跑時為 null。
   * UI 用來顯示「精靈們正在討論… 第 2 / 3 棒」這種進度條。
   */
  collaborativeDiscussionMeta: CollaborativeDiscussionMeta | null;
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
  /**
   * Submit batched answers to the active multi-dimension clarification card.
   * `extraNote` is appended as an `open` clarification when non-empty.
   */
  answerMultiClarification: (
    answers: Array<{ dimension: ClarificationDimension; value: string }>,
    extraNote: string
  ) => Promise<void>;
  /** Dismiss the clarification prompt without re-asking. */
  cancelClarification: () => void;
  // ─── Multi-session controls (tabs) ─────────────────────────────────────
  /** Open a brand-new empty conversation and switch to it. */
  createConversation: (title?: string) => Promise<string>;
  /** Save current conversation, swap state to the target one, and load it. */
  switchConversation: (conversationId: string) => Promise<void>;
  /** Rename a conversation (defaults to current active). */
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  /** Hard-delete a conversation; if it was active, switch to the next one. */
  deleteConversation: (conversationId: string) => Promise<void>;
}

/**
 * Mode chips on the agent-chat composer (跳頁 / 計畫 / 多步驟代理 / 功能詢問).
 *
 * Modes are encoded as structured metadata so the user's typed prompt is
 * displayed as-is in the chat (no Chinese instruction prefix injected) and
 * each mode runs through hard-coded logic where possible — e.g. navigate
 * mode never round-trips through the LLM, it does keyword routing client-
 * side and dispatches a navigate workflow directly.
 */
export type OrbChatRequestedMode =
  | "navigate"
  | "plan"
  | "multi-step"
  | "ask-feature";

export interface SendMessageOptions {
  requestedMode?: OrbChatRequestedMode;
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
  progressEvents: [],
  suggestions: [],
  isOpen: false,
  workflowExecution: null,
  pendingWorkflow: null,
  pendingClarification: null,
  orbAgentEnabled: ORB_AGENT_ENV_ENABLED,
  conversations: [],
  activeConversationId: "",
  setInput: () => {},
  sendMessage: async () => {},
  startCollaborativeDiscussion: async () => "",
  isCollaborativeDiscussionActive: false,
  cancelCollaborativeDiscussion: async () => {},
  collaborativeDiscussionMeta: null,
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
  answerMultiClarification: async () => {},
  cancelClarification: () => {},
  createConversation: async () => "",
  switchConversation: async () => {},
  renameConversation: async () => {},
  deleteConversation: async () => {},
});

export function GlobalOrbChatProvider({ children }: { children: ReactNode }) {
  const { personality } = usePersonality();
  const pageAgent = usePageAgent();
  const [locationPath, setLocation] = useLocation();

  // ─── Multi-session bootstrap ──────────────────────────────────────────
  // Migrate any legacy single-session payload into a fresh conversation, then
  // hydrate the conversation list + active id from localStorage. If neither
  // exists, defer creating one until the user actually arrives at /agent —
  // the first useEffect below handles that.
  const bootstrap = useMemo(() => migrateLegacyConversationIfNeeded(), []);
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    () => bootstrap.list
  );
  const [activeConversationId, setActiveConversationId] = useState<string>(
    () => {
      if (bootstrap.activeId) return bootstrap.activeId;
      if (bootstrap.list.length > 0) return bootstrap.list[0].conversationId;
      const fresh = generateLocalConversationId();
      saveActiveConversationIdToStorage(fresh);
      return fresh;
    }
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadMessagesFromStorage(
      bootstrap.activeId ??
        bootstrap.list[0]?.conversationId ??
        loadActiveConversationIdFromStorage() ??
        ""
    )
  );
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Phase-1 multi-step thinking UX: while a chat request is in flight, the
  // orb polls `ai.chatProgress` keyed by this id and surfaces the milestone
  // events as an inline timeline. `null` outside of an in-flight request.
  const [activeProgressRequestId, setActiveProgressRequestId] = useState<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<OrbChatProgressEvent[]>([]);
  const lastProgressSeqRef = useRef(0);
  // Perception loop: rolling "before" snapshot. Filled with the page
  // state we observed at the start of the workflow; each step's
  // observeAfterStep updates it to the post-step snapshot so the next
  // step compares against the most recent observation.
  const perceptionSnapshotRef = useRef<PageAgentSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [workflowExecution, setWorkflowExecution] = useState<WorkflowExecutionState | null>(null);
  const [pendingWorkflow, setPendingWorkflow] = useState<PendingWorkflowPlan | null>(null);
  const [pendingExecutorTask, setPendingExecutorTask] = useState<PendingExecutorTask | null>(null);
  const [activeExecutorTask, setActiveExecutorTask] = useState<GlobalOrbExecutorTask | null>(null);
  // Latest server-side OrbTask id we've seen come back from the brain
  // router. Used as the rootTaskId for OrbTaskObservationStrip so the
  // user can watch the agent loop's post-mortem observations + chain
  // hops. Reset to null when the user clears history. Holds only one
  // task at a time (the most recent) — the strip itself follows
  // continuations.
  const [latestServerTaskId, setLatestServerTaskId] = useState<string | null>(null);
  const [pendingCodeTask, setPendingCodeTask] = useState<PendingCodeTaskPreview | null>(null);
  // 多代理「自動討論」目前進行中的 collaboration id。null 代表沒在跑；非 null 時
  // 下方 useEffect 會啟動 1.5s 輪詢，把 bus 上新冒出來的精靈訊息塞進 chat。
  const [activeDiscussionId, setActiveDiscussionId] = useState<string | null>(null);
  // 已塞進 chat 的 message id，避免輪詢重複 push 同一段。
  const seenDiscussionMessageIdsRef = useRef<Set<string>>(new Set());
  // 追蹤目前討論最初的 user prompt — 等 discussion_complete 收到時，可以
  // 拿這個 prompt 真的去打第一位生成型精靈，把「規劃」變「執行」。
  const lastDiscussionUserPromptRef = useRef<string | null>(null);
  // 進行中討論的概要（第一棒 / 預計回合 / scope）— UI 顯示「精靈們正在討論…
  // (2/3)」用。null 代表沒在跑。在 startCollaborativeDiscussion 設、收到
  // discussion_complete / cancel / 90s 兜底時清掉。
  const [collaborativeDiscussionMeta, setCollaborativeDiscussionMeta] =
    useState<CollaborativeDiscussionMeta | null>(null);
  const [pendingClarification, setPendingClarificationState] = useState<PendingClarificationPrompt | null>(
    () => loadClarificationFromStorage().prompt
  );
  // Wrap the setter so the clarification is persisted to localStorage in
  // the same tick the state changes — the useEffect below is still here
  // as a defence-in-depth but only fires on next commit, which is too
  // late if the user reloads the tab between dispatch and commit.
  const setPendingClarification = useCallback(
    (next: PendingClarificationPrompt | null | ((prev: PendingClarificationPrompt | null) => PendingClarificationPrompt | null)) => {
      setPendingClarificationState(prev => {
        const resolved = typeof next === "function"
          ? (next as (p: PendingClarificationPrompt | null) => PendingClarificationPrompt | null)(prev)
          : next;
        try {
          saveClarificationToStorage(resolved);
        } catch {
          // best-effort
        }
        return resolved;
      });
    },
    []
  );
  const orbExecutor = useGlobalOrbExecutor();

  // ─── Meta-action handler ref (export PDF / share-via-link) ───────────
  // The handler is created later (after `messages` + `setMessages` are in
  // closure) but `executeActions` needs to reach it without re-binding the
  // whole callback graph. We hold the latest impl in a ref and assign it
  // below; refs are stable, so executeActions doesn't rebuild on each turn.
  const runMetaActionRef = useRef<(action: AgentAction) => Promise<void>>(async () => {});

  // Mirror of `messages` for callbacks that don't list it as a dep (e.g.
  // `executeActions`). Without this, the navigate handler captured a stale
  // history and the director-handoff payload missed the message that
  // triggered the redirect.
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const aiChat = trpc.ai.chat.useMutation();

  // ─── Phase-1 multi-step thinking: poll progress milestones ─────────────
  // While `activeProgressRequestId` is set we poll `ai.chatProgress` every
  // 400 ms. The server tracks per-request milestones in an in-memory ring
  // buffer keyed by the same id; the client appends each new event to the
  // visible timeline so the user sees the orb actually working through
  // sanitization → planning → specialist call rather than 20 s of silence.
  const chatProgressQuery = trpc.ai.chatProgress.useQuery(
    { requestId: activeProgressRequestId ?? "", sinceSeq: lastProgressSeqRef.current },
    {
      enabled: Boolean(activeProgressRequestId),
      refetchInterval: activeProgressRequestId ? 400 : false,
      refetchIntervalInBackground: false,
      retry: 1,
      // Keep the result while transitioning between request ids so the
      // final timeline doesn't flash blank before the new one starts.
      staleTime: 0,
    }
  );

  useEffect(() => {
    const data = chatProgressQuery.data;
    if (!data || data.events.length === 0) return;
    setProgressEvents(prev => {
      const seen = new Set(prev.map(p => p.seq));
      const additions = data.events.filter(e => !seen.has(e.seq));
      if (additions.length === 0) return prev;
      return [...prev, ...additions];
    });
    if (typeof data.lastSeq === "number" && data.lastSeq > lastProgressSeqRef.current) {
      lastProgressSeqRef.current = data.lastSeq;
    }
  }, [chatProgressQuery.data]);

  // Reset the timeline + cursor whenever a new request begins / ends.
  useEffect(() => {
    if (!activeProgressRequestId) return;
    lastProgressSeqRef.current = 0;
    setProgressEvents([]);
  }, [activeProgressRequestId]);

  const startAutoDiscussionMutation =
    trpc.agentCollaboration.startAutoDiscussion.useMutation();
  // 直接讓精靈打 fal.ai：使用者 @圖圖/影影/音音/聲聲 + 一句話描述時，
  // sendMessage 會走 spiritInvokeMut.mutateAsync 而不是 LLM 對話。
  // 也用在 discussion_complete 後的「真實執行」自動補一輪生成。
  const spiritInvokeMut = trpc.spirit.invoke.useMutation();

  // ─── 多代理討論：輪詢 + 訊息注入 ─────────────────────────────────────
  // 1.5s 一次的輪詢，把 bus 上的新精靈訊息塞成 chat bubble。stop 條件：
  //   • activeDiscussionId 為 null（沒在跑 / 已收掉）
  //   • 整支 query 失敗超過 retry 上限（trpc 預設）
  //   • 90 秒兜底 timer 強制清掉 activeDiscussionId
  const discussionMessagesQuery =
    trpc.agentCollaboration.getCollaborationMessages.useQuery(
      { collaborationId: activeDiscussionId ?? "", limit: 20 },
      {
        enabled: Boolean(activeDiscussionId),
        refetchInterval: activeDiscussionId ? 1500 : false,
        refetchIntervalInBackground: false,
        retry: 1,
      }
    );
  const trpcUtils = trpc.useUtils();

  // ─── 多代理討論：把 bus 拉回來的精靈訊息塞進 chat、處理收尾 ────────────
  // 輪詢回的每筆 message 用 messageId 去重；接受兩種 action:
  //   • discussion_turn      → 一棒精靈說了一段，渲染成 spirit chat bubble
  //   • discussion_complete  → 整輪討論收尾，立即停止輪詢、補一條收尾訊息
  // 注意：content.data.agentRole 帶上去後，下游 ChatMessage.agentRole 會被
  // ProactiveOrbWidget / OrbGuidePanel 的 spirit chip render 邏輯認走，自動
  // 顯示精靈頭像 + 家族色，不必另開 message variant。
  useEffect(() => {
    if (!activeDiscussionId) return;
    const data = discussionMessagesQuery.data;
    if (!data) return;
    const seen = seenDiscussionMessageIdsRef.current;
    const newOnes = data.messages.filter(
      m =>
        !seen.has(m.messageId) &&
        m.messageType === "share_context" &&
        ((m.content as { action?: string })?.action === "discussion_turn" ||
          (m.content as { action?: string })?.action === "discussion_complete"),
    );
    if (newOnes.length === 0) return;
    for (const m of newOnes) seen.add(m.messageId);

    const additions: ChatMessage[] = [];
    let completedReason: string | null = null;

    for (const m of newOnes) {
      const action = (m.content as { action?: string })?.action;
      if (action === "discussion_turn") {
        const td = (m.content as {
          data?: {
            agentRole?: string;
            nickname?: string;
            text?: string;
            roundIndex?: number;
            roundsPlanned?: number;
          };
        }).data;
        const nickname = td?.nickname ?? String(m.fromAgent);
        const text = td?.text ?? "";
        const agentRole = td?.agentRole ?? String(m.fromAgent);
        const roundLabel =
          typeof td?.roundIndex === "number" && typeof td?.roundsPlanned === "number"
            ? `（第 ${td.roundIndex + 1}/${td.roundsPlanned} 棒）`
            : "";
        additions.push({
          role: "orb" as const,
          // 仍把 nickname 寫進文字 head，給沒有 spirit chip 的舊 renderer 兼容；
          // 有 chip 的 renderer 會優先用 agentRole 渲染頭像。
          text: `**${nickname}** ${roundLabel}\n\n${text}`,
          at: m.timestamp,
          pagePath: locationPath,
          agentRole,
        });
      } else if (action === "discussion_complete") {
        const cd = (m.content as {
          data?: { stoppedReason?: string; participants?: string[] };
        }).data;
        completedReason = cd?.stoppedReason ?? "max-rounds";
        const reasonLabel = (() => {
          switch (completedReason) {
            case "max-rounds":
              return "已跑滿預計輪數";
            case "no-handoff":
              return "沒有下一棒可接，自然收尾";
            case "llm-error":
              return "其中一棒回覆失敗，討論提前結束";
            case "cancelled":
              return "你取消了這場討論";
            default:
              return "討論結束";
          }
        })();
        const count = cd?.participants?.length ?? 0;
        additions.push({
          role: "orb" as const,
          text: `🌿 精靈們的討論結束（${reasonLabel}，共 ${count} 位參與）。我接下來幫你「真的執行」第一位生成型精靈的部分。`,
          at: m.timestamp,
          pagePath: locationPath,
        });

        // ── 真實執行：把 LLM 規劃變成真的會跑的工具呼叫 ──
        // 從 participants 找：
        //   - 第一位生成型精靈 → 直接 fal-invoke 真的出資產
        //   - 路路 → 用原始 prompt 推目的地，真的 setLocation
        //   - 學學 → 真的跳到 /learn-hub
        // 整體保證「規劃」不會只停在文字，直接接真實執行。
        const userPrompt = lastDiscussionUserPromptRef.current ?? "";
        const participants = (cd?.participants ?? []) as AgentRole[];
        const generativeOrder: AgentRole[] = [
          "image-specialist",
          "video-specialist",
          "music-specialist",
          "voice-specialist",
          "training-specialist",
        ];
        const firstGen = generativeOrder.find(r => participants.includes(r));
        if (firstGen && userPrompt.length >= 6) {
          const genNickname = getPrimaryNicknameForRole(firstGen);
          additions.push({
            role: "orb" as const,
            text: `🎬 ${genNickname} 真的開始做了…`,
            at: m.timestamp + 1,
            pagePath: locationPath,
            agentRole: firstGen,
            intent: "auto-post-discussion-execute",
          });
          // fire-and-forget — 結果回來後在另一個 setMessages 接起
          void (async () => {
            try {
              const result = await spiritInvokeMut.mutateAsync({
                spirit: firstGen,
                prompt: userPrompt,
              });
              if (!result.success) {
                setMessages(prev => [...prev, {
                  role: "orb",
                  text: `${genNickname} 嘗試執行時失敗：${result.error ?? "未知錯誤"}`,
                  at: Date.now(),
                  pagePath: locationPath,
                  agentRole: firstGen,
                }]);
                return;
              }
              const data = result.data as Record<string, unknown>;
              const pickUrl = (): string | null => {
                const direct = (data?.url ?? (data as { output?: string })?.output) as
                  | string
                  | undefined;
                if (typeof direct === "string" && direct) return direct;
                const images = (data?.images as Array<{ url?: string }> | undefined)
                  ?? (data as { image?: { url?: string } | string }).image;
                if (Array.isArray(images) && images[0]?.url) return images[0].url;
                if (typeof images === "string") return images;
                const video = data?.video as { url?: string } | undefined;
                if (video?.url) return video.url;
                const audio = data?.audio as { url?: string } | undefined;
                if (audio?.url) return audio.url;
                return null;
              };
              const assetUrl = pickUrl();
              const KIND_BY_SPIRIT: Partial<Record<AgentRole, ChatAttachmentKind>> = {
                "image-specialist": "image",
                "video-specialist": "video",
                "music-specialist": "audio",
                "voice-specialist": "audio",
                "training-specialist": "image",
              };
              const MIME_BY_KIND: Record<ChatAttachmentKind, ChatAttachmentMimeType> = {
                image: "image/png",
                video: "video/mp4",
                audio: "audio/mpeg",
                pdf: "application/pdf",
                text: "text/plain",
              };
              const kind = KIND_BY_SPIRIT[firstGen] ?? "image";
              const attachment: ChatAttachment | null = assetUrl
                ? {
                    id: `spirit-post-${Date.now()}`,
                    name: `${genNickname}-${result.modelLabel || result.modelId}`,
                    url: assetUrl,
                    mimeType: MIME_BY_KIND[kind],
                    kind,
                  }
                : null;
              setMessages(prev => [...prev, {
                role: "orb",
                text: assetUrl
                  ? `🎨 ${genNickname} 用 ${result.modelLabel || result.modelId} 完成執行了。`
                  : `${genNickname} 跑完了但沒拿到輸出 URL。`,
                at: Date.now(),
                pagePath: locationPath,
                agentRole: firstGen,
                attachments: attachment ? [attachment] : undefined,
              }]);
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              setMessages(prev => [...prev, {
                role: "orb",
                text: `${genNickname} 執行時發生錯誤：${reason}`,
                at: Date.now(),
                pagePath: locationPath,
                agentRole: firstGen,
              }]);
            }
          })();
        }

        // 學學 / 路路 也被討論到 → 真的跳頁
        if (participants.includes("learning-specialist")) {
          additions.push({
            role: "orb" as const,
            text: `🧭 學學 帶你到教學中心 (/learn-hub)。`,
            at: m.timestamp + 2,
            pagePath: locationPath,
            agentRole: "learning-specialist",
          });
          // 立刻跳；polling effect 結束後 setMessages 已 commit
          setTimeout(() => setLocation("/learn-hub"), 200);
        } else if (participants.includes("navigator")) {
          const nav = detectNavIntent(userPrompt);
          if (nav?.path) {
            additions.push({
              role: "orb" as const,
              text: `🧭 路路 帶你到「${nav.label}」(${nav.path})。`,
              at: m.timestamp + 2,
              pagePath: locationPath,
              agentRole: "navigator",
            });
            setTimeout(() => setLocation(nav.path), 200);
          }
        }
        // 用完清掉，下一輪討論不要踩到舊 prompt
        lastDiscussionUserPromptRef.current = null;
      }
    }

    if (additions.length > 0) {
      setMessages(prev => [...prev, ...additions]);
    }

    // 收到 discussion_complete 立即收掉 polling + meta，比 90s 兜底快很多。
    if (completedReason !== null) {
      setActiveDiscussionId(null);
      setCollaborativeDiscussionMeta(null);
    }
  }, [activeDiscussionId, discussionMessagesQuery.data, locationPath, spiritInvokeMut, setLocation]);

  // 兜底：90 秒沒收完就自動清掉，避免 query 一直空轉。runner 預設 3 輪 *
  // 25s/turn ≈ 75s，留 15s buffer 應該夠。
  useEffect(() => {
    if (!activeDiscussionId) return;
    const handle = setTimeout(() => {
      setActiveDiscussionId(null);
    }, 90_000);
    return () => clearTimeout(handle);
  }, [activeDiscussionId]);

  const persistClarificationPicks =
    trpc.orbProxy.persistClarificationPicks.useMutation();
  // Multi-session backend wiring. All four are fire-and-forget — failure
  // never blocks the UI; the client-side localStorage copy is the source of
  // truth for the active session.
  const createConversationServer =
    trpc.orbConversations.create.useMutation();
  const updateConversationServer =
    trpc.orbConversations.update.useMutation();
  const deleteConversationServer =
    trpc.orbConversations.delete.useMutation();
  const clearConversationServer =
    trpc.orbConversations.clearMessages.useMutation();
  const appendMessagesServer =
    trpc.orbConversations.appendMessages.useMutation();
  const orbState = useOrbState();
  const { attachArrivalGuide } = useOrbGuide();
  const isMobile = useIsMobile();
    const codeTaskApprove = trpc.ai.codeTask.approve.useMutation();
    const codeTaskCancel = trpc.ai.codeTask.cancel.useMutation();
    // Phase 3: stay-on-page mode auto-approves the orb task instead of
    // surfacing the WorkflowConfirmationCard / handing off to a studio
    // page. The task then drives itself in the background server-side
    // and step events surface via the existing orbTask.events poll.
    const orbTaskApprove = trpc.ai.orbTask.approve.useMutation();

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

  // ─── Server → client conversation sync ──────────────────────────────
  // When we go from "guest" → "authenticated" (or first paint while logged
  // in) pull the user's existing conversation list and merge it with the
  // local one so other devices' sessions show up as tabs.
  const conversationListQuery = trpc.orbConversations.list.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    }
  );
  useEffect(() => {
    const remote = conversationListQuery.data?.conversations;
    if (!remote) return;
    setConversations(prev => {
      const byId = new Map<string, ConversationSummary>();
      for (const c of prev) byId.set(c.conversationId, c);
      for (const r of remote) {
        const existing = byId.get(r.conversationId);
        const merged: ConversationSummary = {
          conversationId: r.conversationId,
          title: r.title,
          pinned: Boolean(r.pinned),
          archivedAt: r.archivedAt
            ? new Date(r.archivedAt as unknown as string).getTime()
            : null,
          lastMessageAt: r.lastMessageAt
            ? new Date(r.lastMessageAt as unknown as string).getTime()
            : existing?.lastMessageAt ?? null,
          messageCount: r.messageCount ?? existing?.messageCount ?? 0,
          createdAt: r.createdAt
            ? new Date(r.createdAt as unknown as string).getTime()
            : existing?.createdAt ?? Date.now(),
          updatedAt: r.updatedAt
            ? new Date(r.updatedAt as unknown as string).getTime()
            : existing?.updatedAt ?? Date.now(),
        };
        byId.set(r.conversationId, merged);
      }
      const merged = Array.from(byId.values()).sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
      return merged;
    });
  }, [conversationListQuery.data]);

  useEffect(() => {
    if (messages.length > 0)
      saveMessagesToStorage(activeConversationId, messages);
  }, [messages, activeConversationId]);

  // ─── Context-window fullness watchdog (15 精靈 / 暖暖) ──────────────────
  // The chat handler trims history to MAX_CHAT_REQUEST_MESSAGES /
  // MAX_CHAT_REQUEST_CHARS before sending. Once the conversation
  // approaches that cap, older turns get silently dropped — the user
  // notices "the orb forgot what we said earlier" without realising why.
  // This watchdog publishes `context_near_full` at 80% and lets the
  // notification center surface 暖暖's "要不要開新對話？" card.
  // dedupeKey is per-conversation so jumping to a fresh tab doesn't
  // inherit the parent tab's nag.
  useEffect(() => {
    if (messages.length === 0) return;
    const usedChars = messages.reduce((acc, m) => acc + (m.text?.length ?? 0), 0);
    const messageCount = messages.length;
    const charsPct = (usedChars / MAX_CHAT_REQUEST_CHARS) * 100;
    const countPct = (messageCount / MAX_CHAT_REQUEST_MESSAGES) * 100;
    const usedPct = Math.round(Math.max(charsPct, countPct));
    if (usedPct < 80) return;
    const conversationTitle =
      conversations.find(c => c.conversationId === activeConversationId)?.title ?? "目前對話";
    ProactiveEventBus.publish(
      "context_near_full",
      {
        usedPct,
        messageCount,
        usedChars,
        capChars: MAX_CHAT_REQUEST_CHARS,
        conversationTitle,
      },
      // Per-conversation dedupe so a new tab doesn't inherit the nag.
      // 30 min interval — once the user dismisses we don't re-poke
      // until they've added enough turns to cross 80% again from a
      // fresh baseline (or half an hour passes).
      { dedupeKey: `context_near_full:${activeConversationId}`, dedupeMs: 30 * 60_000 }
    );
  }, [messages, activeConversationId, conversations]);

  // ─── Persist conversation list + active id whenever they change ────────
  useEffect(() => {
    saveConversationListToStorage(conversations);
  }, [conversations]);

  useEffect(() => {
    saveActiveConversationIdToStorage(activeConversationId);
  }, [activeConversationId]);

  // ─── Push new turns to the server ──────────────────────────────────────
  // The watermark map (conversationId → newest persisted `at`) is the guard
  // that stops the same message getting POSTed twice when React re-renders
  // or the user switches tabs back. It's persisted to localStorage so a
  // page reload doesn't reset everything to zero and re-push history.
  const lastPersistedAtRef = useRef<Map<string, number>>(
    new Map(Object.entries(loadPersistWatermarkFromStorage()))
  );
  // F4 fix: while a previous `appendMessagesServer.mutate` is still flying
  // the watermark hasn't been updated yet, so a fresh `setMessages` (e.g.
  // a streaming assistant token, a meta-action result) would re-fire this
  // effect with the same `fresh` slice and POST the in-flight messages
  // again, causing duplicate rows in `orb_messages`. We track which `at`
  // timestamps are pending and exclude them from the next batch.
  const pendingAtsRef = useRef<Map<string, Set<number>>>(new Map());
  useEffect(() => {
    if (!isAuthenticated || !activeConversationId || messages.length === 0)
      return;
    const lastAt = lastPersistedAtRef.current.get(activeConversationId) ?? 0;
    const inFlight = pendingAtsRef.current.get(activeConversationId);
    const fresh = messages.filter(m => {
      if (m.at <= lastAt) return false;
      if (inFlight && inFlight.has(m.at)) return false;
      return true;
    });
    if (fresh.length === 0) return;
    const batch = fresh.slice(-20);
    const payload = batch.map(m => ({
      role: m.role,
      text: m.text,
      at: m.at,
      metadata: {
        ...(m.intent ? { intent: m.intent } : {}),
        ...(m.pagePath ? { pagePath: m.pagePath } : {}),
        ...(m.attachments ? { attachments: m.attachments } : {}),
        ...(m.actions ? { actions: m.actions } : {}),
        ...(m.webSources ? { webSources: m.webSources } : {}),
        // 15 精靈：把接手的精靈 id 一起存進 metadata，未來重新打開對話、
        // 全站 widget 列表都能直接讀出當輪是誰回答。沒值就不寫，保持兼容。
        ...(m.agentRole ? { agentRole: m.agentRole } : {}),
        ...(typeof m.agentRoleConfidence === "number"
          ? { agentRoleConfidence: m.agentRoleConfidence }
          : {}),
      },
    }));
    let pendingForConv = pendingAtsRef.current.get(activeConversationId);
    if (!pendingForConv) {
      pendingForConv = new Set<number>();
      pendingAtsRef.current.set(activeConversationId, pendingForConv);
    }
    for (const m of batch) pendingForConv.add(m.at);
    const releasePending = () => {
      const set = pendingAtsRef.current.get(activeConversationId);
      if (!set) return;
      for (const m of batch) set.delete(m.at);
      if (set.size === 0) pendingAtsRef.current.delete(activeConversationId);
    };
    appendMessagesServer.mutate(
      { conversationId: activeConversationId, messages: payload },
      {
        onSuccess: () => {
          const newest = batch[batch.length - 1].at;
          const current = lastPersistedAtRef.current.get(activeConversationId) ?? 0;
          // Watermark advances monotonically — concurrent batches that
          // finish out of order must not regress it.
          if (newest > current) {
            lastPersistedAtRef.current.set(activeConversationId, newest);
            savePersistWatermarkToStorage(lastPersistedAtRef.current);
          }
          releasePending();
        },
        onError: () => {
          // Stay quiet — local copy is fine, retry on next message
          releasePending();
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeConversationId, isAuthenticated]);

  // Keep the active conversation's summary up to date (last message time +
  // count) so the tab list reflects activity without an extra round-trip.
  useEffect(() => {
    if (!activeConversationId || messages.length === 0) return;
    setConversations(prev => {
      const idx = prev.findIndex(
        c => c.conversationId === activeConversationId
      );
      const lastAt = messages[messages.length - 1]?.at ?? Date.now();
      const next: ConversationSummary = idx >= 0
        ? {
            ...prev[idx],
            messageCount: messages.length,
            lastMessageAt: lastAt,
            updatedAt: Date.now(),
            // Auto-fill placeholder titles once we have a user turn
            title:
              prev[idx].title === DEFAULT_CONVERSATION_TITLE
                ? deriveTitleFromMessages(messages)
                : prev[idx].title,
          }
        : {
            conversationId: activeConversationId,
            title: deriveTitleFromMessages(messages),
            pinned: false,
            archivedAt: null,
            lastMessageAt: lastAt,
            messageCount: messages.length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
      const others = prev.filter(
        c => c.conversationId !== activeConversationId
      );
      return [next, ...others];
    });
  }, [messages, activeConversationId]);

  // Persist the open clarification so it survives a reload — otherwise the
  // user loses context if they refresh while waiting to disambiguate.
  useEffect(() => {
    saveClarificationToStorage(pendingClarification);
  }, [pendingClarification]);

  const orbShortcutEnabled =
    (agentPreferencesQuery.data as { orbShortcutEnabled?: boolean } | undefined)?.orbShortcutEnabled !== false;

  // Agent loop v5 — keep PageAgent's reporting-task-id in lock-step
  // with whichever server task we're currently following. This is what
  // lets the chain runner's observer see what the destination page
  // looks like (was the prompt filled, did Generate succeed, …).
  useEffect(() => {
    pageAgent.setReportingTaskId(latestServerTaskId);
    return () => {
      // Clear on unmount only — successive renders just overwrite.
    };
  }, [latestServerTaskId, pageAgent]);

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
    if (messages.length === 0) {
      setMessages([{ role: "orb", text: welcomeMessage, at: Date.now(), pagePath: locationPath }]);
      // Prime first-open quick replies with the four most-useful new shortcuts
      // so users discover them without waiting for an LLM round-trip. The
      // built-in detectors handle every one of these locally.
      setSuggestions([
        { text: "找我之前的素材" },
        { text: "幫我做品牌貼文素材包" },
        { text: "把今天的對話匯出成 PDF" },
        { text: "光球記得我什麼？" },
      ]);
    }
    // initialize once only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearWorkflowExecution = useCallback(() => {
    setWorkflowExecution(null);
  }, []);

  // ─── Meta action implementation ─────────────────────────────────────
  // Find the most recent runWorkflow action embedded in chat history; used
  // by `shareViaLink` when target = "lastWorkflow". We scan from the newest
  // message backward and prefer pending workflow if one is on screen.
  const findLastWorkflow = useCallback((): RunWorkflowAction | null => {
    if (pendingWorkflow) {
      const action: RunWorkflowAction = {
        type: "runWorkflow",
        name: pendingWorkflow.name,
        steps: pendingWorkflow.actions
          .filter((a): a is RunWorkflowAction => a.type === "runWorkflow")
          .flatMap(a => a.steps),
      };
      if (action.steps.length > 0) return action;
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const acts = messages[i]?.actions;
      if (!acts) continue;
      for (let j = acts.length - 1; j >= 0; j -= 1) {
        const a = acts[j];
        if (a.type === "runWorkflow" && a.steps.length > 0) return a;
      }
    }
    return null;
  }, [messages, pendingWorkflow]);

  const messagesForExport = useMemo<ChatMessageForExport[]>(
    () =>
      messages.map(m => ({
        role: m.role,
        text: m.text,
        at: m.at,
        intent: m.intent,
        pagePath: m.pagePath,
      })),
    [messages]
  );

  useEffect(() => {
    runMetaActionRef.current = async (action: AgentAction) => {
      if (action.type === "exportChatPdf") {
        const result = exportChatToPdf({
          messages: messagesForExport,
          scope: action.scope,
          title: action.title,
        });
        const text = result.ok
          ? `📄 已開啟列印視窗，請在跳出來的對話框選「另存為 PDF」即可下載 ${result.count} 則訊息。`
          : result.reason === "no-messages-in-scope"
            ? "📄 這個範圍內還沒有訊息可以匯出。"
            : result.reason === "popup-blocked"
              ? "📄 瀏覽器擋下了新分頁，請在網址列附近允許彈出視窗後再試一次。"
              : `📄 匯出時遇到問題：${result.reason ?? "unknown"}`;
        setMessages(prev => [
          ...prev,
          { role: "orb", text, at: Date.now(), pagePath: locationPath },
        ]);
        return;
      }
      if (action.type === "shareViaLink") {
        const result = await shareViaProcessLink({
          target: action.target,
          workflow: action.target === "lastWorkflow" ? findLastWorkflow() : null,
          chatMessages: action.target === "currentChat" ? messagesForExport : undefined,
          title: action.title,
        });
        let text: string;
        if (!result.ok) {
          text =
            result.reason === "no-workflow-to-share"
              ? "🔗 還沒有可分享的工作流程，先讓我跑過一次再分享吧。"
              : result.reason === "no-chat-history-to-share"
                ? "🔗 目前還沒有聊天內容可以打包成連結。"
                : `🔗 產生分享連結時遇到問題：${result.reason ?? "unknown"}`;
        } else {
          const copyHint = result.copied
            ? "已複製到剪貼簿"
            : "請手動複製這個連結";
          text =
            `🔗 已把${
              action.target === "currentChat" ? "這段對話" : "剛剛的工作流程"
            }打包成可分享連結（共 ${result.stepCount ?? 0} 步），${copyHint}：\n${result.url ?? ""}`;
        }
        setMessages(prev => [
          ...prev,
          { role: "orb", text, at: Date.now(), pagePath: locationPath },
        ]);
      }
    };
  }, [messagesForExport, findLastWorkflow, locationPath]);

  const executeActions = useCallback(async (actionsToExecute: AgentAction[], options: {
    intent?: string;
    requireConfirmation?: boolean;
  } = {}) => {
    // Perception loop preferences. Defaults match
    // DEFAULT_AGENT_PREFERENCES (perceptionEnabled=true, "balanced")
    // so existing users get the behaviour the audit comments promised.
    const perceptionEnabled =
      (agentPreferencesQuery.data as { perceptionEnabled?: boolean } | undefined)
        ?.perceptionEnabled !== false;
    const perceptionStrictnessRaw = (agentPreferencesQuery.data as
      | { perceptionStrictness?: string }
      | undefined)?.perceptionStrictness;
    const perceptionStrictness: "lenient" | "balanced" | "strict" =
      perceptionStrictnessRaw === "lenient" || perceptionStrictnessRaw === "strict"
        ? perceptionStrictnessRaw
        : "balanced";
    // Seed the rolling "before" snapshot with the current page state so
    // the first step's verdict has something to diff against.
    perceptionSnapshotRef.current = pageAgent.snapshot ?? null;
    // ─── Client-only meta actions ────────────────────────────────────────
    // exportChatPdf / shareViaLink never reach the orchestrator — they run
    // entirely in the browser and produce a system reply directly. We pull
    // them out of the list first so the orchestrator only sees real actions.
    const metaActions = actionsToExecute.filter(
      a => a.type === "exportChatPdf" || a.type === "shareViaLink"
    );
    const orchestratorActions = actionsToExecute.filter(
      a => a.type !== "exportChatPdf" && a.type !== "shareViaLink"
    );

    if (metaActions.length > 0) {
      for (const meta of metaActions) {
        await runMetaActionRef.current?.(meta);
      }
    }

    if (orchestratorActions.length === 0) return;

    const nextWorkflowExecution = buildWorkflowExecutionState(orchestratorActions);
    if (nextWorkflowExecution) setWorkflowExecution(nextWorkflowExecution);

    orbState.setState(
      "executing",
      nextWorkflowExecution ? `${nextWorkflowExecution.name}（${nextWorkflowExecution.total} 步）` : "執行中"
    );

    try {
      const results = await executeGlobalActions(orchestratorActions, {
        currentPage: pageAgent.snapshot,
        navigate: async path => {
          // Carry recent chat context into 導演 AI so the user doesn't land on
          // an empty page after the orb says "我帶你過去". Only fires for the
          // /agent → /director hop; other targets keep their existing flow.
          if (path === "/director" && locationPath !== "/director") {
            try {
              writeDirectorHandoff(
                buildDirectorHandoffPayload(messagesRef.current),
              );
            } catch (err) {
              console.warn(
                "[GlobalOrbChat] Failed to write director handoff:",
                err,
              );
            }
          }
          if (path !== locationPath) {
            // 把光球幫使用者要做的整套 actions 預先掛到 OrbGuide 的 arrival 卡。
            // 即使 setLocation 後 page 還沒 hydrate，arrival 緊湊卡也已經告訴
            // 使用者「光球幫你做了什麼、接下來可以選什麼」，不會只剩底下那顆
            // 「完成」泡泡。
            //
            // orbMessage 是卡片 header 底下那行小字。header 已經寫了
            // 「已帶你到 ___」，所以這裡不要再用「已帶你來處理：…」這種重覆
            // 動詞當開頭；把 intent 當成「你剛剛是想做什麼」的脈絡呈現，
            // 並只保留前 60 字（Tailwind 的 truncate 會把過長的部份吃掉，
            // 但提早截字可以讓「…」落在語意完整的位置）。
            // LLM 經常生出「帶你去 / 帶你來 / 我幫你 / 我來 / 為你」這種主詞
            // 動詞，跟 header「已帶你到 ___」連在一起念就是「已帶你到 X，
            // 帶你去 X 規劃…」很怪。把這些開頭片語咬掉，只留下意圖本身。
            const trimmedIntent = (options.intent?.trim() ?? "")
              .replace(/^(已?帶你(到|去|來)|我來|我幫你|為你|幫你)[「『]?[^「『]{0,12}[」』]?[\s,，。:：、—-]*/, "")
              .trim();
            const condensedIntent =
              trimmedIntent.length > 60
                ? `${trimmedIntent.slice(0, 58)}…`
                : trimmedIntent;
            attachArrivalGuide({
              targetPath: path,
              actions: orchestratorActions,
              orbMessage: condensedIntent
                ? `剛剛的指令：${condensedIntent}`
                : undefined,
              // 聊天驅動的跳頁：要求 panel 落在「自由聊天」視圖。沒有這個
              // hint 的話 panel 會預設停在引導模式（靜態按鈕），使用者就會
              // 看到「跳了頁但沒對話框延續」— 這是這次回報的核心 bug。
              preferredPanelMode: "chat",
            });
            setLocation(path);

            // 「自動續話」：跳頁後由目的地頁的精靈用第一人稱接手，補一條 chat
            // 訊息延續對話。這條訊息掛上 agentRole，下游的 spirit chip 會自
            // 動把頭像 + 家族色渲染上去，讓使用者看到「換誰在線了」。
            //
            // 1200ms 延遲是讓使用者能先看到光球前一棒的回覆訊息，再看到「換
            // 人接手」的續話 — 太快兩條訊息會擠在一起像同一個人講；太慢使
            // 用者會以為對話卡住。
            const arrivalSpirit = pickArrivalSpiritForPath(path);
            if (arrivalSpirit) {
              const followUpText = buildArrivalFollowUpText(
                arrivalSpirit,
                trimmedIntent || options.intent,
              );
              setTimeout(() => {
                setMessages(prev => [
                  ...prev,
                  {
                    role: "orb",
                    text: followUpText,
                    at: Date.now(),
                    pagePath: path,
                    agentRole: arrivalSpirit,
                    intent: "arrival-follow-up",
                  },
                ]);
              }, 1200);
            }
          }
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
        // Sub-phase 事件 — 每一步內部的 navigate / settle / awaiting_handler /
        // dispatching / observing / retrying 都會 surface 到 panel 的「目前
        // 子狀態」chip 和 elapsed timer。reducer 會自動 dedupe 同 phase 的
        // 重複事件，所以這裡可以放心 fire 多次。
        onStepProgress: event => {
          setWorkflowExecution(prev =>
            prev ? setWorkflowStepPhase(prev, event) : prev
          );
        },
        // Perception loop wiring — when the user has perceptionEnabled
        // turned on, we capture a snapshot before each step (rolling
        // ref below), call evaluateStepOutcome on the (action, before,
        // after, result) tuple, and forward the recommendation. The
        // strictness setting tunes how aggressively a "no-effect"
        // verdict escalates: lenient never retries, balanced uses the
        // verdict as-is, strict promotes "retry" to "replan" so the
        // planner gets called.
        observeAfterStep: perceptionEnabled
          ? async ({ step, result }) => {
              try {
                const before = perceptionSnapshotRef.current;
                const after = pageAgent.snapshot ?? null;
                // Workflow steps carry the action as `actionType + payload`,
                // not as a tagged AgentAction union. Synthesise the minimal
                // shape evaluateStepOutcome needs — it only switches on
                // `.type`. The cast is acceptable here because the
                // perception loop never mutates the action.
                const syntheticAction = {
                  type: step.actionType,
                  ...(step.path ? { path: step.path } : {}),
                } as unknown as AgentAction;
                const verdict = evaluateStepOutcome({
                  action: syntheticAction,
                  before,
                  after,
                  dispatchResult: result,
                });
                perceptionSnapshotRef.current = after;
                let recommendation = verdict.recommendation;
                if (perceptionStrictness === "lenient" && recommendation === "retry") {
                  recommendation = "proceed";
                } else if (
                  perceptionStrictness === "strict" &&
                  recommendation === "retry"
                ) {
                  recommendation = "replan";
                }
                return { recommendation, reason: verdict.reason };
              } catch (err) {
                console.warn(
                  "[GlobalOrbChat] perception observeAfterStep failed:",
                  err instanceof Error ? err.message : String(err),
                );
                return { recommendation: "proceed" };
              }
            }
          : undefined,
      });

      const failed = results.find(result => !result.ok);
      if (failed) {
        const failedReason = failed.reason ?? "unknown failure";
        const now = Date.now();
        setWorkflowExecution(prev =>
          prev ? failWorkflowAtCurrentStep(prev, failedReason, now) : prev
        );
        orbState.setState("error", `執行失敗：${failedReason.slice(0, 40)}`);
        // 同一份 mapping 走 panel 和 chat bubble 兩條路 — 不然使用者會看到
        // 浮動卡片寫「這頁不支援這個動作」、聊天列卻寫「執行時遇到問題：
        // unsupported action」對不上，會以為是兩個錯。
        const failedActionType =
          orchestratorActions[results.indexOf(failed)]?.type;
        const failure = formatWorkflowFailure(failedReason, {
          actionType: failedActionType,
        });
        const friendlyText = failure.hint
          ? `⚠️ ${failure.summary}\n${failure.hint}`
          : `⚠️ ${failure.summary}`;
        setMessages(prev => [...prev, {
          role: "orb",
          text: friendlyText,
          at: Date.now(),
          pagePath: locationPath,
        }]);
        pageAgent.reportFeedback({
          status: "failed",
          actionType: failedActionType ?? "runWorkflow",
          note: failedReason,
        });
        // notifyOnError mirror — surface a system toast for the
        // partial-failure path the same way the catch branch does.
        const notifyOnStepFail =
          (agentPreferencesQuery.data as { notifyOnError?: boolean } | undefined)
            ?.notifyOnError !== false;
        if (notifyOnStepFail) {
          toast.error("光球執行流程中斷", {
            description: failure.summary.slice(0, 200),
            duration: 12_000,
          });
        }
      } else if (nextWorkflowExecution) {
        const now = Date.now();
        setWorkflowExecution(prev => (prev ? completeWorkflow(prev, now) : prev));
        orbState.setState("success", `${nextWorkflowExecution.name} 完成`);
        // Wire notifyOnCompletion so the user gets a system toast even
        // when the orb panel is closed. Defaults to true (matches
        // DEFAULT_AGENT_PREFERENCES); only suppressed when explicitly
        // false. Safe-guard: fire only when there's a real workflow with
        // multiple steps — single-step "complete" events would spam.
        const notifyComplete =
          (agentPreferencesQuery.data as { notifyOnCompletion?: boolean } | undefined)
            ?.notifyOnCompletion !== false;
        if (notifyComplete && nextWorkflowExecution.total > 1) {
          toast.success(`✅ ${nextWorkflowExecution.name} 完成`, {
            description: `已完成 ${nextWorkflowExecution.total} 步`,
            duration: 6_000,
          });
        }
      } else {
        orbState.setState("success", "完成");
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[GlobalOrbChat] Action execution error:", reason);
      setWorkflowExecution(prev =>
        prev ? failWorkflowAtCurrentStep(prev, reason, Date.now()) : prev
      );
      orbState.setState("error", `執行錯誤：${reason.slice(0, 40)}`);
      setMessages(prev => [...prev, {
        role: "orb",
        text: `⚠️ 執行流程時遇到問題：${reason}`,
        at: Date.now(),
        pagePath: locationPath,
      }]);
      // Wire notifyOnError. Defaults to true; surfaces a persistent toast
      // (no duration limit) so the user can read the failure even after
      // navigating away.
      const notifyError =
        (agentPreferencesQuery.data as { notifyOnError?: boolean } | undefined)
          ?.notifyOnError !== false;
      if (notifyError) {
        toast.error("光球執行流程失敗", {
          description: reason.slice(0, 200),
          duration: 12_000,
        });
      }
    }
  }, [pageAgent, locationPath, setLocation, orbState, attachArrivalGuide, agentPreferencesQuery.data]);

  // Forward declaration for the auto-execute branch inside `sendMessage`.
  // The actual `startPendingWorkflow` callback is defined further down (it
  // depends on `executeActions` + `pendingWorkflow`); we keep a ref so we can
  // invoke the latest version without creating a circular hook dep.
  const startPendingWorkflowRef = useRef<(() => Promise<void>) | null>(null);

  // Consecutive clarification round counter — bumps each time we surface a
  // pending clarification card and resets the moment a non-clarification
  // reply lands. We use it to cap the wizard at 2 rounds: on the third
  // attempt we switch to a "best-guess + confirm" reply instead of asking
  // yet another dimension question, so users don't get stuck in a 4-5 turn
  // form. Stored as a ref to avoid re-renders for a counter only the next
  // sendMessage cares about.
  const clarificationRoundsRef = useRef(0);
  const MAX_CLARIFICATION_ROUNDS = 2;

  // Monotonic id stamped on each sendMessage invocation. After every await
  // we compare back to the ref — if the user cleared history or kicked off
  // a newer turn while the LLM round-trip was in flight, we drop the late
  // result instead of mutating now-stale state (which would otherwise
  // resurrect a cleared history or overwrite a freshly-typed message).
  const sendRequestIdRef = useRef(0);

  // Both clarification branches (server-driven `needsClarification` and the
  // client-side fallback `intentDetection`) end up doing the same thing
  // when the round counter hits MAX_CLARIFICATION_ROUNDS: surface a
  // best-guess reply, reset the counter, pin a fixed quick-reply set. This
  // helper centralises that so the two branches can't drift in copy or
  // suggestion order.
  const applyClarificationCap = useCallback((bestGuessReply: string) => {
    clarificationRoundsRef.current = 0;
    const cappedReply = [
      "🎯 我們繞了幾圈，我先用我目前理解的方向幫你跑：",
      bestGuessReply,
      "",
      "要修改任何一項，直接告訴我（例如「改 30 秒」「改成手繪風」）；想全部重來輸入「重置對話」。",
    ].join("\n");
    setMessages(prev => [...prev, {
      role: "orb",
      text: cappedReply,
      at: Date.now(),
      pagePath: locationPath,
      intent: "反問次數已滿，先以最佳猜測前進",
    }]);
    setSuggestions([
      { text: "這樣開始" },
      { text: "改長度" },
      { text: "改風格" },
      { text: "重置對話" },
    ]);
  }, [locationPath]);

  const sendMessage = useCallback(async (
    text: string,
    attachments: ChatAttachment[] = [],
    options: SendMessageOptions = {}
  ) => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isSending) return;
    const requestedMode = options.requestedMode;

    // 15 精靈 / 巧巧 (quality-coach)：使用者送出的 prompt 過短且沒 @ 點名，
    // 巧巧主動跳出來建議補幾個維度。dedupe by hash 避免每打 1 字觸發一次。
    // 條件刻意保守 — 只在「真的太短」(<8 char) 且「無附件、無 @-mention」
    // 時觸發。
    //
    // 重要：巧巧必須讀對話上下文才能判斷該不該跳出來。如果上一條 user 訊息
    // 是長 prompt（≥ 16 字），現在這條短句多半是「好繼續」「ok 繼續做」這
    // 類延續對話，不是新的需求 — 此時不該再叫巧巧勸使用者補維度，否則就
    // 像截圖那樣對「好繼續把腳本做好」回應「prompt 有點短」，明顯沒讀對話。
    if (
      trimmed.length > 0 &&
      trimmed.length < 8 &&
      attachments.length === 0 &&
      !/^@/.test(trimmed)
    ) {
      const recentUserHistory = messagesRef.current
        .filter(m => m.role === "user")
        .slice(-3); // 看最近 3 條 user 訊息決定是否為延續對話
      const hasRecentLongPrompt = recentUserHistory.some(
        m => (m.text ?? "").trim().length >= 16,
      );
      // 也跳過明顯是「同意 / 延續」短語：好、好的、繼續、ok、yes、go…
      const isContinuationCue = /^(好|好的|好喔|好啊|繼續|繼續做|ok|okay|yes|對|是的|可以|嗯|go|next|讚)$|(請|麻煩).{0,3}繼續/i.test(trimmed);
      if (!hasRecentLongPrompt && !isContinuationCue) {
        ProactiveEventBus.publish(
          "prompt_too_short",
          {
            prompt: trimmed,
            suggestedAddition: "場景、風格、用途其中一個",
          },
          { dedupeKey: trimmed.slice(0, 4), dedupeMs: 60_000 }
        );
      }
    }

    // Stamp this turn so any awaited result that resolves after the user
    // clears history (or kicks off a newer turn) can be detected and
    // discarded before it mutates state.
    const turnId = ++sendRequestIdRef.current;
    const isStale = () => sendRequestIdRef.current !== turnId;

    try {
      const userMessage: ChatMessage = {
      role: "user",
      text: trimmed,
      at: Date.now(),
      pagePath: locationPath,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    // Read history from the ref so this callback doesn't have to list
    // `messages` as a dep (which would rebuild it — and every consumer that
    // depends on the context value — on every committed message).
    const nextHistory = [...messagesRef.current, userMessage];
    setMessages(nextHistory);
    setInput("");
    setSuggestions([]);
    setIsSending(true);

    // Pre-parse long-form briefs once; reused for the LLM context hint and
    // the multi-dim wizard's prefill below so we don't re-parse on the same
    // turn.
    const parsedScriptStructure =
      trimmed.length >= SCRIPT_STRUCTURE_MIN_CHARS
        ? extractScriptStructure(trimmed)
        : null;

    // ─── Edge-case prompt scenarios ──────────────────────────────────────
    // Catches empty / noise / extremely-long input, frustration & cancel
    // intents, self-help queries, history references, and same-prompt loops
    // BEFORE we burn an LLM round-trip. Only runs in default mode so users
    // who explicitly chose "navigate / ask-feature / agent" still hit the
    // dedicated handlers below.
    if (!requestedMode) {
      const recentUserTexts = nextHistory
        .filter(m => m.role === "user")
        .slice(-4, -1) // exclude the message we just pushed
        .map(m => m.text);
      const scenario = detectOrbPromptScenario({
        text: trimmed,
        hasAttachments: attachments.length > 0,
        recentUserTexts,
      });
      if (scenario) {
        try {
          const reply = buildScenarioReplyText(scenario);
          setMessages(prev => [...prev, {
            role: "orb",
            text: reply,
            at: Date.now(),
            pagePath: locationPath,
            intent: scenario.intent,
          }]);
          if (scenario.suggestions && scenario.suggestions.length > 0) {
            setSuggestions(scenario.suggestions.map(text => ({ text })));
          }
          if (scenario.followUp === "reset-conversation") {
            orbState.setState("idle", "等你再開口");
          } else {
            orbState.setState("idle");
          }
          return;
        } finally {
          setIsSending(false);
        }
      }
    }

    // ─── Site-wide search shortcut ───────────────────────────────────────
    // "找我之前的森林圖" / "搜尋 calm BGM" / "翻一下我的筆記提到禪意"
    // 不走 LLM — 直接打 orbProxy.unifiedSearch 然後把結果 markdown 化。
    // 只在 default mode 攔截，不影響使用者明確選了「跳頁／計畫／代理」模式。
    if (!requestedMode) {
      const searchIntent = detectOrbSearchIntent(trimmed);
      if (searchIntent) {
        orbState.setState("searching", `搜尋「${searchIntent.query}」`);
        try {
          const result = await trpcUtils.orbProxy.unifiedSearch.fetch({
            query: searchIntent.query,
            ...(searchIntent.types ? { types: searchIntent.types } : {}),
          });
          if (isStale()) return;
          orbState.setState(
            result.items.length > 0 ? "success" : "idle",
            result.items.length > 0
              ? `找到 ${result.items.length} 筆`
              : `沒有命中`
          );
          const headerText =
            result.items.length === 0
              ? `🔍 全站翻找「${searchIntent.query}」沒有命中——可以試試把關鍵字改寬一點，或告訴我要找哪一類（素材／筆記／生成記錄／教學）。`
              : `🔍 為「${searchIntent.query}」找到 ${result.items.length} 筆結果：`;
          const fallbackText =
            result.items.length > 0
              ? `${headerText}\n\n${formatUnifiedSearchReply(searchIntent.query, result.items)}`
              : headerText;
          setMessages(prev => [...prev, {
            role: "orb",
            text: fallbackText,
            at: Date.now(),
            pagePath: locationPath,
            intent: `站內搜尋「${searchIntent.query}」`,
            searchResults: result.items.length > 0 ? result.items : undefined,
            searchQuery: searchIntent.query,
          }]);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          orbState.setState("error", `搜尋失敗：${reason.slice(0, 40)}`);
          setMessages(prev => [...prev, {
            role: "orb",
            text: `🔍 搜尋時遇到問題：${reason}`,
            at: Date.now(),
            pagePath: locationPath,
          }]);
        }
        return;
      }
    }

    // ─── Feature-inquiry shortcut ────────────────────────────────────────
    // 「你能做什麼？」「有哪些功能？」這類 NL 詢問直接餵 buildFeatureSummaryReply
    // 結果（取自 APP_PAGE_REGISTRY），保證使用者看到的功能清單就是站上實際
    // 註冊的，不會被 LLM 幻想出不存在的 feature。
    //
    // 個人化：把 favoriteSpirits / mutedSpirits 從 agentPreferences 帶進去，
    // 讓「最愛精靈負責的頁面」排在前面，「靜音精靈負責的頁面」隱藏起來。
    // 之後再丟一排 suggestion chips 當作主動 CTA — 使用者可一鍵把純問答
    // 切換成 plan 模式真的執行，不再停在「看完清單沒下一步」。
    if (!requestedMode && detectFeatureInquiry(trimmed)) {
      const prefForSummary = agentPreferencesQuery.data ?? null;
      const featureSummary = buildFeatureSummaryReply({
        favoriteSpirits:
          ((prefForSummary as { favoriteSpirits?: string[] } | null)
            ?.favoriteSpirits ?? []) as AgentRole[],
        mutedSpirits:
          ((prefForSummary as { mutedSpirits?: string[] } | null)
            ?.mutedSpirits ?? []) as AgentRole[],
      });
      setMessages(prev => [...prev, {
        role: "orb",
        text: featureSummary,
        at: Date.now(),
        pagePath: locationPath,
        intent: "feature-inquiry",
      }]);
      setSuggestions(buildFeatureInquiryCtaSuggestions(trimmed));
      orbState.setState("idle", "列了站上的功能");
      return;
    }

    // ─── Spirit dispatch shortcut (15-spirit chat tools + collab handoff) ─
    // 使用者 @ 任何精靈時，依 SPIRIT_CHAT_TOOLS 決定要走哪條路：
    //   - fal-generation:   走 trpc.spirit.invoke 真實打 fal.ai 出圖 / 影 / 音 / 聲 / 訓練
    //   - navigate:         直接 setLocation 跳頁（路路 / 學學）
    //   - search:           走 trpc.orbProxy.unifiedSearch 站內找（查查）
    //   - llm-persona:      fall through 到既有 LLM 流程，由 selectRoleForIntent
    //                       套上該精靈的人格切片（暖暖 / 導導 / 品品 / 編編 /
    //                       巧巧 / 財財 / 守守 6 位）
    //
    // 工具完成後依 SPIRIT_COLLAB_PROTOCOL[mentioned].handoffs 把「下一棒精靈」
    // 列為建議按鈕 — 形成 15 位協作鏈。按按鈕會把 `@nextSpirit ...` 灌進
    // 下一輪輸入，使用者一鍵交棒。
    //
    // 只在 default mode 攔截，避免 hijack 「跳頁 / 計畫 / 代理」這幾個明示模式。
    if (!requestedMode) {
      const mentioned = detectSpiritMention(trimmed);
      const cleanPrompt = stripSpiritMention(trimmed);
      const tool: SpiritChatTool | null = mentioned
        ? SPIRIT_CHAT_TOOLS[mentioned]
        : null;

      // 把 SPIRIT_COLLAB_PROTOCOL 的下一棒換成可點的 chip — 點了就會把
      // `@下一棒精靈 ` 灌進 input。沒掛 action 是因為使用者通常還想接著
      // 補一句話描述（例如「@影影 做成 5 秒動畫」），自動觸發反而失控。
      const buildHandoffChips = (from: AgentRole): ChatSuggestion[] => {
        const handoffs = SPIRIT_COLLAB_PROTOCOL[from]?.handoffs ?? [];
        return handoffs.slice(0, 3).map(h => {
          const targetNickname = getPrimaryNicknameForRole(h.to);
          return { text: `@${targetNickname} ${h.reason}` };
        });
      };

      if (mentioned && tool) {
        const nickname = getPrimaryNicknameForRole(mentioned);

        // ── A) fal-generation: 真實打 fal.ai 出資產 ──
        if (
          tool.kind === "fal-generation" &&
          cleanPrompt.length >= tool.minPromptChars
        ) {
          const stateLabel: Partial<Record<AgentRole, string>> = {
            "image-specialist": "圖圖正在畫…",
            "video-specialist": "影影正在拍…",
            "music-specialist": "音音正在配樂…",
            "voice-specialist": "聲聲正在配音…",
            "training-specialist": "練練正在訓練…",
          };
          orbState.setState(
            "thinking",
            stateLabel[mentioned] ?? `${nickname} 正在處理…`,
          );
          try {
            const result = await spiritInvokeMut.mutateAsync({
              spirit: mentioned,
              prompt: cleanPrompt,
            });
            if (isStale()) return;

            if (!result.success) {
              orbState.setState("error", `${nickname} 失敗`);
              setMessages(prev => [...prev, {
                role: "orb",
                text: `${nickname} 沒辦法完成這次生成：${result.error ?? "未知錯誤"}`,
                at: Date.now(),
                pagePath: locationPath,
                agentRole: mentioned,
              }]);
              return;
            }

            // 從 fal.ai 回傳的不同 shape 中取出第一個資產 URL。各模型 schema 略
            // 有差異（images[0].url / image.url / video.url / audio.url / 純 url），
            // 統一退回到 first-non-null。
            const data = result.data as Record<string, unknown>;
            const pickUrl = (): string | null => {
              const direct = (data?.url ?? (data as { output?: string })?.output) as
                | string
                | undefined;
              if (typeof direct === "string" && direct) return direct;
              const images = (data?.images as Array<{ url?: string }> | undefined)
                ?? (data as { image?: { url?: string } | string }).image;
              if (Array.isArray(images) && images[0]?.url) return images[0].url;
              if (typeof images === "string") return images;
              const video = data?.video as { url?: string } | undefined;
              if (video?.url) return video.url;
              const audio = data?.audio as { url?: string } | undefined;
              if (audio?.url) return audio.url;
              return null;
            };
            const assetUrl = pickUrl();

            // 依精靈決定附件類型；training-specialist 走 image preview（LoRA 預覽圖）
            const KIND_BY_SPIRIT: Partial<Record<AgentRole, ChatAttachmentKind>> = {
              "image-specialist": "image",
              "video-specialist": "video",
              "music-specialist": "audio",
              "voice-specialist": "audio",
              "training-specialist": "image",
            };
            const MIME_BY_KIND: Record<ChatAttachmentKind, ChatAttachmentMimeType> = {
              image: "image/png",
              video: "video/mp4",
              audio: "audio/mpeg",
              pdf: "application/pdf",
              text: "text/plain",
            };
            const kind = KIND_BY_SPIRIT[mentioned] ?? "image";

            const attachment: ChatAttachment | null = assetUrl
              ? {
                  id: `spirit-${Date.now()}`,
                  name: `${nickname}-${result.modelLabel || result.modelId}`,
                  url: assetUrl,
                  mimeType: MIME_BY_KIND[kind],
                  kind,
                }
              : null;

            orbState.setState(
              assetUrl ? "success" : "idle",
              assetUrl ? `${nickname} 出爐` : `${nickname} 完成（無附件）`,
            );
            setMessages(prev => [...prev, {
              role: "orb",
              text: assetUrl
                ? `🎨 ${nickname} 用 ${result.modelLabel || result.modelId} 完成了。`
                : `${nickname} 完成了，但沒有取到輸出 URL。`,
              at: Date.now(),
              pagePath: locationPath,
              agentRole: mentioned,
              attachments: attachment ? [attachment] : undefined,
            }]);
            // 工具完成 → 列下一棒精靈（最多 3 個）
            setSuggestions(buildHandoffChips(mentioned));

            // ── 真實協作：自動把生成結果交給接手精靈做一輪討論 ──
            // 取 SPIRIT_COLLAB_PROTOCOL 第一棒（最多 2 位）作為 allowedRoles，
            // 啟動 startAutoDiscussion；既有的 1.5s polling 會把每位精靈的回應
            // 逐條塞進 chat。先補一條「🤝 {nicks} 接手討論中」當佔位，使用者
            // 立刻看到「協作真的在跑」而不是按完按鈕沒反應。
            //
            // 條件刻意保守：只在 assetUrl 真的拿到時觸發；沒生成成功就只列
            // 建議 chip 不主動把 LLM 又燒一輪。
            if (assetUrl) {
              const handoffsForCollab = (
                SPIRIT_COLLAB_PROTOCOL[mentioned]?.handoffs ?? []
              ).slice(0, 2);
              const handoffTargets = handoffsForCollab.map(h => h.to);
              if (handoffTargets.length > 0) {
                const nextNicknames = handoffTargets
                  .map(getPrimaryNicknameForRole)
                  .join(" + ");
                setMessages(prev => [...prev, {
                  role: "orb",
                  text: `🤝 ${nextNicknames} 接手看一下這個結果，邊想邊給建議…`,
                  at: Date.now(),
                  pagePath: locationPath,
                  intent: "auto-handoff-discussion",
                }]);
                try {
                  const discussionResult =
                    await startAutoDiscussionMutation.mutateAsync({
                      prompt: `剛才 ${nickname} 用 ${result.modelLabel || result.modelId} 完成了「${cleanPrompt}」。資產 URL：${assetUrl}。請接手的精靈各給一句具體建議或下一步。`,
                      initialAgent: handoffTargets[0],
                      maxRounds: handoffTargets.length,
                      allowedRoles: handoffTargets,
                      timeoutMsPerTurn: 20_000,
                    });
                  if (!isStale()) {
                    setActiveDiscussionId(discussionResult.collaborationId);
                  }
                } catch (err) {
                  // 協作觸發失敗只記在 chat，不擋住主流程 — 主結果已經給了
                  if (isStale()) return;
                  const reason = err instanceof Error ? err.message : String(err);
                  setMessages(prev => [...prev, {
                    role: "orb",
                    text: `（接手討論沒跑起來：${reason}）`,
                    at: Date.now(),
                    pagePath: locationPath,
                  }]);
                }
              }
            }
          } catch (err) {
            if (isStale()) return;
            const reason = err instanceof Error ? err.message : String(err);
            orbState.setState("error", `${nickname} 失敗`);
            setMessages(prev => [...prev, {
              role: "orb",
              text: `${nickname} 在呼叫模型時遇到錯誤：${reason}`,
              at: Date.now(),
              pagePath: locationPath,
              agentRole: mentioned,
            }]);
          } finally {
            setIsSending(false);
          }
          return;
        }

        // ── B) navigate: 路路（intent-based）/ 學學（固定到 /learn-hub）──
        if (tool.kind === "navigate") {
          const targetPath =
            tool.toPath
            ?? (tool.intentBased ? detectNavIntent(cleanPrompt)?.path : undefined);
          const targetLabel =
            tool.intentBased ? detectNavIntent(cleanPrompt)?.label : undefined;
          if (targetPath) {
            orbState.setState("success", `${nickname} 帶你跳頁`);
            setMessages(prev => [...prev, {
              role: "orb",
              text: `🧭 ${tool.arrivalHint}（${targetPath}）${
                targetLabel ? ` ── ${targetLabel}` : ""
              }`,
              at: Date.now(),
              pagePath: locationPath,
              agentRole: mentioned,
            }]);
            setLocation(targetPath);
            setSuggestions(buildHandoffChips(mentioned));
            return;
          }
          // intent-based 但沒推出來目的地 → fall through 給 LLM
        }

        // ── C) search: 查查走 unifiedSearch ──
        if (tool.kind === "search" && cleanPrompt.length >= tool.minPromptChars) {
          orbState.setState("searching", `${nickname} 找「${cleanPrompt}」`);
          try {
            const result = await trpcUtils.orbProxy.unifiedSearch.fetch({
              query: cleanPrompt,
            });
            if (isStale()) return;
            const headerText =
              result.items.length === 0
                ? `🔍 ${nickname} 翻找「${cleanPrompt}」沒有命中——可以再給多一點關鍵字。`
                : `🔍 ${nickname} 為「${cleanPrompt}」找到 ${result.items.length} 筆結果：`;
            setMessages(prev => [...prev, {
              role: "orb",
              text:
                result.items.length > 0
                  ? `${headerText}\n\n${formatUnifiedSearchReply(cleanPrompt, result.items)}`
                  : headerText,
              at: Date.now(),
              pagePath: locationPath,
              agentRole: mentioned,
              searchResults: result.items.length > 0 ? result.items : undefined,
              searchQuery: cleanPrompt,
            }]);
            orbState.setState(
              result.items.length > 0 ? "success" : "idle",
              result.items.length > 0
                ? `${nickname} 找到 ${result.items.length} 筆`
                : `${nickname} 沒命中`,
            );
            setSuggestions(buildHandoffChips(mentioned));
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            orbState.setState("error", `${nickname} 搜尋失敗`);
            setMessages(prev => [...prev, {
              role: "orb",
              text: `${nickname} 搜尋時遇到問題：${reason}`,
              at: Date.now(),
              pagePath: locationPath,
              agentRole: mentioned,
            }]);
          } finally {
            setIsSending(false);
          }
          return;
        }

        // ── D) llm-persona: 不在這裡攔，讓既有 LLM 流程接手（selectRoleForIntent
        //     會套上該精靈的人格切片）。但仍把 collab 下一棒列為建議，方便使用者
        //     看到 LLM 回覆後可以一鍵交棒給下一位精靈。
        //
        // 例外：@導導 — 使用者明確找導演規劃多步驟工作流。直接觸發
        // startAutoDiscussion 走「多精靈鏈」執行，由導導先排計畫、編編 /
        // 圖圖 / 影影 / 聲聲 / 音音 / 品品 依 SPIRIT_COLLAB_PROTOCOL 接手，
        // 而不是只回一段 LLM 純文字。`maxRounds=24` 是 router 上限，可覆蓋 24 位精靈協作；一般場景跑
        // 完一條完整的計畫（plan → execute → review）。
        if (
          tool.kind === "llm-persona"
          && mentioned === "director"
          && cleanPrompt.length >= 6
        ) {
          orbState.setState("thinking", "導導 開始排計畫…");
          setMessages(prev => [...prev, {
            role: "orb",
            text: `🗺️ 導導 排好計畫後，會把每一步交給對的精靈接手 — 你會看到他們一棒一棒接著做，最後第一位生成型精靈我會真的幫你做出來。`,
            at: Date.now(),
            pagePath: locationPath,
            agentRole: "director",
            intent: "auto-multi-step-discussion",
          }]);
          try {
            const discussion = await startAutoDiscussionMutation.mutateAsync({
              prompt: cleanPrompt,
              initialAgent: "director",
              maxRounds: 24,
              timeoutMsPerTurn: 25_000,
            });
            if (!isStale()) {
              // 留住原始 prompt — discussion_complete 後 polling effect 會
              // 用它真的去打第一位生成型精靈的 fal.ai。
              lastDiscussionUserPromptRef.current = cleanPrompt;
              setActiveDiscussionId(discussion.collaborationId);
              setSuggestions(buildHandoffChips("director"));
            }
          } catch (err) {
            if (isStale()) return;
            const reason = err instanceof Error ? err.message : String(err);
            orbState.setState("error", "導導 啟動失敗");
            setMessages(prev => [...prev, {
              role: "orb",
              text: `導導 啟動多步討論時遇到問題：${reason}`,
              at: Date.now(),
              pagePath: locationPath,
              agentRole: "director",
            }]);
          } finally {
            setIsSending(false);
          }
          return;
        }

        if (tool.kind === "llm-persona") {
          // 其他 llm-persona 精靈：只設 suggestions hint，不 return — 讓下方
          // LLM 流程繼續跑（suggestions 在 LLM 回完後會被覆蓋成 LLM 的，這
          // 只是預設值）
        }
      }
    }

    // ─── Mode shortcuts: hard-coded behavior so the user sees the prompt
    //     they typed instead of an LLM-rewritten reply, and we don't burn a
    //     round-trip when the answer is already deterministic.

    // navigate (跳頁): keyword-routed direct nav. Uses the same detectors the
    //   LLM-fallback already trusts; only when no path can be inferred do we
    //   defer to the LLM (with the mode hint preserved in `context`).
    if (requestedMode === "navigate") {
      const directNav = detectNavIntent(trimmed);
      const intent = directNav ? null : detectChatIntent(trimmed);
      const inferredPath =
        directNav?.path ??
        (intent && intent.kind === "ready"
          ? intent.workflow.steps.find(step => step.path)?.path
          : undefined);
      const inferredLabel =
        directNav?.label ??
        (intent && intent.kind === "ready" ? intent.workflow.name : undefined);

      if (inferredPath && inferredLabel) {
        const navWorkflow = buildNavigateWorkflow(inferredLabel, inferredPath);
        setMessages(prev => [...prev, {
          role: "orb",
          text: `🧭 帶你去「${inferredLabel}」（${inferredPath}）。`,
          at: Date.now(),
          pagePath: locationPath,
          actions: [navWorkflow],
        }]);
        await executeActions([navWorkflow], {
          intent: inferredLabel,
          requireConfirmation: false,
        });
        return;
      }
      // No keyword match — let the LLM pick a destination, but tell it the
      // user explicitly asked for a navigate-only reply.
    }

    // ask-feature (功能詢問): static response listing what the site can do.
    //   APP_PAGE_REGISTRY is the source of truth for site features, so this
    //   never needs an LLM — the answer is the same every time and avoids
    //   hallucinating features that don't exist.
    //
    // 個人化同 NL 分支：使用者的 favorite / muted 精靈會影響排序與顯示。
    // 同時補一排 suggestion chips，讓使用者「看完清單」之後能夠一鍵把
    // 純問答升級成 plan 模式真的開做。
    if (requestedMode === "ask-feature") {
      const prefForSummary = agentPreferencesQuery.data ?? null;
      const featureSummary = buildFeatureSummaryReply({
        favoriteSpirits:
          ((prefForSummary as { favoriteSpirits?: string[] } | null)
            ?.favoriteSpirits ?? []) as AgentRole[],
        mutedSpirits:
          ((prefForSummary as { mutedSpirits?: string[] } | null)
            ?.mutedSpirits ?? []) as AgentRole[],
      });
      setMessages(prev => [...prev, {
        role: "orb",
        text: featureSummary,
        at: Date.now(),
        pagePath: locationPath,
      }]);
      setSuggestions(buildFeatureInquiryCtaSuggestions(trimmed));
      orbState.setState("idle");
      return;
    }

    try {
      const inferredIntent = inferUserMultimodalIntent(trimmed);
      const backendSummary = summarizeProviderPing(providerPingQuery.data);
      const modeHint = requestedMode ? ` · 使用者選擇模式: ${requestedMode}` : "";
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
            // 15 精靈：mutedSpirits 進去後，server 的 selectRoleForIntent 會
            // 跳過這些角色的 KEYWORD_RULE。favoriteSpirits 不影響路由（純 UI hint）
            // 但仍順手帶過去 — 未來 ProactiveEventBus 用得到。
            mutedSpirits:
              (prefRow as { mutedSpirits?: string[] }).mutedSpirits,
            favoriteSpirits:
              (prefRow as { favoriteSpirits?: string[] }).favoriteSpirits,
            // Phase 3: stay-on-page mode. Forwarded so the server knows
            // not to bake "我帶你過去" into the planner reply when the
            // user has opted into hands-off in-place execution.
            stayOnPageMode:
              (prefRow as { stayOnPageMode?: boolean }).stayOnPageMode ?? false,
            // Phase D wiring follow-up: these used to be saved but never
            // read at runtime. Forwarding them so `criticEnabled` actually
            // flips the chat handler over to the critique-aware planner,
            // and `roleAutoSwitch=false` actually locks the orb to its
            // default companion persona.
            criticEnabled:
              (prefRow as { criticEnabled?: boolean }).criticEnabled ?? undefined,
            criticRefineBelow:
              (prefRow as { criticRefineBelow?: number }).criticRefineBelow ?? undefined,
            roleAutoSwitch:
              (prefRow as { roleAutoSwitch?: boolean }).roleAutoSwitch ?? undefined,
          }
        : undefined;
      // When the user pasted a long brief, pre-parse it and stamp the
      // covered dimensions into `context` so the LLM doesn't re-ask
      // (matches the 反問節制守則 in the system prompt). Reuses the
      // single parse from the top of sendMessage.
      const parsedStructureHint = (() => {
        const parsed = parsedScriptStructure;
        if (!parsed) return "";
        const parts: string[] = [];
        if (parsed.format) parts.push(`format=${parsed.format}`);
        if (parsed.durationLabel) parts.push(`length=${parsed.durationLabel}`);
        if (parsed.subject) parts.push(`subject=${parsed.subject}`);
        if (parsed.styles.length) parts.push(`styles=${parsed.styles.slice(0, 3).join("/")}`);
        if (parsed.platforms.length) parts.push(`platforms=${parsed.platforms.slice(0, 3).join("/")}`);
        if (parsed.purpose) parts.push(`purpose=${parsed.purpose}`);
        if (parsed.scenes > 0) parts.push(`scenes=${parsed.scenes}`);
        return parts.length > 0
          ? ` · parsedScriptStructure: ${parts.join(", ")}`
          : "";
      })();
      // 全站代理對話會把目前使用者選取的文字帶進 context，
      // 讓「請幫我改這段／翻成…」之類請求可直接對準選取內容回覆。
      const selectedTextHint = (() => {
        if (typeof window === "undefined" || typeof window.getSelection !== "function") {
          return "";
        }
        const selected = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
        if (!selected) return "";
        const clipped = selected.length > 500 ? `${selected.slice(0, 500)}…` : selected;
        return ` · 使用者目前選取文字: ${clipped}`;
      })();
      orbState.setState("thinking", "光球思考中…");
      // Per-request id powers the inline thinking-timeline polling. The
      // chat handler keys progress milestones by this id; the client polls
      // `ai.chatProgress` until the mutation resolves. We clear the active
      // id in the surrounding sendMessage `finally` so every error path
      // (clarification cap, planner throw, network drop) drops the poll.
      const progressRequestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `orb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      setActiveProgressRequestId(progressRequestId);
      const data = await aiChat.mutateAsync({
        messages: compactHistoryForRequest(nextHistory)
          .map(m => ({
            role: m.role === "user" ? ("user" as const) : ("assistant" as const),
            content: toLLMMessageContent(m),
          })),
        personality,
        context: `全站光球聊天 · 當前頁面: ${locationPath} · 意圖判斷: ${inferredIntent} · ${backendSummary}${modeHint}${parsedStructureHint}${selectedTextHint}`,
        pageSnapshot: pageAgent.snapshot ?? undefined,
        recentFeedback: pageAgent.recentFeedback,
        preferences: preferencesForChat,
        requestId: progressRequestId,
      });

      // The user (or another effect) invalidated this turn while the LLM
      // was thinking — drop the response instead of mutating stale state.
      if (isStale()) return;

      // 15 精靈：把後端決定的接手精靈拉出來，後面所有 setMessages 都會掛上。
      // 沒有時 (舊 server / gate 早退) 客戶端 chip 仍可用 selectRoleForIntent
      // 推回，所以這裡只是「server-authoritative when available」。
      const serverAgentRole =
        typeof (data as { agentRole?: string }).agentRole === "string"
          ? (data as { agentRole: string }).agentRole
          : undefined;
      const serverAgentRoleConfidence =
        typeof (data as { agentRoleConfidence?: number }).agentRoleConfidence === "number"
          ? (data as { agentRoleConfidence: number }).agentRoleConfidence
          : undefined;
      const serverAgentRoleRationale =
        typeof (data as { agentRoleRationale?: string }).agentRoleRationale === "string"
          ? (data as { agentRoleRationale: string }).agentRoleRationale
          : undefined;
      // 從 server-side rationale 與 warnings 衍生小 chip：mute fallback /
      // mode-contract replan / circuit replan。客戶端不重打 LLM，只 inline 顯示。
      const derivedNotices: ChatMessageNotice[] = [];
      if (serverAgentRoleRationale && /muted by user.*falling back to/i.test(serverAgentRoleRationale)) {
        const fallbackMatch = serverAgentRoleRationale.match(/falling back to ([a-z-]+)/i);
        derivedNotices.push({
          kind: "muted_fallback",
          text: "改由替代角色接手",
          tooltip: fallbackMatch
            ? `你靜音的精靈剛好命中這則訊息；改交給 ${fallbackMatch[1]} 處理。可在設定／精靈偏好中重新啟用。`
            : "你靜音的精靈剛好命中這則訊息；改交給替代角色處理。",
        });
      }
      const serverWarnings = Array.isArray((data as { warnings?: unknown }).warnings)
        ? ((data as { warnings: unknown[] }).warnings.filter((w): w is string => typeof w === "string"))
        : [];
      if (serverWarnings.some(w => /Mode-contract replan triggered/i.test(w))) {
        derivedNotices.push({
          kind: "mode_replan",
          text: "已重擬計畫",
          tooltip: "前一版計畫違反多步驟代理契約（例如把步驟條列寫在聊天裡），系統自動重擬了一次。",
        });
      }
      const spiritFields = serverAgentRole
        ? {
            agentRole: serverAgentRole,
            ...(typeof serverAgentRoleConfidence === "number"
              ? { agentRoleConfidence: serverAgentRoleConfidence }
              : {}),
            ...(serverAgentRoleRationale ? { agentRoleRationale: serverAgentRoleRationale } : {}),
            ...(derivedNotices.length > 0 ? { notices: derivedNotices } : {}),
          }
        : derivedNotices.length > 0
          ? { notices: derivedNotices }
          : {};

      // Server signalled it needs to ask the user before acting. Skip every
      // downstream action / workflow / executor branch and surface the
      // ClarificationPromptCard so the user can disambiguate before the orb
      // dispatches anything. Counter bumps here too so server-side
      // clarification rounds count against the same 2-round cap that the
      // client-side fallback enforces below.
      const needsClarification = (data as { needsClarification?: boolean }).needsClarification === true;
      if (needsClarification) {
        if (clarificationRoundsRef.current >= MAX_CLARIFICATION_ROUNDS) {
          applyClarificationCap(
            (data as { reply?: string }).reply ?? "依據前面對話我會挑最可能的選項組合執行。"
          );
          return;
        }
        clarificationRoundsRef.current += 1;
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
          : inferClarificationIntentCards(clarificationQuestion, trimmed, /用途|use/i.test(clarificationQuestion) ? "usecase" : "format");
        setMessages(prev => [...prev, {
          role: "orb",
          text: clarificationQuestion,
          at: Date.now(),
          pagePath: locationPath,
          ...spiritFields,
        }]);
        setPendingClarification({
          id: `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          question: clarificationQuestion,
          options: clarificationOptions,
          dimension: /用途|use/i.test(clarificationQuestion) ? "usecase" : "format",
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
      // Capture the latest real server task id so OrbTaskObservationStrip
      // can subscribe to the chain runner's audit log. Skip drafts /
      // unset values — the strip ignores null anyway.
      {
        const realTaskId = taskMeta?.taskId ?? telemetryMeta?.taskId ?? null;
        if (realTaskId && !realTaskId.startsWith("draft_")) {
          setLatestServerTaskId(realTaskId);
        }
      }
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
      const safeAssistant = safeRenderAssistantMessage(dataObj);
      const dataReply = safeAssistant.text;
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
        // Cap the wizard at MAX_CLARIFICATION_ROUNDS consecutive turns. On
        // the third attempt we stop asking and ship a "best-guess + confirm"
        // reply instead — the user can still correct us, but we never trap
        // them in an open-ended form.
        if (clarificationRoundsRef.current >= MAX_CLARIFICATION_ROUNDS) {
          applyClarificationCap(dataReply ? dataReply : intentDetection.message);
          return;
        }
        clarificationRoundsRef.current += 1;

        // When the user's brief is severely under-specified (3+ high-signal
        // dimensions missing), upgrade to a multi-dimension card so they
        // pin everything down in one round-trip instead of bouncing through
        // four single-dim wizard turns. We also fold in the parsed
        // structure from any long-form brief earlier in the message so
        // dimensions the user already wrote out (length / style / platform)
        // do NOT get re-asked.
        const detectedModality = inferModalityFromText(trimmed);
        const rememberedCoverage = rememberedDimensionCoverage(rememberedPreferences);
        const prefilledFromScript = parsedScriptStructure
          ? structureToDimensionSignals(parsedScriptStructure)
          : undefined;
        const multi = buildMultiDimWizardClarification(
          trimmed,
          detectedModality,
          rememberedCoverage,
          prefilledFromScript
        );
        const question = intentDetection.message;

        if (multi) {
          const replyForUser = dataReply
            ? `${dataReply}\n\n🎬 ${multi.leadIn}`
            : `🎬 ${multi.leadIn}`;
          setMessages(prev => [...prev, {
            role: "orb",
            text: replyForUser,
            at: Date.now(),
            pagePath: locationPath,
            ...spiritFields,
          }]);
          setPendingClarification({
            id: `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            question: multi.leadIn,
            originalUserText: trimmed,
            createdAt: Date.now(),
            multiDim: multi.entries,
          });
        } else {
          const replyForUser = dataReply ? `${dataReply}\n\n🎬 ${question}` : `🎬 ${question}`;
          setMessages(prev => [...prev, {
            role: "orb",
            text: replyForUser,
            at: Date.now(),
            pagePath: locationPath,
            ...spiritFields,
          }]);
          setPendingClarification({
            id: `clarify_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            question,
            options: intentDetection.options,
            dimension: "format",
            originalUserText: trimmed,
            createdAt: Date.now(),
          });
        }
        const rawSuggestionsClarify = (data as { suggestions?: string[] }).suggestions ?? [];
        setSuggestions(rawSuggestionsClarify.slice(0, 4).map(s => ({ text: s })));
        return;
      }
      // Reaching here means either the LLM came back with actions, or the
      // local fallback found a ready workflow. Either way the wizard is
      // closed for this thread, so reset the round counter — the next
      // under-specified prompt deserves a fresh 2-round budget.
      clarificationRoundsRef.current = 0;
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

      const reasoningChain = extractReasoningChain(data);

      const renderReply = safeAssistant.fallback && safeAssistant.traceId
        ? `${replyText}

追蹤碼：${safeAssistant.traceId}`
        : replyText;

      setMessages(prev => [...prev, {
        role: "orb",
        text: renderReply,
        at: Date.now(),
        intent: effectiveIntent,
        pagePath: locationPath,
        actions: actionsToExecute,
        ...(webSources.length > 0 ? { webSources } : {}),
        ...(reasoningChain ? { reasoningChain } : {}),
        ...spiritFields,
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
        // Auto-execution path: when the user has set confirmationPolicy to
        // 'always_approve' (or pre-approved every tool in the plan via
        // autoApproveTools), skip the WorkflowConfirmationCard — the user
        // has already opted into hands-off execution at the preference
        // level, and asking again on every plan defeats the purpose of an
        // autonomous agent. Runtime gates (high-risk steps + per-step
        // requiresApproval) still apply.
        const policy = preferencesForChat?.confirmationPolicy;
        const autoApprove = Array.isArray(preferencesForChat?.autoApproveTools)
          ? new Set(preferencesForChat?.autoApproveTools)
          : null;
        const everyStepIsAutoApprovedTool =
          autoApprove !== null &&
          autoApprove.size > 0 &&
          pendingPlan.actions.every(a => {
            if (a.type !== "runWorkflow") return autoApprove.has(a.type);
            return a.steps.every(step => autoApprove.has(step.actionType));
          });
        const hasImplicitImageGeneration = pendingPlan.actions.some(action => {
          if (action.type !== "runWorkflow") return false;
          const hasSubmit = action.steps.some(step => step.actionType === "submit");
          if (!hasSubmit) return false;
          const hasExplicitModelSelection = action.steps.some(step => step.actionType === "setModel");
          return !hasExplicitModelSelection;
        });

        if ((policy === "always_approve" || everyStepIsAutoApprovedTool) && !hasImplicitImageGeneration) {
          // Defer to next tick so React commits setPendingWorkflow first;
          // startPendingWorkflow reads the latest pendingWorkflow ref.
          setTimeout(() => {
            void startPendingWorkflowRef.current?.();
          }, 0);
        }
        return;
      }

      if (executorTask) {
        const pages = Array.from(new Set(executorTask.steps.map(step => step.pagePath).filter((v): v is string => Boolean(v))));
        // Phase 3 stay-on-page: auto-approve the task and let the background
        // driver run it server-side. We still respect the per-step
        // requiresApproval flag on high-risk submit / publish steps —
        // those surface as their own gates inside the executor's polling
        // loop, so the user never silently authors anything destructive.
        const stayOnPage =
          (preferencesForChat as { stayOnPageMode?: boolean } | undefined)?.stayOnPageMode === true;
        const allowedRiskLevels = new Set(
          (preferencesForChat as { allowedRiskLevels?: string[] } | undefined)?.allowedRiskLevels ?? ["low", "medium"]
        );
        const everyStepRiskAllowed = executorTask.steps.every(step => {
          const reqApproval = step.requiresApproval === true;
          const stepRisk = String((step as { riskLevel?: string }).riskLevel ?? executorTask.riskLevel ?? "medium").toLowerCase();
          // High-risk OR explicitly approval-gated steps still need the
          // confirmation card; we never auto-approve those silently.
          if (reqApproval) return false;
          return allowedRiskLevels.has(stepRisk);
        });
        const taskIdLooksReal =
          typeof executorTask.taskId === "string" &&
          !executorTask.taskId.startsWith("draft_");
        if (stayOnPage && everyStepRiskAllowed && taskIdLooksReal) {
          setMessages(prev => [
            ...prev,
            {
              role: "orb",
              text: `🚀 已啟動：「${executorTask.summaryForUser}」。我會在背景接力跑完，過程進度直接顯示在這裡，你不用換頁。`,
              at: Date.now(),
              pagePath: locationPath,
              intent: executorTask.summaryForUser,
              ...spiritFields,
            },
          ]);
          // Fire-and-forget approval. The existing useGlobalOrbExecutor
          // poll picks up step.* events and surfaces them through
          // OrbTaskObservationStrip; we don't need to await here.
          void orbTaskApprove
            .mutateAsync({ taskId: executorTask.taskId })
            .catch(err => {
              console.warn(
                "[GlobalOrbChat] stayOnPageMode auto-approve failed:",
                err instanceof Error ? err.message : String(err),
              );
              // Fall back to the manual confirmation card so the user
              // can still kick the task off explicitly.
              setPendingExecutorTask({
                task: executorTask,
                requiresHumanReason:
                  "光球試著直接執行但被擋下來了，你可以手動確認。",
                affectedPages: pages,
              });
            });
          return;
        }
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
        return;
      }

      // ── Phantom-plan defence ─────────────────────────────────────
      // Server should have caught this in `parseOrbReply`, but if a
      // legacy / non-router path slipped through, we still want the
      // user to get a quick-pick clarification card instead of a wall
      // of text. Triggers only when there's nothing else actionable
      // (no plan, no task, no actions) but the reply describes
      // numbered steps and ends with a "which step?" question.
      if (
        !pendingPlan &&
        !executorTask &&
        !codeTaskPreview &&
        actionsToExecute.length === 0 &&
        isPhantomPlanReply(dataReply)
      ) {
        const question =
          extractPhantomPlanQuestion(dataReply) ??
          "我先確認一下你要的方向，這樣才能做對。";
        const phantomDimension: ClarificationDimension =
          /用途|use/i.test(question) ? "usecase" : "format";
        const optionPack = buildContextualClarificationOptions({
          userText: trimmed,
          dimension: phantomDimension,
        });
        setPendingClarification({
          id: `clarify_phantom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          question,
          dimension: phantomDimension,
          options: optionPack.options,
          originalUserText: trimmed,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      // If this turn was already invalidated by a newer send (or clear),
      // swallow the failure quietly — surfacing an error toast for a
      // request the user already abandoned would only confuse.
      if (isStale()) return;
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[GlobalOrbChat] Send error:", reason);
      orbState.setState("error", `連線不穩：${reason.slice(0, 40)}`);

      // 15 精靈 / 守守 (inspector)：聊天 mutation 失敗 = 站上有東西爆掉。
      // 守守主動跳出來給「現在你可以這樣繞過」的訊息，不只是冷冰冰的錯誤。
      // dedupeKey 用 reason 前 16 字 — 同樣錯誤 30s 內只通知一次。
      ProactiveEventBus.publish(
        "site_error_detected",
        {
          endpoint: "ai.chat",
          errorCode: err instanceof Error && "data" in err
            ? String((err as { data?: { code?: unknown } }).data?.code ?? "unknown")
            : "unknown",
          workaround: "稍等 10 秒後再送一次，或重新整理頁面",
        },
        { dedupeKey: reason.slice(0, 16) }
      );
      setWorkflowExecution(prev => prev ? {
        ...prev,
        status: "failed",
        error: reason,
        completedAt: Date.now(),
      } : prev);
      // Restore the failed text into the composer. Previously the orb said
      // "直接按送出再試一次" but the input was already cleared at the top of
      // sendMessage (line ~1850), so the user had to manually re-type the
      // entire prompt — exactly the bug the support screenshots showed when
      // "開始規劃腳本" had to be entered twice. Putting the text back makes
      // the suggested action ("press send again") actually work.
      if (trimmed.length > 0) setInput(trimmed);
      const userEcho = trimmed.length > 0 ? `

我把你剛剛輸入的這段話放回輸入框了，按一下送出就會重試：
「${trimmed.slice(0, 1200)}」` : "";
      setMessages(prev => [...prev, {
        role: "orb",
        text: `🌸 抱歉，剛剛連線有點不穩，我沒有完整處理成功。${userEcho}

如果想換個方式說，也可以直接修改後再送；或我也可以先幫你把需求整理成分鏡／腳本大綱。`,
        at: Date.now(),
        pagePath: locationPath,
        intent: "send-error",
      }]);
    } finally {
      setIsSending(false);
      // Drop the progress-timeline poll guard regardless of which exit
      // path fired. Without this the client keeps polling even after the
      // mutation has resolved or thrown.
      setActiveProgressRequestId(null);
    }
    } finally {
      setIsSending(false);
    }
  }, [
    // `messages` intentionally omitted — we read via messagesRef.current so
    // this callback (and every consumer of the context value) doesn't
    // rebuild on every committed message.
    isSending,
    personality,
    pageAgent,
    locationPath,
    aiChat,
    trpcUtils,
    providerPingQuery.data,
    agentPreferencesQuery.data,
    executeActions,
    applyClarificationCap,
    orbState,
  ]);

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
    const task = pendingCodeTask;
    try {
      await codeTaskApprove.mutateAsync({ codeTaskId: task.codeTaskId });
    } catch (err) {
      // Without this catch the rejection silently propagates: the orb
      // confirmation message is never appended and `pendingCodeTask`
      // stays pinned, so the user is stuck staring at the preview card
      // with no idea their click failed.
      const reason = err instanceof Error ? err.message : String(err);
      toast.error(`確認程式任務失敗：${reason.slice(0, 120)}`);
      setMessages(prev => [...prev, {
        role: "orb",
        text: `⚠️ 沒辦法確認這個程式任務：${reason.slice(0, 200)}`,
        at: Date.now(),
        pagePath: locationPath,
      }]);
      return;
    }
    setMessages(prev => [...prev, { role: "orb", text: `已確認程式任務，交由 ${task.provider} 執行。`, at: Date.now(), pagePath: locationPath }]);
    setPendingCodeTask(null);
  }, [pendingCodeTask, codeTaskApprove, locationPath]);

  const cancelCodeTaskPreview = useCallback(async () => {
    if (!pendingCodeTask) return;
    const task = pendingCodeTask;
    try {
      await codeTaskCancel.mutateAsync({ codeTaskId: task.codeTaskId, reason: "cancelled by user" });
    } catch (err) {
      // Cancellation that fails server-side leaves the task running but
      // the UI thinks it's gone. Surface the error so the user can retry
      // (or escalate); leave the preview card pinned so they have a
      // re-cancel target.
      const reason = err instanceof Error ? err.message : String(err);
      toast.error(`取消程式任務失敗：${reason.slice(0, 120)}`);
      setMessages(prev => [...prev, {
        role: "orb",
        text: `⚠️ 沒辦法取消這個程式任務：${reason.slice(0, 200)}。再點一次試試，或先讓它跑完。`,
        at: Date.now(),
        pagePath: locationPath,
      }]);
      return;
    }
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

  // Keep the ref pointing at the latest `startPendingWorkflow` so the
  // auto-execute branch inside `sendMessage` (declared above) always invokes
  // the current callback without taking a hard React dep.
  useEffect(() => {
    startPendingWorkflowRef.current = startPendingWorkflow;
  }, [startPendingWorkflow]);

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
        ? `${active.originalUserText}\n\n[使用者澄清/${active.dimension ?? "format"}]: ${trimmed}`
        : trimmed;
    await sendMessage(composedUserText);
  }, [pendingClarification, sendMessage]);

  const answerMultiClarification = useCallback(
    async (
      answers: Array<{ dimension: ClarificationDimension; value: string }>,
      extraNote: string
    ) => {
      const active = pendingClarification;
      if (!active) return;
      const cleaned = answers.filter(a => a.value.trim().length > 0);
      if (cleaned.length === 0 && extraNote.trim().length === 0) return;
      setPendingClarification(null);

      // Fire-and-forget: persist durable picks (style / platform / purpose)
      // to the orb-memory store so the planner can skip these dimensions
      // on future requests. Failure here must NOT block the user's reply —
      // worst case the next turn re-asks, which is the existing behavior.
      if (cleaned.length > 0) {
        try {
          persistClarificationPicks.mutate(
            {
              picks: cleaned,
              traceId: active.id,
            },
            {
              onError: () => {
                // intentionally silent — user shouldn't see a memory write fail
              },
            }
          );
        } catch {
          // mutate is sync-throw safe but guard belt-and-braces
        }
      }

      const serialized = serializeMultiDimAnswers(cleaned);
      const noteLine = extraNote.trim().length > 0
        ? `[使用者澄清/open]: ${extraNote.trim()}`
        : "";
      const tail = [serialized, noteLine].filter(Boolean).join("\n");
      const composed =
        active.originalUserText.length > 0
          ? `${active.originalUserText}\n\n${tail}`
          : tail;
      await sendMessage(composed);
    },
    [pendingClarification, sendMessage, persistClarificationPicks]
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  const cancelCollaborationMutation =
    trpc.agentCollaboration.cancelCollaboration.useMutation();

  const startCollaborativeDiscussion = useCallback(
    async (
      prompt: string,
      options?: CollaborativeDiscussionOptions,
    ): Promise<string> => {
      const trimmed = prompt.trim();
      if (!trimmed) {
        throw new Error("empty prompt");
      }

      // Normalize scope inputs once so the user-visible "召集" 開場訊息可以
      // 顯示套用後的範圍，而不是 raw options。allowedRoles + allowedFamilies
      // 都空 = 不限制，文案就走預設。
      const maxRounds = Math.max(
        1,
        Math.min(options?.maxRounds ?? 3, 24),
      );
      const allowedRoles = (options?.allowedRoles ?? []).filter(Boolean);
      const allowedFamilies = (options?.allowedFamilies ?? []) as CollaborativeDiscussionFamily[];
      const extraMutedRoles = (options?.extraMutedRoles ?? []).filter(Boolean);

      const scopeBits: string[] = [];
      if (allowedFamilies.length > 0) {
        const labels: Record<CollaborativeDiscussionFamily, string> = {
          specialist: "專精精靈",
          role: "通用同事",
          proactive: "主動精靈",
        };
        scopeBits.push(`只在 ${allowedFamilies.map(f => labels[f]).join(" / ")} 之間`);
      }
      if (allowedRoles.length > 0) {
        scopeBits.push(`指定 ${allowedRoles.length} 位精靈出席`);
      }
      if (extraMutedRoles.length > 0) {
        scopeBits.push(`此次再 mute ${extraMutedRoles.length} 位`);
      }
      if (options?.initialAgent) {
        scopeBits.push(`由 ${options.initialAgent} 開場`);
      }
      const scopeSuffix = scopeBits.length > 0
        ? `（範圍：${scopeBits.join("，")}）`
        : "";

      // 把使用者的需求先當成 user bubble 推進去，再標一條「光球召集精靈」訊息，
      // 接下來輪詢拉回的精靈訊息會逐條接在後面。讓使用者第一眼就看到「東西
      // 在跑」而不是按完按鈕沒反應。
      const now = Date.now();
      setMessages(prev => [
        ...prev,
        { role: "user", text: trimmed, at: now, pagePath: locationPath },
        {
          role: "orb",
          text: `🌿 我請最多 ${maxRounds} 位精靈一起來看你這個需求，他們會輪流給意見。${scopeSuffix}`,
          at: now + 1,
          pagePath: locationPath,
        },
      ]);
      seenDiscussionMessageIdsRef.current = new Set();
      try {
        const result = await startAutoDiscussionMutation.mutateAsync({
          prompt: trimmed,
          initialAgent: options?.initialAgent,
          maxRounds,
          allowedRoles: allowedRoles.length > 0 ? allowedRoles : undefined,
          allowedFamilies: allowedFamilies.length > 0 ? allowedFamilies : undefined,
          extraMutedRoles: extraMutedRoles.length > 0 ? extraMutedRoles : undefined,
          timeoutMsPerTurn: options?.timeoutMsPerTurn,
        });
        setActiveDiscussionId(result.collaborationId);
        setCollaborativeDiscussionMeta({
          collaborationId: result.collaborationId,
          initialAgent: result.initialAgent,
          maxRounds: result.maxRounds,
          allowedRoles: result.allowedRoles ?? [],
          allowedFamilies:
            (result.allowedFamilies ?? []) as CollaborativeDiscussionFamily[],
          startedAt: now,
        });
        return result.collaborationId;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setMessages(prev => [
          ...prev,
          {
            role: "orb",
            text: `⚠️ 召集精靈時遇到問題：${reason}`,
            at: Date.now(),
            pagePath: locationPath,
          },
        ]);
        throw err;
      }
    },
    [locationPath, startAutoDiscussionMutation],
  );

  const cancelCollaborativeDiscussion = useCallback(async (): Promise<void> => {
    const cid = activeDiscussionId;
    if (!cid) return;
    // 立刻收掉 client 端 polling + meta，使用者點下「停止」按鈕就有反應；
    // server 端 cancelCollaboration 是 fire-and-forget，失敗只記訊息，但不
    // 影響本地 UI（最壞情況：runner 在背景仍跑完，但已 publish 的訊息已被
    // 我們的 effect 收掉，使用者看不到後續）。
    setActiveDiscussionId(null);
    setCollaborativeDiscussionMeta(null);
    setMessages(prev => [
      ...prev,
      {
        role: "orb",
        text: "🛑 已通知精靈停止這場討論。",
        at: Date.now(),
        pagePath: locationPath,
      },
    ]);
    try {
      await cancelCollaborationMutation.mutateAsync({
        collaborationId: cid,
        reason: "user-cancelled-from-orb",
      });
    } catch {
      // best-effort — UI 已經停了
    }
  }, [activeDiscussionId, cancelCollaborationMutation, locationPath]);
  const clearHistory = useCallback(() => {
    // Bumping the request id invalidates any in-flight LLM round-trip so
    // its `if (isStale()) return;` check fires and the late response is
    // discarded instead of repopulating the cleared history.
    sendRequestIdRef.current += 1;
    setMessages([]);
    setSuggestions([]);
    setPendingWorkflow(null);
    setPendingClarification(null);
    clarificationRoundsRef.current = 0;
    clearMessagesFromStorage(activeConversationId);
    if (isAuthenticated) {
      clearConversationServer.mutate(
        { conversationId: activeConversationId },
        { onError: () => {} }
      );
    }
  }, [activeConversationId, isAuthenticated, setPendingClarification]);
  const resetConversation = useCallback(() => {
    sendRequestIdRef.current += 1;
    const welcome: ChatMessage = { role: "orb", text: welcomeMessage, at: Date.now(), pagePath: locationPath };
    setMessages([welcome]);
    setSuggestions([]);
    setPendingWorkflow(null);
    setPendingClarification(null);
    clarificationRoundsRef.current = 0;
    saveMessagesToStorage(activeConversationId, [welcome]);
    if (isAuthenticated) {
      clearConversationServer.mutate(
        { conversationId: activeConversationId },
        { onError: () => {} }
      );
    }
  }, [
    welcomeMessage,
    locationPath,
    activeConversationId,
    isAuthenticated,
    setPendingClarification,
  ]);

  // ─── Multi-session controls ────────────────────────────────────────────
  const buildLocalSummary = useCallback(
    (conversationId: string, title?: string): ConversationSummary => ({
      conversationId,
      title: title?.trim() || DEFAULT_CONVERSATION_TITLE,
      pinned: false,
      archivedAt: null,
      lastMessageAt: null,
      messageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    []
  );

  const createConversation = useCallback(
    async (title?: string): Promise<string> => {
      // Optimistic local create — server creation runs in the background so
      // the new tab is interactive immediately. If the server call fails we
      // keep the local row; the next backend sync will reconcile.
      const localId = generateLocalConversationId();
      const summary = buildLocalSummary(localId, title);

      // Save current conversation's state before swapping
      saveMessagesToStorage(activeConversationId, messagesRef.current);

      sendRequestIdRef.current += 1;
      setConversations(prev => [
        summary,
        ...prev.filter(c => c.conversationId !== localId),
      ]);
      setActiveConversationId(localId);
      const seed: ChatMessage = {
        role: "orb",
        text: welcomeMessage,
        at: Date.now(),
        pagePath: locationPath,
      };
      setMessages([seed]);
      setSuggestions([]);
      setPendingWorkflow(null);
      setPendingClarification(null);
      clarificationRoundsRef.current = 0;

      if (isAuthenticated) {
        try {
          const result = await createConversationServer.mutateAsync({
            title: summary.title,
          });
          const serverId = result?.conversation?.conversationId;
          if (serverId && serverId !== localId) {
            // Server picked a different id — rename the local entry so future
            // appends land in the right row. Migrate the empty messages key.
            const stored = localStorage.getItem(messagesKeyFor(localId));
            if (stored) {
              localStorage.setItem(messagesKeyFor(serverId), stored);
              localStorage.removeItem(messagesKeyFor(localId));
            }
            setConversations(prev =>
              prev.map(c =>
                c.conversationId === localId
                  ? { ...c, conversationId: serverId }
                  : c
              )
            );
            setActiveConversationId(prev =>
              prev === localId ? serverId : prev
            );
            return serverId;
          }
        } catch (err) {
          console.warn("[GlobalOrbChat] Server create failed:", err);
        }
      }
      return localId;
    },
    [
      activeConversationId,
      buildLocalSummary,
      isAuthenticated,
      setPendingClarification,
      welcomeMessage,
      locationPath,
    ]
  );

  const switchConversation = useCallback(
    async (conversationId: string) => {
      if (conversationId === activeConversationId) return;
      // Persist the outgoing conversation's state, then load the target's
      saveMessagesToStorage(activeConversationId, messagesRef.current);

      sendRequestIdRef.current += 1;
      setActiveConversationId(conversationId);
      const loaded = loadMessagesFromStorage(conversationId);
      if (loaded.length > 0) {
        setMessages(loaded);
      } else {
        // New / freshly-cleared tab — seed the welcome message just like
        // first-load so the user isn't staring at an empty pane.
        setMessages([
          {
            role: "orb",
            text: welcomeMessage,
            at: Date.now(),
            pagePath: locationPath,
          },
        ]);
      }
      setSuggestions([]);
      setPendingWorkflow(null);
      setPendingClarification(null);
      clarificationRoundsRef.current = 0;

      // Background pull from server so any messages added on another device
      // surface here. Quietly ignored when offline / unauthenticated.
      if (isAuthenticated) {
        try {
          const remote = await trpcUtils.orbConversations.getMessages.fetch({
            conversationId,
          });
          if (remote?.messages?.length) {
            const remoteMessages: ChatMessage[] = remote.messages.map(m => ({
              role: m.role as ChatRole,
              text: m.text,
              at: Number(m.at),
              ...((m.metadata ?? {}) as Partial<ChatMessage>),
            }));
            // Treat the freshest server message as already-persisted so the
            // append effect doesn't bounce them straight back as duplicates.
            const newest = Math.max(...remoteMessages.map(m => m.at));
            const prevWatermark =
              lastPersistedAtRef.current.get(conversationId) ?? 0;
            if (newest > prevWatermark) {
              lastPersistedAtRef.current.set(conversationId, newest);
              savePersistWatermarkToStorage(lastPersistedAtRef.current);
            }
            setMessages(prev => {
              // Merge by `at` so we don't double-show a message the local
              // store already has (e.g. user just sent it on this device).
              const seen = new Set(prev.map(p => p.at));
              const merged = [
                ...prev,
                ...remoteMessages.filter(r => !seen.has(r.at)),
              ];
              merged.sort((a, b) => a.at - b.at);
              return merged;
            });
          }
        } catch (err) {
          console.warn("[GlobalOrbChat] getMessages failed:", err);
        }
      }
    },
    [
      activeConversationId,
      isAuthenticated,
      setPendingClarification,
      trpcUtils,
      welcomeMessage,
      locationPath,
    ]
  );

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      const cleaned = title.trim().slice(0, 120) || DEFAULT_CONVERSATION_TITLE;
      setConversations(prev =>
        prev.map(c =>
          c.conversationId === conversationId
            ? { ...c, title: cleaned, updatedAt: Date.now() }
            : c
        )
      );
      if (isAuthenticated) {
        try {
          await updateConversationServer.mutateAsync({
            conversationId,
            title: cleaned,
          });
        } catch (err) {
          console.warn("[GlobalOrbChat] rename failed:", err);
        }
      }
    },
    [isAuthenticated]
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      // Drop server-side first so a successful tab close doesn't leave a
      // ghost row. We tolerate 404s — the local list is the source of truth
      // for the optimistic UX.
      if (isAuthenticated) {
        try {
          await deleteConversationServer.mutateAsync({ conversationId });
        } catch (err) {
          console.warn("[GlobalOrbChat] delete failed:", err);
        }
      }
      try {
        localStorage.removeItem(messagesKeyFor(conversationId));
        localStorage.removeItem(timestampKeyFor(conversationId));
      } catch {
        /* noop */
      }
      if (lastPersistedAtRef.current.delete(conversationId)) {
        savePersistWatermarkToStorage(lastPersistedAtRef.current);
      }
      const remaining = conversations.filter(
        c => c.conversationId !== conversationId
      );
      setConversations(remaining);
      if (conversationId === activeConversationId) {
        sendRequestIdRef.current += 1;
        const seed: ChatMessage = {
          role: "orb",
          text: welcomeMessage,
          at: Date.now(),
          pagePath: locationPath,
        };
        if (remaining.length > 0) {
          const next = remaining[0].conversationId;
          setActiveConversationId(next);
          const loaded = loadMessagesFromStorage(next);
          setMessages(loaded.length > 0 ? loaded : [seed]);
        } else {
          // No tabs left — open a fresh one so the chat doesn't get stuck
          const fresh = generateLocalConversationId();
          setConversations([buildLocalSummary(fresh)]);
          setActiveConversationId(fresh);
          setMessages([seed]);
        }
        setSuggestions([]);
        setPendingWorkflow(null);
        setPendingClarification(null);
        clarificationRoundsRef.current = 0;
      }
    },
    [
      activeConversationId,
      buildLocalSummary,
      conversations,
      isAuthenticated,
      setPendingClarification,
      welcomeMessage,
      locationPath,
    ]
  );

  const userOrbAgentOverride = (agentPreferencesQuery.data as { orbAgentEnabled?: boolean | null } | undefined)?.orbAgentEnabled ?? null;
  const orbAgentEnabledResolved = resolveOrbAgentEnabled(userOrbAgentOverride);

  const value = useMemo(() => ({
    messages,
    input,
    isSending,
    progressEvents,
    suggestions,
    isOpen,
    workflowExecution,
    pendingWorkflow,
    pendingClarification,
    orbAgentEnabled: orbAgentEnabledResolved,
    conversations,
    activeConversationId,
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
    answerMultiClarification,
    cancelClarification,
    startCollaborativeDiscussion,
    isCollaborativeDiscussionActive: Boolean(activeDiscussionId),
    cancelCollaborativeDiscussion,
    collaborativeDiscussionMeta,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
  }), [messages, input, isSending, progressEvents, suggestions, isOpen, workflowExecution, pendingWorkflow, pendingClarification, orbAgentEnabledResolved, conversations, activeConversationId, sendMessage, open, close, toggle, clearHistory, resetConversation, clearWorkflowExecution, startPendingWorkflow, revisePendingWorkflow, cancelPendingWorkflow, answerClarification, answerMultiClarification, cancelClarification, startCollaborativeDiscussion, cancelCollaborativeDiscussion, collaborativeDiscussionMeta, activeDiscussionId, createConversation, switchConversation, renameConversation, deleteConversation]);

  return (
    <GlobalOrbChatContext.Provider value={value}>
      {children}
      {/*
        Card stacks — anchored to the orb's home corners on desktop; on mobile
        we collapse both into a single full-width bottom-sheet stack so cards
        stop overflowing 360-460px widths off the side of the phone.

        Desktop layout:
          - Right stack (bottom-right, items-end): clarification → workflow
            confirm → workflow exec → spotlight
          - Left stack (bottom-left, items-start): executor confirm → code
            task → executor progress

        Mobile layout (single stack, full-width):
          All six card slots render in one container at `inset-x-2 bottom-2`
          with `items-stretch` so each card consumes the available width via
          `w-full`. Order is the same priority chain: most-actionable closest
          to the orb (bottom) thanks to flex-col-reverse.

        Cards keep `pointer-events-auto` so the gap between cards stays
        click-through to the page beneath.
      */}
      {/*
        Card visibility:
          /agent 頁自己會在聊天區內 inline 顯示 Clarification / Workflow
          confirm / Workflow exec 三張卡（讓使用者覺得是對話延伸而非彈窗）。
          這裡偵測到 /agent 時把這三張卡的 prompt 設為 null 給 floating
          版本，避免重複渲染。其它（executor / code task / spotlight）
          仍維持 floating，因為它們是跨頁的長任務指示器。
       */}
      {(() => {
        const onAgentPage = locationPath === "/agent";
        const floatingClarification = onAgentPage ? null : pendingClarification;
        const floatingWorkflow = onAgentPage ? null : pendingWorkflow;
        const floatingExecution = onAgentPage ? null : (pendingWorkflow ? null : workflowExecution);
        return isMobile ? (
        <div
          data-testid="orb-card-stack-mobile"
          className="fixed inset-x-2 z-[88] flex flex-col-reverse items-stretch gap-2 overflow-y-auto pointer-events-none"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
            maxHeight: "calc(100vh - 6.5rem - env(safe-area-inset-bottom, 0px))",
          }}
        >
          <ClarificationPromptCard
            prompt={floatingClarification}
            isBusy={isSending}
            onAnswer={text => void answerClarification(text)}
            onMultiAnswer={(answers, extra) => void answerMultiClarification(answers, extra)}
            onCancel={cancelClarification}
          />
          <WorkflowConfirmationCard
            pendingWorkflow={floatingWorkflow}
            isBusy={isSending}
            onStart={startPendingWorkflow}
            onRevise={revisePendingWorkflow}
            onCancel={cancelPendingWorkflow}
          />
          <WorkflowExecutionFloatingPanel
            workflowExecution={floatingExecution}
            onDismiss={clearWorkflowExecution}
          />
          <ExecutorConfirmationCard
            pendingTask={pendingExecutorTask}
            isBusy={isSending}
            onApprove={approveExecutorTask}
            onCancel={cancelExecutorTask}
            onEditPlan={editExecutorPlan}
          />
          <CodeTaskCard
            codeTask={pendingCodeTask}
            isBusy={isSending}
            onApprove={approveCodeTask}
            onCancel={cancelCodeTaskPreview}
          />
          <ExecutorProgressPanel
            task={activeExecutorTask}
            state={orbExecutor.state}
            onRetry={retryExecutorTask}
            onCancel={() => void orbExecutor.cancelTask("cancelled during execution")}
            onReplan={replanFromFailure}
            onApproveStep={stepId => void orbExecutor.approveStep(stepId)}
          />
          <OrbFeatureSpotlight
            isChatOpen={isOpen}
            onTry={text => void sendMessage(text)}
          />
        </div>
      ) : (
        <>
          <div
            data-testid="orb-card-stack-right"
            className="fixed bottom-24 right-5 z-[88] flex flex-col-reverse items-end gap-3 max-h-[calc(100vh-7rem)] overflow-y-auto pointer-events-none"
          >
            <ClarificationPromptCard
              prompt={floatingClarification}
              isBusy={isSending}
              onAnswer={text => void answerClarification(text)}
              onMultiAnswer={(answers, extra) => void answerMultiClarification(answers, extra)}
              onCancel={cancelClarification}
            />
            <WorkflowConfirmationCard
              pendingWorkflow={floatingWorkflow}
              isBusy={isSending}
              onStart={startPendingWorkflow}
              onRevise={revisePendingWorkflow}
              onCancel={cancelPendingWorkflow}
            />
            <WorkflowExecutionFloatingPanel
              workflowExecution={floatingExecution}
              onDismiss={clearWorkflowExecution}
            />
            <OrbFeatureSpotlight
              isChatOpen={isOpen}
              onTry={text => void sendMessage(text)}
            />
          </div>
          <div
            data-testid="orb-card-stack-left"
            className="fixed bottom-24 left-5 z-[87] flex flex-col-reverse items-start gap-3 max-h-[calc(100vh-7rem)] overflow-y-auto pointer-events-none"
          >
            <ExecutorConfirmationCard
              pendingTask={pendingExecutorTask}
              isBusy={isSending}
              onApprove={approveExecutorTask}
              onCancel={cancelExecutorTask}
              onEditPlan={editExecutorPlan}
            />
            <CodeTaskCard
              codeTask={pendingCodeTask}
              isBusy={isSending}
              onApprove={approveCodeTask}
              onCancel={cancelCodeTaskPreview}
            />
            <ExecutorProgressPanel
              task={activeExecutorTask}
              state={orbExecutor.state}
              onRetry={retryExecutorTask}
              onCancel={() => void orbExecutor.cancelTask("cancelled during execution")}
              onReplan={replanFromFailure}
              onApproveStep={stepId => void orbExecutor.approveStep(stepId)}
            />
          </div>
        </>
      );
      })()}
      {latestServerTaskId && (
        <div className="fixed bottom-4 right-4 z-[83] w-[360px] max-w-[calc(100vw-2rem)] pointer-events-auto">
          <OrbTaskObservationStrip
            rootTaskId={latestServerTaskId}
            onSuggestionPick={text => void sendMessage(text)}
            onDismiss={() => setLatestServerTaskId(null)}
          />
        </div>
      )}
    </GlobalOrbChatContext.Provider>
  );
}

export function useGlobalOrbChat() {
  return useContext(GlobalOrbChatContext);
}
