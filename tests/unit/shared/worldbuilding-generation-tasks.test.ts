import { describe, expect, it } from "vitest";
import { buildGenerationTaskList } from "../../../shared/worldbuilding-generation-tasks";

describe("buildGenerationTaskList", () => {
  it("建立任務清單", () => {
    const list = buildGenerationTaskList({ json: { characters:[{id:"c1",name:"A"}], scenes:[{id:"s1",name:"S"}], storyboards:[{id:"sh1",title:"鏡頭1"}], voiceDirections:["VO"], musicPromptSeeds:["m"], soundCueList:["rain"] } });
    expect(list.imageTasks.length).toBeGreaterThan(0);
    expect(list.videoTasks.length).toBe(1);
    expect(list.publishingTasks.length).toBe(1);
  });
});
