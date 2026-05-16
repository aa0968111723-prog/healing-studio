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

export function resolveAssetsLibraryRouteState(search: string) {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const rawSection = params.get("section");
  const rawView = params.get("view");
  const rawTab = params.get("tab");

  const section = SECTION_IDS.includes(rawSection as AssetsLibrarySectionId)
    ? (rawSection as AssetsLibrarySectionId)
    : "assets";

  const viewMode: AssetsLibraryViewMode =
    rawView === "history" || rawView === "cards"
      ? rawView
      : rawSection === "history"
        ? "history"
        : "cards";

  const tab: AssetsLibraryTab =
    rawTab === "team" || rawTab === "my"
      ? rawTab
      : rawSection === "shared"
        ? "team"
        : "my";

  return {
    section,
    viewMode,
    tab,
  };
}
