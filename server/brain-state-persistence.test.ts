/**
 * Brain State Persistence — Vitest tests
 * ────────────────────────────────────────────────────────────────────────────
 * Hermetic：使用 BRAIN_STATE_FILE 指向 tmp 路徑；NODE_ENV=test 預設關閉持久化，
 * 故每個測試都需要明確 unset NODE_ENV / 設 BRAIN_STATE_DISABLE=0 才會啟用寫入。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// 把 NODE_ENV 改成 production，這樣 isPersistDisabled 才會放行。
const originalNodeEnv = process.env.NODE_ENV;
const originalDisable = process.env.BRAIN_STATE_DISABLE;
const originalFile = process.env.BRAIN_STATE_FILE;

let tmpDir = "";
let tmpFile = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-state-"));
  tmpFile = path.join(tmpDir, "state.json");
  process.env.NODE_ENV = "production";
  delete process.env.BRAIN_STATE_DISABLE;
  process.env.BRAIN_STATE_FILE = tmpFile;
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalDisable === undefined) delete process.env.BRAIN_STATE_DISABLE;
  else process.env.BRAIN_STATE_DISABLE = originalDisable;
  if (originalFile === undefined) delete process.env.BRAIN_STATE_FILE;
  else process.env.BRAIN_STATE_FILE = originalFile;
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("brainStatePersistence", () => {
  it("loadStateSync returns null when file missing", async () => {
    const { loadStateSync } = await import("./services/brainStatePersistence");
    expect(loadStateSync()).toBeNull();
  });

  it("flushNow writes a JSON file that loadStateSync can read back", async () => {
    const { flushNow, loadStateSync } = await import(
      "./services/brainStatePersistence"
    );
    await flushNow(() => ({
      reflectionProposals: [{ id: "prop_1", title: "hello" }],
      savedAt: 12345,
    }));
    const state = loadStateSync();
    expect(state).not.toBeNull();
    expect(Array.isArray(state?.reflectionProposals)).toBe(true);
    expect((state?.reflectionProposals?.[0] as { id: string }).id).toBe(
      "prop_1"
    );
    expect(state?.savedAt).toBe(12345);
  });

  it("loadStateSync ignores corrupt JSON", async () => {
    await fs.writeFile(tmpFile, "{not valid json", "utf8");
    const { loadStateSync } = await import(
      "./services/brainStatePersistence"
    );
    expect(loadStateSync()).toBeNull();
  });

  it("schedulePersist + flushNow are noops when NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    const { schedulePersist, flushNow, loadStateSync } = await import(
      "./services/brainStatePersistence"
    );
    schedulePersist(() => ({ savedAt: 1 }));
    await flushNow(() => ({ savedAt: 1 }));
    expect(loadStateSync()).toBeNull();
    // file should not have been created
    let exists = true;
    try {
      await fs.access(tmpFile);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
