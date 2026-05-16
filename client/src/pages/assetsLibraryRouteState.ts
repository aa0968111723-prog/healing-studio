export type AssetsLibrarySectionId =
  | "assets"
  | "prompts"
  | "vault"
  | "tasks"
  | "drive";

export type AssetsLibraryViewMode = "cards" | "history";
export type AssetsLibraryTab = "my" | "team";

const SECTION_IDS: AssetsLibrarySectionId[] = [
  "assets",
  "prompts",
  "vault",
  "tasks",
  "drive",
];

const LEGACY_HISTORY_SECTION = "history";
const LEGACY_SHARED_SECTION = "shared";

function isAssetsLibrarySectionId(
  value: string | null,
): value is AssetsLibrarySectionId {
  return value !== null && SECTION_IDS.includes(value as AssetsLibrarySectionId);
}

export function resolveAssetsLibraryRouteState(search: string) {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const rawSection = params.get("section");
  const rawView = params.get("view");
  const rawTab = params.get("tab");

  const section = isAssetsLibrarySectionId(rawSection)
    ? rawSection
    : "assets";

  const viewMode: AssetsLibraryViewMode =
    rawView === "history" || rawView === "cards"
      ? rawView
      // Legacy /assets?section=history links stay on the assets section but
      // open the timeline view.
      : rawSection === LEGACY_HISTORY_SECTION
        ? "history"
        : "cards";

  const tab: AssetsLibraryTab =
    rawTab === "team" || rawTab === "my"
      ? rawTab
      // Legacy /assets?section=shared links stay on the assets section but
      // open the team tab.
      : rawSection === LEGACY_SHARED_SECTION
        ? "team"
        : "my";

  return {
    section,
    viewMode,
    tab,
  };
}
