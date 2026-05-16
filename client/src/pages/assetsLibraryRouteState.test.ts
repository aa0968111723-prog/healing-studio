import { describe, expect, it } from "vitest";

import { resolveAssetsLibraryRouteState } from "./assetsLibraryRouteState";

describe("resolveAssetsLibraryRouteState", () => {
  it("keeps legacy shared links on the assets section and opens the team tab", () => {
    expect(resolveAssetsLibraryRouteState("?section=shared")).toEqual({
      section: "assets",
      viewMode: "cards",
      tab: "team",
    });
  });

  it("keeps legacy history links on the assets section and history view", () => {
    expect(resolveAssetsLibraryRouteState("?section=history")).toEqual({
      section: "assets",
      viewMode: "history",
      tab: "my",
    });
  });
});
