/**
 * researchLaunch.ts — One-click "send this topic to a deep-research engine".
 *
 * Currently launches Perplexity (with their public `?q=` deep-link, no API
 * keys required), and exposes a small registry so future engines can be added
 * without touching the call sites.
 */

export type ResearchEngineId = "perplexity" | "google" | "google-scholar";

export interface ResearchEngine {
  id: ResearchEngineId;
  label: string;
  /** Build the URL the user is sent to. */
  url: (query: string) => string;
}

export const RESEARCH_ENGINES: ResearchEngine[] = [
  {
    id: "perplexity",
    label: "Perplexity 深度研究",
    url: q => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "google",
    label: "Google 一般搜尋",
    url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "google-scholar",
    label: "Google Scholar 學術搜尋",
    url: q => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`,
  },
];

/**
 * Open a deep-research engine in a new tab. Returns false if the popup was
 * blocked so callers can show a fallback.
 */
export function launchResearch(
  query: string,
  engineId: ResearchEngineId = "perplexity"
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const engine =
    RESEARCH_ENGINES.find(e => e.id === engineId) ?? RESEARCH_ENGINES[0];
  const win = window.open(engine.url(trimmed), "_blank", "noopener,noreferrer");
  return !!win;
}
