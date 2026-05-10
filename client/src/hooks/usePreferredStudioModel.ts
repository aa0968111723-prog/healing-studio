/**
 * usePreferredStudioModel.ts
 *
 * React hook that returns the user's most-picked model for a given studio
 * modality, drawn from the shared `agent_model_picks` table. Used by every
 * surface that fires `dispatchToStudio` so the destination studio opens with
 * the engine the user actually prefers — instead of falling back to whatever
 * default each surface had hardcoded.
 *
 * Always returns gracefully:
 *   - logged-out users: `{ modelId: null, isLoading: false }`
 *   - DB / network failure: `{ modelId: null }` (never throws)
 *   - cold start (no picks yet): `{ modelId: null }` so the caller can keep
 *     its own default fallback.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

export interface UsePreferredStudioModelResult {
  /** The leading modelId for this modality, or null if unknown. */
  modelId: string | null;
  /** True while the underlying query is in flight on first mount. */
  isLoading: boolean;
  /** Top-N entries with pick counts — handy for showing "why this default". */
  entries: ReadonlyArray<{
    modelId: string;
    pickCount: number;
    acceptedCount: number;
  }>;
}

const STALE_TIME_MS = 60_000;

export function usePreferredStudioModel(
  modality: string | undefined,
  options?: { enabled?: boolean; topK?: number }
): UsePreferredStudioModelResult {
  const meQuery = trpc.auth.me.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const isAuthenticated = Boolean(meQuery.data);

  const enabled =
    (options?.enabled ?? true) &&
    isAuthenticated &&
    typeof modality === "string" &&
    modality.length > 0;

  const query = trpc.agentModelPicks.getPreferredForModality.useQuery(
    {
      modality: modality ?? "",
      topK: options?.topK ?? 3,
    },
    {
      enabled,
      staleTime: STALE_TIME_MS,
      refetchOnWindowFocus: false,
    }
  );

  return useMemo(() => {
    const entries = query.data?.entries ?? [];
    return {
      modelId: entries[0]?.modelId ?? null,
      isLoading: query.isLoading && enabled,
      entries: entries.map(e => ({
        modelId: e.modelId,
        pickCount: e.pickCount,
        acceptedCount: e.acceptedCount,
      })),
    };
  }, [query.data, query.isLoading, enabled]);
}
