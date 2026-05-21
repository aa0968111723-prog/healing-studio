import { describe, it, expect } from "vitest";
import { buildVisualInspirationDraftsFromScript } from "../../../shared/script-visual-inspiration-drafts";

describe("script drafts",()=>{
 it("builds prompt-only drafts",()=>{ const items=buildVisualInspirationDraftsFromScript({scriptText:"夜景 特寫",detectedEntities:{characters:["小明"],scenes:["天台"]}}); expect(items.some(i=>i.promptSeed && !i.imageUrl)).toBe(true); });
});
