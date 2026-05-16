/**
 * aiModelsCatalog.ts — client-side re-export of the shared catalog.
 *
 * The canonical source lives in `shared/aiModelsCatalog.ts` so that the
 * server-side researcher / cron / tRPC router can use the same types and
 * baseline data as the AI Models Hub UI.
 *
 * Anything imported here continues to work for existing UI code paths.
 */

export type {
  AIModelEntry,
  EnrichedAIModelEntry,
  ModelModality,
  ModelProvider,
  ModelTier,
  PricingTier,
  FactCheckStatus,
  ModelPricing,
  BenchmarkScore,
  ModelUpdate,
  FactCheckSource,
  ModelAvailability,
  FactCheckMeta,
  LatencyClass,
  SafetyTier,
  ComplianceTag,
  ModelCapabilities,
} from "../../../shared/aiModelsCatalog";

export {
  AI_MODELS_CATALOG,
  PROVIDER_STYLE,
  MODALITY_STYLE,
  TIER_STYLE,
  PRICING_TIER_STYLE,
  FACT_CHECK_STATUS_STYLE,
  FACT_CHECK_STALE_DAYS,
  getUniqueProviders,
  getModelCountByModality,
  getFeaturedModels,
  sortByLatest,
  computeFactCheckStatus,
  mergeEnrichment,
} from "../../../shared/aiModelsCatalog";
