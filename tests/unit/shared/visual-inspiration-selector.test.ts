import { describe, it, expect } from "vitest";
import { evaluateVisualConsistencyHints, selectInspirationsForGenerationTask } from "../../../shared/visual-inspiration-selector";

const lib = { items:[{id:"1",title:"c",kind:"character",sourceType:"upload",tags:[],createdAt:new Date().toISOString(),linkedCharacterIds:["c1"],imageUrl:"u"} as any] };
describe("selector",()=>{
 it("selects",()=>{ expect(selectInspirationsForGenerationTask({taskType:"character_image",library:lib,characterIds:["c1"]})[0]?.id).toBe("1"); });
 it("warnings",()=>{ const r=evaluateVisualConsistencyHints({taskPrompt:"角色測試",selectedInspirations:[]}); expect(r.warnings.length).toBeGreaterThan(0); });
});
