import { describe, it, expect } from "vitest";
import { buildWorldbuildingGenerationTasks } from "../../../shared/worldbuilding-generation-tasks";
import { buildWorldbuildingProductionPackage } from "../../../shared/worldbuilding-production-package";

describe("worldbuilding generation tasks", () => {
  it("builds tasks with blockers", () => {
    const world: any = { id: 1, name: "W", characters: [{ id: "c1", name: "A", appearance: "" }], scenes: [{ id: "s1", name: "S", environment: "room", mood: "" }] };
    const pkg = buildWorldbuildingProductionPackage(world, []);
    const tasks = buildWorldbuildingGenerationTasks({ world, productionPackage: pkg, storyboards: [] });
    expect(tasks.some(t => t.status === "blocked")).toBe(true);
  });
});
