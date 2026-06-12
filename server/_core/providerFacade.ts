/**
 * providerFacade.ts — 統一供應商門面（W1-2／AIDV-11）
 *
 * 所有外部 AI 供應商的 base URL 集中在這一張路由表。任何要打供應商的
 * 程式碼（adapters、aiProxy、llmRouter、studio routers、jobs）一律從這裡
 * 解析 base URL，不再各自硬編 host——加新供應商、換網域、掛閘道都只改這裡。
 *
 * Cloudflare AI Gateway（D10 已拍板，code 端先行）：
 *   設定 CF_AI_GATEWAY_BASE_URL（形如
 *   https://gateway.ai.cloudflare.com/v1/<account>/<gateway>）後，
 *   有對應 CF slug 的供應商會改走閘道，獲得免費的快取／觀測／告警。
 *   CF 的轉發規律是「純 host 置換」：
 *     https://api.anthropic.com/v1/messages
 *       → {gateway}/anthropic/v1/messages
 *   路徑原封不動，所以呼叫端只需要換 base URL，其餘零更動。
 *
 *   未設定（現況）＝所有供應商照舊直連，行為完全不變。
 *   等 Bruce 開好 CF 帳號把變數貼進 Railway 即生效，不用改碼。
 *
 * 環境變數（皆選填；lazy 讀 process.env，測試可隨時覆寫）：
 *   CF_AI_GATEWAY_BASE_URL   閘道底址（不含供應商 slug）
 *   CF_AI_GATEWAY_TOKEN      已驗證閘道的 token（CF 後台開「Authenticated
 *                            Gateway」時必填；會以 cf-aig-authorization 標頭送出）
 *   CF_AI_GATEWAY_PROVIDERS  逗號分隔白名單（值＝本檔的 FacadeProvider 鍵；
 *                            留空＝所有支援的供應商都走閘道）。單一供應商
 *                            走閘道出問題時，用這個把它踢回直連。
 */

export type FacadeProvider =
  | "fal_ai"
  | "fal_queue"
  | "gemini"
  | "elevenlabs"
  | "suno"
  | "openrouter"
  | "anthropic"
  | "perplexity";

interface ProviderRoute {
  /** 直連 base URL（scheme + host［+ 路徑前綴］，結尾不帶斜線）。 */
  directBaseUrl: string;
  /**
   * Cloudflare AI Gateway 的供應商 slug；null＝CF 不支援，永遠直連。
   * slug 對照 CF 文件的 provider endpoints（google-ai-studio、elevenlabs、
   * anthropic、openrouter、perplexity-ai…）。fal 與 suno（第三方代理
   * sunoapi.org）目前都不在 CF 支援清單。
   */
  cfGatewaySlug: string | null;
}

const PROVIDER_ROUTES: Record<FacadeProvider, ProviderRoute> = {
  fal_ai: { directBaseUrl: "https://fal.run", cfGatewaySlug: null },
  fal_queue: { directBaseUrl: "https://queue.fal.run", cfGatewaySlug: null },
  gemini: {
    directBaseUrl: "https://generativelanguage.googleapis.com",
    cfGatewaySlug: "google-ai-studio",
  },
  elevenlabs: {
    directBaseUrl: "https://api.elevenlabs.io",
    cfGatewaySlug: "elevenlabs",
  },
  suno: { directBaseUrl: "https://api.sunoapi.org", cfGatewaySlug: null },
  openrouter: {
    directBaseUrl: "https://openrouter.ai/api/v1",
    cfGatewaySlug: "openrouter",
  },
  anthropic: {
    directBaseUrl: "https://api.anthropic.com",
    cfGatewaySlug: "anthropic",
  },
  perplexity: {
    directBaseUrl: "https://api.perplexity.ai",
    cfGatewaySlug: "perplexity-ai",
  },
};

/**
 * fal 的兩個底址沒有 CF slug、永遠直連，提供成常數方便 studio routers /
 * dispatcher 以單一來源取用（之前 6 個檔案各自硬編了一份）。
 */
export const FAL_RUN_BASE = PROVIDER_ROUTES.fal_ai.directBaseUrl;
export const FAL_QUEUE_BASE = PROVIDER_ROUTES.fal_queue.directBaseUrl;

function gatewayBaseUrl(): string {
  return (process.env.CF_AI_GATEWAY_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function gatewayAllowlist(): Set<string> | null {
  const raw = (process.env.CF_AI_GATEWAY_PROVIDERS ?? "").trim();
  if (!raw) return null; // null＝不設限（所有支援的都走閘道）
  return new Set(
    raw
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );
}

/** 這個供應商目前是否會經由 CF AI Gateway 轉送。 */
export function isRoutedViaGateway(provider: FacadeProvider): boolean {
  const route = PROVIDER_ROUTES[provider];
  if (!route.cfGatewaySlug) return false;
  if (!gatewayBaseUrl()) return false;
  const allow = gatewayAllowlist();
  if (allow && !allow.has(provider)) return false;
  return true;
}

/**
 * 解析供應商目前生效的 base URL（結尾不帶斜線）。
 *
 * @param explicitBase 呼叫端已有的自訂 base（例如 OPENROUTER_BASE_URL）。
 *   若與預設直連底址不同，視為操作者的明確覆寫，優先於閘道。
 */
export function resolveProviderBaseUrl(
  provider: FacadeProvider,
  explicitBase?: string
): string {
  const route = PROVIDER_ROUTES[provider];
  const explicit = explicitBase?.trim().replace(/\/+$/, "");
  if (explicit && explicit !== route.directBaseUrl) return explicit;
  if (!isRoutedViaGateway(provider)) return explicit || route.directBaseUrl;
  return `${gatewayBaseUrl()}/${route.cfGatewaySlug}`;
}

/**
 * 走閘道時需要附加的標頭（已驗證閘道的 cf-aig-authorization）。
 * 直連或未設 token 時回空物件——呼叫端可以無腦 spread。
 */
export function providerGatewayHeaders(
  provider: FacadeProvider
): Record<string, string> {
  if (!isRoutedViaGateway(provider)) return {};
  const token = (process.env.CF_AI_GATEWAY_TOKEN ?? "").trim();
  if (!token) return {};
  return { "cf-aig-authorization": `Bearer ${token}` };
}

/**
 * LLM 引擎名 → 門面供應商鍵的對照（llm.ts／llmRouter.ts 用）。
 * vertex／nvidia／forge 沒有 CF slug 或 URL 結構特殊，維持直連回 null。
 */
export function engineGatewayProvider(engine: string): FacadeProvider | null {
  switch (engine) {
    case "openrouter":
      return "openrouter";
    case "anthropic":
      return "anthropic";
    case "gemini":
      return "gemini";
    case "perplexity":
      return "perplexity";
    default:
      return null;
  }
}
