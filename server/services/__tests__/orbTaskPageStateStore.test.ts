import { afterEach, describe, expect, it } from "vitest";
import {
  _resetOrbTaskPageStateStoreForTests,
  appendOrbTaskPageState,
  deleteOrbTaskPageState,
  getOrbTaskPageState,
} from "../orbTaskPageStateStore";

afterEach(() => {
  _resetOrbTaskPageStateStoreForTests();
});

describe("orbTaskPageStateStore", () => {
  it("returns empty array for unknown task", () => {
    expect(getOrbTaskPageState("nope")).toEqual([]);
  });

  it("appends and reads back snapshots in order", () => {
    appendOrbTaskPageState("t1", {
      at: 1,
      pageId: "studio",
      actionType: "fillPrompt",
      state: { promptText: "hello" },
    });
    appendOrbTaskPageState("t1", {
      at: 2,
      pageId: "studio",
      actionType: "submit",
      state: { ok: true, jobId: "j-1" },
    });
    const snaps = getOrbTaskPageState("t1");
    expect(snaps).toHaveLength(2);
    expect(snaps[0].actionType).toBe("fillPrompt");
    expect(snaps[1].state).toEqual({ ok: true, jobId: "j-1" });
  });

  it("scopes snapshots per taskId", () => {
    appendOrbTaskPageState("t1", { at: 1, state: { a: 1 } });
    appendOrbTaskPageState("t2", { at: 1, state: { b: 2 } });
    expect(getOrbTaskPageState("t1")).toHaveLength(1);
    expect(getOrbTaskPageState("t2")).toHaveLength(1);
    expect(getOrbTaskPageState("t1")[0].state).toEqual({ a: 1 });
  });

  it("caps at 16 snapshots per task (ring buffer)", () => {
    for (let i = 0; i < 20; i++) {
      appendOrbTaskPageState("t1", { at: i, state: { i } });
    }
    const snaps = getOrbTaskPageState("t1");
    expect(snaps).toHaveLength(16);
    // Oldest 4 dropped — buffer should now start at i=4.
    expect(snaps[0].state).toEqual({ i: 4 });
    expect(snaps[15].state).toEqual({ i: 19 });
  });

  it("delete removes the buffer", () => {
    appendOrbTaskPageState("t1", { at: 1, state: {} });
    expect(getOrbTaskPageState("t1")).toHaveLength(1);
    deleteOrbTaskPageState("t1");
    expect(getOrbTaskPageState("t1")).toEqual([]);
  });
});
