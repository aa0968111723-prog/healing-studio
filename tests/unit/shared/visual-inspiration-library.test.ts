import { describe, it, expect } from "vitest";
import { buildVisualInspirationLibrary, scoreVisualInspirationCompleteness } from "../../../shared/visual-inspiration-library";

describe("visual inspiration library", () => {
  it("empty world", () => { const lib = buildVisualInspirationLibrary(null); expect(lib.items).toEqual([]); expect(scoreVisualInspirationCompleteness(null, lib).overallPercent).toBe(0); });
  it("uploaded asset image", () => { const lib = buildVisualInspirationLibrary({ uploadedAssets:[{id:"a1", assetType:"image", url:"u"} as any] }); expect(lib.items[0]?.imageUrl).toBe("u"); });
  it("character ref linked", () => { const lib = buildVisualInspirationLibrary({ characters:[{id:"c1", name:"A", role:"protagonist", referenceLibrary:[{id:"r", imageUrl:"i"}]} as any] }); expect(lib.items.some(i=>i.linkedCharacterIds?.includes("c1"))).toBe(true); });
  it("scene refs linked", () => { const lib = buildVisualInspirationLibrary({ scenes:[{id:"s1", name:"S", realWorldRefs:[{imageUrls:["i"]}]} as any] }); expect(lib.items.some(i=>i.linkedSceneIds?.includes("s1"))).toBe(true); });
  it("palette-only style", () => { const lib = buildVisualInspirationLibrary({ styleProfiles:[{id:"st1", palette:["#fff"]} as any] }); expect(lib.items[0]?.kind).toBe("style"); });
});
