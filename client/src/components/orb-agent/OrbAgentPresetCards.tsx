/**
 * OrbAgentPresetCards.tsx — Bulk-set agent preference profiles.
 *
 * The settings page has 11 tabs of toggles; new users (and the
 * occasional power user) just want to hit a vibe and walk away. This
 * surfaces 4 prebaked profiles that flip the most-impactful fields all
 * at once via the existing `agentPreferences.updatePreferences`
 * mutation — same path the per-tab inputs use, so anything saved here
 * is visible (and editable) in the deeper tabs afterwards.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Leaf, Rocket, Shield, Sparkles, type LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  DEFAULT_AGENT_PREFERENCES,
  type AgentConfirmationPolicy,
} from "@shared/agent-preferences";

interface AgentPresetPatch {
  confirmationPolicy: AgentConfirmationPolicy;
  voiceEnabled: boolean;
  orbProactiveSuggestions: boolean;
  orbShortcutEnabled: boolean;
  maxAutoStepsPerTask: number;
  perceptionEnabled?: boolean;
  perceptionStrictness?: "lenient" | "balanced" | "strict";
  criticEnabled?: boolean;
}

interface AgentPreset {
  id: "calm" | "assistant" | "auto" | "sandbox";
  title: string;
  description: string;
  icon: LucideIcon;
  /** TailwindCSS gradient classes for the preset card background. */
  gradient: string;
  /** Border + accent text color when selected. */
  accent: string;
  patch: AgentPresetPatch;
  badges: string[];
}

export const ORB_AGENT_PRESETS: AgentPreset[] = [
  {
    id: "calm",
    title: "療癒陪伴",
    description: "光球只回覆文字、不主動執行任何動作。最安靜，適合靈感期。",
    icon: Leaf,
    gradient: "from-emerald-50 via-emerald-50/60 to-teal-50",
    accent: "border-emerald-300/70 ring-emerald-300/50",
    patch: {
      confirmationPolicy: "manual",
      voiceEnabled: false,
      orbProactiveSuggestions: false,
      orbShortcutEnabled: true,
      maxAutoStepsPerTask: 1,
      perceptionEnabled: false,
      criticEnabled: false,
    },
    badges: ["不執行動作", "純對話", "極度安靜"],
  },
  {
    id: "assistant",
    title: "貼身助理",
    description: "安全動作自動做，破壞性動作（送出 / 重置 / 跨頁工作流）會先彈確認。最常用。",
    icon: Sparkles,
    gradient: "from-amber-50 via-yellow-50/60 to-amber-50",
    accent: "border-amber-300/70 ring-amber-300/50",
    patch: {
      confirmationPolicy: "confirm_high_risk",
      voiceEnabled: true,
      orbProactiveSuggestions: true,
      orbShortcutEnabled: true,
      maxAutoStepsPerTask: 5,
      perceptionEnabled: true,
      perceptionStrictness: "balanced",
      criticEnabled: true,
    },
    badges: ["半自動", "破壞性先確認", "推薦"],
  },
  {
    id: "auto",
    title: "全自動代理",
    description: "信任光球，多步驟工作流自動跑完。submit / reset 仍會問。",
    icon: Rocket,
    gradient: "from-violet-50 via-indigo-50/60 to-violet-50",
    accent: "border-violet-300/70 ring-violet-300/50",
    patch: {
      confirmationPolicy: "always_approve",
      voiceEnabled: true,
      orbProactiveSuggestions: true,
      orbShortcutEnabled: true,
      maxAutoStepsPerTask: 10,
      perceptionEnabled: true,
      perceptionStrictness: "lenient",
      criticEnabled: false,
    },
    badges: ["全自動", "工作流跑滿", "最快"],
  },
  {
    id: "sandbox",
    title: "測試模式",
    description: "全部動作必經人工確認；適合熟悉新功能或除錯。",
    icon: Shield,
    gradient: "from-rose-50 via-pink-50/60 to-rose-50",
    accent: "border-rose-300/70 ring-rose-300/50",
    patch: {
      confirmationPolicy: "confirm_all",
      voiceEnabled: false,
      orbProactiveSuggestions: false,
      orbShortcutEnabled: true,
      maxAutoStepsPerTask: 3,
      perceptionEnabled: true,
      perceptionStrictness: "strict",
      criticEnabled: true,
    },
    badges: ["每步確認", "嚴格感知", "除錯用"],
  },
];

