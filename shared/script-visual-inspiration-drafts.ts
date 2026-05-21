import type { VisualInspirationItem } from "./worldbuilding-inspiration";

export function buildVisualInspirationDraftsFromScript(args: { scriptText: string; detectedEntities?: { characters?: string[]; scenes?: string[] }; assetNeeds?: { visual?: string[] } }) : VisualInspirationItem[] {
  const text = args.scriptText || "";
  const items: VisualInspirationItem[] = [];
  const now = new Date().toISOString();
  (args.detectedEntities?.characters ?? []).forEach((name, idx) => items.push({ id: `draft-char-${idx}`, title: `${name} 角色靈感草稿`, sourceType: "generated", kind: "character", tags: ["script-draft"], promptSeed: `請以繁體中文生成角色「${name}」的一致性視覺設定`, usageScope: "private_project", createdAt: now }));
  (args.detectedEntities?.scenes ?? []).forEach((name, idx) => items.push({ id: `draft-scene-${idx}`, title: `${name} 場景靈感草稿`, sourceType: "generated", kind: "scene", tags: ["script-draft"], promptSeed: `請以繁體中文生成場景「${name}」的視覺氛圍參考`, usageScope: "private_project", createdAt: now }));
  const styleHits = ["雨天", "黃昏", "夜景", "柔光", "霓虹"].filter(k => text.includes(k));
  styleHits.forEach((k, idx) => items.push({ id: `draft-style-${idx}`, title: `${k} 風格草稿`, sourceType: "generated", kind: "style", tags: [k], mood: k, promptSeed: `請以繁體中文產生「${k}」風格的影像描述`, usageScope: "private_project", createdAt: now }));
  if (/(特寫|俯拍|廣角|運鏡|推鏡)/.test(text)) items.push({ id: "draft-shot-1", title: "鏡頭語言草稿", sourceType: "generated", kind: "shot", tags: ["camera"], composition: "依腳本鏡頭語言建立分鏡構圖", promptSeed: "請以繁體中文強化鏡頭語言與構圖一致性", usageScope: "private_project", createdAt: now });
  return items;
}
