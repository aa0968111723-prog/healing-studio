import { describe, it, expect } from "vitest";
import { buildWorldbuildingGenerationTasks } from "../../../shared/worldbuilding-generation-tasks";

describe("generation tasks inspiration",()=>{
  it("injects inspiration fields",()=>{
    const tasks=buildWorldbuildingGenerationTasks({ world:{id:1, characters:[{id:"c1",name:"A",role:"protagonist",appearance:"角色描述"}] as any, scenes:[] } as any, productionPackage:{title:"t",generatedAt:"",readinessPercent:0,warnings:[],markdown:"",json:{voiceDirections:[],musicPromptSeeds:[]}} as any, inspirationLibrary:{items:[{id:"i1",title:"c",kind:"character",sourceType:"upload",tags:[],createdAt:new Date().toISOString(),linkedCharacterIds:["c1"],imageUrl:"u"}]}});
    expect(tasks.find(t=>t.type==="character_image")?.inspirationIds?.[0]).toBe("i1");
  });
});