interface CurrentAgentPrefsLike {
  confirmationPolicy?: AgentConfirmationPolicy | null;
  voiceEnabled?: boolean | null;
  orbProactiveSuggestions?: boolean | null;
  orbShortcutEnabled?: boolean | null;
  maxAutoStepsPerTask?: number | null;
  perceptionEnabled?: boolean | null;
  perceptionStrictness?: "lenient" | "balanced" | "strict" | null;
  criticEnabled?: boolean | null;
}

/**
 * Decide which preset (if any) currently matches the saved prefs. Used
 * to highlight the active card. Pure helper exported for unit tests.
 */
export function detectActivePreset(
  prefs: CurrentAgentPrefsLike | null | undefined
): AgentPreset["id"] | null {
  if (!prefs) return null;
  for (const preset of ORB_AGENT_PRESETS) {
    const p = preset.patch;
    if (
      prefs.confirmationPolicy === p.confirmationPolicy &&
      Boolean(prefs.voiceEnabled) === p.voiceEnabled &&
      Boolean(prefs.orbProactiveSuggestions) === p.orbProactiveSuggestions &&
      (prefs.maxAutoStepsPerTask ?? DEFAULT_AGENT_PREFERENCES.maxAutoStepsPerTask) ===
        p.maxAutoStepsPerTask
    ) {
      return preset.id;
    }
  }
  return null;
}

interface Props {
  /** Currently-saved prefs from the parent query. */
  current?: CurrentAgentPrefsLike | null;
  /** Optional callback after successful update — parent can refetch + toast. */
  onApplied?: (presetId: AgentPreset["id"]) => void;
}

export default function OrbAgentPresetCards({ current, onApplied }: Props) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.agentPreferences.updatePreferences.useMutation({
    onSuccess: () => {
      void utils.agentPreferences.getPreferences.invalidate();
    },
    onError: err => toast.error(`套用預設失敗：${err.message}`),
  });

  const activeId = useMemo(() => detectActivePreset(current), [current]);

  const apply = (preset: AgentPreset) => {
    updateMutation.mutate(preset.patch, {
      onSuccess: () => {
        toast.success(`已套用「${preset.title}」`);
        onApplied?.(preset.id);
      },
    });
  };

  return (
    <div
      data-testid="orb-agent-preset-cards"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5"
    >
      {ORB_AGENT_PRESETS.map((preset, idx) => {
        const Icon = preset.icon;
        const isActive = activeId === preset.id;
        const disabled = updateMutation.isPending;
        return (
          <motion.button
            key={preset.id}
            type="button"
            data-testid={`orb-agent-preset-${preset.id}`}
            data-active={isActive}
            onClick={() => apply(preset)}
            disabled={disabled}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * idx, type: "spring", stiffness: 300, damping: 24 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3 text-left transition disabled:opacity-50 ${
              preset.gradient
            } ${
              isActive
                ? `${preset.accent} ring-2 shadow-md`
                : "border-border/70 hover:border-border"
            }`}
          >
            {isActive ? (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-foreground/90">
                ✓ 使用中
              </span>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-card/60 backdrop-blur-sm text-foreground/90">
                <Icon className="w-4 h-4" />
              </span>
              <span className="text-sm font-semibold text-foreground">{preset.title}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground line-clamp-3">
              {preset.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {preset.badges.map(badge => (
                <span
                  key={badge}
                  className="inline-flex items-center rounded-full bg-card/70 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                >
                  {badge}
                </span>
              ))}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
