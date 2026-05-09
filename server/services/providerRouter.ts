import { createHash } from "node:crypto";
import { getProviderHealth, type ProviderHealthStatus } from "./providerHealth";

export type ProviderKind = "llm" | "image" | "video" | "audio" | "voice" | "code" | "deploy";
export type ProviderCostTier = "free" | "low" | "medium" | "high" | "unknown";

export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  enabled: boolean;
  priority: number;
  supportsMultimodal: boolean;
  supportsImage: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsPdf: boolean;
  maxInputSize: number;
  timeoutMs: number;
  retryBudget: number;
  estimatedCostTier: ProviderCostTier;
  requiredEnvKeys: string[];
  fallbackProviderIds: string[];
}

export type ProviderRouteIntent =
  | "planner_text"
  | "planner_multimodal"
  | "planner_pdf"
  | "code_task"
  | "deploy"
  | "generate_image"
  | "generate_video"
  | "generate_audio"
  | "voice_tts"
  | "music"
  | "default";

export interface ProviderRouteInput {
  intent: ProviderRouteIntent;
  riskLevel?: "low" | "medium" | "high";
  requiresCodeWrite?: boolean;
  preferredProviderId?: string;
}

export interface ProviderSelection {
  provider: ProviderConfig | null;
  fallbackChain: ProviderConfig[];
  reason: string;
  plannerStatus?: "provider_unavailable";
}

const TRUE_SET = new Set(["1", "true", "yes", "on", "enabled"]);

function flag(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return TRUE_SET.has(raw.toLowerCase());
}

function hasRequiredEnvKeys(keys: string[]) {
  if (!keys.length) return true;
  return keys.every(key => String(process.env[key] ?? "").trim().length > 0);
}

export function getProviderCatalog(): ProviderConfig[] {
  return [
    {
      id: "gemini",
      label: "Google Gemini",
      kind: "llm",
      enabled: true,
      priority: 10,
      supportsMultimodal: true,
      supportsImage: true,
      supportsAudio: true,
      supportsVideo: true,
      supportsPdf: true,
      maxInputSize: 40 * 1024 * 1024,
      timeoutMs: 20_000,
      retryBudget: 1,
      estimatedCostTier: "medium",
      requiredEnvKeys: ["GEMINI_API_KEY"],
      fallbackProviderIds: ["default_llm", "minimax"],
    },
    {
      id: "default_llm",
      label: "Default LLM",
      kind: "llm",
      enabled: true,
      priority: 50,
      supportsMultimodal: false,
      supportsImage: false,
      supportsAudio: false,
      supportsVideo: false,
      supportsPdf: false,
      maxInputSize: 6 * 1024 * 1024,
      timeoutMs: 18_000,
      retryBudget: 1,
      estimatedCostTier: "low",
      requiredEnvKeys: [],
      fallbackProviderIds: ["gemini", "minimax"],
    },
    {
      id: "claudeCode",
      label: "Claude Code",
      kind: "code",
      enabled: flag("ENABLE_CLAUDE_CODE_TASKS", true),
      priority: 10,
      supportsMultimodal: false,
      supportsImage: false,
      supportsAudio: false,
      supportsVideo: false,
      supportsPdf: false,
      maxInputSize: 2 * 1024 * 1024,
      timeoutMs: 30_000,
      retryBudget: 1,
      estimatedCostTier: "high",
      requiredEnvKeys: [],
      fallbackProviderIds: ["codex"],
    },
    {
      id: "codex",
      label: "OpenAI Codex",
      kind: "code",
      enabled: flag("ENABLE_CODEX_TASKS", false),
      priority: 20,
      supportsMultimodal: false,
      supportsImage: false,
      supportsAudio: false,
      supportsVideo: false,
      supportsPdf: false,
      maxInputSize: 2 * 1024 * 1024,
      timeoutMs: 30_000,
      retryBudget: 1,
      estimatedCostTier: "high",
      requiredEnvKeys: [],
      fallbackProviderIds: ["claudeCode"],
    },
    {
      id: "fal",
      label: "FAL",
      kind: "image",
      enabled: true,
      priority: 10,
      supportsMultimodal: false,
      supportsImage: true,
      supportsAudio: false,
      supportsVideo: true,
      supportsPdf: false,
      maxInputSize: 25 * 1024 * 1024,
      timeoutMs: 45_000,
      retryBudget: 1,
      estimatedCostTier: "high",
      requiredEnvKeys: ["FAL_KEY"],
      fallbackProviderIds: ["gemini"],
    },
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      kind: "voice",
      enabled: true,
      priority: 10,
      supportsMultimodal: false,
      supportsImage: false,
      supportsAudio: true,
      supportsVideo: false,
      supportsPdf: false,
      maxInputSize: 12 * 1024 * 1024,
      timeoutMs: 30_000,
      retryBudget: 1,
      estimatedCostTier: "medium",
      requiredEnvKeys: ["ELEVENLABS_API_KEY"],
      fallbackProviderIds: ["default_llm"],
    },
    {
      id: "suno",
      label: "Suno",
      kind: "audio",
      enabled: true,
      priority: 10,
      supportsMultimodal: false,
      supportsImage: false,
      supportsAudio: true,
      supportsVideo: false,
      supportsPdf: false,
      maxInputSize: 10 * 1024 * 1024,
      timeoutMs: 40_000,
      retryBudget: 0,
      estimatedCostTier: "high",
      requiredEnvKeys: ["SUNO_API_KEY"],
      fallbackProviderIds: ["default_llm"],
    },
    {
      id: "minimax",
      label: "MiniMax",
      kind: "llm",
      enabled: true,
      priority: 30,
      supportsMultimodal: false,
      supportsImage: false,
      supportsAudio: false,
      supportsVideo: false,
      supportsPdf: false,
      maxInputSize: 8 * 1024 * 1024,
      timeoutMs: 18_000,
      retryBudget: 1,
      estimatedCostTier: "low",
      requiredEnvKeys: ["NVIDIA_API"],
      fallbackProviderIds: ["default_llm"],
    },
    {
      id: "disabled",
      label: "Disabled Provider",
      kind: "llm",
      enabled: false,
      priority: 999,
      supportsMultimodal: false,
      supportsImage: false,
      supportsAudio: false,
      supportsVideo: false,
      supportsPdf: false,
      maxInputSize: 0,
      timeoutMs: 5_000,
      retryBudget: 0,
      estimatedCostTier: "unknown",
      requiredEnvKeys: [],
      fallbackProviderIds: [],
    },
  ];
}

