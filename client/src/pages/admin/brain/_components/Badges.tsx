/**
 * Health / tier / provider badges used across all 7 tabs.
 * Extracted from `pages/AiBrainSettings.tsx` (Stage G consolidation).
 */
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { HealthState, HealthStatus } from "../_shared";

// ─── HealthDot ────────────────────────────────────────────────────────────

export function HealthDot({
  model,
  health,
}: {
  model: string;
  health: HealthStatus | undefined;
}) {
  const status = health?.[model];
  const state: HealthState =
    status?.state ?? (status ? "healthy" : "unverified");
  const failures = status?.consecutiveFailures ?? 0;

  let color: string;
  let label: string;
  let pulseClass: string;

  if (state === "unhealthy") {
    color = "bg-red-500";
    label = "Offline";
    pulseClass = "";
  } else if (state === "unverified") {
    color = "bg-slate-400";
    label = "未驗證";
    pulseClass = "animate-pulse";
  } else if (failures > 0) {
    color = "bg-amber-500";
    label = "Degraded";
    pulseClass = "animate-pulse";
  } else {
    color = "bg-emerald-500";
    label = "已驗證";
    pulseClass = "";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex items-center">
          <span className={`w-2.5 h-2.5 rounded-full ${color} ${pulseClass}`} />
          {state === "healthy" && failures === 0 && (
            <span
              className={`absolute w-2.5 h-2.5 rounded-full ${color} animate-ping opacity-40`}
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className="font-medium">{label}</p>
        {status?.lastError && (
          <p className="text-muted-foreground mt-0.5 max-w-48 truncate">
            {status.lastError}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── TierBadge ────────────────────────────────────────────────────────────

export function TierBadge({ tier }: { tier: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    premium: {
      className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      label: "Premium",
    },
    standard: {
      className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      label: "Standard",
    },
    fast: {
      className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      label: "Fast",
    },
  };
  const v = variants[tier] ?? variants.standard;
  return (
    <Badge
      variant="outline"
      className={`text-[9px] px-1.5 py-0 ${v.className}`}
    >
      {v.label}
    </Badge>
  );
}

// ─── ProviderBadge ────────────────────────────────────────────────────────

export function ProviderBadge({ value }: { value: string }) {
  let provider = "";
  let className = "";
  if (value.startsWith("fal-ai/") || value.startsWith("fal/")) {
    provider = "Fal.ai";
    className = "bg-violet-500/10 text-violet-600 border-violet-500/20";
  } else if (
    value.startsWith("gemini/") ||
    value.startsWith("imagen") ||
    value.startsWith("veo") ||
    value.startsWith("lyria") ||
    value.startsWith("gemini-")
  ) {
    provider = "Gemini";
    className = "bg-blue-500/10 text-blue-600 border-blue-500/20";
  } else if (value.startsWith("vertex/")) {
    provider = "Vertex";
    className = "bg-cyan-500/10 text-cyan-600 border-cyan-500/20";
  } else if (value.startsWith("elevenlabs/") || value.startsWith("eleven_")) {
    provider = "ElevenLabs";
    className = "bg-purple-500/10 text-purple-600 border-purple-500/20";
  } else if (value.startsWith("suno")) {
    provider = "Suno";
    className = "bg-green-500/10 text-green-600 border-green-500/20";
  }
  if (!provider) return null;
  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${className}`}>
      {provider}
    </Badge>
  );
}
