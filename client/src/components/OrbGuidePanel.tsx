/**
 * OrbGuidePanel.tsx — 光球引導對話面板
 *
 * 這是升級後的光球核心 UI：
 *   - 全新「今天想做什麼？」意圖選擇介面
 *   - 逐步問題收集（每次只問一題，不壓迫）
 *   - 確認畫面 + 一鍵跳轉
 *   - 設計：溫暖、療癒、零壓力
 *
 * 使用方式：
 *   在 ProactiveOrbWidget 的 showPanel 時 render 此元件
 */

import { useRef, useEffect, useMemo, useState, useCallback, type ComponentType } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, X, RotateCcw, FastForward, MessageCircle, Navigation2, Send, Loader2, ChevronDown, Lightbulb, Leaf, Paperclip, Image as ImageIcon, Video, Music, Mic, Check, Circle, CheckCircle2, Briefcase, Wand2 } from "lucide-react";
import { useOrbGuide, INTENT_CONFIGS, type GuideIntent } from "@/contexts/OrbGuideContext";
import VisualSoul from "./VisualSoul";
import { useAIState } from "@/contexts/AIStateContext";
import { usePersonality } from "@/contexts/PersonalityContext";
import { usePageAgent, type AgentAction } from "@/contexts/PageAgentContext";
import { trpc } from "@/lib/trpc";
import type { OrbGuideStepRewrite, AgentModality } from "../../../shared/agent-actions";
import { summarizeOrbGuideActions } from "../../../shared/orb-guide-plans";
import {
  STUDIO_MODALITY_PROFILES,
  STUDIO_TOOLBOX_ENTRIES,
  STUDIO_COLLABORATION_LINKS,
  buildToolboxOpenAction,
  getStudioModalityProfile,
  IMAGE_STUDIO_T2I_PROFILE,
  IMAGE_STUDIO_EDIT_PROFILE,
  IMAGE_STUDIO_EDIT_CAPABILITY_LABELS,
  IMAGE_STUDIO_UPSCALE_PROFILE,
  IMAGE_STUDIO_POSE_PROFILE,
  IMAGE_STUDIO_SD_PROFILE,
  IMAGE_STUDIO_SD_CAPABILITY_LABELS,
  VIDEO_STUDIO_T2V_PROFILE,
  VIDEO_STUDIO_T2V_CAPABILITY_LABELS,
  VIDEO_STUDIO_I2V_PROFILE,
  VIDEO_STUDIO_I2V_CAPABILITY_LABELS,
  VIDEO_STUDIO_V2V_PROFILE,
  VIDEO_STUDIO_V2V_CAPABILITY_LABELS,
  VIDEO_STUDIO_ENHANCE_PROFILE,
  VIDEO_STUDIO_ENHANCE_CAPABILITY_LABELS,
  VIDEO_STUDIO_CONTROL_PROFILE,
  VIDEO_STUDIO_CONTROL_CAPABILITY_LABELS,
  PRO_STUDIO_MUSIC_PROFILE,
  PRO_STUDIO_SFX_PROFILE,
  PRO_STUDIO_TTS_PROFILE,
  PRO_STUDIO_CLONE_PROFILE,
  PRO_STUDIO_PROCESS_PROFILE,
  PRO_STUDIO_ASR_PROFILE,
  PRO_STUDIO_AVATAR_PROFILE,
  type ProStudioTab,
  type ProStudioGenericModel,
  type ProStudioPromptTemplate,
  buildImageStudioSetModelActions,
  buildImageStudioApplyVibeActions,
  buildImageStudioFillPromptActions,
  buildImageStudioSetAspectRatioActions,
  buildImageStudioEditSetModelActions,
  buildImageStudioEditFillPromptActions,
  buildImageStudioEditSetStrengthActions,
  buildImageStudioEditSetOutputSizeActions,
  buildImageStudioUpscaleSetModelActions,
  buildImageStudioUpscaleSetModeActions,
  buildImageStudioUpscaleSetFactorActions,
  buildImageStudioPoseSetModelActions,
  buildImageStudioPoseSetDrawModeActions,
  buildImageStudioSDSetModelActions,
  buildImageStudioSDApplyPromptTemplateActions,
  buildImageStudioSDSetImageSizeActions,
  buildImageStudioSDSetGuidanceActions,
  buildImageStudioSDSetInferStepsActions,
  buildVideoStudioT2VSetModelActions,
  buildVideoStudioT2VApplyTemplateActions,
  buildVideoStudioT2VSetParamActions,
  buildVideoStudioI2VSetModelActions,
  buildVideoStudioI2VApplyTemplateActions,
  buildVideoStudioI2VSetParamActions,
  buildVideoStudioV2VSetModelActions,
  buildVideoStudioV2VApplyTemplateActions,
  buildVideoStudioV2VSetParamActions,
  buildVideoStudioEnhanceSetModelActions,
  buildVideoStudioEnhanceSetParamActions,
  buildVideoStudioControlSetModelActions,
  buildVideoStudioControlApplyTemplateActions,
  buildVideoStudioControlSetCameraMotionActions,
  buildVideoStudioControlSetControlNetActions,
  buildVideoStudioControlSetParamActions,
  buildProStudioSetModelActions,
  buildProStudioFillPromptActions,
  buildProStudioSetParamActions,
  buildProStudioApplyTemplateActions,
} from "../../../shared/orb-studio-actions";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMobile";
import { useGlobalOrbChat, getPageEmoji, formatMessageMetadata, getPageLabelByPath } from "@/contexts/GlobalOrbChatContext";
import { useOrbAttachments, attachmentKindEmoji } from "@/hooks/useOrbAttachments";
import { ORB_UPLOAD_ACCEPT } from "../../../shared/orb-chat-multimodal";
import { toast } from "sonner";

// ─── Shared deep-action runner ──────────────────────────────────────────────
// 五個圖片創作室分頁面板（t2i / edit / upscale / pose / sd）和 Studio 都共用
// 同一段 dispatch 流程：跑完 dispatchMany → toast → 視情況 onClose。把它收成
// 一個 hook，元件內只關心「按下後要 dispatch 哪些 action」，避免重複定義。

function useOrbActionRunner(
  pageAgent: ReturnType<typeof usePageAgent>,
  onClose: () => void
) {
  return useCallback(
    async (label: string, actions: AgentAction[], closeAfter = true) => {
      const ok = await pageAgent.dispatchMany(actions, { source: "manual" });
      if (ok) {
        toast.success(`已執行：${label}`);
        if (closeAfter) onClose();
      }
      return ok;
    },
    [pageAgent, onClose]
  );
}

/** 與 ImageStudio.tsx StudioTab 對齊的有限聯集，方便在路由表使用 */
type ImageStudioTab = "t2i" | "edit" | "upscale" | "pose" | "sd";

function getImageStudioTab(
  pageAgent: ReturnType<typeof usePageAgent>
): ImageStudioTab | null {
  if (pageAgent.snapshot?.pageId !== "image-studio") return null;
  const tab = pageAgent.snapshot?.state?.activeTab;
  return tab === "t2i" ||
    tab === "edit" ||
    tab === "upscale" ||
    tab === "pose" ||
    tab === "sd"
    ? tab
    : null;
}

/**
 * 與 VideoStudio.tsx TabId 對齊；五個分頁全部接深度面板。
 */
type VideoStudioTab = "t2v" | "i2v" | "v2v" | "enhance" | "control";

function getVideoStudioTab(
  pageAgent: ReturnType<typeof usePageAgent>
): VideoStudioTab | null {
  if (pageAgent.snapshot?.pageId !== "video-studio") return null;
  const tab = pageAgent.snapshot?.state?.activeTab;
  return tab === "t2v" ||
    tab === "i2v" ||
    tab === "v2v" ||
    tab === "enhance" ||
    tab === "control"
    ? tab
    : null;
}

/** 與 ProStudio.tsx 7 個分頁對齊 */
function getProStudioTab(
  pageAgent: ReturnType<typeof usePageAgent>
): ProStudioTab | null {
  if (pageAgent.snapshot?.pageId !== "pro-studio") return null;
  const tab = pageAgent.snapshot?.state?.activeTab;
  return tab === "music" ||
    tab === "sfx" ||
    tab === "tts" ||
    tab === "clone" ||
    tab === "process" ||
    tab === "asr" ||
    tab === "avatar"
    ? tab
    : null;
}

// ─── Intent Card ─────────────────────────────────────────────────────────────

function IntentCard({
  intent,
  onSelect,
}: {
  intent: Exclude<GuideIntent, null>;
  onSelect: () => void;
}) {
  const cfg = INTENT_CONFIGS[intent];
  return (
    <motion.button
      onClick={onSelect}
      className={cn(
        "relative flex flex-col items-start gap-1.5 p-3.5 rounded-2xl",
        "bg-white/8 hover:bg-white/15 border border-white/10 hover:border-white/25",
        "transition-all duration-200 text-left group w-full"
      )}
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.97 }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl leading-none">{cfg.emoji}</span>
        <span className="text-sm font-medium text-white/90">{cfg.label}</span>
      </div>
      <p className="text-xs text-white/50 leading-relaxed pl-0.5">{cfg.description}</p>
      <ArrowRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all" />
    </motion.button>
  );
}

// ─── Answer Option Button ─────────────────────────────────────────────────────

function AnswerOption({
  label,
  emoji,
  onSelect,
  delay,
}: {
  label: string;
  emoji: string;
  onSelect: () => void;
  delay: number;
}) {
  return (
    <motion.button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 px-4 py-3 rounded-2xl w-full text-left",
        "bg-white/8 hover:bg-white/18 border border-white/10 hover:border-white/30",
        "transition-all duration-200 group"
      )}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.25 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
    >
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-sm text-white/85 group-hover:text-white transition-colors">{label}</span>
      <ArrowRight className="ml-auto w-3 h-3 text-white/20 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all" />
    </motion.button>
  );
}

// ─── OrbSpeechBubble ─────────────────────────────────────────────────────────