function desiredProviderIds(input: ProviderRouteInput): string[] {
  if (input.preferredProviderId) return [input.preferredProviderId];
  switch (input.intent) {
    case "planner_multimodal":
    case "planner_pdf":
      return ["gemini", "default_llm"];
    case "planner_text":
      return input.riskLevel === "low" ? ["default_llm", "gemini", "minimax"] : ["gemini", "default_llm"];
    case "code_task":
      return ["claudeCode", "codex"];
    case "deploy":
      return ["claudeCode", "codex"];
    case "generate_image":
      return ["fal", "gemini"];
    case "generate_video":
      return ["fal", "gemini"];
    case "generate_audio":
      return ["suno", "default_llm"];
    case "voice_tts":
      return ["elevenlabs", "default_llm"];
    case "music":
      return ["suno", "default_llm"];
    default:
      return ["default_llm", "gemini", "minimax"];
  }
}

function providerSupportsIntent(provider: ProviderConfig, intent: ProviderRouteIntent): boolean {
  switch (intent) {
    case "planner_multimodal":
      // Must be a real multimodal-capable provider — `kind === "llm"` is NOT
      // enough. The previous escape hatch let `default_llm` (which has
      // supportsMultimodal=false and supportsImage/Audio/Video=false) win
      // selection when Gemini was unhealthy, then receive image_url /
      // file_url parts it can't decode.
      return provider.supportsMultimodal;
    case "planner_pdf":
      return provider.supportsPdf || provider.supportsMultimodal;
    case "generate_image":
      return provider.supportsImage;
    case "generate_video":
      return provider.supportsVideo;
    case "generate_audio":
    case "music":
      return provider.supportsAudio;
    case "voice_tts":
      return provider.kind === "voice" || provider.supportsAudio;
    case "code_task":
    case "deploy":
      return provider.kind === "code" || provider.kind === "deploy";
    default:
      return true;
  }
}

export function getProviderStatus(provider: ProviderConfig): ProviderHealthStatus {
  if (!provider.enabled) return "disabled";
  if (!hasRequiredEnvKeys(provider.requiredEnvKeys)) return "missing_key";
  const status = getProviderHealth(provider.id).status;
  return status;
}

function buildFallbackChain(provider: ProviderConfig, catalogById: Map<string, ProviderConfig>) {
  return provider.fallbackProviderIds
    .map(id => catalogById.get(id))
    .filter((entry): entry is ProviderConfig => Boolean(entry));
}

export function selectProvider(input: ProviderRouteInput, catalog = getProviderCatalog()): ProviderSelection {
  const catalogById = new Map(catalog.map(provider => [provider.id, provider]));
  const candidates = desiredProviderIds(input)
    .map(id => catalogById.get(id))
    .filter((entry): entry is ProviderConfig => Boolean(entry))
    .filter(entry => providerSupportsIntent(entry, input.intent));

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const status = getProviderStatus(candidate);
    if (status === "healthy") {
      return {
        provider: candidate,
        fallbackChain: buildFallbackChain(candidate, catalogById),
        reason: index === 0 ? `selected:${candidate.id}` : `fallback:${candidates[0]?.id}->${candidate.id}`,
      };
    }
  }

  for (const candidate of candidates) {
    const fallbacks = buildFallbackChain(candidate, catalogById);
    const healthyFallback = fallbacks.find(
      fallback =>
        providerSupportsIntent(fallback, input.intent) &&
        getProviderStatus(fallback) === "healthy"
    );
    if (healthyFallback) {
      return {
        provider: healthyFallback,
        fallbackChain: fallbacks,
        reason: `fallback:${candidate.id}->${healthyFallback.id}`,
      };
    }
  }

  return {
    provider: null,
    fallbackChain: [],
    reason: "provider_unavailable",
    plannerStatus: "provider_unavailable",
  };
}

export function hashIntentSignature(input: {
  userId?: number;
  sessionId?: string;
  text: string;
  attachmentUrls?: string[];
}): string {
  const normalized = input.text.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 2000);
  const attach = (input.attachmentUrls ?? []).map(url => url.trim()).sort().join("|");
  return createHash("sha256")
    .update(`${input.userId ?? "anon"}|${input.sessionId ?? "none"}|${normalized}|${attach}`)
    .digest("hex");
}
