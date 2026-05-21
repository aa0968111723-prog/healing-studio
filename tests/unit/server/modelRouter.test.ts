import { describe, it, expect } from "vitest";
import { executeModelTask } from "../../../server/services/modelRouter";

describe("modelRouter", () => {
  it("returns dry run", async () => {
    const res = await executeModelTask({ taskId: "t1", taskType: "character_image", modelId: "internal-image-draft", provider: "internal", payload: {}, dryRun: true });
    expect(res.status).toBe("dry_run");
  });
});