function OrbSpeechBubble({ text, small = false }: { text: string; small?: boolean }) {
  return (
    <motion.div
      className={cn(
        "relative px-4 py-3 rounded-2xl rounded-bl-sm",
        "bg-gradient-to-br from-white/12 to-white/6 border border-white/15",
        "text-white/90 leading-relaxed",
        small ? "text-xs" : "text-sm"
      )}
      initial={{ opacity: 0, scale: 0.92, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {text}
    </motion.div>
  );
}

interface VisualMessageItem {
  title: string;
  description: string;
}

function parseVisualMessage(text: string): { intro: string | null; items: VisualMessageItem[] } {
  const rawLines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const itemRegex = /^\d+\.\s*(?:\*\*)?([^:*：]+?)(?:\*\*)?\s*[:：]\s*(.+)$/;
  const bulletRegex = /^[-•]\s*(?:\*\*)?([^:*：]+?)(?:\*\*)?\s*[:：]\s*(.+)$/;
  const items: VisualMessageItem[] = [];
  let intro: string | null = null;

  for (const line of rawLines) {
    const normalized = line
      .replace(/\*\*/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1");
    const match = itemRegex.exec(normalized);
    const bulletMatch = bulletRegex.exec(normalized);
    if (match || bulletMatch) {
      const target = match ?? bulletMatch;
      if (!target) continue;
      items.push({
        title: target[1].trim(),
        description: target[2].trim(),
      });
      continue;
    }
    if (!intro) {
      intro = normalized;
    }
  }

  return { intro, items };
}

function OrbMessageContent({ text, compact = false }: { text: string; compact?: boolean }) {
  const [showFullText, setShowFullText] = useState(false);
  const { intro, items } = parseVisualMessage(text);
  const hasVisualCards = items.length >= 2;
  const isLongText = text.length > 220;

  if (hasVisualCards) {
    return (
      <div className="space-y-2">
        <p className={cn("text-white/85 leading-relaxed", compact ? "text-xs" : "text-sm")}>
          {intro ?? "我幫你整理成重點卡片："}
        </p>
        <div className="space-y-1.5">
          {items.slice(0, 4).map((item, idx) => (
            <div
              key={`${item.title}-${idx}`}
              className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-2"
            >
              <p className={cn("font-medium text-white/90", compact ? "text-[11px]" : "text-xs")}>
                {idx + 1}. {item.title}
              </p>
              <p className={cn("text-white/65 mt-0.5 line-clamp-2", compact ? "text-[10px]" : "text-[11px]")}>
                {item.description}
              </p>
            </div>
          ))}
        </div>
        {isLongText && (
          <button
            onClick={() => setShowFullText(v => !v)}
            className={cn(
              "text-white/55 hover:text-white/85 underline-offset-2 hover:underline transition-colors",
              compact ? "text-[10px]" : "text-[11px]"
            )}
          >
            {showFullText ? "收起完整說明" : "查看完整說明"}
          </button>
        )}
        {isLongText && showFullText && (
          <p className={cn("text-white/70 whitespace-pre-wrap leading-relaxed", compact ? "text-[10px]" : "text-[11px]")}>
            {text}
          </p>
        )}
      </div>
    );
  }

  if (isLongText) {
    const preview = text.slice(0, compact ? 130 : 180).trimEnd();
    return (
      <div className="space-y-1.5">
        <p className={cn("text-white/85 whitespace-pre-wrap leading-relaxed", compact ? "text-xs" : "text-sm")}>
          {showFullText ? text : `${preview}…`}
        </p>
        <button
          onClick={() => setShowFullText(v => !v)}
          className={cn(
            "text-white/55 hover:text-white/85 underline-offset-2 hover:underline transition-colors",
            compact ? "text-[10px]" : "text-[11px]"
          )}
        >
          {showFullText ? "收起" : "展開全文"}
        </button>
      </div>
    );
  }

  return <p className="whitespace-pre-wrap">{text}</p>;
}

function actionToGuideLabel(action: AgentAction): string {
  switch (action.type) {
    case "navigate":
      return `前往 ${getPageLabelByPath(action.path)}`;
    case "setModel":
      return `選模型：${action.modelId}`;
    case "setTab":
      return `切分頁：${action.tabId}`;
    case "setMode":
      return `切模式：${action.modeId}`;
    case "setModality":
      return `切類型：${action.modality}`;
    case "fillPrompt":
      return "填入提示詞";
    case "setParam":
      return `設參數：${action.key}`;
    case "applyPreset":
      return `套用：${action.presetId}`;
    case "focusElement":
      return `看這裡：${action.elementId}`;
    default:
      return action.type;
  }
}

// ─── Studio modality grid (per-page modality switcher, no navigation) ────────

const STUDIO_MODALITY_CARDS: Array<{
  modality: "image" | "video" | "audio" | "voice";
  icon: typeof ImageIcon;
  title: string;
  description: string;
}> = [
  {
    modality: "image",
    icon: ImageIcon,
    title: "切到生成圖像",
    description: "用文字創作任何畫面",
  },
  {
    modality: "video",
    icon: Video,
    title: "切到生成影片",
    description: "幾秒生成流暢動態",
  },
  {
    modality: "audio",
    icon: Music,
    title: "切到生成音樂",
    description: "創作專屬背景音樂",
  },
  {
    modality: "voice",
    icon: Mic,
    title: "切到配音/語音",
    description: "文字變成自然語音",
  },
];

function StudioModalityGrid({
  fullscreen,
  activeModality,
  onPick,
}: {
  fullscreen: boolean;
  activeModality?: AgentModality;
  onPick: (modality: "image" | "video" | "audio" | "voice") => void | Promise<void>;
}) {
  return (
    <div
      className={cn(
        "gap-2 pt-1",
        fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
      )}
    >
      {STUDIO_MODALITY_CARDS.map((card, i) => {
        const Icon = card.icon;
        const isActive = activeModality === card.modality;
        return (
          <motion.button
            key={card.modality}
            onClick={() => void onPick(card.modality)}
            className={cn(
              "rounded-xl border transition-all p-3 text-left flex items-start gap-3",
              "focus:outline-none focus:ring-2 focus:ring-white/30",
              isActive
                ? "border-cyan-300/40 bg-cyan-300/10 hover:bg-cyan-300/15"
                : "border-white/10 bg-white/5 hover:bg-white/12 hover:border-white/25"
            )}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className={cn("rounded-lg p-2 shrink-0", isActive ? "bg-cyan-300/20" : "bg-white/10")}>
              <Icon className="w-4 h-4 text-white/85" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white/90 truncate flex items-center gap-1.5">
                {card.title}
                {isActive && (
                  <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                    目前
                  </span>
                )}
              </p>
              <p className="text-[11px] text-white/55 mt-0.5 line-clamp-2">
                {card.description}
              </p>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-white/40 shrink-0 mt-1.5" />
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Studio deep-action grid: per-modality细節操作 ─────────────────────────

function StudioDeepActionGrid({
  fullscreen,
  modality,
  onRun,
}: {
  fullscreen: boolean;
  modality: AgentModality;
  onRun: (label: string, actions: AgentAction[]) => void | Promise<void>;
}) {
  const profile = getStudioModalityProfile(modality);
  if (!profile) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
        {profile.emoji} {profile.label}・細節操作
      </p>
      <div
        className={cn(
          "gap-1.5",
          fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
        )}
      >
        {profile.deepActions.map((act, i) => (
          <motion.button
            key={`${profile.modality}-${act.label}`}
            onClick={() => void onRun(act.label, act.buildActions())}
            className={cn(
              "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
              "transition-all px-3 py-2 text-left flex items-start gap-2",
              "focus:outline-none focus:ring-1 focus:ring-white/30"
            )}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileTap={{ scale: 0.97 }}
          >
            <span className="text-base leading-none mt-0.5">{act.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white/90 truncate">{act.label}</p>
              <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                {act.description}
              </p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ─── Studio toolbox quick-access row ──────────────────────────────────────

function StudioToolboxRow({
  fullscreen,
  onOpenToolbox,
}: {
  fullscreen: boolean;
  onOpenToolbox: (tab: typeof STUDIO_TOOLBOX_ENTRIES[number]["tab"]) => void | Promise<void>;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
        <Briefcase className="w-3 h-3" /> 工具箱深度操作
      </p>
      <div className="flex flex-wrap gap-1.5">
        {STUDIO_TOOLBOX_ENTRIES.map((entry, i) => (
          <motion.button
            key={entry.tab}
            onClick={() => void onOpenToolbox(entry.tab)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full",
              "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30",
              "text-white/80 hover:text-white transition-all",
              fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]"
            )}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            whileTap={{ scale: 0.97 }}
            title={entry.description}
          >
            <span>{entry.emoji}</span>
            <span>{entry.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ─── Studio collaboration links（模型推薦／導演 AI／API 深度連結／全站光球）─

function StudioCollaborationRow({
  fullscreen,
  onSendChat,
}: {
  fullscreen: boolean;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  return (
    <StudioCollaborationLinkGrid
      fullscreen={fullscreen}
      title="生成模型 / 導演 AI / API 連結"
      links={STUDIO_COLLABORATION_LINKS}
      onSendChat={onSendChat}
    />
  );
}

// ─── Studio Deep Actions (modality grid + deep actions + toolbox + collab) ──

function StudioOrbDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  // Studio.tsx 的 useRegisterPageAgent state 會把 activeModality 揭示出來
  const rawModality = pageAgent.snapshot?.state?.activeModality as
    | string
    | undefined;
  const activeModality: AgentModality | undefined =
    rawModality === "image" ||
    rawModality === "video" ||
    rawModality === "audio" ||
    rawModality === "voice"
      ? rawModality
      : undefined;
  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <StudioModalityGrid
        fullscreen={fullscreen}
        activeModality={activeModality}
        onPick={modality =>
          // 切完模態先讓使用者看到深度操作再決定下一步，不立刻 onClose
          void runActions(`切到 ${modality}`, [{ type: "setModality", modality }], false)
        }
      />

      {activeModality && (
        <StudioDeepActionGrid
          fullscreen={fullscreen}
          modality={activeModality}
          onRun={(label, actions) => void runActions(label, actions)}
        />
      )}

      <StudioToolboxRow
        fullscreen={fullscreen}
        onOpenToolbox={tab =>
          void runActions(`開工具箱 ${tab}`, [buildToolboxOpenAction(tab)])
        }
      />

      <StudioCollaborationRow
        fullscreen={fullscreen}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Image Studio T2I Deep Actions (model + vibe + template + ratio + collab) ─

function ImageStudioT2IDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  const profile = IMAGE_STUDIO_T2I_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const currentModelId = snapshotState?.selectedModelId as string | undefined;
  const currentAspect = snapshotState?.aspectRatio as string | undefined;
  // ImageStudio.tsx 把 vibeIds.join(", ") 放進 snapshot；解析回 set 才能避免
  // 一個 id 是另一個 id 子字串的潛在誤判（目前 8 張卡無此問題，仍保險寫法）
  const appliedVibeSet = useMemo(() => {
    const raw = String(snapshotState?.appliedVibes ?? "");
    return new Set(
      raw.split(",").map(s => s.trim()).filter(Boolean)
    );
  }, [snapshotState?.appliedVibes]);

  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text="嘿 👋 你已經在文字生圖（T2I）。想換模型、加氛圍、套模板，還是幫你寫提示詞？"
      />

      {/* 模型快選 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 文字生圖模型
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.models.map((m, i) => {
            const isActive = currentModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(`切到 ${m.label}`, buildImageStudioSetModelActions(m.id))
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  "focus:outline-none focus:ring-1 focus:ring-white/30",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10 hover:bg-cyan-300/15"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 氛圍卡 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🌈 氛圍卡（applyPreset）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.vibes.map((v, i) => {
            const isApplied = appliedVibeSet.has(v.id);
            return (
              <motion.button
                key={v.id}
                onClick={() =>
                  void runActions(
                    `加入「${v.label}」氛圍`,
                    buildImageStudioApplyVibeActions(v.id),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-full transition-all",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isApplied
                    ? "border border-emerald-300/40 bg-emerald-300/15 text-emerald-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80 hover:text-white"
                )}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.95 }}
                title={isApplied ? "已套用" : "點擊套用"}
              >
                <span>{v.emoji}</span>
                <span>{v.label}</span>
                {isApplied && <Check className="w-2.5 h-2.5" />}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 提示詞模板 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Lightbulb className="w-3 h-3" /> 提示詞起手式（fillPrompt）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.templates.slice(0, fullscreen ? 6 : 4).map((tpl, i) => (
            <motion.button
              key={tpl.id}
              onClick={() =>
                void runActions(
                  `填入「${tpl.label}」模板`,
                  buildImageStudioFillPromptActions(tpl.text)
                )
              }
              className={cn(
                "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                "transition-all px-3 py-2 text-left flex items-start gap-2",
                "focus:outline-none focus:ring-1 focus:ring-white/30"
              )}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                  {tpl.text}
                </p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 畫面比例 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          📐 畫面比例（setParam aspectRatio）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.aspectRatios.map((ar, i) => {
            const isActive = currentAspect === ar.id;
            return (
              <motion.button
                key={ar.id}
                onClick={() =>
                  void runActions(
                    `比例切到 ${ar.label}`,
                    buildImageStudioSetAspectRatioActions(ar.id),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all min-w-[2.5rem] justify-center",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                whileTap={{ scale: 0.95 }}
              >
                {ar.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 一鍵生成 + 重設 */}
      <div className="flex gap-1.5">
        <motion.button
          onClick={() =>
            void runActions(
              "送出生成（API）",
              [{ type: "submit" }]
            )
          }
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出生成
        </motion.button>
        <motion.button
          onClick={() =>
            void runActions("重設此頁", [{ type: "reset" }], false)
          }
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      {/* T2I 跨頁協作（含模型推薦 / 提示詞擴寫 / 導演 AI 等） */}
      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="提示詞 / 模型 / 導演 AI 連結"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Image Studio Edit Deep Actions (model + capability badges + 模板 + 強度) ─

function ImageStudioEditDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  const profile = IMAGE_STUDIO_EDIT_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const currentModelId = snapshotState?.selectedModelId as string | undefined;
  const currentStrength = snapshotState?.strength as number | undefined;
  const currentOutputSize = snapshotState?.outputSize as string | undefined;
  const hasRefImage = Boolean(snapshotState?.hasRefImage);
  const currentModel = useMemo(
    () => profile.models.find(m => m.id === currentModelId),
    [profile.models, currentModelId]
  );
  const supportsStrength = currentModel?.capabilities.includes("strength");
  const supportsOutputSize = currentModel?.capabilities.includes("size");

  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text={
          hasRefImage
            ? "嘿 👋 你已經在圖片編輯（edit）。我幫你選對模型、寫好指令，按一下就改完。"
            : "嘿 👋 你在圖片編輯頁。記得先上傳一張要編輯的圖，我才能幫你動手。"
        }
      />

      {/* 模型快選 + 能力徽章 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 圖片編輯模型（9 種）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.models.map((m, i) => {
            const isActive = currentModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(
                    `切到 ${m.label}`,
                    buildImageStudioEditSetModelActions(m.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  "focus:outline-none focus:ring-1 focus:ring-white/30",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10 hover:bg-cyan-300/15"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {m.fast && (
                      <span className="text-[9px] uppercase tracking-wide text-amber-100/80 rounded-full bg-amber-300/20 px-1.5 py-0.5">
                        快
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                  {m.capabilities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {m.capabilities.map(cap => (
                        <span
                          key={cap}
                          className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                        >
                          {IMAGE_STUDIO_EDIT_CAPABILITY_LABELS[cap]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 編輯任務模板 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Lightbulb className="w-3 h-3" /> 常見編輯任務（fillPrompt）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.templates.slice(0, fullscreen ? 8 : 6).map((tpl, i) => {
            const suggestedModel = tpl.suggestedModelId
              ? profile.models.find(m => m.id === tpl.suggestedModelId)
              : undefined;
            return (
              <motion.button
                key={tpl.id}
                onClick={() =>
                  void runActions(
                    `填入「${tpl.label}」指令`,
                    buildImageStudioEditFillPromptActions(tpl.text)
                  )
                }
                className={cn(
                  "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                  "transition-all px-3 py-2 text-left flex items-start gap-2",
                  "focus:outline-none focus:ring-1 focus:ring-white/30"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.97 }}
                title={tpl.text}
              >
                <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {tpl.text}
                  </p>
                  {suggestedModel && (
                    <p className="text-[9px] text-white/40 mt-1 truncate">
                      建議搭配：{suggestedModel.label}
                    </p>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 改動強度（只在當前模型支援 strength 時顯示） */}
      {supportsStrength && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
            🎚 改動強度（setParam strength）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.strengthPresets.map((p, i) => {
              const isActive =
                typeof currentStrength === "number" &&
                Math.abs(currentStrength - p.value) < 0.05;
              return (
                <motion.button
                  key={p.id}
                  onClick={() =>
                    void runActions(
                      `強度設為 ${p.label}`,
                      buildImageStudioEditSetStrengthActions(p.value),
                      false
                    )
                  }
                  className={cn(
                    "inline-flex items-center rounded-full transition-all",
                    fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                    isActive
                      ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                      : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                  )}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  whileTap={{ scale: 0.95 }}
                  title={p.description}
                >
                  {p.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* 輸出尺寸（僅 GPT Image 1.5 等支援 size 的模型） */}
      {supportsOutputSize && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
            📐 輸出尺寸（setParam outputSize）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.outputSizes.map((s, i) => {
              const isActive = currentOutputSize === s.id;
              return (
                <motion.button
                  key={s.id}
                  onClick={() =>
                    void runActions(
                      `尺寸切到 ${s.label}`,
                      buildImageStudioEditSetOutputSizeActions(s.id),
                      false
                    )
                  }
                  className={cn(
                    "inline-flex items-center rounded-full transition-all",
                    fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                    isActive
                      ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                      : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                  )}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {s.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* 一鍵送出生成 + 重設 */}
      <div className="flex gap-1.5">
        <motion.button
          onClick={() =>
            void runActions("送出編輯（API）", [{ type: "submit" }])
          }
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
          disabled={!hasRefImage}
          title={hasRefImage ? "送出生成" : "先上傳要編輯的圖再送"}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出編輯
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      {/* 跨頁協作 */}
      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="編輯指令 / 模型推薦 / 導演 AI 連結"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Image Studio Upscale Deep Actions (mode + factor + 直送) ─────────────

function ImageStudioUpscaleDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  const profile = IMAGE_STUDIO_UPSCALE_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const currentModelId = snapshotState?.selectedModelId as string | undefined;
  const currentMode = snapshotState?.upscaleMode as "factor" | "target" | undefined;
  const currentFactor = snapshotState?.upscaleFactor as number | undefined;
  const hasUpscaleImage = Boolean(snapshotState?.hasUpscaleImage);

  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text={
          hasUpscaleImage
            ? "嘿 👋 你在影像放大頁。挑倍率，送出就好。"
            : "嘿 👋 你在影像放大頁。先上傳一張要放大的圖，我幫你選倍率。"
        }
      />

      {/* 模型 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 放大模型
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {profile.models.map((m, i) => {
            const isActive = currentModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(
                    `切到 ${m.label}`,
                    buildImageStudioUpscaleSetModelActions(m.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  "focus:outline-none focus:ring-1 focus:ring-white/30",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10 hover:bg-cyan-300/15"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 模式 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🎚 放大模式
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.modes.map(mode => {
            const isActive = currentMode === mode.id;
            return (
              <motion.button
                key={mode.id}
                onClick={() =>
                  void runActions(
                    `切到「${mode.label}」`,
                    buildImageStudioUpscaleSetModeActions(mode.id),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
                title={mode.description}
              >
                {mode.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 倍率 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          📈 放大倍率（會自動切到 factor 模式）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.factors.map(f => {
            const isActive = currentFactor === f.value;
            return (
              <motion.button
                key={f.id}
                onClick={() =>
                  void runActions(
                    `倍率設為 ${f.label}`,
                    buildImageStudioUpscaleSetFactorActions(f.value),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all min-w-[3rem] justify-center",
                  fullscreen ? "px-3 py-1 text-[11px]" : "px-2.5 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
              >
                {f.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 一鍵送出 + 重設 */}
      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出放大（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
          disabled={!hasUpscaleImage}
          title={hasUpscaleImage ? "送出放大" : "先上傳要放大的圖"}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出放大
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="跨頁串接 / 批次放大 / 導演 AI 連結"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Image Studio Pose Deep Actions (model + 7 modes + 直送) ──────────────

function ImageStudioPoseDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  const profile = IMAGE_STUDIO_POSE_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const currentModelId = snapshotState?.selectedModelId as string | undefined;
  const currentDrawMode = snapshotState?.drawMode as string | undefined;
  const hasPoseImage = Boolean(snapshotState?.hasPoseImage);

  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text={
          hasPoseImage
            ? "嘿 👋 你在骨骼姿勢頁。挑偵測模式，送出就好。"
            : "嘿 👋 你在骨骼姿勢頁。先上傳一張人物圖片，我幫你抓骨骼。"
        }
      />

      {/* 模型 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 偵測模型
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {profile.models.map((m, i) => {
            const isActive = currentModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(
                    `切到 ${m.label}`,
                    buildImageStudioPoseSetModelActions(m.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  "focus:outline-none focus:ring-1 focus:ring-white/30",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10 hover:bg-cyan-300/15"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 7 個偵測模式 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🦴 偵測模式（drawMode）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.modes.map((mode, i) => {
            const isActive = currentDrawMode === mode.id;
            return (
              <motion.button
                key={mode.id}
                onClick={() =>
                  void runActions(
                    `切到「${mode.label}」偵測`,
                    buildImageStudioPoseSetDrawModeActions(mode.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-center gap-2",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none">{mode.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate">
                    {mode.label}
                  </p>
                  <p className="text-[9px] text-white/45 truncate">{mode.id}</p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 一鍵送出 + 重設 */}
      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出偵測（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
          disabled={!hasPoseImage}
          title={hasPoseImage ? "送出偵測" : "先上傳人物圖片"}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出偵測
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="骨骼 → ControlNet / t2i / 導演 AI"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Image Studio SD Deep Actions (3 模型 + 模板 + LoRA + ControlNet) ──────

function ImageStudioSDDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  const profile = IMAGE_STUDIO_SD_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const currentModelId = snapshotState?.selectedModelId as string | undefined;
  const currentImageSize = snapshotState?.sdImageSize as string | undefined;
  const currentGuidance = snapshotState?.sdGuidance as number | undefined;
  const currentInferSteps = snapshotState?.sdInferSteps as number | undefined;
  const hasLora = Boolean(snapshotState?.hasLora);
  const hasControlnet = Boolean(snapshotState?.hasControlnet);
  const currentModel = useMemo(
    () => profile.models.find(m => m.id === currentModelId),
    [profile.models, currentModelId]
  );
  const supportsGuidance = currentModel?.capabilities.includes("guidance");

  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble text="嘿 👋 你在 Stable Diffusion 分頁。挑模型、套提示詞、設 LoRA / ControlNet，按一下就生。" />

      {/* 模型 + 能力徽章 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> SD 模型（3 種）
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {profile.models.map((m, i) => {
            const isActive = currentModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(
                    `切到 ${m.label}`,
                    buildImageStudioSDSetModelActions(m.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {m.fast && (
                      <span className="text-[9px] uppercase tracking-wide text-amber-100/80 rounded-full bg-amber-300/20 px-1.5 py-0.5">
                        快
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.capabilities.map(cap => (
                      <span
                        key={cap}
                        className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                      >
                        {IMAGE_STUDIO_SD_CAPABILITY_LABELS[cap]}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 提示詞模板（含正/負雙槽） */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Lightbulb className="w-3 h-3" /> SD 提示詞模板（正向 + 負向同時填）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.templates.map((tpl, i) => (
            <motion.button
              key={tpl.id}
              onClick={() =>
                void runActions(
                  `套用「${tpl.label}」模板`,
                  buildImageStudioSDApplyPromptTemplateActions(tpl)
                )
              }
              className={cn(
                "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                "transition-all px-3 py-2 text-left flex items-start gap-2"
              )}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileTap={{ scale: 0.97 }}
              title={tpl.prompt}
            >
              <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                  {tpl.prompt}
                </p>
                {tpl.negPrompt && (
                  <p className="text-[9px] text-rose-200/60 mt-1 truncate">
                    neg: {tpl.negPrompt}
                  </p>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 圖片尺寸 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          📐 圖片尺寸（sdImageSize）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.imageSizes.map(s => {
            const isActive = currentImageSize === s.id;
            return (
              <motion.button
                key={s.id}
                onClick={() =>
                  void runActions(
                    `尺寸切到 ${s.label}`,
                    buildImageStudioSDSetImageSizeActions(s.id),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
              >
                {s.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 引導值 (僅當前模型支援 guidance) */}
      {supportsGuidance && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
            🎚 引導值（sdGuidance 1–20）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.guidancePresets.map(p => {
              const isActive =
                typeof currentGuidance === "number" &&
                Math.abs(currentGuidance - p.value) < 0.1;
              return (
                <motion.button
                  key={p.id}
                  onClick={() =>
                    void runActions(
                      `引導值 ${p.label}`,
                      buildImageStudioSDSetGuidanceActions(p.value),
                      false
                    )
                  }
                  className={cn(
                    "inline-flex items-center rounded-full transition-all",
                    fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                    isActive
                      ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                      : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                  )}
                  whileTap={{ scale: 0.95 }}
                  title={p.description}
                >
                  {p.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      )}

      {/* 推理步數 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          ⏱ 推理步數（sdInferSteps 10–50）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.inferStepsPresets.map(p => {
            const isActive = currentInferSteps === p.value;
            return (
              <motion.button
                key={p.id}
                onClick={() =>
                  void runActions(
                    `推理步數 ${p.label}`,
                    buildImageStudioSDSetInferStepsActions(p.value),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
                title={p.description}
              >
                {p.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* LoRA / ControlNet 狀態（read-only），實際 URL 設定在頁面內表單填 */}
      {(hasLora || hasControlnet) && (
        <div className="flex flex-wrap gap-1.5">
          {hasLora && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/40 bg-emerald-300/15 text-emerald-50 px-2 py-0.5 text-[10px]">
              <Check className="w-2.5 h-2.5" /> LoRA 已綁定
            </span>
          )}
          {hasControlnet && (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/40 bg-cyan-300/15 text-cyan-50 px-2 py-0.5 text-[10px]">
              <Check className="w-2.5 h-2.5" /> ControlNet 已綁定
            </span>
          )}
        </div>
      )}

      {/* 一鍵送出 + 重設 */}
      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出 SD 生成（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出 SD
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="SD 提示詞 / LoRA / ControlNet / 模型推薦"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Video Studio T2V Deep Actions (6 模型 + 模板 + 時長 / 比例 / 解析度) ────

function VideoStudioT2VDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  const profile = VIDEO_STUDIO_T2V_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const currentDuration = snapshotState?.duration as string | undefined;
  const currentAspect = snapshotState?.aspectRatio as string | undefined;
  // VideoStudio 沒有把 selectedModelId 直接放進 snapshot（modelKey 由 child bus
  // 各自管理），因此用「模型徽章 + 模板建議模型」的方式呈現，不顯示 active 標記。
  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text="嘿 👋 你在影片專業工作室文生影。挑模型、套提示詞、設時長與比例，按一下就生。"
      />

      {/* 模型 + 能力徽章 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 文生影模型（6 種）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.models.map((m, i) => (
            <motion.button
              key={m.id}
              onClick={() =>
                void runActions(
                  `切到 ${m.label}`,
                  buildVideoStudioT2VSetModelActions(m.id),
                  false
                )
              }
              className={cn(
                "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                "transition-all px-3 py-2 text-left flex items-start gap-2",
                "focus:outline-none focus:ring-1 focus:ring-white/30"
              )}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-base leading-none mt-0.5">{m.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                  {m.label}
                  {m.fast && (
                    <span className="text-[9px] uppercase tracking-wide text-amber-100/80 rounded-full bg-amber-300/20 px-1.5 py-0.5">
                      快
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                  {m.description}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.capabilities.map(cap => (
                    <span
                      key={cap}
                      className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                    >
                      {VIDEO_STUDIO_T2V_CAPABILITY_LABELS[cap]}
                    </span>
                  ))}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 模板 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Lightbulb className="w-3 h-3" /> 影片提示詞模板（含負向詞）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.templates.map((tpl, i) => (
            <motion.button
              key={tpl.id}
              onClick={() =>
                void runActions(
                  `套用「${tpl.label}」模板`,
                  buildVideoStudioT2VApplyTemplateActions(tpl)
                )
              }
              className={cn(
                "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                "transition-all px-3 py-2 text-left flex items-start gap-2"
              )}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileTap={{ scale: 0.97 }}
              title={tpl.prompt}
            >
              <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                  {tpl.prompt}
                </p>
                {tpl.suggestedModelId && (
                  <p className="text-[9px] text-white/40 mt-1 truncate">
                    建議搭配：{tpl.suggestedModelId}
                  </p>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 時長 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          ⏱ 時長（duration，Kling / Sora 接受）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.durations.map(d => {
            const isActive = currentDuration === d.value;
            return (
              <motion.button
                key={d.id}
                onClick={() =>
                  void runActions(
                    `時長設為 ${d.label}`,
                    buildVideoStudioT2VSetParamActions("duration", d.value),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all min-w-[3rem] justify-center",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
              >
                {d.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 比例 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          📐 畫面比例（aspectRatio，Kling / Veo3 / Sora 接受）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.aspects.map(a => {
            const isActive = currentAspect === a.value;
            return (
              <motion.button
                key={a.id}
                onClick={() =>
                  void runActions(
                    `比例切到 ${a.label}`,
                    buildVideoStudioT2VSetParamActions("aspectRatio", a.value),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
              >
                {a.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 解析度 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🖥 解析度（resolution，Wan / Sora 接受）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.resolutions.map(r => (
            <motion.button
              key={r.id}
              onClick={() =>
                void runActions(
                  `解析度設為 ${r.label}`,
                  buildVideoStudioT2VSetParamActions("resolution", r.value),
                  false
                )
              }
              className={cn(
                "inline-flex items-center rounded-full transition-all",
                fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
              )}
              whileTap={{ scale: 0.95 }}
            >
              {r.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* 模型專屬開關 */}
      <div className="flex flex-wrap gap-1.5">
        <motion.button
          onClick={() =>
            void runActions(
              "開啟提詞優化（MiniMax）",
              buildVideoStudioT2VSetParamActions("promptOptimizer", true),
              false
            )
          }
          className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/6 hover:bg-white/14 text-white/80 px-2.5 py-1 text-[11px] transition-all"
          whileTap={{ scale: 0.95 }}
        >
          🪄 開提詞優化
        </motion.button>
        <motion.button
          onClick={() =>
            void runActions(
              "開啟生成音訊（Veo3）",
              buildVideoStudioT2VSetParamActions("generateAudio", true),
              false
            )
          }
          className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/6 hover:bg-white/14 text-white/80 px-2.5 py-1 text-[11px] transition-all"
          whileTap={{ scale: 0.95 }}
        >
          🔊 開含音訊
        </motion.button>
      </div>

      {/* 一鍵送出 + 重設 */}
      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出文生影（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出文生影
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="提示詞 / 模型推薦 / 改用 i2v / 導演 AI 拆鏡"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Video Studio I2V Deep Actions (5 模型 + 動作模板 + 時長 / 解析度) ──────

function VideoStudioI2VDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  const profile = VIDEO_STUDIO_I2V_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const hasImage = Boolean(snapshotState?.hasImage);
  const currentDuration = snapshotState?.duration as string | undefined;
  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text={
          hasImage
            ? "嘿 👋 你在圖生影。挑模型、套動作模板，按一下就動。"
            : "嘿 👋 你在圖生影。先上傳一張錨點圖，我幫你選模型與動作。"
        }
      />

      {/* 模型 + 能力徽章 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 圖生影模型（5 種）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.models.map((m, i) => (
            <motion.button
              key={m.id}
              onClick={() =>
                void runActions(
                  `切到 ${m.label}`,
                  buildVideoStudioI2VSetModelActions(m.id),
                  false
                )
              }
              className={cn(
                "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                "transition-all px-3 py-2 text-left flex items-start gap-2"
              )}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-base leading-none mt-0.5">{m.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                  {m.label}
                  {m.fast && (
                    <span className="text-[9px] uppercase tracking-wide text-amber-100/80 rounded-full bg-amber-300/20 px-1.5 py-0.5">
                      快
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                  {m.description}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.capabilities.map(cap => (
                    <span
                      key={cap}
                      className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                    >
                      {VIDEO_STUDIO_I2V_CAPABILITY_LABELS[cap]}
                    </span>
                  ))}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 動作模板 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Lightbulb className="w-3 h-3" /> 動作模板（fillPrompt + 建議模型）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.templates.map((tpl, i) => (
            <motion.button
              key={tpl.id}
              onClick={() =>
                void runActions(
                  `套用「${tpl.label}」動作`,
                  buildVideoStudioI2VApplyTemplateActions(tpl)
                )
              }
              className={cn(
                "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                "transition-all px-3 py-2 text-left flex items-start gap-2"
              )}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileTap={{ scale: 0.97 }}
              title={tpl.prompt}
            >
              <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                  {tpl.prompt}
                </p>
                {tpl.suggestedModelId && (
                  <p className="text-[9px] text-white/40 mt-1 truncate">
                    建議搭配：{tpl.suggestedModelId}
                  </p>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* 時長 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          ⏱ 時長（duration）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.durations.map(d => {
            const isActive = currentDuration === d.value;
            return (
              <motion.button
                key={d.id}
                onClick={() =>
                  void runActions(
                    `時長設為 ${d.label}`,
                    buildVideoStudioI2VSetParamActions("duration", d.value),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all min-w-[3rem] justify-center",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
              >
                {d.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 解析度 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🖥 解析度（resolution，Wan / PixVerse 接受）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.resolutions.map(r => (
            <motion.button
              key={r.id}
              onClick={() =>
                void runActions(
                  `解析度設為 ${r.label}`,
                  buildVideoStudioI2VSetParamActions("resolution", r.value),
                  false
                )
              }
              className={cn(
                "inline-flex items-center rounded-full transition-all",
                fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
              )}
              whileTap={{ scale: 0.95 }}
            >
              {r.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* 比例（Runway 用） */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          📐 比例（aspectRatio，Runway 接受）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.aspects.map(a => (
            <motion.button
              key={a.id}
              onClick={() =>
                void runActions(
                  `比例切到 ${a.label}`,
                  buildVideoStudioI2VSetParamActions("aspectRatio", a.value),
                  false
                )
              }
              className={cn(
                "inline-flex items-center rounded-full transition-all",
                fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
              )}
              whileTap={{ scale: 0.95 }}
            >
              {a.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* 一鍵送出 + 重設 */}
      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出圖生影（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
          disabled={!hasImage}
          title={hasImage ? "送出圖生影" : "先上傳錨點圖"}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出圖生影
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="動作擴寫 / 模型推薦 / 從圖片創作室拿圖 / 導演 AI"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Image / Video Studio tab → component dispatcher ─────────────────────
// 路由表化：新增分頁只要在這裡加一筆，不用改 Main Panel 的條件分支。

interface StudioDeepActionsCommonProps {
  fullscreen: boolean;
  pageAgent: ReturnType<typeof usePageAgent>;
  onClose: () => void;
  onSendChat: (prompt: string) => void | Promise<void>;
}

const IMAGE_STUDIO_PANELS: Record<
  ImageStudioTab,
  ComponentType<StudioDeepActionsCommonProps>
> = {
  t2i: ImageStudioT2IDeepActions,
  edit: ImageStudioEditDeepActions,
  upscale: ImageStudioUpscaleDeepActions,
  pose: ImageStudioPoseDeepActions,
  sd: ImageStudioSDDeepActions,
};

function ImageStudioDeepActionsForTab({
  tab,
  ...common
}: { tab: ImageStudioTab } & StudioDeepActionsCommonProps) {
  const Panel = IMAGE_STUDIO_PANELS[tab];
  return <Panel {...common} />;
}

// ─── Video Studio V2V Deep Actions（3 模型 + 風格化模板 + strength / cfg）──

function VideoStudioV2VDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: StudioDeepActionsCommonProps) {
  const profile = VIDEO_STUDIO_V2V_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const hasVideo = Boolean(snapshotState?.hasVideo);
  const currentStrength = snapshotState?.strength as number | undefined;
  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text={
          hasVideo
            ? "嘿 👋 你在影生影。挑模型、套風格化模板，調 strength 或 CFG，按一下就重風格。"
            : "嘿 👋 你在影生影。先上傳一段要重風格化的影片（或圖，給 LTX 用）。"
        }
      />

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 影生影模型（3 種）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.models.map((m, i) => (
            <motion.button
              key={m.id}
              onClick={() =>
                void runActions(
                  `切到 ${m.label}`,
                  buildVideoStudioV2VSetModelActions(m.id),
                  false
                )
              }
              className={cn(
                "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
                "transition-all px-3 py-2 text-left flex items-start gap-2"
              )}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-base leading-none mt-0.5">{m.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                  {m.label}
                  {m.fast && (
                    <span className="text-[9px] uppercase tracking-wide text-amber-100/80 rounded-full bg-amber-300/20 px-1.5 py-0.5">
                      快
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                  {m.description}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.capabilities.map(cap => (
                    <span
                      key={cap}
                      className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                    >
                      {VIDEO_STUDIO_V2V_CAPABILITY_LABELS[cap]}
                    </span>
                  ))}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Lightbulb className="w-3 h-3" /> 風格化模板
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.templates.map((tpl, i) => (
            <motion.button
              key={tpl.id}
              onClick={() =>
                void runActions(
                  `套用「${tpl.label}」風格`,
                  buildVideoStudioV2VApplyTemplateActions(tpl)
                )
              }
              className="rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25 transition-all px-3 py-2 text-left flex items-start gap-2"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileTap={{ scale: 0.97 }}
              title={tpl.prompt}
            >
              <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">{tpl.prompt}</p>
                {tpl.suggestedModelId && (
                  <p className="text-[9px] text-white/40 mt-1 truncate">
                    建議搭配：{tpl.suggestedModelId}
                  </p>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🎚 改動強度（strength，Wan 用）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.strengthPresets.map(p => {
            const isActive =
              typeof currentStrength === "number" &&
              Math.abs(currentStrength - p.value) < 0.05;
            return (
              <motion.button
                key={p.id}
                onClick={() =>
                  void runActions(
                    `強度設為 ${p.label}`,
                    buildVideoStudioV2VSetParamActions("strength", p.value),
                    false
                  )
                }
                className={cn(
                  "inline-flex items-center rounded-full transition-all",
                  fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                  isActive
                    ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                    : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                )}
                whileTap={{ scale: 0.95 }}
                title={p.description}
              >
                {p.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🎯 CFG（Kling 用，越高越貼合 prompt）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.cfgPresets.map(p => (
            <motion.button
              key={p.id}
              onClick={() =>
                void runActions(
                  `CFG 設為 ${p.label}`,
                  buildVideoStudioV2VSetParamActions("cfgScale", p.value),
                  false
                )
              }
              className={cn(
                "inline-flex items-center rounded-full transition-all",
                fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
              )}
              whileTap={{ scale: 0.95 }}
              title={p.description}
            >
              {p.label}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出影生影（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出影生影
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="風格化指令 / 模型 / 從 i2v 接過來 / 導演 AI 批次"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Video Studio Enhance Deep Actions（3 工具 + 倍率 / fps / Topaz 模型）─

function VideoStudioEnhanceDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: StudioDeepActionsCommonProps) {
  const profile = VIDEO_STUDIO_ENHANCE_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const activeModel = snapshotState?.activeModel as string | undefined;
  const hasVideo = Boolean(snapshotState?.hasVideo);
  const runActions = useOrbActionRunner(pageAgent, onClose);

  // VideoStudio 把 enhance 子模型 key 用 "upscale" / "rife" / "topaz"
  // 揭示在 snapshot.activeModel；orb 模型 id 是 "video-upscale" / "frame-interp"
  // / "topaz-enhance"，這裡做雙向對應給 active 標記用。
  const ENHANCE_MODEL_KEY_TO_ID: Record<string, string> = {
    upscale: "video-upscale",
    rife: "frame-interp",
    topaz: "topaz-enhance",
  };
  const activeOrbModelId = activeModel ? ENHANCE_MODEL_KEY_TO_ID[activeModel] : undefined;

  return (
    <div className="space-y-3">
      <OrbSpeechBubble
        text={
          hasVideo
            ? "嘿 👋 你在畫質優化頁。挑工具、設倍率，按一下就提升畫質。"
            : "嘿 👋 你在畫質優化頁。先上傳要優化的影片，我幫你選工具與倍率。"
        }
      />

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 畫質優化工具（3 種）
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {profile.models.map((m, i) => {
            const isActive = activeOrbModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(
                    `切到 ${m.label}`,
                    buildVideoStudioEnhanceSetModelActions(m.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.capabilities.map(cap => (
                      <span
                        key={cap}
                        className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                      >
                        {VIDEO_STUDIO_ENHANCE_CAPABILITY_LABELS[cap]}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ByteDance 超解析倍率 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🔍 超解析倍率（ByteDance 用）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.upscaleFactors.map(f => (
            <motion.button
              key={f.id}
              onClick={() =>
                void runActions(
                  `倍率 ${f.label}`,
                  buildVideoStudioEnhanceSetParamActions("upscaleFactor", f.value),
                  false
                )
              }
              className={cn(
                "inline-flex items-center rounded-full transition-all min-w-[3rem] justify-center",
                fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
              )}
              whileTap={{ scale: 0.95 }}
            >
              {f.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* RIFE 補幀倍率 + 目標 fps */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🌊 RIFE 補幀倍率
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.rifeMultipliers.map(m => (
            <motion.button
              key={m.id}
              onClick={() =>
                void runActions(
                  m.label,
                  buildVideoStudioEnhanceSetParamActions("multiplier", m.value),
                  false
                )
              }
              className="inline-flex items-center rounded-full transition-all border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80 px-2.5 py-1 text-[11px]"
              whileTap={{ scale: 0.95 }}
            >
              {m.label}
            </motion.button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          ⏱ RIFE 目標幀率
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.rifeFps.map(f => (
            <motion.button
              key={f.id}
              onClick={() =>
                void runActions(
                  f.label,
                  buildVideoStudioEnhanceSetParamActions("outputFps", f.value),
                  false
                )
              }
              className="inline-flex items-center rounded-full transition-all border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80 px-2.5 py-1 text-[11px]"
              whileTap={{ scale: 0.95 }}
            >
              {f.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Topaz 模型 + 輸出比例 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          💎 Topaz 模型（5 種）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.topazModels.map(m => (
            <motion.button
              key={m.id}
              onClick={() =>
                void runActions(
                  `Topaz 模型：${m.label}`,
                  buildVideoStudioEnhanceSetParamActions("topazModel", m.id),
                  false
                )
              }
              className="rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25 transition-all px-3 py-2 text-left"
              whileTap={{ scale: 0.97 }}
            >
              <p className="text-xs font-medium text-white/90">{m.label}</p>
              <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                {m.description}
              </p>
            </motion.button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          📈 Topaz 輸出比例
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.topazScales.map(s => (
            <motion.button
              key={s.id}
              onClick={() =>
                void runActions(
                  `Topaz 比例 ${s.label}`,
                  buildVideoStudioEnhanceSetParamActions("outputScale", s.value),
                  false
                )
              }
              className="inline-flex items-center rounded-full transition-all border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80 px-2.5 py-1 text-[11px]"
              whileTap={{ scale: 0.95 }}
            >
              {s.label}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出畫質優化（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
          disabled={!hasVideo}
          title={hasVideo ? "送出優化" : "先上傳要優化的影片"}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出優化
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="工具推薦 / 多工具流程 / 從歷史拉素材 / 導演 AI 批次"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// ─── Video Studio Control Deep Actions（4 工具 + 17 鏡頭 + ControlNet）────

function VideoStudioControlDeepActions({
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: StudioDeepActionsCommonProps) {
  const profile = VIDEO_STUDIO_CONTROL_PROFILE;
  const snapshotState = pageAgent.snapshot?.state;
  const activeModel = snapshotState?.activeModel as string | undefined;
  const runActions = useOrbActionRunner(pageAgent, onClose);

  const CONTROL_MODEL_KEY_TO_ID: Record<string, string> = {
    cam: "cam-master",
    ad: "animate-diff",
    depth: "depth-crafter",
    vidu: "vidu-ref",
  };
  const activeOrbModelId = activeModel ? CONTROL_MODEL_KEY_TO_ID[activeModel] : undefined;

  return (
    <div className="space-y-3">
      <OrbSpeechBubble text="嘿 👋 你在進階控制頁。挑工具、設鏡頭運動或 ControlNet，按一下就生。" />

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 進階控制工具（4 種）
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.models.map((m, i) => {
            const isActive = activeOrbModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(
                    `切到 ${m.label}`,
                    buildVideoStudioControlSetModelActions(m.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.capabilities.map(cap => (
                      <span
                        key={cap}
                        className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                      >
                        {VIDEO_STUDIO_CONTROL_CAPABILITY_LABELS[cap]}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Lightbulb className="w-3 h-3" /> 控制模板
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.templates.map((tpl, i) => (
            <motion.button
              key={tpl.id}
              onClick={() =>
                void runActions(
                  `套用「${tpl.label}」模板`,
                  buildVideoStudioControlApplyTemplateActions(tpl)
                )
              }
              className="rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25 transition-all px-3 py-2 text-left flex items-start gap-2"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileTap={{ scale: 0.97 }}
              title={tpl.prompt}
            >
              <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">{tpl.prompt}</p>
                {tpl.suggestedModelId && (
                  <p className="text-[9px] text-white/40 mt-1 truncate">
                    建議搭配：{tpl.suggestedModelId}
                  </p>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* CamMaster 17 鏡頭運動 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🎥 鏡頭運動（CamMaster 用）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {/* 變數名故意避開 `motion` 以免遮蔽 framer-motion 的 motion namespace */}
          {profile.cameraMotions.map(cam => (
            <motion.button
              key={cam.id}
              onClick={() =>
                void runActions(
                  `運鏡：${cam.label}`,
                  buildVideoStudioControlSetCameraMotionActions(cam.id),
                  false
                )
              }
              className="inline-flex items-center gap-1 rounded-full transition-all border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80 px-2 py-0.5 text-[10px]"
              whileTap={{ scale: 0.95 }}
              title={cam.id}
            >
              <span>{cam.emoji}</span>
              <span>{cam.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* AnimateDiff ControlNet */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🦴 ControlNet 條件（AnimateDiff 用）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {profile.controlNets.map(cn_ => (
            <motion.button
              key={cn_.id}
              onClick={() =>
                void runActions(
                  `ControlNet：${cn_.label}`,
                  buildVideoStudioControlSetControlNetActions(cn_.id),
                  false
                )
              }
              className="inline-flex items-center gap-1 rounded-full transition-all border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80 px-2.5 py-1 text-[11px]"
              whileTap={{ scale: 0.95 }}
              title={cn_.description}
            >
              {cn_.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* AnimateDiff 引導值預設 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
          🎯 引導值（AnimateDiff guidanceScale）
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[3, 7.5, 12].map(g => (
            <motion.button
              key={g}
              onClick={() =>
                void runActions(
                  `引導值 ${g}`,
                  buildVideoStudioControlSetParamActions("guidanceScale", g),
                  false
                )
              }
              className="inline-flex items-center rounded-full transition-all border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80 px-2.5 py-1 text-[11px]"
              whileTap={{ scale: 0.95 }}
            >
              {g}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5">
        <motion.button
          onClick={() => void runActions("送出進階控制（API）", [{ type: "submit" }])}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
            "text-emerald-50 transition-all",
            fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <Sparkles className="w-3 h-3" /> 一鍵送出
        </motion.button>
        <motion.button
          onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-xl",
            "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
            fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
          )}
          whileTap={{ scale: 0.97 }}
        >
          <RotateCcw className="w-3 h-3" /> 重設
        </motion.button>
      </div>

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="工具推薦 / 用骨骼當 ControlNet / 從圖片創作室拿圖 / 導演 AI 排運鏡"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

const VIDEO_STUDIO_PANELS: Record<
  VideoStudioTab,
  ComponentType<StudioDeepActionsCommonProps>
> = {
  t2v: VideoStudioT2VDeepActions,
  i2v: VideoStudioI2VDeepActions,
  v2v: VideoStudioV2VDeepActions,
  enhance: VideoStudioEnhanceDeepActions,
  control: VideoStudioControlDeepActions,
};

function VideoStudioDeepActionsForTab({
  tab,
  ...common
}: { tab: VideoStudioTab } & StudioDeepActionsCommonProps) {
  const Panel = VIDEO_STUDIO_PANELS[tab];
  return <Panel {...common} />;
}

// ─── Pro Studio Deep Actions（7 分頁共用同一架構） ───────────────────────
//
// 七個分頁的結構高度一致：模型卡 + 模板（部分分頁無）+ 分頁專屬參數晶片 +
// 一鍵送出 + 跨頁協作。所以走「設定驅動」的單一元件 + 一張查表，新增分頁
// 只要動 PRO_STUDIO_TAB_CONFIGS 即可，不用新增元件。

interface ProStudioTabConfig {
  profile: {
    pageId: "pro-studio";
    pagePath: "/pro-studio";
    activeTab: ProStudioTab;
    models: ProStudioGenericModel[];
    templates?: ProStudioPromptTemplate[];
    collaborations: { id: string; label: string; emoji: string; description: string; chatPrompt: string }[];
  };
  /** 分頁標題上的提示文字 */
  greeting: string;
  /** 模型卡片區塊標題 */
  modelsTitle: string;
  /** 是否顯示「一鍵送出」（avatar / clone 等需要先上傳 → 由模型自身控制） */
  showSubmit: boolean;
  submitLabel?: string;
  /**
   * 分頁專屬參數區塊：每個物件包含 title 與 chips 陣列。chips 自帶 label
   * + 點擊時要 dispatch 的動作。各分頁可以覆寫。
   */
  paramSections?: Array<{
    title: string;
    chips: Array<{ id: string; label: string; build: () => AgentAction[]; description?: string; activeWhen?: (state: Record<string, unknown> | undefined) => boolean }>;
  }>;
}

const PRO_STUDIO_TAB_CONFIGS: Record<ProStudioTab, ProStudioTabConfig> = {
  music: {
    profile: PRO_STUDIO_MUSIC_PROFILE,
    greeting: "嘿 👋 你在音樂生成。挑模型、套模板，按一下就開始作曲。",
    modelsTitle: "音樂模型（4 種）",
    showSubmit: true,
    submitLabel: "一鍵送出作曲",
    paramSections: [
      {
        title: "⏱ 時長（duration）",
        chips: PRO_STUDIO_MUSIC_PROFILE.durations.map(d => ({
          id: d.id,
          label: d.label,
          build: () => buildProStudioSetParamActions("music", "duration", d.value),
          activeWhen: state => state?.duration === d.value,
        })),
      },
      {
        title: "🎤 純音樂 / 含人聲",
        chips: [
          {
            id: "instrumental-on",
            label: "純音樂",
            build: () => buildProStudioSetParamActions("music", "instrumental", true),
            activeWhen: state => state?.isInstrumental === true,
          },
          {
            id: "instrumental-off",
            label: "含人聲",
            build: () => buildProStudioSetParamActions("music", "instrumental", false),
            activeWhen: state => state?.isInstrumental === false,
          },
        ],
      },
    ],
  },
  sfx: {
    profile: PRO_STUDIO_SFX_PROFILE,
    greeting: "嘿 👋 你在音效生成。描述要包含材質 / 距離 / 空間感，會更像真實 Foley。",
    modelsTitle: "音效模型",
    showSubmit: true,
    submitLabel: "一鍵送出音效",
    paramSections: [
      {
        title: "⏱ 時長（duration_seconds）",
        chips: PRO_STUDIO_SFX_PROFILE.durations.map(d => ({
          id: d.id,
          label: d.label,
          build: () => buildProStudioSetParamActions("sfx", "duration_seconds", d.value),
          activeWhen: state => state?.duration_seconds === d.value,
        })),
      },
    ],
  },
  tts: {
    profile: PRO_STUDIO_TTS_PROFILE,
    greeting: "嘿 👋 你在語音合成。挑引擎、貼稿件、調語速與穩定度。",
    modelsTitle: "TTS 引擎（2 種）",
    showSubmit: true,
    submitLabel: "一鍵送出語音",
    paramSections: [
      {
        title: "🚀 語速（speed）",
        chips: PRO_STUDIO_TTS_PROFILE.speedPresets.map(p => ({
          id: p.id,
          label: p.label,
          description: p.description,
          build: () => buildProStudioSetParamActions("tts", "speed", p.value),
          activeWhen: state =>
            typeof state?.speed === "number" && Math.abs((state.speed as number) - p.value) < 0.05,
        })),
      },
      {
        title: "🎚 穩定度（stability）",
        chips: PRO_STUDIO_TTS_PROFILE.stabilityPresets.map(p => ({
          id: p.id,
          label: p.label,
          description: p.description,
          build: () => buildProStudioSetParamActions("tts", "stability", p.value),
          activeWhen: state =>
            typeof state?.stability === "number" && Math.abs((state.stability as number) - p.value) < 0.05,
        })),
      },
    ],
  },
  clone: {
    profile: PRO_STUDIO_CLONE_PROFILE,
    greeting: "嘿 👋 你在聲音克隆。挑模式、上傳參考音，按一下就建立聲線。",
    modelsTitle: "克隆模式（5 種）",
    showSubmit: true,
    submitLabel: "一鍵送出克隆",
  },
  process: {
    profile: PRO_STUDIO_PROCESS_PROFILE,
    greeting: "嘿 👋 你在音訊處理。挑工具，上傳音訊，按一下就修。",
    modelsTitle: "處理工具（4 種）",
    showSubmit: true,
    submitLabel: "一鍵送出處理",
    paramSections: [
      {
        title: "🧬 Demucs 模型",
        chips: PRO_STUDIO_PROCESS_PROFILE.demucsModels.map(m => ({
          id: m.id,
          label: m.label,
          build: () => buildProStudioSetParamActions("process", "demucsModel", m.id),
        })),
      },
      {
        title: "🎚 合併策略",
        chips: PRO_STUDIO_PROCESS_PROFILE.mergeStrategies.map(s => ({
          id: s.id,
          label: s.label,
          description: s.description,
          build: () => buildProStudioSetParamActions("process", "mergeStrategy", s.id),
        })),
      },
    ],
  },
  asr: {
    profile: PRO_STUDIO_ASR_PROFILE,
    greeting: "嘿 👋 你在語音識別。上傳音訊就能轉成逐字稿與字幕。",
    modelsTitle: "ASR 工具",
    showSubmit: true,
    submitLabel: "一鍵送出辨識",
    paramSections: [
      {
        title: "⚡ 加速等級（acceleration）",
        chips: PRO_STUDIO_ASR_PROFILE.accelerations.map(a => ({
          id: a.id,
          label: a.label,
          description: a.description,
          build: () => buildProStudioSetParamActions("asr", "acceleration", a.id),
        })),
      },
    ],
  },
  avatar: {
    profile: PRO_STUDIO_AVATAR_PROFILE,
    greeting: "嘿 👋 你在 AI 形像影片。挑工具、上傳人像 + 音訊，按一下就生影片。",
    modelsTitle: "Avatar 工具（6 種）",
    showSubmit: true,
    submitLabel: "一鍵送出 Avatar",
    paramSections: [
      {
        title: "🌐 Dubbing 目標語言（targetLang）",
        chips: PRO_STUDIO_AVATAR_PROFILE.dubbingLangs.map(l => ({
          id: l.id,
          label: l.label,
          build: () => buildProStudioSetParamActions("avatar", "targetLang", l.id),
        })),
      },
    ],
  },
};

function ProStudioDeepActions({
  tab,
  fullscreen,
  pageAgent,
  onClose,
  onSendChat,
}: { tab: ProStudioTab } & StudioDeepActionsCommonProps) {
  const config = PRO_STUDIO_TAB_CONFIGS[tab];
  const profile = config.profile;
  const snapshotState = pageAgent.snapshot?.state;
  // ProStudio 透過 child bridge 把 modelId 暴露在 snapshot.modelId / activeModel
  const currentModelId =
    (snapshotState?.modelId as string | undefined) ??
    (snapshotState?.activeModel as string | undefined);
  const runActions = useOrbActionRunner(pageAgent, onClose);

  return (
    <div className="space-y-3">
      <OrbSpeechBubble text={config.greeting} />

      {/* 模型卡 */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> {config.modelsTitle}
        </p>
        <div
          className={cn(
            "gap-1.5",
            fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
          )}
        >
          {profile.models.map((m, i) => {
            const isActive = currentModelId === m.id;
            return (
              <motion.button
                key={m.id}
                onClick={() =>
                  void runActions(
                    `切到 ${m.label}`,
                    buildProStudioSetModelActions(tab, m.id),
                    false
                  )
                }
                className={cn(
                  "rounded-xl border transition-all px-3 py-2 text-left flex items-start gap-2",
                  isActive
                    ? "border-cyan-300/40 bg-cyan-300/10"
                    : "border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-base leading-none mt-0.5">{m.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate flex items-center gap-1.5">
                    {m.label}
                    {m.fast && (
                      <span className="text-[9px] uppercase tracking-wide text-amber-100/80 rounded-full bg-amber-300/20 px-1.5 py-0.5">
                        快
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[9px] uppercase tracking-wide text-cyan-100/80 rounded-full bg-cyan-300/20 px-1.5 py-0.5">
                        目前
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                    {m.description}
                  </p>
                  {m.tags && m.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {m.tags.map(t => (
                        <span
                          key={t}
                          className="text-[9px] rounded-full bg-white/8 border border-white/12 text-white/70 px-1.5 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* 模板 */}
      {profile.templates && profile.templates.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
            <Lightbulb className="w-3 h-3" /> 起手式模板
          </p>
          <div
            className={cn(
              "gap-1.5",
              fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
            )}
          >
            {profile.templates.map((tpl, i) => (
              <motion.button
                key={tpl.id}
                onClick={() =>
                  void runActions(
                    `套用「${tpl.label}」模板`,
                    buildProStudioApplyTemplateActions(tab, tpl)
                  )
                }
                className="rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25 transition-all px-3 py-2 text-left flex items-start gap-2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.97 }}
                title={tpl.prompt}
              >
                <span className="text-base leading-none mt-0.5">{tpl.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/90 truncate">{tpl.label}</p>
                  <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">{tpl.prompt}</p>
                  {tpl.suggestedModelId && (
                    <p className="text-[9px] text-white/40 mt-1 truncate">
                      建議搭配：{tpl.suggestedModelId}
                    </p>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* 分頁專屬參數晶片 */}
      {config.paramSections?.map(section => (
        <div key={section.title} className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/40 px-1">
            {section.title}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {section.chips.map(chip => {
              const isActive = chip.activeWhen?.(snapshotState);
              return (
                <motion.button
                  key={chip.id}
                  onClick={() => void runActions(chip.label, chip.build(), false)}
                  className={cn(
                    "inline-flex items-center rounded-full transition-all",
                    fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-1 text-[10px]",
                    isActive
                      ? "border border-cyan-300/40 bg-cyan-300/15 text-cyan-50"
                      : "border border-white/12 bg-white/6 hover:bg-white/14 hover:border-white/30 text-white/80"
                  )}
                  whileTap={{ scale: 0.95 }}
                  title={chip.description}
                >
                  {chip.label}
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}

      {/* 一鍵送出 + 重設 */}
      {config.showSubmit && (
        <div className="flex gap-1.5">
          <motion.button
            onClick={() =>
              void runActions(config.submitLabel ?? "送出生成", [{ type: "submit" }])
            }
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl",
              "border border-emerald-300/40 bg-emerald-300/15 hover:bg-emerald-300/25",
              "text-emerald-50 transition-all",
              fullscreen ? "py-2 text-xs" : "py-1.5 text-[11px]"
            )}
            whileTap={{ scale: 0.97 }}
          >
            <Sparkles className="w-3 h-3" /> {config.submitLabel ?? "一鍵送出"}
          </motion.button>
          <motion.button
            onClick={() => void runActions("重設此頁", [{ type: "reset" }], false)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-xl",
              "border border-white/12 bg-white/6 hover:bg-white/14 text-white/75 transition-all",
              fullscreen ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"
            )}
            whileTap={{ scale: 0.97 }}
          >
            <RotateCcw className="w-3 h-3" /> 重設
          </motion.button>
        </div>
      )}

      <StudioCollaborationLinkGrid
        fullscreen={fullscreen}
        title="提示詞 / 模型推薦 / 跨分頁串接 / 導演 AI"
        links={profile.collaborations}
        onSendChat={onSendChat}
      />
    </div>
  );
}

// 通用：渲染一組 collaboration links（給 Studio 與 ImageStudio 共用）

function StudioCollaborationLinkGrid({
  fullscreen,
  title,
  links,
  onSendChat,
}: {
  fullscreen: boolean;
  title: string;
  links: Array<{ id: string; label: string; emoji: string; description: string; chatPrompt: string }>;
  onSendChat: (prompt: string) => void | Promise<void>;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-white/40 px-1 flex items-center gap-1">
        <Wand2 className="w-3 h-3" /> {title}
      </p>
      <div
        className={cn(
          "gap-1.5",
          fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
        )}
      >
        {links.map((link, i) => (
          <motion.button
            key={link.id}
            onClick={() => void onSendChat(link.chatPrompt)}
            className={cn(
              "rounded-xl border border-white/10 bg-white/4 hover:bg-white/12 hover:border-white/25",
              "transition-all px-3 py-2 text-left flex items-start gap-2",
              "focus:outline-none focus:ring-1 focus:ring-white/30"
            )}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            whileTap={{ scale: 0.97 }}
          >
            <span className="text-base leading-none mt-0.5">{link.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white/90 truncate">{link.label}</p>
              <p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">
                {link.description}
              </p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface OrbGuidePanelProps {
  onClose: () => void;
  /** When true, renders as a full-screen bottom sheet overlay (mobile responsive) */
  fullscreen?: boolean;
  /** Callback to open the interaction panel with a specific view */
  onOpenInteraction?: (
    view: "inspiration" | "focus-flow" | "chat" | "tutorial" | "autopilot"
  ) => void;
}

const MODEL_SHORTCUTS = [
  { label: "全站模型總覽", prompt: "帶我去全站可用模型總覽，並告訴我怎麼開始。" },
  { label: "圖片模型", prompt: "帶我去圖片模型頁，幫我選一個最快可用的模型。" },
  { label: "影片模型", prompt: "帶我去影片模型頁，幫我選一個高品質模型。" },
];

export default function OrbGuidePanel({ onClose, fullscreen: fullscreenProp, onOpenInteraction }: OrbGuidePanelProps) {
  const isMobile = useIsMobile();
  const fullscreen = fullscreenProp ?? isMobile;
  const {
    step,
    intent,
    answers,
    plan,
    selectIntent,
    submitAnswer,
    confirmAndNavigate,
    reset,
    patchPlan,
    completedManualStepIds,
    toggleManualStepDone,
    dismissArrival,
  } = useOrbGuide();
  const { aiState } = useAIState();
  const { personality } = usePersonality();
  const pageAgent = usePageAgent();
  const isStudioPage = pageAgent.snapshot?.pageId === "studio";
  // 圖片創作室 5 個分頁（t2i / edit / upscale / pose / sd）各自走自己一套深度
  // 操作面板。把 5 個 boolean 收成一個有限聯集，後面路由就能用單一表達式分派，
  // 加新分頁時只要動 ImageStudioTab 與 IMAGE_STUDIO_PANELS 表，不會散落各處。
  const imageStudioTab = getImageStudioTab(pageAgent);
  const isImageStudioPage = imageStudioTab !== null;
  // 影片專業工作室 5 個分頁（t2v / i2v / v2v / enhance / control）全部接深度面板
  const videoStudioTab = getVideoStudioTab(pageAgent);
  const isVideoStudioPage = videoStudioTab !== null;
  // 音樂配音創作室 7 個分頁（music / sfx / tts / clone / process / asr / avatar）
  const proStudioTab = getProStudioTab(pageAgent);
  const isProStudioPage = proStudioTab !== null;

  // ─── Global Orb Chat Integration ──────────────────────────────────────
  const globalChat = useGlobalOrbChat();

  // 統一 collaboration row 的點擊行為：先收掉面板，再把 prompt 推進全站光球聊天
  const handleStudioCollabChat = useCallback(
    async (prompt: string) => {
      onClose();
      await globalChat.sendMessage(prompt);
      globalChat.open();
    },
    [onClose, globalChat]
  );

  // ── Panel mode: guided flow or free chat ──────────────────────────────────
  const [panelMode, setPanelMode] = useState<"guide" | "chat">("guide");
  // Use global chat state for chat mode - keep full message objects for metadata
  const chatMessages = panelMode === "chat" ? globalChat.messages : [];
  const chatSuggestions = panelMode === "chat" ? globalChat.suggestions : [];
  const chatInput = panelMode === "chat" ? globalChat.input : "";
  const setChatInput = panelMode === "chat" ? globalChat.setInput : () => {};
  const isChatLoading = panelMode === "chat" ? globalChat.isSending : false;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const {
    attachments: chatAttachments,
    isUploading: isUploadingAttachments,
    fileInputRef: chatUploadInputRef,
    pickAttachment: pickChatAttachment,
    removeAttachment: removeChatAttachment,
    clearAttachments: clearChatAttachments,
    handleFiles: handleChatAttachmentFiles,
  } = useOrbAttachments(message => toast.error(message));

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (panelMode === "chat") {
      globalChat.open(); // Sync with global chat state
      setTimeout(() => chatInputRef.current?.focus(), 100);
    }
  }, [panelMode, globalChat]);

  const handleChatSend = useCallback(async () => {
    if ((!chatInput.trim() && chatAttachments.length === 0) || isChatLoading) return;
    const userMsg = chatInput.trim();
    // Use global chat to send the message
    // GlobalOrbChatContext handles all LLM interaction, action dispatch, and message management
    await globalChat.sendMessage(userMsg, chatAttachments);
    clearChatAttachments();
  }, [chatInput, chatAttachments, isChatLoading, globalChat, clearChatAttachments]);

  // Current question index based on answers already collected
  const currentQuestionIndex = intent
    ? Object.keys(answers).length
    : 0;
  const currentQuestion = intent
    ? INTENT_CONFIGS[intent]?.questions[currentQuestionIndex]
    : null;

  // Scroll to bottom when new content appears
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [step, currentQuestionIndex]);

  // ── Phase 3d-hybrid：LLM 軟化 / 補選項 / 跳題 ──
  // 每個 step 有一個 cache key，避免重複 fire；LLM 任何失敗都 fallback 到 stock。
  const stepKey = intent
    ? step === "confirming"
      ? `${intent}:final`
      : currentQuestion
      ? `${intent}:${currentQuestion.id}`
      : null
    : null;
  const [rewriteByKey, setRewriteByKey] = useState<
    Record<string, OrbGuideStepRewrite>
  >({});
  const rewrite = stepKey ? rewriteByKey[stepKey] : undefined;
  const firedKeysRef = useRef<Set<string>>(new Set());

  const stepMutation = trpc.orbGuide.step.useMutation({
    onError: () => {
      /* stay on stock, no UX disruption */
    },
  });

  useEffect(() => {
    if (!intent || !stepKey) return;
    if (firedKeysRef.current.has(stepKey)) return;
    firedKeysRef.current.add(stepKey);

    const cfg = INTENT_CONFIGS[intent];
    if (!cfg) return;
    const answeredSoFar = Object.entries(answers).map(([qid, val]) => {
      // 找該答案在該題 options 裡對應的中文 label（幫 LLM 讀懂）
      const q = cfg.questions.find(x => x.id === qid);
      const opt = q?.options.find(o => o.value === val);
      return { questionId: qid, value: val, label: opt?.label };
    });
    const isFinalStep = step === "confirming";

    stepMutation.mutate(
      {
        intent,
        intentLabel: cfg.label,
        targetLabel: cfg.targetLabel,
        personality,
        answeredSoFar,
        currentQuestion:
          !isFinalStep && currentQuestion
            ? {
                id: currentQuestion.id,
                stockText: currentQuestion.text,
                stockOptions: currentQuestion.options,
              }
            : undefined,
        isFinalStep,
        stockOrbMessage: isFinalStep ? plan?.orbMessage : undefined,
        stockPromptHint: isFinalStep ? plan?.autoFillPrompt : undefined,
      },
      {
        onSuccess: (data: OrbGuideStepRewrite) => {
          setRewriteByKey(prev => ({ ...prev, [stepKey]: data }));
          // 收尾步驟：LLM 有改寫的話，把 plan 同步 patch 掉，讓 autoFillPrompt 真的送到目標頁
          if (isFinalStep && (data.orbMessageOverride || data.promptHintOverride)) {
            patchPlan({
              orbMessage: data.orbMessageOverride,
              autoFillPrompt: data.promptHintOverride,
            });
          }
        },
      }
    );
    // 只在 stepKey 變動時重 fire；stepMutation 來自 hook，身份會變但內部有 guard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // 清 cache：reset / 換 intent 時，清掉已發射的 key
  useEffect(() => {
    if (!intent) {
      firedKeysRef.current.clear();
      setRewriteByKey({});
    }
  }, [intent]);

  // 當前題目合併 stock + LLM 補的 options
  const mergedOptions = useMemo(() => {
    if (!currentQuestion) return [];
    const stock = currentQuestion.options;
    const extra = rewrite?.extraOptions ?? [];
    return [...stock, ...extra];
  }, [currentQuestion, rewrite]);

  // 如果 LLM 建議可跳題，露出「直接帶你走」按鈕（不自動跳）
  // 實作：用當前題目的第一個 stock option 當預設，推進到下一題/確認步驟。
  // 這樣 buildPromptHint 仍會收到合法答案值，prompt 不會壞掉。
  const canSkipNext = !!rewrite?.skipNext && !!currentQuestion;
  const handleSkipNext = () => {
    if (!currentQuestion || !currentQuestion.options.length) return;
    const defaultValue = currentQuestion.options[0].value;
    submitAnswer(currentQuestion.id, defaultValue);
  };

  // ── Intents to show (ordered for best UX) ──
  const intentOrder: Exclude<GuideIntent, null>[] = [
    "image", "video", "music", "voice", "script", "lora", "explore",
  ];

  // ── Fullscreen (mobile bottom-sheet) wrapper ──
  const panelContent = (
    <motion.div
      role="dialog"
      aria-label="光球助手引導面板"
      aria-modal={fullscreen ? "true" : undefined}
      className={cn(
        "relative flex flex-col overflow-hidden",
        fullscreen
          ? "w-full h-full rounded-t-3xl sm:rounded-3xl"
          : "w-[320px] max-h-[520px] rounded-3xl",
        "border border-white/15",
        "bg-gradient-to-b from-black/75 via-black/65 to-black/75",
        "backdrop-blur-2xl shadow-2xl shadow-black/50"
      )}
      initial={fullscreen ? { opacity: 0, y: "100%" } : { opacity: 0, scale: 0.9, y: 16 }}
      animate={fullscreen ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1, y: 0 }}
      exit={fullscreen ? { opacity: 0, y: "60%" } : { opacity: 0, scale: 0.88, y: 10 }}
      transition={fullscreen ? { type: "spring", stiffness: 300, damping: 30 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── 頂部光暈裝飾 ── */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* ── Mobile drag indicator ── */}
      {fullscreen && (
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/25" />
        </div>
      )}

      {/* ── Header ── */}
      <div className={cn(
        "flex items-center justify-between shrink-0",
        fullscreen ? "px-5 pt-3 pb-2" : "px-4 pt-4 pb-2"
      )}>
        <div className="flex items-center gap-2.5">
          <VisualSoul
            state={step === "confirming" ? "acting" : step === "ask_detail" ? "thinking" : panelMode === "chat" && isChatLoading ? "thinking" : "idle"}
            personality={personality}
            size={fullscreen ? "md" : "sm"}
          />
          <span className={cn(
            "font-medium text-white/60 tracking-wide",
            fullscreen ? "text-sm" : "text-xs"
          )}>光球助手</span>
        </div>
        <div className="flex items-center gap-1">
          {panelMode === "guide" && step !== "ask_intent" && (
            <motion.button
              type="button"
              onClick={reset}
              className={cn(
                "rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                fullscreen ? "p-2" : "p-1.5"
              )}
              whileTap={{ scale: 0.9 }}
              title="重新選擇"
              aria-label="重新選擇引導步驟"
            >
              <RotateCcw className={fullscreen ? "w-4 h-4" : "w-3.5 h-3.5"} />
            </motion.button>
          )}
          <motion.button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              fullscreen ? "p-2" : "p-1.5"
            )}
            whileTap={{ scale: 0.9 }}
            aria-label="關閉光球引導面板"
            title={fullscreen ? "收起" : "關閉"}
          >
            {fullscreen ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
          </motion.button>
        </div>
      </div>

      {/* ── Mode Tabs ── */}
      <div className={cn(
        "flex items-center gap-1 shrink-0",
        fullscreen ? "px-5 pb-3" : "px-4 pb-3"
      )}>
        <button
          type="button"
          onClick={() => setPanelMode("guide")}
          aria-pressed={panelMode === "guide"}
          aria-label="切換到引導帶路模式"
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
            fullscreen ? "py-2.5 text-sm" : "py-1.5 text-xs",
            panelMode === "guide"
              ? "bg-white/15 text-white"
              : "text-white/40 hover:text-white/70 hover:bg-white/8"
          )}
        >
          <Navigation2 className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
          引導帶路
        </button>
        <button
          type="button"
          onClick={() => setPanelMode("chat")}
          aria-pressed={panelMode === "chat"}
          aria-label="切換到自由聊天模式"
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
            fullscreen ? "py-2.5 text-sm" : "py-1.5 text-xs",
            panelMode === "chat"
              ? "bg-white/15 text-white"
              : "text-white/40 hover:text-white/70 hover:bg-white/8"
          )}
        >
          <MessageCircle className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
          自由聊天
        </button>
      </div>
      <div className={cn("shrink-0 flex flex-wrap gap-1.5", fullscreen ? "px-5 pb-2" : "px-4 pb-2")}>
        <span className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-[10px] text-white/70">
          新版引導已啟用
        </span>
        {isStudioPage && (
          <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-100">
            支援教學引導 / 一鍵帶操
          </span>
        )}
      </div>

      {/* ── Chat Mode ── */}
      {panelMode === "chat" && (
        <div className={cn(
          "flex flex-col flex-1 overflow-hidden gap-2",
          fullscreen ? "px-5 pb-4" : "px-4 pb-3"
        )}>
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-white/10">
            {chatMessages.length === 0 && (
              <OrbSpeechBubble
                text={
                  intent
                    ? `說說你想要的${INTENT_CONFIGS[intent].label}作品？隨便說幾個字就好，我來幫你規劃。`
                    : "有任何問題都可以直接問我，或是告訴我你想做什麼 ✨"
                }
              />
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={cn("flex flex-col gap-0.5", msg.role === "user" ? "items-end" : "items-start")}
              >
                <div
                  className={cn(
                    "max-w-[88%] px-3 py-2 rounded-2xl leading-relaxed",
                    fullscreen ? "text-sm" : "text-xs",
                    msg.role === "user"
                      ? "bg-white/20 text-white rounded-br-sm"
                      : "bg-white/8 text-white/85 rounded-bl-sm border border-white/10"
                  )}
                >
                  {msg.role === "orb"
                    ? <OrbMessageContent text={msg.text} compact={!fullscreen} />
                    : <p className="whitespace-pre-wrap">{msg.text}</p>}
                  {msg.attachments?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {msg.attachments.map(attachment => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2 py-1 hover:bg-white/15 transition-colors",
                            fullscreen ? "text-[11px]" : "text-[10px]"
                          )}
                        >
                          <span>{attachmentKindEmoji(attachment.kind)}</span>
                          <span className="truncate max-w-[160px]">{attachment.name}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
                {msg.pagePath && msg.at && (
                  <div className={cn(
                    "text-[9px] text-white/40 px-1 flex items-center gap-1",
                    fullscreen ? "text-[10px]" : "text-[9px]",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}>
                    <span>{getPageEmoji(msg.pagePath)}</span>
                    <span>{formatMessageMetadata(msg.pagePath, msg.at)}</span>
                  </div>
                )}
                {msg.role === "orb" && msg.actions && msg.actions.length > 0 && (
                  <div className={cn(
                    "max-w-[88%] mt-1 rounded-xl border border-white/10 bg-white/4 px-2.5 py-2 space-y-2",
                    "self-start"
                  )}>
                    <p className={cn("text-white/55", fullscreen ? "text-[11px]" : "text-[10px]")}>
                      導覽路徑圖
                    </p>
                    <ol className="space-y-1.5">
                      {msg.actions.slice(0, 4).map((action, actionIdx) => (
                        <li key={`${action.type}-${actionIdx}`} className="flex items-start gap-1.5">
                          <span className={cn(
                            "w-4 h-4 rounded-full bg-white/10 border border-white/15 text-white/70 inline-flex items-center justify-center mt-0.5",
                            "text-[9px]"
                          )}>
                            {actionIdx + 1}
                          </span>
                          <span className={cn(
                            "px-2 py-1 rounded-md bg-white/8 border border-white/10 text-white/75 flex-1",
                            fullscreen ? "text-[10px]" : "text-[9px]"
                          )}>
                            {actionToGuideLabel(action)}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.actions.some(a => a.type === "navigate") && (
                        <button
                          onClick={async () => {
                            const nav = msg.actions?.find(a => a.type === "navigate");
                            if (!nav || nav.type !== "navigate") return;
                            await pageAgent.dispatch(nav, { source: "manual" });
                          }}
                          className={cn(
                            "rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20 transition-colors px-3 py-1.5",
                            fullscreen ? "text-xs" : "text-[11px]"
                          )}
                        >
                          直接帶我去
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          await pageAgent.dispatchMany(msg.actions!.slice(0, 4), { source: "manual" });
                        }}
                        className={cn(
                          "rounded-full border border-white/20 bg-white/8 text-white/85 hover:bg-white/14 transition-colors px-3 py-1.5",
                          fullscreen ? "text-xs" : "text-[11px]"
                        )}
                      >
                        重新套用這組引導
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className={cn(
                  "px-3 py-2 rounded-2xl rounded-bl-sm bg-white/8 border border-white/10 text-white/50 flex items-center gap-1.5",
                  fullscreen ? "text-sm" : "text-xs"
                )}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  思考中…
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {chatSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 shrink-0">
              {chatSuggestions.map((suggestion, idx) => (
                <button
                  key={`${suggestion.text}-${idx}`}
                  onClick={() => void globalChat.sendMessage(suggestion.text)}
                  className={cn(
                    "rounded-full border border-white/12 bg-white/6 hover:bg-white/12",
                    "text-white/80 hover:text-white px-3 py-1.5 transition-all",
                    fullscreen ? "text-xs" : "text-[11px]"
                  )}
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          )}
          <div className="shrink-0">
            <p className={cn("text-white/40 mb-1.5", fullscreen ? "text-[11px]" : "text-[10px]")}>
              全站模型快捷入口
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MODEL_SHORTCUTS.map(shortcut => (
                <button
                  key={shortcut.label}
                  onClick={() => void globalChat.sendMessage(shortcut.prompt)}
                  className={cn(
                    "rounded-full border border-white/12 bg-white/5 hover:bg-white/12",
                    "text-white/75 hover:text-white px-3 py-1.5 transition-all",
                    fullscreen ? "text-xs" : "text-[11px]"
                  )}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </div>
          {/* Chat input */}
          <div className="shrink-0 space-y-1.5">
            {chatAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chatAttachments.map(attachment => (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => removeChatAttachment(attachment.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 hover:bg-white/15 text-white/85 transition-colors",
                      fullscreen ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]"
                    )}
                    title="移除附件"
                  >
                    <span>{attachmentKindEmoji(attachment.kind)}</span>
                    <span className="max-w-[120px] truncate">{attachment.name}</span>
                    <X className="w-3 h-3 opacity-70" />
                  </button>
                ))}
              </div>
            )}
            <input
              ref={chatUploadInputRef}
              type="file"
              accept={ORB_UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={e => {
                void handleChatAttachmentFiles(e.target.files);
              }}
            />
            <div className={cn(
              "flex items-center gap-2 bg-white/8 rounded-2xl border border-white/10",
              fullscreen ? "px-4 py-3" : "px-3 py-2"
            )}>
              <button
                type="button"
                onClick={pickChatAttachment}
                disabled={isUploadingAttachments || isChatLoading}
                title="上傳圖片 / 影片 / 音訊 / PDF"
                aria-label="上傳檔案附件"
                className={cn(
                  "rounded-lg hover:bg-white/10 disabled:opacity-30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                  fullscreen ? "p-1.5" : "p-1"
                )}
              >
                {isUploadingAttachments ? (
                  <Loader2 className={fullscreen ? "w-4 h-4 text-white/70 animate-spin" : "w-3 h-3 text-white/70 animate-spin"} />
                ) : (
                  <Paperclip className={fullscreen ? "w-4 h-4 text-white/70" : "w-3 h-3 text-white/70"} />
                )}
              </button>
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleChatSend();
                  }
                }}
                placeholder={fullscreen ? "輸入你的問題或想法…" : "說一句話就好…"}
                aria-label="輸入訊息給光球"
                className={cn(
                  "flex-1 bg-transparent text-white placeholder:text-white/30 outline-none",
                  fullscreen ? "text-sm" : "text-xs"
                )}
              />
              <button
                type="button"
                onClick={() => void handleChatSend()}
                disabled={(!chatInput.trim() && chatAttachments.length === 0) || isChatLoading || isUploadingAttachments}
                aria-label={isChatLoading ? "傳送中" : "傳送訊息"}
                title={isChatLoading ? "傳送中" : "傳送 (Enter)"}
                className={cn(
                  "rounded-lg hover:bg-white/10 disabled:opacity-30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                  fullscreen ? "p-1.5" : "p-1"
                )}
              >
                {isChatLoading
                  ? <Loader2 className={fullscreen ? "w-4 h-4 text-white/70 animate-spin" : "w-3 h-3 text-white/70 animate-spin"} />
                  : <Send className={fullscreen ? "w-4 h-4 text-white/70" : "w-3 h-3 text-white/70"} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Guide Mode (Scrollable Content) ── */}
      {panelMode === "guide" && (
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-white/10",
          fullscreen ? "px-5 pb-5" : "px-4 pb-4"
        )}
      >
        <AnimatePresence mode="wait">

          {/* ═══ STEP: ask_intent ═══ */}
          {step === "ask_intent" && (
            <motion.div
              key="ask_intent"
              className="space-y-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {!isImageStudioPage && !isVideoStudioPage && !isProStudioPage && (
                <OrbSpeechBubble
                  text={
                    isStudioPage
                      ? "嘿 👋 你已經在創作工作室。要做哪個？我幫你切到對應模態。"
                      : "嘿 👋 今天想做什麼？選一個，我帶你去。"
                  }
                />
              )}

              {imageStudioTab ? (
                <ImageStudioDeepActionsForTab
                  tab={imageStudioTab}
                  fullscreen={fullscreen}
                  pageAgent={pageAgent}
                  onClose={onClose}
                  onSendChat={handleStudioCollabChat}
                />
              ) : videoStudioTab ? (
                <VideoStudioDeepActionsForTab
                  tab={videoStudioTab}
                  fullscreen={fullscreen}
                  pageAgent={pageAgent}
                  onClose={onClose}
                  onSendChat={handleStudioCollabChat}
                />
              ) : proStudioTab ? (
                <ProStudioDeepActions
                  tab={proStudioTab}
                  fullscreen={fullscreen}
                  pageAgent={pageAgent}
                  onClose={onClose}
                  onSendChat={handleStudioCollabChat}
                />
              ) : isStudioPage ? (
                /* Studio 頁面專屬：四模態 + 細節操作 + 工具箱 + 全站協作 */
                <StudioOrbDeepActions
                  fullscreen={fullscreen}
                  pageAgent={pageAgent}
                  onClose={onClose}
                  onSendChat={handleStudioCollabChat}
                />
              ) : (
                <div
                  className={cn(
                    "gap-2 pt-1",
                    fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
                  )}
                >
                  {intentOrder.map((id, i) => (
                    <motion.div
                      key={id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <IntentCard
                        intent={id}
                        onSelect={() => selectIntent(id)}
                      />
                    </motion.div>
                  ))}
                </div>
              )}

              {/* ── Quick-access: page detail chat & focus-flow ── */}
              {onOpenInteraction && (
                <div className={cn("flex gap-2", fullscreen ? "pt-3" : "pt-2")}>
                  <motion.button
                    onClick={() => { onClose(); onOpenInteraction("chat"); }}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 rounded-xl",
                      "bg-white/6 hover:bg-white/12 border border-white/10 hover:border-white/20",
                      "transition-all text-white/60 hover:text-white/90",
                      fullscreen ? "py-2.5 text-sm" : "py-2 text-xs"
                    )}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Lightbulb className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
                    頁面細節
                  </motion.button>
                  {isStudioPage && (
                    <motion.button
                      onClick={() => { onClose(); onOpenInteraction("autopilot"); }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 rounded-xl",
                        "bg-white/6 hover:bg-white/12 border border-white/10 hover:border-white/20",
                        "transition-all text-white/60 hover:text-white/90",
                        fullscreen ? "py-2.5 text-sm" : "py-2 text-xs"
                      )}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.45 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      <FastForward className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
                      一鍵帶操
                    </motion.button>
                  )}
                  <motion.button
                    onClick={() => { onClose(); onOpenInteraction("focus-flow"); }}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 rounded-xl",
                      "bg-white/6 hover:bg-white/12 border border-white/10 hover:border-white/20",
                      "transition-all text-white/60 hover:text-white/90",
                      fullscreen ? "py-2.5 text-sm" : "py-2 text-xs"
                    )}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Leaf className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
                    專注流
                  </motion.button>
                  <motion.button
                    onClick={() => { onClose(); onOpenInteraction("tutorial"); }}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 rounded-xl",
                      "bg-white/6 hover:bg-white/12 border border-white/10 hover:border-white/20",
                      "transition-all text-white/60 hover:text-white/90",
                      fullscreen ? "py-2.5 text-sm" : "py-2 text-xs"
                    )}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Sparkles className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
                    教學引導
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}

          {/* ═══ STEP: ask_detail ═══ */}
          {step === "ask_detail" && intent && currentQuestion && (
            <motion.div
              key={`ask_detail_${currentQuestionIndex}`}
              className="space-y-3"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25 }}
            >
              {/* 顯示已選的意圖 */}
              <div className="flex items-center gap-2 px-1">
                <span className="text-lg">{INTENT_CONFIGS[intent].emoji}</span>
                <span className="text-xs text-white/50">{INTENT_CONFIGS[intent].label}</span>
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-white/30">
                  {currentQuestionIndex + 1} / {INTENT_CONFIGS[intent].questions.length}
                </span>
              </div>

              <OrbSpeechBubble
                text={rewrite?.softenedQuestion || currentQuestion.text}
              />

              <div className="space-y-2 pt-1">
                {mergedOptions.map((opt, i) => (
                  <AnswerOption
                    key={opt.value}
                    label={opt.label}
                    emoji={opt.emoji}
                    delay={i * 0.06}
                    onSelect={() => submitAnswer(currentQuestion.id, opt.value)}
                  />
                ))}

                {canSkipNext && (
                  <motion.button
                    onClick={handleSkipNext}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-xl w-full text-left",
                      "bg-white/4 hover:bg-white/10 border border-white/8 hover:border-white/20",
                      "transition-all text-xs text-white/60 hover:text-white/85"
                    )}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: mergedOptions.length * 0.06 + 0.1 }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <FastForward className="w-3 h-3" />
                    <span>光球覺得資訊夠了，直接帶你走</span>
                  </motion.button>
                )}
              </div>
            </motion.div>
          )}

          {/* ═══ STEP: confirming ═══ */}
          {step === "confirming" && plan && (
            <motion.div
              key="confirming"
              className="space-y-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* 光球說的話 */}
              <OrbSpeechBubble text={plan.orbMessage} />

              {/* 目標預覽卡 */}
              <motion.div
                className="p-4 rounded-2xl bg-white/8 border border-white/15 space-y-2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{plan.intent ? INTENT_CONFIGS[plan.intent].emoji : "✨"}</span>
                  <div>
                    <p className="text-sm font-medium text-white/90">前往 {plan.targetLabel}</p>
                    <p className="text-xs text-white/45">{plan.targetPath}</p>
                  </div>
                </div>

                {/* Phase 3e：列出到站會做的動作（setTab / fillPrompt…），讓使用者有預期 */}
                {(() => {
                  const preview = summarizeOrbGuideActions(plan.actions).filter(
                    // fillPrompt 已有自己的區塊顯示完整內容，這邊的摘要就不重覆
                    line => !line.startsWith("填入提示詞")
                  );
                  if (!preview.length) return null;
                  return (
                    <div className="pt-1 border-t border-white/8 space-y-1">
                      <p className="text-xs text-white/40">到站會幫你做</p>
                      <ul className="text-xs text-white/70 space-y-0.5 pl-1">
                        {preview.map((line, i) => (
                          <li key={i}>・{line}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {plan.autoFillPrompt && (
                  <div className="pt-1 border-t border-white/8">
                    <p className="text-xs text-white/40 mb-1">光球幫你準備的提示詞</p>
                    <p className="text-xs text-white/65 bg-white/5 rounded-xl px-3 py-2 font-mono leading-relaxed">
                      {plan.autoFillPrompt}
                    </p>
                  </div>
                )}
              </motion.div>

              {/* 確認按鈕 */}
              <motion.button
                onClick={confirmAndNavigate}
                className={cn(
                  "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl",
                  "bg-gradient-to-r from-white/20 to-white/12 hover:from-white/28 hover:to-white/18",
                  "border border-white/20 hover:border-white/35",
                  "text-sm font-medium text-white transition-all duration-200",
                  "shadow-lg shadow-black/20"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                <Sparkles className="w-4 h-4" />
                帶我去 {plan.targetLabel}
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
      )}

      {/* ── 底部光暈線 ── */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ── 底部安全區 (mobile fullscreen) ── */}
      {fullscreen && (
        <div className="shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
      )}
    </motion.div>
  );

  // ── 跳頁中／到站後：縮成緊湊卡片，不擋目標頁 ──
  // 跳頁時不關 panel（OrbGuideContext 已改），到站後切到這個緊湊版，列出
  // 已自動完成的動作（setTab / fillPrompt …由 PageAgent queue drain 自動執行）
  // 與接下來要使用者親自做的事，方便手動部分的引導完成。
  if (step === "navigating" || step === "arrived") {
    const isNavigating = step === "navigating";
    const autoLines = plan ? summarizeOrbGuideActions(plan.actions) : [];
    const manualSteps = plan?.manualSteps ?? [];
    const arrivalChoices = plan?.arrivalChoices ?? [];
    const allManualDone =
      manualSteps.length > 0 &&
      manualSteps.every(s => completedManualStepIds.includes(s.id));

    const handleArrivalChoice = async (choice: typeof arrivalChoices[number]) => {
      // 光球替使用者按下這張卡的 actions — 全部走 PageAgent bus，所以
      // 跨頁、queue 暫存、回報 feedback 都和原本的多步驟工作流共用一條路。
      // 如果裡面包含 navigate（會把使用者帶到別頁），這張 arrival 卡上
      // 列的「已自動完成 / 接下來請你做」就跟新頁面對不上了，所以
      // 強制收掉，讓新頁面如果有自己的引導再彈出來，不會疊一張舊卡。
      const hasNavigate = choice.actions.some(a => a.type === "navigate");
      await pageAgent.dispatchMany(choice.actions, { source: "manual" });
      if (choice.dismissOnSelect || hasNavigate) dismissArrival();
    };

    return (
      <motion.div
        className={cn(
          "fixed z-[71] pointer-events-auto",
          // 手機：底部置中、左右留 8px；桌機：右下小卡片
          "inset-x-2 bottom-3",
          "sm:inset-x-auto sm:right-4 sm:left-auto sm:bottom-4 sm:w-[360px]"
        )}
        initial={{ opacity: 0, y: 32, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div
          className={cn(
            "relative rounded-2xl border border-white/15 overflow-hidden",
            "bg-gradient-to-b from-black/85 via-black/75 to-black/85",
            "backdrop-blur-2xl shadow-2xl shadow-black/50"
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
            <VisualSoul
              state={isNavigating ? "thinking" : "acting"}
              personality={personality}
              size="sm"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white/90 truncate">
                {isNavigating
                  ? "正在帶你過去…"
                  : `已帶你到 ${plan?.targetLabel ?? ""}`}
              </p>
              {!isNavigating && plan?.orbMessage && (
                <p className="text-[11px] text-white/50 truncate">
                  {plan.orbMessage}
                </p>
              )}
            </div>
            <motion.button
              onClick={dismissArrival}
              className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-all shrink-0"
              whileTap={{ scale: 0.9 }}
              title="收掉引導"
            >
              <X className="w-3.5 h-3.5" />
            </motion.button>
          </div>

          {isNavigating ? (
            <div className="px-4 pb-4 flex items-center gap-2 text-xs text-white/55">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>正在自動切到對應分頁、準備好提示詞…</span>
            </div>
          ) : (
            <div className="px-4 pb-4 space-y-3">
              {autoLines.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-white/40">
                    已自動完成
                  </p>
                  <ul className="space-y-1">
                    {autoLines.map((line, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-xs text-white/75"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-300/90 shrink-0" />
                        <span className="leading-relaxed">{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {arrivalChoices.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-white/40">
                    要不要光球替你按
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {arrivalChoices.map(choice => (
                      <motion.button
                        key={choice.id}
                        type="button"
                        onClick={() => void handleArrivalChoice(choice)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        className={cn(
                          "flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-left",
                          "bg-white/8 hover:bg-white/14 border border-white/12 hover:border-white/25",
                          "transition-colors"
                        )}
                      >
                        {choice.emoji && (
                          <span className="text-base leading-none">{choice.emoji}</span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block text-[11px] font-medium text-white/90 leading-tight">
                            {choice.label}
                          </span>
                          {choice.hint && (
                            <span className="block text-[10px] text-white/50 leading-tight mt-0.5 truncate">
                              {choice.hint}
                            </span>
                          )}
                        </span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}

              {manualSteps.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase tracking-wide text-white/40">
                    接下來請你做
                  </p>
                  <ul className="space-y-1">
                    {manualSteps.map(s => {
                      const done = completedManualStepIds.includes(s.id);
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => toggleManualStepDone(s.id)}
                            className={cn(
                              "w-full flex items-start gap-2 text-left rounded-lg px-1.5 py-1 -mx-1.5 transition-colors",
                              "hover:bg-white/6"
                            )}
                          >
                            {done ? (
                              <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-300 shrink-0" />
                            ) : (
                              <Circle className="w-3.5 h-3.5 mt-0.5 text-white/40 shrink-0" />
                            )}
                            <span
                              className={cn(
                                "text-xs leading-relaxed",
                                done
                                  ? "text-white/40 line-through"
                                  : "text-white/85"
                              )}
                            >
                              {s.label}
                              {s.hint && (
                                <span className="block text-[10px] text-white/40 mt-0.5">
                                  {s.hint}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <motion.button
                onClick={dismissArrival}
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all",
                  allManualDone
                    ? "bg-emerald-400/20 hover:bg-emerald-400/30 border border-emerald-300/30 text-emerald-50"
                    : "bg-white/8 hover:bg-white/14 border border-white/12 text-white/75"
                )}
                whileTap={{ scale: 0.98 }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                {allManualDone ? "都做完了，謝謝光球" : "我自己來，先收掉"}
              </motion.button>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // ── Fullscreen: wrap in fixed overlay; Desktop: return panel directly ──
  if (fullscreen) {
    return (
      <>
        {/* Backdrop */}
        <motion.div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        {/* Bottom sheet container */}
        <div
          className="fixed inset-x-0 bottom-0 z-[71] flex flex-col"
          style={{
            maxHeight: "calc(92vh - env(safe-area-inset-top, 0px))",
          }}
        >
          {panelContent}
        </div>
      </>
    );
  }

  return panelContent;
}
