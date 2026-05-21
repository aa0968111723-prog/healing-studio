import type { WorldbuildingFrameworkData } from "./worldbuilding-types";
import type { VisualInspirationItem, VisualInspirationKind, VisualInspirationLibrary } from "./worldbuilding-inspiration";

const nowIso = () => new Date().toISOString();
const id = (p: string, i: string) => `${p}-${i}`;

const mk = (partial: Partial<VisualInspirationItem> & { id: string; title: string; kind: VisualInspirationKind; sourceType: VisualInspirationItem["sourceType"] }): VisualInspirationItem => ({ tags: [], createdAt: nowIso(), ...partial });

export function buildVisualInspirationLibrary(world: Partial<WorldbuildingFrameworkData> | null | undefined): VisualInspirationLibrary {
  const w = world ?? {};
  const items: VisualInspirationItem[] = [];
  (w.uploadedAssets ?? []).forEach((a, idx) => {
    if (a.assetType !== "image" || !a.url) return;
    items.push(mk({ id: id("asset", a.id || String(idx)), title: (a as any).label || "上傳圖片", imageUrl: a.url, sourceType: "worldbuilding_asset", kind: "reference", tags: [a.purpose || "upload"].filter(Boolean), licenseNote: (a as any).licenseNote }));
  });
  (w.characters ?? []).forEach(c => {
    (c.referenceLibrary ?? []).forEach((r, idx) => r.imageUrl && items.push(mk({ id: id("char-ref", `${c.id}-${r.id || idx}`), title: (r as any).label || `${c.name} 參考`, imageUrl: r.imageUrl, sourceType: "character_reference", kind: "character", linkedCharacterIds: [c.id], tags: [(r as any).pose || "character"].filter(Boolean) })));
    const tv = c.threeViewSheet;
    [tv?.frontImageUrl, tv?.sideImageUrl, tv?.backImageUrl, tv?.threeQuarterImageUrl].forEach((u, idx) => u && items.push(mk({ id: id("char-three", `${c.id}-${idx}`), title: `${c.name} 三視圖`, imageUrl: u, sourceType: "character_reference", kind: "character", linkedCharacterIds: [c.id] })));
    (c.expressions ?? []).forEach(e => e.imageUrl && items.push(mk({ id: id("char-exp", `${c.id}-${e.id}`), title: `${c.name} ${e.name}`, imageUrl: e.imageUrl, sourceType: "character_reference", kind: "character", linkedCharacterIds: [c.id], mood: e.name })));
    (c.outfits ?? []).forEach(o => o.imageUrl && items.push(mk({ id: id("char-outfit", `${c.id}-${o.id}`), title: `${c.name} ${o.name}`, imageUrl: o.imageUrl, sourceType: "character_reference", kind: "character", linkedCharacterIds: [c.id], palette: o.palette })));
  });
  (w.scenes ?? []).forEach(s => {
    (s.realWorldRefs ?? []).forEach((r, idx) => (r.imageUrls ?? []).forEach((u, imgIdx) => u && items.push(mk({ id: id("scene-ref", `${s.id}-${idx}-${imgIdx}`), title: r.label || `${s.name} 參考`, imageUrl: u, sourceType: "scene_reference", kind: "scene", linkedSceneIds: [s.id], tags: [r.refType || "scene"] }))));
    if (s.establishingShotUrl) items.push(mk({ id: id("scene-est", s.id), title: `${s.name} establishing`, imageUrl: s.establishingShotUrl, sourceType: "scene_reference", kind: "shot", linkedSceneIds: [s.id] }));
  });
  (w.styleProfiles ?? []).forEach((s, idx) => {
    if (!s.artStyle && !(s.palette?.length) && !s.lighting) return;
    items.push(mk({ id: id("style", s.id || String(idx)), title: s.name || `風格 ${idx + 1}`, sourceType: "style_reference", kind: "style", linkedStyleProfileIds: s.id ? [s.id] : undefined, palette: s.palette, artStyle: s.artStyle, lighting: s.lighting, promptSeed: [s.artStyle, s.lighting, (s.palette ?? []).join("、")].filter(Boolean).join("，") }));
  });
  return { items };
}

export const filterVisualInspirations = (library: VisualInspirationLibrary, filters: { kind?: VisualInspirationKind; pinnedOnly?: boolean; missingLicenseOnly?: boolean }) => ({ ...library, items: library.items.filter(i => (!filters.kind || i.kind === filters.kind) && (!filters.pinnedOnly || library.pinnedItemIds?.includes(i.id)) && (!filters.missingLicenseOnly || !i.licenseNote)) });
export const groupVisualInspirationsByKind = (library: VisualInspirationLibrary) => library.items.reduce<Record<string, VisualInspirationItem[]>>((acc, it) => ((acc[it.kind] ||= []).push(it), acc), {});
export const getInspirationsForCharacter = (library: VisualInspirationLibrary, characterId: string) => library.items.filter(i => i.linkedCharacterIds?.includes(characterId));
export const getInspirationsForScene = (library: VisualInspirationLibrary, sceneId: string) => library.items.filter(i => i.linkedSceneIds?.includes(sceneId));
export const getInspirationsForStyle = (library: VisualInspirationLibrary, styleId: string) => library.items.filter(i => i.linkedStyleProfileIds?.includes(styleId));

export function scoreVisualInspirationCompleteness(world: Partial<WorldbuildingFrameworkData> | null | undefined, library: VisualInspirationLibrary) {
  const w = world ?? {};
  const characterCoverage = (w.characters ?? []).map(c => {
    const refs = getInspirationsForCharacter(library, c.id);
    const missing: string[] = []; if (!refs.some(r => r.imageUrl)) missing.push("缺角色參考圖");
    return { id: c.id, name: c.name || "未命名", percent: missing.length ? 40 : 100, missing };
  });
  const sceneCoverage = (w.scenes ?? []).map(s => {
    const refs = getInspirationsForScene(library, s.id);
    const missing: string[] = []; if (!refs.length) missing.push("缺場景參考");
    return { id: s.id, name: s.name || "未命名", percent: missing.length ? 40 : 100, missing };
  });
  const styleCoverage = (w.styleProfiles ?? []).map((s, idx) => {
    const id = s.id || String(idx);
    const refs = getInspirationsForStyle(library, id);
    const missing: string[] = []; if (!refs.length) missing.push("缺風格靈感");
    return { id, name: s.name || `風格 ${idx + 1}`, percent: missing.length ? 50 : 100, missing };
  });
  const all = [...characterCoverage, ...sceneCoverage, ...styleCoverage];
  const overallPercent = all.length ? Math.round(all.reduce((a, b) => a + b.percent, 0) / all.length) : 0;
  return { overallPercent, characterCoverage, sceneCoverage, styleCoverage, warnings: overallPercent < 60 ? ["視覺靈感覆蓋率偏低"] : [] };
}
